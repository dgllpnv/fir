import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AMANHA,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparProgramas,
  montarCenario,
  pegar,
  postar,
  receitaDoDia,
  recebimentosDe,
  tarefaCrua,
} from '../tarefas/__tests__/cenario'

/**
 * O ROTEIRO DA MARILLIA, PASSO A PASSO (pedido da cliente, 12-13/11).
 *
 *  1. registrar um orçamento com 3 procedimentos e valor de 25.000;
 *  2. fechar só PARTE: 2 dos 3 procedimentos, 15.000 fechados, 5.000 recebidos
 *     agora, 10.000 de PAGAMENTO EM ABERTO e 10.000 de RESTANTE do orçamento
 *     (a parte não fechada) — "pagamento em aberto" e "orçamento parcialmente
 *     fechado" são coisas diferentes;
 *  3. conferir Hoje › Retomar, o funil, a aba Orçamentos da paciente e a coluna
 *     "Orçamento parcialmente fechado" da Jornada;
 *  4. a receita é só o que entrou, e o orçamento nunca entra nela;
 *  5. fechar TUDO: só as perguntas de pagamento;
 *  6. orçamento só com valor / só com itens, sem virar programa;
 *  7. sem a permissão `valores`: nenhum valor em nenhuma resposta, nem no 400.
 */
type Doc = Record<string, unknown>
type TarefaDoTeste = {
  etapa: string
  programaOrcado: unknown[] | null
  itensOrcamento: { chave: string }[] | null
  orcamentoParcial: boolean
  valorOrcamento: string | null
  valorFechado: string | null
  historico: Doc[]
}

let c: Cenario
let proc: { id: string; nome: string }[]

