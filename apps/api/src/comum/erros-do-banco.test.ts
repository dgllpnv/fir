import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Cenario, desmontarCenario, HOJE, montarCenario, pegar, postar } from '../tarefas/__tests__/cenario'

/**
 * Caçada de "Internal server error" (pedido da cliente, 12/11): cada caso aqui
 * já foi um 500 de verdade — local ou em produção. A recepção nunca deve ver o
 * erro genérico por entrada que o contrato podia ter recusado.
 */
let c: Cenario
beforeAll(async () => {
  c = await montarCenario('erros-do-banco')
})
afterAll(async () => {
  await desmontarCenario(c)
})

const tarefa = (descricao: string) => ({
  vinculo: 'paciente',
  pacienteId: c.pacientes['ana'],
  tipo: 'Consulta agendada',
  descricao,
  responsavelId: c.pessoas['beatriz'],
  quando: { modo: 'retroativo', em: HOJE },
})

describe('entrada que estourava o banco vira 4xx legível', () => {
  it('byte nulo em texto (colagem de planilha) não é 500', async () => {
    const r = await postar(c, '/v1/tarefas', tarefa('a\u0000b'), 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBeLessThan(500)
    expect(r.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('data que não existe no calendário (31/02) é 400 com a frase do contrato', async () => {
    const r = await pegar(c, '/v1/hoje', { dia: '2026-02-30' }, 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(400)
  })

  it('valor com 19 dígitos (estoura o bigint) é recusado na borda', async () => {
    const r = await postar(
      c,
      '/v1/recebimentos',
      { pacienteId: c.pacientes['ana'], tipo: 'Pagamento de consulta', forma: 'Pix', valor: '9999999999999999999' },
      'beatriz',
    )
    expect(r.statusCode, JSON.stringify(r.body)).toBeLessThan(500)
  })

  it('tipo "Sessão de plano" criado à mão não é 500', async () => {
    const r = await postar(c, '/v1/tarefas', { ...tarefa('x'), tipo: 'Sessão de plano' }, 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBeLessThan(500)
  })
})
