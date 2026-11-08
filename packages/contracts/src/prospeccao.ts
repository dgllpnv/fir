import {
  CANAIS_DE_CONTATO,
  ESCOPOS_DE_APLICACAO,
  ETAPAS_DO_LEAD,
  FREQUENCIAS_DA_ROTINA_INTERNA,
  SAUDES_DO_CLIENTE,
  TEMPERATURAS_DO_LEAD,
} from '@fir/domain'
import { z } from 'zod'
import { DiaCivil, Uuid, centavosNaSaida, dinheiroEmTexto } from './comum'

/**
 * G5 — funil de prospecção (`Lead comercial`) e rotina interna da equipe
 * Firmare. `docs/superpowers/plans/g5-spec-rotina-interna-funil.md`, ADR 0016.
 *
 * Todas as rotas vivem sob `/v1/carteira` (mesmo espaço do `CarteiraController`)
 * — o `Usuário de Gestão`, dentro do próprio escopo (emenda à ADR 0011, ADR
 * 0016 item 1).
 *
 * `grupoId` NUNCA aparece nestes contratos de ENTRADA: é a primeira camada do
 * achado crítico do ADR 0016 (item 2) — se o campo existisse no `.strict()`
 * de entrada, o `safeParse` aceitaria um valor do corpo da requisição antes
 * mesmo de o service decidir, e a decisão "nunca cru" ficaria fácil de
 * contornar por engano num endpoint futuro. A exceção documentada no spec —
 * lead de expansão de rede, criado já com `grupoId` por quem tem
 * `escopo='geral'` — entra como campo PRÓPRIO, nomeado para deixar claro que
 * é a exceção (`grupoIdDeExpansao`), nunca o nome genérico `grupoId`.
 */

export const EtapaDoLead = z.enum(ETAPAS_DO_LEAD)
export type EtapaDoLead = z.infer<typeof EtapaDoLead>

export const TemperaturaDoLead = z.enum(TEMPERATURAS_DO_LEAD)
export const SaudeDoCliente = z.enum(SAUDES_DO_CLIENTE)
export const EscopoDeAplicacaoDaRotina = z.enum(ESCOPOS_DE_APLICACAO)
export const FrequenciaDaRotinaInterna = z.enum(FREQUENCIAS_DA_ROTINA_INTERNA)

/* ────────────────────────────────────────────────────────────────────────
 * LEAD COMERCIAL — G5, completado pelo G8 1E (campos de `fLead`, L2554-2558)
 * ──────────────────────────────────────────────────────────────────────── */

/** "Contatar agora / hoje / esta semana" (`sinal`, L2422-2435), calculado no servidor. */
export const SinalDoLeadSaida = z.object({
  nivel: z.enum(['agora', 'hoje', 'semana']),
  motivo: z.string(),
  roteiro: z.enum(['primeiro', 'agendar', 'confirmacao', 'diagnostico', 'proposta', 'retomada']),
  peso: z.number().int(),
})
export type SinalDoLeadSaida = z.infer<typeof SinalDoLeadSaida>

export const LeadComercialNaLista = z.object({
  id: Uuid,
  nome: z.string(),
  grupoId: Uuid.nullable(),
  responsavelUsuarioGestaoId: Uuid.nullable(),
  origem: z.string(),
  etapa: EtapaDoLead,
  temperatura: TemperaturaDoLead,
  produtoInteresse: z.string().nullable(),
  proximoContato: z.string().nullable(),
  clienteCarteiraId: Uuid.nullable(),
  motivoPerda: z.string().nullable(),
  fechadoEm: z.string().nullable(),
  arquivadoEm: z.string().nullable(),
  criadoEm: z.string(),
  especialidade: z.string().nullable(),
  clinica: z.string().nullable(),
  cidade: z.string().nullable(),
  whatsapp: z.string().nullable(),
  instagram: z.string().nullable(),
  clienteIndicadorId: Uuid.nullable(),
  nomeDoClienteIndicador: z.string().nullable(),
  indicadoPor: z.string().nullable(),
  /** `indNome` (L2437): o cliente da carteira, se houver; senão o texto livre. */
  quemIndicou: z.string().nullable(),
  /**
   * "Valor estimado por mês" (L2557). Redigido sem a permissão `valores`
   * pelo `RedacaoInterceptor` — o nome está em `CAMPOS_MONETARIOS`.
   */
  valorEstimado: centavosNaSaida,
  recebidaEm: DiaCivil,
  observacoes: z.string().nullable(),
  /** Oposição ao contato (LGPD A37). */
  naoContatar: z.boolean(),
  excluidoAPedido: z.boolean(),
  /** A data do contato mais recente do histórico (L2418). */
  ultimoContato: DiaCivil.nullable(),
  sinal: SinalDoLeadSaida.nullable(),
  /**
   * O link `wa.me`, montado no servidor. `null` sem telefone e também com
   * `naoContatar` — a oposição é respeitada no servidor, não só escondida
   * pela tela (A37). Sem texto: a mensagem pronta é do ticket 3A (A39).
   */
  linkDoWhatsApp: z.string().nullable(),
})
export type LeadComercialNaLista = z.infer<typeof LeadComercialNaLista>

