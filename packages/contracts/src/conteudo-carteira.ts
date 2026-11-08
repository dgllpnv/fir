import { z } from 'zod'
import { DiaCivil, Uuid } from './comum'

/**
 * **G8 1B — reuniões, documentos e materiais da carteira, escritos pela
 * equipe Firmare** (inventário V13, V14, X2; gates LGPD A6–A14, appsec A-7,
 * A-9, A-18, A-20).
 *
 * Nenhum campo monetário: nada aqui entra em `CAMPOS_MONETARIOS`.
 */

/* ── Vocabulário fechado, copiado do protótipo ─────────────────────────── */

/** `TIPO_REU` (protótipo L1650). 'importada' só nasce da importação do Asana (4B). */
export const TIPOS_DE_REUNIAO = ['semanal', 'mensal', 'diagnostico', 'extra', 'importada'] as const
export type TipoDeReuniao = (typeof TIPOS_DE_REUNIAO)[number]
export const TIPOS_DE_REUNIAO_DO_FORMULARIO = ['semanal', 'mensal', 'diagnostico', 'extra'] as const

/** `DOC_CAT` (protótipo L514). */
export const CATEGORIAS_DE_DOCUMENTO = [
  'Contrato',
  'Diagnóstico',
  'Plano de ação',
  'Política e processo',
  'Relatório',
  'Material de apoio',
] as const
export type CategoriaDeDocumento = (typeof CATEGORIAS_DE_DOCUMENTO)[number]

/** `TIPOS_MAT` (protótipo L2675). */
export const TIPOS_DE_MATERIAL = ['Planilha', 'Documento', 'Script', 'Modelo de mensagem', 'Apresentação'] as const
export type TipoDeMaterial = (typeof TIPOS_DE_MATERIAL)[number]

/** `PROG_MAT` (protótipo L2676). */
export const PROGRAMAS_DE_MATERIAL = ['Comercial', 'Financeiro', 'Operações', 'Gestão', 'Todos'] as const

export const SAUDES_DA_REUNIAO = ['bom', 'atencao', 'critico'] as const

/**
 * Link de documento, material ou anexo: só `https` (inventário V13; LGPD
 * A11). O servidor nunca busca, encurta nem pré-visualiza o link — ele é
 * guardado e devolvido como texto.
 */
export const LinkHttps = z
  .string()
  .trim()
  .max(2000)
  .url('Informe um link válido.')
  .refine((u) => u.toLowerCase().startsWith('https://'), 'O link precisa começar com https://')

const textoOpcional = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.trim())
    .transform((s) => (s === '' ? null : s))
    .nullable()

/* ── Anexo por link (enquanto o de arquivo não chega à ficha) ──────────── */

/**
 * Anexo de ata por LINK (`reunioes_comerciais.anexos`, jsonb). O anexo de
 * ARQUIVO mora em `anexos_carteira` (4C) e é listado pelo serviço de anexos —
 * este contrato não o carrega.
 */
export const AnexoPorLink = z
  .object({
    nome: z.string().trim().min(1).max(200),
    url: LinkHttps,
  })
  .strict()
export type AnexoPorLink = z.infer<typeof AnexoPorLink>

/* ── Reuniões ──────────────────────────────────────────────────────────── */

const camposDaAta = {
  data: DiaCivil,
  tipo: z.enum(TIPOS_DE_REUNIAO_DO_FORMULARIO),
  participantes: textoOpcional(500),
  resumo: z.string().trim().min(1, 'Escreva o que foi visto.').max(4000),
  encaminhamentos: textoOpcional(4000),
  /** Nunca vai ao portal (gate LGPD §3) — o portal nem tem privilégio na coluna. */
  notasInternas: textoOpcional(4000),
  saudeRegistrada: z.enum(SAUDES_DA_REUNIAO),
  anexos: z.array(AnexoPorLink).max(20),
}

