import { randomUUID } from 'node:crypto'
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
 * Os filtros da 1.8 (revisão da branch, S2), sobre Postgres real (seam HTTP).
 *
 * Para cada relatório: o filtro ESTREITA o conjunto da mesma fonte, o resumo é
 * o do conjunto estreitado (Σ das linhas onde o relatório soma), e o id de
 * outra clínica é 422. HOJE = sábado 24/10/2026 (America/Bahia).
 */
let c: Cenario
let pessoaDaOutra: string
let unidadeDaOutra: string
let procedimentos: { id: string; nome: string }[]

const executar = (chave: string, filtros: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/relatorios/${chave}/execucoes`, { filtros }, quem)

const OUTUBRO = { de: '2026-10-01', ate: '2026-10-31' }

async function limparTudo(): Promise<void> {
  await apagarPacientesDaExportacaoDeTeste(c.migrate, c.clinica)
  await c.migrate.query('DELETE FROM tentativas_de_relatorio WHERE clinica_id = $1', [c.clinica])
  await limparEstoque(c)
  await limparFinanceiro(c)
  await limparProgramas(c)
  await limparTarefas(c)
  await c.migrate.query('UPDATE pacientes SET campanha_id = NULL, indicado_por_id = NULL WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query(
    `UPDATE pacientes SET ativo = false, desativado_em = now(), motivo_desativacao = 'erro-de-cadastro'
      WHERE clinica_id = $1 AND ativo AND id <> ALL($2::uuid[])`,
    [c.clinica, [c.pacientes['ana'], c.pacientes['bruna']]],
  )
  await c.migrate.query(
    `UPDATE pacientes SET ultima_consulta = NULL, origem = '', aniversario = NULL, unidade_id = NULL WHERE clinica_id = $1`,
    [c.clinica],
  )
  // Ana na unidade principal; Bruna na Pituba, com a origem gravada em minúsculas.
  await c.migrate.query('UPDATE pacientes SET unidade_id = $2 WHERE id = $1', [c.pacientes['ana'], c.unidades['principal']])
  await c.migrate.query(`UPDATE pacientes SET unidade_id = $2, origem = 'instagram' WHERE id = $1`, [
    c.pacientes['bruna'],
    c.unidades['pituba'],
  ])
}

beforeAll(async () => {
  c = await montarCenario('relatorios-filtros')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores']
      WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec', 'pf_ter', 'pf_cxa', 'pf_enf')`,
    [c.clinica],
  )
  pessoaDaOutra = (await c.migrate.query<{ id: string }>('SELECT id FROM pessoas WHERE clinica_id = $1 LIMIT 1', [c.outraClinica])).rows[0]!.id
  unidadeDaOutra = (
    await c.migrate.query<{ id: string }>(`INSERT INTO unidades (clinica_id, nome) VALUES ($1, 'Unidade da vizinha') RETURNING id`, [
      c.outraClinica,
    ])
  ).rows[0]!.id
  procedimentos = (
    await c.migrate.query<{ id: string; nome: string }>('SELECT id, nome FROM procedimentos WHERE clinica_id = $1 ORDER BY nome LIMIT 2', [
      c.clinica,
    ])
  ).rows
})
afterAll(async () => {
  await limparTudo()
  await desmontarCenario(c)
})
beforeEach(limparTudo)

/* ------------------------------------------------------------- ajudantes */

async function paciente(nome: string, extra: Record<string, unknown> = {}): Promise<string> {
  const colunas = ['clinica_id', 'nome', ...Object.keys(extra)]
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO pacientes (${colunas.join(', ')}) VALUES (${colunas.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    [c.clinica, nome, ...Object.values(extra)],
  )
  return r.rows[0]!.id
}

async function receber(
  pacienteId: string,
  em: string,
  valor: number,
  extra: { forma?: string; tipo?: string; unidadeId?: string | undefined; por?: string } = {},
): Promise<void> {
  await c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, unidade_id, registrado_por)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8)`,
    [c.clinica, pacienteId, extra.tipo ?? 'Consulta realizada', valor, extra.forma ?? 'Pix', em, extra.unidadeId ?? null, extra.por ?? c.pessoas['beatriz']],
  )
}

async function tarefa(campos: { tipo: string; prazo: string; pacienteId?: string; status?: string; concluidaEm?: string; historico?: unknown[]; etapa?: string }) {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tipo, paciente_id, status, concluida_em, historico, etapa)
     VALUES ($1, $2, $2, 'Tarefa', $3::date, $4, $5, $6, $7::timestamptz, $8::jsonb, $9) RETURNING id`,
    [
      c.clinica,
      c.pessoas['beatriz'],
      campos.prazo,
      campos.tipo,
      campos.pacienteId ?? null,
      campos.status ?? 'aberta',
      campos.concluidaEm ?? null,
      JSON.stringify(campos.historico ?? []),
      campos.etapa ?? null,
    ],
  )
  return r.rows[0]!.id
}

