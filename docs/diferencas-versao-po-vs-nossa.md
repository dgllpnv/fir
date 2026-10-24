# Diferenças entre a versão da PO e a nossa

**O que este documento é:** o inventário completo das diferenças entre o que a PO entregou e o que nós construímos, eixo por eixo. Explicação curta em cada linha, nada omitido.

**O que ele não é:** uma declaração de que já temos as funcionalidades. Não temos. Leia a seção 1 antes de qualquer outra — sem ela, este documento engana.

---

## 1. O recorte honesto, antes de tudo

Há três artefatos, não dois.

| Artefato | O que é | Estado |
|---|---|---|
| `versoes/v20-producao/Code.gs` | Google Apps Script sobre Google Sheets. **4 clínicas em produção real.** Implementa **21** ações | Rodando hoje |
| `prototipo-rotinas-de-gestao.html` | 727 KB, 7,4 mil linhas, escrito pela PO. O `demoApiBase` dele define **59** ações. É a especificação funcional e tem autoridade | Especificação |
| Nosso monorepo | 60 commits, 74 arquivos de código, 24 de teste. Implementa **4** rotas: `POST /v1/entrar`, `POST /v1/sair`, `GET /v1/eu` e `GET /v1/saude` | **Fundação pronta, funcionalidades não** |

**Portanto:** hoje a versão dela faz tudo o que uma clínica precisa, e a nossa faz login. A diferença que este documento descreve é de **arquitetura e de qualidade**, não de funcionalidade entregue. A funcionalidade vem nos épicos 2 a 8, e a lista conferível das 59 ações está em [`paridade.md`](paridade.md) — nenhuma delas está ✅.

As 38 ações que o protótipo tem e a produção não tem (estoque inteiro, financeiro inteiro, documentos, férias, horas, perfis, metas de pessoa) **também são nosso escopo**: o dono pediu "tudo o que ela escreveu".

---

## 2. Resumo

| Eixo | Versão da PO | Nossa versão |
|---|---|---|
| Plataforma | Google Apps Script + Sheets | Container Docker, NestJS + Fastify, Next.js |
| Banco | Uma planilha por clínica | PostgreSQL, um banco, isolamento por RLS |
| Autenticação | `uid` + PIN de 4 dígitos em texto puro, em cada requisição | E-mail + senha, Argon2id, sessão opaca em cookie |
| Autorização | Calculada à mão dentro de cada handler | Dois guards globais; rota descoberta não compila o teste |
| Dinheiro | `Math.round(n*100)/100` — float | `bigint` em centavos, do banco à string |
| Isolamento | Arquivo separado por clínica | RLS `FORCE` com `USING` e `WITH CHECK` |
| Regra de negócio | A mesma escrita 3 vezes, já divergentes | Uma vez, em `packages/domain` |
| Testes | Nenhum | 154 passando em 8 pacotes |
| Deploy | Copiar e colar no editor do Apps Script | `fir.bat` local, CI, container na VPS |
| Auditoria | Não existe | **Também não existe ainda** — decidida (D-5), vem antes do Plano 2 |

---

## 3. Plataforma e execução

| # | Diferença | Explicação |
|---|---|---|
| 3.1 | Apps Script → Node 22 em container | Sai o limite de 6 min por execução, a cota diária e o editor na nuvem como única ferramenta. |
| 3.2 | Sem controle de versão → Git | A v20 não tem histórico: `rebuild.py` remonta o arquivo. Hoje são 60 commits com mensagem explicando o porquê. |
| 3.3 | Um arquivo de 1.098 linhas → monorepo em 5 pacotes | `apps/api`, `apps/web`, `packages/domain`, `packages/contracts`, `packages/ui`. Cada um com fronteira e teste próprio. |
| 3.4 | Sem tipos → TypeScript estrito | Inclui `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` e `verbatimModuleSyntax`. Índice de array é `T \| undefined` por padrão. |
| 3.5 | Sem ambiente local → `fir.bat` | `fir subir`, `fir parar`, `fir reset`. Docker Compose com Postgres, Redis e Mailpit no bloco de portas 48xx em `127.0.0.1`. O `.bat` **recusa** subir sem `node_modules` em vez de fingir que subiu. |
| 3.6 | Sem CI → GitHub Actions | `lint`, `typecheck`, `test` e as migrations aplicadas contra um Postgres de serviço. |
| 3.7 | Deploy manual por cópia → container com label do Traefik | Procedimento já provado no Mavia na mesma VPS, ao lado da orquestração do EasyPanel, nunca dentro dela (D-4). |

