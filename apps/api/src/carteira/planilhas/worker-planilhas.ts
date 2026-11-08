import { RelogioDoSistema } from '@fir/domain'
import { Worker } from 'bullmq'
import { BancoService } from '../../banco/banco.service'
import {
  JOB_UM_CLIENTE,
  NOME_DA_FILA_PLANILHAS,
  agendarLeituraDasPlanilhas,
  novaConexaoRedis,
  novaFilaDePlanilhas,
} from './fila-planilhas'
import { LeituraDePlanilhas } from './ler-planilhas'
import { LeitorGoogleSheets, contaDeServicoDoAmbiente } from './leitor-google-sheets'

/**
 * O processo que lê as planilhas de indicadores (ticket 4A).
 *
 * Processo PRÓPRIO, como o `worker-agenda`: ele precisa de saída para a
 * internet (`*.googleapis.com`), e a API mora numa rede sem rota de saída.
 * A credencial do Google existe SÓ neste processo — a API nunca a recebe.
 *
 * Sem `GOOGLE_SA_JSON` (ou com ela inválida), o worker sobe mesmo assim: cada
 * leitura grava "não configurado", que é o que a tela mostra. Morrer na
 * subida faria o container reiniciar em laço e o `implantar.sh` recusar o
 * deploy inteiro por uma configuração que só este recurso precisa.
 *
 * O log carrega só contagens e ids de cliente — nunca link, número lido ou
 * credencial. Nem o motivo de a credencial ser inválida: a mensagem de um
 * parser de chave pode citar um pedaço dela.
 */
async function main(): Promise<void> {
  const conexao = novaConexaoRedis()
  const fila = novaFilaDePlanilhas(conexao)
  await agendarLeituraDasPlanilhas(fila)

  const relogio = new RelogioDoSistema()
  const conta = contaDeServicoDoAmbiente(process.env['GOOGLE_SA_JSON'])
  if (conta === null) {
    console.error('[carteira:planilhas] GOOGLE_SA_JSON ausente ou inválida: as leituras vão registrar "não configurado".')
  }
  const banco = new BancoService()
  const leitura = new LeituraDePlanilhas(banco, new LeitorGoogleSheets(conta, relogio), relogio)

  const worker = new Worker(
    NOME_DA_FILA_PLANILHAS,
    async (job) => {
      if (job.name === JOB_UM_CLIENTE) {
        const clienteCarteiraId = String((job.data as { clienteCarteiraId?: unknown }).clienteCarteiraId ?? '')
        if (!/^[0-9a-f-]{36}$/i.test(clienteCarteiraId)) return { tipo: 'invalido' }
        const res = await leitura.lerCliente(clienteCarteiraId)
        console.log(`[carteira:planilhas] cliente ${clienteCarteiraId}: ${res.tipo}${res.tipo === 'erro' ? ` (${res.codigo})` : ''}`)
        return res
      }
      const res = await leitura.lerTodas()
      console.log(`[carteira:planilhas] rodada: ${res.lidas} lida(s), ${res.falhas} falha(s)`)
      return res
    },
    { connection: conexao, concurrency: 1 },
  )

  worker.on('failed', (job, erro) => {
    console.error(`[carteira:planilhas] job ${job?.name ?? '?'} falhou: ${erro.name}`)
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
  console.log('[carteira:planilhas] worker no ar: a cada 30 min e sob demanda')
}

main().catch((erro: unknown) => {
  console.error('[carteira:planilhas] falha ao iniciar o worker:', erro instanceof Error ? erro.name : 'erro')
  process.exit(1)
})
