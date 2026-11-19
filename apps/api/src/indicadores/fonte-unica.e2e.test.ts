import { percentualInteiro, valorDaMediaMensal, valorDaTaxa } from '@fir/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  limparEstoque,
  limparFinanceiro,
  limparTarefas,
  montarCenario,
  pegar,
} from '../tarefas/__tests__/cenario'

/**
 * **FONTE ÚNICA (gate c.1, validação T2)** — cada chave do catálogo contra a
 * tela ou a rota que mostra o mesmo número hoje, por HTTP.
 *
 * A fixture tem as duas coisas que o validador pediu:
 * - **um mês passado** (setembro): o KPI é o número da tela;
 * - **um dia aberto no meio** do mês corrente: 15/10, com recebimento e sem
 *   caixa, depois de `conferencia_desde` = 01/10. As chaves em reais cortam
 *   nele (ADR 2026-11-17-chaves-em-reais-e-os-dias-de-caixa): o KPI de
 *   outubro é a tela sem o 15/10, e o valor do 15/10 nunca atravessa.
 *
 * HOJE = sábado 24/10/2026 (America/Bahia), caixa de hoje aberto.
 *
 * Sem tela hoje, e por isso fora daqui: `comparecimento`,
 * `faltas_recontatadas`, `pacientes_recaptados` e `rotinas_cumpridas` são
 * medidas novas (I-10 a I-13), cobertas no domínio.
 */
let c: Cenario

type Valor = { emDinheiro: string | null; emNumero: string | null }
type Item = { id: string; chave: string; atual: Valor; motivoSemValor: string | null }

const SEP = { de: '2026-09-01', ate: '2026-09-30' }
const ABERTO = '2026-10-15'
const VALOR_DO_DIA_ABERTO = '77777'

let campanhaSet = ''
let campanhaOut = ''
let fichaA = ''
let fichaB = ''

const tarefa = async (
  tipo: string,
  concluidaEm: string,
  opcoes: { campanhaId?: string; historico?: unknown[]; prazo?: string; status?: string } = {},
): Promise<string> => {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em,
                          criada_em, paciente_id, tipo, historico, campanha_id)
     VALUES ($1, $2, $2, 'fixture', coalesce($7::date, ($3::timestamptz AT TIME ZONE 'America/Bahia')::date), $8::text::status_de_tarefa,
             CASE WHEN $8::text = 'concluida' THEN $3::timestamptz END, $3::timestamptz, $4, $5, $6::jsonb, $9) RETURNING id`,
    [
      c.clinica,
      c.pessoas['beatriz'],
      concluidaEm,
      c.pacientes['ana'],
      tipo,
      JSON.stringify(opcoes.historico ?? []),
      opcoes.prazo ?? null,
      opcoes.status ?? 'concluida',
      opcoes.campanhaId ?? null,
    ],
  )
  return r.rows[0]!.id
}

const pago = async (tipo: string, instante: string, valor: string, campanhaId?: string) => {
  const t = await tarefa(tipo, instante, campanhaId === undefined ? {} : { campanhaId })
  await c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, tipo, valor, valor_aberto, forma, recebido_em, registrado_por)
     VALUES ($1, $2, $3, $4, $5, 0, 'Pix', $6::timestamptz, $7)`,
    [c.clinica, c.pacientes['ana'], t, tipo, valor, instante, c.pessoas['beatriz']],
  )
}

const kpi = (chave: string, parametros: Record<string, string> = {}) =>
  c.migrate.query(
    `INSERT INTO kpis (clinica_id, origem, chave_catalogo, parametros, nome, frequencia, criado_em)
     VALUES ($1, 'catalogo', $2, $3::jsonb, $2, 'mensal', '2026-09-01T12:00:00Z')`,
    [c.clinica, chave, JSON.stringify(parametros)],
  )

