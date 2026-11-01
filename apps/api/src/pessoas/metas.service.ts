import type {
  Conversas,
  ConversaRegistrada,
  ConversaSalva,
  CopiarMetas,
  LancarRealizado,
  MetaDePessoa,
  MetasCopiadas,
  MetasDaPessoa,
  MetasDoMes,
  MinhasMetas,
  RotinaDePessoalCriada,
  SalvarConversa,
  SalvarMetaDePessoa,
} from '@fir/contracts'
import {
  type IndicadorDeMeta,
  INDICADOR_MANUAL,
  MAX_METAS_POR_PESSOA_NO_MES,
  atingimentoDaMeta,
  diaCivil,
  mediaDeAtingimento,
  nomeDoIndicador,
  somarDias,
  somarMeses,
  tipoDoIndicador,
} from '@fir/domain'
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type pg from 'pg'
import type { PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { diaDaClinica } from '../estoque/dia-da-clinica'
import { type RealizadoPorIndicador, realizadoDosIndicadores } from './indicadores.service'

/**
 * **Pessoas › Metas do mês · Conversas 1:1 · Minhas metas** (MANUAL cap. 13).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE SERVIÇO NÃO FAZ
 *
 *  1. **Não calcula percentual nem média.** `atingimentoDaMeta` e
 *     `mediaDeAtingimento` moram em `packages/domain/metas-de-pessoa.ts`, com
 *     property-based test, e o clamp em 100 por meta existe uma vez só. O
 *     protótipo calcula os dois no navegador, em dois lugares diferentes
 *     (`metaCardHtml` e `pesMetas`).
 *
 *  2. **Não decide quem vê valor.** A meta de `orc_valor` viaja em
 *     `metaEmDinheiro`/`realizadoEmDinheiro`, que estão em
 *     `CAMPOS_MONETARIOS`; o `RedacaoInterceptor` os apaga num ponto único
 *     (regra 17). **Não há `if (pode('valores'))` nesta classe**, e é isso que
 *     faz "sem `valores`, a meta entrega só o percentual" valer também para a
 *     rota que ninguém revisou.
 *
 *  3. **Não usa `new Date()`.** `hoje` é `diaDaClinica(relogio, fuso)` — e ele
 *     não é cosmético aqui: é `hoje` que fecha o denominador dos DOIS
 *     percentuais. Com o relógio do navegador (que é o que o protótipo usa), o
 *     computador de balcão adiantado conta como vencida a tarefa de amanhã e
 *     afunda o percentual de quem não atrasou nada.
 *
 *  4. **Não grava realizado automático** (regra 11). A única coluna de
 *     resultado é `realizado_lancado`, restrita a `manual` por `CHECK`.
 * ────────────────────────────────────────────────────────────────────────────
 */

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: PessoaId
  readonly fuso: string
}

type LinhaDeMeta = {
  id: string
  ficha_id: string
  mes: string
  indicador: IndicadorDeMeta
  nome: string
  alvo: string
  realizado_lancado: string | null
}

type LinhaDeFichaDaMeta = {
  id: string
  nome: string
  cargo: string
  pessoa_id: string | null
}

/** O marcador de cada rotina mensal da tela Equipe, e o dia do mês dela. */
const ROTINAS = {
  conversas: {
    marcador: 'pessoas-conversas-1a1',
    descricao: 'Conversas 1:1 do mês com a equipe',
    dia: 20,
  },
  bancoDeHoras: {
    marcador: 'pessoas-banco-de-horas',
    descricao: 'Análise do espelho de ponto e lançamento do banco de horas',
    dia: 5,
  },
} as const

/** Doze meses, como a rotina de fechamento do financeiro. */
const MESES_DA_ROTINA = 12

/** O prazo de uma tarefa de combinado: "para a pessoa, com prazo de 30 dias". */
const DIAS_DO_COMBINADO = 30

