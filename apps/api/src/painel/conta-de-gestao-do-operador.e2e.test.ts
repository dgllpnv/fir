import type { VisaoGeralDaCarteiraSaida } from '@fir/contracts'
import { CHAVES_DE_MODULO } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarOperadorDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { CHAVE_SEGUNDO_FATOR_LIGADO } from '../carteira/segundo-fator/ligado'
import { registrarCookie } from '../main'
import { DURACAO_SESSAO_PAINEL_MS } from './painel.guard'

/**
 * **UM LOGIN SÓ PARA A FIRMARE** (D-23 item 6, ADR 0024), ponta a ponta pela
 * HTTP e contra Postgres real. Seam: HTTP da API + repositórios sobre
 * Postgres real.
 *
 * O que só o banco prova, e por isso mora aqui: o vínculo nasce do gatilho
 * (não de código que alguém esqueça de chamar), uma vez só; a conta não tem
 * senha que confira; o perfil não se rebaixa; desativar o operador derruba as
 * duas sessões na próxima requisição; e as rotas do PAINEL continuam sem
 * dinheiro — o dinheiro chega pela rota da CARTEIRA, sob a sessão dela.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `firmare.${sufixo}`
const USUARIO_OP2 = `segundo.${sufixo}`
const USUARIO_PROV = `prov.${sufixo}`
const USUARIO_COLIDE = `colide.${sufixo}`
const USUARIO_COMUM = `comum.${sufixo}`
const MENSALIDADE = 123_457n

let app: NestFastifyApplication
let migrate: pg.Client
const ids = { op: '', op2: '', prov: '', colide: '', comum: '', comumDeMesmoNome: '', grupo: '', cliente: '' }

const http = () => request(app.getHttpServer())
const cookiesDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const cookieChamado = (r: { headers: Record<string, string> }, nome: string): string | undefined =>
  cookiesDe(r).find((c) => c.startsWith(`${nome}=`))
const par = (c: string | undefined): string => (c ?? '').split(';')[0]!

const um = async (sql: string, p: unknown[]): Promise<string> => (await migrate.query<{ id: string }>(sql, p)).rows[0]!.id

const criarOperador = async (usuario: string, extra = ''): Promise<string> =>
  um(
    `INSERT INTO operadores (usuario, nome, senha_hash${extra ? ', senha_provisoria, senha_provisoria_expira_em' : ''})
     VALUES ($1, $2, $3${extra ? `, true, now() + interval '72 hours'` : ''}) RETURNING id`,
    [usuario, `Nome de ${usuario}`, await hashDeSenha(SENHA)],
  )

const contaDe = async (operadorId: string) =>
  (
    await migrate.query<{
      id: string
      usuario: string
      nome: string
      escopo: string
      grupo_id: string | null
      ativo: boolean
      valores: boolean
      carteira: string
      modulos: string[]
      administrar: boolean
      setor: string | null
      senha_provisoria: boolean
    }>(
      `SELECT u.id, u.usuario, u.nome, u.escopo, u.grupo_id, u.ativo, u.valores, u.carteira, u.modulos,
              u.administrar, u.setor, u.senha_provisoria
         FROM contas_de_gestao_do_operador c JOIN usuarios_gestao u ON u.id = c.usuario_gestao_id
        WHERE c.operador_id = $1`,
      [operadorId],
    )
  ).rows

/** Entra no painel e devolve os dois pares `nome=valor`, mais a resposta. */
const entrarNoPainel = async (usuario = USUARIO_OP) => {
  const r = await http().post('/v1/superadmin/entrar').send({ usuario, senha: SENHA }).expect(200)
  return {
    r,
    painel: par(cookieChamado(r, '__Host-fir-painel')),
    carteira: par(cookieChamado(r, '__Host-fir-carteira')),
    cruCarteira: cookieChamado(r, '__Host-fir-carteira'),
  }
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  // Uma conta de gestão COMUM com o nome de usuário que o próximo operador
  // vai querer: a do operador tem de nascer com outro nome, e esta fica.
  const hash = await hashDeSenha(SENHA)
  ids.comumDeMesmoNome = await um(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo) VALUES ($1, 'Já existia', $2, 'geral') RETURNING id`,
    [USUARIO_COLIDE, hash],
  )
  ids.comum = await um(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, valores) VALUES ($1, 'Comum', $2, 'geral', true) RETURNING id`,
    [USUARIO_COMUM, hash],
  )

  ids.op = await criarOperador(USUARIO_OP)
  ids.op2 = await criarOperador(USUARIO_OP2)
  ids.prov = await criarOperador(USUARIO_PROV, 'provisoria')
  ids.colide = await criarOperador(USUARIO_COLIDE)

  ids.grupo = await um('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`Conta do operador ${sufixo}`])
  ids.cliente = await um(
    `INSERT INTO clientes_carteira (grupo_id, nome, produto, status, mensalidade_centavos)
     VALUES ($1, $2, 'Acelerador FIR', 'ativo', $3) RETURNING id`,
    [ids.grupo, `Cliente ${sufixo}`, MENSALIDADE.toString()],
  )

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  process.env[CHAVE_SEGUNDO_FATOR_LIGADO] = 'false'
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM clientes_carteira WHERE id = $1', [ids.cliente])
  await migrate.query('DELETE FROM grupos WHERE id = $1', [ids.grupo])
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = ANY($1)', [
    [USUARIO_OP, USUARIO_OP2, USUARIO_PROV, USUARIO_COLIDE],
  ])
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador = ANY($1)', [
    [USUARIO_OP, USUARIO_COMUM],
  ])
  for (const id of [ids.op, ids.op2, ids.prov, ids.colide]) await apagarOperadorDeTeste(migrate, id)
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [[ids.comum, ids.comumDeMesmoNome]])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [[ids.comum, ids.comumDeMesmoNome]])
  await migrate.end()
  await app.close()
})

