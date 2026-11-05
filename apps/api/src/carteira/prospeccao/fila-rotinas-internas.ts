import { Queue } from 'bullmq'
import IORedis from 'ioredis'

/**
 * **A FILA DO MARCADOR DE ROTINA INTERNA** (G5) — mesmo padrão de
 * `carteira/jobs/fila-uso-diario.ts` (G4) e `carteira/financeiro/
 * fila-cobrancas.ts` (G3): `Queue`/`Worker` do BullMQ, nome da fila em
 * português (vocabulário de produto), infraestrutura em inglês.
 */
export const NOME_DA_FILA_ROTINAS_INTERNAS = 'carteira:gerar-tarefas-de-rotinas-internas'

/** Único, para `removeRepeatable` aceitar os mesmos parâmetros no deploy seguinte. */
export const NOME_DO_JOB_ROTINAS_INTERNAS = 'gerar-tarefas-de-rotinas-internas'

/**
 * Todo dia às `06:30 UTC` — meia hora depois do uso diário (G4, `06:00 UTC`),
 * só para não disputar a mesma conexão de banco no mesmo instante; nenhuma
 * dependência de dado entre os dois jobs. `06:00 UTC` já é depois da meia-
 * noite em QUALQUER fuso que uma clínica brasileira use hoje (ver o
 * cabeçalho de `fila-uso-diario.ts`), e o `Marcador de rotina interna` é
 * trabalho da EQUIPE FIRMARE — não há fuso de clínica a considerar aqui
 * (mesma razão de `FUSO_DA_FIRMARE` no controller). O job é IDEMPOTENTE
 * (regra 26, `ON CONFLICT DO NOTHING` nos índices parciais da migration
 * 0032): rodar de novo no mesmo dia nunca duplica tarefa.
 */
export const CRON_ROTINAS_INTERNAS = '30 6 * * *'

export function novaConexaoRedis(): IORedis {
  const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:4879'
  return new IORedis(url, { maxRetriesPerRequest: null })
}

/** A fila, pronta para `.add`/agendamento repetível. Uma conexão por chamador — mesma razão de `novaFilaDeUsoDiario`. */
export function novaFilaDeRotinasInternas(conexao: IORedis = novaConexaoRedis()): Queue {
  return new Queue(NOME_DA_FILA_ROTINAS_INTERNAS, { connection: conexao })
}

/**
 * Registra (ou substitui) o agendamento recorrente. Idempotente pelo nome do
 * job: chamar de novo no próximo deploy não duplica o agendamento.
 */
export async function agendarGeracaoDeTarefasDeRotinasInternas(fila: Queue): Promise<void> {
  await fila.add(
    NOME_DO_JOB_ROTINAS_INTERNAS,
    {},
    {
      jobId: NOME_DO_JOB_ROTINAS_INTERNAS,
      repeat: { pattern: CRON_ROTINAS_INTERNAS, tz: 'UTC' },
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 100 },
    },
  )
}
