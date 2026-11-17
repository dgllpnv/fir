# Tickets — Indicadores & Insights

Spec: [`indicadores-e-insights.md`](indicadores-e-insights.md), revisada pelo gate em 2026-11-17. O índice "Condições dos gates", no fim da spec, mapeia cada id para o ticket e o teste. Cada condição aparece abaixo com a sigla do parecer.

## Ordem

- T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10.
- T0 (troca do `xlsx`) é independente e só precisa fechar **antes do T8**.
- T3 e T4 podem correr em paralelo depois do T2, com propriedade de arquivo:
  - T3 é dono de `indicadores/lancamentos*`;
  - T4 é dono de `indicadores/okrs*`.
- T8 pode começar depois do T1.
- O valor chega cedo:
  - T2: a meta no lugar único;
  - T5: a tela principal;
  - T8: o primeiro relatório exportável.

**Cada ticket fecha** com `pnpm typecheck && pnpm turbo run test --concurrency=1 && pnpm build`, com a saída colada.

**Seams:** `packages/domain` puro · HTTP sobre Postgres real · repositórios sobre Postgres real. **Nenhum seam novo.**

**ADRs:**

| Ticket | ADR |
|---|---|
| T1 | KPI, escala e `ValorNaTela`, com o residual de inferência aceito *(appsec C10)* |
| T1 | Recaptação e rotina derivadas (substitui em parte a 0014) |
| T2 | Meta única (`metas_do_mes` → `metas_de_kpi`) |
| T2 | Meta medida pelos dias de caixa fechado, a partir de `conferencia_desde` *(números B6)* |
| T2 | Correção de `caixasDoMes` *(números B3)* |
| T8 | Relatórios: motor por `POST`, arquivo no navegador, exportação registrada, `acao` própria (LGPD R-a) |
| T10 | O que atravessa para a carteira, emendando a 0013 *(appsec C28)* |

**`claude-security:scan`** no diff do T3, do T8, do T9 e do T10, antes do `/code-review` *(appsec C30)*.

---

## T0 — Trocar `xlsx` 0.18.5 pelo tarball oficial SheetJS 0.20.3 *(appsec C18)*

**O quê.**
- Em `apps/web/package.json`, `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`, fixado com `integrity` no `pnpm-lock.yaml`.
- `lib/planilha.ts` não muda.
- Commit próprio.

**Por quê.** Corrige a CVE-2023-30533 (poluição de protótipo na leitura) e a CVE-2024-22363 (ReDoS). O caminho exposto **já está em produção**: a importação de pacientes, de campanha e de estoque lê planilhas de terceiros.

**Testes.**
- `pnpm audit` sem aviso de `xlsx`.
- A suíte de importação (pacientes, campanha, estoque) passa sem alteração.
- Um e2e de importação real roda com o pacote novo.

**Fecha:** appsec C18.

---

## T1 — Domínio, catálogo e esquema

**Bloqueantes resolvidos na spec:** números B1, B2, B4 · appsec C5.

**Arquivos (`packages/domain/src/indicadores/`)**

| Arquivo | Conteúdo |
|---|---|
| `catalogo.ts` | as 20 chaves (I-7), com `permissaoDoValor` *(appsec C5; números c.11b)*; as agregações `analise` e `media_mensal` *(números B4, c.6)*; o schema de parâmetros por chave, `.strict()` *(appsec C6)* |
| `unidades.ts` | `ESCALA_DA_UNIDADE`, `NumeroDoKpi` e `valorNaTela(…)`, o **único** construtor, com XOR por unidade *(appsec C7)*; o formatador por unidade |
| `meta.ts` | os itens abaixo |
| `periodos.ts` | `agrupamentoPara`, `baldes`, `janelaComparavel` sobre os dias de `D` *(números B1, c.8)*, `variacao`, `referenciaPendente`, `prazoDoLancamento`, `mesesDaSerie`, `regimeDoDia(dia, conferenciaDesde, hoje)` *(números B6)* |
| `okr.ts` | `progressoDoOkr`, a média dos progressos inteiros exibidos *(números c.12)*; `situacaoDoOkr`; ordenações |
| `jornada.ts` | `classificarDesfecho`, `recontatoEmAteDoisDias`, `faltaMadura`, `ehRecaptacao` |
| `pessoas.ts` | `umAUmEmDia` |
| `conversao.ts` | `conversaoDeOrcamentos(enviados, fechados)` com o limite de 100 do Painel *(números c.1)*. O Painel passa a usá-la no T2 |