## 4. Dados e isolamento

| # | Diferença | Explicação |
|---|---|---|
| 4.1 | Planilha por clínica → um Postgres com RLS | Isolamento deixa de ser "arquivos diferentes" e passa a ser política do banco. |
| 4.2 | Nenhuma restrição no banco → `ENABLE` + `FORCE` + `USING` + `WITH CHECK` | `FORCE` vale também para o dono da tabela. `WITH CHECK` impede **gravar** na clínica errada, não só ler. |
| 4.3 | Nenhum papel → dois papéis | `fir_app` (sem `BYPASSRLS`, o que a API usa) e `fir_migrate` (com, só migrations). |
| 4.4 | Contexto implícito → `SET LOCAL app.clinica_id` | Escopo de transação: não vaza entre requisições que compartilham conexão do pool. |
| 4.5 | — | Resolver a sessão exigiria saber a clínica, e a RLS exige a clínica antes. Resolvido com `resolver_sessao()` `SECURITY DEFINER` e `search_path` fixo, com `EXECUTE` só para `fir_app`. |
| 4.6 | Sem tipos de coluna → esquema tipado | `BIGINT` para dinheiro e quantidade, `uuid`, `timestamptz`, chaves estrangeiras, `UNIQUE (clinica_id, email)`. |
| 4.7 | Sem migrations → `migrations/*.sql` versionadas | Três hoje. Nome recusado por regex se fora do padrão. |
| 4.8 | `GRANT` como controle → `REVOKE` explícito | `GRANT SELECT` não restringe nada em Postgres: o bootstrap já havia concedido CRUD, e `GRANT` nunca estreita. Sem o `REVOKE`, a API escreveria na tabela raiz da tenancy. |
| 4.9 | Sem pool → pool com tempos limite | `connectionTimeoutMillis` 5s, `idleTimeoutMillis` 30s, `statement_timeout` 15s, `idle_in_transaction_session_timeout` 20s, e um `pool.on('error')` — sem ele, **todo restart do Postgres mata a API**, inclusive durante deploy. |

## 5. Autenticação

| # | Diferença | Explicação |
|---|---|---|
| 5.1 | PIN de 4 dígitos → senha com Argon2id | 19 MiB, t=2, p=1 (perfil OWASP de baixa memória). PIN de 4 dígitos são 10.000 combinações. |
| 5.2 | PIN em texto puro na planilha → só o hash | O PIN era armazenado legível. |
| 5.3 | `carregar` devolvia o PIN de toda a equipe ao admin (`Code.gs:343`, repetido em `:962`) → nada disso | O admin da clínica lia o PIN de todos. Não há equivalente. |
| 5.4 | `equipePublica` respondia **antes do login** com a equipe inteira (`Code.gs:302`) → removido | Era enumeração de usuários por desenho, e entregava o `uid` que o ataque de PIN precisa. |
| 5.5 | Credencial em cada requisição → sessão opaca | Token de 32 bytes aleatórios; só o SHA-256 é guardado. Cookie `__Host-` com `Secure`, `HttpOnly`, `SameSite`. |
| 5.6 | Sem limite de tentativas → dois limites | Por conta e **por origem** — o limite por conta sozinho deixa passar 1.000 e-mails distintos. |
| 5.7 | Erro distinguia casos → resposta uniforme | Tempo igualado com piso fixo, e hash falso quando a pessoa não existe. Medido: 20–68 ms contra 8–9 ms antes; depois, faixas sobrepostas. |
| 5.8 | — | A tentativa era apagada pelo `ROLLBACK` quando o erro era lançado dentro da transação: força bruta ilimitada com aparência de proteção. Hoje a gravação da tentativa não compartilha destino com a exceção. |
| 5.9 | — | Argon2 **fora** da transação, com teto de fila e 503 + `Retry-After`. Antes: 900 logins levavam `/v1/saude` de 7,9 ms a 5.241 ms contra um limite de 5.000. Depois: 192,8 ms de máximo, zero falhas. |
| 5.10 | — | **TLS deixa de ser opcional:** cookie `__Host-` exige `Secure`, e navegador nenhum aceita `Secure` sobre `http://` fora de `localhost`. Sem HTTPS o login não existe. |
| 5.11 | — | **Custo assumido:** três pessoas que dividem o computador do balcão passam a logar e deslogar. O PIN como troca rápida em aparelho já autenticado foi oferecido e recusado (D-3). Pendência P-1. |

