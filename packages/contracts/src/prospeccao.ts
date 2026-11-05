import {
  ESCOPOS_DE_APLICACAO,
  ETAPAS_DO_LEAD,
  FREQUENCIAS_DA_ROTINA_INTERNA,
  SAUDES_DO_CLIENTE,
  TEMPERATURAS_DO_LEAD,
} from '@fir/domain'
import { z } from 'zod'
import { Uuid } from './comum'

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
 * LEAD COMERCIAL
 * ──────────────────────────────────────────────────────────────────────── */

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
})
export type LeadComercialNaLista = z.infer<typeof LeadComercialNaLista>

export const ListaDeLeadsSaida = z.object({ leads: z.array(LeadComercialNaLista) })
export type ListaDeLeadsSaida = z.infer<typeof ListaDeLeadsSaida>

export const LeadCriadoSaida = z.object({ lead: LeadComercialNaLista })
export type LeadCriadoSaida = z.infer<typeof LeadCriadoSaida>

export const CriarLeadEntrada = z
  .object({
    nome: z.string().trim().min(1, 'Informe o nome.').max(160),
    origem: z.string().trim().min(1, 'Informe a origem.').max(80),
    temperatura: TemperaturaDoLead,
    produtoInteresse: z.string().trim().max(80).optional(),
    responsavelUsuarioGestaoId: Uuid.optional(),
    proximoContato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /**
     * A ÚNICA exceção prevista (spec §2.1): lead de expansão de rede já
     * nascendo associado a um grupo existente. Só `escopo='geral'` pode usar
     * — o service recusa quando `escopo='grupo'` tenta um valor diferente do
     * próprio (ADR 0016 item 2; `resolverGrupoDeEscrita`, `packages/domain`).
     */
    grupoIdDeExpansao: Uuid.optional(),
  })
  .strict()
export type CriarLeadEntrada = z.infer<typeof CriarLeadEntrada>

export const AvancarEtapaDoLeadEntrada = z
  .object({
    etapa: EtapaDoLead,
    motivoPerda: z.string().trim().min(1).max(500).optional(),
    proximoContato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .strict()
export type AvancarEtapaDoLeadEntrada = z.infer<typeof AvancarEtapaDoLeadEntrada>

/* ────────────────────────────────────────────────────────────────────────
 * INTERAÇÃO DO LEAD — append-only
 * ──────────────────────────────────────────────────────────────────────── */

export const InteracaoDoLeadNaLista = z.object({
  id: Uuid,
  leadComercialId: Uuid,
  quando: z.string(),
  canal: z.string(),
  nota: z.string(),
  porUsuarioGestaoId: Uuid,
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
