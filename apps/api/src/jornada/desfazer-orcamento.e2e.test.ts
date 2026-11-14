import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparProgramas,
  montarCenario,
  pegar,
  postar,
  receitaDoDia,
} from '../tarefas/__tests__/cenario'

/**
 * **REABRIR / EXCLUIR SÓ O ORÇAMENTO** (pedido da cliente, 2026-11-13).
 *
 * O que esta suíte cobra, na ordem em que a cliente sofre:
 *
 *  1. errou o fechamento → "Reabrir orçamento": volta a Orçamento, o dinheiro
 *     sai da receita e o funil deixa de contar o fechado;
 *  2. o orçamento nem devia existir → "Excluir orçamento": a CONSULTA fica;
 *  3. fechar de novo depois de reabrir NÃO dobra a receita (regra 3);
 *  4. o motivo é obrigatório e quem não tem `receber` não estorna;
 *  5. repetir a ação não estorna duas vezes;
 *  6. dia de caixa fechado pede confirmação.
 */
type Doc = Record<string, unknown>

let c: Cenario
let proc: { id: string; nome: string }[]

beforeAll(async () => {
  c = await montarCenario('desfazer-orcamento')
  const p = await c.migrate.query<{ id: string; nome: string }>(
    'SELECT id, nome FROM procedimentos WHERE clinica_id = $1 ORDER BY nome LIMIT 3',
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

const MOTIVO = 'Fechei o orçamento errado, preciso refazer'

const mover = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, quem)

async function orcarEFechar(): Promise<string> {
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
  const id = r.body.tarefa.id as string
  const o = await mover(id, {
    acao: 'registrarOrcamento',
    valor: '1000000',
    programa: [{ chave: 'p1', procedimentoId: proc[0]!.id, sessoes: 4, intervaloDias: 7 }],
  })
  expect(o.statusCode, JSON.stringify(o.body)).toBe(200)
  return id
}

const fechar = (id: string) =>
  mover(id, {
    acao: 'fechar',
    fechamento: 'tudo',
    recebimento: { valor: '400000', forma: 'Pix', valorAberto: '600000' },
  })

const tarefa = async (id: string) => {
  const r = await pegar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return r.body.tarefa as Doc
}

const funilFechados = async (): Promise<{ n: number; valor: bigint }> => {
  const r = await pegar(c, '/v1/jornada', {}, 'beatriz')
  const p = (r.body.funil as { chave: string; n: number; valor: string | null }[]).find(
    (x) => x.chave === 'fechados',
  )!
  return { n: p.n, valor: BigInt(p.valor ?? '0') }
}

const programasVivos = async (): Promise<number> =>
  (
    await c.migrate.query(
      'SELECT 1 FROM programas WHERE paciente_id = $1 AND excluido_em IS NULL AND clinica_id = $2',
      [c.pacientes['ana'], c.clinica],
    )
  ).rowCount ?? 0

describe('REABRIR O ORÇAMENTO', () => {
  it('volta a Orçamento, estorna o dinheiro, exclui o programa e tira o fechado do funil', async () => {
    const funilAntes = await funilFechados()
    const receitaAntes = await receitaDoDia(c)
    const id = await orcarEFechar()
    expect((await fechar(id)).statusCode).toBe(200)
    expect(await receitaDoDia(c)).toBe(receitaAntes + 400000n)
    expect(await programasVivos()).toBe(1)
    expect((await funilFechados()).n).toBe(funilAntes.n + 1)

    const r = await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)

    const t = await tarefa(id)
    expect(t['etapa']).toBe('orcamento')
    expect(t['valorFechado']).toBeNull()
    expect(t['valorOrcamento']).toBe('1000000') // o oferecido continua
    expect(await receitaDoDia(c)).toBe(receitaAntes) // o dinheiro SAIU da receita
    expect(await programasVivos()).toBe(0)
    expect(await funilFechados()).toEqual(funilAntes) // o funil não conta o desfeito
    const ev = (t['historico'] as Doc[]).at(-1)!
    expect(ev).toMatchObject({ acao: 'reabrirOrcamento', motivo: MOTIVO })
  })

  it('fechar DE NOVO depois de reabrir não dobra a receita nem o funil', async () => {
    const funilAntes = await funilFechados()
    const receitaAntes = await receitaDoDia(c)
    const id = await orcarEFechar()
    await fechar(id)
    await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO })
    const f = await fechar(id)
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    expect(await receitaDoDia(c)).toBe(receitaAntes + 400000n)
    expect((await funilFechados()).n).toBe(funilAntes.n + 1)
    expect(await programasVivos()).toBe(1)
  })

  it('repetir não estorna duas vezes: a segunda é 409', async () => {
    const id = await orcarEFechar()
    await fechar(id)
    expect((await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO })).statusCode).toBe(200)
    expect((await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO })).statusCode).toBe(409)
  })

  it('um orçamento ABERTO não se reabre: 409', async () => {
    const id = await orcarEFechar()
    expect((await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO })).statusCode).toBe(409)
  })
})

