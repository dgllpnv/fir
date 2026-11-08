import { Queue } from 'bullmq'
import IORedis from 'ioredis'

/**
 * **A FILA DE GERAÇÃO DE COBRANÇA DA CARTEIRA** (G3) — mesmo padrão de
 * `carteira/jobs/fila-uso-diario.ts` (G4): `Queue`/`Worker` do BullMQ, nome da
 * fila em português (vocabulário de produto), infraestrutura em inglês.
 */
export const NOME_DA_FILA_COBRANCAS = 'carteira-gerar-cobrancas'

/** Único, para `removeRepeatable` aceitar os mesmos parâmetros no deploy seguinte. */
export const NOME_DO_JOB_COBRANCAS = 'gerar-cobrancas-do-mes'

/**
 * TODO DIA às 07:00 UTC (04:00 no fuso da carteira, `America/Bahia`, UTC-3).
 * Diário, não só no dia 1º (D-22 item 10, ajuste 5 do gate de números G8): o
 * cliente que entra no meio do mês, ou ganha dia de vencimento depois, é
 * cobrado no mesmo mês. O job é IDEMPOTENTE (regra 26) — rodar todo dia, ou
 * de novo no mesmo dia, nunca duplica nem muda o valor já gravado (ADR 0015,
 * achado 2). A competência sai do relógio no fuso da carteira
 * (`competenciaDoMes`), então o horário UTC do disparo não a desloca.
 */
export const CRON_COBRANCAS = '0 7 * * *'

export function novaConexaoRedis(): IORedis {
  const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:4879'
  return new IORedis(url, { maxRetriesPerRequest: null })
}

export function novaFilaDeCobrancas(conexao: IORedis = novaConexaoRedis()): Queue {
  return new Queue(NOME_DA_FILA_COBRANCAS, { connection: conexao })
}

export async function agendarGeracaoDeCobrancas(fila: Queue): Promise<void> {
  // O BullMQ guarda cada agendamento repetível pela chave (nome + padrão). Sem
  // isto, o agendamento mensal antigo ('0 7 1 * *') continuaria registrado ao
  // lado do diário — inofensivo pela idempotência, mas é lixo que confunde
  // quem lê a fila. Remove todo agendamento deste job com outro padrão.
  for (const antigo of await fila.getRepeatableJobs()) {
    if (antigo.name === NOME_DO_JOB_COBRANCAS && antigo.pattern !== CRON_COBRANCAS) {
      await fila.removeRepeatableByKey(antigo.key)
    }
  }
  await fila.add(
    NOME_DO_JOB_COBRANCAS,
    {},
    {
      jobId: NOME_DO_JOB_COBRANCAS,
      repeat: { pattern: CRON_COBRANCAS, tz: 'UTC' },
      removeOnComplete: { count: 31 },
      removeOnFail: { count: 50 },
    },
  )
}
