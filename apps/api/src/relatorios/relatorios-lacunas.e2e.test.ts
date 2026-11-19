import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { apagarPacientesDaExportacaoDeTeste } from '../banco/limpeza-de-teste'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparEstoque,
  limparFinanceiro,
  limparProgramas,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * As lacunas do backlog da cliente (1.8) que a I-38 cortou, sobre Postgres
 * real (seam HTTP da API): as colunas novas dos relatórios 2, 3 e 5, o motivo
 * "ajuste" do 11, a situação do orçamento no 13, as somas em reais da faixa de
 * resumo e o que a exportação leva delas.
 *
 * HOJE = sábado 24/10/2026 (America/Bahia). `beatriz` tem tudo; `juliana`
 * (recepção) tem `pacientes` e `jornada`, sem `valores`.
 */
let c: Cenario
let procedimento: { id: string; nome: string }

const executar = (chave: string, filtros: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/relatorios/${chave}/execucoes`, { filtros }, quem)
const exportar = (chave: string, filtros: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/relatorios/${chave}/exportacoes`, { filtros, formato: 'csv' }, quem)

const OUTUBRO = { de: '2026-10-01', ate: '2026-10-31' }
type Soma = { coluna: string; rotulo: string; valor: string | null }

async function limparTudo(): Promise<void> {
  await apagarPacientesDaExportacaoDeTeste(c.migrate, c.clinica)
  await c.migrate.query('DELETE FROM tentativas_de_relatorio WHERE clinica_id = $1', [c.clinica])
  await limparEstoque(c)
  await limparFinanceiro(c)
  await limparProgramas(c)
  await limparTarefas(c)
  await c.migrate.query(`UPDATE pacientes SET ultima_consulta = NULL, origem = '', unidade_id = NULL WHERE clinica_id = $1`, [c.clinica])
}

beforeAll(async () => {
  c = await montarCenario('relatorios-lacunas')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores']
      WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec', 'pf_ter', 'pf_cxa', 'pf_enf')`,
    [c.clinica],
  )
  procedimento = (
    await c.migrate.query<{ id: string; nome: string }>('SELECT id, nome FROM procedimentos WHERE clinica_id = $1 ORDER BY nome LIMIT 1', [
      c.clinica,
    ])
  ).rows[0]!
})
afterAll(async () => {
  await limparTudo()
  await desmontarCenario(c)
})
beforeEach(limparTudo)

async function receber(pacienteId: string, em: string, valor: number, tarefaId: string | null = null): Promise<void> {
  await c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, recebido_em, registrado_por)
     VALUES ($1, $2, $3, 'Consulta realizada', $4, 'Pix', $5::timestamptz, $6)`,
    [c.clinica, pacienteId, tarefaId, valor, em, c.pessoas['beatriz']],
  )
}

async function tarefa(campos: {
  tipo: string
  prazo: string
  pacienteId: string
  status?: string
  concluidaEm?: string
  etapa?: string
  historico?: unknown[]
}): Promise<string> {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tipo, paciente_id, status, concluida_em, etapa, historico)
     VALUES ($1, $2, $2, 'Tarefa', $3::date, $4, $5, $6, $7::timestamptz, $8, $9::jsonb) RETURNING id`,
    [
      c.clinica,
      c.pessoas['beatriz'],
      campos.prazo,
      campos.tipo,
      campos.pacienteId,
      campos.status ?? 'aberta',
      campos.concluidaEm ?? null,
      campos.etapa ?? null,
      JSON.stringify(campos.historico ?? []),
    ],
  )
  return r.rows[0]!.id
}

const somaDasLinhas = (linhas: Record<string, unknown>[], chave: string): string =>
  linhas.reduce((s, l) => s + BigInt(typeof l[chave] === 'string' ? (l[chave] as string) : '0'), 0n).toString()

/* ============================================================ relatório 2 */

