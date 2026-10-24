# Épico 3 — Jornada do paciente · plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`. Passos com `- [ ]`.

**Objetivo:** o ritual comercial completo. Um agendamento nasce, é confirmado, acontece (ou não), vira orçamento, fecha ou se perde — e **é sempre a mesma `Tarefa`**, que muda de etapa e acumula histórico. Mais as três seções da tela Hoje que fazem a ferramenta cobrar sozinha (**Recontatar**, **confirmar amanhã**, **retomar orçamento**) e a tela **Jornada do paciente**, com o funil do período.

**O invariante que define este épico, e do qual tudo o mais decorre:**

> **Uma única `Tarefa` anda pelas etapas.** Nunca uma tarefa nova por etapa. `faltou` e `desmarcou` **mantêm o cartão aberto** até alguém reagendar ou encerrar.

Se o plano criasse uma tarefa por etapa, o funil contaria a mesma paciente cinco vezes, a taxa de no-show seria calculada sobre um denominador inflado, e o épico 8 (painel) herdaria o erro sem jeito de encontrá-lo. É por isso que a **Task 1** é uma máquina de estados pura e testada, e não um punhado de `if` no serviço: transição que não existe tem de ser **erro de domínio**, não um caso que ninguém escreveu.

**Arquitetura:** a máquina de estados é uma **tabela de dados** em `packages/domain`, não código de controle. Cada transição declara origem, destino, o que grava no `historico` e se **conta no funil**. O banco amarra o par `etapa ↔ status` num `CHECK`, para que nenhum caminho futuro (job, importação, migração das 4 clínicas) consiga gravar um cartão em estado impossível.

**Stack:** PostgreSQL + migration `0007`, NestJS + Fastify, Next.js (App Router), Vitest contra Postgres real, fast-check no domínio.

**Depende de:** o **épico 2** inteiro. As colunas `etapa` (`etapa_de_jornada`) e `historico` (`jsonb`) **já nascem na `0006`**, assim como `tarefas`, `pacientes` e `recebimentos`. Este plano **não as redefine**: ele acrescenta o que falta e usa o que já existe. Também depende de `instanteDaConclusao`, `podeEditar`/`podeCancelar` (`packages/domain/src/tarefa.ts`), `janela`/`diaCivil`/`somarDias` (`relogio.ts`), `TIPOS`/`tipoAoConcluir` (`tipos-de-tarefa.ts`), `temPerm`/`CAMPOS_MONETARIOS` (`permissoes.ts`) e do `RedacaoInterceptor` (`apps/api/src/comum/redacao.interceptor.ts`).

**Cobre de `docs/paridade.md`:** `moverEtapa`. **1 das 59** — e é das maiores: é o funil inteiro, dez ações numa só.

---

## Global Constraints

Valem para **todas** as tarefas. Herdadas do `CLAUDE.md`, do `CONTEXT.md`, de `docs/design.md` e do plano do épico 2.

- **Regra 1:** nenhum `float` perto de dinheiro. `bigint` de centavos no banco, `Dinheiro` no domínio, **string de centavos no transporte e dentro do `jsonb`** (ver a decisão D-4). Nada de `toFixed`, `parseFloat` ou `* 100`.
- **Regra 3:** **cada pagamento conta uma vez.** Já está resolvida no épico 2 pelo índice único `recebimento_por_tarefa`. **Não reimplemente, e não acrescente nenhuma coluna de dinheiro recebido em `tarefas`.** A única coluna monetária que este plano cria é `valor_orcamento`, que **não é receita**.
- **Regra 4:** **orçamento não é receita.** `valor_orcamento` nunca entra em total recebido, em LTV, em meta nem no caixa. Nota promissória não entra no caixa. O teste que prova isso é da Task 5, e é o teste mais importante do plano depois do da Task 7.
- **Regra 16:** o servidor **sempre** valida. `@Exige('jornada')` nas ações do cartão e no funil; `fechar` exige **`jornada` e `receber`**.
- **Regra 17:** a redação de valores é o `RedacaoInterceptor`, num ponto único — e ele **já percorre arrays e objetos simples em profundidade**. Nenhuma rota deste plano escreve um `if` sobre dinheiro. A Task 5 **prova** que a redação alcança `historico[].valor` e `programaOrcado[].valor`.
- **Regra 19:** RLS `ENABLE` + `FORCE` + policy na tabela nova (`motivos_de_perda`), `clinica_id NOT NULL`, e ela entra em `ENTIDADES_COM_CLINICA`.
- **Regra 20:** **o `historico` é append-only** e **o trigger `registrar_auditoria` da `0004` faz o registro sozinho** — ninguém chama `registrar()` à mão. Encerrar é um estado, nunca um `DELETE`.
- **Regra 18/21:** nome de paciente, telefone, valor de orçamento e motivo de perda **nunca** em log. O texto livre de `nota` é digitado pela recepção e pode conter qualquer coisa: **`nota` nunca vai para log**, em nenhum nível.
- **Regra 22/23/24:** `timestamptz` em UTC; toda janela é `[início, fim)` com as bordas no fuso da clínica; **a data de negócio vem do servidor**. "Reagendar para uma data a partir de hoje" é comparado contra o **dia civil do servidor no fuso da clínica**, nunca contra o relógio do cliente.
- **Telas:** `docs/design.md` é a régua. 390 px é o caso principal, **a página nunca rola na horizontal** — o kanban rola dentro do próprio contêiner. Estados de carregando, erro e vazio são parte do ticket. Algarismos tabulares em toda coluna de valor, data ou percentual.
- TypeScript estrito; imports **sem** extensão (ADR 0001); `@Inject(Tipo)` explícito no Nest.
- Nenhuma migration já aplicada se edita. Esta é a **`0007`**.
- Antes de qualquer "pronto": `npx turbo run typecheck test --force`. O `pnpm test` responde do cache sem rodar nada.

---

## A máquina de estados, por inteiro

Esta tabela é a especificação. A **Task 1** a transcreve para `packages/domain/src/jornada.ts` como **dado**, e nenhuma outra parte do sistema decide o que é permitido.

### Os nove estados

| Etapa | `status` obrigatório | O que significa | Onde o cartão aparece |
|---|---|---|---|
| `agendado` | `aberta` | marcado, sem resposta da paciente | Hoje (no dia) · "Próximos passos" na véspera · coluna Agendadas |
| `confirmado` | `aberta` | a paciente respondeu que vem | Hoje (no dia) · coluna Confirmadas |
| `faltou` | **`aberta`** | não compareceu | **Recontatar**, todo dia, até resolver |
| `desmarcou` | **`aberta`** | avisou que não vem | **Recontatar**, todo dia, até resolver |
| `realizado` | `concluida` | o atendimento aconteceu | Concluídas · coluna Realizadas sem orçamento |
| `orcamento` | `concluida` | proposta apresentada, aguardando decisão | "Próximos passos" no dia de retomar · coluna Orçamentos em aberto |
| `fechado` | `concluida` | **terminal** · a paciente aceitou e pagou | coluna Fechados |
| `perdido` | `concluida` | **terminal** · desistiu, com motivo | coluna Perdidos |
| `encerrado` | `cancelada` | **terminal** · faltou/desmarcou e não reagendou | fora de todas as listas |

`faltou` e `desmarcou` com `status = 'aberta'` **é** o invariante do épico. Um cartão em `faltou` continua sendo uma tarefa em aberto do ponto de vista do banco, da RLS e da trilha — ele só sai da seção "Hoje" porque a consulta o manda para "Recontatar".

### As onze transições permitidas

| Ação | De | Para | `status` | Grava no `historico` | Outros efeitos | Conta no funil |
|---|---|---|---|---|---|---|
| **`agendar`** | *(criação)* | `agendado` | `aberta` | `{acao:'agendar', etapa:'agendado', nota:'para DD/MM/AA HH:MM'}` | — | **sim** |
| **`enviarConfirmacao`** | `agendado` | `agendado` | `aberta` | `{acao:'enviarConfirmacao', etapa:'agendado', nota:'mensagem pelo WhatsApp'}` | `confirmacao_enviada_em = agora` | não |
| **`confirmar`** | `agendado` | `confirmado` | `aberta` | `{acao:'confirmar', etapa:'confirmado'}` | — | **sim** |
| **`noshow`** | `agendado`, `confirmado` | `faltou` | `aberta` | `{acao:'noshow', etapa:'faltou', nota:'não compareceu em DD/MM/AA'}` | `proximo_passo_em = hoje` | **sim** |
| **`desmarcar`** | `agendado`, `confirmado` | `desmarcou` | `aberta` | `{acao:'desmarcar', etapa:'desmarcou', nota}` | `proximo_passo_em = hoje` | **sim** |
| **`reagendar`** | `agendado`, `confirmado`, `faltou`, `desmarcou` | `agendado` | `aberta` | `{acao:'reagendar', etapa:'agendado', nota:'de DD/MM/AA para DD/MM/AA HH:MM'}` | `prazo`, `hora`, `proximo_passo_em = NULL`, `confirmacao_enviada_em = NULL` | **não** |
| **`encerrar`** | `faltou`, `desmarcou` | `encerrado` | **`cancelada`** | `{acao:'encerrar', etapa:'encerrado', nota}` | `proximo_passo_em = NULL` | não |
| **`concluir`** | `agendado`, `confirmado`, `faltou`, `desmarcou` | `realizado` | **`concluida`** | `{acao:'concluir', etapa:'realizado'}` | o `tipo` vira o realizado (`tipoAoConcluir`); recebimento embutido, se houver | **sim** |
| **`registrarOrcamento`** | `realizado` | `orcamento` | `concluida` | `{acao:'registrarOrcamento', etapa:'orcamento', valor, nota}` | `valor_orcamento`, `programa_orcado`, `proximo_passo_em = pedido ?? hoje+2` | **sim** |
| **`followUp`** | `orcamento` | `orcamento` | `concluida` | `{acao:'followUp', etapa:'orcamento', nota}` | `proximo_passo_em = pedido ?? hoje+3` | não |
| **`fechar`** | `realizado`, `orcamento` | `fechado` | `concluida` | `{acao:'fechar', etapa:'fechado', valor, nota}` | `proximo_passo_em = NULL`; `valor_orcamento ← entrada + aberto` se ainda vazio; **cria o `Recebimento` e monta o `Programa`, na mesma transação** | **sim** |
| **`perder`** | `orcamento` | `perdido` | `concluida` | `{acao:'perder', etapa:'perdido', motivoId, motivo, nota}` | `proximo_passo_em = NULL` | **sim** |
| **`reabrir`** | `realizado` | a etapa anterior ao `realizado` | `aberta` | `{acao:'reabrir', etapa: <restaurada>}` | estorna o recebimento embutido (épico 2) | não |

**`agendar` e `concluir` não são rotas deste épico.** São o `POST /v1/tarefas` e o `POST /v1/tarefas/:id/concluir` do épico 2, que já escrevem `etapa` e `historico`. Eles entram na tabela porque **a tabela precisa ser a história completa**: se `concluir` estivesse fora dela, o funil teria de aprender a contar `realizado` por um segundo caminho, e o segundo caminho é sempre o que diverge.

### O que é proibido, explicitamente

Tudo o que não está na tabela. Em particular, e cada um destes é um teste:

- **Nada sai de `fechado`, `perdido` ou `encerrado`.** São terminais. Reabrir um `fechado` deixaria dinheiro recebido pendurado num atendimento que voltou a "não aconteceu".
- **`registrarOrcamento` não repete.** De `orcamento` só saem `followUp`, `fechar` e `perder`. Registrar o orçamento duas vezes contaria duas propostas e partiria a conversão do funil.
- **Nenhuma ação de orçamento alcança um cartão em aberto.** `orcamento`, `fechar` e `perder` exigem `status = 'concluida'`: não se orça um atendimento que ainda não aconteceu.
- **Nenhuma ação de agenda alcança um cartão concluído.** `confirmar`, `noshow`, `desmarcar` e `reagendar` exigem `aberta`.
- **`encerrar` só sai de `faltou` ou `desmarcou`.** Cancelar um cartão `agendado` é o `cancelar` do épico 2 — que, a partir deste plano, grava `etapa = 'encerrado'` (ver Task 2, Passo 4).
- **`reabrir` é recusado quando a etapa é `orcamento`, `fechado` ou `perdido`.** Mensagem: *"Este atendimento já tem orçamento registrado."*
- **O `historico` nunca encolhe, nunca é reescrito, nunca é reordenado.** Desfazer é um evento novo.

### As duas regras que o funil depende

1. **Conta no funil quem a tabela diz que conta.** `reagendar` leva a `agendado` e **não conta** — senão quem remarcou três vezes aparece como três agendamentos, o denominador infla e toda taxa de conversão cai sem que nada tenha piorado. `enviarConfirmacao`, `followUp`, `encerrar` e `reabrir` também não contam.
2. **A contagem é por `acao`, não por `etapa`.** O protótipo infere isso da presença de um rótulo no evento (`!x.rot`), o que é frágil: `reagendar` tem rótulo **e** muda de etapa, então a inferência só funciona por coincidência. Aqui a propriedade é **declarada na tabela de transições** e o evento guarda a `acao` que o produziu.

---

