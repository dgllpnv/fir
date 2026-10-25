import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
  receitaDoDia,
  tarefaCrua,
} from '../tarefas/__tests__/cenario'

/**
 * PERDER EXIGE MOTIVO — no servidor, não na tela.
 *
 * O protótipo aceita perder sem motivo. Medido, não suposto:
 * `api('moverEtapa',{id,acao:'perder'})` devolve `OK` e grava `nota: ""`. E o
 * KPI da tela Jornada diz, em letra miúda, *"veja os motivos no histórico"*.
 * Os dois juntos são um número que não explica nada — e o relatório de perda
 * existe para responder exatamente a essa pergunta.
 *
 * E o motivo é DADO da clínica (D-1), não `ENUM` do código: a lista É o
 * relatório, e só vira gestão quando a clínica pode acrescentar o motivo que
 * ela de fato ouve ao telefone.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('perder')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
  // Cada `it` começa com os cinco motivos semeados, ativos e com o nome
  // original: um teste que renomeia não pode envenenar o seguinte.
  await c.migrate.query(
    `UPDATE motivos_de_perda SET nome = p.nome, ativo = true, desativado_em = NULL
       FROM (SELECT * FROM motivos_de_perda_padrao()) p
      WHERE motivos_de_perda.clinica_id = $1 AND motivos_de_perda.ordem = p.ordem`,
    [c.clinica],
  )
})

type Corpo = Record<string, unknown>

const mover = (id: string, corpo: Corpo, quem = 'beatriz') =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, quem)

type Tarefa = {
  etapa: string | null
  status: string
  proximoPassoEm: string | null
  valorOrcamento: string | null
  motivoPerdaId: string | null
  historico: { acao: string; motivoId?: string; motivo?: string; nota?: string }[]
}

const corpoDe = (r: { body: unknown }): Tarefa => (r.body as { tarefa: Tarefa }).tarefa

type Motivo = { id: string; nome: string }

const motivosNoBanco = async (clinicaId = c.clinica): Promise<Motivo[]> =>
  (
    await c.migrate.query<Motivo>(
      'SELECT id, nome FROM motivos_de_perda WHERE clinica_id = $1 ORDER BY ordem',
      [clinicaId],
    )
  ).rows

const idDoMotivo = async (nome: string, clinicaId = c.clinica): Promise<string> =>
  (await motivosNoBanco(clinicaId)).find((m) => m.nome === nome)!.id

async function orcado(valor = '360000'): Promise<string> {
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
  await mover(id, { acao: 'registrarOrcamento', valor }).expect(200)
  return id
}

/**
 * As perdas agrupadas por motivo, com o nome ATUAL da lista ao lado do nome
 * gravado no evento. É o que o relatório do épico 3 vai ler — e a prova de
 * D-2 precisa dos dois lados.
 */
async function perdasPorMotivo(): Promise<
  { motivoId: string; nomeAtual: string; nomeNoEvento: string; n: number }[]
> {
  const r = await c.migrate.query<{
    motivo_id: string
    nome_atual: string
    nome_no_evento: string
    n: string
  }>(
    `SELECT ev->>'motivoId' AS motivo_id,
            m.nome          AS nome_atual,
            ev->>'motivo'   AS nome_no_evento,
            count(*)::text  AS n
       FROM tarefas t
       CROSS JOIN LATERAL jsonb_array_elements(t.historico) ev
       JOIN motivos_de_perda m ON m.id = (ev->>'motivoId')::uuid
      WHERE t.clinica_id = $1 AND ev->>'acao' = 'perder'
      GROUP BY 1, 2, 3`,
    [c.clinica],
  )
  return r.rows.map((x) => ({
    motivoId: x.motivo_id,
    nomeAtual: x.nome_atual,
    nomeNoEvento: x.nome_no_evento,
    n: Number(x.n),
  }))
}

/* ------------------------------------------------- o motivo é obrigatório */