const nomes = (linhas: { nome?: string | null }[]) => linhas.map((l) => l.nome)

/* ================================================================ pacientes */

describe('relatório 1 — unidade e origem', () => {
  it('estreita pela unidade principal e pela origem da lista (sem caixa nem acento); 422 na unidade vizinha', async () => {
    await receber(c.pacientes['ana']!, '2026-01-10T15:00:00Z', 20000)
    await receber(c.pacientes['bruna']!, '2026-01-12T15:00:00Z', 9000)
    const base = { semCompraHaMeses: 3 }
    expect(nomes((await executar('pacientes-sem-compra', base)).body.linhas)).toEqual(['Ana Lúcia Souza', 'Bruna Martins'])

    const porUnidade = await executar('pacientes-sem-compra', { ...base, unidadeId: c.unidades['pituba'] })
    expect(porUnidade.statusCode, porUnidade.text).toBe(200)
    expect(nomes(porUnidade.body.linhas)).toEqual(['Bruna Martins'])
    expect(porUnidade.body.resumo).toEqual({ pacientes: 1 })
    expect(porUnidade.body.cabecalho.filtrosEmTexto).toContain('Unidade: Unidade Pituba')

    expect(nomes((await executar('pacientes-sem-compra', { ...base, origem: 'Instagram' })).body.linhas)).toEqual(['Bruna Martins'])
    expect(nomes((await executar('pacientes-sem-compra', { ...base, origem: 'nao-informada' })).body.linhas)).toEqual(['Ana Lúcia Souza'])
    await c.migrate.query(`UPDATE pacientes SET origem = 'Panfleto' WHERE id = $1`, [c.pacientes['ana']])
    expect(nomes((await executar('pacientes-sem-compra', { ...base, origem: 'fora-da-lista' })).body.linhas)).toEqual(['Ana Lúcia Souza'])

    expect((await executar('pacientes-sem-compra', { ...base, unidadeId: unidadeDaOutra })).statusCode).toBe(422)
    // A origem é da lista (L-IN-7): texto livre é 422.
    expect((await executar('pacientes-sem-compra', { ...base, origem: 'Panfleto' })).statusCode).toBe(422)
  })
})

describe('relatório 2 — dias ou meses, tipo de atendimento, unidade', () => {
  it('estreita por dias, pelo último atendimento do tipo e pela unidade; meses e dias juntos é 422', async () => {
    await c.migrate.query(`UPDATE pacientes SET ultima_consulta = '2026-01-10' WHERE id = $1`, [c.pacientes['ana']])
    await tarefa({ tipo: 'Procedimento realizado', prazo: '2026-05-01', pacienteId: c.pacientes['bruna']!, status: 'concluida', concluidaEm: '2026-05-01T15:00:00Z' })
    await tarefa({ tipo: 'Consulta realizada', prazo: '2026-10-20', pacienteId: c.pacientes['bruna']!, status: 'concluida', concluidaEm: '2026-10-20T15:00:00Z' })

    expect(nomes((await executar('pacientes-sem-atendimento', { semAtendimentoHaMeses: 3 })).body.linhas)).toEqual(['Ana Lúcia Souza'])
    const dias = await executar('pacientes-sem-atendimento', { semAtendimentoHaDias: 2 })
    expect(dias.statusCode, dias.text).toBe(200)
    expect(nomes(dias.body.linhas)).toEqual(['Ana Lúcia Souza', 'Bruna Martins'])

    const doTipo = await executar('pacientes-sem-atendimento', { semAtendimentoHaMeses: 3, tipo: 'Procedimento realizado' })
    expect(doTipo.body.linhas).toEqual([{ pacienteId: c.pacientes['bruna'], nome: 'Bruna Martins', ultimoAtendimento: '2026-05-01' }])
    expect(doTipo.body.resumo).toEqual({ pacientes: 1 })

    expect(nomes((await executar('pacientes-sem-atendimento', { semAtendimentoHaDias: 2, unidadeId: c.unidades['pituba'] })).body.linhas)).toEqual([
      'Bruna Martins',
    ])
    expect((await executar('pacientes-sem-atendimento', { semAtendimentoHaDias: 2, semAtendimentoHaMeses: 3 })).statusCode).toBe(422)
    expect((await executar('pacientes-sem-atendimento', { semAtendimentoHaDias: 2, unidadeId: unidadeDaOutra })).statusCode).toBe(422)
    // Tipo que não é de atendimento não entra.
    expect((await executar('pacientes-sem-atendimento', { semAtendimentoHaMeses: 3, tipo: 'Follow-up' })).statusCode).toBe(422)
  })
})

