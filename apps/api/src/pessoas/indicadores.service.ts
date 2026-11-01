import {
  type IndicadorDeMeta,
  TIPO_PAGAMENTO_DE_ORCAMENTO,
  TIPOS_DE_CONTATO,
  TIPOS_DE_RECEITA,
  TIPOS_PAGAVEIS,
  fimDoMes,
  janela,
  percentualNoPrazo,
} from '@fir/domain'
import type pg from 'pg'
import { DINHEIRO_QUE_ENTROU } from '../financeiro/dinheiro-que-entrou'

/**
 * **OS 8 INDICADORES AUTOMÁTICOS (`IND_PES`) — contagens derivadas.**
 *
 * Nenhum deles é coluna (regra 11). Cada um é uma pergunta feita a
 * `tarefas`, `recebimentos` ou `contagens_de_estoque`, e **a definição de
 * cada um foi medida executando o `realizadoMeta` do protótipo** contra
 * fixtures construídas — não lida de relatório.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS OITO DEFINIÇÕES, UMA LINHA CADA
 *
 *  1. `agendamentos`    eventos de `historico` com **`acao = 'agendar'`**,
 *                       feitos por ela, com `em` no mês.
 *  2. `confirmacoes`    idem, com **`acao = 'confirmar'`**.
 *  3. `contatos`        tarefas CONCLUÍDAS por ela no mês, **com paciente**,
 *                       cujo tipo não atende, não é receita e não é
 *                       recebimento.
 *  4. `orc_qtd`         tarefas concluídas por ela no mês de tipo
 *                       *Pagamento de orçamento*.
 *  5. `orc_valor`       a soma, em CENTAVOS, do que ENTROU nessas mesmas.
 *  6. `recebimentos`    tarefas concluídas por ela no mês, com paciente, que
 *                       são do grupo Pagamentos **ou** um atendimento pagável
 *                       com dinheiro que entrou.
 *  7. `tarefas_prazo`   **PERCENTUAL**: das tarefas dela com prazo no mês e
 *                       já vencido, não canceladas e que não são pagamento,
 *                       quantas foram concluídas até o prazo.
 *  8. `contagens_prazo` **PERCENTUAL**: das contagens de estoque dela com
 *                       prazo no mês e já vencido, quantas fecharam até o
 *                       prazo.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **CONTAR POR `acao` DECLARADA, NUNCA POR RÓTULO** (1 e 2). O protótipo filtra
 * `x.e === 'agendado' && !x.rot`: a etapa mais a ausência de um rótulo
 * customizado. Os quatro eventos que levam a `agendado` ou `orcamento` sem
 * contar no funil são exatamente os que ele marca com `rot` — medido, e é por
 * isso que a inferência dele funciona. Mas ela depende de um campo de TEXTO de
 * apresentação: o dia em que alguém traduzir "Reagendada" ou largar o rótulo,
 * quem remarcou três vezes vira três agendamentos e toda conversão do funil
 * cai sem que nada tenha piorado na clínica. Aqui a pergunta é `acao`, que é
 * declarada pela tabela de transições (ADR 0004).
 *
 * **ONDE DIVERGIMOS DO PROTÓTIPO, e é só um lugar: `contatos` exige
 * PACIENTE.** O indicador se chama *"Contatos com pacientes"*, e o `ehContato`
 * dele é `!atende && !receita && !recebimento` — um predicado que a tarefa
 * INTERNA satisfaz, porque ela tem `tipo = ''` e nenhuma flag. Medido: uma
 * tarefa "Fechar o caixa do dia" concluída no mês devolve `contatos: 1`. O
 * próprio painel dele não faz isso (`feitas.filter(t => t.pacienteId &&
 * ehContato(t))`), então a divergência é com UM dos dois lugares dele e a
 * concordância é com o outro. Sem a exigência, a meta de "20 contatos com
 * pacientes" é batida fechando o caixa vinte vezes. Nenhum dado da v20 depende
 * disto: os indicadores não existem no `Code.gs`.
 *
 * **A JANELA É SEMIABERTA, no fuso da CLÍNICA** (regra 23). `concluida_em` e o
 * `em` do evento são instantes; `prazo` e `contagens.prazo` são dias civis, e
 * para eles a comparação é de calendário — mês `[aaaa-mm-01, fimDoMes]`,
 * inclusivo nas duas pontas, porque não há instante nenhum ali.
 *
 * **Toda consulta filtra `clinica_id` ALÉM da RLS** (regra 19): a policy é a
 * primeira camada, não a única.
 */

