# Épico 4 — Financeiro · plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`. Passos com `- [ ]`.

**Objetivo:** os quatro rituais de dinheiro da clínica, inteiros: registrar o recebimento, fechar o caixa às cegas, pagar as contas no prazo e cobrar quem deve — mais a Visão do mês que decide. Cinco telas (**Recebimentos**, **Caixa do dia**, **Contas a pagar**, **Cobranças**, **Visão do mês**) e o atalho fixo **+ Recebimento** na lateral.

> **Decidido pelo dono em 2026-10-24 — ver `docs/decisoes.md`, D-6.** A supressão do
> agregado enquanto o caixa está aberto **não é mais proposta, é decisão**. A alternativa
> (manter a tela do protótipo e deixar a cegueira valer só para quem não tem `valores`)
> foi oferecida e recusada, porque transformaria a proteção em configuração de perfil.
> **Não reabra.**

**Arquitetura:** a tabela `recebimentos` **já existe** (épico 2, migration `0006`) com o índice que torna impossível contar o mesmo pagamento duas vezes. Este plano **consome** essa tabela: o recebimento avulso cria a **tarefa companheira** concluída e pendura o recebimento nela, na mesma transação. Nenhuma coluna de dinheiro nasce em `tarefas`. Saldo em aberto é **função pura sobre eventos**, agrupada por programa. O esperado do caixa é calculado no servidor e **não existe no corpo da resposta** antes do fechamento.

**Stack:** PostgreSQL + migration `0007`, NestJS + Fastify, Next.js (App Router), Vitest contra Postgres real, fast-check no domínio.

**Depende de:** migration `0004` (trilha + trigger `registrar_auditoria`), `0005` (`unidades`, `pessoas`) e **`0006` (`pacientes`, `tarefas`, `recebimentos`)**. As três aplicadas antes do Passo 1 da Task 5.

**Cobre de `docs/paridade.md`:** `fecharCaixa` · `salvarConta` · `excluirConta` · `pagarConta` · `registrarCobranca` · `finConfig` · `salvarMetaFin`. **7 das 59.**

**O que este épico NÃO migra:** nada. **O `Code.gs` da v20 não implementa nenhuma das 7 ações** — Financeiro existe só no protótipo. Isso tem duas consequências que valem para o plano inteiro: (1) o protótipo é a **única** autoridade aqui, e (2) não há totais da v20 para conferir na regra 28, então nenhum desenho deste épico precisa ser compatível com dado legado. Onde o protótipo tem defeito, corrigimos sem custo de migração — e é por isso que as correções abaixo são baratas.

---

## Global Constraints

Valem para **todas** as tarefas. Copiadas do `CLAUDE.md`, do `CONTEXT.md`, de `docs/design.md` e do `2026-10-23-mapa-de-execucao.md`.

- **Regra 1:** nenhum `float` perto de dinheiro. `bigint` de centavos no banco, `Dinheiro` no domínio, **string de centavos no transporte** (`dinheiroEmTexto`, `packages/contracts/src/comum.ts`). Nada de `toFixed`, `parseFloat`, `* 100` ou `Math.round(x*100)/100`. O protótipo tem essa assinatura em **nove** lugares só no financeiro; nenhum atravessa.
- **Regra 3:** cada pagamento conta uma vez. O embutido no atendimento e o avulso são a **mesma linha** de `recebimentos`. O banco garante: `UNIQUE (tarefa_id) WHERE tarefa_id IS NOT NULL AND estornado_em IS NULL`. **Este plano não cria nenhum caminho que escreva dinheiro fora de `recebimentos`.**
- **Regra 4:** orçamento não é receita. `valor_orcamento` nem existe ainda (nasce no épico 3, em `tarefas`), e **a receita deste épico não lê `tarefas`** — ela soma `recebimentos`. A regra fica satisfeita por construção, não por disciplina.
- **Regra 5:** saldo em aberto é **derivado** (`aberto − abatido`), **agrupado por programa**, com um grupo geral. Nunca campo mutável, nunca colapsado num total só.
- **Regra 6:** o esperado do caixa é calculado no servidor e **não atravessa** antes do fechamento. É invariante de **transporte**: o teste olha o **corpo HTTP cru**, com o usuário **mais privilegiado** que existe.
- **Regra 16:** o servidor **sempre** valida. `@Exige('receber')`, `@Exige('caixa')`, `@Exige('contas')`, `@Exige('contas.gerir')`, `@Exige('cobrancas')`, `@Exige('finmes')`. A dependência `finmes → valores` já vive em `PERMS`; **nenhum `if` a reimplementa**.
- **Regra 17:** a redação é o `RedacaoInterceptor`, num ponto único. **Nenhuma rota deste plano escreve um `if` sobre dinheiro.** Toda rota que puder devolver dinheiro entra em `ROTAS_COM_DINHEIRO`.
- **Regra 19:** RLS `ENABLE` + `FORCE` + policy em toda tabela nova, `clinica_id NOT NULL`. Todas entram em `ENTIDADES_COM_CLINICA`.
- **Regra 20:** soft delete e trilha append-only. **O trigger `registrar_auditoria` grava sozinho** — o plano não manda ninguém chamar `registrar()` à mão, e quem o fizer duplica a trilha.
- **Regra 21:** valor, nome de paciente e telefone **nunca** em log. A mensagem de cobrança monta no servidor e não vai para lugar nenhum além da resposta.
- **Regra 22/23/24:** `timestamptz` em UTC; toda janela é `[início, fim)` com as bordas calculadas no **fuso da clínica**; a data de negócio vem do servidor. O `Relogio` é injetado — **nenhum `new Date()` dentro de serviço**.
- **Regra 25:** recorrência mensal em 29, 30 e 31 cai no último dia do mês curto, **sem perder a âncora**. `somarMeses(dia, n, diaOriginal)` já resolve.
- **Telas:** `docs/design.md` é a régua. 390 px é o caso principal, sem rolagem horizontal. Carregando, erro e vazio são parte do ticket. **Algarismos tabulares em toda coluna de valor, quantidade, data ou percentual.** Nenhum cálculo de total, saldo ou percentual no front.
- TypeScript estrito; imports **sem** extensão (ADR 0001); `@Inject(Tipo)` explícito no Nest.
- Nenhuma migration já aplicada se edita. Esta é a **`0007`**.
- Antes de qualquer "pronto": `npx turbo run typecheck test --force`. O `pnpm test` responde do cache sem rodar nada.

---

## A regra que atravessa o épico inteiro: **dinheiro mora num campo com nome registrado**

O `RedacaoInterceptor` apaga por **nome de chave**, contra `CAMPOS_MONETARIOS` (`packages/domain/src/permissoes.ts`). Isso tem uma consequência que precisa estar escrita antes da primeira linha de contrato, porque ela é invisível em revisão:

```ts
// VAZA. `porForma` não está na lista, então o interceptor RECURSA; as chaves
// internas são "Pix" e "Dinheiro", que também não estão — e os valores saem.
{ porForma: { Pix: '45000', Dinheiro: '12000' } }

// NÃO VAZA. Cada valor mora num campo chamado `valor`, que está na lista.
{ porForma: [ { forma: 'Pix', valor: '45000' }, { forma: 'Dinheiro', valor: '12000' } ] }
```

**Nenhum valor monetário deste épico mora como *valor* de um mapa cuja chave é dado.** Mapa de forma de pagamento, de categoria de despesa ou de programa vira **array de objetos**, sempre, e o campo chama-se `valor`, `esperado`, `contado`, `saldo`, `aberto`, `abatido`, `recebido` ou `meta` — nomes que a Task 5 garante estarem na lista. A Task 5 também escreve a **varredura** que reprova um campo monetário novo com nome fora dela.

---

## Os defeitos do protótipo, e o que fazemos com cada um

O protótipo é a especificação, e o `Code.gs` ganharia dele onde discordassem. **Aqui o `Code.gs` não tem opinião** — ele não implementa financeiro. Então cada linha abaixo é uma correção do protótipo, decidida, nunca silenciosa.

Todos foram **medidos no protótipo rodando** (`http://127.0.0.1:4890`), não lidos.

| # | Protótipo (`demoApiBase`) | O que fazemos | Por quê |
|---|---|---|---|
| 1 | **`fecharCaixa` não checa permissão nenhuma.** Medido: `demoApiBase({action:'fecharCaixa', uid:'u3'})` com a Enfermagem (perfil sem `caixa`, sem `valores`) devolveu `ok:true` e gravou o caixa | `@Exige('caixa')` | Regra 16. A tela guarda por `VIEW_PERM`; um POST direto não passa pela tela |
| 2 | **`registrarCobranca` não checa permissão.** Medido igual: a Enfermagem registrou cobrança | `@Exige('cobrancas')` | Idem |
| 3 | **A recorrência mensal perde a âncora.** Medido: conta de 31/12 → 31/01 → **28/02 → 28/03**. A partir de fevereiro ela vence dia 28 para sempre | Âncora em `dia_vencimento` (1–31) guardado na série: 31/12 → 31/01 → 28/02 → **31/03** | Regra 25, e o MANUAL cap. 14 diz *"repete todo mês, no mesmo dia"*. `somarMeses(dia, n, diaOriginal)` já faz isso |
| 4 | **A recorrência não duplica por um `if` no serviço** (`!F.contas.some(y => y.descricao===c.descricao && y.vencimento===prox)`) | `serie_id` + `UNIQUE (clinica_id, serie_id, vencimento)` | Chave por descrição quebra ao renomear a conta, e `if` perde a corrida entre duas abas |
| 5 | **`excluirConta` apaga, inclusive conta já paga** | Soft delete (`excluida_em`), e **conta paga não se exclui** — 409 | Regra 20. Apagar conta paga muda o resultado do mês sem deixar rastro |
| 6 | **O `esperado` em reais vai para quem não tem `valores`.** Medido: `carregar` como Juliana (Recepção, sem `valores`) devolveu `esperado:{Pix:320,Dinheiro:150,…}` dos caixas que ela fechou | O interceptor apaga `esperado`, `contado` e `diferenca`. A tela dela recebe **`conferido: boolean`**, derivado no servidor | Regra 17 — **e regra 6**: mostrar a *diferença* a quem digitou o *contado* é mostrar o esperado por subtração |
| 7 | O `esperado` gravado inclui `Nota promissória` quando houver, mas a diferença a ignora | Promissória **fora dos dois lados**; vai num bloco próprio, informativo, depois do fechamento | `CONTEXT.md`: *"Nota promissória não entra"*. Guardá-la num campo que a conferência ignora é convite a somá-la um dia |
| 8 | A tela Recebimentos mostra **"Total recebido hoje · Pix R$ 450"** — o esperado do caixa, por forma, antes de fechar | O agregado por forma de **um dia cujo caixa está aberto** não atravessa. A lista individual, sim | Ver "O que a regra 6 alcança, e o que não", abaixo |
| 9 | `calcSaldos` e `saldoInfo` fazem `Math.max(0, …)` por grupo e somam | Mantemos o **clamp por grupo** no número "a receber" — e **não descartamos** o negativo: ele sai como `credito` do grupo | O clamp é o número que a clínica usa. O descarte é que esconde o incidente que o `validador-numeros` manda investigar |
| 10 | `salvarMetaFin` aceita `Number(b.valor)||0` — meta zero apaga a meta | Meta é `PUT` idempotente com `valor >= 0`; zero **remove** a meta explicitamente | Nenhum — é a mesma semântica, escrita |

**Nenhuma dessas vira ADR**, exceto as duas que mudam o que a usuária vê: a **#6** (ADR `0004`) e a **#5** (nota na linha de `excluirConta` em `paridade.md`). As demais são correção de defeito contra regra já escrita.

> **ADR:** se o épico 3 já tiver tomado `0004`, renumere. Número de ADR é sequencial, não reservado.

---

## O que a regra 6 alcança, e o que não — leia antes da Task 9

A conferência às cegas protege contra **uma** coisa: a pessoa que conta a gaveta olhar o número antes de contar. O que o desenho garante, e o que não garante:

**Garantido, e testado no corpo HTTP:**
- `GET /v1/caixa?dia=X` de um dia **não fechado** não contém `esperado`, nem `diferenca`, nem o número sob qualquer outro nome. A chave **não existe** — não é `null`, não é redigida.
- Nenhuma rota devolve **agregado por forma de pagamento** de um dia cujo caixa está aberto.
- Os dois valem para o usuário **mais privilegiado do sistema**, não só para quem não tem `valores`. Redação não é defesa aqui: quem fecha o caixa com `valores` continua precisando conferir às cegas.

**Não garantido, e é honesto dizer:**
- Quem tem `valores` recebe a **lista individual** dos recebimentos do dia, e sabe somar. A lista é o instrumento de trabalho — é com ela que se acha o recebimento que faltou — e tirá-la quebraria o ritual que o módulo existe para instalar.
- A mitigação é operacional e já está no desenho do protótipo: **a responsável pelo caixa (`caixa_responsavel_id`) é, por padrão, a Recepção — que não tem `valores`**. Para ela a conferência é cega de ponta a ponta, porque ela não vê valor nenhum em tela nenhuma.

