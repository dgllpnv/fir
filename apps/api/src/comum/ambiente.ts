/**
 * Lê um inteiro de variável de ambiente, fechando o modo de falha do
 * `Number(process.env[...] ?? padrao)` espalhado pelo módulo de autenticação:
 * `Number('100ms')`, `Number('auto')` e `Number('sixty')` são todos `NaN`, e
 * toda comparação com `NaN` é `false` — um piso de tempo, um teto de fila ou
 * um teto de concorrência configurado errado DESLIGA em silêncio, sem exceção
 * nem log, porque a comparação que o aplicaria nunca é verdadeira.
 *
 * Esta função fecha a classe inteira do defeito: RECUSA na subida do
 * processo, antes de a aplicação aceitar uma requisição, com mensagem que
 * nomeia a variável, o valor recebido e o que era esperado. Falhar ruidoso no
 * segundo 0 é estritamente melhor que falhar silencioso no primeiro incidente
 * em produção.
 *
 * Só a variável AUSENTE (nunca definida) usa o padrão. Definida com valor
 * vazio, fracionário, não-numérico ou fora da faixa declarada é erro do
 * operador, não "ausência" — e os dois não podem ter o mesmo resultado, ou a
 * distinção entre "não configurei" e "configurei errado" desaparece.
 */
export function inteiroDoAmbiente(
  nome: string,
  padrao: number,
  opcoes: { min?: number; max?: number } = {},
): number {
  const bruto = process.env[nome]
  if (bruto === undefined) return validarFaixa(nome, padrao, opcoes, 'padrão do código')

  // Só dígitos, com sinal de negativo opcional: nada de `.`, `,`, espaço,
  // notação científica nem sufixo de unidade ("100ms"). `Number(...)` aceita
  // tudo isso antes de produzir `NaN` ou um valor fracionário — é exatamente
  // a casa por onde o defeito original entrava.
  if (!/^-?\d+$/.test(bruto)) {
    throw new Error(
      `Variável de ambiente ${nome}="${bruto}" não é um inteiro. ` +
        `Esperado um número inteiro${faixaTexto(opcoes)}.`,
    )
  }

  const valor = Number(bruto)
  if (!Number.isSafeInteger(valor)) {
    throw new Error(
      `Variável de ambiente ${nome}="${bruto}" está fora da faixa segura de inteiro.`,
    )
  }

  return validarFaixa(nome, valor, opcoes, 'valor informado')
}

function faixaTexto(opcoes: { min?: number; max?: number }): string {
  if (opcoes.min !== undefined && opcoes.max !== undefined) {
    return ` entre ${opcoes.min} e ${opcoes.max}`
  }
  if (opcoes.min !== undefined) return ` maior ou igual a ${opcoes.min}`
  if (opcoes.max !== undefined) return ` menor ou igual a ${opcoes.max}`
  return ''
}

function validarFaixa(
  nome: string,
  valor: number,
  opcoes: { min?: number; max?: number },
  origem: string,
): number {
  if (opcoes.min !== undefined && valor < opcoes.min) {
    throw new Error(
      `Variável de ambiente ${nome}=${valor} (${origem}) é menor que o mínimo ${opcoes.min}.`,
    )
  }
  if (opcoes.max !== undefined && valor > opcoes.max) {
    throw new Error(
      `Variável de ambiente ${nome}=${valor} (${origem}) é maior que o máximo ${opcoes.max}.`,
    )
  }
  return valor
}
