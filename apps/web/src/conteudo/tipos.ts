/**
 * **Ajuda e manual** — os dois tipos do conteúdo do produto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE `gestao` É UM CAMPO, E NÃO UMA CHAVE DE PERMISSÃO
 *
 * No protótipo a visibilidade de uma pergunta sai de
 * `S.user.admin || pode("painel") || pode("config")` — uma expressão escrita
 * em dois lugares (`vAjuda` e `vManual`). Aqui ela é **uma** função
 * (`podeVerConteudoDeGestao`, em `busca.ts`), e o campo é um booleano só.
 *
 * **Isto não é controle de acesso, e não deve parecer um.** O conteúdo não tem
 * dinheiro, não tem dado de paciente e é igual para as quatro clínicas — a
 * regra 17 não está em jogo. O que está em jogo é relevância: ensinar a
 * recepção a procurar *"Etiquetas QR (administrativo)"* é ensiná-la a tocar e
 * levar 403, que é a mesma razão pela qual tela sem permissão some do menu
 * (`docs/design.md` §4).
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Uma das perguntas frequentes. É o `{t, q, a, k}` dela, com nome. */
export type PerguntaDaAjuda = {
  readonly tema: string
  readonly pergunta: string
  readonly resposta: string
  /**
   * As palavras de busca — o `k` dela, sem acento e sem pontuação.
   *
   * Elas existem porque a recepcionista não busca pelo título: ela digita
   * *"pagamento parcial"*, e a resposta certa (*"O paciente pagou só uma
   * parte"*) não tem nenhuma das duas palavras no título.
   */
  readonly chaves: string
  /** Só aparece para quem tem `painel` ou `config`. É o `adm` dela. */
  readonly gestao?: true
}

/** Uma seção de capítulo do manual. É o `{t, txt}` dela. */
export type SecaoDoManual = {
  readonly titulo: string
  /**
   * A marcação dela, com três regras: linha começando com `- ` é item de
   * lista, `**assim**` é negrito, linha em branco separa parágrafos. Quem a
   * interpreta é `marcacao.ts`.
   */
  readonly texto: string
  readonly gestao?: true
}

export type CapituloDoManual = {
  /** O `id` dela (`m1`…`m14`) — é o alvo do link do sumário. */
  readonly id: string
  /**
   * O número do capítulo, **separado do título**.
   *
   * No array dela o número vive dentro da string (`"12. Estoque"`) e o
   * capítulo 13 aparece **antes** do 12: o sumário lia "… 11, 13, 12, 14",
   * contra a numeração que o próprio texto declara. Com o número num campo, a
   * ordem é derivada dele e o sumário não pode discordar do título.
   */
  readonly numero: number
  readonly titulo: string
  readonly gestao?: true
  readonly secoes: readonly SecaoDoManual[]
}
