import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  FUSO,
  HOJE,
  AMANHA,
  limparFinanceiro,
  limparTarefas,
  montarCenario,
  ONTEM,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * **O CAIXA DO DIA.**
 *
 * A cegueira da conferência — que a chave `esperado` não existe no corpo de um
 * dia aberto — é provada em `transporte-as-cegas.test.ts`, com o corpo HTTP
 * cru e o principal mais forte que existe. Aqui está o resto: o esperado é
 * calculado no servidor sobre a janela da CLÍNICA, a promissória fica fora dos
 * dois lados, um fechamento por dia, e a permissão que o protótipo não exige.
 */
let c: Cenario

type Corpo = Record<string, unknown>
type Linha = { forma: string; esperado: string | null; contado: string | null; diferenca: string | null }

const registrar = (x: Corpo = {}, quem = 'beatriz') =>
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

/**
 * Um recebimento num INSTANTE escolhido, escrito direto no banco.
 *
 * A rota só aceita o dia civil; para provar que a borda é a do fuso da clínica
 * é preciso escolher o instante — 23:59:59,999 de um dia e 00:00:00,000 do
 * seguinte, os dois em `America/Bahia`.
 */
const recebimentoEm = async (instante: string, valor: string, forma = 'Pix'): Promise<void> => {
  await c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por)
     VALUES ($1,$2,'Pagamento de consulta',$3,$4,$5::timestamptz,$6)`,
    [c.clinica, c.pacientes['ana'], valor, forma, instante, c.pessoas['beatriz']],
  )
}

const caixaDe = (dia: string, quem = 'beatriz') => pegar(c, '/v1/caixa', { dia }, quem)

const fechar = (dia: string, contado: Record<string, string>, quem = 'beatriz', obs = '') =>
  postar(
    c,
    '/v1/caixa',
    { dia, obs, contado: Object.entries(contado).map(([forma, valor]) => ({ forma, valor })) },
    quem,
  )

const linhaDe = (corpo: { porForma: Linha[] }, forma: string): Linha =>
  corpo.porForma.find((x) => x.forma === forma)!

beforeAll(async () => {
  c = await montarCenario('caixa')
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparFinanceiro(c)
  await limparTarefas(c)
})

describe('GET /v1/caixa', () => {
  it('dia ainda aberto: a resposta não tem esperado, diferenca nem porForma', async () => {
    await registrar({ valor: '45000', forma: 'Pix' })
    const r = await caixaDe(HOJE)
    expect(r.statusCode).toBe(200)
    expect(r.body.fechado).toBe(false)
    expect(r.body.formas).toEqual(['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito'])
    expect(Object.keys(r.body)).toEqual(['dia', 'fechado', 'formas', 'responsavel'])
  })

  it('sem `dia`, é o HOJE do servidor — não o do navegador', async () => {
    const r = await pegar(c, '/v1/caixa', {}, 'beatriz')
    expect(r.body.dia).toBe(HOJE)
  })

  it('o caixa de AMANHÃ é 400', async () => {
    expect((await caixaDe(AMANHA)).statusCode).toBe(400)
  })

  it('o responsável pelo caixa vem da configuração, e precisa estar ATIVO', async () => {
    await c.migrate.query(
      `INSERT INTO configuracao_financeira (clinica_id, caixa_responsavel_id) VALUES ($1,$2)`,
      [c.clinica, c.pessoas['sonia']],
    )
    expect((await caixaDe(HOJE)).body.responsavel.nome).toBe('Sonia')

    await c.migrate.query(
      `UPDATE configuracao_financeira SET caixa_responsavel_id = $2 WHERE clinica_id = $1`,
      [c.clinica, c.pessoas['marta']], // inativa
    )
    expect((await caixaDe(HOJE)).body.responsavel).toBeNull()
  })

  it('sem a permissão `caixa`, 403 — e `camila` tem `valores`', async () => {
    expect((await caixaDe(HOJE, 'camila')).statusCode).toBe(403)
  })
})

describe('POST /v1/caixa — o fechamento', () => {
  it('o esperado é calculado no SERVIDOR, sobre a janela da CLÍNICA', async () => {
    // 23:59:59,999 do dia 24 em America/Bahia entra; 00:00:00,000 do 25 não.
    await recebimentoEm('2026-10-24T23:59:59.999-03:00', '45000')
    await recebimentoEm('2026-10-25T00:00:00.000-03:00', '99900')

    const r = await fechar(HOJE, { Pix: '45000' })
    expect(r.statusCode).toBe(201)
    expect(linhaDe(r.body, 'Pix').esperado).toBe('45000')
    expect(r.body.conferido).toBe(true)
    expect(r.text).not.toContain('99900')
  })

  it('as bordas são do fuso DA CLÍNICA, não de UTC', async () => {
    // 2026-10-24T23:30-03:00 é 2026-10-25T02:30 em UTC. Um `::date` sobre UTC
    // mandaria este recebimento para o caixa do dia 25.
    await recebimentoEm('2026-10-24T23:30:00.000-03:00', '12300')
    const r = await fechar(HOJE, { Pix: '12300' })
    expect(linhaDe(r.body, 'Pix').esperado).toBe('12300')
    expect(r.body.conferido).toBe(true)
  })

  it('falta de R$ 50 no dinheiro: diferença negativa, por forma e no total', async () => {
    await registrar({ valor: '15000', forma: 'Dinheiro' })
    await registrar({ valor: '45000', forma: 'Pix' })

    const r = await fechar(HOJE, { Dinheiro: '10000', Pix: '45000' })
    expect(linhaDe(r.body, 'Dinheiro').diferenca).toBe('-5000')
    expect(linhaDe(r.body, 'Pix').diferenca).toBe('0')
    expect(r.body.diferenca).toBe('-5000')
    expect(r.body.conferido).toBe(false)
  })

  it('sobra e falta em formas diferentes NÃO dão caixa conferido', async () => {
    // O total zera; as linhas não. É o total que engana, e é por isso que
    // `conferido` não é `diferenca === 0`.
    await registrar({ valor: '10000', forma: 'Pix' })
    // Mesmo valor, mesma paciente, mesmo dia — a forma não desfaz o aviso de
    // duplicidade (D-21). É outro dinheiro, e a pessoa confirma.
    await registrar({ valor: '10000', forma: 'Dinheiro', confirmarDuplicidade: true })

    const r = await fechar(HOJE, { Pix: '5000', Dinheiro: '15000' })
    expect(r.body.diferenca).toBe('0')
    expect(r.body.conferido).toBe(false)
  })

  it('as QUATRO formas saem sempre, mesmo as que ninguém usou', async () => {
    const r = await fechar(HOJE, {})
    expect((r.body.porForma as Linha[]).map((x) => x.forma)).toEqual([
      'Pix',
      'Dinheiro',
      'Cartão de crédito',
      'Cartão de débito',
    ])
  })

  it('nota promissória não entra no caixa — nem no esperado, nem no contado', async () => {
    await registrar({ valor: '120000', forma: 'Nota promissória' })
    const r = await fechar(HOJE, { Pix: '0' })
    expect((r.body.porForma as Linha[]).map((x) => x.forma)).not.toContain('Nota promissória')
    expect(r.body.conferido).toBe(true) // a promissória não cria diferença
    expect(r.body.promissorias).toEqual({ quantidade: 1, valor: '120000' })
  })

  it('promissória no CONTADO é recusada pelo contrato — ela não está na gaveta', async () => {
    const r = await postar(
      c,
      '/v1/caixa',
      { dia: HOJE, obs: '', contado: [{ forma: 'Nota promissória', valor: '100' }] },
      'beatriz',
    )
    expect(r.statusCode).toBe(400)
  })

  it('a mesma forma duas vezes no contado é 400', async () => {
    const r = await postar(
      c,
      '/v1/caixa',
      {
        dia: HOJE,
        obs: '',
        contado: [
          { forma: 'Pix', valor: '100' },
          { forma: 'Pix', valor: '200' },
        ],
      },
      'beatriz',
    )
    expect(r.statusCode).toBe(400)
  })

  it('o recebimento ESTORNADO sai do esperado', async () => {
    const a = await registrar({ valor: '45000', forma: 'Pix' })
    await c.migrate.query('UPDATE recebimentos SET estornado_em = now() WHERE id = $1', [
      a.body.id,
    ])
    const r = await fechar(HOJE, { Pix: '0' })
    expect(linhaDe(r.body, 'Pix').esperado).toBe('0')
    expect(r.body.conferido).toBe(true)
  })

  it('um fechamento por dia: o segundo é 409, e o primeiro fica INTACTO', async () => {
    await registrar({ valor: '45000', forma: 'Pix' })
    await fechar(HOJE, { Pix: '45000' })

    const r = await fechar(HOJE, { Pix: '1' })
    expect(r.statusCode).toBe(409)
    expect(r.body.message).toContain('já foi fechado')
    expect(linhaDe((await caixaDe(HOJE)).body, 'Pix').contado).toBe('45000')
  })

  it('o mesmo dia em OUTRA clínica é permitido — o índice é por clínica', async () => {
    await fechar(HOJE, { Pix: '0' })
    const n = await c.migrate.query<{ n: string }>(
      `INSERT INTO caixas_do_dia (clinica_id, dia, fechado_por)
       SELECT $1, $2::date, id FROM pessoas WHERE clinica_id = $1 LIMIT 1
       RETURNING 1 AS n`,
      [c.outraClinica, HOJE],
    )
    expect(n.rowCount).toBe(1)
  })

  it('fechar o caixa de AMANHÃ é 400 — a data de negócio é do servidor', async () => {
    const r = await fechar(AMANHA, { Pix: '0' })
    expect(r.statusCode).toBe(400)
  })

  it('fechar um dia PASSADO é permitido, e usa o esperado daquele dia', async () => {
    await recebimentoEm('2026-10-23T10:00:00.000-03:00', '7700')
    const r = await fechar(ONTEM, { Pix: '7700' })
    expect(r.statusCode).toBe(201)
    expect(linhaDe(r.body, 'Pix').esperado).toBe('7700')
  })

  it('sem a permissão `caixa`, 403 — o protótipo não checa, e a Enfermagem fechou', async () => {
    // Medido: `demoApiBase({action:'fecharCaixa', uid:'u3'})` devolveu ok:true
    // e gravou o caixa. Aqui é 403, e nada é gravado.
    const r = await fechar(HOJE, { Pix: '1' }, 'camila')
    expect(r.statusCode).toBe(403)
    const n = await c.migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM caixas_do_dia WHERE clinica_id = $1',
      [c.clinica],
    )
    expect(Number(n.rows[0]!.n)).toBe(0)
  })
})

describe('depois do fechamento, quem vê o quê', () => {
  it('o esperado APARECE — é a comparação que a clínica veio ver', async () => {
    await registrar({ valor: '45000', forma: 'Pix' })
    await registrar({ valor: '12000', forma: 'Dinheiro' })
    await fechar(HOJE, { Pix: '45000', Dinheiro: '7000' })

    const r = await caixaDe(HOJE)
    expect(r.body.fechado).toBe(true)
    expect(linhaDe(r.body, 'Dinheiro').diferenca).toBe('-5000')
    expect(linhaDe(r.body, 'Dinheiro').esperado).toBe('12000')
    expect(r.body.fechadoPor.nome).toBe('Beatriz')
  })

  it('a recepcionista sem `valores` recebe `conferido`, e NENHUM número', async () => {
    await registrar({ valor: '45000', forma: 'Pix' })
    await registrar({ valor: '12000', forma: 'Dinheiro' })
    await fechar(HOJE, { Pix: '45000', Dinheiro: '7000' })

    const r = await caixaDe(HOJE, 'sonia')
    expect(r.body.conferido).toBe(false)
    expect(r.body.diferenca).toBeNull()
    expect(linhaDe(r.body, 'Pix').esperado).toBeNull()
    expect(linhaDe(r.body, 'Pix').contado).toBeNull()
    // Inclusive a DIFERENÇA: ela digitou o contado, e a diferença lhe daria o
    // esperado por subtração. Medido no protótipo, onde ela recebia os dois.
    expect(linhaDe(r.body, 'Pix').diferenca).toBeNull()
    for (const n of ['45000', '12000', '7000', '5000', '57000']) {
      expect(r.text, `o corpo contém ${n}`).not.toContain(n)
    }
  })

  it('o caixa de OUTRA clínica não é alcançável', async () => {
    await c.migrate.query(
      `INSERT INTO caixas_do_dia (clinica_id, dia, fechado_por)
       SELECT $1, $2::date, id FROM pessoas WHERE clinica_id = $1 LIMIT 1`,
      [c.outraClinica, HOJE],
    )
    // Mesmo dia, mesma data: a RLS devolve zero linhas e o caixa é "aberto".
    const r = await caixaDe(HOJE)
    expect(r.body.fechado).toBe(false)
  })
})

describe('POST /v1/caixa/reabrir (ADR 2026-11-19-reabrir-caixa)', () => {
  const reabrir = (dia: string, motivo: string, quem = 'beatriz') => postar(c, '/v1/caixa/reabrir', { dia, motivo }, quem)

  it('o dia volta a ficar aberto, às cegas, e fecha de novo com a contagem certa', async () => {
    await registrar({ valor: '45000', forma: 'Pix' })
    expect((await fechar(HOJE, { Pix: '40000' }, 'sonia')).statusCode).toBe(201)

    const r = await reabrir(HOJE, 'Digitei o Pix errado')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    // O dia reaberto é um dia ABERTO: sem esperado, sem diferenca, sem porForma (regra 6).
    expect(r.body.fechado).toBe(false)
    expect(Object.keys(r.body)).toEqual(['dia', 'fechado', 'formas', 'responsavel', 'reaberturas'])
    expect(r.body.reaberturas).toEqual([{ por: 'Beatriz', em: expect.any(String), motivo: 'Digitei o Pix errado' }])
    expect(r.text).not.toContain('45000')
    expect(r.text).not.toContain('40000')
    const lido = await caixaDe(HOJE, 'sonia')
    expect(lido.body.fechado).toBe(false)
    expect(lido.text).not.toContain('45000')

    const de_novo = await fechar(HOJE, { Pix: '45000' }, 'sonia')
    expect(de_novo.statusCode, JSON.stringify(de_novo.body)).toBe(201)
    expect(de_novo.body.conferido).toBe(true)
    // Os últimos fechamentos têm o dia UMA vez: o fechamento que vale.
    const u = (await pegar(c, '/v1/caixa/ultimos', {}, 'beatriz')).body.itens as { dia: string; conferido: boolean }[]
    expect(u.filter((x) => x.dia === HOJE)).toEqual([expect.objectContaining({ dia: HOJE, conferido: true })])
  })

  it('o fechamento que saiu fica inteiro no histórico, e a trilha registra a saída', async () => {
    await registrar({ valor: '45000', forma: 'Pix' })
    const f = await fechar(HOJE, { Pix: '40000' }, 'sonia', 'gaveta conferida')
    const caixaId = (await c.migrate.query<{ id: string }>('SELECT id FROM caixas_do_dia WHERE clinica_id = $1', [c.clinica])).rows[0]!.id
    expect(f.statusCode).toBe(201)
    expect((await reabrir(HOJE, 'Contagem refeita')).statusCode).toBe(200)

    const h = await c.migrate.query<{ caixa_id: string; obs: string; fechado_por: string; reaberto_por: string; motivo: string; linhas: { forma: string; esperado: string; contado: string }[] }>(
      'SELECT caixa_id, obs, fechado_por, reaberto_por, motivo, linhas FROM caixas_reabertos WHERE clinica_id = $1',
      [c.clinica],
    )
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0]).toMatchObject({ caixa_id: caixaId, obs: 'gaveta conferida', fechado_por: c.pessoas['sonia'], reaberto_por: c.pessoas['beatriz'], motivo: 'Contagem refeita' })
    expect(h.rows[0]!.linhas.find((l) => l.forma === 'Pix')).toEqual({ forma: 'Pix', esperado: '45000', contado: '40000' })
    expect((await c.migrate.query('SELECT 1 FROM caixas_do_dia WHERE clinica_id = $1', [c.clinica])).rowCount).toBe(0)
    expect((await c.migrate.query('SELECT 1 FROM caixa_por_forma WHERE clinica_id = $1', [c.clinica])).rowCount).toBe(0)
    const trilha = await c.migrate.query(
      `SELECT 1 FROM auditoria WHERE clinica_id = $1 AND entidade = 'caixas_do_dia' AND entidade_id = $2 AND acao = 'removeu'`,
      [c.clinica, caixaId],
    )
    expect(trilha.rowCount).toBe(1)
  })

  it('sem `finmes`, 403 — inclusive para quem fecha o caixa — e nada muda', async () => {
    await registrar({ valor: '45000', forma: 'Pix' })
    expect((await fechar(HOJE, { Pix: '45000' }, 'sonia')).statusCode).toBe(201)
    expect((await reabrir(HOJE, 'quero refazer', 'sonia')).statusCode).toBe(403)
    expect((await caixaDe(HOJE, 'sonia')).body.fechado).toBe(true)
  })

  it('dia não fechado é 409; motivo curto é 400; dia futuro é 400', async () => {
    expect((await reabrir(HOJE, 'sem caixa')).statusCode).toBe(409)
    expect((await fechar(HOJE, {}, 'sonia')).statusCode).toBe(201)
    expect((await reabrir(HOJE, 'x')).statusCode).toBe(400)
    expect((await reabrir(AMANHA, 'amanhã')).statusCode).toBe(400)
    // Reabrir duas vezes: a segunda já encontra o dia aberto.
    expect((await reabrir(HOJE, 'primeira')).statusCode).toBe(200)
    expect((await reabrir(HOJE, 'segunda')).statusCode).toBe(409)
  })

  it('o caixa da outra clínica não se reabre daqui (RLS): 409, e ele continua lá', async () => {
    await c.migrate.query(`INSERT INTO caixas_do_dia (clinica_id, dia, fechado_por) VALUES ($1, $2, $3)`, [
      c.outraClinica,
      ONTEM,
      (await c.migrate.query<{ id: string }>('SELECT id FROM pessoas WHERE clinica_id = $1 LIMIT 1', [c.outraClinica])).rows[0]!.id,
    ])
    expect((await reabrir(ONTEM, 'tentativa')).statusCode).toBe(409)
    expect((await c.migrate.query('SELECT 1 FROM caixas_do_dia WHERE clinica_id = $1', [c.outraClinica])).rowCount).toBe(1)
  })

  it('o histórico é append-only para a aplicação: UPDATE e DELETE recusados', async () => {
    expect((await fechar(HOJE, {}, 'sonia')).statusCode).toBe(201)
    expect((await reabrir(HOJE, 'teste de trava')).statusCode).toBe(200)
    // A trigger alcança até o dono da tabela.
    await expect(c.migrate.query(`UPDATE caixas_reabertos SET motivo = 'outro' WHERE clinica_id = $1`, [c.clinica])).rejects.toThrow(/UPDATE recusado/)
    // E a aplicação nem tem o privilégio.
    const p = await c.migrate.query<{ upd: boolean; del: boolean; ins: boolean }>(
      `SELECT has_table_privilege('fir_app', 'caixas_reabertos', 'UPDATE') AS upd,
              has_table_privilege('fir_app', 'caixas_reabertos', 'DELETE') AS del,
              has_table_privilege('fir_app', 'caixas_reabertos', 'INSERT') AS ins`,
    )
    expect(p.rows[0]).toEqual({ upd: false, del: false, ins: true })
  })
})

describe('GET /v1/caixa/ultimos', () => {
  it('lista os fechamentos, do mais recente para o mais antigo', async () => {
    await registrar({ valor: '45000', forma: 'Pix' })
    await fechar(ONTEM, { Pix: '0' })
    await fechar(HOJE, { Pix: '45000' })

    const r = await pegar(c, '/v1/caixa/ultimos', {}, 'beatriz')
    expect(r.statusCode).toBe(200)
    expect((r.body.itens as { dia: string }[]).map((x) => x.dia)).toEqual([HOJE, ONTEM])
    expect(r.body.itens[0].conferido).toBe(true)
  })

  it('o caixa com diferença aparece como NÃO conferido, com a diferença', async () => {
    await registrar({ valor: '45000', forma: 'Pix' })
    await fechar(HOJE, { Pix: '40000' })

    const r = await pegar(c, '/v1/caixa/ultimos', {}, 'beatriz')
    expect(r.body.itens[0].conferido).toBe(false)
    expect(r.body.itens[0].diferenca).toBe('-5000')
  })

  it('sem `valores`, sai `conferido` e a diferença vem nula', async () => {
    await registrar({ valor: '45000', forma: 'Pix' })
    await fechar(HOJE, { Pix: '40000' })

    const r = await pegar(c, '/v1/caixa/ultimos', {}, 'sonia')
    expect(r.body.itens[0].conferido).toBe(false)
    expect(r.body.itens[0].diferenca).toBeNull()
    expect(r.text).not.toContain('5000')
  })

  it('o fuso: a data civil do fechamento é a da clínica', async () => {
    await fechar(HOJE, { Pix: '0' })
    const r = await pegar(c, '/v1/caixa/ultimos', {}, 'beatriz')
    expect(r.body.itens[0].dia).toBe(HOJE)
  })
})
