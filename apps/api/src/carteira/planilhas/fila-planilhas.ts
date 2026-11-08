import { Queue } from 'bullmq'
import IORedis from 'ioredis'

/**
 * A fila da leitura das planilhas de indicadores (ticket 4A).
 *
 * Dois tipos de job, e o worker roda UM de cada vez (`concurrency: 1`): o
 * repetível, que lê todos os clientes com planilha, e o "Ler planilha agora"
 * de um cliente. Serial de propósito: a cota da API do Sheets é por projeto,
 * e uma rajada de pedidos manuais não pode tomar a vez da rodada.
 */
// Hífen, nunca dois-pontos: o BullMQ 5 recusa `:` no nome da fila.
export const NOME_DA_FILA_PLANILHAS = 'carteira-planilhas'
export const JOB_TODAS = 'todas'
export const JOB_UM_CLIENTE = 'um-cliente'
/**
 * A cada 30 minutos. Os formulários são semanais; o protótipo publicado
 * relia no máximo a cada 10 minutos, e só com a tela aberta. Uma rodada a
 * cada meia hora deixa o painel da segunda-feira em dia sem gastar cota.
 */
export const CRON_PLANILHAS = '7,37 * * * *'

export function novaConexaoRedis(): IORedis {
  const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:4879'
  return new IORedis(url, { maxRetriesPerRequest: null })
}

export function novaFilaDePlanilhas(conexao: IORedis = novaConexaoRedis()): Queue {
  return new Queue(NOME_DA_FILA_PLANILHAS, { connection: conexao })
}

export async function agendarLeituraDasPlanilhas(fila: Queue): Promise<void> {
  await fila.add(
    JOB_TODAS,
    {},
    {
      jobId: JOB_TODAS,
      repeat: { pattern: CRON_PLANILHAS, tz: 'UTC' },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
    },
  )
}

/** "Ler planilha agora". O `jobId` por cliente deduplica: três cliques enquanto o job espera viram um. */
export async function pedirLeituraDaPlanilha(fila: Queue, clienteCarteiraId: string): Promise<void> {
  await fila.add(
    JOB_UM_CLIENTE,
    { clienteCarteiraId },
    { jobId: `cliente-${clienteCarteiraId}`, removeOnComplete: true, removeOnFail: { count: 20 } },
  )
}
