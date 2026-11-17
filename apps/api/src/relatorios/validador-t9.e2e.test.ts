import { valorDaTaxa } from '@fir/domain'
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
 * Contraexemplos do `validador-numeros` sobre o T9 (2026-11-17). Números
 * redondos, a conta à mão no comentário de cada `it`.
 * HOJE = sábado 24/10/2026 (America/Bahia, UTC−3); o caixa de hoje está aberto.
 */
let c: Cenario
let procs: { id: string; nome: string }[]

const executar = (chave: string, filtros: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/relatorios/${chave}/execucoes`, { filtros }, quem)

async function paciente(nome: string, extra: Record<string, unknown> = {}): Promise<string> {
  const colunas = ['clinica_id', 'nome', ...Object.keys(extra)]
  const valores = [c.clinica, nome, ...Object.values(extra)]
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO pacientes (${colunas.join(', ')}) VALUES (${colunas.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    valores,
  )
  return r.rows[0]!.id
}

type Rec = { tipo?: string; valorAberto?: number; programaId?: string; tarefaId?: string; forma?: string; estornadoEm?: string }
async function receber(pac: string, em: string, valor: number, x: Rec = {}): Promise<string> {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, programa_id, tipo, valor, valor_aberto, forma, recebido_em, registrado_por, estornado_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10, $11::timestamptz) RETURNING id`,
    [
      c.clinica,
      pac,
      x.tarefaId ?? null,
      x.programaId ?? null,
      x.tipo ?? 'Consulta realizada',
      valor,
      x.valorAberto ?? 0,
      x.forma ?? (valor > 0 ? 'Pix' : ''),
      em,
      c.pessoas['beatriz'],
      x.estornadoEm ?? null,
    ],
  )
  return r.rows[0]!.id
}
const fecharCaixa = (dia: string) =>
  c.migrate.query(`INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1, $2::date, '', $3) ON CONFLICT DO NOTHING`, [
    c.clinica,
    dia,
    c.pessoas['beatriz'],
  ])
async function tarefaConcluida(pac: string, tipo: string, em: string): Promise<string> {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tipo, paciente_id, status, concluida_em)
     VALUES ($1, $2, $2, 'fixture', ($4::timestamptz AT TIME ZONE 'America/Bahia')::date, $3, $5, 'concluida', $4::timestamptz) RETURNING id`,
    [c.clinica, c.pessoas['beatriz'], tipo, em, pac],
  )
  return r.rows[0]!.id
}
async function programa(pac: string, proc = 0): Promise<string> {
  const m = await postar(
    c,
    '/v1/programas',
    { pacienteId: pac, inicio: HOJE, itens: [{ chave: 'i1', procedimentoId: procs[proc]!.id, sessoes: 2, intervaloDias: 7 }] },
    'beatriz',
  )
  expect(m.statusCode, m.text).toBe(201)
  return (m.body.id ?? m.body.programa?.id) as string
}

async function limparTudo(): Promise<void> {
  await apagarPacientesDaExportacaoDeTeste(c.migrate, c.clinica)
  await c.migrate.query('DELETE FROM tentativas_de_relatorio WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('DELETE FROM kpis WHERE clinica_id = $1', [c.clinica]).catch(() => undefined)
  await limparFinanceiro(c)
  await limparProgramas(c)
  await limparTarefas(c)
  await c.migrate.query('UPDATE pacientes SET campanha_id = NULL, indicado_por_id = NULL WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query(
    `UPDATE pacientes SET ativo = false, desativado_em = now(), motivo_desativacao = 'erro-de-cadastro'
      WHERE clinica_id = $1 AND ativo AND id <> ALL($2::uuid[])`,
    [c.clinica, [c.pacientes['ana'], c.pacientes['bruna']]],
  )
}

beforeAll(async () => {
  c = await montarCenario('validador-t9')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir','painel','finmes','cobrancas','campanhas']
      WHERE clinica_id = $1 AND chave IN ('pf_sup')`,
    [c.clinica],
  )
  procs = (
    await c.migrate.query<{ id: string; nome: string }>('SELECT id, nome FROM procedimentos WHERE clinica_id = $1 ORDER BY nome LIMIT 2', [
      c.clinica,
    ])
  ).rows
}, 120_000)
afterAll(async () => {
  await limparTudo()
  await desmontarCenario(c)
})
beforeEach(limparTudo)

