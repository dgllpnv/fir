import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import {
  apagarClinicaDeTeste,
  apagarHistoricoGrupoDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'
import {
  FILHAS_DIRETAS_QUE_MUDAM_DE_GRUPO,
  NETAS_QUE_MUDAM_DE_GRUPO,
  TABELAS_COM_GRUPO_QUE_NAO_MUDAM,
} from './cadastro-do-cliente'

/**
 * **G8 0.4 — O CADASTRO DO `Cliente Firmare`, contra Postgres real e pela
 * API inteira** (`AppModule`: guards, `RedacaoInterceptor`, RLS).
 *
 * O que este arquivo prova, na ordem do ticket:
 *  - isolamento por grupo (GET/PATCH de outro grupo = 404 idêntico);
 *  - sem `valores`, escrever mensalidade/pagamento é 403 — e `null`
 *    reenviado não apaga a mensalidade guardada (appsec A-6);
 *  - cliente ATIVO sem clínica é aceito (D-22 item 4);
 *  - criar do zero: `escopo='grupo'` usa o grupo da sessão; `escopo='geral'`
 *    exige grupo válido; a mesma chave três vezes cria UM cliente (A-20);
 *  - invariante de grupo: cliente do grupo X não liga clínica do grupo Y (A-8);
 *  - troca de grupo só pelo Operador, com `historico_grupo_da_clinica` e as
 *    filhas indo junto (A-11 item 6);
 *  - LGPD: observação e telefone não vão para log nem para mensagem de erro;
 *    o portal não lê o cadastro interno.
 *
 * Clientes NUNCA `ativo` com mensalidade e vencimento ao mesmo tempo: o job
 * de cobrança de outro arquivo, rodando em paralelo, os varreria.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_CARTEIRA =
  process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')

let app: NestFastifyApplication
let migrate: pg.Client
let grupoA: string
let grupoB: string
let grupoC: string
let clinica: string
let clienteA: string
let clienteB: string
let operador: string
let ugA: string
let ugB: string
let ugGeral: string
let ugInativoA: string
let cookieA: string
let cookieB: string
let cookieGeral: string
let cookiePainel: string
const criados: string[] = []

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')
const http = () => request(app.getHttpServer())

const criarGrupo = async (nome: string): Promise<string> =>
  (await migrate.query<{ id: string }>('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [nome])).rows[0]!.id

const criarUg = async (usuario: string, escopo: 'grupo' | 'geral', grupo: string | null, ativo = true) =>
  (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id, ativo)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [usuario, `Pessoa ${usuario}`, await hashDeSenha(SENHA), escopo, grupo, ativo],
    )
  ).rows[0]!.id

const entrarNaCarteira = async (usuario: string): Promise<string> =>
  paresDe(cookies(await http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA }).expect(200)))

const mensalidadeNoBanco = async (id: string): Promise<string> =>
  (
    await migrate.query<{ m: string }>('SELECT mensalidade_centavos::text AS m FROM clientes_carteira WHERE id = $1', [
      id,
    ])
  ).rows[0]!.m

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  grupoA = await criarGrupo(`Cadastro A ${sufixo}`)
  grupoB = await criarGrupo(`Cadastro B ${sufixo}`)
  grupoC = await criarGrupo(`Cadastro C ${sufixo}`)
  clinica = (
    await migrate.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica do cadastro') RETURNING id`, [
      `cadastro-${sufixo}`,
    ])
  ).rows[0]!.id
  clienteA = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, mensalidade_centavos)
       VALUES ($1, $2, 'Cliente A do cadastro', 'Consultoria', 150000) RETURNING id`,
      [grupoA, clinica],
    )
  ).rows[0]!.id
  clienteB = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, nome, produto) VALUES ($1, 'Cliente B do cadastro', 'Projeto') RETURNING id`,
      [grupoB],
    )
  ).rows[0]!.id

  ugA = await criarUg(`cad.a.${sufixo}`, 'grupo', grupoA)
  ugB = await criarUg(`cad.b.${sufixo}`, 'grupo', grupoB)
  ugGeral = await criarUg(`cad.g.${sufixo}`, 'geral', null)
  ugInativoA = await criarUg(`cad.i.${sufixo}`, 'grupo', grupoA, false)
  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono', $2) RETURNING id`,
      [`dono.cad.${sufixo}`, await hashDeSenha(SENHA)],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  cookieA = await entrarNaCarteira(`cad.a.${sufixo}`)
  cookieB = await entrarNaCarteira(`cad.b.${sufixo}`)
  cookieGeral = await entrarNaCarteira(`cad.g.${sufixo}`)
  cookiePainel = paresDe(
    cookies(
      await http().post('/v1/superadmin/entrar').send({ usuario: `dono.cad.${sufixo}`, senha: SENHA }).expect(200),
    ),
  )
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const todos = [clienteA, clienteB, ...criados]
  const ugs = [ugA, ugB, ugGeral, ugInativoA]
  // O cliente B fica `onboarding` com mensalidade e vencimento (desde a 1F o
  // job diário cobra isso): a cobrança que o job — ou o teste do ajuste 6 —
  // gerar para ele, no grupo B deste arquivo, sai antes do cliente.
  await migrate.query('DELETE FROM beneficios_de_indicacao WHERE cliente_carteira_id = ANY($1)', [todos])
  await migrate.query('DELETE FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = ANY($1)', [todos])
  await migrate.query('DELETE FROM parceiros_do_cliente WHERE cliente_carteira_id = ANY($1)', [todos])
  await migrate.query('DELETE FROM reunioes_comerciais WHERE cliente_carteira_id = ANY($1)', [todos])
  await migrate.query(
    'DELETE FROM itens_de_tarefa_interna WHERE tarefa_interna_id IN (SELECT id FROM tarefas_internas WHERE cliente_carteira_id = ANY($1))',
    [todos],
  )
  await migrate.query('DELETE FROM tarefas_internas WHERE cliente_carteira_id = ANY($1)', [todos])
  await apagarHistoricoGrupoDeTeste(migrate, clinica)
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [todos])
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador LIKE $1', [`cad.%.${sufixo}`])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [ugs])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [ugs])
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB, grupoC]])
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [`dono.cad.${sufixo}`])
  await apagarOperadorDeTeste(migrate, operador)
  await migrate.end()
  await app.close()
})

describe('GET /v1/carteira/clientes/:id — isolamento por grupo', () => {
  it('o Usuário de Gestão do grupo lê o cadastro; mensalidade e pagamento saem null (sem valores)', async () => {
    const r = await http().get(`/v1/carteira/clientes/${clienteA}`).set('Cookie', cookieA).expect(200)
    expect(r.body.cliente).toMatchObject({ id: clienteA, grupoId: grupoA, clinicaId: clinica, nome: 'Cliente A do cadastro' })
    expect(r.body.cliente.mensalidade).toBeNull()
    expect(r.body.cliente.pagamentoDaMensalidade).toBeNull()
  })

  it('o de OUTRO grupo recebe o mesmo 404 de um id que não existe', async () => {
    const alheio = await http().get(`/v1/carteira/clientes/${clienteA}`).set('Cookie', cookieB).expect(404)
    const nenhum = await http().get(`/v1/carteira/clientes/${randomUUID()}`).set('Cookie', cookieB).expect(404)
    expect(alheio.body.message).toBe(nenhum.body.message)
    expect(JSON.stringify(alheio.body)).not.toContain('Cliente A')
  })

  it('o escopo geral lê qualquer grupo', async () => {
    await http().get(`/v1/carteira/clientes/${clienteB}`).set('Cookie', cookieGeral).expect(200)
  })
})

describe('PATCH /v1/carteira/clientes/:id — o cadastro', () => {
  it('grava os campos do protótipo, e só os que vieram', async () => {
    const r = await http()
      .patch(`/v1/carteira/clientes/${clienteA}`)
      .set('Cookie', cookieA)
      .send({
        segmento: 'Clínica médica',
        cidade: 'Camaçari',
        decisor: 'Dra. Teste',
        aniversarioDecisor: { dia: 29, mes: 2 },
        telefone: '(71) 90000-0001',
        email: 'decisora@exemplo.com',
        cnpj: '12.345.678/0001-90',
        areaFoco: 'Comercial',
        projeto: 'Gestão GA',
        pagador: 'Dr. Pagador',
        reuniaoFixa: { diaDaSemana: 2, hora: '10:00' },
        dataInicio: '2026-09-01',
        dataFim: '2027-01-31',
        servicos: ['semanal', 'dre'],
        responsavelId: ugA,
        observacoes: 'Foco em conversão.',
        parceiros: [
          { frente: 'financeiro', nome: 'Contábil X', whatsapp: '71988887777', linkFormulario: 'https://f.exemplo.com/x' },
        ],
      })
      .expect(200)
    expect(r.body.cliente).toMatchObject({
      segmento: 'Clínica médica',
      aniversarioDecisor: { dia: 29, mes: 2 },
      cnpj: '12345678000190',
      reuniaoFixa: { diaDaSemana: 2, hora: '10:00' },
      servicos: ['semanal', 'dre'],
      responsavelId: ugA,
      nome: 'Cliente A do cadastro',
      parceiros: [{ frente: 'financeiro', nome: 'Contábil X', whatsapp: '71988887777', linkFormulario: 'https://f.exemplo.com/x' }],
    })

    const parcial = await http()
      .patch(`/v1/carteira/clientes/${clienteA}`)
      .set('Cookie', cookieA)
      .send({ cidade: '' })
      .expect(200)
    expect(parcial.body.cliente.cidade).toBeNull()
    expect(parcial.body.cliente.segmento).toBe('Clínica médica')
  })

  it('a trilha grava o Usuário de Gestão como ator, na auditoria da clínica ligada', async () => {
    const t = await migrate.query<{ ator_tipo: string; ator_id: string }>(
      `SELECT ator_tipo, ator_id FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'clientes_carteira' ORDER BY em DESC, id DESC LIMIT 1`,
      [clinica],
    )
    expect(t.rows[0]).toEqual({ ator_tipo: 'usuario_gestao', ator_id: ugA })
    const p = await migrate.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auditoria_do_painel WHERE entidade = 'parceiros_do_cliente' AND ator_id = $1`,
      [ugA],
    )
    expect(p.rows[0]!.n).toBeGreaterThan(0)
  })

  it('a frente esvaziada elimina o parceiro; o reenvio igual não cria linha nova', async () => {
    const corpo = { parceiros: [{ frente: 'comercial', nome: 'Agência Y', whatsapp: null, linkFormulario: null }] }
    for (let i = 0; i < 3; i++) {
      await http().patch(`/v1/carteira/clientes/${clienteA}`).set('Cookie', cookieA).send(corpo).expect(200)
    }
    const n = await migrate.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM parceiros_do_cliente WHERE cliente_carteira_id = $1 AND frente = 'comercial'`,
      [clienteA],
    )
    expect(n.rows[0]!.n).toBe(1)

    const r = await http()
      .patch(`/v1/carteira/clientes/${clienteA}`)
      .set('Cookie', cookieA)
      .send({ parceiros: [{ frente: 'comercial', nome: '', whatsapp: null, linkFormulario: null }] })
      .expect(200)
    expect(r.body.cliente.parceiros.map((p: { frente: string }) => p.frente)).toEqual(['financeiro'])
  })

  it('o Usuário de Gestão de outro grupo não edita (404) e nada muda', async () => {
    await http().patch(`/v1/carteira/clientes/${clienteA}`).set('Cookie', cookieB).send({ nome: 'Invadido' }).expect(404)
    const r = await migrate.query<{ nome: string }>('SELECT nome FROM clientes_carteira WHERE id = $1', [clienteA])
    expect(r.rows[0]!.nome).toBe('Cliente A do cadastro')
  })

  it('responsável de outro grupo, ou desativado, é recusado (422)', async () => {
    await http().patch(`/v1/carteira/clientes/${clienteA}`).set('Cookie', cookieA).send({ responsavelId: ugB }).expect(422)
    await http()
      .patch(`/v1/carteira/clientes/${clienteA}`)
      .set('Cookie', cookieA)
      .send({ responsavelId: ugInativoA })
      .expect(422)
  })

  it('grupo e clínica não são campos do cadastro (400): só o Operador os muda', async () => {
    await http().patch(`/v1/carteira/clientes/${clienteA}`).set('Cookie', cookieA).send({ grupoId: grupoB }).expect(400)
    await http().patch(`/v1/carteira/clientes/${clienteA}`).set('Cookie', cookieA).send({ clinicaId: clinica }).expect(400)
  })

  it('cliente ATIVO sem clínica é aceito (D-22 item 4)', async () => {
    const r = await http()
      .patch(`/v1/carteira/clientes/${clienteB}`)
      .set('Cookie', cookieB)
      .send({ status: 'ativo' })
      .expect(200)
    expect(r.body.cliente).toMatchObject({ status: 'ativo', clinicaId: null })
    await http().patch(`/v1/carteira/clientes/${clienteB}`).set('Cookie', cookieB).send({ status: 'onboarding' }).expect(200)
  })
})

describe('valores (appsec A-6): sem a permissão, nem escreve nem apaga', () => {
  it('mensalidade no corpo é 403, e nada é gravado', async () => {
    await http()
      .patch(`/v1/carteira/clientes/${clienteA}`)
      .set('Cookie', cookieA)
      .send({ mensalidade: '1', nome: 'Não deveria' })
      .expect(403)
    expect(await mensalidadeNoBanco(clienteA)).toBe('150000')
    const n = await migrate.query<{ nome: string }>('SELECT nome FROM clientes_carteira WHERE id = $1', [clienteA])
    expect(n.rows[0]!.nome).toBe('Cliente A do cadastro')
  })

  it('o null REENVIADO pelo formulário (que recebeu o campo redigido) não apaga a mensalidade', async () => {
    const lido = await http().get(`/v1/carteira/clientes/${clienteA}`).set('Cookie', cookieA).expect(200)
    // O formulário ingênuo devolve o objeto inteiro, com os campos redigidos.
    await http()
      .patch(`/v1/carteira/clientes/${clienteA}`)
      .set('Cookie', cookieA)
      .send({ nome: lido.body.cliente.nome, mensalidade: lido.body.cliente.mensalidade })
      .expect(403)
    await http()
      .patch(`/v1/carteira/clientes/${clienteA}`)
      .set('Cookie', cookieA)
      .send({ pagamentoDaMensalidade: null })
      .expect(403)
    expect(await mensalidadeNoBanco(clienteA)).toBe('150000')
  })

  it('nem o escopo geral escreve valor pela carteira enquanto a chave não existe (ticket 0.5)', async () => {
    await http()
      .patch(`/v1/carteira/clientes/${clienteB}`)
      .set('Cookie', cookieGeral)
      .send({ pagamentoDaMensalidade: { diaVencimento: 10, telefoneCobranca: null } })
      .expect(403)
  })
})

describe('POST /v1/carteira/clientes — criar do zero, sem clínica', () => {
  it('escopo grupo usa o grupo da SESSÃO; a mesma chave três vezes cria UM cliente (A-20)', async () => {
    const chave = randomUUID()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = await http()
        .post('/v1/carteira/clientes')
        .set('Cookie', cookieA)
        .send({ chaveDeCriacao: chave, nome: `Novo ${sufixo}`, produto: 'Projeto', status: 'ativo' })
        .expect(201)
      ids.push(r.body.cliente.id)
      expect(r.body.cliente).toMatchObject({ grupoId: grupoA, clinicaId: null, status: 'ativo' })
    }
    criados.push(ids[0]!)
    expect(new Set(ids).size).toBe(1)
    const n = await migrate.query<{ n: number }>('SELECT count(*)::int AS n FROM clientes_carteira WHERE chave_de_criacao = $1', [
      chave,
    ])
    expect(n.rows[0]!.n).toBe(1)
    const trilha = await migrate.query<{ ator_tipo: string; ator_id: string }>(
      `SELECT ator_tipo, ator_id FROM auditoria_do_painel
        WHERE entidade = 'clientes_carteira' AND entidade_id = $1 AND acao = 'criou'`,
      [ids[0]],
    )
    expect(trilha.rows).toEqual([{ ator_tipo: 'usuario_gestao', ator_id: ugA }])
  })

  it('escopo grupo pedindo OUTRO grupo é recusado (403), e nada nasce', async () => {
    const chave = randomUUID()
    await http()
      .post('/v1/carteira/clientes')
      .set('Cookie', cookieA)
      .send({ chaveDeCriacao: chave, grupoId: grupoB, nome: 'Intruso', produto: 'Projeto' })
      .expect(403)
    const n = await migrate.query<{ n: number }>('SELECT count(*)::int AS n FROM clientes_carteira WHERE chave_de_criacao = $1', [
      chave,
    ])
    expect(n.rows[0]!.n).toBe(0)
  })

  it('escopo geral exige grupo válido: ausente ou inexistente é 422; existente cria nele', async () => {
    await http()
      .post('/v1/carteira/clientes')
      .set('Cookie', cookieGeral)
      .send({ chaveDeCriacao: randomUUID(), nome: 'Sem grupo', produto: 'Projeto' })
      .expect(422)
    await http()
      .post('/v1/carteira/clientes')
      .set('Cookie', cookieGeral)
      .send({ chaveDeCriacao: randomUUID(), grupoId: randomUUID(), nome: 'Grupo fantasma', produto: 'Projeto' })
      .expect(422)
    const r = await http()
      .post('/v1/carteira/clientes')
      .set('Cookie', cookieGeral)
      .send({ chaveDeCriacao: randomUUID(), grupoId: grupoB, nome: `No B ${sufixo}`, produto: 'Consultoria' })
      .expect(201)
    criados.push(r.body.cliente.id)
    expect(r.body.cliente.grupoId).toBe(grupoB)
  })

  it('a chave de um cliente de outro grupo não devolve o cliente alheio (409)', async () => {
    const chave = randomUUID()
    const r = await http()
      .post('/v1/carteira/clientes')
      .set('Cookie', cookieB)
      .send({ chaveDeCriacao: chave, nome: `Do B ${sufixo}`, produto: 'Projeto' })
      .expect(201)
    criados.push(r.body.cliente.id)
    const alheio = await http()
      .post('/v1/carteira/clientes')
      .set('Cookie', cookieA)
      .send({ chaveDeCriacao: chave, nome: 'Outro', produto: 'Projeto' })
      .expect(409)
    expect(JSON.stringify(alheio.body)).not.toContain(`Do B ${sufixo}`)
  })

  it('mensalidade na criação, sem valores, é 403', async () => {
    await http()
      .post('/v1/carteira/clientes')
      .set('Cookie', cookieA)
      .send({ chaveDeCriacao: randomUUID(), nome: 'Com valor', produto: 'Projeto', mensalidade: '100000' })
      .expect(403)
  })
})

describe('Operador — PATCH /v1/superadmin/clientes-carteira/:id', () => {
  it('a lista do painel mostra cada cliente com o grupo dele', async () => {
    const r = await http().get('/v1/superadmin/clientes-carteira').set('Cookie', cookiePainel).expect(200)
    const a = r.body.clientes.find((c: { id: string }) => c.id === clienteA)
    expect(a).toMatchObject({ grupoId: grupoA, clinicaId: clinica })
  })

  it('o Operador grava mensalidade e vencimento (centavos, sem float)', async () => {
    await http()
      .patch(`/v1/superadmin/clientes-carteira/${clienteB}`)
      .set('Cookie', cookiePainel)
      .send({ mensalidade: '185033', pagamentoDaMensalidade: { diaVencimento: 31, telefoneCobranca: null } })
      .expect(200)
    const r = await migrate.query<{ m: string; d: number }>(
      'SELECT mensalidade_centavos::text AS m, dia_vencimento AS d FROM clientes_carteira WHERE id = $1',
      [clienteB],
    )
    expect(r.rows[0]).toEqual({ m: '185033', d: 31 })
    await http()
      .patch(`/v1/superadmin/clientes-carteira/${clienteB}`)
      .set('Cookie', cookiePainel)
      .send({ pagamentoDaMensalidade: { diaVencimento: 32, telefoneCobranca: null } })
      .expect(400)
  })

  it('mudar o dia do vencimento de 10 para 31 reprograma a cobrança aberta de um mês de 30 dias para o dia 30 (ajuste 6, regra 25)', async () => {
    await http()
      .patch(`/v1/superadmin/clientes-carteira/${clienteB}`)
      .set('Cookie', cookiePainel)
      .send({ pagamentoDaMensalidade: { diaVencimento: 10, telefoneCobranca: null } })
      .expect(200)
    // Competências próprias deste teste: abril/2099 (30 dias) aberta, junho/2099
    // paga, e abril/2020 aberta mas PASSADA — só a primeira pode mudar.
    const inserir = (competencia: string, vencimento: string, pago: boolean) =>
      migrate.query<{ id: string }>(
        `INSERT INTO cobrancas_do_cliente_firmare
           (cliente_carteira_id, grupo_id, competencia, mensalidade_centavos, desconto_centavos, valor_centavos,
            vencimento, status, pago_em)
         VALUES ($1, $2, $3, 185033, 0, 185033, $4, $5, $6) RETURNING id`,
        [clienteB, grupoB, competencia, vencimento, pago ? 'pago' : 'aberto', pago ? new Date() : null],
      )
    const aberta = (await inserir('2099-04-01', '2099-04-10', false)).rows[0]!.id
    const paga = (await inserir('2099-06-01', '2099-06-10', true)).rows[0]!.id
    const passada = (await inserir('2020-04-01', '2020-04-10', false)).rows[0]!.id

    await http()
      .patch(`/v1/superadmin/clientes-carteira/${clienteB}`)
      .set('Cookie', cookiePainel)
      .send({ pagamentoDaMensalidade: { diaVencimento: 31, telefoneCobranca: null } })
      .expect(200)

    const v = await migrate.query<{ id: string; v: string; valor: string }>(
      `SELECT id, vencimento::text AS v, valor_centavos::text AS valor FROM cobrancas_do_cliente_firmare WHERE id = ANY($1)`,
      [[aberta, paga, passada]],
    )
    const por = Object.fromEntries(v.rows.map((x) => [x.id, x]))
    expect(por[aberta]).toEqual({ id: aberta, v: '2099-04-30', valor: '185033' })
    expect(por[paga]!.v).toBe('2099-06-10')
    expect(por[passada]!.v).toBe('2020-04-10')

    const trilha = await migrate.query<{ de: unknown; para: { vencimento: string } }>(
      `SELECT de, para FROM auditoria_do_painel WHERE entidade = 'cobrancas_do_cliente_firmare' AND entidade_id = $1`,
      [aberta],
    )
    expect(trilha.rows).toHaveLength(1)
    expect(trilha.rows[0]!.de).toEqual({ vencimento: '2099-04-10' })
    expect(trilha.rows[0]!.para.vencimento).toBe('2099-04-30')
  })

  it('mover de grupo: grava o histórico da clínica, leva as filhas e o portal cai', async () => {
    const reuniao = (
      await migrate.query<{ id: string }>(
        `INSERT INTO reunioes_comerciais (cliente_carteira_id, grupo_id, data, resumo, por_usuario_gestao_id)
         VALUES ($1, $2, '2026-10-01', 'Ata de teste', $3) RETURNING id`,
        [clienteA, grupoA, ugA],
      )
    ).rows[0]!.id
    // A tarefa do cliente e o item dela (0051): o item tira o grupo da TAREFA
    // por gatilho — mover precisa levá-lo também (0.5, achado do 2A).
    const tarefa = (
      await migrate.query<{ id: string }>(
        `INSERT INTO tarefas_internas (grupo_id, titulo, prazo, cliente_carteira_id)
         VALUES ($1, 'Tarefa do cliente', '2026-10-05', $2) RETURNING id`,
        [grupoA, clienteA],
      )
    ).rows[0]!.id
    const item = (
      await migrate.query<{ id: string }>(
        `INSERT INTO itens_de_tarefa_interna (tarefa_interna_id, ordem, rotulo) VALUES ($1, 1, 'Item') RETURNING id`,
        [tarefa],
      )
    ).rows[0]!.id

    const r = await http()
      .patch(`/v1/superadmin/clientes-carteira/${clienteA}`)
      .set('Cookie', cookiePainel)
      .send({ grupoId: grupoC, motivo: 'Entrou na rede C' })
      .expect(200)
    expect(r.body.cliente.grupoId).toBe(grupoC)

    const h = await migrate.query<{ grupo_anterior_id: string | null; grupo_novo_id: string; mudado_por: string; motivo: string }>(
      `SELECT grupo_anterior_id, grupo_novo_id, mudado_por, motivo FROM historico_grupo_da_clinica
        WHERE clinica_id = $1 ORDER BY mudado_em DESC, id DESC`,
      [clinica],
    )
    expect(h.rows[0]).toEqual({ grupo_anterior_id: null, grupo_novo_id: grupoC, mudado_por: operador, motivo: 'Entrou na rede C' })

    const filhas = await migrate.query<{ g: string }>(
      `SELECT grupo_id AS g FROM reunioes_comerciais WHERE id = $1
       UNION ALL SELECT grupo_id FROM parceiros_do_cliente WHERE cliente_carteira_id = $2
       UNION ALL SELECT grupo_id FROM tarefas_internas WHERE id = $3
       UNION ALL SELECT grupo_id FROM itens_de_tarefa_interna WHERE id = $4`,
      [reuniao, clienteA, tarefa, item],
    )
    expect(filhas.rows.length).toBeGreaterThan(3)
    expect(new Set(filhas.rows.map((x) => x.g))).toEqual(new Set([grupoC]))

    // O responsável do grupo A não serve ao grupo C: solto, nunca deixado inválido.
    const resp = await migrate.query<{ r: string | null }>(
      'SELECT responsavel_usuario_gestao_id AS r FROM clientes_carteira WHERE id = $1',
      [clienteA],
    )
    expect(resp.rows[0]!.r).toBeNull()

    // O grupo A deixou de ver o cliente.
    await http().get(`/v1/carteira/clientes/${clienteA}`).set('Cookie', cookieA).expect(404)
  })

  it('invariante de grupo (A-8): cliente do grupo X não liga clínica do grupo Y', async () => {
    // A clínica agora é do grupo C (histórico acima); o cliente B é do grupo B.
    await migrate.query('UPDATE clientes_carteira SET clinica_id = NULL WHERE id = $1', [clienteA])
    await http()
      .patch(`/v1/superadmin/clientes-carteira/${clienteB}`)
      .set('Cookie', cookiePainel)
      .send({ clinicaId: clinica })
      .expect(409)
    const r = await migrate.query<{ c: string | null }>('SELECT clinica_id AS c FROM clientes_carteira WHERE id = $1', [
      clienteB,
    ])
    expect(r.rows[0]!.c).toBeNull()

    // E o banco recusa por conta própria, se o service deixasse passar.
    await expect(
      migrate.query(`SELECT set_config('app.pessoa_id', 'operador:' || $1, false)`, [operador]).then(() =>
        migrate.query('UPDATE clientes_carteira SET clinica_id = $2 WHERE id = $1', [clienteB, clinica]),
      ),
    ).rejects.toThrow(/outro grupo/)
    await declararAtorSistema(migrate)
    await migrate.query('UPDATE clientes_carteira SET clinica_id = $2 WHERE id = $1', [clienteA, clinica])
  })

  it('o Usuário de Gestão não muda grupo nem clínica nem pelo banco (trigger, 42501)', async () => {
    const c = new pg.Client({ connectionString: URL_CARTEIRA })
    await c.connect()
    try {
      await c.query('BEGIN')
      await c.query(`SELECT set_config('app.pessoa_id', $1, true)`, [`usuario_gestao:${ugGeral}`])
      await c.query(`SELECT set_config('app.escopo', 'geral', true)`)
      await expect(c.query('UPDATE clientes_carteira SET grupo_id = $2 WHERE id = $1', [clienteB, grupoA])).rejects.toThrow(
        /só o Operador/,
      )
      await c.query('ROLLBACK')
    } finally {
      await c.end()
    }
  })
})

describe('LGPD — observações, telefone e o portal', () => {
  it('nenhum log do caminho de escrita contém observação nem telefone (A31, regra 21)', async () => {
    const escrito: string[] = []
    const originais = [process.stdout.write, process.stderr.write] as const
    const capturar = (texto: unknown): boolean => {
      escrito.push(String(texto))
      return true
    }
    process.stdout.write = capturar as typeof process.stdout.write
    process.stderr.write = capturar as typeof process.stderr.write
    try {
      await http()
        .patch(`/v1/carteira/clientes/${clienteB}`)
        .set('Cookie', cookieB)
        .send({ observacoes: 'Paciente Joana Segredo ligou', telefone: '(71) 97777-1234' })
      await http()
        .patch(`/v1/carteira/clientes/${clienteB}`)
        .set('Cookie', cookieB)
        .send({ observacoes: 'Joana Segredo de novo', areaFoco: 'NaoExiste', telefone: '(71) 97777-1234' })
    } finally {
      process.stdout.write = originais[0]
      process.stderr.write = originais[1]
    }
    const tudo = escrito.join('')
    expect(tudo).not.toContain('Joana Segredo')
    expect(tudo).not.toContain('97777-1234')
  })

  it('o 400 nomeia o campo, nunca ecoa o valor recebido', async () => {
    const r = await http()
      .patch(`/v1/carteira/clientes/${clienteB}`)
      .set('Cookie', cookieB)
      .send({ areaFoco: 'ValorSecreto123', observacoes: 'x'.repeat(2001) })
      .expect(400)
    expect(JSON.stringify(r.body)).not.toContain('ValorSecreto123')
    expect(JSON.stringify(r.body)).not.toContain('xxxxxxxxxx')
  })

  it('o portal não lê o cadastro interno: privilégio por coluna em clientes_carteira', async () => {
    const r = await migrate.query<{ tabela: boolean; nome: boolean; obs: boolean; pagador: boolean; tel: boolean }>(
      `SELECT has_table_privilege('fir_portal', 'clientes_carteira', 'SELECT') AS tabela,
              has_column_privilege('fir_portal', 'clientes_carteira', 'nome', 'SELECT') AS nome,
              has_column_privilege('fir_portal', 'clientes_carteira', 'observacoes', 'SELECT') AS obs,
              has_column_privilege('fir_portal', 'clientes_carteira', 'pagador', 'SELECT') AS pagador,
              has_column_privilege('fir_portal', 'clientes_carteira', 'telefone_cobranca', 'SELECT') AS tel`,
    )
    expect(r.rows[0]).toEqual({ tabela: false, nome: true, obs: false, pagador: false, tel: false })
    const p = await migrate.query<{ sel: boolean }>(
      `SELECT has_any_column_privilege('fir_portal', 'parceiros_do_cliente', 'SELECT') AS sel`,
    )
    expect(p.rows[0]!.sel).toBe(false)
  })
})

describe('mover de grupo cobre TODA tabela com grupo_id (varredura do catálogo)', () => {
  it('cada tabela com grupo_id muda explicitamente, muda por cascata, ou está na lista do que não muda', async () => {
    const comGrupo = await migrate.query<{ tabela: string }>(
      `SELECT c.relname AS tabela FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attname = 'grupo_id' AND NOT a.attisdropped`,
    )
    const explicitas = new Set<string>([
      ...FILHAS_DIRETAS_QUE_MUDAM_DE_GRUPO,
      ...NETAS_QUE_MUDAM_DE_GRUPO.map((n) => n.tabela),
    ])
    // Cascata: FK composta que inclui `grupo_id`, com ON UPDATE CASCADE, para
    // `clientes_carteira` ou para uma tabela que já muda.
    const cascata = await migrate.query<{ tabela: string; pai: string }>(
      `SELECT conrelid::regclass::text AS tabela, confrelid::regclass::text AS pai
         FROM pg_constraint
        WHERE contype = 'f' AND confupdtype = 'c' AND array_length(conkey, 1) > 1`,
    )
    const porCascata = new Set(
      cascata.rows.filter((x) => x.pai === 'clientes_carteira' || explicitas.has(x.pai)).map((x) => x.tabela),
    )
    const sobra = comGrupo.rows
      .map((x) => x.tabela)
      .filter((t) => !explicitas.has(t) && !porCascata.has(t) && !(t in TABELAS_COM_GRUPO_QUE_NAO_MUDAM))
    expect(
      sobra,
      'tabela com grupo_id que NÃO acompanha o cliente na troca de grupo — some à lista de ' +
        '`cadastro-do-cliente.ts`, ponha FK composta com ON UPDATE CASCADE, ou justifique em TABELAS_COM_GRUPO_QUE_NAO_MUDAM',
    ).toEqual([])
    expect(comGrupo.rows.length).toBeGreaterThan(10)
  })
})
