import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { NOME_DO_COOKIE } from '../autenticacao/sessao.guard'
import {
  apagarClinicaDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'

/**
 * A SESSÃO DE SUPORTE, PELA API — decisão D-13.
 *
 * O operador clica na clínica no painel e já está dentro do sistema dela,
 * logado, com privilégio de administradora, **sem virar uma pessoa dela**.
 *
 * Este arquivo cobra os invariantes 1, 2, 3 e 5 na borda HTTP, que é onde a
 * recepção e o operador de fato os encontram. O invariante 4 (a tela diz que
 * é uma sessão do painel) é cobrado por `faixa-de-suporte.test.ts`, na web.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA_OP = 'quatro-pedras-no-caminho'
const SENHA_ADMIN = 'treze-janelas-de-vidro'

const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `sup.${sufixo}`

let app: NestFastifyApplication
let migrate: pg.Client
let operador: string
let painel: string
/** Duas clínicas: o isolamento só se mede com um vizinho. */
let clinicaA: { id: string; codigo: string }
let clinicaB: { id: string; codigo: string }
let adminA: string

const http = () => request(app.getHttpServer())

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')

/** O atributo do cookie do produto, como o navegador o leria. */
const atributosDoCookieDoProduto = (r: { headers: Record<string, string> }): string =>
  cookies(r).find((c) => c.startsWith(`${NOME_DO_COOKIE}=`)) ?? ''

let proximo = 0

async function criarClinica(): Promise<{ id: string; codigo: string }> {
  const codigo = `sup${sufixo}x${proximo++}`
  const id = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, $2, 'America/Bahia') RETURNING id`,
      [codigo, `Clínica ${codigo}`],
    )
  ).rows[0]!.id
  return { id, codigo }
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash)
       VALUES ($1, 'Dono do Painel', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id

  clinicaA = await criarClinica()
  clinicaB = await criarClinica()

  adminA = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, funcao, senha_hash, admin)
       VALUES ($1, 'Dra. Helena', 'helena', 'Administradora', $2, true) RETURNING id`,
      [clinicaA.id, await hashDeSenha(SENHA_ADMIN)],
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
  await app.close()
  await declararAtorSistema(migrate)
  await apagarClinicaDeTeste(migrate, clinicaA.id)
  await apagarClinicaDeTeste(migrate, clinicaB.id)
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await apagarOperadorDeTeste(migrate, operador)
  await migrate.end()
})

/** Abre a sessão de suporte numa clínica e devolve o par de cookie do produto. */
async function abrirSuporte(clinicaId: string): Promise<{ cookie: string; corpo: any; resp: any }> {
  const r = await http()
    .post(`/v1/superadmin/clinicas/${clinicaId}/sessao-de-suporte`)
    .set('Cookie', painel)
    .expect(201)
  return { cookie: paresDe(cookies(r)), corpo: r.body, resp: r }
}

// ---------------------------------------------------------------------------

