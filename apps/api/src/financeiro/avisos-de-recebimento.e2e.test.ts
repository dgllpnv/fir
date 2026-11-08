import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  apagar,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparProgramas,
  montarCenario,
  ONTEM,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * **OS AVISOS DE RECEBIMENTO E O "MUDOU DEPOIS DO FECHAMENTO" (D-21).**
 *
 * Postgres real. Os casos são os que o gate do `validador-numeros` listou:
 * retroativo em cada um dos seis caminhos, a borda de fuso, os números à mão,
 * o estorno que se anula, a promissória, o transporte e a duplicidade com
 * `requisicaoId`.
 *
 * O relógio do cenário é 25/10 02:00 UTC — **23:00 de 24/10 em
 * America/Bahia**. O "hoje" da clínica é 24/10.
 */
let c: Cenario
let tirze: string

type Corpo = Record<string, unknown>
type Alteracao = { forma: string; valor: string | null }

beforeAll(async () => {
  c = await montarCenario('avisos')
  const p = await c.migrate.query<{ id: string }>(
    `SELECT id FROM procedimentos WHERE clinica_id = $1 AND nome_chave = 'tirzepatida'`,
    [c.clinica],
  )
  tirze = p.rows[0]!.id
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparFinanceiro(c)
  await limparProgramas(c)
  await c.migrate.query(`UPDATE clinicas SET fuso = 'America/Bahia' WHERE id = $1`, [c.clinica])
})

/* ----------------------------------------------------------------- ajudas */

const avulso = (x: Corpo = {}, quem = 'beatriz') =>
  postar(
    c,
    '/v1/recebimentos',
    {
      requisicaoId: randomUUID(),
      pacienteId: c.pacientes['ana'],
      valor: '45000',
      forma: 'Pix',
      em: HOJE,
      ref: 'consulta',
      ...x,
    },
    quem,
  )

