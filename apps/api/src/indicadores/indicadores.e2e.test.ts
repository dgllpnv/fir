import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BancoService } from '../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../banco/clinica-id'
import {
  botar,
  type Cenario,
  desmontarCenario,
  FUSO,
  HOJE,
  limparFinanceiro,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'
import { fotografarClinica } from './fotografias'

/**
 * Indicadores & Insights — T2, contra Postgres REAL e a API inteira.
 *
 * HOJE = sábado 24/10/2026 (America/Bahia). `beatriz` (pf_sup) tem `valores`
 * e `finmes`; `juliana` (pf_rec) tem `jornada` e NÃO tem `valores`. As duas
 * ganham `indicadores` e `indicadores.gerir` aqui — a 0099 só as dá a perfil
 * com `painel`, e o cenário nasce depois dela.
 */
let c: Cenario
let banco: BancoService

const MES = '2026-10'

const recebimentoEm = (instante: string, valor: string, aberto = '0') =>
  c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, valor_aberto, forma, recebido_em, registrado_por)
     VALUES ($1, $2, 'Pagamento de consulta', $3, $4, $7, $5::timestamptz, $6)`,
    // Só abrir saldo (valor 0) não tem forma: o banco recusa forma sem dinheiro.
    [c.clinica, c.pacientes['ana'], valor, aberto, instante, c.pessoas['beatriz'], valor === '0' ? '' : 'Pix'],
  )

const kpiNoBanco = async (chave: string, clinica = c.clinica, criadoEm = '2026-10-01T12:00:00Z'): Promise<string> => {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia, criado_em)
     VALUES ($1, 'catalogo', $2, $2, 'mensal', $3) RETURNING id`,
    [clinica, chave, criadoEm],
  )
  return r.rows[0]!.id
}

const lista = (quem = 'beatriz') => pegar(c, '/v1/indicadores', {}, quem)

beforeAll(async () => {
  c = await montarCenario('indicadores-t2')
  banco = new BancoService()
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir']
      WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec')`,
    [c.clinica],
  )
})
afterAll(async () => {
  await limparFinanceiro(c)
  await limparTarefas(c)
  await banco.onModuleDestroy()
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparFinanceiro(c)
  await limparTarefas(c)
})

describe('regra 6 em /v1/indicadores* (appsec C11)', () => {
  it('regra-6-nenhum-byte-de-hoje: com o caixa de hoje aberto, um recebimento de hoje não muda nenhum byte', async () => {
    const id = await kpiNoBanco('faturamento_conferido')
    await kpiNoBanco('ticket_medio')
    await kpiNoBanco('resultado_do_mes')
    await recebimentoEm('2026-10-22T12:00:00Z', '50000')
    const antes = [
      (await lista()).text,
      (await pegar(c, `/v1/indicadores/kpis/${id}`, {}, 'beatriz')).text,
      (await pegar(c, `/v1/indicadores/kpis/${id}/serie`, { de: '2026-10-01', ate: HOJE }, 'beatriz')).text,
    ]
    await recebimentoEm('2026-10-24T15:00:00Z', '77777')
    const depois = [
      (await lista()).text,
      (await pegar(c, `/v1/indicadores/kpis/${id}`, {}, 'beatriz')).text,
      (await pegar(c, `/v1/indicadores/kpis/${id}/serie`, { de: '2026-10-01', ate: HOJE }, 'beatriz')).text,
    ]
    expect(depois).toEqual(antes)
    expect(depois.join('')).not.toContain('77777')
    // ADR 2026-11-19-aguardando-em-reais-com-finmes: `aguardandoFechamento`
    // agora existe no cartão (para quem tem `finmes`), mas fala só dos dias
    // ANTERIORES a hoje — a igualdade de bytes acima é a prova de que o de hoje não entra.
  })
})