describe('relatório 3 — período, unidade e origem', () => {
  it('com período, o LTV das compras do período; unidade e origem estreitam; 422 na unidade vizinha e no período pela metade', async () => {
    await receber(c.pacientes['ana']!, '2026-01-10T15:00:00Z', 20000)
    await receber(c.pacientes['ana']!, '2026-10-10T15:00:00Z', 5000)
    await receber(c.pacientes['bruna']!, '2026-10-12T15:00:00Z', 9000)
    const sempre = await executar('pacientes-maior-ltv', { quantos: 5 }, 'camila')
    expect(sempre.body.linhas.map((l: { ltv: string }) => l.ltv)).toEqual(['25000', '9000'])

    const outubro = await executar('pacientes-maior-ltv', { quantos: 5, ...OUTUBRO }, 'camila')
    expect(outubro.statusCode, outubro.text).toBe(200)
    expect(outubro.body.linhas).toEqual([
      { pacienteId: c.pacientes['bruna'], nome: 'Bruna Martins', ltv: '9000', ticketMedio: '9000', compras: 1 },
      { pacienteId: c.pacientes['ana'], nome: 'Ana Lúcia Souza', ltv: '5000', ticketMedio: '5000', compras: 1 },
    ])
    expect(nomes((await executar('pacientes-maior-ltv', { quantos: 5, unidadeId: c.unidades['principal'] }, 'camila')).body.linhas)).toEqual([
      'Ana Lúcia Souza',
    ])
    expect(nomes((await executar('pacientes-maior-ltv', { quantos: 5, origem: 'Instagram' }, 'camila')).body.linhas)).toEqual(['Bruna Martins'])
    expect((await executar('pacientes-maior-ltv', { quantos: 5, unidadeId: unidadeDaOutra }, 'camila')).statusCode).toBe(422)
    expect((await executar('pacientes-maior-ltv', { quantos: 5, de: '2026-10-01' }, 'camila')).statusCode).toBe(422)
  })
})

describe('relatório 4 — mínimo de indicações', () => {
  it('só a indicadora com pelo menos N indicadas; o resumo é o do recorte', async () => {
    await paciente('Carla Indicada', { indicado_por_id: c.pacientes['ana'], criado_em: '2026-10-05T12:00:00Z' })
    await paciente('Dora Indicada', { indicado_por_id: c.pacientes['ana'], criado_em: '2026-10-06T12:00:00Z' })
    await paciente('Eva Indicada', { indicado_por_id: c.pacientes['bruna'], criado_em: '2026-10-07T12:00:00Z' })
    expect((await executar('pacientes-que-indicaram', OUTUBRO)).body.resumo).toEqual({ indicadoras: 2, indicadas: 3 })
    const r = await executar('pacientes-que-indicaram', { ...OUTUBRO, minimoDeIndicacoes: 2 })
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.linhas.map((l: { indicadora: string; indicadas: number }) => [l.indicadora, l.indicadas])).toEqual([['Ana Lúcia Souza', 2]])
    expect(r.body.resumo).toEqual({ indicadoras: 1, indicadas: 2 })
    expect((await executar('pacientes-que-indicaram', { ...OUTUBRO, minimoDeIndicacoes: 0 })).statusCode).toBe(422)
  })
})

