import { RelogioDoSistema } from '@fir/domain'
import { Worker } from 'bullmq'
import { BancoService } from '../banco/banco.service'
import { AberturaDeIntegracoes } from '../integracoes/cofre-de-integracoes'
import { JOB_TESTAR_INTEGRACAO } from '../integracoes/jobs'
import { AgendaDoMedx } from '../integracoes/medx/agenda-do-medx'
import { FaturamentoDoMedx } from '../integracoes/medx/faturamento-do-medx'
import { LeitorDoMedx } from '../integracoes/medx/leitor-do-medx'
import { baseDoMedxDoAmbiente, criarTransporte } from '../integracoes/medx/transporte'
import { TesteDeConexao } from '../integracoes/teste-de-conexao'
import type { ClinicaId } from '../banco/clinica-id'
import { criarBaixador } from './baixar-feed'
import {
  JOB_FATURAMENTO,
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
  // A integração com o MedX (spec integracao-medx). A privada e a base são
  // lidas NA SUBIDA: produção sem elas cai aqui, não no primeiro teste. Um
  // leitor só: a sessão (JWT em memória) serve ao teste e à agenda.
  const abertura = AberturaDeIntegracoes.doAmbiente()
  const leitorDoMedx = new LeitorDoMedx(criarTransporte({ base: baseDoMedxDoAmbiente() }))
  const testeDeConexao = new TesteDeConexao(banco, abertura, leitorDoMedx)
  const sincronizacao = new SincronizacaoDaAgenda(
    banco,
    new RelogioDoSistema(),
    criarBaixador(),
    new AgendaDoMedx(banco, abertura, leitorDoMedx),
  )
  const faturamento = new FaturamentoDoMedx(banco, abertura, leitorDoMedx, new RelogioDoSistema())

  const worker = new Worker(
    NOME_DA_FILA_AGENDA,
    async (job) => {
      if (job.name === JOB_TESTAR_INTEGRACAO) {
        // Só ids no payload (S-1). O id é conferido contra `clinicas` antes de virar contexto.
        const clinicaId = String((job.data as { clinicaId?: unknown }).clinicaId ?? '')
        const r = await banco.semIsolamentoDeClinica<{ id: string }>(
          'SELECT id FROM clinicas WHERE id::text = $1 AND ativa',
          [clinicaId],
        )
        if (r.rows[0] === undefined) return { tipo: 'sem-clinica' }
        // `as`: o id acabou de ser conferido contra `clinicas`, a raiz do tenancy.
        const res = await testeDeConexao.executar(clinicaId as ClinicaId)
        console.log(`[integracoes] teste da clínica ${clinicaId}: ${res}`)
        return { tipo: res }
      }
      if (job.name === JOB_FATURAMENTO) {
        // Uma clínica de cada vez; a que falha não impede as outras (cada uma
        // grava o próprio erro). Sem faturamento ligado, `lerClinica` sai sem rede.
        const r = await banco.semIsolamentoDeClinica<{ id: string; fuso: string }>(
          'SELECT id, fuso FROM clinicas WHERE ativa ORDER BY id',
        )
        let lidas = 0
        let falhas = 0
        for (const { id, fuso } of r.rows) {
          // `as`: o id vem de `clinicas`, a raiz do tenancy.
          const res = await faturamento.lerClinica(id as ClinicaId, fuso)
          if (res.tipo === 'ok') lidas++
          if (res.tipo === 'falhou') falhas++
        }
        console.log(`[faturamento] rodada: ${lidas} clínica(s) lida(s), ${falhas} falha(s)`)
        return { lidas, falhas }
      }
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
  console.log('[agenda] worker no ar: agenda a cada 15 min, faturamento de hora em hora, e sob demanda')
}

main().catch((erro: unknown) => {
  console.error('[agenda] falha ao iniciar o worker:', erro instanceof Error ? erro.message : erro)
  process.exit(1)
})