## As divergências, e quem ganha

O protótipo é a especificação; o `Code.gs` é a verdade operacional das 4 clínicas. **O `Code.gs` da v20 não tem jornada nenhuma** — não existe coluna `etapa`, não existe `historico`, não existe `moverEtapa`. Confirmado por varredura: nenhuma ocorrência de `etapa`, `historico`, `valorOrcamento`, `acaoEm`, `confEnviada` ou `programaOrc` em `versoes/v20-producao/Code.gs`.

Então **não há discordância a arbitrar sobre a jornada**: o protótipo manda sozinho, e o `Code.gs` só manda no que ele de fato faz — `VIRA_AO_CONCLUIR` (`Code.gs:60`), que o épico 2 já portou. As divergências abaixo são todas do protótipo **contra ele mesmo**, e é por isso que cada uma vira linha aqui.

| Ponto | Protótipo (`demoApiBase`) | `Code.gs` v20 | Segue |
|---|---|---|---|
| **Motivo da perda** | o servidor aceita `perder` **sem motivo** — a obrigatoriedade existe só na tela (`if (!d.motivo){ toast("Escolha o motivo."); return; }`). Medido no protótipo rodando: `api('moverEtapa',{id,acao:'perder'})` devolve `OK` e grava `nota:""` | não existe | **Nenhum dos dois.** Motivo **obrigatório no servidor**. O KPI "Orçamentos perdidos" diz *"veja os motivos no histórico"*; sem motivo obrigatório, o histórico fica vazio e o único número que explicaria a perda não explica nada |
| **O fechamento** | **duas chamadas do cliente**: `criarTarefa`/`criarAdesao` (o recebimento) e **depois** `moverEtapa fechar`. Se a segunda falhar, o dinheiro está lançado e o cartão continua em `orcamento` | não existe | **Nenhum dos dois.** `POST /v1/tarefas/:id/jornada` com `acao: 'fechar'` faz as três escritas numa transação. É um defeito de protótipo, não decisão de produto |
| **`encerrar`** | `status = 'cancelada'`, a `etapa` **continua** `faltou`/`desmarcou`. O cartão só sai do Recontatar porque uma segunda coluna é consultada | não existe | **Divergência consciente.** `etapa = 'encerrado'` — o valor **já existe no ENUM da `0006`**, reservado por este épico. Saber onde um cartão está passa a exigir **uma** coluna |
| **`realizado` → `orcamento` depois de 30 dias** | o **servidor permite**; só a tela esconde o botão (`acoesEsteira`, `dia(t.concluidaEm) >= addDays(today(),-30)`) | não existe | **Protótipo (o servidor).** O limite fica na tela. A migração das 4 clínicas precisa registrar orçamento contra consulta antiga, e bloquear no servidor obrigaria o migrador a escrever direto na tabela — que é como a regra morre |
| **Etapa de uma "Consulta agendada" já concluída** | `etapaDe` devolve `agendado`, e `acoesEsteira` devolve `[]`: **cartão morto**, sem ações e no lugar errado do kanban. Reproduzido no dado de demonstração (tarefa `h18`) | tarefa concluída, sem etapa nenhuma | **Nenhum dos dois.** `etapaDerivada` (Task 1) devolve `realizado` para toda esteira concluída. É o que o épico 9 usa para preencher a coluna na migração, e o runtime nunca deriva |
| **`historico[].valor`** | **não é redigido no servidor** — `saida()` apaga `valor`, `valorAberto` e `valorOrcamento` do topo, mas o valor do orçamento e o do fechamento viajam dentro do `historico`; só a tela esconde (`vVal() && …`) | não existe | **Nenhum dos dois.** É exatamente o que a regra 17 proíbe. Nosso `RedacaoInterceptor` já percorre em profundidade e `valor`/`valorOrcamento` já estão em `CAMPOS_MONETARIOS` — a Task 5 **prova** com teste e mutação, em vez de confiar |
| **`acaoEm`** | um campo com **dois significados**: dia do no-show/desmarque **e** dia de retomar o orçamento | não existe | **Divergência de nome.** `proximo_passo_em`: *o dia a partir do qual este cartão volta a pedir ação*. Os dois usos do protótipo satisfazem essa definição; o nome velho não tinha nenhuma |
| **Permissão** | **nenhuma**: `visivel(t)` libera qualquer tarefa com `pacienteId` para qualquer usuário, e `moverEtapa` não checa nada | não existe | **Divergência consciente.** `@Exige('jornada')` nas ações do cartão e no funil; `fechar` exige **também `receber`**. A chave `jornada` já existe na matriz (`PERMS`) com a descrição *"Funil e situação de agendamentos, orçamentos e fechamentos"* — ela foi escrita para isto. Recepção, Comercial e Supervisão já a têm |

**Nenhuma destas vira ADR isolada.** Elas entram todas numa só, `docs/adr/0004-maquina-de-estados-da-jornada.md`, escrita na Task 12 — porque são a mesma decisão vista de sete ângulos: *a jornada é uma máquina de estados fechada no servidor, não um conjunto de telas que gravam campos*.

---

## Decisões de produto tomadas neste plano

| # | Decisão | Por quê |
|---|---|---|
| **D-1** | **O motivo da perda é dado, não `enum`.** Tabela `motivos_de_perda` por clínica, semeada com os cinco do protótipo (Preço · Sem retorno do paciente · Escolheu outro lugar · Não é o momento · Outro) | Três razões, e a terceira é a que decide. (a) **A lista é o relatório.** "Orçamentos perdidos: 1 · veja os motivos no histórico" só vira gestão quando a clínica pode acrescentar o motivo que de fato ouve ao telefone — "esperando o marido decidir", "foi para o convênio". (b) Um `ENUM` do Postgres exige **migration para cada motivo novo**, e as 4 clínicas têm vocabulários diferentes. (c) É **o mesmo padrão de `origem` do paciente**, que já é dado — duas listas de mesma natureza com modelagens diferentes é dívida nascendo |
| **D-2** | **O evento guarda o `motivoId` *e* o nome do motivo no instante do evento** | Renomear "Preço" para "Preço acima do esperado" **não pode reescrever a história**. Com só o id, o relatório do trimestre passado muda sozinho quando alguém arruma a lista; com só o nome, não dá para agrupar. Guardando os dois, o agrupamento usa o id e a leitura usa o nome gravado. Desativar um motivo é um estado (`ativo`), nunca uma exclusão |
| **D-3** | **`proximo_passo_em` é um `date`, e um só, com um significado só:** *o dia a partir do qual este cartão volta a pedir ação* | Substitui o `acaoEm` de dois significados. Recontatar e "Orçamentos para retomar" passam a ser a **mesma** cláusula `proximo_passo_em <= hoje`, não duas consultas que já divergiram no protótipo (Recontatar não filtra por data; retomar filtra). Entra no `CONTEXT.md` antes de virar código |
| **D-4** | **Dinheiro dentro de `jsonb` é string de centavos** (`"360000"`), nunca número JSON | O `jsonb` do Postgres guarda `numeric` exato, mas `JSON.parse` do lado do Node devolve `number` — e um `number` perto de dinheiro é exatamente a assinatura que a regra 1 proíbe atravessar. A convenção já existe no transporte (`dinheiroEmTexto`, `packages/contracts/src/comum.ts`); usar a mesma dentro do `jsonb` evita ter duas. Bônus: a redação vira `valor: null` sem conversão |
| **D-5** | **As chaves do `historico` são por extenso** (`{acao, etapa, em, porId, nota, valor, motivoId, motivo}`), não as abreviações do protótipo (`{e, em, por, rot, nota, valor}`) | `nome no código = nome no glossário = nome na tela`. E **não há custo de migração**: a v20 não tem `historico`, então não existe dado legado com as chaves curtas. A única fonte com chave curta é o `localStorage` de demonstração do protótipo, que não entra em build |
| **D-6** | **O limite de 30 dias para orçar um atendimento fica na tela, não no servidor** | Ver a tabela de divergências. O servidor permitir é o que torna a migração do épico 9 possível sem escrever direto na tabela |
| **D-7** | **As ações do cartão exigem `jornada`; `fechar` exige `jornada` + `receber`** | O protótipo não exige nada, e isso deixa a enfermagem registrando orçamento de R$ 9.000. A chave `jornada` existe na matriz com exatamente esta descrição, e os perfis Recepção, Comercial e Supervisão já a têm — ninguém perde acesso ao que usa hoje. `fechar` cria `Recebimento`, e a rota que cria dinheiro é gated, sem exceção |

### ❓ A pergunta que fica para o dono

> **"Fechou" num orçamento que tem programa montado fica indisponível entre o épico 3 e o épico 5. Aceita?**
>
> O `roadmap.md` diz que o épico 5 (Programas) **depende do 3** — o orçamento é quem monta o programa. Então, quando este épico entregar, o `fechar` consegue fazer duas das três escritas (o `Recebimento` e a etapa) mas não a terceira (o `Programa`), porque a tabela de programas ainda não existe.
>
> **O que este plano faz:** `registrarOrcamento` **grava** o programa proposto em `programa_orcado` — nada se perde, a proposta fica inteira esperando o épico 5. `fechar` funciona por completo em orçamento **sem** programa. `fechar` em orçamento **com** programa devolve 409 com *"O programa será montado quando o módulo Programas entrar. Registre o recebimento pela tela Recebimentos."*
>
> **A alternativa** é adiar o `fechar` inteiro para o épico 5 — o que também adia o `Fechados` do funil e a coluna Fechados do kanban.
>
> **Não decida isto no código.** Se a resposta for "adie o `fechar` inteiro", a Task 7 sai deste plano e vai para o do épico 5, e as Tasks 9 e 11 ganham uma nota de coluna vazia.

---

## Estrutura de arquivos

| Caminho | Responsabilidade |
|---|---|
| `packages/domain/src/jornada.ts` | **A máquina de estados.** Tabela de transições, `transicao()`, `etapaDerivada()`, rótulos, `ACOES_DO_FUNIL` |
| `packages/domain/src/jornada.test.ts` | Os exemplos e as propriedades |
| `apps/api/migrations/0007_jornada.sql` | Colunas da jornada, `motivos_de_perda`, os três `CHECK`, índices parciais, RLS, trigger |
| `packages/contracts/src/jornada.ts` | `MoverEtapa` como união discriminada por `acao` |
| `apps/api/src/jornada/jornada.controller.ts` · `jornada.service.ts` · `jornada.module.ts` | A rota única de transição |
| `apps/api/src/jornada/fechamento.service.ts` | O `fechar`, com a transação e o `MontadorDePrograma` |
| `apps/api/src/jornada/funil.service.ts` | `GET /v1/jornada` |
| `apps/api/src/hoje/hoje.service.ts` *(modificar)* | Os três blocos novos |
| `apps/web/src/components/cartao-de-tarefa.tsx` *(modificar)* | A faixa de ações e a Evolução |
| `apps/web/src/components/jornada/` | Os formulários por ação, o `funil.tsx`, o `kanban.tsx` |
| `apps/web/src/app/(app)/jornada/page.tsx` | A tela Jornada do paciente |
| `docs/adr/0004-maquina-de-estados-da-jornada.md` | As sete divergências, numa decisão só |

---

## Interfaces

As assinaturas exatas em que as tarefas dependem umas das outras.

```ts
// packages/domain/src/jornada.ts  (Task 1)
export type Etapa =
  | 'agendado' | 'confirmado' | 'faltou' | 'desmarcou'
  | 'realizado' | 'orcamento' | 'fechado' | 'perdido' | 'encerrado'

export type AcaoDeJornada =
  | 'agendar' | 'enviarConfirmacao' | 'confirmar' | 'noshow' | 'desmarcar'
  | 'reagendar' | 'encerrar' | 'concluir' | 'registrarOrcamento'
  | 'followUp' | 'fechar' | 'perder' | 'reabrir'

export type StatusDeTarefa = 'aberta' | 'concluida' | 'cancelada'

export type Transicao = {
  readonly acao: AcaoDeJornada
  readonly de: readonly Etapa[]
  /** `'anterior'` só em `reabrir`: a etapa vem do histórico, não da tabela. */
  readonly para: Etapa | 'anterior'
  readonly status: StatusDeTarefa
  readonly contaNoFunil: boolean
  readonly exigeValor: boolean
  readonly exigeMotivo: boolean
}

export const TRANSICOES: readonly Transicao[]
export const ETAPAS_TERMINAIS: readonly Etapa[]        // fechado, perdido, encerrado
export const ETAPAS_EM_RECONTATO: readonly Etapa[]     // faltou, desmarcou
export const ACOES_DO_FUNIL: readonly AcaoDeJornada[]
export const ROTULO_DE_ETAPA: Readonly<Record<Etapa, string>>

export type EstadoDaJornada = {
  readonly etapa: Etapa
  readonly status: StatusDeTarefa
  readonly historico: readonly EventoDeJornada[]
}

/** O destino, ou o erro de domínio. É a única porta. */
export function transicao(
  estado: EstadoDaJornada, acao: AcaoDeJornada,
): Result<{ readonly etapa: Etapa; readonly status: StatusDeTarefa; readonly contaNoFunil: boolean }>

/** Para o épico 9: preenche `etapa` de dado migrado. O runtime nunca deriva. */
export function etapaDerivada(t: {
  readonly tipo: string; readonly status: StatusDeTarefa; readonly pacienteId: string | null
}): Etapa | null

export function ehDaJornada(t: { readonly tipo: string; readonly pacienteId: string | null }): boolean
```

