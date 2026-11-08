import { SENHA_MAX } from '@fir/domain'
import { z } from 'zod'
import { CarteiraEuSaida } from './carteira'

/**
 * SEGUNDO FATOR (TOTP) DO `Usuário de Gestão` — gate appsec A-12, ADR 0022.
 * Substitui a emenda de 2026-11-05 da ADR 0012 ("sem MFA"): o comentário no
 * topo de `carteira.ts` que diz o contrário é anterior a esta decisão.
 *
 * Os códigos chegam como texto e são normalizados pelo DOMÍNIO
 * (`normalizarCodigoTotp`, `normalizarCodigoDeRecuperacao`) no servidor: um
 * código mal formado é um código errado, e conta como tentativa — o formato
 * não é atalho para errar de graça.
 */

const Codigo = z.string().min(1, 'Informe o código.').max(32)

/** O estado que a tela precisa para decidir para onde mandar a pessoa. */
export const EstadoDoSegundoFatorNaSessao = z.object({ ativo: z.boolean() })
export type EstadoDoSegundoFatorNaSessao = z.infer<typeof EstadoDoSegundoFatorNaSessao>

/** `GET /v1/carteira/eu` — o `eu` de sempre, mais o estado do segundo fator. */
export const CarteiraEuComSegundoFatorSaida = CarteiraEuSaida.extend({
  segundoFator: EstadoDoSegundoFatorNaSessao,
})
export type CarteiraEuComSegundoFatorSaida = z.infer<typeof CarteiraEuComSegundoFatorSaida>

/**
 * A segunda etapa do login — no MESMO `POST /v1/carteira/entrar`, com o
 * cookie do desafio. Um dos dois campos, nunca os dois.
 */
export const SegundaEtapaDeEntrarNaCarteiraEntrada = z.union([
  z.object({ codigo: Codigo }).strict(),
  z.object({ codigoDeRecuperacao: Codigo }).strict(),
])
export type SegundaEtapaDeEntrarNaCarteiraEntrada = z.infer<typeof SegundaEtapaDeEntrarNaCarteiraEntrada>

/** Um código de recuperação foi usado desde a última entrada (A-12). */
export const AvisoDeRecuperacao = z.object({ usadoEm: z.string(), codigosRestantes: z.number().int() })
export type AvisoDeRecuperacao = z.infer<typeof AvisoDeRecuperacao>

/**
 * O que `POST /v1/carteira/entrar` devolve:
 *  - `{ segundoFatorExigido: true }` — a senha conferiu e a conta tem TOTP;
 *    NENHUMA sessão nasceu, só o cookie do desafio (5 min).
 *  - o `eu` com o estado do segundo fator — a sessão nasceu. Se o segundo
 *    fator ainda não está ativo, a sessão só alcança o cadastro, `eu` e
 *    `sair`.
 */
export const EntrarNaCarteiraSaida = z.union([
  z.object({ segundoFatorExigido: z.literal(true) }),
  CarteiraEuComSegundoFatorSaida.extend({
    avisoDeRecuperacao: AvisoDeRecuperacao.nullable(),
  }),
])
export type EntrarNaCarteiraSaida = z.infer<typeof EntrarNaCarteiraSaida>

/** `GET /v1/carteira/eu/segundo-fator`. Nunca o segredo. */
export const SegundoFatorDaCarteiraSaida = z.object({
  ativo: z.boolean(),
  ativadoEm: z.string().nullable(),
  codigosRestantes: z.number().int(),
})
export type SegundoFatorDaCarteiraSaida = z.infer<typeof SegundoFatorDaCarteiraSaida>

/** Começar o cadastro exige reconfirmar a senha (A-12). */
export const IniciarCadastroDoSegundoFatorEntrada = z
  .object({ senha: z.string().min(1, 'Informe a sua senha.').max(SENHA_MAX) })
  .strict()
export type IniciarCadastroDoSegundoFatorEntrada = z.infer<typeof IniciarCadastroDoSegundoFatorEntrada>

/**
 * O segredo PENDENTE — a única resposta em que ele aparece. A tela gera o QR
 * de `uri` no navegador; `segredo` é para digitar à mão.
 */
export const CadastroDoSegundoFatorSaida = z.object({ uri: z.string(), segredo: z.string() })
export type CadastroDoSegundoFatorSaida = z.infer<typeof CadastroDoSegundoFatorSaida>

export const ConfirmarCadastroDoSegundoFatorEntrada = z.object({ codigo: Codigo }).strict()
export type ConfirmarCadastroDoSegundoFatorEntrada = z.infer<typeof ConfirmarCadastroDoSegundoFatorEntrada>

/** Gerar códigos novos: reautenticação AGORA — senha e código (A-12). */
export const RegenerarCodigosDeRecuperacaoEntrada = z
  .object({ senha: z.string().min(1, 'Informe a sua senha.').max(SENHA_MAX), codigo: Codigo })
  .strict()
export type RegenerarCodigosDeRecuperacaoEntrada = z.infer<typeof RegenerarCodigosDeRecuperacaoEntrada>

/** Os dez códigos, em claro — só nesta resposta. Nunca mais recuperáveis. */
export const CodigosDeRecuperacaoSaida = z.object({ codigosDeRecuperacao: z.array(z.string()) })
export type CodigosDeRecuperacaoSaida = z.infer<typeof CodigosDeRecuperacaoSaida>

/** O reset pelo Operador: motivo obrigatório, vai para `auditoria_do_painel`. */
export const ResetarSegundoFatorEntrada = z
  .object({
    motivo: z
      .string()
      .trim()
      .min(10, 'Escreva o motivo e como a identidade foi confirmada (mínimo 10 caracteres).')
      .max(500),
  })
  .strict()
export type ResetarSegundoFatorEntrada = z.infer<typeof ResetarSegundoFatorEntrada>
