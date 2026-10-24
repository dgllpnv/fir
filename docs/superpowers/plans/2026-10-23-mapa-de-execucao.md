# Firmare Rotinas de Gestão — Mapa de execução

> **Este documento não é um plano de tarefas.** É o mapa que ordena os nove planos, fixa a estrutura de arquivos do monorepo inteiro e declara as restrições globais que **todo** plano herda. Leia antes de qualquer plano.

**Objetivo final:** substituir a v20 (Apps Script + Google Sheets, 4 clínicas em produção) por um sistema na stack TypeScript, com **paridade funcional total** com `prototipo-rotinas-de-gestao.html`, migrando as 4 clínicas sem alterar um total.

---

## 1. Restrições globais

Todo plano herda esta seção. Valores exatos, copiados do `CLAUDE.md` e das decisões em `docs/decisoes.md`.

### Versões

| | |
|---|---|
| Node | `>=22` |
| pnpm | `11.25.0` (campo `packageManager`, fonte única) |
| TypeScript | `^5.7`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Turborepo | `^2` |
| PostgreSQL | `17-alpine` |
| Redis | `7-alpine` |

### Representação numérica — a decisão que atravessa tudo

**Dinheiro: inteiro de centavos.** `BIGINT` no Postgres, `bigint` em TS, dentro do value object `Dinheiro`. Nunca `number`, nunca `NUMERIC`, nunca `toFixed`.

**Quantidade de estoque: inteiro de milésimos da `medida` do item.** `BIGINT`, dentro do value object `Quantidade`.

> Por que milésimos: o legado faz `Math.round(x * 1000) / 1000` em toda quantidade, e as doses reais são fracionárias — 0,25 ampola, 0,5 frasco. Milésimos reproduzem **exatamente** a precisão do legado sem ponto flutuante. 1 ampola = `1000`. 0,25 ampola = `250`.

### Tempo

- `TIMESTAMPTZ` em UTC no banco. Containers com `TZ=UTC` e `PGTZ=UTC`.
- **Fuso é propriedade da `Clinica`** (`clinicas.fuso`, padrão `America/Bahia`). Não existe fuso global.
- Toda janela de período é **semiaberta `[início, fim)`**, com as bordas calculadas no fuso da clínica antes da comparação.
- Data de negócio vem do servidor. O relógio é dependência injetada (`Relogio`), nunca `new Date()` dentro de regra.

### Portas — bloco 48xx, tudo em `127.0.0.1`

| Serviço | Local | No container |
|---|---|---|
| Postgres | **4832** | 5432 |
| Redis | **4879** | 6379 |
| API | **4811** | 4811 |
| Web | **4810** | 4810 |
| Mailpit (tela) | **4825** | 8025 |
| Mailpit (SMTP) | **4826** | 1025 |

47xx é do Mavia, que roda na mesma máquina. 80, 8080, 5432 e 6379 estão fora por decisão do dono.

### Nomes

Domínio em **português** (`Tarefa`, `Jornada`, `Programa`, `Contagem`, `Recebimento`, `Movimento`), infraestrutura em **inglês** (`Repository`, `Handler`, `Module`). Nome no código = nome no `CONTEXT.md` = nome na tela.

### Regras que reprovam código em qualquer plano

1. Ponto flutuante em dinheiro ou quantidade.
2. `Math.round(x*100)/100`, `Math.round(x*1000)/1000`, `toFixed`, `parseFloat` perto de valor.
3. Tabela de negócio sem `clinica_id NOT NULL` com policy de RLS.
4. Rota sem autorização explícita no servidor.
5. Redação de valores por endpoint em vez do interceptor único.
6. Quantidade esperada de contagem ou de caixa atravessando para o cliente antes do fechamento.
7. `UPDATE` ou `DELETE` em `movimentos_estoque` ou em `auditoria`.
8. Cálculo de saldo, total ou percentual no front.
9. `any`. Use `unknown` e estreite.

---

## 2. Estrutura de arquivos do monorepo

Fixada aqui para que nenhum plano tenha de decidir onde algo mora.