@Injectable()
export class MetasService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  // -----------------------------------------------------------------------
  // LEITURA
  // -----------------------------------------------------------------------

  /** A aba **Metas** da tela Equipe: todas as fichas ativas, no mês pedido. */
  async metasDoMes(ctx: Contexto, mes: string): Promise<MetasDoMes> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) =>
      this.montarMes(c, ctx, mes),
    )
  }

  /**
   * **Minhas metas** — e ela só devolve as de quem pediu.
   *
   * A ficha é achada por `pessoa_id = ator`, nunca por um id vindo do cliente:
   * esta rota é liberada para TODO perfil (`perm: null`, como na navegação
   * dela), e um parâmetro de pessoa aqui seria a porta pela qual a recepção lê
   * o atingimento da colega sem permissão nenhuma.
   */
  async minhasMetas(ctx: Contexto, mes: string): Promise<MinhasMetas> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const f = (
        await c.query<LinhaDeFichaDaMeta>(
          `SELECT id, nome, cargo, pessoa_id FROM fichas_de_pessoa
            WHERE pessoa_id = $1 AND excluida_em IS NULL`,
          [ctx.ator],
        )
      ).rows[0]
      if (f === undefined) {
        return { mes, temFicha: false, mediaDeAtingimento: null, metas: [] }
      }

      const linhas = await metasDaFicha(c, mes, f.id)
      const realizado = await realizadoDosIndicadores(c, {
        clinicaId: ctx.clinicaId,
        fuso: ctx.fuso,
        mes,
        hoje,
      })
      const metas = linhas.map((l) => montarMeta(l, realizado.get(ctx.ator)))
      return {
        mes,
        temFicha: true,
        mediaDeAtingimento: mediaDeAtingimento(metas.map((m) => m.percentual)),
        metas,
      }
    })
  }

  // -----------------------------------------------------------------------
  // ESCRITA
  // -----------------------------------------------------------------------

  /**
   * `meta` — adicionar.
   *
   * **409 na duplicata**, pelo índice `meta_por_ficha_mes_indicador`. O
   * protótipo faz `P.metas.push` sem conferir nada: duas vezes "Agendamentos
   * feitos" no mesmo mês, e a média de atingimento dela passa a contar a mesma
   * meta duas vezes. O `SELECT` abaixo existe só para nomear o conflito na
   * mensagem — quem recusa é o índice.
   */
  async criarMeta(ctx: Contexto, mes: string, dados: SalvarMetaDePessoa): Promise<MetasDoMes> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      await umaFicha(c, dados.fichaId)

      const quantas = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM metas_de_pessoa
          WHERE ficha_id = $1 AND mes = $2 AND excluida_em IS NULL`,
        [dados.fichaId, mes],
      )
      if (Number(quantas.rows[0]!.n) >= MAX_METAS_POR_PESSOA_NO_MES) {
        throw new UnprocessableEntityException(
          `São até ${MAX_METAS_POR_PESSOA_NO_MES} metas por pessoa em cada mês.`,
        )
      }

      // O ALVO num inteiro só, na escala do indicador (migration 0019,
      // decisão 4). O contrato já garantiu que o campo preenchido combina com
      // o tipo — aqui só se escolhe qual deles virou o `bigint`.
      const alvo =
        dados.metaEmDinheiro !== null ? dados.metaEmDinheiro : BigInt(dados.metaEmNumero!)

      const r = await c.query(
        `INSERT INTO metas_de_pessoa
           (clinica_id, ficha_id, mes, indicador, nome, alvo, criada_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (clinica_id, ficha_id, mes, indicador, nome)
           WHERE excluida_em IS NULL
           DO NOTHING`,
        [
          ctx.clinicaId,
          dados.fichaId,
          mes,
          dados.indicador,
          dados.nome,
          alvo.toString(),
          ctx.ator,
        ],
      )
      if (r.rowCount === 0) {
        const nome =
          dados.indicador === INDICADOR_MANUAL ? dados.nome : nomeDoIndicador(dados.indicador)
        throw new ConflictException(`Já existe a meta "${nome}" para essa pessoa neste mês.`)
      }
    })
    return this.metasDoMes(ctx, mes)
  }

  /** `excluirMeta` — **soft delete** (regra 20), nunca `DELETE`. */
  async excluirMeta(ctx: Contexto, mes: string, id: string): Promise<MetasDoMes> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query(
        `UPDATE metas_de_pessoa SET excluida_em = now()
          WHERE id = $1 AND mes = $2 AND excluida_em IS NULL`,
        [id, mes],
      )
      if (r.rowCount === 0) throw new NotFoundException('Essa meta não existe mais.')
    })
    return this.metasDoMes(ctx, mes)
  }

  /**
   * `realizado` — **só na meta MANUAL**.
   *
   * O protótipo aceita em qualquer meta (`P.metas.find(x => x.id===d.id)`) e a
   * leitura dele ignora o campo nas automáticas: a gestora digita um número em
   * "Agendamentos feitos", vê "Resultado salvo", e a tela continua mostrando a
   * contagem. Aqui é **422 com a razão**, e o `CHECK`
   * `realizado_lancado_so_na_manual` fecha a porta no banco também.
   *
   * `null` LIMPA o lançamento, e a meta volta a `—`.
   */
  async lancarRealizado(
    ctx: Contexto,
    mes: string,
    id: string,
    dados: LancarRealizado,
  ): Promise<MetasDoMes> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const m = (
        await c.query<{ indicador: IndicadorDeMeta }>(
          `SELECT indicador FROM metas_de_pessoa
            WHERE id = $1 AND mes = $2 AND excluida_em IS NULL FOR UPDATE`,
          [id, mes],
        )
      ).rows[0]
      if (m === undefined) throw new NotFoundException('Essa meta não existe mais.')
      if (m.indicador !== INDICADOR_MANUAL) {
        throw new UnprocessableEntityException(
          `"${nomeDoIndicador(m.indicador)}" é calculada pela ferramenta — o resultado não se lança à mão.`,
        )
      }
      await c.query(
        `UPDATE metas_de_pessoa SET realizado_lancado = $2 WHERE id = $1`,
        [id, dados.realizadoEmNumero],
      )
    })
    return this.metasDoMes(ctx, mes)
  }

  /**
   * `copiarMetas` — **idempotente por esquema**.
   *
   * Um `INSERT … SELECT` com `ON CONFLICT DO NOTHING` sobre o índice único: a
   * segunda chamada devolve `copiadas: 0` e `jaExistiam: N`, sem lock e sem
   * leitura-antes-de-escrita. O protótipo faz `if (!P.metas.some(...)) push`,
   * que duas abas atravessam juntas.
   *
   * **O realizado lançado não é copiado** (`realizado_lancado` fica `NULL`):
   * ele é o resultado do mês de ORIGEM. Copiá-lo daria à gestora um novembro
   * que já abre com o número de outubro dentro.
   *
   * Só fichas ATIVAS entram: copiar a meta de quem saiu da clínica criaria
   * uma linha que nenhuma tela mostra (a lista filtra `ativo`) e que entraria
   * na conferência de totais do épico 9 como registro órfão.
   */
  async copiarMetas(ctx: Contexto, para: string, dados: CopiarMetas): Promise<MetasCopiadas> {
    if (dados.de === para) {
      throw new UnprocessableEntityException('Escolha um mês de origem diferente.')
    }
    const { copiadas, naOrigem } = await this.banco.naClinica(
      ctx.clinicaId,
      ctx.ator,
      async (c) => {
        const origem = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n
             FROM metas_de_pessoa m
             JOIN fichas_de_pessoa f ON f.id = m.ficha_id AND f.ativo AND f.excluida_em IS NULL
            WHERE m.mes = $1 AND m.excluida_em IS NULL`,
          [dados.de],
        )
        const r = await c.query(
          `INSERT INTO metas_de_pessoa
             (clinica_id, ficha_id, mes, indicador, nome, alvo, criada_por)
           SELECT m.clinica_id, m.ficha_id, $2, m.indicador, m.nome, m.alvo, $3
             FROM metas_de_pessoa m
             JOIN fichas_de_pessoa f
               ON f.id = m.ficha_id AND f.ativo AND f.excluida_em IS NULL
            WHERE m.mes = $1 AND m.excluida_em IS NULL
           ON CONFLICT (clinica_id, ficha_id, mes, indicador, nome)
             WHERE excluida_em IS NULL
             DO NOTHING`,
          [dados.de, para, ctx.ator],
        )
        return { copiadas: r.rowCount ?? 0, naOrigem: Number(origem.rows[0]!.n) }
      },
    )
    const mesMontado = await this.metasDoMes(ctx, para)
    return { ...mesMontado, copiadas, jaExistiam: naOrigem - copiadas }
  }

  // -----------------------------------------------------------------------
  // CONVERSAS 1:1
  // -----------------------------------------------------------------------

  async conversas(ctx: Contexto): Promise<Conversas> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) =>
      this.montarConversas(c, hoje),
    )
  }

  /**
   * `conversa` — registrar, e criar uma tarefa por combinado **na mesma
   * transação**.
   *
   * No protótipo é um laço na TELA chamando a API uma vez por linha
   * (`for (const c of combs) await tarefaRef(...)`): se a terceira falhar, a
   * conversa fica gravada com dois combinados virados em tarefa e um não — e
   * nada diz qual. Aqui as `N + 1` escritas são uma transação só.
   *
   * O responsável é **a pessoa**, quando ela usa a ferramenta; quando não usa
   * (a faxineira com ficha e sem login), a tarefa fica com quem conduziu a
   * conversa — é o `f.userId || S.user.id` dela, e é o único destino possível:
   * uma tarefa precisa de responsável, e `responsavel_id` é `NOT NULL`.
   */
  async registrarConversa(ctx: Contexto, dados: SalvarConversa): Promise<ConversaSalva> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    // DATA FUTURA É RECUSADA, e `hoje` é o do servidor (regra 24). A tela dela
    // põe `max` no campo e nada mais — e um `max` de HTML é sugestão.
    if (dados.data > hoje) {
      throw new UnprocessableEntityException('A conversa não pode ter data futura.')
    }
    const tarefasCriadas = await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const f = await umaFicha(c, dados.fichaId)
      await c.query(
        `INSERT INTO conversas_1a1
           (clinica_id, ficha_id, data, mes, por_id, fortes, desenvolver, combinados)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          ctx.clinicaId,
          dados.fichaId,
          dados.data,
          dados.mes,
          ctx.ator,
          dados.fortes,
          dados.desenvolver,
          dados.combinados,
        ],
      )

      if (!dados.criarTarefas) return 0
      const combinados = emLinhas(dados.combinados)
      if (combinados.length === 0) return 0

      const responsavel = f.pessoa_id ?? ctx.ator
      const prazo = somarDias(hoje, DIAS_DO_COMBINADO)
      let criadas = 0
      for (const combinado of combinados) {
        const r = await c.query(
          `INSERT INTO tarefas
             (clinica_id, solicitante_id, responsavel_id, descricao, prazo, prioridade,
              status, historico, resultado, obs, recorrencia)
           VALUES ($1, $2, $3, $4, $5::date, 'normal', 'aberta', '[]', '', $6, '')`,
          [
            ctx.clinicaId,
            ctx.ator,
            responsavel,
            // O prefixo é o dela, e ele é o que torna a tarefa legível meses
            // depois, quando ninguém lembra de qual 1:1 o combinado saiu.
            `Combinado 1:1: ${combinado}`.slice(0, 400),
            prazo,
            `Conversa 1:1 de ${f.nome} · ${dados.mes}`.slice(0, 300),
          ],
        )
        criadas += r.rowCount ?? 0
      }
      return criadas
    })
    const montadas = await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) =>
      this.montarConversas(c, hoje),
    )
    return { ...montadas, tarefasCriadas }
  }

  /**
   * As duas rotinas mensais da tela Equipe: 1:1 no dia 20, ponto no dia 5.
   *
   * **Idempotente sem lock**, pelo índice `tarefa_de_rotina (clinica_id,
   * marcador, prazo)`: o segundo toque gera exatamente o mesmo conjunto de
   * `(marcador, prazo)` e não escreve nada. É o mesmo mecanismo da rotina de
   * fechamento do mês (épico 4).
   *
   * A do banco de horas entra aqui, e não na fatia anterior, porque é a mesma
   * linha de código com outro marcador — e a tela dela tem os dois botões.
   */
  async criarRotina(
    ctx: Contexto,
    qual: 'conversas' | 'bancoDeHoras',
  ): Promise<RotinaDePessoalCriada> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    const r = ROTINAS[qual]
    const dia = String(r.dia).padStart(2, '0')
    /**
     * Começa no mês que vem quando o dia já passou neste.
     *
     * Sem isso, a rotina criada em 25 de novembro nasce com a tarefa de 20 de
     * novembro **atrasada**, e a lista de hoje abre com um cartão vermelho que
     * ninguém atrasou — o mesmo clamp do `Contato de retorno`.
     */
    const inicio =
      hoje.slice(8, 10) > dia
        ? somarMeses(`${hoje.slice(0, 7)}-${dia}`, 1)
        : `${hoje.slice(0, 7)}-${dia}`

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      let criadas = 0
      for (let i = 0; i < MESES_DA_ROTINA; i++) {
        const prazo = somarMeses(inicio, i, r.dia)
        const feito = await c.query(
          `INSERT INTO tarefas
             (clinica_id, solicitante_id, responsavel_id, descricao, prazo, prioridade,
              status, historico, resultado, obs, recorrencia, marcador)
           VALUES ($1, $2, $2, $3, $4::date, 'normal', 'aberta', '[]', '', '', 'Mensal', $5)
           ON CONFLICT (clinica_id, marcador, prazo)
             WHERE marcador IS NOT NULL AND excluida_em IS NULL
             DO NOTHING`,
          [ctx.clinicaId, ctx.ator, r.descricao, prazo, r.marcador],
        )
        criadas += feito.rowCount ?? 0
      }
      return { criadas, deInicio: inicio }
    })
  }

  // -----------------------------------------------------------------------
  // MONTAGEM
  // -----------------------------------------------------------------------

  private async montarMes(
    c: pg.PoolClient,
    ctx: Contexto,
    mes: string,
  ): Promise<MetasDoMes> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    const mesAnterior = somarMeses(`${mes}-01`, -1).slice(0, 7)

    const fichas = (
      await c.query<LinhaDeFichaDaMeta>(
        `SELECT id, nome, cargo, pessoa_id FROM fichas_de_pessoa
          WHERE excluida_em IS NULL AND ativo ORDER BY nome`,
      )
    ).rows

    const linhas = await metasDaFicha(c, mes)
    const realizado = await realizadoDosIndicadores(c, {
      clinicaId: ctx.clinicaId,
      fuso: ctx.fuso,
      mes,
      hoje,
    })

    const porFicha = new Map<string, LinhaDeMeta[]>()
    for (const l of linhas) {
      const atual = porFicha.get(l.ficha_id)
      if (atual) atual.push(l)
      else porFicha.set(l.ficha_id, [l])
    }

    const pessoas: MetasDaPessoa[] = fichas.map((f) => {
      // `realizado` é indexado por PESSOA (quem fez os registros), e a ficha
      // sem usuário ligado recebe `undefined` — que `montarMeta` traduz em
      // `null` em toda meta automática. É o `if (!uid) return null` dela.
      const dela = f.pessoa_id === null ? undefined : realizado.get(f.pessoa_id)
      const metas = (porFicha.get(f.id) ?? []).map((l) => montarMeta(l, dela))
      return {
        fichaId: f.id,
        nome: f.nome,
        cargo: f.cargo,
        temUsuario: f.pessoa_id !== null,
        mediaDeAtingimento: mediaDeAtingimento(metas.map((m) => m.percentual)),
        metas,
      }
    })

    const anterior = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM metas_de_pessoa
        WHERE mes = $1 AND excluida_em IS NULL`,
      [mesAnterior],
    )

    return {
      mes,
      mesAnterior,
      mesAnteriorTemMetas: Number(anterior.rows[0]!.n) > 0,
      pessoas,
      maxMetasPorPessoa: MAX_METAS_POR_PESSOA_NO_MES,
    }
  }

  private async montarConversas(c: pg.PoolClient, hoje: string): Promise<Conversas> {
    const mes = hoje.slice(0, 7)

    const linhas = (
      await c.query<{
        id: string
        ficha_id: string
        nome: string
        data: string
        mes: string
        por: string
        fortes: string
        desenvolver: string
        combinados: string
      }>(
        `SELECT cv.id, cv.ficha_id, f.nome, cv.data::text AS data, cv.mes,
                p.nome AS por, cv.fortes, cv.desenvolver, cv.combinados
           FROM conversas_1a1 cv
           JOIN fichas_de_pessoa f ON f.id = cv.ficha_id
           LEFT JOIN pessoas p ON p.id = cv.por_id
          WHERE cv.excluida_em IS NULL
          ORDER BY cv.data DESC, cv.criada_em DESC
          LIMIT 60`,
      )
    ).rows

    const conversas: ConversaRegistrada[] = linhas.map((l) => ({
      id: l.id,
      fichaId: l.ficha_id,
      nome: l.nome,
      data: l.data,
      mes: l.mes,
      por: primeiroNome(l.por),
      // O servidor quebra em linhas — a tela não faz `split`.
      fortes: emLinhas(l.fortes),
      desenvolver: emLinhas(l.desenvolver),
      combinados: emLinhas(l.combinados),
    }))

    /**
     * Pendentes: ficha ATIVA, **com gestor**, sem conversa deste mês.
     *
     * `gestor_id IS NOT NULL` é o `f.gestorId &&` dela: sem gestor definido
     * ninguém é responsável por conduzir, e o aviso apontaria para o vazio.
     */
    const pendentes = (
      await c.query<{ id: string; nome: string; gestor: string | null }>(
        `SELECT f.id, f.nome, g.nome AS gestor
           FROM fichas_de_pessoa f
           LEFT JOIN pessoas g ON g.id = f.gestor_id
          WHERE f.excluida_em IS NULL AND f.ativo AND f.gestor_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM conversas_1a1 cv
               WHERE cv.ficha_id = f.id AND cv.mes = $1 AND cv.excluida_em IS NULL)
          ORDER BY f.nome`,
        [mes],
      )
    ).rows

    const rotina = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tarefas
        WHERE marcador = $1 AND status = 'aberta' AND excluida_em IS NULL`,
      [ROTINAS.conversas.marcador],
    )

    return {
      mes,
      conversas,
      pendentes: pendentes.map((p) => ({
        fichaId: p.id,
        nome: p.nome,
        gestor: primeiroNome(p.gestor),
      })),
      temRotina: Number(rotina.rows[0]!.n) > 0,
    }
  }
}

// ---------------------------------------------------------------------------
// APOIO — nenhuma destas funções decide nada
// ---------------------------------------------------------------------------

/**
 * Uma meta na forma de saída: os dois pares, e o percentual.
 *
 * **É AQUI que "sem `valores`, a meta entrega só o percentual" fica
 * possível**, e o mecanismo é a ESCALA SEPARAR OS CAMPOS, não um `if` de
 * permissão: `orc_valor` preenche `metaEmDinheiro`/`realizadoEmDinheiro`
 * (registrados em `CAMPOS_MONETARIOS`) e deixa os dois `...EmNumero` em
 * `null`; os outros oito fazem o contrário. O `RedacaoInterceptor` apaga os
 * dois primeiros por nome de chave, em qualquer resposta, e `percentual`
 * atravessa porque não é dinheiro — "84% da meta" não revela a meta.
 *
 * O realizado de uma meta AUTOMÁTICA vem do mapa de contagens; da MANUAL, da
 * coluna. `undefined` no mapa (ficha sem usuário ligado, ou nenhum registro no
 * mês) é `null`, que é **"sem dado"** — nunca zero.
 */
function montarMeta(l: LinhaDeMeta, realizado: RealizadoPorIndicador | undefined): MetaDePessoa {
  const tipo = tipoDoIndicador(l.indicador)
  const automatica = l.indicador !== INDICADOR_MANUAL
  const alvo = BigInt(l.alvo)
  const feito = automatica
    ? (realizado?.[l.indicador] ?? null)
    : l.realizado_lancado === null
      ? null
      : BigInt(l.realizado_lancado)

  const ehDinheiro = tipo === 'valor'
  return {
    id: l.id,
    fichaId: l.ficha_id,
    mes: l.mes,
    indicador: l.indicador,
    nome: automatica ? nomeDoIndicador(l.indicador) : l.nome,
    tipo,
    automatica,
    metaEmDinheiro: ehDinheiro ? alvo.toString() : null,
    metaEmNumero: ehDinheiro ? null : Number(alvo),
    realizadoEmDinheiro: ehDinheiro && feito !== null ? feito.toString() : null,
    realizadoEmNumero: ehDinheiro || feito === null ? null : Number(feito),
    percentual: atingimentoDaMeta(feito, alvo),
  }
}

async function metasDaFicha(
  c: pg.PoolClient,
  mes: string,
  fichaId?: string,
): Promise<readonly LinhaDeMeta[]> {
  const r = await c.query<LinhaDeMeta>(
    `SELECT id, ficha_id, mes, indicador, nome, alvo::text AS alvo,
            realizado_lancado::text AS realizado_lancado
       FROM metas_de_pessoa
      WHERE mes = $1 AND excluida_em IS NULL AND ($2::uuid IS NULL OR ficha_id = $2)
      ORDER BY criada_em`,
    [mes, fichaId ?? null],
  )
  return r.rows
}

async function umaFicha(c: pg.PoolClient, id: string): Promise<LinhaDeFichaDaMeta> {
  // Sem cláusula de clínica: a RLS já a impõe, e a ficha da vizinha
  // simplesmente não existe vista daqui — `undefined` vira 404.
  const r = await c.query<LinhaDeFichaDaMeta>(
    `SELECT id, nome, cargo, pessoa_id FROM fichas_de_pessoa
      WHERE id = $1 AND excluida_em IS NULL`,
    [id],
  )
  const l = r.rows[0]
  if (l === undefined) throw new NotFoundException('Ficha não encontrada.')
  return l
}

/**
 * Texto de três linhas em lista, como ela faz: `split`, `trim`, sem vazias.
 *
 * Mora no servidor porque a resposta já viaja em lista — duas
 * implementações do mesmo `filter(Boolean)` divergem no dia em que uma delas
 * aceitar a linha em branco, e aí a 1:1 ganha um combinado vazio virando
 * tarefa.
 */
const emLinhas = (texto: string): string[] =>
  texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')

/** "com Helena" — é o `primeiro()` dela. */
const primeiroNome = (nome: string | null): string =>
  nome === null ? '' : (nome.trim().split(/\s+/)[0] ?? '')

/** Reexportado para o controlador não precisar de `diaCivil` direto. */
export { diaCivil }
