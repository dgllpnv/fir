import { CatalogoDeKpisNaSaida, MAXIMO_DE_SERIES_POR_PEDIDO, SeriesDosKpis } from '@fir/contracts'
import { CATALOGO_DE_KPIS, somarMeses } from '@fir/domain'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparIndicadores,
  montarCenario,
  pegar,
} from '../tarefas/__tests__/cenario'

/**
 * Revisão da branch: S3 (o catálogo do D.1 com explicação limpa e prévia) e
 * P6 (os minigráficos num pedido só), contra Postgres REAL e a API inteira.
 *
 * HOJE = sábado 24/10/2026 (America/Bahia). `beatriz` tem `valores` e NÃO tem
 * `pessoas.gerir`; `juliana` não tem `valores`; `camila` ganha `pessoas.gerir`
 * aqui, para o controle positivo do KPI de RH. `rita` não tem `indicadores`.
 */
let c: Cenario

const kpiNoBanco = async (chave: string, frequencia: 'semanal' | 'mensal' = 'mensal', clinica = c.clinica): Promise<string> =>
  (
    await c.migrate.query<{ id: string }>(
      `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia) VALUES ($1, 'catalogo', $2, $2, $3) RETURNING id`,
      [clinica, chave, frequencia],
    )
  ).rows[0]!.id

/** Um saldo em aberto de R$ 500,00 da `ana`: o `saldo_a_receber` de hoje. */
const saldoAberto = () =>
  c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, valor_aberto, forma, recebido_em, registrado_por)
     VALUES ($1, $2, 'Pagamento de consulta', 0, 50000, '', '2026-10-07T12:00:00Z', $3)`,
    [c.clinica, c.pacientes['ana'], c.pessoas['beatriz']],
  )

const series = (ids: readonly string[], quem = 'beatriz') => pegar(c, '/v1/indicadores/series', { ids: ids.join(',') }, quem)

beforeAll(async () => {
  c = await montarCenario('indicadores-revisao')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir']
      WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec')`,
    [c.clinica],
  )
  // `juliana` lê campanhas (S6): o id do KPI atravessa sem `valores`, o dinheiro não.
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['campanhas'] WHERE clinica_id = $1 AND chave = 'pf_rec'`,
    [c.clinica],
  )
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir','pessoas','pessoas.gerir']
      WHERE clinica_id = $1 AND chave = 'pf_ter'`,
    [c.clinica],
  )
})
afterAll(async () => {
  await limparIndicadores(c)
  await limparFinanceiro(c)
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparIndicadores(c)
  await limparFinanceiro(c)
})

