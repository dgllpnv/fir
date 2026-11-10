import type {
  CriarMetaDoClienteEntrada,
  EditarMetaDoClienteEntrada,
  LancamentoSemanalDeMetasEntrada,
  LancamentoSemanalDeMetasSaida,
  MetaAvaliada,
  MetasDoClienteSaida,
  PainelDeMetasSaida,
  UnidadeDeIndicadorCarteira,
} from '@fir/contracts'
import {
  FRENTES_DA_PLANILHA,
  PLANILHA_DE_INDICADORES,
  diaCivil,
  lerFonteDaPlanilha,
  metricaDaFrente,
  saudeDerivadaDoCliente,
  segundaDaSemana,
  semanaDaReuniao,
  somarDias,
  validarModeloDeMeta,
  type SaudeDoCliente,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
import { umPorClinica } from '../um-por-clinica'
import { gravarAuditoriaDaCarteira } from './auditoria-da-carteira'
import { PESO_DO_DETALHE, SELECT_META, avaliarMetas, carregarContexto, rotuloDaFonte, type LinhaDaMeta } from './metas-avaliacao'
import {
  EntradaInvalidaNaMeta,
  NaoEncontradoNaMeta,
  type Sessao,
  clienteDaMeta,
  equipeDoGrupo,
  exigirSegunda,
  exigirValores,
  valorDaUnidade,
} from './metas-comum'

type IndicadorDb = { id: string; nome: string; unidade: UnidadeDeIndicadorCarteira; sentido: 'maior_melhor' | 'menor_melhor' }

const AGREGACAO_DA_PLANILHA = [
  ['ultima', 'última semana'],
  ['media4', 'média de 4 semanas'],
  ['soma4', 'soma de 4 semanas'],
] as const

/**
 * **G8 2B — metas completas** (M1–M4, M6; `vMetas`, `cPlano`,
 * `abrirLancamentoMetas`, `F.meta`).
 *
 * Toda leitura e escrita como o `Usuário de Gestão` da sessão
 * (`nasTabelasDaCarteiraComoUsuarioDeGestao`): a RLS por grupo é a primeira
 * camada, e o filtro explícito por cliente/grupo a segunda (regra 19). A
 * avaliação é do domínio (`avaliarMeta`, racional exato); este serviço só
 * escolhe o recorte e grava.
 */
@Injectable()
export class MetasDoClienteService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  private hoje(): string {
    return diaCivil(this.relogio.agora(), FUSO_DA_CARTEIRA)
  }

  private async avaliar(c: pg.PoolClient, linhas: readonly LinhaDaMeta[]): Promise<MetaAvaliada[]> {
    const agora = this.relogio.agora()
    return avaliarMetas(linhas, await carregarContexto(c, linhas, agora, FUSO_DA_CARTEIRA))
  }

  // -------------------------------------------------------------------------
  // M1 — Painel de metas
  // -------------------------------------------------------------------------

  async painel(sessao: Sessao, responsavelId: string | null): Promise<PainelDeMetasSaida> {
    const grupo = sessao.escopo === 'geral' ? null : sessao.grupoId
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      // `ativos()` do protótipo (L1120): ativo ou onboarding.
      const clientes = await c.query<{
        id: string
        nome: string
        produto: string
        area_foco: string | null
        responsavel_nome: string | null
        clinica_id: string | null
        conta_na_receita: boolean
      }>(
        `SELECT cl.id, cl.nome, cl.produto, cl.area_foco, u.nome AS responsavel_nome,
                cl.clinica_id, cl.conta_na_receita
           FROM clientes_carteira cl
           LEFT JOIN usuarios_gestao u ON u.id = cl.responsavel_usuario_gestao_id
          WHERE cl.excluido_em IS NULL AND cl.status IN ('ativo', 'onboarding')
            AND ($1::uuid IS NULL OR cl.grupo_id = $1::uuid)
            AND ($2::uuid IS NULL OR cl.responsavel_usuario_gestao_id = $2::uuid)
          ORDER BY cl.nome`,
        [grupo, responsavelId],
      )
      // A clínica em 2+ grupos aparece uma vez só no `geral` (0068): fica o cliente que paga.
      const lista = umPorClinica(clientes.rows)
      const ids = lista.map((x) => x.id)
      const linhas =
        ids.length === 0
          ? []
          : (
              await c.query<LinhaDaMeta>(
                `${SELECT_META}
                  WHERE m.cliente_carteira_id = ANY($1) AND m.excluido_em IS NULL AND m.status <> 'cancelada'
                  ORDER BY m.criado_em`,
                [ids],
              )
            ).rows
      const avaliadas = await this.avaliar(c, linhas)
      const saudes = await this.saudes(c, ids)

      const contagens = { abaixo: 0, atencao: 0, noRitmo: 0, atingida: 0, semLancamento: 0 }
      for (const m of avaliadas) {
        const d = m.avaliacao.detalhe
        if (d === 'abaixo_do_ritmo' || d === 'prazo_vencido') contagens.abaixo++
        else if (d === 'atencao') contagens.atencao++
        else if (d === 'no_ritmo') contagens.noRitmo++
        else if (d === 'atingida' || d === 'na_meta') contagens.atingida++
        else if (d === 'sem_lancamento') contagens.semLancamento++
      }

      const porPeso = (a: MetaAvaliada, b: MetaAvaliada) => PESO_DO_DETALHE[a.avaliacao.detalhe] - PESO_DO_DETALHE[b.avaliacao.detalhe]
      const grupos = lista
        .map((cl) => {
          const metas = avaliadas.filter((m) => m.clienteCarteiraId === cl.id).sort(porPeso)
          return {
            id: cl.id,
            nome: cl.nome,
            produto: cl.produto,
            areaFoco: cl.area_foco,
            responsavelNome: cl.responsavel_nome,
            saude: saudes.get(cl.id) ?? null,
            metas,
            podeLancar: metas.some((m) => m.fonte === 'lancamento'),
          }
        })
        .filter((g) => g.metas.length > 0)
      // L814: o cliente cuja pior meta é a pior vem primeiro.
      const pior = (g: { metas: MetaAvaliada[] }) => (g.metas[0] ? PESO_DO_DETALHE[g.metas[0].avaliacao.detalhe] : 9)
      grupos.sort((a, b) => pior(a) - pior(b))

      return {
        hoje: this.hoje(),
        clientes: grupos,
        semMeta: lista.filter((cl) => !linhas.some((m) => m.cliente_carteira_id === cl.id)).map((cl) => ({ id: cl.id, nome: cl.nome })),
        contagens,
        responsaveis: await equipeDoGrupo(c, grupo),
      }
    })
  }

  /** `Saúde do cliente` derivada do checkin ou da ata mais recente (mesma regra da ficha). */
  private async saudes(c: pg.PoolClient, ids: readonly string[]): Promise<Map<string, SaudeDoCliente | null>> {
    const mapa = new Map<string, SaudeDoCliente | null>()
    if (ids.length === 0) return mapa
    const r = await c.query<{ cliente_carteira_id: string; em: Date; saude: SaudeDoCliente | null }>(
      `SELECT cliente_carteira_id, atualizado_em AS em, saude FROM checkins_internos WHERE cliente_carteira_id = ANY($1)
       UNION ALL
       SELECT cliente_carteira_id, coalesce(atualizado_em, criado_em), saude_registrada
         FROM reunioes_comerciais WHERE cliente_carteira_id = ANY($1) AND arquivada_em IS NULL`,
      [ids],
    )
    for (const id of ids) {
      mapa.set(
        id,
        saudeDerivadaDoCliente(r.rows.filter((x) => x.cliente_carteira_id === id).map((x) => ({ em: x.em.toISOString(), saude: x.saude }))),
      )
    }
    return mapa
  }

  // -------------------------------------------------------------------------
  // Metas de um cliente (cPlano)
  // -------------------------------------------------------------------------

  async doCliente(sessao: Sessao, clienteId: string): Promise<MetasDoClienteSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDaMeta(c, clienteId)
      const linhas = await c.query<LinhaDaMeta>(
        `${SELECT_META} WHERE m.cliente_carteira_id = $1 AND m.excluido_em IS NULL ORDER BY m.criado_em`,
        [cliente.id],
      )
      const indicadores = await this.indicadores(c, cliente.id)
      const temPlanilha = await c.query('SELECT 1 FROM planilhas_do_cliente WHERE cliente_carteira_id = $1', [cliente.id])
      const dia = await c.query<{ reuniao_dia_semana: number | null }>(
        'SELECT reuniao_dia_semana FROM clientes_carteira WHERE id = $1',
        [cliente.id],
      )
      const hoje = this.hoje()
      const seg = segundaDaSemana(hoje)

      // `fontesMeta` (L730-735): lançamento; a planilha, se ligada; os indicadores.
      const fontes: MetasDoClienteSaida['fontes'] = [{ fonte: 'lancamento', rotulo: rotuloDaFonte('lancamento', null), unidade: null }]
      if ((temPlanilha.rowCount ?? 0) > 0) {
        for (const f of FRENTES_DA_PLANILHA) {
          for (const met of PLANILHA_DE_INDICADORES[f].metricas) {
            for (const [ag] of AGREGACAO_DA_PLANILHA) {
              if (met.unidade === '%' && ag === 'soma4') continue // ajuste 19: percentual não soma
              const fonte = `pl:${f}|${met.chave}|${ag}`
              fontes.push({ fonte, rotulo: rotuloDaFonte(fonte, null), unidade: met.unidade })
            }
          }
        }
      }
      for (const i of indicadores) fontes.push({ fonte: `ind:${i.id}`, rotulo: rotuloDaFonte(`ind:${i.id}`, i.nome), unidade: i.unidade })

      return {
        hoje,
        semanaDaReuniao: semanaDaReuniao(hoje, dia.rows[0]?.reuniao_dia_semana ?? 1),
        semanasParaLancar: [0, 1, 2, 3, 4].map((k) => somarDias(seg, -7 * k)),
        metas: await this.avaliar(c, linhas.rows),
        indicadores,
        fontes,
      }
    })
  }

  private async indicadores(c: pg.PoolClient, clienteId: string): Promise<IndicadorDb[]> {
    const r = await c.query<IndicadorDb>(
      `SELECT id, nome, unidade, sentido FROM indicadores_carteira
        WHERE cliente_carteira_id = $1 AND excluido_em IS NULL ORDER BY criado_em`,
      [clienteId],
    )
    return r.rows
  }

  /**
   * A fonte, conferida contra o cliente e a unidade (ajuste 20): outro
   * indicador só do MESMO cliente e da MESMA unidade; métrica da planilha só
   * de unidade igual, e nunca soma de percentual (ajuste 19).
   */
  private async conferirFonte(
    c: pg.PoolClient,
    clienteId: string,
    unidade: string,
    fonte: string,
  ): Promise<{ fonte: 'lancamento' | 'indicador' | 'planilha'; indicadorId: string | null; planilha: string | null }> {
    if (fonte === 'lancamento') return { fonte: 'lancamento', indicadorId: null, planilha: null }
    if (fonte.startsWith('ind:')) {
      const id = fonte.slice(4)
      const r = await c.query<{ unidade: string }>(
        'SELECT unidade FROM indicadores_carteira WHERE id = $1 AND cliente_carteira_id = $2 AND excluido_em IS NULL',
        [id, clienteId],
      )
      if (!r.rows[0]) throw new EntradaInvalidaNaMeta('FONTE_INVALIDA', 'Esse indicador não é desta cliente.')
      if (r.rows[0].unidade !== unidade) {
        throw new EntradaInvalidaNaMeta('FONTE_DE_OUTRA_UNIDADE', 'A fonte precisa ter a mesma unidade da meta.')
      }
      return { fonte: 'indicador', indicadorId: id, planilha: null }
    }
    const pl = lerFonteDaPlanilha(fonte)
    const metrica = pl === null ? null : metricaDaFrente(pl.frente, pl.metrica)
    if (pl === null || metrica === null) throw new EntradaInvalidaNaMeta('FONTE_INVALIDA', 'Essa métrica não existe na planilha.')
    if (metrica.unidade !== unidade) {
      throw new EntradaInvalidaNaMeta('FONTE_DE_OUTRA_UNIDADE', 'A fonte precisa ter a mesma unidade da meta.')
    }
    if (metrica.unidade === '%' && pl.agregacao === 'soma4') {
      throw new EntradaInvalidaNaMeta('PERCENTUAL_NAO_SOMA', 'Percentual não se soma: use a última semana ou a média de 4.')
    }
    return { fonte: 'planilha', indicadorId: null, planilha: `pl:${pl.frente}|${metrica.chave}|${pl.agregacao}` }
  }

  private conferirModelo(unidade: string, tipo: 'mensal' | 'prazo', agregacao: 'soma' | 'media' | 'ultimo', inicial: string | null): void {
    // `as`: a unidade veio de `indicadores_carteira.unidade`, CHECK do banco no mesmo conjunto.
    const r = validarModeloDeMeta({ unidade: unidade as 'R$', tipo, agregacao, valorInicial: inicial === null ? null : BigInt(inicial) })
    if (r.tipo === 'erro') throw new EntradaInvalidaNaMeta(r.erro.codigo, r.erro.mensagem)
  }

  private async lerUma(c: pg.PoolClient, metaId: string): Promise<MetaAvaliada> {
    const r = await c.query<LinhaDaMeta>(`${SELECT_META} WHERE m.id = $1`, [metaId])
    const [m] = await this.avaliar(c, r.rows)
    if (!m) throw new NaoEncontradoNaMeta()
    return m
  }

  async criar(sessao: Sessao, clienteId: string, dto: CriarMetaDoClienteEntrada): Promise<MetaAvaliada> {
    exigirValores(sessao, dto.valorMeta != null || dto.valorInicial != null)
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDaMeta(c, clienteId)
      let indicador: IndicadorDb
      if (dto.indicadorId) {
        const r = await c.query<IndicadorDb>(
          `SELECT id, nome, unidade, sentido FROM indicadores_carteira
            WHERE id = $1 AND cliente_carteira_id = $2 AND excluido_em IS NULL`,
          [dto.indicadorId, cliente.id],
        )
        if (!r.rows[0]) throw new EntradaInvalidaNaMeta('INDICADOR_INVALIDO', 'Esse indicador não é desta cliente.')
        indicador = r.rows[0]
      } else {
        // `novoIndicador` — o refine do contrato garante um dos dois.
        const novo = dto.novoIndicador!
        const r = await c.query<IndicadorDb>(
          `INSERT INTO indicadores_carteira (cliente_carteira_id, grupo_id, nome, unidade, sentido)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, nome, unidade, sentido`,
          [cliente.id, cliente.grupo_id, novo.nome, novo.unidade, dto.sentido],
        )
        indicador = r.rows[0]!
        await gravarAuditoriaDaCarteira(c, {
          usuarioGestaoId: sessao.id,
          grupoId: cliente.grupo_id,
          tabela: 'indicadores_carteira',
          registroId: indicador.id,
          acao: 'criar',
          de: null,
          para: indicador,
        })
      }
      const alvo = valorDaUnidade(indicador.unidade, dto.valorMeta, dto.valorMetaInteiro)
      const inicial =
        dto.valorInicial == null && dto.valorInicialInteiro == null
          ? { centavos: null, inteiro: null }
          : valorDaUnidade(indicador.unidade, dto.valorInicial, dto.valorInicialInteiro)
      this.conferirModelo(indicador.unidade, dto.tipo, dto.agregacao, inicial.centavos ?? inicial.inteiro)
      const fonte = await this.conferirFonte(c, cliente.id, indicador.unidade, dto.fonte)

      const r = await c.query<{ id: string }>(
        `INSERT INTO metas_comerciais
           (cliente_carteira_id, grupo_id, indicador_id, titulo, sentido, tipo, agregacao, fonte, fonte_indicador_id,
            fonte_planilha, valor_meta_centavos, valor_meta_inteiro, valor_inicial_centavos, valor_inicial_inteiro,
            inicio, prazo, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          cliente.id,
          cliente.grupo_id,
          indicador.id,
          dto.titulo,
          dto.sentido,
          dto.tipo,
          dto.agregacao,
          fonte.fonte,
          fonte.indicadorId,
          fonte.planilha,
          alvo.centavos,
          alvo.inteiro,
          inicial.centavos,
          inicial.inteiro,
          dto.inicio,
          dto.prazo,
          dto.status ?? 'em_andamento',
        ],
      )
      const nova = r.rows[0]!
      await gravarAuditoriaDaCarteira(c, {
        usuarioGestaoId: sessao.id,
        grupoId: cliente.grupo_id,
        tabela: 'metas_comerciais',
        registroId: nova.id,
        acao: 'criar',
        de: null,
        para: nova,
      })
      return this.lerUma(c, nova.id)
    })
  }

  /**
   * Editar (`data-edit-meta`). Ausente não muda; `null` em campo monetário
   * NUNCA apaga (A-6 — o formulário de quem não tem `valores` reenvia o alvo
   * redigido como `null`). O indicador da meta não muda: a unidade é dele.
   */
  async editar(sessao: Sessao, clienteId: string, metaId: string, dto: EditarMetaDoClienteEntrada): Promise<MetaAvaliada> {
    exigirValores(sessao, dto.valorMeta != null || dto.valorInicial != null)
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDaMeta(c, clienteId)
      const atual = await c.query<Record<string, unknown> & {
        id: string
        unidade: string
        tipo: 'mensal' | 'prazo'
        agregacao: 'soma' | 'media' | 'ultimo'
        fonte: 'lancamento' | 'indicador' | 'planilha'
        fonte_indicador_id: string | null
        fonte_planilha: string | null
        valor_meta_centavos: string | null
        valor_meta_inteiro: string | null
        valor_inicial_centavos: string | null
        valor_inicial_inteiro: string | null
        inicio: string
        prazo: string | null
      }>(
        `SELECT m.*, m.inicio::text AS inicio, m.prazo::text AS prazo,
                m.valor_meta_centavos::text AS valor_meta_centavos, m.valor_meta_inteiro::text AS valor_meta_inteiro,
                m.valor_inicial_centavos::text AS valor_inicial_centavos, m.valor_inicial_inteiro::text AS valor_inicial_inteiro,
                i.unidade
           FROM metas_comerciais m JOIN indicadores_carteira i ON i.id = m.indicador_id
          WHERE m.id = $1 AND m.cliente_carteira_id = $2 AND m.excluido_em IS NULL
          FOR UPDATE OF m`,
        [metaId, cliente.id],
      )
      const m = atual.rows[0]
      if (!m) throw new NaoEncontradoNaMeta()

      const tipo = dto.tipo ?? m.tipo
      const agregacao = dto.agregacao ?? m.agregacao
      const inicio = dto.inicio ?? m.inicio
      const prazo = dto.prazo === undefined ? m.prazo : dto.prazo
      if (prazo !== null && prazo < inicio) throw new EntradaInvalidaNaMeta('PRAZO_ANTES_DO_INICIO', 'O prazo vem depois do início.')
      if (tipo === 'prazo' && prazo === null) throw new EntradaInvalidaNaMeta('PRAZO_OBRIGATORIO', 'Meta com prazo precisa da data final.')

      let alvo = { centavos: m.valor_meta_centavos, inteiro: m.valor_meta_inteiro }
      if (dto.valorMeta != null || dto.valorMetaInteiro != null) alvo = valorDaUnidade(m.unidade, dto.valorMeta, dto.valorMetaInteiro)
      let inicial = { centavos: m.valor_inicial_centavos, inteiro: m.valor_inicial_inteiro }
      if (dto.valorInicial != null || dto.valorInicialInteiro != null) {
        inicial = valorDaUnidade(m.unidade, dto.valorInicial, dto.valorInicialInteiro)
      } else if (dto.valorInicialInteiro === null && m.unidade !== 'R$') {
        inicial = { centavos: null, inteiro: null } // limpar o inicial NÃO monetário é permitido
      }
      this.conferirModelo(m.unidade, tipo, agregacao, inicial.centavos ?? inicial.inteiro)
      const fonteAtual =
        m.fonte === 'indicador' ? `ind:${m.fonte_indicador_id}` : m.fonte === 'planilha' ? (m.fonte_planilha ?? 'lancamento') : 'lancamento'
      const fonte = await this.conferirFonte(c, cliente.id, m.unidade, dto.fonte ?? fonteAtual)

      const r = await c.query(
        `UPDATE metas_comerciais SET
           titulo = coalesce($2, titulo), sentido = coalesce($3, sentido), tipo = $4, agregacao = $5,
           fonte = $6, fonte_indicador_id = $7, fonte_planilha = $8,
           valor_meta_centavos = $9, valor_meta_inteiro = $10, valor_inicial_centavos = $11, valor_inicial_inteiro = $12,
           inicio = $13, prazo = $14, status = coalesce($15, status), atualizado_em = now()
         WHERE id = $1
         RETURNING *`,
        [
          m.id,
          dto.titulo ?? null,
          dto.sentido ?? null,
          tipo,
          agregacao,
          fonte.fonte,
          fonte.indicadorId,
          fonte.planilha,
          alvo.centavos,
          alvo.inteiro,
          inicial.centavos,
          inicial.inteiro,
          inicio,
          prazo,
          dto.status ?? null,
        ],
      )
      await gravarAuditoriaDaCarteira(c, {
        usuarioGestaoId: sessao.id,
        grupoId: cliente.grupo_id,
        tabela: 'metas_comerciais',
        registroId: m.id,
        acao: 'atualizar',
        de: m,
        para: r.rows[0],
      })
      return this.lerUma(c, m.id)
    })
  }

  /** "Excluir" (L2867) vira soft delete (regra 20): a meta sai das telas, a linha e a trilha ficam. */
  async excluir(sessao: Sessao, clienteId: string, metaId: string): Promise<void> {
    await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDaMeta(c, clienteId)
      const r = await c.query(
        `UPDATE metas_comerciais SET excluido_em = now(), atualizado_em = now()
          WHERE id = $1 AND cliente_carteira_id = $2 AND excluido_em IS NULL
          RETURNING id, excluido_em`,
        [metaId, cliente.id],
      )
      if (!r.rows[0]) throw new NaoEncontradoNaMeta()
      await gravarAuditoriaDaCarteira(c, {
        usuarioGestaoId: sessao.id,
        grupoId: cliente.grupo_id,
        tabela: 'metas_comerciais',
        registroId: metaId,
        acao: 'atualizar',
        de: { excluido_em: null },
        para: r.rows[0],
      })
    })
  }

  // -------------------------------------------------------------------------
  // M4 — Lançar metas da semana
  // -------------------------------------------------------------------------

  /**
   * Uma transação: os lançamentos (upsert por `(indicador, segunda)`, regra
   * 26 — relançar a mesma semana ATUALIZA e audita de→para), a reunião dos
   * combinados e a conclusão da tarefa que abriu o formulário. Ou tudo, ou
   * nada.
   */
  async lancarSemana(sessao: Sessao, clienteId: string, dto: LancamentoSemanalDeMetasEntrada): Promise<LancamentoSemanalDeMetasSaida> {
    exigirSegunda(dto.semana)
    if (dto.semana > segundaDaSemana(this.hoje())) {
      throw new EntradaInvalidaNaMeta('SEMANA_FUTURA', 'Ainda não chegou essa semana.')
    }
    exigirValores(sessao, dto.valores.some((v) => v.valor != null))
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDaMeta(c, clienteId)
      const ids = dto.valores.map((v) => v.metaId)
      if (new Set(ids).size !== ids.length) throw new EntradaInvalidaNaMeta('META_REPETIDA', 'Cada meta aparece uma vez.')
      const metas = ids.length === 0
        ? []
        : (
            await c.query<{ id: string; indicador_id: string; unidade: string }>(
              `SELECT m.id, m.indicador_id, i.unidade
                 FROM metas_comerciais m JOIN indicadores_carteira i ON i.id = m.indicador_id
                WHERE m.id = ANY($1) AND m.cliente_carteira_id = $2 AND m.excluido_em IS NULL
                  AND m.status <> 'cancelada' AND m.fonte = 'lancamento'`,
              [ids, cliente.id],
            )
          ).rows
      if (metas.length !== ids.length) throw new NaoEncontradoNaMeta()
      // Duas metas sobre o MESMO indicador numa semana gravariam dois valores
      // na mesma linha — o segundo apagaria o primeiro em silêncio.
      if (new Set(metas.map((m) => m.indicador_id)).size !== metas.length) {
        throw new EntradaInvalidaNaMeta('INDICADOR_REPETIDO', 'Duas metas medem o mesmo indicador: lance uma só.')
      }

      let lancadas = 0
      for (const v of dto.valores) {
        const meta = metas.find((m) => m.id === v.metaId)!
        const valor = valorDaUnidade(meta.unidade, v.valor, v.valorInteiro)
        await upsertLancamento(c, sessao.id, cliente.grupo_id, meta.indicador_id, dto.semana, valor)
        lancadas++
      }

      let reuniaoId: string | null = null
      const combinados = dto.combinados?.trim() ?? ''
      if (combinados.length > 0) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO reunioes_comerciais
             (cliente_carteira_id, grupo_id, data, tipo, resumo, chave_idempotencia, por_usuario_gestao_id)
           VALUES ($1, $2, $3, 'semanal', $4, $5, $6)
           ON CONFLICT (grupo_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL DO NOTHING
           RETURNING id`,
          [cliente.id, cliente.grupo_id, this.hoje(), `Reunião de metas: ${combinados}`, dto.chaveIdempotencia ?? null, sessao.id],
        )
        reuniaoId = r.rows[0]?.id ?? null
        if (reuniaoId === null && dto.chaveIdempotencia) {
          const ja = await c.query<{ id: string; cliente_carteira_id: string }>(
            'SELECT id, cliente_carteira_id FROM reunioes_comerciais WHERE grupo_id = $1 AND chave_idempotencia = $2',
            [cliente.grupo_id, dto.chaveIdempotencia],
          )
          if (ja.rows[0]?.cliente_carteira_id !== cliente.id) {
            throw new EntradaInvalidaNaMeta('CHAVE_REUTILIZADA', 'Este envio já foi usado em outra cliente.')
          }
          reuniaoId = ja.rows[0].id
        }
      }

      let tarefaConcluida = false
      if (dto.tarefaInternaId && lancadas > 0) {
        const t = await c.query(
          `UPDATE tarefas_internas SET status = 'concluida', concluida_em = now()
            WHERE id = $1 AND cliente_carteira_id = $2 AND status = 'pendente'
            RETURNING id`,
          [dto.tarefaInternaId, cliente.id],
        )
        tarefaConcluida = (t.rowCount ?? 0) > 0
      }
      return { lancadas, reuniaoId, tarefaConcluida }
    })
  }
}

