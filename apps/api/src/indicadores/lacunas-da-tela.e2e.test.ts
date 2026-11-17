import { arredondar, percentualInteiro } from '@fir/domain'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BancoService } from '../banco/banco.service'
import { SISTEMA } from '../banco/ator'
import { clinicaIdDeFonteConfiavel } from '../banco/clinica-id'
import {
  AGORA,
  type Cenario,
  desmontarCenario,
  limparFinanceiro,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'
import { materializarSeries } from './series-de-meta'

/**
 * As lacunas que a tela (T5) achou na API de Indicadores, contra Postgres REAL.
 *
 * HOJE = sábado 24/10/2026 (America/Bahia). A clínica é medida pelo MedX:
 * R$ 200 lidos em cada dia de 01 a 24/10, nenhum recebimento na FIR e nenhum
 * caixa (sem `conferencia_desde`, conta todo dia antes de hoje). Então
 * `D` = 01 a 23/10, 17 dias úteis, e o medido é 23 × R$ 200 = R$ 4.600.
 */
let c: Cenario
const MEDIDO = 23n * 20000n
const UTEIS_DE_D = 17n

const lerKpis = async (quem = 'beatriz') =>
  (await pegar(c, '/v1/indicadores', {}, quem).expect(200)).body.itens as {
    id: string
    chave: string | null
    atual: { emDinheiro: string | null }
    metaVigente: {
      alvo: { emDinheiro: string | null }
      ritmo: { emDinheiro: string | null; percentualDaMeta: number | null }
    } | null
    lancamentoPendente?: boolean
    ultimoLancamento?: { referencia: string; lancadoEm: string; autor: string | null } | null
  }[]

const kpiDeFaturamento = async (): Promise<string> =>
  (
    await c.migrate.query<{ id: string }>(
      `SELECT id FROM kpis WHERE clinica_id = $1 AND chave_catalogo = 'faturamento_conferido' AND arquivado_em IS NULL`,
      [c.clinica],
    )
  ).rows[0]!.id

const limpar = async () => {
  await c.migrate.query('DELETE FROM lancamentos_de_kpi WHERE clinica_id = $1', [c.clinica])
  await limparFinanceiro(c)
  for (const t of ['leituras_de_faturamento_externo', 'integracoes_da_clinica']) {
    await c.migrate.query(`DELETE FROM ${t} WHERE clinica_id = $1`, [c.clinica])
  }
}

beforeAll(async () => {
  c = await montarCenario('lacunas-da-tela')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir'] WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec')`,
    [c.clinica],
  )
})
afterAll(async () => {
  await limpar()
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limpar()
  await c.migrate.query(
    `INSERT INTO integracoes_da_clinica
       (clinica_id, provedor, termo_assinado_em, termo_assinado_por, termo_versao, verificacao, verificada_em,
        conta_externa_id, faturamento_ligado, faturamento_ultimo_sucesso_em, faturamento_releitura_em, meta_medida_por)
     VALUES ($1, 'medx', '2026-10-01', 'Dra. X', 'v1', 'ok', now(), $2, true, $3, $3, 'medx')`,
    [c.clinica, `conta-lacunas-${c.clinica}`, AGORA],
  )
  for (let d = 1; d <= 24; d++) {
    await c.migrate.query(
      `INSERT INTO leituras_de_faturamento_externo
         (clinica_id, provedor, dia, faturamento_lido, faturamento_exato, quantidade_de_pagamentos, lido_em, leitura_id)
       VALUES ($1, 'medx', $2, 20000, 2000000, 1, $3, gen_random_uuid())`,
      [c.clinica, `2026-10-${String(d).padStart(2, '0')}`, AGORA],
    )
  }
  await c.migrate.query(
    `INSERT INTO kpis (clinica_id, origem, chave_catalogo, parametros, nome, frequencia, criado_em)
     VALUES ($1, 'catalogo', 'faturamento_conferido', '{}'::jsonb, 'Faturamento', 'mensal', '2026-09-01T12:00:00Z')`,
    [c.clinica],
  )
})

describe('1. a prévia D.3 mede pela régua do cartão', () => {
  it('previa-mesma-regua-do-cartao: medida pelo MedX, a prévia não é R$ 0 por dia útil', async () => {
    const kpiId = await kpiDeFaturamento()
    const card = (await lerKpis()).find((k) => k.id === kpiId)!
    expect(card.atual.emDinheiro).toBe(String(MEDIDO))
    const p = await pegar(
      c,
      '/v1/indicadores/metas/previa',
      { kpiId, inicio: '2026-10-01', prazo: '2026-10-31', alvo: '1000000' },
      'beatriz',
    ).expect(200)
    // Antes: a prévia media pela FIR (sem recebimento) e dava '0'.
    expect(p.body.atualPorDiaUtil.emDinheiro).toBe(arredondar({ numerador: MEDIDO, denominador: UTEIS_DE_D }).toString())
  })
})

describe('2. o tique do ritmo esperado', () => {
  it('ritmo-tem-percentual-da-meta: ritmo ÷ alvo, inteiro, nunca sempre null', async () => {
    const kpiId = await kpiDeFaturamento()
    await postar(c, '/v1/indicadores/metas', { kpiId, tipo: 'mes', inicio: '2026-10-01', prazo: '2026-10-31', alvo: '1000000' }, 'beatriz').expect(201)
    const meta = (await lerKpis()).find((k) => k.id === kpiId)!.metaVigente!
    expect(meta.ritmo.percentualDaMeta).not.toBeNull()
    expect(meta.ritmo.percentualDaMeta).toBe(percentualInteiro(BigInt(meta.ritmo.emDinheiro!), 1000000n))
    // E sem `valores` o tique continua: o percentual não é monetário.
    const daEquipe = (await lerKpis('juliana')).find((k) => k.id === kpiId)!.metaVigente!
    expect(daEquipe.ritmo.emDinheiro).toBeNull()
    expect(daEquipe.ritmo.percentualDaMeta).toBe(meta.ritmo.percentualDaMeta)
  })
})

describe('3. a série tem escala e o agrupamento pedido', () => {
  it('serie-semanal-8-pontos-com-escala: 8 semanas, e sem `valores` a forma vem sem um centavo', async () => {
    const kpiId = await kpiDeFaturamento()
    const comValores = (await pegar(c, `/v1/indicadores/kpis/${kpiId}/serie`, { agrupamento: 'semana' }, 'beatriz').expect(200)).body
    expect(comValores.agrupamento).toBe('semana')
    expect(comValores.pontos).toHaveLength(8)
    expect(comValores.pontos[0].inicio).toBe('2026-08-31')
    const semValores = (await pegar(c, `/v1/indicadores/kpis/${kpiId}/serie`, { agrupamento: 'semana' }, 'juliana').expect(200)).body
    const ultimos = semValores.pontos.slice(-3) as { numero: { emDinheiro: string | null; escala: number | null } }[]
    // 05–11/10 e 12–18/10: R$ 1.400 cada (a maior); 19–24/10: R$ 1.000 (o 24 não conta).
    expect(ultimos.map((p) => p.numero.escala)).toEqual([100, 100, 71])
    for (const p of semValores.pontos as { numero: { emDinheiro: string | null } }[]) expect(p.numero.emDinheiro).toBeNull()
    expect(comValores.pontos.slice(-3).map((p: { numero: { emDinheiro: string } }) => p.numero.emDinheiro)).toEqual([
      '140000',
      '140000',
      '100000',
    ])
  })

  it('a série por dia de mais de um mês é 422', async () => {
    const kpiId = await kpiDeFaturamento()
    await pegar(c, `/v1/indicadores/kpis/${kpiId}/serie`, { de: '2026-09-01', ate: '2026-10-10', agrupamento: 'dia' }, 'beatriz').expect(422)
  })
})

describe('4. o KPI manual traz a faixa de pendente e o selo da fonte', () => {
  it('lancamento-pendente-e-ultimo-lancamento', async () => {
    const kpiId = (
      await postar(
        c,
        '/v1/indicadores/kpis',
        { origem: 'manual', nome: 'Avaliações no Google', pilar: 'Comercial', unidade: 'quantidade', direcao: 'maior', frequencia: 'mensal', diaDeLancamento: 5, comoMedir: '' },
        'beatriz',
      ).expect(201)
    ).body.id as string
    // O dia 5 já passou e outubro não tem lançamento: pendente.
    let k = (await lerKpis()).find((x) => x.id === kpiId)!
    expect(k.lancamentoPendente).toBe(true)
    expect(k.ultimoLancamento).toBeNull()

    await c.migrate.query(
      `INSERT INTO lancamentos_de_kpi (clinica_id, kpi_id, referencia, valor_numero, lancado_por, lancado_em)
       VALUES ($1, $2, '2026-10-01', 1200, $3, '2026-10-06T13:00:00Z')`,
      [c.clinica, kpiId, c.pessoas['beatriz']],
    )
    k = (await lerKpis()).find((x) => x.id === kpiId)!
    expect(k.lancamentoPendente).toBe(false)
    expect(k.ultimoLancamento).toEqual({ referencia: '2026-10-01', lancadoEm: '2026-10-06T13:00:00.000Z', autor: 'Beatriz' })

    // KPI de catálogo: nunca pendente, sem selo de lançamento.
    const cat = (await lerKpis()).find((x) => x.chave === 'faturamento_conferido')!
    expect(cat.lancamentoPendente).toBe(false)
    expect(cat.ultimoLancamento).toBeNull()
  })
})

describe('5. a meta recorrente (I-24)', () => {
  const metasDaSerie = async () =>
    (
      await c.migrate.query<{ inicio: string; prazo: string; alvo: string; arquivada: boolean }>(
        `SELECT inicio::text AS inicio, prazo::text AS prazo, alvo_centavos::text AS alvo, arquivada_em IS NOT NULL AS arquivada
           FROM metas_de_kpi WHERE clinica_id = $1 AND tipo = 'recorrente' ORDER BY inicio`,
        [c.clinica],
      )
    ).rows
  const rodarJob = () =>
    c.app
      .get(BancoService)
      .naClinica(clinicaIdDeFonteConfiavel(c.clinica), SISTEMA, (cx) =>
        materializarSeries(cx, clinicaIdDeFonteConfiavel(c.clinica), '2026-10-24'),
      )

  it('recorrente-idempotente: o mês pedido e o próximo nascem; o job ×3 não cria mais nada', async () => {
    const kpiId = await kpiDeFaturamento()
    const r = await postar(c, '/v1/indicadores/metas', { kpiId, tipo: 'recorrente', inicio: '2026-10-01', prazo: '2026-10-31', alvo: '1000000' }, 'beatriz').expect(201)
    expect(r.body.tipo).toBe('recorrente')
    expect(r.body.serieId).toEqual(expect.any(String))
    for (let i = 0; i < 3; i++) await rodarJob()
    expect(await metasDaSerie()).toEqual([
      { inicio: '2026-10-01', prazo: '2026-10-31', alvo: '1000000', arquivada: false },
      { inicio: '2026-11-01', prazo: '2026-11-30', alvo: '1000000', arquivada: false },
    ])
  })

  it('recorrente-pelo-validarMeta: fora do mês inteiro e com partida é 422', async () => {
    const kpiId = await kpiDeFaturamento()
    await postar(c, '/v1/indicadores/metas', { kpiId, tipo: 'recorrente', inicio: '2026-10-05', prazo: '2026-10-31', alvo: '1000000' }, 'beatriz').expect(422)
    await postar(c, '/v1/indicadores/metas', { kpiId, tipo: 'recorrente', inicio: '2026-10-01', prazo: '2026-10-31', alvo: '1000000', partida: '100' }, 'beatriz').expect(422)
    expect(await metasDaSerie()).toEqual([])
  })

  it('recorrente-arquivada-nao-renasce: arquivar encerra a série, e o job não recria o mês (regra 27)', async () => {
    const kpiId = await kpiDeFaturamento()
    const r = await postar(c, '/v1/indicadores/metas', { kpiId, tipo: 'recorrente', inicio: '2026-10-01', prazo: '2026-10-31', alvo: '1000000' }, 'beatriz').expect(201)
    await postar(c, `/v1/indicadores/metas/${r.body.id}/arquivar`, {}, 'beatriz').expect((x) => expect(x.status).toBeLessThan(300))
    await rodarJob()
    expect((await metasDaSerie()).map((m) => m.arquivada)).toEqual([true, true])
  })

  it('recorrente-mes-ocupado: o mês com outra meta viva fica sem a da série, e o job não falha', async () => {
    const kpiId = await kpiDeFaturamento()
    await postar(c, '/v1/indicadores/metas', { kpiId, tipo: 'ate_data', inicio: '2026-11-03', prazo: '2026-11-20', alvo: '500000' }, 'beatriz').expect(201)
    await postar(c, '/v1/indicadores/metas', { kpiId, tipo: 'recorrente', inicio: '2026-10-01', prazo: '2026-10-31', alvo: '1000000' }, 'beatriz').expect(201)
    await rodarJob()
    expect((await metasDaSerie()).map((m) => m.inicio)).toEqual(['2026-10-01'])
  })

  it('escrever-reais-sem-valores-403 também na recorrente', async () => {
    const kpiId = await kpiDeFaturamento()
    await postar(c, '/v1/indicadores/metas', { kpiId, tipo: 'recorrente', inicio: '2026-10-01', prazo: '2026-10-31', alvo: '1000000' }, 'juliana').expect(403)
  })
})
