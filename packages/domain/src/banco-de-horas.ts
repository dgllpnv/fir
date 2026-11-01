import { type ErroDeDominio, type Result, erro, erroDe, ok } from './resultado'

/**
 * O BANCO DE HORAS — **inteiro de minutos**, nunca hora decimal.
 *
 * "A ferramenta não registra ponto. No fim do mês, lance o saldo de cada
 * pessoa como aparece no aplicativo oficial de ponto (ex.: +6:30 ou −2:15)"
 * (MANUAL cap. 13).
 *
 * Por que minuto inteiro, e não a hora decimal do protótipo (regra 8): lá o
 * saldo é `Math.round(x*100)/100` e a formatação é
 * `Math.floor(a) + "h" + Math.round((a % 1) * 60)`. Com `a = 0,999` isso
 * imprime **`0h60`**, que não é hora nenhuma — e a volta (`lerHoras`) devolve
 * `1`, não `0,999`. Minuto inteiro torna os dois casos impossíveis por
 * construção, e é a ida-e-volta exata que o teste de propriedade cobra.
 */
export const MINUTOS_POR_HORA = 60

/**
 * ±1.000 h. Acima disso não é saldo, é erro de digitação — e um saldo de
 * 60 mil horas passaria pela tela como um número grande qualquer, para depois
 * virar o alerta crítico de alguém que não deve nada.
 */
export const SALDO_MAXIMO_EM_MINUTOS = 60_000

/** O ±10 h do protótipo, em minutos. É o padrão de toda clínica nova. */
export const LIMITE_DE_HORAS_PADRAO_EM_MINUTOS = 10 * MINUTOS_POR_HORA

/** O teto do limite de alerta: 200 h, como o `max` do campo dela. */
export const LIMITE_DE_HORAS_MAXIMO_EM_MINUTOS = 200 * MINUTOS_POR_HORA

/**
 * O menos tipográfico (U+2212) que `formatarSaldoDeHoras` imprime.
 *
 * Ele existe porque `-` de teclado é um hífen e desalinha numa coluna de
 * algarismos tabulares. A leitura aceita os dois, senão copiar o valor da
 * tela e colá-lo de volta no campo seria recusado.
 */
const MENOS = '−'

/** `[+-]?H:MM` ou `[+-]?HhMM` — com os minutos em DOIS dígitos, ou nenhum. */
const COM_MINUTOS = /^([+-]?)(\d{1,4})[:h](\d{2})?$/i

/** `[+-]?H`, `[+-]?H,DD`, `[+-]?H.DD` — hora decimal. */
const DECIMAL = /^([+-]?)(\d{1,4})(?:[.,](\d{1,4}))?$/

const FORMATO = 'Use o formato +6:30, −2:15 ou 6,5.'

/**
 * Texto digitado → **minutos inteiros**, ou `null` quando o campo está vazio.
 *
 * `null` não é zero: é *"não lance nada neste mês"*, e é assim que a tela
 * apaga um saldo lançado por engano. Zero é um saldo legítimo — a pessoa
 * fechou o mês quitada —, e tratar os dois igual tornaria impossível dizer
 * "ela está em dia" e "ninguém conferiu" com o mesmo campo.
 *
 * **Minutos em dois dígitos, ou nenhum.** `6:3` é recusado de propósito: ele
 * pode ser 6h03 ou 6h30, o protótipo lê `Number("3") = 3` minutos, e um erro
 * de digitação de 27 minutos num saldo de banco de horas é dinheiro.
 */
export function lerSaldoDeHoras(texto: string): Result<number | null, ErroDeDominio> {
  const limpo = texto.replaceAll(MENOS, '-').replace(/\s/g, '')
  if (limpo === '') return ok(null)

  const comMinutos = COM_MINUTOS.exec(limpo)
  if (comMinutos !== null) {
    const [, sinal, horas, minutos] = comMinutos
    const total = Number(horas) * MINUTOS_POR_HORA + Number(minutos ?? '0')
    return comSinal(sinal === '-' ? -total : total)
  }

  const decimal = DECIMAL.exec(limpo)
  if (decimal !== null) {
    const [, sinal, horas, fracao] = decimal
    const total = Number(horas) * MINUTOS_POR_HORA + minutosDaFracao(fracao)
    return comSinal(sinal === '-' ? -total : total)
  }

  return erro(erroDe('SALDO_DE_HORAS_INVALIDO', `Saldo de horas inválido. ${FORMATO}`))
}

/**
 * A fração de hora em minutos, **por aritmética inteira**.
 *
 * `0,51 h` são 30,6 minutos, e alguém tem de arredondar. O que não pode
 * acontecer é a conta passar por ponto flutuante: `Number('0.' + f) * 60` é a
 * assinatura do legado, e aqui `fracao` é lido como os DÍGITOS que são — o
 * mesmo movimento do `LeitorDeNota` com `qCom` e `vUnCom`.
 *
 * Arredonda meio para cima: `0,5 h` → 30 min, `0,25 h` → 15 min.
 */
function minutosDaFracao(fracao: string | undefined): number {
  if (fracao === undefined || fracao === '') return 0
  const denominador = 10 ** fracao.length
  const numerador = Number(fracao) * MINUTOS_POR_HORA
  return Math.floor((numerador * 2 + denominador) / (2 * denominador))
}

function comSinal(minutos: number): Result<number, ErroDeDominio> {
  if (Math.abs(minutos) > SALDO_MAXIMO_EM_MINUTOS) {
    return erro(
      erroDe(
        'SALDO_DE_HORAS_FORA_DA_FAIXA',
        `Saldo de horas acima de ${SALDO_MAXIMO_EM_MINUTOS / MINUTOS_POR_HORA} h. Confira o que o app de ponto mostrou.`,
      ),
    )
  }
  return ok(minutos)
}

/**
 * Minutos → `+6h30`, `−2h15`, `+1h`, `0h`.
 *
 * O formatador mora no domínio pela mesma razão do de dinheiro (regra 7): ele
 * é a **inversa** de `lerSaldoDeHoras`, e as duas pontas precisam concordar
 * exatamente para que o valor que a tabela mostra possa ser editado no campo
 * da linha seguinte sem mudar de número.
 */
export function formatarSaldoDeHoras(minutos: number): string {
  return (minutos < 0 ? MENOS : minutos > 0 ? '+' : '') + formatarHoras(minutos)
}

/** Como `formatarSaldoDeHoras`, **sem sinal** — para `±10h` no texto do limite. */
export function formatarHoras(minutos: number): string {
  const absoluto = Math.abs(minutos)
  const horas = Math.floor(absoluto / MINUTOS_POR_HORA)
  const resto = absoluto % MINUTOS_POR_HORA
  return `${horas}h${resto === 0 ? '' : String(resto).padStart(2, '0')}`
}
