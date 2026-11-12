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

  const rodar = async (dia?: string): Promise<void> => {
    const resumo = await executarUsoDiarioCliente(banco, relogio, dia)
    if (resumo.falhas.length > 0) {
      console.error(
        `[carteira:uso-diario] ${resumo.processados} processados, ${resumo.falhas.length} falha(s):`,
        resumo.falhas,
      )
    } else {
      console.log(`[carteira:uso-diario] ${resumo.processados} processados, sem falhas.`)
    }
  }

  const worker = new Worker(
    NOME_DA_FILA_USO_DIARIO,
    async (job) => {
      // `dia` (AAAA-MM-DD) é só para reprocessar um dia à mão (UPSERT: seguro repetir).
      const dia: unknown = (job.data as { dia?: unknown } | undefined)?.dia
      await rodar(typeof dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : undefined)
    },
    { connection: conexao },
  )

  // Recuperação ao subir: se o worker esteve fora às 03:00 (deploy, queda), "ontem" ficaria
  // sem linha até o dia seguinte. O job é idempotente por (cliente, dia), então rodar de novo
  // é seguro. Falha aqui não derruba o worker: o agendamento normal segue valendo.
  void rodar().catch((erro: unknown) => {
    console.error('[carteira:uso-diario] recuperação ao subir falhou:', erro instanceof Error ? erro.message : erro)
  })

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
