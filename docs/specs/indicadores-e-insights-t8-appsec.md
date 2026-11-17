# Revisão AppSec + LGPD — T8, motor de relatórios (commit `dfa581f`)

**Revisor:** especialista-seguranca-appsec · **Data:** 2026-11-17 · **Substitui:** o `claude-security:scan` da C30 para o T8
**Escopo:** `apps/api/src/relatorios/**`, `packages/contracts/src/relatorios.ts`, migration 0104, ADR `2026-11-17-relatorios-motor-por-post-e-exportacao-registrada`, `ehCampoMonetario` (`packages/domain/src/permissoes.ts:497`).
**Gates:** `indicadores-e-insights-gate-appsec.md` (C8, C9, C11–C17, C19, C25, C29) e `-gate-lgpd.md` (L-IN-1, 2, 5–12, 16, 17, R-a, R-b).

## Veredito: **REPROVADO**

Dois bloqueios. Os dois foram reproduzidos por e2e contra o Postgres real. Corrigidos esses dois, o resto está aprovado. O motor está bem construído. Não há SQL dinâmico, o registro de acesso falha fechado, a redação tem duas camadas e a classe de tempo de execução está certa.

Reprodução: `C:\Users\DAVI LOPES\AppData\Local\Temp\claude\98c2d27d665826e8\a42be1c1-344f-444d-89d5-ad2a994d3400\scratchpad\appsec-t8-adversarial.e2e.test.ts`. O arquivo foi tirado do repositório para não quebrar a suíte de quem trabalha em paralelo. O QA pode adotá-lo em `apps/api/src/relatorios/`.

## Bloqueios

### B1 — C13: o limite por hora não segura pedidos simultâneos e não conta tentativas que estouram o tempo
`apps/api/src/relatorios/motor.ts:221-230` (o `count`) e `:250-263` (o `INSERT` que conta), em READ COMMITTED e sem trava.
- **ADV-1:** 15 `POST …/execucoes` em paralelo com `porHora = 3` deram **11 respostas 200 e 11 registros**. A contagem só enxerga a linha depois do COMMIT, e cada pedido em voo lê o mesmo `n`. Com consultas que levam vários segundos, a janela fica aberta pelo tempo da consulta inteira. Teto de 60 × 10.000 linhas por hora não existe para quem dispara em paralelo.
- **ADV-2:** com `porHora = 1`, quatro pedidos seguidos que estouraram o `statement_timeout` deram `503,503,503,503` e **nunca 429**. O 503 desfaz a transação junto com o registro (`:273-279`). Então a consulta cara, que é justamente a que o par timeout + limite deveria conter, pode ser repetida sem fim.
- **Correção exigida:** antes do `count`, rodar `pg_advisory_xact_lock(hashtextextended(clinica_id || ':' || ator_id, 0))` para serializar por pessoa. Além disso, a tentativa tem de contar mesmo quando a consulta falha: um contador fora da transação da leitura (Redis ou uma linha de tentativa com commit próprio), contado antes da consulta. A trilha continua gravando só o sucesso, como manda a L-IN-8. *Teste:* N em paralelo resultam em no máximo `porHora` respostas 200, e a tentativa que deu 503 conta.

### B2 — Relatório 15 exporta texto livre de tarefa com classe `nenhuma`: dado de paciente sai sem aviso, sem registro de titulares e pela sessão de suporte
`apps/api/src/painel-geral/metricas-diarias.ts:153` (`tarefa: de_paciente ? tipo : descricao`), consumido por `apps/api/src/relatorios/consultas.ts:370-377`. Classe declarada em `packages/contracts/src/relatorios.ts:218`.
- A tarefa **com** `paciente_id` sai certa, só com o `tipo`. Já a tarefa avulsa sai com a `descricao` digitada. No balcão essa descrição é "Ligar para Maria (71) 9…". **ADV-3:** uma tarefa sem `paciente_id` com nome, telefone e "Tirzepatida" na descrição foi exportada em CSV com `classe: nenhuma` e `aviso: null`. Na classe `nenhuma`, o motor deixa a sessão de suporte exportar (`motor.ts:141`, que vale só para classe diferente de `nenhuma`). Também não grava `pacientes_da_exportacao`. Com isso caem a L-IN-5, a L-IN-9, a L-IN-12 e a I-38 ("15: sem paciente").
- **Correção exigida (uma das duas):** (a) o 15 nunca emite `descricao` livre e usa só `tipo` ou um rótulo fixo; ou (b) o 15 passa a `pessoal`, o que traz aviso e bloqueio do suporte. A opção (a) é a recomendada, porque o relatório mede prazo e não precisa do texto. *Teste:* o ADV-3 passa.

## Achados que não bloqueiam (entram como dívida, cada um com o seu gatilho)

