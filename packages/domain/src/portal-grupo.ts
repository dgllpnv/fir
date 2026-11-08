import { Dinheiro } from './dinheiro'

/**
 * **G6 — PORTAL DO GRUPO.** Spec: `docs/superpowers/plans/g6-spec-portal-do-
 * grupo.md`. Gates: ADR 0017 (LGPD/base legal), ADR 0018 (isolamento).
 *
 * Só a aritmética e as regras de negócio genuinamente PURAS do portal moram
 * aqui — a decisão de QUEM pode ver QUAL `Cliente Firmare`/`Grupo` é tenancy,
 * não regra de negócio, e vive só em Postgres (`app_portal_pode_ver`, ADR
 * 0018 §1): duplicá-la em TypeScript seria a mesma regra escrita duas vezes
 * (CLAUDE.md §5, "a herança que esta arquitetura paga").
 */

// ---------------------------------------------------------------------------
// Ciclo do contrato — mesma lógica de `fg-portal.js:104-113` (spec §3.1.1):
// "mês N de M" quando há prazo, ou "Nº mês juntos" quando não há. G6 só
// modela o segundo caso: `Cliente Firmare` não tem prazo de contrato
// cadastrado hoje (`clientes_carteira` não tem essa coluna) — o primeiro
// ramo fica para quando essa informação existir.
// ---------------------------------------------------------------------------

/**
 * O mês corrente da relação, contado a partir do dia de início (inclusive).
 * `1` no próprio mês de início, `2` no mês seguinte, e assim por diante —
 * nunca `0`, porque não existe "mês zero juntos".
 *
 * Calculado em dias de calendário (UTC, regra 22 do CLAUDE.md) — nunca por
 * diferença de milissegundos dividida por um número de dias por mês, que
 * erraria em meses de 28, 30 e 31 dias.
 */
export function mesesJuntos(inicio: Date, agora: Date): number {
  if (agora.getTime() < inicio.getTime()) {
    throw new Error('a data de referência não pode ser anterior ao início do contrato')
  }
  let meses =
    (agora.getUTCFullYear() - inicio.getUTCFullYear()) * 12 + (agora.getUTCMonth() - inicio.getUTCMonth())
  if (agora.getUTCDate() < inicio.getUTCDate()) meses -= 1
  return Math.max(1, meses + 1)
}

// ---------------------------------------------------------------------------
// Supressão por reidentificação (ADR 0013 §4, confirmada para o portal pela
// ADR 0017 §2 e cobrada como critério de aceite pela ADR 0018 item 5/critério
// 9): campanha com menos de `LIMIAR_ORCAMENTOS_PAGOS` orçamentos pagos nunca
// aparece individualizada — nome e valor somem dentro de "Outras campanhas".
// ---------------------------------------------------------------------------

/** `k = 5` — o mesmo número da ADR 0013 §4, nomeado para não virar mágico. */
export const LIMIAR_ORCAMENTOS_PAGOS = 5

/**
 * `null` conta como "abaixo do limiar" — e de propósito: enquanto o job de
 * sincronização (G4, ainda não escrito) não preenche a contagem real, a
 * leitura mais segura é a que esconde, nunca a que mostra. Mostrar um nome e
 * uma receita "porque a contagem ainda não chegou" é exatamente o vazamento
 * que a regra existe para impedir.
 */
export function deveSuprimirCampanha(
  orcamentosPagos: number | null,
  limiar: number = LIMIAR_ORCAMENTOS_PAGOS,
): boolean {
  return orcamentosPagos === null || orcamentosPagos < limiar
}

export type CampanhaParaSupressao = {
  readonly id: string
  readonly nome: string
  readonly resultado: Dinheiro
  readonly orcamentosPagos: number | null
}

export type CampanhaIndividualizada = {
  readonly tipo: 'individual'
  readonly id: string
  readonly nome: string
  readonly resultado: Dinheiro
}

export type OutrasCampanhas = {
  readonly tipo: 'outras'
  /** Quantas campanhas pequenas foram agrupadas — nunca os nomes delas. */
  readonly quantidade: number
  /**
   * Soma EXATA das campanhas agrupadas — ou `null`, "valor não exibido",
   * quando o próprio balde ainda reidentifica (CE-3, gate de números G8):
   * a soma dos orçamentos pagos agrupados não chega a `k`. O caso que
   * motivou a regra: uma campanha pequena sozinha virava "Outras campanhas
   * (1)" com o valor exato dela — esconder o nome não protegia nada.
   */
  readonly resultado: Dinheiro | null
}

export type CampanhaNoPortal = CampanhaIndividualizada | OutrasCampanhas

/**
 * Agrupa as campanhas pequenas numa única "Outras campanhas" — nunca
 * individualizadas, nunca com nome.
 *
 * SUPRESSÃO COMPLEMENTAR (CE-3, ajuste 26 do gate de números G8): o balde
 * só leva valor quando a SOMA dos orçamentos pagos das campanhas agrupadas
 * chega a `k` (contagem desconhecida conta zero — a leitura segura esconde).
 * Uma campanha só no balde nunca chega lá, porque ela mesma está abaixo de
 * `k`: o agregado de uma célula suprimida é a célula, e também é suprimido.
 *
 * Com o balde exibido, a soma da seção (individuais + "Outras") é igual à
 * soma de todas as campanhas de entrada. Com o balde sem valor, nenhum total
 * pode incluí-lo — senão "total − linhas visíveis" devolve a célula
 * suprimida. Por isso o único total permitido é `totalDasCampanhasExibidas`.
 */
