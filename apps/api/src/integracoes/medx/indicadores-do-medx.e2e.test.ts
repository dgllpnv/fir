import type { Painel, PercentualDaMeta, VisaoDoMes } from '@fir/contracts'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { declararAtorSistema } from '../../banco/limpeza-de-teste'
import { AGORA, botar, type Cenario, desmontarCenario, montarCenario, pegar } from '../../tarefas/__tests__/cenario'

/**
 * O faturamento do MedX nos Indicadores (spec integracao-medx C.8–C.11; T7),
 * contra Postgres REAL.
 *
 * AGORA = 25/10 02:00Z = 24/10 23:00 na clínica. Outubro:
 *
 *   dia   MedX      FIR      caixa
 *   20    150,01*   150,00   fechado     (* exato 150,0050: 1 centavo de arredondamento)
 *   21    100,00     80,00   fechado
 *   24     77,77     55,55   ABERTO      ← hoje: nenhum número dele sai (regra 6)
 */
let c: Cenario
const MES = '2026-10'

const lerPainel = async (quem = 'beatriz') => (await pegar(c, '/v1/painel', { periodo: 'mes' }, quem).expect(200)).body as Painel
const lerMeta = async (quem = 'beatriz') =>
  (await pegar(c, `/v1/metas/${MES}/percentual`, {}, quem).expect(200)).body as PercentualDaMeta
const lerVisao = async () => (await pegar(c, '/v1/visao-do-mes', { mes: MES }, 'beatriz').expect(200)).body as VisaoDoMes

const medx = async (dia: string, centavos: number, exato = centavos * 100) =>
  c.migrate.query(
    `INSERT INTO leituras_de_faturamento_externo
       (clinica_id, provedor, dia, faturamento_lido, faturamento_exato, quantidade_de_pagamentos, lido_em, leitura_id)
     VALUES ($1, 'medx', $2, $3, $4, $5, $6, gen_random_uuid())`,
    [c.clinica, dia, centavos, exato, centavos === 0 ? 0 : 1, AGORA],
  )