describe('o vínculo nasce com o operador, uma vez só', () => {
  it('criar o operador provisiona UMA conta de gestão: geral, Diretoria, com valores, sem senha provisória', async () => {
    const contas = await contaDe(ids.op)
    expect(contas).toHaveLength(1)
    const c = contas[0]!
    expect(c).toMatchObject({
      usuario: USUARIO_OP,
      nome: `Nome de ${USUARIO_OP}`,
      escopo: 'geral',
      grupo_id: null,
      ativo: true,
      valores: true,
      carteira: 'todos',
      administrar: true,
      setor: 'diretoria',
      senha_provisoria: false,
    })
    expect([...c.modulos].sort()).toEqual([...CHAVES_DE_MODULO].sort())
  })

  it('provisionar de novo, mexer na senha e no nome não cria segunda conta', async () => {
    const antes = (await contaDe(ids.op))[0]!.id
    const de_novo = await migrate.query<{ id: string }>('SELECT provisionar_conta_de_gestao_do_operador($1) AS id', [ids.op])
    expect(de_novo.rows[0]!.id).toBe(antes)
    await migrate.query('UPDATE operadores SET senha_hash = senha_hash WHERE id = $1', [ids.op])
    await migrate.query('UPDATE operadores SET nome = $2 WHERE id = $1', [ids.op, `Renomeado ${sufixo}`])
    const depois = await contaDe(ids.op)
    expect(depois).toHaveLength(1)
    expect(depois[0]!.id).toBe(antes)
    // O nome acompanha o operador.
    expect(depois[0]!.nome).toBe(`Renomeado ${sufixo}`)
    const n = await migrate.query<{ n: string }>(
      'SELECT count(*) AS n FROM contas_de_gestao_do_operador WHERE operador_id = $1',
      [ids.op],
    )
    expect(n.rows[0]!.n).toBe('1')
  })

  it('o nome de usuário já tomado na carteira não é tomado: a conta do operador ganha `.op1`', async () => {
    const c = (await contaDe(ids.colide))[0]!
    expect(c.usuario).toBe(`${USUARIO_COLIDE}.op1`)
    const comum = await migrate.query<{ nome: string; escopo: string }>(
      'SELECT nome, escopo FROM usuarios_gestao WHERE id = $1',
      [ids.comumDeMesmoNome],
    )
    expect(comum.rows[0]).toEqual({ nome: 'Já existia', escopo: 'geral' })
  })

  it('a criação fica na trilha do painel', async () => {
    const c = (await contaDe(ids.op))[0]!
    const t = await migrate.query<{ acao: string; ator_tipo: string }>(
      `SELECT acao, ator_tipo FROM auditoria_do_painel WHERE entidade = 'usuarios_gestao' AND entidade_id = $1`,
      [c.id],
    )
    expect(t.rows).toContainEqual({ acao: 'criou', ator_tipo: 'sistema' })
  })

  it('o vínculo não é gravável pela aplicação: nem fir_painel nem fir_carteira escrevem nele', async () => {
    const p = await migrate.query<{ painel: boolean; carteira: boolean; prov: boolean }>(
      `SELECT has_table_privilege('fir_painel', 'contas_de_gestao_do_operador', 'INSERT') AS painel,
              has_table_privilege('fir_carteira', 'contas_de_gestao_do_operador', 'INSERT') AS carteira,
              has_function_privilege('fir_painel', 'provisionar_conta_de_gestao_do_operador(uuid)', 'EXECUTE') AS prov`,
    )
    expect(p.rows[0]).toEqual({ painel: false, carteira: false, prov: false })
  })
})

