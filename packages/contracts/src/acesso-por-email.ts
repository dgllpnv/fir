import {
  FINALIDADES_DE_LINK,
  SENHA_MAX,
  canonizarEmail,
  ehErro,
  validarEmail,
} from '@fir/domain'
import { z } from 'zod'

/**
 * Acesso por e-mail e redefinição de senha (ADR 2026-11-16, spec
 * `acesso-por-email.md`, seção 10 prevalecendo).
 *
 * O e-mail canoniza e DEPOIS valida, como o usuário: o teclado do celular
 * entrega `Juliana@Gmail.com `, e o que segue adiante é a forma do banco. A
 * mensagem é a do domínio, a mesma que a tela mostra antes do envio.
 */
export const EmailCanonico = z
  .string()
  .max(320)
  .transform(canonizarEmail)
  .superRefine((v, ctx) => {
    const r = validarEmail(v)
    if (ehErro(r)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.erro.mensagem })
  })

/** `GET /v1/acesso/config` — a tela de entrada esconde "Esqueci minha senha" quando é `false`. */
export const ConfigDoAcesso = z.object({ envioDeEmail: z.boolean() }).strict()
export type ConfigDoAcesso = z.infer<typeof ConfigDoAcesso>

/**
 * A frase ÚNICA do esqueci-senha (spec 3.5, appsec 11): e-mail com conta, sem
 * conta, clínica inexistente, limite estourado e envio desligado respondem
 * estes mesmos bytes, com o mesmo 202.
 */
export const FRASE_DO_ESQUECI_SENHA =
  'Se o e-mail estiver cadastrado, enviamos um link para criar uma senha nova.'

export const EsqueciSenhaEntrada = z
  .object({
    clinica: z.string().trim().toLowerCase().min(1, 'Informe a clínica.').max(60),
    email: EmailCanonico,
  })
  .strict()
export type EsqueciSenhaEntrada = z.infer<typeof EsqueciSenhaEntrada>

export const EsqueciSenhaSaida = z.object({ mensagem: z.literal(FRASE_DO_ESQUECI_SENHA) }).strict()
export type EsqueciSenhaSaida = z.infer<typeof EsqueciSenhaSaida>

/**
 * O token cru do link: 32 bytes em base64url, sem preenchimento — 43
 * caracteres. Qualquer outra forma é recusada antes de virar hash, e responde
 * como link que não vale (410), nunca como erro de forma que diga "quase".
 */
export const TokenDeLink = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

export const ConsultarLinkEntrada = z.object({ token: z.string().max(200) }).strict()
export type ConsultarLinkEntrada = z.infer<typeof ConsultarLinkEntrada>

/**
 * O que `/criar-senha` e `/confirmar-email` mostram. `usuario` aparece AQUI e
 * nunca no corpo do e-mail (LGPD L1): quem chega a esta tela tem o link, que
 * só foi para a caixa de entrada da pessoa. `email` é o endereço para onde o
 * link foi.
 */
export const LinkConsultado = z
  .object({
    finalidade: z.enum(FINALIDADES_DE_LINK),
    primeiroNome: z.string(),
    clinicaNome: z.string(),
    clinicaCodigo: z.string(),
    usuario: z.string(),
    email: z.string(),
  })
  .strict()
export type LinkConsultado = z.infer<typeof LinkConsultado>

/**
 * Usar o link. Convite e redefinição exigem `senha`; a confirmação de e-mail
 * não aceita uma (400). `min(1)` e não `min(SENHA_MIN)`: quem julga é
 * `avaliarSenha`, no servidor, e a frase dela volta como 422.
 */
export const UsarLinkEntrada = z
  .object({
    token: z.string().max(200),
    senha: z.string().min(1, 'Informe a senha.').max(SENHA_MAX).optional(),
  })
  .strict()
export type UsarLinkEntrada = z.infer<typeof UsarLinkEntrada>

/**
 * Cadastrar, trocar ou RETIRAR o próprio e-mail (`email: null`, LGPD L8).
 *
 * `senha` é a senha ATUAL, sempre (appsec 1): sem ela, quem achar uma sessão
 * aberta no balcão cadastra o próprio e-mail e redefine a senha quando quiser —
 * tomada de conta que a troca de senha não desfaz.
 */
export const CadastrarMeuEmailEntrada = z
  .object({
    email: EmailCanonico.nullable(),
    senha: z.string().min(1, 'Informe a sua senha atual.').max(SENHA_MAX),
  })
  .strict()
export type CadastrarMeuEmailEntrada = z.infer<typeof CadastrarMeuEmailEntrada>

/**
 * O 202 das rotas que mandam e-mail (`/eu/email`, reenviar convite, enviar a
 * redefinição): o endereço MASCARADO, para a tela dizer "enviamos para j***@…"
 * sem repetir o endereço inteiro na resposta.
 */
export const EnvioFeito = z.object({ enviadoPara: z.string().nullable() }).strict()
export type EnvioFeito = z.infer<typeof EnvioFeito>
