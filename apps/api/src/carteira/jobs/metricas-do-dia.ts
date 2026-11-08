import {
  type AcaoDeJornada,
  ETAPAS_EM_RECONTATO,
  TIPOS_DE_CONTATO,
  TIPOS_DE_RECEITA,
  TIPOS_PAGAVEIS,
} from '@fir/domain'
import type pg from 'pg'
import { DINHEIRO_QUE_ENTROU } from '../../financeiro/dinheiro-que-entrou'
import { TIPOS_DE_SESSAO } from '../../painel-geral/metricas-diarias'

const ACAO_DE_REAGENDAR: AcaoDeJornada = 'reagendar'

/**
 * **AS CONTAGENS DE `uso_diario_cliente` QUE NÃO TÊM FONTE JÁ EXTRAÍDA DO
 * PAINEL** (G4, migration `0028_carteira_telemetria_e_campanhas.sql`).
 *
 * As que JÁ existiam como consulta reaproveitável (prazos, criadas, conversão
 * de orçamento) moram em `painel-geral/metricas-diarias.ts` — é lá que o job
 * (`uso-diario-cliente.ts`) as busca, junto com as daqui.
 *
 * Nenhuma função toma decisão de QUANDO rodar nem de QUAL clínica: recebem
 * `clinicaId` e a janela já resolvidas, do mesmo jeito que
 * `painel-geral/metricas-diarias.ts` faz — o dia e o fuso são responsabilidade
 * de quem chama (`uso-diario-cliente.ts`), nunca desta camada.
 */

/**
 * **A RECEITA DO DIA, no universo do painel** (`ehReceita`): grupo Pagamentos
 * **ou** atendimento pagável com dinheiro na própria tarefa, de tarefa
 * concluída com paciente. A mesma definição de `painel.pacientes().receita` —
 * sem o corte de "caixa fechado" (regra 6), porque aquele corte protege só o
 * recebido POR FORMA (a conferência às cegas), e `receita_registrada` é o
 * mesmo número que o painel já mostra antes do fechamento do dia.
 *
 * Centavos, `bigint`, nunca `number` (regra 1): o `::text` no SQL evita que o
 * driver `pg` interprete o `numeric` do `sum(bigint)` como ponto flutuante.
 */
export async function somarReceitaRegistrada(
  c: pg.PoolClient,
  clinicaId: string,
  j: { de: Date; ate: Date },
): Promise<bigint> {
  const r = await c.query<{ receita: string }>(
    `SELECT coalesce(sum(r.valor) FILTER (
              WHERE t.tipo = ANY($4::text[]) OR (t.tipo = ANY($5::text[]) AND r.valor > 0)
            ), 0)::text AS receita
       FROM tarefas t
       LEFT JOIN recebimentos r
              ON r.tarefa_id = t.id AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
      WHERE t.clinica_id = $1
        AND t.excluida_em IS NULL
        AND t.status = 'concluida'
        AND t.paciente_id IS NOT NULL
        AND t.concluida_em >= $2 AND t.concluida_em < $3`,
    [clinicaId, j.de, j.ate, [...TIPOS_DE_RECEITA], [...TIPOS_PAGAVEIS]],
  )
  return BigInt(r.rows[0]!.receita)
}

/**
 * **TAREFAS CONCLUÍDAS NO DIA** — pela CONCLUSÃO, sem exigir paciente (ao
 * contrário de `contatos_pacientes`, que exige). Sessão de programa fica de
 * fora, mesma razão da regra documentada em `painel.service.ts`: doze
 * aplicações de uma paciente no mês não podem inflar doze "tarefas
 * concluídas" no indicador comercial do Cliente Firmare.
 */
export async function contarTarefasConcluidas(
  c: pg.PoolClient,
  clinicaId: string,
  j: { de: Date; ate: Date },
): Promise<number> {
  const r = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM tarefas t
      WHERE t.clinica_id = $1
        AND t.excluida_em IS NULL
        AND t.status = 'concluida'
        AND t.tipo <> ALL($4::text[])
        AND t.concluida_em >= $2 AND t.concluida_em < $3`,
    [clinicaId, j.de, j.ate, TIPOS_DE_SESSAO],
  )
  return Number(r.rows[0]!.n)
}

/**
 * **O BACKLOG VENCIDO, EM ABERTO — SNAPSHOT do fim do dia**, não um evento do
 * dia (comentário da migration 0028: não soma ao longo de um período sem
 * contar duas vezes a mesma tarefa aberta em dois dias seguidos). `diaSeguinte`
 * é o primeiro dia CIVIL que ainda não conta como vencido — a mesma borda que
 * `consultarPrazos` usa para separar `atrasadas` de `aVencer`.
 */
export async function contarTarefasVencidasAbertas(
  c: pg.PoolClient,
  clinicaId: string,
  diaSeguinte: string,
): Promise<number> {
  const r = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM tarefas t
      WHERE t.clinica_id = $1
        AND t.excluida_em IS NULL
        AND t.status = 'aberta'
        AND t.tipo <> ALL($3::text[])
        AND t.prazo < $2::date`,
    [clinicaId, diaSeguinte, TIPOS_DE_SESSAO],
  )
  return Number(r.rows[0]!.n)
}

/**
 * **CONTATOS COM PACIENTE, concluídos no dia** — `TIPOS_DE_CONTATO` é o
 * `ehContato` do domínio (não atende, não é receita, não é recebimento),
 * **exigindo paciente** — mesma divergência documentada do protótipo que
 * `indicadores.service.ts` já assumiu: sem a exigência, "Fechar o caixa do
 * dia" contaria como contato com paciente.
 */
