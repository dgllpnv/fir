import {
  type ComposicaoDoKpi,
  type ListaDeLancamentos,
  MAXIMO_DE_GRUPOS_DA_COMPOSICAO,
} from '@fir/contracts'
import {
  diaCivil,
  Dinheiro,
  ESCALA_DA_UNIDADE,
  fimDoMes,
  janela,
  kpiDoCatalogo,
  NumeroDoKpi,
  referenciaDoPeriodo,
  somarDias,
  type UnidadeDeKpi,
  validarJanela,
  valorNaTela,
} from '@fir/domain'
import { ForbiddenException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common'
import type pg from 'pg'
import { BancoService } from '../banco/banco.service'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { medirFaturamentoConferido } from '../financeiro/faturamento-conferido'
import { partesDosRecebidosDaJanela, VisaoDoMesService } from '../financeiro/visao-do-mes.service'
import { metaDoMes } from '../metas/metas.repositorio'
import { pacientesNovosDaJanela } from '../painel-geral/novos-pacientes'
import { type ContextoDeIndicadores, definicaoDe, IndicadoresService, type LinhaDeKpi } from './indicadores.service'

type Bloco = ComposicaoDoKpi['blocos'][number]
type Soma = { quantidade: number; numero: NumeroDoKpi }

/** Os grupos de um bloco: maior primeiro, empate pelo rótulo; `escala` na régua do PRÓPRIO bloco. */
function bloco(por: Bloco['por'], unidade: UnidadeDeKpi, somas: Map<string, Soma>): Bloco {
  const ordenados = [...somas.entries()].sort(([ra, a], [rb, b]) =>
    a.numero.emMenorUnidade === b.numero.emMenorUnidade
      ? ra.localeCompare(rb, 'pt-BR')
      : a.numero.emMenorUnidade > b.numero.emMenorUnidade
        ? -1
        : 1,
  )
  const regua = ordenados.map(([, s]) => s.numero)
  return {
    por,
    grupos: ordenados.slice(0, MAXIMO_DE_GRUPOS_DA_COMPOSICAO).map(([rotulo, s]) => ({
      rotulo,
      quantidade: s.quantidade,
      numero: valorNaTela(unidade, s.numero, null, regua),
    })),
    truncado: ordenados.length > MAXIMO_DE_GRUPOS_DA_COMPOSICAO,
  }
}

/**
 * **O DETALHE DO KPI: "De onde vem o número"** (T6; backlog 1.9 E; spec I-32,
 * LGPD L-IN-3).
 *
 * - A porta é a de sempre: `kpiVisivel` (appsec C5 → 404). Depois, a
 *   `permissaoDaComposicao` do catálogo (→ 403, "Sem acesso ao detalhe").
 * - **Os grupos saem das MESMAS linhas que a fonte do cartão conta**: no
 *   faturamento, `partesDosRecebidosDaJanela` (o `recebido` da Visão do mês)
 *   nos dias que `medirFaturamentoConferido` diz que contam; nos novos
 *   pacientes, `pacientesNovosDaJanela` (a tabela do Painel). A soma de cada
 *   bloco é o número do cartão; se não for, é defeito, e a rota falha alto.
 * - **Nenhum paciente atravessa**: só o rótulo do grupo (forma, tipo, origem)
 *   e a contagem. A linha a linha é do relatório (`relatorio`), com as travas
 *   dele.
 */
@Injectable()
export class DetalheDoKpiService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(IndicadoresService) private readonly indicadores: IndicadoresService,
    @Inject(VisaoDoMesService) private readonly visao: VisaoDoMesService,
  ) {}

  async composicao(ctx: ContextoDeIndicadores, id: string, q: { de?: string | undefined; ate?: string | undefined }): Promise<ComposicaoDoKpi> {
    const hoje = diaCivil(this.relogio.agora(), ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const k = await this.indicadores.kpiVisivel(c, ctx, id)
      const d = definicaoDe(k)
      if (d.chave === null) throw new UnprocessableEntityException('Indicador manual: o detalhe são os lançamentos.')
      const permissao = kpiDoCatalogo(d.chave).permissaoDaComposicao
      if (permissao !== null && !ctx.pode(permissao)) throw new ForbiddenException('Sem acesso ao detalhe.')
      const ate = q.ate ?? hoje
      const de = q.de ?? referenciaDoPeriodo(d.somenteMesCivil ? 'mensal' : k.frequencia, ate)
      const v = validarJanela(de, ate, hoje)
      if (v.tipo === 'erro') throw new UnprocessableEntityException(v.erro.mensagem)
      const fim = ate < hoje ? ate : hoje
      const base = { kpiId: k.id, periodo: { de, ate } }
      if (d.chave === 'faturamento_conferido') return this.doFaturamento(c, ctx, base, de, ate, fim, hoje)
      if (d.chave === 'novos_pacientes') return this.dosNovos(c, ctx, k, base, de, fim)
      return { ...base, disponivel: false, motivoIndisponivel: 'sem_composicao', total: null, diasAguardando: 0, blocos: [], relatorio: null }
    })
  }

  async lancamentos(ctx: ContextoDeIndicadores, id: string, q: { limite: number; deslocamento: number }): Promise<ListaDeLancamentos> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const k = await this.indicadores.kpiVisivel(c, ctx, id)
      if (k.origem !== 'manual') throw new UnprocessableEntityException('Só o indicador manual tem lançamentos.')
      const unidade = definicaoDe(k).unidade
      const r = await c.query<{ referencia: string; c: string | null; n: string | null; comentario: string; lancado_em: Date; autor: string | null }>(
        `SELECT l.referencia::text AS referencia, l.valor_centavos::text AS c, l.valor_numero::text AS n,
                l.comentario, l.lancado_em, p.nome AS autor
           FROM lancamentos_de_kpi l
           LEFT JOIN pessoas p ON p.clinica_id = l.clinica_id AND p.id = l.lancado_por
          WHERE l.clinica_id = $1 AND l.kpi_id = $2
          ORDER BY l.referencia DESC, l.id DESC
          LIMIT $3 OFFSET $4`,
        [ctx.clinicaId, k.id, q.limite + 1, q.deslocamento],
      )
      const itens = r.rows.slice(0, q.limite).map((l) => {
        // O XOR da unidade sai do construtor único (I-34): `emDinheiro` só em reais.
        const t = valorNaTela(unidade, NumeroDoKpi.de(unidade, BigInt((unidade === 'reais' ? l.c : l.n) ?? '0')))
        return {
          referencia: l.referencia,
          lancado: { emDinheiro: t.emDinheiro, emNumero: t.emNumero },
          comentario: l.comentario,
          autor: l.autor,
          lancadoEm: l.lancado_em.toISOString(),
        }
      })
      return { kpiId: k.id, unidade, itens, temMais: r.rows.length > q.limite }
    })
  }

  /** Faturamento por forma e por tipo, só dos dias que CONTAM (I-9; regra 6). */
  private async doFaturamento(
    c: pg.PoolClient,
    ctx: ContextoDeIndicadores,
    base: Pick<ComposicaoDoKpi, 'kpiId' | 'periodo'>,
    de: string,
    ate: string,
    fim: string,
    hoje: string,
  ): Promise<ComposicaoDoKpi> {
    // Mês medido pelo MedX: o número do cartão não é a soma dos recebimentos da FIR.
    const padrao = await this.visao.medidaPadrao(c, ctx)
    for (let mes = de.slice(0, 7); mes <= fim.slice(0, 7); mes = somarDias(fimDoMes(mes), 1).slice(0, 7)) {
      if (((await metaDoMes(c, ctx.clinicaId, mes))?.medidaPor ?? padrao) === 'medx') {
        return { ...base, disponivel: false, motivoIndisponivel: 'medido_pelo_medx', total: null, diasAguardando: 0, blocos: [], relatorio: null }
      }
    }
    const f = await medirFaturamentoConferido(c, ctx.clinicaId, de, ate, ctx.fuso, hoje, 'fir')
    const contam = new Set(f.corte.dias)
    const partes = (await partesDosRecebidosDaJanela(c, ctx.clinicaId, janela(de, fim, ctx.fuso), ctx.fuso)).filter((p) => contam.has(p.dia))
    const somar = (chave: (p: (typeof partes)[number]) => string) => {
      const m = new Map<string, { ids: Set<string>; total: Dinheiro }>()
      for (const p of partes) {
        const g = m.get(chave(p)) ?? { ids: new Set<string>(), total: Dinheiro.zero() }
        g.ids.add(p.recebimentoId)
        g.total = g.total.mais(p.valor)
        m.set(chave(p), g)
      }
      return new Map([...m].map(([r, g]) => [r, { quantidade: g.ids.size, numero: NumeroDoKpi.deDinheiro(g.total) }]))
    }
    const porForma = somar((p) => p.forma)
    const porTipo = somar((p) => p.tipo)
    // Σ das partes = `r.valor` é do banco (0086): a soma de cada bloco é o cartão.
    const soma = [...porForma.values()].reduce((s, g) => s + g.numero.emMenorUnidade, 0n)
    if (soma !== f.recebidoQueConta.centavos) throw new Error('composição do faturamento diverge do cartão')
    return {
      ...base,
      disponivel: true,
      motivoIndisponivel: null,
      total: valorNaTela('reais', NumeroDoKpi.deDinheiro(f.recebidoQueConta)),
      diasAguardando: f.diasAguardandoSemHoje,
      blocos: [bloco('forma', 'reais', porForma), bloco('tipo', 'reais', porTipo)],
      relatorio: { chave: 'recebimentos', de, ate: fim },
    }
  }

  /** Novos pacientes por origem: a tabela do Painel, contada — nenhum nome atravessa. */
  private async dosNovos(
    c: pg.PoolClient,
    ctx: ContextoDeIndicadores,
    k: LinhaDeKpi,
    base: Pick<ComposicaoDoKpi, 'kpiId' | 'periodo'>,
    de: string,
    fim: string,
  ): Promise<ComposicaoDoKpi> {
    const origem = typeof k.parametros['origem'] === 'string' ? k.parametros['origem'] : null
    const novos = (await pacientesNovosDaJanela(c, ctx.clinicaId, janela(de, fim, ctx.fuso), null)).filter(
      (p) => origem === null || p.origem === origem,
    )
    const porUnidade = ESCALA_DA_UNIDADE.quantidade.porUnidade
    const contagem = new Map<string, number>()
    for (const p of novos) contagem.set(p.origem, (contagem.get(p.origem) ?? 0) + 1)
    const porOrigem = new Map(
      [...contagem].map(([r, n]) => [r, { quantidade: n, numero: NumeroDoKpi.de('quantidade', BigInt(n) * porUnidade) }]),
    )
    return {
      ...base,
      disponivel: true,
      motivoIndisponivel: null,
      total: valorNaTela('quantidade', NumeroDoKpi.de('quantidade', BigInt(novos.length) * porUnidade)),
      diasAguardando: 0,
      blocos: [bloco('origem', 'quantidade', porOrigem)],
      relatorio: { chave: 'pacientes-por-origem-e-campanha', de, ate: fim },
    }
  }
}
