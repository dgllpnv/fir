import { Queue } from 'bullmq'
import IORedis from 'ioredis'

/**
 * **A FILA DE TELEMETRIA DA CARTEIRA** (G4) — BullMQ/Redis, como o alvo
 * arquitetural já previa (CLAUDE.md §5) mas que ainda não tinha um primeiro
 * uso real neste monorepo. Nome em inglês por ser infraestrutura (CLAUDE.md
 * §6); o nome da FILA, visível em log e no painel do Redis, é em português —
 * é vocabulário de produto, não de framework.
 */
export const NOME_DA_FILA_USO_DIARIO = 'carteira-uso-diario-cliente'

/** O nome do job repetível dentro da fila — único, para `removeRepeatable` aceitar os mesmos parâmetros no deploy seguinte. */
export const NOME_DO_JOB_USO_DIARIO = 'calcular-uso-diario'

/**
 * **QUANDO RODAR é operacional; O QUE CALCULAR é por clínica** (ver o
 * cabeçalho de `uso-diario-cliente.ts`). Um único agendamento, em UTC, é
 * suficiente: `06:00 UTC` é `03:00` em `America/Sao_Paulo`/`America/Bahia`
 * (UTC-3) e `02:00` em `America/Manaus` (UTC-4) — depois da meia-noite em
 * QUALQUER fuso que uma clínica brasileira use hoje, então "ontem" (regra 22)
 * já terminou de verdade em todas elas no momento em que o job lê.
 */
export const CRON_USO_DIARIO = '0 6 * * *'

/**
 * Conexão Redis dedicada ao BullMQ — `maxRetriesPerRequest: null` é exigido
 * pela própria biblioteca para `Worker`/`QueueScheduler` (sem isso, o cliente
 * desiste de comandos de bloqueio no meio de uma espera longa e o worker cai
 * em erro que não é dele).
 */
export function novaConexaoRedis(): IORedis {
  const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:4879'
  return new IORedis(url, { maxRetriesPerRequest: null })
}

/** A fila, pronta para `.add`/agendamento repetível. Uma conexão por chamador — não é singleton de módulo, para que o teste feche a dela sem afetar outra. */
export function novaFilaDeUsoDiario(conexao: IORedis = novaConexaoRedis()): Queue {
  return new Queue(NOME_DA_FILA_USO_DIARIO, { connection: conexao })
}

/**
 * Registra (ou substitui) o agendamento recorrente. Idempotente pelo nome do
 * job: chamar de novo no próximo deploy não duplica o agendamento — o BullMQ
 * já deduplica por `jobId` quando o repetível é o mesmo.
 */
export async function agendarUsoDiario(fila: Queue): Promise<void> {
  await fila.add(
    NOME_DO_JOB_USO_DIARIO,
    {},
    {
      jobId: NOME_DO_JOB_USO_DIARIO,
      repeat: { pattern: CRON_USO_DIARIO, tz: 'UTC' },
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 100 },
    },
  )
}