describe('relatório 5 — vários procedimentos, período e situação do programa', () => {
  async function programa(pacienteId: string, procedimentoId: string, sessoes: number): Promise<string> {
    const m = await postar(
      c,
      '/v1/programas',
      { pacienteId, inicio: HOJE, itens: [{ chave: 'i1', procedimentoId, sessoes, intervaloDias: 7 }] },
      'beatriz',
    )
    expect(m.statusCode, m.text).toBe(201)
    return (m.body.id ?? m.body.programa?.id) as string
  }

  it('situação pela regra da tela Programas; os filtros de antes continuam valendo; 422 no procedimento vizinho', async () => {
    const a = procedimentos[0]!
    const b = procedimentos[1]!
    const daAna = await programa(c.pacientes['ana']!, a.id, 1)
    await programa(c.pacientes['bruna']!, b.id, 3)
    // A única sessão da Ana, feita: o programa dela está CONCLUÍDO.
    await c.migrate.query(`UPDATE tarefas SET status = 'concluida', concluida_em = now() WHERE programa_id = $1 AND tipo = 'Sessão de plano'`, [daAna])

    const concluidos = await executar('pacientes-por-procedimento', { procedimentoIds: [a.id, b.id], situacoes: ['concluido'] })
    expect(concluidos.statusCode, concluidos.text).toBe(200)
    expect(nomes(concluidos.body.linhas)).toEqual(['Ana Lúcia Souza'])
    expect(concluidos.body.resumo).toEqual({ pacientes: 1, programas: 1 })
    expect(nomes((await executar('pacientes-por-procedimento', { situacoes: ['ativo'] })).body.linhas)).toEqual(['Bruna Martins'])
    expect(nomes((await executar('pacientes-por-procedimento', { procedimentoIds: [b.id] })).body.linhas)).toEqual(['Bruna Martins'])
    // Os favoritos de antes (I-41): `{}` e `incluirEncerrados: false` são "ativo" do banco — ativo e concluído.
    expect(nomes((await executar('pacientes-por-procedimento', {})).body.linhas)).toEqual(['Ana Lúcia Souza', 'Bruna Martins'])
    expect(nomes((await executar('pacientes-por-procedimento', { incluirEncerrados: false, procedimentoId: a.id })).body.linhas)).toEqual([
      'Ana Lúcia Souza',
    ])
    // O período é o do início do programa.
    expect((await executar('pacientes-por-procedimento', { de: '2026-09-01', ate: '2026-09-30' })).body.linhas).toEqual([])

    const vizinho = (
      await c.migrate.query<{ id: string }>('SELECT id FROM procedimentos WHERE clinica_id = $1 LIMIT 1', [c.outraClinica])
    ).rows[0]!.id
    expect((await executar('pacientes-por-procedimento', { procedimentoIds: [a.id, vizinho] })).statusCode).toBe(422)
    expect((await executar('pacientes-por-procedimento', { procedimentoIds: [a.id], procedimentoId: a.id })).statusCode).toBe(422)
    expect((await executar('pacientes-por-procedimento', { situacoes: ['ativo'], incluirEncerrados: true })).statusCode).toBe(422)
  })
})

describe('relatório 6 — origem', () => {
  it('estreita pela origem, e o resumo por origem é o do recorte', async () => {
    await paciente('Carla Nova', { origem: 'Instagram', criado_em: '2026-10-05T12:00:00Z' })
    await paciente('Dora Nova', { origem: '', criado_em: '2026-10-06T12:00:00Z' })
    const r = await executar('pacientes-por-origem-e-campanha', { ...OUTUBRO, origem: 'Instagram' }, 'juliana')
    expect(r.statusCode, r.text).toBe(200)
    expect(nomes(r.body.linhas)).toEqual(['Carla Nova'])
    expect(r.body.resumo).toEqual({ pacientes: 1, convertidos: 0, porOrigem: [{ origem: 'Instagram', novos: 1, jaAtendidos: 0 }] })
  })
})