Itens de `meta.ts`:
- `janelaDaMeta`;
- `ritmoEsperado` no fim do dia `t`, exato, como fração *(números B2)*;
- `situacao`, por multiplicação cruzada *(números c.7)*, com o teto e o valor `null` da perda *(números B4)*;
- `progresso` inteiro;
- `projecao` sobre `úteis(D)` *(números B1)*, `null` com `corte = início` e sinal de incidente para valor fora do domínio *(números c.16)*;
- `percentualDaMeta` inteiro *(números c.11a)*.

**Fora do diretório**
- `permissoes.ts`:
  - as duas chaves;
  - `pf_sup`;
  - `podeLancar`;
  - `exigeValoresParaEscrever(unidade)` *(appsec C3)*;
  - `emDinheiro` em `CAMPOS_MONETARIOS`, com o comentário.
- `DIAS_SEM_RETORNO` vai para o domínio.
- `packages/contracts/src/indicadores.ts`.

**Migrations**
- **0098:**
  - todas as tabelas de indicadores, menos favoritos, exportação e carteira;
  - `tarefas.kpi_id`;
  - `parametros NOT NULL DEFAULT '{}'` *(números c.13)*;
  - RLS `ENABLE` + `FORCE`, com policy `USING` **e** `WITH CHECK`;
  - **FK composta `(clinica_id, x)` em toda referência**, e `UNIQUE (clinica_id, id)` nas tabelas-mãe que não o têm *(appsec C24)*;
  - trigger de auditoria;
  - o `EXCLUDE`;
  - `fotografias_de_kpi` só com `INSERT` *(appsec C25)*;
  - nenhum `DELETE` a `fir_app`.
- **0099:** as chaves nos perfis com `painel`, idempotente.

**Testes**
- **Domínio:**
  - `ritmo-dezembro-2026` e a property `ritmo-vespera-e-prazo` *(B2)*;
  - `situacao-multiplicacao-cruzada` *(c.7)*;
  - `faturamento-conferido-dia-aberto-no-meio-nao-infla-projecao` *(B1)*;
  - `janela-comparavel-mes-curto` e `janela-comparavel-usa-dias-de-D` *(c.8, B1)*;
  - `perda-sem-contagem-nao-atinge-teto` (parte pura) *(B4)*;
  - `media-mensal-nao-recombina` *(c.6)*;
  - `okr-media-dos-exibidos` *(c.12)*;
  - `projecao-com-corte-no-inicio-e-null` *(c.16)*;
  - `valor-na-tela-reais-sem-em-numero`, property *(C7)*;
  - `perms-sem-dependencia-em-cadeia`, arquitetura *(C4)*;
  - `percentual-da-meta-inteiro` *(c.11a)*;
  - `resultado-do-mes-so-mes-civil-422` (validação pura) *(c.4)*;
  - os testes de A.3 e A.5.
- **Postgres real:**
  - `fk-composta-entre-clinicas` *(C24)*;
  - `rls-with-check-tabelas-novas` *(C24)*;
  - `fotografias-so-insert` *(C25)*;
  - `catalogo-parametros-default-unico` *(c.13)*;
  - o `EXCLUDE`;
  - a 0099 idempotente.

**`teste/registro.ts`.** Acrescentar as 7 tabelas a `ENTIDADES_COM_CLINICA`.

**Fecha:** spec A · números B1 (puro), B2, B4 (puro), c.4, c.6, c.7, c.8, c.11a, c.12, c.13 (esquema), c.16 · appsec C3 (predicado), C4, C5 (catálogo), C6 (schemas), C7, C10 (ADR), C24, C25.

---

## T2 — API de KPIs automáticos, metas e migração de `metas_do_mes`

**Bloqueantes:** números B3, B5, B6, B7 · appsec C8, C11.

**Arquivos**
- **Extrações** (tabela da spec): `receitaEPagamentos`, `valorDosOrcamentosPagos`, `contarNovosPacientes`, `contarAbaixoDoMinimo(…, instante)`, `mediaDaEquipeNoMes`, `resultadoDaCampanha`.
  - `saldosDe(…, { ate })`, que **sai do T9 para cá** *(números c.9)*.
  - `diasSemCaixa`, uma função para o Painel, a Visão do mês e o KPI *(números B5)*.
  - `conversaoDeOrcamentos` no Painel *(c.1)*.
- **`caixasDoMes`, corrigida** *(números B3)*:
  - dias úteis até ontem, mais hoje se fechado, mais os não úteis com caixa;
  - toda linha zero;
  - ADR.
- **`apps/api/src/metas/`** e **`apps/api/src/indicadores/`** (calculadora, fontes, serviço, controllers, módulo).
  - O filtro `permissaoDoValor` mora **só** na calculadora e na listagem *(appsec C5)*.
  - A composição com paciente exige `jornada` e é `@DadoSensivel('pacientes', { lista: true })` *(LGPD L-IN-3)*.
