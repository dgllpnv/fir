import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { apagarPacientesDaExportacaoDeTeste } from '../banco/limpeza-de-teste'
import {
  AGORA,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparEstoque,
  limparFinanceiro,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * Contraexemplos do `validador-numeros` sobre o T8 e a API do T5 (2026-11-17).
 * Números redondos, conferidos à mão no comentário de cada `it`.
 * HOJE = sábado 24/10/2026 (America/Bahia).
 */
let c: Cenario

const executar = (chave: string, filtros: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/relatorios/${chave}/execucoes`, { filtros }, quem)

async function receber(em: string, forma: string, valor: number, paciente: string): Promise<string> {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por)
     VALUES ($1, $2, 'Consulta realizada', $3, $4, $5::timestamptz, $6) RETURNING id`,
    [c.clinica, paciente, valor, forma, em, c.pessoas['juliana']],
  )
  return r.rows[0]!.id
}
const fecharCaixa = (dia: string) =>
  c.migrate.query(`INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1, $2::date, '', $3)`, [
    c.clinica,
    dia,
    c.pessoas['beatriz'],
  ])

beforeAll(async () => {
  c = await montarCenario('validador-t8')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir','estoque.gerir']
      WHERE clinica_id = $1 AND chave IN ('pf_sup')`,
    [c.clinica],
  )
})
afterAll(async () => {
  await apagarPacientesDaExportacaoDeTeste(c.migrate, c.clinica)
  await limparEstoque(c)
  await limparFinanceiro(c)
  await limparTarefas(c)
  for (const t of ['leituras_de_faturamento_externo', 'integracoes_da_clinica']) {
    await c.migrate.query(`DELETE FROM ${t} WHERE clinica_id = $1`, [c.clinica])
  }
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparEstoque(c)
  await limparFinanceiro(c)
  await limparTarefas(c)
  for (const t of ['leituras_de_faturamento_externo', 'integracoes_da_clinica']) {
    await c.migrate.query(`DELETE FROM ${t} WHERE clinica_id = $1`, [c.clinica])
  }
})

describe('validador — relatório 8', () => {
  it('v8-legado-sem-forma-e-estorno: setembro, Pix 41,00 + legado sem forma 50,00 + estornado 99,00 = 91,00 = Visão', async () => {
    await receber('2026-09-10T12:00:00Z', 'Pix', 4100, c.pacientes['ana']!)
    await receber('2026-09-11T12:00:00Z', '', 5000, c.pacientes['bruna']!)
    const est = await receber('2026-09-12T12:00:00Z', 'Dinheiro', 9900, c.pacientes['ana']!)
    await c.migrate.query('UPDATE recebimentos SET estornado_em = now() WHERE id = $1', [est])
    const r = await executar('recebimentos', { de: '2026-09-01', ate: '2026-09-30' })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const soma = (r.body.linhas as { valor: string }[]).reduce((s, l) => s + BigInt(l.valor), 0n)
    const v = await pegar(c, '/v1/visao-do-mes', { mes: '2026-09' }, 'beatriz')
    expect(v.statusCode).toBe(200)
    expect(soma).toBe(9100n)
    expect(v.body.recebido).toBe('9100')
    expect(r.body.resumo.total.emDinheiro).toBe('9100')
    expect(r.body.resumo.recebimentos).toBe(2)
  })

  it('v8-atravessa-o-mes: 25/09 sem caixa conta, 07/10 sem caixa aguarda, 05/10 fechado conta, hoje fica fora', async () => {
    await c.migrate.query(`UPDATE clinicas SET conferencia_desde = '2026-09-01' WHERE id = $1`, [c.clinica])
    await receber('2026-09-25T12:00:00Z', 'Pix', 1000, c.pacientes['ana']!)
    await receber('2026-10-05T12:00:00Z', 'Pix', 3000, c.pacientes['ana']!)
    await receber('2026-10-07T12:00:00Z', 'Dinheiro', 2000, c.pacientes['bruna']!)
    await receber('2026-10-24T15:00:00Z', 'Dinheiro', 400, c.pacientes['bruna']!)
    await fecharCaixa('2026-10-05')
    await c.migrate.query(`UPDATE clinicas SET conferencia_desde = '2026-09-01' WHERE id = $1`, [c.clinica])
    const r = await executar('recebimentos', { de: '2026-09-20', ate: HOJE })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    // Conta à mão: 1.000 + 3.000 = 4.000; aguardando 2.000; hoje (400) não atravessa.
    expect(r.body.resumo.total.emDinheiro).toBe('4000')
    expect(r.body.resumo.aguardandoFechamento).toBe('2000')
    const nulos = (r.body.linhas as { valor: string | null; forma: string | null }[]).filter((l) => l.valor === null)
    expect(nulos).toHaveLength(2)
    for (const l of nulos) expect(l.forma).toBeNull()
    expect(r.text).not.toMatch(/"400"/)
  })
})

describe('validador — relatório 11', () => {
  it('v11-ciclo-duplo-meio-centavo: custo 0,01/medida, dose 0,5, concluir→reabrir→concluir→reabrir dá 0 em quantidade e em centavos', async () => {
    const item = (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO itens_de_estoque (clinica_id, nome, medida, custo, aproveita_sobra) VALUES ($1, 'Item meio centavo', 'ml', 1, true) RETURNING id`,
        [c.clinica],
      )
    ).rows[0]!.id
    const mov = async (tipo: string, milesimos: number, dia: string, compensa: string | null = null) =>
      (
        await c.migrate.query<{ id: string }>(
          `INSERT INTO movimentos_de_estoque (clinica_id, item_id, tipo, milesimos, dia, motivo, compensa_id, compensa_motivo, criado_por, paciente_id)
           VALUES ($1, $2, $3, $4, $5::date, '', $6, $7, $8, $9) RETURNING id`,
          [c.clinica, item, tipo, milesimos, dia, compensa, compensa === null ? '' : 'sessao-reaberta', c.pessoas['nara'],
            tipo === 'consumo' && compensa === null ? c.pacientes['ana'] : null],
        )
      ).rows[0]!.id
    await mov('contagem', 5000, '2026-10-01')
    // Como `baixa-relacional.desfazer`: a compensação herda o DIA da origem.
    const b1 = await mov('consumo', -500, '2026-10-05')
    await mov('consumo', 500, '2026-10-05', b1)
    const b2 = await mov('consumo', -500, '2026-10-06')
    await mov('consumo', 500, '2026-10-06', b2)
    await mov('contagem', 5000, '2026-10-20')

    const r = await executar('saidas-de-estoque', { modo: 'analise', de: '2026-10-01', ate: '2026-10-31' })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const linhas = r.body.linhas as { quantidadeEmEstoque: { milesimos: string }; custo: string }[]
    expect(linhas.map((l) => l.quantidadeEmEstoque.milesimos)).toEqual(['500', '-500', '500', '-500'])
    expect(linhas.map((l) => l.custo)).toEqual(['1', '-1', '1', '-1'])
    expect(r.body.resumo.custo).toBe('0')
    const a = await pegar(c, '/v1/estoque/analise', { de: '2026-10-01', ate: '2026-10-31' }, 'beatriz')
    const doItem = (a.body.itens as { itemId: string; saidasEmEstoque: { milesimos: string } }[]).find((i) => i.itemId === item)!
    expect(doItem.saidasEmEstoque.milesimos).toBe('0')
  })
})

