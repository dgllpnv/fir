import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  botar,
  type Cenario,
  desmontarCenario,
  limparFinanceiro,
  limparIndicadores,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * Revalidação de números T2–T4 (validador-numeros, 2026-11-17), sobre 01eafb1.
 * HOJE = sábado 24/10/2026 (America/Bahia). `beatriz` tem `valores`;
 * `juliana` não tem. As duas ganham `indicadores` e `indicadores.gerir`.
 */
let c: Cenario

const SEGUNDA = '2026-10-19'

const kpiManual = async (unidade: string, frequencia = 'semanal'): Promise<string> => {
  const r = await postar(
    c,
    '/v1/indicadores/kpis',
    {
      origem: 'manual',
      nome: `Manual ${unidade}`,
      pilar: 'Financeiro',
      unidade,
      direcao: 'maior',
      frequencia,
      diaDeLancamento: 5,
      comoMedir: 'x',
      responsavelId: c.pessoas['beatriz'],
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.id as string
}

beforeAll(async () => {
  c = await montarCenario('validacao-t2-t4')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir']
      WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec')`,
    [c.clinica],
  )
})
afterAll(async () => {
  await limparIndicadores(c)
  await limparFinanceiro(c)
  await limparTarefas(c)
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparIndicadores(c)
  await limparTarefas(c)
  await limparFinanceiro(c)
})

describe('T3 — o lançamento em reais é centavo inteiro e alimenta a calculadora', () => {
  it('lancamento-reais-em-centavos: R$ 123,45 grava 12345 em valor_centavos e o cartão mostra 12345', async () => {
    const kpi = await kpiManual('reais')
    const r = await botar(c, `/v1/indicadores/kpis/${kpi}/lancamentos/${SEGUNDA}`, { valor: '12345' }, 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const l = await c.migrate.query<{ c: string | null; n: string | null }>(
      'SELECT valor_centavos::text AS c, valor_numero::text AS n FROM lancamentos_de_kpi WHERE kpi_id = $1',
      [kpi],
    )
    expect(l.rows).toEqual([{ c: '12345', n: null }])
    const t = await c.migrate.query<{ t: string }>(
      `SELECT data_type AS t FROM information_schema.columns WHERE table_name = 'lancamentos_de_kpi' AND column_name = 'valor_centavos'`,
    )
    expect(t.rows[0]!.t).toBe('bigint')
    const lista = (await pegar(c, '/v1/indicadores', {}, 'beatriz')).body.itens as { id: string; atual: { emDinheiro: string | null } }[]
    expect(lista.find((x) => x.id === kpi)!.atual.emDinheiro).toBe('12345')
    // Sem `valores`: o número não atravessa.
    const semValores = (await pegar(c, '/v1/indicadores', {}, 'juliana')).text
    expect(semValores).not.toContain('12345')
  })

  it('lancamento-quantidade-em-centesimos: 12 pacientes = 1200, e o cartão mostra 1200', async () => {
    const kpi = await kpiManual('quantidade')
    expect((await botar(c, `/v1/indicadores/kpis/${kpi}/lancamentos/${SEGUNDA}`, { valor: '1200' }, 'beatriz')).statusCode).toBe(200)
    const lista = (await pegar(c, '/v1/indicadores', {}, 'beatriz')).body.itens as { id: string; atual: { emNumero: string | null } }[]
    expect(lista.find((x) => x.id === kpi)!.atual.emNumero).toBe('1200')
  })

  it('DEFEITO X1 troca-de-unidade-concorrente: lançamento que entra entre a checagem e o UPDATE não pode deixar o KPI em reais com valor_numero', async () => {
    const kpi = await kpiManual('quantidade')
    // Simula o `lancar` em andamento: ele segura a linha do KPI (FOR UPDATE) e grava.
    await c.migrate.query('BEGIN')
    await c.migrate.query('SELECT 1 FROM kpis WHERE id = $1 FOR UPDATE', [kpi])
    const edicao = botar(c, `/v1/indicadores/kpis/${kpi}`, { unidade: 'reais' }, 'beatriz').then((r) => r)
    // A edição já fez a checagem (nenhum lançamento) e está parada no UPDATE.
    await new Promise((ok) => setTimeout(ok, 800))
    await c.migrate.query(
      `INSERT INTO lancamentos_de_kpi (clinica_id, kpi_id, referencia, valor_numero, lancado_por) VALUES ($1, $2, $3, 1200, $4)`,
      [c.clinica, kpi, SEGUNDA, c.pessoas['beatriz']],
    )
    await c.migrate.query('COMMIT')
    const r = await edicao
    const k = await c.migrate.query<{ unidade: string }>('SELECT unidade FROM kpis WHERE id = $1', [kpi])
    const l = await c.migrate.query<{ n: string | null }>('SELECT valor_numero::text AS n FROM lancamentos_de_kpi WHERE kpi_id = $1', [kpi])
    // Ou a edição é 409, ou a unidade segue a do lançamento gravado. Nunca 12 pacientes lidos como reais.
    expect({ status: r.statusCode, unidade: k.rows[0]!.unidade, n: l.rows[0]?.n }).toEqual({
      status: 409,
      unidade: 'quantidade',
      n: '1200',
    })
  })
})

describe('T4 — OKR lido sem `valores`', () => {
  it('okr-reais-sem-valores: alvo, partida e atual em reais de um KR manual não atravessam para a juliana', async () => {
    const kpi = await kpiManual('reais', 'mensal')
    await c.migrate.query(
      `INSERT INTO lancamentos_de_kpi (clinica_id, kpi_id, referencia, valor_centavos, lancado_por) VALUES ($1, $2, '2026-10-01', 77777, $3)`,
      [c.clinica, kpi, c.pessoas['beatriz']],
    )
    const r = await postar(
      c,
      '/v1/indicadores/okrs',
      {
        objetivo: 'Faturar',
        periodo: { tipo: 'datas', inicio: '2026-10-01', fim: '2026-10-31' },
        resultadosChave: [{ kpiId: kpi, alvo: '123456', partida: '11111' }],
      },
      'beatriz',
    )
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    expect(r.text).toContain('123456')
    for (const rota of ['/v1/indicadores/okrs', `/v1/indicadores/okrs/${r.body.id}`]) {
      const t = (await pegar(c, rota, {}, 'juliana')).text
      expect(t, rota).not.toContain('77777')
      expect(t, rota).not.toContain('123456')
      expect(t, rota).not.toContain('11111')
    }
    // Progresso 77777/123456 = 63% (exibido); o OKR é o mesmo número.
    const o = (await pegar(c, `/v1/indicadores/okrs/${r.body.id}`, {}, 'beatriz')).body as {
      progresso: number
      resultadosChave: { metaDoKr: { progresso: number } }[]
    }
    expect(o.progresso).toBe(o.resultadosChave[0]!.metaDoKr.progresso)
  })

  it('okr-duplicar-soma-partida-zero: KR de soma (faturamento) duplicado parte de 0, não do valor de hoje', async () => {
    const k = await c.migrate.query<{ id: string }>(
      `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia) VALUES ($1, 'catalogo', 'faturamento_conferido', 'f', 'mensal') RETURNING id`,
      [c.clinica],
    )
    await c.migrate.query(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, valor_aberto, forma, recebido_em, registrado_por)
       VALUES ($1, $2, 'Pagamento de consulta', 50000, 0, 'Pix', '2026-10-05T12:00:00Z', $3)`,
      [c.clinica, c.pacientes['ana'], c.pessoas['beatriz']],
    )
    const r = await postar(
      c,
      '/v1/indicadores/okrs',
      { objetivo: 'Faturar', resultadosChave: [{ kpiId: k.rows[0]!.id, alvo: '1000000' }] },
      'beatriz',
    )
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    const d = await postar(c, `/v1/indicadores/okrs/${r.body.id}/duplicar`, {}, 'beatriz')
    expect(d.statusCode, JSON.stringify(d.body)).toBe(201)
    const kr = (d.body.resultadosChave as { metaDoKr: { alvo: { emDinheiro: string }; partida: { emDinheiro: string } } }[])[0]!
    expect([kr.metaDoKr.alvo.emDinheiro, kr.metaDoKr.partida.emDinheiro]).toEqual(['1000000', '0'])
  })
})

describe('as chaves sem tela, conferidas à mão (c.1)', () => {
  const tarefa = (tipo: string, concluida: string | null, prazo: string, extra: { marcador?: string; status?: string; paciente?: string } = {}) =>
    c.migrate.query(
      `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em, criada_em, paciente_id, tipo, historico, marcador)
       VALUES ($1, $2, $2, 'f', $3::date, $4::text::status_de_tarefa, $5::timestamptz, '2026-01-01T12:00:00Z', $6, $7, '[]', $8)`,
      [c.clinica, c.pessoas['beatriz'], prazo, extra.status ?? 'concluida', concluida, extra.paciente ?? c.pacientes['ana'], tipo, extra.marcador ?? null],
    )
  const kpi = async (chave: string) =>
    (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia) VALUES ($1, 'catalogo', $2, $2, 'mensal') RETURNING id`,
        [c.clinica, chave],
      )
    ).rows[0]!.id
  const valorEmSetembro = async (id: string) =>
    ((await pegar(c, '/v1/indicadores', { de: '2026-09-01', ate: '2026-09-30' }, 'beatriz')).body.itens as {
      id: string
      atual: { emNumero: string | null }
    }[]).find((x) => x.id === id)!.atual.emNumero

  it('pacientes_recaptados: ana volta após 198 dias (recaptada uma vez, mesmo com 2 atendimentos); beto volta após 100 (não); sem anterior não conta', async () => {
    const ana = c.pacientes['ana']!
    const outros = Object.values(c.pacientes).filter((p) => p !== ana)
    const beto = outros[0]!
    const carla = outros[1]!
    await tarefa('Consulta realizada', '2026-03-01T12:00:00Z', '2026-03-01', { paciente: ana })
    await tarefa('Consulta realizada', '2026-09-15T12:00:00Z', '2026-09-15', { paciente: ana })
    await tarefa('Consulta realizada', '2026-09-20T12:00:00Z', '2026-09-20', { paciente: ana })
    await tarefa('Consulta realizada', '2026-06-10T12:00:00Z', '2026-06-10', { paciente: beto })
    await tarefa('Consulta realizada', '2026-09-18T12:00:00Z', '2026-09-18', { paciente: beto })
    await tarefa('Consulta realizada', '2026-09-19T12:00:00Z', '2026-09-19', { paciente: carla })
    expect(await valorEmSetembro(await kpi('pacientes_recaptados'))).toBe('100')
  })

  it('rotinas_cumpridas: 2 previstas (1 concluída, 1 aberta), a cancelada e a sem marcador fora → 50%', async () => {
    await tarefa('Follow-up', '2026-09-10T12:00:00Z', '2026-09-10', { marcador: 'rotina-a' })
    await tarefa('Follow-up', null, '2026-09-11', { marcador: 'rotina-b', status: 'aberta' })
    await tarefa('Follow-up', null, '2026-09-12', { marcador: 'rotina-c', status: 'cancelada' })
    await tarefa('Follow-up', '2026-09-13T12:00:00Z', '2026-09-13')
    await tarefa('Follow-up', '2026-10-01T12:00:00Z', '2026-10-01', { marcador: 'rotina-d' })
    expect(await valorEmSetembro(await kpi('rotinas_cumpridas'))).toBe('5000')
  })
})

describe('c.10 × ADR chaves-em-reais — dia de mês PASSADO sem caixa, ainda fechável às cegas', () => {
  it('o ponto diário de 30/09 sem caixa (conferencia_desde 01/09) — o que sai, e o que o Painel já mostra', async () => {
    await c.migrate.query(`UPDATE clinicas SET conferencia_desde = '2026-09-01' WHERE id = $1`, [c.clinica])
    await c.migrate.query(`INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1, '2026-09-29', '', $2)`, [
      c.clinica,
      c.pessoas['beatriz'],
    ])
    const t = await c.migrate.query<{ id: string }>(
      `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em, criada_em, paciente_id, tipo, historico)
       VALUES ($1, $2, $2, 'f', '2026-09-30', 'concluida', '2026-09-30T12:00:00Z', '2026-09-30T12:00:00Z', $3, 'Pagamento de orçamento', '[]') RETURNING id`,
      [c.clinica, c.pessoas['beatriz'], c.pacientes['ana']],
    )
    await c.migrate.query(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, tipo, valor, valor_aberto, forma, recebido_em, registrado_por)
       VALUES ($1, $2, $3, 'Pagamento de orçamento', 77777, 0, 'Pix', '2026-09-30T12:00:00Z', $4)`,
      [c.clinica, c.pacientes['ana'], t.rows[0]!.id, c.pessoas['beatriz']],
    )
    const k = await c.migrate.query<{ id: string }>(
      `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia) VALUES ($1, 'catalogo', 'valor_fechado_em_orcamentos', 'v', 'mensal') RETURNING id`,
      [c.clinica],
    )
    const s = await pegar(c, `/v1/indicadores/kpis/${k.rows[0]!.id}/serie`, { de: '2026-09-30', ate: '2026-09-30' }, 'beatriz')
    const p = await pegar(c, '/v1/painel', { periodo: 'per', de: '2026-09-30', ate: '2026-09-30' }, 'beatriz')
    const fechavel = await c.migrate.query('SELECT 1 FROM caixas_do_dia WHERE clinica_id = $1 AND dia = $2', [c.clinica, '2026-09-30'])
    // Registro, não asserção de defeito: o ADR escolheu "mês passado = a tela".
    console.info('[validador] serie 30/09:', s.text.includes('77777'), 'painel 30/09:', p.text.includes('77777'), 'caixa 30/09:', fechavel.rowCount)
    expect(fechavel.rowCount).toBe(0)
  })
})
