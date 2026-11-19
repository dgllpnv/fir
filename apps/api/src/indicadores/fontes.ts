import {
  caixasSemDiferenca,
  type ChaveDoCatalogo,
  classificarDesfecho,
  contarDesfechos,
  conversaoDeOrcamentos,
  type CorteDaMeta,
  Dinheiro,
  diasDe,
  ESCALA_DA_UNIDADE,
  ehRecaptacao,
  faltaMadura,
  fimDoMes,
  inicioDoDia,
  janela,
  kpiDoCatalogo,
  type MedidaDaMeta,
  NumeroDoKpi,
  recontatoEmAteDoisDias,
  saldoEmMedida,
  somarDias,
  somarMeses,
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
import { historicosDaJanela as cartoesDaJanela } from '../jornada/historicos-da-janela'
import { movimentosDosItens } from '../estoque/movimentos.repositorio'
import {
  caixasDoPeriodo,
  conferenciaDesde,
  diasQueContamNasTelas,
  medirFaturamentoConferido,
  trechosContinuos,
} from '../financeiro/faturamento-conferido'
import { pacientesQuePodemTerSaldo, saldosDe } from '../financeiro/saldo.repositorio'
import { VisaoDoMesService } from '../financeiro/visao-do-mes.service'
import { consultarPrazos, contarConversaoDeOrcamentos, TIPOS_DE_SESSAO } from '../painel-geral/metricas-diarias'
import { ORIGEM_DO_PACIENTE, PACIENTE_NOVO_NA_JANELA } from '../painel-geral/novos-pacientes'
import { ticketMedio, totaisDosDiasQueContam } from '../painel-geral/totais-de-pacientes'
import { MetasService } from '../pessoas/metas.service'

export type ContextoDoKpi = {
  readonly clinicaId: ClinicaId
  readonly ator: Ator
  readonly fuso: string
  readonly valores: boolean
  /** O filtro Unidade da lista: só as fontes de chave `porUnidade` o leem. */
  readonly unidadeId?: string
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
  /** Por que `numero` é `null` quando não é "nada aconteceu" (vira `motivoSemValor`). */
  readonly motivo?: string
  /**
   * Só no `faturamento_conferido`: o `aguardando` de `medirFaturamentoConferido`
   * (os dias anteriores a hoje sem caixa, sem hoje) e quantos dias são. Quem
   * o lê é a redação, por `finmes` (ADR 2026-11-19-aguardando-em-reais-com-finmes).
   */
  readonly aguardando?: { readonly valor: Dinheiro; readonly diasAnteriores: number }
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
 * **Regra 6 e as chaves em reais** (ADR 2026-11-17-chaves-em-reais-e-os-dias-de-caixa):
 * `faturamento_conferido` é a I-9 em todo período; as outras, que espelham
 * uma tela, dão o número da tela no mês passado e só os dias que contam no
 * mês corrente (`diasQueContamNasTelas`). Nenhum byte de `/v1/indicadores*`
 * muda com um recebimento de hoje (appsec C11).
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
    if (kpiDoCatalogo(kpi.chave).somenteMesCivil) return this.medirPorMes(c, ctx, kpi, p)
    const fim = p.ate < p.hoje ? p.ate : p.hoje
    const simples = (numero: NumeroDoKpi | null, diasAguardando = 0): MedidaDoKpi => ({
      numero,
      diasAguardando,
      corte: fim,
    })
    const j = (de: string, ate: string) => janela(de, ate, ctx.fuso)

    switch (kpi.chave) {
      case 'faturamento_conferido': {
        const f = await medirFaturamentoConferido(c, ctx.clinicaId, p.de, p.ate, ctx.fuso, p.hoje, kpi.medidaPor)
        const numero = kpi.medidaPor === 'medx' ? reais(f.medido) : reais(f.recebidoQueConta)
        return {
          numero,
          diasAguardando: f.diasAguardandoSemHoje,
          corte: f.corte,
          aguardando: { valor: f.aguardando, diasAnteriores: f.diasAnterioresAguardando },
        }
      }
      case 'ticket_medio':
      case 'valor_fechado_em_orcamentos': {
        // A fonte do Painel, medida em cada trecho contínuo de `D` (ADR
        // chaves-em-reais-e-os-dias-de-caixa): o dia aguardando fica fora.
        // A mesma composição do resumo do relatório 13 (`totaisDosDiasQueContam`).
        const { totais, dias: d } = await totaisDosDiasQueContam(c, ctx.clinicaId, { de: p.de, ate: fim }, ctx.fuso, p.hoje)
        const numero = kpi.chave === 'ticket_medio' ? reais(ticketMedio(totais)) : reais(totais.valorDosOrcamentosPagos)
        return { numero, diasAguardando: d.diasAguardando, corte: d.corte }
      }
      case 'saldo_a_receber': {
        // A posição no INSTANTE `início(fim + 1)` (I-6, c.9); o período em curso
        // é a de agora — a mesma de `aReceber` da Visão do mês.
        const opcoes = p.ate < p.hoje ? { ate: inicioDoDia(somarDias(p.ate, 1), ctx.fuso) } : {}
        const candidatos = await pacientesQuePodemTerSaldo(c, ctx.clinicaId, opcoes)
        const saldos = await saldosDe(c, ctx.clinicaId, candidatos, opcoes)
        return simples(reais([...saldos.values()].reduce((s, x) => s.mais(x.saldo), Dinheiro.zero())))
      }
      case 'caixas_sem_diferenca': {
        // Antes do primeiro caixa fechado não há conferência a medir: "sem
        // dado", nunca 0% (B6). O mês da adoção segue a tela (c.1).
        const desde = await conferenciaDesde(c, ctx.clinicaId)
        if (desde === null || fim < desde) return { ...simples(null), motivo: MOTIVO_ANTES_DO_PRIMEIRO_CAIXA }
        const r = caixasSemDiferenca(p.de, p.ate, p.hoje, await caixasDoPeriodo(c, ctx.clinicaId, p.de, p.ate))
        return simples(percentual(r.percentual))
      }
      case 'novos_pacientes':
        return simples(
          contagem(await contarNovosPacientes(c, ctx.clinicaId, j(p.de, fim), kpi.parametros['origem'], ctx.unidadeId)),
        )
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
      case 'resultado_de_campanha':
        return this.medirCampanha(c, ctx, kpi, p.de, fim, p.hoje)
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
      case 'resultado_do_mes':
      case 'despesas_fixas_sobre_recebido':
      case 'atingimento_metas_individuais':
      case 'saldo_banco_de_horas':
      case 'conversas_1a1_em_dia':
        // `somenteMesCivil` no catálogo: medidas em `medirPorMes`, acima.
        throw new Error(`fontes: ${kpi.chave} é só por mês civil`)
    }
  }

  /**
   * **AS CHAVES SÓ DE MÊS CIVIL** (validação T2, W2). A fonte é do mês inteiro
   * (a Visão do mês, as metas da equipe, o banco de horas, o 1:1): uma janela
   * que não é uma sequência de meses civis inteiros — o corrente pode ir só
   * até hoje — não tem número, nunca o do mês inteiro repetido em cada barra.
   * Vários meses combinam pela agregação: soma, razão das somas, a última
   * posição; a média mensal e o 1:1 são de um mês por vez.
   */
  private async medirPorMes(c: pg.PoolClient, ctx: ContextoDoKpi, kpi: KpiParaMedir, p: PeriodoDoKpi): Promise<MedidaDoKpi> {
    const fim = p.ate < p.hoje ? p.ate : p.hoje
    const comNumero = (numero: NumeroDoKpi | null): MedidaDoKpi => ({ numero, diasAguardando: 0, corte: fim })
    const semDado = (motivo: string): MedidaDoKpi => ({ ...comNumero(null), motivo })
    const meses = mesesCivisInteiros(p.de, p.ate, p.hoje)
    if (meses === null) return semDado(MOTIVO_SO_MES_CIVIL)
    const ultimo = meses.at(-1)!
    switch (kpi.chave) {
      case 'resultado_do_mes':
      case 'despesas_fixas_sobre_recebido': {
        // O número da Visão do mês, pela MESMA função (c.1). Mês passado é a
        // tela; o mês corrente corta nos dias que contam (regra 6, c.10).
        const corrente = p.hoje.slice(0, 7)
        let resultado = Dinheiro.zero()
        let fixas = Dinheiro.zero()
        let recebido = Dinheiro.zero()
        let diasAguardando = 0
        let corte: CorteDaMeta = fim
        for (const mes of meses) {
          const v = await this.visao.visaoNaConexao(c, ctx, mes, p.hoje, mes === corrente)
          resultado = resultado.mais(v.visao.resultadoDoMes)
          fixas = fixas.mais(v.visao.fixas)
          recebido = recebido.mais(v.visao.recebido)
          if (mes === corrente) {
            diasAguardando = v.medida.diasAguardandoSemHoje
            const antes = p.de < `${corrente}-01` ? diasDe(p.de, somarDias(`${corrente}-01`, -1)) : []
            const dias = [...antes, ...v.medida.corte.dias]
            corte = { ultimo: dias.at(-1) ?? null, dias }
          }
        }
        const numero =
          kpi.chave === 'resultado_do_mes' ? reais(resultado) : valorDaTaxa('percentual', fixas.centavos, recebido.centavos)
        return { numero, diasAguardando, corte }
      }
      case 'saldo_banco_de_horas':
        // `posicao`: a do último mês da janela.
        return comNumero(NumeroDoKpi.de('horas', await bancoDeHorasPositivo(c, ctx.clinicaId, ultimo)))
      case 'atingimento_metas_individuais': {
        if (meses.length !== 1) return semDado(MOTIVO_UM_MES_POR_VEZ)
        const m = await this.metasDePessoa.metasDoMes(ctx, ultimo)
        const r = valorDaMediaMensal([{ mes: ultimo, percentuais: m.pessoas.map((x) => x.mediaDeAtingimento) }])
        return comNumero(r.tipo === 'ok' ? r.valor : null)
      }
      case 'conversas_1a1_em_dia': {
        if (meses.length !== 1) return semDado(MOTIVO_UM_MES_POR_VEZ)
        const r = await umAUmDoMes(c, ctx.clinicaId, ultimo)
        return comNumero(percentual(umAUmEmDia(r.ativas, r.comConversa)))
      }
      default:
        throw new Error(`fontes: ${kpi.chave} não é só de mês civil`)
    }
  }

  /**
   * `resultado_de_campanha` (I-7): a regra da tela de Campanhas sobre as
   * tarefas concluídas NA JANELA (validação T2, W3). Em reais, só os dias que
   * contam (regra 6): o pagamento de hoje com o caixa aberto não muda nenhum
   * byte. A campanha que não cruza a janela é "sem dado".
   */
  private async medirCampanha(
    c: pg.PoolClient,
    ctx: ContextoDoKpi,
    kpi: KpiParaMedir,
    de: string,
    fim: string,
    hoje: string,
  ): Promise<MedidaDoKpi> {
    const id = kpi.parametros['campanhaId']
    const naJanela = async (a: string, b: string) =>
      (await this.campanhas.naJanela(c, ctx, hoje, janela(a, b, ctx.fuso))).find((x) => x.id === id)
    const camp = await naJanela(de, fim)
    if (camp === undefined || camp.inicio > fim || camp.fim < de) return { numero: null, diasAguardando: 0, corte: fim }
    if (kpi.unidade !== 'reais') {
      return { numero: camp.resultadoEmNumero === null ? null : contagem(camp.resultadoEmNumero), diasAguardando: 0, corte: fim }
    }
    const d = await diasQueContamNasTelas(c, ctx.clinicaId, de, fim, ctx.fuso, hoje)
    let total = 0n
    for (const t of trechosContinuos(d.corte.dias)) total += BigInt((await naJanela(t.de, t.ate))?.resultadoEmDinheiro ?? '0')
    return { numero: NumeroDoKpi.de('reais', total), diasAguardando: d.diasAguardando, corte: d.corte }
  }
}