```ts
// packages/domain/src/jornada.ts — o evento  (Task 1)
export type EventoDeJornada = {
  readonly acao: AcaoDeJornada
  readonly etapa: Etapa
  readonly em: string          // ISO 8601 em UTC
  readonly porId: string
  readonly nota?: string       // máx. 160. NUNCA vai para log.
  readonly valor?: string      // centavos em texto (D-4)
  readonly motivoId?: string
  readonly motivo?: string     // o nome no instante do evento (D-2)
}

/** Append-only. Devolve um array novo; nunca muta o recebido. */
export function anexar(
  historico: readonly EventoDeJornada[], evento: EventoDeJornada,
): readonly EventoDeJornada[]
```

```sql
-- apps/api/migrations/0007_jornada.sql  (Task 2)
ALTER TABLE tarefas ADD COLUMN valor_orcamento        bigint;
ALTER TABLE tarefas ADD COLUMN programa_orcado        jsonb;
ALTER TABLE tarefas ADD COLUMN motivo_perda_id        uuid;
ALTER TABLE tarefas ADD COLUMN proximo_passo_em       date;
ALTER TABLE tarefas ADD COLUMN confirmacao_enviada_em timestamptz;
CREATE TABLE motivos_de_perda (…);
```

```ts
// apps/api/src/jornada/montador-de-programa.ts  (Task 7)
export abstract class MontadorDePrograma {
  abstract montar(tx: Transacao, dados: ProgramaOrcado): Promise<Result<{ programaId: string }>>
}
```

---

## Task 1: A máquina de estados, no domínio puro

**Files:** `packages/domain/src/jornada.ts` · `jornada.test.ts` · *(modificar)* `packages/domain/src/index.ts`

**Antes de qualquer rota, antes da migration.** Esta é a tarefa de que o épico inteiro depende, e ela não toca em I/O, banco nem framework.

**A forma importa tanto quanto o conteúdo:** `TRANSICOES` é uma **tabela de dados**, e `transicao()` é uma busca nela. Se alguém escrever `if (acao === 'confirmar' && etapa === 'agendado')`, a tabela deixou de ser a verdade e o décimo terceiro caso vai ser esquecido — foi assim que o legado passou a ter a mesma regra escrita três vezes.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// packages/domain/src/jornada.test.ts
const aberta = (etapa: Etapa, h: EventoDeJornada[] = []) =>
  ({ etapa, status: 'aberta', historico: h }) as const
const feita = (etapa: Etapa, h: EventoDeJornada[] = []) =>
  ({ etapa, status: 'concluida', historico: h }) as const

it('o caminho feliz inteiro, uma tarefa só', () => {
  let e = aberta('agendado')
  for (const [acao, destino] of [
    ['confirmar', 'confirmado'], ['concluir', 'realizado'],
    ['registrarOrcamento', 'orcamento'], ['fechar', 'fechado'],
  ] as const) {
    const r = exigir(transicao(e, acao))
    expect(r.etapa).toBe(destino)
    e = { ...e, etapa: r.etapa, status: r.status }
  }
})

it('FALTOU MANTÉM O CARTÃO ABERTO — é o invariante do épico', () => {
  const r = exigir(transicao(aberta('confirmado'), 'noshow'))
  expect(r.etapa).toBe('faltou')
  expect(r.status).toBe('aberta')          // NÃO concluida, NÃO cancelada
})

it('DESMARCOU MANTÉM O CARTÃO ABERTO', () => {
  expect(exigir(transicao(aberta('agendado'), 'desmarcar')).status).toBe('aberta')
})

it('de faltou só saem reagendar, encerrar e concluir', () => {
  const permitidas = TODAS_AS_ACOES.filter((a) => ehOk(transicao(aberta('faltou'), a)))
  expect(permitidas.sort()).toEqual(['concluir', 'encerrar', 'reagendar'])
})

it('reagendar devolve o cartão para agendado, e NÃO conta no funil', () => {
  const r = exigir(transicao(aberta('faltou'), 'reagendar'))
  expect(r.etapa).toBe('agendado')
  expect(r.contaNoFunil).toBe(false)
})

it('encerrar leva a encerrado e CANCELA — não some do banco', () => {
  const r = exigir(transicao(aberta('desmarcou'), 'encerrar'))
  expect(r.etapa).toBe('encerrado')
  expect(r.status).toBe('cancelada')
})

it('registrar orçamento duas vezes é recusado', () => {
  expect(transicao(feita('orcamento'), 'registrarOrcamento').erro.codigo)
    .toBe('TRANSICAO_INVALIDA')
})

it('não se orça um atendimento que ainda não aconteceu', () => {
  const r = transicao(aberta('confirmado'), 'registrarOrcamento')
  expect(r.erro.mensagem).toContain('ainda não aconteceu')
})

it('os três terminais não têm saída nenhuma', () => {
  for (const t of ETAPAS_TERMINAIS) {
    for (const a of TODAS_AS_ACOES) {
      expect(ehErro(transicao({ etapa: t, status: statusDe(t), historico: [] }, a))).toBe(true)
    }
  }
})

it('reabrir restaura a etapa anterior ao realizado, não "agendado" por padrão', () => {
  const h = [ev('confirmar', 'confirmado'), ev('noshow', 'faltou'), ev('concluir', 'realizado')]
  expect(exigir(transicao(feita('realizado', h), 'reabrir')).etapa).toBe('faltou')
})

it('reabrir é recusado depois do orçamento — o dinheiro não pode ficar órfão', () => {
  expect(transicao(feita('fechado'), 'reabrir').erro.codigo).toBe('TRANSICAO_INVALIDA')
})

it('o histórico é append-only: o prefixo nunca muda', () => {
  const antes = [ev('agendar', 'agendado')]
  const depois = anexar(antes, ev('confirmar', 'confirmado'))
  expect(depois.slice(0, 1)).toEqual(antes)
  expect(antes).toHaveLength(1)            // o original não foi mutado
})

it('etapaDerivada conserta o cartão morto do protótipo', () => {
  // "Consulta agendada" CONCLUÍDA: o protótipo devolve "agendado" e o cartão
  // fica sem nenhuma ação possível, no lugar errado do kanban.
  expect(etapaDerivada({ tipo: 'Consulta agendada', status: 'concluida', pacienteId: 'p1' }))
    .toBe('realizado')
  expect(etapaDerivada({ tipo: 'Consulta agendada', status: 'aberta', pacienteId: 'p1' }))
    .toBe('agendado')
  expect(etapaDerivada({ tipo: 'Follow-up', status: 'aberta', pacienteId: 'p1' }))
    .toBeNull()
  expect(etapaDerivada({ tipo: 'Consulta agendada', status: 'aberta', pacienteId: null }))
    .toBeNull()
})
```

E as propriedades — **tabela de transições é exatamente o lugar onde exemplo escolhido a dedo não prova nada**:

```ts
it.prop([fc.constantFrom(...TODAS_AS_ETAPAS), fc.constantFrom(...TODAS_AS_ACOES)])(
  'toda transição ou está na tabela ou é erro — nunca um terceiro resultado',
  (etapa, acao) => {
    const r = transicao({ etapa, status: statusDe(etapa), historico: [] }, acao)
    const naTabela = TRANSICOES.some((t) => t.acao === acao && t.de.includes(etapa))
    expect(ehOk(r)).toBe(naTabela)
  },
)

it.prop([fc.constantFrom(...TODAS_AS_ETAPAS), fc.constantFrom(...TODAS_AS_ACOES)])(
  'o status do destino nunca contradiz a etapa do destino',
  (etapa, acao) => {
    const r = transicao({ etapa, status: statusDe(etapa), historico: [] }, acao)
    if (ehErro(r)) return
    expect(r.status).toBe(statusDe(r.etapa))
  },
)

it.prop([fc.array(fc.constantFrom(...TODAS_AS_ACOES), { maxLength: 20 })])(
  'de qualquer caminho alcançável, ainda existe caminho para um terminal',
  (acoes) => {
    // Sem esta propriedade, uma etapa sem saída passa despercebida até a
    // recepção ter um cartão travado na tela, todo dia, sem botão nenhum.
    let e = aberta('agendado')
    for (const a of acoes) { const r = transicao(e, a); if (ehOk(r)) e = aplicar(e, r) }
    expect(alcancaTerminal(e.etapa)).toBe(true)
  },
)

it.prop([fc.array(fc.record({ /* … */ }), { maxLength: 30 })])(
  'anexar é append-only e preserva a ordem para qualquer sequência',
  (eventos) => {
    let h: readonly EventoDeJornada[] = []
    const vistos: EventoDeJornada[] = []
    for (const e of eventos) { h = anexar(h, e); vistos.push(e) }
    expect(h).toEqual(vistos)
  },
)
```

- [ ] **Passo 2: Rodar e ver falhar** — `cd packages/domain && npx vitest run jornada`

- [ ] **Passo 3: Implementar** — a tabela primeiro, a função depois.

```ts
// packages/domain/src/jornada.ts
/**
 * A JORNADA É UMA TABELA, NÃO UM ENCADEAMENTO DE `if`.
 *
 * Toda regra sobre onde um agendamento pode ir está nesta constante, e em
 * lugar nenhum mais. O legado tem a mesma regra escrita três vezes — front,
 * `demoApiBase` e `Code.gs` — e elas já divergiram. Aqui existe uma.
 *
 * `contaNoFunil` é propriedade DA TRANSIÇÃO, não do evento. O protótipo a
 * infere da presença de um rótulo no histórico, o que funciona por
 * coincidência: `reagendar` tem rótulo E muda de etapa. Declarada, ela diz a
 * coisa certa — remarcar não é um agendamento novo, e contá-lo como tal
 * infla o denominador do funil e derruba toda conversão sem que nada tenha
 * piorado na clínica.
 */
const ABERTAS = ['agendado', 'confirmado', 'faltou', 'desmarcou'] as const

export const TRANSICOES = [
  { acao: 'agendar',            de: [],                                    para: 'agendado',   status: 'aberta',    contaNoFunil: true,  exigeValor: false, exigeMotivo: false },
  { acao: 'enviarConfirmacao',  de: ['agendado'],                          para: 'agendado',   status: 'aberta',    contaNoFunil: false, exigeValor: false, exigeMotivo: false },
  { acao: 'confirmar',          de: ['agendado'],                          para: 'confirmado', status: 'aberta',    contaNoFunil: true,  exigeValor: false, exigeMotivo: false },
  { acao: 'noshow',             de: ['agendado', 'confirmado'],            para: 'faltou',     status: 'aberta',    contaNoFunil: true,  exigeValor: false, exigeMotivo: false },
  { acao: 'desmarcar',          de: ['agendado', 'confirmado'],            para: 'desmarcou',  status: 'aberta',    contaNoFunil: true,  exigeValor: false, exigeMotivo: false },
  { acao: 'reagendar',          de: ABERTAS,                               para: 'agendado',   status: 'aberta',    contaNoFunil: false, exigeValor: false, exigeMotivo: false },
  { acao: 'encerrar',           de: ['faltou', 'desmarcou'],               para: 'encerrado',  status: 'cancelada', contaNoFunil: false, exigeValor: false, exigeMotivo: false },
  { acao: 'concluir',           de: ABERTAS,                               para: 'realizado',  status: 'concluida', contaNoFunil: true,  exigeValor: false, exigeMotivo: false },
  { acao: 'registrarOrcamento', de: ['realizado'],                         para: 'orcamento',  status: 'concluida', contaNoFunil: true,  exigeValor: true,  exigeMotivo: false },
  { acao: 'followUp',           de: ['orcamento'],                         para: 'orcamento',  status: 'concluida', contaNoFunil: false, exigeValor: false, exigeMotivo: false },
  { acao: 'fechar',             de: ['realizado', 'orcamento'],            para: 'fechado',    status: 'concluida', contaNoFunil: true,  exigeValor: true,  exigeMotivo: false },
  { acao: 'perder',             de: ['orcamento'],                         para: 'perdido',    status: 'concluida', contaNoFunil: true,  exigeValor: false, exigeMotivo: true  },
  { acao: 'reabrir',            de: ['realizado'],                         para: 'anterior',   status: 'aberta',    contaNoFunil: false, exigeValor: false, exigeMotivo: false },
] as const satisfies readonly Transicao[]
```

A mensagem de erro é **a do protótipo**, porque é a que a recepção já conhece — e ela depende da etapa de origem:

```ts
const MENSAGEM_POR_ORIGEM = (etapa: Etapa): string =>
  ETAPAS_EM_RECONTATO.includes(etapa) || etapa === 'agendado' || etapa === 'confirmado'
    ? 'Essa etapa não vale para um agendamento que ainda não aconteceu.'
    : 'Essa etapa não vale para a situação atual.'
