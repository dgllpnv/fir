import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AMANHA,
  apagar,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  ONTEM,
  pegar,
  postar,
  receitaDoDia,
} from '../tarefas/__tests__/cenario'

/**
 * O RECEBIMENTO AVULSO — e a costura com o épico 2.
 *
 * Ele **não** é uma linha nova de dinheiro: é a MESMA `recebimentos` da
 * migration `0006`, pendurada numa **tarefa companheira** concluída, criada na
 * mesma transação. É isso que faz a ficha da paciente ser uma linha do tempo
 * só, em vez de duas listas que ninguém cruza — e é isso que mantém a regra 3
 * sob a guarda do índice único, e não de um `if`.
 */
let c: Cenario

const req = () => randomUUID()

type Corpo = Record<string, unknown>

const corpoBase = (x: Corpo = {}): Corpo => ({
  requisicaoId: req(),
  pacienteId: c.pacientes['ana'],
  valor: '45000',
  forma: 'Pix',
  em: HOJE,
  ref: 'consulta',
  ...x,
})

const registrar = (x: Corpo = {}, quem = 'beatriz') => postar(c, '/v1/recebimentos', corpoBase(x), quem)

const listar = (consulta: Record<string, string> = {}, quem = 'beatriz') =>
  pegar(c, '/v1/recebimentos', consulta, quem)

const contarVivos = async (): Promise<number> => {
  const r = await c.migrate.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM recebimentos WHERE clinica_id = $1 AND estornado_em IS NULL`,
    [c.clinica],
  )
  return Number(r.rows[0]!.n)
}

const contarTarefasDe = async (pacienteId: string): Promise<number> => {
  const r = await c.migrate.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM tarefas
      WHERE clinica_id = $1 AND paciente_id = $2 AND excluida_em IS NULL`,
    [c.clinica, pacienteId],
  )
  return Number(r.rows[0]!.n)
}

const recebimentoCru = async (id: string) => {
  const r = await c.migrate.query<Record<string, unknown>>(
    `SELECT id, tarefa_id, valor::text AS valor, valor_aberto::text AS valor_aberto, forma, tipo,
            requisicao_id, estornado_em, recebido_em, unidade_id
       FROM recebimentos WHERE id = $1`,
    [id],
  )
  return r.rows[0]
}

const tarefaCrua = async (id: string) => {
  const r = await c.migrate.query<Record<string, unknown>>(
    `SELECT id, status, tipo, descricao, prazo::text AS prazo, concluida_em, excluida_em, obs
       FROM tarefas WHERE id = $1`,
    [id],
  )
  return r.rows[0]
}

const trilhaDe = async (entidade: string, id: string) => {
  const r = await c.migrate.query<{ acao: string }>(
    `SELECT acao FROM auditoria WHERE entidade = $1 AND entidade_id = $2 ORDER BY em`,
    [entidade, id],
  )
  return r.rows.map((x) => x.acao)
}

/** A receita do MÊS civil da clínica, somada direto no banco. */
const receitaDoMes = async (mes = '2026-10'): Promise<bigint> => {
  const r = await c.migrate.query<{ total: string }>(
    `SELECT coalesce(sum(valor), 0)::text AS total FROM recebimentos
      WHERE clinica_id = $1 AND estornado_em IS NULL
        AND to_char((recebido_em AT TIME ZONE 'America/Bahia')::date, 'YYYY-MM') = $2`,
    [c.clinica, mes],
  )
  return BigInt(r.rows[0]!.total)
}

beforeAll(async () => {
  c = await montarCenario('receb')
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparTarefas(c)
})