export const PessoaDaEquipeFirmare = z.object({ id: Uuid, nome: z.string() })
export type PessoaDaEquipeFirmare = z.infer<typeof PessoaDaEquipeFirmare>

/** O resumo da tela Oportunidades (L2474-2481). Tudo calculado no servidor. */
export const ResumoDasOportunidadesSaida = z.object({
  emAndamento: z.number().int(),
  porEtapa: z.array(z.object({ etapa: EtapaDoLead, quantidade: z.number().int() })),
  /** `Σ valorEstimado` fora de ganho, perdido e espera (gate de números, ajuste 14). Redigido. */
  potencial: centavosNaSaida,
  /** "Conversão das encerradas": `ganhos / (ganhos + perdidos)`, % inteiro; `null` = "—". */
  conversaoDasEncerradas: z.number().int().nullable(),
})
export type ResumoDasOportunidadesSaida = z.infer<typeof ResumoDasOportunidadesSaida>

export const ListaDeLeadsSaida = z.object({
  leads: z.array(LeadComercialNaLista),
  resumo: ResumoDasOportunidadesSaida,
  /** O hoje do servidor, no fuso da carteira (regra 24) — a tela nunca usa o relógio do aparelho. */
  hoje: DiaCivil,
  /**
   * A sessão vê dinheiro da carteira? Hoje sempre `false` — a chave `valores`
   * do `Usuário de Gestão` chega no ticket 0.5. A tela usa isto só para
   * mostrar ou não o CAMPO de entrada do valor estimado; a leitura já vem
   * redigida pelo servidor.
   */
  podeVerValores: z.boolean(),
  equipe: z.array(PessoaDaEquipeFirmare),
})
export type ListaDeLeadsSaida = z.infer<typeof ListaDeLeadsSaida>

export const LeadCriadoSaida = z.object({ lead: LeadComercialNaLista })
export type LeadCriadoSaida = z.infer<typeof LeadCriadoSaida>

const textoCurto = (max: number) => z.string().trim().min(1).max(max)
const textoOpcional = (max: number) => z.string().trim().max(max).transform((v) => (v === '' ? null : v))
/** "Valor estimado por mês": centavos em texto, nunca negativo. */
const valorEstimadoEntrada = dinheiroEmTexto.refine((v) => v === null || v >= 0n, 'o valor não pode ser negativo')

export const ETAPAS_ABERTAS_DO_LEAD = ['novo', 'contato', 'reuniao', 'proposta', 'espera'] as const
export const EtapaAbertaDoLead = z.enum(ETAPAS_ABERTAS_DO_LEAD)

