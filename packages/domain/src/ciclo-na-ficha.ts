import { diasEntre } from './relogio'

/**
 * **O CICLO DO CONTRATO de um `Cliente Firmare`** — a barra "Mês 3 de 4 ·
 * 54% do ciclo" da visão geral da ficha (inventário G8 V2; protótipo
 * `cVisao`, `index.html` L1411):
 *
 * ```js
 * tot = (fim - inicio) / dia;  dec = (HOJE - inicio) / dia
 * pct = clamp(dec / tot * 100, 0, 100)
 * mes = `Mês ${min(ceil(tot/30), floor(dec/30) + 1)} de ${ceil(tot/30)}`
 * ```
 *
 * O "mês" do protótipo é um bloco de 30 dias, não o mês do calendário — e é
 * de propósito que a conta fica igual: é a frase que a equipe já lê.
 *
 * **Não é o `cicloDoContrato` do portal** (`portal-grupo.ts`), e o protótipo
 * também tem os dois: o portal (`fg-portal.js` L104-113) conta meses de
 * calendário e o mês médio de 30,4375 dias; a ficha (`cVisao`) conta blocos
 * de 30. Para as mesmas datas os dois podem dizer "Mês 3" e "Mês 4". Unificar
 * é decisão de produto, não deste ticket.
 *
 * Três diferenças, todas em bordas que o protótipo deixava quebradas:
 *  - **antes do início** o protótipo escrevia "Mês 0 de 4"; aqui é "Mês 1";
 *  - **fim igual ou antes do início** dividia por zero (barra `NaN`); aqui
 *    não há ciclo (`null`) e a tela não desenha a barra;
 *  - o percentual sai **inteiro** (o protótipo arredondava só o texto e
 *    usava a fração na largura da barra). Arredondamento meio-para-cima,
 *    feito em inteiros — sem ponto flutuante numa conta que a tela mostra.
 *
 * Dias civis `aaaa-mm-dd` sem fuso: o "hoje" vem SEMPRE do servidor
 * (regra 24), e a diferença é contada em dias de calendário (`diasEntre`,
 * de `relogio.ts`), que não conhece horário de verão.
 */
export type CicloNaFicha = {
  /** O bloco de 30 dias em curso, de 1 a `meses`. */
  readonly mes: number
  /** Quantos blocos de 30 dias o ciclo tem (`ceil(dias / 30)`). */
  readonly meses: number
  /** Quanto do ciclo já passou, de 0 a 100, inteiro. */
  readonly percentual: number
}

export function cicloNaFicha(inicio: string, fim: string, hoje: string): CicloNaFicha | null {
  const total = diasEntre(inicio, fim)
  if (total <= 0) return null
  const decorridos = diasEntre(inicio, hoje)

  const meses = Math.floor((total + 29) / 30)
  const mes = Math.min(meses, Math.max(1, Math.floor(decorridos / 30) + 1))

  let percentual: number
  if (decorridos <= 0) percentual = 0
  else if (decorridos >= total) percentual = 100
  // round(decorridos × 100 / total), meio para cima, só com inteiros.
  else percentual = Math.floor((200 * decorridos + total) / (2 * total))

  return { mes, meses, percentual }
}
