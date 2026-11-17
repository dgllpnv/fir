import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
 * OKRs e resultados-chave — T4, contra Postgres REAL e a API inteira.
 *
 * HOJE = sábado 24/10/2026 (America/Bahia). `beatriz` (pf_sup) tem `valores`
 * e NÃO tem `pessoas.gerir`; `juliana` (pf_rec) NÃO tem `valores`. As duas
 * ganham `indicadores` e `indicadores.gerir` aqui.
 */
let c: Cenario

type Kr = { id: string; kpi: { id: string }; metaDoKr: { progresso: number | null; situacao: string; alvo: { emDinheiro: string | null; emNumero: string | null }; partida: { emNumero: string | null } } }
type Okr = { id: string; objetivo: string; periodo: { tipo: string; inicio: string; fim: string }; estado: string; progresso: number | null; situacao: string; avisoDeKrs: boolean; resultadosChave: Kr[] }

const OUTUBRO = { tipo: 'datas', inicio: '2026-10-01', fim: '2026-10-31' }

/** KPI manual (posição, I-5) em quantidade: o valor é o último lançamento do mês. */
const kpiManual = async (nome: string, clinica = c.clinica): Promise<string> => {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO kpis (clinica_id, origem, nome, pilar, unidade, direcao, frequencia, dia_de_lancamento)
     VALUES ($1, 'manual', $2, 'Comercial', 'quantidade', 'maior', 'mensal', 5) RETURNING id`,
    [clinica, nome],
  )
  return r.rows[0]!.id
}

const kpiDoCatalogo = async (chave: string, clinica = c.clinica): Promise<string> => {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia) VALUES ($1, 'catalogo', $2, $2, 'mensal') RETURNING id`,
    [clinica, chave],
  )
  return r.rows[0]!.id
}

/** Lançamento de outubro, em centésimos (3000 = 30,00). */
const lancar = (kpi: string, centesimos: number) =>
  c.migrate.query(
    `INSERT INTO lancamentos_de_kpi (clinica_id, kpi_id, referencia, valor_numero, lancado_por) VALUES ($1, $2, '2026-10-01', $3, $4)`,
    [c.clinica, kpi, centesimos, c.pessoas['beatriz']],
  )

const criarOkr = (corpo: Record<string, unknown>, quem = 'beatriz') => postar(c, '/v1/indicadores/okrs', corpo, quem)

beforeAll(async () => {
  c = await montarCenario('indicadores-t4')
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
})

describe('progresso e situação (números c.12)', () => {
  it('okr-media-dos-exibidos: 3 KRs exibidos com 30, 60 e 90 dão 60, e a situação é a pior', async () => {
    const kpis = [await kpiManual('Leads A'), await kpiManual('Leads B'), await kpiManual('Leads C')]
    for (const [i, k] of kpis.entries()) await lancar(k, [3000, 6000, 9000][i]!)
    const r = await criarOkr({
      objetivo: 'Ter uma agenda previsível',
      periodo: OUTUBRO,
      resultadosChave: kpis.map((kpiId) => ({ kpiId, alvo: '10000' })),
    })
    expect(r.statusCode).toBe(201)

    // Um 4º KR, de KPI de RH que a `beatriz` não pode ver (C5): não é exibido, e não entra na média.
    const rh = await kpiDoCatalogo('atingimento_metas_individuais')
    await c.migrate.query('BEGIN')
    const kr = await c.migrate.query<{ id: string }>(
      `INSERT INTO resultados_chave (clinica_id, okr_id, kpi_id, ordem) VALUES ($1, $2, $3, 4) RETURNING id`,
      [c.clinica, r.body.id, rh],
    )
    await c.migrate.query(
      `INSERT INTO metas_de_kpi (clinica_id, kpi_id, resultado_chave_id, tipo, inicio, prazo, alvo_numero, partida_numero)
       VALUES ($1, $2, $3, 'mes', '2026-10-01', '2026-10-31', 10000, 9999)`,
      [c.clinica, rh, kr.rows[0]!.id],
    )
    await c.migrate.query('COMMIT')

    const o = (await pegar(c, `/v1/indicadores/okrs/${r.body.id}`, {}, 'beatriz')).body as Okr
    expect(o.resultadosChave.map((x) => x.metaDoKr.progresso)).toEqual([30, 60, 90])
    expect(o.resultadosChave.map((x) => x.kpi.id)).not.toContain(rh)
    expect(o.progresso).toBe(60)
    // Ritmo em 24/10 de um mês de 31 dias: 77,4. O de 90 está no ritmo; os outros, abaixo.
    expect(o.resultadosChave.map((x) => x.metaDoKr.situacao)).toEqual(['abaixo', 'abaixo', 'no_ritmo'])
    expect(o.situacao).toBe('abaixo')
  })

  it('a lista vai do menor progresso para o maior', async () => {
    const a = await kpiManual('A')
    const b = await kpiManual('B')
    await lancar(a, 8000)
    await lancar(b, 2000)
    await criarOkr({ objetivo: 'Alto', periodo: OUTUBRO, resultadosChave: [{ kpiId: a, alvo: '10000' }] })
    await criarOkr({ objetivo: 'Baixo', periodo: OUTUBRO, resultadosChave: [{ kpiId: b, alvo: '10000' }] })
    const l = (await pegar(c, '/v1/indicadores/okrs', {}, 'beatriz')).body as { itens: Okr[] }
    expect(l.itens.map((x) => [x.objetivo, x.progresso])).toEqual([
      ['Baixo', 20],
      ['Alto', 80],
    ])
  })
})

