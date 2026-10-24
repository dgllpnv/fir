# Épico 2 — Núcleo da rotina · plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`. Passos com `- [ ]`.

**Objetivo:** a rotina de tarefas da v20, inteira, rodando sobre Postgres. `Tarefa`, `Paciente`, recorrência, e as quatro telas que a recepção abre o dia inteiro: **Hoje**, **Tarefas**, **Nova tarefa**, **Pacientes**.

**Arquitetura:** a `Tarefa` é a entidade mais usada do produto e **não tem nenhuma coluna de dinheiro**. O dinheiro mora em `recebimentos`, com um índice único que torna impossível contar o mesmo pagamento duas vezes. O `prazo` é um **dia civil** (`date`), não um instante; o único instante é `concluida_em`. A recorrência é materializada (N linhas com `serie_id`), como na v20.

**Stack:** PostgreSQL + migration `0006`, NestJS + Fastify, Next.js (App Router), Vitest contra Postgres real, fast-check no domínio.

**Depende de:** a trilha de auditoria (migration `0004`, trigger `registrar_auditoria`) e o plano de administração da clínica (migration `0005`, tabela `unidades`). As duas precisam estar aplicadas antes do Passo 1 da Task 3.

**Cobre de `docs/paridade.md`:** `criarTarefa` · `editarTarefa` · `atualizarTarefa` · `excluirTarefa` · `salvarPaciente` · `excluirPaciente` · `importarPacientes`. **7 das 59.** `salvarUnidade` sai no plano de admin-da-clínica e **não se repete aqui** — a Task 3 só fecha o buraco que aquele plano deixou (ver o Passo 4 dela).

---

## Global Constraints

Valem para **todas** as tarefas. Copiadas do `CLAUDE.md`, do `CONTEXT.md` e de `docs/design.md`.

- **Regra 1:** nenhum `float` perto de dinheiro. `bigint` de centavos no banco, `Dinheiro` no domínio, string de centavos no transporte (`dinheiroEmTexto`, `packages/contracts/src/comum.ts`). Nada de `toFixed`, `parseFloat` ou `* 100`.
- **Regra 3:** **cada pagamento conta uma vez.** O pagamento embutido no atendimento e o recebimento avulso são a **mesma linha de `recebimentos`**, nunca duas. O banco garante: `UNIQUE (tarefa_id) WHERE tarefa_id IS NOT NULL AND estornado_em IS NULL`.
- **Regra 4:** orçamento não é receita. `valor_orcamento` **não existe** nesta migration — ele nasce no épico 3, junto com `moverEtapa`.
- **Regra 16:** `temPerm` é uma função só, e **o servidor sempre valida**. `@Exige('pacientes')`, `@Exige('pacientes.gerir')`, `@Exige('tarefas.equipe')`.
- **Regra 17:** a redação de valores é o `RedacaoInterceptor`, num ponto único. **Nenhuma rota deste plano reimplementa um `if` sobre dinheiro.** Toda rota que puder devolver dinheiro entra em `ROTAS_COM_DINHEIRO` (`teste/registro.ts`).
- **Regra 19:** RLS `ENABLE` + `FORCE` + policy em toda tabela nova, `clinica_id NOT NULL`. As três entram em `ENTIDADES_COM_CLINICA`.
- **Regra 20:** soft delete e trilha append-only. **O trigger `registrar_auditoria` faz o registro sozinho** — o plano não manda ninguém chamar `registrar()` à mão, e quem o fizer está duplicando a trilha.
- **Regra 18/21:** nome de paciente, telefone e valor **nunca** em log. `GET /v1/pacientes/:id` carrega `@DadoSensivel('paciente')`.
- **Regra 22/23/24:** `timestamptz` em UTC; toda janela é `[início, fim)` com as bordas calculadas no fuso da clínica; **a data de negócio vem do servidor**, nunca do relógio do cliente.
- **Regra 25:** recorrência mensal em 29, 30 e 31 cai no último dia do mês curto. `somarMeses` já resolve — **confira antes de escrever qualquer coisa nova** (`packages/domain/src/relogio.ts`).
- **Regra 26:** `importarPacientes` é idempotente. Reimportar o mesmo arquivo três vezes não cria nada novo, e é assim que se testa.
- **Regra 27:** conciliação sugere, nunca sobrescreve — e **nunca recria o que o usuário apagou**. A importação não ressuscita paciente desativado.
- **Telas:** `docs/design.md` é a régua. 390 px é o caso principal, sem rolagem horizontal. Estados de carregando, erro e vazio são parte do ticket, não acabamento. Algarismos tabulares em toda coluna de valor, quantidade, data ou percentual.
- TypeScript estrito; imports **sem** extensão (ADR 0001); `@Inject(Tipo)` explícito no Nest.
- Nenhuma migration já aplicada se edita. Esta é a **`0006`**.
- Antes de qualquer "pronto": `npx turbo run typecheck test --force`. O `pnpm test` responde do cache sem rodar nada.

---

## As três divergências entre o protótipo e o `Code.gs`, e quem ganha

O protótipo é a especificação; o `Code.gs` é a verdade operacional das 4 clínicas. Onde discordam, **o `Code.gs` ganha** — e cada caso vira uma linha aqui, nunca um ajuste silencioso.

| Ponto | Protótipo (`demoApiBase`) | `Code.gs` v20 | Segue |
|---|---|---|---|
| `unidadeId` ao criar tarefa | `t.unidadeId \|\| ""` — sem fallback | `unidadeValida(t.unidadeId) \|\| p.unidadeId \|\| ''` — cai na **unidade principal do paciente** | **`Code.gs`.** O dado das 4 clínicas tem `unidadeId` preenchido por esse caminho. Com o protótipo, toda tarefa migrada sem unidade explícita sairia do filtro por unidade |
| Responsável | não confere | exige `u.ativo` | **`Code.gs`.** Tarefa atribuída a quem saiu da clínica não aparece para ninguém |
| `atualizarTarefa` · `status` | `t.status = b.status`, **sem lista branca** | valida `['aberta','concluida','cancelada']` | **`Code.gs`.** É defeito do protótipo — a tela dele nunca manda outro valor, então ninguém viu. Aqui o `ENUM` do Postgres fecha a porta |
| `descricao` | sem limite no servidor (o `textarea` tem `maxlength=400`) | `.slice(0, 400)` | **`Code.gs`.** 400, no `CHECK` |
| `hora` | aceita qualquer string | `/^\d{2}:\d{2}$/` | **`Code.gs`.** Coluna `time` |
| Trocar o paciente na edição | mantém `adesaoId` | limpa `adesaoId` e `sessao` | **`Code.gs`.** Sessão de programa pendurada no paciente errado é dose no frasco errado |
| `excluirPaciente` · permissão | `pacientes.gerir` | `me.admin` | **Protótipo.** A v20 não tem matriz de permissão; não é discordância, é modelo novo |
| `excluirPaciente` · efeito | `DELETE` do paciente, das tarefas e das adesões | o mesmo `DELETE` | **Nenhum dos dois.** A regra 20 vence os dois: soft delete, e as tarefas ficam. Vira ADR (Task 6) |

**Uma observação do `Code.gs` que sustenta o desenho inteiro deste plano:** a constante `PAGAMENTO_DE` (`Code.gs:64`) existe com o comentário *"valores lançados antes da v16 em atendimentos viram um pagamento separado"*. A própria v20 já concluiu que o valor embutido no atendimento **é** um pagamento separado. Este plano só torna isso explícito no modelo, em vez de deixá-lo numa tabela de conversão.

---

## Estrutura de arquivos

| Caminho | Responsabilidade |
|---|---|
| `packages/domain/src/tarefa.ts` | Concluir × Editar, as quatro autorizações, o instante da conclusão retroativa |
| `packages/domain/src/recorrencia.ts` | `gerarSerie` — as seis frequências, sobre `somarDias`/`somarMeses` |
| `apps/api/migrations/0006_rotina.sql` | `normalizar_nome`, `pacientes`, `tarefas`, `recebimentos`, RLS, triggers |
| `packages/contracts/src/pacientes.ts` · `tarefas.ts` | Zod → tipos + OpenAPI |
| `apps/api/src/pacientes/` | Rotas, serviço, importação |
| `apps/api/src/tarefas/` | Rotas, serviço, consulta |
| `apps/api/src/hoje/` | A composição da tela Hoje |
| `apps/web/src/app/(app)/hoje/page.tsx` | Tela Hoje — substitui o esqueleto |
| `apps/web/src/app/(app)/tarefas/page.tsx` · `nova/page.tsx` · `pacientes/page.tsx` | As outras três telas |
| `apps/web/src/components/cartao-de-tarefa.tsx` | O cartão, usado por Hoje e por Tarefas |
| `docs/adr/0003-paciente-desativado-nao-apaga-tarefa.md` | A divergência da Task 6 |

---

## Interfaces

As assinaturas exatas em que as tarefas dependem umas das outras. Quem implementa a Task 8 pode contar com estas, já prontas.

```ts
// packages/domain/src/tarefa.ts  (Task 1)
export type TarefaParaAutorizar = {
  readonly solicitanteId: string
  readonly responsavelId: string
  readonly status: 'aberta' | 'concluida' | 'cancelada'
}
export type Autor = { readonly id: string; readonly podeEquipe: boolean }

export function podeConcluir(t: TarefaParaAutorizar, a: Autor): Result<void>
export function podeCancelar(t: TarefaParaAutorizar, a: Autor): Result<void>
export function podeEditar(t: TarefaParaAutorizar, a: Autor): Result<void>
export function podeExcluir(t: TarefaParaAutorizar, a: Autor): Result<void>

export function instanteDaConclusao(
  dia: string, hojeDaClinica: string, fuso: string, agora: Date,
): Result<Date>

// packages/domain/src/recorrencia.ts  (Task 2)
export type Frequencia = 'diaria' | 'uteis' | 'semanal' | 'quinzenal' | 'mensal' | 'ndias'
export const MAX_SERIE = 150
export const ROTULO_FREQUENCIA: Readonly<Record<Frequencia, string>>
export function rotuloDaSerie(f: Frequencia, n?: number): string
export function gerarSerie(
  inicio: string, freq: Frequencia, ate: string, aCadaNDias?: number,
): Result<readonly string[]>
```