## 6. Autorização

| # | Diferença | Explicação |
|---|---|---|
| 6.1 | `visivel` e `saida` recalculados em cada handler (`Code.gs:308,310`) → dois guards globais | `SessaoGuard` e `AutorizacaoGuard` como `APP_GUARD`, na ordem registrada em `app.module.ts`. |
| 6.2 | Rota nova nascia sem proteção → `@Publico()` explícito | Hoje o padrão é protegido; abrir uma rota exige escrever que ela é pública. Três são: `entrar`, `sair` e `saude`. |
| 6.3 | — | `teste/rotas-protegidas.test.ts` varre o `ModulesContainer` do Nest e falha se alguma rota ficar descoberta. Três provas por mutação. |
| 6.4 | Dinheiro apagado à mão em um ponto → `RedacaoInterceptor` global | Um ponto único, e **falha fechado**: sem contexto de permissão, não libera. |
| 6.5 | `admin` booleano → permissões nomeadas | `temPerm` é uma função só, e o servidor sempre valida (regra 16). A tela não é o controle. |
| 6.6 | — | **Limitação atual, honesta:** a redação é por **nome** de campo. `desconto` e `comissao` vazariam; `esperado` e `saldo` serão escondidos demais no estoque, onde são quantidade e não dinheiro. O desenho certo é por tipo no contrato, e está marcado para o Plano 2, antes da primeira rota com dinheiro. |

## 7. Números

| # | Diferença | Explicação |
|---|---|---|
| 7.1 | `Math.round(n*100)/100` (`Code.gs:983`) → `bigint` em centavos | Float não representa `0,07` exatamente; somar centenas de lançamentos acumula erro. |
| 7.2 | Quantidade em `Math.round(x*1000)/1000` → inteiro em milésimos | 1 ampola = `1000n`. Reproduz a precisão do legado **exatamente**, sem float. |
| 7.3 | Divisão solta → `ratear(partes)` | Duas propriedades garantidas por teste: a soma é igual ao todo, e `max − min <= 1`. A soma sozinha não distingue rateio justo de "todo o resto na primeira parte". |
| 7.4 | `toFixed` e `Intl` espalhados → formatador central | `packages/domain`. Nunca `toFixed(2)` solto, nunca `Intl` na página. |
| 7.5 | — | O nosso formatador tinha o mesmo defeito do legado: `Number(inteiros) + Number(decimais)/100` fazia `90071992547409919` centavos sair como `...,20`. Hoje é `formatToParts` sobre os dois `bigint`. |
| 7.6 | — | `Intl` emite U+00A0 como separador de milhar. Comparação de string quebra por um caractere invisível — tratado explicitamente. |
| 7.7 | `novoId()` = UUID truncado em 8 hex (`Code.gs:975`) → `uuid` íntegro | 32 bits dão ~50% de colisão aos 65 mil registros. Os prefixos `u`/`pl`/`t` separam domínios, não ampliam o espaço. |
| 7.8 | — | `ClinicaId` é tipo nominal: `naClinica(corpo.x)` passou a ser erro de compilação. |
| 7.9 | Número desalinhado na tela → `tabular-nums` por padrão em `td` | Coluna que não alinha não se compara, e comparar é o motivo de a coluna existir. |