A linha que o plano traça é esta: **o servidor nunca faz a soma por ela.** Um agregado por forma de pagamento de um dia aberto *é* o esperado com outro nome, e é isso que o teste transversal persegue.

---

## Estrutura de arquivos

| Caminho | Responsabilidade |
|---|---|
| `packages/domain/src/financeiro/saldo.ts` | `saldoEmAberto` — derivado, agrupado, com o crédito preservado |
| `packages/domain/src/financeiro/caixa.ts` | `esperadoDoCaixa`, `conferirCaixa` — por forma e total |
| `packages/domain/src/financeiro/contas.ts` | `CATEGORIAS_DESP`, `proximoVencimento`, `FORMAS_DE_SAIDA` |
| `packages/domain/src/financeiro/visao-do-mes.ts` | `visaoDoMes`, `percentualInteiro` |
| `apps/api/migrations/0007_financeiro.sql` | `contas_a_pagar`, `caixas_do_dia`, `caixa_por_forma`, `cobrancas`, `metas_do_mes`, `configuracao_financeira`, ALTERs |
| `packages/contracts/src/financeiro.ts` | Zod → tipos + OpenAPI |
| `apps/api/src/financeiro/` | `recebimentos` · `caixa` · `contas` · `cobrancas` · `visao-do-mes` · `config` |
| `apps/web/src/app/(app)/recebimentos/page.tsx` · `caixa` · `contas` · `cobrancas` · `visao-do-mes` | As cinco telas |
| `teste/transporte-as-cegas.test.ts` | **O teste da regra 6.** Varre `ROTAS_DE_CONFERENCIA` |
| `teste/campos-de-dinheiro-registrados.test.ts` | Campo monetário com nome fora de `CAMPOS_MONETARIOS` reprova |
| `docs/adr/0004-conferencia-de-caixa-sem-valores.md` | A divergência #6 |

---

## Interfaces

As assinaturas exatas em que as tarefas dependem umas das outras.

```ts
// packages/domain/src/financeiro/saldo.ts  (Task 1)
export type EventoDeSaldo = {
  /** `null` = fora de programa (o grupo geral). O épico 5 passa a preencher. */
  readonly programaId: string | null
  /** O que ESTE evento deixou em aberto. Fato imutável, nunca um saldo corrente. */
  readonly aberto: Dinheiro
  /** O que ESTE evento abateu do grupo. */
  readonly abatido: Dinheiro
}
export type GrupoDeSaldo = {
  readonly programaId: string | null
  readonly aberto: Dinheiro
  readonly abatido: Dinheiro
  /** `aberto − abatido`, limitado a zero por baixo. É o que a clínica cobra. */
  readonly saldo: Dinheiro
  /** O que o clamp acima engoliu, quando `abatido > aberto`. Zero no caso normal. */
  readonly credito: Dinheiro
}
export type SaldoDoPaciente = {
  readonly grupos: readonly GrupoDeSaldo[]
  readonly total: Dinheiro       // soma dos `saldo` dos grupos
  readonly credito: Dinheiro     // soma dos `credito` dos grupos
  readonly temSaldo: boolean     // derivado; sobrevive à redação (regra 17)
}
export function saldoEmAberto(eventos: readonly EventoDeSaldo[]): SaldoDoPaciente

// packages/domain/src/financeiro/caixa.ts  (Task 2)
export const FORMAS_DE_CONFERENCIA = ['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito'] as const
export const FORA_DA_CONFERENCIA = 'Nota promissória'
export type Forma = (typeof FORMAS_DE_CONFERENCIA)[number]
export type LinhaDeCaixa = { readonly forma: Forma; readonly esperado: Dinheiro; readonly contado: Dinheiro; readonly diferenca: Dinheiro }
export type Conferencia = { readonly linhas: readonly LinhaDeCaixa[]; readonly diferenca: Dinheiro; readonly conferido: boolean }

export function esperadoDoCaixa(
  recebimentos: readonly { readonly forma: string; readonly valor: Dinheiro }[],
): ReadonlyMap<Forma, Dinheiro>
export function conferirCaixa(
  esperado: ReadonlyMap<Forma, Dinheiro>, contado: ReadonlyMap<Forma, Dinheiro>,
): Conferencia

// packages/domain/src/financeiro/contas.ts  (Task 3)
export const CATEGORIAS_DESP: readonly { nome: string; tipo: 'fixa' | 'variavel'; desc: string }[]
export const FORMAS_DE_SAIDA = ['Pix', 'Boleto', 'Transferência', 'Cartão de crédito', 'Débito automático', 'Dinheiro'] as const
export function proximoVencimento(vencimento: string, diaDaSerie: number): string

// packages/domain/src/financeiro/visao-do-mes.ts  (Task 4)
export function percentualInteiro(numerador: bigint, denominador: bigint): number | null
export function visaoDoMes(entrada: EntradaDaVisao): VisaoDoMes

// apps/api/migrations/0007_financeiro.sql  (Task 5)
contas_a_pagar          (… valor bigint, vencimento date, serie_id uuid, dia_vencimento smallint …)
caixas_do_dia           (… dia date, UNIQUE (clinica_id, dia) …)
caixa_por_forma         (… caixa_id, forma, esperado bigint, contado bigint …)
cobrancas · metas_do_mes · configuracao_financeira
ALTER recebimentos ADD requisicao_id uuid   -- idempotência do POST
ALTER tarefas      ADD marcador text        -- a rotina mensal de fechamento
```

---

## Task 1: Saldo em aberto — derivado, agrupado, e o crédito que não se descarta

**Files:** `packages/domain/src/financeiro/saldo.ts` · `saldo.test.ts` · *(modificar)* `packages/domain/src/index.ts`

Antes de qualquer rota. Esta é a função que a tela Cobranças usa, que o aviso "paciente com saldo em aberto" usa antes de uma sessão, e que a Visão do mês soma em "saldo a receber dos pacientes". Ela existe **uma vez**.

**As três decisões que esta tarefa fixa**, e cada uma tem razão:

1. **Agrupado por programa, com um grupo geral (`programaId: null`).** Colapsar num total só perde a informação que a cobrança usa: "R$ 2.000 do programa de Tirzepatida" e "R$ 2.000 soltos" exigem conversas diferentes. O protótipo já agrupa (`saldoInfo`, linha 5119) e o `Code.gs` também (`pacientesComSaldo`, linha 1013) — **os dois concordam, e nós seguimos.**
2. **O programa só nasce no épico 5. A FORMA nasce agora.** Hoje todo evento tem `programaId: null` e o resultado é um grupo só. O **contrato já é a lista de grupos**, e a função já é testada com vários — de modo que o épico 5 preenche a coluna e nada mais muda. Entregar um total só hoje e "agrupar depois" é como se colapsa para sempre.
3. **O clamp por grupo fica; o descarte sai.** `Math.max(0, aberto − abatido)` por grupo é o número que o protótipo e o `Code.gs` produzem, e é o que a clínica cobra — um programa pago a mais não pode reduzir a dívida de outro. Mas o excedente **não se joga fora**: ele sai como `credito` do grupo, e a Visão do mês o mostra. O `validador-numeros` é explícito: *"se a soma der negativa, isso é incidente a investigar, não um `Math.max(0, ...)` que esconde."*

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// packages/domain/src/financeiro/saldo.test.ts
const c = (n: number) => Dinheiro.deCentavos(BigInt(n))
const ZERO = Dinheiro.zero()
const ev = (programaId: string | null, aberto: Dinheiro, abatido: Dinheiro) => ({ programaId, aberto, abatido })

it('saldo é aberto − abatido, dentro do grupo', () => {
  const r = saldoEmAberto([ev(null, c(300000), ZERO), ev(null, ZERO, c(100000))])
  expect(r.total.centavos).toBe(200000n)
  expect(r.grupos).toHaveLength(1)
})

it('o pago no programa abate o programa, NÃO o geral', () => {
  // É a falha que faz a clínica parar de cobrar uma dívida que existe.
  const r = saldoEmAberto([
    ev(null, c(100000), ZERO),          // R$ 1.000 solto
    ev('prog-a', c(300000), ZERO),      // R$ 3.000 do programa A
    ev('prog-a', ZERO, c(300000)),      // pagou o programa A inteiro
  ])
  expect(r.total.centavos).toBe(100000n)
  expect(r.grupos.find((g) => g.programaId === 'prog-a')!.saldo.ehZero()).toBe(true)
  expect(r.grupos.find((g) => g.programaId === null)!.saldo.centavos).toBe(100000n)
})

it('grupo pago a mais NÃO abate outro grupo — e o excedente vira `credito`', () => {
  const r = saldoEmAberto([
    ev('prog-a', c(100000), c(150000)),  // pagou R$ 500 a mais
    ev(null, c(80000), ZERO),
  ])
  expect(r.total.centavos).toBe(80000n)        // o geral intacto
  expect(r.credito.centavos).toBe(50000n)      // e o excedente VISÍVEL
  expect(r.grupos.find((g) => g.programaId === 'prog-a')!.saldo.ehZero()).toBe(true)
})

it('`temSaldo` sobrevive à redação — é ele que a equipe sem `valores` recebe', () => {
  expect(saldoEmAberto([ev(null, c(1), ZERO)]).temSaldo).toBe(true)
  expect(saldoEmAberto([]).temSaldo).toBe(false)
  expect(saldoEmAberto([ev(null, c(100), c(100))]).temSaldo).toBe(false)
})

it('a ordem dos grupos é determinística: geral primeiro, depois por id', () => {
  const a = saldoEmAberto([ev('z', c(1), ZERO), ev(null, c(1), ZERO), ev('a', c(1), ZERO)])
  expect(a.grupos.map((g) => g.programaId)).toEqual([null, 'a', 'z'])
})
```

E as propriedades, com `fast-check` — exemplo escolhido a dedo não prova invariante:

```ts
const dinheiro = fc.bigInt({ min: 0n, max: 10_000_000n }).map(Dinheiro.deCentavos)
const evento = fc.record({
  programaId: fc.option(fc.constantFrom('a', 'b', 'c'), { nil: null }),
  aberto: dinheiro, abatido: dinheiro,
})

it.prop([fc.array(evento, { maxLength: 60 })])('o total é exatamente a soma dos saldos dos grupos', (es) => {
  const r = saldoEmAberto(es)
  const soma = r.grupos.reduce((s, g) => s.mais(g.saldo), Dinheiro.zero())
  expect(soma.centavos).toBe(r.total.centavos)
})

it.prop([fc.array(evento, { maxLength: 60 })])('nenhum saldo de grupo é negativo, e o crédito explica a diferença', (es) => {
  const r = saldoEmAberto(es)
  for (const g of r.grupos) {
    expect(g.saldo.ehNegativo()).toBe(false)
    // `saldo − credito === aberto − abatido`: o clamp não PERDE nada, ele
    // move. Sem esta propriedade, `Math.max(0, …)` passaria igual.
    expect(g.saldo.menos(g.credito).centavos).toBe(g.aberto.menos(g.abatido).centavos)
  }
})