describe('registrar — a tarefa companheira', () => {
  it('registrar um recebimento cria UMA tarefa concluída e UM recebimento', async () => {
    const r = await registrar({ ref: 'consulta', valor: '45000', forma: 'Pix' })
    expect(r.statusCode).toBe(201)
    expect(await contarVivos()).toBe(1)

    const cru = await recebimentoCru(r.body.id as string)
    expect(cru!['valor']).toBe('45000')
    expect(cru!['tipo']).toBe('Pagamento de consulta')

    const tarefa = await tarefaCrua(cru!['tarefa_id'] as string)
    expect(tarefa!['status']).toBe('concluida')
    expect(tarefa!['tipo']).toBe('Pagamento de consulta')
    expect(tarefa!['prazo']).toBe(HOJE)
    expect(await receitaDoDia(c)).toBe(45000n)
  })

  it('cada referência vira o TIPO que o faturamento classifica', async () => {
    const casos: readonly [string, string][] = [
      ['consulta', 'Pagamento de consulta'],
      ['sinal', 'Sinal de consulta'],
      ['novo', 'Pagamento de orçamento'],
      ['saldo', 'Pagamento de saldo em aberto'],
    ]
    for (const [ref, tipo] of casos) {
      await limparTarefas(c)
      const r = await registrar({ ref, valor: '10000' })
      expect(r.statusCode, ref).toBe(201)
      expect((await recebimentoCru(r.body.id as string))!['tipo'], ref).toBe(tipo)
    }
  })

  it('"ficou valor em aberto" vira `valor_aberto` no MESMO recebimento', async () => {
    const r = await registrar({ ref: 'novo', valor: '100000', valorAberto: '200000' })
    expect(r.statusCode).toBe(201)
    const cru = await recebimentoCru(r.body.id as string)
    expect(cru!['valor']).toBe('100000')
    expect(cru!['valor_aberto']).toBe('200000')
    // E a receita conta SÓ o que entrou. O aberto não é receita.
    expect(await receitaDoDia(c)).toBe(100000n)
  })

  it('a unidade da clínica VIZINHA não cola no recebimento', async () => {
    // Mesma classe de furo que o épico 2 fechou em `pacientes`: a FK atravessa
    // a RLS, e sem conferir dentro de `naClinica` o vínculo grava com 201.
    const daOutra = await c.migrate.query<{ id: string }>(
      `INSERT INTO unidades (clinica_id, nome) VALUES ($1, 'Vizinha') RETURNING id`,
      [c.outraClinica],
    )
    const r = await registrar({ unidadeId: daOutra.rows[0]!.id })
    expect(r.statusCode).toBe(201)
    expect((await recebimentoCru(r.body.id as string))!['unidade_id']).toBeNull()
  })
})

describe('a regra 3 — cada pagamento conta uma vez', () => {
  it('A RECEITA NÃO DOBRA: o pagamento embutido e o avulso do mesmo atendimento não coexistem', async () => {
    // A consulta foi concluída COM pagamento (épico 2)…
    const consulta = await concluirComPagamento()
    expect(consulta.statusCode).toBe(201)
    const tarefaId = consulta.body.tarefa.id as string
    expect(await receitaDoDia(c)).toBe(45000n)

    // …e a lista dos últimos 7 dias, que vem do SERVIDOR e aparece no
    // formulário ANTES do campo de valor, é o que impede o lançamento
    // duplicado de passar despercebido.
    const aviso = await listar({ pacienteId: c.pacientes['ana']!, ultimosDias: '7' })
    expect(aviso.statusCode).toBe(200)
    expect(aviso.body.itens).toHaveLength(1)
    expect((aviso.body.itens as { tarefaId: string }[])[0]!.tarefaId).toBe(tarefaId)

    // E o índice continua fazendo o que lhe cabe: a MESMA tarefa nunca tem dois.
    await expect(
      c.migrate.query(
        `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, recebido_em, registrado_por)
         VALUES ($1,$2,$3,'Consulta realizada','45000','Pix', now(), $4)`,
        [c.clinica, c.pacientes['ana'], tarefaId, c.pessoas['beatriz']],
      ),
    ).rejects.toThrow(/recebimento_por_tarefa/i)
    expect(await receitaDoDia(c)).toBe(45000n)
  })

  it('O DUPLO TOQUE NÃO DOBRA A RECEITA: o mesmo `requisicaoId` devolve o MESMO recebimento', async () => {
    const r = req()
    const a = await registrar({ requisicaoId: r, valor: '45000' })
    const b = await registrar({ requisicaoId: r, valor: '45000' })
    const d = await registrar({ requisicaoId: r, valor: '45000' })

    expect(a.statusCode).toBe(201)
    expect(b.body.id).toBe(a.body.id)
    expect(d.body.id).toBe(a.body.id)
    expect(await contarVivos()).toBe(1)
    // Nem a tarefa companheira dobra: se ela nascesse fora da guarda de
    // idempotência, sobrariam duas tarefas concluídas e uma órfã.
    expect(await contarTarefasDe(c.pacientes['ana']!)).toBe(1)
    expect(await receitaDoDia(c)).toBe(45000n)
  })

  it('o reenvio devolve o recebimento ORIGINAL mesmo com valor diferente', async () => {
    // Um reenvio não é uma edição. Se o segundo toque trouxesse outro valor e
    // o servidor o aceitasse, a idempotência viraria uma porta de alteração
    // silenciosa de dinheiro já lançado.
    const r = req()
    const a = await registrar({ requisicaoId: r, valor: '45000' })
    const b = await registrar({ requisicaoId: r, valor: '99900' })
    expect(b.body.id).toBe(a.body.id)
    expect((await recebimentoCru(a.body.id as string))!['valor']).toBe('45000')
    expect(await receitaDoDia(c)).toBe(45000n)
  })

  it('ORÇAMENTO NÃO É RECEITA: a receita do mês soma `recebimentos`, nunca `tarefas`', async () => {
    const orc = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'paciente',
        responsavelId: c.pessoas['beatriz'],
        descricao: 'Orçamento da Ana',
        pacienteId: c.pacientes['ana'],
        tipo: 'Orçamento enviado',
        quando: { modo: 'agendada', prazo: HOJE },
      },
      'beatriz',
    )
    expect(orc.statusCode).toBe(201)
    await c.migrate.query(`UPDATE tarefas SET valor_orcamento = 320000 WHERE id = $1`, [
      orc.body.tarefa.id,
    ])
    expect(await receitaDoMes()).toBe(0n)
    expect(await receitaDoDia(c)).toBe(0n)
  })
})