```sql
-- apps/api/migrations/0006_rotina.sql  (Task 3)
normalizar_nome(texto text) RETURNS text   -- IMMUTABLE, indexável
pacientes      (… nome_chave, telefone_chave GENERATED …)
tarefas        (… prazo date, hora time, concluida_em timestamptz, serie_id uuid …)
recebimentos   (… valor bigint, tarefa_id uuid UNIQUE parcial …)
```

---

## Task 1: Concluir × Editar, no domínio puro

**Files:** `packages/domain/src/tarefa.ts` · `tarefa.test.ts` · *(modificar)* `packages/domain/src/index.ts`

Antes de qualquer rota. **O MANUAL cap. 4 abre a seção "Concluir × Editar" com *"Essa é a dúvida mais comum"*** — e as duas têm autorizações diferentes, que o legado espalhou em quatro `if` distintos. Em tabela só isso já é defeito; em código espalhado, é defeito que ninguém encontra.

As quatro regras, lidas de `demoApiBase` e confirmadas no `Code.gs`:

| Ação | Quem pode |
|---|---|
| **Concluir** | qualquer um que enxerga a tarefa |
| **Cancelar** | quem **solicitou**, ou quem tem `tarefas.equipe` |
| **Editar** | quem solicitou, **o responsável**, ou quem tem `tarefas.equipe` |
| **Excluir** | quem solicitou, ou quem tem `tarefas.equipe` — **o responsável não** |

O responsável edita mas não exclui: ele conserta o que vai executar, e não apaga o que outra pessoa pediu. Confundir editar com excluir é como um pedido some sem ninguém saber.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// packages/domain/src/tarefa.test.ts
const ABERTA = { solicitanteId: 'ana', responsavelId: 'bia', status: 'aberta' } as const
const ana = { id: 'ana', podeEquipe: false }
const bia = { id: 'bia', podeEquipe: false }
const cao = { id: 'cao', podeEquipe: false }
const sup = { id: 'sup', podeEquipe: true }

it('qualquer um conclui — concluir é registrar que foi feito', () => {
  for (const a of [ana, bia, cao, sup]) expect(ehOk(podeConcluir(ABERTA, a))).toBe(true)
})

it('o responsável EDITA mas NÃO EXCLUI', () => {
  expect(ehOk(podeEditar(ABERTA, bia))).toBe(true)
  expect(podeExcluir(ABERTA, bia).erro.codigo).toBe('SO_QUEM_SOLICITOU')
})

it('quem não tem nada a ver com a tarefa não edita, não cancela, não exclui', () => {
  expect(podeEditar(ABERTA, cao).erro.codigo).toBe('SEM_ACESSO_A_TAREFA')
  expect(podeCancelar(ABERTA, cao).erro.codigo).toBe('SO_QUEM_SOLICITOU')
  expect(podeExcluir(ABERTA, cao).erro.codigo).toBe('SO_QUEM_SOLICITOU')
})

it('tarefas.equipe faz as quatro', () => {
  for (const f of [podeConcluir, podeCancelar, podeEditar, podeExcluir]) {
    expect(ehOk(f(ABERTA, sup))).toBe(true)
  }
})

it('tarefa cancelada não se conclui — e a mensagem diz o que fazer', () => {
  const r = podeConcluir({ ...ABERTA, status: 'cancelada' }, ana)
  expect(r.erro.codigo).toBe('TAREFA_CANCELADA')
})
```

E o instante da conclusão — a regra que o `Code.gs` chama de `dataConc`:

```ts
const FUSO = 'America/Bahia'

it('concluir HOJE carimba o instante de agora', () => {
  const agora = new Date('2026-10-24T13:05:00Z')
  const r = instanteDaConclusao('2026-10-24', '2026-10-24', FUSO, agora)
  expect(exigir(r)).toEqual(agora)
})

it('concluir RETROATIVO cai dentro do dia civil pedido, no fuso da clínica', () => {
  const r = instanteDaConclusao('2026-10-20', '2026-10-24', FUSO, new Date())
  expect(diaCivil(exigir(r), FUSO)).toBe('2026-10-20')
})

it('data de realização no FUTURO é recusada', () => {
  const r = instanteDaConclusao('2026-10-25', '2026-10-24', FUSO, new Date())
  expect(r.erro.codigo).toBe('DATA_NO_FUTURO')
})

it('o dia civil da clínica é a autoridade, não o UTC', () => {
  // 02:00 UTC de 25/10 ainda é 23:00 de 24/10 em America/Bahia. Concluir
  // "hoje" nesse instante não pode virar um registro do dia 25.
  const agora = new Date('2026-10-25T02:00:00Z')
  expect(diaCivil(agora, FUSO)).toBe('2026-10-24')
  const r = instanteDaConclusao('2026-10-24', diaCivil(agora, FUSO), FUSO, agora)
  expect(ehOk(r)).toBe(true)
})
```

- [ ] **Passo 2: Rodar e ver os nove falharem**

`cd packages/domain && npx vitest run tarefa`

- [ ] **Passo 3: Implementar**

```ts
// packages/domain/src/tarefa.ts
import { erro, erroDe, ok, type Result } from './resultado'
import { diaCivil, inicioDoDia } from './relogio'

const MEIO_DIA_MS = 12 * 60 * 60_000

/**
 * O instante em que uma conclusão retroativa é carimbada.
 *
 * Meio-dia no fuso da clínica, e não meia-noite: é a regra da v20
 * (`dataConc`, Code.gs:166) e as 4 clínicas têm anos de histórico assim. A
 * razão é a borda — com meia-noite, qualquer janela `[início, fim)` e
 * qualquer virada de horário de verão colocam o registro no dia vizinho, e
 * "a consulta do dia 20" aparece no relatório do dia 19.
 *
 * Em dia de mudança de horário de verão isto é 11:00 ou 13:00 locais, não
 * 12:00 — e está certo assim: o que se quer é um instante CONFORTAVELMENTE
 * DENTRO do dia civil, não o meio-dia do relógio.
 */
export function instanteDaConclusao(
  dia: string, hojeDaClinica: string, fuso: string, agora: Date,
): Result<Date> {
  if (dia > hojeDaClinica) {
    return erro(erroDe('DATA_NO_FUTURO', 'A data de realização precisa ser até hoje.'))
  }
  if (dia === hojeDaClinica) return ok(agora)
  return ok(new Date(inicioDoDia(dia, fuso).getTime() + MEIO_DIA_MS))
}
```

As quatro autorizações, cada uma um `Result<void>`, e **nenhuma delas com `if (usuario.admin)`** — `admin` já é absorvido por `temPerm`, e quem o reintroduzir aqui traz de volta o booleano que o `CONTEXT.md` proíbe.

- [ ] **Passo 4: Rodar — PASS.** Exporte de `index.ts`.

- [ ] **Passo 5: Prova por mutação** — troque `podeExcluir` para aceitar o responsável. O segundo teste tem de falhar. Restaure.

- [ ] **Passo 6: Commit**

---

## Task 2: A série recorrente — e o dia 31 que vira 28

**Files:** `packages/domain/src/recorrencia.ts` · `recorrencia.test.ts`

**Confira primeiro o que já existe.** `packages/domain/src/relogio.ts` já tem `somarDias`, `somarMeses(dia, n, diaOriginal)` e `fimDoMes`, e `somarMeses` **já implementa a regra 25**. Esta tarefa não reescreve nada disso: ela monta a série por cima.

O que o `gerarDatas` do protótipo (linha 1256) faz, e que precisa atravessar:

- `mensal` chama `addMeses(ini, k+1, dia0)` — **a âncora é a data inicial, não a anterior**. Uma série que começa em 31/01 vai a 28/02 e **volta a 31/03**. Se a âncora fosse a anterior, ela ficaria presa no dia 28 para sempre, e as clínicas perderiam a data da consulta mensal.
- `uteis` pula sábado e domingo mas **avança um dia por iteração** — não pula de semana.
- O limite é 150, e o protótipo gera 151 antes de recusar (`out.length <= MAX_REC`). Aqui a série **nasce com no máximo 150**; passar disso é erro de domínio, não corte silencioso.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// packages/domain/src/recorrencia.test.ts
it('mensal a partir de 31/01 volta ao dia 31 depois do mês curto', () => {
  const r = exigir(gerarSerie('2026-01-31', 'mensal', '2026-05-31'))
  expect(r).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
})

it('mensal a partir de 29/01 em ano bissexto pega o 29 de fevereiro', () => {
  const r = exigir(gerarSerie('2028-01-29', 'mensal', '2028-03-29'))
  expect(r).toEqual(['2028-01-29', '2028-02-29', '2028-03-29'])
})

it('dias úteis pula sábado e domingo e não pula a semana', () => {
  // 2026-10-23 é uma sexta.
  const r = exigir(gerarSerie('2026-10-23', 'uteis', '2026-10-28'))
  expect(r).toEqual(['2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28'])
})

it('quinzenal é de 14 em 14, não "duas vezes por mês"', () => {
  expect(exigir(gerarSerie('2026-01-01', 'quinzenal', '2026-02-01')))
    .toEqual(['2026-01-01', '2026-01-15', '2026-01-29'])
})

it('série de uma data só é recusada — isso não é série', () => {
  expect(gerarSerie('2026-10-24', 'semanal', '2026-10-24').erro.codigo).toBe('SERIE_CURTA')
})

it('acima de 150 é recusado, não truncado', () => {
  const r = gerarSerie('2026-01-01', 'diaria', '2026-12-31')
  expect(r.erro.codigo).toBe('SERIE_LONGA')
  expect(r.erro.mensagem).toContain('150')
})

it('"a cada X dias" exige X', () => {
  expect(gerarSerie('2026-01-01', 'ndias', '2026-03-01').erro.codigo).toBe('PASSO_INVALIDO')
  expect(exigir(gerarSerie('2026-01-01', 'ndias', '2026-01-21', 10)).length).toBe(3)
})
```

E as propriedades, com `fast-check` — exemplo escolhido a dedo não prova invariante:

```ts
it.prop([fc.date({ min: new Date('2020-01-01'), max: new Date('2035-12-31') }), fc.integer({ min: 1, max: 60 })])(
  'mensal: toda data da série tem o dia original OU é o último dia do mês',
  (d, meses) => {
    const inicio = d.toISOString().slice(0, 10)
    const diaOriginal = Number(inicio.slice(8, 10))
    const r = gerarSerie(inicio, 'mensal', somarMeses(inicio, meses, diaOriginal))
    if (ehErro(r)) return
    for (const dia of r.valor) {
      const n = Number(dia.slice(8, 10))
      expect(n === diaOriginal || dia === fimDoMes(dia.slice(0, 7))).toBe(true)
    }
  },
)

it.prop([/* … */])('a série é estritamente crescente e nunca passa de `ate`', (…) => { … })
```