describe('fonte única (I-7): o KPI é o número da tela de origem', () => {
  it('fonte-unica-faturamento_conferido e meta = Visão do mês: o mesmo alvo, o mesmo medido, o mesmo percentual', async () => {
    await recebimentoEm('2026-10-05T12:00:00Z', '300000')
    await recebimentoEm('2026-10-23T12:00:00Z', '100000')
    expect((await botar(c, `/v1/metas/${MES}`, { valor: '1000000' }, 'beatriz')).statusCode).toBe(200)
    const v = (await pegar(c, '/v1/visao-do-mes', { mes: MES }, 'beatriz')).body
    const itens = (await lista()).body.itens as { chave: string; atual: { emDinheiro: string }; metaVigente: { alvo: { emDinheiro: string }; atual: { emDinheiro: string; percentualDaMeta: number } } | null }[]
    const k = itens.find((x) => x.chave === 'faturamento_conferido')!
    expect(k.atual.emDinheiro).toBe(v.medido)
    expect(k.metaVigente!.alvo.emDinheiro).toBe(v.meta)
    expect(k.metaVigente!.atual.emDinheiro).toBe(v.medido)
    expect(k.metaVigente!.atual.percentualDaMeta).toBe(v.percentualDaMeta)
  })

  it('fonte-unica-saldo_a_receber e fonte-unica-resultado_do_mes: os números da Visão do mês', async () => {
    await kpiNoBanco('saldo_a_receber')
    await kpiNoBanco('resultado_do_mes')
    await recebimentoEm('2026-10-05T12:00:00Z', '0', '45000')
    await recebimentoEm('2026-10-06T12:00:00Z', '120000')
    const v = (await pegar(c, '/v1/visao-do-mes', { mes: MES }, 'beatriz')).body
    const itens = (await lista()).body.itens as { chave: string; atual: { emDinheiro: string } }[]
    expect(itens.find((x) => x.chave === 'saldo_a_receber')!.atual.emDinheiro).toBe(v.aReceber)
    expect(itens.find((x) => x.chave === 'resultado_do_mes')!.atual.emDinheiro).toBe(v.resultadoDoMes)
  })

  it('perda-sem-contagem-nao-atinge-teto: sem item com duas contagens, a perda é "sem dado", nunca 0', async () => {
    await kpiNoBanco('perda_de_estoque')
    const k = ((await lista()).body.itens as { chave: string; atual: { emDinheiro: string | null } }[]).find((x) => x.chave === 'perda_de_estoque')!
    expect(k.atual.emDinheiro).toBeNull()
  })
})

