import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparProgramas,
  montarCenario,
  postar,
  tarefaCrua,
} from '../tarefas/__tests__/cenario'
import { criarPersona } from '../tarefas/__tests__/persona-extra'

/**
 * F9 (appsec, regra 17, spec S-28): quem fecha mas NÃO tem `valores` não pode
 * descobrir o valor do orçamento pela RESPOSTA de `fechar`.
 *
 * A comparação "entrada + em aberto >= oferta" falhava ANTES das outras
 * validações; então "X acima da oferta" e "X abaixo da oferta" voltavam
 * respostas diferentes, e a recepção achava o número por tentativa e erro.
 * Sem `valores`, a comparação roda por último: as duas tentativas recebem o
 * mesmo erro, e nada é gravado.
 */
let c: Cenario
const PROC = '11111111-1111-4111-8111-111111111111'
const OFERTA = '2500000'

beforeAll(async () => {
  c = await montarCenario('fechar-sem-oraculo')
  await criarPersona(c, 'fechador', ['pacientes', 'jornada', 'receber'])
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparProgramas(c)
})

/** Um orçamento de 25.000, com dois procedimentos listados (ou nenhum). */
async function orcamento(comItens: boolean): Promise<string> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['fechador'],
      quando: { modo: 'retroativo', em: HOJE },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  const id = r.body.tarefa.id as string
  const o = await postar(c, `/v1/tarefas/${id}/jornada`, { acao: 'registrarOrcamento', valor: OFERTA }, 'beatriz')
  expect(o.statusCode, JSON.stringify(o.body)).toBe(200)
  if (comItens) {
    await c.migrate.query(`UPDATE tarefas SET itens_orcamento = $2::jsonb WHERE id = $1`, [
      id,
      JSON.stringify([
        { chave: 'a', procedimentoId: PROC },
        { chave: 'b', procedimentoId: PROC },
      ]),
    ])
  }
  return id
}

const fechar = (id: string, quem: string, corpo: Record<string, unknown>) =>
  postar(c, `/v1/tarefas/${id}/jornada`, { acao: 'fechar', ...corpo }, quem)

const recebimentos = async (id: string): Promise<number> =>
  (
    await c.migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM recebimentos WHERE tarefa_id = $1',
      [id],
    )
  ).rows[0]!.n === '0'
    ? 0
    : 1

const ABAIXO = '1000000'
const ACIMA = '3000000'
const entrada = (valor: string) => ({ valor, forma: 'Pix', valorAberto: '0' })

describe('F9 — fechar sem `valores` não revela se o valor passa da oferta', () => {
  it('parcial: X abaixo e X acima da oferta devolvem status e corpo IDÊNTICOS, e nada é gravado', async () => {
    const id = await orcamento(true)
    // Os dois falham pelo mesmo motivo alheio ao valor: nenhum procedimento marcado.
    const abaixo = await fechar(id, 'fechador', { fechamento: 'parte', recebimento: entrada(ABAIXO) })
    const acima = await fechar(id, 'fechador', { fechamento: 'parte', recebimento: entrada(ACIMA) })
    expect(abaixo.statusCode, JSON.stringify(abaixo.body)).toBe(400)
    expect(acima.statusCode).toBe(abaixo.statusCode)
    expect(acima.body).toEqual(abaixo.body)
    expect(await recebimentos(id)).toBe(0)
    expect((await tarefaCrua(c, id))!.etapa).toBe('orcamento')
  })

  it('tudo: com itens marcados (só valem no parcial), soma que fecha e que não fecha dão o MESMO erro', async () => {
    const id = await orcamento(true)
    const completa = await fechar(id, 'fechador', {
      fechamento: 'tudo',
      recebimento: entrada(OFERTA),
      itensFechados: ['a'],
    })
    const incompleta = await fechar(id, 'fechador', {
      fechamento: 'tudo',
      recebimento: entrada(ABAIXO),
      itensFechados: ['a'],
    })
    expect(completa.statusCode, JSON.stringify(completa.body)).toBe(400)
    expect(incompleta.statusCode).toBe(completa.statusCode)
    expect(incompleta.body).toEqual(completa.body)
    expect(await recebimentos(id)).toBe(0)
  })

  it('a recusa que SOBRA (valor acima, tudo o mais válido) não carrega o número e não grava nada', async () => {
    const id = await orcamento(false)
    const r = await fechar(id, 'fechador', { fechamento: 'parte', recebimento: entrada(ACIMA) })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(400)
    expect(JSON.stringify(r.body)).not.toMatch(/25\.000|2500000|3\.000|3000000/)
    expect(await recebimentos(id)).toBe(0)
  })

  it('quem fecha o orçamento todo (a soma completa a oferta) continua conseguindo', async () => {
    const id = await orcamento(false)
    const r = await fechar(id, 'fechador', { fechamento: 'tudo', recebimento: entrada(OFERTA) })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(await recebimentos(id)).toBe(1)
  })

  it('quem fecha uma parte abaixo da oferta (sem itens listados) continua conseguindo', async () => {
    const id = await orcamento(false)
    const r = await fechar(id, 'fechador', { fechamento: 'parte', recebimento: entrada(ABAIXO) })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  })

  it('COM `valores` nada muda: a frase ainda diz a oferta e a ordem das recusas é a de sempre', async () => {
    const id = await orcamento(true)
    const r = await fechar(id, 'beatriz', { fechamento: 'parte', recebimento: entrada(ACIMA) })
    expect(r.statusCode).toBe(400)
    expect(JSON.stringify(r.body)).toContain('25.000,00')
  })
})