describe('a data de negócio vem do servidor', () => {
  it('"amanhã" é 400 — e o relógio do cliente não tem voto', async () => {
    const r = await registrar({ em: AMANHA })
    expect(r.statusCode).toBe(400)
    expect(String(r.body.message)).toContain('até hoje')
    expect(await contarVivos()).toBe(0)
  })

  it('ontem é aceito, e cai no dia de ONTEM na clínica', async () => {
    const r = await registrar({ em: ONTEM })
    expect(r.statusCode).toBe(201)
    expect(await receitaDoDia(c, ONTEM)).toBe(45000n)
    expect(await receitaDoDia(c, HOJE)).toBe(0n)
  })
})

describe('estorno — nunca um DELETE', () => {
  it('estornar tira o dinheiro da receita e DEIXA a trilha', async () => {
    const r = await registrar({ valor: '45000' })
    const id = r.body.id as string
    expect((await apagar(c, `/v1/recebimentos/${id}`, {}, 'beatriz')).statusCode).toBe(204)

    expect(await receitaDoDia(c)).toBe(0n)
    expect((await recebimentoCru(id))!['estornado_em']).not.toBeNull()
    expect(await trilhaDe('recebimentos', id)).toContain('alterou')
  })

  it('estornado leva junto a tarefa companheira, e ela some das listas', async () => {
    const r = await registrar({ valor: '45000' })
    const id = r.body.id as string
    const tarefaId = (await recebimentoCru(id))!['tarefa_id'] as string
    await apagar(c, `/v1/recebimentos/${id}`, {}, 'beatriz')

    // Soft delete, nunca `DELETE`: a tarefa existe e está marcada.
    expect((await tarefaCrua(tarefaId))!['excluida_em']).not.toBeNull()
    expect(await contarTarefasDe(c.pacientes['ana']!)).toBe(0)
    expect((await listar({ dia: HOJE })).body.itens).toHaveLength(0)
  })

  it('estornar duas vezes é 409 — e a primeira continua valendo', async () => {
    const r = await registrar({ valor: '45000' })
    const id = r.body.id as string
    await apagar(c, `/v1/recebimentos/${id}`, {}, 'beatriz')
    const segundo = await apagar(c, `/v1/recebimentos/${id}`, {}, 'beatriz')
    expect(segundo.statusCode).toBe(409)
    expect(await receitaDoDia(c)).toBe(0n)
  })

  it('o pagamento EMBUTIDO não se estorna por aqui — 409, com a saída na mensagem', async () => {
    // Desfazer o pagamento de um atendimento é REABRIR o atendimento (épico
    // 2). Uma segunda porta para o mesmo estorno é a porta que esquece de
    // reabrir a tarefa, e o atendimento fica concluído sem o dinheiro que a
    // recepção acha que lançou.
    const consulta = await concluirComPagamento()
    const tarefaId = consulta.body.tarefa.id as string
    const r = await c.migrate.query<{ id: string }>(
      'SELECT id FROM recebimentos WHERE tarefa_id = $1',
      [tarefaId],
    )
    const resposta = await apagar(c, `/v1/recebimentos/${r.rows[0]!.id}`, {}, 'beatriz')
    expect(resposta.statusCode).toBe(409)
    expect(String(resposta.body.message)).toMatch(/reabr/i)
    expect(await receitaDoDia(c)).toBe(45000n)
  })
})