export const CriarLeadEntrada = z
  .object({
    nome: z.string().trim().min(1, 'Informe o nome.').max(160),
    origem: z.string().trim().min(1, 'Informe a origem.').max(80),
    temperatura: TemperaturaDoLead,
    produtoInteresse: z.string().trim().max(80).optional(),
    responsavelUsuarioGestaoId: Uuid.optional(),
    proximoContato: DiaCivil.optional(),
    /**
     * A ÚNICA exceção prevista (spec §2.1): lead de expansão de rede já
     * nascendo associado a um grupo existente. Só `escopo='geral'` pode usar
     * — o service recusa quando `escopo='grupo'` tenta um valor diferente do
     * próprio (ADR 0016 item 2; `resolverGrupoDeEscrita`, `packages/domain`).
     */
    grupoIdDeExpansao: Uuid.optional(),
    /** O protótipo deixa nascer em qualquer etapa aberta (L2556). `ganho` só pela conversão. */
    etapa: EtapaAbertaDoLead.optional(),
    especialidade: textoOpcional(120).optional(),
    clinica: textoOpcional(160).optional(),
    cidade: textoOpcional(120).optional(),
    whatsapp: textoOpcional(40).optional(),
    instagram: textoOpcional(80).optional(),
    clienteIndicadorId: Uuid.optional(),
    indicadoPor: textoOpcional(160).optional(),
    valorEstimado: valorEstimadoEntrada.optional(),
    /** "Indicação recebida em" (L2557). Ausente = o hoje do servidor. */
    recebidaEm: DiaCivil.optional(),
    observacoes: textoOpcional(2000).optional(),
  })
  .strict()
export type CriarLeadEntrada = z.infer<typeof CriarLeadEntrada>

/**
 * "Editar" (L2958). Todo campo é opcional — ausente não muda; `null` limpa
 * (onde o campo admite vazio). A etapa NÃO se edita aqui: ela tem caminho
 * próprio (`/etapa`, `/contato`, `/perder`), porque `ganho` cria o cliente.
 */
