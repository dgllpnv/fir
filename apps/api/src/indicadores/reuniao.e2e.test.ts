import { ContadorDeIndicadores, IndicadoresDaSemana, ReuniaoDeIndicadores } from '@fir/contracts'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AMANHA,
  botar,
  HOJE,
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
 * Indicadores & Insights — T6 (plano de ação) e T7 (Hoje, contador, Modo
 * reunião e o link da Visão do mês), contra Postgres REAL e a API inteira.
 *
 * HOJE = sábado 24/10/2026 (America/Bahia); a semana corrente é 19–25/10.
 * `beatriz` tem `valores` e NÃO tem `pessoas.gerir`; `juliana` não tem
 * `valores`; `camila` tem `valores` e `pessoas.gerir`; `rita` não tem
 * `indicadores`.
 */
let c: Cenario

const TRES_ROTAS = ['/v1/indicadores/da-semana', '/v1/indicadores/contador', '/v1/indicadores/reuniao'] as const

const kpiNoBanco = async (chave: string, clinica = c.clinica): Promise<string> =>
  (
    await c.migrate.query<{ id: string }>(
      `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia) VALUES ($1, 'catalogo', $2, $2, 'mensal') RETURNING id`,
      [clinica, chave],
    )
  ).rows[0]!.id

const metaDeOutubro = (kpiId: string, alvo: string, quem = 'beatriz') =>
  postar(c, '/v1/indicadores/metas', { kpiId, tipo: 'mes', inicio: '2026-10-01', prazo: '2026-10-31', alvo }, quem)

/** Uma ficha ativa sem conversa no mês: `conversas_1a1_em_dia` = 0% — abaixo de qualquer meta. */
const rhAbaixo = async (): Promise<string> => {
  await c.migrate.query(
    `INSERT INTO fichas_de_pessoa (clinica_id, nome, cargo, contrato, ativo) VALUES ($1, 'Ficha T7', 'Recepção', 'CLT', true)`,
    [c.clinica],
  )
  const id = await kpiNoBanco('conversas_1a1_em_dia')
  const m = await metaDeOutubro(id, '10000', 'camila')
  expect(m.statusCode, JSON.stringify(m.body)).toBe(201)
  return id
}