describe('o operador abre o sistema da clínica num clique', () => {
  it('a rota do painel devolve a clínica e o prazo, e põe o cookie do PRODUTO', async () => {
    const { corpo, resp } = await abrirSuporte(clinicaA.id)
    expect(corpo.clinica.codigo).toBe(clinicaA.codigo)
    expect(corpo.clinica.id).toBe(clinicaA.id)
    expect(typeof corpo.expiraEm).toBe('string')

    const cookie = atributosDoCookieDoProduto(resp)
    expect(cookie, 'a rota não pôs o cookie do produto').not.toBe('')
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/Path=\//i)
  })

  it('sem cookie de painel ela responde 404, como toda rota de painel', async () => {
    await http().post(`/v1/superadmin/clinicas/${clinicaA.id}/sessao-de-suporte`).expect(404)
  })

  it('clínica inexistente é 404; o uuid malformado também', async () => {
    await http()
      .post('/v1/superadmin/clinicas/00000000-0000-4000-8000-000000000000/sessao-de-suporte')
      .set('Cookie', painel)
      .expect(404)
    await http()
      .post('/v1/superadmin/clinicas/nao-e-uuid/sessao-de-suporte')
      .set('Cookie', painel)
      .expect(404)
  })

  it('`GET /v1/eu` diz OPERADOR e não pessoa — e nomeia a clínica certa', async () => {
    const { cookie } = await abrirSuporte(clinicaA.id)
    const r = await http().get('/v1/eu').set('Cookie', cookie).expect(200)
    expect(r.body.usuario, 'a sessão de suporte inventou uma pessoa').toBeNull()
    expect(r.body.operador.id).toBe(operador)
    expect(r.body.operador.usuario).toBe(USUARIO_OP)
    expect(r.body.operador.nome).toBe('Dono do Painel')
    expect(r.body.clinica.codigo).toBe(clinicaA.codigo)
    expect(r.body.clinica.fuso).toBe('America/Bahia')
    // O dia de negócio continua vindo do servidor, no fuso DA CLÍNICA.
    expect(r.body.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('a sessão de PESSOA continua dizendo pessoa, e `operador` é null', async () => {
    const r = await http()
      .post('/v1/entrar')
      .send({ clinica: clinicaA.codigo, usuario: 'helena', senha: SENHA_ADMIN })
      .expect(200)
    expect(r.body.usuario.id).toBe(adminA)
    expect(r.body.operador).toBeNull()
  })

  it('ele vê tudo: a tela de Usuários e acessos, que exige `config`', async () => {
    const { cookie } = await abrirSuporte(clinicaA.id)
    const r = await http().get('/v1/pessoas').set('Cookie', cookie).expect(200)
    expect(r.body.pessoas.length).toBeGreaterThan(0)
  })

  it('e vê DINHEIRO: a redação de valores não o apaga, porque ele tem acesso total', async () => {
    const { cookie } = await abrirSuporte(clinicaA.id)
    const r = await http().get('/v1/financeiro/caixa/hoje').set('Cookie', cookie)
    // A rota existe e responde; o que se mede é não ter virado 403 por falta
    // de `caixa`/`valores`. O corpo em si é de outra suíte.
    expect([200, 404]).toContain(r.status)
  })
})

// ---------------------------------------------------------------------------

describe('INVARIANTE 1 — ele não aparece como pessoa da clínica', () => {
  it('não está em Usuários e acessos', async () => {
    const { cookie } = await abrirSuporte(clinicaA.id)
    const r = await http().get('/v1/pessoas').set('Cookie', cookie).expect(200)
    const itens = r.body.pessoas as { id: string; usuario: string; nome: string }[]
    expect(
      itens.map((p) => p.usuario),
      'o operador apareceu na lista de usuários da clínica',
    ).not.toContain(USUARIO_OP)
    expect(itens.map((p) => p.id)).not.toContain(operador)
    expect(itens.map((p) => p.nome)).not.toContain('Dono do Painel')
  })

  it('não está na EQUIPE — nem como ficha, nem como opção de gestor', async () => {
    const { cookie } = await abrirSuporte(clinicaA.id)
    const r = await http().get('/v1/fichas').set('Cookie', cookie).expect(200)
    const texto = JSON.stringify(r.body)
    expect(texto, 'o operador apareceu na tela Equipe').not.toContain(USUARIO_OP)
    expect(texto).not.toContain(operador)
  })

  it('não entra na contagem de pessoas da clínica — a lista é EXATAMENTE a da clínica', async () => {
    /**
     * CONTAGEM ABSOLUTA, e não um delta.
     *
     * Um delta (antes/depois) passa quando a linha indevida já foi criada por
     * um teste anterior — medido: a mutação "crie uma `pessoa` para o
     * operador" com `ON CONFLICT DO NOTHING` sobreviveu ao delta inteiro,
     * porque a primeira sessão de suporte deste arquivo já a tinha criado.
     * A clínica tem UMA pessoa (a fixture), e é isso que se mede.
     */
    await abrirSuporte(clinicaA.id)
    await abrirSuporte(clinicaA.id)

    const r = await migrate.query<{ id: string; nome: string; usuario: string }>(
      'SELECT id, nome, usuario FROM pessoas WHERE clinica_id = $1 ORDER BY nome',
      [clinicaA.id],
    )
    expect(
      r.rows.map((p) => p.usuario),
      'nasceu uma pessoa que a clínica não criou — o operador virou `pessoa` dela',
    ).toEqual(['helena'])
    expect(r.rows.map((p) => p.id)).toEqual([adminA])
  })

  it('não troca senha de pessoa nenhuma: `POST /v1/eu/senha` é recusado', async () => {
    const { cookie } = await abrirSuporte(clinicaA.id)
    await http()
      .post('/v1/eu/senha')
      .set('Cookie', cookie)
      .send({ atual: SENHA_OP, nova: 'outra-senha-bem-longa-aqui' })
      .expect(403)
  })
})

// ---------------------------------------------------------------------------

describe('INVARIANTE 2 — a escrita dele cai na trilha DELA como operador', () => {
  it('criar um paciente pela sessão de suporte grava `ator_tipo = operador`', async () => {
    const { cookie } = await abrirSuporte(clinicaA.id)
    const nome = `Paciente do Suporte ${sufixo}`
    const criado = await http()
      .post('/v1/pacientes')
      .set('Cookie', cookie)
      .send({ nome, telefone: '71999990000' })
      .expect(201)

    const r = await migrate.query<{
      ator_tipo: string
      ator_id: string | null
      acao: string
      clinica_id: string
    }>(
      `SELECT ator_tipo, ator_id, acao, clinica_id FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pacientes' AND entidade_id = $2
        ORDER BY id`,
      [clinicaA.id, criado.body.id],
    )
    expect(r.rows.length).toBeGreaterThan(0)
    const linha = r.rows[0]!
    expect(linha.ator_tipo, 'a escrita do operador foi atribuída a uma pessoa').toBe('operador')
    expect(linha.ator_id).toBe(operador)
    expect(linha.acao).toBe('criou')
    expect(linha.clinica_id, 'a trilha foi para a clínica errada').toBe(clinicaA.id)
  })

  it('a LEITURA de dado sensível também fica na trilha, como operador', async () => {
    const { cookie } = await abrirSuporte(clinicaA.id)
    const criado = await http()
      .post('/v1/pacientes')
      .set('Cookie', cookie)
      .send({ nome: `Ficha Lida ${sufixo}` })
      .expect(201)

    await http().get(`/v1/pacientes/${criado.body.id}`).set('Cookie', cookie).expect(200)

    const r = await migrate.query<{ ator_tipo: string; ator_id: string | null }>(
      `SELECT ator_tipo, ator_id FROM auditoria
        WHERE clinica_id = $1 AND acao = 'acessou' AND entidade_id = $2`,
      [clinicaA.id, criado.body.id],
    )
    expect(r.rows.length).toBeGreaterThan(0)
    expect(r.rows[0]!.ator_tipo).toBe('operador')
    expect(r.rows[0]!.ator_id).toBe(operador)
  })

  it('nenhuma linha da clínica atribui a uma PESSOA o que o operador fez', async () => {
    const r = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM auditoria
        WHERE clinica_id = $1 AND ator_id = $2 AND ator_tipo <> 'operador'`,
      [clinicaA.id, operador],
    )
    expect(r.rows[0]!.n).toBe('0')
  })
})

// ---------------------------------------------------------------------------

describe('INVARIANTE 3 — uma clínica por sessão, e a RLS vale', () => {
  it('a sessão aberta em A não enxerga nada de B', async () => {
    const { cookie } = await abrirSuporte(clinicaA.id)
    const eu = await http().get('/v1/eu').set('Cookie', cookie).expect(200)
    expect(eu.body.clinica.id).toBe(clinicaA.id)
    expect(eu.body.clinica.id).not.toBe(clinicaB.id)

    // O paciente criado em A não pode aparecer numa sessão de suporte de B.
    const nome = `So Em A ${sufixo}`
    await http().post('/v1/pacientes').set('Cookie', cookie).send({ nome }).expect(201)

    const emB = await abrirSuporte(clinicaB.id)
    const lista = await http()
      .get('/v1/pacientes')
      .set('Cookie', emB.cookie)
      .query({ busca: nome })
      .expect(200)
    expect(JSON.stringify(lista.body), 'a sessão de B alcançou paciente de A').not.toContain(nome)
  })

  it('cada clínica é uma sessão diferente — abrir B não move a sessão de A', async () => {
    const emA = await abrirSuporte(clinicaA.id)
    const emB = await abrirSuporte(clinicaB.id)
    const a = await http().get('/v1/eu').set('Cookie', emA.cookie).expect(200)
    const b = await http().get('/v1/eu').set('Cookie', emB.cookie).expect(200)
    expect(a.body.clinica.id).toBe(clinicaA.id)
    expect(b.body.clinica.id).toBe(clinicaB.id)
  })

  it('a clínica DESATIVADA é recusada — agir numa é erro', async () => {
    const desativada = await criarClinica()
    await migrate.query('UPDATE clinicas SET ativa = false WHERE id = $1', [desativada.id])
    try {
      await http()
        .post(`/v1/superadmin/clinicas/${desativada.id}/sessao-de-suporte`)
        .set('Cookie', painel)
        .expect(409)
    } finally {
      await declararAtorSistema(migrate)
      await apagarClinicaDeTeste(migrate, desativada.id)
    }
  })
})

// ---------------------------------------------------------------------------

describe('INVARIANTE 5 — curta e revogável', () => {
  it('a sessão dura TRINTA MINUTOS, não os trinta dias do balcão', async () => {
    const { corpo, resp } = await abrirSuporte(clinicaA.id)
    const prazo = new Date(corpo.expiraEm).getTime() - Date.now()
    expect(prazo).toBeGreaterThan(25 * 60 * 1000)
    expect(prazo, 'a sessão de suporte herdou o prazo do balcão').toBeLessThanOrEqual(
      31 * 60 * 1000,
    )
    // E o cookie não sobrevive ao prazo da linha: `Max-Age` em segundos.
    expect(atributosDoCookieDoProduto(resp)).toMatch(/Max-Age=1800\b/)
  })

  it('`POST /v1/sair` mata a sessão de suporte — e não estoura', async () => {
    const { cookie } = await abrirSuporte(clinicaA.id)
    await http().get('/v1/eu').set('Cookie', cookie).expect(200)
    await http().post('/v1/sair').set('Cookie', cookie).expect(204)
    await http().get('/v1/eu').set('Cookie', cookie).expect(401)
  })

  it('sair do PAINEL derruba as sessões de suporte abertas em todas as clínicas', async () => {
    // Sessão de painel própria, para não derrubar a dos outros testes.
    const outro = paresDe(
      cookies(
        await http()
          .post('/v1/superadmin/entrar')
          .send({ usuario: USUARIO_OP, senha: SENHA_OP })
          .expect(200),
      ),
    )
    const emA = paresDe(
      cookies(
        await http()
          .post(`/v1/superadmin/clinicas/${clinicaA.id}/sessao-de-suporte`)
          .set('Cookie', outro)
          .expect(201),
      ),
    )
    const emB = paresDe(
      cookies(
        await http()
          .post(`/v1/superadmin/clinicas/${clinicaB.id}/sessao-de-suporte`)
          .set('Cookie', outro)
          .expect(201),
      ),
    )
    await http().get('/v1/eu').set('Cookie', emA).expect(200)
    await http().get('/v1/eu').set('Cookie', emB).expect(200)

    await http().post('/v1/superadmin/sair').set('Cookie', outro).expect(204)

    await http().get('/v1/eu').set('Cookie', emA).expect(401)
    await http().get('/v1/eu').set('Cookie', emB).expect(401)
  })

  it('desativar o operador derruba a sessão de suporte no instante seguinte', async () => {
    const { cookie } = await abrirSuporte(clinicaA.id)
    await http().get('/v1/eu').set('Cookie', cookie).expect(200)
    await migrate.query('UPDATE operadores SET ativo = false WHERE id = $1', [operador])
    try {
      await http().get('/v1/eu').set('Cookie', cookie).expect(401)
    } finally {
      await migrate.query('UPDATE operadores SET ativo = true WHERE id = $1', [operador])
    }
  })
})