beforeAll(async () => {
  c = await montarCenario('orcamento-itens')
  const p = await c.migrate.query<{ id: string; nome: string }>(
    'SELECT id, nome FROM procedimentos WHERE clinica_id = $1 ORDER BY nome LIMIT 3',
    [c.clinica],
  )
  proc = p.rows
  expect(proc.length).toBe(3)
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

/** Os três procedimentos do catálogo, com preço: 10.000 + 5.000 + 10.000 = 25.000. */
const TRES_ITENS = () => [
  { chave: 'a', procedimentoId: proc[0]!.id, valor: '1000000' },
  { chave: 'b', procedimentoId: proc[1]!.id, valor: '500000' },
  { chave: 'c', procedimentoId: proc[2]!.id, valor: '1000000' },
]

async function orcar(
  corpo: Record<string, unknown>,
  responsavel = 'beatriz',
): Promise<string> {
  const id = await realizada(responsavel)
  const o = await mover(id, { acao: 'registrarOrcamento', ...corpo })
  expect(o.statusCode, JSON.stringify(o.body)).toBe(200)
  return id
}

const tarefa = async (id: string, quem = 'beatriz') => {
  const r = await pegar(c, `/v1/tarefas/${id}`, {}, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return r.body.tarefa as TarefaDoTeste
}

const orcamentosDaAna = async (quem = 'beatriz') => {
  const r = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}/orcamentos`, {}, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return r.body as { totais: Record<string, number>; itens: Doc[] }
}

const funil = async (quem = 'beatriz') => {
  const r = await pegar(c, '/v1/jornada', {}, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  const passo = (k: string) =>
    (r.body.funil as { chave: string; n: number; valor: string | null }[]).find((p) => p.chave === k)!
  const coluna = (k: string) =>
    (r.body.colunas as { chave: string; n: number; valor: string | null; itens: Doc[] }[]).find(
      (x) => x.chave === k,
    )!
  return { passo, coluna }
}

describe('O ROTEIRO DA MARILLIA: fechar só uma parte do orçamento de 25.000', () => {
  it('registra 3 procedimentos SEM virar programa; fecha 2 deles; confere tudo o que ela vê', async () => {
    const antes = await funil()
    const receitaAntes = await receitaDoDia(c)

    // 1. O orçamento: 3 procedimentos do catálogo, 25.000, sem programa.
    const id = await orcar({ valor: '2500000', itens: TRES_ITENS() })
    let t = await tarefa(id)
    expect(t.programaOrcado).toBeNull()
    expect(t.itensOrcamento).toHaveLength(3)
    const crua = await tarefaCrua(c, id)
    expect(crua!['programa_orcado']).toBeNull()

    // 2. Fecha só a parte: A e B (15.000), 5.000 agora, 10.000 em aberto, restante 10.000.
    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['a', 'b'],
      recebimento: { valor: '500000', forma: 'Pix', valorAberto: '1000000' },
      retomarRestanteEm: HOJE,
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)

    t = await tarefa(id)
    expect(t.etapa).toBe('fechado')
    expect(t.orcamentoParcial).toBe(true)
    expect(t.valorOrcamento).toBe('2500000') // o oferecido não é sobrescrito
    expect(t.valorFechado).toBe('1500000') // fechado = entrada + em aberto
    // Nenhum programa nasceu: itens do orçamento não são programa.
    const programas = await c.migrate.query(
      'SELECT 1 FROM programas WHERE paciente_id = $1 AND excluido_em IS NULL',
      [c.pacientes['ana']],
    )
    expect(programas.rowCount).toBe(0)

    // O EVENTO guarda o que foi fechado (append-only).
    const ev = (t.historico as Doc[]).find((e) => e['acao'] === 'fechar')!
    expect(ev['itensFechados']).toEqual(['a', 'b'])
    expect(ev['valorFechado']).toBe('1500000')

    // 3a. Hoje › Retomar: o restante está lá na data escolhida.
    const hoje = await pegar(c, '/v1/hoje', { dia: HOJE }, 'beatriz')
    expect(hoje.statusCode, JSON.stringify(hoje.body)).toBe(200)
    expect((hoje.body.retomar as { id: string }[]).map((x) => x.id)).toContain(id)

    // 3b. O funil: "Fechados" soma o FECHADO (15.000), "orçado" o oferecido (25.000).
    const depois = await funil()
    expect(BigInt(depois.passo('fechados').valor!) - BigInt(antes.passo('fechados').valor!)).toBe(1_500_000n)
    expect(depois.passo('fechados').n - antes.passo('fechados').n).toBe(1)
    expect(BigInt(depois.passo('orcamentosEnviados').valor!) - BigInt(antes.passo('orcamentosEnviados').valor!)).toBe(
      2_500_000n,
    )

    // 3c. A coluna "Orçamento parcialmente fechado": o cartão, fechou 2 de 3, restante 10.000.
    const parciais = depois.coluna('parciais')
    expect(parciais.n - antes.coluna('parciais').n).toBe(1)
    const cartao = parciais.itens.find((x) => x['id'] === id)!
    expect(cartao).toMatchObject({
      itensFechados: 2,
      itensTotal: 3,
      valorOrcamento: '2500000',
      valorFechado: '1500000',
      valorRestante: '1000000',
      proximoPassoEm: HOJE,
    })
    // O cabeçalho da coluna soma o RESTANTE a cobrar.
    expect(BigInt(parciais.valor!) - BigInt(antes.coluna('parciais').valor!)).toBe(1_000_000n)
    // E o parcial CONTINUA em "Fechados": o passo do funil e a coluna batem.
    const fechadosAgora = depois.coluna('fechados')
    expect(fechadosAgora.itens.map((x) => x['id'])).toContain(id)
    expect(fechadosAgora.n - antes.coluna('fechados').n).toBe(depois.passo('fechados').n - antes.passo('fechados').n)

    // 3d. A aba Orçamentos da paciente: situação, valores e a marca de cada procedimento.
    const aba = await orcamentosDaAna()
    const o = aba.itens.find((x) => x['tarefaId'] === id)!
    expect(o).toMatchObject({
      situacao: 'parcial',
      valorOrcamento: '2500000',
      valorFechado: '1500000',
      valorRestante: '1000000',
      itensFechados: 2,
      itensTotal: 3,
      retomarRestanteEm: HOJE,
    })
    expect((o['itens'] as Doc[]).map((i) => [i['chave'], i['situacao']])).toEqual([
      ['a', 'fechado'],
      ['b', 'fechado'],
      ['c', 'nao_fechado'],
    ])
    expect(aba.totais['parciais']).toBeGreaterThanOrEqual(1)

    // 4. A RECEITA é só o que entrou: 5.000. O orçamento, o fechado e o saldo não entram.
    expect((await receitaDoDia(c)) - receitaAntes).toBe(500_000n)
    const rec = await recebimentosDe(c, id)
    expect(rec).toHaveLength(1)
    expect(String(rec[0]!['valor'])).toBe('500000')
    expect(String(rec[0]!['valor_aberto'])).toBe('1000000') // PAGAMENTO em aberto = fechado − entrada
  })

  it('o restante marcado para depois NÃO aparece em Hoje › Retomar antes da data', async () => {
    const id = await orcar({ valor: '2500000', itens: TRES_ITENS() })
    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['a'],
      recebimento: { valor: '100000', forma: 'Pix', valorAberto: '0' },
      retomarRestanteEm: AMANHA,
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    const hoje = await pegar(c, '/v1/hoje', { dia: HOJE }, 'beatriz')
    expect((hoje.body.retomar as { id: string }[]).map((x) => x.id)).not.toContain(id)
  })

  it('PARTE exige dizer quais procedimentos, e nem nenhum nem todos', async () => {
    const id = await orcar({ valor: '2500000', itens: TRES_ITENS() })
    const base = { acao: 'fechar', fechamento: 'parte', recebimento: { valor: '500000', forma: 'Pix', valorAberto: '0' } }
    const sem = await mover(id, base)
    expect(sem.statusCode, JSON.stringify(sem.body)).toBe(400)
    const todos = await mover(id, { ...base, itensFechados: ['a', 'b', 'c'] })
    expect(todos.statusCode, JSON.stringify(todos.body)).toBe(400)
    expect(JSON.stringify(todos.body)).toMatch(/O orçamento todo/)
    const intruso = await mover(id, { ...base, itensFechados: ['a', 'zzz'] })
    expect(intruso.statusCode).toBe(400)
    // Nada foi escrito: o cartão segue em "orçamento", sem recebimento.
    expect((await tarefa(id)).etapa).toBe('orcamento')
    expect(await recebimentosDe(c, id)).toHaveLength(0)
  })

  it('PARTE com a soma igual ou acima do orçamento é recusada (use "o orçamento todo")', async () => {
    const id = await orcar({ valor: '2500000', itens: TRES_ITENS() })
    const r = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['a', 'b'],
      recebimento: { valor: '1500000', forma: 'Pix', valorAberto: '1000000' },
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(400)
  })
})

describe('FECHAR O ORÇAMENTO TODO: só as perguntas de pagamento', () => {
  it('fecha tudo com entrada + pagamento em aberto; todos os procedimentos ficam fechados', async () => {
    const id = await orcar({ valor: '2500000', itens: TRES_ITENS() })
    // Sem `inicioDoPrograma`, sem `itensFechados`: só o pagamento.
    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'tudo',
      recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '1500000' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    const t = await tarefa(id)
    expect(t.orcamentoParcial).toBe(false)
    expect(t.valorFechado).toBe('2500000')
    const aba = await orcamentosDaAna()
    const o = aba.itens.find((x) => x['tarefaId'] === id)!
    expect(o['situacao']).toBe('fechado')
    expect(o['valorRestante']).toBeNull()
    expect((o['itens'] as Doc[]).every((i) => i['situacao'] === 'fechado')).toBe(true)
    expect(o['itensFechados']).toBe(3)
  })

  it('"tudo" que não completa o orçamento é recusado, e a frase diz o valor a quem pode vê-lo', async () => {
    const id = await orcar({ valor: '2500000', itens: TRES_ITENS() })
    const r = await mover(id, {
      acao: 'fechar',
      fechamento: 'tudo',
      recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '0' },
    })
    expect(r.statusCode).toBe(400)
  })
})

describe('ORÇAMENTO SEM PROGRAMA: só valor, ou valor e procedimentos', () => {
  it('só com valor (sem lista): fecha tudo e fecha parte sem perguntar procedimentos', async () => {
    const id = await orcar({ valor: '900000' })
    const t = await tarefa(id)
    expect(t.itensOrcamento).toBeNull()
    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      recebimento: { valor: '300000', forma: 'Pix', valorAberto: '200000' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    const o = (await orcamentosDaAna()).itens.find((x) => x['tarefaId'] === id)!
    expect(o['situacao']).toBe('parcial')
    expect(o['valorRestante']).toBe('400000')
    expect(o['itens']).toEqual([])
    expect(o['itensFechados']).toBeNull() // sem detalhamento: nunca inventado
  })

  it('só com valor: itensFechados no PARTE é recusado (não há lista)', async () => {
    const id = await orcar({ valor: '900000' })
    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['a'],
      recebimento: { valor: '300000', forma: 'Pix', valorAberto: '0' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(400)
  })

  it('programa E itens no mesmo orçamento é recusado; item fora do catálogo da clínica também', async () => {
    const id = await realizada()
    const dois = await mover(id, {
      acao: 'registrarOrcamento',
      valor: '2500000',
      itens: TRES_ITENS(),
      programa: [{ chave: 'p1', procedimentoId: proc[0]!.id, sessoes: 2, intervaloDias: 7 }],
    })
    expect(dois.statusCode, JSON.stringify(dois.body)).toBe(400)
    const fora = await mover(id, {
      acao: 'registrarOrcamento',
      valor: '2500000',
      itens: [{ chave: 'a', procedimentoId: '00000000-0000-4000-8000-000000000000' }],
    })
    expect(fora.statusCode, JSON.stringify(fora.body)).toBe(400)
    // Itens que passam do orçamento não cabem.
    const passa = await mover(id, {
      acao: 'registrarOrcamento',
      valor: '100000',
      itens: TRES_ITENS(),
    })
    expect(passa.statusCode, JSON.stringify(passa.body)).toBe(400)
  })

  it('RETROCOMPATÍVEL: o orçamento que já tinha programa lista os itens a partir dele', async () => {
    const id = await orcar({
      valor: '2500000',
      programa: [
        { chave: 'p1', procedimentoId: proc[0]!.id, sessoes: 2, intervaloDias: 7, valor: '1000000' },
        { chave: 'p2', procedimentoId: proc[1]!.id, sessoes: 1, intervaloDias: 7 },
      ],
    })
    const t = await tarefa(id)
    expect(t.programaOrcado).toHaveLength(2)
    expect(t.itensOrcamento!.map((i: { chave: string }) => i.chave)).toEqual(['p1', 'p2'])
    const o = (await orcamentosDaAna()).itens.find((x) => x['tarefaId'] === id)!
    expect(o['itensTotal']).toBe(2)
    // E o fechamento parcial pergunta os itens do programa, como antes.
    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['p1'],
      recebimento: { valor: '300000', forma: 'Pix', valorAberto: '0' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
  })

  it('PEDIDO DA CLIENTE: a aba Orçamentos mostra as SESSÕES e o intervalo — e nunca a dose', async () => {
    const id = await orcar({
      valor: '3000000',
      programa: [
        { chave: 'p1', procedimentoId: proc[0]!.id, sessoes: 10, intervaloDias: 7, dose: '2,5 mg' },
        { chave: 'p2', procedimentoId: proc[1]!.id, sessoes: 1, intervaloDias: 7 },
      ],
    })
    const r = await orcamentosDaAna()
    const o = r.itens.find((x: Doc) => x['tarefaId'] === id)!
    const itens = o['itens'] as Doc[]
    expect(itens.find((i) => i['chave'] === 'p1')).toMatchObject({ sessoes: 10, intervaloDias: 7 })
    expect(itens.find((i) => i['chave'] === 'p2')).toMatchObject({ sessoes: 1 })
    // Regra 18: a dose não atravessa, em nenhum lugar da resposta.
    expect(JSON.stringify(r)).not.toContain('2,5 mg')
    expect(JSON.stringify(r)).not.toContain('dose')
  })

  describe('PEDIDO DA CLIENTE: fechar só parte das SESSÕES (de 10 para 5)', () => {
    const PROG = () => [
      { chave: 'p1', procedimentoId: proc[0]!.id, sessoes: 10, intervaloDias: 7 },
      { chave: 'p2', procedimentoId: proc[1]!.id, sessoes: 8, intervaloDias: 7 },
    ]
    const fecharParcial = (id: string, extra: Record<string, unknown>) =>
      mover(id, {
        acao: 'fechar',
        fechamento: 'parte',
        recebimento: { valor: '100000', forma: 'Pix', valorAberto: '0' },
        ...extra,
      })
    const sessoesDoPrograma = async (): Promise<Record<string, number>> => {
      const r = await c.migrate.query<{ chave: string; sessoes: number }>(
        `SELECT i.procedimento_id::text AS chave, i.sessoes
           FROM itens_do_programa i JOIN programas p ON p.id = i.programa_id
          WHERE p.paciente_id = $1 AND p.excluido_em IS NULL`,
        [c.pacientes['ana']],
      )
      return Object.fromEntries(r.rows.map((x) => [x.chave, x.sessoes]))
    }

    it('fica com os DOIS procedimentos em menos sessões: o programa nasce com 5 e 8, e a aba diz "fechou 5 de 10"', async () => {
      await c.migrate.query('DELETE FROM itens_do_programa WHERE clinica_id = $1', [c.clinica])
      await c.migrate.query('DELETE FROM programas WHERE clinica_id = $1', [c.clinica])
      const id = await orcar({ valor: '3000000', programa: PROG() })
      const f = await fecharParcial(id, {
        itensFechados: ['p1', 'p2'],
        sessoesFechadas: { p1: 5 },
      })
      expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
      expect(await sessoesDoPrograma()).toEqual({ [proc[0]!.id]: 5, [proc[1]!.id]: 8 })

      const o = (await orcamentosDaAna()).itens.find((x) => x['tarefaId'] === id)!
      expect(o['situacao']).toBe('parcial')
      const itens = o['itens'] as Doc[]
      expect(itens.find((i) => i['chave'] === 'p1')).toMatchObject({ sessoes: 10, sessoesFechadas: 5 })
      expect(itens.find((i) => i['chave'] === 'p2')?.['sessoesFechadas']).toBeUndefined()
    })

    it('mais sessões que as orçadas é 400 e nada é gravado', async () => {
      const id = await orcar({ valor: '3000000', programa: PROG() })
      const f = await fecharParcial(id, { itensFechados: ['p1'], sessoesFechadas: { p1: 11 } })
      expect(f.statusCode).toBe(400)
      expect((await tarefa(id)).etapa).toBe('orcamento')
    })

    it('todos os procedimentos com todas as sessões continua sendo "o orçamento todo"', async () => {
      const id = await orcar({ valor: '3000000', programa: PROG() })
      const f = await fecharParcial(id, { itensFechados: ['p1', 'p2'] })
      expect(f.statusCode).toBe(400)
    })

    it('sessões informadas para procedimento NÃO marcado, ou no fechamento total, são 400', async () => {
      const id = await orcar({ valor: '3000000', programa: PROG() })
      expect((await fecharParcial(id, { itensFechados: ['p1'], sessoesFechadas: { p2: 3 } })).statusCode).toBe(400)
      const t = await mover(id, {
        acao: 'fechar',
        fechamento: 'tudo',
        sessoesFechadas: { p1: 3 },
        recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '2000000' },
      })
      expect(t.statusCode).toBe(400)
    })
  })

  it('corrigir o orçamento troca a lista de procedimentos (sem programa)', async () => {
    const id = await orcar({ valor: '2500000', itens: TRES_ITENS() })
    const r = await mover(id, {
      acao: 'corrigirOrcamento',
      chaveIdempotencia: '00000000-0000-4000-8000-0000000000aa',
      itens: [{ chave: 'a', procedimentoId: proc[0]!.id, valor: '1000000' }],
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const t = await tarefa(id)
    expect(t.itensOrcamento).toHaveLength(1)
    expect(t.programaOrcado).toBeNull()
  })

  it('o orçamento FECHADO ANTES do detalhamento fica "sem detalhamento" (sem backfill)', async () => {
    const id = await orcar({ valor: '2500000', itens: TRES_ITENS() })
    // O fechamento antigo não declarava `fechamento`: o evento não diz quais itens.
    const f = await mover(id, {
      acao: 'fechar',
      recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '1500000' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    const o = (await orcamentosDaAna()).itens.find((x) => x['tarefaId'] === id)!
    expect((o['itens'] as Doc[]).every((i) => i['situacao'] === 'sem_detalhamento')).toBe(true)
    expect(o['itensFechados']).toBeNull()
  })

  it('orçamento aberto e perdido aparecem na aba, com os itens "orçados"', async () => {
    const aberto = await orcar({ valor: '2500000', itens: TRES_ITENS() })
    const o = (await orcamentosDaAna()).itens.find((x) => x['tarefaId'] === aberto)!
    expect(o['situacao']).toBe('aberto')
    expect((o['itens'] as Doc[]).every((i) => i['situacao'] === 'orcado')).toBe(true)
    const motivo = await c.migrate.query<{ id: string }>(
      'SELECT id FROM motivos_de_perda WHERE clinica_id = $1 LIMIT 1',
      [c.clinica],
    )
    const p = await mover(aberto, { acao: 'perder', motivoId: motivo.rows[0]!.id })
    expect(p.statusCode, JSON.stringify(p.body)).toBe(200)
    const depois = (await orcamentosDaAna()).itens.find((x) => x['tarefaId'] === aberto)!
    expect(depois['situacao']).toBe('perdido')
  })
})

describe('FECHAMENTO PARCIAL COM PROGRAMA: Σ itens do programa == valor do programa, SEMPRE', () => {
  // O programa não tem coluna de total (o total é a soma dos itens, decisão P-2):
  // o "valor do programa" é o FECHADO digitado, e é a soma dos itens que tem de igualá-lo.
  const somaDosItens = async (): Promise<{ soma: bigint; itens: bigint[] }> => {
    const p = await c.migrate.query<{ id: string }>(
      'SELECT id FROM programas WHERE paciente_id = $1 AND excluido_em IS NULL',
      [c.pacientes['ana']],
    )
    expect(p.rowCount).toBe(1)
    const i = await c.migrate.query<{ valor: string | null }>(
      'SELECT valor::text AS valor FROM itens_do_programa WHERE programa_id = $1 ORDER BY chave',
      [p.rows[0]!.id],
    )
    const itens = i.rows.map((x) => BigInt(x.valor ?? '0'))
    return { soma: itens.reduce((s, v) => s + v, 0n), itens }
  }
  const item = (chave: string, k: number, valor?: string) => ({
    chave,
    procedimentoId: proc[k]!.id,
    sessoes: 2,
    intervaloDias: 7,
    ...(valor === undefined ? {} : { valor }),
  })

  it('todos com preço e o fechado digitado MENOR que a soma dos marcados (desconto): rateia o fechado', async () => {
    const id = await orcar({
      valor: '2500000',
      programa: [item('a', 0, '1000000'), item('b', 1, '1000000'), item('c', 2, '500000')],
    })
    // A + B somam 20.000; fechado digitado = 5.000 + 13.000 = 18.000.
    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['a', 'b'],
      recebimento: { valor: '500000', forma: 'Pix', valorAberto: '1300000' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    const r = await somaDosItens()
    expect(r.soma).toBe(1_800_000n)
    expect(r.itens).toEqual([900_000n, 900_000n])
  })

  it('marcado SEM preço e preços que já estouram o fechado: ninguém fica em R$ 0,00 e a soma bate', async () => {
    const id = await orcar({
      valor: '2500000',
      programa: [item('a', 0, '1000000'), item('b', 1), item('c', 2, '500000')],
    })
    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['a', 'b'],
      recebimento: { valor: '300000', forma: 'Pix', valorAberto: '600000' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    const r = await somaDosItens()
    expect(r.soma).toBe(900_000n)
    expect(r.itens.every((v) => v > 0n)).toBe(true)
  })

  it('nenhum marcado com preço: o fechado é rateado, com o resto nos primeiros (max − min <= 1)', async () => {
    const id = await orcar({
      valor: '2500000',
      programa: [item('a', 0), item('b', 1), item('c', 2)],
    })
    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['a', 'b'],
      recebimento: { valor: '100001', forma: 'Pix', valorAberto: '0' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    const r = await somaDosItens()
    expect(r.soma).toBe(100_001n)
    expect(r.itens).toEqual([50_001n, 50_000n])
  })
})

describe('SEM `valores`: nenhum valor em nenhuma resposta, nem no 400', () => {
  const PERMS_COM_JORNADA = `UPDATE perfis SET perms = ARRAY['pacientes','receber','jornada'] WHERE clinica_id = $1 AND chave = 'pf_bal'`
  const PERMS_ORIGINAIS = `UPDATE perfis SET perms = ARRAY['pacientes','receber'] WHERE clinica_id = $1 AND chave = 'pf_bal'`

  beforeAll(async () => {
    await c.migrate.query(PERMS_COM_JORNADA, [c.clinica])
  })
  afterAll(async () => {
    await c.migrate.query(PERMS_ORIGINAIS, [c.clinica])
  })

  const VALORES = /2500000|1500000|1000000|25\.000|15\.000|10\.000|2\.500/

  it('o 400 do fechamento recusado não carrega o valor do orçamento', async () => {
    const id = await orcar({ valor: '2500000', itens: TRES_ITENS() }, 'rita')
    const tudo = await mover(
      id,
      { acao: 'fechar', fechamento: 'tudo', recebimento: { valor: '100000', forma: 'Pix', valorAberto: '0' } },
      'rita',
    )
    expect(tudo.statusCode, JSON.stringify(tudo.body)).toBe(400)
    expect(JSON.stringify(tudo.body)).not.toMatch(VALORES)

    const parte = await mover(
      id,
      {
        acao: 'fechar',
        fechamento: 'parte',
        itensFechados: ['a'],
        recebimento: { valor: '2500000', forma: 'Pix', valorAberto: '0' },
      },
      'rita',
    )
    expect(parte.statusCode, JSON.stringify(parte.body)).toBe(400)
    expect(JSON.stringify(parte.body)).not.toMatch(VALORES)
  })

  it('quem não vê valores fecha digitando entrada e pagamento em aberto; o servidor confere', async () => {
    const id = await orcar({ valor: '2500000', itens: TRES_ITENS() }, 'rita')
    const f = await mover(
      id,
      {
        acao: 'fechar',
        fechamento: 'parte',
        itensFechados: ['a', 'b'],
        recebimento: { valor: '500000', forma: 'Pix', valorAberto: '1000000' },
      },
      'rita',
    )
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    expect(JSON.stringify(f.body)).not.toMatch(VALORES)
    const t = await tarefa(id, 'rita')
    expect(t.orcamentoParcial).toBe(true) // não é dinheiro: aparece
    expect(t.valorOrcamento).toBeNull()
    expect(t.valorFechado).toBeNull()
    expect(JSON.stringify(t)).not.toMatch(VALORES)
  })

  it('a aba Orçamentos e a coluna da Jornada sem valores: situação, contagem e nomes; nenhum centavo', async () => {
    const id = await orcar({ valor: '2500000', itens: TRES_ITENS() }, 'rita')
    await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['a', 'b'],
      recebimento: { valor: '500000', forma: 'Pix', valorAberto: '1000000' },
    })
    const aba = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}/orcamentos`, {}, 'rita')
    expect(aba.statusCode, JSON.stringify(aba.body)).toBe(200)
    expect(JSON.stringify(aba.body)).not.toMatch(VALORES)
    const o = (aba.body.itens as Doc[]).find((x) => x['tarefaId'] === id)!
    expect(o).toMatchObject({ situacao: 'parcial', itensFechados: 2, itensTotal: 3, valorRestante: null })
    expect(o['procedimento'] ?? (o['itens'] as Doc[])[0]!['procedimento']).toBeTruthy()

    const j = await pegar(c, '/v1/jornada', {}, 'rita')
    expect(j.statusCode, JSON.stringify(j.body)).toBe(200)
    const col = (j.body.colunas as Doc[]).find((x) => x['chave'] === 'parciais')!
    expect(col['n']).toBeGreaterThanOrEqual(1)
    expect(col['valor']).toBeNull()
    const cartao = (col['itens'] as Doc[]).find((x) => x['id'] === id)!
    expect(cartao).toMatchObject({ itensFechados: 2, itensTotal: 3, valorRestante: null, valorFechado: null })
    expect(JSON.stringify(col)).not.toMatch(VALORES)
  })

  it('sem `jornada` não há histórico de orçamentos (camila tem valores, não tem jornada)', async () => {
    const r = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}/orcamentos`, {}, 'camila')
    expect(r.statusCode).toBe(403)
    const sem = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}/orcamentos`, {}, 'ninguem')
    expect(sem.statusCode).toBe(401)
  })

  it('paciente de outra clínica é 404, e id inválido é 400', async () => {
    const outra = await pegar(c, `/v1/pacientes/${c.pacienteDaOutra}/orcamentos`, {}, 'beatriz')
    expect(outra.statusCode).toBe(404)
    const ruim = await pegar(c, '/v1/pacientes/nao-e-uuid/orcamentos', {}, 'beatriz')
    expect(ruim.statusCode).toBe(400)
  })
})

