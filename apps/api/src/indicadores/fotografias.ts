import { diaCivil, inicioDoDia, type Relogio, somarDias } from '@fir/domain'
import type pg from 'pg'
import { SISTEMA } from '../banco/ator'
import type { BancoService } from '../banco/banco.service'
import { type ClinicaId, clinicaIdDeFonteConfiavel } from '../banco/clinica-id'
import { pacientesQuePodemTerSaldo, saldosDe } from '../financeiro/saldo.repositorio'
import { bancoDeHorasPositivo, contarAbaixoDoMinimo } from './fontes'
import { gerarTarefasDeLancamento } from './lancamentos-tarefas'

/** Quantos dias para trás o job recompõe uma fotografia perdida (servidor parado). */
export const DIAS_DE_RECOMPOSICAO = 35

/** As chaves `posicao` do catálogo: a posição passada só existe fotografada (I-6). */
const CHAVES_FOTOGRAFADAS = ['saldo_a_receber', 'itens_abaixo_do_minimo', 'saldo_banco_de_horas'] as const

type ValorDaFotografia = { readonly centavos: bigint | null; readonly numero: bigint | null }

/**
 * A posição do dia `D` no INSTANTE `início(D+1)` no fuso da clínica — não na
 * hora em que o job rodou (números c.9, `fotografia-pelo-instante`). Por isso
 * o job é reentrante: rodar às 00:05 ou às 15:00, uma vez ou três, grava o
 * mesmo número.
 */
export async function posicaoNoDia(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  chave: (typeof CHAVES_FOTOGRAFADAS)[number],
  dia: string,
  fuso: string,
): Promise<ValorDaFotografia> {
  const instante = inicioDoDia(somarDias(dia, 1), fuso)
  switch (chave) {
    case 'saldo_a_receber': {
      const saldos = await saldosDe(c, clinicaId, await pacientesQuePodemTerSaldo(c, clinicaId), { ate: instante })
      let total = 0n
      for (const s of saldos.values()) total += s.saldo.centavos
      return { centavos: total, numero: null }
    }
    case 'itens_abaixo_do_minimo':
      return { centavos: null, numero: BigInt(await contarAbaixoDoMinimo(c, clinicaId, instante)) * 100n }
    case 'saldo_banco_de_horas':
      return { centavos: null, numero: await bancoDeHorasPositivo(c, clinicaId, dia.slice(0, 7)) }
  }
}

/**
 * Fotografa os KPIs `posicao` vivos de UMA clínica, de ontem para trás até
 * `DIAS_DE_RECOMPOSICAO` dias, só os dias que faltam. Insere com
 * `ON CONFLICT DO NOTHING`: a fotografia é append-only (sem UPDATE para
 * `fir_app`), e o dia já fotografado não muda (`fotografia-dia-perdido-recompoe`).
 *
 * Roda DENTRO de `naClinica` daquela clínica: a RLS isola, e o SQL também
 * filtra por `clinica_id` (`job-nao-cruza-clinica`).
 */
export async function fotografarClinica(c: pg.PoolClient, clinicaId: ClinicaId, fuso: string, hoje: string): Promise<number> {
  const kpis = await c.query<{ id: string; chave: (typeof CHAVES_FOTOGRAFADAS)[number]; criado: string }>(
    `SELECT id, chave_catalogo AS chave, ((criado_em AT TIME ZONE $3)::date)::text AS criado FROM kpis
      WHERE clinica_id = $1 AND origem = 'catalogo' AND arquivado_em IS NULL AND chave_catalogo = ANY($2::text[])`,
    [clinicaId, [...CHAVES_FOTOGRAFADAS], fuso],
  )
  let gravadas = 0
  const primeiro = somarDias(hoje, -DIAS_DE_RECOMPOSICAO)
  for (const k of kpis.rows) {
    const feitos = await c.query<{ dia: string }>(
      'SELECT dia::text AS dia FROM fotografias_de_kpi WHERE clinica_id = $1 AND kpi_id = $2 AND dia >= $3::date',
      [clinicaId, k.id, primeiro],
    )
    const ja = new Set(feitos.rows.map((x) => x.dia))
    // Do dia anterior à criação do KPI para a frente: antes disso não há o que medir.
    const desde = k.criado > primeiro ? somarDias(k.criado, -1) : primeiro
    for (let d = desde; d < hoje; d = somarDias(d, 1)) {
      if (ja.has(d)) continue
      const v = await posicaoNoDia(c, clinicaId, k.chave, d, fuso)
      const r = await c.query(
        `INSERT INTO fotografias_de_kpi (clinica_id, kpi_id, dia, valor_centavos, valor_numero)
         VALUES ($1, $2, $3::date, $4, $5) ON CONFLICT (kpi_id, dia) DO NOTHING`,
        [clinicaId, k.id, d, v.centavos?.toString() ?? null, v.numero?.toString() ?? null],
      )
      gravadas += r.rowCount ?? 0
    }
  }
  return gravadas
}

/**
 * O job `indicadores-do-dia`: uma clínica por vez, cada uma na própria
 * transação como `fir_app` (nunca um papel com BYPASSRLS). A falha de uma não
 * derruba as outras, e o log não leva valor nenhum — só contagens e o id
 * (`log-sem-conteudo-indicadores`).
 */
export async function executarIndicadoresDoDia(
  banco: BancoService,
  relogio: Relogio,
): Promise<{ processadas: number; gravadas: number; tarefas: number; falhas: string[] }> {
  const clinicas = await banco.semIsolamentoDeClinica<{ id: string; fuso: string }>(
    'SELECT id, fuso FROM clinicas WHERE ativa',
  )
  let gravadas = 0
  let tarefas = 0
  const falhas: string[] = []
  for (const cl of clinicas.rows) {
    const id = clinicaIdDeFonteConfiavel(cl.id)
    const hoje = diaCivil(relogio.agora(), cl.fuso)
    try {
      gravadas += await banco.naClinica(id, SISTEMA, (c) => fotografarClinica(c, id, cl.fuso, hoje))
    } catch {
      falhas.push(cl.id)
    }
    // T3 (I-30): as tarefas "Lançar [KPI]", para a frente a partir do cursor.
    // Transação e `try` próprios: uma fotografia que falha não segura a
    // tarefa, nem o contrário. O log segue só com o id da clínica.
    try {
      tarefas += await banco.naClinica(id, SISTEMA, (c) => gerarTarefasDeLancamento(c, id, hoje))
    } catch {
      if (!falhas.includes(cl.id)) falhas.push(cl.id)
    }
  }
  return { processadas: clinicas.rows.length, gravadas, tarefas, falhas }
}
