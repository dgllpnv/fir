import { z } from 'zod'

/**
 * Os grupos da carteira que recebem a clínica — a TRANSPARÊNCIA devida a ela
 * (spec clinica-em-varios-grupos §7; ADR 2026-11-10-clinica-em-varios-grupos).
 *
 * Cada grupo designado vira destinatário do uso agregado e da receita por
 * campanha da clínica; a clínica precisa saber quem, desde quando e por quê.
 *
 * Magro de propósito: nome do grupo, instante da designação (UTC) e o motivo
 * que o Operador escreveu. Nenhum cliente, valor, contato nem outra clínica.
 */
export const GrupoDaClinica = z.object({
  grupo: z.string(),
  desde: z.string().datetime(),
  motivo: z.string(),
})
export type GrupoDaClinica = z.infer<typeof GrupoDaClinica>

export const GruposDaClinica = z.object({
  grupos: z.array(GrupoDaClinica),
})
export type GruposDaClinica = z.infer<typeof GruposDaClinica>