describe('ORÇAMENTO EM LISTA COM SESSÕES (pedido da cliente, 2026-11-13)', () => {
  const COM_SESSOES = () => [
    { chave: 'a', procedimentoId: proc[0]!.id, valor: '1000000', sessoes: 10 },
    { chave: 'b', procedimentoId: proc[1]!.id, valor: '500000', sessoes: 4 },
  ]

  it('guarda as sessões da lista e as mostra no cartão e na aba Orçamentos, sem virar programa', async () => {
    const id = await orcar({ valor: '1500000', itens: COM_SESSOES() })
    const t = await tarefa(id)
    expect(t.programaOrcado).toBeNull()
    expect(t.itensOrcamento).toMatchObject([
      { chave: 'a', sessoes: 10 },
      { chave: 'b', sessoes: 4 },
    ])
    const aba = await orcamentosDaAna()
    const o = aba.itens.find((x) => x['tarefaId'] === id)!
    const itens = o['itens'] as Doc[]
    expect(itens.find((i) => i['chave'] === 'a')).toMatchObject({ sessoes: 10 })
    expect(itens.find((i) => i['chave'] === 'b')).toMatchObject({ sessoes: 4 })
  })

  it('fechar de 10 para 5 mantendo OS DOIS procedimentos é parcial, e o evento guarda as sessões', async () => {
    const id = await orcar({ valor: '1500000', itens: COM_SESSOES() })
    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['a', 'b'],
      sessoesFechadas: { a: 5 },
      recebimento: { valor: '200000', forma: 'Pix', valorAberto: '300000' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    const t = await tarefa(id)
    expect(t.orcamentoParcial).toBe(true)
    const ev = (t.historico as Doc[]).find((e) => e['acao'] === 'fechar')!
    expect(ev['sessoesFechadas']).toEqual({ a: 5 })
    const aba = await orcamentosDaAna()
    const itens = aba.itens.find((x) => x['tarefaId'] === id)!['itens'] as Doc[]
    expect(itens.find((i) => i['chave'] === 'a')).toMatchObject({ sessoes: 10, sessoesFechadas: 5 })
    expect(itens.find((i) => i['chave'] === 'b')?.['sessoesFechadas']).toBeUndefined()
  })

  it('recusa fechar mais sessões do que as orçadas, ou sessões de procedimento sem sessões', async () => {
    const id = await orcar({ valor: '1500000', itens: COM_SESSOES() })
    const corpo = (sessoesFechadas: Record<string, number>) => ({
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['a', 'b'],
      sessoesFechadas,
      recebimento: { valor: '200000', forma: 'Pix', valorAberto: '300000' },
    })
    expect((await mover(id, corpo({ a: 11 }))).statusCode).toBe(400)
    const semSessoes = await orcar({
      valor: '1500000',
      itens: [
        { chave: 'a', procedimentoId: proc[0]!.id },
        { chave: 'b', procedimentoId: proc[1]!.id },
      ],
    })
    expect((await mover(semSessoes, corpo({ a: 3 }))).statusCode).toBe(400)
  })

  it('lista SEM sessões continua valendo (o campo é opcional)', async () => {
    const id = await orcar({ valor: '1500000', itens: TRES_ITENS().slice(0, 2) })
    const t = await tarefa(id)
    expect((t.itensOrcamento as Doc[]).every((i) => i['sessoes'] === undefined)).toBe(true)
  })
})

describe('A OBSERVAÇÃO DO FECHAMENTO APARECE NA ABA ORÇAMENTOS (vídeo da cliente: "não fica em lugar nenhum")', () => {
  it('mostra o que foi orçado e o que ficou de fora; sem nota, vem null', async () => {
    const id = await orcar({
      valor: '1500000',
      itens: [
        { chave: 'a', procedimentoId: proc[0]!.id, valor: '1000000' },
        { chave: 'b', procedimentoId: proc[1]!.id, valor: '500000' },
      ],
      nota: 'Implante e limpeza',
    })
    let aba = await orcamentosDaAna()
    let o = aba.itens.find((x) => x['tarefaId'] === id)!
    expect(o['notaDoOrcamento']).toBe('Implante e limpeza')
    expect(o['notaDoFechamento']).toBeNull()

    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['b'],
      nota: 'Não fechou o implante, quer pensar',
      recebimento: { valor: '200000', forma: 'Pix', valorAberto: '300000' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    aba = await orcamentosDaAna()
    o = aba.itens.find((x) => x['tarefaId'] === id)!
    expect(o['notaDoFechamento']).toBe('Não fechou o implante, quer pensar')
    expect(o['notaDoOrcamento']).toBe('Implante e limpeza')
  })

  it('orçamento sem nenhuma nota devolve null nos dois', async () => {
    const id = await orcar({ valor: '1500000', itens: TRES_ITENS().slice(0, 2) })
    const o = (await orcamentosDaAna()).itens.find((x) => x['tarefaId'] === id)!
    expect(o['notaDoOrcamento']).toBeNull()
    expect(o['notaDoFechamento']).toBeNull()
  })
})