describe('relatório 7 — intervalo de datas', () => {
  it('o aniversário no intervalo, na ordem do dia; 29/02 cai em 28/02 no ano comum; mês e intervalo juntos é 422', async () => {
    await c.migrate.query(`UPDATE pacientes SET aniversario = '1990-11-05' WHERE id = $1`, [c.pacientes['ana']])
    await c.migrate.query(`UPDATE pacientes SET aniversario = '1985-10-30' WHERE id = $1`, [c.pacientes['bruna']])
    await paciente('Carla Bissexta', { aniversario: '2000-02-29' })
    const r = await executar('aniversariantes', { de: '2026-10-25', ate: '2026-11-10' }, 'juliana')
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.linhas.map((l: { nome: string; diaEMes: string }) => [l.nome, l.diaEMes])).toEqual([
      ['Bruna Martins', '30/10'],
      ['Ana Lúcia Souza', '05/11'],
    ])
    expect(r.body.resumo).toEqual({ pacientes: 2 })
    expect(nomes((await executar('aniversariantes', { de: '2027-02-20', ate: '2027-03-05' }, 'juliana')).body.linhas)).toEqual(['Carla Bissexta'])
    expect((await executar('aniversariantes', { mes: 10, de: '2026-10-01', ate: '2026-10-31' }, 'juliana')).statusCode).toBe(422)
    expect((await executar('aniversariantes', { de: '2026-10-01', ate: '2027-10-01' }, 'juliana')).statusCode).toBe(422)
  })
})

/* ============================================================== financeiro */

describe('relatório 8 — forma, tipo, unidade e quem registrou', () => {
  it('cada filtro estreita; Σ linhas = total; a forma só olha dias que contam; 422 nos ids vizinhos', async () => {
    const ana = c.pacientes['ana']!
    await receber(ana, '2026-10-05T15:00:00Z', 10000, { unidadeId: c.unidades['principal'] })
    await receber(ana, '2026-10-05T16:00:00Z', 5000, {
      forma: 'Dinheiro',
      tipo: 'Pagamento de saldo em aberto',
      unidadeId: c.unidades['pituba'],
      por: c.pessoas['juliana']!,
    })
    // 06/10 sem caixa fechado: aguardando, sem forma na linha.
    await receber(ana, '2026-10-06T15:00:00Z', 7000)
    await c.migrate.query(`INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1, '2026-10-05', '', $2)`, [
      c.clinica,
      c.pessoas['beatriz'],
    ])
    const soma = (linhas: { valor: string | null }[]) => linhas.reduce((s, l) => s + BigInt(l.valor ?? '0'), 0n).toString()

    const pix = await executar('recebimentos', { ...OUTUBRO, forma: 'Pix' })
    expect(pix.statusCode, pix.text).toBe(200)
    expect(pix.body.linhas.map((l: { data: string; forma: string }) => [l.data, l.forma])).toEqual([['2026-10-05', 'Pix']])
    expect(pix.body.resumo.total.emDinheiro).toBe('10000')
    expect(soma(pix.body.linhas)).toBe('10000')
    // O aguardando continua o total sem forma: nenhum "Pix do dia aberto".
    expect(pix.body.resumo.aguardandoFechamento).toBe('7000')

    for (const filtro of [
      { tipo: 'Pagamento de saldo em aberto' },
      { unidadeId: c.unidades['pituba'] },
      { registradoPorId: c.pessoas['juliana'] },
    ]) {
      const r = await executar('recebimentos', { ...OUTUBRO, ...filtro })
      expect(r.statusCode, r.text).toBe(200)
      expect(r.body.linhas).toHaveLength(1)
      expect(r.body.resumo.total.emDinheiro).toBe('5000')
      expect(soma(r.body.linhas)).toBe('5000')
      expect(r.body.resumo.aguardandoFechamento).toBe('0')
    }
    expect((await executar('recebimentos', { ...OUTUBRO, unidadeId: unidadeDaOutra })).statusCode).toBe(422)
    expect((await executar('recebimentos', { ...OUTUBRO, registradoPorId: pessoaDaOutra })).statusCode).toBe(422)
    expect((await executar('recebimentos', { ...OUTUBRO, forma: 'Boleto' })).statusCode).toBe(422)
  })
})