- **`financeiro/visao-do-mes.service.ts`:**
  - `metaDe`/`salvarMeta` pelo módulo `metas`, lendo só o KPI com `parametros = '{}'` e vivo *(c.13)*;
  - `PUT` sobre `ate_data` sobreposta → `409` *(c.13)*;
  - o zero arquiva;
  - o medido pela régua da I-9, com `regimeDoDia` *(B6)*, o corte `D`/`L` *(B1)* e a régua MedX dentro do corte *(B5)*;
  - `aguardandoFechamento` no contrato.
- **Fechamento do caixa:** preenche `clinicas.conferencia_desde` quando ela é nula, na mesma transação *(B6)*.
- **`0100_metas_do_mes_para_indicadores.sql`:**
  - KPI por clínica, com o responsável conferido como pessoa da clínica *(appsec C25)*;
  - a cópia;
  - **conferência linha a linha** com `EXCEPT` nos dois sentidos, mais a quantidade e a soma por clínica *(números B7)*;
  - `clinicas.conferencia_desde` preenchida com o primeiro caixa *(B6)*;
  - `REVOKE` em `metas_do_mes`.
- **Script `scripts/comparar-meta-antes-do-deploy.ts`** *(números B6, R-2)*:
  - por clínica e por mês com meta: medido antigo, medido novo, diferença, dias sem caixa;
  - **a saída é gravada fora do repositório** (caminho passado por argumento; o script recusa caminho dentro da árvore do git);
  - a Marília assina a lista, e um mês divergente sem a ciência dela segura o deploy.
- **Ensaio da 0100** numa cópia de produção, com a contagem por clínica dos dois lados anexada ao ticket (só números) *(c.13)*.
- **Job `indicadores-do-dia`**, no `worker-uso-diario`, como `fir_app` em `naClinica`, uma clínica por vez *(appsec C26)*:
  - fotografia pelo instante `início(D+1)`, com recomposição de dia perdido por `ON CONFLICT DO NOTHING` *(c.9)*;
  - materialização de séries.
- **Prévia D.3 sem frase**: números estruturados *(appsec C8)*.
- **Medir** se a Visão do mês mostra o total de hoje a quem tem `finmes`. Se mostrar, vai para `docs/dividas.md` *(appsec C11)*.
- **`docs/dividas.md`:** o custo atual na perda *(números B4)*.

**Testes (HTTP + Postgres real)**
- **Igualdade e dinheiro:**
  - `fonte-unica-<chave>` para as 20 *(c.1)*: Painel, Visão do mês, Análise e Metas do mês na mesma janela;
  - a meta de dezembro igual à Visão do mês (1.10, item 1).
- **Corte de caixa e régua:**
  - `conferencia-desde-regime-anterior-nao-muda` e `hoje-sem-caixa-nao-conta` *(B6)*;
  - `regua-medx-dentro-do-corte` e `dias-sem-caixa-uma-funcao` *(B5)*;
  - `regra-6-nenhum-byte-de-hoje` *(c.10, C11)*.
- **Caixa, perda e posições:**
  - `caixa-sabado-nao-passa-de-100` e `caixa-sobra-e-falta-iguais-tem-diferenca` *(B3)*;
  - `perda-nao-soma-por-mes` e `perda-sem-contagem-nao-atinge-teto` *(B4)*;
  - `banco-de-horas-soma-positivos` *(c.14)*;
  - `fotografia-pelo-instante` e `fotografia-dia-perdido-recompoe` *(c.9)*.
- **Migração e meta da Visão do mês:**
  - `migracao-0100-meses-trocados-aborta` *(B7)*;
  - `metas-do-mes-put-antigo-falha` *(C25)*;
  - `put-meta-mes-sobre-ate-data-409` *(c.13)*.
- **Definições de KPI:**
  - `valor-fechado-e-orc-valor` *(c.3)*;
  - `despesas-fixas-sobre-recebido-sem-outras-entradas` *(c.5)*;
  - `resultado-do-mes-comparacao-mes-inteiro` *(c.4)*;
  - `fonte-fora-do-dominio-incidente` *(c.16)*.
- **Permissão e redação:**
  - `kpi-rh-some-sem-pessoas-gerir` e `razao-monetaria-some-sem-valores` *(C5, c.11b)*;
  - `aguardando-null-para-equipe`, com mutação *(c.11d)*;
  - `nenhuma-string-com-dinheiro`, com mutação *(C8)*;
  - `escrever-reais-sem-valores-403` em metas, séries e prévia *(C3)*;
  - `ids-de-outra-clinica` (parâmetros, responsável, série) *(C6)*.