describe('EXCLUIR O ORÇAMENTO — a consulta fica', () => {
  it('volta a Realizada, sem orçamento; o dinheiro é estornado', async () => {
    const receitaAntes = await receitaDoDia(c)
    const id = await orcarEFechar()
    await fechar(id)
    const r = await mover(id, { acao: 'excluirOrcamento', motivo: MOTIVO })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const t = await tarefa(id)
    expect(t['etapa']).toBe('realizado')
    expect(t['valorOrcamento']).toBeNull()
    expect(t['programaOrcado']).toBeNull()
    expect(t['excluidaEm'] ?? null).toBeNull() // a tarefa NÃO foi excluída
    expect(await receitaDoDia(c)).toBe(receitaAntes)
    expect(await programasVivos()).toBe(0)
    // E a aba Orçamentos da paciente já não lista esse orçamento.
    const aba = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}/orcamentos`, {}, 'beatriz')
    expect((aba.body.itens as Doc[]).some((o) => o['tarefaId'] === id)).toBe(false)
  })

  it('um orçamento ainda aberto também pode ser excluído', async () => {
    const id = await orcarEFechar()
    expect((await mover(id, { acao: 'excluirOrcamento', motivo: MOTIVO })).statusCode).toBe(200)
    expect((await tarefa(id))['etapa']).toBe('realizado')
  })

  it('o orçamento enviado que foi excluído sai da contagem do funil', async () => {
    const pegarEnviados = async () => {
      const r = await pegar(c, '/v1/jornada', {}, 'beatriz')
      return (r.body.funil as { chave: string; n: number }[]).find((x) => x.chave === 'orcamentosEnviados')!.n
    }
    const antes = await pegarEnviados()
    const id = await orcarEFechar()
    expect(await pegarEnviados()).toBe(antes + 1)
    await mover(id, { acao: 'excluirOrcamento', motivo: MOTIVO })
    expect(await pegarEnviados()).toBe(antes)
  })
})

describe('REGRAS DO GATE', () => {
  it('motivo ausente ou curto é 400 e nada muda', async () => {
    const id = await orcarEFechar()
    await fechar(id)
    expect((await mover(id, { acao: 'reabrirOrcamento' })).statusCode).toBe(400)
    expect((await mover(id, { acao: 'reabrirOrcamento', motivo: 'curto' })).statusCode).toBe(400)
    expect((await tarefa(id))['etapa']).toBe('fechado')
  })

  it('quem tem `jornada` mas NÃO tem `receber` não estorna: 403', async () => {
    const id = await orcarEFechar()
    await fechar(id)
    const r = await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO }, 'juliana')
    expect(r.statusCode).toBe(403)
    expect((await tarefa(id))['etapa']).toBe('fechado')
  })

  it('a prévia diz o que será desfeito; sem `valores` o número some', async () => {
    const id = await orcarEFechar()
    await fechar(id)
    const com = await pegar(c, `/v1/tarefas/${id}/orcamento/previa`, {}, 'beatriz')
    expect(com.statusCode, JSON.stringify(com.body)).toBe(200)
    expect(com.body).toMatchObject({
      temPagamento: true,
      temPrograma: true,
      valor: '400000',
      geraCredito: false,
      bloqueio: null,
    })
  })

  it('dia de caixa fechado: 409 CONFIRMACAO_NECESSARIA, e com a confirmação passa', async () => {
    const id = await orcarEFechar()
    await fechar(id)
    await c.migrate.query(
      `INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1,$2,'',$3)`,
      [c.clinica, HOJE, c.pessoas['beatriz']],
    )
    const sem = await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO })
    expect(sem.statusCode).toBe(409)
    expect(sem.body).toMatchObject({ codigo: 'CONFIRMACAO_NECESSARIA', avisos: ['CAIXA_FECHADO'] })
    expect((await tarefa(id))['etapa']).toBe('fechado')
    const com = await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO, confirmarCaixaFechado: true })
    expect(com.statusCode, JSON.stringify(com.body)).toBe(200)
    await c.migrate.query('DELETE FROM caixas_do_dia WHERE clinica_id = $1', [c.clinica])
  })
})

describe('QUEM PODE REABRIR E EXCLUIR O ORÇAMENTO (pedido da cliente: superadmin, admin e gestão podem tudo)', () => {
  it('a GESTÃO (jornada + receber) reabre e exclui', async () => {
    const id = await orcarEFechar()
    await fechar(id)
    const r = await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO }, 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const e = await mover(id, { acao: 'excluirOrcamento', motivo: MOTIVO }, 'beatriz')
    expect(e.statusCode, JSON.stringify(e.body)).toBe(200)
  })

  it('o ADMIN reabre e exclui mesmo com um perfil que não tem as permissões', async () => {
    const id = await orcarEFechar()
    await fechar(id)
    // `juliana` (jornada, sem receber) não pode...
    expect((await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO }, 'juliana')).statusCode).toBe(403)
    // ...mas, sendo admin, o perfil deixa de importar.
    const perfil = (
      await c.migrate.query<{ perfil_id: string }>('SELECT perfil_id FROM pessoas WHERE id = $1', [c.pessoas['juliana']])
    ).rows[0]!.perfil_id
    // Admin e perfil são excludentes no banco (`pessoa_tem_acesso_definido`).
    await c.migrate.query('UPDATE pessoas SET admin = true, perfil_id = NULL WHERE id = $1', [c.pessoas['juliana']])
    try {
      const r = await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO }, 'juliana')
      expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
      const e = await mover(id, { acao: 'excluirOrcamento', motivo: MOTIVO }, 'juliana')
      expect(e.statusCode, JSON.stringify(e.body)).toBe(200)
    } finally {
      await c.migrate.query('UPDATE pessoas SET admin = false, perfil_id = $2 WHERE id = $1', [
        c.pessoas['juliana'],
        perfil,
      ])
    }
  })

  it('o balcão (receber, sem jornada) não mexe no orçamento: 403', async () => {
    const id = await orcarEFechar()
    await fechar(id)
    expect((await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO }, 'rita')).statusCode).toBe(403)
    expect((await mover(id, { acao: 'excluirOrcamento', motivo: MOTIVO }, 'rita')).statusCode).toBe(403)
    expect((await tarefa(id))['etapa']).toBe('fechado')
  })
})

describe('REABRIR QUANDO A PACIENTE JÁ PAGOU PARTE DA DÍVIDA (nasceria crédito)', () => {
  // Orçamento em LISTA (sem programa): a dívida do fechamento mora no grupo geral.
  async function listaFechada(): Promise<string> {
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
    const id = r.body.tarefa.id as string
    const o = await mover(id, {
      acao: 'registrarOrcamento',
      valor: '1000000',
      itens: [{ chave: 'a', procedimentoId: proc[0]!.id, valor: '1000000' }],
    })
    expect(o.statusCode, JSON.stringify(o.body)).toBe(200)
    expect((await fechar(id)).statusCode).toBe(200)
    return id
  }
  const pagarSaldo = () =>
    postar(
      c,
      '/v1/recebimentos',
      {
        requisicaoId: randomUUID(),
        pacienteId: c.pacientes['ana'],
        valor: '200000',
        forma: 'Pix',
        em: HOJE,
        obs: '',
        ref: 'saldo',
      },
      'beatriz',
    )

  it('sem pagamento de saldo, não gera crédito e reabre direto', async () => {
    const id = await listaFechada()
    const p = await pegar(c, `/v1/tarefas/${id}/orcamento/previa`, {}, 'beatriz')
    expect(p.body).toMatchObject({ geraCredito: false })
    expect((await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO })).statusCode).toBe(200)
  })

  it('com saldo já pago: a prévia avisa, o 409 pede confirmação (sem número) e, confirmado, reabre', async () => {
    const id = await listaFechada()
    const pg = await pagarSaldo()
    expect(pg.statusCode, JSON.stringify(pg.body)).toBe(201)

    const previa = await pegar(c, `/v1/tarefas/${id}/orcamento/previa`, {}, 'beatriz')
    expect(previa.body).toMatchObject({ geraCredito: true, bloqueio: null })

    const sem = await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO })
    expect(sem.statusCode).toBe(409)
    expect(sem.body).toMatchObject({ codigo: 'CONFIRMACAO_NECESSARIA', avisos: ['CREDITO_NA_PACIENTE'] })
    expect(JSON.stringify(sem.body)).not.toMatch(/\d{4,}/) // nenhum valor no corpo do erro
    expect((await tarefa(id))['etapa']).toBe('fechado') // nada mudou

    const com = await mover(id, { acao: 'reabrirOrcamento', motivo: MOTIVO, confirmarCredito: true })
    expect(com.statusCode, JSON.stringify(com.body)).toBe(200)
    expect((await tarefa(id))['etapa']).toBe('orcamento')
  })

  it('excluir também pede a confirmação do crédito', async () => {
    const id = await listaFechada()
    expect((await pagarSaldo()).statusCode).toBe(201)
    const sem = await mover(id, { acao: 'excluirOrcamento', motivo: MOTIVO })
    expect(sem.statusCode).toBe(409)
    expect(sem.body).toMatchObject({ avisos: ['CREDITO_NA_PACIENTE'] })
    expect((await mover(id, { acao: 'excluirOrcamento', motivo: MOTIVO, confirmarCredito: true })).statusCode).toBe(200)
  })
})