describe('E.1 — criar, editar, encerrar, duplicar e arquivar', () => {
  it('o ciclo inteiro, com a partida recalculada ao duplicar', async () => {
    const a = await kpiManual('NPS')
    const b = await kpiManual('Avaliações')
    const novo = await kpiManual('Indicações')
    await lancar(a, 3000)

    const r = await criarOkr({
      objetivo: 'Encantar quem chega',
      porque: 'Indicação é o melhor canal',
      resultadosChave: [{ kpiId: a, alvo: '10000', partida: '1000' }, { kpiId: b, alvo: '5000' }],
    })
    expect(r.statusCode).toBe(201)
    const criado = r.body as Okr
    // Trimestre por padrão (E.2), pelo dia do SERVIDOR.
    expect(criado.periodo).toEqual({ tipo: 'trimestre', inicio: '2026-10-01', fim: '2026-12-31' })
    expect(criado.estado).toBe('ativo')
    const krB = criado.resultadosChave.find((x) => x.kpi.id === b)!
    const krA = criado.resultadosChave.find((x) => x.kpi.id === a)!

    // Editar: troca o alvo de A, tira B e põe um KR novo. O KR que sai é arquivado com a meta.
    const e = await botar(
      c,
      `/v1/indicadores/okrs/${criado.id}`,
      { objetivo: 'Encantar quem chega e volta', resultadosChave: [{ id: krA.id, kpiId: a, alvo: '9000' }, { kpiId: novo, alvo: '2000' }] },
      'beatriz',
    )
    expect(e.statusCode).toBe(200)
    const editado = e.body as Okr
    expect(editado.objetivo).toBe('Encantar quem chega e volta')
    expect(editado.resultadosChave.map((x) => [x.kpi.id, x.metaDoKr.alvo.emNumero])).toEqual([
      [a, '9000'],
      [novo, '2000'],
    ])
    const metaDeB = await c.migrate.query('SELECT 1 FROM metas_de_kpi WHERE resultado_chave_id = $1 AND arquivada_em IS NULL', [krB.id])
    expect(metaDeB.rowCount).toBe(0)
    // O indicador de um KR não muda.
    const troca = await botar(c, `/v1/indicadores/okrs/${criado.id}`, { resultadosChave: [{ id: krA.id, kpiId: b, alvo: '9000' }] }, 'beatriz')
    expect(troca.statusCode).toBe(422)

    // Encerrar: idempotente; encerrado não se edita.
    const enc = await postar(c, `/v1/indicadores/okrs/${criado.id}/encerrar`, {}, 'beatriz')
    expect(enc.statusCode).toBe(200)
    expect(enc.body.estado).toBe('encerrado')
    expect((await postar(c, `/v1/indicadores/okrs/${criado.id}/encerrar`, {}, 'beatriz')).statusCode).toBe(200)
    expect((await botar(c, `/v1/indicadores/okrs/${criado.id}`, { objetivo: 'Outro' }, 'beatriz')).statusCode).toBe(409)

    // Duplicar: o trimestre seguinte, os mesmos KPIs e alvos, e a partida de A = o valor de hoje (30,00).
    const d = await postar(c, `/v1/indicadores/okrs/${criado.id}/duplicar`, {}, 'beatriz')
    expect(d.statusCode).toBe(201)
    const dup = d.body as Okr
    expect(dup.id).not.toBe(criado.id)
    expect(dup.estado).toBe('ativo')
    expect(dup.periodo).toEqual({ tipo: 'trimestre', inicio: '2027-01-01', fim: '2027-03-31' })
    expect(dup.resultadosChave.map((x) => [x.kpi.id, x.metaDoKr.alvo.emNumero, x.metaDoKr.partida.emNumero])).toEqual([
      [a, '9000', '3000'],
      [novo, '2000', '0'],
    ])

    // Arquivar: some da lista e do detalhe; nada é apagado.
    expect((await postar(c, `/v1/indicadores/okrs/${criado.id}/arquivar`, {}, 'beatriz')).statusCode).toBe(200)
    expect((await pegar(c, `/v1/indicadores/okrs/${criado.id}`, {}, 'beatriz')).statusCode).toBe(404)
    const ids = ((await pegar(c, '/v1/indicadores/okrs', {}, 'beatriz')).body.itens as Okr[]).map((x) => x.id)
    expect(ids).toEqual([dup.id])
    const linha = await c.migrate.query('SELECT arquivado_em FROM okrs WHERE id = $1', [criado.id])
    expect(linha.rows[0].arquivado_em).not.toBeNull()
  })
})

