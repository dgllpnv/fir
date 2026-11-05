import type { Relogio } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'
import { hashDeSenha } from './../autenticacao/senha'

/**
 * **O defeito da D-0, corrigido.**
 *
 * Na v20 e no protótipo o administrativo VÊ o PIN de cada pessoa. Aqui ele
 * redefine e **nunca vê**: a senha é hash desde o primeiro instante, e a
 * provisória existe num único lugar, por um único momento — o corpo da
 * resposta HTTP que a criou.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'montanha-de-vidro-aberta'
const FORMA_DA_PROVISORIA = /^[a-z]+(-[a-z]+){3}$/

const INICIO = new Date('2026-10-28T12:00:00.000Z')
let agora = new Date(INICIO)
const relogioDeTeste: Relogio = { agora: () => agora }
const horas = (n: number) => n * 60 * 60 * 1000
const avancarRelogio = (ms: number) => {
  agora = new Date(agora.getTime() + ms)
}

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let outraClinica: string
let perfilRec: string
let perfilDaOutra: string
let idDaSemConfig: string
const codigo = `pes-${Date.now()}`

const entrar = (usuario: string, senha: string, cod = codigo) =>
  request(app.getHttpServer()).post('/v1/entrar').send({ clinica: cod, usuario, senha })

const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

let admin: string[]
let semConfig: string[]
let adminDaOutra: string[]

const criarPessoa = (sessao: string[], corpo: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/v1/pessoas').set('Cookie', sessao).send(corpo)

const redefinir = (sessao: string[], id: string, senha?: string) =>
  request(app.getHttpServer())
    .post(`/v1/pessoas/${id}/senha`)
    .set('Cookie', sessao)
    .send(senha === undefined ? {} : { senha })

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  const novaClinica = async (cod: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica das Pessoas') RETURNING id`,
        [cod],
      )
    ).rows[0]!.id
  clinica = await novaClinica(codigo)
  outraClinica = await novaClinica(`${codigo}-b`)

  const novoPerfil = async (c: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms)
         VALUES ($1, 'pf_rec', 'Recepção', ARRAY['jornada','receber']) RETURNING id`,
        [c],
      )
    ).rows[0]!.id
  perfilRec = await novoPerfil(clinica)
  perfilDaOutra = await novoPerfil(outraClinica)

  const hash = await hashDeSenha(SENHA)
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin)
     VALUES ($1, 'Helena Prado', 'helena', $2, true)`,
    [clinica, hash],
  )
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin)
     VALUES ($1, 'Vizinha', 'vizinha', $2, true)`,
    [outraClinica, hash],
  )
  idDaSemConfig = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
       VALUES ($1, 'Juliana', 'juliana', $2, $3) RETURNING id`,
      [clinica, hash, perfilRec],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(relogioDeTeste)
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  admin = cookieDe(await entrar('helena', SENHA).expect(200))
  semConfig = cookieDe(await entrar('juliana', SENHA).expect(200))
  adminDaOutra = cookieDe(await entrar('vizinha', SENHA, `${codigo}-b`).expect(200))
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, outraClinica)
  await migrate.end()
  await app.close()
})

beforeEach(async () => {
  agora = new Date(INICIO)
  await migrate.query(
    `DELETE FROM sessoes WHERE pessoa_id IN
       (SELECT id FROM pessoas WHERE clinica_id = $1 AND usuario LIKE 'ana%' OR usuario = 'bia')`,
    [clinica],
  )
  await migrate.query(
    `DELETE FROM pessoas WHERE clinica_id = $1 AND (usuario LIKE 'ana%' OR usuario = 'bia')`,
    [clinica],
  )
})

describe('POST /v1/pessoas', () => {
  it('criar pessoa devolve a provisória UMA vez, e ela nunca mais é legível', async () => {
    const r = await criarPessoa(admin, {
      nome: 'Ana Silva',
      usuario: 'ana.silva',
      funcao: 'Recepção',
      perfilId: perfilRec,
    })
    expect(r.status).toBe(201)
    const prov = r.body.senhaProvisoria as string
    expect(prov).toMatch(FORMA_DA_PROVISORIA)

    // E em lugar nenhum mais: nem na lista da equipe, nem na trilha, nem na
    // própria linha de `pessoas`.
    const equipe = await request(app.getHttpServer()).get('/v1/equipe').set('Cookie', admin)
    expect(JSON.stringify(equipe.body)).not.toContain(prov)

    const linha = await migrate.query(
      'SELECT * FROM pessoas WHERE clinica_id = $1 AND usuario = $2',
      [clinica, 'ana.silva'],
    )
    expect(JSON.stringify(linha.rows[0])).not.toContain(prov)

    const t = await migrate.query<{ de: unknown; para: Record<string, unknown> }>(
      `SELECT de, para FROM auditoria WHERE clinica_id = $1 AND entidade = 'pessoas'
        ORDER BY id DESC LIMIT 1`,
      [clinica],
    )
    expect(JSON.stringify(t.rows[0])).not.toContain(prov)
    expect(t.rows[0]!.para['senha_hash']).toBe('[oculto]')
  })

  it('a pessoa nasce ATIVA, com senha provisória e prazo de 72 horas', async () => {
    const r = await criarPessoa(admin, { nome: 'Ana Silva', usuario: 'ana.silva', perfilId: perfilRec })
    expect(r.status).toBe(201)
    const p = await migrate.query<{
      ativo: boolean
      senha_provisoria: boolean
      senha_provisoria_expira_em: Date
    }>(
      `SELECT ativo, senha_provisoria, senha_provisoria_expira_em FROM pessoas WHERE id = $1`,
      [r.body.id],
    )
    expect(p.rows[0]!.ativo).toBe(true)
    expect(p.rows[0]!.senha_provisoria).toBe(true)
    expect(p.rows[0]!.senha_provisoria_expira_em.getTime()).toBe(INICIO.getTime() + horas(72))
  })

  it('a provisória criada ENTRA, e cai na troca obrigatória', async () => {
    const r = await criarPessoa(admin, { nome: 'Ana Silva', usuario: 'ana.silva', perfilId: perfilRec })
    const s = cookieDe(await entrar('ana.silva', r.body.senhaProvisoria).expect(200))
    const eu = await request(app.getHttpServer()).get('/v1/eu').set('Cookie', s).expect(200)
    expect(eu.body.usuario.senhaProvisoria).toBe(true)
    await request(app.getHttpServer()).get('/v1/hoje').set('Cookie', s).expect(409)
  })

  it('nenhuma rota devolve senha_hash, nunca', async () => {
    await criarPessoa(admin, { nome: 'Ana Silva', usuario: 'ana.silva', perfilId: perfilRec })
    for (const c of [
      await request(app.getHttpServer()).get('/v1/equipe').set('Cookie', admin),
      await request(app.getHttpServer()).get('/v1/eu').set('Cookie', admin),
    ]) {
      expect(JSON.stringify(c.body)).not.toMatch(/\$argon2/)
    }
  })

  it('CRIAR pessoa não aceita senha escolhida — só a TROCA aceita', async () => {
    // **A assimetria é deliberada, e o dono decidiu só metade dela em
    // 2026-11-04:** `POST /v1/pessoas/:id/senha` passou a aceitar `senha`,
    // porque a gerada se perdia; `POST /v1/pessoas` continua recusando.
    //
    // Enquanto for assim, este teste é o que impede a criação de ganhar o
    // campo por descuido — e não por decisão. Se o dono estender a escolha à
    // criação, este teste muda junto; até lá ele guarda a fronteira que
    // existe de fato.
    //
    // Em nenhum dos dois casos o admin conhece a senha de forma DURÁVEL: a
    // escolhida nasce provisória, com 72 horas, e a pessoa é obrigada a
    // trocá-la no primeiro acesso.
    const r = await criarPessoa(admin, {
      nome: 'Bia',
      usuario: 'bia',
      perfilId: perfilRec,
      senha: 'escolhida-por-mim',
    })
    expect(r.status).toBe(400)
    const existe = await migrate.query('SELECT 1 FROM pessoas WHERE clinica_id = $1 AND usuario = $2', [
      clinica,
      'bia',
    ])
    expect(existe.rowCount).toBe(0)
  })

  it('quem não tem `config` recebe 403 nas duas rotas', async () => {
    const a = await criarPessoa(semConfig, { nome: 'Ana', usuario: 'ana.outra', perfilId: perfilRec })
    expect(a.status).toBe(403)
    const b = await redefinir(semConfig, idDaSemConfig)
    expect(b.status).toBe(403)
  })

  it('usuário repetido na mesma clínica é 409, com mensagem útil', async () => {
    await criarPessoa(admin, { nome: 'Ana Silva', usuario: 'ana.silva', perfilId: perfilRec }).expect(
      201,
    )
    const r = await criarPessoa(admin, {
      nome: 'Outra Ana',
      usuario: 'ana.silva',
      perfilId: perfilRec,
    })
    expect(r.status).toBe(409)
    expect(r.body.message).toMatch(/já existe/i)
  })

  it('a clínica vem da SESSÃO: admin da A não alcança a B', async () => {
    // A forma de errar isto é acrescentar um campo `clinicaId` no contrato.
    // O perfil da B não existe visto da A, e a RLS é quem diz isso.
    const r = await criarPessoa(admin, {
      nome: 'Ana Xavier',
      usuario: 'ana.x',
      perfilId: perfilDaOutra,
    })
    expect(r.status).toBe(400)
    // A MENSAGEM importa tanto quanto o status. Com `nome: 'X'` — como este
    // teste nasceu — o 400 vinha do `min(2)` do nome, e o teste passava
    // mesmo sem conferência de perfil nenhuma: provado por mutação.
    expect(r.body.message).toBe('Esse perfil não existe.')
    const naOutra = await migrate.query('SELECT 1 FROM pessoas WHERE clinica_id = $1', [outraClinica])
    expect(naOutra.rowCount).toBe(1) // só a Vizinha
  })

  it('o usuário é validado pela regra do domínio antes de chegar ao banco', async () => {
    const r = await criarPessoa(admin, {
      nome: 'Ana Silva',
      usuario: 'Ana Silva',
      perfilId: perfilRec,
    })
    expect(r.status).toBe(400)
    // A mensagem é a do DOMÍNIO, e é a mesma que a tela mostra antes do
    // envio. Uma frase genérica aqui faria o admin adivinhar no balcão.
    expect(r.body.message).toMatch(/minúsculas|comece por letra/i)
  })

  it('o usuário é canonizado: o que a tela manda e o que o banco guarda é UM', async () => {
    const r = await criarPessoa(admin, {
      nome: 'Ana Silva',
      usuario: '  Ana.Sílva ',
      perfilId: perfilRec,
    }).expect(201)
    // A resposta devolve o CANÔNICO — o admin precisa ditar à pessoa o que o
    // sistema de fato guardou, e não o que ele digitou.
    expect(r.body.usuario).toBe('ana.silva')
    await entrar('ana.silva', r.body.senhaProvisoria).expect(200)
  })
})

describe('POST /v1/pessoas/:id/senha', () => {
  it('redefinir gera NOVA provisória e DERRUBA as sessões da pessoa', async () => {
    // Quem redefine o faz porque desconfia, ou porque a pessoa perdeu o
    // acesso. Se a sessão viva sobrevive à redefinição, ela não serve para o
    // primeiro caso — que é justamente aquele em que ela precisa servir.
    const criada = await criarPessoa(admin, {
      nome: 'Ana Silva',
      usuario: 'ana.silva',
      perfilId: perfilRec,
    }).expect(201)
    const sessaoDaAna = cookieDe(await entrar('ana.silva', criada.body.senhaProvisoria).expect(200))
    await request(app.getHttpServer()).get('/v1/eu').set('Cookie', sessaoDaAna).expect(200)

    const r = await redefinir(admin, criada.body.id as string)
    expect(r.status).toBe(200)
    expect(r.body.senhaProvisoria).toMatch(FORMA_DA_PROVISORIA)
    expect(r.body.senhaProvisoria).not.toBe(criada.body.senhaProvisoria)

    await request(app.getHttpServer()).get('/v1/eu').set('Cookie', sessaoDaAna).expect(401)
    await entrar('ana.silva', r.body.senhaProvisoria).expect(200)
    // E a provisória ANTIGA deixou de valer.
    await entrar('ana.silva', criada.body.senhaProvisoria).expect(401)
  })

  it('a provisória vence em 72 h e deixa de autenticar, sem estado novo vazando', async () => {
    const criada = await criarPessoa(admin, {
      nome: 'Ana Silva',
      usuario: 'ana.silva',
      perfilId: perfilRec,
    }).expect(201)
    avancarRelogio(horas(73))
    const e = await entrar('ana.silva', criada.body.senhaProvisoria)
    expect(e.status).toBe(401)
    // A MESMA frase de qualquer credencial inválida: uma mensagem própria
    // diria ao atacante que a conta existe E que está recém-criada.
    expect(e.body.message).toBe('Usuário ou senha incorretos.')
  })

  it('até 71 h a provisória ainda entra — o prazo não é um arredondamento', async () => {
    const criada = await criarPessoa(admin, {
      nome: 'Ana Silva',
      usuario: 'ana.silva',
      perfilId: perfilRec,
    }).expect(201)
    avancarRelogio(horas(71))
    await entrar('ana.silva', criada.body.senhaProvisoria).expect(200)
  })

  it('redefinir pessoa de outra clínica é 404 — a RLS é quem responde', async () => {
    const criada = await criarPessoa(admin, {
      nome: 'Ana Silva',
      usuario: 'ana.silva',
      perfilId: perfilRec,
    }).expect(201)
    const r = await redefinir(adminDaOutra, criada.body.id as string)
    expect(r.status).toBe(404)
  })

  it('a trilha diz QUEM redefiniu, e não guarda a senha', async () => {
    const criada = await criarPessoa(admin, {
      nome: 'Ana Silva',
      usuario: 'ana.silva',
      perfilId: perfilRec,
    }).expect(201)
    const r = await redefinir(admin, criada.body.id as string).expect(200)

    const helena = (
      await migrate.query<{ id: string }>(
        'SELECT id FROM pessoas WHERE clinica_id = $1 AND usuario = $2',
        [clinica, 'helena'],
      )
    ).rows[0]!.id
    const t = await migrate.query<{
      ator_tipo: string
      ator_id: string
      para: Record<string, unknown>
    }>(
      `SELECT ator_tipo, ator_id, para FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pessoas' AND acao = 'alterou'
        ORDER BY id DESC LIMIT 1`,
      [clinica],
    )
    expect(t.rows[0]!.ator_tipo).toBe('pessoa')
    expect(t.rows[0]!.ator_id).toBe(helena)
    expect(t.rows[0]!.para['senha_hash']).toBe('[oculto]')
    expect(JSON.stringify(t.rows[0])).not.toContain(r.body.senhaProvisoria)
  })

  /* ── A SENHA ESCOLHIDA POR QUEM REDEFINE (decisão do dono, 2026-11-04) ── */

  const comUsuario = async (usuario: string): Promise<string> => {
    const r = await criarPessoa(admin, { nome: `Pessoa ${usuario}`, usuario, perfilId: perfilRec })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    return r.body.id as string
  }

  const entrarComo = (usuario: string, senha: string) =>
    request(app.getHttpServer()).post('/v1/entrar').send({ clinica: codigo, usuario, senha })

  it('a senha ESCOLHIDA passa a valer — é o ponto do pedido', async () => {
    const id = await comUsuario('carla.menezes')
    const r = await redefinir(admin, id, 'nevoeiro-tangerina-pilar')
    expect(r.status, JSON.stringify(r.body)).toBe(200)

    // A metade que importa: ela AUTENTICA. Um 200 que não trocasse a senha
    // deixaria a recepção convencida de que trocou.
    const entrou = await entrarComo('carla.menezes', 'nevoeiro-tangerina-pilar')
    expect(entrou.status, JSON.stringify(entrou.body)).toBe(200)
  })

  it('a escolhida NÃO volta na resposta — quem digitou já sabe', async () => {
    // Ecoar de volta o que o cliente enviou põe a senha no corpo de uma
    // resposta, e daí no log do proxy e no histórico do navegador, sem
    // informar nada a ninguém (regra 21).
    const id = await comUsuario('dora.neves')
    const r = await redefinir(admin, id, 'relampago-cravo-urubu')
    expect(r.body.senhaProvisoria).toBeNull()
    expect(JSON.stringify(r.body)).not.toContain('relampago-cravo-urubu')
  })

  it('a escolhida continua PROVISÓRIA, com prazo — ela não é a senha da pessoa', async () => {
    // O invariante que sustenta a trilha de auditoria: quem digitou a senha a
    // conhece, então ela é bilhete de entrada. Sem a obrigação de trocar, a
    // frase "ninguém além dela sabe a senha dela" deixa de ser verdade e a
    // trilha volta a poder apontar para a pessoa errada.
    const id = await comUsuario('elisa.prado')
    const r = await redefinir(admin, id, 'cachoeira-bussola-trevo')
    expect(r.body.senhaProvisoriaExpiraEm).toBeTruthy()

    const l = await migrate.query<{ provisoria: boolean; expira: Date | null }>(
      'SELECT senha_provisoria AS provisoria, senha_provisoria_expira_em AS expira FROM pessoas WHERE id = $1',
      [id],
    )
    expect(l.rows[0]!.provisoria).toBe(true)
    expect(l.rows[0]!.expira).not.toBeNull()

    // E o guard cobra: entrar funciona, mas rota de negócio responde 409 até
    // a troca.
    const entrou = await entrarComo('elisa.prado', 'cachoeira-bussola-trevo').expect(200)
    const cookie = entrou.headers['set-cookie'] as unknown as string[]
    const tarefas = await request(app.getHttpServer()).get('/v1/tarefas').set('Cookie', cookie)
    expect(tarefas.status).toBe(409)
  })

  it('senha fraca é 422 com a frase do DOMÍNIO, e a senha antiga continua valendo', async () => {
    const id = await comUsuario('fabia.rocha')
    const antes = await redefinir(admin, id).expect(200)

    for (const fraca of ['123', 'senha', '12345678', 'aaaaaaaaaaaa']) {
      const r = await redefinir(admin, id, fraca)
      expect(r.status, `${fraca}: ${JSON.stringify(r.body)}`).toBe(422)
    }

    // A metade que dá dentes: um 422 que ainda assim tivesse gravado o hash
    // seria pior que um 200.
    const entrou = await entrarComo('fabia.rocha', antes.body.senhaProvisoria as string)
    expect(entrou.status, 'a senha anterior deixou de valer depois de um 422').toBe(200)
  })

  it('a senha com o NOME DA PESSOA-ALVO é recusada, não com o de quem digita', async () => {
    // O contexto da regra de força é de quem vai USAR a senha. Um admin
    // escolhendo `joice2026` para a Joice só é pego se o nome dela entrar na
    // conta — e é justamente o que um humano escolhe quando precisa de uma
    // senha "fácil de lembrar" para outra pessoa.
    const id = await comUsuario('gisele.matos')
    const r = await redefinir(admin, id, 'gisele.matos-2026')
    expect(r.status, JSON.stringify(r.body)).toBe(422)
    expect(String(r.body.message)).toContain('não pode conter')
  })

  it('campo desconhecido no corpo é 400, nomeando o campo', async () => {
    const id = await comUsuario('hilda.soares')
    const r = await redefinir(admin, id).send({ senha: 'nevoeiro-tangerina-pilar', prazo: 999 })
    expect(r.status).toBe(400)
    expect(String(r.body.message)).toContain('prazo')
  })

  it('corpo VAZIO continua gerando — o caminho antigo não mudou', async () => {
    const id = await comUsuario('irene.bastos')
    const r = await redefinir(admin, id).expect(200)
    expect(typeof r.body.senhaProvisoria).toBe('string')
    expect((r.body.senhaProvisoria as string).split('-')).toHaveLength(4)
  })
})
