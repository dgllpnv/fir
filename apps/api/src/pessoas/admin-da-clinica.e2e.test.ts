import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import {
  apagarClinicaDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'

/**
 * **A clínica cuida do próprio time** (ADR 2026-11-11, spec admin-da-clinica) —
 * pela porta HTTP, contra Postgres real.
 *
 * O que só um teste destes mede: a escalada de privilégio fechada nas cinco
 * rotas que só exigiam `config`, o lock por clínica sob duas conexões, a
 * revogação de sessão ao rebaixar, a trilha com o ator certo, e o Operador
 * sujeito à mesma invariante de última administradora.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const SENHA = 'montanha-de-vidro-aberta'
const SENHA_OP = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')
const codigo = `adm-${sufixo}`
const USUARIO_OP = `adm.op.${sufixo}`

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let outra: string
let operadorId: string
let perfilRec: string
let perfilEstoque: string
let perfilCfg: string
let perfilRico: string
let perfilDaOutra: string
const ids: Record<string, string> = {}
let hashDaSenha: string

const srv = () => request(app.getHttpServer())
const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const entrar = (usuario: string, cod = codigo) =>
  srv().post('/v1/entrar').send({ clinica: cod, usuario, senha: SENHA })

type Corpo = Record<string, unknown>
const patch = (s: string[], id: string, c: Corpo) =>
  srv().patch(`/v1/pessoas/${id}`).set('Cookie', s).send(c)
const del = (s: string[], id: string) => srv().delete(`/v1/pessoas/${id}`).set('Cookie', s)
const senha = (s: string[], id: string, c: Corpo = {}) =>
  srv().post(`/v1/pessoas/${id}/senha`).set('Cookie', s).send(c)
const criar = (s: string[], c: Corpo) => srv().post('/v1/pessoas').set('Cookie', s).send(c)
const salvarPerfis = (s: string[], c: Corpo) =>
  srv().put('/v1/pessoas/perfis').set('Cookie', s).send(c)

let helena: string[]
let bia: string[]
let sofia: string[]
let juliana: string[]
let vizinha: string[]

const linha = async (id: string) =>
  (
    await migrate.query<{
      admin: boolean
      ativo: boolean
      perfil_id: string | null
      nome: string
      senha_hash: string
      excluida_em: Date | null
    }>('SELECT admin, ativo, perfil_id, nome, senha_hash, excluida_em FROM pessoas WHERE id = $1', [id])
  ).rows[0]!
const adminsAtivas = async () =>
  (
    await migrate.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pessoas
        WHERE clinica_id = $1 AND admin AND ativo AND excluida_em IS NULL`,
      [clinica],
    )
  ).rows[0]!.n

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  const nova = async (cod: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Admin') RETURNING id`,
        [cod],
      )
    ).rows[0]!.id
  clinica = await nova(codigo)
  outra = await nova(`${codigo}-b`)

  const perfil = async (c: string, chave: string, nome: string, perms: string[]) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1,$2,$3,$4) RETURNING id`,
        [c, chave, nome, perms],
      )
    ).rows[0]!.id
  perfilRec = await perfil(clinica, 'pf_rec', 'Recepção', ['jornada', 'receber'])
  perfilEstoque = await perfil(clinica, 'pf_est', 'Só estoque', ['estoque'])
  perfilCfg = await perfil(clinica, 'pf_cfg', 'Supervisão', ['config', 'estoque', 'jornada', 'receber'])
  perfilRico = await perfil(clinica, 'pf_rico', 'Rico', ['config', 'valores', 'pessoas.gerir'])
  perfilDaOutra = await perfil(outra, 'pf_rec', 'Recepção', ['jornada'])

  const hash = await hashDeSenha(SENHA)
  hashDaSenha = hash
  const pessoa = async (
    c: string,
    nome: string,
    usuario: string,
    admin: boolean,
    perfilId: string | null,
    ativo = true,
  ) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id, ativo, desativada_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $7 THEN NULL ELSE now() END) RETURNING id`,
        [c, nome, usuario, hash, admin, perfilId, ativo],
      )
    ).rows[0]!.id
  ids['helena'] = await pessoa(clinica, 'Helena Prado', 'helena', true, null)
  ids['bia'] = await pessoa(clinica, 'Bruna Costa', 'bruna', true, null)
  ids['ines'] = await pessoa(clinica, 'Inês Dias', 'ines', true, null, false)
  ids['sofia'] = await pessoa(clinica, 'Sofia Lima', 'sofia', false, perfilCfg)
  ids['juliana'] = await pessoa(clinica, 'Juliana Santos', 'juliana', false, perfilRec)
  ids['rita'] = await pessoa(clinica, 'Rita Rica', 'rita', false, perfilRico)
  ids['vizinha'] = await pessoa(outra, 'Vizinha', 'vizinha', true, null)

  operadorId = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1,'Op Teste',$2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  vizinha = cookieDe(await entrar('vizinha', `${codigo}-b`).expect(200))
  // Um login por pessoa, uma vez: o limitador de entrada (429) existe e é o
  // que protege a produção; os testes ressuscitam a sessão por SQL.
  helena = cookieDe(await entrar('helena').expect(200))
  bia = cookieDe(await entrar('bruna').expect(200))
  sofia = cookieDe(await entrar('sofia').expect(200))
  juliana = cookieDe(await entrar('juliana').expect(200))
})

afterAll(async () => {
  await app.close()
  await declararAtorSistema(migrate)
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, outra)
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await apagarOperadorDeTeste(migrate, operadorId)
  await migrate.end()
})

beforeEach(async () => {
  const volta = async (
    chave: string,
    admin: boolean,
    perfil: string | null,
    ativo = true,
    nome?: string,
  ) =>
    migrate.query(
      `UPDATE pessoas SET admin=$2, perfil_id=$3, ativo=$4,
              desativada_em = CASE WHEN $4 THEN NULL ELSE coalesce(desativada_em, now()) END,
              excluida_em = NULL, senha_provisoria = false,
              nome = coalesce($5, nome)
        WHERE id = $1`,
      [ids[chave], admin, perfil, ativo, nome ?? null],
    )
  await volta('helena', true, null)
  await volta('bia', true, null)
  await volta('ines', true, null, false)
  await volta('sofia', false, perfilCfg)
  await volta('juliana', false, perfilRec, true, 'Juliana Santos')
  await volta('rita', false, perfilRico)
  await migrate.query(
    `DELETE FROM sessoes WHERE pessoa_id IN
       (SELECT id FROM pessoas WHERE clinica_id = $1 AND id <> ALL($2::uuid[]))`,
    [clinica, Object.values(ids)],
  )
  await migrate.query(
    `DELETE FROM pessoas WHERE clinica_id = $1 AND id <> ALL($2::uuid[])`,
    [clinica, Object.values(ids)],
  )
  await migrate.query(`DELETE FROM perfis WHERE clinica_id = $1 AND id <> ALL($2::uuid[])`, [
    clinica,
    [perfilRec, perfilEstoque, perfilCfg, perfilRico],
  ])
  await migrate.query(
    `UPDATE perfis SET excluido_em = NULL,
            perms = CASE id WHEN $2 THEN '{jornada,receber}'::text[]
                            WHEN $3 THEN '{estoque}'::text[]
                            WHEN $4 THEN '{config,estoque,jornada,receber}'::text[]
                            ELSE '{config,valores,pessoas.gerir}'::text[] END
      WHERE clinica_id = $1`,
    [clinica, perfilRec, perfilEstoque, perfilCfg],
  )
  await migrate.query(`UPDATE pessoas SET senha_hash = $2 WHERE clinica_id = $1`, [clinica, hashDaSenha])
  await migrate.query(
    `UPDATE sessoes SET revogada_em = NULL
      WHERE pessoa_id IN (SELECT id FROM pessoas WHERE clinica_id = $1)`,
    [clinica],
  )
})

// ---------------------------------------------------------------------------
// TICKET 1 — a escalada que `config` abria
// ---------------------------------------------------------------------------

describe('quem tem `config` e não é administradora NÃO escala (A-1, A-3, A-15 a A-19)', () => {
  it('A-1: não se promove nem promove outra, e nada muda', async () => {
    for (const alvo of ['sofia', 'juliana']) {
      const r = await patch(sofia, ids[alvo]!, { acesso: { admin: true } }).expect(403)
      expect(r.body.codigo).toBe('SoAdministradoraConcedeAdministracao')
      expect((await linha(ids[alvo]!)).admin).toBe(false)
    }
  })

  it('não rebaixa nem edita nome/função de administradora (A-17)', async () => {
    await patch(sofia, ids['bia']!, { acesso: { admin: false, perfilId: perfilRec } }).expect(403)
    const r = await patch(sofia, ids['bia']!, { nome: 'Outra Coisa' }).expect(403)
    expect(r.body.codigo).toBe('NaoAgeSobreAdministradora')
    const b = await linha(ids['bia']!)
    expect(b.admin).toBe(true)
    expect(b.nome).toBe('Bruna Costa')
  })

  it('A-16: não REATIVA administradora inativa', async () => {
    const r = await patch(sofia, ids['ines']!, { ativo: true }).expect(403)
    expect(r.body.codigo).toBe('NaoAgeSobreAdministradora')
    expect((await linha(ids['ines']!)).ativo).toBe(false)
  })

  it('A-18: DELETE de administradora por não-admin é 403 e ela continua', async () => {
    await del(sofia, ids['bia']!).expect(403)
    expect((await linha(ids['bia']!)).excluida_em).toBeNull()
  })

  it('A-3: não redefine a senha de administradora, e o hash não muda', async () => {
    const antes = (await linha(ids['bia']!)).senha_hash
    await senha(sofia, ids['bia']!).expect(403)
    expect((await linha(ids['bia']!)).senha_hash).toBe(antes)
    // A sessão da Bia segue viva: a recusa não derrubou nada.
    await srv().get('/v1/pessoas').set('Cookie', bia).expect(200)
  })

  it('A-15: escalada lateral — não atribui perfil mais rico que o dela', async () => {
    const r = await patch(sofia, ids['juliana']!, { acesso: { admin: false, perfilId: perfilRico } }).expect(403)
    expect(r.body.codigo).toBe('NaoConcedeChaveQueNaoTem')
    expect((await linha(ids['juliana']!)).perfil_id).toBe(perfilRec)
  })

  it('A-19: auto-atribuição de perfil mais rico', async () => {
    const r = await patch(sofia, ids['sofia']!, { acesso: { admin: false, perfilId: perfilRico } }).expect(403)
    expect(r.body.codigo).toBe('AutoAtribuicaoDePerfil')
    expect((await linha(ids['sofia']!)).perfil_id).toBe(perfilCfg)
  })

  it('não age sobre quem tem perfil mais rico (editar, senha, excluir)', async () => {
    const e = await patch(sofia, ids['rita']!, { nome: 'Rita X' }).expect(403)
    expect(e.body.codigo).toBe('NaoAgeSobrePessoaDePerfilMaisRico')
    await senha(sofia, ids['rita']!).expect(403)
    await del(sofia, ids['rita']!).expect(403)
    expect((await linha(ids['rita']!)).excluida_em).toBeNull()
  })

  it('o que já funcionava continua: edita e redefine a senha de perfil que ela tem', async () => {
    await patch(sofia, ids['juliana']!, { nome: 'Juliana S.' }).expect(200)
    await patch(sofia, ids['juliana']!, { acesso: { admin: false, perfilId: perfilEstoque } }).expect(200)
    const r = await senha(sofia, ids['juliana']!).expect(200)
    expect(typeof r.body.senhaProvisoria).toBe('string')
  })

  it('P-1: PUT /perfis é só da administradora — a matriz não muda', async () => {
    const antes = await migrate.query('SELECT id, perms FROM perfis WHERE clinica_id = $1 ORDER BY id', [clinica])
    const r = await salvarPerfis(sofia, {
      perfis: [{ id: perfilCfg, nome: 'Supervisão', perms: ['config', 'estoque', 'valores'] }],
    }).expect(403)
    expect(r.body.codigo).toBe('SoAdministradoraEditaPerfis')
    const depois = await migrate.query('SELECT id, perms FROM perfis WHERE clinica_id = $1 ORDER BY id', [clinica])
    expect(depois.rows).toEqual(antes.rows)
  })

  it('A-20: a senha de administradora, por administradora, só é GERADA', async () => {
    const r = await senha(helena, ids['bia']!, { senha: 'qualquer-senha-bem-comprida-9' }).expect(403)
    expect(r.body.codigo).toBe('SenhaDeAdministradoraSoGerada')
    const ok = await senha(helena, ids['bia']!).expect(200)
    expect(typeof ok.body.senhaProvisoria).toBe('string')
    // Para pessoa de perfil comum a escolha continua valendo.
    await senha(helena, ids['juliana']!, { senha: 'cadeira-azul-sobre-a-mesa-77' }).expect(200)
  })

  it('A-6: REBAIXAR derruba as sessões da ex-administradora', async () => {
    await srv().get('/v1/pessoas').set('Cookie', bia).expect(200)
    await patch(helena, ids['bia']!, { acesso: { admin: false, perfilId: perfilCfg } }).expect(200)
    await srv().get('/v1/pessoas').set('Cookie', bia).expect(401)
  })

  it('A-14: promover quem já é admin é no-op — sem segunda linha de trilha', async () => {
    const conta = async () =>
      (
        await migrate.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM auditoria WHERE clinica_id=$1 AND entidade='pessoas' AND entidade_id=$2`,
          [clinica, ids['bia']],
        )
      ).rows[0]!.n
    const antes = await conta()
    await patch(helena, ids['bia']!, { acesso: { admin: true } }).expect(200)
    await patch(helena, ids['bia']!, { nome: 'Bruna Costa' }).expect(200)
    expect(await conta()).toBe(antes)
  })

  it('a promoção grava na trilha o ator real e admin de → para', async () => {
    await patch(helena, ids['juliana']!, { acesso: { admin: true } }).expect(200)
    const r = await migrate.query<{ ator_tipo: string; ator_id: string; de: Corpo; para: Corpo }>(
      `SELECT ator_tipo, ator_id, de, para FROM auditoria
        WHERE clinica_id=$1 AND entidade='pessoas' AND entidade_id=$2 AND acao='alterou'
        ORDER BY id DESC LIMIT 1`,
      [clinica, ids['juliana']],
    )
    expect(r.rows[0]).toMatchObject({ ator_tipo: 'pessoa', ator_id: ids['helena'] })
    expect(r.rows[0]!.de['admin']).toBe(false)
    expect(r.rows[0]!.para['admin']).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// TICKET 2 — criar administradora pela clínica
// ---------------------------------------------------------------------------

describe('POST /v1/pessoas com acesso de administradora', () => {
  it('a administradora cria outra: 201, perfil nulo, provisória uma vez, troca obrigatória', async () => {
    const r = await criar(helena, {
      nome: 'Nova Admin',
      usuario: 'nova.admin',
      acesso: { admin: true },
    }).expect(201)
    expect(r.body.admin).toBe(true)
    expect(r.body.perfilId).toBeNull()
    const l = await migrate.query<{ admin: boolean; perfil_id: string | null; senha_provisoria: boolean }>(
      `SELECT admin, perfil_id, senha_provisoria FROM pessoas WHERE id = $1`,
      [r.body.id],
    )
    expect(l.rows[0]).toEqual({ admin: true, perfil_id: null, senha_provisoria: true })

    const login = await srv()
      .post('/v1/entrar')
      .send({ clinica: codigo, usuario: 'nova.admin', senha: r.body.senhaProvisoria })
      .expect(200)
    expect(login.body.usuario?.senhaProvisoria ?? login.body.eu?.usuario?.senhaProvisoria).toBe(true)

    // A provisória não aparece em coluna nenhuma da trilha.
    const t = await migrate.query<{ j: string }>(
      `SELECT (de::text || coalesce(para::text,'')) AS j FROM auditoria
        WHERE clinica_id=$1 AND entidade='pessoas' AND entidade_id=$2`,
      [clinica, r.body.id],
    )
    expect(JSON.stringify(t.rows)).not.toContain(r.body.senhaProvisoria)
    const trilha = await migrate.query<{ ator_tipo: string; ator_id: string; para: Corpo }>(
      `SELECT ator_tipo, ator_id, para FROM auditoria
        WHERE clinica_id=$1 AND entidade='pessoas' AND entidade_id=$2 AND acao='criou'`,
      [clinica, r.body.id],
    )
    expect(trilha.rows[0]).toMatchObject({ ator_tipo: 'pessoa', ator_id: ids['helena'] })
    expect(trilha.rows[0]!.para['admin']).toBe(true)
  })

  it('não-admin com config: 403 para admin, e para perfil mais rico; 201 para o que ela tem', async () => {
    const a = await criar(sofia, { nome: 'Tentativa', usuario: 'tent.um', acesso: { admin: true } }).expect(403)
    expect(a.body.codigo).toBe('SoAdministradoraConcedeAdministracao')
    await criar(sofia, { nome: 'Tentativa', usuario: 'tent.dois', perfilId: perfilRico }).expect(403)
    await criar(sofia, { nome: 'Legitima', usuario: 'legitima', acesso: { admin: false, perfilId: perfilEstoque } }).expect(201)
    const n = await migrate.query(`SELECT 1 FROM pessoas WHERE clinica_id=$1 AND usuario LIKE 'tent.%'`, [clinica])
    expect(n.rowCount).toBe(0)
  })

  it('A-13: corpo ambíguo é 400; clinicaId no corpo é 400', async () => {
    await criar(helena, { nome: 'Ana', usuario: 'ana.x', perfilId: perfilRec, acesso: { admin: true } }).expect(400)
    await criar(helena, { nome: 'Ana', usuario: 'ana.x', acesso: { admin: true }, clinicaId: outra }).expect(400)
  })

  it('perfil da outra clínica é recusado, e a outra clínica não enxerga a nossa', async () => {
    await criar(helena, { nome: 'Ana', usuario: 'ana.y', acesso: { admin: false, perfilId: perfilDaOutra } }).expect(400)
    const lista = await srv().get('/v1/pessoas').set('Cookie', vizinha).expect(200)
    expect((lista.body.pessoas as unknown[]).length).toBe(1)
    await patch(vizinha, ids['bia']!, { acesso: { admin: false, perfilId: perfilDaOutra } }).expect(404)
    await criar(vizinha, { nome: 'Nova', usuario: 'nova.b', acesso: { admin: true } }).expect(201)
    const naNossa = await migrate.query(`SELECT 1 FROM pessoas WHERE clinica_id=$1 AND usuario='nova.b'`, [clinica])
    expect(naNossa.rowCount).toBe(0)
  })

  it('usuário repetido é 409 pelo índice', async () => {
    await criar(helena, { nome: 'Dup', usuario: 'dup.admin', acesso: { admin: true } }).expect(201)
    await criar(helena, { nome: 'Dup', usuario: 'dup.admin', acesso: { admin: true } }).expect(409)
  })
})

// ---------------------------------------------------------------------------
// CORRIDA — duas conexões reais (A-4, A-21)
// ---------------------------------------------------------------------------

describe('concorrência sob o lock da clínica', () => {
  it('A-21: duas criações simultâneas do mesmo usuário deixam uma só', async () => {
    const corpo = { nome: 'Gêmea', usuario: 'gemea', acesso: { admin: true } }
    const [a, b] = await Promise.all([criar(helena, corpo), criar(bia, corpo)])
    expect([a.status, b.status].sort()).toEqual([201, 409])
    const n = await migrate.query(`SELECT 1 FROM pessoas WHERE clinica_id=$1 AND usuario='gemea'`, [clinica])
    expect(n.rowCount).toBe(1)
  })

  it('o lock é o que serializa: com a clínica travada por outra conexão, criar/editar/excluir/senha ESPERAM', async () => {
    const chamadas: [string, () => PromiseLike<{ status: number }>][] = [
      ['editar', () => patch(helena, ids['juliana']!, { nome: 'Juliana Z.' })],
      ['senha', () => senha(helena, ids['juliana']!)],
      ['criar', () => criar(helena, { nome: 'Esperta', usuario: 'esperta', perfilId: perfilRec })],
      ['excluir', () => del(helena, ids['rita']!)],
      ['perfis', () => salvarPerfis(helena, { perfis: [{ id: perfilRec, nome: 'Recepção', perms: ['jornada'] }, { id: perfilEstoque, nome: 'Só estoque', perms: ['estoque'] }, { id: perfilCfg, nome: 'Supervisão', perms: ['config'] }] })],
    ]
    for (const [nome, chamar] of chamadas) {
      await migrate.query('BEGIN')
      await migrate.query(`SELECT pg_advisory_xact_lock(hashtextextended('pessoas-acesso:' || $1::text, 0))`, [clinica])
      let terminou = false
      const p = Promise.resolve(chamar()).then((r) => {
        terminou = true
        return r.status
      })
      await new Promise((r) => setTimeout(r, 350))
      expect(terminou, `${nome} não esperou o lock da clínica`).toBe(false)
      await migrate.query('COMMIT')
      expect([200, 201, 204]).toContain(await p)
    }
  })

  it('A-4: duas administradoras se rebaixam AO MESMO TEMPO — sobra pelo menos uma', async () => {
    for (let i = 0; i < 4; i++) {
      await migrate.query(`UPDATE pessoas SET admin=true, perfil_id=NULL WHERE id = ANY($1::uuid[])`, [
        [ids['helena'], ids['bia']],
      ])
      await migrate.query(
        `UPDATE sessoes SET revogada_em = NULL WHERE pessoa_id = ANY($1::uuid[])`,
        [[ids['helena'], ids['bia']]],
      )
      const [a, b] = await Promise.all([
        patch(helena, ids['bia']!, { acesso: { admin: false, perfilId: perfilRec } }),
        patch(bia, ids['helena']!, { acesso: { admin: false, perfilId: perfilRec } }),
      ])
      const oks = [a.status, b.status].filter((s) => s === 200).length
      expect(oks, `rodada ${i}: ${a.status}/${b.status}`).toBe(1)
      expect(await adminsAtivas()).toBeGreaterThanOrEqual(1)
    }
  })
})

// ---------------------------------------------------------------------------
// O OPERADOR (sessão de suporte) — mesma invariante, trilha própria
// ---------------------------------------------------------------------------

describe('a sessão de suporte do Operador', () => {
  let painel: string
  let suporte: string

  const paresDe = (l: string[]) => l.map((c) => c.split(';')[0]!).join('; ')

  beforeEach(async () => {
    painel = paresDe(
      cookieDe(await srv().post('/v1/superadmin/entrar').send({ usuario: USUARIO_OP, senha: SENHA_OP }).expect(200)),
    )
    const r = await srv().post(`/v1/superadmin/clinicas/${clinica}/sessao-de-suporte`).set('Cookie', painel).expect(201)
    suporte = paresDe(cookieDe(r))
  })

  it('cria administradora; a trilha diz `operador`; não nasce linha para ele em pessoas', async () => {
    const antes = (await migrate.query(`SELECT 1 FROM pessoas WHERE clinica_id=$1`, [clinica])).rowCount
    const r = await criar([suporte], { nome: 'Via Suporte', usuario: 'via.suporte', acesso: { admin: true } }).expect(201)
    const t = await migrate.query<{ ator_tipo: string; ator_id: string }>(
      `SELECT ator_tipo, ator_id FROM auditoria WHERE clinica_id=$1 AND entidade='pessoas' AND entidade_id=$2 AND acao='criou'`,
      [clinica, r.body.id],
    )
    expect(t.rows[0]).toEqual({ ator_tipo: 'operador', ator_id: operadorId })
    expect((await migrate.query(`SELECT 1 FROM pessoas WHERE clinica_id=$1`, [clinica])).rowCount).toBe(antes! + 1)
  })

  it('a invariante da última administradora vale para ele: 422 em rebaixar, desativar e excluir', async () => {
    await migrate.query(`UPDATE pessoas SET ativo=false, desativada_em=now() WHERE id = $1`, [ids['bia']])
    const a = await patch([suporte], ids['helena']!, { acesso: { admin: false, perfilId: perfilRec } }).expect(422)
    expect(a.body.codigo).toBe('UltimaAdministradoraAtiva')
    const b = await patch([suporte], ids['helena']!, { ativo: false }).expect(422)
    expect(b.body.codigo).toBe('UltimaAdministradoraAtiva')
    const c = await del([suporte], ids['helena']!).expect(422)
    expect(c.body.codigo).toBe('UltimaAdministradoraAtiva')
    expect((await linha(ids['helena']!)).admin).toBe(true)
  })

  it('registro de ACESSO a dado sensível: a admin promovida e o Operador entram na trilha', async () => {
    const ficha = await srv()
      .post('/v1/fichas')
      .set('Cookie', helena)
      .send({
        nome: 'Ficha Teste', cargo: 'Recepção', contrato: 'CLT', admissao: '2024-03-01',
        aniversario: '1994-11-12', salario: '350000', pessoaId: null, gestorId: null, ativo: true,
      })
      .expect(201)
    const fid = ficha.body.id as string
    await srv().get(`/v1/fichas/${fid}`).set('Cookie', bia).expect(200)
    await srv().get(`/v1/fichas/${fid}`).set('Cookie', [suporte]).expect(200)
    const r = await migrate.query<{ ator_tipo: string; ator_id: string }>(
      `SELECT ator_tipo, ator_id FROM auditoria
        WHERE clinica_id=$1 AND acao='acessou' AND entidade='fichas_de_pessoa' AND entidade_id=$2`,
      [clinica, fid],
    )
    const por = r.rows.map((x) => `${x.ator_tipo}:${x.ator_id}`).sort()
    expect(por).toEqual([`operador:${operadorId}`, `pessoa:${ids['bia']}`].sort())
  })
})

// ---------------------------------------------------------------------------
// TICKET 3 — o aviso de administradora nova (P-3)
// ---------------------------------------------------------------------------

describe('GET /v1/pessoas — aviso de administradora criada/promovida', () => {
  const aviso = async (s: string[], id: string) => {
    const r = await srv().get('/v1/pessoas').set('Cookie', s).expect(200)
    return (r.body.pessoas as { id: string; avisoDeAdministradora: Corpo | null }[]).find((p) => p.id === id)!
      .avisoDeAdministradora
  }

  it('promovida por Helena: só nome e data, e quem não é admin com config também vê', async () => {
    await patch(helena, ids['juliana']!, { acesso: { admin: true } }).expect(200)
    const v = await aviso(sofia, ids['juliana']!)
    expect(v).toMatchObject({ acao: 'promovida', por: 'Helena Prado' })
    expect(Object.keys(v!).sort()).toEqual(['acao', 'em', 'por'])
  })

  it('quem não tem `config` não chega à rota', async () => {
    await srv().get('/v1/pessoas').set('Cookie', juliana).expect(403)
  })

  it('ação do Operador aparece como "Firmare (suporte)" — nunca o nome dele', async () => {
    const painel = cookieDe(await srv().post('/v1/superadmin/entrar').send({ usuario: USUARIO_OP, senha: SENHA_OP }).expect(200))
    const p = painel.map((c) => c.split(';')[0]!).join('; ')
    const s = cookieDe(await srv().post(`/v1/superadmin/clinicas/${clinica}/sessao-de-suporte`).set('Cookie', p).expect(201))
    const su = s.map((c) => c.split(';')[0]!).join('; ')
    const r = await criar([su], { nome: 'Pelo Suporte', usuario: 'pelo.suporte', acesso: { admin: true } }).expect(201)
    const v = await aviso(helena, r.body.id)
    expect(v).toMatchObject({ acao: 'criada', por: 'Firmare (suporte)' })
    expect(JSON.stringify(v)).not.toContain('Op Teste')
  })

  it('some depois de 30 dias — e a trilha permanece', async () => {
    // A trilha é append-only e a admin de teste nasce com um evento RECENTE.
    // Para medir a janela, a pessoa nasce SEM evento: o trigger é desligado
    // dentro de uma transação (o estado dele é transacional — nenhuma outra
    // conexão o vê desligado) e as linhas antigas entram como INSERT.
    await migrate.query('BEGIN')
    await migrate.query('ALTER TABLE pessoas DISABLE TRIGGER pessoas_auditoria')
    const id = (
      await migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin)
         VALUES ($1,'Antiga Admin','antiga.admin',$2,true) RETURNING id`,
        [clinica, hashDaSenha],
      )
    ).rows[0]!.id
    await migrate.query('ALTER TABLE pessoas ENABLE TRIGGER pessoas_auditoria')
    await migrate.query('COMMIT')

    const velho = (dias: number) =>
      migrate.query(
        `INSERT INTO auditoria (clinica_id, em, ator_tipo, ator_id, acao, entidade, entidade_id, de, para)
         VALUES ($1, now() - make_interval(days => $2), 'pessoa', $3, 'alterou', 'pessoas', $4,
                 '{"admin": false}', '{"admin": true}')`,
        [clinica, dias, ids['helena'], id],
      )
    await velho(31)
    expect(await aviso(helena, id)).toBeNull()
    await velho(29)
    expect(await aviso(helena, id)).toMatchObject({ acao: 'promovida', por: 'Helena Prado' })
    // A trilha permanece: os dois eventos continuam lá.
    const n = await migrate.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auditoria WHERE entidade='pessoas' AND entidade_id=$1`,
      [id],
    )
    expect(n.rows[0]!.n).toBe(2)
  })
})
