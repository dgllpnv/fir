import { FRENTES_DO_PARCEIRO } from '@fir/domain'
import { z } from 'zod'
import { DiaCivil, Uuid } from './comum'

/**
 * **G8 3A — mensagens prontas e WhatsApp da carteira** (inventário X4, W1,
 * W2, W4, $3, L9, L10, L13; appsec A-14, A-19; LGPD A35–A39; PP-6).
 *
 * Nenhum campo monetário pelo NOME: o valor da mensalidade só existe DENTRO
 * do texto montado, e esse texto é montado no servidor com a redação aplicada
 * antes (`montarMensagemDoCliente`). Por isso nada aqui entra em
 * `CAMPOS_MONETARIOS` — e `chavePix` sai `null` pelo serviço para quem não
 * tem `valores`.
 *
 * O texto montado nunca viaja em query string (A-14): `montar` é `POST`.
 */

/** Chave estável de um modelo de mensagem (`pagamento`, `fluxo`… ou `m_<id>` para os criados). */
export const ChaveDeModelo = z.string().regex(/^[a-z0-9_]{1,40}$/)

const titulo = z.string().trim().min(1).max(120)
const textoDoModelo = z.string().trim().min(1).max(4000)

/* ── Modelos de mensagem (X4) ──────────────────────────────────────────── */

export const ModeloDeMensagem = z.object({
  chave: ChaveDeModelo,
  titulo: z.string(),
  texto: z.string(),
})
export type ModeloDeMensagem = z.infer<typeof ModeloDeMensagem>

export const ModelosDeMensagemSaida = z.object({
  modelos: z.array(ModeloDeMensagem),
  variaveisDisponiveis: z.array(z.string()),
  podeEditar: z.boolean(),
})
export type ModelosDeMensagemSaida = z.infer<typeof ModelosDeMensagemSaida>

export const CriarModeloDeMensagemEntrada = z.object({ titulo, texto: textoDoModelo }).strict()
export type CriarModeloDeMensagemEntrada = z.infer<typeof CriarModeloDeMensagemEntrada>

export const EditarModeloDeMensagemEntrada = z
  .object({ titulo: titulo.optional(), texto: textoDoModelo.optional() })
  .strict()
  .refine((x) => x.titulo !== undefined || x.texto !== undefined, { message: 'nada para mudar' })
export type EditarModeloDeMensagemEntrada = z.infer<typeof EditarModeloDeMensagemEntrada>

export const ModeloDeMensagemSaida = z.object({ modelo: ModeloDeMensagem })
export type ModeloDeMensagemSaida = z.infer<typeof ModeloDeMensagemSaida>

/* ── Roteiros de abordagem comercial (L9, L10) ─────────────────────────── */

export const RoteiroComercial = z.object({
  id: Uuid,
  /** `primeiro`, `agendar`… para os oito padrão; `null` para os criados (L2955). */
  chave: z.string().nullable(),
  titulo: z.string(),
  quando: z.string(),
  /** Vazio = só guia de conversa, sem mensagem para enviar ("Respostas para objeções"). */
  mensagem: z.string(),
  passos: z.array(z.string()),
})
export type RoteiroComercial = z.infer<typeof RoteiroComercial>

export const RoteirosComerciaisSaida = z.object({
  roteiros: z.array(RoteiroComercial),
  variaveisDisponiveis: z.array(z.string()),
  podeEditar: z.boolean(),
})
export type RoteirosComerciaisSaida = z.infer<typeof RoteirosComerciaisSaida>

const passos = z.array(z.string().trim().min(1).max(400)).max(30)

export const CriarRoteiroComercialEntrada = z
  .object({
    titulo,
    quando: z.string().trim().max(200).default(''),
    mensagem: z.string().trim().max(4000).default(''),
    passos: passos.default([]),
  })
  .strict()
export type CriarRoteiroComercialEntrada = z.infer<typeof CriarRoteiroComercialEntrada>

export const EditarRoteiroComercialEntrada = z
  .object({
    titulo: titulo.optional(),
    quando: z.string().trim().max(200).optional(),
    mensagem: z.string().trim().max(4000).optional(),
    passos: passos.optional(),
  })
  .strict()
export type EditarRoteiroComercialEntrada = z.infer<typeof EditarRoteiroComercialEntrada>

export const RoteiroComercialSaida = z.object({ roteiro: RoteiroComercial })
export type RoteiroComercialSaida = z.infer<typeof RoteiroComercialSaida>

/* ── Configuração da carteira (Pix, favorecido, benefício) ─────────────── */

