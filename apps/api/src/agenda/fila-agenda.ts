import { Queue } from 'bullmq'
import IORedis from 'ioredis'

/**
 * A fila da sincronização da agenda (ADR 0019).
 *
 * Dois tipos de job na mesma fila, e o worker roda UM de cada vez
 * (`concurrency: 1`): o repetível, que lê todas as clínicas a cada 15
 * minutos, e o "Sincronizar agora" de uma clínica. A transação já impede dois
 * cartões para o mesmo compromisso; a fila serial impede o worker de abrir
 * duas conexões de rede para o mesmo link ao mesmo tempo.
 */
// Hífen, não dois-pontos: o BullMQ 5 recusa `:` no nome da fila ("Queue name
// cannot contain :"), e o worker morreria ao subir. Achado ao rodar o bundle.
export const NOME_DA_FILA_AGENDA = 'agenda-sincronizacao'
export const JOB_TODAS = 'todas'
export const JOB_UMA = 'uma'
export const CRON_AGENDA = '*/15 * * * *'

export function novaConexaoRedis(): IORedis {
  const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:4879'
  return new IORedis(url, { maxRetriesPerRequest: null })
}

export function novaFilaDaAgenda(conexao: IORedis = novaConexaoRedis()): Queue {
  return new Queue(NOME_DA_FILA_AGENDA, { connection: conexao })
}

export async function agendarRepeticao(fila: Queue): Promise<void> {
  await fila.add(
    JOB_TODAS,
    {},
    {
      jobId: JOB_TODAS,
      repeat: { pattern: CRON_AGENDA, tz: 'UTC' },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
    },
  )
}

/**
 * Pede a sincronização de UMA clínica. O `jobId` por clínica deduplica:
 * clicar três vezes em "Sincronizar agora" enquanto o job espera vira um job.
 */
export async function pedirSincronizacao(fila: Queue, clinicaId: string): Promise<void> {
  await fila.add(
    JOB_UMA,
    { clinicaId },
    { jobId: `uma-${clinicaId}`, removeOnComplete: true, removeOnFail: { count: 20 } },
  )
}
