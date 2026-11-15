/**
 * Validação numérica do F5 (validador-numeros, 2026-11-15): o ciclo
 * fechar → reabrir → fechar → excluir volta EXATAMENTE ao estado de antes —
 * receita, LTV (API e banco) e saldo por adesão —, com e sem pagamento da consulta.
 */
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import {
  type Cenario, desmontarCenario, HOJE, limparProgramas, limparFinanceiro, montarCenario, pegar, postar, receitaDoDia,
} from '../tarefas/__tests__/cenario'

let c: Cenario
let proc: { id: string }[]
beforeAll(async () => {
  c = await montarCenario('auditoria-f5')
  proc = (await c.migrate.query<{ id: string }>('SELECT id FROM procedimentos WHERE clinica_id = $1 ORDER BY nome LIMIT 1', [c.clinica])).rows
}, 60_000)
afterAll(async () => { await desmontarCenario(c) })
beforeEach(async () => { await limparFinanceiro(c); await limparProgramas(c) })

const MOTIVO = 'Fechei o orçamento errado, preciso refazer'
const mover = (id: string, corpo: Record<string, unknown>) => postar(c, `/v1/tarefas/${id}/jornada`, corpo, 'beatriz')

function acharLtv(o: unknown): string | undefined {
  if (o === null || typeof o !== 'object') return undefined
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (k === 'ltv') return String(v)
    const x = acharLtv(v); if (x !== undefined) return x
  }
  return undefined
}
async function estado() {
  const pid = c.pacientes['ana']!
  const f = await pegar(c, `/v1/pacientes/${pid}`, {}, 'beatriz')
  const s = await pegar(c, `/v1/pacientes/${pid}/saldo`, {}, 'beatriz')
  const ltvDb = (await c.migrate.query<{ v: string }>(
    `SELECT coalesce(sum(valor),0)::text v FROM recebimentos WHERE clinica_id=$1 AND paciente_id=$2 AND estornado_em IS NULL AND valor > 0`, [c.clinica, pid])).rows[0]!.v
  return {
    receita: (await receitaDoDia(c)).toString(),
    ltvApi: acharLtv(f.body),
    ltvDb,
    saldo: s.body.saldo,
    grupos: JSON.stringify(s.body.grupos),
  }
}

async function consulta(pagamento?: Record<string, string>) {
  const r = await postar(c, '/v1/tarefas', {
    vinculo: 'paciente', pacienteId: c.pacientes['ana'], tipo: 'Consulta agendada', responsavelId: c.pessoas['beatriz'],
    quando: { modo: 'retroativo', em: HOJE, ...(pagamento ? { pagamento } : {}) },
  }, 'beatriz')
  expect(r.statusCode, r.text).toBe(201)
  const id = r.body.tarefa.id as string
  const o = await mover(id, { acao: 'registrarOrcamento', valor: '1000000',
    programa: [{ chave: 'p1', procedimentoId: proc[0]!.id, sessoes: 4, intervaloDias: 7 }] })
  expect(o.statusCode, o.text).toBe(200)
  return id
}
const fechar = (id: string) => mover(id, { acao: 'fechar', fechamento: 'tudo',
  recebimento: { valor: '400000', forma: 'Pix', valorAberto: '600000' } })

for (const comPagamento of [true, false]) {
  it(`ciclo fechar→reabrir→fechar→reabrir→fechar→excluir (consulta ${comPagamento ? 'paga 500 + 200 aberto' : 'sem pagamento'})`, async () => {
    const id = await consulta(comPagamento ? { valor: '50000', forma: 'Pix', valorAberto: '20000' } : undefined)
    const antes = await estado()
    console.log('ANTES', antes)
    expect(antes.receita).toBe(comPagamento ? '50000' : '0')
    expect(antes.saldo).toBe(comPagamento ? '20000' : '0')
    for (const acao of ['reabrirOrcamento', 'reabrirOrcamento', 'excluirOrcamento']) {
      const f = await fechar(id); expect(f.statusCode, f.text).toBe(200)
      const fechado = await estado()
      console.log('FECHADO', fechado)
      expect(BigInt(fechado.receita)).toBe(BigInt(antes.receita) + 400000n)
      expect(BigInt(fechado.ltvDb)).toBe(BigInt(antes.ltvDb) + 400000n)
      expect(BigInt(fechado.saldo)).toBe(BigInt(antes.saldo) + 600000n)
      const r = await mover(id, { acao, motivo: MOTIVO }); expect(r.statusCode, r.text).toBe(200)
      const depois = await estado()
      console.log('DEPOIS', acao, depois)
      expect(depois).toEqual(antes)
      if (acao === 'excluirOrcamento') break
    }
  })
}