describe('a conta não tem senha, e o perfil dela não se edita', () => {
  it('nenhuma senha entra pela porta da carteira — nem a do operador — e o hash é Argon2 bem formado', async () => {
    // Bem formado: o Argon2 roda inteiro e diz "não confere", sem o log de
    // "conferirSenha falhou" que um texto qualquer no lugar do hash daria.
    const escrito: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((s: string | Uint8Array) => {
      escrito.push(String(s))
      return true
    }) as typeof process.stderr.write
    try {
      await http().post('/v1/carteira/entrar').send({ usuario: USUARIO_OP, senha: SENHA }).expect(401)
    } finally {
      process.stderr.write = original
    }
    expect(escrito.join('')).not.toMatch(/conferirSenha falhou/)
  })

  it.each([
    ['rebaixar para um grupo', `UPDATE usuarios_gestao SET escopo = 'grupo', grupo_id = $2, administrar = false WHERE id = $1`],
    ['tirar valores', 'UPDATE usuarios_gestao SET valores = false WHERE id = $1'],
    ['só a minha carteira', `UPDATE usuarios_gestao SET carteira = 'minha' WHERE id = $1`],
    ['tirar uma tela', `UPDATE usuarios_gestao SET modulos = ARRAY['painel']::text[] WHERE id = $1`],
    ['tirar administrar', 'UPDATE usuarios_gestao SET administrar = false WHERE id = $1'],
    ['dar uma senha', `UPDATE usuarios_gestao SET senha_hash = 'outra' WHERE id = $1`],
    [
      'dar uma senha provisória',
      `UPDATE usuarios_gestao SET senha_provisoria = true, senha_provisoria_expira_em = now() + interval '1 day' WHERE id = $1`,
    ],
    ['desativar sem desativar o operador', 'UPDATE usuarios_gestao SET ativo = false WHERE id = $1'],
  ])('recusa %s', async (_rotulo, sql) => {
    const c = (await contaDe(ids.op))[0]!
    const params = sql.includes('$2') ? [c.id, ids.grupo] : [c.id]
    await expect(migrate.query(sql, params)).rejects.toMatchObject({
      code: '23514',
      constraint: 'conta_de_gestao_do_operador_fixa',
    })
  })

  it('pelo painel: a lista marca a conta, e editá-la responde 409 (nunca 500), sem mudar nada', async () => {
    const { painel } = await entrarNoPainel()
    const c = (await contaDe(ids.op))[0]!
    const lista = await http().get('/v1/superadmin/usuarios-gestao').set('Cookie', painel).expect(200)
    const todos = lista.body.usuariosDeGestao as { id: string; contaDoOperador: boolean }[]
    expect(todos.find((u) => u.id === c.id)?.contaDoOperador).toBe(true)
    expect(todos.find((u) => u.id === ids.comum)?.contaDoOperador).toBe(false)

    const r = await http()
      .patch(`/v1/superadmin/usuarios-gestao/${c.id}`)
      .set('Cookie', painel)
      .send({
        nome: c.nome,
        escopo: 'geral',
        grupoId: null,
        ativo: true,
        valores: false,
        carteira: 'todos',
        modulos: [...CHAVES_DE_MODULO],
        administrar: true,
        setor: 'diretoria',
        funcao: null,
        telefone: null,
      })
    expect(r.status).toBe(409)
    expect((await contaDe(ids.op))[0]!.valores).toBe(true)
  })

  it('a conta comum continua editável', async () => {
    await migrate.query(`UPDATE usuarios_gestao SET carteira = 'minha' WHERE id = $1`, [ids.comum])
    await migrate.query(`UPDATE usuarios_gestao SET carteira = 'todos' WHERE id = $1`, [ids.comum])
  })
})