describe('perder exige motivo — o protótipo aceita, nós não', () => {
  it('perder SEM motivo é 400, recusado pelo PARSE', async () => {
    const id = await orcado()
    const r = await mover(id, { acao: 'perder' })
    expect(r.statusCode).toBe(400)
    expect((await tarefaCrua(c, id))!['etapa']).toBe('orcamento')
  })

  it('motivo que não é uuid é 400', async () => {
    const id = await orcado()
    expect((await mover(id, { acao: 'perder', motivoId: 'Preço' })).statusCode).toBe(400)
  })

  it('MOTIVO DE OUTRA CLÍNICA é 400 — não 404, e nunca sucesso', async () => {
    // 404 diria "esta tarefa não existe", que é mentira. 400 diz "esse motivo
    // não é da sua lista", que é a verdade — e não confirma nada sobre a
    // clínica vizinha, porque a RLS devolve zero linhas e a mensagem é a mesma
    // de um id inventado.
    const id = await orcado()
    const daOutra = await idDoMotivo('Preço', c.outraClinica)
    const r = await mover(id, { acao: 'perder', motivoId: daOutra })
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('motivo da lista')
    expect((await tarefaCrua(c, id))!['etapa']).toBe('orcamento')
    expect((await tarefaCrua(c, id))!['motivo_perda_id']).toBeNull()
  })

  it('motivo inventado é 400, com a MESMA mensagem do de outra clínica', async () => {
    const id = await orcado()
    const r = await mover(id, {
      acao: 'perder',
      motivoId: '99999999-9999-4999-8999-999999999999',
    })
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('motivo da lista')
  })

  it('motivo DESATIVADO não serve para perda nova', async () => {
    // Desativar é um estado, nunca uma exclusão: as perdas antigas continuam
    // apontando para ele, e o relatório do trimestre passado continua inteiro.
    const id = await orcado()
    const preco = await idDoMotivo('Preço')
    await c.migrate.query(
      'UPDATE motivos_de_perda SET ativo = false, desativado_em = now() WHERE id = $1',
      [preco],
    )
    expect((await mover(id, { acao: 'perder', motivoId: preco })).statusCode).toBe(400)
  })

  it('sem a permissão `jornada`, 403 — e nada foi escrito', async () => {
    const id = await orcado()
    const r = await mover(id, { acao: 'perder', motivoId: await idDoMotivo('Preço') }, 'camila')
    expect(r.statusCode).toBe(403)
    expect((await tarefaCrua(c, id))!['etapa']).toBe('orcamento')
  })
})

/* ------------------------------------------- o nome gravado no instante */

describe('o evento guarda o id E o nome (decisão D-2)', () => {
  it('o NOME do motivo fica gravado no evento, junto com o id', async () => {
    const id = await orcado()
    const preco = await idDoMotivo('Preço')
    const t = corpoDe(await mover(id, { acao: 'perder', motivoId: preco }).expect(200))
    expect(t.etapa).toBe('perdido')
    expect(t.status).toBe('concluida')
    expect(t.motivoPerdaId).toBe(preco)
    expect(t.proximoPassoEm).toBeNull()
    expect(t.historico.at(-1)).toMatchObject({ acao: 'perder', motivoId: preco, motivo: 'Preço' })
  })

  it('RENOMEAR o motivo NÃO reescreve a história', async () => {
    // O relatório do trimestre passado não pode mudar porque alguém arrumou a
    // lista hoje. O id AGRUPA; o nome gravado é o que se LÊ.
    const id = await orcado()
    const preco = await idDoMotivo('Preço')
    await mover(id, { acao: 'perder', motivoId: preco }).expect(200)
    await c.migrate.query('UPDATE motivos_de_perda SET nome = $2 WHERE id = $1', [
      preco,
      'Preço acima do esperado',
    ])

    const crua = (await tarefaCrua(c, id))!
    const h = crua['historico'] as { acao: string; motivo?: string }[]
    expect(h.at(-1)!.motivo).toBe('Preço')

    // E o AGRUPAMENTO continua funcionando, pelo id, com o nome novo na
    // leitura — os dois lados de D-2, no mesmo teste.
    expect(await perdasPorMotivo()).toEqual([
      { motivoId: preco, nomeAtual: 'Preço acima do esperado', nomeNoEvento: 'Preço', n: 1 },
    ])
  })

  it('a observação livre fica no evento SEM se misturar ao motivo', async () => {
    // O protótipo junta as duas num campo só:
    // `nota: [b.motivo, nota].filter(Boolean).join(" · ")`. Juntas, não há como
    // agrupar por motivo nem como ler a observação separada.
    const id = await orcado()
    const outro = await idDoMotivo('Outro')
    const t = corpoDe(
      await mover(id, {
        acao: 'perder',
        motivoId: outro,
        nota: 'esperando o marido decidir',
      }).expect(200),
    )
    expect(t.historico.at(-1)).toMatchObject({
      motivo: 'Outro',
      nota: 'esperando o marido decidir',
    })
  })
})

