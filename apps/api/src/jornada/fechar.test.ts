import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  inserirRecebimento,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
  receitaDoDia,
  recebimentosDe,
  tarefaCrua,
  vivosDe,
} from '../tarefas/__tests__/cenario'

/**
 * FECHAR É UMA TRANSAÇÃO SÓ — e é o defeito do protótipo que esta tarefa
 * corrige.
 *
 * Lá, "Fechou" são DUAS chamadas do cliente: `criarTarefa`/`criarAdesao` cria
 * o recebimento e, **depois**, `moverEtapa fechar` move o cartão. Entre uma e
 * outra cabe uma rede que cai, uma aba fechada, um 500. Quando cai, o dinheiro
 * está lançado e o cartão continua em "Orçamentos em aberto" — a clínica vê um
 * orçamento pendente de uma paciente que já pagou, e liga para cobrá-la.
 *
 * Aqui são escritas de uma transação só: o `Recebimento`, a etapa, e o
 * `Programa` quando o épico 5 trouxer o montador.
 *
 * As três linhas de dinheiro do fechamento, e a diferença entre elas:
 *
 *   `recebimento.valor`       o que a paciente PAGOU AGORA     → é receita
 *   `recebimento.valorAberto` o que ficou para depois          → não, até ser pago
 *   `valor_orcamento`         entrada + aberto = o negócio     → **NUNCA** (regra 4)
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('fechar')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
})

type Corpo = Record<string, unknown>

const mover = (id: string, corpo: Corpo, quem = 'beatriz') =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, quem)

type Tarefa = {
  id: string
  etapa: string | null
  status: string
  proximoPassoEm: string | null
  valorOrcamento: string | null
  programaOrcado: unknown[] | null
  pagamento: { valor: string | null; valorAberto: string | null; forma: string } | null
  historico: { acao: string; etapa: string; valor?: string | null; nota?: string }[]
}

const corpoDe = (r: { body: unknown }): Tarefa => (r.body as { tarefa: Tarefa }).tarefa

const buscar = async (id: string, quem = 'beatriz'): Promise<Tarefa> => {
  const r = await pegar(c, '/v1/tarefas', { q: '', limite: '200' }, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  const achada = (r.body as { tarefas: Tarefa[] }).tarefas.find((t) => t.id === id)
  expect(achada, `tarefa ${id} não veio na lista`).toBeDefined()
  return achada!
}

/** Uma consulta lançada retroativa: o cartão nasce em `realizado`, sem dinheiro. */
async function realizado(responsavel = 'beatriz'): Promise<string> {
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

async function orcado(
  valor = '360000',
  programa?: unknown[],
  responsavel = 'beatriz',
): Promise<string> {
  const id = await realizado(responsavel)
  await mover(id, {
    acao: 'registrarOrcamento',
    valor,
    ...(programa === undefined ? {} : { programa }),
  }).expect(200)
  return id
}

const ENTRADA = { valor: '100000', forma: 'Pix', valorAberto: '260000' }

const UM_ITEM = [
  {
    procedimentoId: '11111111-1111-4111-8111-111111111111',
    sessoes: 6,
    intervaloDias: 30,
    chave: 'a',
  },
]

const ltvDaAna = async (quem = 'beatriz'): Promise<string | null> => {
  const r = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}`, {}, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return r.body.ltv as string | null
}

const saldoDaAna = async (quem = 'beatriz'): Promise<string | null> => {
  const r = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}`, {}, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return r.body.saldo as string | null
}

/* ------------------------------------------------- a transação, por inteiro */