/* ================================================================ relatório 9 */

describe('validador — relatório 9', () => {
  /**
   * Ana  · geral: aberto 100,00 (01/10); abate 40,00 às 23:30 de 10/10 e 30,00 às 00:03 de 11/10.
   *        programa em modo saldo: aberto 300,00 (02/10); sessão paga 50,00 (20/10) abate O PROGRAMA.
   * Bruna· geral: aberto 20,00 (06/10), abate 70,00 (07/10) → crédito 50,00 que NÃO compensa
   *        o programa dela: aberto 80,00 (08/10).
   * Carla· geral: aberto 50,00 (05/10), estornado em 15/10.
   *
   * Hoje:  Ana 30,00 + 250,00; Bruna 0 + 80,00; Carla 0  → Σ 360,00, 3 grupos.
   * 10/10 (instante 11/10 03:00Z): Ana 60,00 + 300,00; Bruna 0 + 80,00; Carla 50,00 → Σ 490,00, 4 grupos.
   */
  async function montar() {
    const progAna = await programa(c.pacientes['ana']!, 0)
    const progBruna = await programa(c.pacientes['bruna']!, 1)
    await c.migrate.query(`UPDATE programas SET modo_de_cobranca = 'saldo' WHERE id = $1`, [progAna])
    const carla = await paciente('Carla Estorno')
    const ana = c.pacientes['ana']!
    const bruna = c.pacientes['bruna']!
    await receber(ana, '2026-10-01T12:00:00Z', 0, { valorAberto: 10000 })
    await receber(ana, '2026-10-11T02:30:00Z', 4000, { tipo: 'Pagamento de saldo em aberto' })
    await receber(ana, '2026-10-11T03:03:00Z', 3000, { tipo: 'Pagamento de saldo em aberto' })
    await receber(ana, '2026-10-02T12:00:00Z', 0, { valorAberto: 30000, programaId: progAna })
    await receber(ana, '2026-10-20T12:00:00Z', 5000, { tipo: 'Sessão de plano', programaId: progAna })
    await receber(bruna, '2026-10-06T12:00:00Z', 0, { valorAberto: 2000 })
    await receber(bruna, '2026-10-07T12:00:00Z', 7000, { tipo: 'Pagamento de saldo em aberto' })
    await receber(bruna, '2026-10-08T12:00:00Z', 0, { valorAberto: 8000, programaId: progBruna })
    await receber(carla, '2026-10-05T12:00:00Z', 0, { valorAberto: 5000, estornadoEm: '2026-10-15T12:00:00Z' })
    return { progAna, progBruna, carla }
  }

  it('v9-hoje-credito-nao-compensa-e-sessao-abate-o-programa: Σ 360,00 = Cobranças = Visão do mês', async () => {
    const { progAna, progBruna } = await montar()
    const r = await executar('saldos-em-aberto', {})
    expect(r.statusCode, r.text).toBe(200)
    const linhas = r.body.linhas as { pacienteId: string; programaId: string | null; valorAberto: string }[]
    expect(linhas.map((l) => [l.pacienteId, l.programaId, l.valorAberto])).toEqual([
      [c.pacientes['ana'], null, '3000'],
      [c.pacientes['ana'], progAna, '25000'],
      [c.pacientes['bruna'], progBruna, '8000'],
    ])
    expect(r.body.resumo).toEqual({ pacientes: 2, grupos: 3, aReceber: '36000' })
    const cob = await pegar(c, '/v1/cobrancas', {}, 'beatriz')
    expect(cob.body.aReceber).toBe('36000')
    const v = await pegar(c, '/v1/visao-do-mes', { mes: '2026-10' }, 'beatriz')
    expect(v.statusCode, v.text).toBe(200)
    expect(v.body.aReceber).toBe('36000')
  })

  it('v9-corte-passado-borda-do-dia: 23:30 de 10/10 abate, 00:03 de 11/10 não; a sessão de 20/10 não abate', async () => {
    const { progAna, progBruna } = await montar()
    const r = await executar('saldos-em-aberto', { ate: '2026-10-10' })
    expect(r.statusCode, r.text).toBe(200)
    const linhas = r.body.linhas as { pacienteId: string; programaId: string | null; valorAberto: string }[]
    const daAna = linhas.filter((l) => l.pacienteId === c.pacientes['ana'])
    expect(daAna.map((l) => [l.programaId, l.valorAberto])).toEqual([
      [null, '6000'],
      [progAna, '30000'],
    ])
    expect(linhas.find((l) => l.pacienteId === c.pacientes['bruna'])).toMatchObject({ programaId: progBruna, valorAberto: '8000' })
  })

  it('v9-corte-passado-divida-estornada-depois-do-corte: a posição de 10/10 inclui os 50,00 da Carla (Σ 490,00)', async () => {
    const { carla } = await montar()
    const r = await executar('saldos-em-aberto', { ate: '2026-10-10' })
    expect(r.statusCode, r.text).toBe(200)
    const linhas = r.body.linhas as { pacienteId: string; valorAberto: string }[]
    // Em 10/10 a Carla devia 50,00: o estorno é de 15/10. `saldosDe(…, { ate })`
    // conta esse recebimento; o pré-filtro `pacientesQuePodemTerSaldo` (estado
    // de AGORA) a tira antes.
    console.info('V9-ESTORNO', JSON.stringify(r.body.resumo))
    expect(linhas.find((l) => l.pacienteId === carla)?.valorAberto).toBe('5000')
    expect(r.body.resumo).toEqual({ pacientes: 3, grupos: 4, aReceber: '49000' })
  })
})