/** O realizado de uma pessoa, por indicador. `null` = sem dado. */
export type RealizadoPorIndicador = Readonly<Partial<Record<IndicadorDeMeta, bigint | null>>>

export type ContextoDeIndicadores = {
  readonly clinicaId: string
  readonly fuso: string
  /** `aaaa-mm`. */
  readonly mes: string
  /** O dia da clínica, do SERVIDOR. É ele que fecha a janela dos percentuais. */
  readonly hoje: string
}

type LinhaDeEvento = { pessoa: string | null; acao: string; n: string }
type LinhaDeConclusao = {
  pessoa: string
  contatos: string
  orc_qtd: string
  orc_valor: string
  recebimentos: string
}
type LinhaDePrazo = { pessoa: string; total: string; no_prazo: string }

/**
 * O realizado dos oito, para TODAS as pessoas de uma vez.
 *
 * Quatro consultas, não oito por pessoa: a tela de Metas abre a equipe inteira,
 * e uma consulta por pessoa × indicador seria `N × 8` idas ao banco numa tela
 * que a gestora abre para olhar o mês. Os quatro recortes são quatro perguntas
 * de verdade — evento de jornada, tarefa concluída, prazo de tarefa, prazo de
 * contagem —, e agrupar mais que isso juntaria `WHERE`s incompatíveis.
 */
