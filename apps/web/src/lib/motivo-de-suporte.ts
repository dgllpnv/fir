/**
 * O motivo que o Suporte Firmare informa ao mexer num registro da clínica.
 * Mesma faixa do contrato (`MotivoDeSuporte`: 10 a 200 após o trim) — a tela
 * só adianta o recado; quem recusa de verdade é o servidor.
 */
export const MOTIVO_MIN = 10
export const MOTIVO_MAX = 200

export type ResultadoDoMotivo =
  | { readonly ok: true; readonly motivo: string }
  | { readonly ok: false; readonly erro: string }

export function validarMotivoDeSuporte(texto: string): ResultadoDoMotivo {
  const motivo = texto.trim()
  if (motivo.length < MOTIVO_MIN) {
    return { ok: false, erro: `Escreva ao menos ${MOTIVO_MIN} caracteres (faltam ${MOTIVO_MIN - motivo.length}).` }
  }
  if (motivo.length > MOTIVO_MAX) {
    return { ok: false, erro: `No máximo ${MOTIVO_MAX} caracteres.` }
  }
  return { ok: true, motivo }
}

/** Corpo do DELETE/POST: só leva `motivo` quando há um. */
export function corpoComMotivo(motivo: string | undefined): { body: string } | Record<string, never> {
  return motivo === undefined ? {} : { body: JSON.stringify({ motivo }) }
}

/** `entidadeId` curto para a tabela de Atividades: os últimos 8 caracteres. */
export function idCurto(id: string | null): string | null {
  if (id === null || id === '') return null
  return id.length <= 8 ? id : id.slice(-8)
}
