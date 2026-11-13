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

describe('o funil soma o que foi FECHADO, não o que foi oferecido', () => {
  it('parcial: "Fechados" sobe o valor fechado e "Orçado" sobe o oferecido', async () => {
    const ler = async () => {
      const r = await pegar(c, '/v1/jornada', {}, 'beatriz')
      expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
      const passo = (k: string) =>
        BigInt((r.body.funil as { chave: string; valor: string | null }[]).find((p) => p.chave === k)!.valor ?? '0')
      return { fechado: passo('fechados'), orcado: passo('orcamentosEnviados') }
    }
    const antes = await ler()
    await ofertarEFechar('2500000', '1000000', '500000') // oferece 25.000, fecha 15.000
    const depois = await ler()
    expect(depois.orcado - antes.orcado).toBe(2_500_000n)
    expect(depois.fechado - antes.fechado).toBe(1_500_000n)
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

/* ------------------------------------------------------------------ *
 * O QUE FOI FECHADO É DECLARADO, E O SERVIDOR CONFERE                *
 * ------------------------------------------------------------------ */
async function ofertado(oferta: string, programa?: unknown[]): Promise<string> {
  const id = await realizada()
  const o = await mover(id, {
    acao: 'registrarOrcamento',
    valor: oferta,
    ...(programa === undefined ? {} : { programa }),
  })
  expect(o.statusCode, JSON.stringify(o.body)).toBe(200)
  return id
}

describe('fechar: "fechou tudo" x "só uma parte" é conferido contra os números', () => {
  it('"tudo" com a soma diferente da oferta é recusado e NADA é gravado', async () => {
    const id = await ofertado('2500000')
    // Entrada de 10.000 e "em aberto" esquecido: antes virava "parcial" por engano.
    const r = await mover(id, {
      acao: 'fechar',
      fechamento: 'tudo',
      recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '0' },
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(400)
    const t = await tarefaCrua(c, id)
    expect(t!.etapa).toBe('orcamento')
    expect(t!.valor_fechado).toBeNull()
  })

  it('"tudo" com entrada + em aberto = oferta fecha completo', async () => {
    const id = await ofertado('2500000')
    const r = await mover(id, {
      acao: 'fechar',
      fechamento: 'tudo',
      recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '1500000' },
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const t = await pegar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
    expect(t.body.tarefa.orcamentoParcial).toBe(false)
  })

  it('"parte" com a soma igual ou maior que a oferta é recusado', async () => {
    const id = await ofertado('2500000')
    const r = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '1500000' },
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(400)
  })

  it('itens e data do restante só valem no parcial', async () => {
    const id = await ofertado('2500000')
    const r = await mover(id, {
      acao: 'fechar',
      fechamento: 'tudo',
      retomarRestanteEm: '2026-12-01',
      recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '1500000' },
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(400)
  })
})

/** Orçamento de 25.000 cujo responsável é `quem` (quem não é responsável nem solicitante leva 403). */
async function ofertadoPor(quem: string): Promise<string> {
  const id = await realizada(quem)
  const o = await mover(id, { acao: 'registrarOrcamento', valor: '2500000' }, quem)
  expect(o.statusCode, JSON.stringify(o.body)).toBe(200)
  return id
}

describe('o 400 do fechar não carrega NÚMERO para quem não tem `valores`', () => {
  // `rita` (balcão) recebe e não vê valores; ganha `jornada` só dentro deste bloco.
  beforeAll(async () => {
    await c.migrate.query(
      `UPDATE perfis SET perms = ARRAY['pacientes','receber','jornada'] WHERE clinica_id = $1 AND chave = 'pf_bal'`,
      [c.clinica],
    )
  })
  afterAll(async () => {
    await c.migrate.query(
      `UPDATE perfis SET perms = ARRAY['pacientes','receber'] WHERE clinica_id = $1 AND chave = 'pf_bal'`,
      [c.clinica],
    )
  })

  const semDinheiro = (corpo: { message?: unknown }): void => {
    // Só a MENSAGEM: o corpo traz `statusCode: 400`, que não é dinheiro.
    const texto = String(corpo.message)
    expect(texto).not.toMatch(/\d/)
    expect(texto).not.toMatch(/R\$/)
  }

  it('"tudo" com valor errado (Recepção sem `valores`): 400 sem nenhum dígito de dinheiro', async () => {
    const id = await ofertadoPor('rita')
    const r = await mover(
      id,
      { acao: 'fechar', fechamento: 'tudo', recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '0' } },
      'rita',
    )
    expect(r.statusCode, JSON.stringify(r.body)).toBe(400)
    semDinheiro(r.body)
  })

  it('"parte" com a soma igual à oferta (Recepção sem `valores`): 400 sem nenhum dígito de dinheiro', async () => {
    const id = await ofertadoPor('rita')
    const r = await mover(
      id,
      { acao: 'fechar', fechamento: 'parte', recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '1500000' } },
      'rita',
    )
    expect(r.statusCode, JSON.stringify(r.body)).toBe(400)
    semDinheiro(r.body)
  })
})

describe('o RESTANTE de um parcial volta a Hoje › Retomar', () => {
  const retomarDe = async () => {
    const r = await pegar(c, '/v1/hoje', {}, 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    return (r.body.retomar as { id: string }[]).map((x) => x.id)
  }

  it('parcial com data aparece; "retomarRestante" muda a data; sem data sai da lista', async () => {
    const id = await ofertado('2500000')
    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      retomarRestanteEm: HOJE,
      recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '500000' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    expect(await retomarDe()).toContain(id)

    const adiado = await mover(id, { acao: 'retomarRestante', retomarEm: '2099-01-01' })
    expect(adiado.statusCode, JSON.stringify(adiado.body)).toBe(200)
    expect(await retomarDe()).not.toContain(id)

    const volta = await mover(id, { acao: 'retomarRestante', retomarEm: HOJE })
    expect(volta.statusCode).toBe(200)
    expect(await retomarDe()).toContain(id)

    const encerra = await mover(id, { acao: 'retomarRestante' })
    expect(encerra.statusCode).toBe(200)
    expect(await retomarDe()).not.toContain(id)
    expect((await tarefaCrua(c, id))!.etapa).toBe('fechado') // a etapa não muda
  })

  it('num fechamento COMPLETO não há restante: 409', async () => {
    const id = await ofertado('1500000')
    await mover(id, {
      acao: 'fechar',
      fechamento: 'tudo',
      recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '500000' },
    })
    const r = await mover(id, { acao: 'retomarRestante', retomarEm: HOJE })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(409)
  })
})

describe('parcial com programa: só os itens marcados viram programa', () => {
  it('o programa vale o FECHADO e só tem os itens escolhidos', async () => {
    const p = await c.migrate.query<{ id: string }>(
      `SELECT id FROM procedimentos WHERE clinica_id = $1 AND nome_chave = 'tirzepatida'`,
      [c.clinica],
    )
    const proc = p.rows[0]!.id
    const id = await ofertado('2500000', [
      { procedimentoId: proc, sessoes: 2, intervaloDias: 30, chave: 'a' },
      { procedimentoId: proc, sessoes: 2, intervaloDias: 30, chave: 'b' },
    ])
    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['a'],
      recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '500000' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    const itens = await c.migrate.query<{ chave: string; valor: string }>(
      `SELECT i.chave, i.valor::text AS valor
         FROM itens_do_programa i JOIN programas g ON g.id = i.programa_id
        WHERE g.tarefa_de_origem_id = $1`,
      [id],
    )
    expect(itens.rows.map((x) => x.chave)).toEqual(['a'])
    expect(BigInt(itens.rows[0]!.valor)).toBe(1_500_000n) // o fechado, não os 25.000

    const ruim = await ofertado('2500000', [
      { procedimentoId: proc, sessoes: 2, intervaloDias: 30, chave: 'a' },
    ])
    const r = await mover(ruim, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['zzz'],
      recebimento: { valor: '730000', forma: 'Pix', valorAberto: '0' },
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(400)
  })
})
