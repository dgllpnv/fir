import type {
  CumprimentoDePrazos,
  FiltroDoPainel,
  LinhaPorResponsavel,
  LinhaPorSolicitante,
  Painel,
  PacientesNoPainel,
} from '@fir/contracts'
import { PERIODOS_DO_PAINEL } from '@fir/contracts'
import {
  Dinheiro,
  TIPOS,
  TIPOS_DE_CONTATO,
  TIPOS_DE_RECEITA,
  TIPOS_PAGAVEIS,
  TIPOS_QUE_ATENDEM,
  TIPO_PAGAMENTO_DE_ORCAMENTO,
  fimDoMes,
  janela,
  percentualInteiro,
  somarDias,
  somarMeses,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import type { PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { diaDaClinica } from '../estoque/dia-da-clinica'
import { DINHEIRO_QUE_ENTROU } from '../financeiro/dinheiro-que-entrou'

/**
 * **Gestão › Painel geral** (MANUAL cap. 10) — Período · Cumprimento de
 * prazos · Pacientes no período.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * OS DOIS RECORTES DO PAINEL SÃO DIFERENTES, E CONFUNDI-LOS É O DEFEITO
 *
 *  **Prazos** olha o PRAZO: tarefa com `prazo` no período, não cancelada e
 *  que não é sessão de programa. É sobre *entregar no combinado*.
 *
 *  **Pacientes** olha a CONCLUSÃO: tarefa concluída, com paciente, com
 *  `concluida_em` no período. É sobre *o que aconteceu com a paciente*. A nota
 *  da tela dela diz isso com todas as letras — *"contatos e valores contam
 *  pela data em que a tarefa foi concluída"*.
 *
 *  E **"quem solicitou"** usa um terceiro: a data de CRIAÇÃO. São três
 *  perguntas e três recortes, e o protótipo mantém os três — é a parte dele
 *  que está certa e que é fácil de estragar ao "simplificar".
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **A SESSÃO DE PROGRAMA FICA DE FORA DOS PRAZOS** (`!ehSessao(t)` dela). Doze
 * aplicações de uma paciente no mês virariam doze tarefas no denominador da
 * enfermeira, e a disciplina dela passaria a depender de quantos programas a
 * clínica vendeu. É a mesma razão pela qual a sessão não conta na jornada.
 *
 * **Toda consulta filtra `clinica_id` ALÉM da RLS** (regra 19).
 */

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: PessoaId
  readonly fuso: string
}

/** O nome do tipo de sessão de programa, para o `<> ALL` do SQL. */
const TIPOS_DE_SESSAO = TIPOS.filter((t) => t.sessao === true).map((t) => t.nome)

type LinhaDePrazo = {
  pessoa: string | null
  nome: string | null
  funcao: string | null
  total: string
  no_prazo: string
  com_atraso: string
  atrasadas: string
  a_vencer: string
}

@Injectable()
export class PainelService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async painel(ctx: Contexto, filtro: FiltroDoPainel): Promise<Painel> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    const periodo = bordasDoPeriodo(filtro, hoje)

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const [prazos, criadas, solicitantes, pacientes] = await Promise.all([
        this.prazos(c, ctx, periodo, hoje),
        this.criadasNoPeriodo(c, ctx, periodo),
        this.porSolicitante(c, ctx, periodo),
        this.pacientes(c, ctx, periodo),
      ])

      return {
        hoje,
        periodo,
        prazos: prazos.total,
        criadasNoPeriodo: criadas,
        porResponsavel: prazos.porPessoa,
        porSolicitante: solicitantes,
        pacientes,
      }
    })
  }

  /**
   * O CUMPRIMENTO DE PRAZOS, no total e por responsável — **uma consulta**.
   *
   * `GROUPING SETS` dá o total e o recorte por pessoa de uma vez: duas
   * consultas sobre o mesmo `WHERE` são duas chances de os filtros divergirem,
   * e a divergência apareceria como um total que não bate com a soma das
   * linhas — o pior defeito possível numa tela de indicadores.
   *
   * As quatro situações são o `situacao()` dela, com `grupoPrazo` colapsando
   * `hoje` e `aberta` em `a vencer`:
   *
   *   `ok`        concluída, e o dia da conclusão `<=` o prazo
   *   `tarde`     concluída, e o dia da conclusão `>` o prazo
   *   `atrasada`  aberta, e o prazo já passou
   *   `a vencer`  aberta, e o prazo é hoje ou depois
   *
   * O dia da conclusão sai no FUSO DA CLÍNICA (regra 22): com `AT TIME ZONE
   * 'UTC'`, uma conclusão às 21h de Salvador cairia no dia seguinte e viraria
   * atraso.
   */
  private async prazos(
    c: pg.PoolClient,
    ctx: Contexto,
    periodo: { de: string; ate: string },
    hoje: string,
  ): Promise<{ total: CumprimentoDePrazos; porPessoa: LinhaPorResponsavel[] }> {
    const r = await c.query<LinhaDePrazo>(
      `SELECT t.responsavel_id::text AS pessoa,
              max(p.nome)   AS nome,
              max(p.funcao) AS funcao,
              count(*)::text AS total,
              count(*) FILTER (
                WHERE t.status = 'concluida'
                  AND (t.concluida_em AT TIME ZONE $5)::date <= t.prazo
              )::text AS no_prazo,
              count(*) FILTER (
                WHERE t.status = 'concluida'
                  AND (t.concluida_em AT TIME ZONE $5)::date > t.prazo
              )::text AS com_atraso,
              count(*) FILTER (WHERE t.status = 'aberta' AND t.prazo <  $4::date)::text
                AS atrasadas,
              count(*) FILTER (WHERE t.status = 'aberta' AND t.prazo >= $4::date)::text
                AS a_vencer
         FROM tarefas t
         LEFT JOIN pessoas p ON p.id = t.responsavel_id
        WHERE t.clinica_id = $1
          AND t.excluida_em IS NULL
          AND t.status <> 'cancelada'
          AND t.tipo <> ALL($6::text[])
          AND t.prazo >= $2::date
          AND t.prazo <= $3::date
        GROUP BY GROUPING SETS ((t.responsavel_id), ())
        ORDER BY count(*) DESC`,
      [ctx.clinicaId, periodo.de, periodo.ate, hoje, ctx.fuso, TIPOS_DE_SESSAO],
    )

    // A linha do GROUPING SET vazio é o TOTAL, e ela vem com `pessoa = null`.
    const totalBruto = r.rows.find((l) => l.pessoa === null)
    const porPessoa = r.rows
      .filter((l): l is LinhaDePrazo & { pessoa: string } => l.pessoa !== null)
      .map((l) => ({
        pessoaId: l.pessoa,
        nome: l.nome ?? '',
        funcao: l.funcao ?? '',
        ...cumprimento(l),
      }))

    return {
      total:
        totalBruto === undefined
          ? { total: 0, noPrazo: 0, comAtraso: 0, atrasadas: 0, aVencer: 0, taxaNoPrazo: null }
          : cumprimento(totalBruto),
      porPessoa,
    }
  }

  private async criadasNoPeriodo(
    c: pg.PoolClient,
    ctx: Contexto,
    periodo: { de: string; ate: string },
  ): Promise<number> {
    const j = janela(periodo.de, periodo.ate, ctx.fuso)
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tarefas t
        WHERE t.clinica_id = $1 AND t.excluida_em IS NULL
          AND t.tipo <> ALL($4::text[])
          AND t.criada_em >= $2 AND t.criada_em < $3`,
      [ctx.clinicaId, j.de, j.ate, TIPOS_DE_SESSAO],
    )
    return Number(r.rows[0]!.n)
  }

  /**
   * "Quem solicitou" — pela data de CRIAÇÃO, e a janela é de INSTANTES.
   *
   * `criada_em` é `timestamptz`, então a janela é semiaberta `[de, ate)` com
   * as bordas calculadas no fuso da clínica (regra 23). `prazo` é dia civil e
   * por isso a consulta de cima compara calendário com calendário — são dois
   * tipos diferentes, e tratá-los igual é como uma tarefa criada às 22h de
   * Salvador entra no dia seguinte.
   */
  private async porSolicitante(
    c: pg.PoolClient,
    ctx: Contexto,
    periodo: { de: string; ate: string },
  ): Promise<LinhaPorSolicitante[]> {
    const j = janela(periodo.de, periodo.ate, ctx.fuso)
    const r = await c.query<{
      pessoa: string
      nome: string | null
      solicitadas: string
      para_si: string
    }>(
      `SELECT t.solicitante_id::text AS pessoa,
              max(p.nome) AS nome,
              count(*)::text AS solicitadas,
              count(*) FILTER (WHERE t.responsavel_id = t.solicitante_id)::text AS para_si
         FROM tarefas t
         LEFT JOIN pessoas p ON p.id = t.solicitante_id
        WHERE t.clinica_id = $1
          AND t.excluida_em IS NULL
          AND t.tipo <> ALL($4::text[])
          AND t.criada_em >= $2 AND t.criada_em < $3
        GROUP BY 1
        ORDER BY count(*) DESC`,
      [ctx.clinicaId, j.de, j.ate, TIPOS_DE_SESSAO],
    )
    return r.rows.map((l) => {
      const solicitadas = Number(l.solicitadas)
      const paraSiMesma = Number(l.para_si)
      return {
        pessoaId: l.pessoa,
        nome: l.nome ?? '',
        solicitadas,
        paraSiMesma,
        // DERIVADO, não uma terceira contagem: `solicitadas − paraSiMesma` não
        // tem como divergir, e um `FILTER` a mais teria.
        paraAEquipe: solicitadas - paraSiMesma,
      }
    })
  }

  /**
   * PACIENTES NO PERÍODO — **pela data de conclusão**.
   *
   * O `LEFT JOIN` em `recebimentos` carrega `DINHEIRO_QUE_ENTROU` (a constante
   * da D-9): a receita do painel soma o que ENTROU e nunca a venda a prazo.
   * Sem ele, a clínica que vendeu R$ 3.600 a prazo veria R$ 3.600 de receita
   * num dia em que ninguém pagou nada — e o painel deixaria de bater com o
   * caixa, que é a primeira coisa que alguém confere.
   *
   * `receita` é a mesma definição de `ehReceita`: grupo Pagamentos, **mais** o
   * atendimento pagável que guardou dinheiro na própria tarefa.
   */
  private async pacientes(
    c: pg.PoolClient,
    ctx: Contexto,
    periodo: { de: string; ate: string },
  ): Promise<PacientesNoPainel> {
    const j = janela(periodo.de, periodo.ate, ctx.fuso)
    const args = [
      ctx.clinicaId,
      j.de,
      j.ate,
      [...TIPOS_DE_RECEITA],
      [...TIPOS_PAGAVEIS],
      [...TIPOS_DE_CONTATO],
      [...TIPOS_QUE_ATENDEM],
      TIPO_PAGAMENTO_DE_ORCAMENTO,
    ]
    const EH_RECEITA = `(t.tipo = ANY($4::text[]) OR (t.tipo = ANY($5::text[]) AND r.valor > 0))`

    const totais = await c.query<{
      receita: string
      pagamentos: string
      atendidos: string
      contatos: string
      orc_qtd: string
      orc_valor: string
    }>(
      `SELECT coalesce(sum(r.valor) FILTER (WHERE ${EH_RECEITA}), 0)::text AS receita,
              count(*) FILTER (WHERE ${EH_RECEITA})::text AS pagamentos,
              count(DISTINCT t.paciente_id) FILTER (WHERE t.tipo = ANY($7::text[]))::text AS atendidos,
              count(*) FILTER (WHERE t.tipo = ANY($6::text[]))::text AS contatos,
              count(*) FILTER (WHERE t.tipo = $8)::text AS orc_qtd,
              coalesce(sum(r.valor) FILTER (WHERE t.tipo = $8), 0)::text AS orc_valor
         FROM tarefas t
         LEFT JOIN recebimentos r
                ON r.tarefa_id = t.id AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
        WHERE t.clinica_id = $1
          AND t.excluida_em IS NULL
          AND t.status = 'concluida'
          AND t.paciente_id IS NOT NULL
          AND t.concluida_em >= $2 AND t.concluida_em < $3`,
      args,
    )
    const t = totais.rows[0]!
    const receita = Dinheiro.deCentavos(BigInt(t.receita))
    const pagamentos = Number(t.pagamentos)

    /**
     * AS FORMAS DE PAGAMENTO — **SÓ DOS DIAS COM CAIXA JÁ FECHADO** (regra 6).
     *
     * É a rota mais perigosa deste serviço, e a defesa é a mesma que
     * `visao-do-mes` já construiu: *"o recebido por forma de um período em
     * curso é o esperado somado com outro nome"*. Um período personalizado de
     * `de = ate = hoje` entregaria exatamente o esperado por forma da gaveta
     * que alguém ainda vai contar — e aí a conferência às cegas deixa de medir
     * qualquer coisa.
     *
     * O `EXISTS` em `caixas_do_dia` é o corte, e o DIA é o da CLÍNICA: com
     * `AT TIME ZONE 'UTC'` um recebimento das 21h de Salvador cairia no dia
     * seguinte e escaparia do corte justamente no dia aberto.
     *
     * **O protótipo vaza aqui** (`rec.forEach(t => fs[t.formaPagamento]…)`,
     * sem olhar caixa nenhum). Divergência consciente, como a do `saldo` que
     * não é clampado em zero.
     *
     * `forma = ''` não acontece: `DINHEIRO_QUE_ENTROU` exige `valor > 0`, e o
     * `CHECK recebimento_forma_so_com_dinheiro` garante que valor positivo tem
     * forma. A `coalesce` para "Não informada" é o cinto do dado MIGRADO
     * (épico 9), que não passou por esse `CHECK`.
     */
    /**
     * **Os parâmetros destas duas consultas são PRÓPRIOS, e não `args`.**
     *
     * Medido: o Postgres recusa o statement inteiro com *"could not determine
     * data type of parameter $6"* quando um parâmetro declarado não é usado —
     * e `args` tem oito, dos quais estas duas usam cinco. Reaproveitar a lista
     * grande parecia economia e é um 500.
     */
    const argsDeForma = [ctx.clinicaId, j.de, j.ate, [...TIPOS_DE_RECEITA], [...TIPOS_PAGAVEIS], ctx.fuso]
    const FECHADO = `EXISTS (
            SELECT 1 FROM caixas_do_dia cx
             WHERE cx.clinica_id = $1
               AND cx.dia = (r.recebido_em AT TIME ZONE $6)::date)`
    const formas = await c.query<{ forma: string; n: string; valor: string }>(
      `SELECT CASE WHEN r.forma = '' THEN 'Não informada' ELSE r.forma END AS forma,
              count(*)::text AS n,
              sum(r.valor)::text AS valor
         FROM tarefas t
         JOIN recebimentos r
           ON r.tarefa_id = t.id AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
        WHERE t.clinica_id = $1
          AND t.excluida_em IS NULL
          AND t.status = 'concluida'
          AND t.paciente_id IS NOT NULL
          AND t.concluida_em >= $2 AND t.concluida_em < $3
          AND ${EH_RECEITA}
          AND ${FECHADO}
        GROUP BY 1
        ORDER BY sum(r.valor) DESC`,
      argsDeForma,
    )

    /**
     * O RECORTE, DECLARADO: até que dia a tabela por forma alcança, e quantos
     * dias com recebimento ficaram de fora.
     *
     * Sem estes dois números a tabela parece o período inteiro, e a gestora
     * compara uma soma parcial com um total sem saber — que é pior do que não
     * ter a tabela.
     */
    const corte = await c.query<{ ate: string | null; sem_caixa: string }>(
      `WITH dias AS (
         SELECT DISTINCT (r.recebido_em AT TIME ZONE $6)::date AS dia,
                ${FECHADO} AS fechado
           FROM tarefas t
           JOIN recebimentos r
             ON r.tarefa_id = t.id AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
          WHERE t.clinica_id = $1
            AND t.excluida_em IS NULL
            AND t.status = 'concluida'
            AND t.paciente_id IS NOT NULL
            AND t.concluida_em >= $2 AND t.concluida_em < $3
            AND ${EH_RECEITA}
       )
       SELECT max(dia) FILTER (WHERE fechado)::text AS ate,
              count(*) FILTER (WHERE NOT fechado)::text AS sem_caixa
         FROM dias`,
      argsDeForma,
    )

    /**
     * POR TIPO DE CONTATO: duas contagens com recortes DIFERENTES na mesma
     * linha — "com prazo no período" e "concluídas no período".
     *
     * `FULL OUTER JOIN` e não um `JOIN`: um tipo pode ter prazo no período e
     * nenhuma conclusão (a tarefa atrasada), ou conclusão sem prazo no período
     * (a tarefa de setembro entregue em outubro). Com `JOIN`, cada um dos dois
     * casos some da tabela — e são justamente os dois que a gestora procura.
     */
    const porTipo = await c.query<{
      tipo: string
      com_prazo: string
      concluidas: string
      valor: string
    }>(
      `WITH com_prazo AS (
         SELECT t.tipo, count(*)::bigint AS n
           FROM tarefas t
          WHERE t.clinica_id = $1 AND t.excluida_em IS NULL
            AND t.status <> 'cancelada'
            AND t.paciente_id IS NOT NULL
            AND t.prazo >= $4::date AND t.prazo <= $5::date
          GROUP BY 1
       ), concluidas AS (
         SELECT t.tipo,
                count(*)::bigint AS n,
                coalesce(sum(r.valor), 0)::bigint AS valor
           FROM tarefas t
           LEFT JOIN recebimentos r
                  ON r.tarefa_id = t.id AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
          WHERE t.clinica_id = $1 AND t.excluida_em IS NULL
            AND t.status = 'concluida'
            AND t.paciente_id IS NOT NULL
            AND t.concluida_em >= $2 AND t.concluida_em < $3
          GROUP BY 1
       )
       SELECT coalesce(p.tipo, c2.tipo) AS tipo,
              coalesce(p.n, 0)::text AS com_prazo,
              coalesce(c2.n, 0)::text AS concluidas,
              coalesce(c2.valor, 0)::text AS valor
         FROM com_prazo p
         FULL OUTER JOIN concluidas c2 ON c2.tipo = p.tipo
        ORDER BY coalesce(c2.n, 0) DESC, coalesce(p.n, 0) DESC`,
      // Parâmetros próprios, pela mesma razão de `argsDeForma`: esta consulta
      // usa cinco dos oito de `args`, e um parâmetro declarado e não usado faz
      // o Postgres recusar o statement.
      [ctx.clinicaId, j.de, j.ate, periodo.de, periodo.ate],
    )

    /**
     * A CONVERSÃO DE ORÇAMENTOS, por **`acao` declarada** (ADR 0004).
     *
     * `registrarOrcamento` e `fechar` são as duas ações da jornada, e é a
     * mesma definição que `GET /v1/jornada` usa nos passos do funil — uma
     * regra, dois lugares que a leem. O protótipo soma aqui dois conjuntos
     * diferentes e conta de novo o que já contou; o `Math.min(100, …)` que ele
     * precisa pôr em volta é o sintoma.
     */
    const eventos = await c.query<{ acao: string; n: string }>(
      `SELECT ev->>'acao' AS acao, count(*)::text AS n
         FROM tarefas t
         CROSS JOIN LATERAL jsonb_array_elements(t.historico) ev
        WHERE t.clinica_id = $1
          AND t.excluida_em IS NULL
          AND ev->>'acao' = ANY($4::text[])
          AND (ev->>'em')::timestamptz >= $2
          AND (ev->>'em')::timestamptz <  $3
        GROUP BY 1`,
      [ctx.clinicaId, j.de, j.ate, ['registrarOrcamento', 'fechar']],
    )
    const quantos = (acao: string): number =>
      Number(eventos.rows.find((e) => e.acao === acao)?.n ?? '0')
    const enviados = quantos('registrarOrcamento')
    const fechados = quantos('fechar')

    const somaDasFormas = formas.rows.reduce((s2, f) => s2 + BigInt(f.valor), 0n)
    const receitaTexto = receita.centavos.toString()
    return {
      receita: receitaTexto,
      pagamentos,
      pacientesAtendidos: Number(t.atendidos),
      // **Pelo value object** (regra 1), e `null` sem pagamento nenhum:
      // `R$ 0,00` diria que o ticket médio é zero, e ele não existe.
      ticketMedio: pagamentos === 0 ? null : receita.media(pagamentos).centavos.toString(),
      contatos: Number(t.contatos),
      orcamentosPagos: Number(t.orc_qtd),
      valorDosOrcamentosPagos: t.orc_valor,
      orcamentosEnviados: enviados,
      conversaoDeOrcamentos:
        enviados === 0
          ? null
          : Math.min(100, percentualInteiro(BigInt(fechados), BigInt(enviados)) ?? 0),
      porForma: formas.rows.map((f) => ({
        forma: f.forma,
        pagamentos: Number(f.n),
        valor: f.valor,
        // O denominador é a soma DA TABELA, não a receita do período: as
        // fatias somam 100% do que a tabela mostra. Com a receita inteira
        // embaixo, a diferença até 100% seria o total dos dias ainda não
        // conferidos — o esperado chegando pela porta dos fundos.
        percentual: percentualInteiro(BigInt(f.valor), somaDasFormas),
      })),
      porFormaAteODia: corte.rows[0]?.ate ?? null,
      porFormaDiasSemCaixa: Number(corte.rows[0]?.sem_caixa ?? '0'),
      porTipo: porTipo.rows.map((x) => ({
        tipo: x.tipo,
        comPrazoNoPeriodo: Number(x.com_prazo),
        concluidasNoPeriodo: Number(x.concluidas),
        valor: x.valor,
      })),
    }
  }
}

// ---------------------------------------------------------------------------
// APOIO — nenhuma destas funções lê banco
// ---------------------------------------------------------------------------

/**
 * **AS BORDAS DO PERÍODO SÃO RESOLVIDAS AQUI, a partir do dia do SERVIDOR.**
 *
 * É o `intervalo()` dela, portado — com uma diferença que importa: `today()`
 * ali é o relógio do NAVEGADOR (regra 24). O computador de balcão com a data
 * errada abre "este mês" no mês que não é, e a gestora compara dois números de
 * períodos diferentes sem nada avisando.
 *
 * Aritmética de CALENDÁRIO, sem `Date` local: `somarMeses` e `fimDoMes` já
 * existem e já respeitam a regra 25 (dia 31 no mês curto).
 */
function bordasDoPeriodo(
  filtro: FiltroDoPainel,
  hoje: string,
): { chave: FiltroDoPainel['periodo']; rotulo: string; de: string; ate: string } {
  const rotuloFixo = (chave: string): string =>
    PERIODOS_DO_PAINEL.find((p) => p.chave === chave)?.rotulo ?? ''

  switch (filtro.periodo) {
    case '7d':
      // SETE dias INCLUSIVOS, e por isso `-6` e não `-7`: "últimos 7 dias" com
      // `-7` seriam oito dias, e o número não bate com o rótulo.
      return { chave: '7d', rotulo: 'Últimos 7 dias', de: somarDias(hoje, -6), ate: hoje }
    case '30d':
      return { chave: '30d', rotulo: 'Últimos 30 dias', de: somarDias(hoje, -29), ate: hoje }
    case 'mes': {
      const mes = hoje.slice(0, 7)
      return { chave: 'mes', rotulo: nomeDoMes(mes), de: `${mes}-01`, ate: fimDoMes(mes) }
    }
    case 'ant': {
      const mes = somarMeses(`${hoje.slice(0, 7)}-01`, -1).slice(0, 7)
      return { chave: 'ant', rotulo: nomeDoMes(mes), de: `${mes}-01`, ate: fimDoMes(mes) }
    }
    default:
      // `per`: o contrato já cobrou as duas datas e a ordem delas.
      return {
        chave: 'per',
        rotulo: rotuloFixo('per') === '' ? 'Período personalizado' : 'Período personalizado',
        de: filtro.de!,
        ate: filtro.ate!,
      }
  }
}

const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const

const nomeDoMes = (mes: string): string => MESES[Number(mes.slice(5, 7)) - 1] ?? ''

/**
 * As quatro situações mais a taxa.
 *
 * **O denominador da taxa é `ok + tarde + atrasada`, nunca o total.** O que
 * ainda não venceu não pode estar no prazo nem fora dele; incluí-lo faria a
 * taxa de quem planejou o mês inteiro despencar sem que nada tivesse
 * piorado. É o `base` dela, e é a mesma decisão de `tarefas_prazo`.
 */
function cumprimento(l: LinhaDePrazo): CumprimentoDePrazos {
  const noPrazo = Number(l.no_prazo)
  const comAtraso = Number(l.com_atraso)
  const atrasadas = Number(l.atrasadas)
  const base = noPrazo + comAtraso + atrasadas
  return {
    total: Number(l.total),
    noPrazo,
    comAtraso,
    atrasadas,
    aVencer: Number(l.a_vencer),
    // `null` sem denominador, nunca `0%`: `0%` acusa quem deixou tudo
    // atrasar, e `—` diz que nada venceu ainda.
    taxaNoPrazo: base === 0 ? null : percentualInteiro(BigInt(noPrazo), BigInt(base)),
  }
}
