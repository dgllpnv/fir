import { z } from 'zod'
import { DiaCivil, Uuid } from './comum'

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
  /**
   * **O dia de negócio, do SERVIDOR, no fuso da clínica** (regra 24).
   *
   * Toda tela que precisa saber "que dia é hoje" — o `max` de um campo de
   * data, o agrupamento de contas vencidas, o mês corrente da Visão do mês —
   * lê daqui. O relógio do navegador não decide isso, e o do servidor web
   * tampouco: é um terceiro relógio, e a clínica que abre às 23h55 veria o
   * dia virar antes dela.
   *
   * Vem em `/v1/eu` porque toda página já resolve a sessão; uma rota só para
   * perguntar a data seria uma ida a mais em cada navegação.
   */
  hoje: DiaCivil,
})
export type EuSaida = z.infer<typeof EuSaida>

export const EntrarSaida = EuSaida
export type EntrarSaida = z.infer<typeof EntrarSaida>
