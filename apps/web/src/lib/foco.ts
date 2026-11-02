/**
 * **O LAÇO DE FOCO DE UM MODAL — a parte que se pode provar.**
 *
 * Um modal que não prende o foco é um modal só para quem usa mouse: com Tab,
 * o foco sai pela borda e vai para o conteúdo atrás do véu — que a pessoa não
 * vê, não sabe que alcançou, e que pode acionar sem perceber.
 *
 * A lógica mora aqui, PURA, por um motivo prático: não há Testing Library
 * nesta árvore (dívida registrada em `docs/dividas.md`), então um laço escrito
 * dentro do `useEffect` seria código que nenhum teste roda. Aqui ele é uma
 * função de lista + índice, e `foco.test.ts` cobre os quatro casos que
 * importam — inclusive os dois que a implementação ingênua erra.
 */

/**
 * Os seletores do que recebe foco por Tab.
 *
 * `[tabindex]:not([tabindex="-1"])` entra porque um `<div role="button">` com
 * `tabindex="0"` é focável e nenhum seletor de elemento o pega. `:disabled`
 * sai porque o navegador o pula, e incluí-lo faria o laço parar num elemento
 * que não aceita foco — o Tab seguinte pareceria não fazer nada.
 */
export const SELETOR_FOCAVEL =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Para onde o Tab (ou Shift+Tab) deve levar, dado o que é focável e onde o
 * foco está **agora**.
 *
 * Devolve `null` quando não há o que fazer — e `null` significa "deixe o
 * navegador seguir", nunca "prenda no lugar".
 *
 * Os dois casos que a implementação ingênua erra, e por isso eles são testes:
 *
 *  1. **O foco está FORA da lista.** Acontece de verdade: o navegador devolve
 *     o foco ao `<body>` quando o elemento focado é removido (um botão que
 *     virou "Salvando…" e sumiu). Sem este caso, `indexOf` devolve `-1`,
 *     `-1 + 1 = 0` e o Tab funciona por acidente — mas `Shift+Tab` leva a
 *     `-2`, que é `undefined`, e o laço para de prender.
 *  2. **Um único focável.** Tab tem de voltar nele mesmo. Com `i + 1` cru,
 *     `1 % 1 = 0` até funciona; o que quebra é não tratar a lista VAZIA, onde
 *     qualquer índice é `undefined`.
 */
export function proximoFoco(
  focaveis: readonly HTMLElement[],
  atual: Element | null,
  paraTras: boolean,
): HTMLElement | null {
  if (focaveis.length === 0) return null

  const i = atual === null ? -1 : focaveis.indexOf(atual as HTMLElement)

  // Foco fora do modal: traz para a borda certa, em vez de deixar o Tab
  // continuar para o conteúdo de trás.
  if (i === -1) return (paraTras ? focaveis[focaveis.length - 1] : focaveis[0]) ?? null

  const n = focaveis.length
  const proximo = paraTras ? (i - 1 + n) % n : (i + 1) % n
  return focaveis[proximo] ?? null
}

/**
 * O Tab precisa ser INTERCEPTADO? Só quando ele sairia do laço.
 *
 * Interceptar sempre funciona e custa uma coisa: o foco passa a andar pela
 * ORDEM DO DOM em vez da ordem de tabulação do navegador, que não é a mesma
 * quando há `tabindex` positivo. Interceptar só nas bordas deixa o navegador
 * fazer o trabalho dele no meio da lista, que é onde ele acerta.
 */
export function precisaPrender(
  focaveis: readonly HTMLElement[],
  atual: Element | null,
  paraTras: boolean,
): boolean {
  if (focaveis.length === 0) return false
  const i = atual === null ? -1 : focaveis.indexOf(atual as HTMLElement)
  if (i === -1) return true
  return paraTras ? i === 0 : i === focaveis.length - 1
}