```
fir/
├─ CLAUDE.md  CONTEXT.md  README.md
├─ fir.bat                          ambiente local (plano 1)
├─ package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json  eslint.config.js
├─ .github/workflows/ci.yml
│
├─ infra/
│   ├─ docker-compose.yml           postgres · redis · mailpit, portas 48xx em 127.0.0.1
│   ├─ bootstrap-papeis.sql         papéis do banco local
│   ├─ README.md
│   └─ producao/                    plano 9
│       ├─ docker-compose.yml  implantar.sh  10-papeis.sh  redis.conf.modelo  README.md
│
├─ packages/
│   ├─ domain/src/                  REGRAS PURAS — zero I/O, zero framework
│   │   ├─ resultado.ts             Result<T, ErroDeDominio>
│   │   ├─ dinheiro.ts              centavos
│   │   ├─ quantidade.ts            milésimos da medida
│   │   ├─ relogio.ts               Relogio, fuso da clínica, janela [início, fim)
│   │   ├─ permissoes.ts            PERMS, PERFIS_PADRAO, temPerm, campos redigidos
│   │   ├─ tipos-de-tarefa.ts       a tabela TIPOS com as flags
│   │   ├─ situacao.ts              situacao(t)
│   │   ├─ recorrencia.ts           gerarDatas, addMeses (dia 31 → último dia)
│   │   ├─ jornada.ts               etapas, transições permitidas, etapaDe
│   │   ├─ saldo.ts                 saldoInfo: aberto − abatido, por programa
│   │   ├─ programa/
│   │   │   ├─ montagem.ts          itens, depoisDe, datas das sessões
│   │   │   ├─ reprogramacao.ts     desloca item e dependentes
│   │   │   └─ retorno.ts           retornoDe
│   │   ├─ estoque/
│   │   │   ├─ conversao.ts         unidCompra ↔ medida ↔ unidUso
│   │   │   ├─ saldo.ts             última contagem + movimentos
│   │   │   ├─ analise.ts           inicial + entradas − saídas = esperado; diferença
│   │   │   ├─ lote.ts              FIFO por validade, sobra de frasco
│   │   │   ├─ consumo.ts           o que uma sessão/procedimento baixa
│   │   │   ├─ abc.ts               curva ABC
│   │   │   └─ codigos.ts           GS1 DataMatrix, EAN, QR próprio
│   │   ├─ financeiro/
│   │   │   ├─ caixa.ts             esperado por forma, diferença
│   │   │   ├─ contas.ts            recorrência mensal no pagamento
│   │   │   └─ visao-do-mes.ts      recebido, pagas, resultado, categorias
│   │   ├─ campanha.ts              as 4 métricas
│   │   └─ metas.ts                 realizadoMeta: 8 indicadores automáticos
│   │
│   ├─ contracts/src/               Zod → tipos + OpenAPI
│   │   ├─ comum.ts  autenticacao.ts  tarefas.ts  jornada.ts  pacientes.ts
│   │   ├─ programas.ts  estoque.ts  financeiro.ts  pessoas.ts  campanhas.ts  painel.ts
│   │
│   └─ ui/src/                      tokens "papel e dourado" + primitivos
│
├─ apps/
│   ├─ api/
│   │   ├─ Dockerfile  construir.mjs  migrar.ts  semear.ts
│   │   ├─ migrations/              0001_… forward-only
│   │   └─ src/
│   │       ├─ main.ts  app.module.ts
│   │       ├─ comum/
│   │       │   ├─ redacao.interceptor.ts    ← O TRADUTOR ÚNICO de valores
│   │       │   ├─ clinica.middleware.ts     ← fixa app.clinica_id na sessão do Postgres
│   │       │   ├─ relogio.provider.ts
│   │       │   └─ auditoria.service.ts
│   │       ├─ autenticacao/  autorizacao/
│   │       ├─ clinicas/  pessoas/  perfis/
│   │       ├─ tarefas/  jornada/  pacientes/  unidades/  campanhas/
│   │       ├─ procedimentos/  programas/
│   │       ├─ estoque/  financeiro/  equipe/  painel/
│   │
│   ├─ web/                         Next.js App Router
│   │   └─ src/app/(app)/hoje  tarefas  nova  jornada  pacientes  programas
│   │                       recebimentos  caixa  contas  cobrancas  visao-do-mes
│   │                       estoque  equipe  painel  configuracoes  ajuda  manual
│   │
│   └─ migrador/                    plano 9 — CLI de migração do Sheets
│
├─ docs/superpowers/plans/          estes planos
└─ versoes/  prototipo-…html        REFERÊNCIA. Nunca entra em build.
```

---

## 3. Os nove planos

Cada plano termina em software que roda e se testa sozinho. Nenhum começa antes de o anterior estar verde na `main`.

