import { decodificarBase32, passoDoInstante } from '@fir/domain'
import { Logger } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { apagarOperadorDeTeste, declararAtorSistema } from '../../banco/limpeza-de-teste'
import { RELOGIO } from '../../comum/relogio'
import { registrarCookie } from '../../main'
import { LimitePorOrigem } from '../../autenticacao/limite-por-origem'
import { CODIGO_DESAFIO_INVALIDO } from '../carteira.controller'
import { LIMITE_DA_CARTEIRA } from '../limite-da-carteira'
import { CODIGO_SEGUNDO_FATOR_DA_CARTEIRA } from './segundo-fator.guard'
import { hotp } from './totp'

/**
 * O SEGUNDO FATOR DA CARTEIRA (gate appsec A-12), ponta a ponta: app inteiro,
 * Postgres real, relógio deslocável. Os casos de abuso 26–35 do gate.
 *
 * A obrigatoriedade é medida LIGADA aqui (o `vitest.config.ts` a relaxa para
 * os outros e2e da carteira; o guard lê a variável a cada requisição).
 */
process.env['SEGUNDO_FATOR_CARTEIRA_OPCIONAL_FORA_DE_PRODUCAO'] = '0'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'cadeira-amarela-no-quintal'
const SENHA_OP = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `op2fa.${sufixo}`

/** O relógio do servidor, deslocável: anda em passos de 30 s sem esperar. */
const relogio = { desvioMs: 0, agora: () => new Date(Date.now() + relogio.desvioMs) }
const avancarPassos = (n: number) => {
  relogio.desvioMs += n * 30_000
}

let app: NestFastifyApplication
let migrate: pg.Client
let operador: string
let painel: string
const criados: string[] = []

// --- captura de TUDO que o processo escreve (logger do Nest, console, stdout)
const capturado: string[] = []
const respostas: string[] = []
const escritaOriginal = { out: process.stdout.write.bind(process.stdout), err: process.stderr.write.bind(process.stderr) }

const http = () => request(app.getHttpServer())
const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const cookieChamado = (r: { headers: Record<string, string> }, nome: string): string | null =>
  cookies(r)
    .map((c) => c.split(';')[0]!)
    .find((c) => c.startsWith(`${nome}=`) && c.length > nome.length + 1) ?? null
const SESSAO = '__Host-fir-carteira'
const DESAFIO = '__Host-fir-carteira-desafio'

/** Toda resposta é guardada para a varredura final do segredo. */
const guardar = <T extends { text?: string; headers: Record<string, string> }>(r: T): T => {
  respostas.push(r.text ?? '', JSON.stringify(r.headers))
  return r
}

