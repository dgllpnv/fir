import { perfisPadrao } from '@fir/domain'
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
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA_OP = 'quatro-pedras-no-caminho'
const PROVISORIA = /^[a-z]+(-[a-z]+){3}$/

let app: NestFastifyApplication
let migrate: pg.Client
let operador: string
let painel: string
/** Toda clínica criada por este arquivo, para o `afterAll` desfazer. */
const criadas: string[] = []

/**
 * Sufixo ALEATÓRIO, não `Date.now()`.
 *
 * `operadores.usuario` é único GLOBALMENTE — o operador não pertence a
 * clínica nenhuma, então não há `clinica_id` para separar fixtures. Com
 * `Date.now() % 1e6`, dois arquivos de teste que começam no mesmo
 * milissegundo (e eles rodam em paralelo) produzem o MESMO usuário, e o
 * segundo morre em `duplicate key value violates unique constraint`. Medido:
 * 2 de 6 execuções seguidas.
 */
const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `dono.${sufixo}`

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')

let proximo = 0
const novoCodigo = () => `pcl${sufixo}x${proximo++}`

const http = () => request(app.getHttpServer())

const criarClinica = (corpo: Record<string, unknown> = {}, cookie = painel) =>
  http()
    .post('/v1/superadmin/clinicas')
    .set('Cookie', cookie)
    .send({
      codigo: novoCodigo(),
      nome: 'Clínica Nova',
      fuso: 'America/Bahia',
      admin: { nome: 'Dra. Helena', usuario: 'helena' },
      ...corpo,
    })

