import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AMANHA,
  apagar,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
  remendar,
} from '../tarefas/__tests__/cenario'

/**
 * **CONTAS A PAGAR — a âncora do dia 31 e os dois alcances.**
 *
 * Os dois defeitos do protótipo que esta suíte cobra, os dois medidos:
 *
 *  - a recorrência **perde a âncora**: 31/12 → 31/01 → 28/02 → **28/03**, e a
 *    conta vence dia 28 para sempre. Com a âncora, 28/02 → **31/03**;
 *  - `excluirConta` **apaga**, inclusive conta já paga, mudando o resultado do
 *    mês sem deixar rastro.
 */
let c: Cenario

type Corpo = Record<string, unknown>

const contaBase = (x: Corpo = {}): Corpo => ({
  descricao: 'Aluguel da sala',
  categoria: 'Ocupação',
  valor: '650000',
  vencimento: HOJE,
  fornecedor: '',
  responsavelId: c.pessoas['beatriz'],
  mensal: false,
  ...x,
})

const criar = (x: Corpo = {}, quem = 'beatriz') => postar(c, '/v1/contas', contaBase(x), quem)

const pagar = (id: string, x: Corpo = {}, quem = 'beatriz') =>
  postar(c, `/v1/contas/${id}/pagar`, { em: HOJE, valor: '650000', ...x }, quem)

const listar = (consulta: Record<string, string> = {}, quem = 'beatriz') =>
  pegar(c, '/v1/contas', consulta, quem)

const excluir = (id: string, quem = 'beatriz') => apagar(c, `/v1/contas/${id}`, {}, quem)

const editar = (id: string, x: Corpo = {}, quem = 'beatriz') =>
  remendar(c, `/v1/contas/${id}`, contaBase(x), quem)