const criarUsuario = async (usuario: string): Promise<string> => {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
     VALUES ($1, 'Gestora Dois Fatores', $2, 'geral', NULL) RETURNING id`,
    [usuario, await hashDeSenha(SENHA)],
  )
  criados.push(r.rows[0]!.id)
  return r.rows[0]!.id
}

const codigo = (segredo: string, delta = 0): string =>
  hotp(Buffer.from(decodificarBase32(segredo)!), passoDoInstante(relogio.agora()) + delta)

/** Senha → sessão SEM segundo fator (conta ainda sem TOTP). */
const entrarSemTotp = async (usuario: string): Promise<string> => {
  const r = guardar(await http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA }).expect(200))
  expect(r.body.segundoFator).toEqual({ ativo: false })
  return cookieChamado(r, SESSAO)!
}

/** Senha → desafio (conta com TOTP). Nenhuma sessão. */
const desafiar = async (usuario: string): Promise<string> => {
  const r = guardar(await http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA }).expect(200))
  expect(r.body).toEqual({ segundoFatorExigido: true })
  expect(cookieChamado(r, SESSAO)).toBeNull()
  return cookieChamado(r, DESAFIO)!
}

const segundaEtapa = async (desafio: string, corpo: object) =>
  guardar(await http().post('/v1/carteira/entrar').set('Cookie', desafio).send(corpo))

/** Cadastro completo; devolve o segredo base32, os códigos e a sessão. */
const cadastrar = async (usuario: string) => {
  const sessao = await entrarSemTotp(usuario)
  const c = guardar(await http().post('/v1/carteira/eu/segundo-fator/cadastro').set('Cookie', sessao).send({ senha: SENHA }).expect(200))
  const segredo = c.body.segredo as string
  const ok = guardar(
    await http().post('/v1/carteira/eu/segundo-fator/confirmar').set('Cookie', sessao).send({ codigo: codigo(segredo) }).expect(200),
  )
  return { segredo, uri: c.body.uri as string, codigos: ok.body.codigosDeRecuperacao as string[], sessao }
}

beforeAll(async () => {
  process.stdout.write = ((chunk: unknown, ...resto: unknown[]) => {
    capturado.push(String(chunk))
    return (escritaOriginal.out as (...a: unknown[]) => boolean)(chunk, ...resto)
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown, ...resto: unknown[]) => {
    capturado.push(String(chunk))
    return (escritaOriginal.err as (...a: unknown[]) => boolean)(chunk, ...resto)
  }) as typeof process.stderr.write

  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(relogio)
    // O limite POR ORIGEM (20) contaria as dezenas de entradas deste arquivo,
    // todas do loopback; quem o mede é o e2e da carteira. Aqui se mede o POR CONTA.
    .overrideProvider(LIMITE_DA_CARTEIRA)
    .useValue(new LimitePorOrigem(5000, 15 * 60 * 1000))
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const p = await http().post('/v1/superadmin/entrar').send({ usuario: USUARIO_OP, senha: SENHA_OP }).expect(200)
  painel = cookies(p).map((c) => c.split(';')[0]!).join('; ')
})

afterAll(async () => {
  process.stdout.write = escritaOriginal.out
  process.stderr.write = escritaOriginal.err
  await declararAtorSistema(migrate)
  const identificadores = criados.map((id) => `usuario_gestao:${id}`)
  await migrate.query(`DELETE FROM tentativas_de_carteira WHERE identificador LIKE $1 OR identificador = ANY($2)`, [
    `%.${sufixo}`,
    identificadores,
  ])
  await migrate.query('DELETE FROM codigos_de_recuperacao_da_carteira WHERE usuario_gestao_id = ANY($1)', [criados])
  await migrate.query('DELETE FROM desafios_de_carteira WHERE usuario_gestao_id = ANY($1)', [criados])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [criados])
  await migrate.query('DELETE FROM segundo_fator_da_carteira WHERE usuario_gestao_id = ANY($1)', [criados])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [criados])
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await apagarOperadorDeTeste(migrate, operador)
  await migrate.end()
  await app.close()
})

describe('obrigatoriedade — sessão sem segundo fator (A-12)', () => {
  it('só alcança cadastro, eu e sair; qualquer outra rota é 409 com o código da carteira', async () => {
    const usuario = `obrig.${sufixo}`
    await criarUsuario(usuario)
    const sessao = await entrarSemTotp(usuario)

    const eu = await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(200)
    expect(eu.body.segundoFator).toEqual({ ativo: false })
    await http().get('/v1/carteira/eu/segundo-fator').set('Cookie', sessao).expect(200)

    const preso = await http().get('/v1/carteira/clientes').set('Cookie', sessao).expect(409)
    expect(preso.body.codigo).toBe(CODIGO_SEGUNDO_FATOR_DA_CARTEIRA)
    // Regenerar códigos não é rota de cadastro: também presa.
    await http().post('/v1/carteira/eu/segundo-fator/codigos').set('Cookie', sessao).send({ senha: SENHA, codigo: '123456' }).expect(409)
    // A troca de senha voluntária também: só a provisória atravessa.
    await http().post('/v1/carteira/eu/senha').set('Cookie', sessao).send({ atual: SENHA, nova: 'outra-frase-bem-comprida' }).expect(409)
  })
})

describe('cadastro', () => {
  it('exige a senha, devolve URI e segredo uma vez, ativa com o primeiro código e gera 10 códigos', async () => {
    const usuario = `cad.${sufixo}`
    const id = await criarUsuario(usuario)
    const sessao = await entrarSemTotp(usuario)
    const outra = await entrarSemTotp(usuario)

    await http().post('/v1/carteira/eu/segundo-fator/cadastro').set('Cookie', sessao).send({ senha: 'errada-errada-errada' }).expect(403)

    const c = await http().post('/v1/carteira/eu/segundo-fator/cadastro').set('Cookie', sessao).send({ senha: SENHA }).expect(200)
    expect(c.headers['cache-control']).toBe('no-store')
    const segredo = c.body.segredo as string
    expect(decodificarBase32(segredo)).toHaveLength(20)
    expect(c.body.uri).toBe(
      `otpauth://totp/Firmare%20Carteira:${usuario}?secret=${segredo}&issuer=Firmare%20Carteira&algorithm=SHA1&digits=6&period=30`,
    )

    // Em repouso: só ciphertext, pendente.
    const pendente = await migrate.query<{ cifrado: Buffer; ativado: Date | null }>(
      'SELECT segredo_cifrado AS cifrado, ativado_em AS ativado FROM segundo_fator_da_carteira WHERE usuario_gestao_id = $1',
      [id],
    )
    expect(pendente.rows[0]!.ativado).toBeNull()
    expect(pendente.rows[0]!.cifrado.includes(Buffer.from(decodificarBase32(segredo)!))).toBe(false)
    expect(pendente.rows[0]!.cifrado.toString('latin1')).not.toContain(segredo)

    // Pendente ainda não abre nada.
    await http().get('/v1/carteira/clientes').set('Cookie', sessao).expect(409)

    await http().post('/v1/carteira/eu/segundo-fator/confirmar').set('Cookie', sessao).send({ codigo: codigo(segredo, 3) }).expect(401)
    const ok = await http().post('/v1/carteira/eu/segundo-fator/confirmar').set('Cookie', sessao).send({ codigo: codigo(segredo) }).expect(200)
    const codigos = ok.body.codigosDeRecuperacao as string[]
    expect(codigos).toHaveLength(10)
    for (const k of codigos) expect(k).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/)

    // A MESMA sessão segue, agora verificada; a outra caiu (caso 33).
    await http().get('/v1/carteira/clientes').set('Cookie', sessao).expect(200)
    await http().get('/v1/carteira/eu').set('Cookie', outra).expect(404)

    // Os códigos estão só como hash.
    const hashes = await migrate.query<{ hash: string }>('SELECT hash FROM codigos_de_recuperacao_da_carteira WHERE usuario_gestao_id = $1', [id])
    expect(hashes.rows).toHaveLength(10)
    const brutos = codigos.map((k) => k.replace(/-/g, ''))
    for (const h of hashes.rows) {
      expect(h.hash).toMatch(/^[0-9a-f]{64}$/)
      for (const b of brutos) expect(h.hash).not.toContain(b)
    }

    // Depois da confirmação, nenhuma rota devolve o segredo; recadastrar é 409.
    const estado = await http().get('/v1/carteira/eu/segundo-fator').set('Cookie', sessao).expect(200)
    expect(estado.body).toMatchObject({ ativo: true, codigosRestantes: 10 })
    expect(estado.text).not.toContain(segredo)
    await http().post('/v1/carteira/eu/segundo-fator/cadastro').set('Cookie', sessao).send({ senha: SENHA }).expect(409)

    const trilha = await migrate.query<{ ator_tipo: string; para: unknown }>(
      `SELECT ator_tipo, para FROM auditoria_do_painel WHERE entidade = 'usuarios_gestao' AND entidade_id = $1`,
      [id],
    )
    expect(trilha.rows).toEqual([{ ator_tipo: 'usuario_gestao', para: { segundo_fator: 'ativado' } }])
  })
})