describe('relatório 10 — categoria', () => {
  it('só a categoria; o resumo soma o recorte', async () => {
    await c.migrate.query(
      `INSERT INTO contas_a_pagar (clinica_id, descricao, categoria, valor, vencimento, responsavel_id, forma_prevista)
       VALUES ($1, 'Aluguel', 'Ocupação', 250000, '2026-10-10', $2, 'Boleto'),
              ($1, 'Anúncio', 'Marketing', 40000, '2026-10-12', $2, 'Pix')`,
      [c.clinica, c.pessoas['beatriz']],
    )
    const r = await executar('contas', { ...OUTUBRO, categoria: 'Marketing' })
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.linhas.map((l: { descricao: string }) => l.descricao)).toEqual(['Anúncio'])
    expect(r.body.resumo).toEqual({ contas: 1, valor: '40000', valorPago: '0' })
    expect((await executar('contas', { ...OUTUBRO, categoria: 'Aluguel' })).statusCode).toBe(422)
  })
})

/* ================================================================= estoque */

describe('relatórios 11 e 12 — motivo, local e fornecedor', () => {
  async function local(nome: string, clinica = c.clinica): Promise<string> {
    return (await c.migrate.query<{ id: string }>('INSERT INTO locais_de_estoque (clinica_id, nome) VALUES ($1, $2) RETURNING id', [clinica, nome])).rows[0]!.id
  }
  async function item(nome: string, localId: string): Promise<string> {
    return (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO itens_de_estoque (clinica_id, nome, medida, custo, local_id) VALUES ($1, $2, 'un.', 1000, $3) RETURNING id`,
        [c.clinica, nome, localId],
      )
    ).rows[0]!.id
  }
  async function mov(itemId: string, tipo: string, milesimos: number, dia: string, extra: { motivo?: string; notaId?: string } = {}) {
    await c.migrate.query(
      `INSERT INTO movimentos_de_estoque (clinica_id, item_id, tipo, milesimos, dia, paciente_id, motivo, nota_id, criado_por)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9)`,
      [c.clinica, itemId, tipo, milesimos, dia, tipo === 'consumo' ? c.pacientes['ana'] : null, extra.motivo ?? '', extra.notaId ?? null, c.pessoas['beatriz']],
    )
  }
  async function nota(fornecedor: string, cnpj: string): Promise<string> {
    return (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO notas_de_entrada (clinica_id, numero, fornecedor, cnpj, dia, registrada_por) VALUES ($1, '1', $2, $3, '2026-10-02', $4) RETURNING id`,
        [c.clinica, fornecedor, cnpj, c.pessoas['beatriz']],
      )
    ).rows[0]!.id
  }

  it('11: o motivo é o tipo da saída e o local é o do item; Σ custo das linhas = resumo; 422 no local vizinho', async () => {
    const sala = await local('Sala 1')
    const almox = await local('Almoxarifado')
    const luva = await item('Luva', sala)
    const gaze = await item('Gaze', almox)
    await mov(luva, 'consumo', -2000, '2026-10-05')
    await mov(luva, 'interno', -1000, '2026-10-06', { motivo: 'Limpeza' })
    await mov(gaze, 'descarte', -3000, '2026-10-07')
    const base = { modo: 'calendario', ...OUTUBRO }
    const custo = (linhas: { custo: string }[]) => linhas.reduce((s, l) => s + BigInt(l.custo), 0n).toString()

    const descarte = await executar('saidas-de-estoque', { ...base, motivo: 'descarte' })
    expect(descarte.statusCode, descarte.text).toBe(200)
    expect(descarte.body.linhas.map((l: { item: string }) => l.item)).toEqual(['Gaze'])
    expect(descarte.body.resumo).toEqual({ linhas: 1, custo: custo(descarte.body.linhas) })

    const naSala = await executar('saidas-de-estoque', { ...base, localId: sala })
    expect(naSala.body.linhas.map((l: { item: string }) => l.item)).toEqual(['Luva', 'Luva'])
    expect(naSala.body.resumo).toEqual({ linhas: 2, custo: custo(naSala.body.linhas) })
    expect(naSala.body.cabecalho.filtrosEmTexto).toContain('Local: Sala 1')

    expect((await executar('saidas-de-estoque', { ...base, localId: await local('Vizinho', c.outraClinica) })).statusCode).toBe(422)
    // Ajuste não é saída (B8): fora da lista.
    expect((await executar('saidas-de-estoque', { ...base, motivo: 'ajuste' })).statusCode).toBe(422)
  })

  it('12: o fornecedor é o emissor da nota, por id opaco listado em opções; 422 para id que não é desta clínica', async () => {
    const sala = await local('Sala 1')
    const luva = await item('Luva', sala)
    const x = await nota('Distribuidora X', '12345678000199')
    const y = await nota('Farma Y', '')
    await mov(luva, 'entrada', 5000, '2026-10-02', { notaId: x })
    await mov(luva, 'entrada', 7000, '2026-10-03', { notaId: y })
    await mov(luva, 'entrada', 1000, '2026-10-04')

    const opcoes = await pegar(c, '/v1/relatorios/opcoes/fornecedores', {}, 'beatriz')
    expect(opcoes.statusCode, opcoes.text).toBe(200)
    const fornecedores = opcoes.body.fornecedores as { id: string; nome: string }[]
    expect(fornecedores.map((f) => f.nome)).toEqual(['Distribuidora X', 'Farma Y'])
    expect((await pegar(c, '/v1/relatorios/opcoes/fornecedores', {}, 'juliana')).statusCode).toBe(403)

    const r = await executar('entradas-de-estoque', { ...OUTUBRO, fornecedorId: fornecedores[0]!.id })
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.linhas.map((l: { data: string }) => l.data)).toEqual(['2026-10-02'])
    expect(r.body.resumo).toEqual({ linhas: 1, custo: r.body.linhas[0].custo })
    expect(r.body.cabecalho.filtrosEmTexto).toContain('Fornecedor: Distribuidora X')
    expect((await executar('entradas-de-estoque', { ...OUTUBRO, fornecedorId: randomUUID() })).statusCode).toBe(422)
  })
})

