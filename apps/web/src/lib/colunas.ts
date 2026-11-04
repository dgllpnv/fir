/**
 * Reconhecer as colunas da planilha que a clínica trouxe.
 *
 * **Por que reconhecer em vez de exigir a ordem.** O MANUAL (cap. 12) promete
 * que a ferramenta aceita *"a planilha exportada do sistema principal"* — e
 * cada sistema exporta com um cabeçalho diferente: `Produto`, `Descrição`,
 * `Material`. Exigir a ordem do nosso modelo obrigaria a recepção a recortar
 * e colar coluna por coluna no dia da implantação.
 *
 * As três importações do protótipo (itens, pacientes, campanha) fazem o mesmo
 * reconhecimento, e aqui ele existe **uma vez**.
 */

/** Sem acento, minúsculo, espaço único — como `norm` do protótipo. */
export const normalizar = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')

/**
 * A chave do campo e os cabeçalhos que valem por ela.
 *
 * **A ORDEM IMPORTA, e é por isso que é uma lista e não um objeto.** Cada
 * chave reivindica a primeira coluna livre que casa, e quem vem antes escolhe
 * primeiro. `nome` fica por último de propósito: os apelidos dele (`item`,
 * `produto`) são largos o bastante para roubar a coluna `Unidade de medida`
 * se ele reivindicasse antes de `medida`. Medido no protótipo — é a ordem de
 * `COLS_IMPORT_EST`, e trocá-la quebra a planilha modelo dele.
 */
export type Apelidos = readonly (readonly [string, readonly string[]])[]

export type Mapa = {
  /** Índice da coluna de cada chave, ou `-1` quando ela não veio. */
  indices: Readonly<Record<string, number>>
  /** As linhas de dados, já sem o cabeçalho. */
  corpo: readonly (readonly string[])[]
  /** Número da primeira linha de dados na planilha, para citar na conferência. */
  primeira: number
}

/**
 * Casa um cabeçalho normalizado contra os apelidos de uma chave.
 *
 * `h === c` primeiro, e `h.includes(c)` só com apelido de 3 letras ou mais —
 * é a regra do protótipo (`c.length > 2`), e ela existe porque `un` casaria
 * dentro de *"nome do produto"*.
 */
const casa = (h: string, apelidos: readonly string[]): boolean =>
  apelidos.some((c) => h === c || (c.length > 2 && h.includes(c)))

/**
 * Lê a tabela e devolve onde está cada campo.
 *
 * `posicional` é o plano B: quando nenhuma coluna parece cabeçalho, a planilha
 * é tratada como dados puros na ordem do nosso modelo. É o que faz "copiei só
 * as linhas, sem o cabeçalho" funcionar.
 */
export function mapear(
  tabela: readonly (readonly string[])[],
  apelidos: Apelidos,
  posicional: Readonly<Record<string, number>>,
  apelidosDoCabecalho: readonly string[],
): Mapa | { erro: string } {
  const brutas = tabela.filter((r) => r.some((v) => v.trim() !== ''))
  const cabecalho = brutas[0]
  if (cabecalho === undefined) return { erro: 'Nenhuma linha encontrada na planilha.' }

  const titulos = cabecalho.map(normalizar)
  const temCabecalho = titulos.some((h) => casa(h, apelidosDoCabecalho))

  let indices: Record<string, number>
  if (temCabecalho) {
    indices = Object.fromEntries(apelidos.map(([k]) => [k, -1]))
    const usados = new Set<number>()
    for (const [chave, lista] of apelidos) {
      const i = titulos.findIndex((h, j) => !usados.has(j) && casa(h, lista))
      indices[chave] = i
      if (i >= 0) usados.add(i)
    }
  } else {
    indices = { ...posicional }
  }

  return {
    indices,
    corpo: brutas.slice(temCabecalho ? 1 : 0),
    primeira: temCabecalho ? 2 : 1,
  }
}

/** A célula de uma chave, ou `''` quando a coluna não veio. */
export const celula = (
  linha: readonly string[],
  indices: Readonly<Record<string, number>>,
  chave: string,
): string => {
  const i = indices[chave]
  return i === undefined || i < 0 ? '' : (linha[i] ?? '').trim()
}

/** `sim`, `s`, `x`, `1`… — a coluna de sim/não da planilha modelo. */
export const simOuNao = (v: string): boolean =>
  ['sim', 's', 'x', '1', 'true', 'verdadeiro'].includes(normalizar(v))
