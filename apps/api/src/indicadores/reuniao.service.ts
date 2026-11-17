import type {
  ContadorDeIndicadores,
  IndicadoresDaSemana,
  KpiNaLista,
  ListaDeKpis,
  ListaDeOkrs,
  MetaEmAlerta,
  ReuniaoDeIndicadores,
} from '@fir/contracts'
import { inicioDoDia, referenciaDoPeriodo, somarDias } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import { BancoService } from '../banco/banco.service'
import { type ContextoDeIndicadores, IndicadoresService } from './indicadores.service'
import { OkrsService } from './okrs.service'

/** Até quatro metas no bloco de Hoje (I-45). */
const MAXIMO_DA_SEMANA = 4

/** `abaixo` antes de `atencao`; dentro de cada uma, o menor progresso primeiro. */
function ordemDoAlerta(a: MetaEmAlerta, b: MetaEmAlerta): number {
  const peso = (m: MetaEmAlerta) => (m.metaDoKpi.situacao === 'abaixo' ? 0 : 1)
  return peso(a) - peso(b) || (a.metaDoKpi.progresso ?? Number.MAX_SAFE_INTEGER) - (b.metaDoKpi.progresso ?? Number.MAX_SAFE_INTEGER)
}

/**
 * **HOJE, O CONTADOR DO MENU E O MODO REUNIÃO** (T7; spec I-45, I-46).
 *
 * Nenhum número é calculado aqui: tudo sai de `IndicadoresService.listar` (o
 * cartão e a meta de saúde) e de `OkrsService.listar` (as metas dos KRs) —
 * a mesma calculadora, a mesma porta `kpisVisiveis` (appsec C5). O KPI sem a
 * `permissaoDoValor` não chega aqui, e nenhuma rota repete o filtro.
 *
 * As três saídas são MONTADAS campo a campo em esquemas fechados (LGPD
 * L-IN-4): sem composição, sem `pacienteId`, sem nome de paciente, sem
 * responsável por id. A redação de `emDinheiro` é do `RedacaoInterceptor`;
 * nenhuma string traz número (appsec C8) — a capa é só contagem.
 */