describe('relatório 2 — tipo do último atendimento, LTV e "tem tarefa aberta?"', () => {
  async function cenario() {
    const ana = c.pacientes['ana']!
    const bruna = c.pacientes['bruna']!
    // Ana: atendida (Procedimento realizado) em 10/03, paga 300,00 + 120,01 → LTV 420,01; nenhuma tarefa aberta.
    const t = await tarefa({ tipo: 'Procedimento realizado', prazo: '2026-03-10', pacienteId: ana, status: 'concluida', concluidaEm: '2026-03-10T15:00:00Z' })
    await receber(ana, '2026-03-10T15:00:00Z', 30000, t)
    await receber(ana, '2026-03-12T15:00:00Z', 12001)
    // Bruna: só a "última consulta" do cadastro (sem tipo registrado), sem compra, com uma tarefa aberta.
    await c.migrate.query(`UPDATE pacientes SET ultima_consulta = '2026-02-01' WHERE id = $1`, [bruna])
    await tarefa({ tipo: 'Recaptação', prazo: '2026-10-30', pacienteId: bruna })
    return { ana, bruna }
  }

  it('com `valores`: tipo do último atendimento, LTV da ficha e tarefa aberta; a soma do LTV é a Σ das linhas', async () => {
    const { ana, bruna } = await cenario()
    const r = await executar('pacientes-sem-atendimento', { semAtendimentoHaMeses: 3 })
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.colunas.map((x: { chave: string }) => x.chave)).toEqual(['nome', 'ultimoAtendimento', 'tipo', 'ltv', 'tarefaAberta'])
    expect(r.body.linhas).toEqual([
      { pacienteId: bruna, nome: 'Bruna Martins', ultimoAtendimento: '2026-02-01', tipo: null, ltv: '0', tarefaAberta: 'sim' },
      { pacienteId: ana, nome: 'Ana Lúcia Souza', ultimoAtendimento: '2026-03-10', tipo: 'Procedimento realizado', ltv: '42001', tarefaAberta: 'nao' },
    ])
    // O LTV é o da ficha.
    const ficha = await pegar(c, `/v1/pacientes/${ana}`, {}, 'beatriz')
    expect(JSON.stringify(ficha.body)).toContain('"ltv":"42001"')
    expect(r.body.somas).toEqual([{ coluna: 'ltv', rotulo: 'LTV somado', valor: somaDasLinhas(r.body.linhas, 'ltv') }])
    expect(r.body.somas[0].valor).toBe('42001')
  })

  it('com o filtro de tipo, o tipo da linha é o do filtro', async () => {
    await cenario()
    const r = await executar('pacientes-sem-atendimento', { semAtendimentoHaMeses: 3, tipo: 'Procedimento realizado' })
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.linhas.map((l: { tipo: string | null }) => l.tipo)).toEqual(['Procedimento realizado'])
  })

  it('sem `valores` (juliana): sem a coluna LTV, LTV apagado na linha e nenhuma soma — a tarefa aberta fica', async () => {
    await cenario()
    const r = await executar('pacientes-sem-atendimento', { semAtendimentoHaMeses: 3 }, 'juliana')
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.colunas.map((x: { chave: string }) => x.chave)).toEqual(['nome', 'ultimoAtendimento', 'tipo', 'tarefaAberta'])
    for (const l of r.body.linhas) expect(l.ltv).toBeNull()
    expect(r.body.linhas.map((l: { tarefaAberta: string }) => l.tarefaAberta)).toEqual(['sim', 'nao'])
    expect(r.body.somas).toEqual([])
    expect(r.text).not.toContain('42001')
  })
})

/* ============================================================ relatório 3 */

describe('relatório 3 — posição e última compra', () => {
  it('posição 1..N na ordem do LTV e o dia da última compra; com período, a última compra do período', async () => {
    const ana = c.pacientes['ana']!
    const bruna = c.pacientes['bruna']!
    await receber(ana, '2026-01-10T15:00:00Z', 20000)
    await receber(ana, '2026-03-10T15:00:00Z', 50001)
    await receber(bruna, '2026-10-23T15:00:00Z', 9000)
    const r = await executar('pacientes-maior-ltv', { quantos: 5 }, 'camila')
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.colunas.map((x: { chave: string }) => x.chave)).toEqual(['posicao', 'nome', 'ltv', 'compras', 'ticketMedio', 'ultimaCompra'])
    expect(r.body.linhas.map((l: { posicao: number; nome: string; ultimaCompra: string }) => [l.posicao, l.nome, l.ultimaCompra])).toEqual([
      [1, 'Ana Lúcia Souza', '2026-03-10'],
      [2, 'Bruna Martins', '2026-10-23'],
    ])
    expect(r.body.somas).toEqual([{ coluna: 'ltv', rotulo: 'LTV somado', valor: '79001' }])

    const doPeriodo = await executar('pacientes-maior-ltv', { quantos: 5, de: '2026-01-01', ate: '2026-02-28' }, 'camila')
    expect(doPeriodo.statusCode, doPeriodo.text).toBe(200)
    expect(doPeriodo.body.linhas).toEqual([
      expect.objectContaining({ posicao: 1, nome: 'Ana Lúcia Souza', ltv: '20000', ultimaCompra: '2026-01-10' }),
    ])
  })
})