describe('E.2 — de 1 a 5 KRs, aviso acima de 4, trimestre por padrão e datas livres', () => {
  it('o contrato recusa 0 e 6 KRs; com 5, a resposta avisa; com 4, não', async () => {
    const ks: string[] = []
    for (let i = 0; i < 6; i++) ks.push(await kpiManual(`K${i}`))
    expect((await criarOkr({ objetivo: 'Zero', resultadosChave: [] })).statusCode).toBe(400)
    expect((await criarOkr({ objetivo: 'Seis', resultadosChave: ks.map((kpiId) => ({ kpiId, alvo: '100' })) })).statusCode).toBe(400)
    const cinco = await criarOkr({ objetivo: 'Cinco', resultadosChave: ks.slice(0, 5).map((kpiId) => ({ kpiId, alvo: '100' })) })
    expect(cinco.statusCode).toBe(201)
    expect(cinco.body.avisoDeKrs).toBe(true)
    const quatro = await criarOkr({ objetivo: 'Quatro', resultadosChave: ks.slice(0, 4).map((kpiId) => ({ kpiId, alvo: '100' })) })
    expect(quatro.body.avisoDeKrs).toBe(false)
    // O mesmo KPI duas vezes no mesmo OKR: 422.
    expect((await criarOkr({ objetivo: 'Repetido', resultadosChave: [{ kpiId: ks[0], alvo: '100' }, { kpiId: ks[0], alvo: '200' }] })).statusCode).toBe(422)
  })

  it('a trigger da 0102 segura o banco: um 6º KR vivo, ou um OKR sem KR, não passa do COMMIT', async () => {
    const ks: string[] = []
    for (let i = 0; i < 6; i++) ks.push(await kpiManual(`T${i}`))
    const o = await criarOkr({ objetivo: 'Cinco', resultadosChave: ks.slice(0, 5).map((kpiId) => ({ kpiId, alvo: '100' })) })
    await c.migrate.query('BEGIN')
    await c.migrate.query('INSERT INTO resultados_chave (clinica_id, okr_id, kpi_id, ordem) VALUES ($1, $2, $3, 5)', [c.clinica, o.body.id, ks[5]])
    await expect(c.migrate.query('COMMIT')).rejects.toThrow(/de 1 a 5/)

    await c.migrate.query('BEGIN')
    await c.migrate.query(`INSERT INTO okrs (clinica_id, objetivo, inicio, fim) VALUES ($1, 'Vazio', '2026-10-01', '2026-12-31')`, [c.clinica])
    await expect(c.migrate.query('COMMIT')).rejects.toThrow(/de 1 a 5/)
  })

  it('datas livres valem; trimestre fora do 1º dia é 422', async () => {
    const k = await kpiManual('Livre')
    const livre = await criarOkr({ objetivo: 'Livre', periodo: { tipo: 'datas', inicio: '2026-10-10', fim: '2027-01-20' }, resultadosChave: [{ kpiId: k, alvo: '100' }] })
    expect(livre.statusCode).toBe(201)
    expect(livre.body.periodo).toEqual({ tipo: 'datas', inicio: '2026-10-10', fim: '2027-01-20' })
    const torto = await criarOkr({ objetivo: 'Torto', periodo: { tipo: 'trimestre', inicio: '2026-11-01' }, resultadosChave: [{ kpiId: k, alvo: '100' }] })
    expect(torto.statusCode).toBe(422)
  })

  it('alvo pior que a partida é 422', async () => {
    const k = await kpiManual('Pior')
    expect((await criarOkr({ objetivo: 'Pior', resultadosChave: [{ kpiId: k, alvo: '100', partida: '500' }] })).statusCode).toBe(422)
  })
})