/* =============================================================== relatório 13 */

describe('validador — relatório 13', () => {
  /** Orçamento de R$ 10.000 registrado e fechado HOJE, com entrada de R$ 4.000 no Pix e R$ 6.000 em aberto. */
  async function fecharHoje(): Promise<string> {
    const t = await postar(
      c,
      '/v1/tarefas',
      { vinculo: 'paciente', pacienteId: c.pacientes['ana'], tipo: 'Consulta agendada', responsavelId: c.pessoas['beatriz'], quando: { modo: 'retroativo', em: HOJE } },
      'beatriz',
    )
    expect(t.statusCode, t.text).toBe(201)
    const id = t.body.tarefa.id as string
    const o = await postar(
      c,
      `/v1/tarefas/${id}/jornada`,
      { acao: 'registrarOrcamento', valor: '1000000', programa: [{ chave: 'p1', procedimentoId: procs[0]!.id, sessoes: 4, intervaloDias: 7 }] },
      'beatriz',
    )
    expect(o.statusCode, o.text).toBe(200)
    const f = await postar(
      c,
      `/v1/tarefas/${id}/jornada`,
      { acao: 'fechar', fechamento: 'tudo', recebimento: { valor: '400000', forma: 'Pix', valorAberto: '600000' } },
      'beatriz',
    )
    expect(f.statusCode, f.text).toBe(200)
    return id
  }

  it('v13-dia-aberto-nao-atravessa-na-linha: fechado hoje com o caixa aberto, nenhum campo traz os 4.000,00', async () => {
    await fecharHoje()
    const r = await executar('orcamentos', { de: HOJE, ate: HOJE })
    expect(r.statusCode, r.text).toBe(200)
    // O resumo corta o dia aberto (dias que contam) …
    expect(r.body.resumo.valorFechado).toBe('0')
    // … e a linha não pode trazer o dinheiro do dia sem caixa (regra 6, c.10, a mesma porta do N-22).
    expect(r.body.linhas[0].valorFechado).toBeNull()
    expect(r.text).not.toContain('400000')
  })

  it('v13-c3-mes-passado-fechado: depois do caixa, resumo = KPI; registra Σ linhas × resumo × Painel', async () => {
    const id = await fecharHoje()
    // Move o cartão inteiro 4 dias para trás (20/10) e fecha o caixa daquele dia.
    await c.migrate.query(
      `UPDATE tarefas SET historico = (SELECT jsonb_agg(CASE WHEN e ? 'em'
                 THEN jsonb_set(e, '{em}', to_jsonb(to_char(((e->>'em')::timestamptz - interval '4 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
                 ELSE e END ORDER BY o) FROM jsonb_array_elements(historico) WITH ORDINALITY AS h(e, o))
        WHERE id = $1`,
      [id],
    )
    await c.migrate.query(
      `UPDATE tarefas SET concluida_em = concluida_em - interval '4 days', criada_em = criada_em - interval '4 days'
        WHERE clinica_id = $1 AND paciente_id = $2 AND concluida_em IS NOT NULL`,
      [c.clinica, c.pacientes['ana']],
    )
    await c.migrate.query(`UPDATE recebimentos SET recebido_em = recebido_em - interval '4 days' WHERE clinica_id = $1`, [c.clinica])
    await fecharCaixa('2026-10-20')
    const filtros = { de: '2026-10-01', ate: '2026-10-23' }
    const r = await executar('orcamentos', filtros)
    expect(r.statusCode, r.text).toBe(200)
    const painel = await pegar(c, '/v1/painel', { periodo: 'per', ...filtros }, 'beatriz')
    const somaLinhas = (r.body.linhas as { valorFechado: string | null }[]).reduce((s, l) => s + BigInt(l.valorFechado ?? '0'), 0n)
    const recs = await c.migrate.query<{ tipo: string; valor: string; t: string | null }>(
      `SELECT r.tipo, r.valor::text AS valor, t.tipo AS t FROM recebimentos r LEFT JOIN tarefas t ON t.id = r.tarefa_id WHERE r.clinica_id = $1`,
      [c.clinica],
    )
    console.info('V13-C3', JSON.stringify({ resumo: r.body.resumo, somaLinhas: somaLinhas.toString(), painel: painel.body.pacientes.valorDosOrcamentosPagos, recs: recs.rows }))
    expect(r.body.resumo.valorFechado).toBe(painel.body.pacientes.valorDosOrcamentosPagos)
    // D3, decidido pelo protótipo (`orc_valor`, linha 3503): a coluna segue a MESMA
    // definição do resumo — Σ linhas = resumo = Painel. A entrada gravada no próprio
    // cartão não é "Pagamento de orçamento"; o orçado segue em `valorOrcamento`.
    expect(somaLinhas.toString()).toBe(r.body.resumo.valorFechado)
    expect(r.body.linhas[0].valorOrcamento).toBe('1000000')
  })
})

