/**
 * Validação numérica do F1 (validador-numeros, 2026-11-15): sem `valores`, a
 * recusa da oferta no fim do `fechar` desfaz TUDO (recebimentos, partes,
 * programa, tarefa companheira); o fechamento certo grava exatamente uma vez.
 */
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  type Cenario, desmontarCenario, HOJE, limparProgramas, limparFinanceiro, montarCenario, pegar, postar, receitaDoDia,
} from '../tarefas/__tests__/cenario'
import { criarPersona } from '../tarefas/__tests__/persona-extra'

let c: Cenario
let proc: { id: string }[]
beforeAll(async () => {
  c = await montarCenario('auditoria-receb')
  await criarPersona(c, 'fechador', ['pacientes', 'jornada', 'receber'])
  proc = (await c.migrate.query<{ id: string }>('SELECT id FROM procedimentos WHERE clinica_id = $1 ORDER BY nome LIMIT 1', [c.clinica])).rows
}, 60_000)
afterAll(async () => { await desmontarCenario(c) })
beforeEach(async () => { await limparFinanceiro(c); await limparProgramas(c) })

const pid = () => c.pacientes['ana']!
const saldo = async () => (await pegar(c, `/v1/pacientes/${pid()}/saldo`, {}, 'beatriz')).body.saldo as string
const contar = async (sql: string) => Number((await c.migrate.query<{ n: string }>(sql, [c.clinica])).rows[0]!.n)
const nRec = () => contar('SELECT count(*)::text n FROM recebimentos WHERE clinica_id=$1')
const nPartes = () => contar('SELECT count(*)::text n FROM recebimento_partes WHERE clinica_id=$1')
const nProg = () => contar('SELECT count(*)::text n FROM programas WHERE clinica_id=$1')
const nTar = () => contar('SELECT count(*)::text n FROM tarefas WHERE clinica_id=$1')
const avulso = (x: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, '/v1/recebimentos', { requisicaoId: randomUUID(), pacienteId: pid(), em: HOJE, ...x }, quem)
const divida400 = async () => {
  const r = await avulso({ ref: 'consulta', valor: '10000', forma: 'Pix', valorAberto: '40000' })
  expect(r.statusCode, r.text).toBe(201)
  expect(await saldo()).toBe('40000')
  expect(await receitaDoDia(c)).toBe(10000n)
}

it('uma forma acima da divida: corta no devido (400), partes somam 400, saldo 0; reenvio 3x nao duplica', async () => {
  await divida400()
  const req = randomUUID()
  const corpo = { requisicaoId: req, pacienteId: pid(), em: HOJE, ref: 'saldo', valor: '50000', forma: 'Pix' }
  for (let i = 0; i < 3; i++) {
    const r = await postar(c, '/v1/recebimentos', corpo, 'beatriz')
    expect([200, 201], r.text).toContain(r.statusCode)
    console.log('reenvio', i, r.statusCode, JSON.stringify(r.body).slice(0, 200))
  }
  expect(await saldo()).toBe('0')
  expect(await receitaDoDia(c)).toBe(50000n)
  expect(await nRec()).toBe(2)
  const p = await c.migrate.query<{ forma: string; valor: string; rv: string }>(
    `SELECT pt.forma, pt.valor::text valor, r.valor::text rv FROM recebimento_partes pt JOIN recebimentos r ON r.id=pt.recebimento_id WHERE r.requisicao_id=$1`, [req])
  expect(p.rows).toEqual([{ forma: 'Pix', valor: '40000', rv: '40000' }])
})