const contarDaSerie = async (contaId: string): Promise<number> => {
  const r = await c.migrate.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM contas_a_pagar
      WHERE excluida_em IS NULL
        AND serie_id = (SELECT serie_id FROM contas_a_pagar WHERE id = $1)`,
    [contaId],
  )
  return Number(r.rows[0]!.n)
}

beforeAll(async () => {
  c = await montarCenario('contas')
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparFinanceiro(c)
  await limparTarefas(c)
})

describe('a recorrência mensal, com âncora', () => {
  it('a conta do dia 31 volta ao dia 31 depois do mês curto — o protótipo diz 28/03', async () => {
    const a = await criar({ vencimento: '2026-12-31', mensal: true })
    expect(a.statusCode).toBe(201)
    expect(a.body.mensal).toBe(true)

    const p1 = await pagar(a.body.id)
    expect(p1.statusCode).toBe(201)
    expect(p1.body.proxima.vencimento).toBe('2027-01-31')

    const p2 = await pagar(p1.body.proxima.id)
    expect(p2.body.proxima.vencimento).toBe('2027-02-28')

    const p3 = await pagar(p2.body.proxima.id)
    expect(p3.body.proxima.vencimento).toBe('2027-03-31')
  })

  it('a próxima herda descrição, categoria, valor e responsável', async () => {
    const a = await criar({ vencimento: '2026-12-31', mensal: true, fornecedor: 'Imobiliária X' })
    const p = await pagar(a.body.id, { valor: '700000' })
    expect(p.body.proxima.descricao).toBe('Aluguel da sala')
    expect(p.body.proxima.fornecedor).toBe('Imobiliária X')
    // O VALOR DA CONTA, não o valor PAGO: a próxima repete a cobrança, não o
    // desvio deste mês.
    expect(p.body.proxima.valor).toBe('650000')
    expect(p.body.proxima.pagoEm).toBeNull()
  })

  it('conta NÃO mensal não gera próxima', async () => {
    const a = await criar({ mensal: false })
    const p = await pagar(a.body.id)
    expect(p.body.proxima).toBeNull()
  })

  it('pagar duas vezes NÃO gera duas contas — a segunda é 409', async () => {
    const a = await criar({ vencimento: '2026-12-31', mensal: true })
    await pagar(a.body.id)
    const r = await pagar(a.body.id)
    expect(r.statusCode).toBe(409)
    expect(r.body.message).toContain('já foi paga')
    expect(await contarDaSerie(a.body.id)).toBe(2) // a paga e a próxima
  })

  it('SE A PRÓXIMA JÁ EXISTE, pagar não cria a segunda — e não estoura', async () => {
    // **Este é o teste com dentes do `ON CONFLICT`**, e ele existe porque o
    // teste das "duas abas" abaixo NÃO tem: dois `request()` em `Promise.all`
    // chegam serializados neste harness (medido no épico 2, e medido de novo
    // aqui — a mutação que remove o `ON CONFLICT` passou verde com ele).
    //
    // Aqui o caminho perdedor é forçado de forma determinística: a conta de
    // janeiro já existe quando o pagamento de dezembro tenta criá-la. É o
    // estado real depois de uma importação, ou depois da aba que ganhou a
    // corrida. Sem `ON CONFLICT`, isto é um 23505 — 500 na cara da recepção.
    const a = await criar({ vencimento: '2026-12-31', mensal: true })
    await c.migrate.query(
      `INSERT INTO contas_a_pagar
         (clinica_id, descricao, categoria, valor, vencimento, fornecedor, responsavel_id,
          unidade_id, serie_id, dia_vencimento)
       SELECT clinica_id, descricao, categoria, valor, '2027-01-31'::date, fornecedor,
              responsavel_id, unidade_id, serie_id, dia_vencimento
         FROM contas_a_pagar WHERE id = $1`,
      [a.body.id],
    )

    const p = await pagar(a.body.id)
    expect(p.statusCode).toBe(201)
    // `null`: a conta de janeiro existe, mas NÃO foi esta requisição que a
    // criou — e a resposta diz a verdade sobre o que ela fez.
    expect(p.body.proxima).toBeNull()
    expect(await contarDaSerie(a.body.id)).toBe(2)
  })

  it('duas abas pagando a mesma conta ao mesmo tempo geram UMA próxima', async () => {
    // O `if (!F.contas.some(...))` do protótipo perde esta corrida. O índice
    // `conta_da_serie_por_mes` não perde.
    //
    // **A asserção é o INVARIANTE, não a contagem de 201**, e isso custou uma
    // rodada vermelha para aprender: com a suíte inteira rodando, os dois
    // `request()` às vezes de fato se cruzam, os dois leem `pago_em IS NULL`
    // antes de qualquer `UPDATE`, e os DOIS respondem 201 — um com
    // `proxima: null`, porque o `ON CONFLICT` o fez perder. Isso é o desenho
    // funcionando, e um teste que exigisse "exatamente um 201" o chamaria de
    // defeito. O que não pode acontecer, em ordem nenhuma de chegada, é a
    // série ganhar duas contas de janeiro.
    const a = await criar({ vencimento: '2026-12-31', mensal: true })
    const r = await Promise.allSettled([pagar(a.body.id), pagar(a.body.id)])

    expect(
      r.filter((x) => x.status === 'rejected'),
      'nenhum dos dois pagamentos pode falhar por erro de transporte',
    ).toHaveLength(0)
    // A paga e a próxima — nunca três.
    expect(await contarDaSerie(a.body.id)).toBe(2)
  })

  it('a âncora não se move ao EDITAR o vencimento de uma parcela', async () => {
    // Adiar a parcela deste mês não muda o dia em que a conta repete. Sem
    // isto, um "pago com três dias de atraso" reancoraria a série inteira.
    const a = await criar({ vencimento: '2026-12-31', mensal: true })
    await editar(a.body.id, { vencimento: '2027-01-05', mensal: true })
    const p = await pagar(a.body.id, { valor: '650000' })
    expect(p.body.proxima.vencimento).toBe('2027-02-28')
  })
})

describe('pagamento', () => {
  it('o valor PAGO pode diferir do valor da conta, e é ele que fica', async () => {
    const a = await criar({ valor: '98000' })
    const p = await pagar(a.body.id, { valor: '101200' })
    expect(p.body.conta.valor).toBe('98000')
    expect(p.body.conta.valorPago).toBe('101200')
    expect(p.body.conta.pagoEm).toBe(HOJE)
  })

  it('a forma de pagamento da CONTA não é a do recebimento', async () => {
    const a = await criar()
    expect((await pagar(a.body.id, { formaPagamento: 'Boleto' })).statusCode).toBe(201)

    const b = await criar()
    const r = await pagar(b.body.id, { formaPagamento: 'Nota promissória' })
    expect(r.statusCode).toBe(400)
  })

  it('data de pagamento no FUTURO é 400 — a data de negócio é do servidor', async () => {
    const a = await criar()
    const r = await pagar(a.body.id, { em: AMANHA })
    expect(r.statusCode).toBe(400)
  })

  it('valor pago zero é 400 — pagamento de nada não é pagamento', async () => {
    const a = await criar()
    expect((await pagar(a.body.id, { valor: '0' })).statusCode).toBe(400)
  })
})

describe('os dois alcances de `contas`', () => {
  it('quem tem só `contas` vê as SUAS', async () => {
    await criar({ descricao: 'Pró-labore', responsavelId: c.pessoas['beatriz'] })
    await criar({ descricao: 'Material de limpeza', responsavelId: c.pessoas['sonia'] })

    const r = await listar({}, 'sonia')
    expect((r.body.itens as { descricao: string }[]).map((x) => x.descricao)).toEqual([
      'Material de limpeza',
    ])
  })

  it('a conta de outra pessoa é 404, NÃO 403', async () => {
    // 403 confirmaria que a conta existe — e quanto custa o pró-labore é
    // exatamente o que não se confirma a quem não pode ver.
    const a = await criar({ descricao: 'Pró-labore', valor: '1500000' })
    const r = await pagar(a.body.id, {}, 'sonia')
    expect(r.statusCode).toBe(404)
    expect(r.text).not.toContain('1500000')
  })

  it('quem tem só `contas` NÃO cadastra: 403', async () => {
    const r = await criar({}, 'sonia')
    expect(r.statusCode).toBe(403)
  })

  it('quem tem só `contas` não edita nem exclui: 403', async () => {
    const a = await criar({ responsavelId: c.pessoas['sonia'] })
    expect((await editar(a.body.id, {}, 'sonia')).statusCode).toBe(403)
    expect((await excluir(a.body.id, 'sonia')).statusCode).toBe(403)
  })

  it('quem tem só `contas` PAGA a dela', async () => {
    const a = await criar({ responsavelId: c.pessoas['sonia'] })
    expect((await pagar(a.body.id, {}, 'sonia')).statusCode).toBe(201)
  })

  it('sem `contas`, 403 em tudo', async () => {
    expect((await listar({}, 'camila')).statusCode).toBe(403)
  })

  it('sem `valores`, a lista traz descrição e vencimento, e o valor vem `null`', async () => {
    await criar({ responsavelId: c.pessoas['sonia'], valor: '123400' })
    const r = await listar({}, 'sonia')
    expect(r.body.itens[0].descricao).toBe('Aluguel da sala')
    expect(r.body.itens[0].vencimento).toBe(HOJE)
    expect(r.body.itens[0].valor).toBeNull()
    expect(r.text).not.toContain('123400')
  })
})

describe('exclusão', () => {
  it('conta PAGA não se exclui — 409, com a saída na mensagem', async () => {
    const a = await criar()
    await pagar(a.body.id)
    const r = await excluir(a.body.id)
    expect(r.statusCode).toBe(409)
    expect(r.body.message).toContain('faz parte do resultado do mês')
  })

  it('excluir é SOFT DELETE: a conta some das listas e a linha fica', async () => {
    const a = await criar()
    expect((await excluir(a.body.id)).statusCode).toBe(204)
    expect((await listar()).body.itens).toHaveLength(0)

    const cru = await c.migrate.query<{ excluida_em: Date | null }>(
      'SELECT excluida_em FROM contas_a_pagar WHERE id = $1',
      [a.body.id],
    )
    expect(cru.rowCount).toBe(1)
    expect(cru.rows[0]!.excluida_em).not.toBeNull()
  })

  it('a trilha do soft delete fica', async () => {
    const a = await criar()
    await excluir(a.body.id)
    const t = await c.migrate.query<{ acao: string }>(
      `SELECT acao FROM auditoria WHERE entidade = 'contas_a_pagar' AND entidade_id = $1`,
      [a.body.id],
    )
    expect(t.rows.map((x) => x.acao)).toContain('alterou')
  })
})

describe('cadastro e listagem', () => {
  it('categoria fora da lista do domínio é 400', async () => {
    expect((await criar({ categoria: 'Cerveja' })).statusCode).toBe(400)
  })

  it('o tipo fixa/variável vem do DOMÍNIO, não do cliente', async () => {
    const a = await criar({ categoria: 'Pessoal' })
    expect(a.body.tipo).toBe('fixa')
    const b = await criar({ categoria: 'Marketing' })
    expect(b.body.tipo).toBe('variavel')
  })

  it('`vencida` é derivada contra o hoje do SERVIDOR', async () => {
    await criar({ descricao: 'Venceu', vencimento: '2026-09-10' })
    await criar({ descricao: 'Vence hoje', vencimento: HOJE })
    const itens = (await listar()).body.itens as { descricao: string; vencida: boolean }[]
    expect(itens.find((x) => x.descricao === 'Venceu')!.vencida).toBe(true)
    expect(itens.find((x) => x.descricao === 'Vence hoje')!.vencida).toBe(false)
  })

  it('a conta paga deixa de ser `vencida`', async () => {
    const a = await criar({ vencimento: '2026-09-10' })
    const p = await pagar(a.body.id)
    expect(p.body.conta.vencida).toBe(false)
  })

  it('responsável INATIVO é 400', async () => {
    const r = await criar({ responsavelId: c.pessoas['marta'] })
    expect(r.statusCode).toBe(400)
  })

  it('a conta de OUTRA clínica não é alcançável', async () => {
    const outra = await c.migrate.query<{ id: string }>(
      `INSERT INTO contas_a_pagar (clinica_id, descricao, categoria, valor, vencimento, responsavel_id)
       SELECT $1, 'Segredo da vizinha', 'Ocupação', 999900, $2::date, id
         FROM pessoas WHERE clinica_id = $1 LIMIT 1
       RETURNING id`,
      [c.outraClinica, HOJE],
    )
    const id = outra.rows[0]!.id
    expect((await pegar(c, '/v1/contas', {}, 'beatriz')).text).not.toContain('999900')
    expect((await pagar(id)).statusCode).toBe(404)
  })

  it('"abertas" não traz as pagas; "pagas" não traz as abertas', async () => {
    const a = await criar({ descricao: 'Paga' })
    await pagar(a.body.id)
    await criar({ descricao: 'Aberta' })

    const abertas = (await listar({ situacao: 'abertas' })).body.itens as { descricao: string }[]
    expect(abertas.map((x) => x.descricao)).toEqual(['Aberta'])

    const pagas = (await listar({ situacao: 'pagas' })).body.itens as { descricao: string }[]
    expect(pagas.map((x) => x.descricao)).toEqual(['Paga'])
  })

  it('"todas" inclui as abertas VENCIDAS de meses anteriores', async () => {
    // É o que o protótipo faz, e é o que a clínica precisa ver: a conta de
    // agosto que ninguém pagou não some em outubro.
    await criar({ descricao: 'De agosto', vencimento: '2026-08-10' })
    const itens = (await listar({ situacao: 'todas' })).body.itens as { descricao: string }[]
    expect(itens.map((x) => x.descricao)).toContain('De agosto')
  })
})

describe('o bloco financeiro da tela Hoje', () => {
  it('avisa 3 dias antes, e o corte é do SERVIDOR', async () => {
    await criar({ descricao: 'Em 3 dias', vencimento: '2026-10-27', responsavelId: c.pessoas['beatriz'] })
    await criar({ descricao: 'Em 4 dias', vencimento: '2026-10-28', responsavelId: c.pessoas['beatriz'] })

    const r = await pegar(c, '/v1/hoje', {}, 'beatriz')
    const contas = r.body.financeiro.contas as { descricao: string }[]
    expect(contas.map((x) => x.descricao)).toEqual(['Em 3 dias'])
  })

  it('a conta JÁ VENCIDA continua no aviso', async () => {
    await criar({ descricao: 'Venceu', vencimento: '2026-09-01' })
    const r = await pegar(c, '/v1/hoje', {}, 'beatriz')
    const contas = r.body.financeiro.contas as { descricao: string; vencida: boolean }[]
    expect(contas).toHaveLength(1)
    expect(contas[0]!.vencida).toBe(true)
  })

  it('o aviso é das MINHAS contas, mesmo para quem tem `contas.gerir`', async () => {
    await criar({ descricao: 'Da Sonia', responsavelId: c.pessoas['sonia'] })
    const r = await pegar(c, '/v1/hoje', {}, 'beatriz')
    expect(r.body.financeiro.contas).toHaveLength(0)
  })

  it('sem `contas`, o bloco vem vazio — e sem erro', async () => {
    await criar({ descricao: 'Minha', responsavelId: c.pessoas['beatriz'] })
    const r = await pegar(c, '/v1/hoje', {}, 'juliana')
    expect(r.statusCode).toBe(200)
    expect(r.body.financeiro.contas).toEqual([])
    expect(r.body.financeiro.caixaPendente).toBe(false)
  })

  it('o caixa pendente é BOOLEANO, e nenhum número viaja junto', async () => {
    await postar(
      c,
      '/v1/recebimentos',
      {
        requisicaoId: '11111111-1111-4111-8111-111111111111',
        pacienteId: c.pacientes['ana'],
        valor: '45000',
        forma: 'Pix',
        em: HOJE,
        ref: 'consulta',
      },
      'beatriz',
    )
    const r = await pegar(c, '/v1/hoje', {}, 'beatriz')
    expect(r.body.financeiro.caixaPendente).toBe(true)
    expect(JSON.stringify(r.body.financeiro)).not.toMatch(/esperado|porForma|diferenca/)
  })

  it('fechado o caixa de hoje, o lembrete some', async () => {
    await postar(c, '/v1/caixa', { dia: HOJE, obs: '', contado: [] }, 'beatriz')
    const r = await pegar(c, '/v1/hoje', {}, 'beatriz')
    expect(r.body.financeiro.caixaPendente).toBe(false)
  })

  it('com responsável definido, o lembrete é só DELA', async () => {
    await c.migrate.query(
      `INSERT INTO configuracao_financeira (clinica_id, caixa_responsavel_id) VALUES ($1,$2)`,
      [c.clinica, c.pessoas['sonia']],
    )
    expect((await pegar(c, '/v1/hoje', {}, 'sonia')).body.financeiro.caixaPendente).toBe(true)
    // `rita` tem `receber` e NÃO tem `caixa`: lembrete de uma ação que ela não
    // pode executar é ruído que ela aprende a ignorar.
    expect((await pegar(c, '/v1/hoje', {}, 'rita')).body.financeiro.caixaPendente).toBe(false)
  })
})