/**
 * "Registrar reunião" (`abrirReuniao`/`salvarReuniao`, L1654–1712).
 *
 * `compartilhada` é OBRIGATÓRIO e explícito: o formulário nasce desmarcado
 * (L1671, LGPD A6), mas a API não presume — quem chama diz.
 *
 * `chaveIdempotencia` (A-20): gerada pelo formulário ao abrir. O mesmo envio
 * repetido devolve a ata já criada, sem tarefa nova.
 *
 * `tarefas: null` = "Criar uma tarefa para cada linha" desmarcado. O prazo
 * ausente vira hoje + 7 no fuso da carteira, calculado no SERVIDOR (regra 24).
 */
export const RegistrarReuniaoEntrada = z
  .object({
    chaveIdempotencia: Uuid,
    ...camposDaAta,
    compartilhada: z.boolean(),
    tarefas: z
      .object({
        responsavelUsuarioGestaoId: Uuid,
        prazo: DiaCivil.optional(),
      })
      .strict()
      .nullable(),
  })
  .strict()
export type RegistrarReuniaoEntrada = z.infer<typeof RegistrarReuniaoEntrada>

/** "Editar e anexar". Campo ausente = não mexe. Compartilhar tem rota própria. */
export const EditarReuniaoEntrada = z.object(camposDaAta).partial().strict()
export type EditarReuniaoEntrada = z.infer<typeof EditarReuniaoEntrada>

/**
 * Compartilhar / "Deixar só para a equipe" (L1817, L2843).
 *
 * `motivo`: exigido quando a ata é DEScompartilhada depois de o portal ter
 * sido lido (LGPD A10). Sem ele, a API responde 409
 * `MOTIVO_DO_DESCOMPARTILHAMENTO` e a tela pede.
 */
export const MudarCompartilhamentoEntrada = z
  .object({
    compartilhada: z.boolean(),
    motivo: z.string().trim().min(3).max(1000).optional(),
  })
  .strict()
export type MudarCompartilhamentoEntrada = z.infer<typeof MudarCompartilhamentoEntrada>

export const CODIGO_MOTIVO_DO_DESCOMPARTILHAMENTO = 'MOTIVO_DO_DESCOMPARTILHAMENTO'

/**
 * "Compartilhar todas" (L2844), com a confirmação que o gate exige (LGPD A8):
 * `esperadas` é a contagem que a pessoa CONFIRMOU; se o servidor contar outra
 * (alguém registrou uma ata no meio), recusa com 409 em vez de compartilhar o
 * que ninguém viu. As importadas do Asana só entram com a segunda marcação.
 */
export const CompartilharTodasEntrada = z
  .object({
    incluirImportadas: z.boolean(),
    esperadas: z.number().int().min(0).max(1000),
  })
  .strict()
export type CompartilharTodasEntrada = z.infer<typeof CompartilharTodasEntrada>

export const CODIGO_CONTAGEM_MUDOU = 'CONTAGEM_MUDOU'

export const PessoaDaFirmare = z.object({ id: Uuid, nome: z.string() })
export type PessoaDaFirmare = z.infer<typeof PessoaDaFirmare>

export const ReuniaoNaLista = z.object({
  id: Uuid,
  clienteCarteiraId: Uuid,
  data: DiaCivil,
  tipo: z.enum(TIPOS_DE_REUNIAO),
  participantes: z.string().nullable(),
  resumo: z.string(),
  encaminhamentos: z.string().nullable(),
  notasInternas: z.string().nullable(),
  saudeRegistrada: z.enum(SAUDES_DA_REUNIAO).nullable(),
  compartilhada: z.boolean(),
  registradaPor: PessoaDaFirmare,
  anexos: z.array(AnexoPorLink),
  /** "X de Y tarefas da reunião concluídas" (L1819). */
  tarefas: z.object({ total: z.number().int(), concluidas: z.number().int() }),
  criadoEm: z.string(),
})
export type ReuniaoNaLista = z.infer<typeof ReuniaoNaLista>

