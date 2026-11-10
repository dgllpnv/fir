import type { UsoDoClienteSaida, VisaoDeUsoSaida } from '@fir/contracts'
import { diaCivil, somarDias } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { hashDeSenha } from '../../autenticacao/senha'
import {
  apagarClinicaDeTeste,
  apagarHistoricoGrupoDeTeste,
  declararAtorSistema,
  participarDoGrupoDeTeste,
} from '../../banco/limpeza-de-teste'
import { registrarCookie } from '../../main'

/**
 * **G8 1D — `GET /v1/carteira/uso` e `GET /v1/carteira/clientes/:id/uso`,
 * pela HTTP, contra Postgres real.**
 *
 * O que este arquivo prova:
 *  1. Sem sessão de carteira, 404 (o `CarteiraGuard` vale para as rotas novas).
 *  2. ISOLAMENTO POR GRUPO (regra 19, A-3): o usuário do grupo A não vê o
 *     cliente do grupo B na visão, e a ficha de B responde o MESMO 404 de "não
 *     existe" e de id malformado.
 *  3. REDAÇÃO (regra 17, A18): `receita` sai `null` para o Usuário de Gestão,
 *     pelo `RedacaoInterceptor` — nenhum `if` na rota.
 *  4. REGISTRO DE ACESSO (ADR 0013 §7): uma linha por clínica incluída, na
 *     trilha DAQUELA clínica, `ator_tipo = 'usuario_gestao'`; nada na clínica
 *     do outro grupo.
 *  5. "Faltas recontatadas" oculta (null) com um dia não calculado na janela.
 *
 * O relógio é o do sistema (a rota usa `RelogioDoSistema`): as linhas são
 * montadas relativas ao "hoje" de cada clínica, no fuso dela.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')
const USUARIO_A = `uso.a.${sufixo}`
const USUARIO_GERAL = `uso.geral.${sufixo}`
const FUSO_A = 'America/Bahia'
const FUSO_B = 'America/Manaus'

let app: NestFastifyApplication
let migrate: pg.Client
let grupoA: string
let grupoB: string
let clinicaA: string
let clinicaB: string
let clinicaVazia: string
let clienteA: string
let clienteB: string
let clienteVazio: string
let clienteSemClinica: string
const usuarios: string[] = []

const ehUtil = (dia: string): boolean => {
  const [a, m, d] = dia.split('-').map(Number)
  const w = new Date(Date.UTC(a!, m! - 1, d!)).getUTCDay()
  return w !== 0 && w !== 6
}

const novaClinica = async (nome: string, fuso: string): Promise<string> =>
  (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, $2, $3) RETURNING id`,
      [`uso-${sufixo}-${nome}`, nome, fuso],
    )
  ).rows[0]!.id

const novoCliente = async (grupo: string, clinica: string | null, nome: string, status = 'ativo') => {
  if (clinica) await participarDoGrupoDeTeste(migrate, clinica, grupo)
  return (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status)
       VALUES ($1, $2, $3, 'FIR Clinic', $4) RETURNING id`,
      [grupo, clinica, nome, status],
    )
  ).rows[0]!.id
}

const novoUsuario = async (usuario: string, escopo: 'grupo' | 'geral', grupo: string | null) => {
  const id = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
       VALUES ($1, 'Comercial', $2, $3, $4) RETURNING id`,
      [usuario, await hashDeSenha(SENHA), escopo, grupo],
    )
  ).rows[0]!.id
  usuarios.push(id)
  return id
}

/** 20 dias de linhas antes de hoje: dia útil com uso e 100% no prazo, receita de R$ 150,01. */
const semearUso = async (cliente: string, grupo: string, fuso: string, diaSemCalculo?: string) => {
  const hoje = diaCivil(new Date(), fuso)
  for (let i = 1; i <= 20; i++) {
    const dia = somarDias(hoje, -i)
    const util = ehUtil(dia)
    await migrate.query(
      `INSERT INTO uso_diario_cliente
         (cliente_carteira_id, grupo_id, dia, usuarios_cadastrados, usuarios_ativos,
          tarefas_criadas, tarefas_concluidas, tarefas_no_prazo, contatos_pacientes,
          faltas, faltas_recontatadas, receita_registrada)
       VALUES ($1, $2, $3, 3, $4, $5, $5, $5, $6, 1, $7, $8)`,
      [cliente, grupo, dia, util ? 2 : 0, util ? 5 : 0, util ? 4 : 0, dia === diaSemCalculo ? null : 1, util ? 15001 : 0],
    )
  }
}

const cookies = (r: { headers: Record<string, string> }): string => {
  const v = r.headers['set-cookie'] as unknown
  const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
  return lista.map((c) => c.split(';')[0]!).join('; ')
}