## 8. Datas e fuso

| # | Diferença | Explicação |
|---|---|---|
| 8.1 | `TZ` constante no script → fuso é propriedade da `Clinica` | Regra 22. Multiunidade em fusos diferentes deixa de ser impossível. |
| 8.2 | — | `diaCivil` não depende de dados de locale do CLDR: a chave de agrupamento por dia era corrompida em silêncio por atualização de ICU. |
| 8.3 | — | `inicioDoDia` devolvia o **dia anterior** no adianto do horário de verão. Medido: pedindo `2018-11-04` em `America/Sao_Paulo`, voltava `2018-11-03`. Hoje é busca binária até o segundo. |
| 8.4 | Recorrência mensal | Dia 29, 30 e 31 caem no último dia do mês curto. As clínicas dependem disso — preservado como invariante do épico 2. |

## 9. Concorrência

| # | Diferença | Explicação |
|---|---|---|
| 9.1 | `LockService.waitLock(30000)` → transações do Postgres | Toda escrita serializava na planilha inteira: duas recepcionistas salvando ao mesmo tempo esperavam uma à outra. |
| 9.2 | — | Semáforo de contagem K=4 sobre o Argon2, para o hash não comer o pool. |
| 9.3 | — | Teto de fila com recusa rápida: carga excedente recebe 503 + `Retry-After` em vez de derrubar o resto da API. |

## 10. Onde a regra vive

| # | Diferença | Explicação |
|---|---|---|
| 10.1 | A mesma regra escrita 3 vezes — `index.html`, `demoApiBase`, `Code.gs` — e já divergentes → uma vez em `packages/domain` | Era a maior dívida do legado: corrigir um cálculo exigia achar as três cópias e acertar as três. |
| 10.2 | Contrato implícito no `switch` → `packages/contracts` com Zod | Entrada validada no servidor, tipo derivado do mesmo esquema. |
| 10.3 | Cálculo no cliente → cálculo no servidor | Nenhum saldo, total ou percentual é calculado no front. |
| 10.4 | Termos ambíguos → glossário com termos proibidos | `CONTEXT.md`: `plano` isolado, `adesão`, `pagamento` isolado, `baixa` isolado, `valor` nu, `admin` booleano, `qtd` sem unidade. `Plano` do legado é catálogo; `Adesão` é o programa do paciente. |
| 10.5 | `carregar` devolve a clínica inteira → rota por recurso | Não é divergência de produto: a tela continua idêntica. Muda que a autorização sai do cliente, o custo passa a crescer com a tela e não com o histórico, e o registro de acesso ganha sentido. |

## 11. Auditoria e LGPD

| # | Diferença | Explicação |
|---|---|---|
| 11.1 | Nenhuma trilha → trilha append-only decidida | **Ainda não construída.** D-5 a coloca antes do Plano 2: em tabela append-only não há como recuperar o que não foi gravado, e retrofitar em oito planos é fazer oito vezes o mesmo trabalho. |
| 11.2 | — | Visível ao admin da clínica (as próprias) e ao superadmin (qualquer clínica). |
| 11.3 | — | Registro de **acesso**, não só de escrita: dose, produto e lote por paciente são dado sensível do art. 11 (regra 18). |
| 11.4 | `admin` booleano por pessoa → superadmin é identidade separada | Tabela própria, cookie próprio, prefixo de rota próprio. Um booleano em `pessoas` já perderia o modelo: a mesma sessão poderia sair do próprio tenant. |
| 11.5 | — | Trocar de clínica é **concessão** registrada (operador, clínica, quem autorizou, até quando, por quê) e revogável pela clínica — não um seletor que muda uma variável. |
| 11.6 | Sem política de retenção → `docs/compliance/retencao.md` | Esqueleto hoje. A clínica é controladora, nós somos operadores: acesso nosso a dado de saúde precisa de base legal, justificativa e prazo. Pendência P-3 (DPA). |

## 12. Interface