/* ================================================================ relatório 4 */

describe('validador — relatório 4', () => {
  /**
   * Ana indicou, em outubro: Carla (12 pagamentos de 10,00 em 07/10, caixa fechado),
   * Dora (20,00 em 08/10, caixa fechado; desativada depois) e Eva (só venda a prazo:
   * valor 0, aberto 300,00). Carla paga mais 99,99 HOJE, caixa aberto.
   * indicadas = 3 (N-19: não 14); receita = 120,00 + 20,00 = 140,00 (hoje fora, N-22).
   */
  it('v4-n19-n22: indicadas 3 = Painel, receita 140,00, o dia aberto fora', async () => {
    const ana = c.pacientes['ana']!
    const carla = await paciente('Carla Ind', { indicado_por_id: ana, criado_em: '2026-10-05T12:00:00Z' })
    const dora = await paciente('Dora Ind', { indicado_por_id: ana, criado_em: '2026-10-05T13:00:00Z' })
    const eva = await paciente('Eva Ind', { indicado_por_id: ana, criado_em: '2026-10-05T14:00:00Z' })
    for (let i = 0; i < 12; i++) {
      const t = await tarefaConcluida(carla, 'Pagamento de consulta', `2026-10-07T1${String(i % 10)}:0${Math.floor(i / 10)}:00Z`)
      await receber(carla, `2026-10-07T1${String(i % 10)}:0${Math.floor(i / 10)}:00Z`, 1000, { tarefaId: t, tipo: 'Pagamento de consulta' })
    }
    const td = await tarefaConcluida(dora, 'Pagamento de consulta', '2026-10-08T15:00:00Z')
    await receber(dora, '2026-10-08T15:00:00Z', 2000, { tarefaId: td, tipo: 'Pagamento de consulta' })
    const th = await tarefaConcluida(carla, 'Pagamento de consulta', '2026-10-24T15:00:00Z')
    await receber(carla, '2026-10-24T15:00:00Z', 9999, { tarefaId: th, tipo: 'Pagamento de consulta' })
    await receber(eva, '2026-10-09T15:00:00Z', 0, { valorAberto: 30000 })
    await fecharCaixa('2026-10-07')
    await fecharCaixa('2026-10-08')
    await c.migrate.query(`UPDATE pacientes SET ativo = false, desativado_em = now(), motivo_desativacao = 'erro-de-cadastro' WHERE id = $1`, [dora])

    const filtros = { de: '2026-10-01', ate: HOJE }
    const r = await executar('pacientes-que-indicaram', filtros)
    expect(r.statusCode, r.text).toBe(200)
    const painel = await pegar(c, '/v1/painel', { periodo: 'per', ...filtros }, 'beatriz')
    expect(painel.body.quemMaisIndica).toEqual([{ pacienteId: ana, nome: 'Ana Lúcia Souza', indicadas: 3 }])
    expect(r.body.linhas).toHaveLength(1)
    expect(r.body.linhas[0]).toMatchObject({ pacienteId: ana, indicadas: 3, receitaDasIndicadas: '14000' })
    expect(r.body.resumo).toEqual({ indicadoras: 1, indicadas: 3 })
    expect(r.text).not.toContain('9999')
    // "Viraram pacientes" = ≥ 1 recebimento (spec I-4, O1 decidido no ADR do T9):
    // Carla e Dora pagaram, e a venda a prazo da Eva também é recebimento.
    expect(r.body.linhas[0].viraramPacientes).toBe(3)
  })
})

