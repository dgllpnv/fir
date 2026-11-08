import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { BancoService } from '../../banco/banco.service'
import { AntivirusIndisponivel, ClamdPorTcp } from './antivirus'
import {
  ArmazenamentoCifradoEmDisco,
  diretorioDeAnexosDoAmbiente,
  segredoDeAnexosDoAmbiente,
} from './armazenamento-de-anexos'
import { VarreduraDeAnexos } from './varredura-de-anexos'

/**
 * **O WORKER DA VARREDURA DOS ANEXOS** (G8 4C, A-13) — processo irmão da API,
 * mesma imagem, `node worker-anexos.js` no compose. Mesmo padrão dos outros
 * workers da carteira: BullMQ com job repetível, serviço instanciado direto
 * (sem container Nest), nome de fila sem `:` (o BullMQ 5 o recusa).
 *
 * A cada 30 s: um job, uma rodada de `VarreduraDeAnexos.executar()`. Job
 * repetível pelo mesmo `jobId`, então dois deploys não duplicam o
 * agendamento; e a rodada é reentrante, então uma reentrega do BullMQ não
 * muda o resultado.
 *
 * Rede: só `dados` (Postgres, Redis, clamd). Volume: `/dados/anexos`.
 */
export const NOME_DA_FILA_ANEXOS = 'carteira-varrer-anexos'
const NOME_DO_JOB = 'varrer-anexos-pendentes'
const INTERVALO_MS = 30_000

async function main(): Promise<void> {
  const conexao = new IORedis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:4879', { maxRetriesPerRequest: null })
  const fila = new Queue(NOME_DA_FILA_ANEXOS, { connection: conexao })
  await fila.add(
    NOME_DO_JOB,
    {},
    {
      jobId: NOME_DO_JOB,
      repeat: { every: INTERVALO_MS },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 200 },
    },
  )

  const banco = new BancoService()
  const varredura = new VarreduraDeAnexos(
    banco,
    new ArmazenamentoCifradoEmDisco(diretorioDeAnexosDoAmbiente(), segredoDeAnexosDoAmbiente()),
    ClamdPorTcp.doAmbiente(),
  )

  const worker = new Worker(
    NOME_DA_FILA_ANEXOS,
    async () => {
      const r = await varredura.executar()
      if (r.limpos + r.infectados + r.ilegiveis > 0) {
        console.log(
          `[carteira:anexos] varredura: ${r.limpos} limpo(s), ${r.infectados} infectado(s), ${r.ilegiveis} ilegível(is).`,
        )
      }
      return r
    },
    // Um por vez: cada rodada segura até três cópias de um arquivo de 20 MB.
    { connection: conexao, concurrency: 1 },
  )

  worker.on('failed', (job, erro) => {
    // Antivírus fora do ar é o caso esperado na primeira subida (assinaturas
    // baixando): uma linha curta, sem pilha.
    const motivo = erro instanceof AntivirusIndisponivel ? `antivírus indisponível — ${erro.message}` : erro.message
    console.error(`[carteira:anexos] job ${job?.id ?? '?'} falhou: ${motivo}`)
  })

  const desligar = async (): Promise<void> => {
    await worker.close()
    await fila.close()
    await conexao.quit()
    await banco.onModuleDestroy()
    process.exit(0)
  }
  process.on('SIGTERM', desligar)
  process.on('SIGINT', desligar)
}

main().catch((erro: unknown) => {
  console.error('[carteira:anexos] falha ao iniciar o worker:', erro)
  process.exit(1)
})