const http = () => request(app.getHttpServer())
let cookieA: string
let cookieGeral: string

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  grupoA = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`Uso A ${sufixo}`])).rows[0]!.id
  grupoB = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`Uso B ${sufixo}`])).rows[0]!.id
  clinicaA = await novaClinica('a', FUSO_A)
  clinicaB = await novaClinica('b', FUSO_B)
  clinicaVazia = await novaClinica('vazia', FUSO_A)
  clienteA = await novoCliente(grupoA, clinicaA, 'Clínica Sol')
  clienteVazio = await novoCliente(grupoA, clinicaVazia, 'Clínica Nova', 'onboarding')
  clienteSemClinica = await novoCliente(grupoA, null, 'Lead convertido', 'onboarding')
  clienteB = await novoCliente(grupoB, clinicaB, 'Clínica do Outro Grupo')

  // Um dia da semana de A sem cálculo de recontato: o número precisa sumir.
  const ontemA = somarDias(diaCivil(new Date(), FUSO_A), -1)
  await semearUso(clienteA, grupoA, FUSO_A, ontemA)
  await semearUso(clienteB, grupoB, FUSO_B)

  await novoUsuario(USUARIO_A, 'grupo', grupoA)
  await novoUsuario(USUARIO_GERAL, 'geral', null)

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  cookieA = cookies(await http().post('/v1/carteira/entrar').send({ usuario: USUARIO_A, senha: SENHA }).expect(200))
  cookieGeral = cookies(
    await http().post('/v1/carteira/entrar').send({ usuario: USUARIO_GERAL, senha: SENHA }).expect(200),
  )
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const clientes = [clienteA, clienteB, clienteVazio, clienteSemClinica]
  await migrate.query('DELETE FROM uso_diario_cliente WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM tarefas_internas WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [usuarios])
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador = ANY($1)', [[USUARIO_A, USUARIO_GERAL]])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [usuarios])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [clientes])
  await apagarHistoricoGrupoDeTeste(migrate, clinicaA)
  await apagarHistoricoGrupoDeTeste(migrate, clinicaB)
  await apagarHistoricoGrupoDeTeste(migrate, clinicaVazia)
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  for (const c of [clinicaA, clinicaB, clinicaVazia]) await apagarClinicaDeTeste(migrate, c)
  await migrate.end()
  await app.close()
})

const acessos = async (clinica: string) =>
  (
    await migrate.query<{ ator_tipo: string; ator_id: string; entidade: string; entidade_id: string }>(
      `SELECT ator_tipo, ator_id::text, entidade, entidade_id FROM auditoria
        WHERE clinica_id = $1 AND acao = 'acessou'`,
      [clinica],
    )
  ).rows