it('varias formas acima da divida: 409 sem gravar; com valores leva devido=40000, sem valores nao leva', async () => {
  await divida400()
  const partes = [{ forma: 'Pix', valor: '30000' }, { forma: 'Dinheiro', valor: '20000' }]
  const a = await avulso({ ref: 'saldo', valor: '50000', partes })
  expect(a.statusCode, a.text).toBe(409)
  expect(a.body.codigo).toBe('PARTES_ACIMA_DA_DIVIDA')
  expect(a.body.devido).toBe('40000')
  const b = await avulso({ ref: 'saldo', valor: '50000', partes }, 'rita')
  expect(b.statusCode, b.text).toBe(409)
  expect(b.body.devido).toBeUndefined()
  expect(await nRec()).toBe(1)
  expect(await nPartes()).toBe(1)
  expect(await saldo()).toBe('40000')
  expect(await receitaDoDia(c)).toBe(10000n)
})

it('varias formas exatamente na divida (200+200=400): grava, saldo 0, receita +400', async () => {
  await divida400()
  const r = await avulso({ ref: 'saldo', valor: '40000', partes: [{ forma: 'Pix', valor: '20000' }, { forma: 'Dinheiro', valor: '20000' }] })
  expect(r.statusCode, r.text).toBe(201)
  expect(await saldo()).toBe('0')
  expect(await receitaDoDia(c)).toBe(50000n)
  expect(await nPartes()).toBe(3)
  const z = await avulso({ ref: 'saldo', valor: '25000', partes: [{ forma: 'Pix', valor: '15000' }, { forma: 'Dinheiro', valor: '10000' }] })
  expect(z.statusCode, z.text).toBe(409)
  expect(await nRec()).toBe(2)
})

for (const consultaPaga of [false, true]) {
  it(`fechar sem valores, soma != oferta, COM programa (consulta ${consultaPaga ? 'paga' : 'sem pagamento'}): 400 e nada sobra`, async () => {
    const r = await postar(c, '/v1/tarefas', {
      vinculo: 'paciente', pacienteId: pid(), tipo: 'Consulta agendada', responsavelId: c.pessoas['fechador'],
      quando: { modo: 'retroativo', em: HOJE, ...(consultaPaga ? { pagamento: { valor: '50000', forma: 'Pix' } } : {}) },
    }, 'beatriz')
    expect(r.statusCode, r.text).toBe(201)
    const id = r.body.tarefa.id as string
    const o = await postar(c, `/v1/tarefas/${id}/jornada`, { acao: 'registrarOrcamento', valor: '1000000',
      programa: [{ chave: 'p1', procedimentoId: proc[0]!.id, sessoes: 4, intervaloDias: 7 }] }, 'beatriz')
    expect(o.statusCode, o.text).toBe(200)
    const foto = async () => ({ rec: await nRec(), partes: await nPartes(), prog: await nProg(), tar: await nTar(), receita: await receitaDoDia(c), saldo: await saldo() })
    const antes = await foto()
    const f = await postar(c, `/v1/tarefas/${id}/jornada`, { acao: 'fechar', fechamento: 'tudo',
      recebimento: { valor: '400000', forma: 'Pix', valorAberto: '500000' } }, 'fechador')
    expect(f.statusCode, f.text).toBe(400)
    const depois = await foto()
    console.log('F1', consultaPaga, antes, depois, f.text)
    expect(depois).toEqual(antes)
    const ok = await postar(c, `/v1/tarefas/${id}/jornada`, { acao: 'fechar', fechamento: 'tudo',
      recebimento: { valor: '400000', forma: 'Pix', valorAberto: '600000' } }, 'fechador')
    expect(ok.statusCode, ok.text).toBe(200)
    expect(await nRec()).toBe(antes.rec + 1)
    expect(await receitaDoDia(c)).toBe(antes.receita + 400000n)
    expect(BigInt(await saldo())).toBe(BigInt(antes.saldo) + 600000n)
    expect(await nProg()).toBe(antes.prog + 1)
    const dup = await postar(c, `/v1/tarefas/${id}/jornada`, { acao: 'fechar', fechamento: 'tudo',
      recebimento: { valor: '400000', forma: 'Pix', valorAberto: '600000' } }, 'fechador')
    expect(dup.statusCode).not.toBe(200)
    expect(await nRec()).toBe(antes.rec + 1)
    expect(await receitaDoDia(c)).toBe(antes.receita + 400000n)
  })
}