/** Fecha o caixa de um dia pela rota de verdade, com o contado informado. */
const fecharCaixa = async (dia: string, contado: Record<string, string> = {}) => {
  const r = await postar(
    c,
    '/v1/caixa',
    { dia, obs: '', contado: Object.entries(contado).map(([forma, valor]) => ({ forma, valor })) },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r
}

/** Um caixa fechado escrito DIRETO — para dias que a rota não deixa fechar (o futuro). */
const caixaFechadoNoBanco = async (dia: string): Promise<void> => {
  await c.migrate.query(
    `INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1,$2,'',$3)`,
    [c.clinica, dia, c.pessoas['beatriz']],
  )
}

/** Um recebimento num INSTANTE escolhido, escrito direto no banco. */
const recebimentoEm = async (
  instante: string,
  valor: string,
  x: { forma?: string; paciente?: string; aberto?: string } = {},
): Promise<string> => {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
     VALUES ($1,$2,'Pagamento de consulta',$3,$4,$5,$6::timestamptz,$7) RETURNING id`,
    [
      c.clinica,
      c.pacientes[x.paciente ?? 'ana'],
      valor,
      x.forma ?? 'Pix',
      x.aberto ?? '0',
      instante,
      c.pessoas['beatriz'],
    ],
  )
  return r.rows[0]!.id
}

const caixaDe = (dia: string, quem = 'beatriz') => pegar(c, '/v1/caixa', { dia }, quem)

const alteracaoDe = (corpo: { alteracoesDepoisDoFechamento: Alteracao[] }, forma: string) =>
  corpo.alteracoesDepoisDoFechamento.find((a) => a.forma === forma)!.valor

const contarRecebimentos = async (): Promise<number> => {
  const r = await c.migrate.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM recebimentos WHERE clinica_id = $1',
    [c.clinica],
  )
  return Number(r.rows[0]!.n)
}

const contarTarefas = async (): Promise<number> => {
  const r = await c.migrate.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM tarefas WHERE clinica_id = $1',
    [c.clinica],
  )
  return Number(r.rows[0]!.n)
}

/** O corpo exato do 409 — sem número nenhum. */
const esperar409 = (r: { statusCode: number; body: Corpo; text: string }, avisos: string[]) => {
  expect(r.statusCode, r.text).toBe(409)
  expect(r.body.codigo).toBe('CONFIRMACAO_NECESSARIA')
  expect(r.body.avisos).toEqual(avisos)
  expect(Object.keys(r.body).sort()).toEqual(['avisos', 'codigo', 'message', 'statusCode'])
}

/** Uma consulta agendada para HOJE, aberta, sem dinheiro. */
const consultaAberta = async (): Promise<string> => {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['beatriz'],
      quando: { modo: 'agendada', prazo: HOJE },
    },
    'beatriz',
  )
  expect(r.statusCode, r.text).toBe(201)
  return r.body.tarefa.id as string
}

const retroativa = (pagamento: Corpo, extra: Corpo = {}, em = ONTEM) =>
  postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['beatriz'],
      quando: { modo: 'retroativo', em, pagamento },
      ...extra,
    },
    'beatriz',
  )

const montar = (extra: Corpo = {}) =>
  postar(
    c,
    '/v1/programas',
    {
      pacienteId: c.pacientes['ana'],
      inicio: HOJE,
      itens: [{ chave: 'i1', procedimentoId: tirze, sessoes: 2, intervaloDias: 7 }],
      ...extra,
    },
    'beatriz',
  )

/** Um orçamento registrado num cartão realizado — pronto para "Fechou". */
const orcado = async (): Promise<string> => {
  const t = await postar(
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
  expect(t.statusCode, t.text).toBe(201)
  const id = t.body.tarefa.id as string
  const o = await postar(c, `/v1/tarefas/${id}/jornada`, { acao: 'registrarOrcamento', valor: '360000' }, 'beatriz')
  expect(o.statusCode, o.text).toBe(200)
  return id
}

/* ======================================================= RETROATIVO, 6 PORTAS */

describe('CAIXA_FECHADO — retroativo em cada caminho que grava recebimento', () => {
  it('avulso para um dia de caixa fechado: 409; confirmado, grava', async () => {
    await fecharCaixa(ONTEM)
    const requisicaoId = randomUUID()
    esperar409(await avulso({ em: ONTEM, requisicaoId }), ['CAIXA_FECHADO'])
    expect(await contarRecebimentos()).toBe(0)

    const r = await avulso({ em: ONTEM, requisicaoId, confirmarCaixaFechado: true })
    expect(r.statusCode, r.text).toBe(201)
    expect(r.body.em).toBe(ONTEM)
  })

  it('criar tarefa JÁ CONCLUÍDA com pagamento num dia fechado: 409 sem tarefa; confirmado, grava', async () => {
    await fecharCaixa(ONTEM)
    const pag = { valor: '30000', forma: 'Dinheiro' }
    esperar409(await retroativa(pag), ['CAIXA_FECHADO'])
    // A transação inteira volta: nem o recebimento, nem a tarefa.
    expect(await contarTarefas()).toBe(0)
    expect(await contarRecebimentos()).toBe(0)

    const r = await retroativa(pag, { confirmarCaixaFechado: true })
    expect(r.statusCode, r.text).toBe(201)
    expect(await contarRecebimentos()).toBe(1)
  })

  it('concluir tarefa com pagamento em data retroativa de caixa fechado: 409, a tarefa segue aberta', async () => {
    const id = await consultaAberta()
    await fecharCaixa(ONTEM)
    const corpo = { em: ONTEM, pagamento: { valor: '20000', forma: 'Pix' } }
    esperar409(await postar(c, `/v1/tarefas/${id}/concluir`, corpo, 'beatriz'), ['CAIXA_FECHADO'])
    const crua = await c.migrate.query<{ status: string }>('SELECT status FROM tarefas WHERE id = $1', [id])
    expect(crua.rows[0]!.status).toBe('aberta')
    expect(await contarRecebimentos()).toBe(0)

    const r = await postar(c, `/v1/tarefas/${id}/concluir`, { ...corpo, confirmarCaixaFechado: true }, 'beatriz')
    expect(r.statusCode, r.text).toBe(200)
    expect(await contarRecebimentos()).toBe(1)
  })

  it('concluir SESSÃO com pagamento em data retroativa de caixa fechado: 409; confirmado, grava', async () => {
    const m = await montar()
    expect(m.statusCode, m.text).toBe(201)
    const s = await c.migrate.query<{ id: string }>(
      `SELECT id FROM tarefas WHERE programa_id = $1 AND tipo = 'Sessão de plano' ORDER BY sessao_indice LIMIT 1`,
      [m.body.id],
    )
    const sessao = s.rows[0]!.id
    await fecharCaixa(ONTEM)
    const corpo = { em: ONTEM, reprogramar: false, pagamento: { valor: '30000', forma: 'Pix' } }
    esperar409(await postar(c, `/v1/programas/sessoes/${sessao}/concluir`, corpo, 'beatriz'), [
      'CAIXA_FECHADO',
    ])
    expect(await contarRecebimentos()).toBe(0)

    const r = await postar(
      c,
      `/v1/programas/sessoes/${sessao}/concluir`,
      { ...corpo, confirmarCaixaFechado: true },
      'beatriz',
    )
    expect(r.statusCode, r.text).toBe(200)
    expect(await contarRecebimentos()).toBe(1)
  })

  it('FECHAR na jornada com o caixa de hoje já fechado: 409; confirmado, grava', async () => {
    const id = await orcado()
    await fecharCaixa(HOJE)
    const corpo = { acao: 'fechar', recebimento: { valor: '100000', forma: 'Pix', valorAberto: '260000' } }
    esperar409(await postar(c, `/v1/tarefas/${id}/jornada`, corpo, 'beatriz'), ['CAIXA_FECHADO'])
    const crua = await c.migrate.query<{ etapa: string }>('SELECT etapa::text AS etapa FROM tarefas WHERE id = $1', [id])
    expect(crua.rows[0]!.etapa).toBe('orcamento')

    const r = await postar(c, `/v1/tarefas/${id}/jornada`, { ...corpo, confirmarCaixaFechado: true }, 'beatriz')
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.tarefa.etapa).toBe('fechado')
  })

  it('MONTAR programa com entrada, caixa de hoje fechado: 409 sem programa; confirmado, grava', async () => {
    await fecharCaixa(HOJE)
    const pagamento = { valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' }
    esperar409(await montar({ pagamento }), ['CAIXA_FECHADO'])
    const n = await c.migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM programas WHERE clinica_id = $1',
      [c.clinica],
    )
    expect(n.rows[0]!.n).toBe('0')

    const r = await montar({ pagamento, confirmarCaixaFechado: true })
    expect(r.statusCode, r.text).toBe(201)
  })

  it('montar programa SEM entrada (venda a prazo, valor 0) num dia fechado: nenhum aviso', async () => {
    await fecharCaixa(HOJE)
    const r = await montar({ pagamento: { valorTotal: '360000', valorEntrada: '0' } })
    expect(r.statusCode, r.text).toBe(201)
  })

  it('nota promissória num dia fechado: sem aviso, e o dia NÃO fica marcado', async () => {
    await fecharCaixa(HOJE)
    const r = await avulso({ forma: 'Nota promissória', valor: '120000' })
    expect(r.statusCode, r.text).toBe(201)
    const dia = await caixaDe(HOJE)
    expect(dia.body.mudouDepoisDoFechamento).toBe(false)
    expect((dia.body.alteracoesDepoisDoFechamento as Alteracao[]).every((a) => a.valor === '0')).toBe(true)
  })

  it('o 409 para quem NÃO tem `valores` é o mesmo — e o corpo não tem número nenhum', async () => {
    await fecharCaixa(HOJE)
    const r = await avulso({ valor: '45678' }, 'rita')
    esperar409(r, ['CAIXA_FECHADO'])
    // Fora o próprio `statusCode`, nenhum algarismo no corpo.
    const { statusCode: _, ...resto } = r.body as Corpo
    expect(JSON.stringify(resto)).not.toMatch(/\d/)
  })
})

/* ============================================================= BORDA DE FUSO */

describe('a janela do dia é a da CLÍNICA, semiaberta', () => {
  it('America/Bahia: hoje 23h → o caixa de 25/10 (dia UTC) fechado NÃO avisa; o de 24/10 avisa', async () => {
    // Um `::date` sobre UTC diria que agora é 25/10 e avisaria.
    await caixaFechadoNoBanco('2026-10-25')
    expect((await avulso()).statusCode).toBe(201)
    await caixaFechadoNoBanco(HOJE)
    esperar409(await avulso({ valor: '1' }), ['CAIXA_FECHADO'])
  })

  it('America/Bahia: duplicidade com 00h00 de hoje conta; 23h59m59,999 de ontem e 00h00 de amanhã não', async () => {
    await recebimentoEm('2026-10-23T23:59:59.999-03:00', '45000')
    await recebimentoEm('2026-10-25T00:00:00.000-03:00', '45000')
    expect((await avulso()).statusCode).toBe(201)

    await limparProgramas(c)
    await recebimentoEm('2026-10-24T00:00:00.000-03:00', '45000')
    esperar409(await avulso(), ['POSSIVEL_DUPLICIDADE'])
  })

  it('America/Noronha (UTC−2): agora é 00h00 de 25/10 — o dia da clínica já virou', async () => {
    await c.migrate.query(`UPDATE clinicas SET fuso = 'America/Noronha' WHERE id = $1`, [c.clinica])
    const AMANHA = '2026-10-25'
    // 23h59m59,999 de 24/10 em Noronha: OUTRO dia, não é duplicidade.
    await recebimentoEm('2026-10-24T23:59:59.999-02:00', '45000')
    // O caixa de 24/10 fechado não diz respeito a um recebimento de 25/10.
    await caixaFechadoNoBanco(HOJE)
    const r = await avulso({ em: AMANHA })
    expect(r.statusCode, r.text).toBe(201)

    // 00h00 de 25/10 em Noronha: o MESMO dia. Agora avisa.
    await caixaFechadoNoBanco(AMANHA)
    esperar409(await avulso({ em: AMANHA }), ['CAIXA_FECHADO', 'POSSIVEL_DUPLICIDADE'])
  })
})

/* ============================================================== DUPLICIDADE */

describe('POSSIVEL_DUPLICIDADE', () => {
  it('mesma paciente, mesmo dia, mesmo valor: 409; confirmado, grava um segundo', async () => {
    expect((await avulso({ valor: '15000' })).statusCode).toBe(201)
    esperar409(await avulso({ valor: '15000' }), ['POSSIVEL_DUPLICIDADE'])
    const r = await avulso({ valor: '15000', confirmarDuplicidade: true })
    expect(r.statusCode, r.text).toBe(201)
    expect(await contarRecebimentos()).toBe(2)
  })

  it('a forma não desfaz o aviso — Pix e Dinheiro do mesmo valor ainda é suspeito', async () => {
    await avulso({ valor: '15000', forma: 'Pix' })
    esperar409(await avulso({ valor: '15000', forma: 'Dinheiro' }), ['POSSIVEL_DUPLICIDADE'])
  })

  it('a nota promissória conta como o pagamento já registrado', async () => {
    await avulso({ valor: '30000', forma: 'Nota promissória' })
    esperar409(await avulso({ valor: '30000', forma: 'Pix' }), ['POSSIVEL_DUPLICIDADE'])
  })

  it('1 centavo diferente, outro dia ou outra paciente: grava sem aviso', async () => {
    await avulso({ valor: '15000' })
    expect((await avulso({ valor: '15001' })).statusCode).toBe(201)
    expect((await avulso({ valor: '15000', em: ONTEM })).statusCode).toBe(201)
    expect((await avulso({ valor: '15000', pacienteId: c.pacientes['bruna'] })).statusCode).toBe(201)
  })

  it('o pagamento EMBUTIDO conta: avulso igual ao do atendimento concluído avisa', async () => {
    const id = await consultaAberta()
    const ok = await postar(
      c,
      `/v1/tarefas/${id}/concluir`,
      { em: HOJE, pagamento: { valor: '20000', forma: 'Pix' } },
      'beatriz',
    )
    expect(ok.statusCode, ok.text).toBe(200)
    esperar409(await avulso({ valor: '20000' }), ['POSSIVEL_DUPLICIDADE'])
  })

  it('estornado não conta', async () => {
    const r = await avulso({ valor: '15000' })
    expect((await apagar(c, `/v1/recebimentos/${r.body.id}`, {}, 'beatriz')).statusCode).toBe(204)
    expect((await avulso({ valor: '15000' })).statusCode).toBe(201)
  })

  it('recebimento de tarefa EXCLUÍDA não conta', async () => {
    const r = await avulso({ valor: '15000' })
    await c.migrate.query('UPDATE tarefas SET excluida_em = now() WHERE id = $1', [r.body.tarefaId])
    expect((await avulso({ valor: '15000' })).statusCode).toBe(201)
  })

  it('valor 0 (venda a prazo) nunca é o "pagamento já registrado"', async () => {
    await c.migrate.query(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
       VALUES ($1,$2,'Pagamento de orçamento',0,'',50000,now(),$3)`,
      [c.clinica, c.pacientes['ana'], c.pessoas['beatriz']],
    )
    expect((await avulso({ valor: '50000' })).statusCode).toBe(201)
  })

  it('reenvio do MESMO `requisicaoId` devolve a linha existente — nunca 409 sobre ela mesma', async () => {
    const requisicaoId = randomUUID()
    const a = await avulso({ valor: '15000', requisicaoId })
    const b = await avulso({ valor: '15000', requisicaoId })
    expect(b.statusCode, b.text).toBe(201)
    expect(b.body.id).toBe(a.body.id)
    expect(await contarRecebimentos()).toBe(1)
  })

  it('os dois avisos juntos; cada confirmação apaga só o seu', async () => {
    await avulso({ valor: '15000' })
    await fecharCaixa(HOJE, { Pix: '15000' })
    esperar409(await avulso({ valor: '15000' }), ['CAIXA_FECHADO', 'POSSIVEL_DUPLICIDADE'])
    esperar409(await avulso({ valor: '15000', confirmarCaixaFechado: true }), ['POSSIVEL_DUPLICIDADE'])
    esperar409(await avulso({ valor: '15000', confirmarDuplicidade: true }), ['CAIXA_FECHADO'])
    const r = await avulso({ valor: '15000', confirmarCaixaFechado: true, confirmarDuplicidade: true })
    expect(r.statusCode, r.text).toBe(201)
  })

  it('o contrato recusa `false` explícito como confirmação', async () => {
    expect((await avulso({ confirmarDuplicidade: false })).statusCode).toBe(400)
  })
})