export const ConfiguracaoDasMensagensSaida = z.object({
  /** `null` sem `valores` (e quando não cadastrada — `pagamentoVisivel` diz qual). */
  chavePix: z.string().nullable(),
  favorecido: z.string().nullable(),
  /** "10% de desconto na mensalidade seguinte" — a regra vigente do benefício de indicação, só leitura aqui. */
  beneficio: z.string(),
  /** A sessão vê os dados de pagamento (tem `valores`). Sem isso a tela mostra "restrito". */
  pagamentoVisivel: z.boolean(),
  podeEditarPagamento: z.boolean(),
})
export type ConfiguracaoDasMensagensSaida = z.infer<typeof ConfiguracaoDasMensagensSaida>

export const EditarPagamentoDaCarteiraEntrada = z
  .object({
    chavePix: z.string().trim().min(1).max(140).nullable(),
    favorecido: z.string().trim().min(1).max(160).nullable(),
  })
  .strict()
export type EditarPagamentoDaCarteiraEntrada = z.infer<typeof EditarPagamentoDaCarteiraEntrada>

/* ── Montar e registrar o envio (W1, W2, L9, PP-6) ─────────────────────── */

export const FrenteDoParceiroContrato = z.enum(FRENTES_DO_PARCEIRO)

/**
 * A quem a mensagem vai. Para o cliente: um modelo (`chave`), opcionalmente
 * de uma tarefa (o dia e o remetente saem dela) e de uma frente (mensagem ao
 * parceiro). Para o lead: um roteiro, pela chave ou pelo id.
 */
export const DestinoDaMensagem = z.discriminatedUnion('para', [
  z
    .object({
      para: z.literal('cliente'),
      clienteId: Uuid,
      chave: ChaveDeModelo,
      tarefaInternaId: Uuid.optional(),
      frente: FrenteDoParceiroContrato.optional(),
    })
    .strict(),
  z
    .object({
      para: z.literal('lead'),
      leadId: Uuid,
      roteiro: z.string().trim().min(1).max(60),
    })
    .strict(),
])
export type DestinoDaMensagem = z.infer<typeof DestinoDaMensagem>

export const MontarMensagemEntrada = z.object({ destino: DestinoDaMensagem }).strict()
export type MontarMensagemEntrada = z.infer<typeof MontarMensagemEntrada>

export const DestinatarioDaMensagemContrato = z.enum(['cliente', 'cobranca', 'parceiro', 'lead'])

export const MensagemMontadaSaida = z.object({
  /** O título do modelo ou do roteiro. */
  titulo: z.string(),
  /** "Clínica Pontes", "Agência X · Clínica Pontes", "Dra. Larissa Moura". */
  para: z.string(),
  texto: z.string(),
  avisos: z.array(z.string()),
  /** Só dígitos, pronto para o `wa.me`. `null` = sem botão de WhatsApp (falta, inválido ou mensagem restrita). */
  telefone: z.string().nullable(),
  destinatario: DestinatarioDaMensagemContrato,
  restrita: z.boolean(),
  /** O passo a passo do roteiro (L2523); vazio para modelo. */
  passos: z.array(z.string()),
  /**
   * Quando alguém CONFIRMOU ter enviado esta mensagem a este destino pela
   * última vez (instante ISO), ou `null`. É o que a pessoa marcou, nunca uma
   * prova de entrega (PP-6).
   */
  ultimoEnvioConfirmado: z.object({ em: z.string(), dia: DiaCivil }).nullable(),
})
export type MensagemMontadaSaida = z.infer<typeof MensagemMontadaSaida>

/**
 * "Marcar como enviada" — o FATO, sem o texto (LGPD A36). Idempotente pela
 * chave gerada a cada modal aberto (A-14): repetir não cria dois.
 */
export const RegistrarEnvioDeMensagemEntrada = z
  .object({ chaveIdempotencia: Uuid, destino: DestinoDaMensagem })
  .strict()
export type RegistrarEnvioDeMensagemEntrada = z.infer<typeof RegistrarEnvioDeMensagemEntrada>

export const EnvioDeMensagemRegistradoSaida = z.object({
  envioConfirmadoEm: z.string(),
  /** O dia civil do envio no fuso da carteira (servidor, regra 22). */
  envioConfirmadoNoDia: DiaCivil,
  /** A mesma chave já tinha sido registrada — nada novo foi gravado. */
  repetido: z.boolean(),
})
export type EnvioDeMensagemRegistradoSaida = z.infer<typeof EnvioDeMensagemRegistradoSaida>

/** Oposição do parceiro de uma frente ao contato (LGPD A37). */
export const OposicaoDoParceiroEntrada = z.object({ naoContatar: z.boolean() }).strict()
export type OposicaoDoParceiroEntrada = z.infer<typeof OposicaoDoParceiroEntrada>

/** Os códigos de recusa que a tela casa. */
export const CODIGO_NAO_CONTATAR = 'NAO_CONTATAR'
export const CODIGO_MENSAGEM_RESTRITA = 'MENSAGEM_RESTRITA'