describe('login com segundo fator', () => {
  it('senha certa dá um DESAFIO, que não abre rota nenhuma; o código certo dá a sessão (caso 26)', async () => {
    const usuario = `login.${sufixo}`
    const id = await criarUsuario(usuario)
    const { segredo } = await cadastrar(usuario)
    avancarPassos(5)

    const desafio = await desafiar(usuario)
    // O desafio no lugar do cookie de sessão: nada.
    const comoSessao = desafio.replace(`${DESAFIO}=`, `${SESSAO}=`)
    await http().get('/v1/carteira/eu').set('Cookie', comoSessao).expect(404)
    await http().get('/v1/carteira/clientes').set('Cookie', desafio).expect(404)

    const r = await segundaEtapa(desafio, { codigo: codigo(segredo) })
    expect(r.status).toBe(200)
    expect(r.body.segundoFator).toEqual({ ativo: true })
    expect(r.body.avisoDeRecuperacao).toBeNull()
    const sessao = cookieChamado(r, SESSAO)!
    await http().get('/v1/carteira/clientes').set('Cookie', sessao).expect(200)

    const s = await migrate.query<{ n: string }>(
      'SELECT count(*) AS n FROM sessoes_de_carteira WHERE usuario_gestao_id = $1 AND segundo_fator_em IS NOT NULL AND revogada_em IS NULL',
      [id],
    )
    expect(Number(s.rows[0]!.n)).toBeGreaterThanOrEqual(1)

    // O desafio é de uso único.
    const de_novo = await segundaEtapa(desafio, { codigo: codigo(segredo, 1) })
    expect(de_novo.status).toBe(401)
    expect(de_novo.body.codigo).toBe(CODIGO_DESAFIO_INVALIDO)
  })

  it('código errado: 401, sob o piso de resposta (caso 34)', async () => {
    const usuario = `errado.${sufixo}`
    await criarUsuario(usuario)
    const { segredo } = await cadastrar(usuario)
    avancarPassos(5)
    const desafio = await desafiar(usuario)
    const inicio = performance.now()
    const r = await segundaEtapa(desafio, { codigo: codigo(segredo, 7) })
    expect(r.status).toBe(401)
    expect(r.body.message).toBe('Código incorreto.')
    expect(performance.now() - inicio).toBeGreaterThanOrEqual(90)
    // Formato inválido conta como código errado, não como 400.
    expect((await segundaEtapa(desafio, { codigo: 'abc' })).status).toBe(401)
  })

  it('o MESMO código duas vezes na mesma janela: o segundo é recusado (caso 27)', async () => {
    const usuario = `replay.${sufixo}`
    await criarUsuario(usuario)
    const { segredo } = await cadastrar(usuario)
    avancarPassos(5)
    const c = codigo(segredo)
    expect((await segundaEtapa(await desafiar(usuario), { codigo: c })).status).toBe(200)
    const segunda = await segundaEtapa(await desafiar(usuario), { codigo: c })
    expect(segunda.status).toBe(401)
    expect(segunda.body.message).toBe('Código incorreto.')
    // E o do passo anterior, mais velho que o último aceito, também.
    expect((await segundaEtapa(await desafiar(usuario), { codigo: codigo(segredo, -1) })).status).toBe(401)
  })

  it('±1 passo aceito; ±2 recusados (caso 28)', async () => {
    const usuario = `janela.${sufixo}`
    await criarUsuario(usuario)
    const { segredo } = await cadastrar(usuario)

    avancarPassos(10)
    expect((await segundaEtapa(await desafiar(usuario), { codigo: codigo(segredo, -2) })).status).toBe(401)
    expect((await segundaEtapa(await desafiar(usuario), { codigo: codigo(segredo, 2) })).status).toBe(401)
    expect((await segundaEtapa(await desafiar(usuario), { codigo: codigo(segredo, -1) })).status).toBe(200)
    avancarPassos(10)
    expect((await segundaEtapa(await desafiar(usuario), { codigo: codigo(segredo, 1) })).status).toBe(200)
  })
})