/* ================================================================ relatório 3 */

describe('validador — relatório 3', () => {
  /**
   * Ana: 200,00 Pix + 50,00 nota promissória + venda a prazo (0 / 300,00) + 99,00 estornado.
   * LTV = 250,00, compras = 2, ticket = 125,00. A ficha diz o mesmo LTV.
   */
  it('v3-ltv-igual-a-ficha: 250,00, 2 compras, ticket 125,00', async () => {
    const ana = c.pacientes['ana']!
    await receber(ana, '2026-09-01T12:00:00Z', 20000)
    await receber(ana, '2026-09-02T12:00:00Z', 5000, { forma: 'Nota promissória' })
    await receber(ana, '2026-09-03T12:00:00Z', 0, { valorAberto: 30000 })
    await receber(ana, '2026-09-04T12:00:00Z', 9900, { estornadoEm: '2026-09-05T12:00:00Z' })
    const r = await executar('pacientes-maior-ltv', { quantos: 10 })
    expect(r.statusCode, r.text).toBe(200)
    const linha = (r.body.linhas as { pacienteId: string }[]).find((l) => l.pacienteId === ana)
    expect(linha).toMatchObject({ ltv: '25000', compras: 2, ticketMedio: '12500' })
    const ficha = await pegar(c, `/v1/pacientes/${ana}`, {}, 'beatriz')
    expect(ficha.statusCode).toBe(200)
    const ltvDaFicha = (ficha.body.ltv ?? ficha.body.paciente?.ltv) as string
    expect(ltvDaFicha).toBe('25000')
  })
})

/* =============================================================== relatório 14 */

