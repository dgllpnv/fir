import { RelogioDoSistema } from '@fir/domain'
import { Worker } from 'bullmq'
import { BancoService } from '../../banco/banco.service'
import {
  NOME_DA_FILA_CAMPANHAS,
  agendarSincronizacaoDeCampanhas,
  novaConexaoRedis,
  novaFilaDeCampanhas,
} from './fila-campanhas'
import { executarSincronizacaoDeCampanhas } from './sincronizar-campanhas'

/**
 * **O PROCESSO DO WORKER DE CAMPANHAS** (K4) — entrypoint próprio, como
 * `carteira/jobs/worker-uso-diario.ts` e pelas mesmas razões: não é importado
 * pelo `app.module.ts`, não serve HTTP, roda em container próprio só na rede
 * `dados`.
 *
 * Reentrante: o BullMQ reentrega o job se o processo cair no meio, e a
 * sincronização é UPSERT por chave explícita — rodar de novo dá as mesmas
 * linhas.
 *
 * Log OPERACIONAL: contagens e identificadores de cliente/clínica. Nunca
 * valor, nome de campanha nem nada de paciente (regra 21, LGPD A25).
 */
async function main(): Promise<void> {
  const conexao = novaConexaoRedis()
  const fila = novaFilaDeCampanhas(conexao)
  await agendarSincronizacaoDeCampanhas(fila)

  const banco = new BancoService()
  const relogio = new RelogioDoSistema()

  const worker = new Worker(
    NOME_DA_FILA_CAMPANHAS,
    async () => {
      const resumo = await executarSincronizacaoDeCampanhas(banco, relogio)
      const linha = `${resumo.processados} cliente(s), ${resumo.linhasGravadas} linha(s) gravada(s)`
      if (resumo.falhas.length > 0) {
        console.error(`[carteira:campanhas] ${linha}, ${resumo.falhas.length} falha(s):`, resumo.falhas)
      } else {
        console.log(`[carteira:campanhas] ${linha}, sem falhas.`)
      }
      return resumo
    },
    { connection: conexao },
  )

  worker.on('failed', (job, erro) => {
    console.error(`[carteira:campanhas] job ${job?.id ?? '?'} falhou:`, erro.message)
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
  console.error('[carteira:campanhas] falha ao iniciar o worker:', erro)
  process.exit(1)
})
