import { diaCivil } from '@fir/domain'

/**
 * A BORDA do MedX: o que vem de lá vira dado da FIR por funções puras, aqui,
 * e em nenhum outro lugar (spec integracao-medx B.1, B.11; gate S-15).
 */

/**
 * O relógio do MedX é `-03:00` (OpenAPI: "As datas usam UTC−03"). É constante
 * do ADAPTADOR, não da clínica: uma clínica em Manaus continua conversando
 * com um MedX que fala em horário de Brasília.
 */
const OFFSET_DO_MEDX_MIN = -180
const OFFSET_DO_MEDX = '-03:00'

const DATA_HORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,7})?)?(Z|[+-]\d{2}:\d{2})?$/

/**
 * Texto de data-hora do MedX → instante UTC. Sem offset, aplica `-03:00`; com
 * offset, respeita — e avisa (`offsetDiferente`) quando ele não é `-03:00`,
 * porque isso muda o que o resto do sistema entende por "o relógio do MedX".
 * Forma fora da gramática: `null` (quem chama aborta a leitura: contrato).
 */
export function instanteDoMedx(texto: string): { instante: Date; offsetDiferente: boolean } | null {
  const m = DATA_HORA.exec(texto)
  if (m === null) return null
  const [, a, mes, d, h, min, s, offset] = m
  const ms = Date.UTC(Number(a), Number(mes) - 1, Number(d), Number(h), Number(min), Number(s ?? 0))
  const conferido = new Date(ms)
  // Recusa 2026-02-30 e 25:00, que `Date.UTC` "corrige" em silêncio.
  if (
    conferido.getUTCFullYear() !== Number(a) ||
    conferido.getUTCMonth() !== Number(mes) - 1 ||
    conferido.getUTCDate() !== Number(d) ||
    conferido.getUTCHours() !== Number(h) ||
    conferido.getUTCMinutes() !== Number(min)
  ) {
    return null
  }
  const off = offset === undefined ? OFFSET_DO_MEDX : offset
  const minutos = off === 'Z' ? 0 : (off[0] === '-' ? -1 : 1) * (Number(off.slice(1, 3)) * 60 + Number(off.slice(4, 6)))
  return { instante: new Date(ms - minutos * 60_000), offsetDiferente: off !== OFFSET_DO_MEDX }
}

const SO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * O DIA de um pagamento do MedX, no calendário da clínica (spec C.7, parecer A4).
 *
 * Só data (`aaaa-mm-dd`): é o dia do MedX e fica como está — converter uma
 * data em instante e de volta em outro fuso troca o dia. Data e hora: o
 * instante (sem offset, `-03:00`) reduzido ao dia civil no fuso da clínica.
 * Fora da gramática: `null` (quem chama aborta: contrato).
 */
export function diaDoPagamento(texto: string, fuso: string): string | null {
  const d = SO_DATA.exec(texto)
  if (d !== null) {
    const t = new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])))
    return t.getUTCFullYear() === Number(d[1]) && t.getUTCMonth() === Number(d[2]) - 1 && t.getUTCDate() === Number(d[3])
      ? texto
      : null
  }
  const i = instanteDoMedx(texto)
  return i === null ? null : diaCivil(i.instante, fuso)
}

const dois = (n: number): string => String(n).padStart(2, '0')

/** Instante UTC → relógio de parede do MedX, sem offset (`2026-11-16T00:00:00`), para as bordas da janela. */
export function relogioDoMedx(instante: Date): string {
  const t = new Date(instante.getTime() + OFFSET_DO_MEDX_MIN * 60_000)
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}T${dois(t.getUTCHours())}:${dois(t.getUTCMinutes())}:${dois(t.getUTCSeconds())}`
}

// Controle (C0, C1), formatação invisível e os marcadores de direção (U+202E e família).
const PERIGOSOS = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g

/**
 * Nome de pessoa vindo de fora: NFC, sem controle nem bidi, espaços colapsados.
 * Até 120 caracteres — o teto de `pacientes.nome` (a spec diz até 200; o cadastro manda).
 */
export function nomeSeguro(texto: string | null | undefined): string {
  if (texto === null || texto === undefined) return ''
  // Espaço (tab, quebra) vira espaço ANTES de tirar o controle: senão "da\tSilva" vira "daSilva".
  return texto.normalize('NFC').replace(/\s+/g, ' ').replace(PERIGOSOS, '').replace(/ {2,}/g, ' ').trim().slice(0, 120).trim()
}

/** Telefone vindo de fora: só dígitos e `+ ( ) - espaço`, até 30. Sem dígito suficiente, `null`. */
export function telefoneSeguro(texto: string | null | undefined): string | null {
  if (texto === null || texto === undefined) return null
  const t = texto.replace(/[^\d+()\- ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30)
  return (t.match(/\d/g)?.length ?? 0) >= 8 ? t : null
}

/** Id do MedX (inteiro, pode ser negativo) como texto seguro para caminho de URL. */
export function idDoMedx(n: number): string | null {
  return Number.isSafeInteger(n) && Math.abs(n) <= 2_147_483_647 ? String(n) : null
}
