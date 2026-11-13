/**
 * **O NOME DE UMA LISTA DE PACIENTES, SEM O QUE NÃO É NOME.**
 *
 * A planilha da cliente (campanha "Recontato de inativos") traz, na coluna do
 * paciente, texto como `6. Maria Souza - R$ 15.200` ou
 * `Marta Alves (Faturado: R$ 8.000,50)`: o ÍNDICE da linha na frente e o
 * VALOR faturado atrás. Gravado como veio, o nome do paciente carrega o
 * número — e a cliente corrige na mão, uma tarefa por vez.
 *
 * Aqui o nome sai limpo e o valor sai como o que ele é: DINHEIRO, em
 * centavos inteiros (regra 1), sem `float` no caminho — a leitura é de
 * dígitos, e a vírgula decide a escala.
 *
 * Mora em `packages/domain` porque a tela (prévia) e o servidor (gravação) têm
 * de concordar: a chave de idempotência da importação (regra 26) é o nome
 * LIMPO, e duas limpezas diferentes reimportariam o mesmo paciente duas vezes.
 */
export type NomeDeLista = {
  readonly nome: string
  /** Centavos, ou `null` quando o texto não trazia valor legível. */
  readonly valorEmCentavos: bigint | null
}

/**
 * O que a recepção DIGITOU → centavos, inteiro, sem ponto flutuante. A ÚNICA
 * leitura de dinheiro digitado do sistema (o front só reexporta).
 *
 * `15.200` → 1520000n · `15.200,50` → 1520050n · `8000` → 800000n · `3,5` → 350n
 * `15.20` → 1520n · `1.5` → 150n (ponto seguido de 1 ou 2 dígitos é DECIMAL).
 *
 * Ponto só é milhar em grupos de exatamente 3 dígitos. Qualquer outra forma
 * ("1..5", "15.", "1.2.3", "1,234", ",5") é `null`: jamais adivinhar dinheiro.
 */
export function centavosDoTextoBrasileiro(texto: string): bigint | null {
  const t = texto.replace(/\s/g, '')
  if (t === '') return null
  const comMilhar = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)
  const comVirgula = /^\d+(,\d{1,2})?$/.test(t)
  const comPonto = /^\d+\.\d{1,2}$/.test(t)
  if (!comMilhar && !comVirgula && !comPonto) return null
  const normalizado = comMilhar ? t.replace(/\./g, '') : t.replace('.', ',')
  const [inteiros = '', decimais = ''] = normalizado.split(',')
  return BigInt(inteiros) * 100n + BigInt(decimais.padEnd(2, '0') || '0')
}

const INDICE = /^\s*\d{1,4}\s*(?:[.)\u2013\u2014:-]|\s-)\s*(?=\S)/
const VALOR_NO_FIM =
  /\s*[-\u2013\u2014(\[]?\s*(?:faturad[oa]s?\s*:?\s*)?R\$\s*(\d[\d.]*(?:,\d{1,2})?)\s*[)\]]?\s*$/i

export function limparNomeDeLista(bruto: string): NomeDeLista {
  let nome = bruto.replace(/\s+/g, ' ').trim()
  nome = nome.replace(INDICE, '')
  let valor: bigint | null = null
  const m = VALOR_NO_FIM.exec(nome)
  if (m !== null) {
    valor = centavosDoTextoBrasileiro(m[1] ?? '')
    nome = nome.slice(0, m.index)
  }
  // O rótulo "Faturado:" sozinho, sobrando no fim ou no começo.
  nome = nome.replace(/\s*[-\u2013\u2014(]?\s*faturad[oa]s?\s*:?\s*$/i, '')
  nome = nome.replace(/[\s\-\u2013\u2014(\[:]+$/, '').trim()
  return { nome, valorEmCentavos: valor }
}
