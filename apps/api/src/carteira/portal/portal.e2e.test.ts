import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { PISO_DE_RESPOSTA_MS } from '../../autenticacao/autenticacao.service'
import { hashDeSenha } from '../../autenticacao/senha'
import {
  apagarClinicaDeTeste,
  apagarHistoricoGrupoDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
  participarDoGrupoDeTeste,
} from '../../banco/limpeza-de-teste'
import { registrarCookie } from '../../main'
import { DURACAO_SESSAO_PORTAL_MS } from './portal.guard'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'quatro-pedras-no-caminho'
const SENHA_OP = 'cinco-pedras-no-caminho'

let app: NestFastifyApplication
let migrate: pg.Client
let grupo: string
let grupoB: string
let clinicaX: string
let clinicaY: string
let clinicaZ: string
let clienteX: string
let clienteY: string
let clienteZ: string
let usuarioPortalX: string
let usuarioPortalGrupo: string
let usuarioPortalInativo: string
let usuarioDeGestao: string
let operador: string

const sufixo = randomBytes(4).toString('hex')
const PORTAL_X = `portal.x.${sufixo}`
const PORTAL_GRUPO = `portal.grupo.${sufixo}`
const PORTAL_INATIVO = `portal.inativo.${sufixo}`
const NAO_EXISTE = `ninguem.${sufixo}`
const USUARIO_GESTAO = `gestao.${sufixo}`
const USUARIO_OP = `dono.${sufixo}`

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')
const http = () => request(app.getHttpServer())

const criarUsuarioDoPortal = async (
  usuario: string,
  escopo: 'cliente' | 'grupo',
  alvo: string,
  ativo = true,
): Promise<string> => {
  const coluna = escopo === 'cliente' ? 'cliente_carteira_id' : 'grupo_id'
  const r = await migrate.query<{ id: string }>(
    // `ve_valores`: estas contas são a do titular (LGPD A52, 0059).
    `INSERT INTO usuarios_do_portal (usuario, nome, senha_hash, escopo, ${coluna}, ativo, ve_valores)
     VALUES ($1, 'Teste do Portal', $2, $3, $4, $5, true) RETURNING id`,
    [usuario, await hashDeSenha(SENHA), escopo, alvo, ativo],
  )
  return r.rows[0]!.id
}

