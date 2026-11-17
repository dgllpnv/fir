import {
  type CatalogoDeKpisNaSaida,
  type CriarKpi,
  type CriarMetaDeKpi,
  type DetalheDoKpi,
  type EditarKpi,
  type EditarMetaDeKpi,
  type KpiNaLista,
  lerParametrosDoKpi,
  type ListaDeKpis,
  type MetaDeKpiNaSaida,
  type PreviaDaMeta,
  type SerieDoKpi,
} from '@fir/contracts'
import {
  type Agregacao,
  agrupamentoPara,
  arredondar,
  baldes,
  CATALOGO_DE_KPIS,
  type ChaveDePermissao,
  type ChaveDoCatalogo,
  type CorteDaMeta,
  diaCivil,
  diasDe,
  diasUteisDoConjunto,
  diasUteisEntre,
  type Direcao,
  exigeValoresParaEscrever,
  type FrequenciaDeKpi,
  janelaComparavel,
  kpiDoCatalogo,
  type MedidaDaMeta,
  type MetaParaConta,
  NumeroDoKpi,
  type PilarDeKpi,
  permissaoDoValor,
  progresso,
  projecao,
  recombinaBaldes,
  referenciaDoPeriodo,
  ritmoEsperado,
  situacao,
  somarDias,
  somarMeses,
  type TipoDeMetaDeKpi,
  type UnidadeDeKpi,
  unidadeDoKpiDoCatalogo,
  validarJanela,
  validarMeta,
  valorAguardando,
  valorNaTela,
  variacao,
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
import { type Ator, pessoaDoAtor } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { VisaoDoMesService } from '../financeiro/visao-do-mes.service'
import { type ContextoDoKpi, FontesDosKpis, type KpiParaMedir, type MedidaDoKpi } from './fontes'

/** O contexto da requisição que a calculadora precisa: `pode` é o `temPerm` do guard. */
export type ContextoDeIndicadores = {
  readonly clinicaId: ClinicaId
  readonly ator: Ator
  readonly fuso: string
  readonly pode: (chave: ChaveDePermissao) => boolean
}

type LinhaDeKpi = {
  id: string
  origem: 'catalogo' | 'manual'
  chave_catalogo: ChaveDoCatalogo | null
  parametros: Record<string, unknown>
  nome: string
  pilar: PilarDeKpi | null
  unidade: UnidadeDeKpi | null
  direcao: Direcao | null
  frequencia: FrequenciaDeKpi
  dia_de_lancamento: number | null
  como_medir: string
  responsavel_id: string | null
  metrica: string | null
}

type LinhaDeMeta = {
  id: string
  kpi_id: string
  tipo: TipoDeMetaDeKpi
  inicio: string
  prazo: string
  alvo_centavos: string | null
  alvo_numero: string | null
  partida_centavos: string | null
  partida_numero: string | null
  medida_por: MedidaDaMeta
  responsavel_id: string | null
}

type Definicao = {
  readonly chave: ChaveDoCatalogo | null
  readonly pilar: PilarDeKpi
  readonly unidade: UnidadeDeKpi
  readonly direcao: Direcao
  readonly agregacao: Agregacao
  readonly admiteNegativo: boolean
  readonly teto: bigint | null
  readonly somenteMesCivil: boolean
  readonly fonte: string | null
}

const SELECT_KPI = `
  SELECT k.id, k.origem, k.chave_catalogo, k.parametros, k.nome, k.pilar, k.unidade, k.direcao,
         k.frequencia, k.dia_de_lancamento, k.como_medir, k.responsavel_id,
         (SELECT cp.metrica FROM campanhas cp
           WHERE cp.clinica_id = k.clinica_id AND cp.id::text = k.parametros->>'campanhaId') AS metrica
    FROM kpis k`

const SELECT_META = `
  SELECT id, kpi_id, tipo, inicio::text AS inicio, prazo::text AS prazo,
         alvo_centavos::text AS alvo_centavos, alvo_numero::text AS alvo_numero,
         partida_centavos::text AS partida_centavos, partida_numero::text AS partida_numero,
         medida_por, responsavel_id
    FROM metas_de_kpi`

function definicaoDe(k: LinhaDeKpi): Definicao {
  if (k.origem === 'manual' || k.chave_catalogo === null) {
    // I-5: KPI manual é sempre `posicao` (o último lançamento do período).
    return {
      chave: null,
      pilar: k.pilar!,
      unidade: k.unidade!,
      direcao: k.direcao!,
      agregacao: 'posicao',
      admiteNegativo: false,
      teto: null,
      somenteMesCivil: false,
      fonte: null,
    }
  }
  const c = kpiDoCatalogo(k.chave_catalogo)
  return {
    chave: c.chave,
    pilar: c.pilar,
    unidade: unidadeDoKpiDoCatalogo(c.chave, k.metrica ?? 'convertidos'),
    direcao: c.direcao,
    agregacao: c.agregacao,
    admiteNegativo: c.admiteNegativo,
    teto: c.teto,
    somenteMesCivil: c.somenteMesCivil,
    fonte: c.fonte,
  }
}

const numeroDe = (u: UnidadeDeKpi, centavos: string | null, numero: string | null): NumeroDoKpi | null => {
  const t = u === 'reais' ? centavos : numero
  return t === null ? null : NumeroDoKpi.de(u, BigInt(t))
}

const paraTexto = (p: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)]))

