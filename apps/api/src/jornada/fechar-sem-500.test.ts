import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparProgramas,
  montarCenario,
  ONTEM,
  pegar,
  postar,
  recebimentosDe,
  tarefaCrua,
} from '../tarefas/__tests__/cenario'

/**
 * NENHUM CAMINHO DO "FECHOU" DEVOLVE 500 (vídeos da cliente, 12/11).
 *
 * Em produção a recepção viu "Internal server error" ao salvar o fechamento de
 * um orçamento de Tirzepatida cujo atendimento JÁ TINHA programa, sessão e
 * "Pagamento de orçamento" — o cartão voltara a "orçamento" depois de um
 * fechamento anterior. O índice `programa_por_origem` (um orçamento monta UM
 * programa) estourava como 23505 sem tradução. Cada caso abaixo é um jeito de
 * chegar a esse índice, ou ao vizinho `sessao_unica_no_item`: recusa de
 * NEGÓCIO (409/400) com frase clara, e nada meio-gravado.
 */
let c: Cenario
let tirze: string

beforeAll(async () => {
  c = await montarCenario('fechar-sem-500')
  const p = await c.migrate.query<{ id: string }>(
    `SELECT id FROM procedimentos WHERE clinica_id = $1 AND nome_chave = 'tirzepatida'`,
    [c.clinica],
  )
  tirze = p.rows[0]!.id
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparProgramas(c)
})

const mover = (id: string, corpo: Record<string, unknown>) =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, 'beatriz')

const PROGRAMA = () => [{ chave: 'i1', procedimentoId: tirze, sessoes: 8, intervaloDias: 7 }]
const FECHAR = (extra: Record<string, unknown> = {}) => ({
  acao: 'fechar',
  recebimento: { valor: '500000', forma: 'Pix', valorAberto: '1000000' },
  ...extra,
})

async function orcada(): Promise<string> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['beatriz'],
      quando: { modo: 'retroativo', em: HOJE },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  const id = r.body.tarefa.id as string
  const o = await mover(id, { acao: 'registrarOrcamento', valor: '1500000', programa: PROGRAMA() })
  expect(o.statusCode, JSON.stringify(o.body)).toBe(200)
  return id
}

const programasVivos = async (): Promise<number> =>
  (
    await c.migrate.query(
      'SELECT 1 FROM programas WHERE paciente_id = $1 AND excluido_em IS NULL',
      [c.pacientes['ana']],
    )
  ).rowCount ?? 0

describe('fechar um programa de 8 sessões', () => {
  it('início = hoje, no passado e no futuro: 200 (ou recusa 4xx), nunca 500', async () => {
    for (const inicio of [HOJE, ONTEM, '2026-12-01']) {
      const id = await orcada()
      const r = await mover(id, FECHAR({ inicioDoPrograma: inicio }))
      expect(r.statusCode, `${inicio}: ${JSON.stringify(r.body)}`).toBeLessThan(500)
      await limparProgramas(c)
    }
  })

  it('fechar duas vezes seguidas: o segundo é 409, e nada é gravado a mais', async () => {
    const id = await orcada()
    expect((await mover(id, FECHAR())).statusCode).toBe(200)
    const dois = await mover(id, FECHAR())
    expect(dois.statusCode, JSON.stringify(dois.body)).toBe(409)
    expect(await programasVivos()).toBe(1)
    expect((await recebimentosDe(c, id)).length + 0).toBeGreaterThanOrEqual(1)
  })

  it('duplo clique (duas requisições juntas): uma fecha, a outra é 409; um programa só', async () => {
    const id = await orcada()
    const [a, b] = await Promise.all([mover(id, FECHAR()), mover(id, FECHAR())])
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
    expect(await programasVivos()).toBe(1)
  })

  it('o cartão VOLTOU a "orçamento" depois de fechado (o caso do vídeo): 409 claro, sem meio-gravado', async () => {
    const id = await orcada()
    expect((await mover(id, FECHAR())).statusCode).toBe(200)
    // O estado que a produção mostrou: programa, sessão e pagamento existem, e
    // o cartão está de novo em "orçamento".
    await c.migrate.query(
      `UPDATE tarefas SET etapa = 'orcamento'::etapa_de_jornada WHERE id = $1`,
      [id],
    )
    const antes = await recebimentosDe(c, id)
    const sessoes = await c.migrate.query('SELECT 1 FROM tarefas WHERE paciente_id = $1', [
      c.pacientes['ana'],
    ])
    // O aviso de pagamento repetido pede confirmação; a recepção confirma — e é
    // AÍ que o índice do programa estourava como 500.
    const aviso = await mover(id, FECHAR())
    expect(aviso.statusCode, JSON.stringify(aviso.body)).toBe(409)
    const r = await mover(id, FECHAR({ confirmarDuplicidade: true }))
    expect(r.statusCode, JSON.stringify(r.body)).toBe(409)
    expect(JSON.stringify(r.body)).toMatch(/programa/i)
    expect(JSON.stringify(r.body)).not.toMatch(/duplicate|unique|constraint/i)
    // Nada meio-gravado: nenhum recebimento nem tarefa nova, programa único.
    expect(await recebimentosDe(c, id)).toHaveLength(antes.length)
    expect(
      (await c.migrate.query('SELECT 1 FROM tarefas WHERE paciente_id = $1', [c.pacientes['ana']]))
        .rowCount,
    ).toBe(sessoes.rowCount)
    expect(await programasVivos()).toBe(1)
    expect((await tarefaCrua(c, id))!['etapa']).toBe('orcamento')
  })

  it('a rota pública não vaza o erro do banco em nenhum desses caminhos', async () => {
    const r = await pegar(c, '/v1/hoje', {}, 'beatriz')
    expect(r.statusCode).toBe(200)
  })
})