| # | Plano | Entrega verificável |
|---|---|---|
| **1** | **Fundação** | `fir` sobe o ambiente. Você entra com e-mail e senha, vê a tela Hoje vazia, e não enxerga dado de outra clínica. `pnpm typecheck && pnpm test` verde no CI. |
| **2** | **Tarefas e pacientes** | Criar, editar, concluir, cancelar e excluir tarefa; recorrência; tela Hoje completa (semana, pendentes, filtros, aniversariantes); Tarefas; Pacientes com importação; Unidades. |
| **3** | **Jornada** | Agendamento anda pelas 8 etapas com histórico; confirmação por WhatsApp; Recontatar; orçamento com programa montado; fechamento; perda com motivo; funil do período. |
| **4** | **Financeiro** | Recebimentos; saldo em aberto por programa; caixa do dia às cegas; contas a pagar com recorrência; cobranças; Visão do mês com meta e categorias. |
| **5** | **Programas** | Catálogo de procedimentos com insumos; programa montado por itens com `depoisDe`; sessões; reprogramação em cascata; contato de retorno. |
| **6** | **Estoque** | Itens com as três unidades; locais; os 6 tipos de movimento; contagem às cegas com recorrência; análise do período; curva ABC; QR, GS1 e EAN; entrada por XML de NF-e; **baixa automática pela sessão, reversível**. |
| **7** | **Pessoas** | Fichas, férias, documentos com validade, metas com os 8 indicadores automáticos, conversas 1:1, banco de horas, alertas; Minhas metas. |
| **8** | **Campanhas, Painel e Ajuda** | Campanhas com as 4 métricas e importação de lista; Painel geral; Ajuda e Manual com busca. |
| **9** | **Migração e produção** | Migrador do Sheets com relatório de conferência; `infra/producao` no padrão do Mavia; deploy na VPS verificado; corte de uma clínica. |

**Entre o plano 8 e o 9 está o marco de paridade.** Os critérios de aceite de `DESENVOLVEDOR-gestao-de-rotina.md` §13 passam a ser a definição de pronto.

---

## 4. Como cada plano é escrito

Um plano é escrito **quando o anterior está verde**, não antes. A razão é concreta: o plano 4 precisa dos nomes e assinaturas reais que o plano 2 produziu, e um plano escrito hoje contra assinaturas imaginadas manda o implementador procurar funções que não existem com o nome que ele leu.

O que cada plano carrega:

1. O cabeçalho obrigatório da skill, com objetivo, arquitetura e stack.
2. A seção **Restrições globais** apontando para este documento.
3. A **estrutura de arquivos** daquele plano, extraída da seção 2 acima.
4. Tarefas de 2 a 5 minutos por passo, no ciclo TDD: escrever o teste que falha → rodar e ver falhar → implementação mínima → rodar e ver passar → commit.
5. Em cada tarefa, o bloco **Interfaces** — o que ela consome das anteriores e o que ela produz para as seguintes, com assinaturas exatas.

---

## 5. Seams de teste (fixados aqui, válidos para todos os planos)

Teste mora **só** nestes seis lugares. Seam novo exige decisão do `arquiteto-solucao`.

| # | Seam | Ferramenta | O que observa |
|---|---|---|---|
| 1 | `packages/domain` puro | Vitest + fast-check | Dinheiro, Quantidade, conversão, saldo, análise, jornada, recorrência, permissões, metas |
| 2 | HTTP da API | Vitest + supertest | Contrato, permissão aplicada, valores redigidos, códigos de erro |
| 3 | Repositório sobre Postgres real | Vitest + Testcontainers | RLS, idempotência, transação, append-only |
| 4 | `AgendaProvider` | Vitest | Conciliação propõe, não sobrescreve (plano futuro) |
| 5 | `LeitorDeNota` | Vitest | XML de NF-e, idempotência pela chave de acesso |
| 6 | Fluxo do balcão | Playwright | Os 7 critérios de aceite de paridade |

**Property-based é obrigatório** em todo cálculo de dinheiro e de quantidade.

---

## 6. Os testes que atravessam todos os planos

Escritos no plano 1 como utilitários, e **cada plano novo os estende**:

**`teste/transporte-as-cegas.ts`** — varre o contrato e falha se qualquer resposta expuser quantidade esperada de contagem aberta ou esperado de caixa não fechado.

**`teste/redacao-de-valores.ts`** — varre o contrato e falha se **qualquer rota nova** devolver campo monetário sem um teste correspondente com usuário sem `valores`. Uma lista mantida à mão fica desatualizada no endpoint número quarenta; esta varre.

**`teste/isolamento-de-clinica.ts`** — para cada entidade registrada, tenta ler da clínica B autenticado na clínica A e exige vazio, **pelo banco**.

**`teste/receita-nao-dobra.ts`** — o cenário do pagamento embutido mais o recebimento avulso, mesmo valor, mesmo dia, mesmo paciente.

---

## 7. O que o plano 1 entrega, em detalhe

Porque é o próximo a executar e é o que você vai rodar:

```
fir                        → sobe Postgres, Redis e Mailpit; aplica migrations;
                             semeia a clínica de demonstração; sobe API e web
http://127.0.0.1:4810      → tela de entrada
                             demo@firmare.local / firmare-demonstracao
http://127.0.0.1:4825      → Mailpit, a caixa de entrada local
fir down · fir reset · fir status · fir logs · fir psql
```

Depois de `fir`, estes comandos precisam passar com a saída colada:

```bash
pnpm typecheck
pnpm test
pnpm test:domain
```

O plano detalhado está em `2026-10-23-plano-1-fundacao.md`.