- **Jornada, jobs e log:**
  - `composicao-com-paciente-exige-jornada` *(L-IN-3)*;
  - `job-nao-cruza-clinica` *(C26)*;
  - `log-sem-conteudo-indicadores` *(C29)*.
- **Suítes antigas:** a do Painel e a da Visão do mês sem alteração de asserção. A exceção são o medido da meta (I-9) e o `comDiferenca` (I-15), que mudam de propósito, com a ADR citada no teste.

**`teste/registro.ts`.**
- `['emDinheiro']` em: `GET /v1/indicadores/catalogo`, `GET /v1/indicadores`, `GET /v1/indicadores/kpis/:id`, `GET /v1/indicadores/kpis/:id/serie`, `GET /v1/indicadores/metas/previa`, `POST`/`PUT` de metas e de KPIs.
- `GET /v1/metas/:mes/percentual` e `GET /v1/visao-do-mes` ganham `aguardandoFechamento`.
- `aguardandoFechamento` também em `CAMPOS_MONETARIOS`.
- A matriz de acesso, com a permissão mínima de cada rota *(C4)*.

**Fecha:**
- 1.10, itens 1, 2, 8 e 9;
- spec B e D;
- números B1, B3, B5, B6, B7, c.1–c.5, c.9, c.10, c.11b/d, c.13, c.14, c.16;
- appsec C3, C5, C6, C8, C11, C25, C26, C29;
- LGPD L-IN-3.

---

## T3 — KPIs manuais, lançamentos e tarefas

**Bloqueante:** appsec C2.

**Arquivos**
- `indicadores/lancamentos.service.ts` e a rota `PUT …/lancamentos/:referencia`, guardada por `podeLancar`, **registrada como exceção nomeada** *(appsec C4)*.
  - Só KPI manual, vivo e da clínica.
  - `responsavel_id` lido na mesma transação *(appsec C1)*.
  - A resposta é **só o schema do lançamento**, e o valor anterior em reais sai redigido *(appsec C2)*.
- A geração de tarefas no job (o cursor), a reatribuição e o cancelamento.
- `tarefas/`:
  - `TarefaNaLista.lancamentoDeKpi = { kpiId, nome, unidade, comoMedir, referencia, prazo }`: tudo o que a D.4 precisa, **sem nenhuma rota de leitura de indicadores** *(appsec C2)*;
  - `TarefaNaLista.kpi = { id, nome }`;
  - `POST /v1/tarefas` recusa o marcador `lancamento-kpi:` *(appsec C27)*.
- O aviso fixo nos campos `comentario` e `como_medir` *(LGPD R-e)*. Nenhum dos dois vai para log *(appsec C29)*.

**Testes (HTTP + Postgres real)**
- C.1–C.3 da spec.
- `lancamento-responsavel-trocada`, `lancamento-kpi-de-catalogo-422`, `lancamento-outra-clinica-404` e `lancamento-arquivado-409` *(C1)*.
- `excecao-da-responsavel-nao-abre-leitura`: `403` em todo `GET /v1/indicadores*`, e nenhuma chave fora do schema no `PUT` *(C2)*.
- `marcador-lancamento-forjado-422` *(C27)*.
- `escrever-reais-sem-valores-403` no `PUT` de KPI manual que muda a unidade para `reais` *(C3)*.
- `log-sem-conteudo-indicadores` com comentário da fixture *(C29)*.
- `claude-security:scan` *(C30)*.

**`teste/registro.ts`.** `PUT …/lancamentos/:referencia` com `['emDinheiro']`, como exceção de acesso.

**Fecha:** 1.10, item 3 · spec C · appsec C1, C2, C3 (KPI manual), C27 (marcador), C29, C30 · LGPD R-e.

---

## T4 — OKRs e resultados-chave

**Arquivos**
- `indicadores/okrs.service.ts` e `okrs.controller.ts`.
- A trigger de 1 a 5 KRs.
- KR de campanha com o alvo travado.
- `exigeValoresParaEscrever` ao criar, editar e **duplicar** KR em reais *(appsec C3)*.
- `okrId` e `responsavelId` conferidos contra a clínica *(appsec C6)*.
- O aviso fixo em `objetivo` e `porque` *(LGPD R-e)*.

**Testes**
- E.1–E.3 da spec.
- 3 KRs exibidos com 30, 60 e 90 → progresso 60. A situação é a pior. `okr-media-dos-exibidos` também na HTTP *(números c.12)*.
- `escrever-reais-sem-valores-403` no duplicar *(C3)*.
- `ids-de-outra-clinica` (okr, kpi) *(C6)*.