describe('FECHAR É UMA TRANSAÇÃO SÓ', () => {
  it('as duas escritas acontecem juntas: o recebimento e a etapa', async () => {
    const id = await orcado()
    const t = corpoDe(await mover(id, { acao: 'fechar', recebimento: ENTRADA }).expect(200))

    expect(t.etapa).toBe('fechado')
    expect(t.status).toBe('concluida')
    // O cartão para de pedir ação: a paciente decidiu.
    expect(t.proximoPassoEm).toBeNull()
    expect(t.pagamento).not.toBeNull()
    expect(t.pagamento!.valor).toBe('100000')
    expect(t.pagamento!.valorAberto).toBe('260000')
    expect(await vivosDe(c, id)).toHaveLength(1)
  })

  it('o montador indisponível DESFAZ a escrita do dinheiro — nenhum recebimento órfão', async () => {
    // Com programa na proposta, o fechamento precisa montar o `Programa`, e o
    // montador do épico 5 não existe. A recusa tem de desfazer o recebimento
    // que a mesma transação já tinha inserido — senão a paciente pagou, o
    // cartão continuou em "Orçamentos em aberto", e a clínica liga para
    // cobrar quem já pagou. É exatamente o defeito do protótipo.
    const id = await orcado('360000', UM_ITEM)
    const r = await mover(id, { acao: 'fechar', recebimento: ENTRADA })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(501)
    expect(String(r.body.message)).toContain('Programas')

    expect(await recebimentosDe(c, id)).toHaveLength(0) // nem vivo, nem estornado
    const t = await buscar(id)
    expect(t.etapa).toBe('orcamento')
    expect(t.status).toBe('concluida')
    // E a proposta CONTINUA LÁ, inteira, esperando o épico 5.
    expect(t.programaOrcado).toHaveLength(1)
    expect(await receitaDoDia(c)).toBe(0n)
  })

  it('se o RECEBIMENTO falhar, a etapa NÃO anda — ou as duas escritas, ou nenhuma', async () => {
    /**
     * O outro sentido da atomicidade, e o único que um teste consegue
     * distinguir de "nunca foi inserido".
     *
     * A vaga de recebimento da tarefa está ocupada (índice único
     * `recebimento_por_tarefa`, regra 3), então a inserção do fechamento
     * falha. Se a etapa andasse, a clínica veria "Fechado" num cartão em que
     * o dinheiro do fechamento não entrou — e o funil contaria um negócio
     * que não existe.
     *
     * Isto também é a prova que o teste do montador NÃO dá: lá, "rolou de
     * volta" e "nunca foi inserido" produzem o mesmo resultado observável.
     */
    const id = await orcado()
    await inserirRecebimento(c, id, c.pacientes['ana']!, 5000n)

    const r = await mover(id, { acao: 'fechar', recebimento: ENTRADA })
    expect(r.statusCode, JSON.stringify(r.body)).toBeGreaterThanOrEqual(400)

    expect((await buscar(id)).etapa).toBe('orcamento')
    const vivos = await vivosDe(c, id)
    expect(vivos).toHaveLength(1)
    expect(vivos[0]!.valor).toBe('5000') // o que já estava, intacto
  })

  it('o histórico não ganha evento quando o fechamento é recusado', async () => {
    const id = await orcado('360000', UM_ITEM)
    const antes = (await buscar(id)).historico.length
    await mover(id, { acao: 'fechar', recebimento: ENTRADA }).expect(501)
    expect((await buscar(id)).historico).toHaveLength(antes)
  })
})

/* ---------------------------------------- orçamento não é receita (regra 4) */

describe('A RECEITA CONTA A ENTRADA, NUNCA O ORÇAMENTO', () => {
  it('entrada de R$ 1.000 num orçamento de R$ 3.600: receita é 100000', async () => {
    const id = await orcado()
    await mover(id, { acao: 'fechar', recebimento: ENTRADA }).expect(200)

    expect(await receitaDoDia(c)).toBe(100000n) // R$ 1.000, não R$ 3.600
    expect((await buscar(id)).valorOrcamento).toBe('360000')
  })

  it('o LTV sobe pela entrada, não pelo negócio fechado', async () => {
    const id = await orcado()
    await mover(id, { acao: 'fechar', recebimento: ENTRADA }).expect(200)
    expect(await ltvDaAna()).toBe('100000')
  })

  it('o saldo em aberto NASCE do fechamento, e é derivado', async () => {
    const id = await orcado()
    expect(await saldoDaAna()).toBe('0')
    await mover(id, { acao: 'fechar', recebimento: ENTRADA }).expect(200)
    expect(await saldoDaAna()).toBe('260000')
    // E não existe coluna `saldo` em `tarefas` (regra 5).
    expect(Object.keys((await tarefaCrua(c, id))!)).not.toContain('saldo')
  })

  it('A RECEITA NÃO DOBRA: o mesmo cartão recusa o segundo recebimento', async () => {
    const id = await orcado()
    await mover(id, { acao: 'fechar', recebimento: ENTRADA }).expect(200)
    await expect(
      inserirRecebimento(c, id, c.pacientes['ana']!, 100000n),
    ).rejects.toThrow(/recebimento_por_tarefa/i)
    expect(await receitaDoDia(c)).toBe(100000n)
  })
})

/* --------------------------------------------------- o valor do negócio */