/**
 * Upsert de UM `Lançamento de indicador` por `(indicador, referência)`, com a
 * trilha de→para quando corrige (critério 2.1.3). A referência já foi
 * conferida como segunda-feira por quem chama.
 */
export async function upsertLancamento(
  c: pg.PoolClient,
  usuarioGestaoId: string,
  grupoId: string,
  indicadorId: string,
  referencia: string,
  valor: { centavos: string | null; inteiro: string | null },
  observacao: string | null = null,
): Promise<Record<string, unknown> & { id: string }> {
  const anterior = await c.query('SELECT * FROM lancamentos_de_indicador WHERE indicador_id = $1 AND referencia = $2', [
    indicadorId,
    referencia,
  ])
  const r = await c.query<Record<string, unknown> & { id: string }>(
    `INSERT INTO lancamentos_de_indicador
       (indicador_id, grupo_id, referencia, valor_centavos, valor_inteiro, observacao, lancado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (indicador_id, referencia) DO UPDATE SET
       valor_centavos = EXCLUDED.valor_centavos,
       valor_inteiro  = EXCLUDED.valor_inteiro,
       observacao     = coalesce(EXCLUDED.observacao, lancamentos_de_indicador.observacao),
       lancado_por    = EXCLUDED.lancado_por,
       atualizado_em  = now()
     RETURNING *`,
    [indicadorId, grupoId, referencia, valor.centavos, valor.inteiro, observacao, usuarioGestaoId],
  )
  const linha = r.rows[0]!
  await gravarAuditoriaDaCarteira(c, {
    usuarioGestaoId,
    grupoId,
    tabela: 'lancamentos_de_indicador',
    registroId: linha.id,
    acao: anterior.rows[0] ? 'atualizar' : 'criar',
    de: anterior.rows[0] ?? null,
    para: linha,
  })
  return linha
}