describe('limite de tentativas', () => {
  it('cinco erros num desafio matam o desafio — nem o código certo passa depois', async () => {
    const usuario = `mata.${sufixo}`
    await criarUsuario(usuario)
    const { segredo } = await cadastrar(usuario)
    avancarPassos(5)
    const desafio = await desafiar(usuario)
    for (let i = 0; i < 5; i++) expect((await segundaEtapa(desafio, { codigo: codigo(segredo, 9) })).status).toBe(401)
    const depois = await segundaEtapa(desafio, { codigo: codigo(segredo) })
    expect(depois.status).toBe(401)
    expect(depois.body.codigo).toBe(CODIGO_DESAFIO_INVALIDO)
  })

  it('o limite é POR CONTA: erros espalhados em desafios novos disparam o bloqueio (caso 29)', async () => {
    const usuario = `distrib.${sufixo}`
    await criarUsuario(usuario)
    const { segredo } = await cadastrar(usuario)
    avancarPassos(5)
    for (let i = 0; i < 5; i++) {
      expect((await segundaEtapa(await desafiar(usuario), { codigo: codigo(segredo, 9) })).status).toBe(401)
    }
    // O sexto desafio, com o código CERTO: bloqueado.
    const bloqueado = await segundaEtapa(await desafiar(usuario), { codigo: codigo(segredo) })
    expect(bloqueado.status).toBe(429)
    expect(Number(bloqueado.headers['retry-after'])).toBeGreaterThan(0)

    // Passada a espera (1 min), o certo entra; o contador NÃO reiniciou por desafio.
    avancarPassos(3)
    expect((await segundaEtapa(await desafiar(usuario), { codigo: codigo(segredo) })).status).toBe(200)
  })
})

