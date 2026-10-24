import { z } from 'zod'
import { Uuid } from './comum'

export const EntrarEntrada = z.object({
  // A clínica entra aqui, no contrato, e não lida solta do corpo no
  // controlador: um campo que o schema não conhece é um campo que ninguém
  // valida.
  clinica: z.string().trim().toLowerCase().min(1, 'Informe a clínica.').max(60),
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.'),
  // Oito é o piso; a força real vem do limite de tentativas e do Argon2id.
  senha: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres.').max(200),
})
export type EntrarEntrada = z.infer<typeof EntrarEntrada>

export const PerfilPublico = z.object({
  id: Uuid,
  chave: z.string(),
  nome: z.string(),
  perms: z.array(z.string()),
})
export type PerfilPublico = z.infer<typeof PerfilPublico>

export const PessoaPublica = z.object({
  id: Uuid,
  nome: z.string(),
  email: z.string(),
  funcao: z.string(),
  admin: z.boolean(),
  perfilId: Uuid.nullable(),
  ativo: z.boolean(),
})
export type PessoaPublica = z.infer<typeof PessoaPublica>

export const ClinicaPublica = z.object({
  id: Uuid,
  codigo: z.string(),
  nome: z.string(),
  fuso: z.string(),
})
export type ClinicaPublica = z.infer<typeof ClinicaPublica>

/** O que `GET /v1/eu` devolve. A tela monta o menu a partir de `perfis`. */
export const EuSaida = z.object({
  usuario: PessoaPublica,
  clinica: ClinicaPublica,
  perfis: z.array(PerfilPublico),
})
export type EuSaida = z.infer<typeof EuSaida>

export const EntrarSaida = EuSaida
export type EntrarSaida = z.infer<typeof EntrarSaida>