/** Faturamento conferido com meta de R$ 10.000 e R$ 1.234,57 recebidos em 07/10: abaixo. */
const faturamentoAbaixo = async (): Promise<string> => {
  await c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, valor_aberto, forma, recebido_em, registrado_por)
     VALUES ($1, $2, 'Pagamento de consulta', 123457, 0, 'Pix', '2026-10-07T12:00:00Z', $3)`,
    [c.clinica, c.pacientes['ana'], c.pessoas['beatriz']],
  )
  const r = await postar(c, '/v1/indicadores/kpis', { origem: 'catalogo', chave: 'faturamento_conferido' }, 'beatriz')
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  const m = await metaDeOutubro(r.body.id as string, '1000000')
  expect(m.statusCode, JSON.stringify(m.body)).toBe(201)
  return r.body.id as string
}

const plano = (kpiId: string | undefined, quem = 'beatriz', extra: Record<string, unknown> = {}) =>
  postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'interna',
      responsavelId: c.pessoas[quem],
      descricao: 'Ligar para quem faltou',
      quando: { modo: 'agendada', prazo: AMANHA },
      ...(kpiId === undefined ? {} : { kpiId }),
      ...extra,
    },
    quem,
  )

/** Todas as chaves e todas as strings da resposta, em qualquer profundidade. */
function varrer(x: unknown, chaves: string[] = [], strings: string[] = []): { chaves: string[]; strings: string[] } {
  if (typeof x === 'string') strings.push(x)
  else if (Array.isArray(x)) for (const y of x) varrer(y, chaves, strings)
  else if (x !== null && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      chaves.push(k)
      // O campo monetário TIPADO (centavos em texto) é a forma certa; o que se proíbe é o texto.
      if (k !== 'emDinheiro') varrer(v, chaves, strings)
    }
  }
  return { chaves, strings }
}

beforeAll(async () => {
  c = await montarCenario('indicadores-t6-t7')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir']
      WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec')`,
    [c.clinica],
  )
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir','pessoas','pessoas.gerir']
      WHERE clinica_id = $1 AND chave = 'pf_ter'`,
    [c.clinica],
  )
})
afterAll(async () => {
  await limparIndicadores(c)
  await limparFinanceiro(c)
  await limparTarefas(c)
  await c.migrate.query('DELETE FROM fichas_de_pessoa WHERE clinica_id = $1', [c.clinica])
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparIndicadores(c)
  await limparTarefas(c)
  await limparFinanceiro(c)
  await c.migrate.query('DELETE FROM fichas_de_pessoa WHERE clinica_id = $1', [c.clinica])
})

describe('T6 — plano de ação: tarefa com `kpiId` (I-46; appsec C6, C27)', () => {
  it('cria a tarefa ligada ao KPI, e `TarefaNaLista.kpi` leva só { id, nome }', async () => {
    const kpi = await kpiNoBanco('novos_pacientes')
    const r = await plano(kpi)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    expect(r.body.tarefa.kpi).toEqual({ id: kpi, nome: 'novos_pacientes' })
    expect(r.body.tarefa.lancamentoDeKpi).toBeNull()
    const g = await c.migrate.query<{ kpi_id: string; marcador: string | null }>('SELECT kpi_id, marcador FROM tarefas WHERE id = $1', [
      r.body.tarefa.id,
    ])
    expect(g.rows).toEqual([{ kpi_id: kpi, marcador: null }])
  })

  it('plano-de-acao-kpi-rh-exige-pessoas-gerir: sem `pessoas.gerir` o KPI de RH não existe (422, nada gravado); com ela, 201', async () => {
    const rh = await kpiNoBanco('saldo_banco_de_horas')
    const sem = await plano(rh, 'beatriz')
    expect(sem.statusCode, JSON.stringify(sem.body)).toBe(422)
    expect((await c.migrate.query('SELECT 1 FROM tarefas WHERE kpi_id = $1', [rh])).rowCount).toBe(0)
    const com = await plano(rh, 'camila')
    expect(com.statusCode, JSON.stringify(com.body)).toBe(201)
    expect(com.body.tarefa.kpi.id).toBe(rh)
  })

  it('sem `indicadores`, o plano de ação é 403 — e a tarefa comum continua de todos', async () => {
    const kpi = await kpiNoBanco('novos_pacientes')
    expect((await plano(kpi, 'rita')).statusCode).toBe(403)
    expect((await plano(undefined, 'rita')).statusCode).toBe(201)
  })

  it('ids-de-outra-clinica: `kpiId` da vizinha é 422, nunca 500 nem tarefa', async () => {
    const vizinho = await kpiNoBanco('novos_pacientes', c.outraClinica)
    const r = await plano(vizinho)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(422)
    expect(JSON.stringify(r.body)).not.toContain(vizinho)
    expect((await c.migrate.query('SELECT 1 FROM tarefas WHERE kpi_id = $1', [vizinho])).rowCount).toBe(0)
  })

  it('KPI arquivado é 422; `kpiId` em tarefa de paciente é 400 (o plano é interno, L-IN-4)', async () => {
    const kpi = await kpiNoBanco('novos_pacientes')
    await c.migrate.query('UPDATE kpis SET arquivado_em = now() WHERE id = $1', [kpi])
    expect((await plano(kpi)).statusCode).toBe(422)
    const vivo = await kpiNoBanco('novos_pacientes')
    const p = await postar(
      c,
      '/v1/tarefas',
      { vinculo: 'paciente', pacienteId: c.pacientes['ana'], tipo: 'Follow-up', responsavelId: c.pessoas['beatriz'], quando: { modo: 'agendada', prazo: AMANHA }, kpiId: vivo },
      'beatriz',
    )
    expect(p.statusCode).toBe(400)
  })

  it('as regras do marcador (T3) continuam: `lancamento-kpi:` com `kpiId` é 422; o plano se conclui pela rota comum', async () => {
    const kpi = await kpiNoBanco('novos_pacientes')
    const forjado = await plano(kpi, 'beatriz', { marcador: `lancamento-kpi:${kpi}` })
    expect(forjado.statusCode).toBe(422)
    const r = await plano(kpi)
    expect(r.statusCode).toBe(201)
    const fim = await postar(c, `/v1/tarefas/${r.body.tarefa.id}/concluir`, { em: HOJE }, 'beatriz')
    expect(fim.statusCode, JSON.stringify(fim.body)).toBe(200)
  })
})

describe('T7 — da-semana, contador e reuniao (I-45, I-46)', () => {
  it('as três rotas cumprem o contrato, e a meta abaixo aparece em todas', async () => {
    const fat = await faturamentoAbaixo()
    const s = await pegar(c, '/v1/indicadores/da-semana', {}, 'beatriz')
    expect(s.statusCode, JSON.stringify(s.body)).toBe(200)
    const semana = IndicadoresDaSemana.parse(s.body)
    expect(semana.itens.map((x) => [x.kpi.id, x.metaDoKpi.situacao])).toEqual([[fat, 'abaixo']])
    expect(semana.itens[0]!.metaDoKpi.alvo.emDinheiro).toBe('1000000')
    const n = await pegar(c, '/v1/indicadores/contador', {}, 'beatriz')
    expect(ContadorDeIndicadores.parse(n.body)).toEqual({ abaixo: 1 })
    const r = await pegar(c, '/v1/indicadores/reuniao', {}, 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const reuniao = ReuniaoDeIndicadores.parse(r.body)
    expect(reuniao.semana).toEqual({ de: '2026-10-19', ate: '2026-10-25' })
    expect(reuniao.saude.map((k) => k.id)).toEqual([fat])
    expect(reuniao.capa).toMatchObject({ clinica: 'Clínica Tarefas', metas: 1, abaixo: 1 })
  })

  it('o slide final traz os planos de ação da semana — e só eles', async () => {
    const kpi = await kpiNoBanco('novos_pacientes')
    const r = await plano(kpi)
    expect(r.statusCode).toBe(201)
    // `criada_em` é o `now()` do banco; o relógio do servidor, nos testes, é o fixo de 24/10.
    // Segunda 19/10 00:00 em Salvador = 03:00Z: a borda de início ENTRA ([início, fim)).
    await c.migrate.query(`UPDATE tarefas SET criada_em = '2026-10-19T03:00:00Z' WHERE id = $1`, [r.body.tarefa.id])
    // Plano da semana PASSADA (domingo 18/10, 20h em Salvador) não entra.
    const velho = await plano(kpi)
    await c.migrate.query(`UPDATE tarefas SET criada_em = '2026-10-18T23:00:00Z' WHERE id = $1`, [velho.body.tarefa.id])
    // Tarefa comum da semana, sem KPI, também não.
    expect((await plano(undefined)).statusCode).toBe(201)
    const planos = (await pegar(c, '/v1/indicadores/reuniao', {}, 'beatriz')).body.planosDeAcao as unknown[]
    expect(planos).toEqual([
      { id: r.body.tarefa.id, descricao: 'Ligar para quem faltou', kpi: { id: kpi, nome: 'novos_pacientes' }, prazo: AMANHA, status: 'aberta', responsavel: 'Beatriz' },
    ])
  })

  it('reuniao-sem-paciente e da-semana-sem-paciente: nenhuma composição, pacienteId nem nome de paciente (L-IN-4)', async () => {
    await faturamentoAbaixo()
    await kpiNoBanco('novos_pacientes')
    // Uma tarefa de paciente na semana, e um plano de ação.
    const doPaciente = await postar(
      c,
      '/v1/tarefas',
      { vinculo: 'paciente', pacienteId: c.pacientes['ana'], tipo: 'Follow-up', responsavelId: c.pessoas['beatriz'], quando: { modo: 'agendada', prazo: AMANHA } },
      'beatriz',
    )
    expect(doPaciente.statusCode).toBe(201)
    const kpi = await kpiNoBanco('comparecimento')
    expect((await plano(kpi)).statusCode).toBe(201)
    for (const rota of ['/v1/indicadores/reuniao', '/v1/indicadores/da-semana']) {
      for (const quem of ['beatriz', 'camila']) {
        const r = await pegar(c, rota, {}, quem)
        expect(r.statusCode, rota).toBe(200)
        const { chaves } = varrer(r.body)
        for (const proibida of ['paciente', 'pacienteId', 'pacientes', 'composicao', 'porForma', 'linhas']) {
          expect(chaves, `${rota} ${quem}`).not.toContain(proibida)
        }
        for (const p of Object.values(c.pacientes)) expect(r.text, rota).not.toContain(p)
        expect(r.text, rota).not.toContain('Ana')
        expect(r.text, rota).not.toContain('Bruna')
      }
    }
  })

  it('kpi-rh-some-sem-pessoas-gerir: o KPI de RH abaixo da meta não existe nas três rotas para quem não tem `pessoas.gerir`', async () => {
    const rh = await rhAbaixo()
    // Controle: com `pessoas.gerir` ele está nas três.
    const semana = (await pegar(c, '/v1/indicadores/da-semana', {}, 'camila')).body as { itens: { kpi: { id: string } }[] }
    expect(semana.itens.map((x) => x.kpi.id)).toEqual([rh])
    expect((await pegar(c, '/v1/indicadores/contador', {}, 'camila')).body).toEqual({ abaixo: 1 })
    expect((await pegar(c, '/v1/indicadores/reuniao', {}, 'camila')).text).toContain(rh)
    for (const rota of TRES_ROTAS) {
      const r = await pegar(c, rota, {}, 'beatriz')
      expect(r.statusCode, rota).toBe(200)
      expect(r.text, rota).not.toContain(rh)
      expect(r.text, rota).not.toContain('conversas_1a1_em_dia')
    }
    expect((await pegar(c, '/v1/indicadores/contador', {}, 'beatriz')).body).toEqual({ abaixo: 0 })
  })

  it('nenhuma-string-com-dinheiro: sem `valores`, nenhum centavo e nenhum R$ nas três rotas (com mutação)', async () => {
    await faturamentoAbaixo()
    const kpi = await kpiNoBanco('novos_pacientes')
    expect((await plano(kpi)).statusCode).toBe(201)
    for (const rota of TRES_ROTAS) {
      const r = await pegar(c, rota, {}, 'juliana')
      expect(r.statusCode, rota).toBe(200)
      expect(r.text, rota).not.toContain('123457')
      expect(r.text, rota).not.toContain('1000000')
      for (const s of varrer(r.body).strings) expect(s, `${rota}: ${s}`).not.toMatch(/R\$|\d+,\d{2}\b/)
    }
    // Mutação: a MESMA leitura com `valores` traz os centavos — o teste vê o vazamento quando ele existe.
    const comValores = await pegar(c, '/v1/indicadores/reuniao', {}, 'beatriz')
    expect(comValores.text).toContain('123457')
    expect(comValores.text).toContain('1000000')
  })

  it('os slides de OKR são os do trimestre de hoje: o duplicado para o próximo não entra (vídeo de 19/11)', async () => {
    const k = await kpiNoBanco('comparecimento')
    const agora = await postar(c, '/v1/indicadores/okrs', { objetivo: 'Deste trimestre', periodo: { tipo: 'trimestre', inicio: '2026-10-01' }, resultadosChave: [{ kpiId: k, alvo: '9000' }] }, 'beatriz')
    expect(agora.statusCode, JSON.stringify(agora.body)).toBe(201)
    const dup = await postar(c, `/v1/indicadores/okrs/${agora.body.id}/duplicar`, {}, 'beatriz')
    expect(dup.statusCode, JSON.stringify(dup.body)).toBe(201)
    expect(dup.body.periodo.inicio).toBe('2027-01-01')
    const r = ReuniaoDeIndicadores.parse((await pegar(c, '/v1/indicadores/reuniao', {}, 'beatriz')).body)
    expect(r.okrs.map((o) => o.id)).toEqual([agora.body.id])
    // A capa e os slides contam o mesmo.
    expect(r.capa.okrsAtivos).toBe(1)
    expect(r.capa.prioridades?.quantos).toBe(1)
  })

  it('sem `indicadores`, 403 nas três', async () => {
    for (const rota of TRES_ROTAS) expect((await pegar(c, rota, {}, 'rita')).statusCode, rota).toBe(403)
  })
})

describe('T7 — Visão do mês: "aguardando fechamento" e o link para Indicadores', () => {
  it('a Visão do mês leva o id do KPI da meta; sem meta definida, `null`', async () => {
    expect((await pegar(c, '/v1/visao-do-mes', { mes: '2026-10' }, 'beatriz')).body.kpiDaMetaId).toBeNull()
    expect((await botar(c, '/v1/metas/2026-10', { valor: '1000000' }, 'beatriz')).statusCode).toBe(200)
    const v = (await pegar(c, '/v1/visao-do-mes', { mes: '2026-10' }, 'beatriz')).body
    const k = await c.migrate.query<{ id: string }>(
      `SELECT id FROM kpis WHERE clinica_id = $1 AND chave_catalogo = 'faturamento_conferido' AND arquivado_em IS NULL`,
      [c.clinica],
    )
    expect(v.kpiDaMetaId).toBe(k.rows[0]!.id)
    expect(v).toHaveProperty('aguardandoFechamento')
    expect(typeof v.diasAguardandoFechamento).toBe('number')
  })
})