describe('entrar no painel abre a carteira', () => {
  it('o login devolve os DOIS cookies, e o da carteira dura o mesmo que o do painel', async () => {
    const { r, cruCarteira } = await entrarNoPainel()
    expect(cookieChamado(r, '__Host-fir-painel')).toBeDefined()
    expect(cruCarteira).toBeDefined()
    const idade = Math.floor(DURACAO_SESSAO_PAINEL_MS / 1000)
    expect(cruCarteira).toMatch(new RegExp(`Max-Age=${idade}(;|$)`))
    expect(cruCarteira).toMatch(/HttpOnly/)
    expect(cruCarteira).toMatch(/Secure/)
    expect(cruCarteira).toMatch(/SameSite=Strict/)

    // E no BANCO: as duas sessões vencem no mesmo instante, a menos do tempo
    // entre as duas transações.
    const c = (await contaDe(ids.op))[0]!
    const v = await migrate.query<{ dif: number }>(
      `SELECT abs(extract(epoch FROM (
                (SELECT max(expira_em) FROM sessoes_de_carteira WHERE usuario_gestao_id = $1)
              - (SELECT max(expira_em) FROM sessoes_de_operador WHERE operador_id = $2)))) AS dif`,
      [c.id, ids.op],
    )
    expect(Number(v.rows[0]!.dif)).toBeLessThan(5)
  })

  it('a sessão da carteira é a da conta vinculada: escopo geral, com valores e administrar', async () => {
    const { carteira } = await entrarNoPainel()
    const eu = await http().get('/v1/carteira/eu').set('Cookie', carteira).expect(200)
    const c = (await contaDe(ids.op))[0]!
    expect(eu.body.usuarioDeGestao).toMatchObject({
      id: c.id,
      escopo: 'geral',
      grupoId: null,
      valores: true,
      carteira: 'todos',
      administrar: true,
      senhaProvisoria: false,
    })
  })

  it('a Visão geral abre com valores pela sessão da carteira', async () => {
    const { carteira } = await entrarNoPainel()
    const v = (await http().get('/v1/carteira/painel').set('Cookie', carteira).expect(200)).body as VisaoGeralDaCarteiraSaida
    expect(v.podeVerValores).toBe(true)
    expect(v.kpis.mrr).not.toBeNull()
    // O MRR é de todos os grupos (outros e2e criam clientes em paralelo):
    // afirma-se que o desta fixture está DENTRO dele.
    expect(BigInt(v.kpis.mrr!)).toBeGreaterThanOrEqual(MENSALIDADE)
  })

  it('a abertura fica na trilha do painel, com o operador como ator e a conta como entidade', async () => {
    await entrarNoPainel()
    const c = (await contaDe(ids.op))[0]!
    const t = await migrate.query<{ n: string }>(
      `SELECT count(*) AS n FROM auditoria_do_painel
        WHERE ator_tipo = 'operador' AND ator_id = $1 AND acao = 'entrou'
          AND entidade = 'usuarios_gestao' AND entidade_id = $2`,
      [ids.op, c.id],
    )
    expect(Number(t.rows[0]!.n)).toBeGreaterThan(0)
  })

  it('senha PROVISÓRIA não abre a carteira — nem pelo login, nem pela rota de reabrir', async () => {
    const { r, painel } = await entrarNoPainel(USUARIO_PROV)
    expect(cookieChamado(r, '__Host-fir-carteira')).toBeUndefined()
    const re = await http().post('/v1/superadmin/eu/conta-de-gestao').set('Cookie', painel).expect(409)
    expect(re.body.codigo).toBe('SENHA_PROVISORIA_OPERADOR')
  })

  it('a rota de reabrir devolve a sessão a quem largou a carteira, e pede a sessão do painel', async () => {
    const { painel, carteira } = await entrarNoPainel()
    await http().post('/v1/carteira/sair').set('Cookie', carteira).expect(204)
    await http().get('/v1/carteira/eu').set('Cookie', carteira).expect(404)

    const r = await http().post('/v1/superadmin/eu/conta-de-gestao').set('Cookie', painel).expect(204)
    const nova = par(cookieChamado(r, '__Host-fir-carteira'))
    expect(nova).not.toBe('')
    await http().get('/v1/carteira/eu').set('Cookie', nova).expect(200)

    // Sem a sessão do painel, a rota não existe; com a da carteira só, também não.
    await http().post('/v1/superadmin/eu/conta-de-gestao').expect(404)
    await http().post('/v1/superadmin/eu/conta-de-gestao').set('Cookie', nova).expect(404)
  })
})