```

- [ ] **Passo 4: Rodar — PASS.** Exporte de `index.ts`.

- [ ] **Passo 5: Prova por mutação** — troque `noshow` para `status: 'concluida'`. O teste *"FALTOU MANTÉM O CARTÃO ABERTO"* tem de falhar, e a propriedade *"o status do destino nunca contradiz a etapa"* também. Restaure. **Esta é a mutação que o épico 3 existe para pegar**: com o cartão concluído, ele some do Recontatar, ninguém liga para quem faltou, e a ferramenta volta a ser uma lista de tarefas.

- [ ] **Passo 6: Segunda mutação** — acrescente `'orcamento'` ao `de` de `registrarOrcamento`. O teste *"registrar orçamento duas vezes é recusado"* e a propriedade *"toda transição ou está na tabela ou é erro"* têm de falhar juntas. Restaure.

- [ ] **Passo 7: Commit**

---

## Task 2: Migration 0007 — e o `CHECK` que torna o estado impossível impossível

**Files:** `apps/api/migrations/0007_jornada.sql` · `teste/jornada-banco.test.ts` · *(modificar)* `teste/registro.ts` · `apps/api/src/tarefas/edicao.service.ts`

**Não edite a `0006`.** As colunas `etapa` e `historico` já existem, e o ENUM `etapa_de_jornada` já tem os nove valores — inclusive `encerrado`, reservado por este épico.

**A decisão que esta migration fixa:** o par `etapa ↔ status` é amarrado por `CHECK`. É o mesmo movimento do índice único de `recebimentos` no épico 2: a defesa fica onde **nenhum caminho novo consegue contorná-la**. Um cartão `faltou` com `status = 'concluida'` desaparece do Recontatar, e o defeito só aparece semanas depois, quando a clínica percebe que ninguém liga para quem falta.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// teste/jornada-banco.test.ts
it('faltou com status concluida é RECUSADO pelo banco', async () => {
  const t = await criarTarefaDireto(CLINICA, { etapa: 'agendado' })
  await expect(cru(`UPDATE tarefas SET etapa='faltou', status='concluida' WHERE id=$1`, [t]))
    .rejects.toThrow(/etapa_combina_com_status/i)
})

it('orçamento num cartão em aberto é RECUSADO pelo banco', async () => {
  await expect(cru(`UPDATE tarefas SET etapa='orcamento', status='aberta' WHERE id=$1`, [T]))
    .rejects.toThrow(/etapa_combina_com_status/i)
})

it('encerrado exige cancelada', async () => { /* … */ })

it('valor de orçamento num cartão agendado é recusado', async () => {
  await expect(cru(`UPDATE tarefas SET valor_orcamento=360000 WHERE id=$1`, [AGENDADO]))
    .rejects.toThrow(/orcamento_so_com_etapa/i)
})

it('etapa sem paciente é recusada', async () => { /* a jornada é do paciente */ })

it('motivo de perda de OUTRA clínica é recusado', async () => {
  // FK + RLS. Uma clínica não enxerga, nem referencia, o vocabulário da outra.
})

it('toda clínica nova nasce com os cinco motivos', async () => {
  expect((await motivosDe(NOVA)).map((m) => m.nome)).toEqual([
    'Preço', 'Sem retorno do paciente', 'Escolheu outro lugar',
    'Não é o momento', 'Outro',
  ])
})

it('o nome do motivo é único por clínica, ignorando acento e caixa', async () => {
  await expect(criarMotivo(CLINICA, 'preco')).rejects.toThrow(/motivos_nome_unico/i)
})
```

- [ ] **Passo 2: Rodar e ver falhar** — `column "valor_orcamento" does not exist`.

- [ ] **Passo 3: Escrever a migration**

```sql
-- 0007_jornada.sql

-- ---------------------------------------------------------------------------
-- MOTIVOS DE PERDA — dado da clínica, não ENUM do código (decisão D-1).
--
-- A lista É o relatório: "Orçamentos perdidos: 4 · veja os motivos no
-- histórico" só vira gestão quando a clínica pode acrescentar o motivo que
-- ela de fato ouve ao telefone. Um ENUM do Postgres exigiria uma migration
-- por motivo novo, e as 4 clínicas têm vocabulários diferentes.
-- ---------------------------------------------------------------------------
CREATE TABLE motivos_de_perda (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id    uuid NOT NULL REFERENCES clinicas(id),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 1 AND 60),
  nome_chave    text GENERATED ALWAYS AS (normalizar_nome(nome)) STORED,
  ordem         smallint NOT NULL DEFAULT 0,
  ativo         boolean NOT NULL DEFAULT true,
  desativado_em timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT desativado_tem_instante CHECK ((NOT ativo) = (desativado_em IS NOT NULL))
);
CREATE UNIQUE INDEX motivos_nome_unico ON motivos_de_perda (clinica_id, nome_chave) WHERE ativo;

-- `normalizar_nome` é da 0006. Reusada de propósito: duas normalizações de
-- nome no mesmo banco é como "Preço" e "preço" viram dois motivos e o
-- relatório do trimestre reporta a mesma perda em duas linhas.

-- ---------------------------------------------------------------------------
-- AS COLUNAS DA JORNADA
-- ---------------------------------------------------------------------------
ALTER TABLE tarefas
  -- Centavos. E NÃO É RECEITA (regra 4): nunca entra em total recebido, em
  -- LTV nem em meta. Fica aqui, e não em `recebimentos`, exatamente porque
  -- `recebimentos` é a tabela do dinheiro que ENTROU.
  ADD COLUMN valor_orcamento  bigint CHECK (valor_orcamento IS NULL OR valor_orcamento > 0),
  -- A proposta de programa, guardada inteira para o épico 5 consumir no
  -- fechamento. Máx. 10 itens, validados contra o catálogo no serviço.
  ADD COLUMN programa_orcado  jsonb,
  ADD COLUMN motivo_perda_id  uuid REFERENCES motivos_de_perda(id),
  -- O DIA A PARTIR DO QUAL ESTE CARTÃO VOLTA A PEDIR AÇÃO (decisão D-3).
  -- Substitui o `acaoEm` do protótipo, que tinha dois significados. Recontatar
  -- e "orçamentos para retomar" passam a ser a MESMA cláusula.
  ADD COLUMN proximo_passo_em date,
  -- O épico 10 manda a mensagem; aqui só fica o registro de que foi mandada.
  ADD COLUMN confirmacao_enviada_em timestamptz;

-- ---------------------------------------------------------------------------
-- O CHECK QUE TORNA O ESTADO IMPOSSÍVEL IMPOSSÍVEL.
--
-- `faltou` e `desmarcou` com `status='aberta'` é o invariante do épico: é o
-- que faz o cartão aparecer em "Recontatar" todo dia até alguém reagendar ou
-- encerrar. Escrito aqui, nenhum caminho futuro — job, importação, migração
-- das 4 clínicas, correção manual no psql — consegue gravar um cartão num
-- estado que a tela não sabe mostrar.
-- ---------------------------------------------------------------------------
ALTER TABLE tarefas ADD CONSTRAINT etapa_combina_com_status CHECK (
  etapa IS NULL OR (
    (etapa IN ('agendado','confirmado','faltou','desmarcou') AND status = 'aberta')   OR
    (etapa IN ('realizado','orcamento','fechado','perdido')  AND status = 'concluida') OR
    (etapa = 'encerrado'                                     AND status = 'cancelada')
  ));

ALTER TABLE tarefas ADD CONSTRAINT etapa_exige_paciente CHECK (
  etapa IS NULL OR paciente_id IS NOT NULL);

ALTER TABLE tarefas ADD CONSTRAINT orcamento_so_com_etapa CHECK (
  (valor_orcamento IS NULL AND programa_orcado IS NULL)
  OR etapa IN ('orcamento','fechado','perdido'));

ALTER TABLE tarefas ADD CONSTRAINT motivo_so_em_perdido CHECK (
  motivo_perda_id IS NULL OR etapa = 'perdido');

-- ---------------------------------------------------------------------------
-- ÍNDICES — as três consultas que a tela Hoje faz a cada abertura.
-- Parciais, porque a fração da tabela que interessa é minúscula e cresce com
-- o que está pendente, não com o histórico da clínica.
-- ---------------------------------------------------------------------------
CREATE INDEX tarefas_em_recontato ON tarefas (clinica_id, proximo_passo_em)
  WHERE etapa IN ('faltou','desmarcou') AND excluida_em IS NULL;

CREATE INDEX tarefas_para_retomar ON tarefas (clinica_id, proximo_passo_em)
  WHERE etapa = 'orcamento' AND excluida_em IS NULL;

CREATE INDEX tarefas_por_etapa ON tarefas (clinica_id, etapa, prazo)
  WHERE etapa IS NOT NULL AND excluida_em IS NULL;

-- O funil percorre os eventos do `historico`. GIN para que "quem teve evento
-- X no período" não vire sequential scan numa clínica com três anos de dado.
CREATE INDEX tarefas_historico ON tarefas USING gin (historico jsonb_path_ops)
  WHERE etapa IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS e trilha na tabela nova.
-- ---------------------------------------------------------------------------
ALTER TABLE motivos_de_perda ENABLE ROW LEVEL SECURITY;
ALTER TABLE motivos_de_perda FORCE  ROW LEVEL SECURITY;
CREATE POLICY motivos_por_clinica ON motivos_de_perda
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());
CREATE TRIGGER motivos_auditoria AFTER INSERT OR UPDATE OR DELETE ON motivos_de_perda
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();
```

- [ ] **Passo 4: Fechar os dois buracos que a `0006` deixou**

**(a) Semear os motivos em toda clínica.** Semeie as existentes nesta migration e acrescente a semeadura ao fluxo de criação de clínica, onde `perfisPadrao()` já é escrito. Os cinco nomes e a ordem vêm de `MOTIVOS_PERDA` do protótipo — não invente outros.

**(b) `cancelar` num cartão da jornada.** O `POST /v1/tarefas/:id/cancelar` do épico 2 grava `status = 'cancelada'` sem tocar em `etapa` — e a partir desta migration isso viola `etapa_combina_com_status`. Ajuste-o: quando `etapa IS NOT NULL`, grava também `etapa = 'encerrado'` e anexa `{acao:'encerrar', etapa:'encerrado'}` ao histórico. **Isto não duplica o `encerrar` da Task 4** — é o mesmo efeito, alcançado pela outra porta, e as duas passam pela mesma `transicao()`.

- [ ] **Passo 5: Aplicar e rodar** — `cd apps/api && npx tsx migrar.ts`, depois `cd teste && npx vitest run jornada-banco` → PASS. Rode também `npx vitest run` inteiro: o `cancelar` do épico 2 tem de continuar verde.

- [ ] **Passo 6: Registrar** — `'motivos_de_perda'` em `ENTIDADES_COM_CLINICA` (`teste/registro.ts`). `auditoria-inescapavel.test.ts` varre o catálogo e reprova tabela com `clinica_id` sem trigger — rode e veja passar.

- [ ] **Passo 7: Prova por mutação** — remova a cláusula `faltou`/`desmarcou` do `CHECK`, reaplique num banco limpo (`fir reset`) e rode: o primeiro teste tem de falhar. Restaure.

- [ ] **Passo 8: Commit**

---

## Task 3: Os contratos — uma ação, um corpo

**Files:** `packages/contracts/src/jornada.ts` · `jornada.test.ts` · *(modificar)* `index.ts`

**A decisão que esta tarefa fixa:** `MoverEtapa` é uma **união discriminada por `acao`**, não um objeto com dez campos opcionais.

O protótipo recebe `{id, acao, prazo?, hora?, valor?, nota?, motivo?, acaoEm?, programa?}` e descobre o que falta em tempo de execução — às vezes. `perder` sem motivo ele **não** descobre: aceita e grava vazio. Aqui, `perder` sem `motivoId` **não compila**, e `reagendar` com `valor` também não.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// packages/contracts/src/jornada.test.ts
it('perder SEM motivo é recusado pelo PARSE, não pelo serviço', () => {
  expect(MoverEtapa.safeParse({ acao: 'perder', nota: 'desistiu' }).success).toBe(false)
})

it('reagendar sem prazo é recusado', () => {
  expect(MoverEtapa.safeParse({ acao: 'reagendar' }).success).toBe(false)
})

it('registrar orçamento sem valor é recusado', () => {
  expect(MoverEtapa.safeParse({ acao: 'registrarOrcamento' }).success).toBe(false)
})

it('orçamento de valor zero é recusado — isso não é proposta', () => {
  expect(MoverEtapa.safeParse({ acao: 'registrarOrcamento', valor: '0' }).success).toBe(false)
})

it('o valor do orçamento chega como centavos, nunca como float', () => {
  const r = MoverEtapa.parse({ acao: 'registrarOrcamento', valor: '360000' })
  expect(r.valor).toBe(360000n)
})

it('campo que não é da ação é recusado — nada de corpo-saco', () => {
  // `.strict()`: `reagendar` com `valor` no corpo significa que quem chamou
  // entendeu errado o que está fazendo, e o silêncio é pior que o 400.
  expect(MoverEtapa.safeParse({ acao: 'reagendar', prazo: '2026-11-03', valor: '100' }).success)
    .toBe(false)
})

it('a nota é limitada a 160 e vem aparada', () => { /* igual ao protótipo */ })