/* ------------------------------------------------- perdido é terminal */

describe('perdido é terminal, e o valor perdido não é receita', () => {
  it('nada sai de perdido', async () => {
    const id = await orcado()
    await mover(id, { acao: 'perder', motivoId: await idDoMotivo('Preço') }).expect(200)
    for (const corpo of [
      { acao: 'followUp' },
      { acao: 'registrarOrcamento', valor: '100000' },
      { acao: 'reabrir' },
      { acao: 'confirmar' },
      { acao: 'noshow' },
    ]) {
      const r = await mover(id, corpo)
      expect(r.statusCode, JSON.stringify(corpo)).toBe(409)
    }
    expect((await tarefaCrua(c, id))!['etapa']).toBe('perdido')
  })

  it('perder NÃO apaga o valor do orçamento — é ele que mede o perdido', async () => {
    const id = await orcado()
    const t = corpoDe(await mover(id, { acao: 'perder', motivoId: await idDoMotivo('Preço') }).expect(200))
    expect(t.valorOrcamento).toBe('360000')
  })

  it('o valor perdido NUNCA entra em receita', async () => {
    const antes = await receitaDoDia(c)
    const id = await orcado()
    await mover(id, { acao: 'perder', motivoId: await idDoMotivo('Preço') }).expect(200)
    expect(await receitaDoDia(c)).toBe(antes)
  })
})

/* ----------------------------------------------- GET /v1/motivos-de-perda */

describe('GET /v1/motivos-de-perda', () => {
  it('devolve só os ATIVOS da clínica, na ordem semeada', async () => {
    const r = await pegar(c, '/v1/motivos-de-perda', {}, 'beatriz').expect(200)
    expect(r.body.itens.map((m: Motivo) => m.nome)).toEqual([
      'Preço',
      'Sem retorno do paciente',
      'Escolheu outro lugar',
      'Não é o momento',
      'Outro',
    ])
  })

  it('o desativado sai da lista', async () => {
    const preco = await idDoMotivo('Preço')
    await c.migrate.query(
      'UPDATE motivos_de_perda SET ativo = false, desativado_em = now() WHERE id = $1',
      [preco],
    )
    const r = await pegar(c, '/v1/motivos-de-perda', {}, 'beatriz').expect(200)
    expect(r.body.itens.map((m: Motivo) => m.id)).not.toContain(preco)
    expect(r.body.itens).toHaveLength(4)
  })

  it('a lista é DA CLÍNICA: nenhum id da vizinha atravessa', async () => {
    const daOutra = (await motivosNoBanco(c.outraClinica)).map((m) => m.id)
    const r = await pegar(c, '/v1/motivos-de-perda', {}, 'beatriz').expect(200)
    for (const m of r.body.itens as Motivo[]) expect(daOutra).not.toContain(m.id)
  })

  it('sem a permissão `jornada`, 403', async () => {
    expect((await pegar(c, '/v1/motivos-de-perda', {}, 'camila')).statusCode).toBe(403)
  })

  it('sem sessão, 401', async () => {
    expect((await pegar(c, '/v1/motivos-de-perda', {}, 'ninguem')).statusCode).toBe(401)
  })
})