describe('metas sobre o lugar único (I-26)', () => {
  it('put-meta-mes-sobre-ate-data-409: o mês dentro de uma meta "até a data" é 409 com a mensagem, nunca 500', async () => {
    const r = await postar(c, '/v1/indicadores/kpis', { origem: 'catalogo', chave: 'faturamento_conferido' }, 'beatriz')
    expect(r.statusCode).toBe(201)
    const m = await postar(
      c,
      '/v1/indicadores/metas',
      { kpiId: r.body.id, tipo: 'ate_data', inicio: '2026-10-01', prazo: '2026-12-20', alvo: '9000000' },
      'beatriz',
    )
    expect(m.statusCode).toBe(201)
    const put = await botar(c, '/v1/metas/2026-11', { valor: '100000' }, 'beatriz')
    expect(put.statusCode).toBe(409)
    expect(put.body.message).toContain('edite-a em Indicadores')
  })

  it('metas-do-mes-put-antigo-falha: `fir_app` não escreve mais em `metas_do_mes` (0100)', async () => {
    const app = new pg.Client({ connectionString: process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir' })
    await app.connect()
    try {
      await app.query('BEGIN')
      await app.query("SELECT set_config('app.clinica_id', $1, true), set_config('app.pessoa_id', $2, true)", [c.clinica, c.pessoas['beatriz']])
      await expect(
        app.query(`INSERT INTO metas_do_mes (clinica_id, competencia, valor, definida_por) VALUES ($1, '2026-10-01', 100, $2)`, [
          c.clinica,
          c.pessoas['beatriz'],
        ]),
      ).rejects.toThrow(/permission denied|permissão negada/)
    } finally {
      await app.query('ROLLBACK')
      await app.end()
    }
  })

  it('migracao-0100-meses-trocados-aborta: a conferência linha a linha recusa a cópia com jan e fev trocados', async () => {
    await c.migrate.query('BEGIN')
    try {
      const k = await c.migrate.query<{ id: string }>(
        `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia)
         VALUES ($1, 'catalogo', 'faturamento_conferido', 'F', 'mensal') RETURNING id`,
        [c.clinica],
      )
      const jan = await c.migrate.query<{ id: string }>(
        `INSERT INTO metas_do_mes (clinica_id, competencia, valor, definida_por, definida_em)
         VALUES ($1, '2027-01-01', 100000, $2, '2026-12-01T00:00:00Z') RETURNING id`,
        [c.clinica, c.pessoas['beatriz']],
      )
      const fev = await c.migrate.query<{ id: string }>(
        `INSERT INTO metas_do_mes (clinica_id, competencia, valor, definida_por, definida_em)
         VALUES ($1, '2027-02-01', 200000, $2, '2026-12-01T00:00:00Z') RETURNING id`,
        [c.clinica, c.pessoas['beatriz']],
      )
      // Mesma quantidade e mesma soma por clínica: só a igualdade LINHA A LINHA pega.
      for (const [orig, mes, fim, valor] of [
        [jan.rows[0]!.id, '2027-01-01', '2027-01-31', 200000],
        [fev.rows[0]!.id, '2027-02-01', '2027-02-28', 100000],
      ] as const) {
        await c.migrate.query(
          `INSERT INTO metas_de_kpi (clinica_id, kpi_id, tipo, inicio, prazo, alvo_centavos, partida_centavos,
                                     origem_migracao, definida_por, definida_em)
           VALUES ($1, $2, 'mes', $3, $4, $5, 0, $6, $7, '2026-12-01T00:00:00Z')`,
          [c.clinica, k.rows[0]!.id, mes, fim, valor, orig, c.pessoas['beatriz']],
        )
      }
      await expect(c.migrate.query('SELECT conferir_migracao_de_metas_do_mes()')).rejects.toThrow(/divergente/)
    } finally {
      await c.migrate.query('ROLLBACK')
    }
  })
})

describe('permissão e redação (appsec C3, C5, C7)', () => {
  it('escrever-reais-sem-valores-403: meta e prévia em reais sem `valores` são 403', async () => {
    const id = await kpiNoBanco('faturamento_conferido')
    const m = await postar(c, '/v1/indicadores/metas', { kpiId: id, tipo: 'mes', inicio: '2026-11-01', prazo: '2026-11-30', alvo: '100000' }, 'juliana')
    expect(m.statusCode).toBe(403)
    const p = await pegar(c, '/v1/indicadores/metas/previa', { kpiId: id, inicio: '2026-11-01', prazo: '2026-11-30', alvo: '100000' }, 'juliana')
    expect(p.statusCode).toBe(403)
    // O KPI que ainda vai nascer (D.1) passa pela MESMA porta.
    const porChave = await pegar(c, '/v1/indicadores/metas/previa', { chave: 'faturamento_conferido', inicio: '2026-11-01', prazo: '2026-11-30', alvo: '100000' }, 'juliana')
    expect(porChave.statusCode).toBe(403)
    const porUnidade = await pegar(c, '/v1/indicadores/metas/previa', { unidade: 'reais', inicio: '2026-11-01', prazo: '2026-11-30', alvo: '100000' }, 'juliana')
    expect(porUnidade.statusCode).toBe(403)
  })

  it('previa-do-kpi-que-vai-nascer (D.1): pela chave, o ritmo e o atual, iguais aos do KPI criado; pela unidade, só o ritmo', async () => {
    await recebimentoEm('2026-10-05T12:00:00Z', '300000')
    const q = { inicio: '2026-10-01', prazo: '2026-10-31', alvo: '1000000' }
    const porChave = await pegar(c, '/v1/indicadores/metas/previa', { ...q, chave: 'faturamento_conferido' }, 'beatriz')
    expect(porChave.statusCode).toBe(200)
    expect(porChave.body.ritmoPorDiaUtil.emDinheiro).not.toBeNull()
    expect(porChave.body.atualPorDiaUtil.emDinheiro).not.toBeNull()
    const id = await kpiNoBanco('faturamento_conferido')
    const porId = await pegar(c, '/v1/indicadores/metas/previa', { ...q, kpiId: id }, 'beatriz')
    expect(porChave.body).toEqual(porId.body)

    const manual = await pegar(c, '/v1/indicadores/metas/previa', { ...q, unidade: 'quantidade', alvo: '3000' }, 'beatriz')
    expect(manual.statusCode).toBe(200)
    expect(manual.body.ritmoPorDiaUtil.emNumero).not.toBeNull()
    expect(manual.body.atualPorDiaUtil.emNumero).toBeNull()

    // A recusa da meta traz o código do domínio: é o que a tela casa para pôr o erro embaixo do campo.
    const zero = await postar(c, '/v1/indicadores/metas', { kpiId: id, tipo: 'mes', inicio: '2026-11-01', prazo: '2026-11-30', alvo: '0' }, 'beatriz')
    expect(zero.statusCode).toBe(422)
    expect(zero.body).toMatchObject({ codigo: 'AlvoPiorQueAPartida', message: 'O alvo precisa ser maior que zero.' })

    // Nenhum, ou mais de um: 400.
    expect((await pegar(c, '/v1/indicadores/metas/previa', q, 'beatriz')).statusCode).toBe(400)
    expect((await pegar(c, '/v1/indicadores/metas/previa', { ...q, kpiId: id, chave: 'faturamento_conferido' }, 'beatriz')).statusCode).toBe(400)
  })

  it('kpi-rh-some-sem-pessoas-gerir e razao-monetaria-some-sem-valores: o KPI não existe na resposta', async () => {
    const rh = await kpiNoBanco('atingimento_metas_individuais')
    await kpiNoBanco('despesas_fixas_sobre_recebido')
    const daBeatriz = ((await lista()).body.itens as { chave: string }[]).map((x) => x.chave)
    expect(daBeatriz).not.toContain('atingimento_metas_individuais')
    expect(daBeatriz).toContain('despesas_fixas_sobre_recebido')
    expect((await pegar(c, `/v1/indicadores/kpis/${rh}`, {}, 'beatriz')).statusCode).toBe(404)
    const daJuliana = ((await lista('juliana')).body.itens as { chave: string }[]).map((x) => x.chave)
    expect(daJuliana).not.toContain('despesas_fixas_sobre_recebido')
  })

  it('nenhuma-string-com-dinheiro: sem `valores`, nenhum centavo em lugar nenhum da resposta (com mutação)', async () => {
    await kpiNoBanco('faturamento_conferido')
    await recebimentoEm('2026-10-07T12:00:00Z', '123457')
    const equipe = await lista('juliana')
    expect(equipe.text).not.toContain('123457')
    expect((equipe.body.itens as { atual: { emDinheiro: string | null } }[])[0]!.atual.emDinheiro).toBeNull()
    // Mutação: a MESMA leitura com `valores` contém o número — o teste vê o vazamento quando ele existe.
    expect((await lista()).text).toContain('123457')
  })

  it('ids-de-outra-clinica: KPI da vizinha é 404 no detalhe, na série e como alvo de meta', async () => {
    const vizinho = await kpiNoBanco('novos_pacientes', c.outraClinica)
    expect((await pegar(c, `/v1/indicadores/kpis/${vizinho}`, {}, 'beatriz')).statusCode).toBe(404)
    expect((await pegar(c, `/v1/indicadores/kpis/${vizinho}/serie`, {}, 'beatriz')).statusCode).toBe(404)
    const m = await postar(c, '/v1/indicadores/metas', { kpiId: vizinho, tipo: 'mes', inicio: '2026-11-01', prazo: '2026-11-30', alvo: '1000' }, 'beatriz')
    expect(m.statusCode).toBe(404)
  })

  it('sem `indicadores`, 403 em toda leitura', async () => {
    expect((await lista('camila')).statusCode).toBe(403)
    expect((await pegar(c, '/v1/indicadores/catalogo', {}, 'camila')).statusCode).toBe(403)
  })

  it('log-sem-conteudo-indicadores: ler e escrever KPI não põe valor nem nome no log', async () => {
    const espioes = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m))
    try {
      await kpiNoBanco('faturamento_conferido')
      await recebimentoEm('2026-10-08T12:00:00Z', '654321')
      await lista()
      const linhas = espioes.flatMap((e) => e.mock.calls.map((x) => x.map(String).join(' ')))
      expect(linhas.join('\n')).not.toContain('654321')
      expect(linhas.join('\n')).not.toContain('Ana')
    } finally {
      for (const e of espioes) e.mockRestore()
    }
  })
})