describe('programa — a porta do épico 5', () => {
  it('"programa em andamento" é 409, com o texto da tela', async () => {
    const r = await registrar({ ref: 'programa', programaId: randomUUID() })
    expect(r.statusCode).toBe(409)
    expect(String(r.body.message)).toContain('programa em andamento')
    expect(await contarVivos()).toBe(0)
  })
})

describe('permissão e redação', () => {
  it('sem `receber`, 403 — e nenhum recebimento é criado', async () => {
    const r = await registrar({}, 'juliana')
    expect(r.statusCode).toBe(403)
    expect(await contarVivos()).toBe(0)
  })

  it('sem `receber`, a lista e o estorno também são 403', async () => {
    const criado = await registrar({ valor: '45000' })
    expect((await listar({ dia: HOJE }, 'juliana')).statusCode).toBe(403)
    expect(
      (await apagar(c, `/v1/recebimentos/${criado.body.id as string}`, {}, 'juliana')).statusCode,
    ).toBe(403)
  })

  it('sem `valores`, a lista traz paciente, forma e data, e `valor` vem `null`', async () => {
    // `rita` tem `receber` e NÃO tem `valores`: é o perfil que a clínica de
    // verdade dá ao balcão. Ela registra o dinheiro e não o vê.
    const criado = await registrar({ valor: '45000', valorAberto: undefined }, 'rita')
    expect(criado.statusCode).toBe(201)

    const r = await listar({ dia: HOJE }, 'rita')
    const item = (r.body.itens as Record<string, unknown>[])[0]!
    expect(item['paciente']).toBe('Ana Lúcia Souza')
    expect(item['forma']).toBe('Pix')
    expect(item['em']).toBe(HOJE)
    expect(item['valor']).toBeNull()
    expect(item['valorAberto']).toBeNull()
    // E o número não aparece sob nenhum outro nome, em lugar nenhum do corpo.
    expect(r.text).not.toContain('45000')
  })

  it('a RESPOSTA do POST também é redigida — não só a lista', async () => {
    const r = await registrar({ valor: '45000' }, 'rita')
    expect(r.body.valor).toBeNull()
    expect(r.text).not.toContain('45000')
    // O id existe: é dele que a tela precisa para desfazer.
    expect(typeof r.body.id).toBe('string')
  })
})

describe('isolamento de clínica', () => {
  it('recebimento de outra clínica não é alcançável nem por id', async () => {
    const id = await c.migrate.query<{ id: string }>(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por)
       VALUES ($1, $2, 'Pagamento de consulta', 99900, 'Pix', now(), $3) RETURNING id`,
      [c.outraClinica, c.pacienteDaOutra, (await pessoaDaOutraClinica())],
    )
    const r = await apagar(c, `/v1/recebimentos/${id.rows[0]!.id}`, {}, 'beatriz')
    expect(r.statusCode).toBe(404)
    const lista = await listar({ dia: HOJE })
    expect(lista.text).not.toContain('99900')
  })

  it('paciente de outra clínica é 404 no POST, não 201 com o vínculo errado', async () => {
    const r = await registrar({ pacienteId: c.pacienteDaOutra })
    expect(r.statusCode).toBe(404)
    expect(await contarVivos()).toBe(0)
  })
})

describe('a regra 21 — nada de valor nem de nome de paciente em log', () => {
  it('nenhum log do caminho feliz contém valor nem nome de paciente', async () => {
    const escrito: string[] = []
    const originais = [process.stdout.write, process.stderr.write] as const
    const capturar = (texto: unknown): boolean => {
      escrito.push(String(texto))
      return true
    }
    process.stdout.write = capturar as typeof process.stdout.write
    process.stderr.write = capturar as typeof process.stderr.write
    try {
      await registrar({ valor: '45000' })
    } finally {
      process.stdout.write = originais[0]
      process.stderr.write = originais[1]
    }
    const tudo = escrito.join('')
    expect(tudo).not.toContain('45000')
    expect(tudo).not.toContain('Ana Lúcia')
    expect(tudo).not.toContain('98888')
  })
})

/** O caminho do ÉPICO 2: o atendimento concluído com o pagamento dentro. */
const concluirComPagamento = () =>
  postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      responsavelId: c.pessoas['beatriz'],
      descricao: 'Consulta da Ana',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta realizada',
      quando: { modo: 'retroativo', em: HOJE, pagamento: { valor: '45000', forma: 'Pix' } },
    },
    'beatriz',
  )

async function pessoaDaOutraClinica(): Promise<string> {
  const r = await c.migrate.query<{ id: string }>(
    'SELECT id FROM pessoas WHERE clinica_id = $1 LIMIT 1',
    [c.outraClinica],
  )
  return r.rows[0]!.id
}
