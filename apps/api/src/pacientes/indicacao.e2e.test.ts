import { RelogioFixo } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'
import { INDICADORA_INVALIDA } from './vinculos-do-cadastro'

/**
 * **"Indicado por" liga a uma paciente cadastrada** (correções da PO, B2).
 *
 * O que este arquivo fixa, com Postgres real e RLS ativa:
 *  - autoindicação recusada no domínio (HTTP) e no `CHECK` (banco);
 *  - indicadora de outra clínica, inativa ou inventada: o MESMO 400, nada
 *    gravado (S-34, AB-B2-1, AB-B2-3); e a FK composta recusa no banco;
 *  - apagar a indicadora zera só `indicado_por_id` (S-32, L-B2-2);
 *  - com o id, o texto vai `''` (L-B2-3);
 *  - a lista não traz o nome da indicadora; a ficha traz só se ativa (L-B2-6);
 *  - a edição do vínculo entra na trilha com ids (L-B2-10).
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'senha-de-teste-indicacao'
const codigo = `ind-${Date.now()}`

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let vizinha: string
let daVizinha: string
let juliana: string[]

const umId = async (sql: string, params: unknown[]): Promise<string> =>
  (await migrate.query<{ id: string }>(sql, params)).rows[0]!.id

const srv = () => request(app.getHttpServer())
const criar = (corpo: Record<string, unknown>) =>
  srv().post('/v1/pacientes').set('Cookie', juliana).send(corpo)
const editar = (id: string, corpo: Record<string, unknown>) =>
  srv().patch(`/v1/pacientes/${id}`).set('Cookie', juliana).send(corpo)
const ficha = (id: string) => srv().get(`/v1/pacientes/${id}`).set('Cookie', juliana)

const linha = async (id: string) =>
  (
    await migrate.query<{ indicado_por_id: string | null; indicado_por: string; clinica_id: string }>(
      'SELECT indicado_por_id::text, indicado_por, clinica_id::text FROM pacientes WHERE id = $1',
      [id],
    )
  ).rows[0]!

/** Uma paciente nova na clínica, direto no banco (com nome único). */
let seq = 0
const paciente = async (nome: string, clinicaId = clinica): Promise<string> =>
  umId(`INSERT INTO pacientes (clinica_id, nome) VALUES ($1, $2) RETURNING id`, [
    clinicaId,
    `${nome} ${codigo} ${++seq}`,
  ])

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[indicacao.e2e] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinica = await umId(
    `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica da Indicação') RETURNING id`,
    [codigo],
  )
  vizinha = await umId(
    `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Vizinha') RETURNING id`,
    [`${codigo}-v`],
  )
  const perfil = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', ARRAY['pacientes']) RETURNING id`,
    [clinica],
  )
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, usuario, funcao, senha_hash, admin, perfil_id)
     VALUES ($1, 'Juliana', 'juliana', 'Recepcionista', $2, false, $3)`,
    [clinica, await hashDeSenha(SENHA), perfil],
  )
  daVizinha = await paciente('Vizinha Indicadora', vizinha)

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(new RelogioFixo(new Date('2026-11-09T15:00:00Z')))
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const r = await srv()
    .post('/v1/entrar')
    .send({ clinica: codigo, usuario: 'juliana', senha: SENHA })
    .expect(200)
  const v = r.headers['set-cookie'] as unknown
  juliana = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, vizinha)
  await migrate.end()
  await app.close()
})

describe('gravar a indicadora cadastrada', () => {
  it('no cadastro: grava o id e o texto vai vazio, mesmo que tenha vindo (L-B2-3)', async () => {
    const maria = await paciente('Maria Indicadora')
    const r = await criar({
      nome: `Carla Indicada ${codigo}`,
      origem: 'Indicação',
      indicadoPor: 'Maria da padaria',
      indicadoPorId: maria,
    }).expect(201)
    const l = await linha(r.body.id as string)
    expect(l.indicado_por_id).toBe(maria)
    expect(l.indicado_por).toBe('')
  })

  it('origem que não é Indicação não guarda indicação nenhuma, nem por id', async () => {
    const maria = await paciente('Maria')
    const r = await criar({
      nome: `Instagram ${codigo}`,
      origem: 'Instagram',
      indicadoPorId: maria,
    }).expect(201)
    expect((await linha(r.body.id as string)).indicado_por_id).toBeNull()

    // E na edição sem `origem` no pedido: vale a origem que a linha já tem.
    await editar(r.body.id as string, { indicadoPorId: maria }).expect(200)
    expect((await linha(r.body.id as string)).indicado_por_id).toBeNull()
  })

  it('autoindicação: 400 sem nome no corpo (AB-B2-2, L-B2-9)', async () => {
    const nome = `Autoindicada ${codigo}`
    const r = await criar({ nome, origem: 'Indicação' }).expect(201)
    const id = r.body.id as string
    const e = await editar(id, { origem: 'Indicação', indicadoPorId: id }).expect(400)
    expect(e.body.message).toBe('Uma paciente não pode indicar a si mesma.')
    expect(JSON.stringify(e.body)).not.toContain(nome)
    expect((await linha(id)).indicado_por_id).toBeNull()
  })

  it('outra clínica, inativa ou inventada: o MESMO 400, nada gravado (AB-B2-1, AB-B2-3)', async () => {
    const indicada = await paciente('Indicada')
    const inativa = await paciente('Inativa')
    await migrate.query(
      'UPDATE pacientes SET ativo = false, desativado_em = now() WHERE id = $1',
      [inativa],
    )
    const corpos: string[] = []
    for (const alvo of [daVizinha, inativa, '7d0c1c55-58a4-4f4b-9d55-3b7a0f6c2e11']) {
      const r = await editar(indicada, { origem: 'Indicação', indicadoPorId: alvo }).expect(400)
      corpos.push(JSON.stringify(r.body))
      expect(r.body.message).toBe(INDICADORA_INVALIDA)
    }
    // Sem oráculo de existência: as três respostas são idênticas.
    expect(new Set(corpos).size).toBe(1)
    expect((await linha(indicada)).indicado_por_id).toBeNull()

    // No cadastro, também — e nenhuma linha nasce.
    const nome = `Nao nasce ${codigo}`
    await criar({ nome, origem: 'Indicação', indicadoPorId: daVizinha }).expect(400)
    const n = await migrate.query('SELECT 1 FROM pacientes WHERE clinica_id = $1 AND nome = $2', [
      clinica,
      nome,
    ])
    expect(n.rowCount).toBe(0)
  })

  it('texto livre preenchido solta o vínculo; editar outro campo mantém o vínculo', async () => {
    const maria = await paciente('Maria')
    const carla = await paciente('Carla')
    await editar(carla, { origem: 'Indicação', indicadoPorId: maria }).expect(200)

    // Editar só o telefone não mexe na indicação (ausente mantém).
    await editar(carla, { telefone: '71 99999-0000' }).expect(200)
    expect((await linha(carla)).indicado_por_id).toBe(maria)

    // A indicadora foi desativada depois: editar mandando o MESMO id passa.
    await migrate.query(
      'UPDATE pacientes SET ativo = false, desativado_em = now() WHERE id = $1',
      [maria],
    )
    await editar(carla, { origem: 'Indicação', indicadoPorId: maria, obs: 'x' }).expect(200)
    expect((await linha(carla)).indicado_por_id).toBe(maria)

    // Texto livre: quem indicou não é paciente.
    await editar(carla, { origem: 'Indicação', indicadoPor: 'Dona Lurdes' }).expect(200)
    expect(await linha(carla)).toMatchObject({ indicado_por_id: null, indicado_por: 'Dona Lurdes' })
  })

  it('a edição do vínculo entra na trilha com ids (L-B2-10)', async () => {
    const maria = await paciente('Maria')
    const carla = await paciente('Carla')
    await editar(carla, { origem: 'Indicação', indicadoPorId: maria }).expect(200)
    const t = await migrate.query<{ de: Record<string, unknown>; para: Record<string, unknown> }>(
      `SELECT de, para FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pacientes' AND entidade_id = $2 AND acao = 'alterou'
        ORDER BY em DESC, id DESC LIMIT 1`,
      [clinica, carla],
    )
    expect(t.rows[0]!.de['indicado_por_id']).toBeNull()
    expect(t.rows[0]!.para['indicado_por_id']).toBe(maria)
  })
})

describe('onde o nome da indicadora sai, e onde não sai (L-B2-6)', () => {
  it('a lista não traz o nome da indicadora em campo nenhum', async () => {
    const nomeDaIndicadora = `Zuleica Indicadora ${codigo}`
    const maria = await umId(
      `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, $2) RETURNING id`,
      [clinica, nomeDaIndicadora],
    )
    const carla = await paciente('Indicada Da Zuleica')
    await editar(carla, { origem: 'Indicação', indicadoPorId: maria }).expect(200)

    const r = await srv()
      .get('/v1/pacientes')
      .query({ q: 'Indicada Da Zuleica' })
      .set('Cookie', juliana)
      .expect(200)
    expect(r.body.pacientes).toHaveLength(1)
    const corpo = JSON.stringify(r.body)
    expect(corpo).not.toContain(nomeDaIndicadora)
    expect(corpo).not.toContain(maria)
    // E a resposta do PATCH (forma de lista) também não.
    const p = await editar(carla, { obs: 'y' }).expect(200)
    expect(JSON.stringify(p.body)).not.toContain(nomeDaIndicadora)
  })

  it('a ficha traz id e nome da indicadora ativa; desativada, nem nome nem id', async () => {
    const nomeDaIndicadora = `Yolanda Indicadora ${codigo}`
    const maria = await umId(
      `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, $2) RETURNING id`,
      [clinica, nomeDaIndicadora],
    )
    const carla = await paciente('Carla')
    await editar(carla, { origem: 'Indicação', indicadoPorId: maria }).expect(200)

    const ativa = await ficha(carla).expect(200)
    expect(ativa.body.indicadora).toEqual({ id: maria, nome: nomeDaIndicadora })
    expect(ativa.body.indicadaPorPaciente).toBe(true)
    expect(ativa.body.indicadoPor).toBe('')

    await migrate.query(
      'UPDATE pacientes SET ativo = false, desativado_em = now() WHERE id = $1',
      [maria],
    )
    const inativa = await ficha(carla).expect(200)
    expect(inativa.body.indicadora).toBeNull()
    expect(inativa.body.indicadaPorPaciente).toBe(true)
    const corpo = JSON.stringify(inativa.body)
    expect(corpo).not.toContain(nomeDaIndicadora)
    expect(corpo).not.toContain(maria)
  })
})

describe('as restrições da 0062, no banco', () => {
  it('o CHECK recusa a autoindicação', async () => {
    const p = await paciente('Auto')
    await expect(
      migrate.query('UPDATE pacientes SET indicado_por_id = id WHERE id = $1', [p]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'paciente_nao_indica_a_si_mesma' })
  })

  it('a FK composta recusa a indicadora de outra clínica, mesmo sem RLS no caminho', async () => {
    const p = await paciente('Cruzada')
    await expect(
      migrate.query('UPDATE pacientes SET indicado_por_id = $2 WHERE id = $1', [p, daVizinha]),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'paciente_indicada_por_paciente_da_clinica',
    })
  })

  it('o CHECK recusa id e texto juntos (L-B2-3)', async () => {
    const maria = await paciente('Maria')
    const p = await paciente('Texto')
    await expect(
      migrate.query(
        `UPDATE pacientes SET indicado_por_id = $2, indicado_por = 'Maria' WHERE id = $1`,
        [p, maria],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'paciente_indicada_sem_nome_em_texto' })
  })

  it('apagar a indicadora não falha e zera SÓ o id (S-32, AB-B2-4)', async () => {
    const maria = await paciente('Maria Apagada')
    const carla = await paciente('Carla')
    await migrate.query(
      `UPDATE pacientes SET origem = 'Indicação', indicado_por_id = $2 WHERE id = $1`,
      [carla, maria],
    )
    await migrate.query('DELETE FROM pacientes WHERE id = $1', [maria])
    expect(await linha(carla)).toEqual({ indicado_por_id: null, indicado_por: '', clinica_id: clinica })
  })
})
