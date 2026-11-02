import type { Achado, LinhaDeConferencia } from '@fir/domain'

/**
 * A FORMA do relatório, num arquivo só — e ela mora **fora** do migrador e
 * **fora** da conferência de propósito.
 *
 * Os dois precisam dela: o migrador a devolve, a conferência a produz. Com o
 * tipo dentro de um dos dois, os arquivos se importam em círculo — e o
 * sintoma de um ciclo entre um `@Injectable` e um módulo que o importa é um
 * `undefined` na hora da injeção, não um erro de compilação.
 */
export type RelatorioDaMigracao = {
  readonly clinicaId: string
  /**
   * Uma linha por conferência, na ordem em que a regra 28 as lista. **Toda
   * linha carrega `origem`, `destino` e `bate`** — nunca só o veredito: o
   * relatório tem de poder ser lido por quem vai decidir o corte, e "não
   * bateu" sem os dois números não é informação.
   */
  readonly linhas: readonly LinhaDeConferencia[]
  /** `true` só quando TODAS as linhas batem. É o portão do corte. */
  readonly fechado: boolean
  /** Conversões de dinheiro que arredondaram na segunda casa (ADR 0009). */
  readonly arredondamentos: number
  /**
   * O que o migrador achou e **não** reprova: a aba de backup ignorada, a
   * pessoa reconstruída, o homônimo desativado, a sessão cancelada à mão.
   *
   * Nunca com conteúdo de dado real — aba, linha, coluna e código (regra 21).
   */
  readonly observacoes: readonly Achado[]
}