/* ================================================================= jornada */

describe('relatório 13 — etapa e motivo de perda', () => {
  it('estreita pela etapa do cartão e pelo motivo do último perder; 422 no motivo vizinho', async () => {
    const motivos = (
      await c.migrate.query<{ id: string }>('SELECT id FROM motivos_de_perda WHERE clinica_id = $1 ORDER BY ordem, nome LIMIT 2', [c.clinica])
    ).rows.map((m) => m.id)
    const [preco, outro] = motivos as [string, string]
    const ev = (acao: string, etapa: string, em: string, extra: Record<string, unknown> = {}) => ({ acao, etapa, em, porId: c.pessoas['beatriz'], ...extra })
    await tarefa({
      tipo: 'Consulta realizada',
      prazo: '2026-10-05',
      pacienteId: c.pacientes['ana']!,
      etapa: 'perdido',
      status: 'concluida',
      concluidaEm: '2026-10-05T15:00:00Z',
      historico: [
        ev('registrarOrcamento', 'orcamento', '2026-10-05T15:00:00Z', { valor: '100000' }),
        ev('perder', 'perdido', '2026-10-07T15:00:00Z', { motivoId: preco, motivo: 'Preço' }),
      ],
    })
    await tarefa({
      tipo: 'Consulta realizada',
      prazo: '2026-10-06',
      pacienteId: c.pacientes['bruna']!,
      etapa: 'orcamento',
      status: 'concluida',
      concluidaEm: '2026-10-06T15:00:00Z',
      historico: [ev('registrarOrcamento', 'orcamento', '2026-10-06T15:00:00Z', { valor: '50000' })],
    })
    expect(nomes((await executar('orcamentos', OUTUBRO)).body.linhas)).toEqual(['Ana Lúcia Souza', 'Bruna Martins'])
    const perdidos = await executar('orcamentos', { ...OUTUBRO, etapa: 'perdido' })
    expect(perdidos.statusCode, perdidos.text).toBe(200)
    expect(nomes(perdidos.body.linhas)).toEqual(['Ana Lúcia Souza'])
    expect(perdidos.body.resumo.orcamentos).toBe(1)
    expect(nomes((await executar('orcamentos', { ...OUTUBRO, motivoDePerdaId: preco })).body.linhas)).toEqual(['Ana Lúcia Souza'])
    expect((await executar('orcamentos', { ...OUTUBRO, motivoDePerdaId: outro })).body.linhas).toEqual([])
    const vizinho = (await c.migrate.query<{ id: string }>('SELECT id FROM motivos_de_perda WHERE clinica_id = $1 LIMIT 1', [c.outraClinica])).rows[0]!.id
    expect((await executar('orcamentos', { ...OUTUBRO, motivoDePerdaId: vizinho })).statusCode).toBe(422)
  })
})

