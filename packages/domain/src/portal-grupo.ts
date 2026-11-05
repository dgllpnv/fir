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
  /** Soma EXATA das campanhas agrupadas — nunca um total arredondado. */
  readonly resultado: Dinheiro
}

export type CampanhaNoPortal = CampanhaIndividualizada | OutrasCampanhas

/**
 * Agrupa as campanhas pequenas numa única "Outras campanhas" — nunca
 * individualizadas, nunca com nome. A soma da seção inteira (individuais +
 * "Outras") é sempre igual à soma de todas as campanhas de entrada: nenhum
 * centavo de receita desaparece, só o DETALHE de qual campanha pequena o
 * gerou (regra 6 do CLAUDE.md aplicada à reidentificação, não ao caixa).
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
    const soma = pequenas.reduce((acc, c) => acc.mais(c.resultado), Dinheiro.zero())
    saida.push({ tipo: 'outras', quantidade: pequenas.length, resultado: soma })
  }
  return saida
}
