import { RelogioFixo } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { declararAtorSistema } from '../../banco/limpeza-de-teste'
import { RELOGIO } from '../../comum/relogio'
import { registrarCookie } from '../../main'

/**
 * **G8 2B — metas completas, ponta a ponta pela HTTP, contra Postgres real.**
 *
 * Os contraexemplos congelados do gate de números (CE-2, CE-4, CE-5) passam
 * pela API inteira — contrato, serviço, banco, domínio —, não só pelo
 * `avaliarMeta` (que já tem os seus em `metas-carteira.test.ts`). A meta do
 * CE-2 usa unidade `un`: a aritmética é a mesma de R$ 100,00 e, sem a chave
 * `valores` (ninguém da carteira a tem até o ticket 0.5), lançar R$ é 403
 * (A-6) — provado aqui também.
 *
 * Relógio fixo: quinta-feira, 05/11/2026, 12:00 na Bahia. Novembro de 2026
 * tem 5 segundas (02, 09, 16, 23, 30); a reunião da cliente A é na segunda,
 * então a semana da reunião é a de 02/11.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const SENHA = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')
const AGORA = new Date('2026-11-05T15:00:00Z')

let app: NestFastifyApplication
let migrate: pg.Client
const ids = { grupoA: '', grupoB: '', clienteA: '', clienteA2: '', clienteB: '', geral: '', doA: '', doB: '' }
let cookieA = ''
let cookieB = ''
let cookieGeral = ''

const http = () => request(app.getHttpServer())
const entrar = async (usuario: string): Promise<string> => {
  const r = await http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA }).expect(200)
  const v = r.headers['set-cookie'] as unknown
  const lista = Array.isArray(v) ? (v as string[]) : [String(v)]
  return lista.map((c) => c.split(';')[0]!).join('; ')
}
const um = async (sql: string, p: unknown[]): Promise<string> => (await migrate.query<{ id: string }>(sql, p)).rows[0]!.id

type MetaNaResposta = {
  id: string
  titulo: string
  valorMeta: string | null
  valorMetaInteiro: string | null
  atual: { valor: string | null; numero: string | null; escala: string } | null
  automatico: boolean
  avaliacao: { estado: string; detalhe: string; percentual: number | null; ritmoEsperado: number }
  semanas: { referencia: string; valor: string | null; numero: string | null; lancada: boolean }[]
  semanasPassadas: number | null
  semanasDoMes: number | null
  faltaLancar: string | null
  acoes: { concluidas: number; total: number }
}

async function metasDe(cookie: string, cliente: string): Promise<MetaNaResposta[]> {
  const r = await http().get(`/v1/carteira/clientes/${cliente}/metas`).set('cookie', cookie).expect(200)
  return r.body.metas as MetaNaResposta[]
}

async function criarMeta(cookie: string, cliente: string, corpo: Record<string, unknown>): Promise<MetaNaResposta> {
  const r = await http().post(`/v1/carteira/clientes/${cliente}/metas`).set('cookie', cookie).send(corpo)
  if (r.status !== 201) throw new Error(`criar meta: ${r.status} ${JSON.stringify(r.body)}`)
  return r.body.metaSalva as MetaNaResposta
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  ids.grupoA = await um('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`Metas A ${sufixo}`])
  ids.grupoB = await um('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`Metas B ${sufixo}`])
  // Clientes sem clínica, em onboarding (o padrão): entram em `ativos()` e nenhum job os varre.
  const cliente = (g: string, nome: string) =>
    um(`INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto) VALUES ($1, NULL, $2, 'Acelerador FIR') RETURNING id`, [g, nome])
  ids.clienteA = await cliente(ids.grupoA, `Cliente A ${sufixo}`)
  ids.clienteA2 = await cliente(ids.grupoA, `Cliente A2 sem meta ${sufixo}`)
  ids.clienteB = await cliente(ids.grupoB, `Cliente B ${sufixo}`)
  await migrate.query('UPDATE clientes_carteira SET reuniao_dia_semana = 1 WHERE id = $1', [ids.clienteA])
  const hash = await hashDeSenha(SENHA)
  const usuario = (u: string, escopo: string, grupo: string | null) =>
    um(`INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, $1, $2, $3, $4) RETURNING id`, [
      `${u}.${sufixo}`,
      hash,
      escopo,
      grupo,
    ])
  ids.geral = await usuario('geral', 'geral', null)
  ids.doA = await usuario('doa', 'grupo', ids.grupoA)
  ids.doB = await usuario('dob', 'grupo', ids.grupoB)

  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(RELOGIO).useValue(new RelogioFixo(AGORA)).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  cookieA = await entrar(`doa.${sufixo}`)
  cookieB = await entrar(`dob.${sufixo}`)
  cookieGeral = await entrar(`geral.${sufixo}`)
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const clientes = [ids.clienteA, ids.clienteA2, ids.clienteB].filter(Boolean)
  const grupos = [ids.grupoA, ids.grupoB].filter(Boolean)
  const usuarios = [ids.geral, ids.doA, ids.doB].filter(Boolean)
  await migrate.query('DELETE FROM acoes_do_plano WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM tarefas_internas WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM reunioes_comerciais WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM metas_comerciais WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM lancamentos_de_indicador WHERE grupo_id = ANY($1)', [grupos])
  await migrate.query('DELETE FROM indicadores_carteira WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM planilhas_do_cliente WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM auditoria_da_carteira WHERE grupo_id = ANY($1)', [grupos])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [usuarios])
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador = ANY($1)', [
    [`geral.${sufixo}`, `doa.${sufixo}`, `dob.${sufixo}`],
  ])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [usuarios])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [grupos])
  await migrate.end()
  await app.close()
})

let metaCe2 = ''
let indicadorCe2 = ''
let metaCe5 = ''

describe('CE-2 e CE-5 pela API (gate de números)', () => {
  it('CE-2: mensal com soma, alvo 100, 1 de 5 semanas passadas, acumulado 18 → No ritmo', async () => {
    const meta = await criarMeta(cookieA, ids.clienteA, {
      titulo: 'Avaliações no mês',
      novoIndicador: { nome: 'Avaliações', unidade: 'un' },
      tipo: 'mensal',
      agregacao: 'soma',
      sentido: 'maior_melhor',
      valorMetaInteiro: '100',
      fonte: 'lancamento',
      inicio: '2026-11-01',
      prazo: null,
    })
    metaCe2 = meta.id
    expect(meta.avaliacao.detalhe).toBe('sem_lancamento')
    expect(meta.faltaLancar).toBe('2026-11-02')

    const l = await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/metas/lancamento-semanal`)
      .set('cookie', cookieA)
      .send({ semana: '2026-11-02', valores: [{ metaId: metaCe2, valorInteiro: '18' }] })
      .expect(200)
    expect(l.body).toEqual({ lancadas: 1, reuniaoId: null, tarefaConcluida: false })

    const m = (await metasDe(cookieA, ids.clienteA)).find((x) => x.id === metaCe2)!
    // 18/100 = 0,9 × 1/5 exatamente: o protótipo em ponto flutuante diz "Atenção".
    expect(m.avaliacao.detalhe).toBe('no_ritmo')
    expect(m.avaliacao.percentual).toBe(18)
    expect(m.avaliacao.ritmoEsperado).toBe(20)
    expect(m.semanasPassadas).toBe(1)
    expect(m.semanasDoMes).toBe(5)
    expect(m.atual).toEqual({ valor: null, numero: '180', escala: 'decimos' })
    expect(m.semanas.map((s) => s.lancada)).toEqual([true, false, false, false, false])
    expect(m.faltaLancar).toBeNull()
    const ind = await migrate.query<{ indicador_id: string }>('SELECT indicador_id FROM metas_comerciais WHERE id = $1', [metaCe2])
    indicadorCe2 = ind.rows[0]!.indicador_id
  })

  it('CE-5: com prazo, menor melhor, inicial 100, alvo 50, atual 70 → progresso 60% (denominadores negativos)', async () => {
    const meta = await criarMeta(cookieA, ids.clienteA, {
      titulo: 'Dias para retorno',
      novoIndicador: { nome: 'Dias até o retorno', unidade: 'dias' },
      tipo: 'prazo',
      agregacao: 'ultimo',
      sentido: 'menor_melhor',
      valorInicialInteiro: '100',
      valorMetaInteiro: '50',
      fonte: 'lancamento',
      inicio: '2026-10-05',
      prazo: '2026-12-31',
    })
    metaCe5 = meta.id
    await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/metas/lancamento-semanal`)
      .set('cookie', cookieA)
      .send({ semana: '2026-11-02', valores: [{ metaId: metaCe5, valorInteiro: '70' }] })
      .expect(200)
    const m = (await metasDe(cookieA, ids.clienteA)).find((x) => x.id === metaCe5)!
    expect(m.avaliacao.percentual).toBe(60)
    // esperado = 31/87 dias ≈ 36%; 60% ≥ 0,9 × 36% → no ritmo (a cruzada ingênua inverteria).
    expect(m.avaliacao.detalhe).toBe('no_ritmo')
    expect(m.avaliacao.ritmoEsperado).toBe(36)
  })

  it('relançar a mesma semana três vezes deixa UMA linha, com o último valor, e a trilha de→para', async () => {
    for (const v of ['20', '21', '22']) {
      await http()
        .post(`/v1/carteira/clientes/${ids.clienteA}/metas/lancamento-semanal`)
        .set('cookie', cookieA)
        .send({ semana: '2026-11-02', valores: [{ metaId: metaCe2, valorInteiro: v }] })
        .expect(200)
    }
    const linhas = await migrate.query<{ valor_inteiro: string }>(
      `SELECT valor_inteiro::text FROM lancamentos_de_indicador WHERE indicador_id = $1 AND referencia = '2026-11-02'`,
      [indicadorCe2],
    )
    expect(linhas.rows).toEqual([{ valor_inteiro: '22' }])
    const trilha = await migrate.query<{ acao: string }>(
      `SELECT acao FROM auditoria_da_carteira a
        JOIN lancamentos_de_indicador l ON l.id = a.registro_id
       WHERE l.indicador_id = $1 ORDER BY a.em`,
      [indicadorCe2],
    )
    expect(trilha.rows.map((r) => r.acao)).toEqual(['criar', 'atualizar', 'atualizar', 'atualizar'])
    // volta ao cenário do CE-2
    await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/metas/lancamento-semanal`)
      .set('cookie', cookieA)
      .send({ semana: '2026-11-02', valores: [{ metaId: metaCe2, valorInteiro: '18' }] })
      .expect(200)
  })
})

describe('CE-4: a referência é a segunda-feira', () => {
  it('lançamento fora da segunda é recusado na ENTRADA, nas três rotas, e nada é gravado', async () => {
    const semanal = await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/metas/lancamento-semanal`)
      .set('cookie', cookieA)
      .send({ semana: '2026-11-03', valores: [{ metaId: metaCe2, valorInteiro: '5' }] })
      .expect(400)
    expect(semanal.body.codigo).toBe('REFERENCIA_FORA_DA_SEGUNDA')
    const lote = await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/lancamentos`)
      .set('cookie', cookieA)
      .send({ referencia: '2026-11-04', valores: [{ indicadorId: indicadorCe2, valorInteiro: '5' }] })
      .expect(400)
    expect(lote.body.codigo).toBe('REFERENCIA_FORA_DA_SEGUNDA')
    await http()
      .post(`/v1/carteira/indicadores/${indicadorCe2}/lancamentos`)
      .set('cookie', cookieA)
      .send({ referencia: '2026-11-05', valorInteiro: '5' })
      .expect(400)
    const n = await migrate.query(`SELECT 1 FROM lancamentos_de_indicador WHERE indicador_id = $1 AND referencia <> '2026-11-02'`, [
      indicadorCe2,
    ])
    expect(n.rowCount).toBe(0)
  })

  it('semana futura é recusada', async () => {
    const r = await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/metas/lancamento-semanal`)
      .set('cookie', cookieA)
      .send({ semana: '2026-11-09', valores: [{ metaId: metaCe2, valorInteiro: '5' }] })
      .expect(400)
    expect(r.body.codigo).toBe('SEMANA_FUTURA')
  })

  it('legados (terça e quinta da mesma semana) aparecem no RELATÓRIO e não dobram a soma', async () => {
    // Simula o que o contrato antigo aceitava: gravado direto no banco.
    await migrate.query(
      `INSERT INTO lancamentos_de_indicador (indicador_id, grupo_id, referencia, valor_inteiro, lancado_por)
       VALUES ($1, $2, '2026-11-03', 50, $3), ($1, $2, '2026-11-05', 50, $3)`,
      [indicadorCe2, ids.grupoA, ids.doA],
    )
    try {
      const rel = await migrate.query<{ referencia: string; segunda_da_semana: string; segunda_ja_lancada: boolean }>(
        `SELECT referencia::text, segunda_da_semana::text, segunda_ja_lancada
           FROM lancamentos_fora_da_segunda WHERE indicador_id = $1 ORDER BY referencia`,
        [indicadorCe2],
      )
      expect(rel.rows).toEqual([
        { referencia: '2026-11-03', segunda_da_semana: '2026-11-02', segunda_ja_lancada: true },
        { referencia: '2026-11-05', segunda_da_semana: '2026-11-02', segunda_ja_lancada: true },
      ])
      // Pelo papel da carteira (security_invoker): o grupo B não vê os legados do A.
      const pelaCarteiraB = await carteiraComo(ids.doB, 'grupo', ids.grupoB, (c) =>
        c.query('SELECT 1 FROM lancamentos_fora_da_segunda WHERE indicador_id = $1', [indicadorCe2]),
      )
      expect(pelaCarteiraB.rowCount).toBe(0)
      const m = (await metasDe(cookieA, ids.clienteA)).find((x) => x.id === metaCe2)!
      expect(m.atual?.numero).toBe('180') // 18, não 118
      expect(m.avaliacao.detalhe).toBe('no_ritmo')
    } finally {
      await migrate.query(`DELETE FROM lancamentos_de_indicador WHERE indicador_id = $1 AND referencia IN ('2026-11-03', '2026-11-05')`, [
        indicadorCe2,
      ])
    }
  })
})

async function carteiraComo<T>(
  usuarioId: string,
  escopo: string,
  grupo: string | null,
  f: (c: pg.Client) => Promise<T>,
): Promise<T> {
  const url = process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir'
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    await c.query('BEGIN')
    await c.query("SELECT set_config('app.pessoa_id', $1, true)", [`usuario_gestao:${usuarioId}`])
    await c.query("SELECT set_config('app.escopo', $1, true)", [escopo])
    await c.query("SELECT set_config('app.grupo_id', $1, true)", [grupo ?? ''])
    return await f(c)
  } finally {
    await c.query('ROLLBACK')
    await c.end()
  }
}

describe('A-6 e redação de valores (appsec caso 12, regra 17)', () => {
  it('meta e lançamento em R$ sem a permissão valores: 403, nada gravado', async () => {
    const meta = await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/metas`)
      .set('cookie', cookieGeral)
      .send({
        titulo: 'Faturamento',
        novoIndicador: { nome: 'Faturamento', unidade: 'R$' },
        tipo: 'mensal',
        agregacao: 'soma',
        sentido: 'maior_melhor',
        valorMeta: '5000000',
        fonte: 'lancamento',
        inicio: '2026-11-01',
        prazo: null,
      })
      .expect(403)
    expect(meta.body.codigo).toBe('SEM_PERMISSAO_DE_VALORES')
    const n = await migrate.query(`SELECT 1 FROM indicadores_carteira WHERE cliente_carteira_id = $1 AND nome = 'Faturamento'`, [ids.clienteA])
    expect(n.rowCount).toBe(0)
  })

  it('meta R$ existente: nenhum número absoluto atravessa (alvo, atual, semanas, série) — só o percentual', async () => {
    const ind = await um(
      `INSERT INTO indicadores_carteira (cliente_carteira_id, grupo_id, nome, unidade, sentido, meta_centavos)
       VALUES ($1, $2, 'Faturamento semanal', 'R$', 'maior_melhor', 9876543) RETURNING id`,
      [ids.clienteA, ids.grupoA],
    )
    await migrate.query(
      `INSERT INTO metas_comerciais (cliente_carteira_id, grupo_id, indicador_id, titulo, sentido, tipo, agregacao,
                                     valor_meta_centavos, inicio, prazo)
       VALUES ($1, $2, $3, 'Faturar no mês', 'maior_melhor', 'mensal', 'soma', 5000003, '2026-11-01', NULL)`,
      [ids.clienteA, ids.grupoA, ind],
    )
    await migrate.query(
      `INSERT INTO lancamentos_de_indicador (indicador_id, grupo_id, referencia, valor_centavos, lancado_por)
       VALUES ($1, $2, '2026-11-02', 1234567, $3), ($1, $2, '2026-10-26', 7654321, $3)`,
      [ind, ids.grupoA, ids.doA],
    )
    const rotas = [
      `/v1/carteira/clientes/${ids.clienteA}/metas`,
      `/v1/carteira/clientes/${ids.clienteA}/indicadores`,
      '/v1/carteira/metas/painel',
    ]
    for (const rota of rotas) {
      const r = await http().get(rota).set('cookie', cookieA).expect(200)
      const texto = JSON.stringify(r.body)
      for (const segredo of ['5000003', '1234567', '7654321', '9876543', '123456', '50000']) {
        expect(texto.includes(segredo), `${rota} vazou ${segredo}`).toBe(false)
      }
    }
    const m = (await metasDe(cookieA, ids.clienteA)).find((x) => x.titulo === 'Faturar no mês')!
    expect(m.valorMeta).toBeNull()
    expect(m.atual).toEqual({ valor: null, numero: null, escala: 'centavos' })
    expect(m.semanas[0]).toMatchObject({ referencia: '2026-11-02', valor: null, numero: null, lancada: true })
    expect(m.avaliacao.percentual).toBe(25) // 1234567/5000003 ≈ 24,69% → 25: o percentual atravessa
    const i = await http().get(`/v1/carteira/clientes/${ids.clienteA}/indicadores`).set('cookie', cookieA).expect(200)
    const cartao = (i.body.indicadores as { id: string; valorMeta: unknown; ultimo: { valor: unknown }; serie: { valor: unknown }[]; variacaoEmDecimos: number | null }[]).find(
      (x) => x.id === ind,
    )!
    expect(cartao.valorMeta).toBeNull()
    expect(cartao.ultimo.valor).toBeNull()
    expect(cartao.serie.every((p) => p.valor === null)).toBe(true)
    // A variação (−83,87%) e o "Na meta" de um indicador em R$ revelam a receita: não
    // atravessam sem `valores` (regra 17 — o percentual passa só na meta do mês, acima).
    expect(cartao.variacaoEmDecimos).toBeNull()
    expect((cartao as unknown as { naMeta: unknown }).naMeta).toBeNull()
  })
})

describe('fonte da planilha e de outro indicador (M5)', () => {
  it('meta com fonte "pl:comercial|leads_recebidos|soma4" lê as quatro semanas anteriores', async () => {
    const linha = (semana: string, site: number, google: number) => ({
      carimbo: `${semana}T12:00:00.000Z`,
      semana,
      semanaInformada: null,
      mesConfere: null,
      preenchidas: 3,
      total: 8,
      valores: {
        leads_site: { estado: 'numero', inteiro: String(site) },
        leads_google: { estado: 'numero', inteiro: String(google) },
        leads_insta: { estado: 'vazio' },
      },
    })
    const resultado = {
      abas: [
        {
          frente: 'comercial',
          titulo: 'Comercial',
          candidatas: [],
          colunasFaltando: [],
          semCarimbo: false,
          // 26/10 e 19/10 dentro das quatro; 28/09 fora; 02/11 é a semana corrente (fora).
          linhas: [linha('2026-09-28', 99, 0), linha('2026-10-19', 4, 3), linha('2026-10-26', 6, 2), linha('2026-11-02', 50, 50)],
        },
      ],
    }
    await migrate.query(
      `INSERT INTO planilhas_do_cliente (cliente_carteira_id, grupo_id, spreadsheet_id, link, resultado, lida_em)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [ids.clienteA, ids.grupoA, `1Metas${randomBytes(12).toString('hex')}`, `https://docs.google.com/spreadsheets/d/x${sufixo}/edit`, JSON.stringify(resultado)],
    )
    const lista = await http().get(`/v1/carteira/clientes/${ids.clienteA}/metas`).set('cookie', cookieA).expect(200)
    const fontes = (lista.body.fontes as { fonte: string }[]).map((f) => f.fonte)
    expect(fontes).toContain('pl:comercial|leads_recebidos|soma4')
    expect(fontes).not.toContain('pl:comercial|taxa_conversao|soma4') // percentual não soma (ajuste 19)

    const meta = await criarMeta(cookieA, ids.clienteA, {
      titulo: 'Leads do mês pela planilha',
      novoIndicador: { nome: 'Leads', unidade: 'un' },
      tipo: 'prazo',
      agregacao: 'soma',
      sentido: 'maior_melhor',
      valorMetaInteiro: '30',
      fonte: 'pl:comercial|leads_recebidos|soma4',
      inicio: '2026-10-01',
      prazo: '2026-11-30',
    })
    expect(meta.automatico).toBe(true)
    expect(meta.atual).toEqual({ valor: null, numero: '150', escala: 'decimos' }) // 7 + 8 = 15
    expect(meta.avaliacao.percentual).toBe(50)
    expect(meta.faltaLancar).toBeNull() // fonte automática não pede lançamento
  })

  it('fonte de outra unidade é recusada; fonte de indicador de OUTRA cliente também', async () => {
    const outraUnidade = await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/metas`)
      .set('cookie', cookieA)
      .send({
        titulo: 'Taxa pela planilha',
        novoIndicador: { nome: 'Leads 2', unidade: 'un' },
        tipo: 'mensal',
        agregacao: 'ultimo',
        sentido: 'maior_melhor',
        valorMetaInteiro: '30',
        fonte: 'pl:comercial|taxa_conversao|ultima',
        inicio: '2026-11-01',
        prazo: null,
      })
      .expect(400)
    expect(outraUnidade.body.codigo).toBe('FONTE_DE_OUTRA_UNIDADE')
    const indB = await um(
      `INSERT INTO indicadores_carteira (cliente_carteira_id, grupo_id, nome, unidade, sentido) VALUES ($1, $2, 'Do B', 'un', 'maior_melhor') RETURNING id`,
      [ids.clienteB, ids.grupoB],
    )
    const r = await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/metas`)
      .set('cookie', cookieGeral)
      .send({
        titulo: 'Pega do B',
        indicadorId: indicadorCe2,
        tipo: 'mensal',
        agregacao: 'ultimo',
        sentido: 'maior_melhor',
        valorMetaInteiro: '30',
        fonte: `ind:${indB}`,
        inicio: '2026-11-01',
        prazo: null,
      })
      .expect(400)
    expect(r.body.codigo).toBe('FONTE_INVALIDA')
  })

  it('meta com fonte de outro indicador lê o último lançamento dele', async () => {
    const meta = await criarMeta(cookieA, ids.clienteA, {
      titulo: 'Avaliações (último)',
      novoIndicador: { nome: 'Espelho', unidade: 'un' },
      tipo: 'mensal',
      agregacao: 'ultimo',
      sentido: 'maior_melhor',
      valorMetaInteiro: '20',
      fonte: `ind:${indicadorCe2}`,
      inicio: '2026-11-01',
      prazo: null,
    })
    expect(meta.atual?.numero).toBe('180')
    expect(meta.avaliacao.detalhe).toBe('atencao') // 18/20 = 90% → Atenção (L775), exato
  })
})

describe('isolamento por grupo (regra 19)', () => {
  it('o grupo B não lê, não cria, não edita nem lança nas metas da cliente A — 404, igual a "não existe"', async () => {
    await http().get(`/v1/carteira/clientes/${ids.clienteA}/metas`).set('cookie', cookieB).expect(404)
    await http().get(`/v1/carteira/clientes/${ids.clienteA}/indicadores`).set('cookie', cookieB).expect(404)
    await http().patch(`/v1/carteira/clientes/${ids.clienteA}/metas/${metaCe2}`).set('cookie', cookieB).send({ titulo: 'x' }).expect(404)
    await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/metas/lancamento-semanal`)
      .set('cookie', cookieB)
      .send({ semana: '2026-11-02', valores: [{ metaId: metaCe2, valorInteiro: '1' }] })
      .expect(404)
    // Meta do A pela rota do B (cliente certo para B, meta de outro): também 404.
    await http()
      .post(`/v1/carteira/clientes/${ids.clienteB}/metas/lancamento-semanal`)
      .set('cookie', cookieB)
      .send({ semana: '2026-11-02', valores: [{ metaId: metaCe2, valorInteiro: '1' }] })
      .expect(404)
    const painel = await http().get('/v1/carteira/metas/painel').set('cookie', cookieB).expect(200)
    const nomes = JSON.stringify(painel.body)
    expect(nomes.includes(ids.clienteA)).toBe(false)
    expect(nomes.includes(ids.clienteA2)).toBe(false)
  })
})

describe('M1 — painel de metas', () => {
  it('contagens, a pior meta primeiro, e "sem metas definidas"', async () => {
    const r = await http().get('/v1/carteira/metas/painel').set('cookie', cookieA).expect(200)
    const a = (r.body.clientes as { id: string; metas: MetaNaResposta[]; podeLancar: boolean }[]).find((x) => x.id === ids.clienteA)!
    expect(a.podeLancar).toBe(true)
    const pesos = { prazo_vencido: 0, abaixo_do_ritmo: 1, atencao: 2, sem_lancamento: 3, no_ritmo: 4, atingida: 5, na_meta: 5 } as Record<string, number>
    const ordem = a.metas.map((m) => pesos[m.avaliacao.detalhe]!)
    expect([...ordem].sort((x, y) => x - y)).toEqual(ordem)
    const total = Object.values(r.body.contagens as Record<string, number>).reduce((s, n) => s + n, 0)
    expect(total).toBe(a.metas.length)
    expect((r.body.semMeta as { id: string }[]).map((x) => x.id)).toContain(ids.clienteA2)
  })
})

describe('M4 — combinados e tarefa da reunião de metas', () => {
  it('os combinados viram UMA reunião (mesma chave, dois envios) e a tarefa é concluída', async () => {
    const tarefa = await um(
      `INSERT INTO tarefas_internas (titulo, grupo_id, cliente_carteira_id, prazo) VALUES ('Reunião de metas', $1, $2, '2026-11-02') RETURNING id`,
      [ids.grupoA, ids.clienteA],
    )
    const chave = randomUUID()
    const corpo = {
      semana: '2026-10-26',
      valores: [{ metaId: metaCe2, valorInteiro: '7' }],
      combinados: 'Ligar para as faltas de terça.',
      tarefaInternaId: tarefa,
      chaveIdempotencia: chave,
    }
    const um1 = await http().post(`/v1/carteira/clientes/${ids.clienteA}/metas/lancamento-semanal`).set('cookie', cookieA).send(corpo).expect(200)
    const um2 = await http().post(`/v1/carteira/clientes/${ids.clienteA}/metas/lancamento-semanal`).set('cookie', cookieA).send(corpo).expect(200)
    expect(um1.body.tarefaConcluida).toBe(true)
    expect(um2.body.reuniaoId).toBe(um1.body.reuniaoId)
    const atas = await migrate.query<{ resumo: string; tipo: string; data: string }>(
      `SELECT resumo, tipo, data::text FROM reunioes_comerciais WHERE cliente_carteira_id = $1`,
      [ids.clienteA],
    )
    expect(atas.rows).toEqual([{ resumo: 'Reunião de metas: Ligar para as faltas de terça.', tipo: 'semanal', data: '2026-11-05' }])
    const t = await migrate.query<{ status: string }>('SELECT status FROM tarefas_internas WHERE id = $1', [tarefa])
    expect(t.rows[0]!.status).toBe('concluida')
  })
})

describe('V10 — indicadores manuais', () => {
  it('lançar a semana de todos de uma vez, três vezes: uma linha por indicador; variação contra a segunda anterior', async () => {
    const criado = await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/indicadores`)
      .set('cookie', cookieA)
      .send({ nome: 'Agendamentos', unidade: 'un', sentido: 'maior_melhor', valorMetaInteiro: '10' })
      .expect(201)
    const ind = criado.body.indicador.id as string
    for (let k = 0; k < 3; k++) {
      await http()
        .post(`/v1/carteira/clientes/${ids.clienteA}/lancamentos`)
        .set('cookie', cookieA)
        .send({ referencia: '2026-10-26', valores: [{ indicadorId: ind, valorInteiro: '8' }] })
        .expect(200)
      await http()
        .post(`/v1/carteira/clientes/${ids.clienteA}/lancamentos`)
        .set('cookie', cookieA)
        .send({ referencia: '2026-11-02', valores: [{ indicadorId: ind, valorInteiro: '12' }] })
        .expect(200)
    }
    const n = await migrate.query('SELECT 1 FROM lancamentos_de_indicador WHERE indicador_id = $1', [ind])
    expect(n.rowCount).toBe(2)
    const r = await http().get(`/v1/carteira/clientes/${ids.clienteA}/indicadores`).set('cookie', cookieA).expect(200)
    expect(r.body.semanaAtual).toBe('2026-11-02')
    const c = (r.body.indicadores as { id: string; naMeta: boolean; variacaoEmDecimos: number; valorMetaInteiro: string; serie: unknown[] }[]).find(
      (x) => x.id === ind,
    )!
    expect(c).toMatchObject({ naMeta: true, variacaoEmDecimos: 500, valorMetaInteiro: '10' })
    expect(c.serie).toHaveLength(2)
  })
})

describe('V8 — Ação do plano', () => {
  let acao = ''
  it('cria, lista com "atrasada" derivada, conclui pelo check, reabre e arquiva — com trilha por ator', async () => {
    const r = await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/acoes-do-plano`)
      .set('cookie', cookieA)
      .send({
        titulo: 'Roteiro de confirmação na recepção',
        tipo: 'plano',
        metaId: metaCe2,
        quemExecuta: 'firmare',
        acompanhamentoUsuarioGestaoId: ids.doA,
        prazo: '2026-11-01',
        status: 'pendente',
        descricao: null,
      })
      .expect(201)
    acao = r.body.acao.id
    expect(r.body.acao).toMatchObject({ atrasada: true, diasDeAtraso: 4, metaTitulo: 'Avaliações no mês', acompanhamentoNome: `doa.${sufixo}` })

    const m = (await metasDe(cookieA, ids.clienteA)).find((x) => x.id === metaCe2)!
    expect(m.acoes).toEqual({ concluidas: 0, total: 1 })

    const feita = await http().post(`/v1/carteira/clientes/${ids.clienteA}/acoes-do-plano/${acao}/alternar`).set('cookie', cookieA).expect(200)
    expect(feita.body.acao).toMatchObject({ status: 'concluida', atrasada: false })
    expect(feita.body.acao.concluidaEm).not.toBeNull()
    const reaberta = await http().post(`/v1/carteira/clientes/${ids.clienteA}/acoes-do-plano/${acao}/alternar`).set('cookie', cookieA).expect(200)
    expect(reaberta.body.acao).toMatchObject({ status: 'pendente', concluidaEm: null })

    const editada = await http()
      .patch(`/v1/carteira/clientes/${ids.clienteA}/acoes-do-plano/${acao}`)
      .set('cookie', cookieA)
      .send({ prazo: '2026-11-20', status: 'em_andamento' })
      .expect(200)
    expect(editada.body.acao).toMatchObject({ prazo: '2026-11-20', status: 'em_andamento', atrasada: false, titulo: 'Roteiro de confirmação na recepção' })

    const trilha = await migrate.query<{ ator_tipo: string; ator_id: string; acao: string }>(
      `SELECT ator_tipo, ator_id, acao FROM auditoria_do_painel WHERE entidade = 'acoes_do_plano' AND entidade_id = $1 ORDER BY id`,
      [acao],
    )
    expect(trilha.rows.length).toBe(4)
    expect(trilha.rows.every((t) => t.ator_tipo === 'usuario_gestao' && t.ator_id === ids.doA)).toBe(true)

    await http().post(`/v1/carteira/clientes/${ids.clienteA}/acoes-do-plano/${acao}/arquivar`).set('cookie', cookieA).expect(204)
    const lista = await http().get(`/v1/carteira/clientes/${ids.clienteA}/acoes-do-plano`).set('cookie', cookieA).expect(200)
    expect((lista.body.acoes as { id: string }[]).some((x) => x.id === acao)).toBe(false)
    const ainda = await migrate.query('SELECT 1 FROM acoes_do_plano WHERE id = $1 AND arquivada_em IS NOT NULL', [acao])
    expect(ainda.rowCount).toBe(1) // regra 20: arquivar, nunca apagar
  })

  it('meta de outra cliente, ou acompanhamento de outro grupo: 400; o grupo B não vê nem cria: 404', async () => {
    const metaDoB = await um(
      `INSERT INTO metas_comerciais (cliente_carteira_id, grupo_id, indicador_id, titulo, sentido, valor_meta_inteiro, inicio, prazo)
       SELECT $1, $2, id, 'Meta do B', 'maior_melhor', 1, '2026-11-01', '2026-12-01' FROM indicadores_carteira WHERE cliente_carteira_id = $1 LIMIT 1
       RETURNING id`,
      [ids.clienteB, ids.grupoB],
    )
    const base = { titulo: 'Ação', tipo: 'comercial', quemExecuta: 'cliente', prazo: null, status: 'pendente', descricao: null }
    const r1 = await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/acoes-do-plano`)
      .set('cookie', cookieGeral)
      .send({ ...base, metaId: metaDoB, acompanhamentoUsuarioGestaoId: null })
      .expect(400)
    expect(r1.body.codigo).toBe('META_INVALIDA')
    const r2 = await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/acoes-do-plano`)
      .set('cookie', cookieGeral)
      .send({ ...base, metaId: null, acompanhamentoUsuarioGestaoId: ids.doB })
      .expect(400)
    expect(r2.body.codigo).toBe('RESPONSAVEL_INVALIDO')
    await http().get(`/v1/carteira/clientes/${ids.clienteA}/acoes-do-plano`).set('cookie', cookieB).expect(404)
    await http()
      .post(`/v1/carteira/clientes/${ids.clienteA}/acoes-do-plano`)
      .set('cookie', cookieB)
      .send({ ...base, metaId: null, acompanhamentoUsuarioGestaoId: null })
      .expect(404)
    await http().post(`/v1/carteira/clientes/${ids.clienteA}/acoes-do-plano/${acao}/alternar`).set('cookie', cookieB).expect(404)
  })
})