/* ================================================ MUDOU DEPOIS DO FECHAMENTO */

describe('"mudou depois do fechamento" na leitura do caixa', () => {
  it('sem nada depois: false, e as quatro alterações são zero', async () => {
    await avulso({ valor: '10000' })
    await fecharCaixa(HOJE, { Pix: '10000' })
    const r = await caixaDe(HOJE)
    expect(r.body.mudouDepoisDoFechamento).toBe(false)
    expect(r.body.alteracoesDepoisDoFechamento).toEqual([
      { forma: 'Pix', valor: '0' },
      { forma: 'Dinheiro', valor: '0' },
      { forma: 'Cartão de crédito', valor: '0' },
      { forma: 'Cartão de débito', valor: '0' },
    ])
    const lista = await pegar(c, '/v1/caixa/ultimos', {}, 'beatriz')
    expect(lista.body.itens[0].mudouDepoisDoFechamento).toBe(false)
  })

  it('números à mão: fecha Pix 100,00; lança 50,00 Pix confirmado → Pix +50,00, demais 0; o guardado fica', async () => {
    await avulso({ valor: '10000', forma: 'Pix' })
    await fecharCaixa(HOJE, { Pix: '10000' })
    const r = await avulso({ valor: '5000', forma: 'Pix', confirmarCaixaFechado: true })
    expect(r.statusCode, r.text).toBe(201)

    const dia = await caixaDe(HOJE)
    expect(dia.body.mudouDepoisDoFechamento).toBe(true)
    expect(alteracaoDe(dia.body, 'Pix')).toBe('5000')
    expect(alteracaoDe(dia.body, 'Dinheiro')).toBe('0')
    expect(alteracaoDe(dia.body, 'Cartão de crédito')).toBe('0')
    expect(alteracaoDe(dia.body, 'Cartão de débito')).toBe('0')
    // O fechamento guardado NÃO é recalculado.
    const pix = (dia.body.porForma as { forma: string; esperado: string; contado: string }[]).find(
      (l) => l.forma === 'Pix',
    )!
    expect(pix.esperado).toBe('10000')
    expect(pix.contado).toBe('10000')
    expect(dia.body.conferido).toBe(true)
    const banco = await c.migrate.query<{ esperado: string }>(
      `SELECT f.esperado::text AS esperado FROM caixa_por_forma f
         JOIN caixas_do_dia cx ON cx.id = f.caixa_id
        WHERE cx.clinica_id = $1 AND f.forma = 'Pix'`,
      [c.clinica],
    )
    expect(banco.rows[0]!.esperado).toBe('10000')

    const lista = await pegar(c, '/v1/caixa/ultimos', {}, 'beatriz')
    expect(lista.body.itens[0].mudouDepoisDoFechamento).toBe(true)
  })

  it('sem `valores`: a marca atravessa, o valor da alteração vem null', async () => {
    await fecharCaixa(HOJE)
    await avulso({ valor: '5000', forma: 'Pix', confirmarCaixaFechado: true })
    const dia = await caixaDe(HOJE, 'sonia')
    expect(dia.statusCode).toBe(200)
    expect(dia.body.mudouDepoisDoFechamento).toBe(true)
    expect((dia.body.alteracoesDepoisDoFechamento as Alteracao[]).every((a) => a.valor === null)).toBe(true)
    expect(dia.text).not.toContain('5000')
    const lista = await pegar(c, '/v1/caixa/ultimos', {}, 'sonia')
    expect(lista.body.itens[0].mudouDepoisDoFechamento).toBe(true)
  })

  it('estorno depois do fechamento: −X, e a marca acende', async () => {
    const r = await avulso({ valor: '10000', forma: 'Dinheiro' })
    await fecharCaixa(HOJE, { Dinheiro: '10000' })
    expect((await apagar(c, `/v1/recebimentos/${r.body.id}`, {}, 'beatriz')).statusCode).toBe(204)
    const dia = await caixaDe(HOJE)
    expect(dia.body.mudouDepoisDoFechamento).toBe(true)
    expect(alteracaoDe(dia.body, 'Dinheiro')).toBe('-10000')
    expect(alteracaoDe(dia.body, 'Pix')).toBe('0')
  })

  it('o caso que se ANULA: estorno de 100 + novo de 100 → diferença 0, marca acesa', async () => {
    const r = await avulso({ valor: '10000', forma: 'Pix' })
    await fecharCaixa(HOJE, { Pix: '10000' })
    await apagar(c, `/v1/recebimentos/${r.body.id}`, {}, 'beatriz')
    // O estornado não conta como duplicidade; só o caixa fechado avisa.
    const novo = await avulso({ valor: '10000', forma: 'Pix', confirmarCaixaFechado: true })
    expect(novo.statusCode, novo.text).toBe(201)
    const dia = await caixaDe(HOJE)
    expect(alteracaoDe(dia.body, 'Pix')).toBe('0')
    expect(dia.body.mudouDepoisDoFechamento).toBe(true)
  })

  it('tarefa excluída depois do fechamento acende a marca', async () => {
    const r = await avulso({ valor: '10000', forma: 'Pix' })
    await fecharCaixa(HOJE, { Pix: '10000' })
    await c.migrate.query('UPDATE tarefas SET excluida_em = now() WHERE id = $1', [r.body.tarefaId])
    const dia = await caixaDe(HOJE)
    expect(dia.body.mudouDepoisDoFechamento).toBe(true)
    expect(alteracaoDe(dia.body, 'Pix')).toBe('-10000')
  })

  it('transporte: o dia ABERTO não tem esperado, diferenca, alterações nem a marca', async () => {
    await avulso({ valor: '10000', forma: 'Pix' })
    const r = await caixaDe(HOJE)
    expect(r.body.fechado).toBe(false)
    expect(Object.keys(r.body)).toEqual(['dia', 'fechado', 'formas', 'responsavel'])
    expect(r.text).not.toContain('10000')
    expect(r.text).not.toContain('mudouDepoisDoFechamento')
    expect(r.text).not.toContain('alteracoesDepoisDoFechamento')
  })
})
