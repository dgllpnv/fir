import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  limparFinanceiro,
  limparTarefas,
  montarCenario,
  pegar,
} from '../tarefas/__tests__/cenario'

/**
 * Validação de números do T2 (validador-numeros, 2026-11-17). Contraexemplos
 * congelados contra Postgres REAL e a API inteira. Os marcados DEFEITO falham
 * hoje de propósito: são a prova, e a correção é do T2.
 *
 * HOJE = sábado 24/10/2026 (America/Bahia). `beatriz` tem `valores`.
 */
let c: Cenario

type Valor = { emDinheiro: string | null }
type Item = {
  id: string
  chave: string
  atual: Valor
  anterior: Valor | null
  variacao: { tipo: string; percentual?: number } | null
}
type Ponto = { inicio: string; diaAguardando: boolean; numero: Valor }

const recebimento = (instante: string, valor: string, tarefaId: string | null = null, tipo = 'Pagamento de consulta') =>
  c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, tipo, valor, valor_aberto, forma, recebido_em, registrado_por)
     VALUES ($1, $2, $3, $4, $5, 0, 'Pix', $6::timestamptz, $7)`,
    [c.clinica, c.pacientes['ana'], tarefaId, tipo, valor, instante, c.pessoas['beatriz']],
  )

const tarefaConcluida = async (tipo: string, concluidaEm: string, campanhaId: string | null = null): Promise<string> => {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em,
                          criada_em, paciente_id, tipo, historico, campanha_id)
     VALUES ($1, $2, $2, 'fixture', ($3::timestamptz AT TIME ZONE 'America/Bahia')::date, 'concluida', $3::timestamptz,
             $3::timestamptz, $4, $5, '[]'::jsonb, $6) RETURNING id`,
    [c.clinica, c.pessoas['beatriz'], concluidaEm, c.pacientes['ana'], tipo, campanhaId],
  )
  return r.rows[0]!.id
}

const kpi = async (chave: string, parametros: Record<string, string> = {}): Promise<string> => {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO kpis (clinica_id, origem, chave_catalogo, parametros, nome, frequencia, criado_em)
     VALUES ($1, 'catalogo', $2, $3::jsonb, $2, 'mensal', '2026-09-01T12:00:00Z') RETURNING id`,
    [c.clinica, chave, JSON.stringify(parametros)],
  )
  return r.rows[0]!.id
}

const caixaFechado = (dia: string) =>
  c.migrate.query(`INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1, $2::date, '', $3)`, [
    c.clinica,
    dia,
    c.pessoas['beatriz'],
  ])

const lista = async (consulta: Record<string, string> = {}) =>
  (await pegar(c, '/v1/indicadores', consulta, 'beatriz')).body.itens as Item[]
const serie = async (id: string, de: string, ate: string) =>
  (await pegar(c, `/v1/indicadores/kpis/${id}/serie`, { de, ate }, 'beatriz')).body as {
    barrasSomamOTotal: boolean
    pontos: Ponto[]
  }

beforeAll(async () => {
  c = await montarCenario('validacao-t2')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir']
      WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec')`,
    [c.clinica],
  )
})
afterAll(async () => {
  await limparFinanceiro(c)
  await limparTarefas(c)
  await c.migrate.query('DELETE FROM campanhas WHERE clinica_id = $1', [c.clinica])
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparFinanceiro(c)
  await limparTarefas(c)
  await c.migrate.query('DELETE FROM campanhas WHERE clinica_id = $1', [c.clinica])
})

describe('DEFEITO W1 — a comparação "mesmo dia do mês anterior" usa o prefixo até hoje, não D (B1, I-28)', () => {
  it('comparacao-faturamento-usa-D: R$ 1.000 todo dia nos dois meses dá variação 0, não −4%', async () => {
    // Setembro: R$ 1.000 em cada dia de 1 a 24. Outubro: R$ 1.000 em cada dia de 1 a 23.
    // HOJE (24/10) não conta (regra 6): D = 1..23. Anterior certo = 1..23/09 = R$ 23.000.
    for (let d = 1; d <= 24; d++) await recebimento(`2026-09-${String(d).padStart(2, '0')}T12:00:00Z`, '100000')
    for (let d = 1; d <= 23; d++) await recebimento(`2026-10-${String(d).padStart(2, '0')}T12:00:00Z`, '100000')
    await kpi('faturamento_conferido')
    const k = (await lista()).find((x) => x.chave === 'faturamento_conferido')!
    expect(k.atual.emDinheiro).toBe('2300000')
    // Hoje: anterior = 1..24/09 = 2.400.000 e variação −4% num mês idêntico ao anterior.
    expect(k.anterior?.emDinheiro).toBe('2300000')
    expect(k.variacao).toEqual({ tipo: 'relativa', percentual: 0 })
  })
})