it.prop([fc.array(evento, { maxLength: 60 })])('a ordem dos eventos não muda nada', (es) => {
  const a = saldoEmAberto(es), b = saldoEmAberto([...es].reverse())
  expect(b.total.centavos).toBe(a.total.centavos)
  expect(b.grupos.map((g) => [g.programaId, g.saldo.centavos])).toEqual(a.grupos.map((g) => [g.programaId, g.saldo.centavos]))
})
```

A segunda propriedade é a que separa esta implementação de uma errada. *"Nenhum saldo negativo"* sozinha passa com `Math.max(0, …)` puro — e é exatamente essa implementação que o `validador-numeros` reprova. É o `saldo − credito === aberto − abatido` que obriga o excedente a ter para onde ir.

- [ ] **Passo 2: Rodar e ver os oito falharem** — `cd packages/domain && npx vitest run financeiro/saldo`

- [ ] **Passo 3: Implementar** — `Map` por `programaId`, ordenação `null` primeiro e depois `localeCompare`, nenhuma aritmética fora de `Dinheiro`.

- [ ] **Passo 4: Rodar — PASS.** Exporte de `index.ts`.

- [ ] **Passo 5: Prova por mutação** — troque o clamp por grupo por um clamp no total (`Math.max(0, Σ)`). O teste "grupo pago a mais NÃO abate outro grupo" tem de falhar com `30000`. Restaure. **É a mutação que esta tarefa existe para pegar.**

- [ ] **Passo 6: Commit**

---

## Task 2: O esperado do caixa, e a conferência — domínio puro

**Files:** `packages/domain/src/financeiro/caixa.ts` · `caixa.test.ts` · *(modificar)* `index.ts`

**A decisão que esta tarefa fixa:** `Nota promissória` **não existe** na conferência — nem no esperado, nem no contado, nem na diferença. O protótipo a deixa entrar no `esperado` gravado e depois a exclui do cálculo da diferença (linha 1368); um campo que a conferência ignora é um campo que alguém soma um dia.

A promissória continua sendo receita (está em `FORMAS_PAGAMENTO` e entra no LTV) — ela só não está na gaveta.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// packages/domain/src/financeiro/caixa.test.ts
it('o esperado soma por forma, e ignora a nota promissória', () => {
  const e = esperadoDoCaixa([
    { forma: 'Pix', valor: c(45000) },
    { forma: 'Pix', valor: c(12000) },
    { forma: 'Dinheiro', valor: c(5000) },
    { forma: 'Nota promissória', valor: c(999999) },
  ])
  expect(e.get('Pix')!.centavos).toBe(57000n)
  expect(e.get('Dinheiro')!.centavos).toBe(5000n)
  expect([...e.keys()]).not.toContain('Nota promissória')
})

it('a conferência tem as QUATRO formas, mesmo as que ninguém usou', () => {
  // A gaveta com zero em dinheiro é uma informação; uma linha ausente não é.
  const r = conferirCaixa(esperadoDoCaixa([]), new Map([['Pix', c(0)]]))
  expect(r.linhas.map((l) => l.forma)).toEqual(['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito'])
})

it('falta de R$ 50 no dinheiro: diferença negativa, por forma e no total', () => {
  const r = conferirCaixa(
    esperadoDoCaixa([{ forma: 'Dinheiro', valor: c(15000) }, { forma: 'Pix', valor: c(45000) }]),
    new Map([['Dinheiro', c(10000)], ['Pix', c(45000)]]),
  )
  expect(r.linhas.find((l) => l.forma === 'Dinheiro')!.diferenca.centavos).toBe(-5000n)
  expect(r.linhas.find((l) => l.forma === 'Pix')!.diferenca.ehZero()).toBe(true)
  expect(r.diferenca.centavos).toBe(-5000n)
  expect(r.conferido).toBe(false)
})

it('sobra e falta em formas diferentes NÃO se cancelam na leitura por forma', () => {
  // O total zera; as linhas não. É o total que engana, e por isso a tela
  // mostra as quatro linhas antes do total.
  const r = conferirCaixa(
    esperadoDoCaixa([{ forma: 'Pix', valor: c(10000) }, { forma: 'Dinheiro', valor: c(10000) }]),
    new Map([['Pix', c(5000)], ['Dinheiro', c(15000)]]),
  )
  expect(r.diferenca.ehZero()).toBe(true)
  expect(r.conferido).toBe(false)    // conferido NÃO é "total zero"
})

it('uma forma que o contado não trouxe conta como zero contado, não como ausente', () => { /* … */ })
it('promissória no contado é recusada — ela não está na gaveta', () => {
  expect(() => conferirCaixa(new Map(), new Map([['Nota promissória' as never, c(1)]]))).toThrow(/promiss/i)
})
```

```ts
it.prop([fc.array(fc.record({ forma: fc.constantFrom(...FORMAS_DE_CONFERENCIA, FORA_DA_CONFERENCIA), valor: dinheiro }), { maxLength: 40 }),
         fc.dictionary(fc.constantFrom(...FORMAS_DE_CONFERENCIA), dinheiro)])(
  'a diferença total é exatamente a soma das diferenças por forma',
  (recs, contado) => {
    const r = conferirCaixa(esperadoDoCaixa(recs), new Map(Object.entries(contado) as never))
    const soma = r.linhas.reduce((s, l) => s.mais(l.diferenca), Dinheiro.zero())
    expect(soma.centavos).toBe(r.diferenca.centavos)
  },
)

it.prop([/* … */])('`conferido` é verdadeiro se e somente se TODA linha tem diferença zero', (…) => { … })
```

A última é a que impede a regressão óbvia: `conferido = diferenca.ehZero()` passa em quase todo exemplo e falha exatamente no caso de sobra e falta que se cancelam — o caso em que a clínica tem dois erros e acha que tem nenhum.

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar** — nenhuma divisão, nenhum `Number`. `conferirCaixa` lança para forma fora da lista, em vez de ignorar em silêncio (regra: somar o que não se declarou é como o dinheiro some).

- [ ] **Passo 4: Rodar — PASS**

- [ ] **Passo 5: Prova por mutação** — troque `conferido` para `this.diferenca.ehZero()`. O teste de sobra-e-falta tem de falhar. Restaure.

- [ ] **Passo 6: Commit**

---

## Task 3: Contas a pagar no domínio — a âncora do dia 31 e as dez categorias

**Files:** `packages/domain/src/financeiro/contas.ts` · `contas.test.ts` · *(modificar)* `index.ts`

**Confira primeiro o que já existe.** `packages/domain/src/relogio.ts` tem `somarMeses(dia, n, diaOriginal)` e **ela já implementa a regra 25**. Esta tarefa não reescreve: ela dá o nome certo ao terceiro argumento.

O defeito medido no protótipo (`addMeses(c.vencimento, 1)`, sem âncora): a conta de **31/12** gera 31/01, depois **28/02**, depois **28/03** — e vence dia 28 para o resto da vida da clínica. Com a âncora, 28/02 → **31/03**.

As dez categorias do MANUAL cap. 14 vivem aqui, em tabela, pelo mesmo motivo que `TIPOS` vive: espalhar `if (categoria === 'Pessoal')` é como o legado passou a ter a mesma regra em três lugares.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('a conta do dia 31 volta ao dia 31 depois do mês curto', () => {
  expect(proximoVencimento('2026-12-31', 31)).toBe('2027-01-31')
  expect(proximoVencimento('2027-01-31', 31)).toBe('2027-02-28')
  expect(proximoVencimento('2027-02-28', 31)).toBe('2027-03-31')   // ← o defeito do protótipo
})

it('dia 29 em ano bissexto pega o 29 de fevereiro', () => {
  expect(proximoVencimento('2028-01-29', 29)).toBe('2028-02-29')
})

it('as dez categorias, e só elas, com fixas e variáveis fechando a lista', () => {
  expect(CATEGORIAS_DESP).toHaveLength(10)
  expect(CATEGORIAS_DESP.filter((c) => c.tipo === 'fixa').map((c) => c.nome))
    .toEqual(['Pessoal', 'Ocupação', 'Sistemas e assinaturas', 'Serviços contratados'])
  expect(CATEGORIAS_DESP.at(-1)!.nome).toBe('Outras despesas')   // o fallback é o último
})

it('as formas de SAÍDA não são as de entrada', () => {
  // Conta a pagar é Boleto, Transferência e Débito automático; recebimento é
  // Pix, cartões e promissória. Misturar as duas listas é o começo de uma
  // Visão do mês que soma maçã com laranja.
  expect(FORMAS_DE_SAIDA).toContain('Boleto')
  expect(FORMAS_DE_SAIDA).not.toContain('Nota promissória')
})
```

```ts
it.prop([fc.date({ min: new Date('2024-01-01'), max: new Date('2035-12-31') }), fc.integer({ min: 1, max: 31 }), fc.integer({ min: 1, max: 48 })])(
  'iterar N meses a partir da âncora dá o dia da âncora OU o último dia do mês, sempre',
  (d, ancora, n) => {
    let v = `${d.toISOString().slice(0, 8)}${String(Math.min(ancora, 28)).padStart(2, '0')}`
    for (let i = 0; i < n; i++) {
      v = proximoVencimento(v, ancora)
      const dia = Number(v.slice(8, 10))
      expect(dia === ancora || v === fimDoMes(v.slice(0, 7))).toBe(true)
      expect(dia).toBeLessThanOrEqual(ancora)   // nunca ULTRAPASSA a âncora
    }
  },
)
```

A segunda asserção da propriedade (`dia <= ancora`) é a que pega a correção errada: uma implementação que "sobe" para o dia 1 do mês seguinte quando o dia não existe passa na primeira e falha nesta — e é a que faria a conta de 31/01 vencer em 01/03.

- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** (`proximoVencimento` é `somarMeses(vencimento, 1, diaDaSerie)` — três linhas e um comentário explicando a âncora) · **Passo 4: PASS**

- [ ] **Passo 5: Prova por mutação** — remova o terceiro argumento de `somarMeses`. O terceiro `expect` do primeiro teste tem de falhar com `2027-03-28`. Restaure.

- [ ] **Passo 6: Commit**

---

## Task 4: A Visão do mês no domínio — e o percentual que não passa por `float`

**Files:** `packages/domain/src/financeiro/visao-do-mes.ts` · `visao-do-mes.test.ts` · *(modificar)* `index.ts`

A agregação inteira acontece aqui, pura, sobre listas já filtradas pelo repositório. O front **não soma nada** (`docs/design.md` §5).

**Não há divisão de valor neste épico.** Nenhum número é repartido em parcelas, então `Dinheiro.ratear` não é usado — e dizer isso é parte do trabalho: a propriedade de rateio (`max − min <= 1`) não tem onde se aplicar, e inventar um uso para ela seria pior que não a ter. As propriedades obrigatórias aqui são as de **fechamento de totais**, e elas pegam o erro real deste módulo: uma categoria que some da soma.

O percentual é o único lugar com divisão, e ela é **inteira**:

```ts
/**
 * Percentual arredondado para o inteiro mais próximo, SEM passar por `float`.
 *
 * `Math.round(a / b * 100)` é a assinatura do protótipo. Ela está errada por
 * dois motivos: `a` e `b` são `bigint` de centavos e `Number(a)` perde
 * precisão acima de 2^53; e meio por cento a mais ou a menos muda o número
 * que a clínica lê na barra da meta.
 *
 * `(2·a·100 + b) / (2·b)` é arredondamento para o mais próximo, meio PARA
 * CIMA, em aritmética inteira — a mesma regra do `Math.round` para positivos.
 */
export function percentualInteiro(numerador: bigint, denominador: bigint): number | null
```

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('o percentual arredonda como o Math.round, sem float', () => {
  expect(percentualInteiro(6600n, 10000n)).toBe(66)
  expect(percentualInteiro(665n, 1000n)).toBe(67)      // 66,5 → 67, meio para cima
  expect(percentualInteiro(664n, 1000n)).toBe(66)
  expect(percentualInteiro(0n, 1000n)).toBe(0)
  expect(percentualInteiro(1000n, 0n)).toBeNull()      // meta zero não tem percentual
})

it('o percentual sobrevive a valores que estouram o double', () => {
  // 90.071.992.547.409.919 centavos: `Number()` deste valor já mente.
  expect(percentualInteiro(90071992547409919n, 90071992547409919n)).toBe(100)
})

it('resultado é recebido menos despesas pagas, e pode ser negativo', () => {
  const v = visaoDoMes({ recebido: [c(500000)], pagas: [{ categoria: 'Pessoal', valor: c(800000) }], /* … */ })
  expect(v.resultado.centavos).toBe(-300000n)
})

it('despesa paga usa o VALOR PAGO quando ele difere do valor da conta', () => {
  // A conta era R$ 980 e veio R$ 1.012. O mês fecha com 1.012.
  const v = visaoDoMes({ pagas: [{ categoria: 'Ocupação', valor: c(101200) }], /* … */ })
  expect(v.despesasPagas.centavos).toBe(101200n)
})

it('fixas e variáveis somam exatamente as despesas pagas', () => { /* … */ })
it('uma categoria sem movimento no mês NÃO aparece — e uma com movimento no mês anterior, sim', () => { /* … */ })
it('a meta sem `valores` entrega só o percentual', () => {
  // Aqui é só a FORMA: `meta` e `recebido` existem como campo, e quem os
  // apaga é o interceptor (Task 11). O domínio nunca decide permissão.
  const v = visaoDoMes({ /* … */ meta: c(1200000), recebido: [c(792000)] })
  expect(v.percentualDaMeta).toBe(66)
})
```

```ts
it.prop([fc.array(fc.record({ categoria: fc.constantFrom(...CATEGORIAS_DESP.map((x) => x.nome)), valor: dinheiro }), { maxLength: 80 })])(
  'a soma das categorias é exatamente o total de despesas pagas, e fixas + variáveis também',
  (pagas) => {
    const v = visaoDoMes({ pagas, recebido: [], /* … */ })
    const porCat = v.porCategoria.reduce((s, x) => s.mais(x.valor), Dinheiro.zero())
    expect(porCat.centavos).toBe(v.despesasPagas.centavos)
    expect(v.fixas.mais(v.variaveis).centavos).toBe(v.despesasPagas.centavos)
  },
)

it.prop([/* … */])('somar a lista em qualquer ordem dá o mesmo total', (…) => { … })
```

- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** · **Passo 4: PASS**

