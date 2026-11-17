/**
 * **ANIVERSARIANTES** (relatório 7; LGPD L-IN-6): o relatório mostra o DIA E
 * O MÊS e a IDADE — nunca a data completa de nascimento. As duas contas moram
 * aqui para a tela e o servidor não as escreverem duas vezes.
 *
 * Datas são dias civis `aaaa-mm-dd`; `hoje` é o dia da CLÍNICA, do relógio do
 * servidor (regras 22 e 24). Aritmética de calendário em texto, sem `Date`.
 */

/** `aaaa-mm-dd` → `dd/mm`. */
export const diaEMesDoAniversario = (nascimento: string): string => `${nascimento.slice(8, 10)}/${nascimento.slice(5, 7)}`

/**
 * Os anos completos em `hoje`. Quem faz anos em 29/02 completa o ano em 01/03
 * nos anos não bissextos (o dia 28 ainda não é o aniversário). Nascimento no
 * futuro — cadastro errado — é `null`, nunca uma idade negativa.
 */
export function idadeEm(nascimento: string, hoje: string): number | null {
  if (nascimento > hoje) return null
  const anos = Number(hoje.slice(0, 4)) - Number(nascimento.slice(0, 4))
  return hoje.slice(5) < nascimento.slice(5) ? anos - 1 : anos
}
