import { recorteDeCaixa } from '../financeiro/faturamento-conferido'
import type {
  ConferenciaMedx,
  CumprimentoDePrazos,
  FiltroDoPainel,
  IndicadoraNoPainel,
  LinhaPorResponsavel,
  LinhaPorSolicitante,
  LinhaPorUnidade,
  NovosPacientes,
  Painel,
  PacientesNoPainel,
  RecorteDeCaixa,
  TopPagantes,
} from '@fir/contracts'
import { PERIODOS_DO_PAINEL } from '@fir/contracts'
import {
  conversaoDeOrcamentos,
  Dinheiro,
  TIPOS_DE_CONTATO,
  TIPOS_DE_RECEITA,
  TIPOS_PAGAVEIS,
  TIPOS_QUE_ATENDEM,
  TIPO_PAGAMENTO_DE_ORCAMENTO,
  fimDoMes,
  janela,
  percentualInteiro,
  residuoDeArredondamento,
  somarDias,
  somarMeses,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import type { Ator, PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { CampanhasService } from '../campanhas/campanhas.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { diaDaClinica } from '../estoque/dia-da-clinica'
import { DINHEIRO_QUE_ENTROU } from '../financeiro/dinheiro-que-entrou'
import { outrasEntradasDaJanela } from '../financeiro/outras-entradas.repositorio'
import { somaDoMedx } from '../integracoes/faturamento-lido'
import { ticketMedio, totaisDePacientes, totaisDosDiasQueContam } from './totais-de-pacientes'
import { diasQueAindaNaoContam, JA_ATENDIDO, LTV_DO_NOVO, ltvNosDias, ORIGEM_DO_PACIENTE, PACIENTE_NOVO_NA_JANELA } from './novos-pacientes'
import { indicadorasDaJanela } from './quem-mais-indica'
import { FORA_DE_PACIENTE_DESATIVADO } from '../tarefas/leitura'
import {
  TIPOS_DE_SESSAO,
  baseDeReceita,
  caixaFechado,
  contarConversaoDeOrcamentos,
  contarTarefasCriadas,
  consultarPrazos,
} from './metricas-diarias'

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
  readonly ator: Ator
  readonly fuso: string
  /** `pode('valores')`; repassado às campanhas (percentual de receita, regra 17). */
  readonly valores?: boolean
}

@Injectable()
export class PainelService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(CampanhasService) private readonly campanhas: CampanhasService,
  ) {}

  async painel(ctx: Contexto, filtro: FiltroDoPainel): Promise<Painel> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    const periodo = bordasDoPeriodo(filtro, hoje)

    /**
     * **As campanhas saem do `CampanhasService`, e não de um SELECT novo.**
     *
     * Elas vêm de FORA da transação do painel de propósito: `naClinica` abre a
     * conexão da clínica, e chamar outro serviço de dentro dela abriria uma
     * segunda — o bloco é leitura pura, e as sete contagens da campanha são
     * uma regra que já existe num lugar só.
     */
    const campanhas = await this.campanhas.noPeriodo(ctx, periodo.de, periodo.ate)

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const [prazos, criadas, solicitantes, pacientes, topPagantes, porUnidade, novos, indica] =
        await Promise.all([
          this.prazos(c, ctx, periodo, hoje),
          this.criadasNoPeriodo(c, ctx, periodo),
          this.porSolicitante(c, ctx, periodo),
          this.pacientes(c, ctx, periodo, hoje),
          this.topPagantes(c, ctx, periodo, filtro.top),
          this.porUnidade(c, ctx, periodo, hoje),
          this.novosPacientes(c, ctx, periodo, hoje),
          this.quemMaisIndica(c, ctx, periodo),
        ])
      const medx = await this.conferenciaMedx(c, ctx, periodo, hoje)

      return {
        hoje,
        periodo,
        prazos: prazos.total,
        criadasNoPeriodo: criadas,
        porResponsavel: prazos.porPessoa,
        porSolicitante: solicitantes,
        pacientes,
        topPagantes,
        porUnidade,
        novosPacientes: novos,
        campanhas,
        quemMaisIndica: indica,
        medx,
      }
    })
  }

  /**
   * **FATURAMENTO NO MEDX e CONFERÊNCIA MEDX × FIR** (spec integracao-medx
   * C.8, C.9; parecer de números N-B7, A8, A9).
   *
   * O lado FIR é `recebidosDaJanela`, a MESMA consulta do `recebido` da Visão
   * do mês (sem Outras entradas). O lado MedX é o único leitor do faturamento
   * lido. Os dois ficam lado a lado; nada aqui os soma.
   *
   * **Só entram dias com o caixa fechado** — totais, diferença e lista. O
   * total FIR de um dia aberto é o esperado do caixa dele, e o do MedX, na
   * clínica que lança nos dois sistemas, também (regra 6). Por isso este bloco
   * não usa `corteDeCaixa`, que olha os dias com recebimento na FIR: um dia
   * com pagamento só no MedX precisa do mesmo corte.
   */
  private async conferenciaMedx(
    c: pg.PoolClient,
    ctx: Contexto,
    periodo: { de: string; ate: string },
    hoje: string,
  ): Promise<ConferenciaMedx | null> {
    // O recorte é o de `recorteDeCaixa`: UMA função de "dia sem caixa" para o
    // Painel, a Visão do mês e o KPI (números B5, `dias-sem-caixa-uma-funcao`).
    const recorte = await recorteDeCaixa(c, ctx.clinicaId, periodo.de, periodo.ate, ctx.fuso, hoje)
    const { lido, fir, fechados, semCaixa } = recorte
    if (lido === null) return null
    const conferidos = recorte.dias.filter((d) => fechados.has(d))
    const medx = somaDoMedx(lido, conferidos)
    const recebidoNaFir = conferidos.reduce((s, d) => s.mais(fir.get(d) ?? Dinheiro.zero()), Dinheiro.zero())
    const diasComDiferenca = conferidos.flatMap((d) => {
      const diferenca = (lido.porDia.get(d)?.faturamento ?? Dinheiro.zero()).menos(fir.get(d) ?? Dinheiro.zero())
      return diferenca.ehZero() ? [] : [{ dia: d, diferencaMedxFir: diferenca.centavos.toString() }]
    })

    return {
      faturamentoNoMedx: medx.faturamento.centavos.toString(),
      recebidoNaFir: recebidoNaFir.centavos.toString(),
      diferencaMedxFir: medx.faturamento.menos(recebidoNaFir).centavos.toString(),
      totalExato: medx.exatoEmDezmilesimos.toString(),
      arredondamentoDoMedx: residuoDeArredondamento(medx.faturamento.centavos, medx.exatoEmDezmilesimos).toString(),
      diasComDiferenca,
      recorte: { ateODia: conferidos.at(-1) ?? null, diasSemCaixa: semCaixa.length },
      leituraIncompleta: !lido.coberturaCompleta,
      lidoEm: lido.lidoEm === null ? null : lido.lidoEm.toISOString(),
    }
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
    // Extraída para `./metricas-diarias` (G4, plano §7): o job de telemetria
    // da carteira (`carteira/jobs/uso-diario-cliente.ts`) precisa da MESMA
    // consulta para um único dia, e uma segunda cópia é a que diverge no
    // primeiro ajuste que só uma das duas recebesse.
    return consultarPrazos(c, ctx.clinicaId, periodo, hoje, ctx.fuso)
  }

  private async criadasNoPeriodo(
    c: pg.PoolClient,
    ctx: Contexto,
    periodo: { de: string; ate: string },
  ): Promise<number> {
    return contarTarefasCriadas(c, ctx.clinicaId, periodo, ctx.fuso)
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
    hoje: string,
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

    // As contagens da tabela: a MESMA função dos KPIs (I-7), na janela inteira.
    const t = await totaisDePacientes(c, ctx.clinicaId, j)
    // O DINHEIRO, só nos dias que contam (regra 6; D-I3): hoje com o caixa
    // aberto, e o dia do mês corrente ainda sem caixa, são o esperado da gaveta.
    // A MESMA função do relatório 13 e dos KPIs `ticket_medio` e
    // `valor_fechado_em_orcamentos`: os quatro dão o mesmo número.
    const { totais: m, dias } = await totaisDosDiasQueContam(c, ctx.clinicaId, periodo, ctx.fuso, hoje)
    const contam = dias.corte.dias
    const receita = m.receita
    const pagamentos = m.pagamentos

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
     * `forma = ''` ACONTECE, e o épico 9 confirmou: a v20 só passou a pedir a
     * forma na v17, e `migrarPagamentos()` grava `''` de propósito. O `CASE`
     * para "Não informada" era "o cinto do dado migrado" e passou a ser o
     * caminho normal dele — a migration 0021 relaxou
     * `recebimento_forma_so_com_dinheiro` justamente para aceitar o fato.
     * Aqui ele APARECE, com nome, porque este bloco é informativo e já está
     * atrás do corte do caixa fechado; o que ele **não** pode fazer é entrar no
     * esperado de um caixa ABERTO, e é disso que `NA_GAVETA` cuida no
     * `caixa.service`.
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
    // O MESMO corte dos blocos novos, e a mesma função: o `EXISTS` escrito
    // duas vezes é a chance de um dos dois perder o `AT TIME ZONE` da clínica.
    const FECHADO = caixaFechado('$1', '$6')
    const formas = await c.query<{ forma: string; n: string; valor: string }>(
      // POR PARTE (fatia 4.1): `sum(parte.valor)` e `count(DISTINCT r.id)` — o
      // recebimento de Pix 300 + Dinheiro 200 aparece uma vez em cada forma, e a
      // soma das fatias continua sendo a receita da tabela.
      `SELECT CASE WHEN pt.forma = '' THEN 'Não informada' ELSE pt.forma END AS forma,
              count(DISTINCT r.id)::text AS n,
              sum(pt.valor)::text AS valor
         FROM tarefas t
         JOIN recebimentos r
           ON r.tarefa_id = t.id AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
         JOIN recebimento_partes pt
           ON pt.recebimento_id = r.id AND pt.clinica_id = r.clinica_id
        WHERE t.clinica_id = $1
          AND t.excluida_em IS NULL
          AND t.status = 'concluida'
          AND t.paciente_id IS NOT NULL
          AND t.concluida_em >= $2 AND t.concluida_em < $3
          AND ${EH_RECEITA}
          AND ${FECHADO}
        GROUP BY 1
        ORDER BY sum(pt.valor) DESC`,
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
                coalesce(sum(r.valor) FILTER (
                  WHERE ((t.concluida_em AT TIME ZONE $7)::date)::text = ANY($6::text[])), 0)::bigint AS valor
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
      [ctx.clinicaId, j.de, j.ate, periodo.de, periodo.ate, [...contam], ctx.fuso],
    )

    // A CONVERSÃO DE ORÇAMENTOS, por `acao` declarada (ADR 0004) — extraída
    // para `./metricas-diarias` pela mesma razão de `consultarPrazos`: o job
    // de telemetria da carteira (G4) precisa da mesma definição para um
    // único dia.
    const { enviados, fechados } = await contarConversaoDeOrcamentos(c, ctx.clinicaId, j)

    const somaDasFormas = formas.rows.reduce((s2, f) => s2 + BigInt(f.valor), 0n)
    const receitaTexto = receita.centavos.toString()
    // As OUTRAS ENTRADAS da janela, em linha própria: nunca somadas à receita.
    // Também só dos dias que contam: a outra entrada de hoje está na mesma gaveta.
    const diasQueContam = new Set(contam)
    const outras = (await outrasEntradasDaJanela(c, ctx.clinicaId, j, ctx.fuso)).filter((x) => diasQueContam.has(x.dia))
    return {
      receita: receitaTexto,
      pagamentos,
      outrasEntradas: outras.reduce((s2, x) => s2.mais(x.valor), Dinheiro.zero()).centavos.toString(),
      quantidadeDeOutrasEntradas: outras.length,
      pacientesAtendidos: t.atendidos,
      // **Pelo value object** (regra 1), e `null` sem pagamento nenhum:
      // `R$ 0,00` diria que o ticket médio é zero, e ele não existe.
      ticketMedio: ticketMedio(m)?.centavos.toString() ?? null,
      contatos: t.contatos,
      orcamentosPagos: t.orcamentosPagos,
      valorDosOrcamentosPagos: m.valorDosOrcamentosPagos.centavos.toString(),
      orcamentosEnviados: enviados,
      // A regra (com o limite de 100) é do domínio, a MESMA do KPI (números c.1).
      conversaoDeOrcamentos: conversaoDeOrcamentos(enviados, fechados),
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

  /**
   * **O CORTE DE CAIXA FECHADO, numa função só** (regra 6).
   *
   * `janela === null` é "a história inteira" — o modo *desde o início* do Top
   * 10. Com janela, é o período do painel.
   *
   * Os dois números que ele devolve são o que DECLARA o recorte: até que dia a
   * soma alcança, e quantos dias com recebimento ficaram de fora. Sem eles a
   * tabela parece a janela inteira, e a gestora compara uma soma parcial com
   * um total sem saber — que é pior do que não ter a tabela.
   *
   * **Uma função e não o `WITH dias` copiado em cada bloco novo:** o quarto
   * bloco não é revisado com o cuidado do primeiro, e é nele que o `EXISTS`
   * some.
   */
  private async corteDeCaixa(
    c: pg.PoolClient,
    ctx: Contexto,
    /** Instantes UTC, semiaberta `[de, ate)` (regra 23). `null` = tudo. */
    janela: { de: Date; ate: Date } | null,
  ): Promise<RecorteDeCaixa> {
    const args: unknown[] = [ctx.clinicaId, ctx.fuso, [...TIPOS_DE_RECEITA], [...TIPOS_PAGAVEIS]]
    if (janela !== null) args.push(janela.de, janela.ate)
    const r = await c.query<{ ate: string | null; sem_caixa: string }>(
      `WITH dias AS (
         SELECT DISTINCT (r.recebido_em AT TIME ZONE $2)::date AS dia,
                ${caixaFechado('$1', '$2')} AS fechado
           FROM tarefas t
           JOIN recebimentos r
             ON r.tarefa_id = t.id AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
          WHERE ${baseDeReceita('$1', '$3', '$4')}
            ${janela === null ? '' : 'AND t.concluida_em >= $5 AND t.concluida_em < $6'}
       )
       SELECT max(dia) FILTER (WHERE fechado)::text AS ate,
              count(*) FILTER (WHERE NOT fechado)::text AS sem_caixa
         FROM dias`,
      args,
    )
    return {
      ateODia: r.rows[0]?.ate ?? null,
      diasSemCaixa: Number(r.rows[0]?.sem_caixa ?? '0'),
    }
  }

  /**
   * **TOP 10 PAGANTES** — *"no período do Painel ou desde o início"*.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * ELE PASSA PELO CORTE DE CAIXA FECHADO, E É O MESMO MOTIVO DO `porForma`
   *
   * Um ranking por paciente numa janela de **um dia** é a soma daquele dia por
   * outro agrupamento — e a janela é escolhida por quem olha (`per` com
   * `de = ate = hoje`). Sem o `EXISTS` em `caixas_do_dia`, a recepcionista que
   * vai contar a gaveta abre o Painel, escolhe hoje, e lê o que o sistema
   * espera: a regra 6 furada pela porta dos fundos, com outra etiqueta.
   *
   * **O protótipo soma sem olhar caixa nenhum** (`top10Html`). Divergência
   * consciente, igual à do `porForma`.
   * ──────────────────────────────────────────────────────────────────────────
   *
   * A unidade é a **principal da paciente** (`p.unidadeId` dela), não a do
   * atendimento: a linha responde *"quem é esta paciente"*, e ela é de uma
   * unidade só.
   */
  private async topPagantes(
    c: pg.PoolClient,
    ctx: Contexto,
    periodo: { de: string; ate: string },
    modo: 'periodo' | 'tudo',
  ): Promise<TopPagantes> {
    const jan = modo === 'tudo' ? null : janela(periodo.de, periodo.ate, ctx.fuso)
    const args: unknown[] = [ctx.clinicaId, ctx.fuso, [...TIPOS_DE_RECEITA], [...TIPOS_PAGAVEIS]]
    if (jan !== null) args.push(jan.de, jan.ate)

    const [itens, recorte] = await Promise.all([
      c.query<{ id: string; nome: string; unidade: string; n: string; valor: string }>(
        `SELECT t.paciente_id::text AS id,
                max(pa.nome) AS nome,
                coalesce(max(u.nome), '') AS unidade,
                count(*)::text AS n,
                sum(r.valor)::text AS valor
           FROM tarefas t
           JOIN recebimentos r
             ON r.tarefa_id = t.id AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
           JOIN pacientes pa ON pa.id = t.paciente_id
           LEFT JOIN unidades u ON u.id = pa.unidade_id
          WHERE ${baseDeReceita('$1', '$3', '$4')}
            AND ${caixaFechado('$1', '$2')}
            ${jan === null ? '' : 'AND t.concluida_em >= $5 AND t.concluida_em < $6'}
          GROUP BY t.paciente_id
          -- O desempate pelo NOME não é zelo: sem ele, duas pacientes com a
          -- mesma soma trocam de posição entre dois carregamentos do mesmo
          -- dado, e o "top 3" muda sozinho na tela.
          ORDER BY sum(r.valor) DESC, max(pa.nome) ASC
          LIMIT 10`,
        args,
      ),
      this.corteDeCaixa(c, ctx, jan),
    ])

    return {
      modo,
      recorte,
      itens: itens.rows.map((l) => ({
        pacienteId: l.id,
        nome: l.nome,
        unidade: l.unidade,
        pagamentos: Number(l.n),
        valor: l.valor,
      })),
    }
  }

  /**
   * **DESEMPENHO POR UNIDADE** — uma consulta, seis recortes diferentes.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * A UNIDADE DE UM ATENDIMENTO É A DA TAREFA E, SEM ELA, A DA PACIENTE
   *
   * É o `unidadeDaTarefa` dela (`t.unidadeId || pac.unidadeId`). Sem o segundo
   * termo, a clínica que nunca troca a unidade no atendimento — o caso normal,
   * porque o campo já vem preenchido pela paciente — veria **todo** o
   * faturamento em "Sem unidade", e a tabela que existe para comparar os dois
   * endereços mostraria um só.
   * ──────────────────────────────────────────────────────────────────────────
   *
   * Cada bloco tem a SUA janela, e elas não são a mesma:
   *
   *   `pacientes` e `ltvMedio`  sem janela — é o cadastro e a vida da paciente
   *   `faturamento`             a janela do painel, **com o corte de caixa**
   *   `programasNovos`          a janela do painel (pela criação)
   *   `programasAtivos`         sem janela — é o estado de hoje
   *   `sessões`                 prazo na janela E já vencido
   *   `tarefasAtrasadas`        sem janela — é o que está parado agora
   *
   * **`ltvMedio` não passa pelo corte**, e é deliberado: LTV é o que a
   * paciente pagou na VIDA, não na janela — não é o esperado de dia nenhum, e
   * `/v1/pacientes` já o entrega por paciente com essa classificação escrita.
   *
   * **Vazio na clínica de um endereço só** (o `temUnidades()` dela): sem
   * unidade cadastrada, a tabela teria uma linha chamada "Sem unidade" e
   * nenhuma comparação.
   */
  private async porUnidade(
    c: pg.PoolClient,
    ctx: Contexto,
    periodo: { de: string; ate: string },
    hoje: string,
  ): Promise<LinhaPorUnidade[]> {
    const j = janela(periodo.de, periodo.ate, ctx.fuso)
    const r = await c.query<{
      id: string | null
      nome: string
      pacientes: string
      com_ltv: string
      soma_ltv: string
      pagamentos: string
      faturamento: string
      programas_novos: string
      programas_ativos: string
      sessoes: string
      faltas: string
      atrasadas: string
    }>(
      `WITH baldes AS (
         SELECT u.id, u.nome FROM unidades u WHERE u.clinica_id = $1
         UNION ALL
         -- "Sem unidade" é UM BALDE, não a ausência de balde: o atendimento
         -- lançado sem unidade tem de aparecer em algum lugar, senão o total
         -- da tabela não bate com o do painel e ninguém sabe por quê.
         SELECT NULL::uuid, 'Sem unidade'
       ),
       pacientes_da_unidade AS (
         SELECT pa.unidade_id AS uid,
                count(*)::bigint AS pacientes,
                count(*) FILTER (WHERE ltv.valor > 0)::bigint AS com_ltv,
                coalesce(sum(ltv.valor) FILTER (WHERE ltv.valor > 0), 0)::bigint AS soma_ltv
           FROM pacientes pa
           CROSS JOIN LATERAL (
             -- A MESMA definição de LTV de pacientes.service.ts: soma de
             -- recebimentos com a constante da D-9, sem a venda a prazo.
             SELECT coalesce(sum(r.valor), 0) AS valor
               FROM recebimentos r
              WHERE r.paciente_id = pa.id AND r.estornado_em IS NULL
                AND ${DINHEIRO_QUE_ENTROU}
           ) ltv
          WHERE pa.clinica_id = $1 AND pa.ativo
          GROUP BY 1
       ),
       faturamento AS (
         SELECT coalesce(t.unidade_id, pa.unidade_id) AS uid,
                count(*)::bigint AS pagamentos,
                sum(r.valor)::bigint AS valor
           FROM tarefas t
           JOIN recebimentos r
             ON r.tarefa_id = t.id AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
           JOIN pacientes pa ON pa.id = t.paciente_id
          WHERE ${baseDeReceita('$1', '$9', '$10')}
            AND t.concluida_em >= $5 AND t.concluida_em < $6
            AND ${caixaFechado('$1', '$2')}
          GROUP BY 1
       ),
       programas_da_unidade AS (
         SELECT coalesce(pr.unidade_id, pa.unidade_id) AS uid,
                count(*) FILTER (WHERE pr.criado_em >= $5 AND pr.criado_em < $6)::bigint AS novos,
                count(*) FILTER (
                  WHERE pr.situacao = 'ativo'
                    AND EXISTS (SELECT 1 FROM tarefas s
                                 WHERE s.programa_id = pr.id AND s.status = 'aberta'
                                   AND s.excluida_em IS NULL
                                   AND s.tipo = ANY($7::text[]))
                )::bigint AS ativos
           FROM programas pr
           JOIN pacientes pa ON pa.id = pr.paciente_id
          WHERE pr.clinica_id = $1 AND pr.excluido_em IS NULL
          GROUP BY 1
       ),
       sessoes_da_unidade AS (
         SELECT coalesce(t.unidade_id, pa.unidade_id) AS uid,
                count(*)::bigint AS previstas,
                -- FALTA é "não aconteceu na data": continua aberta, ou foi
                -- concluída depois do prazo. O dia da conclusão sai no fuso da
                -- CLÍNICA — com UTC, a sessão das 21h viraria falta.
                count(*) FILTER (
                  WHERE t.status = 'aberta'
                     OR (t.concluida_em AT TIME ZONE $2)::date > t.prazo
                )::bigint AS faltas
           FROM tarefas t
           JOIN pacientes pa ON pa.id = t.paciente_id
          WHERE t.clinica_id = $1 AND t.excluida_em IS NULL
            AND t.status <> 'cancelada'
            AND t.tipo = ANY($7::text[])
            AND t.prazo >= $3::date AND t.prazo <= $4::date
            -- Só o que JÁ venceu: a sessão de semana que vem não é falta.
            AND t.prazo < $8::date
          GROUP BY 1
       ),
       atrasadas_da_unidade AS (
         SELECT coalesce(t.unidade_id, pa.unidade_id) AS uid, count(*)::bigint AS atrasadas
           FROM tarefas t
           JOIN pacientes pa ON pa.id = t.paciente_id
          WHERE t.clinica_id = $1 AND t.excluida_em IS NULL
            AND t.status = 'aberta' AND t.prazo < $8::date
            AND ${FORA_DE_PACIENTE_DESATIVADO}
            AND t.tipo <> ALL($7::text[])
          GROUP BY 1
       )
       SELECT b.id::text AS id, b.nome,
              coalesce(p.pacientes, 0)::text AS pacientes,
              coalesce(p.com_ltv, 0)::text AS com_ltv,
              coalesce(p.soma_ltv, 0)::text AS soma_ltv,
              coalesce(f.pagamentos, 0)::text AS pagamentos,
              coalesce(f.valor, 0)::text AS faturamento,
              coalesce(g.novos, 0)::text AS programas_novos,
              coalesce(g.ativos, 0)::text AS programas_ativos,
              coalesce(s.previstas, 0)::text AS sessoes,
              coalesce(s.faltas, 0)::text AS faltas,
              coalesce(a.atrasadas, 0)::text AS atrasadas
         FROM baldes b
         LEFT JOIN pacientes_da_unidade p ON p.uid IS NOT DISTINCT FROM b.id
         LEFT JOIN faturamento f           ON f.uid IS NOT DISTINCT FROM b.id
         LEFT JOIN programas_da_unidade g  ON g.uid IS NOT DISTINCT FROM b.id
         LEFT JOIN sessoes_da_unidade s    ON s.uid IS NOT DISTINCT FROM b.id
         LEFT JOIN atrasadas_da_unidade a  ON a.uid IS NOT DISTINCT FROM b.id
        -- IS NOT DISTINCT FROM e não =: com =, a linha "Sem unidade"
        -- (NULL) nunca casaria com o grupo NULL das métricas, e tudo o que
        -- foi lançado sem unidade sairia como zero.
        ORDER BY (b.id IS NULL), b.nome`,
      [
        ctx.clinicaId,
        ctx.fuso,
        periodo.de,
        periodo.ate,
        j.de,
        j.ate,
        TIPOS_DE_SESSAO,
        hoje,
        [...TIPOS_DE_RECEITA],
        [...TIPOS_PAGAVEIS],
      ],
    )

    /**
     * **A CLÍNICA DE UM ENDEREÇO SÓ NÃO VÊ ESTE BLOCO** — é o `temUnidades()`
     * dela, e a decisão mora aqui e não na tela: a tabela de uma linha
     * chamada "Sem unidade" não compara nada com nada, e a tela que a
     * recebesse precisaria de um `if` para esconder um bloco que o servidor
     * não devia ter montado.
     *
     * Medido: sem isto, a clínica sem unidade cadastrada abre o painel e
     * encontra um bloco novo com o faturamento do período repetido.
     */
    if (!r.rows.some((l) => l.id !== null)) return []

    const linhas = r.rows.map((l) => {
      const previstas = Number(l.sessoes)
      const faltas = Number(l.faltas)
      const comLtv = Number(l.com_ltv)
      return {
        unidadeId: l.id,
        nome: l.nome,
        pacientes: Number(l.pacientes),
        pagamentos: Number(l.pagamentos),
        faturamento: l.faturamento,
        // **PELO VALUE OBJECT** (regra 1), e `null` sem ninguém que pagou:
        // `R$ 0,00` diria que o LTV médio é zero, e ele não existe.
        ltvMedio:
          comLtv === 0
            ? null
            : Dinheiro.deCentavos(BigInt(l.soma_ltv)).media(comLtv).centavos.toString(),
        programasNovos: Number(l.programas_novos),
        programasAtivos: Number(l.programas_ativos),
        sessoesPrevistas: previstas,
        sessoesComFalta: faltas,
        taxaDeFalta: previstas === 0 ? null : percentualInteiro(BigInt(faltas), BigInt(previstas)),
        tarefasAtrasadas: Number(l.atrasadas),
      }
    })

    /**
     * A linha "Sem unidade" só fica se tiver o que mostrar; a unidade
     * CADASTRADA fica sempre, mesmo vazia — é informação que ela existe e não
     * teve movimento.
     */
    return linhas.filter(
      (l) =>
        l.unidadeId !== null ||
        l.pacientes > 0 ||
        l.pagamentos > 0 ||
        l.programasNovos > 0 ||
        l.programasAtivos > 0 ||
        l.sessoesPrevistas > 0 ||
        l.tarefasAtrasadas > 0,
    )
  }

  /**
   * **NOVOS PACIENTES POR ORIGEM** — pela data de CADASTRO.
   *
   * É o quarto recorte do painel, e nenhum dos outros três serve: não é o
   * prazo (prazos), não é a conclusão (pacientes), não é a criação da tarefa
   * (quem solicitou). *"Pela data de cadastro na ferramenta"*, como a nota da
   * tela dela diz.
   *
   * `ltvTotal` é a soma do LTV dessas pacientes — a mesma definição de
   * `pacientes.service.ts`, sem janela (é o que elas pagaram na vida), MENOS
   * os dias do mês corrente que ainda não contam (`diasQueAindaNaoContam`).
   *
   * Só paciente **ativa**: um cadastro feito por engano e desativado não é
   * uma paciente nova, e deixá-lo aqui faria a origem "Instagram" crescer com
   * o erro de digitação de alguém.
   */
  private async novosPacientes(
    c: pg.PoolClient,
    ctx: Contexto,
    periodo: { de: string; ate: string },
    hoje: string,
  ): Promise<NovosPacientes> {
    const j = janela(periodo.de, periodo.ate, ctx.fuso)
    // O LTV é a vida, MENOS os dias do mês corrente que ainda não contam: com
    // uma paciente nova só na origem, o LTV dela seria o pagamento de hoje — o
    // esperado da gaveta (regra 6). A mesma conta da receita do relatório 6.
    const naoContam = await diasQueAindaNaoContam(c, ctx.clinicaId, ctx.fuso, hoje)
    const r = await c.query<{
      origem: string
      novos: string
      atendidos: string
      ltv: string
    }>(
      `SELECT ${ORIGEM_DO_PACIENTE} AS origem,
              count(*)::text AS novos,
              count(*) FILTER (WHERE ${JA_ATENDIDO})::text AS atendidos,
              coalesce(sum(ltv.valor - aguarda.valor), 0)::text AS ltv
         FROM pacientes pa
         CROSS JOIN LATERAL (${LTV_DO_NOVO}) ltv
         CROSS JOIN LATERAL (${ltvNosDias('$5', '$6')}) aguarda
        WHERE ${PACIENTE_NOVO_NA_JANELA}
        GROUP BY 1
        ORDER BY count(*) DESC, 1 ASC`,
      [ctx.clinicaId, j.de, j.ate, [...TIPOS_QUE_ATENDEM], naoContam, ctx.fuso],
    )

    const porOrigem = r.rows.map((l) => ({
      origem: l.origem,
      novos: Number(l.novos),
      jaAtendidos: Number(l.atendidos),
      ltvTotal: l.ltv,
    }))
    return {
      // DERIVADO da soma das linhas, não uma segunda contagem: um `count(*)`
      // à parte é a chance de o total não bater com a tabela embaixo dele.
      total: porOrigem.reduce((n, o) => n + o.novos, 0),
      porOrigem,
    }
  }

  /**
   * **QUEM MAIS INDICA** (correções da PO, B3) — pela data de CADASTRO da
   * indicada, a mesma janela de `novosPacientes`.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * CONTA PACIENTES, NÃO LINHAS (N-19)
   *
   * A consulta lê só `pacientes`, as duas pontas do vínculo, e conta
   * `count(DISTINCT indicada)`. Nenhum `JOIN` com `tarefas` ou `recebimentos`:
   * com ele, a indicada com 12 sessões pagas viraria 12 indicações. Se a
   * receita das indicadas entrar um dia, ela vem de uma subconsulta agregada
   * POR INDICADA, com `baseDeReceita` e o corte de caixa (N-22), e só então
   * entra aqui.
   * ──────────────────────────────────────────────────────────────────────────
   *
   * Só por `indicado_por_id`: o texto livre de `indicado_por` não diz, sem
   * homônimo, quem é a pessoa (N-20, L-B2-4).
   *
   * Indicadora **ativa** apenas (L-B3-3); a indicada desativada conta, porque
   * o cadastro aconteceu na janela e desativar é estado (N-20).
   *
   * `clinica_id = $1` nas DUAS pontas além da RLS (S-39): o ranking só tem
   * paciente da clínica, mesmo que um vínculo antigo apontasse para fora.
   *
   * Desempate `nome, id` ANTES do `LIMIT` (N-21): sem ele, duas indicadoras
   * empatadas trocam de lugar entre dois carregamentos, e a décima some e
   * volta sozinha.
   */
  private async quemMaisIndica(
    c: pg.PoolClient,
    ctx: Contexto,
    periodo: { de: string; ate: string },
  ): Promise<IndicadoraNoPainel[]> {
    // A consulta mora em `quem-mais-indica.ts`: o relatório 4 conta as mesmas.
    const r = await indicadorasDaJanela(c, ctx.clinicaId, janela(periodo.de, periodo.ate, ctx.fuso), 10)
    return r.map((l) => ({ pacienteId: l.pacienteId, nome: l.nome, indicadas: l.indicadas }))
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