describe('validador — relatório 14', () => {
  /**
   * 05/10 falta, recontato 06/10 (no prazo); 10/10 falta sem recontato; 12/10 falta da
   * paciente DESATIVADA sem recontato; 23/10 desmarcação (prazo correndo).
   * Maduras = 3, recontatadas em até 2 dias = 1 → KPI = valorDaTaxa(1, 3).
   */
  it('v14-resumo-igual-ao-kpi-com-desativada', async () => {
    const ev = (acao: string, etapa: string, em: string) => ({ acao, etapa, em, porId: c.pessoas['beatriz'] })
    const saiu = await paciente('Iris Saiu')
    const historicos: [string, unknown[]][] = [
      [c.pacientes['bruna']!, [ev('noshow', 'faltou', '2026-10-05T15:00:00Z'), ev('reagendar', 'agendado', '2026-10-06T15:00:00Z')]],
      [c.pacientes['bruna']!, [ev('noshow', 'faltou', '2026-10-10T15:00:00Z')]],
      [saiu, [ev('noshow', 'faltou', '2026-10-12T15:00:00Z')]],
      [c.pacientes['bruna']!, [ev('desmarcar', 'desmarcou', '2026-10-23T15:00:00Z')]],
    ]
    for (const [p, h] of historicos) {
      await c.migrate.query(
        `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tipo, paciente_id, historico)
         VALUES ($1, $2, $2, 'Consulta', '2026-10-05', 'Consulta agendada', $3, $4::jsonb)`,
        [c.clinica, c.pessoas['beatriz'], p, JSON.stringify(h)],
      )
    }
    await c.migrate.query(`UPDATE pacientes SET ativo = false, desativado_em = now(), motivo_desativacao = 'erro-de-cadastro' WHERE id = $1`, [saiu])
    await c.migrate.query(
      `INSERT INTO kpis (clinica_id, origem, chave_catalogo, parametros, nome, frequencia, criado_em)
       VALUES ($1, 'catalogo', 'faltas_recontatadas', '{}'::jsonb, 'faltas', 'mensal', '2026-09-01T12:00:00Z')`,
      [c.clinica],
    )
    const r = await executar('faltas-e-desmarcacoes', { de: '2026-10-01', ate: '2026-10-31' })
    expect(r.statusCode, r.text).toBe(200)
    expect(r.body.resumo).toEqual({ faltas: 4, maduras: 3, recontatadasEmAteDoisDias: 1, aguardandoPrazo: 1 })
    const linhaDaSaiu = (r.body.linhas as { data: string; nome: string | null; pacienteId: string | null }[]).find((l) => l.data === '2026-10-12')
    expect(linhaDaSaiu).toMatchObject({ nome: null, pacienteId: null })
    const k = await pegar(c, '/v1/indicadores', {}, 'beatriz')
    expect(k.statusCode, k.text).toBe(200)
    const item = (k.body.itens as { chave: string; atual: { emNumero: string | null } }[]).find((x) => x.chave === 'faltas_recontatadas')!
    // O KPI e o relatório, pela MESMA taxa: 1 ÷ 3 maduras.
    const doRelatorio = valorDaTaxa('percentual', BigInt(r.body.resumo.recontatadasEmAteDoisDias), BigInt(r.body.resumo.maduras))
    const esperado = valorDaTaxa('percentual', 1n, 3n)
    const txt = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    console.info('V14-KPI', txt({ kpi: item.atual, esperado }))
    expect(txt(doRelatorio)).toBe(txt(esperado))
    expect(item.atual.emNumero).toBe(esperado!.emMenorUnidade.toString())
  })
})

/* ================================================================ relatório 6 */

describe('validador — relatório 6', () => {
  /** Duas novas do Instagram: 100,00 e 50,00 (uma estornada de 30,00). Σ receita das linhas = LTV do Painel = 150,00. */
  it('v6-soma-da-receita-por-origem-igual-ao-ltv-do-painel', async () => {
    const f = await paciente('Fabi Nova', { origem: 'Instagram', criado_em: '2026-10-05T12:00:00Z' })
    const g = await paciente('Gil Nova', { origem: 'Instagram', criado_em: '2026-10-06T12:00:00Z' })
    await receber(f, '2026-10-07T12:00:00Z', 10000)
    await receber(g, '2026-10-08T12:00:00Z', 5000)
    await receber(g, '2026-10-08T13:00:00Z', 3000, { estornadoEm: '2026-10-09T12:00:00Z' })
    const filtros = { de: '2026-10-01', ate: '2026-10-31' }
    const r = await executar('pacientes-por-origem-e-campanha', filtros)
    expect(r.statusCode, r.text).toBe(200)
    const soma = (r.body.linhas as { origem: string; receita: string }[])
      .filter((l) => l.origem === 'Instagram')
      .reduce((s, l) => s + BigInt(l.receita), 0n)
    const painel = await pegar(c, '/v1/painel', { periodo: 'per', ...filtros }, 'beatriz')
    const ig = (painel.body.novosPacientes.porOrigem as { origem: string; ltvTotal: string }[]).find((x) => x.origem === 'Instagram')!
    expect(soma).toBe(15000n)
    expect(String(soma)).toBe(ig.ltvTotal)
  })
})