A segunda propriedade é a que separa esta implementação de uma errada: *"nunca passa de `ate`"* sozinha não distingue "crescente" de "repetida", e uma série com duas tarefas no mesmo dia é exatamente o que a recepção reclama.

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar**

```ts
// packages/domain/src/recorrencia.ts
export const MAX_SERIE = 150

export const ROTULO_FREQUENCIA = {
  diaria: 'Todos os dias', uteis: 'Dias úteis', semanal: 'Semanal',
  quinzenal: 'A cada 15 dias', mensal: 'Mensal', ndias: 'A cada X dias',
} as const satisfies Record<Frequencia, string>

export function gerarSerie(
  inicio: string, freq: Frequencia, ate: string, aCadaNDias?: number,
): Result<readonly string[]> {
  if (ate < inicio) return erro(erroDe('ATE_ANTES', 'O "repetir até" é antes da data inicial.'))
  if (freq === 'ndias' && !(Number.isInteger(aCadaNDias) && aCadaNDias! >= 2 && aCadaNDias! <= 365)) {
    return erro(erroDe('PASSO_INVALIDO', 'Informe de 2 a 365 dias.'))
  }
  const passo = freq === 'semanal' ? 7 : freq === 'quinzenal' ? 14 : freq === 'ndias' ? aCadaNDias! : 1
  // A ÂNCORA É A DATA INICIAL, não a anterior. Ver o cabeçalho desta tarefa:
  // é o que faz 31/01 → 28/02 → 31/03 em vez de ficar preso no 28.
  const diaOriginal = Number(inicio.slice(8, 10))

  const datas: string[] = []
  let d = inicio
  for (let k = 0; d <= ate && k < 2000; k++) {
    if (freq !== 'uteis' || ehDiaUtil(d)) datas.push(d)
    if (datas.length > MAX_SERIE) {
      return erro(erroDe('SERIE_LONGA', `A série passa de ${MAX_SERIE} tarefas. Reduza o "repetir até".`))
    }
    d = freq === 'mensal' ? somarMeses(inicio, k + 1, diaOriginal) : somarDias(d, passo)
  }
  if (datas.length < 2) {
    return erro(erroDe('SERIE_CURTA', 'A série precisa de pelo menos 2 datas. Ajuste o "repetir até".'))
  }
  return ok(datas)
}
```

`ehDiaUtil` compara o dia da semana **sem fuso**: o dia civil já é uma data de calendário, e aplicar fuso a ele seria convertê-lo duas vezes.

- [ ] **Passo 4: Rodar — PASS**

- [ ] **Passo 5: Prova por mutação** — troque a âncora de `somarMeses(inicio, k+1, diaOriginal)` para `somarMeses(d, 1)`. O primeiro teste tem de falhar com `2026-03-28`. Restaure. **Esta é a mutação que o épico 2 existe para pegar.**

- [ ] **Passo 6: Commit**

---

## Task 3: Migration 0006 — e a tarefa que não tem coluna de dinheiro

**Files:** `apps/api/migrations/0006_rotina.sql` · `teste/rotina-rls.test.ts` · *(modificar)* `teste/registro.ts`

**A decisão que esta tarefa fixa:** `tarefas` **não tem** `valor`, `valor_aberto` nem `forma_pagamento`. O legado tem as três, e é por isso que a receita do mês dobra quando alguém lança o recebimento avulso do mesmo atendimento. Aqui o dinheiro mora em `recebimentos`, e **um atendimento guarda no máximo um recebimento** — garantido por índice único, não por revisão de código.

O recebimento avulso do épico 4 usará a **mesma** tabela, criando a tarefa companheira concluída e o recebimento ligado a ela. A diferença entre "embutido" e "avulso" passa a ser só de qual tarefa o recebimento pende — e em ambos os casos **existe exatamente um**.

- [ ] **Passo 1: Escrever o teste que falha**

```ts
// teste/rotina-rls.test.ts
it('o mesmo atendimento não aceita dois recebimentos — regra 3, no banco', async () => {
  const tarefa = await criarTarefaDireto(CLINICA)
  await inserirRecebimento({ tarefaId: tarefa, valor: 45000n })
  await expect(inserirRecebimento({ tarefaId: tarefa, valor: 45000n }))
    .rejects.toThrow(/recebimento_por_tarefa/i)
})

it('estornar libera a tarefa para um recebimento novo', async () => {
  const tarefa = await criarTarefaDireto(CLINICA)
  const r = await inserirRecebimento({ tarefaId: tarefa, valor: 45000n })
  await estornar(r)
  await expect(inserirRecebimento({ tarefaId: tarefa, valor: 50000n })).resolves.toBeDefined()
})

it('dois pacientes com o mesmo nome, só acento diferente, são o mesmo nome', async () => {
  await inserirPaciente(CLINICA, 'Ana Lúcia  Souza')
  await expect(inserirPaciente(CLINICA, 'ana lucia souza'))
    .rejects.toThrow(/pacientes_nome_unico/i)
})

it('o mesmo nome em OUTRA clínica é permitido', async () => {
  await inserirPaciente(CLINICA, 'Ana Lúcia Souza')
  await expect(inserirPaciente(OUTRA, 'Ana Lúcia Souza')).resolves.toBeDefined()
})

it('tarefa com tipo exige paciente, e paciente exige tipo', async () => {
  await expect(inserirTarefaCrua({ pacienteId: null, tipo: 'Follow-up' }))
    .rejects.toThrow(/tipo_exige_paciente/i)
})
```

- [ ] **Passo 2: Rodar e ver falhar** — `relation "pacientes" does not exist`.

- [ ] **Passo 3: Escrever a migration**

