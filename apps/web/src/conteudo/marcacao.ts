import { dobrar } from './busca'

/**
 * **A marcação do manual**, interpretada numa estrutura — nunca em HTML.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTRUTURA, E NÃO `dangerouslySetInnerHTML`
 *
 * O `mdManual` dela devolve string de HTML e por isso precisa de `esc()` em
 * cada pedaço, de um `replace` que não entre dentro de tag (`(<[^>]+>)|([^<]+)`)
 * e de um segundo `replace` para o destaque da busca. São três lugares onde um
 * `<` do texto dela vira marcação, e o texto é editável por quem escreve
 * conteúdo.
 *
 * Aqui o texto nunca é HTML: ele vira `Bloco[]`, e o React escapa. Não há
 * `esc`, não há `innerHTML`, e o destaque é um pedaço de texto marcado em vez
 * de uma tag injetada.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * As três regras dela, e só elas:
 *   `- ` no começo da linha → item de lista
 *   `**assim**`             → negrito
 *   linha em branco         → separa blocos
 */

/** Um pedaço de linha, com os dois eixos que a tela desenha. */
export type Trecho = {
  readonly texto: string
  readonly negrito: boolean
  /** Casou com um termo da busca. */
  readonly destaque: boolean
}

export type Bloco =
  | { readonly tipo: 'paragrafo'; readonly trechos: readonly Trecho[] }
  | { readonly tipo: 'lista'; readonly itens: readonly (readonly Trecho[])[] }

/**
 * Parte uma linha em trechos de negrito, por `**`.
 *
 * `split` em vez de regex com grupo: os pedaços de índice ímpar são os que
 * estavam entre os asteriscos. Um `**` sozinho (sem o par) deixa o resto da
 * linha em texto normal, que é o que `negrito` dela também faz — e é o
 * comportamento certo para conteúdo escrito à mão: nunca engolir texto.
 */
function partirNegrito(linha: string): { texto: string; negrito: boolean }[] {
  const pedacos = linha.split('**')
  return pedacos
    .map((texto, i) => ({ texto, negrito: i % 2 === 1 }))
    .filter((p) => p.texto !== '')
}

/**
 * Parte um pedaço de texto nos termos da busca, preservando o resto.
 *
 * Compara no texto DOBRADO (sem acento, minúsculo) e corta no ORIGINAL — é
 * para isso que `dobrar` preserva o comprimento. Sem isso, buscar "sessao"
 * não acharia "sessão", que é justamente como a recepção digita.
 */
function partirDestaque(
  texto: string,
  termos: readonly string[],
): { texto: string; destaque: boolean }[] {
  if (termos.length === 0) return [{ texto, destaque: false }]
  const dobrado = dobrar(texto)
  /** `true` em cada posição que pertence a algum termo. */
  const marcado = new Array<boolean>(texto.length).fill(false)
  for (const termo of termos) {
    let de = dobrado.indexOf(termo)
    while (de !== -1) {
      for (let i = de; i < de + termo.length; i++) marcado[i] = true
      de = dobrado.indexOf(termo, de + termo.length)
    }
  }
  const saida: { texto: string; destaque: boolean }[] = []
  let inicio = 0
  for (let i = 1; i <= texto.length; i++) {
    if (i === texto.length || marcado[i] !== marcado[inicio]) {
      saida.push({ texto: texto.slice(inicio, i), destaque: marcado[inicio] === true })
      inicio = i
    }
  }
  return saida
}

const trechosDaLinha = (linha: string, termos: readonly string[]): Trecho[] =>
  partirNegrito(linha).flatMap((p) =>
    partirDestaque(p.texto, termos).map((d) => ({
      texto: d.texto,
      negrito: p.negrito,
      destaque: d.destaque,
    })),
  )

/**
 * O texto de uma seção, em blocos.
 *
 * **Parágrafo antes da lista, dentro do mesmo bloco**, como nela: a frase que
 * introduz a lista vem na mesma quebra que os itens, e invertê-los poria o
 * *"Em Configurações › Procedimentos, cadastre:"* depois do que se cadastra.
 */
export function interpretar(texto: string, termos: readonly string[] = []): Bloco[] {
  const blocos: Bloco[] = []
  for (const bruto of texto.split(/\n\s*\n/)) {
    const linhas = bruto.split('\n')
    const itens = linhas.filter((l) => l.startsWith('- '))
    const corrido = linhas.filter((l) => !l.startsWith('- ')).join(' ').trim()
    if (corrido !== '') {
      blocos.push({ tipo: 'paragrafo', trechos: trechosDaLinha(corrido, termos) })
    }
    if (itens.length > 0) {
      blocos.push({
        tipo: 'lista',
        itens: itens.map((l) => trechosDaLinha(l.slice(2), termos)),
      })
    }
  }
  return blocos
}

/** O texto puro de uma seção — sem `**` e sem os marcadores de lista. */
export const textoPuro = (texto: string): string =>
  interpretar(texto)
    .flatMap((b) => (b.tipo === 'paragrafo' ? [b.trechos] : b.itens))
    .map((trechos) => trechos.map((t) => t.texto).join(''))
    .join('\n')