describe('fotografias de posição (I-6, números c.9)', () => {
  const fotografar = (clinica: string) =>
    banco.naClinica(clinicaIdDeFonteConfiavel(clinica), c.pessoas['beatriz'] as never, (cx) =>
      fotografarClinica(cx, clinicaIdDeFonteConfiavel(clinica), FUSO, HOJE),
    )
  const fotos = async (kpi: string) =>
    (
      await c.migrate.query<{ dia: string; v: string | null }>(
        'SELECT dia::text AS dia, valor_centavos::text AS v FROM fotografias_de_kpi WHERE kpi_id = $1 ORDER BY dia',
        [kpi],
      )
    ).rows

  it('fotografia-pelo-instante: a posição de D é a do instante início(D+1), e rodar de novo não muda nada', async () => {
    const id = await kpiNoBanco('saldo_a_receber', c.clinica, '2026-10-21T12:00:00Z')
    // Um saldo de R$ 100 aberto em 21/10 às 22h de Salvador (22/10 01:00Z): é de 21/10.
    await recebimentoEm('2026-10-22T01:00:00Z', '0', '10000')
    // E um de R$ 50 aberto HOJE: não pertence à posição de nenhum dia passado.
    await recebimentoEm('2026-10-24T12:00:00Z', '0', '5000')
    await fotografar(c.clinica)
    const primeira = await fotos(id)
    expect(primeira).toEqual([
      { dia: '2026-10-20', v: '0' },
      { dia: '2026-10-21', v: '10000' },
      { dia: '2026-10-22', v: '10000' },
      { dia: '2026-10-23', v: '10000' },
    ])
    expect(await fotografar(c.clinica)).toBe(0)
    expect(await fotos(id)).toEqual(primeira)
  })

  it('fotografia-dia-perdido-recompoe e job-nao-cruza-clinica', async () => {
    const id = await kpiNoBanco('saldo_a_receber', c.clinica, '2026-10-22T12:00:00Z')
    const vizinho = await kpiNoBanco('saldo_a_receber', c.outraClinica, '2026-10-22T12:00:00Z')
    await recebimentoEm('2026-10-20T12:00:00Z', '0', '7000')
    // O servidor ficou parado: nenhum dia fotografado. O job recompõe todos, pelo instante.
    await fotografar(c.clinica)
    expect((await fotos(id)).map((x) => x.v)).toEqual(['7000', '7000', '7000'])
    expect(await fotos(vizinho)).toEqual([])
  })
})