export const MOTIVO_SO_MES_CIVIL = 'so_mes_civil_inteiro'
export const MOTIVO_UM_MES_POR_VEZ = 'um_mes_por_vez'
export const MOTIVO_ANTES_DO_PRIMEIRO_CAIXA = 'antes_do_primeiro_caixa'

/** `[de, ate]` é uma sequência de meses civis inteiros (o corrente pode ir só até hoje)? */
export function mesesCivisInteiros(de: string, ate: string, hoje: string): string[] | null {
  if (de > ate || de.slice(8, 10) !== '01') return null
  const mesFinal = ate.slice(0, 7)
  const inteiro = ate === fimDoMes(mesFinal) || (mesFinal === hoje.slice(0, 7) && ate >= hoje)
  if (!inteiro) return null
  const meses: string[] = []
  for (let m = de.slice(0, 7); m <= mesFinal; m = somarMeses(`${m}-01`, 1).slice(0, 7)) meses.push(m)
  return meses
}

type EventoDoHistorico = Parameters<typeof classificarDesfecho>[0][number]

/** Os históricos dos cartões com algum evento na janela (I-10, I-11) — a leitura do relatório 14 também. */
async function historicosDaJanela(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  j: { de: Date; ate: Date },
): Promise<(readonly EventoDoHistorico[])[]> {
  return (await cartoesDaJanela(c, clinicaId, j)).map((x) => x.historico)
}

/** Pacientes novos na janela — o `WHERE` e o rótulo de origem do Painel (`novos-pacientes.ts`). */
export async function contarNovosPacientes(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  j: { de: Date; ate: Date },
  origem: string | undefined,
  /** O filtro Unidade: a unidade PRINCIPAL da paciente, a mesma régua do Painel por unidade. */
  unidadeId?: string,
): Promise<number> {
  const r = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pacientes pa
      WHERE ${PACIENTE_NOVO_NA_JANELA}
        AND ($4::text IS NULL OR (${ORIGEM_DO_PACIENTE}) = $4)
        AND ($5::uuid IS NULL OR pa.unidade_id = $5::uuid)`,
    [clinicaId, j.de, j.ate, origem ?? null, unidadeId ?? null],
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