const fir = async (instante: string, valor: number) =>
  c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
     VALUES ($1, $2, 'Pagamento de consulta', $3, 'Pix', 0, $4::timestamptz, $5)`,
    [c.clinica, c.pacientes['ana'], valor, instante, c.pessoas['beatriz']],
  )
const configurar = (x: { ligado?: boolean; medidaPor?: 'fir' | 'medx' }) =>
  c.migrate.query(
    'UPDATE integracoes_da_clinica SET faturamento_ligado = $2, meta_medida_por = $3 WHERE clinica_id = $1',
    [c.clinica, x.ligado ?? true, x.medidaPor ?? 'fir'],
  )

beforeAll(async () => {
  c = await montarCenario('medx-indicadores')
  // Recebimento (e suas partes) é imutável: semeado uma vez, igual em todos os testes.
  await fir('2026-10-20T15:00:00Z', 15000)
  await fir('2026-10-21T15:00:00Z', 8000)
  await fir('2026-10-24T15:00:00Z', 5555)
})
afterAll(async () => {
  for (const t of ['leituras_de_faturamento_externo', 'metas_de_kpi', 'metas_do_mes', 'caixas_do_dia', 'integracoes_da_clinica']) {
    await c.migrate.query(`DELETE FROM ${t} WHERE clinica_id = $1`, [c.clinica])
  }
  await desmontarCenario(c)
})
beforeEach(async () => {
  for (const t of ['leituras_de_faturamento_externo', 'metas_de_kpi', 'metas_do_mes', 'caixas_do_dia', 'integracoes_da_clinica']) {
    await c.migrate.query(`DELETE FROM ${t} WHERE clinica_id = $1`, [c.clinica])
  }
  await c.migrate.query(
    `INSERT INTO integracoes_da_clinica
       (clinica_id, provedor, termo_assinado_em, termo_assinado_por, termo_versao, verificacao, verificada_em,
        conta_externa_id, faturamento_ligado, faturamento_ultimo_sucesso_em, faturamento_releitura_em)
     VALUES ($1, 'medx', '2026-10-01', 'Dra. X', 'v1', 'ok', now(), $2, true, $3, $3)`,
    [c.clinica, `conta-ind-${c.clinica}`, AGORA],
  )
  for (let d = 1; d <= 24; d++) {
    const dia = `2026-10-${String(d).padStart(2, '0')}`
    await medx(dia, d === 20 ? 15001 : d === 21 ? 10000 : d === 24 ? 7777 : 0, d === 20 ? 1500050 : undefined)
  }
  for (const dia of ['2026-10-20', '2026-10-21']) {
    await c.migrate.query('INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1, $2, \'\', $3)', [
      c.clinica,
      dia,
      c.pessoas['beatriz'],
    ])
  }
})

describe('Faturamento no MedX e Conferência MedX × FIR (Painel)', () => {
  it('lado a lado, só com os dias de caixa fechado', async () => {
    const m = (await lerPainel()).medx
    expect(m).toEqual({
      faturamentoNoMedx: '25001',
      recebidoNaFir: '23000',
      diferencaMedxFir: '2001',
      totalExato: '2500050',
      arredondamentoDoMedx: '1',
      diasComDiferenca: [
        { dia: '2026-10-20', diferencaMedxFir: '1' },
        { dia: '2026-10-21', diferencaMedxFir: '2000' },
      ],
      recorte: { ateODia: '2026-10-21', diasSemCaixa: 1 },
      leituraIncompleta: false,
      lidoEm: AGORA.toISOString(),
    })
  })

  it('regra 6: antes do caixa de hoje fechar, nenhum número de hoje sai na resposta', async () => {
    const r = await pegar(c, '/v1/painel', { periodo: 'mes' }, 'beatriz').expect(200)
    const medxNoFio = JSON.stringify((r.body as Painel).medx)
    for (const deHoje of ['7777', '5555', '2222', '-2222', '32778', '28555']) expect(medxNoFio).not.toContain(deHoje)
    // Fechou o caixa de hoje: hoje entra.
    await c.migrate.query("INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1, '2026-10-24', '', $2)", [
      c.clinica,
      c.pessoas['beatriz'],
    ])
    const m = (await lerPainel()).medx!
    expect(m).toMatchObject({ faturamentoNoMedx: '32778', recebidoNaFir: '28555', recorte: { ateODia: '2026-10-24', diasSemCaixa: 0 } })
    expect(m.diasComDiferenca.at(-1)).toEqual({ dia: '2026-10-24', diferencaMedxFir: '2222' })
  })

  it('dia sem leitura: "leitura incompleta", e o dia não vira zero', async () => {
    await c.migrate.query("DELETE FROM leituras_de_faturamento_externo WHERE clinica_id = $1 AND dia = '2026-10-21'", [c.clinica])
    const m = (await lerPainel()).medx!
    expect(m.leituraIncompleta).toBe(true)
    expect(m.faturamentoNoMedx).toBe('15001')
  })

  it('sem o faturamento do MedX ligado, o bloco não existe', async () => {
    await configurar({ ligado: false })
    expect((await lerPainel()).medx).toBe(null)
  })

  it('o Painel exige `painel` (que exige `valores`): sem ele, 403', async () => {
    await pegar(c, '/v1/painel', { periodo: 'mes' }, 'juliana').expect(403)
  })

  it('C.11: uma substituição na trilha (`GET /v1/auditoria`) não entrega o faturamento sem `valores`', async () => {
    await declararAtorSistema(c.migrate)
    await c.migrate.query(
      `UPDATE leituras_de_faturamento_externo SET faturamento_lido = 16999, faturamento_exato = 1699900, quantidade_de_pagamentos = 3
        WHERE clinica_id = $1 AND dia = '2026-10-20'`,
      [c.clinica],
    )
    const consulta = { entidade: 'leituras_de_faturamento_externo', limite: '5' }
    const comValores = JSON.stringify((await pegar(c, '/v1/auditoria', consulta, 'beatriz').expect(200)).body)
    expect(comValores).toContain('16999')
    // `config` sem `valores`: a trilha chega, os centavos e a contagem de pagamentos não.
    await c.migrate.query("UPDATE perfis SET perms = array_append(perms, 'config') WHERE clinica_id = $1 AND chave = 'pf_rec'", [c.clinica])
    try {
      const r = (await pegar(c, '/v1/auditoria', consulta, 'juliana').expect(200)).body as { itens: unknown[] }
      expect(r.itens.length).toBeGreaterThan(0)
      const semValores = JSON.stringify(r)
      for (const centavos of ['16999', '15001', '1699900', '1500050']) expect(semValores).not.toContain(centavos)
      expect(semValores).toContain('"quantidade_de_pagamentos":null')
    } finally {
      await c.migrate.query("UPDATE perfis SET perms = array_remove(perms, 'config') WHERE clinica_id = $1 AND chave = 'pf_rec'", [c.clinica])
    }
  })

  it('o número do MedX não entra no resto do Painel (receita, top pagantes)', async () => {
    const p = await lerPainel()
    const resto = JSON.stringify({ ...p, medx: null })
    for (const doMedx of ['15001', '25001', '32778', '2500050']) expect(resto).not.toContain(doMedx)
  })
})

describe('a meta medida pelo MedX (N-B6)', () => {
  it('a régua é copiada da configuração quando a meta é definida; o percentual da rota é o da Visão do mês', async () => {
    await configurar({ medidaPor: 'medx' })
    const salva = (await botar(c, `/v1/metas/${MES}`, { valor: '50000' }, 'beatriz').expect(200)).body as PercentualDaMeta
    // ADR 2026-11-17-meta-medida-pelos-dias-de-caixa (números B5/B6): a régua
    // do MedX passa pelo MESMO corte da FIR. O primeiro caixa é 20/10, então
    // 01–19 ficam no regime anterior e contam; 20 e 21 fecharam; 24 (hoje,
    // aberto) aguarda. 150,01 + 100,00 = 250,01 de 500,00 → 50% (era 66%, com
    // os 77,77 do dia aberto). `recebido` continua o da FIR, o mês inteiro.
    expect(salva).toEqual({
      mes: MES,
      meta: '50000',
      recebido: '28555',
      medidaPor: 'medx',
      medido: '25001',
      lidoEm: AGORA.toISOString(),
      percentual: 50,
      // O de hoje (55,55) nunca sai: com o caixa aberto, é o esperado (regra 6).
      aguardandoFechamento: '0',
      diasAguardandoFechamento: 1,
    })
    const v = await lerVisao()
    expect(v).toMatchObject({ medidaDaMeta: 'medx', medido: '25001', recebido: '28555', percentualDaMeta: 50, metaRestante: '24999' })
  })

  it('14. retroatividade: trocar a configuração não muda mês que já tem meta', async () => {
    await configurar({ medidaPor: 'fir' })
    await botar(c, `/v1/metas/${MES}`, { valor: '50000' }, 'beatriz').expect(200)
    // ADR 2026-11-17-meta-medida-pelos-dias-de-caixa: 150 + 80 = 230 de 500 →
    // 46% (era 57%, com os 55,55 de hoje, que tem o caixa aberto).
    expect((await lerMeta()).percentual).toBe(46)
    await configurar({ medidaPor: 'medx' })
    expect(await lerMeta()).toMatchObject({ medidaPor: 'fir', percentual: 46 })
    expect((await lerVisao()).percentualDaMeta).toBe(46)
  })

  it('MedX com leitura incompleta: sem percentual e sem "faltam" — nunca 0%', async () => {
    await configurar({ medidaPor: 'medx' })
    await botar(c, `/v1/metas/${MES}`, { valor: '50000' }, 'beatriz').expect(200)
    await c.migrate.query("DELETE FROM leituras_de_faturamento_externo WHERE clinica_id = $1 AND dia = '2026-10-03'", [c.clinica])
    expect(await lerMeta()).toMatchObject({ medidaPor: 'medx', medido: null, percentual: null })
    expect(await lerVisao()).toMatchObject({ percentualDaMeta: null, metaRestante: null, recebido: '28555' })
  })

  it('MedX só com o faturamento ligado: configurado, mas desligado, a meta nova é da FIR', async () => {
    await configurar({ ligado: false, medidaPor: 'medx' })
    expect(((await botar(c, `/v1/metas/${MES}`, { valor: '50000' }, 'beatriz').expect(200)).body as PercentualDaMeta).medidaPor).toBe('fir')
  })

  it('sem `valores`: atravessam o percentual, a régua e a hora da leitura — nenhum centavo', async () => {
    await configurar({ medidaPor: 'medx' })
    await botar(c, `/v1/metas/${MES}`, { valor: '50000' }, 'beatriz').expect(200)
    expect(await lerMeta('juliana')).toEqual({
      mes: MES,
      meta: null,
      recebido: null,
      medidaPor: 'medx',
      medido: null,
      lidoEm: AGORA.toISOString(),
      // ADR 2026-11-17-meta-medida-pelos-dias-de-caixa: 50% (era 66%).
      percentual: 50,
      // O valor aguardando é dinheiro: a redação o apaga. A contagem atravessa.
      aguardandoFechamento: null,
      diasAguardandoFechamento: 1,
    })
  })
})