describe('E.3 — o KPI ligado sai da faixa Saúde; o mesmo KPI em dois OKRs tem duas metas', () => {
  it('okrIds no cartão; duas metas, uma por KR, e a meta de saúde intacta', async () => {
    const ligado = await kpiManual('Ligado')
    const solto = await kpiManual('Solto')
    const o1 = await criarOkr({ objetivo: 'Um', resultadosChave: [{ kpiId: ligado, alvo: '1000' }] })
    const o2 = await criarOkr({ objetivo: 'Dois', resultadosChave: [{ kpiId: ligado, alvo: '2000' }] })
    expect([o1.statusCode, o2.statusCode]).toEqual([201, 201])

    const itens = (await pegar(c, '/v1/indicadores', {}, 'beatriz')).body.itens as { id: string; okrIds: string[]; metaVigente: unknown }[]
    expect(itens.find((x) => x.id === ligado)!.okrIds).toEqual([o1.body.id, o2.body.id].sort())
    expect(itens.find((x) => x.id === solto)!.okrIds).toEqual([])
    // A meta do KR não é a meta de saúde do cartão.
    expect(itens.find((x) => x.id === ligado)!.metaVigente).toBeNull()

    const metas = await c.migrate.query<{ alvo: string }>(
      `SELECT alvo_numero::text AS alvo FROM metas_de_kpi WHERE kpi_id = $1 AND arquivada_em IS NULL AND resultado_chave_id IS NOT NULL ORDER BY alvo_numero`,
      [ligado],
    )
    expect(metas.rows.map((m) => m.alvo)).toEqual(['1000', '2000'])

    // Encerrado, o OKR solta o KPI de volta para a faixa Saúde.
    await postar(c, `/v1/indicadores/okrs/${o1.body.id}/encerrar`, {}, 'beatriz')
    await postar(c, `/v1/indicadores/okrs/${o2.body.id}/encerrar`, {}, 'beatriz')
    const depois = (await pegar(c, '/v1/indicadores', {}, 'beatriz')).body.itens as { id: string; okrIds: string[] }[]
    expect(depois.find((x) => x.id === ligado)!.okrIds).toEqual([])
  })

  it('KR de campanha: o alvo é a meta da campanha, travado', async () => {
    const camp = await c.migrate.query<{ id: string }>(
      `INSERT INTO campanhas (clinica_id, nome, inicio, fim, metrica, meta) VALUES ($1, 'Outubro Rosa', '2026-10-01', '2026-10-31', 'convertidos', 12) RETURNING id`,
      [c.clinica],
    )
    try {
      const k = await c.migrate.query<{ id: string }>(
        `INSERT INTO kpis (clinica_id, origem, chave_catalogo, parametros, nome, frequencia)
         VALUES ($1, 'catalogo', 'resultado_de_campanha', $2::jsonb, 'Campanha', 'mensal') RETURNING id`,
        [c.clinica, JSON.stringify({ campanhaId: camp.rows[0]!.id })],
      )
      const kpiId = k.rows[0]!.id
      expect((await criarOkr({ objetivo: 'Rosa', periodo: OUTUBRO, resultadosChave: [{ kpiId, alvo: '500' }] })).statusCode).toBe(422)
      const r = await criarOkr({ objetivo: 'Rosa', periodo: OUTUBRO, resultadosChave: [{ kpiId }] })
      expect(r.statusCode).toBe(201)
      const kr = (r.body as Okr).resultadosChave[0]!
      expect(kr.metaDoKr.alvo.emNumero).toBe('1200')
      expect((kr as unknown as { alvoTravado: boolean }).alvoTravado).toBe(true)
    } finally {
      await limparIndicadores(c)
      await c.migrate.query('DELETE FROM campanhas WHERE id = $1', [camp.rows[0]!.id])
    }
  })
})