export async function realizadoDosIndicadores(
  c: pg.PoolClient,
  ctx: ContextoDeIndicadores,
): Promise<Map<string, RealizadoPorIndicador>> {
  const j = janela(`${ctx.mes}-01`, fimDoMes(ctx.mes), ctx.fuso)
  const porPessoa = new Map<string, Record<string, bigint | null>>()
  const guardar = (pessoa: string, chave: IndicadorDeMeta, valor: bigint | null): void => {
    const atual = porPessoa.get(pessoa)
    if (atual) atual[chave] = valor
    else porPessoa.set(pessoa, { [chave]: valor })
  }

  // ---------------------------------------------------------------------
  // 1 e 2 — `agendamentos` e `confirmacoes`: EVENTOS, por `acao` declarada.
  //
  // `CROSS JOIN LATERAL jsonb_array_elements` é a mesma varredura de
  // `funil.service.ts`, que foi medida com 100 mil tarefas: nenhum índice a
  // acelera, e o planejador escolhe `Parallel Seq Scan`.
  //
  // `porId` é QUEM FEZ a ação, não quem é responsável pelo cartão — é o
  // `x.por === uid` dela. Quem agendou a consulta ganha o agendamento, mesmo
  // que a consulta seja de outra.
  // ---------------------------------------------------------------------
  const eventos = await c.query<LinhaDeEvento>(
    `SELECT ev->>'porId' AS pessoa, ev->>'acao' AS acao, count(*)::text AS n
       FROM tarefas t
       CROSS JOIN LATERAL jsonb_array_elements(t.historico) ev
      WHERE t.clinica_id = $1
        AND t.excluida_em IS NULL
        AND ev->>'acao' = ANY($2)
        AND (ev->>'em')::timestamptz >= $3
        AND (ev->>'em')::timestamptz <  $4
      GROUP BY 1, 2`,
    [ctx.clinicaId, ['agendar', 'confirmar'], j.de, j.ate],
  )
  for (const l of eventos.rows) {
    if (l.pessoa === null) continue
    guardar(l.pessoa, l.acao === 'agendar' ? 'agendamentos' : 'confirmacoes', BigInt(l.n))
  }

  // ---------------------------------------------------------------------
  // 3 a 6 — as TAREFAS CONCLUÍDAS no mês, por responsável.
  //
  // Uma consulta com quatro `FILTER`, porque os quatro partem do mesmo
  // conjunto (`conc` dela): concluídas, dela, com `concluida_em` no mês.
  //
  // O `LEFT JOIN` em `recebimentos` carrega `DINHEIRO_QUE_ENTROU` — a
  // constante da D-9 — e é ele que faz duas coisas:
  //
  //   * `orc_valor` somar o que ENTROU, nunca a venda a prazo. Orçamento não é
  //     receita (regra 4): o que se soma aqui é o valor PAGO no fechamento, que
  //     é o `t.valor` do protótipo num tipo cujo rótulo é "Valor pago (R$)" —
  //     não o `valorOrcamento`, que nunca entra em meta.
  //   * `recebimentos` contar o atendimento PAGÁVEL só quando houve pagamento,
  //     que é o `(valor > 0 || formaPagamento)` dela. Um programa que fechou
  //     sem entrada não é um recebimento registrado.
  //
  // O `JOIN` não duplica linha: `recebimento_por_tarefa` garante no máximo um
  // recebimento vivo por tarefa (regra 3, em forma de índice).
  // ---------------------------------------------------------------------
  const concluidas = await c.query<LinhaDeConclusao>(
    `SELECT t.responsavel_id::text AS pessoa,
            count(*) FILTER (
              WHERE t.paciente_id IS NOT NULL AND t.tipo = ANY($4)
            )::text AS contatos,
            count(*) FILTER (WHERE t.tipo = $5)::text AS orc_qtd,
            coalesce(sum(r.valor) FILTER (WHERE t.tipo = $5), 0)::text AS orc_valor,
            count(*) FILTER (
              WHERE t.paciente_id IS NOT NULL
                AND (t.tipo = ANY($6) OR (t.tipo = ANY($7) AND r.id IS NOT NULL))
            )::text AS recebimentos
       FROM tarefas t
       LEFT JOIN recebimentos r
              ON r.tarefa_id = t.id
             AND r.estornado_em IS NULL
             AND ${DINHEIRO_QUE_ENTROU}
      WHERE t.clinica_id = $1
        AND t.excluida_em IS NULL
        AND t.status = 'concluida'
        AND t.concluida_em >= $2
        AND t.concluida_em <  $3
      GROUP BY 1`,
    [
      ctx.clinicaId,
      j.de,
      j.ate,
      [...TIPOS_DE_CONTATO],
      TIPO_PAGAMENTO_DE_ORCAMENTO,
      [...TIPOS_DE_RECEITA],
      [...TIPOS_PAGAVEIS],
    ],
  )
  for (const l of concluidas.rows) {
    guardar(l.pessoa, 'contatos', BigInt(l.contatos))
    guardar(l.pessoa, 'orc_qtd', BigInt(l.orc_qtd))
    guardar(l.pessoa, 'orc_valor', BigInt(l.orc_valor))
    guardar(l.pessoa, 'recebimentos', BigInt(l.recebimentos))
  }

  // ---------------------------------------------------------------------
  // 7 — `tarefas_prazo`: PERCENTUAL.
  //
  // O denominador é a parte que decide, e ele tem QUATRO condições:
  //
  //   * `prazo` no mês — o indicador é do mês do PRAZO, não da conclusão. Uma
  //     tarefa de outubro concluída em novembro conta no outubro dela, atrasada.
  //   * `prazo <= hoje` — o que ainda não venceu não pode estar atrasado, e
  //     incluí-lo afundaria o percentual de quem planejou o mês inteiro. `<=`,
  //     não `<`: a tarefa de HOJE já entra (medido).
  //   * `status <> 'cancelada'` — cancelar não é atrasar.
  //   * `tipo` não é pagamento — o lançamento de um pagamento tem prazo igual
  //     ao dia do caixa e distorceria a disciplina de quem recebe dinheiro.
  //
  // `Orçamento enviado` e `Sessão de plano` ENTRAM (medido no protótipo): só o
  // grupo Pagamentos sai.
  //
  // `(concluida_em AT TIME ZONE $fuso)::date <= prazo` é o `dia(t.concluidaEm)
  // <= t.prazo` dela, no fuso da CLÍNICA — com `AT TIME ZONE 'UTC'`, uma
  // conclusão às 21h de Salvador cairia no dia seguinte e viraria atraso.
  // ---------------------------------------------------------------------
  const prazoDeTarefas = await c.query<LinhaDePrazo>(
    `SELECT t.responsavel_id::text AS pessoa,
            count(*)::text AS total,
            count(*) FILTER (
              WHERE t.status = 'concluida'
                AND (t.concluida_em AT TIME ZONE $5)::date <= t.prazo
            )::text AS no_prazo
       FROM tarefas t
      WHERE t.clinica_id = $1
        AND t.excluida_em IS NULL
        AND t.status <> 'cancelada'
        AND t.prazo >= $2::date
        AND t.prazo <= $3::date
        AND t.prazo <= $4::date
        AND t.tipo <> ALL($6)
      GROUP BY 1`,
    [
      ctx.clinicaId,
      `${ctx.mes}-01`,
      fimDoMes(ctx.mes),
      ctx.hoje,
      ctx.fuso,
      [...TIPOS_DE_RECEITA],
    ],
  )
  for (const l of prazoDeTarefas.rows) {
    guardar(l.pessoa, 'tarefas_prazo', emPercentual(l))
  }

  // ---------------------------------------------------------------------
  // 8 — `contagens_prazo`: PERCENTUAL. A fonte existe desde o épico 6.
  //
  // `concluida_em` aqui é `date`, não instante — a contagem fecha num DIA
  // civil —, então a comparação é direta e não passa por fuso. `<=` inclusivo:
  // fechar no próprio dia do prazo é no prazo (medido).
  //
  // `contagens_de_estoque` não tem soft delete, e por isso não há
  // `excluida_em IS NULL` aqui. Uma contagem fechada é livro-razão.
  // ---------------------------------------------------------------------
  const prazoDeContagens = await c.query<LinhaDePrazo>(
    `SELECT ct.responsavel_id::text AS pessoa,
            count(*)::text AS total,
            count(*) FILTER (
              WHERE ct.situacao = 'concluida' AND ct.concluida_em <= ct.prazo
            )::text AS no_prazo
       FROM contagens_de_estoque ct
      WHERE ct.clinica_id = $1
        AND ct.prazo >= $2::date
        AND ct.prazo <= $3::date
        AND ct.prazo <= $4::date
      GROUP BY 1`,
    [ctx.clinicaId, `${ctx.mes}-01`, fimDoMes(ctx.mes), ctx.hoje],
  )
  for (const l of prazoDeContagens.rows) {
    guardar(l.pessoa, 'contagens_prazo', emPercentual(l))
  }

  return porPessoa as Map<string, RealizadoPorIndicador>
}

/**
 * O percentual de uma linha de prazo, pelo DOMÍNIO.
 *
 * `percentualNoPrazo` LANÇA quando `no_prazo > total` — e é deliberado que o
 * caminho de produção passe por essa porta: um `FILTER` que algum dia fique
 * mais largo que o `WHERE` estoura aqui, em vez de entregar 150% dentro de uma
 * barra de progresso onde ninguém olha duas vezes.
 */
function emPercentual(l: LinhaDePrazo): bigint | null {
  const p = percentualNoPrazo(Number(l.total), Number(l.no_prazo))
  return p === null ? null : BigInt(p)
}