/* ============================================================ relatório 5 */

describe('relatório 5 — a data de início do programa', () => {
  it('cada linha traz o início da adesão', async () => {
    const m = await postar(
      c,
      '/v1/programas',
      { pacienteId: c.pacientes['ana'], inicio: '2026-10-20', itens: [{ chave: 'i1', procedimentoId: procedimento.id, sessoes: 3, intervaloDias: 7 }] },
      'beatriz',
    )
    expect(m.statusCode, m.text).toBe(201)
    const r = await executar('pacientes-por-procedimento', { procedimentoIds: [procedimento.id] })
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.colunas.map((x: { chave: string }) => x.chave)).toContain('inicio')
    expect(r.body.linhas).toEqual([expect.objectContaining({ nome: 'Ana Lúcia Souza', inicio: '2026-10-20' })])
    expect(r.body.somas).toEqual([{ coluna: 'valor', rotulo: 'Valor somado', valor: somaDasLinhas(r.body.linhas, 'valor') }])
  })
})

/* =========================================================== relatório 11 */

describe('relatório 11 — o motivo "ajuste"', () => {
  async function item(): Promise<string> {
    return (
      await c.migrate.query<{ id: string }>(`INSERT INTO itens_de_estoque (clinica_id, nome, medida, custo) VALUES ($1, 'Luva', 'un.', 1000) RETURNING id`, [
        c.clinica,
      ])
    ).rows[0]!.id
  }
  const mov = (itemId: string, tipo: string, milesimos: number, dia: string, motivo = '') =>
    c.migrate.query(
      `INSERT INTO movimentos_de_estoque (clinica_id, item_id, tipo, milesimos, dia, motivo, criado_por, paciente_id)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8)`,
      [c.clinica, itemId, tipo, milesimos, dia, motivo, c.pessoas['beatriz'], tipo === 'consumo' ? c.pacientes['ana'] : null],
    )

  it('calendário: só com o filtro, os ajustes dos dois sentidos — o para menos é saída positiva, o para mais, negativa', async () => {
    const luva = await item()
    await mov(luva, 'consumo', -2000, '2026-10-05')
    await mov(luva, 'ajuste', -1000, '2026-10-06', 'Caixa rasgada')
    await mov(luva, 'ajuste', 500, '2026-10-07', 'Achado no armário')
    const base = { modo: 'calendario', ...OUTUBRO }

    const todos = await executar('saidas-de-estoque', base)
    expect(todos.statusCode, todos.text).toBe(200)
    // Sem o filtro, o ajuste não é saída (B8): a lista é a de sempre.
    expect(todos.body.linhas.map((l: { motivo: string }) => l.motivo)).toEqual(['Consumo'])

    const ajustes = await executar('saidas-de-estoque', { ...base, motivo: 'ajuste' })
    expect(ajustes.statusCode, ajustes.text).toBe(200)
    const linhas = ajustes.body.linhas as { quantidadeEmEstoque: { milesimos: string }; motivo: string; custo: string }[]
    expect(linhas.map((l) => [l.quantidadeEmEstoque.milesimos, l.motivo, l.custo])).toEqual([
      ['1000', 'Ajuste para menos', '1000'],
      ['-500', 'Ajuste para mais', '-500'],
    ])
    // O texto livre do ajuste não sai fora do recorte de saúde (M1).
    expect(ajustes.text).not.toContain('Caixa rasgada')
    expect(ajustes.body.cabecalho.filtrosEmTexto).toContain('Motivo: Ajuste')
    expect(ajustes.body.resumo).toEqual({ linhas: 2, custo: '500' })
    expect(ajustes.body.somas).toEqual([{ coluna: 'custo', rotulo: 'Custo somado', valor: '500' }])
  })

  it('análise: sem o filtro, Σ = saidasEmEstoque da Análise; com "ajuste", Σ = −ajustesEmEstoque', async () => {
    const luva = await item()
    await mov(luva, 'contagem', 10000, '2026-10-01')
    await mov(luva, 'consumo', -2000, '2026-10-05')
    await mov(luva, 'ajuste', -1000, '2026-10-06', 'Quebrou')
    await mov(luva, 'ajuste', 250, '2026-10-07', 'Sobrou')
    await mov(luva, 'contagem', 7000, '2026-10-20')
    // Fora do recorte da análise (depois da contagem final).
    await mov(luva, 'ajuste', -3000, '2026-10-22', 'Depois')
    const base = { modo: 'analise', ...OUTUBRO }
    const a = await pegar(c, '/v1/estoque/analise', OUTUBRO, 'beatriz')
    expect(a.statusCode, a.text).toBe(200)
    const doItem = (a.body.itens as { itemId: string; saidasEmEstoque: { milesimos: string }; ajustesEmEstoque: { milesimos: string } }[]).find(
      (i) => i.itemId === luva,
    )!
    const soma = (linhas: { quantidadeEmEstoque: { milesimos: string } }[]) =>
      linhas.reduce((s, l) => s + BigInt(l.quantidadeEmEstoque.milesimos), 0n)

    const saidas = await executar('saidas-de-estoque', base)
    expect(saidas.statusCode, saidas.text).toBe(200)
    expect(soma(saidas.body.linhas)).toBe(BigInt(doItem.saidasEmEstoque.milesimos))

    const ajustes = await executar('saidas-de-estoque', { ...base, motivo: 'ajuste' })
    expect(ajustes.statusCode, ajustes.text).toBe(200)
    expect(ajustes.body.linhas).toHaveLength(2)
    expect(soma(ajustes.body.linhas)).toBe(-BigInt(doItem.ajustesEmEstoque.milesimos))
    expect(soma(ajustes.body.linhas)).toBe(750n)
  })
})

