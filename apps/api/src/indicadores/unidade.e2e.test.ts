import { ListaDeKpis } from '@fir/contracts'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  limparFinanceiro,
  limparIndicadores,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * O filtro Unidade da tela de Indicadores (backlog 1.9 B; ADR
 * 2026-11-17-filtro-de-unidade-nos-indicadores). HOJE = 24/10/2026.
 * A clínica tem duas unidades (`principal`, `pituba`).
 */
let c: Cenario

const kpiNoBanco = async (chave: string): Promise<string> =>
  (
    await c.migrate.query<{ id: string }>(
      `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia) VALUES ($1, 'catalogo', $2, $2, 'mensal') RETURNING id`,
      [c.clinica, chave],
    )
  ).rows[0]!.id

const novo = (nome: string, unidade: string | null) =>
  c.migrate.query(
    `INSERT INTO pacientes (clinica_id, nome, unidade_id, criado_em) VALUES ($1, $2, $3, '2026-10-10T12:00:00Z')`,
    [c.clinica, nome, unidade],
  )

const lista = async (q: Record<string, string> = {}) => {
  const r = await pegar(c, '/v1/indicadores', q, 'beatriz')
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return ListaDeKpis.parse(r.body)
}

beforeAll(async () => {
  c = await montarCenario('indicadores-unidade')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir'] WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec')`,
    [c.clinica],
  )
})
afterAll(async () => {
  await limparIndicadores(c)
  await limparFinanceiro(c)
  await limparTarefas(c)
  await c.migrate.query(`DELETE FROM pacientes WHERE clinica_id = $1 AND nome LIKE 'Unidade T %'`, [c.clinica])
  await c.migrate.query(`DELETE FROM unidades WHERE clinica_id = $1`, [c.outraClinica])
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparIndicadores(c)
  await limparFinanceiro(c)
  await c.migrate.query(`DELETE FROM pacientes WHERE clinica_id = $1 AND nome LIKE 'Unidade T %'`, [c.clinica])
})

describe('GET /v1/indicadores?unidade', () => {
  it('novos pacientes se mede pela unidade principal da paciente; o resto diz "não se divide" e mantém o número da clínica', async () => {
    await novo('Unidade T Um', c.unidades['pituba']!)
    await novo('Unidade T Dois', c.unidades['pituba']!)
    await novo('Unidade T Três', c.unidades['principal']!)
    await novo('Unidade T Quatro', null)
    const novos = await kpiNoBanco('novos_pacientes')
    const fat = await kpiNoBanco('faturamento_conferido')
    const semFiltro = await lista()
    const naPituba = await lista({ unidade: c.unidades['pituba']! })
    const doKpi = (l: ListaDeKpis, id: string) => l.itens.find((k) => k.id === id)!
    expect(doKpi(semFiltro, novos).atual.emNumero).toBe('400')
    expect(doKpi(naPituba, novos).atual.emNumero).toBe('200')
    expect(doKpi((await lista({ unidade: c.unidades['principal']! })), novos).atual.emNumero).toBe('100')
    expect(doKpi(naPituba, novos).naoSeDividePorUnidade).toBe(false)
    expect(doKpi(naPituba, fat).naoSeDividePorUnidade).toBe(true)
    expect(doKpi(naPituba, fat).atual).toEqual(doKpi(semFiltro, fat).atual)
    expect(doKpi(semFiltro, fat).naoSeDividePorUnidade).toBe(false)
  })

  it('a meta é da clínica: com o filtro, a meta sai igual e o número da unidade não ganha percentual da meta', async () => {
    await novo('Unidade T Um', c.unidades['pituba']!)
    await novo('Unidade T Dois', c.unidades['principal']!)
    const novos = await kpiNoBanco('novos_pacientes')
    const m = await postar(c, '/v1/indicadores/metas', { kpiId: novos, tipo: 'mes', inicio: '2026-10-01', prazo: '2026-10-31', alvo: '1000' }, 'beatriz')
    expect(m.statusCode, JSON.stringify(m.body)).toBe(201)
    const semFiltro = (await lista()).itens.find((k) => k.id === novos)!
    const naPituba = (await lista({ unidade: c.unidades['pituba']! })).itens.find((k) => k.id === novos)!
    expect(naPituba.metaVigente).toEqual(semFiltro.metaVigente)
    expect(semFiltro.atual.percentualDaMeta).toBe(20)
    expect(naPituba.atual.percentualDaMeta).toBeNull()
  })

  it('ids-de-outra-clinica: a unidade da vizinha é 422, nunca 500 nem lista', async () => {
    const vizinha = (
      await c.migrate.query<{ id: string }>(`INSERT INTO unidades (clinica_id, nome) VALUES ($1, 'Unidade da vizinha') RETURNING id`, [c.outraClinica])
    ).rows[0]!.id
    const r = await pegar(c, '/v1/indicadores', { unidade: vizinha }, 'beatriz')
    expect(r.statusCode).toBe(422)
    expect((await pegar(c, '/v1/indicadores', { unidade: 'nao-e-uuid' }, 'beatriz')).statusCode).toBe(400)
  })
})
