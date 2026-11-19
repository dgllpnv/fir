import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  botar,
  type Cenario,
  desmontarCenario,
  limparFinanceiro,
  limparTarefas,
  montarCenario,
  pegar,
} from '../tarefas/__tests__/cenario'

/**
 * **O AGUARDANDO EM REAIS NO KPI** (backlog 1.2; ADR
 * 2026-11-19-aguardando-em-reais-com-finmes), por HTTP sobre Postgres real.
 *
 * HOJE = sábado 24/10/2026 (America/Bahia), caixa de hoje aberto.
 * `conferencia_desde` = 01/10. Fechados: 01 a 19/10 e 21/10. Sem caixa e com
 * recebimento: 20/10 (2.500,00) e 22/10 (3.800,00) — R$ 6.300,00 em 2 dias.
 * Hoje tem 1.920,00, que nunca atravessa (regra 6).
 *
 * - `beatriz` (pf_sup): `valores` + `finmes` → o valor atravessa;
 * - `camila` (pf_ter): `valores` SEM `finmes` → `null`;
 * - `juliana` (pf_rec): equipe, sem `valores` → `null`.
 */
let c: Cenario
let kpiId = ''

const MES = '2026-10'
const AGUARDANDO = '630000'
const DE_HOJE = '192000'

type Item = {
  id: string
  chave: string | null
  atual: { emDinheiro: string | null }
  diasAguardando: number
  aguardandoFechamento?: string | null
  diasAnterioresAguardandoFechamento?: number | null
}

const receber = (instante: string, valor: string) =>
  c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, valor_aberto, forma, recebido_em, registrado_por)
     VALUES ($1, $2, 'Pagamento de consulta', $3, 0, 'Pix', $4::timestamptz, $5)`,
    [c.clinica, c.pacientes['ana'], valor, instante, c.pessoas['beatriz']],
  )

const doFaturamento = async (quem: string) => {
  const r = await pegar(c, '/v1/indicadores', {}, quem)
  expect(r.status, r.text).toBe(200)
  const k = (r.body.itens as Item[]).find((x) => x.chave === 'faturamento_conferido')
  expect(k).toBeDefined()
  return { k: k!, texto: r.text, itens: r.body.itens as Item[] }
}

beforeAll(async () => {
  c = await montarCenario('aguardando-em-reais')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores']
      WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_ter', 'pf_rec')`,
    [c.clinica],
  )
  await limparFinanceiro(c)
  await limparTarefas(c)
  for (let d = 1; d <= 21; d++) {
    if (d === 20) continue
    await c.migrate.query(`INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1, $2::date, '', $3)`, [
      c.clinica,
      `${MES}-${String(d).padStart(2, '0')}`,
      c.pessoas['beatriz'],
    ])
  }
  await c.migrate.query(`UPDATE clinicas SET conferencia_desde = '2026-10-01' WHERE id = $1`, [c.clinica])
  await receber('2026-10-10T12:00:00Z', '100000')
  await receber('2026-10-20T12:00:00Z', '250000')
  await receber('2026-10-22T12:00:00Z', '380000')
  await receber('2026-10-24T12:00:00Z', DE_HOJE)
  const k = await c.migrate.query<{ id: string }>(
    `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia, criado_em)
     VALUES ($1, 'catalogo', 'faturamento_conferido', 'Faturamento conferido', 'mensal', '2026-10-01T12:00:00Z') RETURNING id`,
    [c.clinica],
  )
  kpiId = k.rows[0]!.id
  await c.migrate.query(
    `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia, criado_em)
     VALUES ($1, 'catalogo', 'ticket_medio', 'Ticket médio', 'mensal', '2026-10-01T12:00:00Z')`,
    [c.clinica],
  )
  // Uma meta muito acima do medido: o KPI entra em "da semana" (abaixo do ritmo).
  expect((await botar(c, `/v1/metas/${MES}`, { valor: '100000000' }, 'beatriz')).statusCode).toBe(200)
}, 120_000)

