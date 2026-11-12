import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
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

/**
 * DESATIVAR não é excluir (regra 20) — e o estado tem de CORTAR o acesso, na
 * PRÓXIMA requisição, para quem já está dentro:
 *
 *  (a) usuário de gestão desativado: a sessão e o desafio do segundo fator
 *      caem, e reativar NÃO ressuscita a sessão antiga;
 *  (b) usuário de escopo `grupo` (gestão e portal) de um grupo desativado
 *      perde o acesso na hora, e entrar de novo também falha;
 *  (c) clínica desativada: a sessão das pessoas dela cai, entrar falha e a
 *      sessão de suporte é recusada.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA_OP = 'quatro-pedras-no-caminho'
const SENHA = 'azul-cavalo-bateria-grampo'
const PERFIL = {
  valores: false,
  carteira: 'minha',
  modulos: ['clientes', 'rotina'],
  administrar: false,
  setor: null,
  funcao: null,
  telefone: null,
} as const

const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `dono.des.${sufixo}`

let app: NestFastifyApplication
let migrate: pg.Client
let operador: string
let painel: string
const gruposCriados: string[] = []
const usuariosCriados: string[] = []
const portaisCriados: string[] = []
const clinicasCriadas: string[] = []

const http = () => request(app.getHttpServer())
const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  painel = paresDe(
    cookies(
      await http()
        .post('/v1/superadmin/entrar')
        .send({ usuario: USUARIO_OP, senha: SENHA_OP })
        .expect(200),
    ),
  )
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  if (portaisCriados.length > 0) {
    await migrate.query('DELETE FROM sessoes_do_portal WHERE usuario_portal_id = ANY($1)', [portaisCriados])
    await migrate.query('DELETE FROM usuarios_do_portal WHERE id = ANY($1)', [portaisCriados])
  }
  if (usuariosCriados.length > 0) {
    await migrate.query('DELETE FROM desafios_de_carteira WHERE usuario_gestao_id = ANY($1)', [usuariosCriados])
    await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [usuariosCriados])
    await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [usuariosCriados])
  }
  for (const id of clinicasCriadas) {
    await migrate.query('DELETE FROM clientes_carteira WHERE clinica_id = $1', [id])
    await apagarHistoricoGrupoDeTeste(migrate, id)
    await apagarClinicaDeTeste(migrate, id)
  }
  if (gruposCriados.length > 0) {
    await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [gruposCriados])
  }
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await apagarOperadorDeTeste(migrate, operador)
  await migrate.end()
  await app.close()
})

const criarGrupo = async (nome: string): Promise<string> => {
  const r = await http().post('/v1/superadmin/grupos').set('Cookie', painel).send({ nome }).expect(201)
  gruposCriados.push(r.body.grupo.id)
  return r.body.grupo.id as string
}

/** Cria pela API (o caminho real) e troca a provisória por uma senha conhecida, já definitiva. */
const criarUsuarioDeGestao = async (
  usuario: string,
  escopo: 'geral' | 'grupo',
  grupoId: string | null,
): Promise<string> => {
  const r = await http()
    .post('/v1/superadmin/usuarios-gestao')
    .set('Cookie', painel)
    .send({ usuario, nome: 'Gestora Desativável', escopo, grupoId, ...PERFIL })
    .expect(201)
  const id = r.body.usuarioDeGestao.id as string
  usuariosCriados.push(id)
  await migrate.query(
    `UPDATE usuarios_gestao SET senha_hash = $2, senha_provisoria = false, senha_provisoria_expira_em = NULL WHERE id = $1`,
    [id, await hashDeSenha(SENHA)],
  )
  return id
}

const entrarNaCarteira = (usuario: string) => http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA })
const sessaoDaCarteira = async (usuario: string): Promise<string> =>
  paresDe(cookies(await entrarNaCarteira(usuario).expect(200)))

const patchUsuario = (id: string, ativo: boolean, escopo: 'geral' | 'grupo', grupoId: string | null) =>
  http()
    .patch(`/v1/superadmin/usuarios-gestao/${id}`)
    .set('Cookie', painel)
    .send({ nome: 'Gestora Desativável', escopo, grupoId, ativo, ...PERFIL })