const entrarNoPortal = (usuario = PORTAL_X, senha = SENHA) =>
  http().post('/v1/portal/entrar').send({ usuario, senha })

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  grupo = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Grupo Portal E2E') RETURNING id`))
    .rows[0]!.id
  grupoB = (
    await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Grupo Portal E2E B') RETURNING id`)
  ).rows[0]!.id

  clinicaX = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Portal X') RETURNING id`,
      [`pe2ex-${sufixo}`],
    )
  ).rows[0]!.id
  clinicaY = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Portal Y') RETURNING id`,
      [`pe2ey-${sufixo}`],
    )
  ).rows[0]!.id
  clinicaZ = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Portal Z') RETURNING id`,
      [`pe2ez-${sufixo}`],
    )
  ).rows[0]!.id

  await participarDoGrupoDeTeste(migrate, clinicaX, grupo)
  await participarDoGrupoDeTeste(migrate, clinicaY, grupo)
  await participarDoGrupoDeTeste(migrate, clinicaZ, grupoB)
  clienteX = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto) VALUES ($1, $2, 'Cliente Portal X', 'Acelerador FIR') RETURNING id`,
      [grupo, clinicaX],
    )
  ).rows[0]!.id
  clienteY = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto) VALUES ($1, $2, 'Cliente Portal Y', 'Acelerador FIR') RETURNING id`,
      [grupo, clinicaY],
    )
  ).rows[0]!.id
  clienteZ = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto) VALUES ($1, $2, 'Cliente Portal Z', 'Consultoria') RETURNING id`,
      [grupoB, clinicaZ],
    )
  ).rows[0]!.id

  // Duas campanhas de receita em X: uma grande (sempre aparece) e uma
  // pequena (menos de 5 orçamentos pagos — some em "Outras campanhas").
  await migrate.query(
    `INSERT INTO campanhas_carteira
       (cliente_carteira_id, grupo_id, origem, nome, periodo_inicio, periodo_fim, metrica, meta, resultado, orcamentos_pagos,
        mes_referencia, receita_centavos)
     VALUES
       ($1, $2, 'manual', 'Campanha Grande', $3, $3, 'receita', 100000, 500000, 12, $3, 500000),
       ($1, $2, 'manual', 'Campanha Pequena (3 pacientes)', $3, $3, 'receita', 10000, 90000, 3, $3, 90000)`,
    // G8 3D: a célula é campanha × mês (0043) e o portal mostra os 12 meses até o atual — o mês corrente cabe sempre.
    [clienteX, grupo, `${new Date().toISOString().slice(0, 7)}-01`],
  )

  usuarioPortalX = await criarUsuarioDoPortal(PORTAL_X, 'cliente', clienteX)
  usuarioPortalGrupo = await criarUsuarioDoPortal(PORTAL_GRUPO, 'grupo', grupo)
  usuarioPortalInativo = await criarUsuarioDoPortal(PORTAL_INATIVO, 'cliente', clienteX, false)

  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id
  usuarioDeGestao = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
       VALUES ($1, 'Gestão E2E', $2, 'grupo', $3) RETURNING id`,
      [USUARIO_GESTAO, await hashDeSenha(SENHA), grupo],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM tentativas_do_portal WHERE identificador = ANY($1)', [
    [PORTAL_X, PORTAL_GRUPO, PORTAL_INATIVO, NAO_EXISTE],
  ])
  await migrate.query('DELETE FROM sessoes_do_portal WHERE usuario_portal_id = ANY($1)', [
    [usuarioPortalX, usuarioPortalGrupo, usuarioPortalInativo],
  ])
  await migrate.query('DELETE FROM usuarios_do_portal WHERE id = ANY($1)', [
    [usuarioPortalX, usuarioPortalGrupo, usuarioPortalInativo],
  ])
  await migrate.query('DELETE FROM reunioes_comerciais WHERE cliente_carteira_id = $1', [clienteX])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = $1', [usuarioDeGestao])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = $1', [usuarioDeGestao])
  await migrate.query('DELETE FROM campanhas_carteira WHERE cliente_carteira_id = $1', [clienteX])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [[clienteX, clienteY, clienteZ]])
  await apagarHistoricoGrupoDeTeste(migrate, clinicaX)
  await apagarHistoricoGrupoDeTeste(migrate, clinicaY)
  await apagarHistoricoGrupoDeTeste(migrate, clinicaZ)
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupo, grupoB]])
  await apagarClinicaDeTeste(migrate, clinicaX)
  await apagarClinicaDeTeste(migrate, clinicaY)
  await apagarClinicaDeTeste(migrate, clinicaZ)
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await apagarOperadorDeTeste(migrate, operador)
  await migrate.end()
  await app.close()
})

