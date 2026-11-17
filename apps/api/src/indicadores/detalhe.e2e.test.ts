import { ComposicaoDoKpi, ListaDeLancamentos, SerieDoKpi } from '@fir/contracts'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AMANHA,
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
 * Indicadores & Insights — T6, o detalhe do KPI: a composição do número, os
 * lançamentos, os planos de ação por `kpiId` e o ritmo diário da série.
 *
 * HOJE = sábado 24/10/2026 (America/Bahia), caixa de hoje aberto.
 * `beatriz`: `valores`, `finmes`, `pacientes`, sem `pessoas.gerir`.
 * `juliana`: `pacientes`, `jornada`, SEM `valores` e SEM `finmes`.
 * `camila`: `valores` e `pacientes`, SEM `finmes`.
 */
let c: Cenario

const kpiNoBanco = async (chave: string, clinica = c.clinica, parametros = '{}'): Promise<string> =>
  (
    await c.migrate.query<{ id: string }>(
      `INSERT INTO kpis (clinica_id, origem, chave_catalogo, parametros, nome, frequencia)
       VALUES ($1, 'catalogo', $2, $3::jsonb, $2, 'mensal') RETURNING id`,
      [clinica, chave, parametros],
    )
  ).rows[0]!.id

const recebimento = (instante: string, valor: string, forma: string, tipo = 'Pagamento de consulta') =>
  c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, valor_aberto, forma, recebido_em, registrado_por)
     VALUES ($1, $2, $3, $4, 0, $5, $6::timestamptz, $7)`,
    [c.clinica, c.pacientes['ana'], tipo, valor, forma, instante, c.pessoas['beatriz']],
  )

const composicao = (id: string, quem = 'beatriz', q: Record<string, string> = {}) =>
  pegar(c, `/v1/indicadores/kpis/${id}/composicao`, q, quem)

beforeAll(async () => {
  c = await montarCenario('indicadores-t6-detalhe')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir']
      WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec', 'pf_ter')`,
    [c.clinica],
  )
})
afterAll(async () => {
  await limparIndicadores(c)
  await limparFinanceiro(c)
  await limparTarefas(c)
  await c.migrate.query(`DELETE FROM pacientes WHERE clinica_id = $1 AND nome LIKE 'Novo T6 %'`, [c.clinica])
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparIndicadores(c)
  await limparTarefas(c)
  await limparFinanceiro(c)
  await c.migrate.query(`DELETE FROM pacientes WHERE clinica_id = $1 AND nome LIKE 'Novo T6 %'`, [c.clinica])
})