**`teste/registro.ts`.** As rotas de OKR com `['emDinheiro']`.

**Fecha:** 1.10, item 5 · spec E · appsec C3 (OKR), C6 (OKR).

---

## T5 — Tela principal (1.9 A–D)

**O quê.**
- Menu, topo B, abas e filtros.
- Faixas e cartão C.1.
- Formulários D.1–D.4.
- **A frase da prévia D.3 é montada na tela** a partir de `ValorNaTela`, com o formatador central. Sem `valores`, sai sem o trecho em reais *(appsec C8)*.
- O rótulo e a dica próprios de "Despesas fixas sobre o recebido" *(números c.5)*.
- O D.1 avisa "não use nome de pessoa nem de paciente" no nome do KPI manual *(LGPD L-IN-18)*.

**Arquivos.**
- `app/(app)/indicadores/{layout,page}.tsx`.
- `components/indicadores/*`.
- `components/graficos/faisca.tsx`.
- `lib/menu.ts`, `lib/icones.tsx`, `components/shell.tsx`.

**Testes.**
- Playwright do fluxo principal.
- A auditoria do `design.md` §5.
- Sem `valores`: o cartão mostra só o percentual e a prévia não tem `R$`.

**Fecha:** 1.10, itens 6 e 11 (parte) · spec G.1, G.5 · números c.5 (tela) · appsec C8 (tela) · LGPD L-IN-18 (aviso). **Depende de R-1.**

---

## T6 — Detalhe do KPI com gráfico (1.9 E)

**O quê.**
- A página `/indicadores/[id]` inteira, como na spec.
- Ponto de dia aguardando em **qualquer** KPI em reais: sem valor e sem escala, como barra clara *(números c.10)*.
- Em `perda_de_estoque`, o aviso "as barras não somam o total" *(números B4)*.
- "Sem acesso ao detalhe" quando falta a permissão da composição *(LGPD L-IN-3)*.
- Plano de ação:
  - `kpiId` no `POST /v1/tarefas`, conferido contra a clínica *(appsec C6)*;
  - exige `indicadores` mais a `permissaoDoValor` *(appsec C27)*.

**Testes.**
- Playwright:
  - os três botões;
  - junho–novembro dá 6 barras;
  - 01/11–hoje dá dia a dia;
  - sem meta mostra o aviso.
- HTTP:
  - `plano-de-acao-kpi-rh-exige-pessoas-gerir` *(C27)*;
  - `ids-de-outra-clinica` com `kpiId` *(C6)*.
- Medir R-7.

**Fecha:** 1.10, itens 4, 10 e 12 · spec G.2 · appsec C6 (plano), C27 (plano).

---

## T7 — Modo reunião, Hoje, contador e Visão do mês (1.9 F, H)

**O quê.**
- Como na spec.
- `da-semana`, `reuniao` e `contador` respeitam `permissaoDoValor` *(appsec C5)*.
- Nenhuma composição, `pacienteId` nem nome de paciente nessas respostas *(LGPD L-IN-4)*.
- A capa sem string com dinheiro *(appsec C8)*.
- A Visão do mês mostra "aguardando fechamento" e o link.

**Testes.**
- Playwright: o Modo reunião.
- HTTP:
  - `reuniao-sem-paciente` e `da-semana-sem-paciente` *(L-IN-4)*;
  - `kpi-rh-some-sem-pessoas-gerir` nas três rotas *(C5)*;
  - `nenhuma-string-com-dinheiro` *(C8)*.

**`teste/registro.ts`.** `da-semana` e `reuniao` com `['emDinheiro']`.

**Fecha:** 1.10, itens 7 e 13 · spec G.3, G.4 · appsec C5 (rotas), C8 (capa) · LGPD L-IN-4.

---

## T8 — Motor de relatórios, relatórios 1, 8, 11 e 15, exportação e favoritos

**Bloqueantes:** números B8 · appsec C11, C15 · **depende do T0**.

**Arquivos**
- **`packages/contracts/src/relatorios.ts`:**
  - catálogo com `classe` *(LGPD L-IN-1)*;
  - filtros Zod `.strict()`, com enum e ids e **sem string livre** *(appsec C12; LGPD L-IN-7)*;
  - um schema de linha por relatório, igual às colunas padrão da I-38 mais o opt-in *(LGPD L-IN-6)*;
  - nomes `valorMinimo`/`valorMaximo` *(appsec C9)*.
