import {
  caixasSemDiferenca,
  type ChaveDoCatalogo,
  classificarDesfecho,
  contarDesfechos,
  conversaoDeOrcamentos,
  type CorteDaMeta,
  Dinheiro,
  ESCALA_DA_UNIDADE,
  ehRecaptacao,
  faltaMadura,
  inicioDoDia,
  janela,
  type MedidaDaMeta,
  NumeroDoKpi,
  recontatoEmAteDoisDias,
  saldoEmMedida,
  somarDias,
  TIPOS_QUE_ATENDEM,
  umAUmEmDia,
  type UnidadeDeKpi,
  valorDaMediaMensal,
  valorDaTaxa,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import type { Ator } from '../banco/ator'
import type { ClinicaId } from '../banco/clinica-id'
import { CampanhasService } from '../campanhas/campanhas.service'
import { analiseNaConexao } from '../estoque/analise.service'
import { movimentosDosItens } from '../estoque/movimentos.repositorio'
import { caixasDoPeriodo, medirFaturamentoConferido } from '../financeiro/faturamento-conferido'
import { pacientesQuePodemTerSaldo, saldosDe } from '../financeiro/saldo.repositorio'
import { VisaoDoMesService } from '../financeiro/visao-do-mes.service'
import { consultarPrazos, contarConversaoDeOrcamentos, TIPOS_DE_SESSAO } from '../painel-geral/metricas-diarias'
import { ticketMedio, totaisDePacientes } from '../painel-geral/totais-de-pacientes'
import { MetasService } from '../pessoas/metas.service'

export type ContextoDoKpi = {
  readonly clinicaId: ClinicaId
  readonly ator: Ator
  readonly fuso: string
  readonly valores: boolean
}

/** `[de, ate]` em dias civis da clínica, inclusivos; `hoje` é do servidor. */
export type PeriodoDoKpi = { readonly de: string; readonly ate: string; readonly hoje: string }

export type MedidaDoKpi = {
  /** `null` = sem dado (nunca zero). */
  readonly numero: NumeroDoKpi | null
  /** Dias que ainda não contam pela regra 6 (só a contagem atravessa). */
  readonly diasAguardando: number
  /** O corte para ritmo e projeção: `D`/`L` no faturamento conferido, o fim do período nas outras. */
  readonly corte: CorteDaMeta
}

export type KpiParaMedir = {
  readonly id: string
  readonly chave: ChaveDoCatalogo
  readonly parametros: Readonly<Record<string, string>>
  readonly unidade: UnidadeDeKpi
  /** A régua da meta viva (`faturamento_conferido`); `fir` sem meta. */
  readonly medidaPor: MedidaDaMeta
}

const CENTESIMOS = ESCALA_DA_UNIDADE.quantidade.porUnidade
const contagem = (n: number) => NumeroDoKpi.de('quantidade', BigInt(n) * CENTESIMOS)
const percentual = (p: number | null) =>
  p === null ? null : NumeroDoKpi.de('percentual', BigInt(p) * ESCALA_DA_UNIDADE.percentual.porUnidade)
const reais = (d: Dinheiro | null) => (d === null ? null : NumeroDoKpi.deDinheiro(d))

/**
 * **AS FONTES DOS KPIs DO CATÁLOGO — uma por chave, cada uma a função que a
 * tela de origem já usa** (spec I-7: mover, nunca copiar). Esta classe não
 * calcula regra nenhuma: chama a fonte e embrulha o número na unidade.
 *
 * **Regra 6.** As chaves em reais (e as que dependem do recebido) só contam
 * os dias que contam pela I-9: com o caixa de hoje aberto, o período termina
 * ontem (`ateQueConta`), e nenhum byte de `/v1/indicadores*` muda com um
 * recebimento de hoje (appsec C11).
 */
@Injectable()
export class FontesDosKpis {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(VisaoDoMesService) private readonly visao: VisaoDoMesService,
    @Inject(MetasService) private readonly metasDePessoa: MetasService,
    @Inject(CampanhasService) private readonly campanhas: CampanhasService,
  ) {}

  async medir(c: pg.PoolClient, ctx: ContextoDoKpi, kpi: KpiParaMedir, p: PeriodoDoKpi): Promise<MedidaDoKpi> {
    const fim = p.ate < p.hoje ? p.ate : p.hoje
    const simples = (numero: NumeroDoKpi | null, diasAguardando = 0): MedidaDoKpi => ({
      numero,
      diasAguardando,
      corte: fim,
    })
    const mes = fim.slice(0, 7)
    const j = (de: string, ate: string) => janela(de, ate, ctx.fuso)

    switch (kpi.chave) {
      case 'faturamento_conferido': {
        const f = await medirFaturamentoConferido(c, ctx.clinicaId, p.de, p.ate, ctx.fuso, p.hoje, kpi.medidaPor)
        const numero = kpi.medidaPor === 'medx' ? reais(f.medido) : reais(f.recebidoQueConta)
        return { numero, diasAguardando: f.diasAguardandoSemHoje, corte: f.corte }
      }
      case 'resultado_do_mes': {
        const v = await this.visao.visaoNaConexao(c, ctx, mes, p.hoje, true)
        return simples(reais(v.visao.resultadoDoMes), v.medida.diasAguardandoSemHoje)
      }
      case 'despesas_fixas_sobre_recebido': {
        // Fixas ÷ RECEBIDO, sem outras entradas (números c.5) — não é a razão
        // fixas ÷ despesas da Visão do mês. O recebido é o dos dias que contam.
        const v = await this.visao.visaoNaConexao(c, ctx, mes, p.hoje, true)
        return simples(valorDaTaxa('percentual', v.visao.fixas.centavos, v.visao.recebido.centavos), v.medida.diasAguardandoSemHoje)
      }
      case 'ticket_medio': {
        const { ate, aguardando } = await this.ateQueConta(c, ctx, fim, p.hoje)
        if (ate < p.de) return simples(null, aguardando)
        return simples(reais(ticketMedio(await totaisDePacientes(c, ctx.clinicaId, j(p.de, ate)))), aguardando)
      }
      case 'valor_fechado_em_orcamentos': {
        const { ate, aguardando } = await this.ateQueConta(c, ctx, fim, p.hoje)
        if (ate < p.de) return simples(NumeroDoKpi.zero('reais'), aguardando)
        const t = await totaisDePacientes(c, ctx.clinicaId, j(p.de, ate))
        return simples(reais(t.valorDosOrcamentosPagos), aguardando)
      }
      case 'saldo_a_receber': {
        // A posição no INSTANTE `início(fim + 1)` (I-6, c.9); o período em curso
        // é a de agora — a mesma de `aReceber` da Visão do mês.
        const candidatos = await pacientesQuePodemTerSaldo(c, ctx.clinicaId)
        const opcoes = p.ate < p.hoje ? { ate: inicioDoDia(somarDias(p.ate, 1), ctx.fuso) } : {}
        const saldos = await saldosDe(c, ctx.clinicaId, candidatos, opcoes)
        return simples(reais([...saldos.values()].reduce((s, x) => s.mais(x.saldo), Dinheiro.zero())))
      }
      case 'caixas_sem_diferenca': {
        const r = caixasSemDiferenca(p.de, p.ate, p.hoje, await caixasDoPeriodo(c, ctx.clinicaId, p.de, p.ate))
        return simples(percentual(r.percentual))
      }
      case 'novos_pacientes':
        return simples(contagem(await contarNovosPacientes(c, ctx.clinicaId, j(p.de, fim), kpi.parametros['origem'])))
      case 'conversao_de_orcamentos': {
        const { enviados, fechados } = await contarConversaoDeOrcamentos(c, ctx.clinicaId, j(p.de, fim))
        return simples(percentual(conversaoDeOrcamentos(enviados, fechados)))
      }
      case 'comparecimento': {
        const hs = await historicosDaJanela(c, ctx.clinicaId, j(p.de, fim))
        let realizados = 0
        let faltas = 0
        for (const h of hs) {
          const d = contarDesfechos(classificarDesfecho(h), j(p.de, fim))
          realizados += d.realizados
          faltas += d.faltas
        }
        return simples(valorDaTaxa('percentual', BigInt(realizados), BigInt(realizados + faltas)))
      }
      case 'faltas_recontatadas': {
        const hs = await historicosDaJanela(c, ctx.clinicaId, j(p.de, fim))
        let maduras = 0
        let recontatadas = 0
        for (const h of hs) {
          for (const f of recontatoEmAteDoisDias(h, ctx.fuso)) {
            if (f.dia < p.de || f.dia > fim) continue
            // A falta entra no denominador só depois do prazo de 2 dias (I-11).
            if (!faltaMadura(f.dia, p.hoje)) continue
            maduras++
            if (f.emAteDoisDias) recontatadas++
          }
        }
        return simples(valorDaTaxa('percentual', BigInt(recontatadas), BigInt(maduras)))
      }
      case 'pacientes_recaptados':
        return simples(contagem(await contarRecaptados(c, ctx.clinicaId, p.de, fim, ctx.fuso)))
      case 'resultado_de_campanha': {
        const id = kpi.parametros['campanhaId']
        const lista = await this.campanhas.noPeriodo({ ...ctx }, p.de, fim)
        const camp = lista.find((x) => x.id === id)
        if (camp === undefined) return simples(null)
        if (kpi.unidade === 'reais') {
          return simples(camp.resultadoEmDinheiro === null ? null : NumeroDoKpi.de('reais', BigInt(camp.resultadoEmDinheiro)))
        }
        return simples(camp.resultadoEmNumero === null ? null : contagem(camp.resultadoEmNumero))
      }
      case 'tarefas_no_prazo': {
        const { total } = await consultarPrazos(c, ctx.clinicaId, { de: p.de, ate: fim }, p.hoje, ctx.fuso)
        const base = total.noPrazo + total.comAtraso + total.atrasadas
        return simples(valorDaTaxa('percentual', BigInt(total.noPrazo), BigInt(base)))
      }
      case 'rotinas_cumpridas': {
        const r = await rotinasDoPeriodo(c, ctx.clinicaId, p.de, fim, p.hoje)
        return simples(valorDaTaxa('percentual', BigInt(r.cumpridas), BigInt(r.previstas)))
      }
      case 'perda_de_estoque': {
        // `analise` (B4): a janela INTEIRA de uma vez, nunca a soma dos meses.
        // Sem nenhum item com duas contagens, `null` ("sem contagens"), nunca 0.
        const a = await analiseNaConexao(c, p.de, fim)
        if (a.valorDaFalta === null || a.itens.every((i) => i.valorDaFalta === null)) return simples(null)
        return simples(NumeroDoKpi.de('reais', BigInt(a.valorDaFalta)))
      }
      case 'itens_abaixo_do_minimo': {
        const instante = p.ate < p.hoje ? inicioDoDia(somarDias(p.ate, 1), ctx.fuso) : null
        return simples(contagem(await contarAbaixoDoMinimo(c, ctx.clinicaId, instante)))
      }
      case 'atingimento_metas_individuais': {
        const m = await this.metasDePessoa.metasDoMes(ctx, mes)
        const r = valorDaMediaMensal([{ mes, percentuais: m.pessoas.map((x) => x.mediaDeAtingimento) }])
        return simples(r.tipo === 'ok' ? r.valor : null)
      }
      case 'saldo_banco_de_horas':
        return simples(NumeroDoKpi.de('horas', await bancoDeHorasPositivo(c, ctx.clinicaId, mes)))
      case 'conversas_1a1_em_dia': {
        const r = await umAUmDoMes(c, ctx.clinicaId, mes)
        return simples(percentual(umAUmEmDia(r.ativas, r.comConversa)))
      }
    }
  }

  /** Com o caixa de hoje aberto, o período em reais termina ontem (regra 6). */
  private async ateQueConta(
    c: pg.PoolClient,
    ctx: ContextoDoKpi,
    fim: string,
    hoje: string,
  ): Promise<{ ate: string; aguardando: number }> {
    if (fim < hoje) return { ate: fim, aguardando: 0 }
    const r = await c.query('SELECT 1 FROM caixas_do_dia WHERE clinica_id = $1 AND dia = $2::date', [ctx.clinicaId, hoje])
    return r.rowCount === 0 ? { ate: somarDias(hoje, -1), aguardando: 1 } : { ate: fim, aguardando: 0 }
  }
}