- **M1 — Relatório 11: o `motivo` livre do movimento atravessa para quem não tem `jornada`** (`consultas.ts:301-302`). **ADV-4:** o motivo "Frasco da Ana Lúcia Souza caiu" saiu para a `camila` (`estoque.gerir`, sem `jornada`) com classe `nenhuma`. Na prática o motivo costuma ser padronizado ("Sobra de frasco aberto"), mas o campo é livre. Sugestão: emitir só o rótulo do tipo e o motivo do catálogo. O texto livre fica só com `jornada`. Gatilho: o primeiro motivo de descarte ou ajuste digitado à mão.
- **L1 — O código da exportação tem 32 bits e não é único** (`motor.ts:206`, sem UNIQUE em `entidade_id`). Uma colisão faz um arquivo achado apontar para duas exportações (L-IN-10). Sugestão: `UNIQUE (clinica_id, entidade_id) WHERE acao = 'exportou'` e nova tentativa na colisão.
- **L2 — `statement_timeout` limita cada comando, não a execução.** O 11 roda pelo menos 3 comandos, então pode chegar a uns 30 s. Aceitável depois do B1. Registrar o valor real na ADR.
- **L3 — JOINs sem `clinica_id`** em `consultas.ts:286-287` (`pessoas`, `pacientes`). A RLS cobre, mas a segunda camada da regra 19 falta. Acrescentar `AND pa.clinica_id = m.clinica_id`.
- **L4 — `relatorios_favoritos.nome` é texto livre e a clínica toda o vê.** Pode levar "R$ 5 mil" ou um nome de paciente. Só a tela avisa (L-IN-17), e isso é aceito como residual.

## Conferido na fonte e aprovado

- **C8:** cabeçalho, `filtrosEmTexto` e rótulos sem valor. A faixa aparece só como "Faixa de valor aplicada" (`consultas.ts:112`).
- **C9:** `valorMinimo` e `valorMaximo` estão em `CAMPOS_MONETARIOS`. A faixa sem `valores` dá 403 antes do parse (`motor.ts:185`). O `para.filtros` da trilha e o `to_jsonb` dos favoritos são redigidos por nome em qualquer profundidade.
- **C11:** no relatório 8, o dia que não conta sai com `valor` e `forma` em `null`, e hoje fica fora de `aguardandoFechamento` (`consultas.ts:172-194`).
- **C12:** zero `sql.raw` ou `sql.identifier`. O SQL é todo `$n`, e as interpolações em `metricas-diarias.ts` são constantes. Os filtros são Zod `.strict()` sem string livre, e os ids são Uuid. Há teste de arquitetura.
- **C14:** o registro é gravado na mesma transação. A trigger forçada a falhar devolve 500 sem linhas, e isso está testado.
- **C15:** execução por POST. A URL carrega só `:chave`. O Fastify roda sem logger de requisição.
- **C16:** `montar` → `redigir`, e depois o `RedacaoInterceptor` global (`app.module.ts:151`). A exportação passa pelo mesmo caminho.
- **C17 (servidor):** o servidor não monta arquivo, então não há o que escapar aqui. O CSV/XLSX fica para o web.
- **C19:** a lista, a edição e o arquivamento conferem a permissão do relatório. Rodar o favorito passa pelo motor.
- **C25:** `relatorios_favoritos` e `pacientes_da_exportacao` estão sem DELETE para `fir_app`, com trigger append-only que alcança o dono e FK composta para `auditoria (clinica_id, id)`.
- **C29:** o filtro de erro loga só o código do erro.
- **`ehCampoMonetario`:** toda chave de dinheiro de linha e resumo está coberta: `ltv`, `valorDaUltimaCompra`, `valor`, `emDinheiro` (com `emNumero` nulo em reais), `aguardandoFechamento` e `custo`. Nenhuma linha emite dinheiro sob nome que a regra deixe passar. A rota está em `ROTAS_COM_DINHEIRO`, com mutação.
- **L-IN-1 e L-IN-2:** `classeDoRelatorio` sobe a classe para `saude` com o procedimento (1) ou com o paciente (11). O 1 sem `jornada` dá 403. O 11 sem `jornada` cai para `nenhuma` sem a coluna, e a consulta também tira a coluna (`consultas.ts:239`). Esse rebaixamento é seguro.
- **L-IN-5:** o suporte (`pessoa === null`) leva 403 em `pessoal` e `saude`. Ressalva: o B2.
- **L-IN-6, L-IN-7:** telefone opt-in só na exportação, e filtros só por id.
- **L-IN-8, L-IN-9:** `pacientes_da_exportacao` grava exatamente os pacientes das linhas cortadas (1, 8 e 11 com `jornada`). Paciente desativado sai sem nome e fica fora da tabela.
- **L-IN-10, L-IN-11, L-IN-12:** o código vai no nome do arquivo e no `entidade_id`. A finalidade é enumerada e obrigatória em `saude`, e o aviso sai pronto do servidor.
- **L-IN-16, L-IN-17:** atendidas.
- **R-a:** com o CHECK ampliado, `AcaoDaTrilha` e o `superadmin` também ganharam `exportou`. O append-only da `auditoria` (0004) fica intacto.
- **R-b:** Atividades tem o filtro por `acao = 'exportou'`, e isso está testado.