describe('GET /v1/carteira/uso', () => {
  it('sem sessão de carteira: 404', async () => {
    await http().get('/v1/carteira/uso').expect(404)
    await http().get(`/v1/carteira/clientes/${clienteA}/uso`).expect(404)
  })

  it('o grupo A vê só os clientes ligados a clínica do grupo A, nunca os do B', async () => {
    const r = await http().get('/v1/carteira/uso').set('Cookie', cookieA).expect(200)
    const v = r.body as VisaoDeUsoSaida
    const ids = v.clientes.map((c) => c.clienteCarteiraId)
    expect(ids).toContain(clienteA)
    expect(ids).toContain(clienteVazio)
    expect(ids).not.toContain(clienteB)
    // O cliente sem clínica não tem FIR Clinic para mostrar.
    expect(ids).not.toContain(clienteSemClinica)
    expect(v.totais.clinicas).toBe(v.clientes.length)
    expect(v.totais.bom + v.totais.atencao + v.totais.critico + v.totais.semSituacao).toBe(v.totais.clinicas)
  })

  it('situação, semana e série do cliente com dados; sem dados no cliente novo', async () => {
    const v = (await http().get('/v1/carteira/uso').set('Cookie', cookieA).expect(200)).body as VisaoDeUsoSaida
    const a = v.clientes.find((c) => c.clienteCarteiraId === clienteA)!
    expect(a.saude).toEqual({ situacao: 'bom', rotulo: 'Uso em dia' })
    expect(a.semana!.diasUteis).toBe(5)
    expect(a.semana!.diasComUso).toBe(5)
    expect(a.semana!.percentualNoPrazo).toBe(100)
    expect(a.semana!.pessoasAtivas).toBe(2)
    expect(a.deltaNoPrazo).toBe(0)
    expect(a.serie).toHaveLength(30)
    // A16: a série diária nunca carrega pessoas.
    expect(Object.keys(a.serie[0]!).sort()).toEqual(['dia', 'tarefasConcluidas'])
    // PP-8: um dia da janela sem cálculo esconde o número inteiro.
    expect(a.semana!.faltasRecontatadas).toBeNull()

    const novo = v.clientes.find((c) => c.clienteCarteiraId === clienteVazio)!
    expect(novo.saude).toEqual({ situacao: null, rotulo: 'Sem dados' })
    expect(novo.semana).toBeNull()
    // O crítico/atenção/bom vem antes do "sem situação".
    expect(v.clientes.indexOf(a)).toBeLessThan(v.clientes.indexOf(novo))
  })

  it('regra 17: receita sai null — o Usuário de Gestão não tem `valores`', async () => {
    const v = (await http().get('/v1/carteira/uso').set('Cookie', cookieA).expect(200)).body as VisaoDeUsoSaida
    const a = v.clientes.find((c) => c.clienteCarteiraId === clienteA)!
    expect(a.semana).toHaveProperty('receita', null)
  })

  it('ADR 0013 §7: uma linha de acesso por clínica incluída, nenhuma na do outro grupo', async () => {
    const antes = (await acessos(clinicaA)).length
    await http().get('/v1/carteira/uso').set('Cookie', cookieA).expect(200)
    const depois = await acessos(clinicaA)
    expect(depois.length).toBe(antes + 1)
    expect(depois.at(-1) ?? depois[0]).toMatchObject({
      ator_tipo: 'usuario_gestao',
      ator_id: usuarios[0],
      entidade: 'uso_diario_cliente',
      entidade_id: clienteA,
    })
    expect((await acessos(clinicaVazia)).length).toBeGreaterThan(0)
    expect((await acessos(clinicaB)).filter((x) => x.ator_id === usuarios[0])).toEqual([])
  })

  it('escopo geral vê os dois grupos', async () => {
    const v = (await http().get('/v1/carteira/uso').set('Cookie', cookieGeral).expect(200)).body as VisaoDeUsoSaida
    const ids = v.clientes.map((c) => c.clienteCarteiraId)
    expect(ids).toContain(clienteA)
    expect(ids).toContain(clienteB)
  })
})

describe('GET /v1/carteira/clientes/:id/uso', () => {
  it('a ficha de uso do próprio grupo: semana, relatório e texto sem dinheiro', async () => {
    const r = await http().get(`/v1/carteira/clientes/${clienteA}/uso`).set('Cookie', cookieA).expect(200)
    const u = r.body as UsoDoClienteSaida
    expect(u.comClinica).toBe(true)
    expect(u.uso!.semana.diasComUso).toBe(5)
    expect(u.uso!.semana).toHaveProperty('receita', null)
    expect(u.uso!.semanaAnterior).toHaveProperty('receita', null)
    expect(u.uso!.relatorio.marcos.map((m) => m.dia)).toEqual([30, 60, 90])
    expect(u.uso!.relatorio.indicadores.map((i) => i.chave)).not.toContain('rotinasCumpridas')
    expect(u.uso!.relatorio.texto).toContain('USO DA FIR CLINIC · Clínica Sol')
    expect(u.uso!.relatorio.texto).not.toMatch(/R\$|150/)
  })

  it('cliente de OUTRO grupo, inexistente e id malformado: o mesmo 404', async () => {
    const outro = await http().get(`/v1/carteira/clientes/${clienteB}/uso`).set('Cookie', cookieA).expect(404)
    const nada = await http()
      .get('/v1/carteira/clientes/00000000-0000-4000-8000-000000000000/uso')
      .set('Cookie', cookieA)
      .expect(404)
    const torto = await http().get('/v1/carteira/clientes/nao-e-uuid/uso').set('Cookie', cookieA).expect(404)
    expect(outro.body.message).toBe(nada.body.message)
    expect(torto.body.message).toBe(nada.body.message)
    expect((await acessos(clinicaB)).filter((x) => x.ator_id === usuarios[0])).toEqual([])
  })

  it('cliente sem clínica ligada: comClinica false, sem uso, sem trilha', async () => {
    const u = (await http().get(`/v1/carteira/clientes/${clienteSemClinica}/uso`).set('Cookie', cookieA).expect(200))
      .body as UsoDoClienteSaida
    expect(u).toEqual({ clienteCarteiraId: clienteSemClinica, nome: 'Lead convertido', comClinica: false, uso: null })
  })

  it('cliente com clínica e sem resumo ainda: uso null', async () => {
    const u = (await http().get(`/v1/carteira/clientes/${clienteVazio}/uso`).set('Cookie', cookieA).expect(200))
      .body as UsoDoClienteSaida
    expect(u.comClinica).toBe(true)
    expect(u.uso).toBeNull()
  })
})