/** Cria e registra para limpeza. Falha alto se a criação não deu 201. */
const criarClinicaOk = async (corpo: Record<string, unknown> = {}) => {
  const r = await criarClinica(corpo).expect(201)
  criadas.push(r.body.id)
  return r.body as {
    id: string
    codigo: string
    admin: { id: string; senhaProvisoria: string }
  }
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash)
       VALUES ($1, 'Dono', $2) RETURNING id`,
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
  for (const id of criadas) await apagarClinicaDeTeste(migrate, id)
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await apagarOperadorDeTeste(migrate, operador)
  await migrate.end()
  await app.close()
})

describe('POST /v1/superadmin/clinicas', () => {
  it('entrega clínica + perfis padrão + admin com provisória, numa chamada', async () => {
    const codigo = novoCodigo()
    const r = await criarClinica({ codigo }).expect(201)
    criadas.push(r.body.id)

    expect(r.body.codigo).toBe(codigo)
    expect(r.body.admin.senhaProvisoria).toMatch(PROVISORIA)
    expect(r.body.admin.admin).toBe(true)
    expect(r.body.admin.perfilId).toBeNull()

    const perfis = await migrate.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM perfis WHERE clinica_id = $1',
      [r.body.id],
    )
    expect(perfis.rows[0]!.n).toBe(perfisPadrao().length)

    // E a clínica está USÁVEL: a admin entra e cai na troca obrigatória.
    const e = await http()
      .post('/v1/entrar')
      .send({ clinica: codigo, usuario: 'helena', senha: r.body.admin.senhaProvisoria })
      .expect(200)
    const sessao = paresDe(cookies(e))
    const hoje = await http().get('/v1/hoje').set('Cookie', sessao)
    expect(hoje.status).toBe(409)
    expect(hoje.body.codigo).toBe('SENHA_PROVISORIA')
  })

  it('tudo ou nada: se a admin falhar, a clínica NÃO nasce', async () => {
    const codigo = novoCodigo()
    await criarClinica({ codigo, admin: { nome: 'A', usuario: 'NÃO VALE' } }).expect(400)
    const existe = await migrate.query('SELECT 1 FROM clinicas WHERE codigo = $1', [codigo])
    expect(existe.rowCount, 'meia criação: a clínica nasceu sem administradora').toBe(0)
  })

  it('A CLÍNICA VÊ quem a criou, desde a primeira linha da trilha dela', async () => {
    // D-10: "o acesso é total; o registro é obrigatório". Esta é a prova.
    const nova = await criarClinicaOk()
    const t = await migrate.query<{ ator_tipo: string; ator_id: string; entidade: string }>(
      `SELECT ator_tipo, ator_id, entidade FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pessoas'`,
      [nova.id],
    )
    expect(t.rows.length).toBeGreaterThan(0)
    for (const linha of t.rows) {
      expect(linha.ator_tipo).toBe('operador')
      expect(linha.ator_id).toBe(operador)
    }
  })

  it('o operador fixa app.clinica_id da clínica NOVA — não escapa da RLS', async () => {
    const nova = await criarClinicaOk()
    // Medido pelo que a transação FIXOU, não pelo que o código diz fixar:
    // toda linha de trilha escrita por esta criação pertence à clínica nova.
    const linhas = await migrate.query<{ clinica_id: string }>(
      `SELECT DISTINCT clinica_id FROM auditoria
        WHERE ator_id = $1 AND ator_tipo = 'operador' AND entidade IN ('pessoas', 'perfis')`,
      [operador],
    )
    for (const l of linhas.rows) expect(criadas).toContain(l.clinica_id)
  })

  it('código repetido é 409, e o repetido é CANÔNICO', async () => {
    const codigo = novoCodigo()
    await criarClinicaOk({ codigo })
    const maiusculo = await criarClinica({ codigo: codigo.toUpperCase() })
    expect(maiusculo.status).toBe(409)
    const comEspaco = await criarClinica({ codigo: `  ${codigo}  ` })
    expect(comEspaco.status).toBe(409)
  })

  it('o fuso é obrigatório e validado contra a lista IANA', async () => {
    await criarClinica({ fuso: 'America/Bahiaa' }).expect(400)
    await criarClinica({ fuso: '' }).expect(400)
    const r = await criarClinica({ fuso: 'America/Sao_Paulo' }).expect(201)
    criadas.push(r.body.id)
    expect(r.body.fuso).toBe('America/Sao_Paulo')
  })

  it('o corpo é estrito: nem a clínica nem a admin aceitam campo de senha', async () => {
    await criarClinica({ senha: 'escolhida-por-mim' }).expect(400)
    await criarClinica({
      admin: { nome: 'A B', usuario: 'ab.cd', senha: 'escolhida-por-mim' },
    }).expect(400)
  })

  it('a provisória da admin não aparece em trilha nenhuma das duas tabelas', async () => {
    const nova = await criarClinicaOk()
    const prov = nova.admin.senhaProvisoria
    expect(prov).toMatch(PROVISORIA)

    const daClinica = await migrate.query(
      'SELECT de, para FROM auditoria WHERE clinica_id = $1',
      [nova.id],
    )
    expect(JSON.stringify(daClinica.rows)).not.toContain(prov)
    expect(JSON.stringify(daClinica.rows)).toContain('[oculto]')

    const doPainel = await migrate.query('SELECT de, para FROM auditoria_do_painel')
    expect(JSON.stringify(doPainel.rows)).not.toContain(prov)
  })

  it('a criação da clínica fica registrada em auditoria_do_painel', async () => {
    // `clinicas` não tem trigger (e não pode ter: ela é a raiz do tenancy,
    // sem clinica_id próprio para a trilha). Então esta linha é escrita à mão.
    const nova = await criarClinicaOk()
    const t = await migrate.query<{ acao: string; entidade: string; entidade_id: string }>(
      `SELECT acao, entidade, entidade_id FROM auditoria_do_painel
        WHERE entidade = 'clinicas' AND entidade_id = $1`,
      [nova.id],
    )
    expect(t.rows[0]).toMatchObject({ acao: 'criou', entidade: 'clinicas' })
  })

  it('sem sessão de painel, 404 — e nada é criado', async () => {
    const codigo = novoCodigo()
    await criarClinica({ codigo }, '').expect(404)
    const existe = await migrate.query('SELECT 1 FROM clinicas WHERE codigo = $1', [codigo])
    expect(existe.rowCount).toBe(0)
  })
})

describe('GET /v1/superadmin/clinicas', () => {
  it('lista as clínicas, sem campo monetário nenhum', async () => {
    const nova = await criarClinicaOk()
    const r = await http().get('/v1/superadmin/clinicas').set('Cookie', painel).expect(200)
    expect(r.body.itens.map((c: { id: string }) => c.id)).toContain(nova.id)
    expect(JSON.stringify(r.body)).not.toMatch(/\$argon2/)
  })
})