- **`apps/api/src/relatorios/`:**
  - **`motor.ts`:**
    - `SET LOCAL statement_timeout = '10s'`, janela máxima de 24 meses, 60 por hora por pessoa (`429`) e `503` no estouro *(appsec C13)*;
    - registro de acesso **na mesma transação**, falhando fechado, com contagem de linhas e sem campo livre *(appsec C14; LGPD L-IN-8)*;
    - classe dinâmica e `jornada` na classe `saude` *(LGPD L-IN-1, L-IN-2)*;
    - colunas `dinheiro` fora sem `valores`.
  - **Consultas** 1, 8 (dia aguardando com `valor: null`, `forma: null`, contagem distinta, promissória, *números c.10, c.15; appsec C11*), 11 (modo "período da análise", com compensação negativa, *números B8*) e 15. Todas parametrizadas, sem `sql.raw` *(appsec C12)*.
  - **`relatorios.controller.ts`:**
    - `POST /v1/relatorios/:chave/execucoes` *(G4; appsec C15)*;
    - `POST …/exportacoes`, com finalidade na classe `saude` *(LGPD L-IN-11)*, `incluirTelefone` *(LGPD L-IN-6)*, `403` na sessão de suporte *(LGPD L-IN-5)*, código da exportação *(LGPD L-IN-10)*, cabeçalho e aviso prontos e sem dinheiro *(LGPD L-IN-12; appsec C8)*, e `pacientes_da_exportacao` *(LGPD L-IN-9)*.
  - **Favoritos:** Zod na escrita e na leitura, a lista filtrada por permissão, a faixa de valor redigida e `403` ao rodar *(appsec C9, C19; LGPD L-IN-17)*.
- **Log:** `/v1/relatorios*` sem corpo, sem query e sem resposta, no logger da API e no Traefik (`infra/producao`) *(appsec C15; LGPD L-IN-16)*.
- **`0101_relatorios_favoritos_e_exportacoes.sql`:**
  - `relatorios_favoritos`;
  - **`pacientes_da_exportacao (clinica_id, exportacao_id, paciente_id)`**, append-only (só `INSERT`), com RLS e FK composta *(G5; LGPD L-IN-9; appsec C24, C25)*.
- **Web:**
  - `app/(app)/indicadores/relatorios/{page,imprimir/page}.tsx`. A página de impressão busca as linhas pelo `POST …/exportacoes` *(LGPD L-IN-15)*.
  - `components/relatorios/*`.
  - `lib/planilha.ts`: CSV RFC 4180 com BOM e prefixo `'` na célula de texto perigosa, e XLSX só com `t: 's'`, sem `f` e sem hyperlink *(appsec C17)*.
  - Nenhum storage de linhas, nem persistência do TanStack Query. Sair do sistema limpa o cache *(LGPD L-IN-15)*.
  - Nome do arquivo `fir-<relatorio>-<AAAAMMDD>-<8 hex>`.
  - O caixa "Incluir telefone", desligado por padrão.
  - A confirmação com finalidade enumerada.
- **ADR do T8**, com a decisão sobre `acao = 'exportou'` (LGPD R-a). Filtro "Exportações" em Atividades se couber (LGPD R-b).
- **`docs/compliance/retencao.md`:** já tem a seção do parecer. Conferir os nomes de entidade (`relatorio` × `exportacao_de_relatorio`) e o número de migration "0098–0103".

**Testes**
- **Os números batem:**
  - `saidas-batem-com-analise-reabertura` e `sobra-de-frasco-dose-mais-descarte` *(B8)*;
  - `relatorio-8-dia-aberto-sem-forma` e `relatorio-8-bate-com-visao-com-promissoria` *(c.10, c.15, C11)*;
  - `relatorio-8-contagem-distinta` *(c.15)*;
  - o resumo do 15 é igual ao Painel.
- **Arquivo e redação:**
  - `exportacao-redacao-mutacao` *(C16)*;
  - `csv-xlsx-sem-formula`, com `=cmd()`, `+1`, `-2+3`, `@SUM(A1)`, `\t=1`, `" ;=1` e quebra de linha, e o XLSX relido sem `f` *(C17)*;
  - `nenhuma-string-com-dinheiro` no cabeçalho e no resumo *(C8)*.
- **Execução segura:**
  - `relatorio-filtro-desconhecido-422` e `relatorio-pg-sleep-inerte` *(C12)*;
  - arquitetura `relatorios-sem-sql-raw` *(C12)*;
  - `relatorio-61-execucao-429` e `relatorio-timeout-503` *(C13)*;
  - `registro-de-acesso-falha-fechado` *(C14)*;
  - `relatorio-filtros-fora-do-log` *(C15, L-IN-16)*.
- **Favoritos:**
  - `favorito-faixa-de-valor-redigido-e-403` *(C9)*;
  - `favorito-de-relatorio-sem-permissao-nao-aparece` *(C19)*;
  - `favorito-chave-extra-422` *(L-IN-17)*.