```sql
-- 0006_rotina.sql

-- ---------------------------------------------------------------------------
-- A MESMA normalização de nome do legado (`normalizar()` em Code.gs:977 e
-- `norm()` no protótipo), agora IMMUTABLE — e por isso indexável.
--
-- Por que no banco e não na aplicação: a checagem "já existe paciente com
-- esse nome" feita em TypeScript é ler-depois-escrever, e duas recepcionistas
-- cadastrando a mesma paciente ao mesmo tempo criam as duas. Com índice
-- único, a segunda recebe erro. Com `if`, a clínica recebe uma paciente
-- duplicada e descobre no fechamento do mês, quando o LTV dela está partido
-- em dois.
-- ---------------------------------------------------------------------------
CREATE FUNCTION normalizar_nome(texto text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT regexp_replace(
           lower(translate(btrim(texto),
             'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
             'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
           '\s+', ' ', 'g')
$$;

-- ---------------------------------------------------------------------------
-- PACIENTES
-- ---------------------------------------------------------------------------
CREATE TABLE pacientes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      uuid NOT NULL REFERENCES clinicas(id),
  nome            text NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  nome_chave      text GENERATED ALWAYS AS (normalizar_nome(nome)) STORED,
  telefone        text NOT NULL DEFAULT '' CHECK (length(telefone) <= 30),
  -- Só os dígitos: é por eles que a importação deduplica (regra 26).
  telefone_chave  text GENERATED ALWAYS AS
                    (nullif(regexp_replace(telefone, '\D', '', 'g'), '')) STORED,
  aniversario     date,
  origem          text NOT NULL DEFAULT '' CHECK (length(origem) <= 60),
  indicado_por    text NOT NULL DEFAULT '' CHECK (length(indicado_por) <= 80),
  unidade_id      uuid REFERENCES unidades(id),
  -- Para quem já era atendido antes da ferramenta (MANUAL cap. 7).
  ultima_consulta date,
  ativo           boolean NOT NULL DEFAULT true,
  desativado_em   timestamptz,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid REFERENCES pessoas(id),
  CONSTRAINT desativado_tem_instante CHECK ((NOT ativo) = (desativado_em IS NOT NULL))
);

-- Parcial em `ativo`: paciente desativado não ocupa o nome. Quem foi apagado
-- por engano e é recadastrado não deve esbarrar num registro que sumiu da tela.
CREATE UNIQUE INDEX pacientes_nome_unico ON pacientes (clinica_id, nome_chave) WHERE ativo;
CREATE INDEX pacientes_por_telefone ON pacientes (clinica_id, telefone_chave)
  WHERE telefone_chave IS NOT NULL;
CREATE INDEX pacientes_aniversario ON pacientes
  (clinica_id, (extract(month FROM aniversario)), (extract(day FROM aniversario)))
  WHERE aniversario IS NOT NULL AND ativo;

-- ---------------------------------------------------------------------------
-- TAREFAS
-- ---------------------------------------------------------------------------
CREATE TYPE status_de_tarefa AS ENUM ('aberta', 'concluida', 'cancelada');

-- As etapas da Jornada. As TRANSIÇÕES são do épico 3 (`moverEtapa`); aqui
-- nascem só as duas que `criarTarefa` e `atualizarTarefa` já fazem na v20:
-- agendado, e agendado → realizado ao concluir.
CREATE TYPE etapa_de_jornada AS ENUM
  ('agendado','confirmado','realizado','faltou','desmarcou','orcamento','fechado','perdido','encerrado');

CREATE TABLE tarefas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id     uuid NOT NULL REFERENCES clinicas(id),
  solicitante_id uuid NOT NULL REFERENCES pessoas(id),
  responsavel_id uuid NOT NULL REFERENCES pessoas(id),
  descricao      text NOT NULL CHECK (length(descricao) BETWEEN 1 AND 400),

  -- `date`, NÃO `timestamptz`. O prazo é um dia no CALENDÁRIO da clínica, e
  -- um instante o faria pular de dia conforme o fuso de quem lê. O único
  -- instante desta tabela é `concluida_em` (regra 22/23).
  prazo          date NOT NULL,
  hora           time,

  prioridade     text NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('normal','urgente')),
  status         status_de_tarefa NOT NULL DEFAULT 'aberta',
  concluida_em   timestamptz,

  paciente_id    uuid REFERENCES pacientes(id),
  -- `text` e não ENUM: o dado migrado tem nomes de três gerações
  -- ("Orçamento fechado", "Agendamento"), e `TIPO_ANTIGO` os traduz na
  -- leitura. Um ENUM aqui recusaria a migração das 4 clínicas.
  tipo           text NOT NULL DEFAULT '' CHECK (length(tipo) <= 60),
  etapa          etapa_de_jornada,
  historico      jsonb NOT NULL DEFAULT '[]'::jsonb,

  obs            text NOT NULL DEFAULT '' CHECK (length(obs) <= 300),
  serie_id       uuid,
  recorrencia    text NOT NULL DEFAULT '' CHECK (length(recorrencia) <= 40),
  unidade_id     uuid REFERENCES unidades(id),

  excluida_em    timestamptz,
  criada_em      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tipo_exige_paciente CHECK ((paciente_id IS NULL) = (tipo = '')),
  CONSTRAINT concluida_tem_instante CHECK ((status = 'concluida') = (concluida_em IS NOT NULL))
);

-- A consulta de Hoje e de Tarefas é sempre por clínica + janela de prazo.
CREATE INDEX tarefas_por_prazo ON tarefas (clinica_id, prazo) WHERE excluida_em IS NULL;
CREATE INDEX tarefas_abertas ON tarefas (clinica_id, responsavel_id, prazo)
  WHERE status = 'aberta' AND excluida_em IS NULL;
CREATE INDEX tarefas_por_conclusao ON tarefas (clinica_id, concluida_em DESC)
  WHERE status = 'concluida' AND excluida_em IS NULL;
CREATE INDEX tarefas_por_paciente ON tarefas (clinica_id, paciente_id) WHERE excluida_em IS NULL;
CREATE INDEX tarefas_por_serie ON tarefas (clinica_id, serie_id, prazo) WHERE serie_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RECEBIMENTOS — a regra 3, em forma de tabela
--
-- Nasce aqui, no épico 2, mesmo que a tela de recebimento avulso seja do
-- épico 4. Se nascesse lá, o épico 2 teria guardado dinheiro em `tarefas` e
-- o épico 4 começaria migrando dado financeiro — que é o jeito mais caro
-- possível de descobrir a regra 3.
-- ---------------------------------------------------------------------------
CREATE TABLE recebimentos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id     uuid NOT NULL REFERENCES clinicas(id),
  paciente_id    uuid NOT NULL REFERENCES pacientes(id),
  -- A tarefa de onde este dinheiro veio. Sempre preenchida no épico 2 (o
  -- pagamento embutido no atendimento). O avulso do épico 4 cria a tarefa
  -- companheira e aponta para ela — a ficha do paciente é UMA linha do tempo.
  tarefa_id      uuid REFERENCES tarefas(id),
  tipo           text NOT NULL CHECK (length(tipo) <= 60),

  -- Centavos. Regra 1. Nunca numeric, nunca float.
  valor          bigint NOT NULL CHECK (valor > 0),
  forma          text NOT NULL CHECK (forma IN
                   ('Pix','Dinheiro','Cartão de crédito','Cartão de débito','Nota promissória')),
  -- O que ESTE pagamento deixou em aberto. É um fato imutável do evento, não
  -- um saldo corrente: o saldo do paciente continua DERIVADO (regra 5),
  -- somando os `valor_aberto` que abriram e subtraindo os recebimentos que
  -- abateram, agrupado por programa.
  valor_aberto   bigint NOT NULL DEFAULT 0 CHECK (valor_aberto >= 0),

  recebido_em    timestamptz NOT NULL,
  unidade_id     uuid REFERENCES unidades(id),
  registrado_por uuid NOT NULL REFERENCES pessoas(id),
  -- Desfazer é estornar, nunca DELETE (regra 20).
  estornado_em   timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- A REGRA 3, EM UMA LINHA.
--
-- Um atendimento guarda NO MÁXIMO UM recebimento vivo. Não é convenção, não é
-- revisão de código, não é um `if` no serviço: é o banco recusando. O erro
-- clássico desta categoria é a receita do mês dobrar sem ninguém perceber até
-- o fechamento — e a defesa precisa estar no lugar onde nenhum caminho novo
-- (job, importação, migração das 4 clínicas) consegue contorná-la.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX recebimento_por_tarefa ON recebimentos (tarefa_id)
  WHERE tarefa_id IS NOT NULL AND estornado_em IS NULL;

CREATE INDEX recebimentos_por_data ON recebimentos (clinica_id, recebido_em DESC)
  WHERE estornado_em IS NULL;
CREATE INDEX recebimentos_por_paciente ON recebimentos (clinica_id, paciente_id)
  WHERE estornado_em IS NULL;

-- ---------------------------------------------------------------------------
-- RLS e trilha, nas três.
-- ---------------------------------------------------------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['pacientes','tarefas','recebimentos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_por_clinica ON %I USING (clinica_id = app_clinica_id()) '
      'WITH CHECK (clinica_id = app_clinica_id())', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()', t, t);
  END LOOP;
END $$;
```

- [ ] **Passo 4: Fechar o buraco de `unidades` que o plano de admin deixou**

**Não edite a `0005`.** Confira o que ela gravou e acrescente só o que falta, aqui:

```sql
-- O protótipo e o Code.gs guardam ENDEREÇO na unidade (`salvarUnidade`,
-- 160 caracteres) — a 0005 não o tem.
ALTER TABLE unidades ADD COLUMN IF NOT EXISTS endereco text NOT NULL DEFAULT ''
  CHECK (length(endereco) <= 160);

-- E os dois comparam o nome NORMALIZADO (`norm()` / `normalizar()`). Um
-- `UNIQUE (clinica_id, nome)` deixa passar "Unidade Pituba" e "unidade
-- pituba" como unidades diferentes — e aí a recepção tem duas, com metade do
-- caixa em cada.
ALTER TABLE unidades ADD COLUMN IF NOT EXISTS nome_chave text
  GENERATED ALWAYS AS (normalizar_nome(nome)) STORED;
ALTER TABLE unidades DROP CONSTRAINT IF EXISTS unidades_clinica_id_nome_key;
CREATE UNIQUE INDEX IF NOT EXISTS unidades_nome_unico ON unidades (clinica_id, nome_chave);
```

Se a `0005` já tiver `endereco`, o `IF NOT EXISTS` cuida. **Isto não duplica `salvarUnidade`** — a rota é daquele plano; aqui é só o esquema que ela precisa.

- [ ] **Passo 5: Aplicar e rodar**

`cd apps/api && npx tsx migrar.ts` → aplica `0006`. Depois `cd teste && npx vitest run rotina-rls` → PASS.

- [ ] **Passo 6: Registrar**

Em `teste/registro.ts`, acrescente `'pacientes'`, `'tarefas'` e `'recebimentos'` a `ENTIDADES_COM_CLINICA`. **`teste/auditoria-inescapavel.test.ts` já varre o catálogo** e reprova tabela com `clinica_id` sem trigger — rode-o e veja passar; se falhar, o `DO $$` do Passo 3 não pegou.

- [ ] **Passo 7: Prova por mutação** — remova o `WHERE estornado_em IS NULL` do índice `recebimento_por_tarefa`, reaplique num banco limpo (`fir reset`) e rode: o teste "estornar libera a tarefa" tem de falhar. Restaure.

- [ ] **Passo 8: Commit**

---

## Task 4: Os contratos — e o lançamento retroativo que não é um booleano

**Files:** `packages/contracts/src/pacientes.ts` · `tarefas.ts` · *(modificar)* `index.ts`

**A decisão que esta tarefa fixa:** criar uma tarefa tem **três formas mutuamente exclusivas**, e elas são uma união discriminada, não três campos opcionais que podem vir juntos.

O protótipo descobre a combinação ilegal em tempo de execução (`if (t.realizada) return fail("Lançamento retroativo não pode ser recorrente.")`). Aqui ela não compila.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// packages/contracts/src/tarefas.test.ts
it('retroativo com série é recusado pelo PARSE, não pelo serviço', () => {
  const r = CriarTarefa.safeParse({
    ...BASE, quando: { modo: 'retroativo', em: '2026-10-20' }, serie: { freq: 'semanal', ate: '…' },
  })
  expect(r.success).toBe(false)
})

it('tipo do grupo Pagamentos é recusado ao CRIAR tarefa', () => {
  const r = CriarTarefa.safeParse({ ...COM_PACIENTE, tipo: 'Pagamento de consulta' })
  expect(r.success).toBe(false)
  expect(JSON.stringify(r.error)).toContain('Recebimento')
})