const lista = async (consulta: Record<string, string> = {}) => {
  const r = await pegar(c, '/v1/indicadores', consulta, 'beatriz')
  expect(r.status).toBe(200)
  return { itens: r.body.itens as Item[], texto: r.text }
}
const doKpi = (itens: Item[], chave: string, campanhaId?: string) => {
  const k = itens.find((x) => x.chave === chave && (campanhaId === undefined || x.id === campanhaId))
  expect(k, chave).toBeDefined()
  return k!
}
const painel = async (de: string, ate: string) => {
  const r = await pegar(c, '/v1/painel', { periodo: 'per', de, ate }, 'beatriz')
  expect(r.status).toBe(200)
  return r.body as {
    prazos: { noPrazo: number; comAtraso: number; atrasadas: number }
    pacientes: { ticketMedio: string | null; valorDosOrcamentosPagos: string; conversaoDeOrcamentos: number | null }
    novosPacientes: { total: number; porOrigem: { origem: string; novos: number }[] }
  }
}
const pct = (p: number | null) => (p === null ? null : String(p * 100))

let set: { itens: Item[]; texto: string }
let out: { itens: Item[]; texto: string }
const ids = new Map<string, string>()

beforeAll(async () => {
  c = await montarCenario('fonte-unica-t2')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir','pessoas.gerir','estoque','estoque.gerir','campanhas','painel','finmes','cobrancas']
      WHERE clinica_id = $1 AND chave = 'pf_sup'`,
    [c.clinica],
  )
  await limparFinanceiro(c)
  await limparTarefas(c)
  await limparEstoque(c)

  // --- Campanhas: uma em setembro, uma em outubro ---------------------------------
  const camp = async (nome: string, inicio: string, fim: string) =>
    (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO campanhas (clinica_id, categoria, foco, nome, objetivo, inicio, fim, metrica, tipo_metrica, meta, criada_por)
         VALUES ($1, 'Aniversariantes', '', $2, '', $3, $4, 'receita', '', 1000000, $5) RETURNING id`,
        [c.clinica, nome, inicio, fim, c.pessoas['beatriz']],
      )
    ).rows[0]!.id
  campanhaSet = await camp('Setembro', '2026-09-01', '2026-09-30')
  campanhaOut = await camp('Outubro', '2026-10-01', '2026-10-31')

  // --- Recebimentos: setembro inteiro; outubro com o dia aberto no meio -----------
  await pago('Pagamento de consulta', '2026-09-05T12:00:00Z', '30000', campanhaSet)
  await pago('Pagamento de orçamento', '2026-09-10T12:00:00Z', '100000', campanhaSet)
  await pago('Pagamento de consulta', '2026-09-20T12:00:00Z', '20000')
  await pago('Pagamento de consulta', '2026-10-10T12:00:00Z', '50000', campanhaOut)
  await pago('Pagamento de orçamento', '2026-10-12T12:00:00Z', '40000')
  await pago('Pagamento de orçamento', `${ABERTO}T12:00:00Z`, VALOR_DO_DIA_ABERTO, campanhaOut)

  // --- Caixas: 01 a 22/10 fechados, menos o 15; o 10/10 com diferença no Pix ------
  for (let d = 1; d <= 22; d++) {
    if (d === 15) continue
    const dia = `2026-10-${String(d).padStart(2, '0')}`
    const cx = await c.migrate.query<{ id: string }>(
      `INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1, $2::date, '', $3) RETURNING id`,
      [c.clinica, dia, c.pessoas['beatriz']],
    )
    if (d === 10) {
      await c.migrate.query(
        `INSERT INTO caixa_por_forma (caixa_id, clinica_id, forma, esperado, contado) VALUES ($1, $2, 'Pix', 50000, 49000)`,
        [cx.rows[0]!.id, c.clinica],
      )
    }
  }
  await c.migrate.query(`UPDATE clinicas SET conferencia_desde = '2026-10-01' WHERE id = $1`, [c.clinica])

  // --- Despesa fixa paga em setembro ----------------------------------------------
  await c.migrate.query(
    `INSERT INTO contas_a_pagar (clinica_id, descricao, categoria, valor, vencimento, responsavel_id, pago_em, valor_pago, forma_pagamento, pago_por)
     VALUES ($1, 'Aluguel', 'Ocupação', 45000, '2026-09-05', $2, '2026-09-05', 45000, 'Pix', $2)`,
    [c.clinica, c.pessoas['beatriz']],
  )

  // --- Orçamentos: dois enviados e um fechado em setembro -------------------------
  await tarefa('Orçamento', '2026-09-08T12:00:00Z', {
    historico: [
      { acao: 'registrarOrcamento', em: '2026-09-08T12:00:00Z' },
      { acao: 'fechar', em: '2026-09-12T12:00:00Z' },
    ],
    status: 'aberta',
  })
  await tarefa('Orçamento', '2026-09-09T12:00:00Z', {
    historico: [{ acao: 'registrarOrcamento', em: '2026-09-09T12:00:00Z' }],
    status: 'aberta',
  })

  // --- Prazos em setembro: uma no prazo, uma com atraso, uma atrasada -------------
  await tarefa('Follow-up', '2026-09-14T12:00:00Z', { prazo: '2026-09-15' })
  await tarefa('Follow-up', '2026-09-18T12:00:00Z', { prazo: '2026-09-16' })
  await tarefa('Follow-up', '2026-09-17T12:00:00Z', { prazo: '2026-09-17', status: 'aberta' })

  // --- Pacientes novos: dois em setembro (um sem origem), um em outubro -----------
  for (const [nome, origem, criado] of [
    ['Nova Um', 'Instagram', '2026-09-03T12:00:00Z'],
    ['Nova Dois', '', '2026-09-21T12:00:00Z'],
    ['Nova Tres', 'Instagram', '2026-10-05T12:00:00Z'],
  ] as const) {
    await c.migrate.query(`INSERT INTO pacientes (clinica_id, nome, origem, criado_em) VALUES ($1, $2, $3, $4::timestamptz)`, [
      c.clinica,
      nome,
      origem,
      criado,
    ])
  }

  // --- Estoque: um item abaixo do mínimo, um sem mínimo ---------------------------
  await c.migrate.query(
    `INSERT INTO itens_de_estoque (clinica_id, nome, medida, minimo, criado_em) VALUES
       ($1, 'Seringa fonte-unica', 'un', 5000, '2026-09-01T12:00:00Z'),
       ($1, 'Gaze fonte-unica', 'un', NULL, '2026-09-01T12:00:00Z')`,
    [c.clinica],
  )

  // --- Equipe: duas fichas CLT com gestora; banco de horas, metas e 1:1 -----------
  await c.migrate.query(`DELETE FROM fichas_de_pessoa WHERE clinica_id = $1`, [c.clinica]).catch(() => undefined)
  const ficha = async (nome: string) =>
    (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO fichas_de_pessoa (clinica_id, nome, cargo, contrato, gestor_id, ativo) VALUES ($1, $2, 'Recepção', 'CLT', $3, true) RETURNING id`,
        [c.clinica, nome, c.pessoas['beatriz']],
      )
    ).rows[0]!.id
  fichaA = await ficha('Ficha A')
  fichaB = await ficha('Ficha B')
  await c.migrate.query(
    `INSERT INTO banco_de_horas (clinica_id, ficha_id, mes, saldo_minutos) VALUES ($1, $2, '2026-09', 125), ($1, $3, '2026-09', -40)`,
    [c.clinica, fichaA, fichaB],
  )
  await c.migrate.query(
    `INSERT INTO metas_de_pessoa (clinica_id, ficha_id, mes, indicador, nome, alvo, realizado_lancado)
     VALUES ($1, $2, '2026-09', 'manual', 'Avaliações', 10, 5), ($1, $3, '2026-09', 'manual', 'Avaliações', 4, 3)`,
    [c.clinica, fichaA, fichaB],
  )
  await c.migrate.query(
    `INSERT INTO conversas_1a1 (clinica_id, ficha_id, data, mes, por_id, fortes) VALUES ($1, $2, '2026-10-06', '2026-10', $3, 'pontual')`,
    [c.clinica, fichaA, c.pessoas['beatriz']],
  )

  // --- Um KPI por chave com tela ---------------------------------------------------
  for (const chave of [
    'faturamento_conferido',
    'resultado_do_mes',
    'ticket_medio',
    'despesas_fixas_sobre_recebido',
    'saldo_a_receber',
    'caixas_sem_diferenca',
    'novos_pacientes',
    'conversao_de_orcamentos',
    'valor_fechado_em_orcamentos',
    'tarefas_no_prazo',
    'perda_de_estoque',
    'itens_abaixo_do_minimo',
    'atingimento_metas_individuais',
    'saldo_banco_de_horas',
    'conversas_1a1_em_dia',
  ]) {
    await kpi(chave)
  }
  await kpi('novos_pacientes', { origem: 'Instagram' })
  await kpi('resultado_de_campanha', { campanhaId: campanhaSet })
  await kpi('resultado_de_campanha', { campanhaId: campanhaOut })
  const r = await c.migrate.query<{ id: string; p: string | null }>(
    `SELECT id, parametros->>'campanhaId' AS p FROM kpis WHERE clinica_id = $1 AND chave_catalogo = 'resultado_de_campanha'`,
    [c.clinica],
  )
  for (const l of r.rows) ids.set(l.p!, l.id)

  set = await lista(SEP)
  out = await lista()
}, 120_000)

afterAll(async () => {
  await c.migrate.query(`DELETE FROM conversas_1a1 WHERE clinica_id = $1`, [c.clinica])
  await c.migrate.query(`DELETE FROM metas_de_pessoa WHERE clinica_id = $1`, [c.clinica])
  await c.migrate.query(`DELETE FROM banco_de_horas WHERE clinica_id = $1`, [c.clinica])
  await c.migrate.query(`DELETE FROM fichas_de_pessoa WHERE clinica_id = $1`, [c.clinica])
  await c.migrate.query(`DELETE FROM contas_a_pagar WHERE clinica_id = $1`, [c.clinica])
  await limparEstoque(c)
  await limparFinanceiro(c)
  await limparTarefas(c)
  await c.migrate.query('DELETE FROM campanhas WHERE clinica_id = $1', [c.clinica])
  await desmontarCenario(c)
})

describe('o dia aberto no meio nunca atravessa (regra 6, c.10)', () => {
  // ADR 2026-11-19-aguardando-em-reais-com-finmes (substitui o item 5 da
  // meta-medida-pelos-dias-de-caixa): com `finmes`, o 15/10 sai UMA vez, como
  // o total `aguardandoFechamento` do faturamento conferido — o mesmo da
  // Visão do mês. Em nenhum outro campo, e nunca sem `finmes`.
  it('com `finmes`: o valor do 15/10 só como `aguardandoFechamento` do faturamento conferido, igual à Visão do mês', async () => {
    const v = (await pegar(c, '/v1/visao-do-mes', { mes: '2026-10' }, 'beatriz')).body as { aguardandoFechamento: string }
    expect(v.aguardandoFechamento).toBe(VALOR_DO_DIA_ABERTO)
    const fat = doKpi(out.itens, 'faturamento_conferido') as Item & { aguardandoFechamento: string | null }
    expect(fat.aguardandoFechamento).toBe(v.aguardandoFechamento)
    const semOAguardando = out.itens.map((k) => ({ ...k, aguardandoFechamento: undefined }))
    expect(JSON.stringify(semOAguardando)).not.toContain(VALOR_DO_DIA_ABERTO)
  })

  it('sem `finmes` (com `valores`): nenhuma resposta de outubro traz o valor do 15/10', async () => {
    await c.migrate.query(`UPDATE perfis SET perms = perms || ARRAY['indicadores'] WHERE clinica_id = $1 AND chave = 'pf_ter'`, [
      c.clinica,
    ])
    const r = await pegar(c, '/v1/indicadores', {}, 'camila')
    expect(r.status).toBe(200)
    expect((r.body.itens as Item[]).some((x) => x.chave === 'faturamento_conferido')).toBe(true)
    expect(r.text).not.toContain(VALOR_DO_DIA_ABERTO)
  })
})

describe('fonte única com o Painel (c.1)', () => {
  it('fonte-unica-ticket_medio: setembro = Painel; outubro = Painel de 01 a 14/10 (o 15 aguarda)', async () => {
    expect(doKpi(set.itens, 'ticket_medio').atual.emDinheiro).toBe((await painel(SEP.de, SEP.ate)).pacientes.ticketMedio)
    const ate14 = (await painel('2026-10-01', '2026-10-14')).pacientes.ticketMedio
    expect(doKpi(out.itens, 'ticket_medio').atual.emDinheiro).toBe(ate14)
  })

  it('fonte-unica-valor_fechado_em_orcamentos: setembro = Painel; outubro = Painel, que já corta o dia aberto (D-I3)', async () => {
    expect(doKpi(set.itens, 'valor_fechado_em_orcamentos').atual.emDinheiro).toBe(
      (await painel(SEP.de, SEP.ate)).pacientes.valorDosOrcamentosPagos,
    )
    const tela = await painel('2026-10-01', '2026-10-24')
    expect(doKpi(out.itens, 'valor_fechado_em_orcamentos').atual.emDinheiro).toBe(tela.pacientes.valorDosOrcamentosPagos)
    expect(JSON.stringify(tela)).not.toContain(VALOR_DO_DIA_ABERTO)
  })

  it('fonte-unica-novos_pacientes: o total e a linha de uma origem do Painel', async () => {
    const p = await painel(SEP.de, SEP.ate)
    const todos = set.itens.filter((x) => x.chave === 'novos_pacientes')
    const numeros = todos.map((x) => x.atual.emNumero).sort()
    const instagram = p.novosPacientes.porOrigem.find((o) => o.origem === 'Instagram')?.novos ?? 0
    expect(numeros).toEqual([String(instagram * 100), String(p.novosPacientes.total * 100)].sort())
    expect(p.novosPacientes.total).toBe(2)
    const o = await painel('2026-10-01', '2026-10-24')
    expect(out.itens.filter((x) => x.chave === 'novos_pacientes').map((x) => x.atual.emNumero)).toContain(
      String(o.novosPacientes.total * 100),
    )
  })

  it('fonte-unica-conversao_de_orcamentos: o percentual do Painel', async () => {
    const p = await painel(SEP.de, SEP.ate)
    expect(p.pacientes.conversaoDeOrcamentos).toBe(50)
    expect(doKpi(set.itens, 'conversao_de_orcamentos').atual.emNumero).toBe(pct(p.pacientes.conversaoDeOrcamentos))
  })

  it('fonte-unica-tarefas_no_prazo: no prazo ÷ (no prazo + com atraso + atrasadas) do Painel', async () => {
    const { prazos } = await painel(SEP.de, SEP.ate)
    const esperado = valorDaTaxa('percentual', BigInt(prazos.noPrazo), BigInt(prazos.noPrazo + prazos.comAtraso + prazos.atrasadas))
    expect(esperado).not.toBeNull()
    expect(doKpi(set.itens, 'tarefas_no_prazo').atual.emNumero).toBe(esperado!.emMenorUnidade.toString())
  })
})

describe('fonte única com a Visão do mês (c.1)', () => {
  it('fonte-unica-despesas_fixas_sobre_recebido: fixas ÷ recebido da Visão de setembro', async () => {
    const v = (await pegar(c, '/v1/visao-do-mes', { mes: '2026-09' }, 'beatriz')).body as {
      fixas: string
      recebido: string
    }
    expect(v.fixas).toBe('45000')
    const esperado = valorDaTaxa('percentual', BigInt(v.fixas), BigInt(v.recebido))
    expect(doKpi(set.itens, 'despesas_fixas_sobre_recebido').atual.emNumero).toBe(esperado!.emMenorUnidade.toString())
  })

  it('fonte-unica-resultado_do_mes: setembro = a Visão de setembro (mês passado é a tela)', async () => {
    const v = (await pegar(c, '/v1/visao-do-mes', { mes: '2026-09' }, 'beatriz')).body as { resultadoDoMes: string }
    expect(doKpi(set.itens, 'resultado_do_mes').atual.emDinheiro).toBe(v.resultadoDoMes)
  })

  it('fonte-unica-caixas_sem_diferenca: outubro = a Visão; setembro (antes do 1º caixa) é "sem dado", nunca 0%', async () => {
    const v = (await pegar(c, '/v1/visao-do-mes', { mes: '2026-10' }, 'beatriz')).body as {
      caixa: { fechados: number; comDiferenca: number; diasDaConferencia: number }
    }
    expect(v.caixa.comDiferenca).toBe(1)
    const esperado = percentualInteiro(BigInt(v.caixa.fechados - v.caixa.comDiferenca), BigInt(v.caixa.diasDaConferencia))
    expect(doKpi(out.itens, 'caixas_sem_diferenca').atual.emNumero).toBe(pct(esperado))
    const antes = doKpi(set.itens, 'caixas_sem_diferenca')
    expect(antes.atual.emNumero).toBeNull()
    expect(antes.motivoSemValor).toBe('antes_do_primeiro_caixa')
  })
})

describe('fonte única com as outras telas (c.1)', () => {
  it('fonte-unica-resultado_de_campanha: setembro = a tela de Campanhas; outubro = a tela sem o dia aberto', async () => {
    const r = await pegar(c, '/v1/campanhas', {}, 'beatriz')
    expect(r.status).toBe(200)
    const telas = r.body.campanhas as { id: string; resultadoEmDinheiro: string | null }[]
    const tela = (id: string) => telas.find((x) => x.id === id)!.resultadoEmDinheiro
    expect(doKpi(set.itens, 'resultado_de_campanha', ids.get(campanhaSet)).atual.emDinheiro).toBe(tela(campanhaSet))
    const outubro = BigInt(tela(campanhaOut)!) - BigInt(VALOR_DO_DIA_ABERTO)
    expect(doKpi(out.itens, 'resultado_de_campanha', ids.get(campanhaOut)).atual.emDinheiro).toBe(String(outubro))
  })

  it('fonte-unica-itens_abaixo_do_minimo: a contagem de `abaixoDoMinimo` da lista de itens', async () => {
    const r = await pegar(c, '/v1/estoque', {}, 'beatriz')
    expect(r.status).toBe(200)
    const n = (r.body.itens as { abaixoDoMinimo: boolean }[]).filter((x) => x.abaixoDoMinimo).length
    expect(n).toBe(1)
    expect(doKpi(out.itens, 'itens_abaixo_do_minimo').atual.emNumero).toBe(String(n * 100))
  })

  it('fonte-unica-atingimento_metas_individuais: a média das médias da aba Metas de setembro', async () => {
    const r = await pegar(c, '/v1/metas-de-pessoa/2026-09', {}, 'beatriz')
    expect(r.status).toBe(200)
    const percentuais = (r.body.pessoas as { mediaDeAtingimento: number | null }[]).map((p) => p.mediaDeAtingimento)
    const esperado = valorDaMediaMensal([{ mes: '2026-09', percentuais }])
    expect(esperado.tipo).toBe('ok')
    if (esperado.tipo !== 'ok') return
    expect(doKpi(set.itens, 'atingimento_metas_individuais').atual.emNumero).toBe(esperado.valor?.emMenorUnidade.toString() ?? null)
  })

  it('fonte-unica-saldo_banco_de_horas: a soma dos saldos POSITIVOS da tabela de setembro', async () => {
    const r = await pegar(c, '/v1/fichas/horas/2026-09', {}, 'beatriz')
    expect(r.status).toBe(200)
    const positivos = (r.body.linhas as { saldoEmMinutos: number | null }[])
      .map((l) => l.saldoEmMinutos ?? 0)
      .filter((m) => m > 0)
      .reduce((s, m) => s + m, 0)
    expect(positivos).toBe(125)
    expect(doKpi(set.itens, 'saldo_banco_de_horas').atual.emNumero).toBe(String(positivos))
  })

  it('fonte-unica-conversas_1a1_em_dia: feitas ÷ (feitas + pendentes) da tela de Conversas do mês', async () => {
    const r = await pegar(c, '/v1/conversas', {}, 'beatriz')
    expect(r.status).toBe(200)
    const feitas = new Set((r.body.conversas as { fichaId: string }[]).map((x) => x.fichaId)).size
    const pendentes = (r.body.pendentes as unknown[]).length
    const esperado = valorDaTaxa('percentual', BigInt(feitas), BigInt(feitas + pendentes))
    expect(doKpi(out.itens, 'conversas_1a1_em_dia').atual.emNumero).toBe(esperado!.emMenorUnidade.toString())
  })

  it('a série do mês só de mês civil tem uma barra por mês, nunca uma por dia (W2)', async () => {
    const id = doKpi(set.itens, 'resultado_do_mes').id
    const r = await pegar(c, `/v1/indicadores/kpis/${id}/serie`, { de: '2026-08-01', ate: '2026-09-30' }, 'beatriz')
    expect(r.body.agrupamento).toBe('mes')
    const v = (await pegar(c, '/v1/visao-do-mes', { mes: '2026-09' }, 'beatriz')).body as { resultadoDoMes: string }
    expect((r.body.pontos as { numero: Valor }[]).at(-1)!.numero.emDinheiro).toBe(v.resultadoDoMes)
  })
})
