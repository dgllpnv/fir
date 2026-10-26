import { somarDias, somarMeses } from './relogio'

/**
 * O CONTATO DE RETORNO — a tarefa que nasce sozinha quando o último item do
 * programa termina, para a paciente repetir o procedimento.
 *
 * A regra, lida de `Code.gs:154` (`retornoDe`) e MEDIDA idêntica no protótipo:
 *
 *   podeEm = ultimaSessaoEm + quantidade (meses ou dias)
 *   prazo  = podeEm − antecedência
 *   se prazo < hoje da clínica  →  prazo = hoje da clínica
 */

export type RegraDeRetorno = {
  readonly quantidade: number
  readonly unidade: 'd' | 'm'
  readonly antecedenciaDias: number
}

export type ContatoDeRetorno = {
  /** O dia em que a paciente já pode repetir o procedimento. */
  readonly podeEm: string
  /** O prazo da tarefa de contato: `podeEm − antecedência`, nunca no passado. */
  readonly prazo: string
}

/**
 * `null` quando o procedimento não tem regra de retorno.
 *
 * **O clamp é o detalhe que importa.** Uma paciente que terminou o tratamento
 * há oito meses, com retorno de quatro meses e contato quinze dias antes,
 * teria prazo em data passada — e o cartão nasceria "atrasado há cinco meses"
 * no dia em que foi criado. Clampar põe a ligação na fila de hoje, que é onde
 * ela de fato está.
 *
 * `hojeDaClinica` é argumento, nunca `new Date()`: a data de negócio vem do
 * servidor, no fuso da clínica (regra 24). O protótipo usa `today()` do
 * navegador, e é por isso que esta função não pode copiá-lo.
 */
export function retornoDe(
  regra: RegraDeRetorno | null,
  ultimaSessaoEm: string,
  hojeDaClinica: string,
): ContatoDeRetorno | null {
  if (regra === null || regra.quantidade <= 0) return null

  // `somarMeses` já implementa a regra 25: dia 29, 30 ou 31 em mês curto cai
  // no último dia do mês. O terceiro argumento (`diaOriginal`) existe para a
  // SÉRIE mensal, que precisa voltar ao dia 31 depois de passar por fevereiro;
  // aqui há um salto só, a partir de `ultimaSessaoEm`, e o padrão da função
  // já é o dia dessa data. Passá-lo seria repetir o valor que a função lê.
  const podeEm =
    regra.unidade === 'd'
      ? somarDias(ultimaSessaoEm, regra.quantidade)
      : somarMeses(ultimaSessaoEm, regra.quantidade)

  const comAntecedencia = somarDias(podeEm, -Math.max(0, regra.antecedenciaDias))
  // Comparação lexicográfica: para `yyyy-MM-dd` é a mesma ordem da cronológica.
  const prazo = comAntecedencia < hojeDaClinica ? hojeDaClinica : comAntecedencia

  return { podeEm, prazo }
}