export const EditarLeadEntrada = z
  .object({
    nome: textoCurto(160).optional(),
    origem: textoCurto(80).optional(),
    temperatura: TemperaturaDoLead.optional(),
    produtoInteresse: textoOpcional(80).nullable().optional(),
    responsavelUsuarioGestaoId: Uuid.nullable().optional(),
    proximoContato: DiaCivil.nullable().optional(),
    especialidade: textoOpcional(120).nullable().optional(),
    clinica: textoOpcional(160).nullable().optional(),
    cidade: textoOpcional(120).nullable().optional(),
    whatsapp: textoOpcional(40).nullable().optional(),
    instagram: textoOpcional(80).nullable().optional(),
    clienteIndicadorId: Uuid.nullable().optional(),
    indicadoPor: textoOpcional(160).nullable().optional(),
    valorEstimado: valorEstimadoEntrada.optional(),
    recebidaEm: DiaCivil.optional(),
    observacoes: textoOpcional(2000).nullable().optional(),
    /** Oposição ao contato (A37). Marcar é imediato; desmarcar exige o pedido da própria pessoa. */
    naoContatar: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Nada para alterar.')
export type EditarLeadEntrada = z.infer<typeof EditarLeadEntrada>

export const AvancarEtapaDoLeadEntrada = z
  .object({
    etapa: EtapaDoLead,
    motivoPerda: z.string().trim().min(1).max(500).optional(),
    proximoContato: DiaCivil.nullable().optional(),
  })
  .strict()
export type AvancarEtapaDoLeadEntrada = z.infer<typeof AvancarEtapaDoLeadEntrada>

/** "Marcar como perdido" com "Tentar de novo em (opcional)" (L2960). */
export const MarcarLeadPerdidoEntrada = z
  .object({
    motivo: z.string().trim().min(1, 'Informe o motivo.').max(500),
    tentarDeNovoEm: DiaCivil.nullable().optional(),
  })
  .strict()
export type MarcarLeadPerdidoEntrada = z.infer<typeof MarcarLeadPerdidoEntrada>

/** "Registrar contato" (L2559-2565): interação, etapa, temperatura e próximo contato numa transação. */
export const RegistrarContatoDoLeadEntrada = z
  .object({
    /** Gerada pela tela a cada formulário aberto: repetir a requisição não duplica (A-20). */
    chaveIdempotencia: Uuid,
    data: DiaCivil,
    canal: z.enum(CANAIS_DE_CONTATO),
    nota: z.string().trim().min(1, 'Conte o que foi conversado.').max(2000),
    etapa: EtapaDoLead,
    temperatura: TemperaturaDoLead,
    proximoContato: DiaCivil.nullable(),
  })
  .strict()
export type RegistrarContatoDoLeadEntrada = z.infer<typeof RegistrarContatoDoLeadEntrada>

/* ────────────────────────────────────────────────────────────────────────
 * INTERAÇÃO DO LEAD — append-only
 * ──────────────────────────────────────────────────────────────────────── */

export const InteracaoDoLeadNaLista = z.object({
  id: Uuid,
  leadComercialId: Uuid,
  quando: z.string(),
  /** O dia do contato informado no formulário (L2560). */
  dataDoContato: DiaCivil,
  canal: z.string(),
  nota: z.string(),
  porUsuarioGestaoId: Uuid,
  porNome: z.string().nullable(),
})
export type InteracaoDoLeadNaLista = z.infer<typeof InteracaoDoLeadNaLista>

export const ListaDeInteracoesDoLeadSaida = z.object({ interacoes: z.array(InteracaoDoLeadNaLista) })
export type ListaDeInteracoesDoLeadSaida = z.infer<typeof ListaDeInteracoesDoLeadSaida>

export const CriarInteracaoDoLeadEntrada = z
  .object({
    canal: z.string().trim().min(1, 'Informe o canal.').max(40),
    nota: z.string().trim().min(1, 'Informe a nota.').max(2000),
  })
  .strict()
export type CriarInteracaoDoLeadEntrada = z.infer<typeof CriarInteracaoDoLeadEntrada>

export const InteracaoDoLeadCriadaSaida = z.object({ interacao: InteracaoDoLeadNaLista })
export type InteracaoDoLeadCriadaSaida = z.infer<typeof InteracaoDoLeadCriadaSaida>

/* ────────────────────────────────────────────────────────────────────────
 * FICHA DO LEAD (`vLead`, L2490-2513) e o contato registrado
 * ──────────────────────────────────────────────────────────────────────── */

export const SituacaoDoBeneficio = z.enum(['guardado', 'pendente', 'concedido'])
export type SituacaoDoBeneficio = z.infer<typeof SituacaoDoBeneficio>

/**
 * Um `Benefício de indicação` como a tela de benefícios o mostra (L2539-2547).
 * `percentualCentesimos` não é dinheiro (1000 = 10,00%). Nenhum valor em R$
 * atravessa aqui: o desconto aplicado mora na cobrança.
 */
export const BeneficioDeIndicacaoNaTela = z.object({
  id: Uuid,
  situacao: SituacaoDoBeneficio,
  clienteCarteiraId: Uuid.nullable(),
  nomeDoCliente: z.string().nullable(),
  indicadorNome: z.string().nullable(),
  /** Quem recebe: o cliente, ou o nome guardado de quem indicou. */
  beneficiario: z.string(),
  leadComercialId: Uuid.nullable(),
  nomeDoLead: z.string().nullable(),
  /** Quando a indicação virou contrato (`fechado_em` do lead), ou a criação do benefício. */
  dataDoContrato: z.string(),
  percentualCentesimos: z.string().regex(/^\d+$/),
  consumidoEm: z.string().nullable(),
  /** A competência (`aaaa-mm`) da cobrança que aplicou o desconto. */
  competenciaDaCobranca: z.string().nullable(),
  /**
   * Só no benefício guardado: clientes da carteira com o mesmo nome de quem
   * indicou. É SUGESTÃO (regra 27) — ninguém é ligado sem alguém confirmar.
   */
  sugestoesDeCliente: z.array(z.object({ id: Uuid, nome: z.string() })),
})
export type BeneficioDeIndicacaoNaTela = z.infer<typeof BeneficioDeIndicacaoNaTela>

export const FichaDoLeadSaida = z.object({
  lead: LeadComercialNaLista,
  interacoes: z.array(InteracaoDoLeadNaLista),
  beneficio: BeneficioDeIndicacaoNaTela.nullable(),
  hoje: DiaCivil,
  /** Os padrões do formulário "Registrar contato", calculados no servidor (L2562). */
  sugestaoDeContato: z.object({ etapa: EtapaDoLead, proximoContato: DiaCivil }),
  podeVerValores: z.boolean(),
  equipe: z.array(PessoaDaEquipeFirmare),
})
export type FichaDoLeadSaida = z.infer<typeof FichaDoLeadSaida>

export const ContatoRegistradoSaida = z.object({ lead: LeadComercialNaLista, interacao: InteracaoDoLeadNaLista })
export type ContatoRegistradoSaida = z.infer<typeof ContatoRegistradoSaida>

/* ────────────────────────────────────────────────────────────────────────
 * QUEM INDICA (`vIndicadores`, L2533-2548) e BENEFÍCIOS
 * ──────────────────────────────────────────────────────────────────────── */

export const LinhaDoRankingSaida = z.object({
  chave: z.string(),
  nome: z.string(),
  clienteCarteiraId: Uuid.nullable(),
  total: z.number().int(),
  emAndamento: z.number().int(),
  viraramClientes: z.number().int(),
  /** "Indicações que viraram cliente": `ganhos / total`, % inteiro — NÃO é a conversão das encerradas. */
  indicacoesQueViraramCliente: z.number().int().nullable(),
  leads: z.array(z.object({ id: Uuid, nome: z.string() })),
  beneficiosConcedidos: z.number().int(),
  beneficiosPendentes: z.number().int(),
  beneficiosGuardados: z.number().int(),
})
export type LinhaDoRankingSaida = z.infer<typeof LinhaDoRankingSaida>

export const IndicacoesSaida = z.object({ ranking: z.array(LinhaDoRankingSaida) })
export type IndicacoesSaida = z.infer<typeof IndicacoesSaida>

export const ListaDeBeneficiosSaida = z.object({
  beneficios: z.array(BeneficioDeIndicacaoNaTela),
  /**
   * A regra que a próxima conversão fotografa (gate de números, ajuste 9).
   * Hoje é o padrão do protótipo (10%); "Alterar regra" chega com a
   * configuração da carteira (T5).
   */
  regraPercentualCentesimos: z.string().regex(/^\d+$/),
})
export type ListaDeBeneficiosSaida = z.infer<typeof ListaDeBeneficiosSaida>

/** Liga um benefício GUARDADO ao cliente em que a pessoa se tornou (D-22 item 11). */
export const VincularBeneficioEntrada = z.object({ clienteCarteiraId: Uuid }).strict()
export type VincularBeneficioEntrada = z.infer<typeof VincularBeneficioEntrada>

export const BeneficioVinculadoSaida = z.object({ beneficio: BeneficioDeIndicacaoNaTela })
export type BeneficioVinculadoSaida = z.infer<typeof BeneficioVinculadoSaida>

/* ────────────────────────────────────────────────────────────────────────
 * TAREFA INTERNA / ROTINA INTERNA
 * ──────────────────────────────────────────────────────────────────────── */

export const StatusDaTarefaInterna = z.enum(['pendente', 'concluida', 'cancelada'])
export type StatusDaTarefaInterna = z.infer<typeof StatusDaTarefaInterna>

export const PrioridadeDaTarefaInterna = z.enum(['baixa', 'normal', 'alta'])

export const TarefaInternaNaLista = z.object({
  id: Uuid,
  titulo: z.string(),
  descricao: z.string().nullable(),
  grupoId: Uuid.nullable(),
  responsavelUsuarioGestaoId: Uuid.nullable(),
  clienteCarteiraId: Uuid.nullable(),
  leadComercialId: Uuid.nullable(),
  prazo: z.string(),
  prioridade: PrioridadeDaTarefaInterna,
  status: StatusDaTarefaInterna,
  concluidaEm: z.string().nullable(),
  rotinaInternaId: Uuid.nullable(),
})
export type TarefaInternaNaLista = z.infer<typeof TarefaInternaNaLista>

export const ListaDeTarefasInternasSaida = z.object({ tarefas: z.array(TarefaInternaNaLista) })
export type ListaDeTarefasInternasSaida = z.infer<typeof ListaDeTarefasInternasSaida>

export const TarefaInternaCriadaSaida = z.object({ tarefa: TarefaInternaNaLista })
export type TarefaInternaCriadaSaida = z.infer<typeof TarefaInternaCriadaSaida>

export const CriarTarefaInternaEntrada = z
  .object({
    titulo: z.string().trim().min(1, 'Informe o título.').max(160),
    descricao: z.string().trim().max(2000).optional(),
    responsavelUsuarioGestaoId: Uuid.optional(),
    clienteCarteiraId: Uuid.optional(),
    leadComercialId: Uuid.optional(),
    prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato aaaa-mm-dd'),
    prioridade: PrioridadeDaTarefaInterna.default('normal'),
  })
  .strict()
export type CriarTarefaInternaEntrada = z.infer<typeof CriarTarefaInternaEntrada>

export const AtualizarStatusDaTarefaInternaEntrada = z
  .object({ status: z.enum(['concluida', 'cancelada']) })
  .strict()
export type AtualizarStatusDaTarefaInternaEntrada = z.infer<typeof AtualizarStatusDaTarefaInternaEntrada>

export const RotinaInternaNaLista = z.object({
  id: Uuid,
  titulo: z.string(),
  grupoId: Uuid.nullable(),
  responsavelUsuarioGestaoId: Uuid.nullable(),
  frequencia: FrequenciaDaRotinaInterna,
  escopoAplicacao: EscopoDeAplicacaoDaRotina,
  passos: z.array(z.string()),
  ativa: z.boolean(),
  inicio: z.string(),
})
export type RotinaInternaNaLista = z.infer<typeof RotinaInternaNaLista>

export const ListaDeRotinasInternasSaida = z.object({ rotinas: z.array(RotinaInternaNaLista) })
export type ListaDeRotinasInternasSaida = z.infer<typeof ListaDeRotinasInternasSaida>

export const RotinaInternaCriadaSaida = z.object({ rotina: RotinaInternaNaLista })
export type RotinaInternaCriadaSaida = z.infer<typeof RotinaInternaCriadaSaida>

export const CriarRotinaInternaEntrada = z
  .object({
    titulo: z.string().trim().min(1, 'Informe o título.').max(160),
    responsavelUsuarioGestaoId: Uuid.optional(),
    frequencia: FrequenciaDaRotinaInterna,
    escopoAplicacao: EscopoDeAplicacaoDaRotina,
    passos: z.array(z.string().trim().min(1)).max(30).default([]),
    inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato aaaa-mm-dd'),
  })
  .strict()
export type CriarRotinaInternaEntrada = z.infer<typeof CriarRotinaInternaEntrada>

/* ────────────────────────────────────────────────────────────────────────
 * CHECKIN INTERNO — qualitativo nesta fatia (spec §4). Sem `meta_id`/`valor`.
 * ──────────────────────────────────────────────────────────────────────── */

export const CheckinInternoNaLista = z.object({
  id: Uuid,
  clienteCarteiraId: Uuid,
  semana: z.string(),
  nota: z.string(),
  saude: SaudeDoCliente,
  porUsuarioGestaoId: Uuid,
  rotinaInternaId: Uuid.nullable(),
})
export type CheckinInternoNaLista = z.infer<typeof CheckinInternoNaLista>

export const ListaDeCheckinsInternosSaida = z.object({ checkins: z.array(CheckinInternoNaLista) })
export type ListaDeCheckinsInternosSaida = z.infer<typeof ListaDeCheckinsInternosSaida>

export const CheckinInternoCriadoSaida = z.object({ checkin: CheckinInternoNaLista })
export type CheckinInternoCriadoSaida = z.infer<typeof CheckinInternoCriadoSaida>

export const RegistrarCheckinInternoEntrada = z
  .object({
    clienteCarteiraId: Uuid,
    nota: z.string().trim().min(1, 'Informe a nota.').max(2000),
    saude: SaudeDoCliente,
  })
  .strict()
export type RegistrarCheckinInternoEntrada = z.infer<typeof RegistrarCheckinInternoEntrada>

/** Edita um checkin JÁ EXISTENTE — só o da semana corrente (spec §7, critério 7). */
export const AtualizarCheckinInternoEntrada = z
  .object({
    nota: z.string().trim().min(1, 'Informe a nota.').max(2000),
    saude: SaudeDoCliente,
  })
  .strict()
export type AtualizarCheckinInternoEntrada = z.infer<typeof AtualizarCheckinInternoEntrada>