- **LGPD:**
  - `classe-do-relatorio-por-filtro` *(L-IN-1)*;
  - `saude-exige-jornada` (1 com procedimento e 11) *(L-IN-2)*;
  - `suporte-nao-exporta-pessoal-nem-saude` *(L-IN-5)*;
  - `schema-de-linha-e-o-padrao` e `exportacao-sem-telefone-por-padrao` *(L-IN-6)*;
  - `filtros-sem-string-livre` *(L-IN-7)*;
  - `geracao-registrada-com-contagem` *(L-IN-8)*;
  - `pacientes-da-exportacao-n-linhas` e `pacientes-da-exportacao-so-insert` *(L-IN-9, C25)*;
  - `codigo-da-exportacao-bate-com-auditoria` *(L-IN-10)*;
  - `exportacao-saude-sem-finalidade-422` *(L-IN-11)*.
- **Playwright:**
  - `exportacao-cabecalho-e-aviso` nos três formatos *(L-IN-12; 1.10, item 14)*;
  - `storage-sem-linhas` *(L-IN-15)*;
  - o favorito com um clique (1.10, item 18).
- `log-sem-conteudo-relatorios` *(C29)*.
- `claude-security:scan` *(C30)*.

**`teste/registro.ts`.**
- `POST /v1/relatorios/:chave/execucoes` e `POST …/exportacoes` com `valorDaUltimaCompra`, `ltv`, `valor`, `custo`, `emDinheiro`.
- `GET /v1/relatorios` com `valorMinimo` e `valorMaximo`.
- `relatorios_favoritos` e `pacientes_da_exportacao` em `ENTIDADES_COM_CLINICA`.
- `CAMPOS_MONETARIOS` ganha `valorDaUltimaCompra`, `valorMinimo` e `valorMaximo`.

**Fecha:**
- 1.10, itens 14, 16, 17 e 18;
- spec H.1, H.3–H.11;
- números B8, c.10 (relatório), c.15;
- appsec C8 (relatório), C9, C11 (relatório), C12–C17, C19, C25 (exportação), C29, C30;
- LGPD L-IN-1, L-IN-2 (1 e 11), L-IN-5 a L-IN-12, L-IN-15 a L-IN-17, R-a, R-b.

---

## T9 — Os outros 11 relatórios e "Criar campanha com esta lista"

**Bloqueante:** appsec C21.

**Arquivos**
- **`relatorios/consultas/*.ts`** dos relatórios 2–7, 9, 10, 12, 13 e 14, com as colunas padrão da I-38 *(LGPD L-IN-6)*:
  - 3 exige `valores` *(números c.11c)*;
  - 4 sem nome das indicadas;
  - 5 e 13 com classe `saude` e `jornada` *(LGPD L-IN-2)*;
  - 7 com dia/mês e idade;
  - 9 com `saldosDe(…, { ate })` (feito no T2) e faixa de valor só com `valores`;
  - 13 com valor fechado = `orc_valor` *(números c.3)*;
  - 14 com recontato pela I-11.
- **`relatorios/campanha.service.ts`:** a rota `POST /v1/relatorios/:chave/campanha`.
  - Permissões e `.strict()` sem `pacienteIds` *(appsec C20)*.
  - `Idempotency-Key` gravada em `campanhas.chave_de_idempotencia` *(appsec C21)*.
  - Tudo ou nada: acima de 2.000 ou `truncado` → `422` *(appsec C22)*.
  - Destino, responsável e tipo conferidos *(appsec C23)*.
  - Desativados (inclusive `pediu-para-sair`) e anonimizados fora *(LGPD L-IN-14)*.
  - Na classe `saude`, nada de procedimento copiado *(LGPD L-IN-13)*.
- **`campanhas/campanhas.service.ts`:** `criarNaTransacao` e `adicionarPacientesNaTransacao`.
- **`0102_campanha_chave_de_idempotencia.sql`:** `campanhas.chave_de_idempotencia uuid NULL` com `UNIQUE (clinica_id, chave_de_idempotencia)` *(appsec C21)*.
- **Web:**
  - o formulário de campanha no modo "com lista", com o uuid gerado ao abrir;
  - na classe `saude`, a dica da L-IN-13.

