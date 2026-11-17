import { z } from 'zod'
import { CicloDaAgenda, ResumoDaSincronizacao } from './agenda'
import { DiaCivil } from './comum'

/**
 * AS INTEGRAÇÕES DA CLÍNICA no painel do superadmin (spec `integracao-medx.md`, seção A).
 *
 * A chave entra por aqui e **nunca sai**: a resposta tem só os 4 últimos
 * caracteres (gate S-9). Nenhum campo monetário — o painel não mostra dinheiro.
 */

/**
 * A chave colada. Sem espaço nem quebra de linha (colar com espaço é o erro
 * mais comum, e um token com espaço nunca autentica). Os limites são folgados:
 * o formato do token do MedX não é documentado.
 */
export const ChaveDeIntegracaoEntrada = z
  .object({
    chave: z
      .string()
      .trim()
      .min(16, 'A chave parece incompleta. Copie de novo, inteira.')
      .max(2000, 'A chave é longa demais. Confira o que foi colado.')
      .regex(/^[\x21-\x7e]+$/, 'A chave não pode ter espaço, quebra de linha nem acento.'),
  })
  .strict()
export type ChaveDeIntegracaoEntrada = z.infer<typeof ChaveDeIntegracaoEntrada>

/** O termo da clínica autorizando a leitura (LGPD B1). Sem ele, nada liga. */
export const TermoDeIntegracaoEntrada = z
  .object({
    assinadoEm: DiaCivil,
    assinadoPor: z.string().trim().min(1, 'Diga quem assinou pela clínica.').max(200),
    versao: z.string().trim().min(1, 'Diga a versão do termo.').max(50),
  })
  .strict()
export type TermoDeIntegracaoEntrada = z.infer<typeof TermoDeIntegracaoEntrada>

export const LigacoesDaIntegracaoEntrada = z
  .object({
    agenda: z.boolean(),
    faturamento: z.boolean(),
    /**
     * O PADRÃO da régua das metas dos meses novos (spec C.10). A régua de cada
     * mês é gravada com a meta: trocar aqui não muda mês que já tem meta.
     */
    metaMedidaPor: z.enum(['fir', 'medx']).default('fir'),
  })
  .strict()
  .refine((x) => x.metaMedidaPor === 'fir' || x.faturamento, {
    message: 'A meta só pode ser medida pelo MedX com o faturamento do MedX ligado.',
    path: ['metaMedidaPor'],
  })
export type LigacoesDaIntegracaoEntrada = z.infer<typeof LigacoesDaIntegracaoEntrada>

/**
 * Os códigos de status do MedX que significam "cancelado" (spec B.8), de
 * `GET /agenda/catalogos` (0–12). Configurados por clínica: nenhum código no
 * código-fonte. Vazio = só o sumiço confirmado por id desmarca.
 */
export const StatusDeCanceladoEntrada = z
  .object({ codigos: z.array(z.number().int().min(0).max(12)).max(13) })
  .strict()
export type StatusDeCanceladoEntrada = z.infer<typeof StatusDeCanceladoEntrada>

/** Um status do catálogo do MedX (`GET /agenda/catalogos`), gravado no último teste verde. */
export const StatusDoMedx = z.object({ id: z.number().int(), nome: z.string() }).strict()
export type StatusDoMedx = z.infer<typeof StatusDoMedx>

/**
 * O estado técnico da agenda do MedX, para o superadmin (spec D.2). `null`
 * enquanto a clínica não tiver a agenda ligada ao MedX alguma vez.
 */
export const AgendaDoMedxNoPainel = z
  .object({
    ativa: z.boolean(),
    ultimaLeituraEm: z.string().nullable(),
    ultimoSucessoEm: z.string().nullable(),
    ultimoErro: z.string(),
    ultimoResumo: ResumoDaSincronizacao.nullable(),
    ciclos: z.array(CicloDaAgenda),
  })
  .strict()
export type AgendaDoMedxNoPainel = z.infer<typeof AgendaDoMedxNoPainel>

export const EstadoDaVerificacao = z.enum(['sem_chave', 'nao_verificada', 'pedida', 'ok', 'recusada'])
export type EstadoDaVerificacao = z.infer<typeof EstadoDaVerificacao>

/** Exatamente isto, e nada além (S-9). Nada de JWT, `expiresIn` nem a chave. */
export const IntegracaoNoPainel = z
  .object({
    provedor: z.enum(['so_fir', 'medx']),
    estado: EstadoDaVerificacao,
    finalDaChave: z.string().nullable(),
    verificadaEm: z.string().nullable(),
    usuarioExterno: z.string().nullable(),
    contaExterna: z.string().nullable(),
    escopos: z.array(z.string()),
    unidades: z.number().int(),
    ligadoAgenda: z.boolean(),
    ligadoFaturamento: z.boolean(),
    /** Padrão da régua das metas dos meses novos. */
    metaMedidaPor: z.enum(['fir', 'medx']),
    statusDeCancelado: z.array(z.number().int()),
    catalogoDeStatus: z.array(StatusDoMedx),
    agenda: AgendaDoMedxNoPainel.nullable(),
    termo: z
      .object({ assinadoEm: DiaCivil, assinadoPor: z.string(), versao: z.string() })
      .nullable(),
    ultimoErro: z.string(),
  })
  .strict()
export type IntegracaoNoPainel = z.infer<typeof IntegracaoNoPainel>
