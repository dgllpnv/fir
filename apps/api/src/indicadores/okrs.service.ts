import type {
  CriarOkr,
  DuplicarOkr,
  EditarOkr,
  ListaDeOkrs,
  OkrNaSaida,
  ResultadoChaveNaSaida,
  ResultadoChavePedido,
} from '@fir/contracts'
import {
  alvoDaCampanha,
  avisoDeKrs,
  diaCivil,
  exigeValoresParaEscrever,
  NumeroDoKpi,
  ordenarOkrs,
  type PeriodoDoOkr,
  periodoDoOkr,
  progressoDoOkr,
  proximoPeriodoDoOkr,
  situacaoDoOkr,
  type TipoDePeriodoDoOkr,
  tipoDaMetaDoKr,
  validarKrsDoOkr,
  validarMeta,
} from '@fir/domain'
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type pg from 'pg'
import { pessoaDoAtor } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { VisaoDoMesService } from '../financeiro/visao-do-mes.service'
import {
  type ContextoDeIndicadores,
  type Definicao,
  definicaoDe,
  IndicadoresService,
  type LinhaDeKpi,
  type LinhaDeMeta,
  SELECT_META,
  traduzirErroDoBanco,
} from './indicadores.service'

type LinhaDeOkr = {
  id: string
  objetivo: string
  porque: string
  tipo_periodo: TipoDePeriodoDoOkr
  inicio: string
  fim: string
  responsavel_id: string | null
  estado: 'ativo' | 'encerrado'
  encerrado_em: Date | null
}

type LinhaDeKr = { id: string; kpi_id: string; ordem: number }

/** O alvo e a partida de um KR, já na unidade do KPI e validados pela meta (I-22). */
type KrPreparado = {
  readonly kpi: LinhaDeKpi
  readonly definicao: Definicao
  readonly alvo: NumeroDoKpi
  readonly partida: NumeroDoKpi
}

const SELECT_OKR = `
  SELECT id, objetivo, porque, tipo_periodo, inicio::text AS inicio, fim::text AS fim,
         responsavel_id, estado, encerrado_em
    FROM okrs`

const TRAVA = 'okr_de_1_a_5_krs'

/**
 * **OKRs E RESULTADOS-CHAVE** (spec E; CONTEXT.md `OKR`, `Resultado-chave`).
 *
 * Um KR é o vínculo do OKR com um KPI, com uma META PRÓPRIA em `metas_de_kpi`
 * (`resultado_chave_id`). A meta do KR sai pelas mesmas contas da meta de
 * saúde (`IndicadoresService.metaNaSaida`), e o KPI só entra pela porta única
 * `kpisVisiveis` (appsec C5): KR de KPI que a pessoa não pode ver não existe
 * na resposta, e o progresso do OKR é a média dos KRs EXIBIDOS (números c.12).
 *
 * Toda escrita de alvo ou partida em reais exige `valores` (appsec C3) —
 * criar, editar e duplicar. Todo id do corpo é conferido contra a clínica
 * (appsec C6): o KPI pela porta única (404), o responsável pela FK composta
 * (422), o OKR pela RLS e pelo filtro (404).
 *
 * `objetivo` e `porque` são texto livre da equipe (LGPD R-e): nunca em log,
 * nunca em mensagem de erro.
 */