export async function contarContatosDePacientes(
  c: pg.PoolClient,
  clinicaId: string,
  j: { de: Date; ate: Date },
): Promise<number> {
  const r = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM tarefas t
      WHERE t.clinica_id = $1
        AND t.excluida_em IS NULL
        AND t.status = 'concluida'
        AND t.paciente_id IS NOT NULL
        AND t.tipo = ANY($4::text[])
        AND t.concluida_em >= $2 AND t.concluida_em < $3`,
    [clinicaId, j.de, j.ate, [...TIPOS_DE_CONTATO]],
  )
  return Number(r.rows[0]!.n)
}

/**
 * **FALTAS — `noshow` e `desmarcar`, por `acao` declarada do histórico da
 * JORNADA** (ADR 0004), nunca um status inferido.
 *
 * É a MESMA dupla que já forma a coluna "Recontatar" do funil
 * (`funil.service.ts`, `etapas: ['faltou','desmarcou']`) e os dois primeiros
 * KPIs de `ACOES_DOS_KPIS` — decisão do dono já registrada no plano §9 (Q5:
 * "as duas contam"). `perder` (o terceiro KPI) fica de fora: significa a
 * paciente desistir, não faltar.
 *
 * A pergunta cruzada com o reagendamento subsequente é
 * `contarFaltasRecontatadas`, logo abaixo.
 */
export async function contarFaltas(
  c: pg.PoolClient,
  clinicaId: string,
  j: { de: Date; ate: Date },
): Promise<number> {
  const r = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM tarefas t
       CROSS JOIN LATERAL jsonb_array_elements(t.historico) ev
      WHERE t.clinica_id = $1
        AND t.excluida_em IS NULL
        AND ev->>'acao' = ANY($4::text[])
        AND (ev->>'em')::timestamptz >= $2
        AND (ev->>'em')::timestamptz <  $3`,
    [clinicaId, j.de, j.ate, ['noshow', 'desmarcar']],
  )
  return Number(r.rows[0]!.n)
}

/**
 * **FALTAS RECONTATADAS NO DIA** (decisão do dono, plano §9 itens 5/5b):
 * eventos `reagendar` do histórico da jornada que aconteceram na janela do
 * dia (fuso da clínica, semiaberta) e cuja etapa ANTERIOR — a do evento
 * imediatamente antes no histórico — era `faltou` ou `desmarcou`
 * (`ETAPAS_EM_RECONTATO`, a mesma dupla da coluna "Recontatar" do funil e de
 * `contarFaltas`). A data é a do REAGENDAMENTO, não a da falta: é o trabalho
 * de recontato que aconteceu no dia.
 *
 * "Etapa anterior" pelo evento anterior, e não por "houve um `noshow` em
 * algum momento": o cartão que faltou, foi reagendado, compareceu e depois
 * foi reagendado de novo a partir de `agendado` não é um segundo recontato.
 * Quem voltou a `faltou` por `reabrir` (de `encerrado`) também conta — o
 * evento `reabrir` grava `etapa: 'faltou'`.
 *
 * `ev.i > 1` não é enfeite: o índice de `jsonb` aceita negativo e conta do
 * FIM do array, então `historico -> -1` no primeiro evento leria o ÚLTIMO.
 */
export async function contarFaltasRecontatadas(
  c: pg.PoolClient,
  clinicaId: string,
  j: { de: Date; ate: Date },
): Promise<number> {
  const r = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM tarefas t
       CROSS JOIN LATERAL jsonb_array_elements(t.historico) WITH ORDINALITY AS ev(e, i)
      WHERE t.clinica_id = $1
        AND t.excluida_em IS NULL
        AND ev.e->>'acao' = $4
        AND (ev.e->>'em')::timestamptz >= $2
        AND (ev.e->>'em')::timestamptz <  $3
        AND ev.i > 1
        AND t.historico -> (ev.i - 2)::int ->> 'etapa' = ANY($5::text[])`,
    [clinicaId, j.de, j.ate, ACAO_DE_REAGENDAR, [...ETAPAS_EM_RECONTATO]],
  )
  return Number(r.rows[0]!.n)
}

/**
 * **USUÁRIOS CADASTRADOS e ATIVOS** — só CONTAGEM (regra de minimização,
 * ADR 0013 §2; comentário da migration 0028). Nunca nome nem e-mail.
 *
 * `cadastrados` é um SNAPSHOT de hoje: `pessoas.ativo` na clínica, no
 * instante em que o job roda — não há coluna de histórico de quando alguém
 * foi desativada, então um dia recalculado no PASSADO reflete quem está ativa
 * HOJE, não quem estava ativa naquele dia. É a mesma limitação que
 * `tarefas_vencidas_abertas` já tem por ser snapshot, e fica documentada aqui
 * pela mesma razão.
 *
 * `ativos` é LOGIN NO DIA (decisão do dono, plano §9, Q4: "opção A — login no
 * dia. Mais simples; evolui para 'ação registrada' só se a Firmare perceber
 * que login-sem-uso distorce o número") — pessoas DISTINTAS com `sessoes.
 * criada_em` na janela do dia.
 */
export async function contarUsuarios(
  c: pg.PoolClient,
  clinicaId: string,
  j: { de: Date; ate: Date },
): Promise<{ cadastrados: number; ativos: number }> {
  const [cadastrados, ativos] = await Promise.all([
    c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pessoas WHERE clinica_id = $1 AND ativo`,
      [clinicaId],
    ),
    c.query<{ n: string }>(
      `SELECT count(DISTINCT s.pessoa_id)::text AS n
         FROM sessoes s
        WHERE s.clinica_id = $1
          AND s.criada_em >= $2 AND s.criada_em < $3`,
      [clinicaId, j.de, j.ate],
    ),
  ])
  return { cadastrados: Number(cadastrados.rows[0]!.n), ativos: Number(ativos.rows[0]!.n) }
}
