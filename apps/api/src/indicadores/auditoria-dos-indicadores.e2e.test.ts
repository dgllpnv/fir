import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  botar,
  type Cenario,
  desmontarCenario,
  limparIndicadores,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * Appsec B1 (indicadores-e-insights-t3-t4-appsec.md): a trilha devolve
 * `to_jsonb(NEW)` em snake_case, e `valor_centavos`, `alvo_centavos` e
 * `partida_centavos` atravessavam `GET /v1/auditoria` para quem tem `config`
 * sem `valores`. A correção é a regra do sufixo `*Centavos` em
 * `ehCampoMonetario`. Este teste é o que a derruba se ela sair: mutação
 * conferida tirando o `endsWith('Centavos')` (os dois casos sem `valores`
 * falham com o número em claro).
 *
 * `juliana` (pf_rec) ganha `config` e não tem `valores`; `beatriz` (pf_sup) tem os dois.
 */
let c: Cenario

const LANCADO = '150043'
const ALVO = '990077'
const PARTIDA = '220011'

let kpi = ''

type Item = { entidade: string; de: Record<string, unknown> | null; para: Record<string, unknown> | null }

const trilhaDoKpi = async (entidade: string, quem: string): Promise<{ status: number; texto: string; itens: Item[] }> => {
  const r = await pegar(c, '/v1/auditoria', { entidade, limite: '200' }, quem)
  const itens = ((r.body as { itens?: Item[] }).itens ?? []).filter(
    (i) => i.para?.['kpi_id'] === kpi || i.de?.['kpi_id'] === kpi,
  )
  return { status: r.statusCode, texto: JSON.stringify(itens), itens }
}

beforeAll(async () => {
  c = await montarCenario('auditoria-dos-indicadores')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir']
      WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec')`,
    [c.clinica],
  )
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['config'] WHERE clinica_id = $1 AND chave = 'pf_rec' AND NOT ('config' = ANY(perms))`,
    [c.clinica],
  )

  const k = await postar(
    c,
    '/v1/indicadores/kpis',
    {
      origem: 'manual',
      nome: 'Faturamento do convênio',
      pilar: 'Financeiro',
      unidade: 'reais',
      direcao: 'maior',
      frequencia: 'mensal',
      diaDeLancamento: 5,
      comoMedir: 'x',
      responsavelId: c.pessoas['beatriz'],
    },
    'beatriz',
  )
  expect(k.statusCode, JSON.stringify(k.body)).toBe(201)
  kpi = k.body.id as string

  const l = await botar(c, `/v1/indicadores/kpis/${kpi}/lancamentos/2026-10-01`, { valor: LANCADO }, 'beatriz')
  expect(l.statusCode, JSON.stringify(l.body)).toBe(200)

  const o = await postar(
    c,
    '/v1/indicadores/okrs',
    {
      objetivo: 'Faturar',
      periodo: { tipo: 'datas', inicio: '2026-10-01', fim: '2026-10-31' },
      resultadosChave: [{ kpiId: kpi, alvo: ALVO, partida: PARTIDA }],
    },
    'beatriz',
  )
  expect(o.statusCode, JSON.stringify(o.body)).toBe(201)
})
afterAll(async () => {
  await limparIndicadores(c)
  await limparTarefas(c)
  await desmontarCenario(c)
})

describe('GET /v1/auditoria redige os *_centavos dos indicadores (appsec B1, regra 17)', () => {
  it('sem `valores`: o valor lançado em reais sai null na trilha de lancamentos_de_kpi', async () => {
    const t = await trilhaDoKpi('lancamentos_de_kpi', 'juliana')
    expect(t.status).toBe(200)
    expect(t.itens.length).toBeGreaterThan(0)
    for (const i of t.itens) expect(i.para).toHaveProperty('valor_centavos', null)
    expect(t.texto).not.toContain(LANCADO)
  })

  it('sem `valores`: alvo e partida do KR em reais saem null na trilha de metas_de_kpi', async () => {
    const t = await trilhaDoKpi('metas_de_kpi', 'juliana')
    expect(t.status).toBe(200)
    expect(t.itens.length).toBeGreaterThan(0)
    for (const i of t.itens) {
      expect(i.para).toHaveProperty('alvo_centavos', null)
      expect(i.para).toHaveProperty('partida_centavos', null)
    }
    expect(t.texto).not.toContain(ALVO)
    expect(t.texto).not.toContain(PARTIDA)
  })

  it('com `valores`: os mesmos números aparecem inteiros', async () => {
    const l = await trilhaDoKpi('lancamentos_de_kpi', 'beatriz')
    expect(l.status).toBe(200)
    expect(l.itens.some((i) => String(i.para?.['valor_centavos']) === LANCADO)).toBe(true)
    const m = await trilhaDoKpi('metas_de_kpi', 'beatriz')
    expect(m.itens.some((i) => String(i.para?.['alvo_centavos']) === ALVO)).toBe(true)
    expect(m.itens.some((i) => String(i.para?.['partida_centavos']) === PARTIDA)).toBe(true)
  })
})
