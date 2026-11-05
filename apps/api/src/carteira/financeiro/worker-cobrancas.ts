import { RelogioDoSistema } from '@fir/domain'
import { Worker } from 'bullmq'
import { BancoService } from '../../banco/banco.service'
import { executarGeracaoDeCobrancas } from './gerar-cobrancas'
import {
  NOME_DA_FILA_COBRANCAS,
  agendarGeracaoDeCobrancas,
  novaConexaoRedis,
  novaFilaDeCobrancas,
} from './fila-cobrancas'

/**
 * **O PROCESSO DO WORKER DE COBRANÇA DA CARTEIRA** (G3) — entrypoint próprio,
 * `tsx src/carteira/financeiro/worker-cobrancas.ts`, mesmo padrão de
 * `carteira/jobs/worker-uso-diario.ts` (G4): processo irmão, nunca importado
 * por `app.module.ts`.
 *
 * Log OPERACIONAL — contagem de geradas/falhas e `clienteCarteiraId`, nunca
 * valor, nome nem dado de cliente (regra 21).
 */
async function main(): Promise<void> {
  const conexao = novaConexaoRedis()
  const fila = novaFilaDeCobrancas(conexao)
  await agendarGeracaoDeCobrancas(fila)

  const banco = new BancoService()
  const relogio = new RelogioDoSistema()

  const worker = new Worker(
    NOME_DA_FILA_COBRANCAS,
    async () => {
      const resumo = await executarGeracaoDeCobrancas(banco, relogio)
      if (resumo.falhas.length > 0) {
        console.error(
          `[carteira:cobrancas] ${resumo.geradas} gerada(s), ${resumo.falhas.length} falha(s):`,
          resumo.falhas,
        )
      } else {
        console.log(`[carteira:cobrancas] ${resumo.geradas} gerada(s), sem falhas.`)
      }
      return resumo
    },
    { connection: conexao },
  )

  worker.on('failed', (job, erro) => {
    console.error(`[carteira:cobrancas] job ${job?.id ?? '?'} falhou:`, erro.message)
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
  console.error('[carteira:cobrancas] falha ao iniciar o worker:', erro)
  process.exit(1)
})