**Testes**
- `campanha-da-lista-tres-posts-uma-campanha`, com os três concorrentes *(C21)*.
- `campanha-da-lista-2001-422`, com zero linhas novas *(C22)*.
- `campanha-da-lista-permissoes-403` e `campanha-da-lista-recusa-paciente-ids` *(C20)*.
- `campanha-da-lista-destino-e-tarefa-conferidos` *(C23)*.
- `campanha-da-lista-sem-pediu-para-sair` *(L-IN-14)*.
- `campanha-saude-sem-procedimento` *(L-IN-13)*.
- H.2: rodar duas vezes dá `criadas = 0`, e a origem do paciente não muda.
- `relatorio-3-exige-valores` *(c.11c)*.
- `saude-exige-jornada` para o 5 e o 13 *(L-IN-2)*.
- Σ do 9 com corte hoje = `aReceber`; corte passado; agrupamento por adesão.
- Redação por relatório, com mutação em um deles.
- `log-sem-conteudo-relatorios` *(C29)*.
- `claude-security:scan` *(C30)*.

**`teste/registro.ts`.**
- A união de `execucoes`/`exportacoes` amplia com `valorAberto`, `valorOrcamento`, `valorFechado`, `valorPago`, `ticketMedio`, `receita`, `receitaDasIndicadas`.
- `POST …/campanha` com `[]`.
- `CAMPOS_MONETARIOS` ganha `receitaDasIndicadas`.

**Fecha:**
- 1.10, item 15;
- spec H.2;
- números c.3 (relatório 13), c.11c;
- appsec C20–C23, C29, C30;
- LGPD L-IN-2 (5 e 13), L-IN-6 (restantes), L-IN-13, L-IN-14.

---

## T10 — Carteira, Manual e Ajuda

**Bloqueio:** os valores em reais e o nome livre só atravessam com a ADR que emenda a 0013 **aceita** *(appsec C28)*. Sem ela, o ticket entrega só situação e percentual.

**Arquivos**
- **`0103_kpis_na_carteira.sql`**, no molde da 0028/0046: sem `clinica_id`, `FORCE` RLS por grupo *(appsec C28)*.
- **Job `uso-diario-cliente`:**
  - grava só para clínica com vínculo ativo, e para no desvínculo;
  - não grava os três KPIs de RH *(appsec C5, C28)*;
  - no pilar Pessoas grava `valor_*` nulo *(LGPD L-IN-18)*;
  - roda como `fir_app` em `naClinica` *(appsec C26)*.
- **Leitura na carteira** pelo espaço `carteira` do interceptor (`temPermCarteira(…,'valores')`) *(appsec C28)*.
- O bloco "Indicadores da clínica" na ficha do Cliente Firmare.
- O texto de "Grupos que recebem a clínica".
- **Manual (capítulo novo) e Ajuda:**
  - as duas receitas *(números c.2)*;
  - o KPI manual como posição;
  - a régua da meta e `conferencia_desde` *(números B6, R-2)*;
  - as divergências da I-38 *(LGPD)*;
  - os avisos de texto livre.
- **`docs/compliance/retencao.md`:** `kpis_na_carteira`, 2 anos (a seção do parecer já existe).

**Testes.**
- `carteira-sem-valores-null`, `carteira-grupo-b-zero` e `carteira-desvinculada-sem-linha` *(C28)*.
- `carteira-pessoas-sem-valor` *(L-IN-18)*.
- `kpi-rh-some-sem-pessoas-gerir` na carteira *(C5)*.
- `job-nao-cruza-clinica` *(C26)*.
- Três rodadas idempotentes.
- `claude-security:scan` *(C30)*.

**`teste/registro.ts`.** `kpis_na_carteira` na mesma lista de `uso_diario_cliente`.

**Fecha:** spec I · números c.2 (Manual) · appsec C5 (carteira), C26, C28, C30 · LGPD L-IN-18.

---

## Critérios da 1.10 por ticket

| Critério da 1.10 | Ticket |
|---|---|
| Meta de dezembro igual à Visão do mês | T2 |
| Conversão igual à do Painel | T2 |
| KPI manual semanal, com tarefa em Hoje que conclui | T3 |
| Gráfico com real, ritmo e projeção, e a cor | T1, T6 |
| OKR com 3 KRs, progresso = média | T4 |
| Sem `valores`, só percentual | T2–T9 |
| Modo reunião em tela cheia, pelas setas | T7 |
| Meta da Visão do mês migrada | T2 |
| Faturamento conferido e "aguardando fechamento" | T2 |
| Os três botões do gráfico | T6 |
| Telas iguais ao protótipo | T5–T8 (R-1) |
| Personalizado: 6 barras; dia a dia | T1, T6 |
| Fundo claro no Modo reunião | T7 |
| "Sem compra há 6 meses" exporta nos três formatos | T8 |
| Criar campanha com a lista | T9 |
| Recebimentos = Visão do mês; saídas = Análise | T8 |
| Sem `valores`, exportação sem reais | T8, T9 |
| Favorito com um clique | T8 |