describe('(a) usuário de gestão desativado', () => {
  it('perde a carteira na PRÓXIMA requisição, tem sessão e desafio revogados, e reativar não ressuscita a sessão', async () => {
    const usuario = `gestora.a.${sufixo}`
    const id = await criarUsuarioDeGestao(usuario, 'geral', null)
    const sessao = await sessaoDaCarteira(usuario)
    await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(200)

    // Um desafio do segundo fator em curso (senha certa, código ainda não dado).
    await migrate.query(
      `INSERT INTO desafios_de_carteira (usuario_gestao_id, token_hash, expira_em)
       VALUES ($1, $2, now() + interval '5 minutes')`,
      [id, randomBytes(16).toString('hex')],
    )

    const r = await patchUsuario(id, false, 'geral', null).expect(200)
    expect(r.body.usuarioDeGestao.ativo).toBe(false)

    // Próxima requisição: 404, a mesma de qualquer sessão inválida.
    await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(404)
    // E entrar de novo é recusado.
    await entrarNaCarteira(usuario).expect(401)

    const viva = await migrate.query(
      'SELECT count(*)::int AS n FROM sessoes_de_carteira WHERE usuario_gestao_id = $1 AND revogada_em IS NULL',
      [id],
    )
    expect(viva.rows[0].n).toBe(0)
    const desafios = await migrate.query(
      'SELECT count(*)::int AS n FROM desafios_de_carteira WHERE usuario_gestao_id = $1 AND revogado_em IS NULL AND concluido_em IS NULL',
      [id],
    )
    expect(desafios.rows[0].n).toBe(0)

    // Reativar devolve a PESSOA, não a sessão que estava aberta antes.
    await patchUsuario(id, true, 'geral', null).expect(200)
    await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(404)
    const nova = await sessaoDaCarteira(usuario)
    await http().get('/v1/carteira/eu').set('Cookie', nova).expect(200)
  })

  it('nada foi apagado: a linha continua lá, desativada, e a trilha tem de → para', async () => {
    const id = await criarUsuarioDeGestao(`gestora.a2.${sufixo}`, 'geral', null)
    await patchUsuario(id, false, 'geral', null).expect(200)
    const l = await migrate.query('SELECT ativo FROM usuarios_gestao WHERE id = $1', [id])
    expect(l.rows[0]).toMatchObject({ ativo: false })
    const t = await migrate.query(
      `SELECT de, para FROM auditoria_do_painel WHERE entidade = 'usuarios_gestao' AND entidade_id = $1 ORDER BY id DESC LIMIT 1`,
      [id],
    )
    expect(t.rows[0].de).toMatchObject({ ativo: true })
    expect(t.rows[0].para).toMatchObject({ ativo: false })
  })
})

