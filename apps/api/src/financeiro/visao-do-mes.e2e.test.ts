import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  botar,
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
 * **A VISÃO DO MÊS, a meta e a configuração.**
 *
 * Três coisas que esta suíte prova e que nenhuma outra prova:
 *
 *  - **a janela do mês é semiaberta, com as bordas no fuso da clínica** — e o
 *    mês anterior usa EXATAMENTE a mesma régua, porque uma comparação medida
 *    com réguas diferentes é o jeito mais discreto de um relatório mentir;
 *  - **`finmes` sem `valores` não abre nada**, e a dependência mora na tabela
 *    `PERMS`, não num `if`;
 *  - **a equipe sem `valores` lê o percentual da meta, e só ele** — sem uma
 *    linha de código decidindo isso.
 */
let c: Cenario

const MES = '2026-10'
const ANTERIOR = '2026-09'

type Corpo = Record<string, unknown>

const recebimentoEm = async (instante: string, valor: string, forma = 'Pix'): Promise<void> => {
  await c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por)
     VALUES ($1,$2,'Pagamento de consulta',$3,$4,$5::timestamptz,$6)`,
    [c.clinica, c.pacientes['ana'], valor, forma, instante, c.pessoas['beatriz']],
  )
}

const criarConta = (x: Corpo = {}, quem = 'beatriz') =>
  postar(
    c,
    '/v1/contas',
    {
      descricao: 'Conta',
      categoria: 'Ocupação',
      valor: '250000',
      vencimento: HOJE,
      fornecedor: '',
      responsavelId: c.pessoas['beatriz'],
      mensal: false,
      ...x,
    },
    quem,
  )

const pagarConta = (id: string, x: Corpo = {}) =>
  postar(c, `/v1/contas/${id}/pagar`, { em: HOJE, valor: '250000', ...x }, 'beatriz')

const visao = (mes = MES, quem = 'beatriz') => pegar(c, '/v1/visao-do-mes', { mes }, quem)

const definirMeta = (mes: string, valor: string, quem = 'beatriz') =>
  botar(c, `/v1/metas/${mes}`, { valor }, quem)

const percentual = (mes = MES, quem = 'beatriz') =>
  pegar(c, `/v1/metas/${mes}/percentual`, {}, quem)

beforeAll(async () => {
  c = await montarCenario('visao')
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparFinanceiro(c)
  await limparTarefas(c)
})

describe('a janela do mês', () => {
  it('é SEMIABERTA, com as bordas no fuso da clínica', async () => {
    await recebimentoEm('2026-09-30T23:59:59.999-03:00', '10000')
    await recebimentoEm('2026-10-01T00:00:00.000-03:00', '20000')
    await recebimentoEm('2026-10-31T23:59:59.999-03:00', '30000')
    await recebimentoEm('2026-11-01T00:00:00.000-03:00', '40000')

    const r = await visao()
    expect(r.statusCode).toBe(200)
    expect(r.body.recebido).toBe('50000')
    expect(r.body.quantidadeDeRecebimentos).toBe(2)
  })

  it('o mês anterior usa EXATAMENTE a mesma régua dos dois lados', async () => {
    await recebimentoEm('2026-09-15T10:00:00.000-03:00', '77700')
    await recebimentoEm('2026-10-15T10:00:00.000-03:00', '11100')

    const outubro = await visao(MES)
    const setembro = await visao(ANTERIOR)
    expect(outubro.body.mesAnterior.recebido).toBe(setembro.body.recebido)
    expect(outubro.body.mesAnterior.recebido).toBe('77700')
  })

  it('sem `mes`, é o mês CORRENTE do servidor', async () => {
    const r = await pegar(c, '/v1/visao-do-mes', {}, 'beatriz')
    expect(r.body.mes).toBe(MES)
  })

  it('mês mal formado é 400', async () => {
    expect((await visao('outubro')).statusCode).toBe(400)
  })
})

describe('despesas e resultado', () => {
  it('o VALOR PAGO entra no mês, não o valor da conta', async () => {
    const a = await criarConta({ valor: '98000' })
    await pagarConta(a.body.id, { valor: '101200' })
    const r = await visao()
    expect(r.body.despesasPagas).toBe('101200')
  })

  it('as categorias somam o total, e fixas + variáveis também', async () => {
    const a = await criarConta({ categoria: 'Pessoal', valor: '400000' })
    await pagarConta(a.body.id, { valor: '400000' })
    const b = await criarConta({ categoria: 'Marketing', valor: '150000' })
    await pagarConta(b.body.id, { valor: '150000' })

    const r = await visao()
    const porCat = (r.body.porCategoria as { valor: string }[]).reduce(
      (s, x) => s + BigInt(x.valor),
      0n,
    )
    expect(porCat).toBe(BigInt(r.body.despesasPagas))
    expect(BigInt(r.body.fixas) + BigInt(r.body.variaveis)).toBe(BigInt(r.body.despesasPagas))
    expect(r.body.fixas).toBe('400000')
    expect(r.body.variaveis).toBe('150000')
  })

  it('o resultado é recebido − despesas pagas, e pode ser negativo', async () => {
    await recebimentoEm('2026-10-10T10:00:00.000-03:00', '500000')
    const a = await criarConta({ valor: '800000' })
    await pagarConta(a.body.id, { valor: '800000' })

    const r = await visao()
    expect(r.body.resultadoDoMes).toBe('-300000')
  })

  it('"a pagar até o fim do mês" inclui as VENCIDAS de meses anteriores', async () => {
    await criarConta({ descricao: 'De agosto', vencimento: '2026-08-10', valor: '30000' })
    await criarConta({ descricao: 'Deste mês', vencimento: '2026-10-28', valor: '20000' })
    // Novembro NÃO entra.
    await criarConta({ descricao: 'De novembro', vencimento: '2026-11-05', valor: '99900' })

    const r = await visao()
    expect(r.body.aPagar).toBe('50000')
    expect(r.body.quantidadeAPagar).toBe(2)
    expect(r.body.quantidadeVencidas).toBe(1)
  })

  it('A REGRA 6 NA VISÃO DO MÊS: `porForma` só alcança dia com caixa FECHADO', async () => {
    // O mês corrente contém o dia de hoje. Um "recebido por forma" que o
    // incluísse seria o esperado da gaveta com outra etiqueta, numa tela que
    // a gestora abre ao lado de quem vai contar.
    await recebimentoEm('2026-10-10T10:00:00.000-03:00', '45000', 'Pix')
    await recebimentoEm('2026-10-24T10:00:00.000-03:00', '12000', 'Dinheiro')

    const aberto = await visao()
    expect(aberto.body.recebido).toBe('57000') // o total do mês, inteiro
    expect(aberto.body.porForma).toEqual([]) // e NADA por forma
    expect(aberto.body.porFormaAteODia).toBeNull()
    expect(aberto.body.porFormaDiasSemCaixa).toBe(2)

    // Fechado o caixa do dia 10, aquele dia — e só ele — passa a aparecer.
    await postar(
      c,
      '/v1/caixa',
      { dia: '2026-10-10', obs: '', contado: [{ forma: 'Pix', valor: '45000' }] },
      'beatriz',
    )
    const r = await visao()
    expect(Array.isArray(r.body.porForma)).toBe(true)
    expect(r.body.porForma).toHaveLength(1)
    expect(r.body.porForma[0]).toEqual({ forma: 'Pix', valor: '45000' })
    expect(r.body.porFormaAteODia).toBe('2026-10-10')
    expect(r.body.porFormaDiasSemCaixa).toBe(1)
    // O total do mês não muda: a regra 6 recorta o agregado POR FORMA, e não
    // a receita do mês.
    expect(r.body.recebido).toBe('57000')
  })

  it('o saldo a receber dos pacientes é a MESMA função da tela Cobranças', async () => {
    await postar(
      c,
      '/v1/recebimentos',
      {
        requisicaoId: randomUUID(),
        pacienteId: c.pacientes['ana'],
        valor: '100000',
        valorAberto: '200000',
        forma: 'Pix',
        em: HOJE,
        ref: 'novo',
      },
      'beatriz',
    )
    const r = await visao()
    const cob = await pegar(c, '/v1/cobrancas', {}, 'beatriz')
    expect(r.body.aReceber).toBe('200000')
    expect(r.body.aReceber).toBe(cob.body.aReceber)
  })

  it('a Visão do mês conta os caixas fechados e as diferenças', async () => {
    await recebimentoEm('2026-10-24T10:00:00.000-03:00', '45000', 'Pix')
    await postar(
      c,
      '/v1/caixa',
      { dia: HOJE, obs: '', contado: [{ forma: 'Pix', valor: '40000' }] },
      'beatriz',
    )
    const r = await visao()
    expect(r.body.caixa.fechados).toBe(1)
    expect(r.body.caixa.comDiferenca).toBe(1)
    expect(r.body.caixa.diferenca).toBe('-5000')
    // Conferido à mão: 1/10/2026 é quinta. Úteis até 24/10 (sábado, que não
    // conta) = 1 e 2, mais 5–9, 12–16 e 19–23 = **17**. É o denominador do
    // "N de M dias úteis fechados", e ele é do SERVIDOR.
    expect(r.body.caixa.diasUteis).toBe(17)
  })

  it('ORÇAMENTO NÃO É RECEITA: a receita soma `recebimentos`, nunca `tarefas`', async () => {
    await postar(
      c,
      '/v1/tarefas',
      {
        descricao: 'Orçamento enviado para Ana',
        tipo: 'Orçamento enviado',
        prazo: HOJE,
        responsavelId: c.pessoas['beatriz'],
        pacienteId: c.pacientes['ana'],
        prioridade: 'normal',
      },
      'beatriz',
    )
    const r = await visao()
    expect(r.body.recebido).toBe('0')
  })
})

describe('a meta', () => {
  it('a equipe sem `valores` lê o PERCENTUAL, e só ele', async () => {
    await definirMeta(MES, '1200000')
    await recebimentoEm('2026-10-24T10:00:00.000-03:00', '792000')

    const r = await percentual(MES, 'rita')
    expect(r.statusCode).toBe(200)
    expect(r.body.percentual).toBe(66)
    expect(r.body.meta).toBeNull()
    expect(r.body.recebido).toBeNull()
    expect(r.text).not.toContain('1200000')
    expect(r.text).not.toContain('792000')
  })

  it('quem tem `valores` lê os três', async () => {
    await definirMeta(MES, '1200000')
    await recebimentoEm('2026-10-24T10:00:00.000-03:00', '792000')
    const r = await percentual(MES, 'beatriz')
    expect(r.body).toEqual({
      mes: MES,
      meta: '1200000',
      recebido: '792000',
      percentual: 66,
    })
  })

  it('meta ZERO remove a meta — e sem meta não há percentual', async () => {
    await definirMeta(MES, '1200000')
    expect((await percentual()).body.meta).toBe('1200000')

    await definirMeta(MES, '0')
    const r = await percentual()
    expect(r.body.meta).toBeNull()
    expect(r.body.percentual).toBeNull()
  })

  it('`PUT` é idempotente: gravar duas vezes deixa UMA linha', async () => {
    await definirMeta(MES, '1000000')
    await definirMeta(MES, '1500000')
    const n = await c.migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM metas_do_mes WHERE clinica_id = $1',
      [c.clinica],
    )
    expect(Number(n.rows[0]!.n)).toBe(1)
    expect((await percentual()).body.meta).toBe('1500000')
  })

  it('definir meta sem `finmes` é 403 — e `rita` tem `receber`', async () => {
    expect((await definirMeta(MES, '100', 'rita')).statusCode).toBe(403)
  })

  it('a meta de OUTRA clínica não é alcançável', async () => {
    await c.migrate.query(
      `INSERT INTO metas_do_mes (clinica_id, competencia, valor, definida_por)
       SELECT $1, '2026-10-01'::date, 9999900, id FROM pessoas WHERE clinica_id = $1 LIMIT 1`,
      [c.outraClinica],
    )
    const r = await percentual()
    expect(r.body.meta).toBeNull()
    expect(r.text).not.toContain('9999900')
  })
})

describe('`finmes` depende de `valores`, e a dependência mora na TABELA', () => {
  it('um perfil com `finmes` e SEM `valores` NÃO abre a Visão do mês', async () => {
    // É a prova de que a dependência está em `PERMS` e é resolvida por
    // `temPerm` — a mesma função do servidor e da tela. Se alguém "consertar"
    // a tabela um dia, este teste fica vermelho.
    await c.migrate.query(
      `UPDATE perfis SET perms = ARRAY['pacientes','finmes'] WHERE clinica_id = $1 AND chave = 'pf_bal'`,
      [c.clinica],
    )
    try {
      expect((await visao(MES, 'rita')).statusCode).toBe(403)
    } finally {
      await c.migrate.query(
        `UPDATE perfis SET perms = ARRAY['pacientes','receber'] WHERE clinica_id = $1 AND chave = 'pf_bal'`,
        [c.clinica],
      )
    }
  })

  it('sem `finmes`, a Visão do mês é 403 mesmo com `valores`', async () => {
    expect((await visao(MES, 'camila')).statusCode).toBe(403)
  })
})

describe('configuração financeira', () => {
  it('grava e relê o responsável pelo caixa e a mensagem', async () => {
    const r = await remendar(
      c,
      '/v1/configuracoes/financeiro',
      { caixaResponsavelId: c.pessoas['sonia'], mensagemDeCobranca: 'Oi {nome}, passa aqui.' },
      'beatriz',
    )
    expect(r.statusCode).toBe(200)
    const lido = await pegar(c, '/v1/configuracoes/financeiro', {}, 'beatriz')
    expect(lido.body.caixaResponsavelId).toBe(c.pessoas['sonia'])
    expect(lido.body.mensagemDeCobranca).toBe('Oi {nome}, passa aqui.')
  })

  it('a mensagem configurada é a que a cobrança usa', async () => {
    await remendar(
      c,
      '/v1/configuracoes/financeiro',
      { caixaResponsavelId: null, mensagemDeCobranca: '{nome}, passa aqui. — {eu}' },
      'beatriz',
    )
    const m = await pegar(c, `/v1/cobrancas/${c.pacientes['ana']}/mensagem`, {}, 'sonia')
    expect(m.body.texto).toBe('Ana, passa aqui. — Sonia')
  })

  it('o responsável pelo caixa precisa estar ATIVO', async () => {
    const r = await remendar(
      c,
      '/v1/configuracoes/financeiro',
      { caixaResponsavelId: c.pessoas['marta'], mensagemDeCobranca: '' },
      'beatriz',
    )
    expect(r.statusCode).toBe(400)
  })

  it('sem `finmes`, 403', async () => {
    expect((await pegar(c, '/v1/configuracoes/financeiro', {}, 'sonia')).statusCode).toBe(403)
  })
})

describe('a rotina mensal de fechamento', () => {
  it('nasce UMA vez, mesmo com dois toques', async () => {
    const a = await postar(c, '/v1/visao-do-mes/rotina', {}, 'beatriz')
    expect(a.statusCode).toBe(201)
    expect(a.body.criadas).toBe(12)
    expect(a.body.deInicio).toBe('2026-11-01')

    const b = await postar(c, '/v1/visao-do-mes/rotina', {}, 'beatriz')
    expect(b.body.criadas).toBe(0)

    const n = await c.migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tarefas
        WHERE clinica_id = $1 AND marcador = 'fechamento-do-mes' AND excluida_em IS NULL`,
      [c.clinica],
    )
    expect(Number(n.rows[0]!.n)).toBe(12)
  })

  it('sem `finmes`, 403', async () => {
    expect((await postar(c, '/v1/visao-do-mes/rotina', {}, 'sonia')).statusCode).toBe(403)
  })
})