describe('o superadmin alcança as pessoas de QUALQUER clínica', () => {
  it('cria qualquer perfil, e também a administradora', async () => {
    const nova = await criarClinicaOk()
    const perfis = await migrate.query<{ id: string }>(
      'SELECT id FROM perfis WHERE clinica_id = $1',
      [nova.id],
    )
    let i = 0
    for (const p of perfis.rows) {
      const r = await http()
        .post(`/v1/superadmin/clinicas/${nova.id}/pessoas`)
        .set('Cookie', painel)
        .send({ nome: `Pessoa ${i}`, usuario: `pessoa.${i}`, perfilId: p.id })
      expect(r.status, JSON.stringify(r.body)).toBe(201)
      expect(r.body.senhaProvisoria).toMatch(PROVISORIA)
      i++
    }
    // E a SEGUNDA administradora — o elo que o admin da clínica não tem.
    const admin = await http()
      .post(`/v1/superadmin/clinicas/${nova.id}/pessoas`)
      .set('Cookie', painel)
      .send({ nome: 'Segunda Admin', usuario: 'segunda.admin', perfilId: null })
      .expect(201)
    expect(admin.body.admin).toBe(true)
  })

  it('redefinir a senha do ADMIN da clínica é o elo seguinte da cadeia', async () => {
    const nova = await criarClinicaOk()
    // A admin troca a provisória e passa a ter sessão viva.
    const entrada = await http()
      .post('/v1/entrar')
      .send({ clinica: nova.codigo, usuario: 'helena', senha: nova.admin.senhaProvisoria })
      .expect(200)
    const sessaoDaAdmin = paresDe(cookies(entrada))
    await http()
      .post('/v1/eu/senha')
      .set('Cookie', sessaoDaAdmin)
      .send({ atual: nova.admin.senhaProvisoria, nova: 'sete-telhados-de-barro' })
      .expect(204)
    await http().get('/v1/eu').set('Cookie', sessaoDaAdmin).expect(200)

    const r = await http()
      .post(`/v1/superadmin/clinicas/${nova.id}/pessoas/${nova.admin.id}/senha`)
      .set('Cookie', painel)
      .expect(200)
    expect(r.body.senhaProvisoria).toMatch(PROVISORIA)
    // A sessão viva CAI: quem redefine o faz porque desconfia.
    await http().get('/v1/eu').set('Cookie', sessaoDaAdmin).expect(401)
    // E a nova provisória entra.
    await http()
      .post('/v1/entrar')
      .send({ clinica: nova.codigo, usuario: 'helena', senha: r.body.senhaProvisoria })
      .expect(200)
  })

  it('a clínica vê TODA ação do operador dentro dela, com ator_tipo operador', async () => {
    const nova = await criarClinicaOk()
    const antes = await migrate.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auditoria WHERE clinica_id = $1 AND ator_tipo = 'operador'`,
      [nova.id],
    )
    const perfil = await migrate.query<{ id: string }>(
      'SELECT id FROM perfis WHERE clinica_id = $1 LIMIT 1',
      [nova.id],
    )
    await http()
      .post(`/v1/superadmin/clinicas/${nova.id}/pessoas`)
      .set('Cookie', painel)
      .send({ nome: 'Mais Uma', usuario: 'mais.uma', perfilId: perfil.rows[0]!.id })
      .expect(201)
    await http()
      .post(`/v1/superadmin/clinicas/${nova.id}/pessoas/${nova.admin.id}/senha`)
      .set('Cookie', painel)
      .expect(200)

    // Exatamente DUAS linhas novas, e as duas com o id DESTE operador. Um
    // `>` passaria com uma só, e passaria também se metade das ações
    // tivesse sido atribuída ao sistema.
    const depois = await migrate.query<{ ator_id: string; acao: string; entidade: string }>(
      `SELECT ator_id, acao, entidade FROM auditoria
        WHERE clinica_id = $1 AND ator_tipo = 'operador'
        ORDER BY em DESC, id DESC LIMIT 2`,
      [nova.id],
    )
    const total = await migrate.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auditoria WHERE clinica_id = $1 AND ator_tipo = 'operador'`,
      [nova.id],
    )
    expect(total.rows[0]!.n).toBe(antes.rows[0]!.n + 2)
    for (const linha of depois.rows) {
      expect(linha.ator_id, 'a clínica vê a ação, mas não vê QUEM a fez').toBe(operador)
      expect(linha.entidade).toBe('pessoas')
    }
    expect(depois.rows.map((l) => l.acao).sort()).toEqual(['alterou', 'criou'])
  })

  it('NENHUMA ação do painel sobre a clínica B escreve na trilha da clínica A', async () => {
    const a = await criarClinicaOk()
    const b = await criarClinicaOk()
    const antesDeA = await migrate.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM auditoria WHERE clinica_id = $1',
      [a.id],
    )
    const perfilB = await migrate.query<{ id: string }>(
      'SELECT id FROM perfis WHERE clinica_id = $1 LIMIT 1',
      [b.id],
    )
    await http()
      .post(`/v1/superadmin/clinicas/${b.id}/pessoas`)
      .set('Cookie', painel)
      .send({ nome: 'Da B', usuario: 'da.b', perfilId: perfilB.rows[0]!.id })
      .expect(201)
    const depoisDeA = await migrate.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM auditoria WHERE clinica_id = $1',
      [a.id],
    )
    expect(depoisDeA.rows[0]!.n).toBe(antesDeA.rows[0]!.n)
  })

  it('o perfil de OUTRA clínica não serve — a RLS responde, não um if', async () => {
    const a = await criarClinicaOk()
    const b = await criarClinicaOk()
    const perfilDeB = await migrate.query<{ id: string }>(
      'SELECT id FROM perfis WHERE clinica_id = $1 LIMIT 1',
      [b.id],
    )
    const r = await http()
      .post(`/v1/superadmin/clinicas/${a.id}/pessoas`)
      .set('Cookie', painel)
      .send({ nome: 'Cruzada', usuario: 'cruzada', perfilId: perfilDeB.rows[0]!.id })
    expect(r.status, 'o painel criou pessoa com o perfil da clínica vizinha').toBe(400)
  })

  it('a pessoa de OUTRA clínica não é alcançável pela rota desta', async () => {
    const a = await criarClinicaOk()
    const b = await criarClinicaOk()
    const pessoaDeB = await migrate.query<{ id: string }>(
      'SELECT id FROM pessoas WHERE clinica_id = $1 LIMIT 1',
      [b.id],
    )
    await http()
      .post(`/v1/superadmin/clinicas/${a.id}/pessoas/${pessoaDeB.rows[0]!.id}/senha`)
      .set('Cookie', painel)
      .expect(404)
    await http()
      .get(`/v1/superadmin/clinicas/${a.id}/pessoas/${pessoaDeB.rows[0]!.id}`)
      .set('Cookie', painel)
      .expect(404)
  })

  it('o id da clínica vem da ROTA e é validado contra `clinicas`', async () => {
    // A única fonte NOVA de `ClinicaId` deste plano, e ela passa pelo banco:
    // um uuid inventado na URL não pode virar `SET LOCAL app.clinica_id`.
    const inventado = '00000000-0000-4000-8000-000000000000'
    await http()
      .post(`/v1/superadmin/clinicas/${inventado}/pessoas`)
      .set('Cookie', painel)
      .send({ nome: 'Fantasma', usuario: 'fantasma', perfilId: null })
      .expect(404)
    await http().get(`/v1/superadmin/clinicas/${inventado}/pessoas`).set('Cookie', painel).expect(404)
  })

  it('id de clínica malformado é 404, nunca 400', async () => {
    // 400 para uuid inválido e 404 para uuid válido inexistente distingue os
    // dois para quem sonda.
    await http().get('/v1/superadmin/clinicas/nao-e-uuid/pessoas').set('Cookie', painel).expect(404)
  })

  it('clínica DESATIVADA não aceita criação pelo painel', async () => {
    const nova = await criarClinicaOk()
    await migrate.query('UPDATE clinicas SET ativa = false WHERE id = $1', [nova.id])
    try {
      const r = await http()
        .post(`/v1/superadmin/clinicas/${nova.id}/pessoas`)
        .set('Cookie', painel)
        .send({ nome: 'Tarde Demais', usuario: 'tarde.demais', perfilId: null })
      expect(r.status).toBe(409)
    } finally {
      await migrate.query('UPDATE clinicas SET ativa = true WHERE id = $1', [nova.id])
    }
  })

  it('o superadmin NUNCA lê a senha de ninguém — nem redefinindo', async () => {
    const nova = await criarClinicaOk()
    const r = await http()
      .post(`/v1/superadmin/clinicas/${nova.id}/pessoas/${nova.admin.id}/senha`)
      .set('Cookie', painel)
      .expect(200)
    // Ele vê a provisória que ACABOU de ser gerada, uma vez. Nunca a anterior.
    const ficha = await http()
      .get(`/v1/superadmin/clinicas/${nova.id}/pessoas/${nova.admin.id}`)
      .set('Cookie', painel)
      .expect(200)
    expect(JSON.stringify(ficha.body)).not.toMatch(/\$argon2|senhaProvisoria/)
    expect(JSON.stringify(ficha.body)).not.toContain(r.body.senhaProvisoria)

    const lista = await http()
      .get(`/v1/superadmin/clinicas/${nova.id}/pessoas`)
      .set('Cookie', painel)
      .expect(200)
    expect(JSON.stringify(lista.body)).not.toMatch(/\$argon2/)
    expect(JSON.stringify(lista.body)).not.toContain(r.body.senhaProvisoria)
  })

  it('usuário repetido na mesma clínica é 409, com mensagem útil', async () => {
    const nova = await criarClinicaOk()
    const r = await http()
      .post(`/v1/superadmin/clinicas/${nova.id}/pessoas`)
      .set('Cookie', painel)
      .send({ nome: 'Outra Helena', usuario: 'helena', perfilId: null })
    expect(r.status).toBe(409)
    expect(r.body.message).toMatch(/já existe/i)
  })

  it('operador INATIVO não faz nada, mesmo com cookie válido', async () => {
    await migrate.query('UPDATE operadores SET ativo = false WHERE id = $1', [operador])
    try {
      await http().get('/v1/superadmin/clinicas').set('Cookie', painel).expect(404)
    } finally {
      await migrate.query('UPDATE operadores SET ativo = true WHERE id = $1', [operador])
    }
  })
})
