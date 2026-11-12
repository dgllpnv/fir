import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparProgramas,
  montarCenario,
  pegar,
  postar,
  tarefaCrua,
} from '../tarefas/__tests__/cenario'

/**
 * ORÇAMENTO PARCIAL (vídeo da cliente, 12/11): a clínica ofereceu 25 mil, a
 * paciente fechou 15 mil. Isso precisa aparecer como PARCIAL — e não como
 * "fechado com saldo em aberto". O que separa os dois é o valor realmente
 * fechado (entrada + saldo) contra o oferecido.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('orcamento-parcial')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparProgramas(c)
})

const mover = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, quem)

async function realizada(responsavel = 'beatriz'): Promise<string> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas[responsavel],
      quando: { modo: 'retroativo', em: HOJE },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.tarefa.id as string
}

/** Oferece `oferta` (centavos) e fecha com `entrada` + `aberto`. */
async function ofertarEFechar(
  oferta: string,
  entrada: string,
  aberto: string,
  responsavel = 'beatriz',
): Promise<string> {
  const id = await realizada(responsavel)
  const o = await mover(id, { acao: 'registrarOrcamento', valor: oferta })
  expect(o.statusCode, JSON.stringify(o.body)).toBe(200)
  const f = await mover(id, {
    acao: 'fechar',
    recebimento: { valor: entrada, forma: 'Pix', valorAberto: aberto },
  })
  expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
  return id
}

const contagemDe = async (quem = 'beatriz') => {
  const r = await pegar(c, '/v1/jornada/orcamentos', {}, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  const eu = (r.body.itens as Record<string, unknown>[]).find((i) => i['pessoaId'] === c.pessoas['beatriz'])
  return {
    lancados: Number(eu?.['lancados'] ?? 0),
    completos: Number(eu?.['fechadosCompletos'] ?? 0),
    parciais: Number(eu?.['fechadosParciais'] ?? 0),
    sem: Number(eu?.['fechadosSemClassificacao'] ?? 0),
  }
}

describe('FECHAR guarda o valor fechado e distingue parcial de completo', () => {
  it('ofereceu 25.000 e fechou 15.000 (10.000 + 5.000 em aberto): parcial', async () => {
    const id = await ofertarEFechar('2500000', '1000000', '500000')
    const t = await tarefaCrua(c, id)
    expect(t!.valor_orcamento).toBe('2500000') // a oferta não é sobrescrita
    expect(t!.valor_fechado).toBe('1500000') // entrada + saldo
    const r = await pegar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.tarefa.orcamentoParcial).toBe(true)
  })

  it('fechou o valor oferecido (com saldo em aberto): completo, não parcial', async () => {
    const id = await ofertarEFechar('1500000', '1000000', '500000')
    const t = await tarefaCrua(c, id)
    expect(t!.valor_fechado).toBe('1500000')
    const r = await pegar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
    expect(r.body.tarefa.orcamentoParcial).toBe(false)
  })

  it('sem a permissão `valores`, o valor fechado some, mas "parcial" continua visível', async () => {
    const id = await ofertarEFechar('2500000', '1000000', '0', 'juliana')
    const r = await pegar(c, `/v1/tarefas/${id}`, {}, 'juliana')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.tarefa.valorFechado).toBeNull()
    expect(r.body.tarefa.valorOrcamento).toBeNull()
    expect(r.body.tarefa.orcamentoParcial).toBe(true)
  })
})

describe('GET /v1/jornada/orcamentos — contagem por atendente', () => {
  it('conta lançados, fechados completos e parciais, sem nenhum valor', async () => {
    const antes = await contagemDe()
    await ofertarEFechar('2500000', '1000000', '500000') // parcial
    await ofertarEFechar('1500000', '1500000', '0') // completo
    const aberto = await realizada()
    await mover(aberto, { acao: 'registrarOrcamento', valor: '900000' }) // só lançado
    const depois = await contagemDe()
    expect(depois.lancados - antes.lancados).toBe(3)
    expect(depois.parciais - antes.parciais).toBe(1)
    expect(depois.completos - antes.completos).toBe(1)

    const r = await pegar(c, '/v1/jornada/orcamentos', {}, 'beatriz')
    expect(JSON.stringify(r.body)).not.toMatch(/valor(Fechado|Orcamento)?"/)
  })

  it('período inválido é 400, e sem sessão é 401', async () => {
    const ruim = await pegar(c, '/v1/jornada/orcamentos', { periodo: 'sempre' }, 'beatriz')
    expect(ruim.statusCode).toBe(400)
    const sem = await pegar(c, '/v1/jornada/orcamentos', {}, 'ninguem')
    expect(sem.statusCode).toBe(401)
  })
})