describe('permissão e clínica (appsec C3, C6)', () => {
  it('escrever-reais-sem-valores-403: criar, editar e DUPLICAR KR em reais sem `valores` (com o controle)', async () => {
    const fat = await kpiDoCatalogo('faturamento_conferido')
    const manual = await kpiManual('Manual')
    const r = await criarOkr({ objetivo: 'Faturar', resultadosChave: [{ kpiId: fat, alvo: '1000000' }, { kpiId: manual, alvo: '100' }] })
    expect(r.statusCode).toBe(201)
    const krFat = (r.body as Okr).resultadosChave.find((x) => x.kpi.id === fat)!
    const krManual = (r.body as Okr).resultadosChave.find((x) => x.kpi.id === manual)!

    expect((await criarOkr({ objetivo: 'X', resultadosChave: [{ kpiId: fat, alvo: '1000000' }] }, 'juliana')).statusCode).toBe(403)
    expect(
      (
        await botar(
          c,
          `/v1/indicadores/okrs/${r.body.id}`,
          { resultadosChave: [{ id: krFat.id, kpiId: fat, alvo: '2000000' }, { id: krManual.id, kpiId: manual }] },
          'juliana',
        )
      ).statusCode,
    ).toBe(403)
    expect((await postar(c, `/v1/indicadores/okrs/${r.body.id}/duplicar`, {}, 'juliana')).statusCode).toBe(403)

    // Controle: a MESMA juliana edita o texto e duplica um OKR sem reais.
    expect((await botar(c, `/v1/indicadores/okrs/${r.body.id}`, { objetivo: 'Faturar mais' }, 'juliana')).statusCode).toBe(200)
    const semReais = await criarOkr({ objetivo: 'Sem reais', resultadosChave: [{ kpiId: manual, alvo: '100' }] }, 'juliana')
    expect(semReais.statusCode).toBe(201)
    expect((await postar(c, `/v1/indicadores/okrs/${semReais.body.id}/duplicar`, {}, 'juliana')).statusCode).toBe(201)

    // E a leitura dela sai sem o alvo em reais; a da beatriz, com (mutação).
    const daJuliana = await pegar(c, `/v1/indicadores/okrs/${r.body.id}`, {}, 'juliana')
    expect(daJuliana.text).not.toContain('1000000')
    expect((daJuliana.body as Okr).resultadosChave.find((x) => x.kpi.id === fat)!.metaDoKr.alvo.emDinheiro).toBeNull()
    expect((await pegar(c, `/v1/indicadores/okrs/${r.body.id}`, {}, 'beatriz')).text).toContain('1000000')
  })

  it('ids-de-outra-clinica: o OKR, o KPI e o responsável da vizinha são 404/422, nunca 500', async () => {
    const kVizinho = await kpiManual('Da vizinha', c.outraClinica)
    const okrVizinho = await c.migrate.query<{ id: string }>(
      `WITH o AS (INSERT INTO okrs (clinica_id, objetivo, inicio, fim) VALUES ($1, 'Dela', '2026-10-01', '2026-12-31') RETURNING id),
            k AS (INSERT INTO resultados_chave (clinica_id, okr_id, kpi_id, ordem) SELECT $1, o.id, $2, 1 FROM o RETURNING okr_id)
       SELECT okr_id AS id FROM k`,
      [c.outraClinica, kVizinho],
    )
    const id = okrVizinho.rows[0]!.id
    expect((await pegar(c, `/v1/indicadores/okrs/${id}`, {}, 'beatriz')).statusCode).toBe(404)
    expect((await botar(c, `/v1/indicadores/okrs/${id}`, { objetivo: 'Meu' }, 'beatriz')).statusCode).toBe(404)
    expect((await postar(c, `/v1/indicadores/okrs/${id}/encerrar`, {}, 'beatriz')).statusCode).toBe(404)
    expect((await postar(c, `/v1/indicadores/okrs/${id}/duplicar`, {}, 'beatriz')).statusCode).toBe(404)
    expect((await postar(c, `/v1/indicadores/okrs/${id}/arquivar`, {}, 'beatriz')).statusCode).toBe(404)
    expect(((await pegar(c, '/v1/indicadores/okrs', {}, 'beatriz')).body.itens as Okr[]).map((x) => x.id)).not.toContain(id)

    expect((await criarOkr({ objetivo: 'KPI dela', resultadosChave: [{ kpiId: kVizinho, alvo: '100' }] })).statusCode).toBe(404)

    const meu = await kpiManual('Meu')
    const pessoaDela = await c.migrate.query<{ id: string }>('SELECT id FROM pessoas WHERE clinica_id = $1 LIMIT 1', [c.outraClinica])
    const resp = await criarOkr({ objetivo: 'Responsável dela', responsavelId: pessoaDela.rows[0]!.id, resultadosChave: [{ kpiId: meu, alvo: '100' }] })
    expect(resp.statusCode).toBe(422)

    // O KR de outro OKR (da mesma clínica) também não entra pela edição.
    const a = await criarOkr({ objetivo: 'A', resultadosChave: [{ kpiId: meu, alvo: '100' }] })
    const outro = await kpiManual('Outro')
    const b = await criarOkr({ objetivo: 'B', resultadosChave: [{ kpiId: outro, alvo: '100' }] })
    const krDeB = (b.body as Okr).resultadosChave[0]!.id
    expect((await botar(c, `/v1/indicadores/okrs/${a.body.id}`, { resultadosChave: [{ id: krDeB, kpiId: outro, alvo: '100' }] }, 'beatriz')).statusCode).toBe(404)
  })

  it('sem `indicadores`, 403; sem `indicadores.gerir`, só leitura', async () => {
    expect((await pegar(c, '/v1/indicadores/okrs', {}, 'camila')).statusCode).toBe(403)
    await c.migrate.query(`UPDATE perfis SET perms = array_remove(perms, 'indicadores.gerir') WHERE clinica_id = $1 AND chave = 'pf_rec'`, [c.clinica])
    try {
      const k = await kpiManual('Leitura')
      expect((await pegar(c, '/v1/indicadores/okrs', {}, 'juliana')).statusCode).toBe(200)
      expect((await criarOkr({ objetivo: 'Não', resultadosChave: [{ kpiId: k, alvo: '100' }] }, 'juliana')).statusCode).toBe(403)
    } finally {
      await c.migrate.query(`UPDATE perfis SET perms = perms || ARRAY['indicadores.gerir'] WHERE clinica_id = $1 AND chave = 'pf_rec'`, [c.clinica])
    }
  })

  it('log sem o texto livre (LGPD R-e): objetivo e porque não vão para log nem para a mensagem de erro', async () => {
    const espioes = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m))
    try {
      const k = await kpiManual('Texto')
      const r = await criarOkr({ objetivo: 'Objetivo-sigiloso-XYZ', porque: 'Porque-sigiloso-XYZ', resultadosChave: [{ kpiId: k, alvo: '100', partida: '900' }] })
      expect(r.statusCode).toBe(422)
      expect(r.text).not.toContain('sigiloso')
      const linhas = espioes.flatMap((e) => e.mock.calls.map((x) => x.map(String).join(' ')))
      expect(linhas.join('\n')).not.toContain('sigiloso')
    } finally {
      for (const e of espioes) e.mockRestore()
    }
  })
})

