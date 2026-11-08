import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { apagarPagamentosDesfeitosDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import {
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
 * **DESFAZER PAGAMENTO DE CONTA** (D-21, item 4; ajustes 9, 10 e 11 do gate).
 *
 * O que esta suíte cobra, contra Postgres real:
 *  - a conta volta para aberta e o pagamento desfeito fica, inteiro e com o
 *    motivo, numa tabela que o BANCO recusa alterar;
 *  - a Visão do mês e o "Pago por forma" caem EXATAMENTE o `valor_pago`;
 *  - desfazer e refazer o Paguei não dá à série uma segunda conta à frente —
 *    nem depois de adiar o vencimento, nem depois de excluir a seguinte;
 *  - duas abas desfazendo ao mesmo tempo gravam UMA linha.
 *
 * Relógio do cenário: hoje é 24/10/2026 em `America/Bahia`.
 */
let c: Cenario

type Corpo = Record<string, unknown>

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP =
  process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'

const contaBase = (x: Corpo = {}): Corpo => ({
  descricao: 'Aluguel da sala',
  categoria: 'Ocupação',
  valor: '650000',
  vencimento: '2026-10-10',
  fornecedor: '',
  responsavelId: c.pessoas['beatriz'],
  mensal: false,
  ...x,
})

const criar = async (x: Corpo = {}): Promise<string> => {
  const r = await postar(c, '/v1/contas', contaBase(x), 'beatriz')
  expect(r.statusCode).toBe(201)
  return r.body.id as string
}

const pagar = (id: string, x: Corpo = {}) =>
  postar(c, `/v1/contas/${id}/pagar`, { em: HOJE, valor: '101200', formaPagamento: 'Pix', ...x }, 'beatriz')

const desfazer = (id: string, x: Corpo = {}, quem = 'beatriz') =>
  postar(c, `/v1/contas/${id}/desfazer-pagamento`, { motivo: 'Valor digitado errado', ...x }, quem)

const desfeitosDe = async (contaId: string) =>
  (
    await c.migrate.query<{
      pago_em: string
      valor_pago: string
      forma_pagamento: string
      pago_por: string | null
      categoria: string
      vencimento: string
      motivo: string
      desfeito_por: string
    }>(
      `SELECT pago_em::text AS pago_em, valor_pago::text AS valor_pago, forma_pagamento, pago_por,
              categoria, vencimento::text AS vencimento, motivo, desfeito_por
         FROM pagamentos_de_conta_desfeitos WHERE conta_id = $1`,
      [contaId],
    )
  ).rows

/** Contas da série, VIVAS e excluídas. */
const daSerie = async (contaId: string) =>
  (
    await c.migrate.query<{ vencimento: string; excluida: boolean }>(
      `SELECT vencimento::text AS vencimento, excluida_em IS NOT NULL AS excluida
         FROM contas_a_pagar
        WHERE serie_id = (SELECT serie_id FROM contas_a_pagar WHERE id = $1)
        ORDER BY vencimento`,
      [contaId],
    )
  ).rows

const visao = async () => {
  const r = await pegar(c, '/v1/visao-do-mes', { mes: '2026-10' }, 'beatriz')
  expect(r.statusCode).toBe(200)
  return r.body as {
    despesasPagas: string
    quantidadeDePagas: number
    pagoPorForma: { forma: string; valor: string }[]
  }
}

const formaNa = (v: { pagoPorForma: { forma: string; valor: string }[] }, forma: string): bigint =>
  BigInt(v.pagoPorForma.find((x) => x.forma === forma)?.valor ?? '0')

beforeAll(async () => {
  c = await montarCenario('contas-desfazer')
}, 60_000)

afterAll(async () => {
  for (const id of [c.clinica, c.outraClinica]) await apagarPagamentosDesfeitosDeTeste(c.migrate, id)
  await desmontarCenario(c)
})

beforeEach(async () => {
  // ANTES de `limparFinanceiro`: a linha append-only aponta para a conta.
  for (const id of [c.clinica, c.outraClinica]) await apagarPagamentosDesfeitosDeTeste(c.migrate, id)
  await limparFinanceiro(c)
  await limparTarefas(c)
})

describe('desfazer o Paguei', () => {
  it('a conta volta para ABERTA e o pagamento fica inteiro na tabela append-only', async () => {
    const id = await criar({ categoria: 'Marketing', vencimento: '2026-10-15' })
    expect((await pagar(id, { formaPagamento: 'Boleto' })).statusCode).toBe(201)

    const r = await desfazer(id, { motivo: '  Paguei a conta errada  ' })
    expect(r.statusCode).toBe(201)
    expect(r.body).toMatchObject({
      id,
      pagoEm: null,
      valorPago: null,
      formaPagamento: '',
      pagoPor: null,
      valor: '650000',
    })

    const linhas = await desfeitosDe(id)
    expect(linhas).toEqual([
      {
        pago_em: HOJE,
        valor_pago: '101200',
        forma_pagamento: 'Boleto',
        pago_por: c.pessoas['beatriz'],
        categoria: 'Marketing',
        vencimento: '2026-10-15',
        motivo: 'Paguei a conta errada',
        desfeito_por: c.pessoas['beatriz'],
      },
    ])

    // A trilha também registra o de → para, nas duas tabelas.
    const trilha = await c.migrate.query<{ entidade: string; acao: string }>(
      `SELECT entidade, acao FROM auditoria
        WHERE clinica_id = $1 AND entidade IN ('contas_a_pagar', 'pagamentos_de_conta_desfeitos')
          AND (entidade_id = $2 OR entidade = 'pagamentos_de_conta_desfeitos')`,
      [c.clinica, id],
    )
    expect(trilha.rows).toContainEqual({ entidade: 'pagamentos_de_conta_desfeitos', acao: 'criou' })
    expect(trilha.rows.filter((x) => x.entidade === 'contas_a_pagar' && x.acao === 'alterou').length)
      .toBeGreaterThanOrEqual(2) // o Paguei e o desfazer
  })

  it('a Visão do mês e o "Pago por forma" caem EXATAMENTE o valor pago', async () => {
    const pix = await criar({ descricao: 'Internet' })
    const boleto = await criar({ descricao: 'Contador' })
    await pagar(pix, { valor: '101200', formaPagamento: 'Pix' })
    await pagar(boleto, { valor: '50000', formaPagamento: 'Boleto' })

    const antes = await visao()
    await desfazer(pix)
    const depois = await visao()

    expect(BigInt(antes.despesasPagas) - BigInt(depois.despesasPagas)).toBe(101200n)
    expect(depois.despesasPagas).toBe('50000')
    expect(antes.quantidadeDePagas - depois.quantidadeDePagas).toBe(1)
    expect(formaNa(antes, 'Pix') - formaNa(depois, 'Pix')).toBe(101200n)
    expect(formaNa(depois, 'Boleto')).toBe(formaNa(antes, 'Boleto'))
  })

  it('depois de desfeito, paga de novo com os valores certos', async () => {
    const id = await criar()
    await pagar(id, { valor: '101200' })
    await desfazer(id)
    const p = await pagar(id, { valor: '98000', formaPagamento: 'Transferência' })
    expect(p.statusCode).toBe(201)
    expect(p.body.conta.valorPago).toBe('98000')
    expect((await visao()).despesasPagas).toBe('98000')
  })

  it('motivo com menos de 3 caracteres é 400, e nada muda', async () => {
    const id = await criar()
    await pagar(id)
    expect((await desfazer(id, { motivo: ' a ' })).statusCode).toBe(400)
    expect(await desfeitosDe(id)).toEqual([])
  })
})

describe('a renovação não se repete (ajuste 10)', () => {
  it('pagar de novo NÃO cria segunda conta do mês seguinte', async () => {
    const id = await criar({ mensal: true })
    const p1 = await pagar(id)
    expect(p1.body.proxima.vencimento).toBe('2026-11-10')
    await desfazer(id)

    const p2 = await pagar(id)
    expect(p2.statusCode).toBe(201)
    expect(p2.body.proxima).toBeNull()
    expect(await daSerie(id)).toEqual([
      { vencimento: '2026-10-10', excluida: false },
      { vencimento: '2026-11-10', excluida: false },
    ])
  })

  it('nem depois de EDITAR o vencimento — 10/12 não colidiria no índice', async () => {
    const id = await criar({ mensal: true })
    await pagar(id)
    await desfazer(id)
    // Adiar para 05/11: o seguinte pela âncora seria 10/12, que NÃO colide com
    // a 10/11 já existente no índice `conta_da_serie_por_mes` — só a regra da
    // conta posterior segura.
    expect(
      (await remendar(c, `/v1/contas/${id}`, contaBase({ mensal: true, vencimento: '2026-11-05' }), 'beatriz'))
        .statusCode,
    ).toBe(200)

    const p = await pagar(id)
    expect(p.statusCode).toBe(201)
    expect(p.body.proxima).toBeNull()
    expect((await daSerie(id)).map((x) => x.vencimento)).toEqual(['2026-11-05', '2026-11-10'])
  })

  it('nem depois de EXCLUIR a do mês seguinte — o que a gestora apagou não volta', async () => {
    const id = await criar({ mensal: true })
    const p1 = await pagar(id)
    expect((await apagar(c, `/v1/contas/${p1.body.proxima.id}`, {}, 'beatriz')).statusCode).toBe(204)
    await desfazer(id)

    const p2 = await pagar(id)
    expect(p2.statusCode).toBe(201)
    expect(p2.body.proxima).toBeNull()
    expect(await daSerie(id)).toEqual([
      { vencimento: '2026-10-10', excluida: false },
      { vencimento: '2026-11-10', excluida: true },
    ])
  })
})

describe('corrida e recusas', () => {
  it('duas abas desfazendo ao mesmo tempo: UMA linha, e a outra recebe 409', async () => {
    const id = await criar()
    await pagar(id)
    const r = await Promise.all([desfazer(id), desfazer(id)])
    expect(r.map((x) => x.statusCode).sort()).toEqual([201, 409])
    expect(await desfeitosDe(id)).toHaveLength(1)
  })

  it('a aba que chega DEPOIS do desfazer da outra não grava linha — corrida forçada', async () => {
    // O teste acima pode chegar serializado neste harness (medido no épico 2).
    // Este força o caminho perdedor: a "outra aba" segura a linha da conta,
    // a requisição fica esperando no lock, a outra aba desfaz e confirma — e a
    // requisição tem de enxergar a conta já ABERTA. Sem o `FOR UPDATE` e sem
    // o `AND pago_em IS NOT NULL`, ela gravaria um segundo desfazer do mesmo
    // dinheiro, e Σ desfeitos passaria a ser maior que Σ registrados.
    const id = await criar()
    await pagar(id)

    const outraAba = new pg.Client({ connectionString: URL_MIG })
    await outraAba.connect()
    try {
      await declararAtorSistema(outraAba)
      await outraAba.query('BEGIN')
      await outraAba.query('SELECT 1 FROM contas_a_pagar WHERE id = $1 FOR UPDATE', [id])

      const pendente = Promise.resolve(desfazer(id))
      // Espera a requisição de fato parar no lock — nunca um sleep às cegas.
      for (let i = 0; i < 100; i++) {
        const w = await c.migrate.query(
          `SELECT 1 FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query ILIKE '%contas_a_pagar%'`,
        )
        if ((w.rowCount ?? 0) > 0) break
        await new Promise((ok) => setTimeout(ok, 50))
      }
      await outraAba.query(
        `UPDATE contas_a_pagar SET pago_em = NULL, valor_pago = NULL, forma_pagamento = '', pago_por = NULL
          WHERE id = $1`,
        [id],
      )
      await outraAba.query('COMMIT')

      const r = await pendente
      expect(r.statusCode).toBe(409)
      expect(await desfeitosDe(id)).toEqual([])
    } finally {
      await outraAba.end()
    }
  })

  it('sem `contas.gerir`, 403 — mesmo na conta da própria pessoa', async () => {
    const id = await criar({ responsavelId: c.pessoas['sonia'] })
    await pagar(id)
    expect((await desfazer(id, {}, 'sonia')).statusCode).toBe(403)
    expect(await desfeitosDe(id)).toEqual([])
  })

  it('conta ABERTA é 409', async () => {
    const id = await criar()
    const r = await desfazer(id)
    expect(r.statusCode).toBe(409)
    expect(await desfeitosDe(id)).toEqual([])
  })

  it('conta EXCLUÍDA é 404', async () => {
    const id = await criar()
    await apagar(c, `/v1/contas/${id}`, {}, 'beatriz')
    expect((await desfazer(id)).statusCode).toBe(404)
  })

  it('a conta de OUTRA clínica é 404', async () => {
    const outra = await c.migrate.query<{ id: string }>(
      `INSERT INTO contas_a_pagar
         (clinica_id, descricao, categoria, valor, vencimento, responsavel_id, pago_em, valor_pago, pago_por)
       SELECT $1, 'Segredo da vizinha', 'Ocupação', 999900, $2::date, id, $2::date, 999900, id
         FROM pessoas WHERE clinica_id = $1 LIMIT 1
       RETURNING id`,
      [c.outraClinica, HOJE],
    )
    const r = await desfazer(outra.rows[0]!.id)
    expect(r.statusCode).toBe(404)
    expect(r.text).not.toContain('999900')
  })

  it('a conta paga que se tenta excluir aponta o "Desfazer pagamento"', async () => {
    const id = await criar()
    await pagar(id)
    const r = await apagar(c, `/v1/contas/${id}`, {}, 'beatriz')
    expect(r.statusCode).toBe(409)
    expect(r.body.message).toContain('Desfazer pagamento')
    expect(r.body.message).not.toContain('edite o valor pago')
  })
})

describe('pagamento de mês anterior (ajuste 11)', () => {
  it('sem confirmação: 409 MES_ANTERIOR, sem número nenhum, e nada muda', async () => {
    const id = await criar({ vencimento: '2026-09-30' })
    await pagar(id, { em: '2026-09-30', valor: '123457' })

    const r = await desfazer(id)
    expect(r.statusCode).toBe(409)
    expect(r.body).toMatchObject({ codigo: 'CONFIRMACAO_NECESSARIA', avisos: ['MES_ANTERIOR'] })
    expect(r.text).not.toMatch(/123457|1\.234|1234/)
    expect(await desfeitosDe(id)).toEqual([])
    const ainda = await c.migrate.query<{ pago_em: string | null }>(
      'SELECT pago_em::text AS pago_em FROM contas_a_pagar WHERE id = $1',
      [id],
    )
    expect(ainda.rows[0]!.pago_em).toBe('2026-09-30')
  })

  it('com `confirmarMesAnterior: true`: desfaz', async () => {
    const id = await criar({ vencimento: '2026-09-30' })
    await pagar(id, { em: '2026-09-30' })
    const r = await desfazer(id, { confirmarMesAnterior: true })
    expect(r.statusCode).toBe(201)
    expect(r.body.pagoEm).toBeNull()
    expect(await desfeitosDe(id)).toHaveLength(1)
  })

  it('pagamento do mês CORRENTE não pede confirmação — nem no dia 1', async () => {
    const id = await criar()
    await pagar(id, { em: '2026-10-01' })
    expect((await desfazer(id)).statusCode).toBe(201)
  })
})

describe('a tabela append-only, no banco', () => {
  it('UPDATE e DELETE recusados — inclusive para o DONO', async () => {
    const id = await criar()
    await pagar(id)
    await desfazer(id)
    await expect(
      c.migrate.query(`UPDATE pagamentos_de_conta_desfeitos SET motivo = 'outro' WHERE conta_id = $1`, [id]),
    ).rejects.toThrow(/append-only/)
    await expect(
      c.migrate.query('DELETE FROM pagamentos_de_conta_desfeitos WHERE conta_id = $1', [id]),
    ).rejects.toThrow(/append-only/)
    await expect(c.migrate.query('TRUNCATE pagamentos_de_conta_desfeitos')).rejects.toThrow(
      /append-only/,
    )
  })

  it('`fir_app` só tem SELECT e INSERT', async () => {
    const r = await c.migrate.query<{ upd: boolean; del: boolean; trn: boolean; ins: boolean }>(
      `SELECT has_table_privilege('fir_app', 'pagamentos_de_conta_desfeitos', 'UPDATE') AS upd,
              has_table_privilege('fir_app', 'pagamentos_de_conta_desfeitos', 'DELETE') AS del,
              has_table_privilege('fir_app', 'pagamentos_de_conta_desfeitos', 'TRUNCATE') AS trn,
              has_table_privilege('fir_app', 'pagamentos_de_conta_desfeitos', 'INSERT') AS ins`,
    )
    expect(r.rows[0]).toEqual({ upd: false, del: false, trn: false, ins: true })
  })

  it('RLS: a outra clínica não enxerga a linha', async () => {
    const id = await criar()
    await pagar(id)
    await desfazer(id)

    const app = new pg.Client({ connectionString: URL_APP })
    await app.connect()
    try {
      const contar = async (clinica: string): Promise<number> => {
        await app.query('BEGIN')
        try {
          await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinica])
          await app.query('SELECT set_config($1, $2, true)', ['app.pessoa_id', 'sistema'])
          const r = await app.query('SELECT 1 FROM pagamentos_de_conta_desfeitos WHERE conta_id = $1', [id])
          return r.rowCount ?? 0
        } finally {
          await app.query('ROLLBACK')
        }
      }
      expect(await contar(c.clinica)).toBe(1)
      expect(await contar(c.outraClinica)).toBe(0)
    } finally {
      await app.end()
    }
  })
})
