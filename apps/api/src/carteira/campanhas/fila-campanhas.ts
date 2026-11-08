import { Queue } from 'bullmq'
import IORedis from 'ioredis'

/**
 * **A FILA DA SINCRONIZAÇÃO DE CAMPANHAS** (K4). Mesmo desenho das outras três
 * filas da carteira (`carteira/jobs/fila-uso-diario.ts`). Nome SEM `:` — o
 * BullMQ usa `:` como separador das chaves no Redis, e um nome com `:` quebra
 * a listagem e a limpeza da fila.
 */
export const NOME_DA_FILA_CAMPANHAS = 'carteira-sincronizar-campanhas'

/** Único, para `removeRepeatable` aceitar os mesmos parâmetros no deploy seguinte. */
export const NOME_DO_JOB_CAMPANHAS = 'sincronizar-campanhas'

/**
 * `07:30 UTC` = `04:30` em UTC-3 e `03:30` em UTC-4 — depois da virada do dia
 * em qualquer fuso de clínica brasileira, e depois dos outros jobs da
 * carteira (06:00, 06:30 e as cobranças do dia 1 às 07:00), para não
 * disputarem o mesmo Postgres no mesmo minuto. O QUE calcular (o mês de cada pagamento) é no fuso de cada clínica,
 * dentro do job; QUANDO disparar é operacional.
 */
export const CRON_CAMPANHAS = '30 7 * * *'

export function novaConexaoRedis(): IORedis {
  const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:4879'
  return new IORedis(url, { maxRetriesPerRequest: null })
}

export function novaFilaDeCampanhas(conexao: IORedis = novaConexaoRedis()): Queue {
  return new Queue(NOME_DA_FILA_CAMPANHAS, { connection: conexao })
}

/** Idempotente pelo `jobId`: o próximo deploy não duplica o agendamento. */
export async function agendarSincronizacaoDeCampanhas(fila: Queue): Promise<void> {
  await fila.add(
    NOME_DO_JOB_CAMPANHAS,
    {},
    {
      jobId: NOME_DO_JOB_CAMPANHAS,
      repeat: { pattern: CRON_CAMPANHAS, tz: 'UTC' },
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 100 },
    },
  )
}