describe('prioridades do trimestre (revisão P1): o servidor dá {quantos, media}, e a lista e a capa dão o mesmo', () => {
  it('só os ATIVOS que tocam o trimestre; o encerrado e o do trimestre seguinte ficam fora', async () => {
    const [a, b, e, f] = [await kpiManual('P-A'), await kpiManual('P-B'), await kpiManual('P-E'), await kpiManual('P-F')]
    await lancar(a, 3000)
    await lancar(b, 9000)
    await lancar(e, 1000)
    const ra = await criarOkr({ objetivo: 'Trinta', periodo: OUTUBRO, responsavelId: c.pessoas['beatriz'], resultadosChave: [{ kpiId: a, alvo: '10000' }] })
    const rb = await criarOkr({ objetivo: 'Noventa', periodo: OUTUBRO, resultadosChave: [{ kpiId: b, alvo: '10000' }] })
    const re = await criarOkr({ objetivo: 'Encerrado', periodo: OUTUBRO, resultadosChave: [{ kpiId: e, alvo: '10000' }] })
    const rf = await criarOkr({ objetivo: 'Futuro', periodo: { tipo: 'trimestre', inicio: '2027-01-01' }, resultadosChave: [{ kpiId: f, alvo: '10000' }] })
    for (const r of [ra, rb, re, rf]) expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    expect((await postar(c, `/v1/indicadores/okrs/${re.body.id}/encerrar`, {}, 'beatriz')).statusCode).toBe(200)

    const l = await pegar(c, '/v1/indicadores/okrs', {}, 'beatriz')
    expect(l.statusCode).toBe(200)
    // Os quatro na lista; na faixa, só Trinta e Noventa: média 60, não 43 (com o encerrado).
    expect((l.body as { itens: Okr[] }).itens).toHaveLength(4)
    expect(l.body.prioridades).toEqual({ quantos: 2, media: 60, trimestre: { inicio: '2026-10-01', fim: '2026-12-31' } })

    // A capa da TV: o MESMO número, na mesma semana.
    const capa = (await pegar(c, '/v1/indicadores/reuniao', {}, 'beatriz')).body.capa as { prioridades: unknown }
    expect(capa.prioridades).toEqual({ quantos: 2, media: 60 })

    // Os filtros da tela mudam só a faixa.
    const minha = await pegar(c, '/v1/indicadores/okrs', { responsavel: c.pessoas['beatriz']! }, 'beatriz')
    expect(minha.body.prioridades).toMatchObject({ quantos: 1, media: 30 })
    const proximo = await pegar(c, '/v1/indicadores/okrs', { trimestre: '2027-01-01' }, 'beatriz')
    expect(proximo.body.prioridades).toEqual({ quantos: 1, media: null, trimestre: { inicio: '2027-01-01', fim: '2027-03-31' } })
    expect((proximo.body as { itens: Okr[] }).itens).toHaveLength(4)
    expect((await pegar(c, '/v1/indicadores/okrs', { trimestre: '2026-10-15' }, 'beatriz')).statusCode).toBe(422)
    expect((await pegar(c, '/v1/indicadores/okrs', { outro: '1' }, 'beatriz')).statusCode).toBe(400)
  })
})