it('o programa orçado aceita no máximo 10 itens', () => { /* `.slice(0,10)` do protótipo vira `.max(10)` */ })

it('fechar carrega o corpo do recebimento, e a forma é da lista fechada', () => {
  const r = MoverEtapa.parse({
    acao: 'fechar',
    recebimento: { valor: '100000', forma: 'Pix', valorAberto: '260000' },
  })
  expect(r.recebimento.valor).toBe(100000n)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar**

```ts
// packages/contracts/src/jornada.ts
import { z } from 'zod'
import { DiaCivil, dinheiroEmTexto, Hora, Uuid } from './comum'
import { PagamentoEmbutido } from './tarefas'   // do épico 2 — o MESMO schema

const Nota = z.string().trim().max(160).optional()

/** Um item do programa proposto no orçamento. A costura com o épico 5. */
const ItemOrcado = z.object({
  procedimentoId: Uuid,
  sessoes: z.number().int().min(1).max(60),
  intervaloDias: z.number().int().min(1).max(365),
  dose: z.string().trim().max(40).optional(),
  responsavelId: Uuid.nullish(),
  valor: dinheiroEmTexto.optional(),
  /** Encadeamento dentro da proposta: este item começa depois daquele. */
  chave: z.string().min(1).max(20),
  depoisDe: z.string().min(1).max(20).optional(),
})

/**
 * UMA AÇÃO, UM CORPO.
 *
 * O protótipo recebe tudo num objeto só e valida alguns campos em tempo de
 * execução — mas não `motivo` em `perder`, que ele aceita vazio. Resultado
 * medido: o KPI "Orçamentos perdidos · veja os motivos no histórico" aponta
 * para um histórico sem motivo nenhum. Aqui a combinação não existe.
 */
export const MoverEtapa = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('enviarConfirmacao') }).strict(),
  z.object({ acao: z.literal('confirmar') }).strict(),
  z.object({ acao: z.literal('noshow') }).strict(),
  z.object({ acao: z.literal('desmarcar'), nota: Nota }).strict(),
  z.object({ acao: z.literal('reagendar'), prazo: DiaCivil, hora: Hora.optional() }).strict(),
  z.object({ acao: z.literal('encerrar'), nota: Nota }).strict(),
  z.object({ acao: z.literal('reabrir') }).strict(),
  z.object({
    acao: z.literal('registrarOrcamento'),
    valor: dinheiroEmTexto.refine((v) => v > 0n, 'Informe o valor do orçamento.'),
    retomarEm: DiaCivil.optional(),            // padrão: hoje + 2 (servidor)
    programa: z.array(ItemOrcado).min(1).max(10).optional(),
    nota: Nota,
  }).strict(),
  z.object({ acao: z.literal('followUp'), retomarEm: DiaCivil.optional(), nota: Nota }).strict(),
  z.object({ acao: z.literal('fechar'), recebimento: PagamentoEmbutido, nota: Nota }).strict(),
  z.object({ acao: z.literal('perder'), motivoId: Uuid, nota: Nota }).strict(),
])
```

Note o que **não** está no contrato: `etapa`. O cliente nunca diz para onde o cartão vai — ele diz o que a recepção fez, e o servidor decide o destino pela tabela da Task 1. É a diferença entre uma máquina de estados e um campo editável.

E note que `retomarEm` é **opcional**: o padrão (`hoje + 2` para o orçamento, `hoje + 3` para o follow-up) é calculado **no servidor**, no fuso da clínica (regra 24). O protótipo calcula na tela.

- [ ] **Passo 4: Rodar — PASS.** Exporte de `index.ts`.

- [ ] **Passo 5: Commit**

---

## Task 4: A rota — as transições que não mexem em dinheiro

**Files:** `apps/api/src/jornada/jornada.controller.ts` · `jornada.service.ts` · `jornada.module.ts` · `jornada.e2e.test.ts`

```
POST /v1/tarefas/:id/jornada     @Exige('jornada')
```

**Uma rota, não dez.** O corpo discrimina. As ações desta tarefa são `enviarConfirmacao`, `confirmar`, `noshow`, `desmarcar`, `reagendar`, `encerrar` e `reabrir` — as de orçamento são das Tasks 5–7, na mesma rota.

O serviço faz sempre a mesma coisa, e **a ordem não é negociável**:

```
1. SELECT … FOR UPDATE          (dentro de banco.naClinica — a RLS filtra)
2. etapa IS NULL  → 404 "Agendamento não encontrado."
3. transicao(estado, acao)      ← packages/domain, Task 1
4. validações da ação           (prazo >= hoje DO SERVIDOR, etc.)
5. UPDATE  etapa, status, historico = historico || $evento, campos da ação
6. devolve a tarefa
```

O `FOR UPDATE` não é zelo: duas recepcionistas tocando "Confirmou" e "No-show" no mesmo cartão ao mesmo tempo, sem ele, produzem duas leituras do mesmo estado e dois `UPDATE` que se sobrescrevem — e o histórico perde um evento. A trilha de auditoria (regra 20) é prova, e prova com buraco não é prova.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('É A MESMA TAREFA — nenhuma tarefa nova por etapa', async () => {
  const antes = await contarTarefasDe(ANA)
  for (const acao of ['confirmar', 'noshow', 'reagendar'] as const) {
    const r = await mover(CARD, acao === 'reagendar' ? { acao, prazo: amanha() } : { acao })
    expect(r.json().id).toBe(CARD)
  }
  expect(await contarTarefasDe(ANA)).toBe(antes)
})

it('no-show MANTÉM o cartão aberto e o põe em Recontatar', async () => {
  const t = (await mover(CARD, { acao: 'noshow' })).json()
  expect(t.etapa).toBe('faltou')
  expect(t.status).toBe('aberta')
  expect(t.proximoPassoEm).toBe(hojeDaClinica())
  expect((await hoje()).recontatar.map((x) => x.id)).toContain(CARD)
})

it('o cartão em Recontatar sai de "Hoje" e das pendentes — mas não some', async () => {
  await mover(CARD, { acao: 'noshow' })
  const h = await hoje()
  expect(h.hoje.map((x) => x.id)).not.toContain(CARD)
  expect(h.pendentes.itens.map((x) => x.id)).not.toContain(CARD)
  expect(h.recontatar.map((x) => x.id)).toContain(CARD)
})

it('reagendar volta para agendado, limpa o passo e a confirmação enviada', async () => {
  await mover(CARD, { acao: 'enviarConfirmacao' })
  await mover(CARD, { acao: 'noshow' })
  const t = (await mover(CARD, { acao: 'reagendar', prazo: '2026-11-03', hora: '09:30' })).json()
  expect(t.etapa).toBe('agendado')
  expect(t.prazo).toBe('2026-11-03')
  expect(t.proximoPassoEm).toBeNull()
  expect(t.confirmacaoEnviadaEm).toBeNull()
  expect(t.historico.at(-1)).toMatchObject({ acao: 'reagendar', etapa: 'agendado' })
})

it('reagendar para uma data passada é 400 — contra o hoje DO SERVIDOR', async () => {
  // RelogioFixo em 2026-10-25T02:00:00Z. Em America/Bahia ainda é 24/10, então
  // "2026-10-24" é hoje e PASSA; "2026-10-23" é 400. Um cliente com o relógio
  // adiantado não muda nenhum dos dois (regra 24).
  expect((await mover(CARD, { acao: 'reagendar', prazo: '2026-10-24' })).statusCode).toBe(200)
  expect((await mover(CARD, { acao: 'reagendar', prazo: '2026-10-23' })).statusCode).toBe(400)
})

it('encerrar cancela mas NÃO apaga — a trilha fica', async () => {
  await mover(CARD, { acao: 'desmarcar', nota: 'viagem' })
  const t = (await mover(CARD, { acao: 'encerrar', nota: 'mudou de cidade' })).json()
  expect(t.etapa).toBe('encerrado')
  expect(t.status).toBe('cancelada')
  expect(await existeNoBanco(CARD)).toBe(true)
  expect(t.historico).toHaveLength(ANTES + 2)
})

it('o histórico é append-only pela rota: nenhum evento some', async () => {
  const antes = (await buscar(CARD)).historico
  await mover(CARD, { acao: 'confirmar' })
  const depois = (await buscar(CARD)).historico
  expect(depois.slice(0, antes.length)).toEqual(antes)
})

it('transição proibida é 409, com a mensagem que a recepção já conhece', async () => {
  const r = await mover(FECHADO, { acao: 'confirmar' })
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toContain('não vale para a situação atual')
})

it('reabrir restaura a etapa anterior, não "agendado" por padrão', async () => {
  await mover(CARD, { acao: 'noshow' })
  await concluir(CARD, { em: hojeDaClinica() })      // rota do épico 2
  const t = (await reabrir(CARD)).json()
  expect(t.etapa).toBe('faltou')
  expect(t.status).toBe('aberta')
})

it('reabrir depois do orçamento é 409 — o dinheiro não fica órfão', async () => {
  const r = await reabrir(COM_ORCAMENTO)
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toContain('orçamento')
})

it('tarefa que não é da jornada é 404, não 409', async () => {
  // Uma tarefa interna, ou um Follow-up: `etapa IS NULL`. 409 diria que ela
  // existe e que a ação é que está errada — e ela nem é um agendamento.
  expect((await mover(TAREFA_INTERNA, { acao: 'confirmar' })).statusCode).toBe(404)
})

it('sem a permissão `jornada`, 403 — e o cartão não se move', async () => {
  expect((await mover(CARD, { acao: 'confirmar' }, cookieDe(ENFERMAGEM))).statusCode).toBe(403)
  expect((await buscar(CARD)).etapa).toBe('agendado')
})

it('cartão de outra clínica é 404, nem com o id na mão', async () => { /* RLS */ })

it('duas ações simultâneas no mesmo cartão não perdem evento', async () => {
  // FOR UPDATE. Sem ele, as duas leem `agendado` e o segundo UPDATE escreve
  // um `historico` que não viu o primeiro evento.
  const [a, b] = await Promise.allSettled([
    mover(CARD, { acao: 'confirmar' }), mover(CARD, { acao: 'noshow' }),
  ])
  expect([a, b].filter(okDe).length).toBe(1)
  expect((await buscar(CARD)).historico).toHaveLength(ANTES + 1)
})

it('nenhum log contém a nota, o nome da paciente nem o telefone', async () => {
  const linhas = await capturarConsole(() =>
    mover(CARD, { acao: 'desmarcar', nota: 'o marido da Ana Lúcia não deixou' }))
  expect(linhas.join('\n')).not.toMatch(/marido|Ana Lúcia/)
})
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — `Relogio` **injetado** (`@Inject(Relogio)`), nunca `new Date()` dentro do serviço: sem isso o teste do fuso é impossível de escrever sem esperar a meia-noite.

O `historico` cresce **no banco**, não em JavaScript:

```sql
UPDATE tarefas
   SET etapa = $2, status = $3, historico = historico || $4::jsonb, …
 WHERE id = $1 AND excluida_em IS NULL
```

Ler o array, dar `push` e gravar de volta é ler-depois-escrever — perde a corrida que o `FOR UPDATE` existe para não perder, e torna o `FOR UPDATE` decorativo. `||` concatena no servidor do banco.

A nota da ação `noshow` sai do **fuso da clínica**: `não compareceu em ${formatarDia(prazo, clinica.fuso)}`. Formatar com o fuso errado põe a data de ontem num registro de hoje.

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Registrar as rotas** em `teste/registro.ts`. `POST /v1/tarefas/:id/jornada` devolve `valorOrcamento` e `historico[].valor` → entra em `ROTAS_COM_DINHEIRO`.

- [ ] **Passo 6: Prova por mutação** — troque `historico || $4` por um `SET historico = $4` com o array lido antes. O teste de concorrência tem de falhar. Restaure.

- [ ] **Passo 7: Commit**

---

## Task 5: Orçamento — registrar, retomar, e provar que não é receita

**Files:** `apps/api/src/jornada/jornada.service.ts` *(modificar)* · `orcamento.test.ts` · `teste/redacao-de-valores.test.ts` *(modificar)*

As ações `registrarOrcamento` e `followUp`, na mesma rota da Task 4.

**A regra 4 é o produto inteiro desta tarefa.** `valor_orcamento` é uma nota promissória: ela mede conversão, e **nada mais**. No dia em que ela vazar para a receita, o faturamento do mês fica errado para cima, a meta aparece batida, e a clínica descobre no fechamento.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('ORÇAMENTO NÃO É RECEITA — e esta é a asserção que o épico protege', async () => {
  const antes = await receitaDoDia()
  const t = (await mover(REALIZADO, { acao: 'registrarOrcamento', valor: '360000' })).json()
  expect(t.valorOrcamento).toBe('360000')
  expect(await receitaDoDia()).toBe(antes)              // não mudou
  expect(await contarRecebimentosDe(REALIZADO)).toBe(0) // nenhuma linha criada
  expect(await ltvDe(ANA)).toBe(await ltvAntes)         // o LTV não mexeu
  expect(await metaDoMes()).toMatchObject({ realizado: antes })
})

it('o esperado do caixa do dia ignora o orçamento', async () => {
  // Se o orçamento entrasse aqui, a conferência às cegas pediria R$ 3.600 em
  // dinheiro que ninguém recebeu, e a recepção fecharia o caixa com "falta".
})

it('a tarefa continua SEM coluna de dinheiro recebido', async () => {
  const t = (await buscar(REALIZADO)).valorOrcamento
  expect(Object.keys(await buscar(REALIZADO))).not.toContain('valor')
})

it('retomar em: padrão hoje+2, calculado no fuso da clínica pelo SERVIDOR', async () => {
  const t = (await mover(REALIZADO, { acao: 'registrarOrcamento', valor: '360000' })).json()
  expect(t.proximoPassoEm).toBe(somarDias(hojeDaClinica(), 2))
})

it('follow-up não troca a etapa, não zera o valor e só adia o passo', async () => {
  const t = (await mover(ORCADO, { acao: 'followUp', nota: 'vai decidir até sexta' })).json()
  expect(t.etapa).toBe('orcamento')
  expect(t.valorOrcamento).toBe('360000')
  expect(t.proximoPassoEm).toBe(somarDias(hojeDaClinica(), 3))
  expect(t.historico.at(-1).acao).toBe('followUp')
})

it('registrar orçamento duas vezes é 409', async () => {
  expect((await mover(ORCADO, { acao: 'registrarOrcamento', valor: '100000' })).statusCode).toBe(409)
})

it('orçar um atendimento ANTIGO é permitido pelo servidor', async () => {
  // O protótipo esconde o botão depois de 30 dias — e está certo, na TELA.
  // No servidor, bloquear faria a migração do épico 9 escrever direto na
  // tabela, que é como a regra 4 morre sem ninguém ver (decisão D-6).
  expect((await mover(REALIZADO_HA_2_ANOS, { acao: 'registrarOrcamento', valor: '500000' })).statusCode).toBe(200)
})

it('programa orçado: procedimento inexistente ou inativo é 400', async () => { /* … */ })
it('programa orçado com 11 itens é recusado pelo parse', async () => { /* Task 3 */ })

it('o programa orçado sobrevive inteiro para o épico 5', async () => {
  const t = (await mover(REALIZADO, {
    acao: 'registrarOrcamento', valor: '360000',
    programa: [{ procedimentoId: TIRZE, sessoes: 12, intervaloDias: 7, chave: 'i1', dose: '2,5 mg' }],
  })).json()
  expect(t.programaOrcado).toHaveLength(1)
  expect(t.programaOrcado[0]).toMatchObject({ sessoes: 12, dose: '2,5 mg' })
})

// ── A PROVA DA REDAÇÃO (regra 17) ───────────────────────────────────────────
it('sem `valores`, o dinheiro some do topo E DE DENTRO DO HISTÓRICO', async () => {
  // O protótipo redige só o topo (`saida()`): o valor do orçamento viaja
  // dentro de `historico` e só a TELA o esconde. É exatamente o que a regra
  // 17 proíbe. O `RedacaoInterceptor` já percorre em profundidade — este
  // teste existe para que ninguém "otimize" a recursão fora.
  const t = (await buscar(ORCADO, cookieDe(SEM_VALORES))).json()
  expect(t.valorOrcamento).toBeNull()
  expect(t.historico.find((e) => e.acao === 'registrarOrcamento').valor).toBeNull()
  expect(t.programaOrcado[0].valor).toBeNull()
  expect(JSON.stringify(t)).not.toContain('360000')
})

it('com `valores`, o mesmo cartão traz tudo', async () => { /* a forma não muda */ })
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar**

O `valor` do evento entra no `jsonb` como **string de centavos** (decisão D-4). Escreva o porquê no código, uma vez:

```ts
/**
 * Centavos EM TEXTO dentro do jsonb, não número JSON.
 *
 * O `jsonb` do Postgres guarda `numeric` exato, então o banco não perderia
 * precisão — mas `JSON.parse`, do lado do Node, devolve `number`, e um
 * `number` perto de dinheiro é a assinatura que a regra 1 proíbe atravessar.
 * A convenção já existe no transporte (`dinheiroEmTexto`); duas convenções
 * para a mesma coisa é como uma delas é esquecida.
 */
const valorDoEvento = (d: Dinheiro): string => String(d.centavos)
```

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Registrar** — acrescente `historico[].valor`, `programaOrcado[].valor` e `valorOrcamento` aos `camposDeDinheiro` das rotas da jornada em `teste/registro.ts`. O `redacao-de-valores.test.ts` passa a cobrar os três.

- [ ] **Passo 6: Prova por mutação** — em `redacao.interceptor.ts`, troque `redigir(valor, pode)` por `valor` na última linha do laço (a recursão). O teste *"o dinheiro some do topo E DE DENTRO DO HISTÓRICO"* tem de falhar. Restaure. **É esta mutação que separa a regra 17 implementada da regra 17 escrita.**

- [ ] **Passo 7: Commit**

---

## Task 6: Perder com motivo — e o motivo que é dado

**Files:** `apps/api/src/jornada/jornada.service.ts` *(modificar)* · `apps/api/src/jornada/motivos.controller.ts` · `perder.test.ts`

```
POST /v1/tarefas/:id/jornada   { acao: 'perder', motivoId, nota? }    @Exige('jornada')
GET  /v1/motivos-de-perda                                              @Exige('jornada')
```

**O protótipo aceita perder sem motivo** — medido, não suposto: `api('moverEtapa',{id,acao:'perder'})` devolve `OK` e grava `nota: ""`. E o KPI da tela Jornada diz, em letra miúda, *"veja os motivos no histórico"*. Os dois juntos são um número que não explica nada.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('perder sem motivo é 400 — o protótipo aceita, nós não', async () => {
  const r = await mover(ORCADO, { acao: 'perder' } as never)
  expect(r.statusCode).toBe(400)
})

it('motivo de outra clínica é 400 — não 404, e nunca sucesso', async () => {
  expect((await mover(ORCADO, { acao: 'perder', motivoId: MOTIVO_DA_OUTRA })).statusCode).toBe(400)
})

it('motivo desativado não serve para perda nova', async () => { /* … */ })

it('o NOME do motivo fica gravado no evento, junto com o id', async () => {
  const t = (await mover(ORCADO, { acao: 'perder', motivoId: PRECO })).json()
  expect(t.historico.at(-1)).toMatchObject({ acao: 'perder', motivoId: PRECO, motivo: 'Preço' })
})

it('RENOMEAR o motivo NÃO reescreve a história', async () => {
  // O relatório do trimestre passado não pode mudar porque alguém arrumou a
  // lista hoje. O id agrupa; o nome gravado é o que se lê (decisão D-2).
  await mover(ORCADO, { acao: 'perder', motivoId: PRECO })
  await renomearMotivo(PRECO, 'Preço acima do esperado')
  expect((await buscar(ORCADO)).historico.at(-1).motivo).toBe('Preço')
  expect(await perdasPorMotivo()).toContainEqual({ motivoId: PRECO, nome: 'Preço acima do esperado', n: 1 })
})

it('perdido é terminal: nada sai dele', async () => {
  await mover(ORCADO, { acao: 'perder', motivoId: PRECO })
  for (const acao of ['followUp', 'fechar', 'registrarOrcamento', 'reabrir'] as const) {
    expect((await mover(ORCADO, { acao } as never)).statusCode).toBe(409)
  }
})

it('perder NÃO apaga o valor do orçamento — é ele que mede o perdido', async () => {
  const t = (await mover(ORCADO, { acao: 'perder', motivoId: PRECO })).json()
  expect(t.valorOrcamento).toBe('360000')
})

it('o valor perdido NUNCA entra em receita nem em LTV', async () => {
  const antes = await receitaDoDia()
  await mover(ORCADO, { acao: 'perder', motivoId: PRECO })
  expect(await receitaDoDia()).toBe(antes)
})

it('GET /v1/motivos-de-perda devolve só os ativos da clínica, na ordem', async () => { /* … */ })
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — o motivo é resolvido **dentro da mesma transação**, com a RLS ativa: um `SELECT nome FROM motivos_de_perda WHERE id = $1 AND ativo`. Zero linhas → `400 'Escolha um motivo da lista.'`. Nada de `IN` montado com o id vindo do corpo.

Ainda **não** há tela de gestão de motivos. A semeadura da Task 2 dá os cinco, e a clínica os edita em `Configurações` — **que fica para depois**, anotado em `docs/dividas.md` na Task 12. A rota `PATCH /v1/motivos-de-perda/:id` não entra aqui; só o `GET`, que a tela de perda precisa para montar a lista.

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Prova por mutação** — faça o evento gravar só `motivoId`, sem `motivo`. O teste *"RENOMEAR o motivo NÃO reescreve a história"* tem de falhar. Restaure.

- [ ] **Passo 6: Commit**

---

## Task 7: Fechar — uma transação só

**Files:** `apps/api/src/jornada/fechamento.service.ts` · `montador-de-programa.ts` · `fechar.test.ts`

> ⚠️ **Leia antes a pergunta para o dono**, acima. Se a resposta for *"adie o `fechar` inteiro para o épico 5"*, esta tarefa sai do plano.

```
POST /v1/tarefas/:id/jornada   { acao: 'fechar', recebimento: {…} }
@Exige('jornada')  @Exige('receber')
```

**O defeito que esta tarefa corrige.** No protótipo, "Fechou" são **duas chamadas do cliente**: `criarTarefa`/`criarAdesao` cria o recebimento, e **depois** `moverEtapa fechar` move o cartão. Entre uma e outra cabe uma rede que cai, uma aba fechada, um 500. Quando cai, o dinheiro está lançado e o cartão continua em "Orçamentos em aberto" — a clínica vê um orçamento pendente de uma paciente que já pagou, e liga para cobrá-la.

Aqui são **três escritas numa transação**: o `Recebimento`, o `Programa` (quando houver) e a etapa.

**As três coisas que o fechamento grava, e a diferença entre elas:**

| Campo | O que é | Entra na receita? |
|---|---|---|
| `recebimento.valor` | o que a paciente **pagou agora** | **sim** — é a única |
| `recebimento.valorAberto` | o que ficou para depois | não, até ser pago |
| `valor_orcamento` | entrada + aberto = **o negócio fechado** | **nunca** |

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('fechar faz UMA transação: ou as três escritas, ou nenhuma', async () => {
  // Forçar falha no montador do programa e conferir que NÃO existe
  // recebimento órfão e que o cartão continua em `orcamento`.
  comMontadorQueFalha(async () => {
    expect((await mover(ORCADO, { acao: 'fechar', recebimento: ENTRADA })).statusCode).toBe(500)
  })
  expect(await recebimentosVivosDe(ORCADO)).toHaveLength(0)
  expect((await buscar(ORCADO)).etapa).toBe('orcamento')
})

it('a receita conta A ENTRADA, não o orçamento', async () => {
  await mover(ORCADO, { acao: 'fechar', recebimento: { valor: '100000', forma: 'Pix', valorAberto: '260000' } })
  expect(await receitaDoDia()).toBe(100000n)        // R$ 1.000, não R$ 3.600
  expect((await buscar(ORCADO)).valorOrcamento).toBe('360000')
})

it('a receita NÃO DOBRA: o mesmo cartão recusa o segundo recebimento', async () => {
  await mover(ORCADO, { acao: 'fechar', recebimento: ENTRADA })
  await expect(inserirRecebimento({ tarefaId: ORCADO, valor: 100000n })).rejects.toThrow()
  expect(await receitaDoDia()).toBe(100000n)
})

it('o saldo em aberto nasce do fechamento, agrupado — e é derivado', async () => {
  await mover(ORCADO, { acao: 'fechar', recebimento: { valor: '100000', forma: 'Pix', valorAberto: '260000' } })
  expect(await saldoDe(ANA)).toMatchObject({ geral: 260000n })
  // E NÃO existe coluna `saldo` em lugar nenhum (regra 5).
})

it('fechar direto de `realizado`, sem orçamento, funciona e grava o total', async () => {
  const t = (await mover(REALIZADO, {
    acao: 'fechar', recebimento: { valor: '45000', forma: 'Pix', valorAberto: '15000' },
  })).json()
  expect(t.etapa).toBe('fechado')
  expect(t.valorOrcamento).toBe('60000')     // entrada + aberto, como o protótipo
})

it('fechar NÃO sobrescreve um valor de orçamento já registrado', async () => {
  // O protótipo: `if (!(Number(t.valorOrcamento) > 0) && Number(b.valor) > 0)`.
  // Se sobrescrevesse, o funil mediria "fechado pelo que entrou", e um
  // fechamento com entrada pequena apagaria o tamanho do negócio.
  await mover(ORCADO, { acao: 'fechar', recebimento: { valor: '10000', forma: 'Pix' } })
  expect((await buscar(ORCADO)).valorOrcamento).toBe('360000')
})

it('fechado é terminal, e reabrir é 409', async () => { /* … */ })

it('sem a permissão `receber`, 403 — e nada foi escrito', async () => {
  const r = await mover(ORCADO, { acao: 'fechar', recebimento: ENTRADA }, cookieDe(COMERCIAL))
  expect(r.statusCode).toBe(403)
  expect(await recebimentosVivosDe(ORCADO)).toHaveLength(0)
  expect((await buscar(ORCADO)).etapa).toBe('orcamento')
})

it('fechar com programa orçado é 409 enquanto o épico 5 não existe', async () => {
  const r = await mover(ORCADO_COM_PROGRAMA, { acao: 'fechar', recebimento: ENTRADA })
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toContain('Programas')
  // E o programa proposto CONTINUA LÁ, inteiro, esperando.
  expect((await buscar(ORCADO_COM_PROGRAMA)).programaOrcado).toHaveLength(1)
})
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar — e declarar a costura com o épico 5**

```ts
// apps/api/src/jornada/montador-de-programa.ts
/**
 * A COSTURA COM O ÉPICO 5, declarada aqui e implementada lá.
 *
 * O fechamento de um orçamento com programa precisa montar o `Programa` na
 * MESMA transação do recebimento e da etapa — senão a paciente paga, o
 * cartão fecha, e as doze aplicações não existem. Este épico não constrói o
 * épico 5: ele declara a porta pela qual o épico 5 entra, e recebe a
 * transação aberta para que a atomicidade seja de quem chama, não de quem é
 * chamado.
 *
 * `programa_orcado` guarda a proposta inteira desde o `registrarOrcamento`.
 * Nada se perde enquanto esta porta não tem implementação: o épico 5 lê a
 * coluna e monta.
 */
export abstract class MontadorDePrograma {
  abstract montar(tx: Transacao, dados: ProgramaOrcado): Promise<Result<{ programaId: string }>>
}

/** Até o épico 5. Recusa em vez de montar pela metade. */
@Injectable()
export class MontadorIndisponivel extends MontadorDePrograma {
  async montar(): Promise<Result<{ programaId: string }>> {
    return erro(erroDe('PROGRAMA_AINDA_NAO',
      'O programa será montado quando o módulo Programas entrar. ' +
      'Registre o recebimento pela tela Recebimentos.'))
  }
}
```

Injetado com `@Inject(MontadorDePrograma)` e provido por `{ provide: MontadorDePrograma, useClass: MontadorIndisponivel }` em `jornada.module.ts`. **O épico 5 troca uma linha**, e o teste *"fechar com programa orçado é 409"* vira o teste do caminho feliz.

O recebimento usa o **mesmo serviço do épico 2** (`PagamentoEmbutido` → uma linha em `recebimentos` com `tarefa_id`). Nenhuma segunda implementação, nenhuma coluna de dinheiro recebido em `tarefas`.

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Prova por mutação** — tire o `fechar` de dentro da transação (faça as três escritas em três conexões). O primeiro teste tem de falhar com recebimento órfão. Restaure. **É esta mutação que separa o nosso fechamento do do protótipo.**

- [ ] **Passo 6: Segunda mutação** — faça `fechar` sobrescrever `valor_orcamento` sempre. O teste *"NÃO sobrescreve"* tem de falhar. Restaure.

- [ ] **Passo 7: Commit**

---

## Task 8: `GET /v1/hoje` — Recontatar e Próximos passos da jornada

**Files:** `apps/api/src/hoje/hoje.service.ts` *(modificar)* · `apps/api/src/hoje/hoje.controller.ts` *(modificar)* · `hoje-jornada.test.ts`

**É aqui que a ferramenta deixa de ser uma lista de tarefas.** Três blocos novos na mesma resposta que o épico 2 já compõe — e **os três são calculados no servidor** (`docs/design.md` proíbe cálculo no front):

| Bloco | Quem entra | De onde vem |
|---|---|---|
| `recontatar` | `etapa IN ('faltou','desmarcou')` e `excluida_em IS NULL` | ficam **todo dia** até reagendar ou encerrar |
| `paraConfirmar` | `etapa = 'agendado'` e `prazo = hoje + 1` | *"Confirmar os agendamentos de amanhã"* |
| `retomar` | `etapa = 'orcamento'` e `proximo_passo_em <= hoje` | *"Orçamentos para retomar o contato"*, do mais antigo |

**A regra que não pode faltar, e que o épico 2 não tinha como escrever:** cartões em recontato **saem** da seção "Hoje", das "Pendentes de dias anteriores" e da contagem das bolinhas da semana. É o que o protótipo faz (`base = …filter(… && !emRecontato(t) …)`), e a razão é de produto: um cartão que faltou há três semanas não é uma tarefa atrasada que alguém esqueceu — é um recontato pendente, e ele já tem seção própria. Misturar os dois faz a recepção ver "15 pendentes" todo dia e parar de olhar.

Os três blocos respeitam o filtro de pessoa, e com a mesma regra frouxa do protótipo (`vePasso`): em "Para mim" entra quem é **responsável ou solicitante** — porque o passo seguinte de um agendamento que eu marquei é meu, mesmo que outra pessoa vá executar.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('faltou e desmarcou ficam em Recontatar TODO DIA, até resolver', async () => {
  await mover(CARD, { acao: 'noshow' })
  for (const dia of [hoje(), mais(1), mais(7), mais(30)]) {
    expect((await hoje({ dia })).recontatar.map((x) => x.id)).toContain(CARD)
  }
})

it('reagendar tira do Recontatar; encerrar também', async () => {
  await mover(A, { acao: 'noshow' }); await mover(B, { acao: 'desmarcar' })
  await mover(A, { acao: 'reagendar', prazo: amanha() })
  await mover(B, { acao: 'encerrar' })
  expect((await hoje()).recontatar).toHaveLength(0)
})

it('o cartão em recontato NÃO conta como pendente nem nas bolinhas da semana', async () => {
  const antes = await hoje()
  await mover(ATRASADO, { acao: 'noshow' })
  const depois = await hoje()
  expect(depois.pendentes.total).toBe(antes.pendentes.total - 1)
  expect(somaDasBolinhas(depois.semana)).toBe(somaDasBolinhas(antes.semana) - 1)
  expect(depois.recontatar).toHaveLength(1)   // não sumiu: mudou de lugar
})

it('paraConfirmar é só AMANHÃ, pelo hoje do SERVIDOR', async () => {
  // RelogioFixo em 2026-10-25T02:00:00Z → em America/Bahia ainda é 24/10,
  // então "amanhã" é 25/10 e não 26/10.
  expect((await hoje()).paraConfirmar.map((x) => x.prazo)).toEqual(['2026-10-25'])
})

it('um agendamento já confirmado sai de paraConfirmar', async () => { /* … */ })

it('retomar só traz orçamento com o passo VENCIDO, do mais antigo', async () => {
  const r = (await hoje()).retomar
  expect(r.every((x) => x.proximoPassoEm <= hojeDaClinica())).toBe(true)
  expect(r.map((x) => x.proximoPassoEm)).toEqual([...r.map((x) => x.proximoPassoEm)].sort())
})

it('followUp adia e o cartão sai de retomar hoje', async () => {
  await mover(ORCADO, { acao: 'followUp', nota: 'vai decidir' })
  expect((await hoje()).retomar.map((x) => x.id)).not.toContain(ORCADO)
})

it('em "Para mim" entra quem é responsável OU solicitante', async () => { /* vePasso */ })

it('navegar para outra semana não muda Recontatar nem Próximos passos', async () => {
  // Eles são do HOJE do servidor, não do dia navegado — como "atrasada".
  expect((await hoje({ dia: semanaPassada() })).recontatar).toEqual((await hoje()).recontatar)
})

it('sem a permissão `jornada`, os três blocos vêm vazios, e o resto não', async () => {
  const h = await hoje(cookieDe(ENFERMAGEM))
  expect([h.recontatar, h.paraConfirmar, h.retomar].every((b) => b.length === 0)).toBe(true)
  expect(h.hoje.length).toBeGreaterThan(0)
})

it('sem `valores`, o orçamento em retomar vem null — e a lista continua', async () => { /* … */ })
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — os três blocos saem da **mesma consulta** da tela Hoje, por `etapa`, usando `tarefas_em_recontato` e `tarefas_para_retomar`. Três round-trips a mais numa tela que a recepção abre cinquenta vezes por dia é como ela trava no celular.

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Medir** — `EXPLAIN ANALYZE` da consulta de Hoje com **50 mil tarefas** semeadas, das quais 200 em recontato. Os dois índices parciais têm de aparecer. Se vier sequential scan, conserte agora: a clínica que vai doer é a que tem três anos de dado, e ela entra na migração do épico 9.

- [ ] **Passo 6: Commit**

---

## Task 9: `GET /v1/jornada` — o funil, contado pelo histórico

**Files:** `apps/api/src/jornada/funil.service.ts` · `funil.controller.ts` · `funil.test.ts`

```
GET /v1/jornada?periodo=&de=&ate=&responsavelId=&unidadeId=     @Exige('jornada')
```

Devolve três coisas, todas calculadas no servidor:

1. **O funil** — `agendados`, `confirmados`, `realizados`, `orcamentosEnviados`, `fechados`, cada um com contagem, valor e a conversão sobre a etapa anterior.
2. **Os três KPIs** — no-show (quantidade **e taxa**), desmarcados, orçamentos perdidos (com o valor).
3. **Onde estão agora** — as sete colunas do kanban.

**A diferença entre 1 e 3, e ela é a pergunta que a tela responde:** o funil conta **movimentos do período**; as colunas mostram **a situação de hoje**. Um cartão agendado em setembro e realizado em outubro conta em "agendados" de setembro e em "realizados" de outubro, e hoje está na coluna "Realizadas sem orçamento". São duas perguntas diferentes, e colapsá-las numa é como o número do funil deixa de bater com o tamanho da coluna e ninguém sabe qual está certo.

**A regra que faz o funil honesto:** conta-se evento cujo `acao` está em `ACOES_DO_FUNIL` (Task 1) e cujo `em` cai na janela `[início, fim)`, com as bordas no fuso da clínica. `reagendar`, `enviarConfirmacao`, `followUp`, `encerrar` e `reabrir` **não contam**.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('REAGENDAR NÃO CONTA COMO AGENDAMENTO NOVO', async () => {
  const antes = (await funil()).agendados.n
  await mover(CARD, { acao: 'noshow' })
  await mover(CARD, { acao: 'reagendar', prazo: amanha() })
  await mover(CARD, { acao: 'reagendar', prazo: mais(7) })
  expect((await funil()).agendados.n).toBe(antes)
  // Se contasse, quem remarcou três vezes apareceria como três agendamentos,
  // e TODA conversão do funil cairia sem nada ter piorado na clínica.
})

it('enviar confirmação não conta como confirmação', async () => {
  const antes = (await funil()).confirmados.n
  await mover(CARD, { acao: 'enviarConfirmacao' })
  expect((await funil()).confirmados.n).toBe(antes)
})

it('follow-up não conta como orçamento novo', async () => { /* … */ })

it('a janela é semiaberta, com as bordas no fuso DA CLÍNICA', async () => {
  await moverEm(A, 'confirmar', '2026-10-24T23:59:59.999-03:00')
  await moverEm(B, 'confirmar', '2026-10-25T00:00:00.000-03:00')
  expect((await funil({ de: '2026-10-24', ate: '2026-10-24' })).confirmados.n).toBe(1)
})

it('a taxa de no-show é faltou ÷ (realizado + faltou)', async () => {
  // NÃO sobre agendados: um agendamento que ainda vai acontecer não deveria
  // piorar a taxa de hoje. É a conta do protótipo, e é a certa.
  expect((await funil()).noShow).toMatchObject({ n: 2, taxa: 0.22 })
})

it('o valor dos perdidos é o ORÇADO, e nunca entra em receita', async () => {
  const f = await funil()
  expect(f.perdidos.valor).toBe('450000')
  expect(await receitaDoPeriodo()).not.toBe(450000n)
})

it('"fechados" conta o valor FECHADO, não o recebido', async () => {
  // Entrada de R$ 1.000 num orçamento de R$ 3.600: fechados = 360000.
  // O recebido é da tela Recebimentos, e as duas medem coisas diferentes.
})

it('as colunas mostram HOJE; o funil, o período', async () => {
  const f = await funil({ de: ontem(), ate: ontem() })
  expect(f.agendados.n).toBe(0)                      // nada no período
  expect(f.colunas.agendadas.length).toBeGreaterThan(0)  // mas há cartões hoje
})

it('a coluna Recontatar junta faltou e desmarcou, e exclui o encerrado', async () => {
  await mover(A, { acao: 'noshow' }); await mover(B, { acao: 'desmarcar' })
  await mover(C, { acao: 'desmarcar' }); await mover(C, { acao: 'encerrar' })
  expect((await funil()).colunas.recontatar.map((x) => x.id).sort()).toEqual([A, B].sort())
})

it('sem `valores`: as CONTAGENS ficam, os valores vêm null', async () => {
  const f = await funil(cookieDe(SEM_VALORES))
  expect(f.agendados.n).toBeGreaterThan(0)
  expect(f.orcamentosEnviados.valor).toBeNull()
  expect(f.colunas.orcamentos[0].valorOrcamento).toBeNull()
  expect(JSON.stringify(f)).not.toContain('360000')
})

it('sem a permissão `jornada`, 403', async () => { /* … */ })
it('o funil não enxerga cartão de outra clínica', async () => { /* RLS */ })
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — os eventos saem do `jsonb` com `jsonb_array_elements`, filtrados por `acao` e por `em` dentro da janela, numa `LATERAL`. A lista de ações que contam vem de `ACOES_DO_FUNIL` (`@fir/domain`), **passada como parâmetro**, nunca escrita à mão no SQL: a lista existe uma vez.

```sql
SELECT ev->>'acao' AS acao, count(*) AS n, sum((ev->>'valor')::bigint) AS valor
  FROM tarefas t
  CROSS JOIN LATERAL jsonb_array_elements(t.historico) ev
 WHERE t.excluida_em IS NULL
   AND t.etapa IS NOT NULL
   AND ev->>'acao' = ANY($acoesDoFunil)
   AND (ev->>'em')::timestamptz >= $de
   AND (ev->>'em')::timestamptz <  $ate
 GROUP BY 1
```

`(ev->>'valor')::bigint` — e é por isso que a decisão D-4 (string de centavos) vale a pena: o cast é exato, sem `numeric` no meio e sem `float` em lugar nenhum.

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Prova por mutação** — acrescente `'reagendar'` a `ACOES_DO_FUNIL`. O primeiro teste tem de falhar. Restaure.

- [ ] **Passo 6: Medir** — `EXPLAIN ANALYZE` com 50 mil tarefas, 8 mil delas da jornada. O `LATERAL` sobre `jsonb` é o trecho mais caro deste épico; se não usar `tarefas_por_etapa`, conserte agora.

- [ ] **Passo 7: Commit**

---

## Task 10: O cartão da jornada — dois toques, dentro do próprio cartão

**Files:** `apps/web/src/components/cartao-de-tarefa.tsx` *(modificar)* · `apps/web/src/components/jornada/faixa-de-acoes.tsx` · `forma-de-etapa.tsx` · `evolucao.tsx` · *(modificar)* `apps/web/src/app/(app)/hoje/page.tsx`

**Leia `docs/design.md` antes, e rode a auditoria da seção 5 no fim.**

O cartão do épico 2 ganha três coisas, **dentro dele**, sem modal e sem outra tela:

1. **A etiqueta da etapa** e a linha de contexto (*"confirmação enviada em 23/10, aguardando resposta"* · *"recontatar para reagendar"* · *"retomar em 24/10 (atrasado)"*).
2. **A faixa de ações**, que vem da etapa — as mesmas da tabela da Task 1, com os rótulos da PO: `Enviar confirmação` · `Confirmou` · `No-show` · `Reagendar` · `Desmarcou` · `Encerrar` · `Registrar orçamento` · `Fechou` · `Registrar follow-up` · `Perdeu`.
3. **`Evolução · N etapas`**, recolhida, com etapa, data, quem fez, observação e — com `valores` — o valor.

**A faixa de ações vem do servidor ou de `@fir/domain`, nunca de uma segunda tabela no front.** É literalmente a dívida que este projeto existe para não repetir: o legado tem a mesma regra escrita três vezes e elas já divergiram.

- [ ] **Passo 1: A faixa de ações** — `acoesDaEtapa(etapa, status, concluidaEm)`, derivada de `TRANSICOES`. O **único** acréscimo do front é o limite de 30 dias para orçar um atendimento (decisão D-6) — e ele fica comentado como afordância de tela, não como regra.

- [ ] **Passo 2: Os formulários por ação, inline** — cada ação abre o seu **no próprio cartão**, com os campos exatos do protótipo:
  - `reagendar`: nova data (padrão: hoje) e horário opcional.
  - `noshow`: nenhum campo, só a dica *"Depois, use Reagendar"*.
  - `desmarcar` / `encerrar`: motivo livre, **opcional**, 160 caracteres.
  - `registrarOrcamento`: valor, "retomar contato em" (padrão hoje+2), "o que foi orçado", e a caixa **"É um programa: montar agora"** com o montador.
  - `followUp`: "como foi o contato" (obrigatório na tela) e "próximo contato em" (padrão hoje+3).
  - `perder`: **motivo em lista suspensa** — vinda de `GET /v1/motivos-de-perda`, nunca de uma constante no front — e observação opcional.
  - `fechar`: **não** abre formulário; leva para Recebimento já preenchido com o valor do orçamento, como no protótipo.

  O padrão de data (`hoje+2`, `hoje+3`) é **mostrado** pela tela e **decidido** pelo servidor. Se o front mandar a data, a regra 24 está quebrada por conveniência.

- [ ] **Passo 3: Evolução** — `<details>` recolhida. O valor só aparece quando vem preenchido; **nenhum `if` de permissão** — o servidor já devolveu `null`.

- [ ] **Passo 4: As três seções novas da tela Hoje**, na ordem do protótipo: **Recontatar** (depois do financeiro, com a nota *"Pacientes que faltaram ou desmarcaram. Ficam aqui até reagendar ou encerrar."*) e **Próximos passos da jornada** (só quando o dia navegado é hoje, com os dois subtítulos). Os dados vêm prontos de `GET /v1/hoje`; **nenhuma contagem no front**.

- [ ] **Passo 5: A mensagem de confirmação** — `wa.me` com o texto pronto e editável, do modelo da clínica. Abrir o WhatsApp é do front; **registrar o envio é a ação `enviarConfirmacao`**, e o disparo automático é o épico 10.

- [ ] **Passo 6: Auditoria de `design.md` §5**, item a item. Inclusive: abrir em **390 px**, confirmar que a faixa de ações **quebra em linha** em vez de rolar, e **contar os toques** de `abrir Hoje → marcar no-show` (alvo: **2**) e de `abrir Hoje → reagendar quem faltou` (alvo: **4**, contando a escolha da data).

- [ ] **Passo 7: Commit**

---

## Task 11: A tela Jornada do paciente

**Files:** `apps/web/src/app/(app)/jornada/page.tsx` · `apps/web/src/components/jornada/funil.tsx` · `kanban.tsx` · *(modificar)* `apps/web/src/lib/menu.ts`

**Comercial › Jornada do paciente.** Filtros de período, pessoa e unidade. Tudo vem pronto de `GET /v1/jornada`.

- [ ] **Passo 1: O funil** — cinco passos, cada um com contagem, barra proporcional a `agendados`, a conversão sobre a etapa anterior e — com `valores` — o valor, com o rótulo certo em cada um (*recebido* · *orçado* · *fechado*). Algarismos tabulares em tudo.

- [ ] **Passo 2: Os três KPIs** — no-show (quantidade, taxa e a explicação *"das consultas e procedimentos que deveriam acontecer"*), desmarcados, orçamentos perdidos (com o valor e *"veja os motivos no histórico"* — que agora **tem** motivos, graças à Task 6).

- [ ] **Passo 3: "Onde estão os pacientes agora"** — as sete colunas. A nota da PO explica a diferença entre elas e o funil, e ela é obrigatória: *"Agendadas, confirmadas, no-show e orçamentos em aberto mostram a situação de hoje; realizadas, fechados e perdidos mostram o período escolhido."*

  **O kanban é o único lugar deste épico onde `docs/design.md` aperta de verdade.** Sete colunas não cabem em 390 px, e o protótipo rola horizontalmente — medido na tela: a coluna "Orçamentos em aberto" fica cortada na borda. A regra não é "não role": é **a página nunca rola na horizontal**. Então o kanban rola **dentro do próprio contêiner** (`overflow-x: auto`), com indicação visível de que há mais à direita. Em 390 px, considere a alternativa de **lista agrupada por etapa** no lugar do kanban — `/prototype`, três direções, o humano escolhe. **Não entregue um kanban de sete colunas em 390 px sem essa rodada.**

- [ ] **Passo 4: `menu.ts`** — troque `epico` por `'jornada'` em `/jornada`. **`menu-vs-telas.test.ts` vai cobrar** — ele confronta o menu com as páginas no disco.

- [ ] **Passo 5: Estados** — carregando (sem deslocar conteúdo), erro (com "Ir para Hoje" e "Recarregar"), e o **vazio**, que é a primeira tela que toda clínica nova vê: *"Nenhum agendamento no período. A jornada começa quando você cria uma tarefa de Consulta agendada."*, com o atalho.

- [ ] **Passo 6: Auditoria de `design.md` §5** — e, neste caso, com atenção dobrada aos dois temas: as sete etiquetas de etapa usam quatro cores de estado, e `--gold` **não é texto** (2,21:1 no tema claro — reprova).

- [ ] **Passo 7: Commit**

---

## Task 12: Fechamento

- [ ] `docs/paridade.md`: `moverEtapa` → ✅, com a nota *"virou `POST /v1/tarefas/:id/jornada`, uma rota com união discriminada por ação; motivo de perda obrigatório; fechamento numa transação; ver ADR 0004"*.
- [ ] `docs/adr/0004-maquina-de-estados-da-jornada.md` — contexto (a jornada só existe no protótipo; o `Code.gs` não tem nenhuma coluna dela), decisão (máquina de estados fechada em `packages/domain`, amarrada por `CHECK` no banco), consequências, e **as sete divergências** da tabela acima, cada uma com o seu porquê. Alternativas rejeitadas: uma tarefa por etapa (e por que o funil quebraria), `etapa` como campo livre editável, motivo de perda como `ENUM`.
- [ ] `CONTEXT.md`: acrescentar **`proximo_passo_em`** ao glossário rápido, com a definição de D-3; acrescentar **`Motivo de perda`** como entidade, com as invariantes de D-1 e D-2; atualizar o verbete `Jornada` com os nove estados e `encerrado`.
- [ ] `docs/arquitetura/sistema.md`: acrescentar **`MontadorDePrograma`** à lista de seams declarados. Mantenha a lista curta.
- [ ] `teste/registro.ts`: `motivos_de_perda` em `ENTIDADES_COM_CLINICA`; as rotas da jornada em `ROTAS_COM_DINHEIRO`, com `valorOrcamento`, `historico[].valor` e `programaOrcado[].valor`.
- [ ] `docs/dividas.md`: (a) a **gestão de motivos de perda** em Configurações ficou de fora — a clínica usa os cinco semeados até lá; (b) `fechar` com programa está em 409 até o épico 5 trocar o `MontadorDePrograma`; (c) **campanha** no cartão da jornada continua do épico 8.
- [ ] `npx turbo run typecheck test --force`, **três vezes** — determinismo não se afirma, se observa.
- [ ] Commit

---

## Auto-revisão

**Cobre de `paridade.md`:** `moverEtapa`. **1 das 59** — dez ações, treze transições, três seções da tela Hoje e a tela Jornada.

**Regras do `CLAUDE.md` exercitadas:** 1 e 4 (Tasks 2, 5, 7, 9 — orçamento não é receita, em quatro lugares) · 3 (Task 7, pelo índice do épico 2, sem reimplementar) · 5 (Task 7, saldo derivado) · 16 e 17 (Tasks 4–9; a Task 5 **prova** a redação em profundidade e a derruba por mutação) · 18 e 21 (Task 4, a `nota` que nunca vai para log) · 19 e 20 (Task 2) · 22, 23 e 24 (Tasks 4, 8, 9).

**O invariante, e onde ele está escrito três vezes de propósito:** `faltou`/`desmarcou` mantêm o cartão **aberto**. Está na tabela de transições (Task 1), no `CHECK etapa_combina_com_status` (Task 2) e no teste da tela Hoje que exige o cartão em `recontatar` e fora de `pendentes` (Task 8). Três camadas, porque é o invariante do qual o funil, o painel do épico 8 e o ritual inteiro dependem — e porque é o único que, quebrado, **não produz erro nenhum**: produz silêncio, e ninguém liga para quem faltou.

**Fora de escopo, de propósito:**

- **O envio da confirmação por WhatsApp.** Aqui só a etapa e o registro (`confirmacao_enviada_em`). O disparo, o modelo por clínica e a resposta automática são o **épico 10**.
- **A montagem do `Programa` no fechamento.** O `programa_orcado` é gravado inteiro e o `MontadorDePrograma` está declarado; a implementação é o **épico 5**. Ver a pergunta para o dono.
- **A tela de gestão dos motivos de perda.** Os cinco semeados bastam para o épico. `Configurações › Motivos de perda` fica em `docs/dividas.md`.
- **Campanha** no cartão e a sugestão *"Sugerida porque a paciente está nessa campanha"* — **épico 8**, por migration de expand.
- **Os indicadores `agendamentos` e `confirmacoes` da meta da pessoa** — eles contam eventos `agendar` e `confirmar` do `historico`, que este épico passa a escrever, mas a meta é do **épico 7**. Este plano entrega a fonte; quem conta é lá.
- **O recebimento avulso** e a tela Recebimentos — **épico 4**. A Task 7 usa o serviço de recebimento embutido do épico 2.

**O risco que fica:** o funil percorre `jsonb` com `LATERAL`, e é o trecho mais caro do épico — ele cresce com o **histórico inteiro** da clínica, não com o período filtrado, porque o filtro de data está dentro do array e não na linha. O índice GIN e o `tarefas_por_etapa` reduzem o conjunto, e o Passo 6 da Task 9 mede isso **agora**, com 50 mil tarefas. Se não bastar, a saída é uma tabela de eventos materializada — e **essa decisão é melhor tomada aqui, com o número na mão, do que no épico 8**, quando o painel passar a ler os mesmos eventos por mais quatro recortes.