@Injectable()
export class OkrsService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(IndicadoresService) private readonly indicadores: IndicadoresService,
    @Inject(VisaoDoMesService) private readonly visao: VisaoDoMesService,
  ) {}

  private hoje(ctx: ContextoDeIndicadores): string {
    return diaCivil(this.relogio.agora(), ctx.fuso)
  }

  /* ---------------------------------------------------------------- leitura */

  async listar(ctx: ContextoDeIndicadores): Promise<ListaDeOkrs> {
    const hoje = this.hoje(ctx)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDeOkr>(`${SELECT_OKR} WHERE clinica_id = $1 AND arquivado_em IS NULL ORDER BY inicio, id`, [
        ctx.clinicaId,
      ])
      const visiveis = await this.kpisPorId(c, ctx)
      const itens: OkrNaSaida[] = []
      for (const o of r.rows) itens.push(await this.saida(c, ctx, o, visiveis, hoje))
      return { hoje, itens: ordenarOkrs(itens) }
    })
  }

  async detalhe(ctx: ContextoDeIndicadores, id: string): Promise<OkrNaSaida> {
    const hoje = this.hoje(ctx)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) =>
      this.saida(c, ctx, await this.okrDaClinica(c, ctx, id, false), await this.kpisPorId(c, ctx), hoje),
    )
  }

  /* ---------------------------------------------------------------- escrita */

  async criar(ctx: ContextoDeIndicadores, dados: CriarOkr): Promise<OkrNaSaida> {
    const hoje = this.hoje(ctx)
    const periodo = exigirOk(periodoDoOkr(dados.periodo, hoje))
    exigirOk(validarKrsDoOkr(dados.resultadosChave.map((k) => k.kpiId)))
    if (dados.resultadosChave.some((k) => k.id !== undefined)) {
      throw new UnprocessableEntityException('Um OKR novo só tem resultados-chave novos.')
    }
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      try {
        const okr = await this.inserirOkr(c, ctx, {
          objetivo: dados.objetivo,
          porque: dados.porque,
          periodo,
          responsavelId: dados.responsavelId ?? null,
        })
        const preparados: KrPreparado[] = []
        for (const pedido of dados.resultadosChave) {
          const k = await this.indicadores.kpiVisivel(c, ctx, pedido.kpiId)
          preparados.push(await this.prepararKr(c, ctx, k, periodo, pedido, null))
        }
        for (const [i, p] of preparados.entries()) await this.inserirKr(c, ctx, okr.id, i + 1, p, periodo, okr.responsavel_id)
        await c.query(`SET CONSTRAINTS ${TRAVA} IMMEDIATE`)
        return await this.saida(c, ctx, okr, await this.kpisPorId(c, ctx), hoje)
      } catch (e) {
        throw traduzirErroDeOkr(e)
      }
    })
  }

  async editar(ctx: ContextoDeIndicadores, id: string, dados: EditarOkr): Promise<OkrNaSaida> {
    const hoje = this.hoje(ctx)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      try {
        const atual = await this.okrDaClinica(c, ctx, id, true)
        if (atual.estado === 'encerrado') throw new ConflictException('OKR encerrado não se edita; duplique-o para o próximo período.')
        const periodo =
          dados.periodo === undefined ? periodoDaLinha(atual) : exigirOk(periodoDoOkr(dados.periodo, hoje))
        const responsavelId = dados.responsavelId === undefined ? atual.responsavel_id : dados.responsavelId
        await c.query(
          `UPDATE okrs SET objetivo = $3, porque = $4, tipo_periodo = $5, inicio = $6::date, fim = $7::date, responsavel_id = $8
            WHERE clinica_id = $1 AND id = $2`,
          [ctx.clinicaId, id, dados.objetivo ?? atual.objetivo, dados.porque ?? atual.porque, periodo.tipo, periodo.inicio, periodo.fim, responsavelId],
        )
        const visiveis = await this.kpisPorId(c, ctx)
        const krs = await this.krsVivos(c, ctx, id)
        // O KR de KPI que a pessoa NÃO vê (C5) fica como está: ela não o recebeu, e não o tira por omissão.
        const meus = krs.filter((kr) => visiveis.has(kr.kpi_id))
        const pedidos: readonly ResultadoChavePedido[] =
          dados.resultadosChave ?? meus.map((kr) => ({ id: kr.id, kpiId: kr.kpi_id }))
        // Só a lista NOVA se confere: sem ela, nada muda — nem quando todos os KRs são invisíveis a ela.
        if (dados.resultadosChave !== undefined) exigirOk(validarKrsDoOkr(pedidos.map((p) => p.kpiId)))

        const porId = new Map(meus.map((kr) => [kr.id, kr]))
        const preparados: { pedido: ResultadoChavePedido; p: KrPreparado }[] = []
        for (const pedido of pedidos) {
          let existente: LinhaDeMeta | null = null
          if (pedido.id !== undefined) {
            const kr = porId.get(pedido.id)
            if (kr === undefined) throw new NotFoundException('Resultado-chave não encontrado neste OKR.')
            if (kr.kpi_id !== pedido.kpiId) throw new UnprocessableEntityException('O indicador de um resultado-chave não muda; crie outro.')
            existente = await this.metaDoKr(c, ctx, kr.id)
          }
          const k = await this.indicadores.kpiVisivel(c, ctx, pedido.kpiId)
          preparados.push({ pedido, p: await this.prepararKr(c, ctx, k, periodo, pedido, existente) })
        }

        const mantidos = new Set(pedidos.flatMap((p) => (p.id === undefined ? [] : [p.id])))
        for (const kr of meus) if (!mantidos.has(kr.id)) await this.arquivarKr(c, ctx, kr.id)
        for (const [i, { pedido, p }] of preparados.entries()) {
          if (pedido.id === undefined) await this.inserirKr(c, ctx, id, i + 1, p, periodo, responsavelId)
          else await this.atualizarKr(c, ctx, pedido.id, i + 1, p, periodo, responsavelId)
        }
        // Os KRs que a pessoa não vê acompanham o período e o responsável do OKR — sem tocar no alvo.
        for (const kr of krs.filter((x) => !visiveis.has(x.kpi_id))) {
          await c.query(
            `UPDATE metas_de_kpi SET tipo = $3, inicio = $4::date, prazo = $5::date, responsavel_id = $6
              WHERE clinica_id = $1 AND resultado_chave_id = $2 AND arquivada_em IS NULL`,
            [ctx.clinicaId, kr.id, tipoDaMetaDoKr(periodo), periodo.inicio, periodo.fim, responsavelId],
          )
        }
        await c.query(`SET CONSTRAINTS ${TRAVA} IMMEDIATE`)
        return await this.saida(c, ctx, await this.okrDaClinica(c, ctx, id, false), visiveis, hoje)
      } catch (e) {
        throw traduzirErroDeOkr(e)
      }
    })
  }

  /** Idempotente: encerrar o encerrado devolve o mesmo OKR. As metas dos KRs ficam — e congelam no prazo. */
  async encerrar(ctx: ContextoDeIndicadores, id: string): Promise<OkrNaSaida> {
    const hoje = this.hoje(ctx)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const okr = await this.okrDaClinica(c, ctx, id, true)
      if (okr.estado === 'ativo') {
        await c.query(
          `UPDATE okrs SET estado = 'encerrado', encerrado_em = now() WHERE clinica_id = $1 AND id = $2 AND estado = 'ativo'`,
          [ctx.clinicaId, id],
        )
      }
      return this.saida(c, ctx, await this.okrDaClinica(c, ctx, id, false), await this.kpisPorId(c, ctx), hoje)
    })
  }

  /**
   * Duplicar (spec E.1): o próximo período, os mesmos KPIs e alvos, e a
   * partida RECALCULADA — o valor de hoje do KPI, o mesmo do cartão (na
   * `soma`, sempre zero). Só os KRs que a pessoa vê; KR em reais sem `valores`
   * é 403, mesmo sem o valor no corpo: o servidor gravaria o alvo por ela.
   */
  async duplicar(ctx: ContextoDeIndicadores, id: string, dados: DuplicarOkr): Promise<OkrNaSaida> {
    const hoje = this.hoje(ctx)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      try {
        const origem = await this.okrDaClinica(c, ctx, id, false)
        const periodo =
          dados.periodo === undefined ? proximoPeriodoDoOkr(periodoDaLinha(origem)) : exigirOk(periodoDoOkr(dados.periodo, hoje))
        const visiveis = await this.kpisPorId(c, ctx)
        const krs = (await this.krsVivos(c, ctx, id)).filter((kr) => visiveis.has(kr.kpi_id))
        const novosAlvos = new Map((dados.alvos ?? []).map((a) => [a.resultadoChaveId, a.alvo]))
        for (const krId of novosAlvos.keys()) {
          if (!krs.some((kr) => kr.id === krId)) throw new NotFoundException('Resultado-chave não encontrado neste OKR.')
        }
        const preparados: KrPreparado[] = []
        for (const kr of krs) {
          const k = visiveis.get(kr.kpi_id)!
          const d = definicaoDe(k)
          exigirEscritaNaUnidade(ctx, d.unidade)
          const meta = await this.metaDoKr(c, ctx, kr.id)
          if (meta === null) continue
          const alvoNovo = novosAlvos.get(kr.id)
          const alvo = alvoNovo ?? (d.unidade === 'reais' ? meta.alvo_centavos : meta.alvo_numero)!
          const partida = d.agregacao === 'soma' || d.agregacao === 'analise'
            ? '0'
            : ((await this.indicadores.valorDoPeriodoCorrente(c, ctx, k, hoje))?.emMenorUnidade.toString() ??
              (d.unidade === 'reais' ? meta.partida_centavos : meta.partida_numero) ??
              '0')
          preparados.push(await this.prepararKr(c, ctx, k, periodo, { alvo, partida }, null, alvoNovo === undefined))
        }
        if (preparados.length === 0) throw new UnprocessableEntityException('Este OKR não tem resultado-chave para duplicar.')
        const okr = await this.inserirOkr(c, ctx, {
          objetivo: origem.objetivo,
          porque: origem.porque,
          periodo,
          responsavelId: origem.responsavel_id,
        })
        for (const [i, p] of preparados.entries()) await this.inserirKr(c, ctx, okr.id, i + 1, p, periodo, okr.responsavel_id)
        await c.query(`SET CONSTRAINTS ${TRAVA} IMMEDIATE`)
        return await this.saida(c, ctx, okr, visiveis, hoje)
      } catch (e) {
        throw traduzirErroDeOkr(e)
      }
    })
  }

  /** Arquivar leva os KRs e as metas deles junto: a meta do KR libera o `EXCLUDE` (I-25). Nunca DELETE. */
  async arquivar(ctx: ContextoDeIndicadores, id: string): Promise<{ arquivado: true }> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      await this.okrDaClinica(c, ctx, id, true)
      await c.query(
        `UPDATE metas_de_kpi SET arquivada_em = now()
          WHERE clinica_id = $1 AND arquivada_em IS NULL
            AND resultado_chave_id IN (SELECT id FROM resultados_chave WHERE clinica_id = $1 AND okr_id = $2)`,
        [ctx.clinicaId, id],
      )
      await c.query('UPDATE resultados_chave SET arquivado_em = now() WHERE clinica_id = $1 AND okr_id = $2 AND arquivado_em IS NULL', [
        ctx.clinicaId,
        id,
      ])
      await c.query('UPDATE okrs SET arquivado_em = now() WHERE clinica_id = $1 AND id = $2 AND arquivado_em IS NULL', [ctx.clinicaId, id])
      await c.query(`SET CONSTRAINTS ${TRAVA} IMMEDIATE`)
    })
    return { arquivado: true }
  }

  /* ------------------------------------------------------------- internos */

  /** Os KPIs que a pessoa pode ver, pela porta única (C5). */
  private async kpisPorId(c: pg.PoolClient, ctx: ContextoDeIndicadores): Promise<Map<string, LinhaDeKpi>> {
    return new Map((await this.indicadores.kpisVisiveis(c, ctx, null)).map((k) => [k.id, k]))
  }

  private async okrDaClinica(c: pg.PoolClient, ctx: ContextoDeIndicadores, id: string, travar: boolean): Promise<LinhaDeOkr> {
    const r = await c.query<LinhaDeOkr>(
      `${SELECT_OKR} WHERE clinica_id = $1 AND id = $2 AND arquivado_em IS NULL${travar ? ' FOR UPDATE' : ''}`,
      [ctx.clinicaId, id],
    )
    const o = r.rows[0]
    if (o === undefined) throw new NotFoundException('OKR não encontrado.')
    return o
  }

  private async krsVivos(c: pg.PoolClient, ctx: ContextoDeIndicadores, okrId: string): Promise<LinhaDeKr[]> {
    const r = await c.query<LinhaDeKr>(
      `SELECT id, kpi_id, ordem FROM resultados_chave
        WHERE clinica_id = $1 AND okr_id = $2 AND arquivado_em IS NULL ORDER BY ordem, criado_em, id`,
      [ctx.clinicaId, okrId],
    )
    return r.rows
  }

  private async metaDoKr(c: pg.PoolClient, ctx: ContextoDeIndicadores, krId: string): Promise<LinhaDeMeta | null> {
    const r = await c.query<LinhaDeMeta>(
      `${SELECT_META} WHERE clinica_id = $1 AND resultado_chave_id = $2 AND arquivada_em IS NULL ORDER BY inicio LIMIT 1`,
      [ctx.clinicaId, krId],
    )
    return r.rows[0] ?? null
  }

  /**
   * O alvo e a partida de um KR, conferidos:
   * - KR de campanha: o alvo é a meta da campanha, travado (I-27);
   * - `valores` para gravar em reais (C3): KR novo, ou alvo/partida no corpo;
   * - a meta passa por `validarMeta` (alvo pior que a partida → 422; mês civil
   *   para o `resultado_do_mes`, números c.4).
   */
  private async prepararKr(
    c: pg.PoolClient,
    ctx: ContextoDeIndicadores,
    k: LinhaDeKpi,
    periodo: PeriodoDoOkr,
    pedido: Pick<ResultadoChavePedido, 'alvo' | 'partida'>,
    existente: LinhaDeMeta | null,
    alvoCopiado = false,
  ): Promise<KrPreparado> {
    const d = definicaoDe(k)
    const emReais = d.unidade === 'reais'
    if (existente === null || pedido.alvo !== undefined || pedido.partida !== undefined) exigirEscritaNaUnidade(ctx, d.unidade)

    let alvo: NumeroDoKpi
    if (d.chave === 'resultado_de_campanha') {
      const camp = await c.query<{ metrica: string; meta: string }>(
        `SELECT metrica, meta::text AS meta FROM campanhas
          WHERE clinica_id = $1 AND id::text = $2 AND excluida_em IS NULL`,
        [ctx.clinicaId, String(k.parametros['campanhaId'] ?? '')],
      )
      const cp = camp.rows[0]
      if (cp === undefined) throw new UnprocessableEntityException('A campanha deste indicador não existe mais.')
      alvo = alvoDaCampanha(cp.metrica, BigInt(cp.meta))
      if (!alvoCopiado && pedido.alvo !== undefined && BigInt(pedido.alvo) !== alvo.emMenorUnidade) {
        throw new UnprocessableEntityException('O alvo do resultado-chave de campanha é a meta da campanha; edite-a na campanha.')
      }
    } else {
      const texto = pedido.alvo ?? (existente === null ? undefined : (emReais ? existente.alvo_centavos : existente.alvo_numero) ?? undefined)
      if (texto === undefined) throw new UnprocessableEntityException('Informe o alvo do resultado-chave.')
      alvo = NumeroDoKpi.de(d.unidade, BigInt(texto))
    }
    const partidaTexto =
      pedido.partida ?? (existente === null ? null : emReais ? existente.partida_centavos : existente.partida_numero) ?? '0'
    const partida = NumeroDoKpi.de(d.unidade, BigInt(partidaTexto))
    const v = validarMeta(d, { tipo: tipoDaMetaDoKr(periodo), inicio: periodo.inicio, prazo: periodo.fim, partida, alvo })
    if (v.tipo === 'erro') throw new UnprocessableEntityException(v.erro.mensagem)
    return { kpi: k, definicao: d, alvo, partida }
  }

  private async inserirOkr(
    c: pg.PoolClient,
    ctx: ContextoDeIndicadores,
    o: { objetivo: string; porque: string; periodo: PeriodoDoOkr; responsavelId: string | null },
  ): Promise<LinhaDeOkr> {
    const r = await c.query<LinhaDeOkr>(
      `INSERT INTO okrs (clinica_id, objetivo, porque, tipo_periodo, inicio, fim, responsavel_id, criado_por)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8)
       RETURNING id, objetivo, porque, tipo_periodo, inicio::text AS inicio, fim::text AS fim, responsavel_id, estado, encerrado_em`,
      [ctx.clinicaId, o.objetivo, o.porque, o.periodo.tipo, o.periodo.inicio, o.periodo.fim, o.responsavelId, pessoaDoAtor(ctx.ator)],
    )
    return r.rows[0]!
  }

  private async inserirKr(
    c: pg.PoolClient,
    ctx: ContextoDeIndicadores,
    okrId: string,
    ordem: number,
    p: KrPreparado,
    periodo: PeriodoDoOkr,
    responsavelId: string | null,
  ): Promise<void> {
    const kr = await c.query<{ id: string }>(
      'INSERT INTO resultados_chave (clinica_id, okr_id, kpi_id, ordem) VALUES ($1, $2, $3, $4) RETURNING id',
      [ctx.clinicaId, okrId, p.kpi.id, ordem],
    )
    const emReais = p.definicao.unidade === 'reais'
    const medidaPor = p.definicao.chave === 'faturamento_conferido' ? await this.visao.medidaPadrao(c, ctx) : 'fir'
    await c.query(
      `INSERT INTO metas_de_kpi (clinica_id, kpi_id, resultado_chave_id, tipo, inicio, prazo, alvo_centavos, alvo_numero,
                                 partida_centavos, partida_numero, responsavel_id, medida_por, definida_por)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12, $13)`,
      [ctx.clinicaId, p.kpi.id, kr.rows[0]!.id, tipoDaMetaDoKr(periodo), periodo.inicio, periodo.fim,
        emReais ? p.alvo.emMenorUnidade.toString() : null, emReais ? null : p.alvo.emMenorUnidade.toString(),
        emReais ? p.partida.emMenorUnidade.toString() : null, emReais ? null : p.partida.emMenorUnidade.toString(),
        responsavelId, medidaPor, pessoaDoAtor(ctx.ator)],
    )
  }

  private async atualizarKr(
    c: pg.PoolClient,
    ctx: ContextoDeIndicadores,
    krId: string,
    ordem: number,
    p: KrPreparado,
    periodo: PeriodoDoOkr,
    responsavelId: string | null,
  ): Promise<void> {
    await c.query('UPDATE resultados_chave SET ordem = $3 WHERE clinica_id = $1 AND id = $2', [ctx.clinicaId, krId, ordem])
    const emReais = p.definicao.unidade === 'reais'
    await c.query(
      `UPDATE metas_de_kpi SET tipo = $3, inicio = $4::date, prazo = $5::date, alvo_centavos = $6, alvo_numero = $7,
              partida_centavos = $8, partida_numero = $9, responsavel_id = $10, definida_por = $11, definida_em = now()
        WHERE clinica_id = $1 AND resultado_chave_id = $2 AND arquivada_em IS NULL`,
      [ctx.clinicaId, krId, tipoDaMetaDoKr(periodo), periodo.inicio, periodo.fim,
        emReais ? p.alvo.emMenorUnidade.toString() : null, emReais ? null : p.alvo.emMenorUnidade.toString(),
        emReais ? p.partida.emMenorUnidade.toString() : null, emReais ? null : p.partida.emMenorUnidade.toString(),
        responsavelId, pessoaDoAtor(ctx.ator)],
    )
  }

  private async arquivarKr(c: pg.PoolClient, ctx: ContextoDeIndicadores, krId: string): Promise<void> {
    await c.query('UPDATE metas_de_kpi SET arquivada_em = now() WHERE clinica_id = $1 AND resultado_chave_id = $2 AND arquivada_em IS NULL', [
      ctx.clinicaId,
      krId,
    ])
    await c.query('UPDATE resultados_chave SET arquivado_em = now() WHERE clinica_id = $1 AND id = $2', [ctx.clinicaId, krId])
  }

  /** A saída: só os KRs EXIBIDOS (C5), e o OKR é a média deles e a pior situação (números c.12). */
  private async saida(
    c: pg.PoolClient,
    ctx: ContextoDeIndicadores,
    o: LinhaDeOkr,
    visiveis: Map<string, LinhaDeKpi>,
    hoje: string,
  ): Promise<OkrNaSaida> {
    const resultadosChave: ResultadoChaveNaSaida[] = []
    for (const kr of await this.krsVivos(c, ctx, o.id)) {
      const k = visiveis.get(kr.kpi_id)
      if (k === undefined) continue
      const linha = await this.metaDoKr(c, ctx, kr.id)
      if (linha === null) continue
      const d = definicaoDe(k)
      const meta = await this.indicadores.metaNaSaida(c, ctx, k, d, linha, hoje)
      resultadosChave.push({
        id: kr.id,
        ordem: kr.ordem,
        kpi: { id: k.id, nome: k.nome, chave: d.chave, unidade: d.unidade },
        alvoTravado: d.chave === 'resultado_de_campanha',
        metaDoKr: meta,
      })
    }
    return {
      id: o.id,
      objetivo: o.objetivo,
      porque: o.porque,
      periodo: { tipo: o.tipo_periodo, inicio: o.inicio, fim: o.fim },
      responsavelId: o.responsavel_id,
      estado: o.estado,
      encerradoEm: o.encerrado_em === null ? null : o.encerrado_em.toISOString(),
      progresso: progressoDoOkr(resultadosChave.map((kr) => kr.metaDoKr.progresso)),
      situacao: situacaoDoOkr(resultadosChave.map((kr) => kr.metaDoKr.situacao)),
      avisoDeKrs: avisoDeKrs(resultadosChave.length),
      resultadosChave,
    }
  }
}

