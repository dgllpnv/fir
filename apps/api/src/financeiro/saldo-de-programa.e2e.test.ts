import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparProgramas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * **"SALDO EM ABERTO" ABATE A DÍVIDA CERTA** (pedido da cliente, 2026-11-13).
 *
 * O defeito, medido: a paciente fecha um programa com valor em aberto; a dívida
 * mora no grupo DO PROGRAMA. A recepção registra o pagamento em "Saldo em
 * aberto", e ele caía sempre no grupo GERAL: o geral ficava com crédito e a
 * dívida do programa continuava igual.
 *
 * Agora o recebimento diz QUAL dívida paga (`programaId`), o servidor confere que
 * ela é da paciente, e pagar mais do que a dívida do grupo exige confirmação
 * explícita — nunca crédito em silêncio.
 */
type Doc = Record<string, unknown>
let c: Cenario
let proc: { id: string }[]

beforeAll(async () => {
  c = await montarCenario('saldo-de-programa')
  const p = await c.migrate.query<{ id: string }>(
    'SELECT id FROM procedimentos WHERE clinica_id = $1 ORDER BY nome LIMIT 2',
    [c.clinica],
  )
  proc = p.rows
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparProgramas(c)
})

const mover = (id: string, corpo: Record<string, unknown>) =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, 'beatriz')

/** Fecha um programa de R$ 10.000: entrada de 4.000, e 6.000 EM ABERTO no programa. */
async function programaComDivida(paciente = 'ana'): Promise<string> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes[paciente],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['beatriz'],
      quando: { modo: 'retroativo', em: HOJE },
    },
    'beatriz',
  )
  const id = r.body.tarefa.id as string
  await mover(id, {
    acao: 'registrarOrcamento',
    valor: '1000000',
    programa: [{ chave: 'p1', procedimentoId: proc[0]!.id, sessoes: 4, intervaloDias: 7 }],
  })
  const f = await mover(id, {
    acao: 'fechar',
    fechamento: 'tudo',
    recebimento: { valor: '400000', forma: 'Pix', valorAberto: '600000' },
  })
  expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
  const p = await c.migrate.query<{ id: string }>(
    'SELECT id FROM programas WHERE tarefa_de_origem_id = $1',
    [id],
  )
  return p.rows[0]!.id
}

const saldo = async (paciente = 'ana', quem = 'beatriz') => {
  const r = await pegar(c, `/v1/pacientes/${c.pacientes[paciente]}/saldo`, {}, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return r.body as { grupos: Doc[]; saldo: string | null; credito: string | null }
}

let n = 0
const pagarSaldo = (corpo: Record<string, unknown>, paciente = 'ana') =>
  postar(
    c,
    '/v1/recebimentos',
    {
      requisicaoId: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      pacienteId: c.pacientes[paciente],
      valor: '100000',
      forma: 'Pix',
      em: HOJE,
      obs: '',
      ref: 'saldo',
      ...corpo,
    },
    'beatriz',
  )

describe('a dívida mora no programa', () => {
  it('ANTES: sem dizer a dívida, o pagamento vira crédito no grupo geral (o defeito da cliente)', async () => {
    const programa = await programaComDivida()
    const antes = await saldo()
    expect(antes.grupos.find((g) => g['programaId'] === programa)).toMatchObject({ saldo: '600000', devendo: true })

    // Sem programaId, vai ao geral, que não deve nada: o servidor RECUSA em vez de gerar crédito.
    const r = await pagarSaldo({})
    expect(r.statusCode).toBe(409)
    expect(JSON.stringify(r.body)).not.toContain('100000') // a recusa não carrega número
    expect((await saldo()).credito).toBe('0')
  })

  it('escolhendo a dívida do programa, o pagamento ABATE o programa e não gera crédito', async () => {
    const programa = await programaComDivida()
    const r = await pagarSaldo({ programaId: programa })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    const depois = await saldo()
    expect(depois.grupos.find((g) => g['programaId'] === programa)).toMatchObject({ saldo: '500000' })
    expect(depois.credito).toBe('0')
    expect(depois.saldo).toBe('500000')
  })

  it('pagar a dívida toda em partes zera o programa, sem crédito', async () => {
    const programa = await programaComDivida()
    // Valores diferentes: o mesmo valor no mesmo dia dispara o aviso de duplicidade.
    for (const valor of ['90000', '100000', '110000', '120000', '130000', '50000']) {
      const r = await pagarSaldo({ programaId: programa, valor })
      expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    }
    const fim = await saldo()
    expect(fim.saldo).toBe('0')
    expect(fim.credito).toBe('0')
    expect(fim.grupos.find((g) => g['programaId'] === programa)).toMatchObject({ devendo: false })
  })

  it('acima da dívida do programa: registra só o que quita, sem crédito', async () => {
    const programa = await programaComDivida()
    const r = await pagarSaldo({ programaId: programa, valor: '700000' })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    expect(r.body.valor).toBe('600000')
    const depois = await saldo()
    expect(depois.credito).toBe('0')
    expect(depois.saldo).toBe('0')
  })

  it('o duplo toque do MESMO envio não pergunta de novo nem duplica', async () => {
    const programa = await programaComDivida()
    const requisicaoId = '11111111-1111-4111-8111-111111111111'
    const corpo = { requisicaoId, programaId: programa }
    const a = await pagarSaldo(corpo)
    const b = await pagarSaldo(corpo)
    expect(a.statusCode).toBe(201)
    expect(b.body.id).toBe(a.body.id)
    expect((await saldo()).saldo).toBe('500000')
  })
})

describe('a dívida escolhida precisa ser DA PACIENTE', () => {
  it('programa de OUTRA paciente é 409 e nada é gravado', async () => {
    const deBruna = await programaComDivida('bruna')
    const r = await pagarSaldo({ programaId: deBruna }, 'ana')
    expect(r.statusCode).toBe(409)
    expect((await saldo('ana')).credito).toBe('0')
    expect((await saldo('bruna')).saldo).toBe('600000')
  })

  it('programa que não existe é 409', async () => {
    const r = await pagarSaldo({ programaId: '22222222-2222-4222-8222-222222222222' })
    expect(r.statusCode).toBe(409)
  })
})

describe('sem a permissão `valores`, o nome da dívida aparece e o número não', () => {
  it('o saldo da recepção traz `devendo` e o nome do programa, sem nenhum valor', async () => {
    const programa = await programaComDivida()
    const r = await saldo('ana', 'juliana')
    const g = r.grupos.find((x) => x['programaId'] === programa)!
    expect(g['devendo']).toBe(true)
    expect(typeof g['programa']).toBe('string')
    expect(JSON.stringify(r)).not.toContain('600000')
  })
})
