import { type CelulaDaPlanilha, RelogioFixo, diasEntre } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { BancoService } from '../../banco/banco.service'
import {
  apagarClinicaDeTeste,
  apagarHistoricoGrupoDeTeste,
  declararAtorSistema,
  participarDoGrupoDeTeste,
} from '../../banco/limpeza-de-teste'
import { RELOGIO } from '../../comum/relogio'
import { registrarCookie } from '../../main'
import { LeituraDePlanilhas } from './ler-planilhas'
import { LeitorDePlanilhaEmMemoria } from './leitor-de-planilha-em-memoria'
import { PEDIDO_DE_LEITURA_DA_PLANILHA, type PedidoDeLeituraDaPlanilha } from './planilhas-carteira.service'

/**
 * **A PLANILHA DE INDICADORES, contra Postgres real e pela HTTP** (ticket 4A).
 *
 * O Google não entra: o worker é exercitado com `LeitorDePlanilhaEmMemoria`
 * (a fixture do seam), e o "Ler planilha agora" com um registro no lugar da
 * fila. O resto é de verdade — RLS por grupo, índice único global, trilha,
 * redação de valores.
 *
 * Clientes SEM `status` (ficam `onboarding`): nenhum job de outro arquivo
 * os varre.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const SENHA = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')
const novoId = (): string => `1Teste${randomBytes(16).toString('hex')}`

// Quarta-feira, 11/11/2026, 15:00 na Bahia. "Semana passada" = a de 02/11.
const AGORA = new Date('2026-11-11T18:00:00Z')
const REF = '2026-11-02'

/** Uma chave privada que NÃO pode aparecer em resposta nenhuma. */
const PEM = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const EMAIL_DA_CONTA = `fir-planilhas@teste-${sufixo}.iam.gserviceaccount.com`

class PedidosRegistrados implements PedidoDeLeituraDaPlanilha {
  readonly pedidos: string[] = []
  async pedir(clienteCarteiraId: string): Promise<void> {
    this.pedidos.push(clienteCarteiraId)
  }
}

let app: NestFastifyApplication
let migrate: pg.Client
let banco: BancoService
const pedidos = new PedidosRegistrados()
const clinicas: string[] = []
const ids = { grupoA: '', grupoB: '', clienteA: '', clienteA2: '', clienteB: '', geral: '', usuarioA: '' }
let cookieGeral = ''
let cookieA = ''

const http = () => request(app.getHttpServer())
const entrar = async (usuario: string): Promise<string> => {
  const r = await http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA }).expect(200)
  const v = r.headers['set-cookie'] as unknown
  const lista = Array.isArray(v) ? (v as string[]) : [String(v)]
  return lista.map((c) => c.split(';')[0]!).join('; ')
}

beforeAll(async () => {
  process.env['GOOGLE_SA_JSON'] = JSON.stringify({ client_email: EMAIL_DA_CONTA, private_key: PEM })
  process.env['GOOGLE_SA_EMAIL'] = EMAIL_DA_CONTA
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  const um = async (sql: string, p: unknown[]): Promise<string> => (await migrate.query<{ id: string }>(sql, p)).rows[0]!.id

  ids.grupoA = await um('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`Planilhas A ${sufixo}`])
  ids.grupoB = await um('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`Planilhas B ${sufixo}`])
  // Um Cliente Firmare por clínica (UNIQUE em clientes_carteira.clinica_id).
  const cliente = async (grupo: string) => {
    const clinica = await um('INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id', [
      `planilhas-${sufixo}-${clinicas.length}`,
      'Clínica',
    ])
    clinicas.push(clinica)
    await participarDoGrupoDeTeste(migrate, clinica, grupo)
    return um(`INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto) VALUES ($1, $2, 'Cliente', 'Consultoria') RETURNING id`, [
      grupo,
      clinica,
    ])
  }
  ids.clienteA = await cliente(ids.grupoA)
  ids.clienteA2 = await cliente(ids.grupoA)
  ids.clienteB = await cliente(ids.grupoB)
  const hash = await hashDeSenha(SENHA)
  ids.geral = await um(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, 'Firmare', $2, 'geral', NULL) RETURNING id`,
    [`geral.${sufixo}`, hash],
  )
  ids.usuarioA = await um(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, 'Rede A', $2, 'grupo', $3) RETURNING id`,
    [`grupoa.${sufixo}`, hash, ids.grupoA],
  )

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PEDIDO_DE_LEITURA_DA_PLANILHA)
    .useValue(pedidos)
    .overrideProvider(RELOGIO)
    .useValue(new RelogioFixo(AGORA))
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  banco = new BancoService()
  cookieGeral = await entrar(`geral.${sufixo}`)
  cookieA = await entrar(`grupoa.${sufixo}`)
})