it('paciente sem tipo de contato é recusado', () => { /* … */ })
it('tarefa interna com tipo é recusada', () => { /* … */ })
it('hora fora de HH:MM é recusada', () => { /* … */ })
it('valor do pagamento embutido chega como string de centavos', () => {
  const r = Concluir.parse({ em: '2026-10-24', pagamento: { valor: '45000', forma: 'Pix' } })
  expect(r.pagamento?.valor).toBe(45000n)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar**

```ts
// packages/contracts/src/tarefas.ts
import { z } from 'zod'
import { ehPagamento, TIPOS } from '@fir/domain'
import { DiaCivil, dinheiroEmTexto, Uuid } from './comum'

const Hora = z.string().regex(/^\d{2}:\d{2}$/, 'use HH:MM')
const NomeDeTipo = z.string().max(60)

export const FORMAS = ['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito', 'Nota promissória'] as const

/**
 * O pagamento embutido no atendimento — o bloco "Houve pagamento?" da tela.
 *
 * Ele e o recebimento avulso do épico 4 produzem a MESMA linha de
 * `recebimentos`. Nunca as duas para o mesmo dinheiro (regra 3).
 */
export const PagamentoEmbutido = z.object({
  valor: dinheiroEmTexto,
  forma: z.enum(FORMAS),
  valorAberto: dinheiroEmTexto.optional(),
})

/**
 * QUANDO a tarefa acontece. União discriminada, e não `realizada: boolean` +
 * `datas: string[]`, porque "retroativo numa série" é a combinação que o
 * protótipo recusa em tempo de execução — aqui ela não tem como ser escrita.
 */
export const Quando = z.discriminatedUnion('modo', [
  // O caso normal: agendar para a frente (ou para hoje).
  z.object({ modo: z.literal('agendada'), prazo: DiaCivil, hora: Hora.optional() }),
  // MANUAL cap. 4, "Lançar algo que já aconteceu": a tarefa nasce CONCLUÍDA.
  z.object({
    modo: z.literal('retroativo'),
    em: DiaCivil,
    hora: Hora.optional(),
    pagamento: PagamentoEmbutido.optional(),
  }),
  // "Tarefas que se repetem": N tarefas com o mesmo `serie_id`.
  z.object({
    modo: z.literal('serie'),
    inicio: DiaCivil,
    hora: Hora.optional(),
    freq: z.enum(['diaria', 'uteis', 'semanal', 'quinzenal', 'mensal', 'ndias']),
    ate: DiaCivil,
    aCadaNDias: z.number().int().min(2).max(365).optional(),
  }),
])

/**
 * Nova tarefa NUNCA cria um tipo do grupo Pagamentos.
 *
 * A tela da PO já faz isso — o `<select>` de "Nova tarefa" filtra
 * `!ehPagamento(t.nome)` (protótipo, linha 2466) e a dica embaixo dele diz
 * "Recebeu dinheiro do paciente? Não é tarefa: use Recebimento". A regra
 * mora aqui também porque o servidor sempre valida: se a única guarda fosse
 * o `<select>`, um POST direto criaria a segunda contagem do mesmo dinheiro.
 */
const tipoQueNaoEhPagamento = NomeDeTipo.refine((t) => !ehPagamento(t), {
  message: 'Pagamento não é tarefa. Use Recebimento para registrar dinheiro recebido.',
})

export const CriarTarefa = z
  .object({
    responsavelId: Uuid,
    descricao: z.string().trim().max(400).optional(),
    prioridade: z.enum(['normal', 'urgente']).default('normal'),
    obs: z.string().trim().max(300).default(''),
    unidadeId: Uuid.nullish(),
    quando: Quando,
  })
  .and(
    z.discriminatedUnion('vinculo', [
      z.object({ vinculo: z.literal('interna') }),
      z.object({
        vinculo: z.literal('paciente'),
        pacienteId: Uuid,
        tipo: tipoQueNaoEhPagamento,
        procedimentoId: Uuid.nullish(),
      }),
    ]),
  )
```

`descricao` é opcional e o serviço a preenche com o nome do tipo quando vier vazia — é o que a tela faz (`if (!tarefa.descricao) tarefa.descricao = ntipo.value`, linha 2718) e é por isso que o rótulo dela muda para "Descrição (opcional)" no modo paciente.

`Concluir`, `Cancelar`, `EditarTarefa` (com `serie: boolean`) e `ExcluirTarefa` (com `serie: boolean`) seguem o mesmo rigor. `Concluir` carrega `em: DiaCivil` e `pagamento?: PagamentoEmbutido`.

- [ ] **Passo 4: Rodar — PASS.** Exporte de `index.ts`.

- [ ] **Passo 5: Commit**

---

## Task 5: Pacientes — criar, editar, listar, abrir a ficha

**Files:** `apps/api/src/pacientes/pacientes.controller.ts` · `pacientes.service.ts` · `pacientes.module.ts` · `pacientes.e2e.test.ts`

Quatro rotas. `GET /v1/pacientes` e `POST` com `@Exige('pacientes')`; `GET /v1/pacientes/:id` com `@Exige('pacientes')` **e `@DadoSensivel('paciente')`** — a ficha é a rota que a regra 18 nomeia, porque a pergunta da LGPD é *"quem olhou o cadastro da minha paciente"*.

A lista serve a tela: busca por nome **ou telefone**, ordenação, filtro de origem, e os quatro atalhos do MANUAL cap. 7 — `todos`, `aniversariantes` (do mês), `com-tarefa-aberta`, `sem-retorno` (último atendimento ou `ultima_consulta` há mais de 6 meses, do mais antigo para o mais recente).

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('cadastrar com nome repetido, só acento diferente, é recusado com a mensagem dela', async () => {
  await criar({ nome: 'Ana Lúcia Souza' })
  const r = await criar({ nome: 'ana lucia souza' })
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toContain('Busque pelo nome para selecionar')
})

it('`ultimaConsulta` no futuro é descartada, não aceita', async () => {
  const r = await criar({ nome: 'X', ultimaConsulta: amanhaDaClinica() })
  expect(r.json().ultimaConsulta).toBeNull()
})

it('`indicadoPor` só é guardado quando a origem é Indicação', async () => { /* … */ })

it('o atalho "sem retorno" usa o MAIS RECENTE entre atendimento e ultimaConsulta', async () => {
  // Uma paciente com `ultimaConsulta` antiga mas atendimento recente NÃO é
  // candidata a recaptação. Confundir os dois faz a clínica ligar para quem
  // esteve lá na semana passada.
})

it('o atalho "aniversariantes" usa o mês do fuso DA CLÍNICA', async () => { /* … */ })

it('sem a permissão `pacientes`, a lista é 403', async () => { /* … */ })

it('abrir a ficha grava "acessou" na trilha, com o id da paciente', async () => {
  await pedir(`/v1/pacientes/${ALVO}`, cookieDe(JULIANA))
  const t = await ultimaTrilha()
  expect(t.acao).toBe('acessou')
  expect(t.entidade_id).toBe(ALVO)
})

it('nenhum log contém nome nem telefone de paciente', async () => {
  const linhas = await capturarConsole(() => criar({ nome: 'Ana Lúcia', telefone: '71988887777' }))
  expect(linhas.join('\n')).not.toMatch(/Ana Lúcia|988887777/)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar**

O conflito de nome **vem do banco, não de um `SELECT` antes**:

```ts
try {
  const { rows } = await c.query(SQL_INSERIR, params)
  return rows[0]
} catch (e) {
  // 23505 = unique_violation. Ler-depois-escrever perde a corrida entre duas
  // recepcionistas cadastrando a mesma paciente; o índice não perde.
  if (ehViolacaoDeUnico(e, 'pacientes_nome_unico')) {
    throw new ConflictException(
      'Já existe paciente com esse nome. Busque pelo nome para selecionar.',
    )
  }
  throw e
}
```

**Nada de `registrar()`** — o trigger da `0006` já gravou.

- [ ] **Passo 4: Rodar — PASS**

- [ ] **Passo 5: Registrar as rotas** em `teste/registro.ts`. `GET /v1/pacientes` devolve `ltv` e `saldo` por paciente → entra em `ROTAS_COM_DINHEIRO` com esses campos, e `teste/redacao-de-valores.test.ts` passa a cobrar que ambos saiam `null` sem a permissão `valores`.

- [ ] **Passo 6: Commit**

---

## Task 6: Desativar paciente — e a ADR que a divergência exige

**Files:** `apps/api/src/pacientes/pacientes.controller.ts` · `docs/adr/0003-paciente-desativado-nao-apaga-tarefa.md`

`DELETE /v1/pacientes/:id` com `@Exige('pacientes.gerir')`.

**Aqui o protótipo e o `Code.gs` concordam, e os dois perdem.** Ambos apagam o paciente, **todas as tarefas dele e todos os programas**. A regra 20 não permite: desativar é um estado, nunca uma exclusão, e a trilha de auditoria de um atendimento concluído não pode sumir porque alguém errou o cadastro.

O que muda para a recepção, e precisa estar na tela: ela continua vendo o aviso de quantas tarefas estão ligadas (a v20 devolve `{ id, tarefas: n }`), mas o texto passa de *"a exclusão apaga também as tarefas vinculadas"* para *"o cadastro sai das listas; o histórico fica"*.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('desativar tira das listas mas NÃO apaga as tarefas', async () => {
  await desativar(ALVO)
  expect(await listar()).not.toContainEqual(expect.objectContaining({ id: ALVO }))
  expect(await contarTarefasDe(ALVO)).toBeGreaterThan(0)
})

it('desativar devolve quantas tarefas ficaram — é o que a tela avisa antes', async () => {
  expect((await desativar(ALVO)).json().tarefas).toBe(4)
})

it('o nome volta a ficar livre depois de desativar', async () => {
  const nome = (await buscar(ALVO)).nome
  await desativar(ALVO)
  await expect(criar({ nome })).resolves.toMatchObject({ statusCode: 201 })
})

it('sem `pacientes.gerir`, 403 — e a paciente continua ativa', async () => { /* … */ })

it('a desativação entra na trilha com de/para de `ativo`', async () => {
  await desativar(ALVO)
  const t = await trilhaDe('pacientes', ALVO)
  expect(t.de.ativo).toBe(true)
  expect(t.para.ativo).toBe(false)
})
```

- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** — `UPDATE pacientes SET ativo=false, desativado_em=now() WHERE id=$1 AND ativo` com checagem de `rowCount`, nunca "ler depois escrever".

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Escrever a ADR `0003`** — contexto (os dois apagam), decisão (soft delete, tarefas ficam), consequências (a tela muda de texto; a contagem de pacientes exclui inativos; a migração do épico 9 precisa saber que a v20 não tem o estado "inativo" e importa todos como ativos), alternativa rejeitada (apagar em cascata, e por quê: a trilha de um atendimento concluído é prova, não conveniência).

- [ ] **Passo 6: Commit**

---

## Task 7: Importar pacientes — idempotente três vezes

**Files:** `apps/api/src/pacientes/importacao.service.ts` · `importacao.test.ts`

`POST /v1/pacientes/importar`, `@Exige('pacientes.gerir')`. Até **2.000** linhas (`MAX_IMPORT_PAC`, igual nos dois).

As regras, idênticas no protótipo e no `Code.gs`, e todas consequentes:

1. A chave é **nome normalizado** OU **telefone com 10+ dígitos**. Repetida **dentro do arquivo** conta como ignorada, não como segundo cadastro.
2. Paciente que já existe **não é duplicado**: só se completa o que estiver **vazio**. `telefone`, `aniversario` e `unidade_id` só entram se o campo atual for vazio.
3. `ultima_consulta` é a exceção: entra quando for **mais recente** que a guardada.
4. Datas no futuro são descartadas, não recusam a linha.
5. **Nada que já existe é apagado.** Regra 27.

E uma que é nossa, não deles: **a importação não ressuscita paciente desativado.** A busca por chave só olha `ativo`. Regra 27 — *nunca se recria o que o usuário apagou*.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('importar o MESMO arquivo três vezes não cria nada novo', async () => {
  const antes = await contar()
  const a = await importar(ARQUIVO)
  const b = await importar(ARQUIVO)
  const c = await importar(ARQUIVO)
  expect(a.novos).toBe(ARQUIVO.length)
  expect(b.novos).toBe(0)
  expect(c.novos).toBe(0)
  expect(b.atualizados).toBe(0)   // a segunda já não tem o que completar
  expect(await contar()).toBe(antes + ARQUIVO.length)
})

it('duas linhas com o mesmo telefone no MESMO arquivo criam um paciente só', async () => {
  const r = await importar([
    { nome: 'Ana Souza', telefone: '(71) 98888-7777' },
    { nome: 'Ana S.',    telefone: '71988887777' },
  ])
  expect(r.novos).toBe(1)
  expect(r.ignorados).toBe(1)
})

it('completa o vazio e NÃO sobrescreve o preenchido', async () => {
  await criar({ nome: 'Ana Souza', telefone: '71999990000' })
  const r = await importar([{ nome: 'Ana Souza', telefone: '71988887777', aniversario: '1990-03-02' }])
  const p = await buscarPorNome('Ana Souza')
  expect(p.telefone).toBe('71999990000')          // intocado — regra 27
  expect(p.aniversario).toBe('1990-03-02')        // estava vazio: completou
  expect(r.atualizados).toBe(1)
})

it('`ultimaConsulta` só avança, nunca retrocede', async () => { /* … */ })

it('paciente DESATIVADO não é ressuscitado pela importação', async () => {
  await desativar(ALVO)
  const r = await importar([{ nome: nomeDe(ALVO) }])
  expect(r.novos).toBe(1)
  expect((await buscar(ALVO)).ativo).toBe(false)
})

it('2.001 linhas é recusado, com o número na mensagem', async () => { /* … */ })

it('linha sem nome é ignorada, e não derruba a importação inteira', async () => { /* … */ })
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — **uma transação só** para o lote inteiro, e a deduplicação dentro do arquivo **antes** de tocar o banco. O `INSERT` de novos usa `ON CONFLICT ON CONSTRAINT pacientes_nome_unico DO NOTHING` como segunda camada: a corrida entre dois arquivos importados ao mesmo tempo não pode criar a paciente duas vezes, e a deduplicação em memória não a cobre.

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Prova por mutação** — troque o `ON CONFLICT` por `INSERT` puro e rode duas importações concorrentes do mesmo arquivo. Um dos dois tem de falhar com violação de único; se os dois passarem, o índice não está pegando. Restaure.

- [ ] **Passo 6: Commit**

---

## Task 8: Criar tarefa — e o lançamento retroativo

**Files:** `apps/api/src/tarefas/tarefas.controller.ts` · `tarefas.service.ts` · `tarefas.module.ts` · `criar-tarefa.test.ts`

`POST /v1/tarefas`. Sem `@Exige` — Hoje, Tarefas e Nova tarefa são de todos (`menu.ts`, `perm: null`).

As três formas da Task 4, nesta ordem de decisão:

```
quando.modo === 'serie'      → gerarSerie → N linhas, um serie_id, todas abertas
quando.modo === 'retroativo' → 1 linha, status 'concluida', concluida_em = instanteDaConclusao(…)
                               + se houver pagamento: 1 linha em `recebimentos`
quando.modo === 'agendada'   → 1 linha, status 'aberta'
```

E os dois ajustes que o `Code.gs` ganha (ver a tabela de divergências):

```ts
// `Code.gs:373`: a unidade cai na unidade PRINCIPAL do paciente quando não
// vier explícita. O protótipo deixa vazio, e o dado migrado das 4 clínicas
// desapareceria do filtro por unidade.
const unidadeId = unidadeValida(corpo.unidadeId) ?? paciente?.unidadeId ?? null

// `Code.gs:355`: o responsável precisa estar ATIVO. Tarefa atribuída a quem
// saiu da clínica não aparece no "Para mim" de ninguém.
if (!responsavel?.ativo) throw new BadRequestException('Escolha um responsável ativo.')
```

A etapa da jornada, exatamente como `demoApiBase` a monta (linha 1404) — e **só** isto; as demais transições são do épico 3:

```ts
if (pacienteId && TIPOS_AGENDA.includes(tipo)) {
  if (concluida) {
    // "Agendado vira realizado" é a MESMA tarefa, com histórico. Nunca uma
    // tarefa nova por etapa (CONTEXT.md, invariante da Jornada).
    tipo = tipoAoConcluir(tipo); etapa = 'realizado'
    historico = [{ e: 'agendado', em: agora, por: autor }, { e: 'realizado', em: concluidaEm, por: autor }]
  } else {
    etapa = 'agendado'
    historico = [{ e: 'agendado', em: agora, por: autor, nota: `para ${prazo}${hora ? ' ' + hora : ''}` }]
  }
}
```

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('a data de negócio vem do SERVIDOR, não do corpo', async () => {
  // Um cliente com o relógio adiantado manda "hoje" = amanhã. O servidor
  // compara com o dia civil DELE, no fuso da clínica, e recusa (regra 24).
  const r = await criar({ quando: { modo: 'retroativo', em: amanhaNoFusoDaClinica() } })
  expect(r.statusCode).toBe(400)
  expect(r.json().message).toContain('até hoje')
})

it('retroativo nasce CONCLUÍDO, com o instante dentro do dia pedido', async () => {
  const t = (await criar({ quando: { modo: 'retroativo', em: '2026-10-20' } })).json()
  expect(t.status).toBe('concluida')
  expect(diaCivil(new Date(t.concluidaEm), FUSO_DA_CLINICA)).toBe('2026-10-20')
})

it('retroativo com pagamento cria UM recebimento, e a tarefa não guarda dinheiro', async () => {
  const t = (await criar({
    vinculo: 'paciente', pacienteId: ANA, tipo: 'Consulta realizada',
    quando: { modo: 'retroativo', em: hojeDaClinica(), pagamento: { valor: '45000', forma: 'Pix' } },
  })).json()
  expect(await contarRecebimentosDe(t.id)).toBe(1)
  expect(Object.keys(t)).not.toContain('valor')   // a tarefa NÃO tem coluna de dinheiro
  expect(await receitaDoDia()).toBe(45000n)
})

it('a receita NÃO DOBRA: o mesmo atendimento recusa o segundo recebimento', async () => {
  const t = await criarComPagamento(45000n)
  await expect(inserirRecebimento({ tarefaId: t.id, valor: 45000n })).rejects.toThrow()
  expect(await receitaDoDia()).toBe(45000n)
})

it('tipo do grupo Pagamentos é 400, e a mensagem manda para Recebimento', async () => {
  const r = await criar({ vinculo: 'paciente', pacienteId: ANA, tipo: 'Pagamento de orçamento' })
  expect(r.statusCode).toBe(400)
  expect(r.json().message).toContain('Recebimento')
})

it('série mensal começando em 31/01 cria as 5 datas certas, com um serie_id só', async () => {
  const r = await criar({ quando: { modo: 'serie', inicio: '2026-01-31', freq: 'mensal', ate: '2026-05-31' } })
  const todas = r.json().todas
  expect(todas.map((t) => t.prazo)).toEqual(
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
  expect(new Set(todas.map((t) => t.serieId)).size).toBe(1)
})

it('a série inteira é UMA transação — nenhuma tarefa meia-criada', async () => {
  // Forçar falha na 4ª linha de 5 e conferir que ZERO foram gravadas.
})

it('responsável inativo é recusado', async () => { /* Code.gs:355 */ })

it('sem unidade explícita, a tarefa herda a unidade principal do paciente', async () => { /* Code.gs:373 */ })

it('descrição vazia vira o nome do tipo', async () => {
  const t = (await criar({ vinculo: 'paciente', pacienteId: ANA, tipo: 'Follow-up' })).json()
  expect(t.descricao).toBe('Follow-up')
})

it('a tarefa de outra clínica não é alcançável nem por id', async () => { /* RLS */ })
```

- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** — tudo dentro de um `banco.naClinica(clinicaId, ator, …)`, série inclusive.

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Prova por mutação** — remova o índice `recebimento_por_tarefa`; o teste "a receita NÃO DOBRA" tem de falhar. Restaure. **É o teste mais importante deste plano.**

- [ ] **Passo 6: Commit**

---

## Task 9: Concluir, cancelar, reabrir — e o pagamento que conta uma vez

**Files:** `apps/api/src/tarefas/tarefas.controller.ts` · `conclusao.service.ts` · `concluir.test.ts`

Três rotas, e **são três porque são três coisas** — o `atualizarTarefa` da v20 as empilha num `status` e foi assim que ele ficou sem lista branca:

```
POST /v1/tarefas/:id/concluir   { em, obs?, pagamento? }
POST /v1/tarefas/:id/cancelar   { obs? }
POST /v1/tarefas/:id/reabrir    { }
```

Cada uma chama a autorização correspondente da Task 1. **Reabrir estorna o recebimento embutido** — a tarefa volta a aberta, o dinheiro sai da receita, e o estorno fica na trilha. Sem isso, reabrir uma consulta deixa o pagamento órfão contando receita de um atendimento que não aconteceu.

Agendado vira realizado na própria tarefa (`tipoAoConcluir`), e a descrição acompanha **só** quando ela era o nome do tipo — é o que `demoApiBase` faz (`if (tv && (t.descricao===t.tipo || !t.descricao)) t.descricao = tv`): quem escreveu uma descrição de verdade não a perde.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('concluir "Consulta agendada" vira "Consulta realizada" NA MESMA TAREFA', async () => {
  const t = await concluir(AGENDADA, { em: hojeDaClinica() })
  expect(t.id).toBe(AGENDADA)                 // a mesma, não uma nova
  expect(t.tipo).toBe('Consulta realizada')
  expect(t.etapa).toBe('realizado')
  expect(t.historico.at(-1).e).toBe('realizado')
  expect(await contarTarefasDe(PACIENTE)).toBe(ANTES)   // nenhuma tarefa nova
})

it('a descrição escrita à mão sobrevive à conclusão', async () => {
  const t = await concluir(COM_DESCRICAO_PROPRIA, { em: hojeDaClinica() })
  expect(t.descricao).toBe('Consulta de retorno')
})

it('CONCLUIR não é EDITAR: concluir não mexe em prazo nem em responsável', async () => {
  const antes = await buscar(ABERTA)
  const t = await concluir(ABERTA, { em: hojeDaClinica() })
  expect(t.prazo).toBe(antes.prazo)
  expect(t.responsavelId).toBe(antes.responsavelId)
})

it('cancelar: o responsável NÃO pode; quem solicitou pode', async () => {
  expect((await cancelar(T, cookieDe(RESPONSAVEL))).statusCode).toBe(403)
  expect((await cancelar(T, cookieDe(SOLICITANTE))).statusCode).toBe(200)
})

it('quem tem `tarefas.equipe` cancela a tarefa de outra pessoa', async () => { /* … */ })

it('reabrir ESTORNA o recebimento embutido e a receita do dia volta a zero', async () => {
  const t = await criarComPagamento(45000n)
  expect(await receitaDoDia()).toBe(45000n)
  await reabrir(t.id)
  expect(await receitaDoDia()).toBe(0n)
  expect((await recebimentoDe(t.id)).estornadoEm).not.toBeNull()
})

it('concluir de novo depois de reabrir cria UM recebimento, não dois', async () => {
  const t = await criarComPagamento(45000n)
  await reabrir(t.id)
  await concluir(t.id, { em: hojeDaClinica(), pagamento: { valor: '50000', forma: 'Pix' } })
  expect(await recebimentosVivosDe(t.id)).toHaveLength(1)
  expect(await receitaDoDia()).toBe(50000n)
})

it('concluir com data futura é 400', async () => { /* … */ })

it('o estorno é um registro novo na trilha, nunca um DELETE', async () => { /* regra 20 */ })
```

- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** · **Passo 4: PASS**

- [ ] **Passo 5: Prova por mutação** — faça `reabrir` apagar o recebimento em vez de estorná-lo. O último teste tem de falhar. Restaure.

- [ ] **Passo 6: Commit**

---

## Task 10: Editar e excluir — e a série que anda junto

**Files:** `apps/api/src/tarefas/edicao.service.ts` · `editar.test.ts` · `excluir.test.ts`

As duas na mesma tarefa porque são o mesmo lugar na tela dela: *"**Excluir** (dentro de Editar)"* (MANUAL cap. 4). E porque o alcance da série é idêntico nas duas — implementá-lo duas vezes é como ele diverge.

### 10a · `PATCH /v1/tarefas/:id`, com `serie: boolean`

As regras da série, lidas de `demoApiBase` e confirmadas no `Code.gs`, e cada uma delas é uma decisão:

- Só alcança as tarefas **abertas** com `prazo >= prazoOriginal`. O passado não se reescreve.
- Se o prazo mudou, as próximas **deslocam o mesmo número de dias** — não recalculam a série. Quem adiou a consulta de sexta para segunda adiou as próximas em 3 dias, não mudou a frequência.
- A **data de realização e o resultado valem só para esta** (a tela diz isso em letra miúda).
- Trocar o paciente **limpa `adesaoId` e `sessao`** (`Code.gs:519`) — sessão pendurada no paciente errado é dose no frasco errado.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('adiar 3 dias com `serie` desloca as próximas em 3 dias, sem recalcular', async () => {
  // Série semanal 02/11, 09/11, 16/11. Adiar a primeira para 05/11.
  await editar(PRIMEIRA, { prazo: '2026-11-05' }, { serie: true })
  expect(await prazosDaSerie()).toEqual(['2026-11-05', '2026-11-12', '2026-11-19'])
})

it('`serie` não toca nas concluídas nem nas canceladas', async () => { /* … */ })
it('`serie` não toca nas de prazo ANTERIOR ao original', async () => { /* … */ })
it('sem `serie`, só esta muda', async () => { /* … */ })

it('trocar o paciente limpa o vínculo com o programa', async () => {
  const t = await editar(COM_ADESAO, { pacienteId: OUTRO_PACIENTE, tipo: 'Follow-up' })
  expect(t.adesaoId).toBeNull()
})

it('o responsável edita; quem não tem nada a ver, não', async () => { /* Task 1, pela rota */ })

it('editar não conclui — mesmo com `pagamento` no corpo', async () => {
  // `pagamento` não existe no contrato de edição. É a separação Concluir ×
  // Editar, e o parse recusa antes de o serviço existir.
})

it('editar uma tarefa de outra clínica é 404, não 403', async () => {
  // 403 confirmaria que ela existe. A RLS já devolve zero linhas.
})
```

- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** — o deslocamento em **um `UPDATE` com `prazo = prazo + $delta`**, não em laço de aplicação: 150 linhas em 150 round-trips é o que faz a tela travar no celular da recepção.

- [ ] **Passo 4: PASS**

### 10b · `DELETE /v1/tarefas/:id?serie=true|false`

Autorização: `podeExcluir` (Task 1) — **o responsável não**.

**Soft delete** (`excluida_em`), contra a v20 que faz `sh.deleteRow`. A regra 20 vale aqui como valeu na Task 6, e a razão é a mesma: a tarefa que alguém excluiu "por engano" às vezes é a que tinha o pagamento.

O alcance da série é o mesmo da edição: **abertas**, com `prazo >= prazo desta`.

- [ ] **Passo 5: Escrever os testes que falham**

```ts
it('excluir só esta deixa as outras da série em paz', async () => { /* … */ })

it('excluir "esta e as próximas" não toca nas anteriores nem nas concluídas', async () => {
  const ids = await excluir(SEGUNDA, { serie: true })
  expect(ids).toHaveLength(2)        // a 2ª e a 3ª; a 1ª e a concluída ficam
})

it('a tarefa excluída some de TODAS as consultas', async () => {
  await excluir(T)
  expect(await listarTarefas()).not.toContainEqual(expect.objectContaining({ id: T }))
  expect(await hoje()).not.toContain(T)
  expect(await fichaDoPaciente(ANA)).not.toContain(T)
})

it('excluir uma tarefa com recebimento é recusado — estorne primeiro', async () => {
  // Sumir com a tarefa deixaria o dinheiro contando receita sem origem
  // visível. A saída é reabrir (que estorna) e então excluir.
  const r = await excluir(COM_PAGAMENTO)
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toContain('Reabra a tarefa')
})

it('o responsável não exclui', async () => { /* Task 1, pela rota */ })
```

- [ ] **Passo 6: Ver falhar** · **Passo 7: Implementar** · **Passo 8: PASS** · **Passo 9: Commit**

---

## Task 11: A consulta — a janela `[início, fim)` que as duas telas usam

**Files:** `apps/api/src/tarefas/consulta.service.ts` · `apps/api/src/hoje/hoje.controller.ts` · `consulta.test.ts`

Duas rotas, uma consulta por baixo.

```
GET /v1/tarefas?escopo=&solicitanteId=&responsavelId=&situacao=&periodo=&de=&ate=&q=&tipo=&unidadeId=
GET /v1/hoje?dia=&escopo=
```

**A regra do período, e ela é do MANUAL cap. 4:** *"O período considera a data de realização das concluídas e o prazo das demais."* Duas colunas de natureza diferente numa janela só:

```sql
WHERE t.excluida_em IS NULL
  AND CASE WHEN t.status = 'concluida'
           -- instante: janela em UTC, bordas calculadas no fuso da clínica
           THEN t.concluida_em >= $de AND t.concluida_em < $ate
           -- dia civil: compara data com data, sem fuso nenhum no meio
           ELSE t.prazo >= $deCivil AND t.prazo < $ateCivil
      END
```

As bordas vêm de `janela(de, ate, clinica.fuso)` (`packages/domain/src/relogio.ts`), **semiabertas**, uma convenção só no sistema inteiro (regra 23).

Os três escopos (MANUAL cap. 3):

| `escopo` | Filtro | Permissão |
|---|---|---|
| `meu` | `responsavel_id = eu` | — |
| `solicitei` | `solicitante_id = eu` | — |
| `equipe` | nenhum | **`tarefas.equipe`** |

`GET /v1/hoje` compõe, **no servidor**, o que a tela mostra:

- `dia` — o dia civil pedido; **sem o parâmetro, `diaCivil(relogio.agora(), clinica.fuso)`**. O cliente nunca decide a data de negócio (regra 24).
- `semana` — os 7 dias da semana que contém `dia` (**começando na segunda**, `weekStartOf` do protótipo), cada um com `{ dia, tarefas: n, atrasadas: n }`. São as bolinhas douradas e vermelhas, **contadas no servidor** — `docs/design.md` proíbe cálculo no front.
- `aniversariantes` — pacientes ativos cujo `aniversario` cai no dia, no fuso da clínica.
- `pendentes` — **abertas com `prazo < hoje do servidor`**, recolhidas: a tela mostra só o número até alguém tocar. *"Ficam aqui todos os dias até serem concluídas ou canceladas."*
- `hoje` — abertas com `prazo = dia`.
- `ocultasPeloFiltro` — quantas tarefas do dia o escopo escondeu. É o aviso *"6 tarefas em aberto para hoje não aparecem em 'Para mim'"*, e sem ele a recepção acha que o dia está vazio.

**`atrasada` é sempre contra o hoje do SERVIDOR, nunca contra o `dia` navegado.** Navegar para a semana passada não torna tudo atrasado; navegar para a próxima não desatrasa nada.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('a janela é semiaberta: o último instante do dia entra, o primeiro do seguinte não', async () => {
  await concluirEm(A, '2026-10-24T23:59:59.999-03:00')
  await concluirEm(B, '2026-10-25T00:00:00.000-03:00')
  const r = await listar({ periodo: 'per', de: '2026-10-24', ate: '2026-10-24' })
  expect(ids(r)).toEqual([A])
})

it('o período usa `concluida_em` das concluídas e `prazo` das abertas', async () => {
  // Uma tarefa com prazo 20/10 concluída em 24/10 aparece no período do dia
  // 24, NÃO no do dia 20. É o que o MANUAL manda, e é o que a recepção
  // espera quando confere o que fez hoje.
})

it('as bordas são calculadas no fuso DA CLÍNICA, não em UTC', async () => {
  // Mesma tarefa, duas clínicas de fusos diferentes: a janela de "24/10"
  // cobre instantes UTC diferentes em cada uma.
})

it('`escopo=equipe` sem `tarefas.equipe` é 403', async () => { /* … */ })

it('`Para mim` conta quantas ficaram de fora — a recepção precisa saber', async () => {
  const r = await hoje({ escopo: 'meu' })
  expect(r.ocultasPeloFiltro).toBe(6)
})

it('pendentes de dias anteriores vêm recolhidas: contagem + lista', async () => {
  const r = await hoje()
  expect(r.pendentes.total).toBe(3)
  expect(r.pendentes.itens).toHaveLength(3)
})

it('`atrasada` é contra o hoje do servidor, não contra o dia navegado', async () => {
  const r = await hoje({ dia: diaDaSemanaPassada() })
  expect(r.semana.find((d) => d.dia === hojeDaClinica()).atrasadas).toBe(3)
})

it('sem `?dia=`, o dia vem do relógio do SERVIDOR no fuso da clínica', async () => {
  // RelogioFixo em 2026-10-25T02:00:00Z. Em America/Bahia ainda é 24/10.
  expect((await hoje()).dia).toBe('2026-10-24')
})

it('a semana começa na SEGUNDA', async () => {
  expect((await hoje({ dia: '2026-10-25' })).semana[0].dia).toBe('2026-10-19')  // domingo 25
})

it('buscar casa paciente, descrição e resultado — e ignora acento', async () => { /* … */ })

it('a consulta não devolve tarefa de outra clínica, nem com o id na mão', async () => { /* RLS */ })
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — `Relogio` **injetado** (`RelogioDoSistema` em produção, `RelogioFixo` no teste). Nenhum `new Date()` dentro do serviço: sem isso os três últimos testes ficam impossíveis de escrever sem esperar a meia-noite.

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Medir** — `EXPLAIN ANALYZE` da consulta de Hoje com 50 mil tarefas semeadas. Ela roda a cada abertura de tela, no celular da recepção, numa clínica com anos de histórico. Se não usar `tarefas_abertas`, o índice está errado — conserte agora, não no épico 9.

- [ ] **Passo 6: Commit**

---

## Task 12: A tela Hoje — de verdade

**Files:** `apps/web/src/app/(app)/hoje/page.tsx` *(substitui o esqueleto)* · `apps/web/src/components/cartao-de-tarefa.tsx` · `semana.tsx` · `filtro-de-pessoa.tsx`

**Leia `docs/design.md` antes, e rode a auditoria da seção 5 no fim.** Esta é a tela que a clínica deixa aberta o dia inteiro.

A ordem das seções é a do protótipo, e ela não é arbitrária — é a ordem do dia:

```
Semana (7 dias, bolinhas)
Aniversário hoje            → atalho "Criar tarefa"
[ Para mim | Que solicitei | Equipe toda ]
Aviso: "N tarefas não aparecem em 'Para mim'"   (só quando N > 0)
Pendentes de dias anteriores (N)   → RECOLHIDA
Hoje (N)
```

**O cartão** (MANUAL cap. 3): paciente, tipo de contato, descrição, quem executa, prazo, e as etiquetas "Atrasada" e "Urgente". Ações: **círculo** conclui · **Editar** · **Cancelar tarefa** · **WhatsApp** quando houver telefone.

- [ ] **Passo 1: O cartão, isolado** — `cartao-de-tarefa.tsx`, usado por Hoje e por Tarefas. Um componente só: duplicá-lo é como o legado passou a ter a mesma regra escrita três vezes.

  O círculo abre o painel de conclusão **no próprio cartão** (data de realização, "Recebeu algum valor?" Não/Sim, resultado) — não um modal, não outra tela. É o caminho de dois toques, e é literalmente o que a recepção faz cinquenta vezes por dia.

- [ ] **Passo 2: Semana e filtros** — os sete dias vêm **prontos do servidor** (`r.semana`). Nenhuma contagem no front.

- [ ] **Passo 3: As seções** — pendentes recolhida por padrão, com o número visível. Estados de carregando (sem deslocar conteúdo quando terminar), erro (com "Ir para Hoje" e "Recarregar") e vazio.

- [ ] **Passo 4: Dinheiro** — o painel de conclusão aceita valor e forma. **A entrada é texto; a saída sai de `formatarDinheiro`.** Nenhum `toFixed`, nenhum `Intl` direto, nenhum `if` escondendo dinheiro: o servidor já devolveu `null` sem a permissão `valores`. Algarismos tabulares.

- [ ] **Passo 5: Auditoria de `design.md` §5**, item a item — inclusive abrir em 390 px e contar os toques do fluxo "abrir Hoje → concluir com pagamento".

- [ ] **Passo 6: Commit**

---

## Task 13: Tarefas, Nova tarefa e Pacientes

**Files:** `apps/web/src/app/(app)/tarefas/page.tsx` · `nova/page.tsx` · `pacientes/page.tsx` · *(modificar)* `apps/web/src/lib/menu.ts`

- [ ] **Passo 1: Tarefas** — os três chips de pessoa, mais oito filtros em lista suspensa: Solicitante · Responsável · Situação (Todas, Em aberto, Atrasadas, Concluídas, Canceladas) · Período (Qualquer data, 7 dias, 30 dias, Este mês, Mês passado, Personalizado) · Buscar · Tipo (com "Tarefas internas") · Campanha · Unidade. Contagem no topo, e o mesmo aviso de "N tarefas de outras pessoas não aparecem".

  **Campanha fica de fora** — ver "Fora de escopo", abaixo.

- [ ] **Passo 2: Nova tarefa** — e esta é a tela em que `docs/design.md` mais cobra.

  Dois modos: **Tarefa interna** · **Vinculada a paciente**. No modo paciente com um tipo de agenda, a tela **encolhe** para paciente, tipo, data, horário e responsável; descrição, unidade, urgente e repetir vão para **"+ Mais opções"**. Medido no protótipo: são seis campos visíveis, não doze.

  O que não pode faltar:
  - **Cadastrar paciente ali mesmo** — a busca oferece `+ Cadastrar "Maria" como novo paciente`. Sem isso, agendar uma paciente nova vira duas telas, e a recepção com o telefone na mão escolhe o caminho errado.
  - **"Já foi realizada (lançamento retroativo)"**, com a data de realização. Escolher "Consulta realizada" ou "Procedimento realizado" **marca a caixa sozinho** e põe a data em hoje — são tipos que só existem depois de terem acontecido.
  - **Repetir**, com a prévia em texto: *"Serão criadas 5 tarefas de 31/01/26 a 31/05/26"*. A prévia vem do servidor ou de `gerarSerie` (`@fir/domain`) — **nunca de uma segunda implementação no front**.
  - A dica, exatamente como ela escreveu: *"Recebeu dinheiro do paciente? Não é tarefa: use Recebimento."* O link fica desabilitado com um "em breve" até o épico 4.

- [ ] **Passo 3: Pacientes** — indicadores com filtro de período (cadastrados, atendidos, e — com `valores` — receita e LTV médio), a tabela "Pacientes por origem", busca por nome ou telefone, ordenação, filtro de origem, e os quatro atalhos: **Todos · Aniversariantes do mês · Com tarefa em aberto · Sem retorno há 6+ meses**. Mais "Novo paciente" e "Importar pacientes".

- [ ] **Passo 4: `menu.ts`** — troque `epico` por `null` em `/tarefas`, `/nova` e `/pacientes`. **`menu-vs-telas.test.ts` vai cobrar** — ele confronta o menu com as páginas no disco.

- [ ] **Passo 5: Auditoria de `design.md` §5** nas três.

- [ ] **Passo 6: Commit**

---

## Task 14: Fechamento

- [ ] `docs/paridade.md`: `criarTarefa`, `editarTarefa`, `atualizarTarefa`, `excluirTarefa`, `salvarPaciente`, `excluirPaciente`, `importarPacientes` → ✅. Anote na coluna "Nota" as divergências decididas (soft delete em `excluirPaciente`; `atualizarTarefa` virou três rotas).
- [ ] `docs/adr/0003-...` escrita e referenciada na linha de `excluirPaciente`.
- [ ] `teste/registro.ts`: `ENTIDADES_COM_CLINICA` com as três tabelas; `ROTAS_COM_DINHEIRO` com as rotas que devolvem `valor`, `valorAberto`, `ltv`, `saldo`, `recebido`.
- [ ] `docs/dividas.md`: registrar que **Campanha** (no cadastro de paciente e na tarefa) ficou para o épico 8, e que a coluna entra por expand.
- [ ] `npx turbo run typecheck test --force`, **três vezes** — determinismo não se afirma, se observa.
- [ ] Commit

---

## Auto-revisão

**Cobre de `paridade.md`:** `criarTarefa` · `editarTarefa` · `atualizarTarefa` (vira `concluir`/`cancelar`/`reabrir`) · `excluirTarefa` (soft delete) · `salvarPaciente` · `excluirPaciente` (vira desativar) · `importarPacientes`. **7 das 59.** `salvarUnidade` é do plano de admin-da-clínica — aqui só o esquema que faltava.

**Regras do `CLAUDE.md` exercitadas:** 1 e 3 (Tasks 3, 8, 9) · 5 (Task 3, `valor_aberto` como fato do evento) · 16 (Tasks 5–11) · 17 (Tasks 5 e 11) · 18 (Task 5) · 19 e 20 (Task 3) · 22, 23 e 24 (Tasks 1 e 11) · 25 (Task 2) · 26 e 27 (Task 7).

**Fora de escopo, de propósito:**

- **Jornada** — confirmação por WhatsApp, no-show, desmarcou, reagendar, encerrar, orçamento, fechamento, perda com motivo, as seções **Recontatar** e **Próximos passos da jornada** da tela Hoje, e a tela Jornada. É o **épico 3** (`moverEtapa`). As colunas `etapa` e `historico` nascem aqui porque `criarTarefa` e `concluir` já as escrevem na v20; as **transições** não.
- **Sessões de programas** na tela Hoje, o aviso de saldo antes da sessão e a baixa no estoque — **épicos 5 e 6**.
- **Financeiro** na tela Hoje (lembrete de caixa, contas dos próximos 3 dias) e o **Recebimento avulso** — **épico 4**. A tabela `recebimentos` nasce aqui; a rota que cria recebimento sem tarefa, não.
- **Campanha** na tarefa e no paciente, e a sugestão automática *"Sugerida porque a paciente está nessa campanha"* — **épico 8**. Entra por migration de expand, sem tocar nada do que este plano escreveu.
- **Ficha do paciente** com histórico completo, LTV e produtos utilizados — o `GET /v1/pacientes/:id` deste plano devolve o cadastro e as tarefas; LTV e saldo por programa dependem dos épicos 4 e 5.

**O risco que fica:** a tela Hoje é a que mais consulta o banco, e é a única cujo custo cresce com o histórico da clínica em vez de com o que está na tela. O Passo 5 da Task 11 mede isso **agora**, com 50 mil tarefas semeadas, porque a clínica que vai doer é a que tem três anos de dado — e ela entra na migração do épico 9, não num teste de desenvolvimento com vinte linhas.