describe('sair do painel encerra as duas', () => {
  it('as duas sessões morrem no banco, e os dois cookies são limpos', async () => {
    const { painel, carteira } = await entrarNoPainel()
    await http().get('/v1/carteira/eu').set('Cookie', carteira).expect(200)

    const r = await http().post('/v1/superadmin/sair').set('Cookie', `${painel}; ${carteira}`).expect(204)
    const limpos = cookiesDe(r)
    expect(limpos.find((c) => c.startsWith('__Host-fir-painel=;'))).toBeDefined()
    expect(limpos.find((c) => c.startsWith('__Host-fir-carteira=;'))).toBeDefined()

    // O token velho, reapresentado, não vale em nenhum dos dois espaços.
    await http().get('/v1/superadmin/eu').set('Cookie', painel).expect(404)
    await http().get('/v1/carteira/eu').set('Cookie', carteira).expect(404)
  })

  it('a carteira morre mesmo se o navegador não mandar o cookie dela na saída', async () => {
    const { painel, carteira } = await entrarNoPainel()
    await http().post('/v1/superadmin/sair').set('Cookie', painel).expect(204)
    await http().get('/v1/carteira/eu').set('Cookie', carteira).expect(404)
  })
})

describe('operador desativado perde as duas', () => {
  it('na próxima requisição, painel e carteira respondem 404; reativado, a conta volta', async () => {
    const { painel, carteira } = await entrarNoPainel(USUARIO_OP2)
    await http().get('/v1/carteira/eu').set('Cookie', carteira).expect(200)

    await migrate.query('UPDATE operadores SET ativo = false WHERE id = $1', [ids.op2])
    try {
      await http().get('/v1/superadmin/eu').set('Cookie', painel).expect(404)
      await http().get('/v1/carteira/eu').set('Cookie', carteira).expect(404)
      const c = (await contaDe(ids.op2))[0]!
      expect(c.ativo).toBe(false)
      const vivas = await migrate.query<{ n: string }>(
        'SELECT count(*) AS n FROM sessoes_de_carteira WHERE usuario_gestao_id = $1 AND revogada_em IS NULL',
        [c.id],
      )
      expect(vivas.rows[0]!.n).toBe('0')
    } finally {
      await migrate.query('UPDATE operadores SET ativo = true WHERE id = $1', [ids.op2])
    }
    expect((await contaDe(ids.op2))[0]!.ativo).toBe(true)
    // Reativar não ressuscita a sessão revogada: é preciso entrar de novo.
    await http().get('/v1/carteira/eu').set('Cookie', carteira).expect(404)
  })
})

