import type { CumprimentoDePrazos, LinhaPorResponsavel } from '@fir/contracts'
import { TIPOS, janela, percentualInteiro } from '@fir/domain'
import type pg from 'pg'

/**
 * **AS CONSULTAS DE `PainelService` QUE O JOB DE TELEMETRIA DA CARTEIRA
 * REAPROVEITA** (G4, plano §7) — extraídas aqui porque passaram a ter DOIS
 * chamadores: a tela "Gestão › Painel geral" (período escolhido pela
 * gestora) e `carteira/jobs/uso-diario-cliente.ts` (um único dia, escolhido
 * pelo job).
 *
 * A regra que isto protege é a da arquitetura (CLAUDE.md §5): "cada regra
 * existe uma vez". Sem a extração, `uso_diario_cliente.tarefas_no_prazo`
 * nasceria com uma SEGUNDA cópia do `GROUPING SETS` de `cumprimento()`, e as
 * duas copias divergiriam no primeiro ajuste que só uma delas recebesse —
 * exatamente o defeito que o legado tinha com a mesma regra escrita em três
 * lugares (front, `demoApiBase`, `Code.gs`).
 *
 * Nenhuma função aqui lê `ClinicaId`/`Contexto` do painel: recebem
 * `clinicaId: string` e `fuso: string` soltos, porque o chamador da carteira
 * não tem (nem deve ter) um `Contexto` do painel geral — só uma clínica e um
 * fuso, lidos de `clientes_carteira`/`clinicas`.
 */

/** O nome do tipo de sessão de programa, para o `<> ALL` do SQL — ver `ehSessao`. */
export const TIPOS_DE_SESSAO = TIPOS.filter((t) => t.sessao === true).map((t) => t.nome)

export type LinhaDePrazo = {
  pessoa: string | null
  nome: string | null
  funcao: string | null
  total: string
  no_prazo: string
  com_atraso: string
  atrasadas: string
  a_vencer: string
}

/**
 * As quatro situações mais a taxa.
 *
 * **O denominador da taxa é `ok + tarde + atrasada`, nunca o total.** O que
 * ainda não venceu não pode estar no prazo nem fora dele; incluí-lo faria a
 * taxa de quem planejou o mês inteiro despencar sem que nada tivesse
 * piorado.
 */
export function cumprimento(l: LinhaDePrazo): CumprimentoDePrazos {
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

/**
 * O CUMPRIMENTO DE PRAZOS, no total e por responsável — **uma consulta**.
 *
 * `GROUPING SETS` dá o total e o recorte por pessoa de uma vez: duas
 * consultas sobre o mesmo `WHERE` são duas chances de os filtros divergirem.
 *
 * As quatro situações são o `situacao()` do protótipo, com `grupoPrazo`
 * colapsando `hoje` e `aberta` em `a vencer`:
 *
 *   `ok`        concluída, e o dia da conclusão `<=` o prazo
 *   `tarde`     concluída, e o dia da conclusão `>` o prazo
 *   `atrasada`  aberta, e o prazo já passou
 *   `a vencer`  aberta, e o prazo é hoje ou depois
 *
 * O dia da conclusão sai no FUSO DA CLÍNICA (regra 22). `periodo` aceita
 * `de === ate`: é exatamente o caso de uso do job da carteira, um único dia.
 */
export async function consultarPrazos(
  c: pg.PoolClient,
  clinicaId: string,
  periodo: { de: string; ate: string },
  hoje: string,
  fuso: string,
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
    [clinicaId, periodo.de, periodo.ate, hoje, fuso, TIPOS_DE_SESSAO],
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

/**
 * As tarefas CRIADAS num período — pela data de CRIAÇÃO, janela de
 * INSTANTES semiaberta `[de, ate)` no fuso da clínica (regra 23).
 */
export async function contarTarefasCriadas(
  c: pg.PoolClient,
  clinicaId: string,
  periodo: { de: string; ate: string },
  fuso: string,
): Promise<number> {
  const j = janela(periodo.de, periodo.ate, fuso)
  const r = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM tarefas t
      WHERE t.clinica_id = $1 AND t.excluida_em IS NULL
        AND t.tipo <> ALL($4::text[])
        AND t.criada_em >= $2 AND t.criada_em < $3`,
    [clinicaId, j.de, j.ate, TIPOS_DE_SESSAO],
  )
  return Number(r.rows[0]!.n)
}

/**
 * A CONVERSÃO DE ORÇAMENTOS, por **`acao` declarada** (ADR 0004) — não por
 * um tipo "fechado" que o protótipo infere do rótulo.
 *
 * `registrarOrcamento` e `fechar` são as duas ações da jornada, e é a mesma
 * definição que `GET /v1/jornada` usa nos passos do funil — uma regra, dois
 * lugares que a leem (agora três, com o job da carteira).
 */
export async function contarConversaoDeOrcamentos(
  c: pg.PoolClient,
  clinicaId: string,
  j: { de: Date; ate: Date },
): Promise<{ enviados: number; fechados: number }> {
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
    [clinicaId, j.de, j.ate, ['registrarOrcamento', 'fechar']],
  )
  const quantos = (acao: string): number =>
    Number(eventos.rows.find((e) => e.acao === acao)?.n ?? '0')
  return { enviados: quantos('registrarOrcamento'), fechados: quantos('fechar') }
}

/**
 * **O UNIVERSO DA RECEITA, escrito uma vez** — o `ehReceita` do painel, em
 * SQL. Tarefa viva, CONCLUÍDA, de paciente, do grupo Pagamentos **ou** de
 * atendimento pagável que guardou dinheiro na própria tarefa.
 *
 * Recebe as POSIÇÕES dos parâmetros em vez de fixá-las: o Postgres recusa o
 * statement inteiro quando um parâmetro declarado não aparece ("could not
 * determine data type of parameter $6"), e cada consulta usa posições
 * diferentes dos oito parâmetros possíveis.
 */
export const baseDeReceita = (clinica: string, receita: string, pagaveis: string): string => `
      t.clinica_id = ${clinica}
      AND t.excluida_em IS NULL
      AND t.status = 'concluida'
      AND t.paciente_id IS NOT NULL
      AND (t.tipo = ANY(${receita}::text[]) OR (t.tipo = ANY(${pagaveis}::text[]) AND r.valor > 0))`

/**
 * **O CORTE DA REGRA 6: só o dia cujo caixa já foi FECHADO.**
 *
 * O dia é o da CLÍNICA — com `AT TIME ZONE 'UTC'`, um recebimento das 21h de
 * Salvador cairia no dia seguinte e escaparia do corte justamente no dia
 * aberto, que é o único dia que o corte existe para proteger.
 *
 * Pressupõe `recebimentos` aliasada como `r`.
 */
export const caixaFechado = (clinica: string, fuso: string): string => `EXISTS (
            SELECT 1 FROM caixas_do_dia cx
             WHERE cx.clinica_id = ${clinica}
               AND cx.dia = (r.recebido_em AT TIME ZONE ${fuso})::date)`