type EventoDoHistorico = Parameters<typeof classificarDesfecho>[0][number]

/** Os históricos dos cartões com algum evento na janela (I-10, I-11). */
async function historicosDaJanela(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  j: { de: Date; ate: Date },
): Promise<EventoDoHistorico[][]> {
  const r = await c.query<{ historico: EventoDoHistorico[] }>(
    `SELECT t.historico FROM tarefas t
      WHERE t.clinica_id = $1 AND t.excluida_em IS NULL AND t.paciente_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.historico) ev
                     WHERE ev ? 'em' AND (ev->>'em')::timestamptz >= $2 AND (ev->>'em')::timestamptz < $3)`,
    [clinicaId, j.de, j.ate],
  )
  return r.rows.map((x) => x.historico)
}

/**
 * Pacientes novos na janela — o MESMO `WHERE` de `novosPacientes` do Painel
 * (cadastro na janela, paciente ativo), com a origem opcional pelo mesmo rótulo.
 */
export async function contarNovosPacientes(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  j: { de: Date; ate: Date },
  origem: string | undefined,
): Promise<number> {
  const r = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pacientes pa
      WHERE pa.clinica_id = $1 AND pa.ativo AND pa.criado_em >= $2 AND pa.criado_em < $3
        AND ($4::text IS NULL OR (CASE WHEN pa.origem = '' THEN 'Não informada' ELSE pa.origem END) = $4)`,
    [clinicaId, j.de, j.ate, origem ?? null],
  )
  return Number(r.rows[0]!.n)
}

/** I-12: paciente distinta atendida em `[de, ate]` cujo atendimento anterior foi ≥ 182 dias antes. */
async function contarRecaptados(c: pg.PoolClient, clinicaId: ClinicaId, de: string, ate: string, fuso: string): Promise<number> {
  const j = janela(de, ate, fuso)
  const r = await c.query<{ paciente_id: string; dia: string }>(
    `SELECT DISTINCT t.paciente_id, ((t.concluida_em AT TIME ZONE $5)::date)::text AS dia
       FROM tarefas t JOIN pacientes pa ON pa.id = t.paciente_id AND pa.clinica_id = t.clinica_id AND pa.ativo
      WHERE t.clinica_id = $1 AND t.excluida_em IS NULL AND t.status = 'concluida'
        AND t.tipo = ANY($4::text[]) AND t.concluida_em < $3
        AND t.paciente_id IN (
          SELECT a.paciente_id FROM tarefas a
           WHERE a.clinica_id = $1 AND a.excluida_em IS NULL AND a.status = 'concluida'
             AND a.tipo = ANY($4::text[]) AND a.concluida_em >= $2 AND a.concluida_em < $3)
      ORDER BY 1, 2`,
    [clinicaId, j.de, j.ate, [...TIPOS_QUE_ATENDEM], fuso],
  )
  const recaptados = new Set<string>()
  let anterior: { paciente: string; dia: string } | null = null
  for (const l of r.rows) {
    const diaAnterior = anterior !== null && anterior.paciente === l.paciente_id ? anterior.dia : null
    if (l.dia >= de && ehRecaptacao(l.dia, diaAnterior)) recaptados.add(l.paciente_id)
    anterior = { paciente: l.paciente_id, dia: l.dia }
  }
  return recaptados.size
}

/** I-13: rotinas previstas (série ou marcador, fora das sessões, não canceladas) e as concluídas. */
async function rotinasDoPeriodo(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  de: string,
  ate: string,
  hoje: string,
): Promise<{ previstas: number; cumpridas: number }> {
  const limite = somarDias(ate < hoje ? ate : hoje, 1)
  const r = await c.query<{ previstas: string; cumpridas: string }>(
    `SELECT count(*)::text AS previstas, count(*) FILTER (WHERE t.status = 'concluida')::text AS cumpridas
       FROM tarefas t
      WHERE t.clinica_id = $1 AND t.excluida_em IS NULL AND t.status <> 'cancelada'
        AND (t.serie_id IS NOT NULL OR t.marcador IS NOT NULL)
        AND NOT (coalesce(t.tipo, '') = ANY($4::text[]))
        AND t.prazo >= $2::date AND t.prazo < $3::date`,
    [clinicaId, de, limite, [...TIPOS_DE_SESSAO]],
  )
  return { previstas: Number(r.rows[0]!.previstas), cumpridas: Number(r.rows[0]!.cumpridas) }
}

/**
 * Itens ativos com saldo abaixo do mínimo no INSTANTE (I-6): o saldo é
 * derivado dos movimentos com `em < instante` por `saldoEmMedida`, a mesma
 * função da lista de itens (`abaixoDoMinimo`). `instante = null` é agora.
 */
export async function contarAbaixoDoMinimo(c: pg.PoolClient, clinicaId: ClinicaId, instante: Date | null): Promise<number> {
  const r = await c.query<{ id: string; medida: string; minimo: string }>(
    `SELECT id, medida, minimo::text AS minimo FROM itens_de_estoque
      WHERE clinica_id = $1 AND excluido_em IS NULL AND ativo AND minimo IS NOT NULL`,
    [clinicaId],
  )
  const movs = await movimentosDosItens(c, r.rows.map((x) => x.id))
  let n = 0
  for (const l of r.rows) {
    const ate = (movs.get(l.id) ?? []).filter((m) => instante === null || new Date(m.em) < instante)
    // `medida` vem do cadastro (regra 9); o tipo do domínio é o da coluna.
    const { saldo } = saldoEmMedida(ate, l.medida as Parameters<typeof saldoEmMedida>[1])
    if (saldo.milesimos < BigInt(l.minimo)) n++
  }
  return n
}

/**
 * Banco de horas (números c.14): por ficha ATIVA, o saldo mais recente até o
 * mês `M`; o KPI soma só os POSITIVOS — horas que a clínica deve. Em minutos,
 * a menor unidade de `horas`.
 */
export async function bancoDeHorasPositivo(c: pg.PoolClient, clinicaId: ClinicaId, mes: string): Promise<bigint> {
  const r = await c.query<{ saldo: number }>(
    `SELECT DISTINCT ON (b.ficha_id) b.saldo_minutos AS saldo
       FROM banco_de_horas b
       JOIN fichas_de_pessoa f ON f.id = b.ficha_id AND f.clinica_id = b.clinica_id
      WHERE b.clinica_id = $1 AND b.excluido_em IS NULL AND b.mes <= $2
        AND f.ativo AND f.excluida_em IS NULL
      ORDER BY b.ficha_id, b.mes DESC`,
    [clinicaId, mes],
  )
  return r.rows.reduce((s, x) => (x.saldo > 0 ? s + BigInt(x.saldo) : s), 0n)
}

async function umAUmDoMes(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  mes: string,
): Promise<{ ativas: string[]; comConversa: string[] }> {
  const ativas = await c.query<{ id: string }>(
    'SELECT id FROM fichas_de_pessoa WHERE clinica_id = $1 AND excluida_em IS NULL AND ativo',
    [clinicaId],
  )
  const conversas = await c.query<{ ficha_id: string }>(
    'SELECT ficha_id FROM conversas_1a1 WHERE clinica_id = $1 AND excluida_em IS NULL AND mes = $2',
    [clinicaId, mes],
  )
  return { ativas: ativas.rows.map((x) => x.id), comConversa: conversas.rows.map((x) => x.ficha_id) }
}
