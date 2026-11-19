import { randomUUID } from 'node:crypto'
import { CAMPOS_MONETARIOS } from '@fir/domain'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { apagarPacientesDaExportacaoDeTeste } from '../banco/limpeza-de-teste'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparProgramas,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * T9 — os outros 11 relatórios e "Criar campanha com esta lista", sobre
 * Postgres real (seam HTTP da API).
 *
 * HOJE = sábado 24/10/2026 (America/Bahia). `beatriz` (supervisão) tem tudo,
 * inclusive `campanhas.gerir`; `juliana` (recepção) tem `pacientes` e
 * `jornada`, sem `valores` nem `campanhas.gerir`; `camila` (comercial) tem
 * `pacientes` e `valores`, sem `jornada`; `sonia` (caixa) tem `cobrancas` e
 * não vê valor; `nara` (enfermagem) tem `programas`, sem `jornada`. Todas
 * ganham `indicadores`.
 */
let c: Cenario
let procedimento: { id: string; nome: string }

const executar = (chave: string, filtros: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/relatorios/${chave}/execucoes`, { filtros }, quem)

const criarCampanha = (chave: string, corpo: Record<string, unknown>, opcoes: { quem?: string; idempotencia?: string | null } = {}) => {
  const r = request(c.app.getHttpServer())
    .post(`/v1/relatorios/${chave}/campanha`)
    .set('Cookie', c.cookies[opcoes.quem ?? 'beatriz']!)
  if (opcoes.idempotencia !== null) r.set('Idempotency-Key', opcoes.idempotencia ?? randomUUID())
  return r.send(corpo)
}

const tarefa = () => ({ tipo: 'Recaptação', descricao: '', prazo: '2026-10-30', responsavelId: c.pessoas['juliana'] })
const nova = (nome = 'Volta pra gente') => ({
  nome,
  inicio: '2026-10-24',
  fim: '2026-11-30',
  metrica: 'convertidos',
  metaEmNumero: 10,
})
const SEM_ATENDIMENTO = { semAtendimentoHaMeses: 3 }

const contar = async (sql: string, params: unknown[] = [c.clinica]): Promise<number> =>
  Number((await c.migrate.query<{ n: string }>(sql, params)).rows[0]!.n)
const tarefasDaClinica = () => contar('SELECT count(*)::text AS n FROM tarefas WHERE clinica_id = $1')
const campanhasDaClinica = () => contar('SELECT count(*)::text AS n FROM campanhas WHERE clinica_id = $1')

/** Uma paciente nova, ativa, que o `afterEach` desativa. */
async function paciente(nome: string, extra: Record<string, unknown> = {}): Promise<string> {
  const colunas = ['clinica_id', 'nome', ...Object.keys(extra)]
  const valores = [c.clinica, nome, ...Object.values(extra)]
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO pacientes (${colunas.join(', ')}) VALUES (${colunas.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    valores,
  )
  return r.rows[0]!.id
}

async function receber(paciente: string, em: string, valor: number, extra: { valorAberto?: number; programaId?: string; tarefaId?: string } = {}) {
  await c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, programa_id, tipo, valor, valor_aberto, forma, recebido_em, registrado_por)
     VALUES ($1, $2, $3, $4, 'Consulta realizada', $5, $6, $7, $8::timestamptz, $9)`,
    [
      c.clinica,
      paciente,
      extra.tarefaId ?? null,
      extra.programaId ?? null,
      valor,
      extra.valorAberto ?? 0,
      // Sem dinheiro, sem forma (`recebimento_forma_so_com_dinheiro`).
      valor > 0 ? 'Pix' : '',
      em,
      c.pessoas['beatriz'],
    ],
  )
}