describe('DEFEITO W2 — resultado_do_mes ignora o início do período: todo balde é o mês inteiro', () => {
  it('serie-resultado-do-mes-por-dia-nao-repete-o-mes: nada aconteceu de 1 a 3/09, as barras não podem valer R$ 1.000 cada', async () => {
    // Mês PASSADO: no mês corrente todo ponto diário sai "aguardando" (o hoje aberto conta em todos).
    const id = await kpi('resultado_do_mes')
    await recebimento('2026-09-05T12:00:00Z', '100000')
    const s = await serie(id, '2026-09-01', '2026-09-03')
    // Hoje: 3 barras de 100.000 e `barrasSomamOTotal: true` → R$ 3.000 de um mês que teve R$ 1.000.
    const soma = s.pontos.reduce((t, p) => t + BigInt(p.numero.emDinheiro ?? '0'), 0n)
    if (s.barrasSomamOTotal) expect(soma <= 100000n).toBe(true)
    expect(s.pontos[0]!.numero.emDinheiro).not.toBe('100000')
  })
})

describe('DEFEITO W3 — resultado_de_campanha ignora a janela e o caixa de hoje (I-7, regra 6)', () => {
  const campanha = async () =>
    (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO campanhas (clinica_id, categoria, foco, nome, objetivo, inicio, fim, metrica, tipo_metrica, meta, criada_por)
         VALUES ($1, 'Aniversariantes', '', 'Outubro', '', '2026-10-01', '2026-10-31', 'receita', '', 1000000, $2) RETURNING id`,
        [c.clinica, c.pessoas['beatriz']],
      )
    ).rows[0]!.id

  it('campanha-serie-por-dia: receita de R$ 1.000 em 05/10 não aparece nas barras de 1 a 3/10', async () => {
    const camp = await campanha()
    const t = await tarefaConcluida('Pagamento de consulta', '2026-10-05T12:00:00Z', camp)
    await recebimento('2026-10-05T12:00:00Z', '100000', t)
    const id = await kpi('resultado_de_campanha', { campanhaId: camp })
    const s = await serie(id, '2026-10-01', '2026-10-03')
    expect(s.pontos.map((p) => p.numero.emDinheiro)).toEqual(['0', '0', '0'])
  })

  it('campanha-regra-6-hoje: com o caixa de hoje aberto, um pagamento de hoje não muda nenhum byte', async () => {
    const camp = await campanha()
    await kpi('resultado_de_campanha', { campanhaId: camp })
    const antes = (await pegar(c, '/v1/indicadores', {}, 'beatriz')).text
    const t = await tarefaConcluida('Pagamento de consulta', '2026-10-24T15:00:00Z', camp)
    await recebimento('2026-10-24T15:00:00Z', '77777', t)
    const depois = (await pegar(c, '/v1/indicadores', {}, 'beatriz')).text
    expect(depois).not.toContain('77777')
    expect(depois).toBe(antes)
  })
})

describe('DEFEITO W4 — dia passado sem caixa (depois de conferencia_desde) atravessa nas chaves em reais (c.10)', () => {
  it('valor-fechado-dia-passado-aberto: o ponto de 23/10, sem caixa e ainda fechável às cegas, não traz o valor', async () => {
    await caixaFechado('2026-10-22')
    await c.migrate.query(`UPDATE clinicas SET conferencia_desde = '2026-10-01' WHERE id = $1`, [c.clinica])
    const t = await tarefaConcluida('Pagamento de orçamento', '2026-10-23T12:00:00Z')
    await recebimento('2026-10-23T12:00:00Z', '77777', t, 'Pagamento de orçamento')
    const id = await kpi('valor_fechado_em_orcamentos')
    const r = await pegar(c, `/v1/indicadores/kpis/${id}/serie`, { de: '2026-10-23', ate: '2026-10-23' }, 'beatriz')
    // O faturamento conferido do mesmo dia diz "aguardando"; o valor fechado entrega o total da gaveta.
    expect(r.text).not.toContain('77777')
    expect((r.body.pontos as Ponto[])[0]!.diaAguardando).toBe(true)
  })
})

describe('DIVERGÊNCIA W5 — resultado_do_mes de mês PASSADO ≠ Visão do mês (c.1)', () => {
  it('resultado-mes-passado-igual-a-tela: setembro com um dia sem caixa', async () => {
    await caixaFechado('2026-09-10')
    await c.migrate.query(`UPDATE clinicas SET conferencia_desde = '2026-09-01' WHERE id = $1`, [c.clinica])
    await recebimento('2026-09-10T12:00:00Z', '50000')
    await recebimento('2026-09-15T12:00:00Z', '100000')
    await kpi('resultado_do_mes')
    const v = (await pegar(c, '/v1/visao-do-mes', { mes: '2026-09' }, 'beatriz')).body as { resultadoDoMes: string }
    const k = (await lista({ de: '2026-09-01', ate: '2026-09-30' })).find((x) => x.chave === 'resultado_do_mes')!
    // Tela: 150.000. KPI: 50.000 (o dia 15 "aguardando" para sempre).
    expect(k.atual.emDinheiro).toBe(v.resultadoDoMes)
  })
})