afterAll(async () => {
  await limparFinanceiro(c)
  await limparTarefas(c)
  await desmontarCenario(c)
})

describe('com `finmes`: o total aguardando atravessa, o mesmo da Visão do mês', () => {
  it('aguardando-com-finmes: lista e detalhe = `aguardandoFechamento` da Visão do mês, centavo a centavo', async () => {
    const v = await pegar(c, '/v1/visao-do-mes', { mes: MES }, 'beatriz')
    expect(v.status, v.text).toBe(200)
    expect(v.body.aguardandoFechamento).toBe(AGUARDANDO)

    const { k, texto, itens } = await doFaturamento('beatriz')
    expect(k.aguardandoFechamento).toBe(v.body.aguardandoFechamento)
    expect(k.diasAnterioresAguardandoFechamento).toBe(v.body.diasAnterioresAguardandoFechamento)
    expect(k.diasAnterioresAguardandoFechamento).toBe(2)
    // 20/10, 22/10 e hoje (aberto).
    expect(k.diasAguardando).toBe(3)
    // O de hoje nunca, nem para quem tem `finmes` (regra 6).
    expect(texto).not.toContain(DE_HOJE)
    // Só o faturamento conferido leva o aguardando.
    expect(itens.find((x) => x.chave === 'ticket_medio')!.aguardandoFechamento).toBeNull()

    const d = await pegar(c, `/v1/indicadores/kpis/${kpiId}`, {}, 'beatriz')
    expect(d.status, d.text).toBe(200)
    expect(d.body.aguardandoFechamento).toBe(v.body.aguardandoFechamento)
    expect(d.body.diasAnterioresAguardandoFechamento).toBe(2)
    expect(d.text).not.toContain(DE_HOJE)
  })
})

describe('sem `finmes`: null', () => {
  it('aguardando-valores-sem-finmes: quem vê valores mas não tem `finmes` lê null', async () => {
    const { k, texto } = await doFaturamento('camila')
    // `valores` funciona: o número grande atravessa.
    expect(k.atual.emDinheiro).not.toBeNull()
    expect(k.aguardandoFechamento).toBeNull()
    expect(k.diasAnterioresAguardandoFechamento).toBe(2)
    expect(texto).not.toContain(AGUARDANDO)
    const d = await pegar(c, `/v1/indicadores/kpis/${kpiId}`, {}, 'camila')
    expect(d.body.aguardandoFechamento).toBeNull()
    expect(d.text).not.toContain(AGUARDANDO)
    // A mesma regra na rota da meta, que a equipe lê (ponto único).
    const p = await pegar(c, `/v1/metas/${MES}/percentual`, {}, 'camila')
    expect(p.status).toBe(200)
    expect(p.body.aguardandoFechamento).toBeNull()
  })

  it('aguardando-equipe: sem `valores`, null — só a contagem de dias', async () => {
    const { k, texto } = await doFaturamento('juliana')
    expect(k.aguardandoFechamento).toBeNull()
    expect(k.diasAguardando).toBe(3)
    expect(texto).not.toContain(AGUARDANDO)
  })
})

describe('nunca em "da semana" nem no Modo reunião', () => {
  it('aguardando-fora-da-semana-e-da-reuniao: nem a chave, nem o valor, mesmo com `finmes`', async () => {
    const s = await pegar(c, '/v1/indicadores/da-semana', {}, 'beatriz')
    expect(s.status, s.text).toBe(200)
    expect((s.body.itens as unknown[]).length).toBeGreaterThan(0)
    const r = await pegar(c, '/v1/indicadores/reuniao', {}, 'beatriz')
    expect(r.status, r.text).toBe(200)
    for (const t of [s.text, r.text]) {
      expect(t).not.toContain('aguardandoFechamento')
      expect(t).not.toContain(AGUARDANDO)
      expect(t).not.toContain(DE_HOJE)
    }
  })
})
