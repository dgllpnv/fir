import type { SituacaoDaMeta } from './meta'

/**
 * OKR: progresso, situação e ordem (CONTEXT.md, `OKR`).
 *
 * O progresso do OKR é a média, meio para cima, dos progressos **inteiros
 * exibidos** dos KRs (números c.12): quem soma a tela chega ao número.
 * 10,5 / 10,5 / 10,4 aparecem como 11 / 11 / 10, e a média deles é 11 — a
 * média exata daria 10, e a tela contradiria a própria conta.
 */
export function progressoDoOkr(progressosExibidos: readonly (number | null)[]): number | null {
  const xs = progressosExibidos.filter((p): p is number => p !== null)
  for (const p of xs) {
    if (!Number.isInteger(p) || p < 0 || p > 100) {
      throw new Error(`progressoDoOkr: progresso exibido é inteiro de 0 a 100, recebeu ${p}`)
    }
  }
  if (xs.length === 0) return null
  const soma = xs.reduce((s, p) => s + p, 0)
  return Math.floor((2 * soma + xs.length) / (2 * xs.length))
}

/** Da pior para a melhor. `sem_dado` não piora nem melhora: só vale quando é tudo o que há. */
const ORDEM: readonly SituacaoDaMeta[] = ['abaixo', 'atencao', 'no_ritmo', 'atingida']

/** A situação do OKR é a PIOR entre os KRs. */
export function situacaoDoOkr(situacoes: readonly SituacaoDaMeta[]): SituacaoDaMeta {
  const comDado: readonly SituacaoDaMeta[] = situacoes.filter((s) => s !== 'sem_dado')
  if (comDado.length === 0) return 'sem_dado'
  return ORDEM.find((s) => comDado.includes(s)) ?? 'sem_dado'
}

/** A lista vai do menor progresso para o maior; sem progresso vai para o fim; empate pelo objetivo. */
export function ordenarOkrs<T extends { readonly progresso: number | null; readonly objetivo: string }>(
  okrs: readonly T[],
): T[] {
  return [...okrs].sort((a, b) => {
    if (a.progresso === null && b.progresso === null) return a.objetivo.localeCompare(b.objetivo, 'pt-BR')
    if (a.progresso === null) return 1
    if (b.progresso === null) return -1
    return a.progresso - b.progresso || a.objetivo.localeCompare(b.objetivo, 'pt-BR')
  })
}