/* =========================================================== relatório 13 */

describe('relatório 13 — situação enviado / fechado / perdido', () => {
  async function cartoes() {
    const ev = (acao: string, etapa: string, em: string, extra: Record<string, unknown> = {}) => ({ acao, etapa, em, porId: c.pessoas['beatriz'], ...extra })
    const orcamento = (em: string) => ev('registrarOrcamento', 'orcamento', em, { valor: '100000' })
    const enviado = await tarefa({
      tipo: 'Consulta realizada',
      prazo: '2026-10-05',
      pacienteId: c.pacientes['ana']!,
      status: 'concluida',
      concluidaEm: '2026-10-05T15:00:00Z',
      etapa: 'orcamento',
      historico: [orcamento('2026-10-05T15:00:00Z')],
    })
    const fechado = await tarefa({
      tipo: 'Consulta realizada',
      prazo: '2026-10-06',
      pacienteId: c.pacientes['bruna']!,
      status: 'concluida',
      concluidaEm: '2026-10-06T15:00:00Z',
      etapa: 'fechado',
      historico: [orcamento('2026-10-06T15:00:00Z'), ev('fechar', 'fechado', '2026-10-08T15:00:00Z', { valor: '100000' })],
    })
    const perdido = await tarefa({
      tipo: 'Consulta realizada',
      prazo: '2026-10-07',
      pacienteId: c.pacientes['ana']!,
      status: 'concluida',
      concluidaEm: '2026-10-07T15:00:00Z',
      etapa: 'perdido',
      historico: [orcamento('2026-10-07T15:00:00Z'), ev('perder', 'perdido', '2026-10-09T15:00:00Z', { motivo: 'Preço' })],
    })
    return { enviado, fechado, perdido }
  }

  it('a coluna é a situação do orçamento, e o filtro estreita por ela', async () => {
    const { enviado, fechado, perdido } = await cartoes()
    const r = await executar('orcamentos', OUTUBRO)
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.colunas.map((x: { chave: string }) => x.chave)).toContain('situacao')
    expect(r.body.colunas.map((x: { chave: string }) => x.chave)).not.toContain('etapa')
    expect((r.body.linhas as { tarefaId: string; situacao: string }[]).map((l) => [l.tarefaId, l.situacao])).toEqual([
      [enviado, 'enviado'],
      [fechado, 'fechado'],
      [perdido, 'perdido'],
    ])
    for (const [situacao, id] of [
      ['enviado', enviado],
      ['fechado', fechado],
      ['perdido', perdido],
    ] as const) {
      const s = await executar('orcamentos', { ...OUTUBRO, situacao })
      expect(s.statusCode, s.text).toBe(200)
      expect(s.body.linhas.map((l: { tarefaId: string }) => l.tarefaId)).toEqual([id])
      expect(s.body.resumo.orcamentos).toBe(1)
    }
    expect((await executar('orcamentos', { ...OUTUBRO, situacao: 'orcamento' })).statusCode).toBe(422)
    // O favorito de antes (etapa) continua valendo, mas não junto com a situação.
    expect((await executar('orcamentos', { ...OUTUBRO, etapa: 'perdido' })).body.linhas).toHaveLength(1)
    expect((await executar('orcamentos', { ...OUTUBRO, etapa: 'perdido', situacao: 'perdido' })).statusCode).toBe(422)
  })
})