describe('relatório 14 — recontatada sim ou não', () => {
  it('sim = recontato no prazo ou depois; o resumo é o do recorte', async () => {
    const ev = (acao: string, etapa: string, em: string) => ({ acao, etapa, em, porId: c.pessoas['beatriz'] })
    for (const h of [
      [ev('noshow', 'faltou', '2026-10-05T15:00:00Z'), ev('reagendar', 'agendado', '2026-10-06T15:00:00Z')],
      [ev('noshow', 'faltou', '2026-10-10T15:00:00Z')],
      [ev('desmarcar', 'desmarcou', '2026-10-23T15:00:00Z')],
    ]) {
      await tarefa({ tipo: 'Consulta agendada', prazo: '2026-10-05', pacienteId: c.pacientes['bruna']!, historico: h })
    }
    const sim = await executar('faltas-e-desmarcacoes', { ...OUTUBRO, recontatada: 'sim' }, 'juliana')
    expect(sim.statusCode, sim.text).toBe(200)
    expect(sim.body.linhas.map((l: { data: string }) => l.data)).toEqual(['2026-10-05'])
    expect(sim.body.resumo).toEqual({ faltas: 1, maduras: 1, recontatadasEmAteDoisDias: 1, aguardandoPrazo: 0 })
    const nao = await executar('faltas-e-desmarcacoes', { ...OUTUBRO, recontatada: 'nao' }, 'juliana')
    expect(nao.body.linhas.map((l: { situacao: string }) => l.situacao)).toEqual(['sem-recontato', 'aguardando-prazo'])
    expect(nao.body.resumo).toEqual({ faltas: 2, maduras: 1, recontatadasEmAteDoisDias: 0, aguardandoPrazo: 1 })
  })
})

/* =================================================================== equipe */

describe('relatório 15 — situação e tipo', () => {
  it('o tipo entra no WHERE do Painel e a situação na classificação; resumo.total = linhas', async () => {
    await tarefa({ tipo: 'Follow-up', prazo: '2026-10-10', pacienteId: c.pacientes['bruna']!, status: 'concluida', concluidaEm: '2026-10-09T15:00:00Z' })
    await tarefa({ tipo: 'Recaptação', prazo: '2026-10-12', pacienteId: c.pacientes['bruna']! })
    await tarefa({ tipo: 'Follow-up', prazo: '2026-10-28', pacienteId: c.pacientes['bruna']! })
    expect((await executar('tarefas-da-equipe', OUTUBRO)).body.linhas).toHaveLength(3)

    const follow = await executar('tarefas-da-equipe', { ...OUTUBRO, tipo: 'Follow-up' })
    expect(follow.statusCode, follow.text).toBe(200)
    expect(follow.body.linhas.map((l: { noPrazo: string }) => l.noPrazo)).toEqual(['ok', 'a_vencer'])
    expect(follow.body.resumo.prazos).toMatchObject({ total: 2, noPrazo: 1, aVencer: 1, atrasadas: 0, taxaNoPrazo: 100 })

    const atrasadas = await executar('tarefas-da-equipe', { ...OUTUBRO, situacao: 'atrasada' })
    expect(atrasadas.body.linhas.map((l: { tarefa: string }) => l.tarefa)).toEqual(['Recaptação'])
    expect(atrasadas.body.resumo.prazos).toEqual({ total: 1, noPrazo: 0, comAtraso: 0, atrasadas: 1, aVencer: 0, taxaNoPrazo: 0 })
    expect((await executar('tarefas-da-equipe', { ...OUTUBRO, tipo: 'Inventado' })).statusCode).toBe(422)
  })
})