describe('GET /v1/indicadores/kpis/:id/composicao (backlog 1.9 E; L-IN-3)', () => {
  it('faturamento por forma e por tipo: a soma de cada bloco é o número do cartão, sem hoje e sem paciente', async () => {
    const id = await kpiNoBanco('faturamento_conferido')
    await recebimento('2026-10-05T12:00:00Z', '30000', 'Pix')
    await recebimento('2026-10-06T12:00:00Z', '20000', 'Dinheiro', 'Pagamento de orçamento')
    await recebimento('2026-10-07T12:00:00Z', '15000', 'Pix')
    // Hoje, com o caixa aberto: não conta (regra 6) — `composicao-sem-hoje`.
    await recebimento('2026-10-24T15:00:00Z', '77777', 'Pix')
    const r = await composicao(id)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const comp = ComposicaoDoKpi.parse(r.body)
    const cartao = ((await pegar(c, '/v1/indicadores', {}, 'beatriz')).body.itens as { id: string; atual: { emDinheiro: string } }[]).find(
      (k) => k.id === id,
    )!
    expect(comp.total!.emDinheiro).toBe(cartao.atual.emDinheiro)
    expect(comp.total!.emDinheiro).toBe('65000')
    const forma = comp.blocos.find((b) => b.por === 'forma')!
    expect(forma.grupos.map((g) => [g.rotulo, g.quantidade, g.numero.emDinheiro])).toEqual([
      ['Pix', 2, '45000'],
      ['Dinheiro', 1, '20000'],
    ])
    const tipo = comp.blocos.find((b) => b.por === 'tipo')!
    expect(tipo.grupos.map((g) => [g.rotulo, g.numero.emDinheiro])).toEqual([
      ['Pagamento de consulta', '45000'],
      ['Pagamento de orçamento', '20000'],
    ])
    expect(comp.relatorio).toEqual({ chave: 'recebimentos', de: '2026-10-01', ate: '2026-10-24' })
    expect(r.text).not.toContain('77777')
    expect(r.text).not.toContain(c.pacientes['ana']!)
    expect(r.text).not.toContain('Ana')
  })

  it('sem a `permissaoDaComposicao` é 403 ("Sem acesso ao detalhe"); sem `indicadores`, 403', async () => {
    const id = await kpiNoBanco('faturamento_conferido')
    // `camila` vê valores e não tem `finmes`, a permissão da composição do faturamento.
    const r = await composicao(id, 'camila')
    expect(r.statusCode).toBe(403)
    expect(r.body.message).toBe('Sem acesso ao detalhe.')
    expect((await composicao(id, 'rita')).statusCode).toBe(403)
  })

  it('L-IN-3: a composição de comparecimento exige `jornada` (camila 403) e não traz paciente para quem a tem', async () => {
    const id = await kpiNoBanco('comparecimento')
    expect((await composicao(id, 'camila')).statusCode).toBe(403)
    const r = await composicao(id, 'juliana')
    expect(r.statusCode).toBe(200)
    expect(r.body).toMatchObject({ disponivel: false, motivoIndisponivel: 'sem_composicao', blocos: [] })
  })

  it('kpi-rh-some-sem-pessoas-gerir e ids-de-outra-clinica: 404; KPI manual: 422', async () => {
    expect((await composicao(await kpiNoBanco('saldo_banco_de_horas'))).statusCode).toBe(404)
    expect((await composicao(await kpiNoBanco('faturamento_conferido', c.outraClinica))).statusCode).toBe(404)
    const manual = await postar(
      c,
      '/v1/indicadores/kpis',
      { origem: 'manual', nome: 'NPS', pilar: 'Comercial', unidade: 'quantidade', direcao: 'maior', frequencia: 'mensal', diaDeLancamento: 5 },
      'beatriz',
    )
    expect((await composicao(manual.body.id as string)).statusCode).toBe(422)
  })

  it('novos pacientes por origem: a contagem do cartão, sem nome de paciente (juliana, sem `valores`)', async () => {
    for (const [nome, origem] of [
      ['Novo T6 Um', 'Instagram'],
      ['Novo T6 Dois', 'Instagram'],
      ['Novo T6 Três', ''],
    ]) {
      await c.migrate.query(`INSERT INTO pacientes (clinica_id, nome, origem, criado_em) VALUES ($1, $2, $3, '2026-10-10T12:00:00Z')`, [
        c.clinica,
        nome,
        origem,
      ])
    }
    const id = await kpiNoBanco('novos_pacientes')
    const r = await composicao(id, 'juliana')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const comp = ComposicaoDoKpi.parse(r.body)
    expect(comp.blocos[0]!.grupos.map((g) => [g.rotulo, g.quantidade])).toEqual([
      ['Instagram', 2],
      ['Não informada', 1],
    ])
    const cartao = ((await pegar(c, '/v1/indicadores', {}, 'juliana')).body.itens as { id: string; atual: { emNumero: string } }[]).find(
      (k) => k.id === id,
    )!
    expect(comp.total!.emNumero).toBe(cartao.atual.emNumero)
    expect(r.text).not.toContain('Novo T6')
    expect(comp.relatorio?.chave).toBe('pacientes-por-origem-e-campanha')
  })
})