describe('códigos de recuperação', () => {
  it('servem uma vez só; o aviso aparece na entrada seguinte; regenerar invalida os anteriores (caso 30)', async () => {
    const usuario = `recup.${sufixo}`
    await criarUsuario(usuario)
    const { segredo, codigos } = await cadastrar(usuario)
    avancarPassos(5)

    // Hífen e caixa tolerados.
    const r = await segundaEtapa(await desafiar(usuario), { codigoDeRecuperacao: codigos[0]!.toLowerCase() })
    expect(r.status).toBe(200)
    expect(r.body.avisoDeRecuperacao).toMatchObject({ codigosRestantes: 9 })

    const repetido = await segundaEtapa(await desafiar(usuario), { codigoDeRecuperacao: codigos[0]! })
    expect(repetido.status).toBe(401)

    // A próxima entrada (por TOTP) mostra o aviso; a seguinte, não mais.
    const proxima = await segundaEtapa(await desafiar(usuario), { codigo: codigo(segredo) })
    expect(proxima.body.avisoDeRecuperacao).toMatchObject({ codigosRestantes: 9 })
    const sessao = cookieChamado(proxima, SESSAO)!
    avancarPassos(2)
    const seguinte = await segundaEtapa(await desafiar(usuario), { codigo: codigo(segredo) })
    expect(seguinte.body.avisoDeRecuperacao).toBeNull()
    const outraSessao = cookieChamado(seguinte, SESSAO)!

    // Regenerar: senha + código agora.
    avancarPassos(2)
    await http().post('/v1/carteira/eu/segundo-fator/codigos').set('Cookie', sessao).send({ senha: 'errada-errada-errada', codigo: codigo(segredo) }).expect(403)
    const novos = guardar(
      await http().post('/v1/carteira/eu/segundo-fator/codigos').set('Cookie', sessao).send({ senha: SENHA, codigo: codigo(segredo) }).expect(200),
    )
    expect(novos.body.codigosDeRecuperacao).toHaveLength(10)
    // As outras sessões caem (caso 33).
    await http().get('/v1/carteira/eu').set('Cookie', outraSessao).expect(404)
    await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(200)

    // Um código antigo, nunca usado: não vale mais. Um novo: vale.
    avancarPassos(2)
    expect((await segundaEtapa(await desafiar(usuario), { codigoDeRecuperacao: codigos[1]! })).status).toBe(401)
    expect((await segundaEtapa(await desafiar(usuario), { codigoDeRecuperacao: novos.body.codigosDeRecuperacao[0] })).status).toBe(200)
  })
})

describe('AAD — o ciphertext é da linha (caso 31)', () => {
  it('o segredo de A copiado para a linha de B: o código de A não autentica B', async () => {
    const a = `aad.a.${sufixo}`
    const b = `aad.b.${sufixo}`
    const idA = await criarUsuario(a)
    const idB = await criarUsuario(b)
    const { segredo } = await cadastrar(a)
    await cadastrar(b)
    await migrate.query(
      `UPDATE segundo_fator_da_carteira
          SET segredo_cifrado = (SELECT segredo_cifrado FROM segundo_fator_da_carteira WHERE usuario_gestao_id = $1),
              chave_versao = 1, ultimo_passo = NULL
        WHERE usuario_gestao_id = $2`,
      [idA, idB],
    )
    avancarPassos(5)
    expect((await segundaEtapa(await desafiar(b), { codigo: codigo(segredo) })).status).toBe(401)
  })
})