describe('S3 — o catálogo do D.1: explicação sem referência da spec, e a prévia de cada linha', () => {
  it('explicacao-limpa: nenhuma linha do catálogo nem o detalhe levam "(I-9)" à usuária', async () => {
    const r = await pegar(c, '/v1/indicadores/catalogo', {}, 'beatriz')
    expect(r.statusCode).toBe(200)
    const cat = CatalogoDeKpisNaSaida.parse(r.body)
    for (const i of cat.itens) expect(i.explicacao, i.chave).not.toMatch(/\((?:I|c|B|C)[-.]?\d/)
    expect(cat.itens.find((i) => i.chave === 'faturamento_conferido')!.explicacao).toBe('Recebimentos dos dias com caixa fechado')

    const id = await kpiNoBanco('comparecimento')
    const d = await pegar(c, `/v1/indicadores/kpis/${id}`, {}, 'beatriz')
    expect(d.body.explicacao).toBe('Realizados ÷ (realizados + faltas)')
  })

  it('previa-e-o-cartao: a prévia é o número que o cartão mostra depois de criado, pela mesma calculadora', async () => {
    await saldoAberto()
    const antes = CatalogoDeKpisNaSaida.parse((await pegar(c, '/v1/indicadores/catalogo', {}, 'beatriz')).body)
    const previa = antes.itens.find((i) => i.chave === 'saldo_a_receber')!.previa
    expect(previa).toMatchObject({ unidade: 'reais', emDinheiro: '50000', emNumero: null })
    // A chave que não mede nada sem a campanha não tem prévia.
    expect(antes.itens.find((i) => i.chave === 'resultado_de_campanha')!.previa).toBeNull()

    const id = await kpiNoBanco('saldo_a_receber')
    const lista = (await pegar(c, '/v1/indicadores', {}, 'beatriz')).body as { itens: { id: string; atual: unknown }[] }
    expect(lista.itens.find((k) => k.id === id)!.atual).toEqual(previa)
  })

  it('previa-redigida-sem-valores: sem `valores`, o dinheiro da prévia sai apagado; a contagem fica', async () => {
    await saldoAberto()
    const r = await pegar(c, '/v1/indicadores/catalogo', {}, 'juliana')
    expect(r.statusCode).toBe(200)
    const cat = CatalogoDeKpisNaSaida.parse(r.body)
    for (const i of cat.itens.filter((x) => x.previa?.unidade === 'reais')) expect(i.previa!.emDinheiro, i.chave).toBeNull()
    expect(r.text).not.toContain('50000')
    expect(cat.itens.find((i) => i.chave === 'novos_pacientes')!.previa).toMatchObject({ unidade: 'quantidade' })
    // `permissaoDoValor` (C5): sem `pessoas.gerir`, a linha de RH nem é medida.
    expect(cat.itens.map((i) => i.chave)).not.toContain('conversas_1a1_em_dia')
  })
})

describe('P6 — GET /v1/indicadores/series: os minigráficos num pedido só', () => {
  it('a-mesma-serie: cada item é byte a byte a série da rota de um KPI, na janela da frequência', async () => {
    const semanal = await kpiNoBanco('novos_pacientes', 'semanal')
    const mensal = await kpiNoBanco('saldo_a_receber')
    const r = await series([mensal, semanal])
    expect(r.statusCode).toBe(200)
    const lote = SeriesDosKpis.parse(r.body)
    expect(lote.itens.map((s) => s.kpiId).sort()).toEqual([mensal, semanal].sort())

    const s = lote.itens.find((x) => x.kpiId === semanal)!
    // S1: o semanal são 8 semanas, por semana.
    expect(s.agrupamento).toBe('semana')
    expect(s.pontos).toHaveLength(8)
    expect(s).toEqual((await pegar(c, `/v1/indicadores/kpis/${semanal}/serie`, { agrupamento: 'semana' }, 'beatriz')).body)

    const m = lote.itens.find((x) => x.kpiId === mensal)!
    expect(m.agrupamento).toBe('mes')
    expect(m.pontos).toHaveLength(6)
    const seisMeses = somarMeses(`${HOJE.slice(0, 7)}-01`, -5)
    expect(m).toEqual(
      (await pegar(c, `/v1/indicadores/kpis/${mensal}/serie`, { de: seisMeses, ate: HOJE, agrupamento: 'mes' }, 'beatriz')).body,
    )
  })

  it('permissao-por-kpi: o KPI de RH sem `pessoas.gerir` e o da vizinha não existem na resposta', async () => {
    const meu = await kpiNoBanco('novos_pacientes')
    const rh = await kpiNoBanco('conversas_1a1_em_dia')
    const vizinho = await kpiNoBanco('novos_pacientes', 'mensal', c.outraClinica)
    const r = await series([meu, rh, vizinho], 'beatriz')
    expect(r.statusCode).toBe(200)
    expect((r.body as SeriesDosKpis).itens.map((s) => s.kpiId)).toEqual([meu])
    // Controle: com `pessoas.gerir`, o de RH vem (a vizinha, nunca).
    const comRh = await series([meu, rh, vizinho], 'camila')
    expect((comRh.body as SeriesDosKpis).itens.map((s) => s.kpiId).sort()).toEqual([meu, rh].sort())
  })

  it('o pedido: teto de ids, sem repetição, sem lista vazia; sem `indicadores`, 403', async () => {
    const id = await kpiNoBanco('novos_pacientes')
    const demais = Array.from({ length: MAXIMO_DE_SERIES_POR_PEDIDO + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect((await series(demais)).statusCode).toBe(400)
    expect((await series([id, id])).statusCode).toBe(400)
    expect((await series([])).statusCode).toBe(400)
    expect((await series(['nao-e-uuid'])).statusCode).toBe(400)
    expect((await pegar(c, '/v1/indicadores/series', { ids: id, agrupamento: 'dia' }, 'beatriz')).statusCode).toBe(400)
    expect((await series([id], 'rita')).statusCode).toBe(403)
    // O teto exato passa.
    expect((await series([id, ...demais.slice(0, MAXIMO_DE_SERIES_POR_PEDIDO - 1)])).statusCode).toBe(200)
  })

  /**
   * R-7: o custo da tela principal com 20 KPIs. Medição, não asserção — roda
   * com `MEDIR_R7=1`. Compara as 20 rotas em paralelo (o que a tela fazia) com
   * o pedido único.
   */
  it.skipIf(process.env['MEDIR_R7'] !== '1')('R-7 medido: 20 KPIs, 20 rotas contra 1', async () => {
    // As 16 chaves que a `beatriz` vê sem parâmetro, e 4 `novos_pacientes` por origem: 20 KPIs.
    const ids: { id: string; semanal: boolean }[] = []
    const visiveis = CATALOGO_DE_KPIS.filter((k) => k.parametrosObrigatorios.length === 0 && k.permissaoDoValor !== 'pessoas.gerir')
    for (const [i, k] of visiveis.entries()) {
      const semanal = k.frequencias.some((x) => x === 'semanal') && i % 2 === 0
      ids.push({ id: await kpiNoBanco(k.chave, semanal ? 'semanal' : 'mensal'), semanal })
    }
    for (const origem of ['Instagram', 'Google', 'Indicação', 'Fachada']) {
      const r = await c.migrate.query<{ id: string }>(
        `INSERT INTO kpis (clinica_id, origem, chave_catalogo, parametros, nome, frequencia)
         VALUES ($1, 'catalogo', 'novos_pacientes', $2::jsonb, $3, 'semanal') RETURNING id`,
        [c.clinica, JSON.stringify({ origem }), origem],
      )
      ids.push({ id: r.rows[0]!.id, semanal: true })
    }
    expect(ids).toHaveLength(20)
    const seisMeses = somarMeses(`${HOJE.slice(0, 7)}-01`, -5)
    const umaPorKpi = () =>
      Promise.all(
        ids.map((k) =>
          pegar(c, `/v1/indicadores/kpis/${k.id}/serie`, k.semanal ? { agrupamento: 'semana' } : { de: seisMeses, ate: HOJE, agrupamento: 'mes' }, 'beatriz'),
        ),
      )
    const medir = async (f: () => Promise<unknown>): Promise<number[]> => {
      await f() // aquecimento
      const ts: number[] = []
      for (let i = 0; i < 5; i++) {
        const t = performance.now()
        await f()
        ts.push(Math.round(performance.now() - t))
      }
      return ts.sort((a, b) => a - b)
    }
    const antes = await medir(umaPorKpi)
    const depois = await medir(() => series(ids.map((k) => k.id)))
    console.log(`[R-7] 20 KPIs · 20 rotas em paralelo (ms, 5 rodadas): ${antes.join(', ')} · mediana ${antes[2]}`)
    console.log(`[R-7] 20 KPIs · 1 rota /series (ms, 5 rodadas): ${depois.join(', ')} · mediana ${depois[2]}`)
    expect((await series(ids.map((k) => k.id))).body.itens).toHaveLength(20)
  }, 300_000)
})

describe('S6 — lugar único: Metas do mês e cada campanha levam o id do KPI, nunca o valor', () => {
  const campanha = async (nome: string): Promise<string> =>
    (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO campanhas (clinica_id, nome, inicio, fim, metrica, meta) VALUES ($1, $2, '2026-10-01', '2026-10-31', 'receita', 500000) RETURNING id`,
        [c.clinica, nome],
      )
    ).rows[0]!.id

  it('kpiDoAtingimentoId: null sem o KPI; o id com ele vivo; null de novo arquivado', async () => {
    const rota = '/v1/metas-de-pessoa/2026-10'
    const antes = await pegar(c, rota, {}, 'camila')
    expect(antes.statusCode).toBe(200)
    expect(antes.body.kpiDoAtingimentoId).toBeNull()
    // O da vizinha não conta.
    await kpiNoBanco('atingimento_metas_individuais', 'mensal', c.outraClinica)
    expect((await pegar(c, rota, {}, 'camila')).body.kpiDoAtingimentoId).toBeNull()

    const id = await kpiNoBanco('atingimento_metas_individuais')
    expect((await pegar(c, rota, {}, 'camila')).body.kpiDoAtingimentoId).toBe(id)
    await c.migrate.query('UPDATE kpis SET arquivado_em = now() WHERE id = $1', [id])
    expect((await pegar(c, rota, {}, 'camila')).body.kpiDoAtingimentoId).toBeNull()
  })

  it('kpiDoResultadoId: cada campanha leva o SEU KPI vivo, na lista e no detalhe; sem ele, null', async () => {
    try {
      const comKpi = await campanha('Com KPI')
      const semKpi = await campanha('Sem KPI')
      const k = await c.migrate.query<{ id: string }>(
        `INSERT INTO kpis (clinica_id, origem, chave_catalogo, parametros, nome, frequencia)
         VALUES ($1, 'catalogo', 'resultado_de_campanha', $2::jsonb, 'Resultado', 'mensal') RETURNING id`,
        [c.clinica, JSON.stringify({ campanhaId: comKpi })],
      )
      const kpiId = k.rows[0]!.id
      const lista = await pegar(c, '/v1/campanhas', {}, 'beatriz')
      expect(lista.statusCode).toBe(200)
      const porId = new Map((lista.body.campanhas as { id: string; kpiDoResultadoId: string | null }[]).map((x) => [x.id, x.kpiDoResultadoId]))
      expect(porId.get(comKpi)).toBe(kpiId)
      expect(porId.get(semKpi)).toBeNull()
      expect((await pegar(c, `/v1/campanhas/${comKpi}`, {}, 'beatriz')).body.campanha.kpiDoResultadoId).toBe(kpiId)

      // Sem `valores`, o id atravessa (não é dinheiro) e o valor da campanha não.
      const sem = await pegar(c, `/v1/campanhas/${comKpi}`, {}, 'juliana')
      expect(sem.statusCode).toBe(200)
      expect(sem.body.campanha.kpiDoResultadoId).toBe(kpiId)
      expect(sem.body.campanha.metaEmDinheiro).toBeNull()

      await c.migrate.query('UPDATE kpis SET arquivado_em = now() WHERE id = $1', [kpiId])
      expect((await pegar(c, `/v1/campanhas/${comKpi}`, {}, 'beatriz')).body.campanha.kpiDoResultadoId).toBeNull()
    } finally {
      await c.migrate.query('DELETE FROM kpis WHERE clinica_id = $1', [c.clinica])
      await c.migrate.query('DELETE FROM campanhas WHERE clinica_id = $1', [c.clinica])
    }
  })
})
