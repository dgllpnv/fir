/**
 * **COMPARAR A META ANTES DO DEPLOY DA 0100** (ticket T2; números B6, R-2).
 *
 * Para cada clínica e cada mês com meta em `metas_do_mes`: o medido pela regra
 * de HOJE (todo o recebido do mês, ou o MedX do mês inteiro), o medido pela
 * regra NOVA (I-9: dias de caixa fechado a partir do primeiro caixa; hoje sem
 * caixa nunca conta), a diferença e os dias sem caixa. A PO assina a lista;
 * um mês divergente sem a ciência dela segura o deploy.
 *
 * Roda ANTES da 0100 (não lê `clinicas.conferencia_desde`: o início da
 * conferência é calculado aqui, pela mesma regra da migration —
 * `min(caixas_do_dia.dia)`).
 *
 * **A saída é gravada FORA do repositório.** O caminho vem por argumento, e o
 * script recusa qualquer caminho dentro da árvore do git: a lista tem valores
 * de clínicas reais, e o repositório é público.
 *
 *   pnpm --filter @fir/api exec tsx scripts/comparar-meta-antes-do-deploy.ts <arquivo.csv>
 */
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { Dinheiro, diaCivil, diaConta, fimDoMes, janela, regimeDoDia } from '@fir/domain'
import pg from 'pg'
import { clinicaIdDeFonteConfiavel } from '../src/banco/clinica-id'
import { recorteDeCaixa } from '../src/financeiro/faturamento-conferido'
import { porDia, recebidosDaJanela } from '../src/financeiro/recebido-por-dia'
import { somaDoMedx } from '../src/integracoes/faturamento-lido'

export function caminhoForaDoRepositorio(destino: string, raizDoGit: string): string {
  const alvo = resolve(destino)
  const raiz = resolve(raizDoGit)
  const dentro = (a: string) => a.toLowerCase() === raiz.toLowerCase() || a.toLowerCase().startsWith(`${raiz.toLowerCase()}${sep}`)
  if (dentro(alvo)) throw new Error(`Recusado: ${alvo} está dentro do repositório (${raiz}). Grave fora dele.`)
  return alvo
}

async function main(): Promise<void> {
  const destino = process.argv[2]
  if (destino === undefined) throw new Error('Uso: comparar-meta-antes-do-deploy.ts <arquivo-fora-do-repositorio.csv>')
  const raiz = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const arquivo = caminhoForaDoRepositorio(destino, raiz)

  const pool = new pg.Pool({
    connectionString: process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir',
  })
  const c = await pool.connect()
  const linhas = ['clinica_id;mes;medida_por;medido_antigo;medido_novo;diferenca;dias_sem_caixa']
  try {
    const metas = await c.query<{ clinica_id: string; mes: string; medida_por: 'fir' | 'medx'; fuso: string; desde: string | null }>(
      `SELECT m.clinica_id, to_char(m.competencia, 'YYYY-MM') AS mes, m.medida_por, cl.fuso,
              (SELECT min(dia)::text FROM caixas_do_dia cx WHERE cx.clinica_id = m.clinica_id) AS desde
         FROM metas_do_mes m JOIN clinicas cl ON cl.id = m.clinica_id
        ORDER BY 1, 2`,
    )
    for (const m of metas.rows) {
      const id = clinicaIdDeFonteConfiavel(m.clinica_id)
      const hoje = diaCivil(new Date(), m.fuso)
      const de = `${m.mes}-01`
      const ate = fimDoMes(m.mes)
      const todos = porDia(await recebidosDaJanela(c, id, janela(de, ate, m.fuso), m.fuso))
      const recorte = await recorteDeCaixa(c, id, de, ate, m.fuso, hoje)
      const contam = new Set(recorte.dias.filter((d) => diaConta(regimeDoDia(d, m.desde, hoje), recorte.fechados.has(d))))
      let antigo: Dinheiro | null = [...todos.values()].reduce((s, x) => s.mais(x), Dinheiro.zero())
      let novo: Dinheiro | null = [...todos].reduce((s, [d, x]) => (contam.has(d) ? s.mais(x) : s), Dinheiro.zero())
      if (m.medida_por === 'medx') {
        const lido = recorte.lido
        antigo = lido === null || !lido.coberturaCompleta ? null : somaDoMedx(lido).faturamento
        novo = lido === null || [...contam].some((d) => !lido.porDia.has(d)) ? null : somaDoMedx(lido, contam).faturamento
      }
      const t = (x: Dinheiro | null) => (x === null ? '' : x.centavos.toString())
      const dif = antigo === null || novo === null ? '' : novo.menos(antigo).centavos.toString()
      linhas.push([m.clinica_id, m.mes, m.medida_por, t(antigo), t(novo), dif, String(recorte.semCaixa.length)].join(';'))
    }
  } finally {
    c.release()
    await pool.end()
  }
  await writeFile(arquivo, `${linhas.join('\n')}\n`, { encoding: 'utf8', flag: 'wx' })
  // Só a contagem na tela: os valores ficam no arquivo, fora do repositório.
  console.log(`${linhas.length - 1} mês(es) comparado(s) → ${arquivo}`)
}

if (process.argv[1]?.endsWith('comparar-meta-antes-do-deploy.ts')) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