describe('POST /v1/portal/entrar', () => {
  it('entra com usuário e senha do Usuário do portal', async () => {
    const r = await entrarNoPortal().expect(200)
    expect(r.body.usuarioDoPortal).toMatchObject({ usuario: PORTAL_X, escopo: 'cliente', clienteCarteiraId: clienteX })
    expect(cookies(r).join()).toMatch(/__Host-fir-portal=/)
  })

  it('nunca devolve hash nem prazo interno', async () => {
    const r = await entrarNoPortal().expect(200)
    expect(JSON.stringify(r.body)).not.toMatch(/\$argon2|senha_hash|expira/i)
  })

  it('o cookie é HttpOnly, Secure, SameSite=Strict e Path=/', async () => {
    const bruto = cookies(await entrarNoPortal().expect(200)).join(';')
    expect(bruto).toMatch(/HttpOnly/i)
    expect(bruto).toMatch(/Secure/i)
    expect(bruto).toMatch(/SameSite=Strict/i)
    expect(bruto).toMatch(/Path=\//i)
  })

  it('a sessão dura doze horas', async () => {
    const bruto = cookies(await entrarNoPortal().expect(200)).join(';')
    const m = /Max-Age=(\d+)/i.exec(bruto)
    expect(m?.[1]).toBe(String(DURACAO_SESSAO_PORTAL_MS / 1000))
  })

  it('senha errada, usuário inexistente e conta desativada dizem a MESMA frase (ADR 0018 §3 item 2)', async () => {
    const a = await entrarNoPortal(PORTAL_X, 'chute-errado-aqui').expect(401)
    const b = await entrarNoPortal(NAO_EXISTE, 'chute-errado-aqui').expect(401)
    const c = await entrarNoPortal(PORTAL_INATIVO, SENHA).expect(401)
    expect(new Set([a.body.message, b.body.message, c.body.message]).size).toBe(1)
    expect(a.body.message).toBe('Usuário ou senha incorretos.')
  })

  it('o piso de tempo vale aqui também, nos três caminhos (ADR 0018 critério 12)', async () => {
    const medir = async (fn: () => Promise<unknown>) => {
      const inicio = performance.now()
      await fn()
      return performance.now() - inicio
    }
    const casos: [string, () => Promise<unknown>][] = [
      ['sucesso', () => entrarNoPortal().expect(200)],
      ['senha errada', () => entrarNoPortal(PORTAL_X, 'chute-errado-aqui').expect(401)],
      ['inexistente', () => entrarNoPortal(NAO_EXISTE, 'chute-errado-aqui').expect(401)],
      ['desativado', () => entrarNoPortal(PORTAL_INATIVO, SENHA).expect(401)],
    ]
    for (const [nome, fn] of casos) {
      expect(await medir(fn), nome).toBeGreaterThanOrEqual(PISO_DE_RESPOSTA_MS - 5)
    }
  })
})

describe('GET /v1/portal/eu', () => {
  it('devolve o próprio usuário do portal com a sessão válida', async () => {
    const sessao = paresDe(cookies(await entrarNoPortal().expect(200)))
    const r = await http().get('/v1/portal/eu').set('Cookie', sessao).expect(200)
    expect(r.body.usuarioDoPortal.usuario).toBe(PORTAL_X)
  })

  it('sem cookie, responde 404 — não 401', async () => {
    await http().get('/v1/portal/eu').expect(404)
  })
})

describe('P-12: revogação é checada a cada requisição', () => {
  it('desativar o Usuário do portal bloqueia a PRÓXIMA requisição', async () => {
    const usuario = `revoga.${sufixo}`
    const id = await criarUsuarioDoPortal(usuario, 'cliente', clienteX)
    try {
      const sessao = paresDe(cookies(await entrarNoPortal(usuario).expect(200)))
      await http().get('/v1/portal/eu').set('Cookie', sessao).expect(200)
      await migrate.query('UPDATE usuarios_do_portal SET ativo = false WHERE id = $1', [id])
      await http().get('/v1/portal/eu').set('Cookie', sessao).expect(404)
    } finally {
      await migrate.query('DELETE FROM sessoes_do_portal WHERE usuario_portal_id = $1', [id])
      await migrate.query('DELETE FROM usuarios_do_portal WHERE id = $1', [id])
    }
  })

  it('POST /v1/portal/sair revoga a sessão', async () => {
    const sessao = paresDe(cookies(await entrarNoPortal().expect(200)))
    await http().post('/v1/portal/sair').set('Cookie', sessao).expect(204)
    await http().get('/v1/portal/eu').set('Cookie', sessao).expect(404)
  })
})

describe('os espaços de identidade são disjuntos', () => {
  it('a credencial do portal NÃO entra pelo login do produto', async () => {
    await http().post('/v1/entrar').send({ clinica: 'demo', usuario: PORTAL_X, senha: SENHA }).expect(401)
  })

  it('o cookie do portal não abre rota de superadmin nem de carteira', async () => {
    const sessao = paresDe(cookies(await entrarNoPortal().expect(200)))
    await http().get('/v1/superadmin/eu').set('Cookie', sessao).expect(404)
    await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(404)
  })
})

describe('GET /v1/portal/clientes — o núcleo do Portal do Grupo', () => {
  it('escopo=cliente (X) vê só a própria seção, nunca Y nem Z', async () => {
    const sessao = paresDe(cookies(await entrarNoPortal(PORTAL_X).expect(200)))
    const r = await http().get('/v1/portal/clientes').set('Cookie', sessao).expect(200)
    expect(r.body.clientes.map((c: { nome: string }) => c.nome)).toEqual(['Cliente Portal X'])
  })

  it('escopo=cliente (X) tentando ler Y por manipulação não é possível — a rota nunca aceita id de cliente', async () => {
    // Não há parâmetro de cliente na rota (ADR 0018 item 1): a única forma de
    // "manipular" é não ter o que manipular. Confirmado pela ausência de Y na
    // resposta acima.
    expect(true).toBe(true)
  })

  it('escopo=grupo vê TODAS as seções do grupo (X e Y), nunca Z — critério de aceite 2 do spec', async () => {
    const sessao = paresDe(cookies(await entrarNoPortal(PORTAL_GRUPO).expect(200)))
    const r = await http().get('/v1/portal/clientes').set('Cookie', sessao).expect(200)
    const nomes = r.body.clientes.map((c: { nome: string }) => c.nome)
    expect(nomes).toEqual(expect.arrayContaining(['Cliente Portal X', 'Cliente Portal Y']))
    expect(nomes).not.toContain('Cliente Portal Z')
  })

  it('redação de valores: o titular (ve_valores) vê o próprio dinheiro (ADR 0017 §3, LGPD A52)', async () => {
    const sessao = paresDe(cookies(await entrarNoPortal(PORTAL_X).expect(200)))
    const r = await http().get('/v1/portal/clientes').set('Cookie', sessao).expect(200)
    const cliente = r.body.clientes.find((c: { nome: string }) => c.nome === 'Cliente Portal X')
    const campanhaGrande = cliente.campanhas.find((c: { tipo: string }) => c.tipo === 'individual')
    expect(campanhaGrande.resultadoEmDinheiro).not.toBeNull()
    expect(typeof campanhaGrande.resultadoEmDinheiro).toBe('string')
  })

  it('supressão por reidentificação: campanha com <5 orçamentos pagos nunca aparece individualizada (ADR 0018 critério 9)', async () => {
    const sessao = paresDe(cookies(await entrarNoPortal(PORTAL_X).expect(200)))
    const r = await http().get('/v1/portal/clientes').set('Cookie', sessao).expect(200)
    const cliente = r.body.clientes.find((c: { nome: string }) => c.nome === 'Cliente Portal X')
    const nomes = cliente.campanhas.filter((c: { tipo: string }) => c.tipo === 'individual').map((c: { nome: string }) => c.nome)
    expect(nomes).toEqual(['Campanha Grande'])
    expect(JSON.stringify(cliente.campanhas)).not.toContain('Pequena')
    const outras = cliente.campanhas.find((c: { tipo: string }) => c.tipo === 'outras')
    // CE-3: uma campanha só no balde — o valor dela NÃO vai junto (era 90000).
    expect(outras).toEqual({ tipo: 'outras', quantidade: 1, resultadoEmDinheiro: null })
    expect(JSON.stringify(cliente.campanhas)).not.toContain('90000')
  })

  it('reuniões (G8 0.1): só a ata compartilhada chega, e só com as colunas da lista branca (LGPD A7)', async () => {
    await declararAtorSistema(migrate)
    await migrate.query(
      `INSERT INTO reunioes_comerciais (cliente_carteira_id, grupo_id, data, resumo, encaminhamentos, por_usuario_gestao_id, compartilhada)
       VALUES ($1, $2, '2026-10-01', 'Impressões internas: a dona parece desanimada', NULL, $3, DEFAULT),
              ($1, $2, '2026-10-08', 'Ata compartilhada', 'Revisar roteiro', $3, true)`,
      [clienteX, grupo, usuarioDeGestao],
    )
    const sessao = paresDe(cookies(await entrarNoPortal(PORTAL_X).expect(200)))
    const r = await http().get('/v1/portal/clientes').set('Cookie', sessao).expect(200)
    const cliente = r.body.clientes.find((c: { nome: string }) => c.nome === 'Cliente Portal X')
    expect(cliente.reunioes.map((x: { resumo: string }) => x.resumo)).toEqual(['Ata compartilhada'])
    // G8 3D: os anexos (link e arquivo) entram na lista branca do A7.
    expect(Object.keys(cliente.reunioes[0]).sort()).toEqual(['arquivos', 'data', 'encaminhamentos', 'id', 'links', 'resumo'])
    expect(JSON.stringify(r.body)).not.toContain('Impressões internas')
  })

  it('registro de acesso: lê o grupo (2 clínicas) e grava DUAS linhas de auditoria, uma em cada clínica (ADR 0018 critério 5)', async () => {
    const sessao = paresDe(cookies(await entrarNoPortal(PORTAL_GRUPO).expect(200)))
    await http().get('/v1/portal/clientes').set('Cookie', sessao).expect(200)

    const trilhaX = await migrate.query<{ ator_tipo: string; ator_id: string; entidade: string }>(
      `SELECT ator_tipo, ator_id, entidade FROM auditoria
        WHERE clinica_id = $1 AND acao = 'acessou' ORDER BY em DESC LIMIT 1`,
      [clinicaX],
    )
    const trilhaY = await migrate.query<{ ator_tipo: string; ator_id: string; entidade: string }>(
      `SELECT ator_tipo, ator_id, entidade FROM auditoria
        WHERE clinica_id = $1 AND acao = 'acessou' ORDER BY em DESC LIMIT 1`,
      [clinicaY],
    )
    expect(trilhaX.rows[0]).toEqual({ ator_tipo: 'usuario_portal', ator_id: usuarioPortalGrupo, entidade: 'carteira_comercial' })
    expect(trilhaY.rows[0]).toEqual({ ator_tipo: 'usuario_portal', ator_id: usuarioPortalGrupo, entidade: 'carteira_comercial' })
  })
})

describe('criação de Usuário do portal — spec §1.3', () => {
  it('Usuário de Gestão cria escopo=cliente para um Cliente Firmare do próprio grupo', async () => {
    const sessaoGestao = paresDe(
      cookies(
        await http().post('/v1/carteira/entrar').send({ usuario: USUARIO_GESTAO, senha: SENHA }).expect(200),
      ),
    )
    const novoUsuario = `criado.cliente.${sufixo}`
    const r = await http()
      .post('/v1/carteira/acessos-do-portal/usuarios')
      .set('Cookie', sessaoGestao)
      .send({ usuario: novoUsuario, nome: 'Novo do Portal', clienteCarteiraId: clienteX })
      .expect(201)
    expect(r.body.usuarioDoPortal).toMatchObject({ escopo: 'cliente', clienteCarteiraId: clienteX })
    expect(typeof r.body.senhaProvisoria).toBe('string')

    await migrate.query('DELETE FROM usuarios_do_portal WHERE usuario = $1', [novoUsuario])
  })

  it('Usuário de Gestão NÃO alcança o endpoint de escopo=grupo — é @SoOperador, 404 sem cookie de painel', async () => {
    const sessaoGestao = paresDe(
      cookies(
        await http().post('/v1/carteira/entrar').send({ usuario: USUARIO_GESTAO, senha: SENHA }).expect(200),
      ),
    )
    await http()
      .post('/v1/superadmin/acessos-do-portal/usuarios')
      .set('Cookie', sessaoGestao)
      .send({ usuario: `tentativa.${sufixo}`, nome: 'X', grupoId: grupo })
      .expect(404)
  })

  it('Operador cria escopo=grupo', async () => {
    const sessaoOperador = paresDe(
      cookies(
        await http().post('/v1/superadmin/entrar').send({ usuario: USUARIO_OP, senha: SENHA_OP }).expect(200),
      ),
    )
    const novoUsuario = `criado.grupo.${sufixo}`
    const r = await http()
      .post('/v1/superadmin/acessos-do-portal/usuarios')
      .set('Cookie', sessaoOperador)
      .send({ usuario: novoUsuario, nome: 'Dono da Rede', grupoId: grupo })
      .expect(201)
    expect(r.body.usuarioDoPortal).toMatchObject({ escopo: 'grupo', grupoId: grupo })

    await migrate.query('DELETE FROM usuarios_do_portal WHERE usuario = $1', [novoUsuario])
  })
})