describe('validador — régua da série (T5)', () => {
  // DEFEITO V-T5-1 (validador, 2026-11-17): a série mede TODO balde pela régua da meta de HOJE.
  // Visão de setembro = R$ 100,00 (meta de setembro 'fir'); barra de setembro = null (MedX sem leitura).
  // Corrigido: cada balde pela régua do próprio mês (`medirPelaReguaDeCadaMes`).
  it('serie-mes-passado-regua-do-mes: setembro medido pela FIR na Visão; a barra de setembro da série tem de ser a mesma', async () => {
    // Setembro: meta 'fir' de R$ 1.000 e R$ 100 recebidos na FIR. Outubro: a clínica
    // passou ao MedX e a meta de outubro é 'medx' (R$ 200 lidos por dia).
    await c.migrate.query(
      `INSERT INTO integracoes_da_clinica
         (clinica_id, provedor, termo_assinado_em, termo_assinado_por, termo_versao, verificacao, verificada_em,
          conta_externa_id, faturamento_ligado, faturamento_ultimo_sucesso_em, faturamento_releitura_em, meta_medida_por)
       VALUES ($1, 'medx', '2026-10-01', 'Dra. X', 'v1', 'ok', now(), $2, true, $3, $3, 'medx')`,
      [c.clinica, `conta-validador-${c.clinica}`, AGORA],
    )
    for (let d = 1; d <= 24; d++) {
      await c.migrate.query(
        `INSERT INTO leituras_de_faturamento_externo
           (clinica_id, provedor, dia, faturamento_lido, faturamento_exato, quantidade_de_pagamentos, lido_em, leitura_id)
         VALUES ($1, 'medx', $2, 20000, 2000000, 1, $3, gen_random_uuid())`,
        [c.clinica, `2026-10-${String(d).padStart(2, '0')}`, AGORA],
      )
    }
    await receber('2026-09-10T12:00:00Z', 'Pix', 10000, c.pacientes['ana']!)
    const kpi = (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO kpis (clinica_id, origem, chave_catalogo, parametros, nome, frequencia, criado_em)
         VALUES ($1, 'catalogo', 'faturamento_conferido', '{}'::jsonb, 'Faturamento', 'mensal', '2026-08-01T12:00:00Z')
         ON CONFLICT DO NOTHING RETURNING id`,
        [c.clinica],
      )
    ).rows[0]?.id ??
      (
        await c.migrate.query<{ id: string }>(
          `SELECT id FROM kpis WHERE clinica_id = $1 AND chave_catalogo = 'faturamento_conferido' AND arquivado_em IS NULL`,
          [c.clinica],
        )
      ).rows[0]!.id
    for (const [inicio, prazo, medida] of [
      ['2026-09-01', '2026-09-30', 'fir'],
      ['2026-10-01', '2026-10-31', 'medx'],
    ] as const) {
      await c.migrate.query(
        `INSERT INTO metas_de_kpi (clinica_id, kpi_id, tipo, inicio, prazo, alvo_centavos, medida_por, definida_por)
         VALUES ($1, $2, 'mes', $3::date, $4::date, 100000, $5, $6)`,
        [c.clinica, kpi, inicio, prazo, medida, c.pessoas['beatriz']],
      )
    }
    const v = await pegar(c, '/v1/visao-do-mes', { mes: '2026-09' }, 'beatriz')
    expect(v.statusCode).toBe(200)
    const s = await pegar(c, `/v1/indicadores/kpis/${kpi}/serie`, { de: '2026-09-01', ate: HOJE, agrupamento: 'mes' }, 'beatriz')
    expect(s.statusCode, JSON.stringify(s.body)).toBe(200)
    const setembro = (s.body.pontos as { inicio: string; numero: { emDinheiro: string | null } }[]).find((p) => p.inicio === '2026-09-01')!
    expect(setembro.numero.emDinheiro).toBe(v.body.medido)
  })
})
