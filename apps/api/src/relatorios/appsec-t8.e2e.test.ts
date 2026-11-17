import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { apagarPacientesDaExportacaoDeTeste } from '../banco/limpeza-de-teste'
import { type Cenario, desmontarCenario, limparEstoque, limparTarefas, montarCenario, postar } from '../tarefas/__tests__/cenario'
import { LIMITES_DO_MOTOR, LIMITES_PADRAO, type LimitesDoMotor } from './limites'

/**
 * Revisão appsec do T8 (docs/specs/indicadores-e-insights-t8-appsec.md):
 * as reproduções adversariais do revisor, adotadas como regressão. ADV-1 e
 * ADV-2 foram APERTADAS na correção do B1 (exatamente o limite; o 429 vem
 * logo depois do 503), nunca afrouxadas.
 */
let c: Cenario
const limites: { -readonly [K in keyof LimitesDoMotor]: LimitesDoMotor[K] } = { ...LIMITES_PADRAO }
const URL_MIG = process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const OUTUBRO = { de: '2026-10-01', ate: '2026-10-31' }
const executar = (chave: string, filtros: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/relatorios/${chave}/execucoes`, { filtros }, quem)
const exportar = (chave: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/relatorios/${chave}/exportacoes`, corpo, quem)

async function zerar(): Promise<void> {
  await apagarPacientesDaExportacaoDeTeste(c.migrate, c.clinica)
  await c.migrate.query('DELETE FROM tentativas_de_relatorio WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('BEGIN')
  await c.migrate.query('ALTER TABLE auditoria DISABLE TRIGGER auditoria_sem_update')
  await c.migrate.query(`DELETE FROM auditoria WHERE clinica_id = $1 AND entidade IN ('relatorio', 'exportacao_de_relatorio')`, [c.clinica])
  await c.migrate.query('ALTER TABLE auditoria ENABLE TRIGGER auditoria_sem_update')
  await c.migrate.query('COMMIT')
}

beforeAll(async () => {
  c = await montarCenario('relatorios-appsec', [{ token: LIMITES_DO_MOTOR, valor: limites }])
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores'] WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec', 'pf_ter', 'pf_cxa')`,
    [c.clinica],
  )
  await c.migrate.query(`UPDATE perfis SET perms = perms || ARRAY['estoque.gerir'] WHERE clinica_id = $1 AND chave = 'pf_ter'`, [c.clinica])
})
afterAll(async () => {
  await zerar()
  await limparEstoque(c)
  await limparTarefas(c)
  await desmontarCenario(c)
})
beforeEach(async () => {
  Object.assign(limites, LIMITES_PADRAO)
  await zerar()
  await limparEstoque(c)
  await limparTarefas(c)
})

describe('C13 — limite por hora', () => {
  it('ADV-1 concorrência: N pedidos em paralelo passam do limite (count-then-insert sem trava)', async () => {
    limites.porHora = 3
    const rs = await Promise.all(Array.from({ length: 15 }, () => executar('tarefas-da-equipe', OUTUBRO, 'beatriz')))
    const ok = rs.filter((r) => r.statusCode === 200).length
    const gravadas = await c.migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM auditoria WHERE clinica_id = $1 AND ator_id = $2 AND entidade = 'relatorio'`,
      [c.clinica, c.pessoas['beatriz']],
    )
    console.info(`ADV-1: [${rs.map((r) => r.statusCode).join(',')}] ${ok} de 15 com 200 (limite 3); ${gravadas.rows[0]!.n} registros`)
    expect(ok).toBeLessThanOrEqual(3)
    // Exatamente o limite passa, e o resto é 429 — nem 500, nem 503.
    expect(ok).toBe(3)
    expect(rs.filter((r) => r.statusCode === 429)).toHaveLength(12)
    expect(gravadas.rows[0]!.n).toBe('3')
  })

  it('ADV-2 tentativa que estoura o tempo não conta: consultas de 10 s sem fim, nunca 429', async () => {
    limites.porHora = 1
    limites.tempoMaximoMs = 300
    const trava = new pg.Client({ connectionString: URL_MIG })
    await trava.connect()
    const status: number[] = []
    try {
      await trava.query('BEGIN')
      await trava.query('LOCK TABLE itens_de_estoque IN ACCESS EXCLUSIVE MODE')
      for (let i = 0; i < 4; i++) status.push((await executar('saidas-de-estoque', { modo: 'analise', ...OUTUBRO }, 'camila')).statusCode)
    } finally {
      await trava.query('ROLLBACK')
      await trava.end()
    }
    console.info(`ADV-2: status = ${status.join(',')}`)
    expect(status).toContain(429)
    // A tentativa que estourou o tempo CONTOU: a segunda já é 429, não 503.
    expect(status).toEqual([503, 429, 429, 429])
  })
})

describe('L-IN-6 / texto livre em relatório de classe nenhuma', () => {
  it('ADV-3 relatório 15: descrição livre de tarefa sem paciente_id leva nome e telefone de paciente, exportável sem aviso', async () => {
    await c.migrate.query(
      `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, tipo)
       VALUES ($1, $2, $2, 'Ligar para Ana Lúcia Souza (71) 98888-7777 sobre a Tirzepatida', '2026-10-20', 'aberta', '')`,
      [c.clinica, c.pessoas['beatriz']],
    )
    const r = await exportar('tarefas-da-equipe', { filtros: OUTUBRO, formato: 'csv' })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    console.info(`ADV-3: classe=${r.body.resultado.classe} aviso=${String(r.body.exportacao.cabecalho.aviso)}`)
    expect(r.text).not.toContain('Ana Lúcia')
    expect(r.text).not.toContain('98888')
    expect(r.text).not.toContain('Tirzepatida')
    const tela = await executar('tarefas-da-equipe', OUTUBRO)
    expect(tela.text).not.toMatch(/Ana Lúcia|98888|Tirzepatida/)
    expect((tela.body.linhas as { tarefa: string }[]).map((l) => l.tarefa)).toEqual(['Tarefa avulsa'])
  })

  it('ADV-4 relatório 11: motivo livre do movimento leva nome de paciente para quem não tem `jornada`', async () => {
    const item = (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO itens_de_estoque (clinica_id, nome, medida, custo, aproveita_sobra) VALUES ($1, 'Frasco adv', 'frasco', 10000, false) RETURNING id`,
        [c.clinica],
      )
    ).rows[0]!.id
    await c.migrate.query(
      `INSERT INTO movimentos_de_estoque (clinica_id, item_id, tipo, milesimos, dia, motivo, criado_por)
       VALUES ($1, $2, 'descarte', -200, '2026-10-06', 'Frasco da Ana Lúcia Souza caiu', $3)`,
      [c.clinica, item, c.pessoas['nara']],
    )
    const r = await executar('saidas-de-estoque', { modo: 'calendario', ...OUTUBRO }, 'camila')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    console.info(`ADV-4: classe=${r.body.classe}`)
    expect(r.text).not.toContain('Ana Lúcia')
  })
})