const periodoDaLinha = (o: LinhaDeOkr): PeriodoDoOkr => ({ tipo: o.tipo_periodo, inicio: o.inicio, fim: o.fim })

function exigirOk<T>(r: { tipo: 'ok'; valor: T } | { tipo: 'erro'; erro: { mensagem: string } }): T {
  if (r.tipo === 'erro') throw new UnprocessableEntityException(r.erro.mensagem)
  return r.valor
}

/** C3 (appsec): alvo ou partida em reais exige `valores` — 403, antes de qualquer conta. */
function exigirEscritaNaUnidade(ctx: ContextoDeIndicadores, unidade: Definicao['unidade']): void {
  if (exigeValoresParaEscrever(unidade) && !ctx.pode('valores')) {
    throw new ForbiddenException('Definir valor em reais exige a permissão de ver valores.')
  }
}

/** A trava 1–5 (0102) e o KPI repetido viram 422 com mensagem fixa — nunca o texto do banco. */
function traduzirErroDeOkr(e: unknown): unknown {
  if (typeof e === 'object' && e !== null && 'constraint' in e) {
    if (e.constraint === TRAVA) return new UnprocessableEntityException('Um OKR tem de 1 a 5 resultados-chave.')
    if (e.constraint === 'kpi_uma_vez_por_okr') return new UnprocessableEntityException('O mesmo indicador aparece duas vezes neste OKR.')
  }
  return traduzirErroDoBanco(e, 'Já existe uma meta viva deste indicador neste resultado-chave.')
}
