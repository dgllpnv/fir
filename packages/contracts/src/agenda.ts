import { z } from 'zod'
import { Uuid } from './comum'

/**
 * A agenda do sistema da clínica (ADR 0019) — `GET/PUT /v1/agenda-externa`.
 *
 * O link iCal é SEGREDO: entra pelo `PUT` e nunca sai. A tela recebe só
 * `urlMascarada` (host + 4 últimos caracteres), o bastante para a gestora
 * reconhecer qual link está colado sem que a recepção, o log do navegador ou
 * uma captura de tela levem o token.
 */
export const ResumoDaSincronizacao = z.object({
  vistos: z.number().int(),
  criados: z.number().int(),
  reagendados: z.number().int(),
  desmarcados: z.number().int(),
  ignorados: z.number().int(),
  pacientesNovos: z.number().int(),
})
export type ResumoDaSincronizacao = z.infer<typeof ResumoDaSincronizacao>

export const AgendaExterna = z.discriminatedUnion('configurada', [
  z.object({ configurada: z.literal(false) }),
  z.object({
    configurada: z.literal(true),
    ativa: z.boolean(),
    urlMascarada: z.string(),
    responsavelId: Uuid,
    responsavelNome: z.string(),
    palavrasIgnorar: z.array(z.string()),
    /** ISO 8601 UTC. */
    ultimaLeituraEm: z.string().nullable(),
    ultimoSucessoEm: z.string().nullable(),
    /** Mensagem para a tela. Vazio quando a última leitura deu certo. */
    ultimoErro: z.string(),
    ultimoResumo: ResumoDaSincronizacao.nullable(),
  }),
])
export type AgendaExterna = z.infer<typeof AgendaExterna>

/**
 * Salvar a agenda. `url` é obrigatória na primeira vez e opcional depois:
 * ausente, o link guardado continua — a tela não tem o link para reenviar, e
 * é assim que deve ser.
 */
export const SalvarAgendaExterna = z
  .object({
    url: z
      .string()
      .trim()
      .max(2000)
      .regex(/^(https|webcals?):\/\//i, 'Cole o link iCal completo, começando com https:// ou webcal://.')
      .optional(),
    responsavelId: Uuid,
    ativa: z.boolean(),
    palavrasIgnorar: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
  })
  .strict()
export type SalvarAgendaExterna = z.infer<typeof SalvarAgendaExterna>

/** `POST /v1/agenda-externa/sincronizar` — o pedido entra na fila do worker. */
export const SincronizacaoPedida = z.object({ pedida: z.literal(true) })
export type SincronizacaoPedida = z.infer<typeof SincronizacaoPedida>