const codigoPg = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : undefined

/**
 * **A CALCULADORA DE KPI E A LISTAGEM** (spec I-7, I-16 a I-23, I-34).
 *
 * O filtro `permissaoDoValor` mora AQUI e só aqui (appsec C5): `kpisVisiveis`
 * é a única porta por onde um KPI sai, e um KPI sem a permissão do valor não
 * existe na resposta — nem na lista, nem no detalhe (404), nem na série.
 *
 * Nenhum valor em reais sai fora de `ValorNaTela.emDinheiro`; a redação de
 * `valores` é do `RedacaoInterceptor`, num ponto único.
 */
@Injectable()
export class IndicadoresService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(FontesDosKpis) private readonly fontes: FontesDosKpis,
    @Inject(VisaoDoMesService) private readonly visao: VisaoDoMesService,
  ) {}

  private hoje(ctx: ContextoDeIndicadores): string {
    return diaCivil(this.relogio.agora(), ctx.fuso)
  }

  private podeVer(ctx: ContextoDeIndicadores, chave: ChaveDoCatalogo | null): boolean {
    const p = permissaoDoValor(chave)
    return p === null || ctx.pode(p)
  }

  private paraFonte(ctx: ContextoDeIndicadores): ContextoDoKpi {
    return { clinicaId: ctx.clinicaId, ator: ctx.ator, fuso: ctx.fuso, valores: ctx.pode('valores') }
  }

  /* ---------------------------------------------------------------- leitura */

  async catalogo(ctx: ContextoDeIndicadores): Promise<CatalogoDeKpisNaSaida> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const vivos = await c.query<{ id: string; chave: string }>(
        `SELECT id, chave_catalogo AS chave FROM kpis
          WHERE clinica_id = $1 AND origem = 'catalogo' AND parametros = '{}'::jsonb AND arquivado_em IS NULL`,
        [ctx.clinicaId],
      )
      const porChave = new Map(vivos.rows.map((x) => [x.chave, x.id]))
      return {
        itens: CATALOGO_DE_KPIS.filter((k) => this.podeVer(ctx, k.chave)).map((k) => ({
          chave: k.chave,
          nome: k.nome,
          pilar: k.pilar,
          unidade: k.unidade,
          direcao: k.direcao,
          agregacao: k.agregacao,
          frequencias: [...k.frequencias],
          parametros: [...k.parametros],
          fonte: k.fonte,
          somenteMesCivil: k.somenteMesCivil,
          kpiId: porChave.get(k.chave) ?? null,
        })),
      }
    })
  }

  async listar(
    ctx: ContextoDeIndicadores,
    consulta: { de?: string | undefined; ate?: string | undefined; pilar?: PilarDeKpi | undefined; responsavel?: string | undefined },
  ): Promise<ListaDeKpis> {
    const hoje = this.hoje(ctx)
    if (consulta.de !== undefined || consulta.ate !== undefined) {
      const v = validarJanela(consulta.de ?? consulta.ate!, consulta.ate ?? hoje, hoje)
      if (v.tipo === 'erro') throw new UnprocessableEntityException(v.erro.mensagem)
    }
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const kpis = await this.kpisVisiveis(c, ctx, null)
      const itens: KpiNaLista[] = []
      for (const k of kpis) {
        const d = definicaoDe(k)
        if (consulta.pilar !== undefined && d.pilar !== consulta.pilar) continue
        if (consulta.responsavel !== undefined && k.responsavel_id !== consulta.responsavel) continue
        itens.push(await this.cartao(c, ctx, k, hoje, consulta.de, consulta.ate))
      }
      return { hoje, itens }
    })
  }

  async detalhe(ctx: ContextoDeIndicadores, id: string): Promise<DetalheDoKpi> {
    const hoje = this.hoje(ctx)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const k = await this.kpiVisivel(c, ctx, id)
      const cartao = await this.cartao(c, ctx, k, hoje)
      const metas = await c.query<LinhaDeMeta>(
        `${SELECT_META} WHERE clinica_id = $1 AND kpi_id = $2 AND resultado_chave_id IS NULL AND arquivada_em IS NULL
          ORDER BY inicio`,
        [ctx.clinicaId, k.id],
      )
      const d = definicaoDe(k)
      const saida: MetaDeKpiNaSaida[] = []
      for (const m of metas.rows) saida.push(await this.metaNaSaida(c, ctx, k, d, m, hoje))
      return {
        ...cartao,
        comoMedir: k.como_medir,
        diaDeLancamento: k.dia_de_lancamento,
        fonte: d.fonte,
        metas: saida,
      }
    })
  }

  async serie(ctx: ContextoDeIndicadores, id: string, consulta: { de?: string | undefined; ate?: string | undefined }): Promise<SerieDoKpi> {
    const hoje = this.hoje(ctx)
    const ate = consulta.ate ?? hoje
    const de = consulta.de ?? `${somarMeses(`${hoje.slice(0, 7)}-01`, -2).slice(0, 7)}-01`
    const v = validarJanela(de, ate, hoje)
    if (v.tipo === 'erro') throw new UnprocessableEntityException(v.erro.mensagem)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const k = await this.kpiVisivel(c, ctx, id)
      const d = definicaoDe(k)
      const agrupamento = agrupamentoPara(de, ate, k.frequencia)
      const pontos = []
      for (const b of baldes(de, ate, agrupamento, hoje)) {
        // `fim` do balde é EXCLUSIVO; a fonte mede dias civis inclusivos.
        const m = await this.medir(c, ctx, k, d, b.inicio, somarDias(b.fim, -1), hoje)
        // Regra 6 em toda série de dinheiro (c.10): dia aguardando vai SEM valor e sem escala.
        const aberto = agrupamento === 'dia' && m.diasAguardando > 0
        pontos.push({
          inicio: b.inicio,
          fim: somarDias(b.fim, -1),
          parcial: b.parcial,
          diaAguardando: aberto,
          numero: aberto ? valorAguardando(d.unidade) : valorNaTela(d.unidade, m.numero),
        })
      }
      return { kpiId: k.id, agrupamento, barrasSomamOTotal: recombinaBaldes(d.agregacao), pontos }
    })
  }

  /** Prévia D.3 (I-23): números estruturados, nunca a frase (appsec C8). */
  async previa(
    ctx: ContextoDeIndicadores,
    q: { kpiId: string; inicio: string; prazo: string; alvo: string; partida?: string | undefined },
  ): Promise<PreviaDaMeta> {
    const hoje = this.hoje(ctx)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const k = await this.kpiVisivel(c, ctx, q.kpiId)
      const d = definicaoDe(k)
      this.exigirEscritaNaUnidade(ctx, d.unidade)
      const U = BigInt(diasUteisEntre(q.inicio, q.prazo))
      const alvo = BigInt(q.alvo) - BigInt(q.partida ?? '0')
      const ritmo = U === 0n ? null : NumeroDoKpi.de(d.unidade, arredondar({ numerador: alvo, denominador: U }))
      const fim = hoje < q.prazo ? hoje : q.prazo
      let atual: NumeroDoKpi | null = null
      if (fim >= q.inicio) {
        const m = await this.medir(c, ctx, k, d, q.inicio, fim, hoje)
        const dias = typeof m.corte === 'string' ? diasDe(q.inicio, m.corte) : m.corte.dias
        const u = BigInt(diasUteisDoConjunto(dias, q.inicio, q.prazo))
        atual = m.numero === null || u === 0n ? null : NumeroDoKpi.de(d.unidade, arredondar({ numerador: m.numero.emMenorUnidade, denominador: u }))
      }
      return {
        prazo: q.prazo,
        diasUteis: Number(U),
        ritmoPorDiaUtil: valorNaTela(d.unidade, ritmo),
        atualPorDiaUtil: valorNaTela(d.unidade, atual),
      }
    })
  }

  /* ---------------------------------------------------------------- escrita */

  async criarKpi(ctx: ContextoDeIndicadores, dados: CriarKpi): Promise<DetalheDoKpi> {
    const pessoa = pessoaDoAtor(ctx.ator)
    const id = await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      try {
        if (dados.origem === 'manual') {
          if (dados.frequencia === 'semanal' && dados.diaDeLancamento > 7) {
            throw new UnprocessableEntityException('No KPI semanal, o dia de lançamento vai de 1 (segunda) a 7.')
          }
          const r = await c.query<{ id: string }>(
            `INSERT INTO kpis (clinica_id, origem, nome, pilar, unidade, direcao, frequencia, dia_de_lancamento,
                               como_medir, responsavel_id, criado_por)
             VALUES ($1, 'manual', $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [ctx.clinicaId, dados.nome, dados.pilar, dados.unidade, dados.direcao, dados.frequencia,
              dados.diaDeLancamento, dados.comoMedir, dados.responsavelId ?? null, pessoa],
          )
          return r.rows[0]!.id
        }
        const k = kpiDoCatalogo(dados.chave)
        if (!this.podeVer(ctx, k.chave)) throw new ForbiddenException('Sem permissão para este indicador.')
        const p = lerParametrosDoKpi(dados.chave, dados.parametros)
        if (!p.success) throw new UnprocessableEntityException('Parâmetros inválidos para este indicador.')
        const parametros: Record<string, unknown> = p.data
        if (typeof parametros['campanhaId'] === 'string') {
          // O id do corpo é conferido contra a CLÍNICA (appsec C6): de outra clínica, a RLS o esconde.
          const camp = await c.query('SELECT 1 FROM campanhas WHERE clinica_id = $1 AND id = $2', [ctx.clinicaId, parametros['campanhaId']])
          if (camp.rowCount === 0) throw new UnprocessableEntityException('Campanha não encontrada.')
        }
        const frequencia = dados.frequencia ?? k.frequencias.at(-1)!
        if (!(k.frequencias as readonly string[]).includes(frequencia)) {
          throw new UnprocessableEntityException('Frequência que este indicador não tem.')
        }
        const r = await c.query<{ id: string }>(
          `INSERT INTO kpis (clinica_id, origem, chave_catalogo, parametros, nome, frequencia, responsavel_id, criado_por)
           VALUES ($1, 'catalogo', $2, $3::jsonb, $4, $5, $6, $7) RETURNING id`,
          [ctx.clinicaId, k.chave, JSON.stringify(parametros), k.nome, frequencia, dados.responsavelId ?? null, pessoa],
        )
        return r.rows[0]!.id
      } catch (e) {
        throw traduzirErroDoBanco(e, 'Este indicador já existe na clínica.')
      }
    })
    return this.detalhe(ctx, id)
  }

  async editarKpi(ctx: ContextoDeIndicadores, id: string, dados: EditarKpi): Promise<DetalheDoKpi> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const k = await this.kpiVisivel(c, ctx, id)
      try {
        await c.query(
          `UPDATE kpis SET nome = CASE WHEN origem = 'manual' THEN coalesce($3, nome) ELSE nome END,
                           como_medir = coalesce($4, como_medir),
                           responsavel_id = CASE WHEN $5::boolean THEN $6::uuid ELSE responsavel_id END
            WHERE clinica_id = $1 AND id = $2`,
          [ctx.clinicaId, k.id, dados.nome ?? null, dados.comoMedir ?? null, dados.responsavelId !== undefined, dados.responsavelId ?? null],
        )
      } catch (e) {
        throw traduzirErroDoBanco(e, 'Conflito ao editar o indicador.')
      }
    })
    return this.detalhe(ctx, id)
  }

  async arquivarKpi(ctx: ContextoDeIndicadores, id: string): Promise<{ arquivado: true }> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const k = await this.kpiVisivel(c, ctx, id)
      await c.query('UPDATE metas_de_kpi SET arquivada_em = now() WHERE clinica_id = $1 AND kpi_id = $2 AND arquivada_em IS NULL', [ctx.clinicaId, k.id])
      await c.query('UPDATE kpis SET arquivado_em = now() WHERE clinica_id = $1 AND id = $2 AND arquivado_em IS NULL', [ctx.clinicaId, k.id])
    })
    return { arquivado: true }
  }

  async criarMeta(ctx: ContextoDeIndicadores, dados: CriarMetaDeKpi): Promise<MetaDeKpiNaSaida> {
    const hoje = this.hoje(ctx)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const k = await this.kpiVisivel(c, ctx, dados.kpiId)
      const d = definicaoDe(k)
      this.exigirEscritaNaUnidade(ctx, d.unidade)
      const partida = NumeroDoKpi.de(d.unidade, BigInt(dados.partida ?? '0'))
      const alvo = NumeroDoKpi.de(d.unidade, BigInt(dados.alvo))
      const v = validarMeta(d, { tipo: dados.tipo, inicio: dados.inicio, prazo: dados.prazo, partida, alvo })
      if (v.tipo === 'erro') throw new UnprocessableEntityException(v.erro.mensagem)
      const medidaPor = d.chave === 'faturamento_conferido' ? await this.visao.medidaPadrao(c, ctx) : 'fir'
      const emReais = d.unidade === 'reais'
      try {
        const r = await c.query<LinhaDeMeta>(
          `INSERT INTO metas_de_kpi (clinica_id, kpi_id, tipo, inicio, prazo, alvo_centavos, alvo_numero,
                                     partida_centavos, partida_numero, responsavel_id, medida_por, definida_por)
           VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id, kpi_id, tipo, inicio::text AS inicio, prazo::text AS prazo,
                     alvo_centavos::text AS alvo_centavos, alvo_numero::text AS alvo_numero,
                     partida_centavos::text AS partida_centavos, partida_numero::text AS partida_numero,
                     medida_por, responsavel_id`,
          [ctx.clinicaId, k.id, dados.tipo, dados.inicio, dados.prazo,
            emReais ? dados.alvo : null, emReais ? null : dados.alvo,
            emReais ? partida.emMenorUnidade.toString() : null, emReais ? null : partida.emMenorUnidade.toString(),
            dados.responsavelId ?? null, medidaPor, pessoaDoAtor(ctx.ator)],
        )
        return await this.metaNaSaida(c, ctx, k, d, r.rows[0]!, hoje)
      } catch (e) {
        throw traduzirErroDoBanco(e, 'Já existe uma meta viva deste indicador nesse período; edite-a.')
      }
    })
  }

  async editarMeta(ctx: ContextoDeIndicadores, id: string, dados: EditarMetaDeKpi): Promise<MetaDeKpiNaSaida> {
    const hoje = this.hoje(ctx)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const atual = await this.metaDaClinica(c, ctx, id)
      const k = await this.kpiVisivel(c, ctx, atual.kpi_id)
      const d = definicaoDe(k)
      this.exigirEscritaNaUnidade(ctx, d.unidade)
      const emReais = d.unidade === 'reais'
      const alvo = NumeroDoKpi.de(d.unidade, BigInt(dados.alvo ?? (emReais ? atual.alvo_centavos : atual.alvo_numero)!))
      const partida = NumeroDoKpi.de(
        d.unidade,
        BigInt(dados.partida ?? (emReais ? atual.partida_centavos : atual.partida_numero) ?? '0'),
      )
      const prazo = dados.prazo ?? atual.prazo
      const v = validarMeta(d, { tipo: atual.tipo, inicio: atual.inicio, prazo, partida, alvo })
      if (v.tipo === 'erro') throw new UnprocessableEntityException(v.erro.mensagem)
      try {
        await c.query(
          `UPDATE metas_de_kpi SET alvo_centavos = $3, alvo_numero = $4, partida_centavos = $5, partida_numero = $6,
                  prazo = $7::date, responsavel_id = CASE WHEN $8::boolean THEN $9::uuid ELSE responsavel_id END,
                  definida_por = $10, definida_em = now()
            WHERE clinica_id = $1 AND id = $2`,
          [ctx.clinicaId, id,
            emReais ? alvo.emMenorUnidade.toString() : null, emReais ? null : alvo.emMenorUnidade.toString(),
            emReais ? partida.emMenorUnidade.toString() : null, emReais ? null : partida.emMenorUnidade.toString(),
            prazo, dados.responsavelId !== undefined, dados.responsavelId ?? null, pessoaDoAtor(ctx.ator)],
        )
      } catch (e) {
        throw traduzirErroDoBanco(e, 'Já existe uma meta viva deste indicador nesse período; edite-a.')
      }
      return this.metaNaSaida(c, ctx, k, d, await this.metaDaClinica(c, ctx, id), hoje)
    })
  }

  async arquivarMeta(ctx: ContextoDeIndicadores, id: string): Promise<{ arquivada: true }> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const m = await this.metaDaClinica(c, ctx, id)
      await this.kpiVisivel(c, ctx, m.kpi_id)
      await c.query('UPDATE metas_de_kpi SET arquivada_em = now() WHERE clinica_id = $1 AND id = $2 AND arquivada_em IS NULL', [ctx.clinicaId, id])
    })
    return { arquivada: true }
  }

  /* ------------------------------------------------------------- internos */

  /** C3 (appsec): alvo ou partida em reais exige `valores` — 403, antes de qualquer conta. */
  private exigirEscritaNaUnidade(ctx: ContextoDeIndicadores, unidade: UnidadeDeKpi): void {
    if (exigeValoresParaEscrever(unidade) && !ctx.pode('valores')) {
      throw new ForbiddenException('Definir valor em reais exige a permissão de ver valores.')
    }
  }

  /** A ÚNICA porta de saída de KPI (appsec C5): sem a permissão do valor, o KPI não existe. */
  private async kpisVisiveis(c: pg.PoolClient, ctx: ContextoDeIndicadores, id: string | null): Promise<LinhaDeKpi[]> {
    const r = await c.query<LinhaDeKpi>(
      `${SELECT_KPI} WHERE k.clinica_id = $1 AND k.arquivado_em IS NULL AND ($2::uuid IS NULL OR k.id = $2::uuid)
        ORDER BY k.criado_em, k.id`,
      [ctx.clinicaId, id],
    )
    return r.rows.filter((k) => this.podeVer(ctx, k.chave_catalogo))
  }

  private async kpiVisivel(c: pg.PoolClient, ctx: ContextoDeIndicadores, id: string): Promise<LinhaDeKpi> {
    const k = (await this.kpisVisiveis(c, ctx, id))[0]
    if (k === undefined) throw new NotFoundException('Indicador não encontrado.')
    return k
  }

  private async metaDaClinica(c: pg.PoolClient, ctx: ContextoDeIndicadores, id: string): Promise<LinhaDeMeta> {
    const r = await c.query<LinhaDeMeta>(`${SELECT_META} WHERE clinica_id = $1 AND id = $2 AND arquivada_em IS NULL`, [ctx.clinicaId, id])
    const m = r.rows[0]
    if (m === undefined) throw new NotFoundException('Meta não encontrada.')
    return m
  }

  private async medir(
    c: pg.PoolClient,
    ctx: ContextoDeIndicadores,
    k: LinhaDeKpi,
    d: Definicao,
    de: string,
    ate: string,
    hoje: string,
    medidaPor: MedidaDaMeta = 'fir',
  ): Promise<MedidaDoKpi> {
    const fim = ate < hoje ? ate : hoje
    if (d.chave === null) {
      // I-5: o último lançamento com referência no período.
      const r = await c.query<{ c: string | null; n: string | null }>(
        `SELECT valor_centavos::text AS c, valor_numero::text AS n FROM lancamentos_de_kpi
          WHERE clinica_id = $1 AND kpi_id = $2 AND referencia BETWEEN $3::date AND $4::date
          ORDER BY referencia DESC LIMIT 1`,
        [ctx.clinicaId, k.id, de, fim],
      )
      const l = r.rows[0]
      return { numero: l === undefined ? null : numeroDe(d.unidade, l.c, l.n), diasAguardando: 0, corte: fim }
    }
    const paraMedir: KpiParaMedir = { id: k.id, chave: d.chave, parametros: paraTexto(k.parametros), unidade: d.unidade, medidaPor }
    const m = await this.fontes.medir(c, this.paraFonte(ctx), paraMedir, { de, ate, hoje })
    if (m.numero !== null && !d.admiteNegativo && m.numero.emMenorUnidade < 0n) {
      // c.16: valor de fonte fora do domínio NÃO é escondido por um `max`. Incidente
      // no log (só o id do KPI e a chave, nunca o valor) e `null` com motivo.
      console.warn(`[indicadores] fonte_fora_do_dominio kpi=${k.id} chave=${d.chave}`)
      return { ...m, numero: null }
    }
    return m
  }

  private async cartao(
    c: pg.PoolClient,
    ctx: ContextoDeIndicadores,
    k: LinhaDeKpi,
    hoje: string,
    deConsulta?: string,
    ateConsulta?: string,
  ): Promise<KpiNaLista> {
    const d = definicaoDe(k)
    const ate = ateConsulta ?? hoje
    const de = deConsulta ?? referenciaDoPeriodo(d.somenteMesCivil ? 'mensal' : k.frequencia, ate)
    const metas = await c.query<LinhaDeMeta>(
      `${SELECT_META} WHERE clinica_id = $1 AND kpi_id = $2 AND resultado_chave_id IS NULL AND arquivada_em IS NULL
          AND inicio <= $3::date AND prazo >= $3::date LIMIT 1`,
      [ctx.clinicaId, k.id, hoje],
    )
    const vigente = metas.rows[0] ?? null
    const medidaPor = vigente?.medida_por ?? 'fir'
    const m = await this.medir(c, ctx, k, d, de, ate, hoje, medidaPor)
    const meta = vigente === null ? null : await this.metaNaSaida(c, ctx, k, d, vigente, hoje)
    const alvo = vigente === null ? null : numeroDe(d.unidade, vigente.alvo_centavos, vigente.alvo_numero)

    let anterior: NumeroDoKpi | null = null
    const comparavel = janelaComparavel(diasDe(de, ate < hoje ? ate : hoje), k.frequencia)
    // `resultado_do_mes` só compara mês FECHADO com mês fechado (números c.4).
    const comparaResultado = d.chave !== 'resultado_do_mes' || ate.slice(0, 7) < hoje.slice(0, 7)
    if (comparavel.length > 0 && comparaResultado) {
      const fimAnt = comparavel.at(-1)!
      if (d.agregacao === 'posicao' && d.chave !== null) {
        const f = await c.query<{ c: string | null; n: string | null }>(
          `SELECT valor_centavos::text AS c, valor_numero::text AS n FROM fotografias_de_kpi
            WHERE clinica_id = $1 AND kpi_id = $2 AND dia = $3::date`,
          [ctx.clinicaId, k.id, fimAnt],
        )
        const l = f.rows[0]
        anterior = l === undefined ? null : numeroDe(d.unidade, l.c, l.n)
      } else {
        anterior = (await this.medir(c, ctx, k, d, comparavel[0]!, fimAnt, hoje, medidaPor)).numero
      }
    }
    const v = variacao(m.numero, anterior)
    return {
      id: k.id,
      origem: k.origem,
      chave: d.chave,
      nome: k.nome,
      pilar: d.pilar,
      unidade: d.unidade,
      direcao: d.direcao,
      agregacao: d.agregacao,
      frequencia: k.frequencia,
      parametros: paraTexto(k.parametros),
      responsavelId: k.responsavel_id,
      periodo: { de, ate },
      atual: valorNaTela(d.unidade, m.numero, alvo),
      anterior: anterior === null ? null : valorNaTela(d.unidade, anterior),
      variacao:
        v === null
          ? null
          : v.tipo === 'pontos'
            ? { tipo: 'pontos', emCentesimos: v.emCentesimos.toString() }
            : v.tipo === 'relativa'
              ? { tipo: 'relativa', percentual: v.percentual }
              : { tipo: 'novo' },
      diasAguardando: m.diasAguardando,
      motivoSemValor: null,
      metaVigente: meta,
    }
  }

  private async metaNaSaida(
    c: pg.PoolClient,
    ctx: ContextoDeIndicadores,
    k: LinhaDeKpi,
    d: Definicao,
    l: LinhaDeMeta,
    hoje: string,
  ): Promise<MetaDeKpiNaSaida> {
    const alvo = numeroDe(d.unidade, l.alvo_centavos, l.alvo_numero)!
    const partida = numeroDe(d.unidade, l.partida_centavos, l.partida_numero) ?? NumeroDoKpi.zero(d.unidade)
    const meta: MetaParaConta = { agregacao: d.agregacao, direcao: d.direcao, inicio: l.inicio, prazo: l.prazo, partida, alvo }
    const fim = l.prazo < hoje ? l.prazo : hoje
    // I-18: `soma` mede `[início, corte]`; as outras, o período corrente do cartão.
    const de = d.agregacao === 'soma' ? l.inicio : referenciaDoPeriodo(d.somenteMesCivil ? 'mensal' : k.frequencia, fim)
    const futura = fim < l.inicio
    const m: MedidaDoKpi = futura
      ? { numero: null, diasAguardando: 0, corte: somarDias(l.inicio, -1) }
      : await this.medir(c, ctx, k, d, de < l.inicio ? l.inicio : de, fim, hoje, l.medida_por)
    const corte: CorteDaMeta = m.corte
    const p = projecao(meta, m.numero, corte, { admiteNegativo: d.admiteNegativo, teto: d.teto })
    const ritmo = ritmoEsperado(meta, corte)
    return {
      id: l.id,
      kpiId: l.kpi_id,
      tipo: l.tipo,
      inicio: l.inicio,
      prazo: l.prazo,
      alvo: valorNaTela(d.unidade, alvo),
      partida: valorNaTela(d.unidade, partida),
      medidaPor: l.medida_por,
      responsavelId: l.responsavel_id,
      atual: valorNaTela(d.unidade, m.numero, alvo),
      ritmo: valorNaTela(d.unidade, NumeroDoKpi.de(d.unidade, arredondar(ritmo))),
      situacao: situacao(meta, m.numero, corte, hoje),
      progresso: progresso(meta, m.numero, corte),
      projecao: p.valor === null ? null : valorNaTela(d.unidade, p.valor, alvo),
      motivoSemProjecao: p.motivo,
    }
  }
}

/** Erros do banco que são do USUÁRIO viram 4xx; o resto sobe. */
function traduzirErroDoBanco(e: unknown, mensagemDeConflito: string): unknown {
  const codigo = codigoPg(e)
  if (codigo === '23505' || codigo === '23P01') return new ConflictException(mensagemDeConflito)
  if (codigo === '23503') return new UnprocessableEntityException('Responsável ou referência que não é desta clínica.')
  if (codigo === '23514') return new UnprocessableEntityException('Valor fora do permitido.')
  return e
}