describe('reset pelo Operador (caso 32)', () => {
  it('sem motivo é recusado; com motivo derruba sessões e desafios, grava a trilha e força novo cadastro', async () => {
    const usuario = `reset.${sufixo}`
    const id = await criarUsuario(usuario)
    const { segredo } = await cadastrar(usuario)
    avancarPassos(5)
    const sessao = cookieChamado(await segundaEtapa(await desafiar(usuario), { codigo: codigo(segredo) }), SESSAO)!
    const desafioVivo = await desafiar(usuario)

    const rota = `/v1/superadmin/usuarios-gestao/${id}/segundo-fator/resetar`
    await http().post(rota).set('Cookie', painel).send({}).expect(400)
    await http().post(rota).set('Cookie', painel).send({ motivo: 'curto' }).expect(400)
    // A sessão da CARTEIRA não alcança a rota do Operador.
    await http().post(rota).set('Cookie', sessao).send({ motivo: 'tentativa pela carteira' }).expect(404)

    const motivo = 'Celular perdido; identidade confirmada por videochamada.'
    await http().post(rota).set('Cookie', painel).send({ motivo }).expect(204)

    await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(404)
    avancarPassos(2)
    const morto = await segundaEtapa(desafioVivo, { codigo: codigo(segredo) })
    expect(morto.status).toBe(401)
    expect(morto.body.codigo).toBe(CODIGO_DESAFIO_INVALIDO)

    const linha = await migrate.query<{ s: Buffer | null; a: Date | null }>(
      'SELECT segredo_cifrado AS s, ativado_em AS a FROM segundo_fator_da_carteira WHERE usuario_gestao_id = $1',
      [id],
    )
    expect(linha.rows[0]).toEqual({ s: null, a: null })
    const vivos = await migrate.query<{ n: string }>(
      'SELECT count(*) AS n FROM codigos_de_recuperacao_da_carteira WHERE usuario_gestao_id = $1 AND usado_em IS NULL AND invalidado_em IS NULL',
      [id],
    )
    expect(Number(vivos.rows[0]!.n)).toBe(0)

    const trilha = await migrate.query<{ ator_tipo: string; ator_id: string; motivo: string; para: unknown }>(
      `SELECT ator_tipo, ator_id, motivo, para FROM auditoria_do_painel
        WHERE entidade = 'usuarios_gestao' AND entidade_id = $1 AND ator_tipo = 'operador'`,
      [id],
    )
    expect(trilha.rows).toEqual([
      { ator_tipo: 'operador', ator_id: operador, motivo, para: { segundo_fator: 'resetado pelo operador' } },
    ])

    // Próximo login: sessão sem segundo fator, presa no cadastro.
    const nova = await entrarSemTotp(usuario)
    await http().get('/v1/carteira/clientes').set('Cookie', nova).expect(409)
  })

  it('usuário inexistente: 404', async () => {
    await http()
      .post('/v1/superadmin/usuarios-gestao/00000000-0000-4000-8000-000000000000/segundo-fator/resetar')
      .set('Cookie', painel)
      .send({ motivo: 'motivo suficientemente longo' })
      .expect(404)
  })
})

describe('o segredo não vaza (caso 35)', () => {
  it('nem segredo, nem URI, nem código de recuperação aparecem em log; o segredo só na resposta do cadastro', async () => {
    const usuario = `vaza.${sufixo}`
    await criarUsuario(usuario)
    const inicioRespostas = respostas.length
    const { segredo, uri, codigos } = await cadastrar(usuario)
    avancarPassos(5)
    await segundaEtapa(await desafiar(usuario), { codigo: codigo(segredo) })
    await segundaEtapa(await desafiar(usuario), { codigoDeRecuperacao: codigos[2]! })

    // A captura funciona: o logger do Nest passa por ela.
    new Logger('canario-2fa').error('canario-do-segundo-fator')
    const log = capturado.join('\n')
    expect(log).toContain('canario-do-segundo-fator')
    expect(log).not.toContain(segredo)
    expect(log).not.toContain('otpauth://')
    for (const k of codigos) {
      expect(log).not.toContain(k)
      expect(log).not.toContain(k.replace(/-/g, ''))
    }

    // Nas respostas desta conta, o segredo aparece UMA vez: a do cadastro.
    const desta = respostas.slice(inicioRespostas).join('\n')
    expect(desta.split(segredo).length - 1).toBe(2) // `segredo` e dentro da `uri`, no mesmo corpo
    expect(desta.split(uri.replace(/\//g, '\\/')).length + desta.split(uri).length - 2).toBe(1)
  })
})
