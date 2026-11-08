import { RelogioDoSistema } from '@fir/domain'
import { Worker } from 'bullmq'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { criarBaixador } from './baixar-feed'
import {
  JOB_UMA,
  NOME_DA_FILA_AGENDA,
  agendarRepeticao,
  novaConexaoRedis,
  novaFilaDaAgenda,
} from './fila-agenda'
import { SincronizacaoDaAgenda } from './sincronizacao'

/**
 * O processo que lê a agenda das clínicas (ADR 0019).
 *
 * Processo PRÓPRIO, não a API: ele precisa de saída para a internet, e a API
 * mora numa rede sem rota de saída. E o conteúdo de fora é interpretado aqui,
 * longe do processo que serve o balcão.
 *
 * O log carrega só contagens e ids de clínica — nunca título, nome ou link.
 */
async function main(): Promise<void> {
  const conexao = novaConexaoRedis()
  const fila = novaFilaDaAgenda(conexao)
  await agendarRepeticao(fila)

  const banco = new BancoService()
  const sincronizacao = new SincronizacaoDaAgenda(banco, new RelogioDoSistema(), criarBaixador())

  const worker = new Worker(
    NOME_DA_FILA_AGENDA,
    async (job) => {
      if (job.name === JOB_UMA) {
        const clinicaId = String((job.data as { clinicaId?: unknown }).clinicaId ?? '')
        const r = await banco.semIsolamentoDeClinica<{ fuso: string }>(
          'SELECT fuso FROM clinicas WHERE id = $1 AND ativa',
          [clinicaId],
        )
        const fuso = r.rows[0]?.fuso
        if (fuso === undefined) return { tipo: 'sem-clinica' }
        // `as`: o id acabou de ser conferido contra `clinicas`, a raiz do tenancy.
        const res = await sincronizacao.sincronizarClinica(clinicaId as ClinicaId, fuso)
        console.log(`[agenda] clínica ${clinicaId}: ${res.tipo}`)
        return { tipo: res.tipo }
      }
      const res = await sincronizacao.sincronizarTodas()
      console.log(`[agenda] rodada: ${res.clinicas} clínica(s) com agenda, ${res.falhas} falha(s)`)
      return res
    },
    { connection: conexao, concurrency: 1 },
  )

  worker.on('failed', (job, erro) => {
    console.error(`[agenda] job ${job?.name ?? '?'} falhou:`, erro.message)
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
  console.log('[agenda] worker no ar: a cada 15 min e sob demanda')
}

main().catch((erro: unknown) => {
  console.error('[agenda] falha ao iniciar o worker:', erro instanceof Error ? erro.message : erro)
  process.exit(1)
})
