/**
 * O que foi LIDO: a etiqueta da ferramenta, o DataMatrix GS1 da caixa do
 * medicamento, ou o código de barras.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO É DOMÍNIO
 *
 * Parece coisa de tela — quem lê é a câmera do celular. Mas o que se extrai de
 * um DataMatrix GS1 é **validade e lote**, e os dois entram no estoque: a
 * validade É o lote no nosso modelo, e o FIFO é por ela (regra 15). Uma
 * validade lida errado é a dose do frasco vencido aplicada na próxima
 * paciente.
 *
 * E há uma regra de calendário escondida aqui que ninguém adivinha: **o GS1
 * permite o dia `00`**, que significa "o último dia do mês". O protótipo o
 * traduz para `28`, o que erra em 31 de janeiro por três dias. Aqui ele vira o
 * ÚLTIMO DIA do mês de verdade — e é a regra 25 outra vez, do outro lado.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { fimDoMes } from './relogio'

export type CodigoLido =
  /** A etiqueta impressa pela ferramenta: `FRMEST:<clínica>:<item>`. */
  | { readonly tipo: 'etiqueta'; readonly itemId: string }
  /** DataMatrix GS1 da caixa: GTIN, validade e lote do fabricante. */
  | {
      readonly tipo: 'medicamento'
      /** 14 dígitos, forma canônica. */
      readonly gtin: string
      readonly validade: string | null
      readonly lote: string
    }
  /** Código de barras simples (EAN-8/13, GTIN-14). */
  | { readonly tipo: 'barras'; readonly gtin: string }
  /** Não reconhecido. A tela diz isso e oferece digitar. */
  | { readonly tipo: 'desconhecido'; readonly texto: string }

/** O prefixo da etiqueta da ferramenta. Mesmo do protótipo (`codigoQrItem`). */
const ETIQUETA = /^FRMEST:[^:]*:(.+)$/

/**
 * A data de um AI de validade GS1 (`AAMMDD`).
 *
 * `DD = 00` significa **o último dia do mês** — está na especificação GS1, e é
 * o que o fabricante imprime quando a validade é "06/2027". O protótipo usa
 * `28` fixo: em 31 de janeiro isso antecipa a validade em três dias, e um lote
 * bom sai do FIFO antes da hora.
 */
function dataGs1(aammdd: string): string | null {
  if (!/^\d{6}$/.test(aammdd)) return null
  const ano = `20${aammdd.slice(0, 2)}`
  const mes = aammdd.slice(2, 4)
  const dia = aammdd.slice(4, 6)
  if (mes < '01' || mes > '12') return null
  if (dia === '00') return fimDoMes(`${ano}-${mes}`)
  if (dia < '01' || dia > '31') return null
  return `${ano}-${mes}-${dia}`
}

/**
 * Interpreta o texto lido. **Nunca lança** — texto estranho vira
 * `desconhecido`, e a tela oferece digitar o código.
 *
 * A ordem dos três reconhecimentos é a do protótipo, e ela importa: a etiqueta
 * primeiro (ela é nossa e é inequívoca), depois o GS1 (que começa com o AI
 * `01` seguido de 14 dígitos), e só então o código de barras nu.
 */
export function interpretarCodigo(bruto: string): CodigoLido {
  const t = String(bruto ?? '').trim()

  const etiqueta = ETIQUETA.exec(t)
  if (etiqueta !== null) return { tipo: 'etiqueta', itemId: etiqueta[1]! }

  // Os prefixos de simbologia que o leitor às vezes entrega (`]d2` para
  // DataMatrix, `]C1` para GS1-128, `]Q3` para QR), e o separador de grupo
  // (ASCII 29) normalizado para `|`.
  const gs = t.replace(/^\]d2|^\]C1|^\]Q3/, '').replace(/\u001d/g, '|')

  if (/^01\d{14}/.test(gs)) {
    const gtin = gs.slice(2, 16)
    let validade: string | null = null
    let lote = ''
    let resto = gs.slice(16)
    // Os AIs vêm concatenados, e só os de tamanho fixo podem ser lidos por
    // posição. `10` (lote) e `21` (série) são de tamanho VARIÁVEL e terminam no
    // separador de grupo — ler 20 caracteres fixos ali comeria o AI seguinte.
    while (resto.length > 0) {
      resto = resto.replace(/^\|/, '')
      const ai = resto.slice(0, 2)
      if (ai === '17' || ai === '15') {
        const v = dataGs1(resto.slice(2, 8))
        if (ai === '17') validade = v
        resto = resto.slice(8)
        continue
      }
      if (ai === '10' || ai === '21') {
        const fim = resto.indexOf('|')
        const valor = fim < 0 ? resto.slice(2) : resto.slice(2, fim)
        if (ai === '10') lote = valor
        resto = fim < 0 ? '' : resto.slice(fim)
        continue
      }
      // AI desconhecido: parar é o certo. Adivinhar o tamanho dele faria o
      // resto da leitura ser interpretado deslocado, e a validade sairia de
      // um pedaço de outro campo.
      break
    }
    return { tipo: 'medicamento', gtin, validade, lote }
  }

  if (/^\d{8,14}$/.test(t)) return { tipo: 'barras', gtin: t.padStart(14, '0') }
  return { tipo: 'desconhecido', texto: t }
}

/**
 * A forma canônica de um GTIN: **14 dígitos**, com zeros à esquerda.
 *
 * EAN-13 e GTIN-14 do mesmo produto são o mesmo código. É a mesma
 * normalização que o servidor grava, e existe aqui para a tela poder comparar
 * o que leu com o que o catálogo tem — sem uma ida ao servidor por leitura.
 */
export const gtinCanonico = (gtin: string): string => gtin.replace(/\D/g, '').padStart(14, '0')