| # | Diferença | Explicação |
|---|---|---|
| 12.1 | Paleta "papel e dourado" | **Mantida de propósito** — as 4 clínicas já a reconhecem. |
| 12.2 | Dourado usado como texto → dois papéis separados | Medi: `--gold` `#C5A467` sobre fundo claro dá **2,21:1**, menos da metade do mínimo de 4,5:1. `--gold` é traço e borda; `--gold-ink` é texto (4,91:1 no claro, 10,86:1 no escuro). |
| 12.3 | Tema escuro ausente → par de primeira classe | `prefers-color-scheme` **e** `[data-theme]`, com o seletor manual vencendo nos dois sentidos. |
| 12.4 | Desktop primeiro → 390 px é o caso principal | A usuária é a recepcionista, de pé, com o telefone tocando. Nenhuma tela rola na horizontal. |
| 12.5 | Estados implícitos → carregando, erro e vazio são parte do ticket | O vazio é a primeira tela que toda clínica nova vê. |
| 12.6 | — | Proibidos: roxo, gradiente decorativo, glassmorphism, emoji na interface. |
| 12.7 | — | Navegação por teclado com foco visível; toast com `aria-live`. |

## 13. Testes

| # | Diferença | Explicação |
|---|---|---|
| 13.1 | Nenhum teste → 154 em 8 pacotes | |
| 13.2 | — | Testes **transversais**: varrem o catálogo do Postgres e os esquemas Zod, em vez de uma lista mantida à mão que envelhece em silêncio. |
| 13.3 | — | A varredura de RLS cobre `('r','p','v','m')`. Filtrar só `'r'` deixava **view** escapar — e view roda como `fir_migrate`, que tem `BYPASSRLS`, lendo todas as clínicas sem ruído. Também passou a verificar **todas** as linhas de `pg_policies`, não a primeira: policies são OR. |
| 13.4 | — | **Provas por mutação**: a correção é aceita só depois de enfraquecer o guard de propósito e ver o teste pegar. |
| 13.5 | — | Teste com zero asserções foi tratado como defeito e ganhou piso de asserção. |

## 14. Processo

| # | Diferença | Explicação |
|---|---|---|
| 14.1 | Nenhum documento → `CLAUDE.md` com 28 regras inegociáveis | |
| 14.2 | — | 15 agentes especialistas em `.claude/agents/`, cada um com poder de veto declarado. |
| 14.3 | — | `docs/decisoes.md`: decisão registrada não se re-litiga; mudança exige data e razão novas. |
| 14.4 | — | `docs/adr/`: divergir do protótipo é decisão de produto e vira ADR, nunca divergência silenciosa. |
| 14.5 | — | `docs/paridade.md`: as 59 ações com estado. Sem ela, "paridade" é palavra, não portão. |

---

## 15. O que sai de propósito

| Item | Por quê |
|---|---|
| PIN de 4 dígitos | Credencial primária insegura por desenho (D-3). Não volta. |
| `equipePublica` | Enumeração de usuários sem autenticação. |
| PIN visível ao admin | Não existe equivalente: a senha não é legível por ninguém. |
| `carregar` como rota única | Vira rota por recurso. A tela não muda. |
| Google Sheets como banco | Permanece como **fonte da migração**, e só. |

## 16. O que a versão dela faz melhor hoje

Dito sem rodeio, porque importa para a decisão de corte:

1. **Ela funciona.** 4 clínicas trabalham nela todos os dias. A nossa faz login.
2. **A equipe já sabe usá-la.** Nome e PIN em dois toques; a nossa pede e-mail e senha (P-1 em aberto).
3. **Zero custo de infraestrutura e zero operação.** Nada de VPS, TLS, backup ou monitoramento.
4. **O protótipo é uma especificação funcional boa.** 59 ações coerentes, com manual de 14 capítulos em linguagem de usuário. Foi ele que permitiu planejar sem reuniões de descoberta.

A troca só se paga quando as 59 linhas de `paridade.md` estiverem ✅ e o relatório de conferência de cada clínica bater **exatamente** — migração sem reconciliação é cópia, não migração (regra 28).
