/**
 * **Os indicadores fora da aba** (backlog 1.9 A e H): o contador do menu e o
 * bloco "Indicadores da semana" em Hoje. Só regra de exibição e de quando
 * perguntar — o número vem pronto do servidor.
 */

/**
 * De quanto em quanto tempo o contador do menu pergunta de novo. A tela de
 * Hoje fica aberta o dia inteiro, e o número muda devagar (a situação de uma
 * meta anda com o dia e com os lançamentos): 10 minutos com a aba visível
 * bastam. Sem cache no servidor (I-45), cada pergunta custa uma medição
 * completa — por isso nada de intervalo curto.
 */
export const INTERVALO_DO_CONTADOR_MS = 10 * 60_000

/**
 * O mínimo entre duas perguntas disparadas por evento (voltar à aba, trocar
 * de tela). Quem salta de tela em tela não dispara uma medição por clique.
 */
export const RESPIRO_DO_CONTADOR_MS = 60_000

/** Pergunta de novo? `null` = nunca perguntou. */
export const precisaPerguntar = (ultima: number | null, agora: number, respiroMs: number): boolean =>
  ultima === null || agora - ultima >= respiroMs

/** O texto do selo: some no zero (1.9 A); acima de 99, "99+" para não alargar o menu. */
export function textoDoContador(abaixo: number | null): string | null {
  if (abaixo === null || abaixo <= 0) return null
  return abaixo > 99 ? '99+' : String(abaixo)
}

/** O nome que o leitor de tela lê junto do item do menu. */
export const rotuloDoContador = (abaixo: number): string =>
  `${abaixo} ${abaixo === 1 ? 'meta abaixo do ritmo' : 'metas abaixo do ritmo'}`