/* ================================================= somas e exportação (6, 7) */

describe('somas em reais da faixa de resumo', () => {
  it('relatório 10: valor e valor pago somados no servidor, centavo a centavo, iguais ao resumo', async () => {
    await c.migrate.query(
      `INSERT INTO contas_a_pagar (clinica_id, descricao, categoria, valor, vencimento, responsavel_id, forma_prevista)
       VALUES ($1, 'Aluguel', 'Ocupação', 250001, '2026-10-10', $2, 'Boleto'),
              ($1, 'Água', 'Ocupação', 3333, '2026-10-12', $2, 'Pix')`,
      [c.clinica, c.pessoas['beatriz']],
    )
    const r = await executar('contas', OUTUBRO)
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.somas).toEqual([
      { coluna: 'valor', rotulo: 'Valor somado', valor: somaDasLinhas(r.body.linhas, 'valor') },
      { coluna: 'valorPago', rotulo: 'Valor pago somado', valor: '0' },
    ])
    expect(r.body.somas[0].valor).toBe('253334')
    expect(r.body.somas[0].valor).toBe(r.body.resumo.valor)
  })

  it('relatório 8: o total soma só as linhas com valor (o dia aguardando sai sem valor) e bate com o resumo', async () => {
    await receber(c.pacientes['ana']!, '2026-10-05T15:00:00Z', 10001)
    await receber(c.pacientes['bruna']!, '2026-10-06T15:00:00Z', 2002)
    await c.migrate.query(`INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1, '2026-10-05', '', $2)`, [
      c.clinica,
      c.pessoas['beatriz'],
    ])
    const r = await executar('recebimentos', { de: '2026-10-01', ate: HOJE })
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.somas).toEqual([{ coluna: 'valor', rotulo: 'Total', valor: '10001' }])
    expect(r.body.somas[0].valor).toBe(r.body.resumo.total.emDinheiro)
  })

  it('a exportação leva as mesmas somas; sem `valores`, nenhuma', async () => {
    await receber(c.pacientes['ana']!, '2026-03-10T15:00:00Z', 12345)
    await c.migrate.query(`UPDATE pacientes SET ultima_consulta = '2026-02-01' WHERE id = ANY($1::uuid[])`, [[c.pacientes['ana'], c.pacientes['bruna']]])
    const b = await exportar('pacientes-sem-atendimento', { semAtendimentoHaMeses: 3 })
    expect(b.statusCode, b.text).toBe(200)
    expect(b.body.resultado.somas).toEqual([{ coluna: 'ltv', rotulo: 'LTV somado', valor: '12345' }])
    const j = await exportar('pacientes-sem-atendimento', { semAtendimentoHaMeses: 3 }, 'juliana')
    expect(j.statusCode, j.text).toBe(200)
    expect(j.body.resultado.somas).toEqual([])
    expect(j.text).not.toContain('12345')
  })
})