async function limparTudo(): Promise<void> {
  await apagarPacientesDaExportacaoDeTeste(c.migrate, c.clinica)
  await c.migrate.query('DELETE FROM tentativas_de_relatorio WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('BEGIN')
  try {
    await c.migrate.query('ALTER TABLE auditoria DISABLE TRIGGER auditoria_sem_update')
    await c.migrate.query(`DELETE FROM auditoria WHERE clinica_id = $1 AND entidade IN ('relatorio', 'exportacao_de_relatorio')`, [
      c.clinica,
    ])
    await c.migrate.query('ALTER TABLE auditoria ENABLE TRIGGER auditoria_sem_update')
    await c.migrate.query('COMMIT')
  } catch (e) {
    await c.migrate.query('ROLLBACK')
    throw e
  }
  await limparFinanceiro(c)
  await limparProgramas(c)
  await limparTarefas(c)
  await c.migrate.query('DELETE FROM contas_a_pagar WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('UPDATE pacientes SET campanha_id = NULL, indicado_por_id = NULL WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('DELETE FROM campanhas WHERE clinica_id = $1', [c.clinica])
  // As pacientes criadas pelo teste saem do caminho (desativar é estado, regra 20).
  await c.migrate.query(
    `UPDATE pacientes SET ativo = false, desativado_em = now(), motivo_desativacao = 'erro-de-cadastro'
      WHERE clinica_id = $1 AND ativo AND id <> ALL($2::uuid[])`,
    [c.clinica, [c.pacientes['ana'], c.pacientes['bruna']]],
  )
  await c.migrate.query(`UPDATE pacientes SET ultima_consulta = NULL, origem = '' WHERE clinica_id = $1`, [c.clinica])
}

beforeAll(async () => {
  c = await montarCenario('relatorios-t9')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores']
      WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec', 'pf_ter', 'pf_cxa', 'pf_enf')`,
    [c.clinica],
  )
  const p = await c.migrate.query<{ id: string; nome: string }>(
    'SELECT id, nome FROM procedimentos WHERE clinica_id = $1 ORDER BY nome LIMIT 1',
    [c.clinica],
  )
  procedimento = p.rows[0]!
})
afterAll(async () => {
  await limparTudo()
  await desmontarCenario(c)
})
beforeEach(limparTudo)

/** Ana e Bruna sem atendimento desde o começo do ano. */
const semAtendimento = () =>
  c.migrate.query(`UPDATE pacientes SET ultima_consulta = '2026-01-10' WHERE id = ANY($1::uuid[])`, [
    [c.pacientes['ana'], c.pacientes['bruna']],
  ])

/* =========================================================== os relatórios */

describe('relatórios 2, 3, 4, 6 e 7 — pacientes', () => {
  it('2: quem não vem desde antes do corte, do mais antigo para o mais recente', async () => {
    await c.migrate.query(`UPDATE pacientes SET ultima_consulta = '2026-01-10' WHERE id = $1`, [c.pacientes['ana']])
    await c.migrate.query(`UPDATE pacientes SET ultima_consulta = '2026-09-30' WHERE id = $1`, [c.pacientes['bruna']])
    const r = await executar('pacientes-sem-atendimento', SEM_ATENDIMENTO, 'juliana')
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.linhas).toEqual([
      // Sem `valores` (juliana), o LTV sai apagado; o movimento é o do cadastro, sem tipo.
      { pacienteId: c.pacientes['ana'], nome: 'Ana Lúcia Souza', ultimoAtendimento: '2026-01-10', tipo: null, ltv: null, tarefaAberta: 'nao' },
    ])
    expect(r.body.resumo).toEqual({ pacientes: 1 })
  })

  it('relatorio-3-exige-valores: sem `valores`, 403; com, o ranking e o ticket médio pelo value object', async () => {
    expect((await executar('pacientes-maior-ltv', {}, 'juliana')).statusCode).toBe(403)
    await receber(c.pacientes['ana']!, '2026-01-10T15:00:00Z', 20000)
    await receber(c.pacientes['ana']!, '2026-03-10T15:00:00Z', 50001)
    await receber(c.pacientes['bruna']!, '2026-10-23T15:00:00Z', 9000)
    const r = await executar('pacientes-maior-ltv', { quantos: 5 }, 'camila')
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.linhas).toEqual([
      // 70.001 ÷ 2 = 35.000,5 → meio-para-cima (`Dinheiro.media`).
      { pacienteId: c.pacientes['ana'], posicao: 1, nome: 'Ana Lúcia Souza', ltv: '70001', compras: 2, ticketMedio: '35001', ultimaCompra: '2026-03-10' },
      { pacienteId: c.pacientes['bruna'], posicao: 2, nome: 'Bruna Martins', ltv: '9000', compras: 1, ticketMedio: '9000', ultimaCompra: '2026-10-23' },
    ])
    // O LTV é o da ficha.
    const ficha = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}`, {}, 'camila')
    expect(JSON.stringify(ficha.body)).toContain('70001')
  })

  it('4: as indicadoras do Painel, sem o nome das indicadas; receita só do período com caixa fechado', async () => {
    const carla = await paciente('Carla Indicada', { indicado_por_id: c.pacientes['ana'], criado_em: '2026-10-05T12:00:00Z' })
    await paciente('Dora Indicada', { indicado_por_id: c.pacientes['ana'], criado_em: '2026-10-06T12:00:00Z' })
    // Fora da janela: não conta.
    await paciente('Eva Indicada', { indicado_por_id: c.pacientes['ana'], criado_em: '2026-09-06T12:00:00Z' })
    const t = await c.migrate.query<{ id: string }>(
      `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tipo, paciente_id, status, concluida_em)
       VALUES ($1, $2, $2, 'Consulta', '2026-10-07', 'Consulta realizada', $3, 'concluida', '2026-10-07T15:00:00Z') RETURNING id`,
      [c.clinica, c.pessoas['beatriz'], carla],
    )
    await receber(carla, '2026-10-07T15:00:00Z', 15000, { tarefaId: t.rows[0]!.id })
    await c.migrate.query(`INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1, '2026-10-07', '', $2)`, [
      c.clinica,
      c.pessoas['beatriz'],
    ])
    const filtros = { de: '2026-10-01', ate: '2026-10-31' }
    const r = await executar('pacientes-que-indicaram', filtros)
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.linhas).toEqual([
      { pacienteId: c.pacientes['ana'], indicadora: 'Ana Lúcia Souza', indicadas: 2, viraramPacientes: 1, receitaDasIndicadas: '15000' },
    ])
    expect(r.text).not.toContain('Carla')
    expect(r.text).not.toContain('Dora')
    const painel = await pegar(c, '/v1/painel', { periodo: 'per', ...filtros }, 'beatriz')
    expect(painel.body.quemMaisIndica).toEqual([{ pacienteId: c.pacientes['ana'], nome: 'Ana Lúcia Souza', indicadas: 2 }])
    // Sem `valores`, a receita sai apagada e a contagem fica.
    const j = await executar('pacientes-que-indicaram', filtros, 'juliana')
    expect(j.body.linhas[0]).toMatchObject({ indicadas: 2, receitaDasIndicadas: null })
  })

  it('6: por origem, as mesmas contagens de "Novos pacientes" do Painel', async () => {
    const camp = await c.migrate.query<{ id: string }>(
      `INSERT INTO campanhas (clinica_id, nome, inicio, fim, metrica, meta) VALUES ($1, 'Outubro Rosa', '2026-10-01', '2026-10-31', 'convertidos', 10) RETURNING id`,
      [c.clinica],
    )
    const p1 = await paciente('Fabi Nova', { origem: 'Instagram', campanha_id: camp.rows[0]!.id, criado_em: '2026-10-05T12:00:00Z' })
    await paciente('Gil Nova', { origem: 'Instagram', criado_em: '2026-10-06T12:00:00Z' })
    await paciente('Hana Nova', { criado_em: '2026-10-07T12:00:00Z' })
    await c.migrate.query(
      `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tipo, paciente_id, status, concluida_em)
       VALUES ($1, $2, $2, 'Consulta', '2026-10-08', 'Consulta realizada', $3, 'concluida', '2026-10-08T15:00:00Z')`,
      [c.clinica, c.pessoas['beatriz'], p1],
    )
    const filtros = { de: '2026-10-01', ate: '2026-10-31' }
    const r = await executar('pacientes-por-origem-e-campanha', filtros)
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.linhas.find((l: { nome: string }) => l.nome === 'Fabi Nova')).toMatchObject({
      origem: 'Instagram',
      campanha: 'Outubro Rosa',
      convertido: 'sim',
    })
    const painel = await pegar(c, '/v1/painel', { periodo: 'per', ...filtros }, 'beatriz')
    const doPainel = (painel.body.novosPacientes.porOrigem as { origem: string; novos: number; jaAtendidos: number }[])
      .map(({ origem, novos, jaAtendidos }) => ({ origem, novos, jaAtendidos }))
      .sort((a, b) => a.origem.localeCompare(b.origem))
    const doRelatorio = [...(r.body.resumo.porOrigem as { origem: string }[])].sort((a, b) => a.origem.localeCompare(b.origem))
    expect(doRelatorio).toEqual(doPainel)
    expect(doRelatorio).toEqual([
      { origem: 'Instagram', novos: 2, jaAtendidos: 1 },
      { origem: 'Não informada', novos: 1, jaAtendidos: 0 },
    ])
  })

  it('7: dia/mês e idade de hoje, NUNCA a data completa de nascimento (I-38)', async () => {
    const r = await executar('aniversariantes', { mes: 10 }, 'juliana')
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.linhas).toEqual([
      { pacienteId: c.pacientes['ana'], nome: 'Ana Lúcia Souza', diaEMes: '24/10', idade: 36, ultimoAtendimento: null },
    ])
    expect(r.text).not.toContain('1990')
  })
})

describe('relatórios 5 e 13 — classe saúde exige jornada (L-IN-2)', () => {
  it('saude-exige-jornada: o 5 sem `jornada` (nara, com `programas`) e o 13 sem `jornada` (camila) dão 403', async () => {
    expect((await executar('pacientes-por-procedimento', {}, 'nara')).statusCode).toBe(403)
    expect((await executar('orcamentos', { de: '2026-10-01', ate: '2026-10-31' }, 'camila')).statusCode).toBe(403)
  })

  it('5: feitas e restantes pela regra da tela Programas, um item por linha', async () => {
    const m = await postar(
      c,
      '/v1/programas',
      { pacienteId: c.pacientes['ana'], inicio: HOJE, itens: [{ chave: 'i1', procedimentoId: procedimento.id, sessoes: 3, intervaloDias: 7 }] },
      'beatriz',
    )
    expect(m.statusCode, m.text).toBe(201)
    const programaId = (m.body.id ?? m.body.programa?.id) as string
    await c.migrate.query(
      `UPDATE tarefas SET status = 'concluida', concluida_em = now()
        WHERE id = (SELECT id FROM tarefas WHERE programa_id = $1 AND tipo = 'Sessão de plano' ORDER BY prazo LIMIT 1)`,
      [programaId],
    )
    const r = await executar('pacientes-por-procedimento', { procedimentoId: procedimento.id })
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.classe).toBe('saude')
    expect(r.body.linhas).toEqual([
      expect.objectContaining({ nome: 'Ana Lúcia Souza', procedimento: procedimento.nome, sessoesFeitas: 1, sessoesRestantes: 2 }),
    ])
    const lista = await pegar(c, '/v1/programas', {}, 'beatriz')
    expect(JSON.stringify(lista.body)).toContain(programaId)
  })

  it('13: o orçamento vivo do período; valor fechado do resumo = o do Painel (números c.3)', async () => {
    const t = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'paciente',
        pacienteId: c.pacientes['ana'],
        tipo: 'Consulta agendada',
        responsavelId: c.pessoas['beatriz'],
        quando: { modo: 'retroativo', em: HOJE },
      },
      'beatriz',
    )
    expect(t.statusCode, t.text).toBe(201)
    const o = await postar(c, `/v1/tarefas/${t.body.tarefa.id}/jornada`, { acao: 'registrarOrcamento', valor: '360000' }, 'beatriz')
    expect(o.statusCode, o.text).toBe(200)
    const filtros = { de: '2026-10-01', ate: '2026-10-31' }
    const r = await executar('orcamentos', filtros, 'juliana')
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.classe).toBe('saude')
    // Sem `valores`, nada de dinheiro (regra 17).
    expect(r.body.linhas).toEqual([
      expect.objectContaining({ nome: 'Ana Lúcia Souza', data: HOJE, situacao: 'enviado', valorOrcamento: null, valorFechado: null }),
    ])
    const b = await executar('orcamentos', filtros)
    expect(b.body.linhas[0]).toMatchObject({ valorOrcamento: '360000', valorFechado: null })
    const painel = await pegar(c, '/v1/painel', { periodo: 'per', ...filtros }, 'beatriz')
    expect(b.body.resumo.valorFechado).toBe(painel.body.pacientes.valorDosOrcamentosPagos)
    expect(b.body.resumo.enviados).toBe(1)
  })
})

describe('relatório 13 — Σ da coluna = resumo = Painel (D3, D-I3)', () => {
  it('o "Pagamento de orçamento" do dia fechado entra; o de hoje, com o caixa aberto, não', async () => {
    const pagamento = async (dia: string, valor: number) => {
      const t = await c.migrate.query<{ id: string }>(
        `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tipo, paciente_id, status, concluida_em)
         VALUES ($1, $2, $2, 'Pagamento', $3::date, 'Pagamento de orçamento', $4, 'concluida', ($3 || 'T15:00:00Z')::timestamptz) RETURNING id`,
        [c.clinica, c.pessoas['beatriz'], dia, c.pacientes['bruna']],
      )
      await receber(c.pacientes['bruna']!, `${dia}T15:00:00Z`, valor, { tarefaId: t.rows[0]!.id })
    }
    await pagamento('2026-10-20', 25000)
    await pagamento(HOJE, 7000)
    await c.migrate.query(`INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1, '2026-10-20', '', $2)`, [
      c.clinica,
      c.pessoas['beatriz'],
    ])
    const filtros = { de: '2026-10-01', ate: '2026-10-31' }
    const r = await executar('orcamentos', filtros)
    expect(r.statusCode, r.text).toBe(200)
    const soma = (r.body.linhas as { valorFechado: string | null }[]).reduce((s, l) => s + BigInt(l.valorFechado ?? '0'), 0n)
    expect(r.body.resumo.valorFechado).toBe('25000')
    expect(soma.toString()).toBe(r.body.resumo.valorFechado)
    expect(r.text).not.toContain('7000')
    // D-I3: o Painel corta pelos mesmos dias — o pagamento de hoje, caixa aberto, fora dos dois.
    const painel = await pegar(c, '/v1/painel', { periodo: 'per', ...filtros }, 'beatriz')
    expect(painel.body.pacientes.valorDosOrcamentosPagos).toBe(r.body.resumo.valorFechado)
    expect(painel.text).not.toContain('"7000"')

    // Fechado o caixa de hoje, o pagamento aparece nos dois.
    await c.migrate.query(`INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1, $2, '', $3)`, [
      c.clinica,
      HOJE,
      c.pessoas['beatriz'],
    ])
    const depois = await executar('orcamentos', filtros)
    const painelDepois = await pegar(c, '/v1/painel', { periodo: 'per', ...filtros }, 'beatriz')
    expect(depois.body.resumo.valorFechado).toBe('32000')
    expect(painelDepois.body.pacientes.valorDosOrcamentosPagos).toBe('32000')
  })
})

describe('relatório 9 — saldos em aberto', () => {
  async function saldos() {
    const m = await postar(
      c,
      '/v1/programas',
      { pacienteId: c.pacientes['ana'], inicio: HOJE, itens: [{ chave: 'i1', procedimentoId: procedimento.id, sessoes: 2, intervaloDias: 7 }] },
      'beatriz',
    )
    expect(m.statusCode, m.text).toBe(201)
    const programaId = (m.body.id ?? m.body.programa?.id) as string
    await receber(c.pacientes['ana']!, '2026-10-01T12:00:00Z', 0, { valorAberto: 10000 })
    await receber(c.pacientes['ana']!, '2026-10-02T12:00:00Z', 0, { valorAberto: 30000, programaId })
    await receber(c.pacientes['bruna']!, '2026-10-20T12:00:00Z', 0, { valorAberto: 5000 })
    return programaId
  }

  it('Σ com corte hoje = `aReceber` de Cobranças; agrupado por adesão', async () => {
    const programaId = await saldos()
    const r = await executar('saldos-em-aberto', {})
    expect(r.statusCode, r.text).toBe(200)
    const linhas = r.body.linhas as { pacienteId: string; programaId: string | null; adesao: string; valorAberto: string; desde: string }[]
    expect(linhas.map((l) => [l.pacienteId, l.programaId, l.valorAberto, l.desde])).toEqual([
      [c.pacientes['ana'], null, '10000', '2026-10-01'],
      [c.pacientes['ana'], programaId, '30000', '2026-10-02'],
      [c.pacientes['bruna'], null, '5000', '2026-10-20'],
    ])
    expect(linhas[0]!.adesao).toBe('Geral')
    expect(linhas[1]!.adesao).toBe(procedimento.nome)
    const soma = linhas.reduce((s, l) => s + BigInt(l.valorAberto), 0n)
    const cob = await pegar(c, '/v1/cobrancas', {}, 'beatriz')
    expect(cob.statusCode).toBe(200)
    expect(soma.toString()).toBe(cob.body.aReceber)
    expect(r.body.resumo).toEqual({ pacientes: 2, grupos: 3, aReceber: cob.body.aReceber })
  })

  it('corte passado: a posição no fim daquele dia; corte futuro, 422', async () => {
    await saldos()
    const r = await executar('saldos-em-aberto', { ate: '2026-10-10' })
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.resumo).toEqual({ pacientes: 1, grupos: 2, aReceber: '40000' })
    expect((await executar('saldos-em-aberto', { ate: '2026-10-25' })).statusCode).toBe(422)
  })

  it('sem `valores` (sonia): as linhas ficam, o dinheiro sai, e a faixa de valor é 403', async () => {
    await saldos()
    const r = await executar('saldos-em-aberto', {}, 'sonia')
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.linhas).toHaveLength(3)
    expect(r.body.resumo.aReceber).toBeNull()
    for (const l of r.body.linhas) expect(l.valorAberto).toBeNull()
    expect((await executar('saldos-em-aberto', { valorMinimo: '100' }, 'sonia')).statusCode).toBe(403)
  })
})

describe('relatórios 10 e 14', () => {
  it('10: as contas do vencimento, com a forma usada ou a prevista', async () => {
    await c.migrate.query(
      `INSERT INTO contas_a_pagar (clinica_id, descricao, categoria, valor, vencimento, responsavel_id, forma_prevista)
       VALUES ($1, 'Aluguel', 'Ocupação', 250000, '2026-10-10', $2, 'Boleto'),
              ($1, 'Luz', 'Ocupação', 30000, '2026-11-10', $2, 'Pix')`,
      [c.clinica, c.pessoas['beatriz']],
    )
    const r = await executar('contas', { de: '2026-10-01', ate: '2026-10-31' })
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.linhas).toEqual([
      expect.objectContaining({ descricao: 'Aluguel', valor: '250000', pagoEm: null, valorPago: null, forma: 'Boleto' }),
    ])
    expect(r.body.resumo).toEqual({ contas: 1, valor: '250000', valorPago: '0' })
    expect((await executar('contas', { de: '2026-10-01', ate: '2026-10-31' }, 'sonia')).statusCode).toBe(403)
  })

  it('14: recontato pela I-11 — no prazo, fora dele e aguardando', async () => {
    const ev = (acao: string, etapa: string, em: string) => ({ acao, etapa, em, porId: c.pessoas['beatriz'] })
    const historicos = [
      [ev('noshow', 'faltou', '2026-10-05T15:00:00Z'), ev('reagendar', 'agendado', '2026-10-06T15:00:00Z')],
      [ev('noshow', 'faltou', '2026-10-10T15:00:00Z')],
      [ev('desmarcar', 'desmarcou', '2026-10-23T15:00:00Z')],
    ]
    for (const h of historicos) {
      await c.migrate.query(
        `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tipo, paciente_id, historico)
         VALUES ($1, $2, $2, 'Consulta', '2026-10-05', 'Consulta agendada', $3, $4::jsonb)`,
        [c.clinica, c.pessoas['beatriz'], c.pacientes['bruna'], JSON.stringify(h)],
      )
    }
    const r = await executar('faltas-e-desmarcacoes', { de: '2026-10-01', ate: '2026-10-31' }, 'juliana')
    expect(r.statusCode, r.text).toBe(200)
    expect((r.body.linhas as { data: string; motivo: string; situacao: string }[]).map((l) => [l.data, l.motivo, l.situacao])).toEqual([
      ['2026-10-05', 'falta', 'recontatada'],
      ['2026-10-10', 'falta', 'sem-recontato'],
      ['2026-10-23', 'desmarcacao', 'aguardando-prazo'],
    ])
    expect(r.body.resumo).toEqual({ faltas: 3, maduras: 2, recontatadasEmAteDoisDias: 1, aguardandoPrazo: 1 })
  })
})

describe('redação por relatório (regra 17)', () => {
  it('quem não tem `valores` não recebe nenhum campo monetário preenchido, em nenhum relatório que abre', async () => {
    await semAtendimento()
    const casos: [string, Record<string, unknown>, string][] = [
      ['pacientes-sem-atendimento', SEM_ATENDIMENTO, 'juliana'],
      ['pacientes-que-indicaram', { de: '2026-10-01', ate: '2026-10-31' }, 'juliana'],
      ['pacientes-por-origem-e-campanha', { de: '2026-10-01', ate: '2026-10-31' }, 'juliana'],
      ['aniversariantes', { mes: 10 }, 'juliana'],
      ['orcamentos', { de: '2026-10-01', ate: '2026-10-31' }, 'juliana'],
      ['faltas-e-desmarcacoes', { de: '2026-10-01', ate: '2026-10-31' }, 'juliana'],
      ['saldos-em-aberto', {}, 'sonia'],
    ]
    const monetarios = new Set<string>(CAMPOS_MONETARIOS)
    const vazou = (x: unknown, onde: string): string[] =>
      Array.isArray(x)
        ? x.flatMap((y, i) => vazou(y, `${onde}[${i}]`))
        : typeof x === 'object' && x !== null
          ? Object.entries(x).flatMap(([k, v]) =>
              monetarios.has(k) && v !== null && typeof v !== 'object' ? [`${onde}.${k}`] : vazou(v, `${onde}.${k}`),
            )
          : []
    for (const [chave, filtros, quem] of casos) {
      const r = await executar(chave, filtros, quem)
      expect(r.statusCode, `${chave}: ${r.text}`).toBe(200)
      expect(vazou(r.body, chave)).toEqual([])
      expect((r.body.colunas as { tipo: string }[]).some((x) => x.tipo === 'dinheiro'), chave).toBe(false)
    }
  })
})

/* ===================================== "Criar campanha com esta lista" */

describe('Criar campanha com esta lista (spec I-42)', () => {
  it('campanha-da-lista-tres-posts-uma-campanha: três pedidos concorrentes com a mesma chave (C21)', async () => {
    await semAtendimento()
    const chave = randomUUID()
    const corpo = { filtros: SEM_ATENDIMENTO, destino: { nova: nova() }, tarefa: tarefa() }
    const rs = await Promise.all([1, 2, 3].map(() => criarCampanha('pacientes-sem-atendimento', corpo, { idempotencia: chave })))
    for (const r of rs) expect(r.status, r.text).toBe(200)
    expect(new Set(rs.map((r) => r.body.campanhaId)).size).toBe(1)
    expect(await campanhasDaClinica()).toBe(1)
    expect(await tarefasDaClinica()).toBe(2)
    expect(rs.map((r) => r.body.criadas as number).reduce((s, n) => s + n, 0)).toBe(2)
  })

  it('H.2: rodar duas vezes dá `criadas = 0`, e a origem da paciente não muda', async () => {
    await semAtendimento()
    const origem = await c.migrate.query<{ id: string }>(
      `INSERT INTO campanhas (clinica_id, nome, inicio, fim, metrica, meta) VALUES ($1, 'Origem', '2026-01-01', '2026-01-31', 'convertidos', 1) RETURNING id`,
      [c.clinica],
    )
    await c.migrate.query('UPDATE pacientes SET campanha_id = $2 WHERE id = $1', [c.pacientes['ana'], origem.rows[0]!.id])
    const destino = await c.migrate.query<{ id: string }>(
      `INSERT INTO campanhas (clinica_id, nome, inicio, fim, metrica, meta) VALUES ($1, 'Destino', '2026-10-01', '2026-11-30', 'convertidos', 1) RETURNING id`,
      [c.clinica],
    )
    const corpo = { filtros: SEM_ATENDIMENTO, destino: { campanhaId: destino.rows[0]!.id }, tarefa: tarefa() }
    const a = await criarCampanha('pacientes-sem-atendimento', corpo)
    expect(a.status, a.text).toBe(200)
    expect(a.body).toEqual({ campanhaId: destino.rows[0]!.id, pacientes: 2, criadas: 2, ignoradas: 0 })
    const b = await criarCampanha('pacientes-sem-atendimento', corpo)
    expect(b.body).toEqual({ campanhaId: destino.rows[0]!.id, pacientes: 2, criadas: 0, ignoradas: 2 })
    const p = await c.migrate.query<{ id: string; campanha_id: string | null }>(
      'SELECT id, campanha_id FROM pacientes WHERE id = ANY($1::uuid[]) ORDER BY nome',
      [[c.pacientes['ana'], c.pacientes['bruna']]],
    )
    expect(p.rows.map((x) => x.campanha_id)).toEqual([origem.rows[0]!.id, null])
    // A descrição padrão, e nenhuma cópia dos filtros.
    const t = await c.migrate.query<{ descricao: string; obs: string }>('SELECT descricao, obs FROM tarefas WHERE clinica_id = $1', [c.clinica])
    for (const x of t.rows) expect(x).toEqual({ descricao: 'Contato da campanha: Destino', obs: '' })
  })

  it('campanha-da-lista-2001-422: acima de 2.000, nada nasce (C22)', async () => {
    await c.migrate.query(
      `INSERT INTO pacientes (clinica_id, nome, ultima_consulta)
       SELECT $1, 'Lote ' || lpad(g::text, 4, '0'), '2026-01-10' FROM generate_series(1, 2001) g`,
      [c.clinica],
    )
    const r = await criarCampanha('pacientes-sem-atendimento', { filtros: SEM_ATENDIMENTO, destino: { nova: nova() }, tarefa: tarefa() })
    expect(r.status, r.text).toBe(422)
    expect(await campanhasDaClinica()).toBe(0)
    expect(await tarefasDaClinica()).toBe(0)
    const registro = await contar(
      `SELECT count(*)::text AS n FROM auditoria WHERE clinica_id = $1 AND entidade = 'relatorio' AND para ? 'campanhaId'`,
    )
    expect(registro).toBe(0)
  })

  it('campanha-da-lista-permissoes-403 e campanha-da-lista-recusa-paciente-ids (C20)', async () => {
    await semAtendimento()
    const corpo = { filtros: SEM_ATENDIMENTO, destino: { nova: nova() }, tarefa: tarefa() }
    // Sem `campanhas.gerir`.
    expect((await criarCampanha('pacientes-sem-atendimento', corpo, { quem: 'juliana' })).status).toBe(403)
    // Com `campanhas.gerir` mas sem a permissão do relatório: o 3 exige `valores`.
    await c.migrate.query(`UPDATE perfis SET perms = perms || ARRAY['campanhas.gerir'] WHERE clinica_id = $1 AND chave = 'pf_rec'`, [c.clinica])
    try {
      expect((await criarCampanha('pacientes-maior-ltv', { ...corpo, filtros: {} }, { quem: 'juliana' })).status).toBe(403)
    } finally {
      await c.migrate.query(`UPDATE perfis SET perms = array_remove(perms, 'campanhas.gerir') WHERE clinica_id = $1 AND chave = 'pf_rec'`, [
        c.clinica,
      ])
    }
    // Sem `indicadores` (rita): a rota recusa antes do serviço.
    expect((await criarCampanha('pacientes-sem-atendimento', corpo, { quem: 'rita' })).status).toBe(403)
    // A lista vem do servidor, nunca do cliente.
    const comIds = { ...corpo, pacienteIds: [c.pacientes['ana']] }
    expect((await criarCampanha('pacientes-sem-atendimento', comIds)).status).toBe(422)
    // Sem Idempotency-Key, 422; relatório sem lista de pacientes, 422; desconhecido, 404.
    expect((await criarCampanha('pacientes-sem-atendimento', corpo, { idempotencia: null })).status).toBe(422)
    expect((await criarCampanha('contas', { ...corpo, filtros: { de: '2026-10-01', ate: '2026-10-31' } })).status).toBe(422)
    expect((await criarCampanha('nao-existe', corpo)).status).toBe(404)
    expect(await campanhasDaClinica()).toBe(0)
    expect(await tarefasDaClinica()).toBe(0)
  })

  it('campanha-da-lista-destino-e-tarefa-conferidos (C23)', async () => {
    await semAtendimento()
    const base = { filtros: SEM_ATENDIMENTO, destino: { nova: nova() } }
    // Responsável inativo (marta) e de outra clínica.
    expect((await criarCampanha('pacientes-sem-atendimento', { ...base, tarefa: { ...tarefa(), responsavelId: c.pessoas['marta'] } })).status).toBe(422)
    const daOutra = await c.migrate.query<{ id: string }>('SELECT id FROM pessoas WHERE clinica_id = $1 LIMIT 1', [c.outraClinica])
    expect((await criarCampanha('pacientes-sem-atendimento', { ...base, tarefa: { ...tarefa(), responsavelId: daOutra.rows[0]!.id } })).status).toBe(422)
    // Pagamento não é tarefa.
    expect((await criarCampanha('pacientes-sem-atendimento', { ...base, tarefa: { ...tarefa(), tipo: 'Pagamento de consulta' } })).status).toBe(422)
    // Campanha que não existe nesta clínica.
    const r = await criarCampanha('pacientes-sem-atendimento', { filtros: SEM_ATENDIMENTO, destino: { campanhaId: randomUUID() }, tarefa: tarefa() })
    expect(r.status).toBe(422)
    // Tudo ou nada: a campanha nova do primeiro pedido também não ficou.
    expect(await campanhasDaClinica()).toBe(0)
    expect(await tarefasDaClinica()).toBe(0)
  })

  it('campanha-da-lista-sem-pediu-para-sair: desativada e anonimizada ficam fora (L-IN-14)', async () => {
    await semAtendimento()
    const saiu = await paciente('Iris Saiu', { ultima_consulta: '2026-01-10' })
    await c.migrate.query(`UPDATE pacientes SET ativo = false, desativado_em = now(), motivo_desativacao = 'pediu-para-sair' WHERE id = $1`, [saiu])
    const r = await criarCampanha('pacientes-sem-atendimento', { filtros: SEM_ATENDIMENTO, destino: { nova: nova() }, tarefa: tarefa() })
    expect(r.status, r.text).toBe(200)
    expect(r.body).toMatchObject({ pacientes: 2, criadas: 2 })
    expect(await contar('SELECT count(*)::text AS n FROM tarefas WHERE clinica_id = $1 AND paciente_id = $2', [c.clinica, saiu])).toBe(0)
  })

  it('campanha-saude-sem-procedimento: na classe saúde, o procedimento não vai para a campanha nem para a tarefa (L-IN-13)', async () => {
    const t = await c.migrate.query<{ id: string }>(
      `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tipo, paciente_id, procedimento_id, status, concluida_em)
       VALUES ($1, $2, $2, 'Procedimento', '2026-03-10', 'Procedimento agendado', $3, $4, 'concluida', '2026-03-10T15:00:00Z') RETURNING id`,
      [c.clinica, c.pessoas['beatriz'], c.pacientes['ana'], procedimento.id],
    )
    await receber(c.pacientes['ana']!, '2026-03-10T15:00:00Z', 50000, { tarefaId: t.rows[0]!.id })
    const r = await criarCampanha('pacientes-sem-compra', {
      filtros: { semCompraHaMeses: 3, procedimentoId: procedimento.id },
      destino: { nova: nova('Retorno') },
      tarefa: tarefa(),
    })
    expect(r.status, r.text).toBe(200)
    expect(r.body).toMatchObject({ pacientes: 1, criadas: 1 })
    const camp = await c.migrate.query('SELECT * FROM campanhas WHERE id = $1', [r.body.campanhaId])
    expect(JSON.stringify(camp.rows)).not.toContain(procedimento.nome)
    const tar = await c.migrate.query(
      'SELECT descricao, obs, procedimento_id FROM tarefas WHERE clinica_id = $1 AND campanha_id = $2',
      [c.clinica, r.body.campanhaId],
    )
    expect(tar.rows).toEqual([{ descricao: 'Contato da campanha: Retorno', obs: '', procedimento_id: null }])
    // A origem fica só no registro de acesso, por id (L-IN-14).
    const reg = await c.migrate.query<{ para: Record<string, unknown> }>(
      `SELECT para FROM auditoria WHERE clinica_id = $1 AND entidade = 'relatorio' AND para ? 'campanhaId'`,
      [c.clinica],
    )
    expect(reg.rows).toEqual([
      { para: expect.objectContaining({ relatorio: 'pacientes-sem-compra', classe: 'saude', campanhaId: r.body.campanhaId, criadas: 1 }) },
    ])
    expect(JSON.stringify(reg.rows)).not.toContain(procedimento.nome)
    expect(JSON.stringify(reg.rows)).not.toContain('Ana')
  })

  it('log-sem-conteudo-relatorios (C29): criar campanha e rodar o relatório não escrevem nome nem telefone', async () => {
    await semAtendimento()
    const pedacos: string[] = []
    const out = process.stdout.write.bind(process.stdout)
    const err = process.stderr.write.bind(process.stderr)
    process.stdout.write = ((s: string | Uint8Array, ...r: unknown[]) => {
      pedacos.push(String(s))
      return out(s, ...(r as []))
    }) as typeof process.stdout.write
    process.stderr.write = ((s: string | Uint8Array, ...r: unknown[]) => {
      pedacos.push(String(s))
      return err(s, ...(r as []))
    }) as typeof process.stderr.write
    try {
      await executar('pacientes-sem-atendimento', SEM_ATENDIMENTO)
      await criarCampanha('pacientes-sem-atendimento', { filtros: SEM_ATENDIMENTO, destino: { nova: nova() }, tarefa: tarefa() })
      // E o caminho de erro (422) também.
      await criarCampanha('pacientes-sem-atendimento', { filtros: SEM_ATENDIMENTO, destino: { nova: nova() }, tarefa: tarefa(), pacienteIds: [] })
    } finally {
      process.stdout.write = out
      process.stderr.write = err
    }
    const saida = pedacos.join('\n')
    for (const proibido of ['Ana Lúcia', 'Bruna', '98888', 'Volta pra gente']) expect(saida).not.toContain(proibido)
  })
})