export const ReunioesDoClienteSaida = z.object({
  reunioes: z.array(ReuniaoNaLista),
  /** Saúde derivada (PP-3): o registro mais recente entre checkin e ata. */
  saudeAtual: z.enum(SAUDES_DA_REUNIAO).nullable(),
  /** Para a confirmação de "Compartilhar todas" (LGPD A8). */
  pendentesDeCompartilhar: z.object({ comuns: z.number().int(), importadas: z.number().int() }),
  /** Quem pode receber as tarefas dos encaminhamentos (mesmo grupo, ADR 0016). */
  responsaveis: z.array(PessoaDaFirmare),
  /** "Compartilhar todas" e arquivar: só quem administra (A-9). */
  podeAdministrar: z.boolean(),
  /** Prazo padrão das tarefas, hoje + 7 no fuso da carteira (servidor, regra 24). */
  prazoPadrao: DiaCivil,
})
export type ReunioesDoClienteSaida = z.infer<typeof ReunioesDoClienteSaida>

export const ReuniaoRegistradaSaida = z.object({
  reuniao: ReuniaoNaLista,
  tarefasCriadas: z.number().int(),
  /** O envio repetido (mesma chave): nada novo foi criado. */
  jaExistia: z.boolean(),
})
export type ReuniaoRegistradaSaida = z.infer<typeof ReuniaoRegistradaSaida>

export const ReuniaoSaida = z.object({ reuniao: ReuniaoNaLista })
export type ReuniaoSaida = z.infer<typeof ReuniaoSaida>

export const CompartilhamentoMudadoSaida = z.object({
  reuniao: ReuniaoNaLista,
  /** LGPD A10: o descompartilhamento depois de leitura foi registrado. */
  reversaoAposLeitura: z.boolean(),
})
export type CompartilhamentoMudadoSaida = z.infer<typeof CompartilhamentoMudadoSaida>

export const CompartilharTodasSaida = z.object({ compartilhadas: z.number().int() })
export type CompartilharTodasSaida = z.infer<typeof CompartilharTodasSaida>

/* ── Documentos ────────────────────────────────────────────────────────── */

/**
 * "Adicionar documento" (`F.doc`, L2764). `visivelPortal` OBRIGATÓRIO, sem
 * default (LGPD A12): o banco tem `DEFAULT true`, a API recusa a escrita sem
 * a escolha explícita.
 */
export const CriarDocumentoEntrada = z
  .object({
    titulo: z.string().trim().min(1).max(160),
    categoria: z.enum(CATEGORIAS_DE_DOCUMENTO),
    link: LinkHttps,
    visivelPortal: z.boolean(),
  })
  .strict()
export type CriarDocumentoEntrada = z.infer<typeof CriarDocumentoEntrada>

export const EditarDocumentoEntrada = CriarDocumentoEntrada.partial().strict()
export type EditarDocumentoEntrada = z.infer<typeof EditarDocumentoEntrada>

export const DocumentoNaLista = z.object({
  id: Uuid,
  clienteCarteiraId: Uuid,
  titulo: z.string(),
  categoria: z.string(),
  link: z.string(),
  data: DiaCivil,
  visivelPortal: z.boolean(),
})
export type DocumentoNaLista = z.infer<typeof DocumentoNaLista>

export const DocumentosDoClienteSaida = z.object({
  documentos: z.array(DocumentoNaLista),
  podeAdministrar: z.boolean(),
})
export type DocumentosDoClienteSaida = z.infer<typeof DocumentosDoClienteSaida>

export const DocumentoSaida = z.object({ documento: DocumentoNaLista })
export type DocumentoSaida = z.infer<typeof DocumentoSaida>

/* ── Materiais ─────────────────────────────────────────────────────────── */

