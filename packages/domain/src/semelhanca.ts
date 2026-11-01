/**
 * Quanto do nome de um item aparece na descrição de uma nota fiscal.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO É DOMÍNIO E NÃO UM `ILIKE`
 *
 * A nota diz `TIRZEPATIDA 5MG/0,5ML SOL INJ AMP`; o item chama-se
 * `Tirzepatida 5 mg`. Nenhum `=`, nenhum `ILIKE '%…%'` e nenhum `similarity()`
 * do `pg_trgm` casa os dois de forma explicável — e **explicável é o
 * requisito**: a tela diz à pessoa *por que* sugeriu aquele item ("nome
 * parecido" ou "sugestão: confira"), e ela decide. Uma distância de trigramas
 * daria um número que ninguém no balcão pode conferir.
 *
 * A medida é **assimétrica de propósito**: é a fração das palavras DO ITEM que
 * aparecem na descrição da NOTA. As descrições de nota são longas e cheias de
 * palavra que não é nome ("SOL INJ AMP"), então dividir pelo tamanho da
 * descrição puniria o casamento certo. É a conta do protótipo (`parecido`),
 * medida nele.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Minúsculas, sem acento, espaços colapsados — **a mesma forma de
 * `normalizar_nome` no Postgres** (migration 0006).
 *
 * Existe em TypeScript porque a semelhança é calculada em memória, sobre o
 * catálogo já carregado: mandar cada par de nomes ao banco para normalizar
 * seria uma consulta por linha de nota.
 */
export function normalizarNome(texto: string): string {
  return texto
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * As palavras que importam num nome de produto.
 *
 * Fora: as de uma letra e as preposições. "Tirzepatida 5 mg" e "Tirzepatida de
 * 5 mg" têm de dar o mesmo conjunto, senão o "de" baixa a nota de um casamento
 * certo — e é a lista do protótipo (`tokensNome`), tal e qual.
 */
const VAZIAS = new Set(['de', 'da', 'do', 'com', 'para', 'em', 'x', 'c'])

export function palavrasDoNome(texto: string): string[] {
  return normalizarNome(texto)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !VAZIAS.has(w))
}

/**
 * De 0 a 100: quantos por cento das palavras de `nomeDoItem` aparecem em
 * `descricao`.
 *
 * **Inteiro, nunca fração** — não porque haja dinheiro aqui, mas porque o
 * número cruza a fronteira HTTP e um `0.7499999999999999` compararia diferente
 * dos dois lados. Os limiares são inteiros também.
 *
 * Casamento de palavra: igual, ou uma é prefixo da outra com três letras ou
 * mais. É o que faz `ampola` casar com `amp` e `tirzepatida` com `tirzepatid`,
 * sem fazer `ml` casar com `mg`.
 */
export function semelhancaDeNome(nomeDoItem: string, descricao: string): number {
  const doItem = [...new Set(palavrasDoNome(nomeDoItem))]
  const daNota = palavrasDoNome(descricao)
  if (doItem.length === 0 || daNota.length === 0) return 0

  const achadas = doItem.filter((x) =>
    daNota.some(
      (w) =>
        w === x || (w.length >= 3 && x.length >= 3 && (x.startsWith(w) || w.startsWith(x))),
    ),
  ).length
  return Math.round((achadas * 100) / doItem.length)
}

/**
 * Os dois limiares, com nome — e eles são a mesma decisão do protótipo.
 *
 * Acima de `CONFIAVEL`, a tela diz "nome parecido" e deixa a linha marcada.
 * Entre `SUGESTAO` e `CONFIAVEL`, ela diz "sugestão: confira" — e a diferença
 * entre as duas frases é a diferença entre a pessoa conferir e não conferir.
 * Abaixo, a linha não entra no estoque ("não parece item de estoque"), que é o
 * caso do frete e da taxa de entrega.
 */
export const SEMELHANCA_CONFIAVEL = 75
export const SEMELHANCA_SUGESTAO = 50