afterAll(async () => {
  delete process.env['GOOGLE_SA_JSON']
  delete process.env['GOOGLE_SA_EMAIL']
  await declararAtorSistema(migrate)
  const clientes = [ids.clienteA, ids.clienteA2, ids.clienteB].filter(Boolean)
  const usuarios = [ids.geral, ids.usuarioA].filter(Boolean)
  const grupos = [ids.grupoA, ids.grupoB].filter(Boolean)
  await migrate.query('DELETE FROM planilhas_do_cliente WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM auditoria_da_carteira WHERE grupo_id = ANY($1)', [grupos])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [usuarios])
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador = ANY($1)', [[`geral.${sufixo}`, `grupoa.${sufixo}`]])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [usuarios])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [clientes])
  for (const c of clinicas) await apagarHistoricoGrupoDeTeste(migrate, c)
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [grupos])
  for (const c of clinicas) await apagarClinicaDeTeste(migrate, c)
  await migrate.end()
  await banco.onModuleDestroy()
  await app.close()
})

const link = (id: string, resto = '/edit#gid=0') => `https://docs.google.com/spreadsheets/d/${id}${resto}`
const ID_A = novoId()

describe('PUT /v1/carteira/clientes/:id/planilha (A-16)', () => {
  it('a equipe de escopo geral grava; a trilha guarda o de→para do id', async () => {
    const r = await http()
      .put(`/v1/carteira/clientes/${ids.clienteA}/planilha`)
      .set('cookie', cookieGeral)
      .send({ link: link(ID_A) })
      .expect(200)
    expect(r.body).toEqual({ link: link(ID_A), trocou: true })
    const linha = await migrate.query<{ spreadsheet_id: string; grupo_id: string }>(
      'SELECT spreadsheet_id, grupo_id FROM planilhas_do_cliente WHERE cliente_carteira_id = $1',
      [ids.clienteA],
    )
    expect(linha.rows).toEqual([{ spreadsheet_id: ID_A, grupo_id: ids.grupoA }])
    const trilha = await migrate.query<{ acao: string; usuario_gestao_id: string; para: { spreadsheet_id: string } }>(
      `SELECT acao, usuario_gestao_id, para FROM auditoria_da_carteira WHERE tabela = 'planilhas_do_cliente' AND grupo_id = $1`,
      [ids.grupoA],
    )
    expect(trilha.rows).toEqual([{ acao: 'criar', usuario_gestao_id: ids.geral, para: { spreadsheet_id: ID_A, link: link(ID_A) } }])
  })

  it('regravar o mesmo link não cria linha nem trilha nova (idempotente)', async () => {
    const r = await http()
      .put(`/v1/carteira/clientes/${ids.clienteA}/planilha`)
      .set('cookie', cookieGeral)
      .send({ link: link(ID_A) })
      .expect(200)
    expect(r.body.trocou).toBe(false)
    const n = await migrate.query(`SELECT 1 FROM auditoria_da_carteira WHERE tabela = 'planilhas_do_cliente' AND grupo_id = $1`, [
      ids.grupoA,
    ])
    expect(n.rowCount).toBe(1)
  })

  it('o usuário de escopo grupo NÃO grava o link (deputado confuso; nega por padrão até a 0.5)', async () => {
    await http()
      .put(`/v1/carteira/clientes/${ids.clienteA2}/planilha`)
      .set('cookie', cookieA)
      .send({ link: link(novoId()) })
      .expect(403)
  })

  it('o MESMO id em outro cliente é recusado — de outro grupo e do mesmo grupo', async () => {
    const outroGrupo = await http()
      .put(`/v1/carteira/clientes/${ids.clienteB}/planilha`)
      .set('cookie', cookieGeral)
      .send({ link: link(ID_A, '/edit?usp=sharing') })
      .expect(409)
    expect(outroGrupo.body.message).toBe('Esta planilha já está ligada a outro cliente.')
    await http()
      .put(`/v1/carteira/clientes/${ids.clienteA2}/planilha`)
      .set('cookie', cookieGeral)
      .send({ link: link(ID_A) })
      .expect(409)
    const b = await migrate.query('SELECT 1 FROM planilhas_do_cliente WHERE cliente_carteira_id = ANY($1)', [
      [ids.clienteB, ids.clienteA2],
    ])
    expect(b.rowCount).toBe(0)
  })

  it('link com host diferente de docs.google.com, http ou sem id é 400 — e nada é gravado', async () => {
    for (const ruim of [
      `https://docs.google.com.evil.example/spreadsheets/d/${novoId()}`,
      `http://docs.google.com/spreadsheets/d/${novoId()}`,
      `https://169.254.169.254/spreadsheets/d/${novoId()}`,
      'https://docs.google.com/spreadsheets/d/curto',
    ]) {
      await http().put(`/v1/carteira/clientes/${ids.clienteA2}/planilha`).set('cookie', cookieGeral).send({ link: ruim }).expect(400)
    }
    const n = await migrate.query('SELECT 1 FROM planilhas_do_cliente WHERE cliente_carteira_id = $1', [ids.clienteA2])
    expect(n.rowCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// A leitura (o worker, com a fixture do seam) e a situação
// ---------------------------------------------------------------------------

const serie = (dia: string): CelulaDaPlanilha => ({ numeroDecimal: `${diasEntre('1899-12-30', dia)}.5` })
const n = (x: number): CelulaDaPlanilha => ({ numeroDecimal: String(x) })
const segundaSeguinte = (semana: string) => {
  const d = new Date(`${semana}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 7)
  return d.toISOString().slice(0, 10)
}
const SEMANAS = ['2026-10-12', '2026-10-19', '2026-10-26', REF]

const planilhaDeTeste = [
  {
    titulo: 'Financeiro',
    linhas: [
      ['Carimbo de data/hora', 'Faturamento da semana (R$)', 'Valor recebido (R$)', 'Despesas pagas (R$)', 'Análise estratégica'],
      ...SEMANAS.map((s) => [serie(segundaSeguinte(s)), n(42000.5), '38.000,00', n(25000), 'Semana boa, Dra. Fulana atendeu muito']),
    ],
  },
  {
    titulo: 'COMERCIAL',
    linhas: [
      ['Carimbo de data/hora', 'Endereço de e-mail', 'Quantos leads chegaram do site?', 'Quantos leads chegaram do google?', 'Quantos leads chegaram do Instagram?', 'Leads do site convertidos', 'Leads do google convertidos', 'Leads do Instagram convertidos', 'Leads frios ou fora de perfil'],
      ...SEMANAS.map((s) => [serie(segundaSeguinte(s)), 'parceiro@exemplo.com', n(28), n(7), n(9), n(3), n(1), n(1), n(9)]),
    ],
  },
  // Tráfego pago: sem linha da semana de referência ("não recebida").
  {
    titulo: 'Tráfego pago',
    linhas: [
      ['Carimbo de data/hora', 'Quantas campanhas rodaram na semana?', 'Dados da campanha do Google', 'Dados da campanha do Meta'],
      [serie(segundaSeguinte('2026-10-19')), n(3), 'Investimento R$ 620', 'Investimento R$ 900'],
    ],
  },
  { titulo: 'Instruções', linhas: [['Leia antes']] },
]

describe('a leitura e GET /v1/carteira/clientes/:id/planilha', () => {
  const leitor = new LeitorDePlanilhaEmMemoria().com(ID_A, planilhaDeTeste)

  it('o worker lê; reler grava o MESMO resultado na MESMA linha', async () => {
    const leitura = new LeituraDePlanilhas(banco, leitor, new RelogioFixo(AGORA))
    expect(await leitura.lerCliente(ids.clienteA)).toEqual({ tipo: 'lida' })
    const antes = await migrate.query<{ resultado: unknown }>('SELECT resultado FROM planilhas_do_cliente WHERE cliente_carteira_id = $1', [
      ids.clienteA,
    ])
    for (let i = 0; i < 3; i++) await leitura.lerCliente(ids.clienteA)
    const depois = await migrate.query<{ resultado: unknown }>('SELECT resultado FROM planilhas_do_cliente WHERE cliente_carteira_id = $1', [
      ids.clienteA,
    ])
    expect(depois.rows).toHaveLength(1)
    expect(depois.rows[0]!.resultado).toEqual(antes.rows[0]!.resultado)
    // Nada de texto livre nem coluna fora da especificação no que foi guardado.
    const guardado = JSON.stringify(depois.rows[0]!.resultado)
    expect(guardado).not.toContain('Fulana')
    expect(guardado).not.toContain('parceiro@exemplo.com')
    expect(guardado).not.toContain('Investimento')
    expect(leitor.lidas.every((x) => x === ID_A)).toBe(true)
  })

  it('a situação por frente: completa, não recebida, aba ausente; dinheiro redigido, contagem não', async () => {
    const r = await http().get(`/v1/carteira/clientes/${ids.clienteA}/planilha`).set('cookie', cookieA).expect(200)
    const corpo = r.body as {
      planilha: { link: string; lidaEm: string; erro: string | null }
      emailDaContaDeServico: string
      semanaDeReferencia: string
      semanas: string[]
      frentes: {
        frente: string
        abaEncontrada: string | null
        situacao: { status: string; envio: { preenchidas: number; total: number } | null }
        historico: { status: string }[]
        metricas: { chave: string; ultimo: { leitura: Record<string, string | null> } | null; media: Record<string, string | null> | null }[]
      }[]
    }
    expect(corpo.semanaDeReferencia).toBe(REF)
    // O hoje e o fuso da carteira vêm do servidor: a tela escreve "lida hoje às 15:00" sem relógio próprio.
    expect(r.body).toMatchObject({ hoje: '2026-11-11', fuso: 'America/Bahia' })
    expect(corpo.semanas).toHaveLength(8)
    expect(corpo.planilha).toMatchObject({ link: link(ID_A), lidaEm: AGORA.toISOString(), erro: null })
    expect(corpo.emailDaContaDeServico).toBe(EMAIL_DA_CONTA)
    const frente = (f: string) => corpo.frentes.find((x) => x.frente === f)!

    expect(frente('comercial')).toMatchObject({ abaEncontrada: 'COMERCIAL', situacao: { status: 'ok' } })
    // A pergunta opcional "Análise" não está no formulário: 7 de 8 respondidas, e ainda é "completa".
    expect(frente('comercial').situacao.envio).toEqual({ carimbo: expect.any(String), preenchidas: 7, total: 8 })
    expect(frente('trafego').situacao.status).toBe('pendente')
    expect(frente('marketing')).toMatchObject({ abaEncontrada: null, situacao: { status: 'atencao' } })
    expect(frente('comercial').historico.slice(-4).map((h) => h.status)).toEqual(['ok', 'ok', 'ok', 'ok'])

    const leads = frente('comercial').metricas.find((m) => m.chave === 'leads_recebidos')!
    expect(leads.ultimo!.leitura).toEqual({ valor: null, quantidadeEmDecimos: '440', percentualEmDecimos: null })
    const taxa = frente('comercial').metricas.find((m) => m.chave === 'taxa_conversao')!
    expect(taxa.ultimo!.leitura.percentualEmDecimos).toBe('114')
    // Faturamento é dinheiro: sem a permissão `valores` (nenhum Usuário de Gestão a tem hoje), sai null.
    const fat = frente('financeiro').metricas.find((m) => m.chave === 'faturamento')!
    expect(fat.ultimo!.leitura).toEqual({ valor: null, quantidadeEmDecimos: null, percentualEmDecimos: null })
    expect(fat.media).toEqual({ valor: null, quantidadeEmDecimos: null, percentualEmDecimos: null })
    expect(JSON.stringify(corpo)).not.toContain('4200050')
  })

  it('a chave privada da conta de serviço não aparece em resposta nenhuma', async () => {
    const r = await http().get(`/v1/carteira/clientes/${ids.clienteA}/planilha`).set('cookie', cookieGeral).expect(200)
    const texto = JSON.stringify(r.body)
    expect(texto).not.toContain('PRIVATE KEY')
    expect(texto).not.toContain(PEM.split('\n')[1]!)
    expect(texto).not.toContain('private_key')
  })

  it('falha de leitura grava a frase do erro e MANTÉM a última leitura boa', async () => {
    const quebrado = new LeitorDePlanilhaEmMemoria().falhando(ID_A, 'sem_acesso')
    const res = await new LeituraDePlanilhas(banco, quebrado, new RelogioFixo(AGORA)).lerCliente(ids.clienteA)
    expect(res).toEqual({ tipo: 'erro', codigo: 'sem_acesso' })
    const r = await http().get(`/v1/carteira/clientes/${ids.clienteA}/planilha`).set('cookie', cookieA).expect(200)
    expect(r.body.planilha.erro).toMatch(/não tem acesso a esta planilha/)
    expect(r.body.frentes.find((f: { frente: string }) => f.frente === 'comercial').situacao.status).toBe('ok')
  })

  it('cliente sem planilha: planilha null, as quatro frentes "aba não encontrada"', async () => {
    const r = await http().get(`/v1/carteira/clientes/${ids.clienteA2}/planilha`).set('cookie', cookieA).expect(200)
    expect(r.body.planilha).toBeNull()
    expect(r.body.frentes).toHaveLength(4)
  })

  it('janela fora do conjunto é 400', async () => {
    await http().get(`/v1/carteira/clientes/${ids.clienteA}/planilha?semanas=7`).set('cookie', cookieA).expect(400)
    const r = await http().get(`/v1/carteira/clientes/${ids.clienteA}/planilha?semanas=13`).set('cookie', cookieA).expect(200)
    expect(r.body.semanas).toHaveLength(13)
  })
})

describe('isolamento por grupo', () => {
  it('o cliente de outro grupo é 404 em GET e em "ler agora", nunca 403', async () => {
    await http().get(`/v1/carteira/clientes/${ids.clienteB}/planilha`).set('cookie', cookieA).expect(404)
    await http().post(`/v1/carteira/clientes/${ids.clienteB}/planilha/ler`).set('cookie', cookieA).expect(404)
    await http().get('/v1/carteira/clientes/nao-e-uuid/planilha').set('cookie', cookieA).expect(404)
  })

  it('sem sessão de carteira, 404 (o guard não confirma que a rota existe)', async () => {
    await http().get(`/v1/carteira/clientes/${ids.clienteA}/planilha`).expect(404)
  })
})

describe('POST /v1/carteira/clientes/:id/planilha/ler', () => {
  it('enfileira (202) e recusa um segundo pedido no mesmo minuto (429)', async () => {
    const antes = pedidos.pedidos.length
    await http().post(`/v1/carteira/clientes/${ids.clienteA}/planilha/ler`).set('cookie', cookieA).expect(202)
    expect(pedidos.pedidos.slice(antes)).toEqual([ids.clienteA])
    await http().post(`/v1/carteira/clientes/${ids.clienteA}/planilha/ler`).set('cookie', cookieA).expect(429)
    expect(pedidos.pedidos.length).toBe(antes + 1)
  })

  it('sem planilha cadastrada, 409', async () => {
    await http().post(`/v1/carteira/clientes/${ids.clienteA2}/planilha/ler`).set('cookie', cookieA).expect(409)
  })
})
