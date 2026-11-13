import type { RazaoDeDesativacao } from '@fir/contracts'
import { MOTIVO_MAX, MOTIVO_MIN } from './motivo-de-suporte'

export const DETALHE_MAX = 200

/** Corpo do `DELETE /v1/pacientes/:id`: a razão sempre; detalhe e motivo de suporte quando há. */
export function corpoDeDesativar(
  razao: RazaoDeDesativacao,
  detalhe: string,
  motivoDeSuporte?: string,
): { body: string } {
  const d = detalhe.trim()
  return {
    body: JSON.stringify({
      razao,
      ...(d === '' ? {} : { detalhe: d }),
      ...(motivoDeSuporte === undefined ? {} : { motivo: motivoDeSuporte }),
    }),
  }
}

export type ResultadoDaReativacao =
  | { readonly ok: true; readonly corpo: { body: string } | Record<string, never> }
  | { readonly ok: false; readonly erro: string }

/**
 * Reativar quem pediu para sair exige confirmação marcada e motivo de 10 a 200.
 * A tela só adianta o recado: quem decide é o servidor, que lê a razão do banco.
 */
export function prepararReativacao(
  reforcada: boolean,
  confirmou: boolean,
  motivo: string,
  motivoDeSuporte?: string,
): ResultadoDaReativacao {
  if (!reforcada) {
    return {
      ok: true,
      corpo:
        motivoDeSuporte === undefined
          ? {}
          : { body: JSON.stringify({ motivo: motivoDeSuporte }) },
    }
  }
  if (!confirmou) return { ok: false, erro: 'Marque que o titular pediu para voltar a ser contatado.' }
  const m = (motivoDeSuporte ?? motivo).trim()
  if (m.length < MOTIVO_MIN || m.length > MOTIVO_MAX) {
    return { ok: false, erro: `O motivo deve ter de ${MOTIVO_MIN} a ${MOTIVO_MAX} caracteres.` }
  }
  return { ok: true, corpo: { body: JSON.stringify({ confirmoQueOTitularPediu: true, motivo: m }) } }
}