@Injectable()
export class ReuniaoDeIndicadoresService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(IndicadoresService) private readonly indicadores: IndicadoresService,
    @Inject(OkrsService) private readonly okrs: OkrsService,
  ) {}

  async daSemana(ctx: ContextoDeIndicadores): Promise<IndicadoresDaSemana> {
    const { lista, okrs } = await this.ler(ctx)
    const itens = metasVigentes(lista, okrs)
      .filter((m) => m.metaDoKpi.situacao === 'abaixo' || m.metaDoKpi.situacao === 'atencao')
      .sort(ordemDoAlerta)
      .slice(0, MAXIMO_DA_SEMANA)
    return { hoje: lista.hoje, itens }
  }

  async contador(ctx: ContextoDeIndicadores): Promise<ContadorDeIndicadores> {
    const { lista, okrs } = await this.ler(ctx)
    return { abaixo: metasVigentes(lista, okrs).filter((m) => m.metaDoKpi.situacao === 'abaixo').length }
  }

  async reuniao(ctx: ContextoDeIndicadores): Promise<ReuniaoDeIndicadores> {
    const { lista, okrs } = await this.ler(ctx)
    const hoje = lista.hoje
    const de = referenciaDoPeriodo('semanal', hoje)
    const ate = somarDias(de, 6)
    const metas = metasVigentes(lista, okrs)
    const ativos = okrs.itens.filter((o) => o.estado === 'ativo')
    const conta = (s: string) => metas.filter((m) => m.metaDoKpi.situacao === s).length
    const visiveis = new Set(lista.itens.map((k) => k.id))

    const { clinica, planos } = await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const nome = await c.query<{ nome: string }>('SELECT nome FROM clinicas WHERE id = $1', [ctx.clinicaId])
      // A semana é `[segunda, próxima segunda)` em instantes UTC, com as bordas
      // no fuso da clínica (regra 23). O plano é tarefa interna: o filtro de
      // paciente é a segunda camada do contrato (L-IN-4).
      const r = await c.query<{
        id: string
        descricao: string
        kpi_id: string
        kpi_nome: string
        prazo: string
        status: 'aberta' | 'concluida' | 'cancelada'
        responsavel: string | null
      }>(
        `SELECT t.id, t.descricao, t.kpi_id, k.nome AS kpi_nome, t.prazo::text AS prazo, t.status::text AS status,
                coalesce(p.nome, g.nome) AS responsavel
           FROM tarefas t
           JOIN kpis k ON k.clinica_id = t.clinica_id AND k.id = t.kpi_id
           LEFT JOIN pessoas p ON p.clinica_id = t.clinica_id AND p.id = t.responsavel_id
           LEFT JOIN grupos_da_equipe g ON g.clinica_id = t.clinica_id AND g.id = t.grupo_id
          WHERE t.clinica_id = $1 AND t.kpi_id IS NOT NULL AND t.paciente_id IS NULL AND t.excluida_em IS NULL
            AND (t.marcador IS NULL OR t.marcador NOT LIKE 'lancamento-kpi:%')
            AND t.criada_em >= $2 AND t.criada_em < $3
          ORDER BY t.criada_em, t.id`,
        [ctx.clinicaId, inicioDoDia(de, ctx.fuso), inicioDoDia(somarDias(ate, 1), ctx.fuso)],
      )
      return { clinica: nome.rows[0]?.nome ?? '', planos: r.rows }
    })

    return {
      hoje,
      semana: { de, ate },
      capa: {
        clinica,
        okrsAtivos: ativos.length,
        metas: metas.length,
        abaixo: conta('abaixo'),
        atencao: conta('atencao'),
        noRitmo: conta('no_ritmo'),
        atingidas: conta('atingida'),
      },
      okrs: ativos.map((o) => ({
        id: o.id,
        objetivo: o.objetivo,
        periodo: { inicio: o.periodo.inicio, fim: o.periodo.fim },
        progresso: o.progresso,
        situacao: o.situacao,
        resultadosChave: o.resultadosChave.map((kr) => ({
          id: kr.id,
          kpi: { id: kr.kpi.id, nome: kr.kpi.nome, unidade: kr.kpi.unidade },
          metaDoKr: kr.metaDoKr,
        })),
      })),
      saude: lista.itens.filter((k) => k.okrIds.length === 0).map(kpiNaReuniao),
      // O KPI que a pessoa não pode ver (C5) leva junto o plano dele.
      planosDeAcao: planos
        .filter((p) => visiveis.has(p.kpi_id))
        .map((p) => ({
          id: p.id,
          descricao: p.descricao,
          kpi: { id: p.kpi_id, nome: p.kpi_nome },
          prazo: p.prazo,
          status: p.status,
          responsavel: p.responsavel,
        })),
    }
  }

  private async ler(ctx: ContextoDeIndicadores): Promise<{ lista: ListaDeKpis; okrs: ListaDeOkrs }> {
    const lista = await this.indicadores.listar(ctx, {})
    const okrs = await this.okrs.listar(ctx)
    return { lista, okrs }
  }
}

/**
 * As metas vivas HOJE: a meta de saúde vigente de cada cartão e a meta de cada
 * KR de OKR ativo cujo período contém hoje.
 */
function metasVigentes(lista: ListaDeKpis, okrs: ListaDeOkrs): MetaEmAlerta[] {
  const hoje = lista.hoje
  const saude: MetaEmAlerta[] = lista.itens.flatMap((k) =>
    k.metaVigente === null ? [] : [{ kpi: { id: k.id, nome: k.nome, unidade: k.unidade }, okrId: null, metaDoKpi: k.metaVigente }],
  )
  const krs: MetaEmAlerta[] = okrs.itens
    .filter((o) => o.estado === 'ativo')
    .flatMap((o) =>
      o.resultadosChave
        .filter((kr) => kr.metaDoKr.inicio <= hoje && hoje <= kr.metaDoKr.prazo)
        .map((kr) => ({ kpi: { id: kr.kpi.id, nome: kr.kpi.nome, unidade: kr.kpi.unidade }, okrId: o.id, metaDoKpi: kr.metaDoKr })),
    )
  return [...saude, ...krs]
}

const kpiNaReuniao = (k: KpiNaLista): ReuniaoDeIndicadores['saude'][number] => ({
  id: k.id,
  nome: k.nome,
  pilar: k.pilar,
  unidade: k.unidade,
  direcao: k.direcao,
  periodo: k.periodo,
  atual: k.atual,
  anterior: k.anterior,
  variacao: k.variacao,
  diasAguardando: k.diasAguardando,
  metaVigente: k.metaVigente,
})