- [ ] **Passo 5: Conferência à mão, com números redondos** — o `validador-numeros` trabalha assim, e esta é a hora: recebido R$ 10.000,00; despesas Pessoal R$ 4.000,00, Ocupação R$ 2.500,00, Marketing R$ 1.500,00. Esperado: pagas R$ 8.000,00, fixas R$ 6.500,00 (81%), variáveis R$ 1.500,00 (19%), resultado R$ 2.000,00 (20% do recebido), meta R$ 12.000,00 → 83%. Escreva **este** cenário como teste nomeado, com os números no corpo. Ele é o que alguém relê quando o fechamento não bate.

- [ ] **Passo 6: Commit**

---

## Task 5: Migration 0007 — e os campos monetários que não se escondem sozinhos

**Files:** `apps/api/migrations/0007_financeiro.sql` · `teste/financeiro-rls.test.ts` · `teste/campos-de-dinheiro-registrados.test.ts` · *(modificar)* `teste/registro.ts` · `packages/domain/src/permissoes.ts` · `CONTEXT.md`

**Antes do SQL, o glossário.** Dois termos nascem aqui e não estão no `CONTEXT.md`: **`Conta a pagar`** (já existe como termo proibido-substituto, mas sem definição e sem invariantes) e **`Marcador de rotina`** (o rótulo que liga uma tarefa à rotina mensal que a criou). Escreva os dois em `CONTEXT.md` **primeiro**, com invariantes, e só então a coluna.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// teste/financeiro-rls.test.ts
it('o caixa do dia é único por clínica e por dia — o segundo fechamento é recusado pelo BANCO', async () => {
  await fecharDireto(CLINICA, '2026-10-24')
  await expect(fecharDireto(CLINICA, '2026-10-24')).rejects.toThrow(/caixa_por_dia/i)
})

it('o mesmo dia em OUTRA clínica é permitido', async () => { /* … */ })

it('a conta do mês seguinte nasce uma vez — o banco recusa a segunda', async () => {
  const serie = randomUUID()
  await inserirConta({ serieId: serie, vencimento: '2027-01-31', diaVencimento: 31 })
  await expect(inserirConta({ serieId: serie, vencimento: '2027-01-31', diaVencimento: 31 }))
    .rejects.toThrow(/conta_da_serie_por_mes/i)
})

it('série sem âncora é recusada — uma conta mensal sem dia de vencimento não existe', async () => {
  await expect(inserirConta({ serieId: randomUUID(), diaVencimento: null }))
    .rejects.toThrow(/serie_tem_ancora/i)
})

it('conta paga sem valor pago é recusada', async () => { /* pagamento_completo */ })

it('o mesmo `requisicaoId` não cria dois recebimentos', async () => {
  const req = randomUUID()
  await inserirRecebimento({ requisicaoId: req, valor: 45000n })
  await expect(inserirRecebimento({ requisicaoId: req, valor: 45000n }))
    .rejects.toThrow(/recebimento_por_requisicao/i)
})
```

```ts
// teste/campos-de-dinheiro-registrados.test.ts
it('todo campo monetário dos contratos tem nome que o interceptor conhece', () => {
  // Varredura de FONTE, não de runtime: lê `packages/contracts/src/*.ts` e
  // extrai os nomes à esquerda de `dinheiroEmTexto`. Uma lista mantida à mão
  // fica desatualizada no endpoint número quarenta; esta varre.
  const fora = camposDeDinheiroDosContratos().filter((n) => !CAMPOS_MONETARIOS.includes(n))
  expect(fora, `campos monetários fora de CAMPOS_MONETARIOS: ${fora.join(', ')}`).toEqual([])
})

it('nenhum contrato põe dinheiro como VALOR de um mapa', () => {
  // `z.record(z.string(), dinheiroEmTexto)` é a forma que o interceptor não
  // alcança: ele redige por NOME DE CHAVE, e a chave aqui é dado.
  expect(fonteDosContratos()).not.toMatch(/z\.record\([^)]*dinheiroEmTexto/)
})
```

- [ ] **Passo 2: Rodar e ver falhar** — `relation "contas_a_pagar" does not exist`.

- [ ] **Passo 3: Escrever a migration**

```sql
-- 0007_financeiro.sql

-- ---------------------------------------------------------------------------
-- CONTAS A PAGAR
--
-- `recorrente boolean` do protótipo não existe aqui: a recorrência É a série.
-- Duas representações do mesmo fato (um booleano e um vínculo) divergem no
-- dia em que alguém desmarca uma e não a outra.
-- ---------------------------------------------------------------------------
CREATE TABLE contas_a_pagar (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      uuid NOT NULL REFERENCES clinicas(id),
  descricao       text NOT NULL CHECK (length(descricao) BETWEEN 1 AND 80),
  -- `text` e não ENUM: acrescentar uma categoria para uma clínica não pode
  -- exigir migration. A lista válida é a de `packages/domain` e a borda Zod
  -- a cobra; aqui fica só o tamanho.
  categoria       text NOT NULL CHECK (length(categoria) <= 40),
  valor           bigint NOT NULL CHECK (valor > 0),
  -- `date`: vencimento é um dia no CALENDÁRIO da clínica, nunca um instante.
  vencimento      date NOT NULL,
  fornecedor      text NOT NULL DEFAULT '' CHECK (length(fornecedor) <= 80),
  responsavel_id  uuid NOT NULL REFERENCES pessoas(id),
  unidade_id      uuid REFERENCES unidades(id),

  -- A SÉRIE MENSAL, e a ÂNCORA.
  --
  -- `dia_vencimento` (1–31) é o dia ORIGINAL, e é ele que faz 31/12 → 31/01
  -- → 28/02 → 31/03. Sem a âncora — que é o que o protótipo faz — a conta
  -- cai para o dia 28 em fevereiro e NUNCA MAIS volta: medido.
  serie_id        uuid,
  dia_vencimento  smallint CHECK (dia_vencimento BETWEEN 1 AND 31),
  CONSTRAINT serie_tem_ancora CHECK ((serie_id IS NULL) = (dia_vencimento IS NULL)),

  pago_em         date,
  valor_pago      bigint CHECK (valor_pago > 0),
  forma_pagamento text NOT NULL DEFAULT '' CHECK (length(forma_pagamento) <= 30),
  pago_por        uuid REFERENCES pessoas(id),
  CONSTRAINT pagamento_completo CHECK (
    (pago_em IS NULL) = (valor_pago IS NULL) AND (pago_em IS NULL) = (pago_por IS NULL)),

  excluida_em     timestamptz,
  criada_em       timestamptz NOT NULL DEFAULT now(),
  criada_por      uuid REFERENCES pessoas(id)
);

-- A CONTA DO MÊS SEGUINTE NASCE UMA VEZ.
-- Não é `if (!F.contas.some(y => y.descricao===c.descricao && …))` no serviço:
-- a chave por descrição quebra assim que alguém renomeia a conta, e o `if`
-- perde a corrida entre duas abas. É o banco que recusa.
CREATE UNIQUE INDEX conta_da_serie_por_mes ON contas_a_pagar (clinica_id, serie_id, vencimento)
  WHERE serie_id IS NOT NULL AND excluida_em IS NULL;

CREATE INDEX contas_abertas ON contas_a_pagar (clinica_id, vencimento)
  WHERE pago_em IS NULL AND excluida_em IS NULL;
CREATE INDEX contas_pagas_por_mes ON contas_a_pagar (clinica_id, pago_em)
  WHERE pago_em IS NOT NULL AND excluida_em IS NULL;
CREATE INDEX contas_por_responsavel ON contas_a_pagar (clinica_id, responsavel_id, vencimento)
  WHERE excluida_em IS NULL;

-- ---------------------------------------------------------------------------
-- CAIXA DO DIA — e por que são DUAS tabelas
--
-- O esperado e o contado por forma poderiam ser um `jsonb`. Não são, por dois
-- motivos: `bigint` não cabe em número JSON sem perda acima de 2^53 (e
-- guardá-lo como texto dentro do jsonb torna a Visão do mês incapaz de somar
-- em SQL), e a diferença por forma é exatamente o que a clínica lê.
--
-- NÃO existe coluna `diferenca`. Ela é `Σ(contado − esperado)` sobre as
-- linhas, e as linhas são FATOS CONGELADOS do fechamento. Uma coluna
-- redundante é uma coluna que um dia discorda da soma.
-- ---------------------------------------------------------------------------
CREATE TABLE caixas_do_dia (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id   uuid NOT NULL REFERENCES clinicas(id),
  dia          date NOT NULL,
  obs          text NOT NULL DEFAULT '' CHECK (length(obs) <= 160),
  fechado_por  uuid NOT NULL REFERENCES pessoas(id),
  fechado_em   timestamptz NOT NULL DEFAULT now()
);

-- UM FECHAMENTO POR DIA. O segundo é recusado pelo banco, não por um `some()`.
CREATE UNIQUE INDEX caixa_por_dia ON caixas_do_dia (clinica_id, dia);

CREATE TABLE caixa_por_forma (
  caixa_id    uuid NOT NULL REFERENCES caixas_do_dia(id),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  forma       text NOT NULL CHECK (forma IN ('Pix','Dinheiro','Cartão de crédito','Cartão de débito')),
  -- O esperado NO MOMENTO DO FECHAMENTO. Fato do evento, não valor derivado:
  -- um recebimento lançado depois, retroativo, mudaria o número e a
  -- conferência deixaria de dizer o que era verdade quando se contou.
  esperado    bigint NOT NULL,
  contado     bigint NOT NULL,
  PRIMARY KEY (caixa_id, forma)
);

-- ---------------------------------------------------------------------------
-- COBRANÇAS — um log de contato, append-only. Não tem soft delete porque não
-- tem exclusão: "a clínica falou com a paciente no dia 12" não se desfaz.
-- ---------------------------------------------------------------------------
CREATE TABLE cobrancas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id   uuid NOT NULL REFERENCES clinicas(id),
  paciente_id  uuid NOT NULL REFERENCES pacientes(id),
  canal        text NOT NULL CHECK (canal IN ('WhatsApp','Telefone','Presencial','Outro')),
  em           timestamptz NOT NULL DEFAULT now(),
  por          uuid NOT NULL REFERENCES pessoas(id)
);
CREATE INDEX cobrancas_por_paciente ON cobrancas (clinica_id, paciente_id, em DESC);

-- ---------------------------------------------------------------------------
-- META DO MÊS — `date` no dia 1, não `text 'aaaa-mm'`: ordenação, janela e
-- aritmética de mês saem de graça, e um mês inválido não entra.
-- ---------------------------------------------------------------------------
CREATE TABLE metas_do_mes (
  clinica_id    uuid NOT NULL REFERENCES clinicas(id),
  competencia   date NOT NULL CHECK (extract(day FROM competencia) = 1),
  valor         bigint NOT NULL CHECK (valor > 0),
  definida_por  uuid NOT NULL REFERENCES pessoas(id),
  definida_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinica_id, competencia)
);

