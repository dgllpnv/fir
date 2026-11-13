import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  apagar,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparProgramas,
  montarCenario,
  pegar,
  postar,
  receitaDoDia,
} from '../tarefas/__tests__/cenario'

/**
 * EXCLUIR O CARTÃO FECHADO COM PAGAMENTO (e a companheira "Pagamento de
 * orçamento"): o que tinha de sumir, some — com ASSERÇÃO.
 *
 * O saldo da paciente é derivado e agrupado por adesão (regra 5). Estornar a
 * entrada e arquivar o programa tem de zerar o grupo da adesão (ele não pode
 * continuar aparecendo com saldo), e a receita do mês e a visão do mês caem
 * exatamente o que entrou — nem um centavo a mais, nem a menos.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('excluir-saldo-adesao')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparFinanceiro(c)
  await limparProgramas(c)
})

const mover = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, quem)

type Grupo = { programaId: string | null; saldo: string | null }

const saldoDaAna = async () => {
  const r = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}/saldo`, {}, 'beatriz')
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return r.body as { grupos: Grupo[]; saldo: string | null; temSaldo: boolean }
}

const recebidoNoMes = async (): Promise<bigint> => {
  const r = await pegar(c, '/v1/visao-do-mes', { mes: '2026-10' }, 'beatriz')
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return BigInt(r.body.recebido as string)
}

/** Consulta com R$ 500 embutidos + orçamento de R$ 25.000 fechado: R$ 10.000 agora, R$ 15.000 em aberto. */
async function fechadaComPagamento(): Promise<{ id: string; programaId: string }> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta realizada',
      responsavelId: c.pessoas['beatriz'],
      quando: { modo: 'retroativo', em: HOJE, pagamento: { valor: '50000', forma: 'Pix' } },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  const id = r.body.tarefa.id as string
  const tirze = (
    await c.migrate.query<{ id: string }>(
      `SELECT id FROM procedimentos WHERE clinica_id = $1 AND nome_chave = 'tirzepatida'`,
      [c.clinica],
    )
  ).rows[0]!.id
  const o = await mover(id, {
    acao: 'registrarOrcamento',
    valor: '2500000',
    programa: [{ chave: 'a', procedimentoId: tirze, sessoes: 4, intervaloDias: 7 }],
  })
  expect(o.statusCode, JSON.stringify(o.body)).toBe(200)
  const f = await mover(id, {
    acao: 'fechar',
    recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '1500000' },
  })
  expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
  const prog = await c.migrate.query<{ id: string }>(
    'SELECT id FROM programas WHERE tarefa_de_origem_id = $1',
    [id],
  )
  expect(prog.rowCount).toBe(1)
  return { id, programaId: prog.rows[0]!.id }
}

describe('excluir a tarefa fechada com pagamento e companheira', () => {
  it('o saldo por adesão zera, o grupo da adesão some, e a receita do mês cai exatamente a entrada', async () => {
    const { id, programaId } = await fechadaComPagamento()

    // ANTES: o grupo da adesão existe e deve 15.000; a receita do mês é 500 + 10.000.
    const antes = await saldoDaAna()
    const grupoAntes = antes.grupos.find((g) => g.programaId === programaId)
    expect(grupoAntes, 'o grupo da adesão deveria existir antes de excluir').toBeDefined()
    expect(grupoAntes!.saldo).toBe('1500000')
    expect(antes.saldo).toBe('1500000')
    const receitaAntes = await receitaDoDia(c)
    const mesAntes = await recebidoNoMes()
    expect(receitaAntes).toBe(1_050_000n)
    expect(mesAntes).toBe(1_050_000n)

    const r = await apagar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)

    // DEPOIS: nada em aberto, em nenhum grupo, e o grupo da adesão não aparece.
    const depois = await saldoDaAna()
    expect(depois.saldo).toBe('0')
    expect(depois.temSaldo).toBe(false)
    expect(depois.grupos.find((g) => g.programaId === programaId)).toBeUndefined()
    expect(depois.grupos.every((g) => g.saldo === '0' || g.saldo === null)).toBe(true)

    // A receita do dia e a do MÊS caem exatamente os 10.500,00 que tinham entrado.
    expect(await receitaDoDia(c)).toBe(receitaAntes - 1_050_000n)
    expect(await recebidoNoMes()).toBe(mesAntes - 1_050_000n)
    expect(await recebidoNoMes()).toBe(0n)
  })

  it('o valor em aberto (orçamento) nunca virou receita, nem antes nem depois', async () => {
    const { id } = await fechadaComPagamento()
    expect(await recebidoNoMes()).toBe(1_050_000n) // sem os 15.000 em aberto nem os 25.000
    await apagar(c, `/v1/tarefas/${id}`, {}, 'beatriz').expect(200)
    expect(await recebidoNoMes()).toBe(0n)
  })
})