describe('o valor do negócio fechado', () => {
  it('fechar direto de `realizado` grava entrada + aberto como valor do orçamento', async () => {
    const id = await realizado()
    const t = corpoDe(
      await mover(id, {
        acao: 'fechar',
        recebimento: { valor: '45000', forma: 'Pix', valorAberto: '15000' },
      }).expect(200),
    )
    expect(t.etapa).toBe('fechado')
    expect(t.valorOrcamento).toBe('60000') // 450 + 150, como o protótipo
  })

  it('sem valor em aberto, o negócio é a entrada', async () => {
    const id = await realizado()
    const t = corpoDe(
      await mover(id, { acao: 'fechar', recebimento: { valor: '45000', forma: 'Dinheiro' } }).expect(
        200,
      ),
    )
    expect(t.valorOrcamento).toBe('45000')
  })

  it('fechar NÃO sobrescreve um valor de orçamento já registrado', async () => {
    // O protótipo: `if (!(Number(t.valorOrcamento) > 0) && Number(b.valor) > 0)`.
    // Se sobrescrevesse, o funil mediria "fechado pelo que entrou", e um
    // fechamento com entrada pequena apagaria o tamanho do negócio.
    const id = await orcado('360000')
    const t = corpoDe(
      await mover(id, { acao: 'fechar', recebimento: { valor: '10000', forma: 'Pix' } }).expect(200),
    )
    expect(t.valorOrcamento).toBe('360000')
  })

  it('o evento de fechamento carrega o VALOR FECHADO, em centavos de texto', async () => {
    const id = await orcado('360000')
    const t = corpoDe(
      await mover(id, {
        acao: 'fechar',
        recebimento: { valor: '10000', forma: 'Pix' },
        nota: 'entrada no Pix',
      }).expect(200),
    )
    const ev = t.historico.at(-1)!
    expect(ev.acao).toBe('fechar')
    expect(ev.etapa).toBe('fechado')
    // É o valor do NEGÓCIO (360000), não o da entrada (10000): é ele que o
    // funil soma em "Fechados", e as duas medem coisas diferentes.
    expect(ev.valor).toBe('360000')
    expect(ev.nota).toBe('entrada no Pix')
  })

  it('DINHEIRO DENTRO DO JSONB É STRING DE CENTAVOS, nunca number', async () => {
    const id = await orcado('360000')
    await mover(id, { acao: 'fechar', recebimento: { valor: '10000', forma: 'Pix' } }).expect(200)
    const crua = (await tarefaCrua(c, id))!
    const hist = crua['historico'] as { acao: string; valor?: unknown }[]
    const ev = hist.find((x) => x.acao === 'fechar')!
    expect(typeof ev.valor).toBe('string')
  })
})

/* ------------------------------------------------------------- terminal */

describe('fechado é terminal', () => {
  it('nada sai de fechado — nem reabrir', async () => {
    const id = await orcado()
    await mover(id, { acao: 'fechar', recebimento: ENTRADA }).expect(200)
    for (const acao of ['confirmar', 'noshow', 'followUp', 'reabrir'] as const) {
      const r = await mover(id, { acao })
      expect(r.statusCode, `${acao} devia ser recusada`).toBe(409)
    }
    // Reabrir um fechado deixaria o recebimento pendurado num atendimento que
    // voltou a não ter acontecido.
    expect(await vivosDe(c, id)).toHaveLength(1)
    expect((await buscar(id)).etapa).toBe('fechado')
  })

  it('fechar duas vezes é 409, e o dinheiro não dobra', async () => {
    const id = await orcado()
    await mover(id, { acao: 'fechar', recebimento: ENTRADA }).expect(200)
    await mover(id, { acao: 'fechar', recebimento: ENTRADA }).expect(409)
    expect(await receitaDoDia(c)).toBe(100000n)
  })
})

/* ------------------------------------------------------- a autorização */

describe('a rota que cria dinheiro é gated', () => {
  it('sem `receber`, 403 — e NADA foi escrito', async () => {
    // Juliana é recepção: tem `jornada`, não tem `receber`.
    const id = await orcado()
    const r = await mover(id, { acao: 'fechar', recebimento: ENTRADA }, 'juliana')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(403)
    expect(await recebimentosDe(c, id)).toHaveLength(0)
    expect((await buscar(id)).etapa).toBe('orcamento')
  })

  it('sem `jornada`, 403 — a permissão da classe continua valendo', async () => {
    const id = await orcado()
    const r = await mover(id, { acao: 'fechar', recebimento: ENTRADA }, 'camila')
    expect(r.statusCode).toBe(403)
    expect((await buscar(id)).etapa).toBe('orcamento')
  })

  it('as OUTRAS ações continuam sem exigir `receber`', async () => {
    const id = await orcado()
    // Juliana (sem `receber`) registra o follow-up normalmente.
    const t = corpoDe(await mover(id, { acao: 'followUp', nota: 'vai decidir' }, 'juliana').expect(200))
    expect(t.etapa).toBe('orcamento')
  })
})

/* ----------------------------------------------------- redação de valores */

describe('a redação alcança o fechamento inteiro', () => {
  it('sem `valores`: o valor do negócio some do topo E DE DENTRO DO HISTÓRICO', async () => {
    // Juliana é a RESPONSÁVEL para que o cartão caia no "Para mim" dela — ela
    // não tem `tarefas.equipe`, e o que se mede aqui é a redação, não o escopo.
    const id = await orcado('360000', undefined, 'juliana')
    await mover(id, { acao: 'fechar', recebimento: ENTRADA }).expect(200)

    // Juliana tem `jornada`, não tem `valores`.
    const t = await buscar(id, 'juliana')
    expect(t.valorOrcamento).toBeNull()
    expect(t.pagamento!.valor).toBeNull()
    expect(t.pagamento!.valorAberto).toBeNull()
    const ev = t.historico.find((x) => x.acao === 'fechar')!
    expect(ev.valor).toBeNull()
    // A varredura que não depende de eu lembrar de cada campo.
    expect(JSON.stringify(t)).not.toContain('360000')
    expect(JSON.stringify(t)).not.toContain('100000')
  })
})