describe('sem o vínculo, não há carteira', () => {
  const USUARIO_SEM = `semvinculo.${sufixo}`
  let operadorSem = ''
  let contaSem = ''

  beforeAll(async () => {
    operadorSem = await criarOperador(USUARIO_SEM)
    contaSem = (await contaDe(operadorSem))[0]!.id
  })
  afterAll(async () => {
    await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_SEM])
    await apagarOperadorDeTeste(migrate, operadorSem)
    await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = $1', [contaSem])
    await migrate.query('DELETE FROM usuarios_gestao WHERE id = $1', [contaSem]).catch(() => undefined)
  })

  it('apagar o vínculo desativa a conta e derruba a sessão; o painel segue, a carteira não reabre (404)', async () => {
    const { painel, carteira } = await entrarNoPainel(USUARIO_SEM)
    await http().get('/v1/carteira/eu').set('Cookie', carteira).expect(200)

    await migrate.query('DELETE FROM contas_de_gestao_do_operador WHERE operador_id = $1', [operadorSem])
    const u = await migrate.query<{ ativo: boolean }>('SELECT ativo FROM usuarios_gestao WHERE id = $1', [contaSem])
    expect(u.rows[0]!.ativo).toBe(false)
    await http().get('/v1/carteira/eu').set('Cookie', carteira).expect(404)

    await http().get('/v1/superadmin/eu').set('Cookie', painel).expect(200)
    const r = await http().post('/v1/superadmin/eu/conta-de-gestao').set('Cookie', painel).expect(404)
    expect(cookieChamado(r, '__Host-fir-carteira')).toBeUndefined()
  })
})

describe('a conta de gestão comum não é afetada', () => {
  it('entrar e sair do painel não toca a sessão dela, e ela não ganha vínculo', async () => {
    const r = await http().post('/v1/carteira/entrar').send({ usuario: USUARIO_COMUM, senha: SENHA }).expect(200)
    const sessaoComum = par(cookieChamado(r, '__Host-fir-carteira'))
    const { painel } = await entrarNoPainel()
    await http().post('/v1/superadmin/sair').set('Cookie', painel).expect(204)
    await http().get('/v1/carteira/eu').set('Cookie', sessaoComum).expect(200)

    const v = await migrate.query<{ n: string }>(
      'SELECT count(*) AS n FROM contas_de_gestao_do_operador WHERE usuario_gestao_id = ANY($1)',
      [[ids.comum, ids.comumDeMesmoNome]],
    )
    expect(v.rows[0]!.n).toBe('0')
  })
})

describe('as rotas do PAINEL continuam sem dinheiro', () => {
  it('com as duas sessões no navegador, a lista de clientes do painel sai redigida; a da carteira, não', async () => {
    const { painel, carteira } = await entrarNoPainel()
    const ambos = `${painel}; ${carteira}`
    const lista = await http().get('/v1/superadmin/clientes-carteira').set('Cookie', ambos).expect(200)
    const meu = (lista.body.clientes as { id: string; mensalidade: string | null }[]).find((c) => c.id === ids.cliente)
    expect(meu).toBeDefined()
    expect(meu!.mensalidade).toBeNull()

    const ficha = await http().get(`/v1/carteira/clientes/${ids.cliente}`).set('Cookie', ambos).expect(200)
    expect(ficha.body.cliente.mensalidade).toBe(MENSALIDADE.toString())
  })
})

describe('com o segundo fator LIGADO, a entrada única não o contorna', () => {
  it('o login não abre a carteira, a rota de reabrir responde 409, e uma sessão já aberta é barrada', async () => {
    const antes = await entrarNoPainel()
    await http().get('/v1/carteira/painel').set('Cookie', antes.carteira).expect(200)

    process.env[CHAVE_SEGUNDO_FATOR_LIGADO] = 'true'
    try {
      const { r, painel } = await entrarNoPainel()
      expect(cookieChamado(r, '__Host-fir-carteira')).toBeUndefined()
      const re = await http().post('/v1/superadmin/eu/conta-de-gestao').set('Cookie', painel).expect(409)
      expect(re.body.codigo).toBe('CONTA_DE_GESTAO_COM_SEGUNDO_FATOR')
      // A sessão aberta com a chave desligada nasceu sem `segundo_fator_em`:
      // o guard a trata como qualquer sessão sem código.
      const barrada = await http().get('/v1/carteira/painel').set('Cookie', antes.carteira).expect(409)
      expect(barrada.body.codigo).toBe('SEGUNDO_FATOR_CARTEIRA')
    } finally {
      process.env[CHAVE_SEGUNDO_FATOR_LIGADO] = 'false'
    }
  })
})