const camposDoMaterial = {
  titulo: z.string().trim().min(1).max(160),
  tipo: z.enum(TIPOS_DE_MATERIAL),
  programas: z.array(z.enum(PROGRAMAS_DE_MATERIAL)).max(5),
  link: LinkHttps.nullable(),
  texto: textoOpcional(8000),
  descricao: textoOpcional(500),
}

/**
 * "Novo material personalizado" (`data-novomatcli`, L2803; `fMaterial`).
 * `visivelPortal` = "Quem pode receber: Pode ir para a cliente" — obrigatório,
 * sem default (LGPD A12).
 */
export const CriarMaterialDoClienteEntrada = z
  .object({ ...camposDoMaterial, visivelPortal: z.boolean() })
  .strict()
export type CriarMaterialDoClienteEntrada = z.infer<typeof CriarMaterialDoClienteEntrada>

export const EditarMaterialDoClienteEntrada = CriarMaterialDoClienteEntrada.partial().strict()
export type EditarMaterialDoClienteEntrada = z.infer<typeof EditarMaterialDoClienteEntrada>

/** "Novo material" da biblioteca geral (L2923). `usoInterno` obrigatório. */
export const CriarMaterialDaBibliotecaEntrada = z
  .object({ ...camposDoMaterial, usoInterno: z.boolean() })
  .strict()
export type CriarMaterialDaBibliotecaEntrada = z.infer<typeof CriarMaterialDaBibliotecaEntrada>

export const EditarMaterialDaBibliotecaEntrada = CriarMaterialDaBibliotecaEntrada.partial().strict()
export type EditarMaterialDaBibliotecaEntrada = z.infer<typeof EditarMaterialDaBibliotecaEntrada>

export const OrigemDoMaterial = z.enum(['biblioteca', 'personalizado'])
export type OrigemDoMaterial = z.infer<typeof OrigemDoMaterial>

export const MaterialNaLista = z.object({
  id: Uuid,
  origem: OrigemDoMaterial,
  titulo: z.string(),
  tipo: z.string(),
  programas: z.array(z.string()),
  /** "uso interno" (L2700): na biblioteca, `uso_interno`; no personalizado, `NOT visivel_portal`. */
  usoInterno: z.boolean(),
  link: z.string().nullable(),
  texto: z.string().nullable(),
  descricao: z.string().nullable(),
  /** Só na ficha de um cliente: o dia do último "Enviado em" (L2705), no fuso da carteira (servidor). */
  enviadoEm: DiaCivil.nullable(),
})
export type MaterialNaLista = z.infer<typeof MaterialNaLista>

export const MateriaisDoClienteSaida = z.object({
  programa: z.string(),
  personalizados: z.array(MaterialNaLista),
  doPrograma: z.array(MaterialNaLista),
  deOutrosProgramas: z.array(MaterialNaLista),
})
export type MateriaisDoClienteSaida = z.infer<typeof MateriaisDoClienteSaida>

export const BibliotecaSaida = z.object({
  materiais: z.array(MaterialNaLista),
  podeAdministrar: z.boolean(),
})
export type BibliotecaSaida = z.infer<typeof BibliotecaSaida>

export const MaterialSaida = z.object({ material: MaterialNaLista })
export type MaterialSaida = z.infer<typeof MaterialSaida>

/**
 * "Envio registrado" (L2810). A confirmação é EXPLÍCITA (PP-6): abrir o
 * WhatsApp não prova o envio.
 */
export const RegistrarEnvioDeMaterialEntrada = z
  .object({ origem: OrigemDoMaterial, materialId: Uuid })
  .strict()
export type RegistrarEnvioDeMaterialEntrada = z.infer<typeof RegistrarEnvioDeMaterialEntrada>

export const EnvioDeMaterialSaida = z.object({ enviadoEm: DiaCivil })
export type EnvioDeMaterialSaida = z.infer<typeof EnvioDeMaterialSaida>