describe('validador — relatório 6, dia aberto', () => {
  /** Paciente nova cadastrada hoje paga 77,77 hoje, caixa aberto: a coluna "receita" não pode trazer o dia (c.10). */
  it('v6-dia-aberto-nao-atravessa-na-receita', async () => {
    const n = await paciente('Nina Hoje', { origem: 'Instagram', criado_em: '2026-10-24T13:00:00Z' })
    await receber(n, '2026-10-24T14:00:00Z', 7777)
    const r = await executar('pacientes-por-origem-e-campanha', { de: HOJE, ate: HOJE })
    expect(r.statusCode, r.text).toBe(200)
    console.info('V6-HOJE', JSON.stringify(r.body.linhas))
    expect(r.text).not.toContain('7777')
  })
})

describe('validador — relatório 13, revalidação (Σ linhas = resumo, só dias que contam)', () => {
  /**
   * Cartão orçado em 25/09 (fora do período) e fechado em 20/10 15:00Z, com a companheira
   * "Pagamento de orçamento" de 1.000,00 concluída no mesmo instante (caixa 20/10 fechado).
   * Pagamento de orçamento avulso de 500,00 em 21/10 (caixa fechado). 777,77 hoje, caixa aberto.
   * Resumo = Σ linhas = 1.500,00; os 777,77 não atravessam. Painel de 01 a 24/10 = 2.277,77 (D-I3).
   */
  it('v13-revalida-pagamentos-de-orcamento-por-cartao-e-avulso', async () => {
    const ana = c.pacientes['ana']!
    const ev = (acao: string, etapa: string, em: string, extra: Record<string, unknown> = {}) => ({ acao, etapa, em, porId: c.pessoas['beatriz'], ...extra })
    const cartao = (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tipo, paciente_id, status, concluida_em, etapa, historico, valor_orcamento)
         VALUES ($1, $2, $2, 'Consulta', '2026-09-25', 'Consulta realizada', $3, 'concluida', '2026-10-20T15:00:00Z', 'fechado', $4::jsonb, 1000000) RETURNING id`,
        [c.clinica, c.pessoas['beatriz'], ana, JSON.stringify([
          ev('registrarOrcamento', 'orcamento', '2026-09-25T15:00:00Z', { valor: '1000000' }),
          ev('fechar', 'fechado', '2026-10-20T15:00:00Z', { valor: '1000000' }),
        ])],
      )
    ).rows[0]!.id
    const comp = await tarefaConcluida(ana, 'Pagamento de orçamento', '2026-10-20T15:00:00Z')
    await receber(ana, '2026-10-20T15:00:00Z', 100000, { tarefaId: comp, tipo: 'Pagamento de orçamento' })
    const avulso = await tarefaConcluida(c.pacientes['bruna']!, 'Pagamento de orçamento', '2026-10-21T15:00:00Z')
    await receber(c.pacientes['bruna']!, '2026-10-21T15:00:00Z', 50000, { tarefaId: avulso, tipo: 'Pagamento de orçamento' })
    const hoje = await tarefaConcluida(c.pacientes['bruna']!, 'Pagamento de orçamento', '2026-10-24T15:00:00Z')
    await receber(c.pacientes['bruna']!, '2026-10-24T15:00:00Z', 77777, { tarefaId: hoje, tipo: 'Pagamento de orçamento' })
    await fecharCaixa('2026-10-20')
    await fecharCaixa('2026-10-21')

    const filtros = { de: '2026-10-01', ate: HOJE }
    const r = await executar('orcamentos', filtros)
    expect(r.statusCode, r.text).toBe(200)
    const linhas = r.body.linhas as { tarefaId: string | null; valorFechado: string | null; valorOrcamento: string | null }[]
    console.info('V13-REVALIDA', JSON.stringify({ resumo: r.body.resumo, linhas }))
    const soma = linhas.reduce((s, l) => s + BigInt(l.valorFechado ?? '0'), 0n)
    expect(r.body.resumo.valorFechado).toBe('150000')
    expect(soma).toBe(150000n)
    expect(linhas.find((l) => l.tarefaId === cartao)).toMatchObject({ valorFechado: '100000', valorOrcamento: '1000000' })
    expect(r.text).not.toContain('77777')
    const painel = await pegar(c, '/v1/painel', { periodo: 'per', ...filtros }, 'beatriz')
    // D-I3 pago: o Painel corta pelos mesmos dias que contam — o dia aberto fora dos dois.
    expect(painel.body.pacientes.valorDosOrcamentosPagos).toBe(r.body.resumo.valorFechado)
  })
})