describe('(b) grupo desativado', () => {
  it('o usuário de gestão do grupo perde o acesso na próxima requisição, e reativar o grupo não ressuscita a sessão', async () => {
    const grupoId = await criarGrupo(`Grupo Desativável ${sufixo}`)
    const usuario = `gestora.b.${sufixo}`
    await criarUsuarioDeGestao(usuario, 'grupo', grupoId)
    const sessao = await sessaoDaCarteira(usuario)
    await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(200)

    await http()
      .patch(`/v1/superadmin/grupos/${grupoId}`)
      .set('Cookie', painel)
      .send({ nome: `Grupo Desativável ${sufixo}`, ativo: false })
      .expect(200)

    await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(404)
    await entrarNaCarteira(usuario).expect(401)

    await http()
      .patch(`/v1/superadmin/grupos/${grupoId}`)
      .set('Cookie', painel)
      .send({ nome: `Grupo Desativável ${sufixo}`, ativo: true })
      .expect(200)
    await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(404)
    const nova = await sessaoDaCarteira(usuario)
    await http().get('/v1/carteira/eu').set('Cookie', nova).expect(200)
  })

  it('o usuário do portal de escopo grupo também cai na hora, e volta com o grupo', async () => {
    const grupoId = await criarGrupo(`Grupo Portal ${sufixo}`)
    const usuario = `portal.b.${sufixo}`
    const p = await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_do_portal (usuario, nome, senha_hash, escopo, grupo_id, ve_valores)
       VALUES ($1, 'Rede', $2, 'grupo', $3, true) RETURNING id`,
      [usuario, await hashDeSenha(SENHA), grupoId],
    )
    portaisCriados.push(p.rows[0]!.id)
    const entrar = () => http().post('/v1/portal/entrar').send({ usuario, senha: SENHA })
    const sessao = paresDe(cookies(await entrar().expect(200)))
    await http().get('/v1/portal/eu').set('Cookie', sessao).expect(200)

    const desativar = (ativo: boolean) =>
      http()
        .patch(`/v1/superadmin/grupos/${grupoId}`)
        .set('Cookie', painel)
        .send({ nome: `Grupo Portal ${sufixo}`, ativo })
        .expect(200)
    await desativar(false)
    await http().get('/v1/portal/eu').set('Cookie', sessao).expect(404)
    await entrar().expect(401)

    await desativar(true)
    const nova = paresDe(cookies(await entrar().expect(200)))
    await http().get('/v1/portal/eu').set('Cookie', nova).expect(200)
  })

  it('a lista traz padrao e as contagens de quem perde o acesso — só ativos', async () => {
    const grupoId = await criarGrupo(`Grupo Contagem ${sufixo}`)
    const ativo = await criarUsuarioDeGestao(`gestora.c1.${sufixo}`, 'grupo', grupoId)
    const inativo = await criarUsuarioDeGestao(`gestora.c2.${sufixo}`, 'grupo', grupoId)
    await patchUsuario(inativo, false, 'grupo', grupoId).expect(200)
    expect(ativo).not.toBe(inativo)

    const l = await http().get('/v1/superadmin/grupos').set('Cookie', painel).expect(200)
    const g = l.body.grupos.find((x: { id: string }) => x.id === grupoId)
    expect(g).toMatchObject({ padrao: false, clinicasAtivas: 0, usuariosAtivos: 1 })
    const padrao = l.body.grupos.find((x: { padrao: boolean }) => x.padrao)
    expect(padrao).toBeDefined()
  })

  it('o grupo Firmare (padrão) não desativa: 409, nunca 500', async () => {
    const l = await http().get('/v1/superadmin/grupos').set('Cookie', painel).expect(200)
    const padrao = l.body.grupos.find((x: { padrao: boolean }) => x.padrao)
    await http()
      .patch(`/v1/superadmin/grupos/${padrao.id}`)
      .set('Cookie', painel)
      .send({ nome: padrao.nome, ativo: false })
      .expect(409)
  })
})

describe('(c) clínica desativada', () => {
  it('a sessão das pessoas dela cai, entrar falha, a sessão de suporte é recusada, e nada é apagado', async () => {
    const codigo = `des${sufixo}`
    const nova = await http()
      .post('/v1/superadmin/clinicas')
      .set('Cookie', painel)
      .send({ codigo, nome: 'Clínica Desativável', fuso: 'America/Bahia', admin: { nome: 'Dra. Teste', usuario: `admin.${sufixo}` } })
      .expect(201)
    const clinicaId = nova.body.id as string
    clinicasCriadas.push(clinicaId)
    await migrate.query(`UPDATE pessoas SET senha_hash = $2, senha_provisoria = false WHERE id = $1`, [
      nova.body.admin.id,
      await hashDeSenha(SENHA),
    ])
    const entrar = () =>
      http().post('/v1/entrar').send({ clinica: codigo, usuario: `admin.${sufixo}`, senha: SENHA })
    const sessao = paresDe(cookies(await entrar().expect(200)))
    await http().get('/v1/eu').set('Cookie', sessao).expect(200)

    await http()
      .patch(`/v1/superadmin/clinicas/${clinicaId}`)
      .set('Cookie', painel)
      .send({ nome: 'Clínica Desativável', fuso: 'America/Bahia', ativa: false })
      .expect(200)

    const depois = await http().get('/v1/eu').set('Cookie', sessao)
    expect([401, 404]).toContain(depois.status)
    const tentativa = await entrar()
    expect([401, 404]).toContain(tentativa.status)
    await http().post(`/v1/superadmin/clinicas/${clinicaId}/sessao-de-suporte`).set('Cookie', painel).expect(409)

    // Estado, não exclusão: a clínica e a administradora continuam no banco.
    const c = await migrate.query('SELECT ativa FROM clinicas WHERE id = $1', [clinicaId])
    expect(c.rows[0]).toMatchObject({ ativa: false })
    const p = await migrate.query('SELECT ativo FROM pessoas WHERE id = $1', [nova.body.admin.id])
    expect(p.rows[0]).toMatchObject({ ativo: true })

    // Reativar devolve a entrada.
    await http()
      .patch(`/v1/superadmin/clinicas/${clinicaId}`)
      .set('Cookie', painel)
      .send({ nome: 'Clínica Desativável', fuso: 'America/Bahia', ativa: true })
      .expect(200)
    await entrar().expect(200)
  })
})