describe('GET /v1/indicadores/kpis/:id/lancamentos', () => {
  const manualEmReais = async (): Promise<string> => {
    const r = await postar(
      c,
      '/v1/indicadores/kpis',
      {
        origem: 'manual',
        nome: 'Receita do evento',
        pilar: 'Financeiro',
        unidade: 'reais',
        direcao: 'maior',
        frequencia: 'semanal',
        diaDeLancamento: 1,
        responsavelId: c.pessoas['beatriz'],
      },
      'beatriz',
    )
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    return r.body.id as string
  }

  it('os lançamentos do mais recente ao mais antigo, com autor e comentário; paginados', async () => {
    const id = await manualEmReais()
    expect((await botar(c, `/v1/indicadores/kpis/${id}/lancamentos/2026-10-12`, { valor: '123456', comentario: 'semana boa' }, 'beatriz')).statusCode).toBe(200)
    expect((await botar(c, `/v1/indicadores/kpis/${id}/lancamentos/2026-10-19`, { valor: '654321' }, 'beatriz')).statusCode).toBe(200)
    const r = await pegar(c, `/v1/indicadores/kpis/${id}/lancamentos`, {}, 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const l = ListaDeLancamentos.parse(r.body)
    expect(l.itens.map((x) => [x.referencia, x.lancado.emDinheiro, x.autor, x.comentario])).toEqual([
      ['2026-10-19', '654321', 'Beatriz', ''],
      ['2026-10-12', '123456', 'Beatriz', 'semana boa'],
    ])
    expect(l.temMais).toBe(false)
    const pagina = ListaDeLancamentos.parse((await pegar(c, `/v1/indicadores/kpis/${id}/lancamentos`, { limite: '1' }, 'beatriz')).body)
    expect([pagina.itens.length, pagina.temMais]).toEqual([1, true])
  })

  it('redacao: sem `valores`, o valor em reais não atravessa (com mutação); KPI de catálogo é 422; vizinha é 404', async () => {
    const id = await manualEmReais()
    expect((await botar(c, `/v1/indicadores/kpis/${id}/lancamentos/2026-10-19`, { valor: '987654' }, 'beatriz')).statusCode).toBe(200)
    const equipe = await pegar(c, `/v1/indicadores/kpis/${id}/lancamentos`, {}, 'juliana')
    expect(equipe.statusCode).toBe(200)
    expect(equipe.text).not.toContain('987654')
    expect(equipe.body.itens[0].lancado.emDinheiro).toBeNull()
    expect((await pegar(c, `/v1/indicadores/kpis/${id}/lancamentos`, {}, 'beatriz')).text).toContain('987654')
    expect((await pegar(c, `/v1/indicadores/kpis/${await kpiNoBanco('novos_pacientes')}/lancamentos`, {}, 'beatriz')).statusCode).toBe(422)
    expect((await pegar(c, `/v1/indicadores/kpis/${await kpiNoBanco('novos_pacientes', c.outraClinica)}/lancamentos`, {}, 'beatriz')).statusCode).toBe(404)
    expect((await pegar(c, `/v1/indicadores/kpis/${id}/lancamentos`, {}, 'rita')).statusCode).toBe(403)
  })
})

describe('GET /v1/tarefas?kpiId — os planos de ação do KPI', () => {
  it('só as tarefas ligadas ao KPI, dentro do escopo', async () => {
    const kpi = await kpiNoBanco('novos_pacientes')
    const nova = (kpiId?: string) =>
      postar(
        c,
        '/v1/tarefas',
        {
          vinculo: 'interna',
          responsavelId: c.pessoas['beatriz'],
          descricao: 'Plano',
          quando: { modo: 'agendada', prazo: AMANHA },
          ...(kpiId === undefined ? {} : { kpiId }),
        },
        'beatriz',
      )
    const plano = await nova(kpi)
    expect(plano.statusCode).toBe(201)
    expect((await nova()).statusCode).toBe(201)
    const r = await pegar(c, '/v1/tarefas', { kpiId: kpi }, 'beatriz')
    expect(r.statusCode).toBe(200)
    expect((r.body.tarefas as { id: string }[]).map((t) => t.id)).toEqual([plano.body.tarefa.id])
    expect((await pegar(c, '/v1/tarefas', { kpiId: 'nao-e-uuid' }, 'beatriz')).statusCode).toBe(400)
  })
})

describe('SerieDoKpi.ritmoDiario — a linha do ritmo diário da meta', () => {
  it('dia a dia com meta: o ritmo é o da prévia D.3; sem `valores`, só o percentual (com mutação)', async () => {
    const id = await kpiNoBanco('faturamento_conferido')
    const meta = { kpiId: id, tipo: 'mes', inicio: '2026-10-01', prazo: '2026-10-31', alvo: '2300000' }
    expect((await postar(c, '/v1/indicadores/metas', meta, 'beatriz')).statusCode).toBe(201)
    const previa = await pegar(c, '/v1/indicadores/metas/previa', { kpiId: id, inicio: meta.inicio, prazo: meta.prazo, alvo: meta.alvo }, 'beatriz')
    const s = SerieDoKpi.parse((await pegar(c, `/v1/indicadores/kpis/${id}/serie`, { de: '2026-10-01', agrupamento: 'dia' }, 'beatriz')).body)
    expect(s.agrupamento).toBe('dia')
    expect(s.ritmoDiario!.emDinheiro).toBe(previa.body.ritmoPorDiaUtil.emDinheiro)
    expect(s.ritmoDiario!.percentualDaMeta).not.toBeNull()
    const equipe = await pegar(c, `/v1/indicadores/kpis/${id}/serie`, { de: '2026-10-01', agrupamento: 'dia' }, 'juliana')
    expect(equipe.body.ritmoDiario.emDinheiro).toBeNull()
    expect(equipe.body.ritmoDiario.percentualDaMeta).toBe(s.ritmoDiario!.percentualDaMeta)
    expect(equipe.text).not.toContain(s.ritmoDiario!.emDinheiro!)
    // Mês a mês, ou sem meta: sem linha.
    expect((await pegar(c, `/v1/indicadores/kpis/${id}/serie`, { agrupamento: 'mes' }, 'beatriz')).body.ritmoDiario).toBeNull()
    const semMeta = await kpiNoBanco('valor_fechado_em_orcamentos')
    expect((await pegar(c, `/v1/indicadores/kpis/${semMeta}/serie`, { de: '2026-10-01', agrupamento: 'dia' }, 'beatriz')).body.ritmoDiario).toBeNull()
  })
})
