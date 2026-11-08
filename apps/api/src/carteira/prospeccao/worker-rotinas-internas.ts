import { RelogioDoSistema } from '@fir/domain'
import { Worker } from 'bullmq'
import { BancoService } from '../../banco/banco.service'
import {
  NOME_DA_FILA_ROTINAS_INTERNAS,
  agendarGeracaoDeTarefasDeRotinasInternas,
  novaConexaoRedis,
  novaFilaDeRotinasInternas,
} from './fila-rotinas-internas'
import { RotinaInternaService } from './rotina-interna.service'

/**
 * **O PROCESSO DO WORKER DO MARCADOR DE ROTINA INTERNA** (G5) — entrypoint
 * próprio, `tsx src/carteira/prospeccao/worker-rotinas-internas.ts`, mesmo
 * padrão de `carteira/jobs/worker-uso-diario.ts` (G4) e `carteira/
 * financeiro/worker-cobrancas.ts` (G3): processo irmão, nunca importado por
 * `app.module.ts`.
 *
 * `RotinaInternaService` é instanciado direto (sem container Nest) —
 * é uma classe `@Injectable()` com DOIS parâmetros de construtor
 * (`BancoService`, `Relogio`), nenhum deles exigindo o DI do Nest para
 * existir; o mesmo padrão que os outros dois workers já usam para
 * `BancoService`/`RelogioDoSistema`.
 *
 * Log aqui é OPERACIONAL — contagem de tarefas geradas, nunca título de
 * tarefa, nome de cliente/lead nem responsável (regra 21).
 */
async function main(): Promise<void> {
  const conexao = novaConexaoRedis()
  const fila = novaFilaDeRotinasInternas(conexao)
  await agendarGeracaoDeTarefasDeRotinasInternas(fila)

  const banco = new BancoService()
  const relogio = new RelogioDoSistema()
  const servico = new RotinaInternaService(banco, relogio)

  const worker = new Worker(
    NOME_DA_FILA_ROTINAS_INTERNAS,
    async () => {
      const geradas = await servico.gerarTarefasDeRotinasInternas()
      console.log(`[carteira:rotinas-internas] ${geradas} tarefa(s) gerada(s).`)
      return { geradas }
    },
    { connection: conexao },
  )

  worker.on('failed', (job, erro) => {
    console.error(`[carteira:rotinas-internas] job ${job?.id ?? '?'} falhou:`, erro.message)
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
  console.error('[carteira:rotinas-internas] falha ao iniciar o worker:', erro)
  process.exit(1)
})
