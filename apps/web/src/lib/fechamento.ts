/**
 * AS CONTAS DO FORMULÁRIO "FECHOU O ORÇAMENTO" — conveniência de tela.
 *
 * O servidor confere tudo de novo (`FechamentoService`) e é a autoridade; estas
 * contas só poupam a recepção de somar de cabeça. Por isso moram aqui puras,
 * em `bigint`, e sem `toFixed`: o que é digitado entra por `centavosDoTexto` e
 * o que sai é formatado por `formatarDinheiro`.
 *
 * Os dois conceitos que a cliente separou, e que aqui têm nomes diferentes:
 *
 *  * PAGAMENTO EM ABERTO = fechado − recebido agora. É o saldo A RECEBER da
 *    paciente (regra 5), do que foi fechado.
 *  * RESTANTE DO ORÇAMENTO = oferecido − fechado. É a parte que NÃO foi
 *    fechada (os procedimentos que ela não levou); só existe no parcial.
 */
import { centavosDoTexto } from './dinheiro-digitado'

export type ItemParaSomar = { readonly chave: string; readonly valor?: string | null | undefined }

/**
 * A soma dos preços dos itens MARCADOS — o valor fechado sugerido.
 *
 * `null` quando não há como somar com honestidade: nenhum marcado, ou algum
 * marcado sem preço (somar só os que têm preço sugeriria um valor menor que o
 * fechado, e a recepção confiaria nele).
 */
export function somaDosItensMarcados(
  itens: readonly ItemParaSomar[],
  marcados: ReadonlySet<string>,
): bigint | null {
  const escolhidos = itens.filter((i) => marcados.has(i.chave))
  if (escolhidos.length === 0) return null
  let soma = 0n
  for (const i of escolhidos) {
    if (i.valor === undefined || i.valor === null || i.valor === '') return null
    soma += BigInt(i.valor)
  }
  return soma
}

export type EntradaDoCalculo = {
  /** O orçamento oferecido, ou `null` (sem orçamento, ou sem a permissão `valores`). */
  readonly oferta: bigint | null
  readonly tipo: 'tudo' | 'parte'
  /** O texto digitado do valor fechado (só no parcial). */
  readonly fechadoDigitado: string
  /** O texto digitado do valor recebido agora. */
  readonly entradaDigitada: string
}

export type ResultadoDoCalculo = {
  readonly fechado: bigint | null
  readonly entrada: bigint | null
  /** fechado − entrada. `null` enquanto faltar um dos dois, ou se a entrada passar do fechado. */
  readonly pagamentoEmAberto: bigint | null
  /** oferecido − fechado, só no parcial. */
  readonly restante: bigint | null
  /** A frase do que está errado, ou `null`. */
  readonly erro: string | null
}

export function calcularFechamento(x: EntradaDoCalculo): ResultadoDoCalculo {
  const entrada = centavosDoTexto(x.entradaDigitada)
  const fechado = x.tipo === 'tudo' ? x.oferta : centavosDoTexto(x.fechadoDigitado)

  let erro: string | null = null
  if (x.tipo === 'parte') {
    if (x.fechadoDigitado.trim() === '' || fechado === null || fechado <= 0n) {
      erro = 'Informe o valor fechado. Use 300,00.'
    } else if (x.oferta !== null && fechado >= x.oferta) {
      erro = 'Fechou só uma parte: o valor fechado precisa ser menor que o orçamento.'
    }
  }
  if (erro === null && entrada !== null && fechado !== null && entrada > fechado) {
    erro = 'O valor recebido agora é maior que o valor fechado.'
  }

  const pagamentoEmAberto =
    entrada !== null && fechado !== null && entrada <= fechado ? fechado - entrada : null
  const restante =
    x.tipo === 'parte' && x.oferta !== null && fechado !== null && fechado < x.oferta
      ? x.oferta - fechado
      : null
  return { fechado, entrada, pagamentoEmAberto, restante, erro }
}