CREATE TABLE configuracao_financeira (
  clinica_id            uuid PRIMARY KEY REFERENCES clinicas(id),
  caixa_responsavel_id  uuid REFERENCES pessoas(id),
  mensagem_de_cobranca  text NOT NULL DEFAULT '' CHECK (length(mensagem_de_cobranca) <= 400),
  atualizada_em         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- O que falta nas tabelas da 0006. Expand, sem tocar no que já existe.
-- ---------------------------------------------------------------------------

-- IDEMPOTÊNCIA DO RECEBIMENTO.
-- A tela desabilita o botão ao enviar; isso é front. Numa conexão de balcão
-- lenta, o duplo toque chega duas vezes ao servidor, e a regra 3 não protege
-- deste caso: são duas tarefas companheiras diferentes, cada uma com UM
-- recebimento. O índice abaixo é o que faz o reenvio devolver o MESMO
-- recebimento em vez de criar o segundo.
ALTER TABLE recebimentos ADD COLUMN requisicao_id uuid;
CREATE UNIQUE INDEX recebimento_por_requisicao ON recebimentos (clinica_id, requisicao_id)
  WHERE requisicao_id IS NOT NULL;

-- MARCADOR DE ROTINA: liga a tarefa à rotina que a criou ("fechamento-do-mes").
-- Com `prazo` na chave, criar a rotina duas vezes gera o MESMO conjunto de
-- (marcador, prazo) e o segundo `INSERT … ON CONFLICT DO NOTHING` não escreve
-- nada. Idempotência sem lock.
ALTER TABLE tarefas ADD COLUMN marcador text CHECK (length(marcador) <= 40);
CREATE UNIQUE INDEX tarefa_de_rotina ON tarefas (clinica_id, marcador, prazo)
  WHERE marcador IS NOT NULL AND excluida_em IS NULL;

-- ---------------------------------------------------------------------------
-- RLS e trilha, nas seis.
-- ---------------------------------------------------------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['contas_a_pagar','caixas_do_dia','caixa_por_forma',
                           'cobrancas','metas_do_mes','configuracao_financeira'] LOOP
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

- [ ] **Passo 4: Estender `CAMPOS_MONETARIOS`**

Em `packages/domain/src/permissoes.ts`, acrescente os nomes que este épico introduz — e **só** eles:

```ts
'aberto', 'abatido', 'credito', 'contado', 'despesasPagas', 'resultado', 'aPagar',
'fixas', 'variaveis', 'aReceber', 'metaRestante',
```

`valor`, `valorAberto`, `valorPago`, `esperado`, `diferenca`, `meta`, `recebido`, `saldo`, `ltv` **já estão lá**. Confira antes de acrescentar: um nome duplicado é inofensivo, mas um nome que você acrescentou sem precisar é um campo que você nomeou errado.

- [ ] **Passo 5: Aplicar e rodar** — `cd apps/api && npx tsx migrar.ts` aplica a `0007`; `cd teste && npx vitest run financeiro-rls campos-de-dinheiro` → PASS.

- [ ] **Passo 6: Registrar** — em `teste/registro.ts`, acrescente as **seis** tabelas a `ENTIDADES_COM_CLINICA`. **`teste/auditoria-inescapavel.test.ts` varre o catálogo** e reprova tabela com `clinica_id` sem trigger — rode-o e veja passar.

- [ ] **Passo 7: Prova por mutação** — remova `dia_vencimento` do `CONSTRAINT serie_tem_ancora`, reaplique num banco limpo (`fir reset`) e rode: "série sem âncora é recusada" tem de falhar. Restaure.

- [ ] **Passo 8: Commit**

---

## Task 6: Os contratos — e o recebimento que não é uma tarefa com valor

**Files:** `packages/contracts/src/financeiro.ts` · `financeiro.test.ts` · *(modificar)* `index.ts`

**A decisão que esta tarefa fixa:** o que o paciente está pagando é uma **união discriminada** de cinco referências (`REFS_RECEB` do protótipo, linha 4917), não um campo `tipo` livre. Cada referência carrega o que ela — e só ela — aceita.

```ts
// packages/contracts/src/financeiro.ts
export const FORMAS_DE_ENTRADA = ['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito', 'Nota promissória'] as const

/**
 * O QUE o paciente está pagando. União discriminada, e não um `tipo: string`,
 * porque cada referência aceita coisas diferentes:
 *
 *  - `consulta`, `sinal` e `novo` aceitam "ficou valor em aberto";
 *  - `programa` e `saldo` não aceitam — eles ABATEM saldo, não o criam;
 *  - só `programa` tem `programaId`, e ele é obrigatório lá.
 *
 * Com três campos opcionais, "abater saldo criando saldo" compila. Aqui não.
 */
export const Referencia = z.discriminatedUnion('ref', [
  z.object({ ref: z.literal('consulta'), valorAberto: dinheiroEmTexto.optional() }),
  z.object({ ref: z.literal('sinal'),    valorAberto: dinheiroEmTexto.optional() }),
  z.object({ ref: z.literal('novo'),     valorAberto: dinheiroEmTexto.optional() }),
  // `programa` só é aceitável a partir do épico 5. Até lá a rota recusa com
  // "Este paciente não tem programa em andamento." — o mesmo texto da tela.
  z.object({ ref: z.literal('programa'), programaId: Uuid }),
  z.object({ ref: z.literal('saldo') }),
])

export const RegistrarRecebimento = z.object({
  // Gerado pelo CLIENTE, uma vez por formulário aberto. Reenviar devolve o
  // mesmo recebimento (índice `recebimento_por_requisicao`), e é assim que o
  // duplo toque no balcão deixa de dobrar a receita.
  requisicaoId: Uuid,
  pacienteId: Uuid,
  valor: dinheiroEmTexto,
  forma: z.enum(FORMAS_DE_ENTRADA),
  em: DiaCivil,
  obs: z.string().trim().max(200).default(''),
  unidadeId: Uuid.nullish(),
}).and(Referencia)
```

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('"programa em andamento" sem programa é recusado pelo PARSE', () => {
  expect(RegistrarRecebimento.safeParse({ ...BASE, ref: 'programa' }).success).toBe(false)
})

it('abater saldo com "ficou valor em aberto" não compila nem faz parse', () => {
  expect(RegistrarRecebimento.safeParse({ ...BASE, ref: 'saldo', valorAberto: '50000' }).success).toBe(false)
})

it('valor zero é recusado — recebimento de nada não é recebimento', () => { /* … */ })

it('o valor chega como bigint de centavos, nunca como número', () => {
  const r = RegistrarRecebimento.parse({ ...BASE, ref: 'consulta', valor: '45000' })
  expect(r.valor).toBe(45000n)
})

it('a conta a pagar só aceita as categorias do domínio', () => {
  expect(SalvarConta.safeParse({ ...CONTA, categoria: 'Cerveja' }).success).toBe(false)
})

it('a forma de pagamento da CONTA não é a do RECEBIMENTO', () => {
  expect(PagarConta.safeParse({ ...PAG, formaPagamento: 'Boleto' }).success).toBe(true)
  expect(PagarConta.safeParse({ ...PAG, formaPagamento: 'Nota promissória' }).success).toBe(false)
})

it('o contado do caixa não aceita nota promissória', () => {
  expect(FecharCaixa.safeParse({ dia: '2026-10-24', contado: { 'Nota promissória': '100' } }).success).toBe(false)
})

it('nenhuma resposta deste arquivo tem dinheiro dentro de um mapa', () => {
  // Já coberto pela varredura da Task 5; aqui é a leitura humana do mesmo
  // fato, para quem abrir este arquivo primeiro.
  expect(ConferenciaDeCaixa.shape.porForma).toBeInstanceOf(z.ZodArray)
})
```

- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** (`SalvarConta`, `PagarConta`, `FecharCaixa`, `RegistrarCobranca`, `SalvarMeta`, `ConfigFinanceira`, e as respostas `ConferenciaDeCaixa`, `SaldoDoPaciente`, `VisaoDoMes`) · **Passo 4: PASS.** Exporte de `index.ts`.

- [ ] **Passo 5: Commit**

---

## Task 7: O recebimento avulso — a tarefa companheira, e a receita que não dobra

**Files:** `apps/api/src/financeiro/recebimentos.controller.ts` · `recebimentos.service.ts` · `financeiro.module.ts` · `recebimentos.e2e.test.ts` · *(modificar)* `teste/registro.ts`

```
POST   /v1/recebimentos          @Exige('receber')
GET    /v1/recebimentos?dia=&de=&ate=&pacienteId=    @Exige('receber')
DELETE /v1/recebimentos/:id      @Exige('receber')   — ESTORNA, nunca apaga
```

**A costura com o épico 2, e ela é o coração deste plano.** O recebimento avulso **não** é uma linha nova de dinheiro: é a **mesma** `recebimentos` da `0006`, pendurada numa tarefa companheira criada na mesma transação.

```ts
// Uma transação. As duas linhas nascem juntas ou nenhuma nasce.
await banco.naClinica(clinicaId, ator, async (c) => {
  const concluidaEm = exigir(instanteDaConclusao(corpo.em, hojeDaClinica, fuso, relogio.agora()))
  // A tarefa companheira: é ela que faz a ficha do paciente ser UMA linha do
  // tempo, em vez de duas listas que ninguém cruza.
  const tarefa = await inserirTarefa(c, {
    status: 'concluida', concluidaEm, prazo: corpo.em,
    pacienteId: corpo.pacienteId, tipo: TIPO_DA_REFERENCIA[corpo.ref],
    descricao: DESCRICAO_DA_REFERENCIA[corpo.ref],
    solicitanteId: eu, responsavelId: eu, obs: corpo.obs,
  })
  // E o recebimento pendurado nela. O índice `recebimento_por_tarefa` da 0006
  // garante que esta tarefa nunca terá um segundo.
  return inserirRecebimento(c, { tarefaId: tarefa.id, requisicaoId: corpo.requisicaoId, ... })
})
```

**Os quatro tipos que `TIPO_DA_REFERENCIA` produz são todos do grupo Pagamentos** — e o épico 2 já recusa esses tipos em `POST /v1/tarefas` (contrato `tipoQueNaoEhPagamento`). Os dois juntos fecham o cerco: **a única porta para dinheiro é esta rota**, e ela escreve exatamente uma linha de `recebimentos`.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('registrar um recebimento cria UMA tarefa concluída e UM recebimento', async () => {
  const r = await registrar({ ref: 'consulta', valor: '45000', forma: 'Pix' })
  expect(r.statusCode).toBe(201)
  expect(await contarRecebimentosVivos()).toBe(1)
  expect((await tarefaDe(r.json().id)).status).toBe('concluida')
  expect(await receitaDoDia()).toBe(45000n)
})

it('A RECEITA NÃO DOBRA: o pagamento embutido e o avulso do mesmo atendimento não coexistem', async () => {
  // O cenário clássico. A consulta foi concluída COM pagamento (épico 2), e
  // alguém lança o mesmo dinheiro de novo em Recebimentos.
  const consulta = await concluirComPagamento({ pacienteId: ANA, valor: '45000', forma: 'Pix' })
  expect(await receitaDoDia()).toBe(45000n)

  // O avulso cria uma tarefa NOVA, então o índice da 0006 não o impede — e
  // não deve: é um segundo pagamento legítimo se for mesmo outro dinheiro.
  // O que o impede de PASSAR DESPERCEBIDO é a lista dos últimos 7 dias, que
  // vem do servidor e aparece no formulário antes de salvar.
  const aviso = await recebimentosRecentes(ANA)
  expect(aviso).toHaveLength(1)
  expect(aviso[0].tarefaId).toBe(consulta.id)

  // E o índice continua fazendo o que lhe cabe: a MESMA tarefa nunca tem dois.
  await expect(inserirRecebimento({ tarefaId: consulta.id, valor: 45000n })).rejects.toThrow()
  expect(await receitaDoDia()).toBe(45000n)
})

it('o duplo toque não dobra a receita: o mesmo `requisicaoId` devolve o MESMO recebimento', async () => {
  const req = randomUUID()
  const a = await registrar({ requisicaoId: req, valor: '45000' })
  const b = await registrar({ requisicaoId: req, valor: '45000' })
  const d = await registrar({ requisicaoId: req, valor: '45000' })
  expect(b.json().id).toBe(a.json().id)
  expect(d.json().id).toBe(a.json().id)
  expect(await contarRecebimentosVivos()).toBe(1)
  expect(await contarTarefasDe(ANA)).toBe(1)      // nem a tarefa companheira dobra
  expect(await receitaDoDia()).toBe(45000n)
})

it('ORÇAMENTO NÃO É RECEITA: a receita do mês soma `recebimentos`, nunca `tarefas`', async () => {
  await criarOrcamentoEnviado({ pacienteId: ANA, valor: '320000' })
  expect(await receitaDoMes()).toBe(0n)
})

it('a data do recebimento vem do SERVIDOR: "amanhã" é 400', async () => {
  const r = await registrar({ em: amanhaNoFusoDaClinica() })
  expect(r.statusCode).toBe(400)
  expect(r.json().message).toContain('até hoje')
})

it('estornar tira o dinheiro da receita e DEIXA a trilha — nunca um DELETE', async () => {
  const r = await registrar({ valor: '45000' })
  await estornar(r.json().id)
  expect(await receitaDoDia()).toBe(0n)
  expect((await recebimentoCru(r.json().id)).estornado_em).not.toBeNull()
  expect(await trilhaDe('recebimentos', r.json().id)).toContainEqual(expect.objectContaining({ acao: 'alterou' }))
})

it('estornado libera a tarefa companheira e ela some das listas', async () => { /* … */ })

it('"programa em andamento" é 409 enquanto não houver programas — com o texto da tela', async () => {
  const r = await registrar({ ref: 'programa', programaId: randomUUID() })
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toContain('programa em andamento')
})

it('sem `receber`, 403 — e nenhum recebimento é criado', async () => { /* … */ })
it('sem `valores`, a lista traz paciente, forma e data, e `valor` vem `null`', async () => { /* … */ })
it('recebimento de outra clínica não é alcançável nem por id', async () => { /* RLS */ })
it('nenhum log contém valor nem nome de paciente', async () => { /* regra 21 */ })
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — o `ON CONFLICT (clinica_id, requisicao_id) DO NOTHING` seguido de `SELECT` do existente **dentro da mesma transação**; o `instanteDaConclusao` de `@fir/domain` (épico 2, Task 1), não um `new Date()`.

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Registrar** — `POST`/`GET /v1/recebimentos` em `ROTAS_COM_DINHEIRO` com `valor` e `valorAberto`. `teste/redacao-de-valores.test.ts` passa a cobrar que ambos saiam `null` sem `valores`.

- [ ] **Passo 6: Prova por mutação** — remova o `requisicao_id` do `INSERT`. O teste do duplo toque tem de falhar com três recebimentos. Restaure.

- [ ] **Passo 7: Commit**

---

## Task 8: Saldo do paciente e Cobranças — o agrupamento que a cobrança usa

**Files:** `apps/api/src/financeiro/saldo.service.ts` · `cobrancas.controller.ts` · `saldo.e2e.test.ts` · `cobrancas.e2e.test.ts`

```
GET  /v1/pacientes/:id/saldo    @Exige('pacientes')
GET  /v1/cobrancas              @Exige('cobrancas')
POST /v1/cobrancas              @Exige('cobrancas')
```

**O repositório lê eventos; `saldoEmAberto` (Task 1) decide.** O SQL devolve `(programa_id, aberto, abatido)` por recebimento vivo do paciente e nada mais — **não existe** um `SUM()` com `GREATEST(0, …)` no SQL, porque o clamp por grupo e a preservação do crédito são regra, e regra mora em `packages/domain`.

> **Enquanto o épico 5 não chega**, `programa_id` não existe em `recebimentos` e o SQL projeta `NULL`. O resultado é **um grupo**, e a resposta já é a **lista de grupos**. O épico 5 acrescenta a coluna, o `SELECT` passa a projetá-la, e **nem o contrato nem a função mudam**.

`GET /v1/cobrancas` devolve, já ordenado **no servidor**: quem está há mais tempo sem contato primeiro, empate pelo maior saldo — a ordem do protótipo (linha 5994), que é a ordem em que a recepção liga.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('o saldo vem AGRUPADO, nunca num total só', async () => {
  const r = await pedir(`/v1/pacientes/${ANA}/saldo`, cookieDe(ADMIN))
  expect(Array.isArray(r.json().grupos)).toBe(true)
  expect(r.json().grupos[0]).toHaveProperty('aberto')
  expect(r.json().grupos[0]).toHaveProperty('abatido')
})

it('pagar parcialmente um orçamento deixa o resto em aberto — o exemplo do MANUAL cap. 6', async () => {
  // Orçamento de R$ 3.000, entrada de R$ 1.000.
  await registrar({ pacienteId: ANA, ref: 'novo', valor: '100000', valorAberto: '200000' })
  expect((await saldoDe(ANA)).total).toBe('200000')
  // Parcela de R$ 800.
  await registrar({ pacienteId: ANA, ref: 'saldo', valor: '80000' })
  expect((await saldoDe(ANA)).total).toBe('120000')
})

it('sem `valores`, a equipe recebe `temSaldo` e NÃO o número', async () => {
  const r = await pedir(`/v1/pacientes/${ANA}/saldo`, cookieDe(JULIANA))
  expect(r.json().temSaldo).toBe(true)
  expect(r.json().total).toBeNull()
  expect(r.json().grupos[0].saldo).toBeNull()
  // E o número não aparece sob nenhum outro nome, em lugar nenhum do corpo.
  expect(r.body).not.toContain('200000')
})

it('a Cobranças ordena por quem está há mais tempo sem contato', async () => {
  const r = await pedir('/v1/cobrancas', cookieDe(ADMIN))
  expect(r.json().itens.map((x) => x.pacienteId)).toEqual([NUNCA_CONTATADO, CONTATO_ANTIGO, CONTATO_ONTEM])
})

it('"sem contato há 15 dias ou mais" conta no servidor, contra o hoje do SERVIDOR', async () => {
  expect((await pedir('/v1/cobrancas', cookieDe(ADMIN))).json().semContato).toBe(2)
})

it('paciente sem saldo NÃO aparece na Cobranças', async () => { /* … */ })

it('registrar cobrança exige a permissão — o protótipo não exige, e a Enfermagem passou', async () => {
  // Medido no protótipo: `registrarCobranca` como Camila (perfil Enfermagem)
  // devolveu ok. Aqui é 403.
  const r = await registrarCobranca(ANA, cookieDe(CAMILA_ENFERMAGEM))
  expect(r.statusCode).toBe(403)
})

it('a mensagem de cobrança monta no SERVIDOR e não leva valor nenhum', async () => {
  const r = await pedir(`/v1/cobrancas/${ANA}/mensagem`, cookieDe(JULIANA))
  expect(r.json().texto).toContain('valor em aberto')
  expect(r.json().texto).not.toMatch(/\d{2,}/)     // nenhum número na mensagem
})

it('a cobrança de outra clínica não é alcançável', async () => { /* RLS */ })
```

- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** · **Passo 4: PASS**

- [ ] **Passo 5: Registrar** — as três rotas em `ROTAS_COM_DINHEIRO` (`saldo`, `aberto`, `abatido`, `credito`, `total`, `aReceber`).

- [ ] **Passo 6: Prova por mutação** — faça o SQL devolver um `SUM()` já agrupado só por paciente. O primeiro teste e o do orçamento parcial têm de falhar. Restaure. **É a mutação que a regra 5 existe para pegar.**

- [ ] **Passo 7: Commit**

---

## Task 9: O caixa do dia — e o teste que prova a regra 6 no transporte

**Files:** `apps/api/src/financeiro/caixa.controller.ts` · `caixa.service.ts` · `caixa.e2e.test.ts` · **`teste/transporte-as-cegas.test.ts`** · *(modificar)* `teste/registro.ts`

```
GET  /v1/caixa?dia=    @Exige('caixa')
POST /v1/caixa         @Exige('caixa')   — fechar
```

**Esta é a tarefa pela qual o épico será julgado.** Leia "O que a regra 6 alcança, e o que não", acima, antes do primeiro passo.

A forma da resposta, e ela é a regra:

```ts
// DIA ABERTO — a chave `esperado` NÃO EXISTE. Não é null, não é redigida.
{ dia: '2026-10-24', fechado: false, formas: ['Pix','Dinheiro','Cartão de crédito','Cartão de débito'],
  responsavel: { id: '…', nome: 'Juliana Santos' } }

// DIA FECHADO — e agora sim.
{ dia: '2026-10-24', fechado: true, conferido: false,
  fechadoPor: { id, nome }, fechadoEm: '…', obs: '',
  // ARRAY, não mapa: o interceptor redige por NOME DE CHAVE (ver a seção
  // "dinheiro mora num campo com nome registrado").
  porForma: [{ forma: 'Pix', esperado: '45000', contado: '45000', diferenca: '0' }, …],
  diferenca: '-5000',
  // Informativo, fora da conferência.
  promissorias: { quantidade: 1, valor: '120000' } }
```

**`conferido` é booleano e derivado, e é ele — não `diferenca` — que a recepcionista sem `valores` lê.** Mostrar a diferença a quem digitou o contado é mostrar o esperado por subtração: ela sabe o que contou. É a divergência #6, e vira a ADR `0004`.

- [ ] **Passo 1: Escrever o teste da regra 6 — este primeiro, antes de qualquer outro**

```ts
// teste/transporte-as-cegas.test.ts
const DIA = '2026-10-24'

it('O ESPERADO NÃO ATRAVESSA ANTES DO FECHAMENTO — nem para quem pode tudo', async () => {
  await registrarRecebimento({ valor: '45000', forma: 'Pix', em: DIA })
  await registrarRecebimento({ valor: '12000', forma: 'Dinheiro', em: DIA })

  // O usuário MAIS privilegiado do sistema. A redação de valores não é a
  // defesa aqui: quem fecha o caixa COM `valores` continua precisando
  // conferir às cegas, e um teste feito com usuário fraco provaria a regra
  // 17, não a regra 6.
  const r = await pedir(`/v1/caixa?dia=${DIA}`, cookieDe(ADMIN))
  expect(r.statusCode).toBe(200)
  expect(JSON.parse(r.body).fechado).toBe(false)

  // 1. A chave não existe. `null` não serve: um campo redigido conta ao
  //    cliente que existe um número ali, e o próximo refactor o "conserta".
  const chaves = chavesProfundas(JSON.parse(r.body))
  expect(chaves).not.toContain('esperado')
  expect(chaves).not.toContain('diferenca')
  expect(chaves).not.toContain('porForma')

  // 2. E o NÚMERO não aparece no corpo, sob nome nenhum. É esta asserção que
  //    pega o campo renomeado — `total`, `resumo`, `_debug`, ou um agregado
  //    "por forma" que é o esperado com outra etiqueta.
  for (const n of ['45000', '12000', '57000', '450,00', '120,00', '570,00']) {
    expect(r.body, `o corpo do caixa ABERTO contém ${n}`).not.toContain(n)
  }
})

it('nenhuma OUTRA rota devolve agregado por forma de um dia com caixa aberto', async () => {
  // Varredura: `ROTAS_DE_CONFERENCIA` lista as rotas que tocam o dia. Cada
  // plano novo acrescenta aqui, e esquecer é o que este teste existe para
  // pegar — o agregado por forma de um dia aberto É o esperado.
  for (const rota of ROTAS_DE_CONFERENCIA) {
    const r = await pedir(rota.caminho.replace(':dia', DIA), cookieDe(ADMIN))
    expect(chavesProfundas(JSON.parse(r.body)), rota.caminho).not.toContain('porForma')
    expect(r.body, rota.caminho).not.toContain('57000')
  }
})

it('depois do fechamento, o esperado aparece — é a comparação que a clínica veio ver', async () => {
  await fechar(DIA, { Pix: '45000', Dinheiro: '7000' })
  const r = await pedir(`/v1/caixa?dia=${DIA}`, cookieDe(ADMIN))
  expect(JSON.parse(r.body).fechado).toBe(true)
  expect(JSON.parse(r.body).porForma.find((x) => x.forma === 'Dinheiro').diferenca).toBe('-5000')
})

it('a recepcionista sem `valores` recebe `conferido`, e NENHUM número', async () => {
  await fechar(DIA, { Pix: '45000', Dinheiro: '7000' })
  const r = await pedir(`/v1/caixa?dia=${DIA}`, cookieDe(JULIANA))
  expect(JSON.parse(r.body).conferido).toBe(false)
  expect(JSON.parse(r.body).diferenca).toBeNull()
  expect(JSON.parse(r.body).porForma[0].esperado).toBeNull()
  // Inclusive a DIFERENÇA: ela sabe o que contou; a diferença lhe daria o
  // esperado por subtração. Medido no protótipo, onde ela recebia os dois.
  expect(r.body).not.toContain('5000')
})
```

- [ ] **Passo 2: Rodar e ver falhar** — a rota não existe.

- [ ] **Passo 3: Escrever os testes do fechamento**

```ts
it('o esperado é calculado no SERVIDOR, sobre os recebimentos do dia na janela da clínica', async () => {
  await registrarRecebimentoEm('2026-10-24T23:59:59.999-03:00', '45000', 'Pix')
  await registrarRecebimentoEm('2026-10-25T00:00:00.000-03:00', '99900', 'Pix')
  const r = await fechar('2026-10-24', { Pix: '45000' })
  expect(r.json().porForma.find((x) => x.forma === 'Pix').esperado).toBe('45000')
  expect(r.json().conferido).toBe(true)
})

it('as bordas são do fuso DA CLÍNICA, não de UTC', async () => { /* duas clínicas, fusos diferentes */ })

it('nota promissória não entra no caixa — nem no esperado, nem no contado', async () => {
  await registrarRecebimento({ valor: '120000', forma: 'Nota promissória', em: DIA })
  const r = await fechar(DIA, { Pix: '0' })
  expect(r.json().porForma.map((x) => x.forma)).not.toContain('Nota promissória')
  expect(r.json().conferido).toBe(true)                 // a promissória não cria diferença
  expect(r.json().promissorias.valor).toBe('120000')    // mas aparece, à parte
})

it('o recebimento ESTORNADO sai do esperado', async () => { /* … */ })

it('um fechamento por dia: o segundo é 409, e o primeiro fica intacto', async () => {
  await fechar(DIA, { Pix: '45000' })
  const r = await fecharCru(DIA, { Pix: '1' })
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toContain('já foi fechado')
  expect((await caixaDe(DIA)).porForma.find((x) => x.forma === 'Pix').contado).toBe('45000')
})

it('fechar o caixa de amanhã é 400', async () => { /* data de negócio do servidor */ })

it('sem a permissão `caixa`, 403 — o protótipo não checa, e a Enfermagem fechou', async () => {
  // Medido: `demoApiBase({action:'fecharCaixa', uid:'u3'})` devolveu ok:true.
  expect((await fecharCru(DIA, {}, cookieDe(CAMILA_ENFERMAGEM))).statusCode).toBe(403)
})

it('o caixa de outra clínica não é alcançável', async () => { /* RLS */ })
```

- [ ] **Passo 4: Implementar** — o `SELECT` do esperado e o `INSERT` do caixa **na mesma transação**, para que um recebimento gravado no meio não caia fora dos dois lados. `esperadoDoCaixa` e `conferirCaixa` de `@fir/domain` fazem a aritmética; o serviço só busca e grava.

- [ ] **Passo 5: PASS**

- [ ] **Passo 6: Registrar** — `GET`/`POST /v1/caixa` em `ROTAS_COM_DINHEIRO`, e **em `ROTAS_DE_CONFERENCIA`** (lista nova em `teste/registro.ts`, com o comentário dizendo o que ela é: *"rotas que tocam um dia cujo caixa pode estar aberto"*).

- [ ] **Passo 7: Prova por mutação — duas, e as duas são obrigatórias**
  1. Faça `GET /v1/caixa` devolver `esperado` também com o dia aberto. **O primeiro teste tem de falhar nas duas asserções** (chave e número). Restaure.
  2. Renomeie `esperado` para `previsto` no dia aberto, mantendo o valor. **A asserção de chave passa e a do número falha** — que é exatamente o motivo de a segunda existir. Restaure.

- [ ] **Passo 8: Escrever a ADR `0004`** — contexto (o protótipo entrega `esperado` e `diferenca` a quem não tem `valores`, medido), decisão (`conferido` booleano para a equipe; os valores só com `valores`), consequências (a recepcionista vê "com diferença" e não quanto; a conversa sobre o valor passa pelo administrativo — que é o que o MANUAL já diz em Cobranças), alternativa rejeitada (entregar a diferença: ela revela o esperado por subtração a quem digitou o contado).

- [ ] **Passo 9: Commit**

---

## Task 10: Contas a pagar — o ritual, a recorrência e o lembrete na tela Hoje

**Files:** `apps/api/src/financeiro/contas.controller.ts` · `contas.service.ts` · `contas.e2e.test.ts` · *(modificar)* `apps/api/src/hoje/hoje.controller.ts`

```
GET    /v1/contas?situacao=&mes=    @Exige('contas')
POST   /v1/contas                   @Exige('contas.gerir')
PATCH  /v1/contas/:id               @Exige('contas.gerir')
DELETE /v1/contas/:id               @Exige('contas.gerir')   — soft delete
POST   /v1/contas/:id/pagar         @Exige('contas')         — + dono ou `contas.gerir`
```

**`contas` e `contas.gerir` são dois alcances, não dois níveis.** Com `contas`, a pessoa vê e paga **as dela**. Com `contas.gerir`, vê e paga **todas**, e cadastra. O protótipo faz exatamente isso (`if (!mePode('contas.gerir') && c.responsavelId!==me.id)`), e a diferença importa: a conta do pró-labore não aparece para a recepção.

E a tela Hoje ganha o bloco do financeiro, **montado no servidor**:

```ts
// GET /v1/hoje passa a devolver:
financeiro: {
  // Só se EU sou a responsável pelo caixa (ou tenho `finmes` e estou no
  // filtro "todas") e o caixa de hoje ainda não foi fechado. Booleano — e
  // nenhum valor, obviamente (regra 6).
  caixaPendente: boolean,
  // As minhas contas que vencem em até 3 dias, mais as já vencidas.
  // "3 dias" é do MANUAL cap. 14, e a conta é do SERVIDOR.
  contas: [{ id, descricao, categoria, vencimento, valor, vencida, responsavel }],
}
```

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('conta mensal do dia 31 gera a do mês seguinte no DIA 31 — e volta ao 31 depois de fevereiro', async () => {
  const c = await criarConta({ descricao: 'Aluguel', vencimento: '2026-12-31', mensal: true })
  const p1 = await pagar(c.id, { em: hojeDaClinica(), valor: '650000' })
  expect(p1.json().proxima.vencimento).toBe('2027-01-31')
  const p2 = await pagar(p1.json().proxima.id, { em: hojeDaClinica(), valor: '650000' })
  expect(p2.json().proxima.vencimento).toBe('2027-02-28')
  const p3 = await pagar(p2.json().proxima.id, { em: hojeDaClinica(), valor: '650000' })
  expect(p3.json().proxima.vencimento).toBe('2027-03-31')   // o protótipo diz 28/03
})

it('pagar duas vezes NÃO gera duas contas — a segunda é 409', async () => {
  const c = await criarConta({ mensal: true })
  await pagar(c.id, { em: hojeDaClinica(), valor: '100000' })
  const r = await pagar(c.id, { em: hojeDaClinica(), valor: '100000' })
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toContain('já foi paga')
  expect(await contarContasDaSerie(c.serieId)).toBe(2)   // a paga e a próxima, nada mais
})

it('duas abas pagando a mesma conta ao mesmo tempo geram UMA próxima', async () => {
  // O `if (!F.contas.some(...))` do protótipo perde esta corrida. O índice
  // `conta_da_serie_por_mes` não perde.
  const c = await criarConta({ mensal: true })
  const [a, b] = await Promise.allSettled([pagar(c.id, PAG), pagar(c.id, PAG)])
  expect([a, b].filter((x) => x.status === 'fulfilled' && x.value.statusCode === 200)).toHaveLength(1)
  expect(await contarContasDaSerie(c.serieId)).toBe(2)
})

it('valor pago diferente do valor da conta é o que entra no mês', async () => {
  const c = await criarConta({ valor: '98000' })
  await pagar(c.id, { em: hojeDaClinica(), valor: '101200' })
  expect((await visaoDoMes()).despesasPagas).toBe('101200')
})

it('data de pagamento no futuro é 400', async () => { /* data de negócio do servidor */ })

it('quem tem só `contas` vê as suas, e a de outra pessoa é 404 — não 403', async () => {
  // 403 confirmaria que a conta existe e quanto custa o pró-labore.
  expect((await pedir(`/v1/contas/${DO_PROLABORE}`, cookieDe(JULIANA))).statusCode).toBe(404)
})

it('quem tem só `contas` não cadastra: 403', async () => { /* … */ })

it('conta PAGA não se exclui — 409, com a saída na mensagem', async () => {
  const c = await criarConta({}); await pagar(c.id, PAG)
  const r = await excluir(c.id)
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toContain('faz parte do resultado do mês')
})

it('excluir é soft delete: a conta some das listas e a trilha fica', async () => { /* regra 20 */ })

it('a tela Hoje avisa 3 dias antes — e o corte é do SERVIDOR, no fuso da clínica', async () => {
  await criarConta({ vencimento: somarDias(hojeDaClinica(), 3), responsavelId: EU })
  await criarConta({ vencimento: somarDias(hojeDaClinica(), 4), responsavelId: EU })
  expect((await hoje()).financeiro.contas).toHaveLength(1)
})

it('a tela Hoje avisa o caixa pendente — e NÃO manda número nenhum junto', async () => {
  const r = await hoje(cookieDe(RESPONSAVEL_PELO_CAIXA))
  expect(r.financeiro.caixaPendente).toBe(true)
  expect(JSON.stringify(r.financeiro)).not.toMatch(/esperado|porForma/)
})

it('a conta de outra clínica não é alcançável', async () => { /* RLS */ })
```

- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** — `proximoVencimento` de `@fir/domain`; o `INSERT` da próxima com `ON CONFLICT ON CONSTRAINT conta_da_serie_por_mes DO NOTHING`, **na mesma transação** do pagamento.

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Registrar** — as cinco rotas e `GET /v1/hoje` em `ROTAS_COM_DINHEIRO`.

- [ ] **Passo 6: Prova por mutação** — troque o `ON CONFLICT` por `INSERT` puro. O teste das duas abas tem de falhar com violação de único (ou, pior, com três contas). Restaure.

- [ ] **Passo 7: Commit**

---

## Task 11: Meta, configuração e a Visão do mês — e o percentual que atravessa sozinho

**Files:** `apps/api/src/financeiro/visao-do-mes.controller.ts` · `meta.controller.ts` · `config.controller.ts` · `visao-do-mes.e2e.test.ts`

```
GET    /v1/visao-do-mes?mes=            @Exige('finmes')
PUT    /v1/metas/:mes                   @Exige('finmes')
DELETE /v1/metas/:mes                   @Exige('finmes')
GET    /v1/metas/:mes/percentual        — SEM @Exige: é o que a equipe lê em Recebimentos
GET    /v1/configuracoes/financeiro     @Exige('finmes')
PATCH  /v1/configuracoes/financeiro     @Exige('finmes')
```

**`finmes` depende de `valores`, e isso não é um `if` neste arquivo.** A dependência vive em `PERMS` (`['Financeiro','finmes',…,'valores']`), `temPerm` a resolve, e o guard chama `temPerm`. Um teste prova que marcar `finmes` sem `valores` não abre a rota — e esse teste existe para que ninguém "conserte" a tabela um dia.

**A meta sem `valores` entrega só o percentual, e é o interceptor que faz isso.** A rota devolve `{ meta, recebido, percentual }`; `meta` e `recebido` já estão em `CAMPOS_MONETARIOS`, então saem `null`; `percentual` não é monetário e atravessa. **Zero linhas de código novo** — e a tarefa é provar isso, não construí-lo.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('a equipe sem `valores` lê o percentual da meta, e só ele', async () => {
  await definirMeta('2026-10', '1200000')
  await registrarRecebimento({ valor: '792000', em: '2026-10-24' })
  const r = await pedir('/v1/metas/2026-10/percentual', cookieDe(JULIANA))
  expect(r.json().percentual).toBe(66)
  expect(r.json().meta).toBeNull()
  expect(r.json().recebido).toBeNull()
  expect(r.body).not.toContain('1200000')
  expect(r.body).not.toContain('792000')
})

it('`finmes` sem `valores` NÃO abre a Visão do mês — a dependência está na tabela', async () => {
  const perfil = await criarPerfil({ perms: ['finmes'] })      // sem `valores`
  expect((await pedir('/v1/visao-do-mes?mes=2026-10', cookieDe(perfil))).statusCode).toBe(403)
})

it('o mês é uma janela SEMIABERTA, com as bordas no fuso da clínica', async () => {
  await registrarRecebimentoEm('2026-09-30T23:59:59.999-03:00', '10000')
  await registrarRecebimentoEm('2026-10-01T00:00:00.000-03:00', '20000')
  await registrarRecebimentoEm('2026-10-31T23:59:59.999-03:00', '30000')
  await registrarRecebimentoEm('2026-11-01T00:00:00.000-03:00', '40000')
  expect((await visaoDoMes('2026-10')).recebido).toBe('50000')
})

it('o mês anterior usa EXATAMENTE a mesma regra de janela dos dois lados', async () => {
  // A comparação "vs. setembro" é inútil se os dois meses forem medidos com
  // réguas diferentes — e é o jeito mais discreto de um relatório mentir.
  const v = await visaoDoMes('2026-10')
  expect(v.mesAnterior.recebido).toBe((await visaoDoMes('2026-09')).recebido)
})

it('"a pagar até o fim do mês" inclui as VENCIDAS de meses anteriores', async () => {
  // É o que o protótipo faz (`mesDe(c.vencimento) <= m`), e é o que a clínica
  // precisa ver: a conta de agosto que ninguém pagou não some em outubro.
  await criarConta({ vencimento: '2026-08-10' })
  expect((await visaoDoMes('2026-10')).aPagar).toBe('...')
})

it('despesas por categoria somam o total, e fixas + variáveis também', async () => { /* … */ })

it('a Visão do mês conta os caixas fechados e as diferenças do mês', async () => {
  const v = await visaoDoMes('2026-10')
  expect(v.caixa).toEqual({ fechados: 3, diasUteis: 18, comDiferenca: 1, diferenca: '-5000' })
})

it('"recebido por forma" é ARRAY, e cada valor é redigido sem `valores`', async () => {
  const r = await pedir('/v1/visao-do-mes?mes=2026-10', cookieDe(ADMIN))
  expect(Array.isArray(r.json().porForma)).toBe(true)
  expect(r.json().porForma[0]).toHaveProperty('valor')
})

it('a rotina mensal de fechamento nasce UMA vez, mesmo com dois toques', async () => {
  await criarRotinaDeFechamento()
  await criarRotinaDeFechamento()
  expect(await contarTarefasComMarcador('fechamento-do-mes')).toBe(12)
})

it('o responsável pelo caixa precisa estar ATIVO', async () => { /* Code.gs:355, mesmo espírito */ })
it('a meta de outra clínica não é alcançável', async () => { /* RLS */ })
```

- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** — `visaoDoMes` de `@fir/domain` faz a agregação; o serviço faz **as consultas e a janela**, e `janela(de, ate, clinica.fuso)` de `relogio.ts` faz as bordas.

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Registrar** — as rotas em `ROTAS_COM_DINHEIRO`, com **todos** os campos: `recebido`, `despesasPagas`, `resultado`, `aPagar`, `aReceber`, `meta`, `metaRestante`, `fixas`, `variaveis`, `valor`, `diferenca`.

- [ ] **Passo 6: Prova por mutação** — remova a dependência `'valores'` da linha de `finmes` em `PERMS`. O segundo teste tem de falhar. Restaure. **É a prova de que a dependência mora na tabela.**

- [ ] **Passo 7: Commit**

---

## Task 12: As telas — Recebimentos e Caixa do dia

**Files:** `apps/web/src/app/(app)/recebimentos/page.tsx` · `caixa/page.tsx` · `apps/web/src/components/linha-de-recebimento.tsx` · *(modificar)* `apps/web/src/lib/menu.ts` · `nova/page.tsx`

**Leia `docs/design.md` antes, e rode a auditoria da seção 5 no fim.**

- [ ] **Passo 1: `+ Recebimento` como ação fixa na lateral**

Em `menu.ts`, ao lado de `+ Nova tarefa`, **com o mesmo estilo de ação** (não de item de menu) e `perm: 'receber'`. Não é uma tela a mais no grupo Financeiro — é um atalho permanente, porque registrar pagamento é a coisa mais frequente que a recepção faz depois de criar tarefa. E o grupo **Financeiro** ganha as cinco telas: Recebimentos · Caixa do dia · Contas a pagar · Cobranças · Visão do mês.

Em `nova/page.tsx`, **habilite o link** da dica *"Recebeu dinheiro do paciente? Não é tarefa: use Recebimento."* — o épico 2 o deixou desabilitado com "em breve".

- [ ] **Passo 2: Recebimentos**

A ordem da tela é a do protótipo, e ela é a ordem da conversa no balcão:

```
Meta do mês (barra + percentual)          ← percentual sempre; valor só com `valores`
Dica: "Atendimento é tarefa; dinheiro é recebimento."
Paciente  (busca, com "+ Cadastrar … como novo paciente")
  ↓ escolhido
  Recebimentos deste paciente nos últimos 7 dias   ← o aviso contra lançar duas vezes
  Paciente com saldo em aberto (quando houver)
  O que o paciente está pagando?  [5 opções, cada uma com explicação]
  Valor · Forma · Data · (Ficou valor em aberto?)
  Unidade · Observação
Recebimentos de hoje (N)
```

O que não pode faltar, e cada um tem razão:
- **A lista dos últimos 7 dias vem do servidor** e aparece **antes** do campo de valor. É a defesa de produto contra a receita dobrada, e ela só funciona se estiver no caminho, não numa aba.
- **`requisicaoId` é gerado ao abrir o formulário**, não ao enviar. Gerado no envio, o duplo toque produz dois ids e o índice não serve para nada.
- **"Programa em andamento" aparece desabilitado**, com o texto do protótipo: *"Este paciente não tem programa em andamento."* Até o épico 5, sempre.
- A entrada é texto; **a saída sai de `formatarDinheiro`** (`@fir/domain`). Nenhum `toFixed`, nenhum `Intl` direto, nenhum `if` escondendo dinheiro — o servidor já devolveu `null`. **Algarismos tabulares.**

- [ ] **Passo 3: Caixa do dia**

Dia (até hoje) · Responsável pelo fechamento (só com `finmes`) · os **quatro** campos · Observação · **Fechar caixa**. Depois do fechamento, a tabela de comparação e os "Últimos fechamentos".

**O que a tela NÃO faz, e é o ponto inteiro:** ela não busca o esperado, não o guarda em estado, não o esconde com CSS. Ele **não está na resposta**. Se o seu componente tem um `if (fechado)` sobre um campo de valor, ou a API está errada ou você está reimplementando o controle no lugar onde ele não funciona.

Sem `valores`, a tela mostra **"conferido"** ou **"com diferença"** e o texto *"Confira com o administrativo"* — nunca um valor, nem a diferença.

- [ ] **Passo 4: Estados** — carregando (sem deslocar o conteúdo quando terminar), erro (com "Ir para Hoje" e "Recarregar") e vazio. O vazio de Recebimentos é a primeira tela que toda clínica nova vê neste módulo.

- [ ] **Passo 5: Auditoria de `design.md` §5**, item a item — inclusive abrir em 390 px e **contar os toques** do fluxo "balcão → registrar R$ 450 em Pix para a Maria". O critério é: **quatro toques e dois campos**, com a paciente já cadastrada.

- [ ] **Passo 6: Commit**

---

## Task 13: As telas — Contas a pagar, Cobranças e Visão do mês

**Files:** `apps/web/src/app/(app)/contas/page.tsx` · `cobrancas/page.tsx` · `visao-do-mes/page.tsx` · *(modificar)* `hoje/page.tsx` · `menu.ts`

- [ ] **Passo 1: Contas a pagar** — os quatro grupos na ordem do protótipo (**Vencidas** · Próximos 7 dias · Ainda neste mês · Pagas em <mês>), o formulário com categoria em `<optgroup>` **Despesas fixas / Despesas variáveis** e a descrição da categoria embaixo do campo, e o painel "Registrar pagamento" **dentro da linha**, não num modal.

  Quem tem só `contas` vê a nota *"Aparecem aqui as contas que estão sob sua responsabilidade."* e não vê "Nova conta".

- [ ] **Passo 2: Cobranças** — dois indicadores (saldo a receber **ou**, sem `valores`, a contagem de pacientes; e "sem contato há 15 dias ou mais"), a lista já ordenada pelo servidor, e três ações por linha: **Lembrar pelo WhatsApp** (abre a mensagem pronta, **sem valor nenhum no texto**, e registra o contato) · **Recebeu** (leva ao Recebimento daquele paciente) · **Ficha**.

- [ ] **Passo 3: Visão do mês** — seletor de mês (12 meses), meta editável, e os cinco indicadores: Recebido · Despesas pagas · Resultado · A pagar até o fim do mês · Saldo a receber, cada um com a comparação ao mês anterior. Depois: Despesas por categoria (barras, fixas × variáveis, percentual e mês anterior), Recebido por forma, e o resumo dos caixas do mês. Mais **Imprimir** e **Criar rotina mensal de fechamento**.

  **Nenhum desses números é somado no front.** Todos vêm prontos de `GET /v1/visao-do-mes`. A barra da meta recebe o percentual, não a divisão.

- [ ] **Passo 4: O bloco Financeiro na tela Hoje** — "Fechar o caixa de hoje" e as contas dos próximos 3 dias, com **"Paguei"** levando direto ao painel de pagamento. Os dois vêm de `GET /v1/hoje`, já filtrados.

- [ ] **Passo 5: `menu.ts`** — `epico` vira `null` nas cinco telas. **`menu-vs-telas.test.ts` vai cobrar** — ele confronta o menu com as páginas no disco.

- [ ] **Passo 6: Auditoria de `design.md` §5** nas três. Atenção em Visão do mês: é a tela com mais colunas de número do produto, e **algarismos tabulares** não são opcionais em nenhuma delas.

- [ ] **Passo 7: Commit**

---

## Task 14: Fechamento

- [ ] `docs/paridade.md`: `fecharCaixa`, `salvarConta`, `excluirConta`, `pagarConta`, `registrarCobranca`, `finConfig`, `salvarMetaFin` → ✅. Na coluna "Nota", as divergências decididas: `fecharCaixa` passa a exigir `caixa`; `registrarCobranca` passa a exigir `cobrancas`; `excluirConta` vira soft delete e recusa conta paga; a recorrência mensal ganha âncora.
- [ ] `docs/adr/0004-conferencia-de-caixa-sem-valores.md` escrita e referenciada na linha de `fecharCaixa`.
- [ ] `CONTEXT.md`: `Conta a pagar` e `Marcador de rotina` definidos, com invariantes. `Saldo em aberto` ganha a frase sobre o **crédito preservado**.
- [ ] `teste/registro.ts`: `ENTIDADES_COM_CLINICA` com as seis tabelas novas; `ROTAS_COM_DINHEIRO` com as rotas deste plano; **`ROTAS_DE_CONFERENCIA`** criada e com `GET /v1/caixa` e `GET /v1/recebimentos`.
- [ ] `docs/dividas.md`: registrar que **`teste/receita-nao-dobra`** precisa ganhar o caso do `valor_orcamento` **quando o épico 3 criar a coluna** — hoje a regra 4 é satisfeita por construção (a receita não lê `tarefas`), e é exatamente por isso que ninguém vai lembrar. **Gatilho: a primeira migration do épico 3.**
- [ ] `docs/dividas.md`: registrar que o **agrupamento por programa entrega um grupo só** até o épico 5 preencher `recebimentos.programa_id`, e que a coluna entra por expand sem tocar no contrato. **Gatilho: a primeira tarefa do épico 5.**
- [ ] `npx turbo run typecheck test --force`, **três vezes** — determinismo não se afirma, se observa.
- [ ] Commit

---

## Auto-revisão

**Cobre de `paridade.md`:** `fecharCaixa` · `salvarConta` · `excluirConta` · `pagarConta` · `registrarCobranca` · `finConfig` · `salvarMetaFin`. **7 das 59.** Mais as cinco telas do grupo Financeiro e o atalho **+ Recebimento** na lateral, que é ação e não tela.

**Os quatro invariantes, e onde cada um é provado:**

| Regra | Onde vive | O teste que a prova |
|---|---|---|
| **3** — cada pagamento uma vez | Índice `recebimento_por_tarefa` (0006) + `requisicao_id` (0007) + a tarefa companheira | Task 7: "A RECEITA NÃO DOBRA" e "o duplo toque não dobra a receita" |
| **4** — orçamento não é receita | **Estrutural:** a receita soma `recebimentos`, e nunca lê `tarefas` | Task 7: "ORÇAMENTO NÃO É RECEITA" |
| **5** — saldo derivado e agrupado | `saldoEmAberto`, função pura sobre eventos | Task 1 (propriedade `saldo − credito === aberto − abatido`) e Task 8 (mutação do `SUM()` por paciente) |
| **6** — o esperado não atravessa | A chave **não existe** no corpo do dia aberto | Task 9: `teste/transporte-as-cegas.test.ts`, com o usuário mais privilegiado, asserção no **corpo cru** e **duas** provas por mutação |

**Regras do `CLAUDE.md` exercitadas:** 1 (todas) · 3 e 4 (Tasks 6, 7) · 5 (Tasks 1, 8) · 6 (Tasks 2, 9, 12) · 7 (Tasks 12, 13) · 16 (Tasks 7–11) · 17 (Tasks 5, 9, 11) · 19 e 20 (Task 5) · 21 (Tasks 7, 8) · 22, 23 e 24 (Tasks 9, 10, 11) · 25 (Tasks 3, 10).

**Property-based:** Tasks 1, 2, 3 e 4. **Não há divisão de valor neste épico** — `Dinheiro.ratear` não é usado, e dizê-lo é parte do trabalho: a propriedade `max − min <= 1` não tem onde se aplicar aqui, e inventar um uso para ela seria pior que não a ter. As propriedades obrigatórias são as de **fechamento de totais** (a soma dos grupos é o total; a soma das categorias é o total de despesas; a soma das diferenças por forma é a diferença) — e são elas que pegam o erro real deste módulo, que é uma linha sumir da soma.

**Fora de escopo, de propósito:**

- **Programa** em tudo que toca dinheiro: escolher o programa no recebimento, o modo saldo abatendo por sessão, montar o programa no ato da venda ("É um programa de acompanhamento: montar agora"). É o **épico 5**. A forma agrupada do saldo nasce aqui; a coluna `programa_id` em `recebimentos`, não.
- **Orçamento e fechamento** (`valorOrcamento`, o cartão "Fechou" que vira recebimento, `moverEtapa`) — **épico 3**. A Task 7 recebe `ref: 'novo'` e grava o recebimento; o que o épico 3 acrescenta é o caminho que *vem do orçamento*, com o valor em aberto já calculado.
- **Campanha** no recebimento (`campanhaId` e a sugestão *"Sugerida porque a paciente está nessa campanha"*) — **épico 8**. Entra por migration de expand.
- **LTV do paciente** na ficha — depende deste épico e do 5; a soma por paciente é trivial sobre `recebimentos`, mas o número que a clínica reconhece inclui as sessões de programa.
- **Conciliação bancária, DRE, regime de competência, parcelamento de cartão.** O MANUAL abre o capítulo 14 dizendo que o módulo *"não substitui a contabilidade nem o financeiro completo"*, e essa frase é escopo, não modéstia.

**O risco que fica, e ele não é técnico:** a conferência às cegas protege contra olhar o número antes de contar — e **não** contra quem tem `valores` somar a lista do dia. O desenho faz o que cabe ao software (o servidor nunca soma por ela, e a chave não existe no corpo); o resto é operacional: a responsável pelo caixa precisa ser uma pessoa **sem** `valores`, e isso é configuração da clínica, não garantia do código. A Task 11 deixa `caixa_responsavel_id` explícito justamente para que essa escolha seja visível e auditável em vez de acidental. **Vale uma linha no roteiro de implantação** — se a clínica puser o Financeiro como responsável pelo caixa, a conferência vira teatro, e ninguém será avisado.
