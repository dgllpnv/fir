import { Queue } from 'bullmq'
import IORedis from 'ioredis'

/**
 * **A FILA DE GERAÇÃO DE COBRANÇA DA CARTEIRA** (G3) — mesmo padrão de
 * `carteira/jobs/fila-uso-diario.ts` (G4): `Queue`/`Worker` do BullMQ, nome da
 * fila em português (vocabulário de produto), infraestrutura em inglês.
 */
export const NOME_DA_FILA_COBRANCAS = 'carteira:gerar-cobrancas'

/** Único, para `removeRepeatable` aceitar os mesmos parâmetros no deploy seguinte. */
export const NOME_DO_JOB_COBRANCAS = 'gerar-cobrancas-do-mes'

/**
 * Todo dia 1º às 07:00 UTC (04:00 em `America/Bahia`/`America/Sao_Paulo`,
 * UTC-3). O job é IDEMPOTENTE (regra 26) — rodar de novo no mesmo dia, ou
 * mesmo recuperar de um dia perdido, nunca duplica nem muda o valor já
 * gravado (ADR 0015, achado 2). A competência não é por-fuso-de-clínica (ver
 * `gerar-cobrancas.ts`): um horário UTC fixo é suficiente.
 */
export const CRON_COBRANCAS = '0 7 1 * *'

export function novaConexaoRedis(): IORedis {
  const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:4879'
  return new IORedis(url, { maxRetriesPerRequest: null })
}

export function novaFilaDeCobrancas(conexao: IORedis = novaConexaoRedis()): Queue {
  return new Queue(NOME_DA_FILA_COBRANCAS, { connection: conexao })
}

export async function agendarGeracaoDeCobrancas(fila: Queue): Promise<void> {
  await fila.add(
    NOME_DO_JOB_COBRANCAS,
    {},
    {
      jobId: NOME_DO_JOB_COBRANCAS,
      repeat: { pattern: CRON_COBRANCAS, tz: 'UTC' },
      removeOnComplete: { count: 12 },
      removeOnFail: { count: 50 },
    },
  )
}
