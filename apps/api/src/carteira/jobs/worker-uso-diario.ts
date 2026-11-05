import { RelogioDoSistema } from '@fir/domain'
import { Worker } from 'bullmq'
import { BancoService } from '../../banco/banco.service'
import {
  NOME_DA_FILA_USO_DIARIO,
  agendarUsoDiario,
  novaConexaoRedis,
  novaFilaDeUsoDiario,
} from './fila-uso-diario'
import { executarUsoDiarioCliente } from './uso-diario-cliente'

/**
 * **O PROCESSO DO WORKER DA CARTEIRA** (G4) — entrypoint próprio, `tsx src/
 * carteira/jobs/worker-uso-diario.ts`, não parte do `main.ts` da API.
 *
 * Nenhum módulo Nest aqui de propósito: `BancoService` não tem dependência de
 * DI (zero no construtor), e um `Worker` de fila não serve HTTP — misturá-lo
 * no `AppModule` acoplaria o ciclo de vida de "responder requisição" ao de
 * "processar fila", quando um dos dois cair por OOM ou por travar numa query
 * longa. **Este arquivo não é importado por `app.module.ts`, e não deveria
 * ser** — é um processo irmão, como `infra/producao` já prevê para o Mavia
 * (container próprio, mesma rede de dados, sem porta exposta ao Traefik).
 *
 * Log aqui é OPERACIONAL, nunca de domínio: contagem de processados e de
 * falhas, `clienteCarteiraId`/`clinicaId` (identificadores, não PII) — nunca
 * valor, nome de paciente nem dose (regra 21).
 */
async function main(): Promise<void> {
  const conexao = novaConexaoRedis()
  const fila = novaFilaDeUsoDiario(conexao)
  await agendarUsoDiario(fila)

  const banco = new BancoService()
  const relogio = new RelogioDoSistema()

  const worker = new Worker(
    NOME_DA_FILA_USO_DIARIO,
    async () => {
      const resumo = await executarUsoDiarioCliente(banco, relogio)
      if (resumo.falhas.length > 0) {
        console.error(
          `[carteira:uso-diario] ${resumo.processados} processados, ${resumo.falhas.length} falha(s):`,
          resumo.falhas,
        )
      } else {
        console.log(`[carteira:uso-diario] ${resumo.processados} processados, sem falhas.`)
      }
      return resumo
    },
    { connection: conexao },
  )

  worker.on('failed', (job, erro) => {
    console.error(`[carteira:uso-diario] job ${job?.id ?? '?'} falhou:`, erro.message)
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
  console.error('[carteira:uso-diario] falha ao iniciar o worker:', erro)
  process.exit(1)
})