export function agruparCampanhasComSupressao(
  campanhas: readonly CampanhaParaSupressao[],
  limiar: number = LIMIAR_ORCAMENTOS_PAGOS,
): readonly CampanhaNoPortal[] {
  const individuais: CampanhaIndividualizada[] = []
  const pequenas: CampanhaParaSupressao[] = []

  for (const c of campanhas) {
    if (deveSuprimirCampanha(c.orcamentosPagos, limiar)) pequenas.push(c)
    else individuais.push({ tipo: 'individual', id: c.id, nome: c.nome, resultado: c.resultado })
  }

  const saida: CampanhaNoPortal[] = [...individuais]
  if (pequenas.length > 0) {
    const contagemDoBalde = pequenas.reduce((acc, c) => acc + (c.orcamentosPagos ?? 0), 0)
    const resultado =
      contagemDoBalde >= limiar ? pequenas.reduce((acc, c) => acc.mais(c.resultado), Dinheiro.zero()) : null
    saida.push({ tipo: 'outras', quantidade: pequenas.length, resultado })
  }
  return saida
}

/**
 * O ÚNICO total de campanhas que pode ir para a tela: a soma das linhas com
 * valor exibido. `soDasExibidas = true` quando há um balde sem valor — a tela
 * rotula "das campanhas exibidas", porque esse total é menor que a receita
 * real das campanhas, e de propósito (CE-3: incluir o balde suprimido aqui
 * deixaria recuperar a célula por subtração).
 */
export function totalDasCampanhasExibidas(saida: readonly CampanhaNoPortal[]): {
  readonly total: Dinheiro
  readonly soDasExibidas: boolean
} {
  let total = Dinheiro.zero()
  let soDasExibidas = false
  for (const c of saida) {
    if (c.resultado === null) soDasExibidas = true
    else total = total.mais(c.resultado)
  }
  return { total, soDasExibidas }
}

// ---------------------------------------------------------------------------
// O2 — o cartão do ciclo e a saudação (`fg-portal.js` L101–113, G8 3D).
// O G6 só tinha o "Nº mês juntos" a partir de `criado_em`; com o cadastro
// completo (0047, C3) o ciclo usa `data_inicio`/`data_fim`, como o protótipo.
// Tudo em DIA CIVIL (`aaaa-mm-dd`): o "hoje" é o do servidor, no fuso da
// carteira (regra 24), e quem chama o passa.
// ---------------------------------------------------------------------------

export type CicloDoContrato =
  | { readonly tipo: 'programa' }
  | { readonly tipo: 'recorrente'; readonly mes: number; readonly inicio: string }
  | {
      readonly tipo: 'com_fim'
      readonly mes: number
      readonly total: number
      /** A barra: quanto do caminho entre início e fim já passou, 0–100, inteiro. */
      readonly percentual: number
      readonly inicio: string
      readonly fim: string
    }

const DIA_MS = 86_400_000
const diaUtc = (dia: string): number => {
  const [a = 1970, m = 1, d = 1] = dia.slice(0, 10).split('-').map(Number)
  return Date.UTC(a, m - 1, d) / DIA_MS
}
const partes = (dia: string): [number, number, number] => {
  const [a = 1970, m = 1, d = 1] = dia.slice(0, 10).split('-').map(Number)
  return [a, m, d]
}

/** O mês médio do protótipo: `2629800000` ms = 30,4375 dias (portal:L108). Exato em binário (30 + 7/16). */
const DIAS_DO_MES_MEDIO = 30.4375

/**
 * `fg-portal.js` L104–113. O "Mês N" conta como o protótipo: meses de
 * calendário desde o início, mais um quando o dia de hoje já alcançou o dia
 * do início — o mesmo de `mesesJuntos`, sem lançar erro para início futuro
 * (`Math.max(1, …)` do protótipo). Com fim: "Mês min(N, M) de M", M pelo
 * número de meses médios entre as datas, nunca menos que 1.
 */
export function cicloDoContrato(inicio: string | null, fim: string | null, hoje: string): CicloDoContrato {
  if (inicio === null) return { tipo: 'programa' }
  const [ai, mi, di] = partes(inicio)
  const [ah, mh, dh] = partes(hoje)
  const mesN = Math.max(1, (ah - ai) * 12 + (mh - mi) + (dh >= di ? 1 : 0))
  if (fim === null) return { tipo: 'recorrente', mes: mesN, inicio }

  const a = diaUtc(inicio)
  const f = diaUtc(fim)
  const h = diaUtc(hoje)
  const total = Math.max(1, Math.round((f - a) / DIAS_DO_MES_MEDIO))
  const percentual =
    f <= a ? (h >= f ? 100 : 0) : Math.max(0, Math.min(100, Math.round(((h - a) * 100) / (f - a))))
  return { tipo: 'com_fim', mes: Math.min(mesN, total), total, percentual, inicio, fim }
}

/**
 * "Olá, [primeiro nome da decisora]" (portal:L101): as duas primeiras
 * palavras do decisor ou, sem ele, do nome do cliente — "Dra. Cristina",
 * "Ana Paula". `null` quando não há nada a dizer (a tela usa "seja bem vinda").
 */
export function nomeDaSaudacao(decisor: string | null, nomeDoCliente: string): string | null {
  const fonte = decisor !== null && decisor.trim() !== '' ? decisor : nomeDoCliente
  const palavras = fonte.trim().split(/\s+/).filter((p) => p.length > 0)
  return palavras.length === 0 ? null : palavras.slice(0, 2).join(' ')
}
