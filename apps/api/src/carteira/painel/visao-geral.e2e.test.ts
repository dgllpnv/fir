import type { ContadoresDoMenuSaida, UsuarioDeGestaoPublico, VisaoGeralDaCarteiraSaida } from '@fir/contracts'
import { CHAVES_DE_MODULO, RelogioFixo } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { declararAtorSistema } from '../../banco/limpeza-de-teste'
import { RELOGIO } from '../../comum/relogio'
import { registrarCookie } from '../../main'
import { VisaoGeralService } from './visao-geral.service'

/**
 * **G8 3B — a Visão geral da carteira, ponta a ponta pela HTTP, contra
 * Postgres real.** Seam: HTTP da API + repositório sobre Postgres real.
 *
 * O que só o banco prova, e por isso mora aqui:
 *  - ISOLAMENTO DE GRUPO: o `Usuário de Gestão` de `escopo='grupo'` não entra
 *    na Visão geral (tela "só escopo geral", A-5); os badges dele contam só o
 *    próprio grupo; e o serviço, chamado com uma sessão de grupo, só enxerga o
 *    grupo dela pela RLS — a segunda camada, provada sem a primeira.
 *  - "SÓ A MINHA CARTEIRA" (A-3) nos agregados: MRR, saúde, reuniões,
 *    aniversários, contatos e entregas são só da própria carteira, e nenhum
 *    id ou nome de cliente alheio aparece na resposta.
 *  - REDAÇÃO: `mrr`, `ticketMedio` e o `valorEstimado` dos contatos saem
 *    `null` sem `valores`, pelo `RedacaoInterceptor` real.
 *
 * Aritmética (MRR, ticket, baldes da saúde) tem property-based no domínio
 * (`visao-geral-carteira.test.ts`). Aqui as contas exatas usam o usuário
 * "minha" e as sessões de grupo, cujo universo é só o desta fixture: a
 * diretoria (`todos`, escopo geral) vê também o que os outros e2e criam em
 * paralelo, então dela só se afirma presença e forma.
 *
 * Relógio fixo: quarta-feira, 11/11/2026, 12:00 na Bahia.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const SENHA = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')
const AGORA = new Date('2026-11-11T15:00:00Z')

let app: NestFastifyApplication
let migrate: pg.Client
const ids = {
  grupoA: '',
  grupoB: '',
  diretoria: '',
  semValores: '',
  minha: '',
  doA: '',
  doB: '',
  a1: '',
  a2: '',
  b1: '',
  b2: '',
  leadA: '',
  leadB: '',
}
const cookie = { diretoria: '', semValores: '', minha: '', doA: '', doB: '' }
const NOME = { a1: `A1 minha ${sufixo}`, a2: `A2 sem dona ${sufixo}`, b1: `B1 outro grupo ${sufixo}`, leadB: `Dra. Lead B ${sufixo}` }

const http = () => request(app.getHttpServer())
const entrar = async (usuario: string): Promise<string> => {
  const r = await http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA }).expect(200)
  const v = r.headers['set-cookie'] as unknown
  const lista = Array.isArray(v) ? (v as string[]) : [String(v)]
  return lista.map((c) => c.split(';')[0]!).join('; ')
}
const um = async (sql: string, p: unknown[]): Promise<string> => (await migrate.query<{ id: string }>(sql, p)).rows[0]!.id

const painel = async (c: string): Promise<VisaoGeralDaCarteiraSaida> =>
  (await http().get('/v1/carteira/painel').set('cookie', c).expect(200)).body as VisaoGeralDaCarteiraSaida
const contadores = async (c: string): Promise<ContadoresDoMenuSaida> =>
  (await http().get('/v1/carteira/eu/contadores').set('cookie', c).expect(200)).body as ContadoresDoMenuSaida

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  ids.grupoA = await um('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`Visão A ${sufixo}`])
  ids.grupoB = await um('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`Visão B ${sufixo}`])

  const hash = await hashDeSenha(SENHA)
  const usuario = (u: string, escopo: string, grupo: string | null, valores: boolean, carteira: string, administrar: boolean) =>
    um(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id, valores, carteira, administrar)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [`${u}.${sufixo}`, `${u} ${sufixo}`, hash, escopo, grupo, valores, carteira, administrar],
    )
  ids.diretoria = await usuario('diretoria', 'geral', null, true, 'todos', true)
  ids.semValores = await usuario('semvalores', 'geral', null, false, 'todos', false)
  ids.minha = await usuario('minha', 'geral', null, true, 'minha', false)
  ids.doA = await usuario('doa', 'grupo', ids.grupoA, true, 'todos', false)
  ids.doB = await usuario('dob', 'grupo', ids.grupoB, true, 'todos', false)

  const cliente = (g: string, nome: string, status: string, mensalidade: bigint, responsavel: string | null) =>
    um(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status, mensalidade_centavos, responsavel_usuario_gestao_id)
       VALUES ($1, NULL, $2, 'Acelerador FIR', $3, $4, $5) RETURNING id`,
      [g, nome, status, mensalidade.toString(), responsavel],
    )
  ids.a1 = await cliente(ids.grupoA, NOME.a1, 'ativo', 100_000n, ids.minha)
  ids.a2 = await cliente(ids.grupoA, NOME.a2, 'onboarding', 50_001n, null)
  ids.b1 = await cliente(ids.grupoB, NOME.b1, 'ativo', 700_000n, null)
  ids.b2 = await cliente(ids.grupoB, `B2 encerrado ${sufixo}`, 'encerrado', 900_000n, null)
  // Reunião fixa na quarta (hoje) e decisora fazendo aniversário amanhã.
  await migrate.query(
    `UPDATE clientes_carteira SET reuniao_dia_semana = 3, reuniao_hora = '10:00', decisor = $2, telefone = '71999990000',
            aniversario_decisor_dia = 12, aniversario_decisor_mes = 11 WHERE id = $1`,
    [ids.a1, `Decisora A1 ${sufixo}`],
  )
  await migrate.query(
    `UPDATE clientes_carteira SET reuniao_dia_semana = 1, decisor = $2, telefone = '71999990001',
            aniversario_decisor_dia = 13, aniversario_decisor_mes = 11 WHERE id = $1`,
    [ids.b1, `Decisora B1 ${sufixo}`],
  )

  const checkin = (cli: string, g: string, saude: string) =>
    migrate.query(
      `INSERT INTO checkins_internos (cliente_carteira_id, grupo_id, semana, nota, saude, por_usuario_gestao_id)
       VALUES ($1, $2, '2026-W46', 'nota', $3, $4)`,
      [cli, g, saude, ids.diretoria],
    )
  await checkin(ids.a1, ids.grupoA, 'critico')
  await checkin(ids.a2, ids.grupoA, 'atencao')
  await checkin(ids.b1, ids.grupoB, 'critico')

  const acao = (cli: string, g: string, titulo: string, prazo: string) =>
    migrate.query(
      `INSERT INTO acoes_do_plano (cliente_carteira_id, grupo_id, titulo, prazo, criado_por) VALUES ($1, $2, $3, $4, $5)`,
      [cli, g, titulo, prazo, ids.diretoria],
    )
  await acao(ids.a1, ids.grupoA, `Ação atrasada A1 ${sufixo}`, '2026-11-01')
  await acao(ids.a2, ids.grupoA, `Ação próxima A2 ${sufixo}`, '2026-11-15')
  await acao(ids.b1, ids.grupoB, `Ação atrasada B1 ${sufixo}`, '2026-11-02')

  const tarefa = (g: string, resp: string, cli: string | null, prazo: string) =>
    migrate.query(
      `INSERT INTO tarefas_internas (titulo, grupo_id, responsavel_usuario_gestao_id, cliente_carteira_id, prazo)
       VALUES ($1, $2, $3, $4, $5)`,
      [`Tarefa ${sufixo}`, g, resp, cli, prazo],
    )
  await tarefa(ids.grupoA, ids.minha, ids.a1, '2026-11-05')
  await tarefa(ids.grupoA, ids.doA, ids.a2, '2026-11-04')
  await tarefa(ids.grupoA, ids.doA, ids.a2, '2026-11-11')
  await tarefa(ids.grupoB, ids.doB, ids.b1, '2026-11-03')
  await tarefa(ids.grupoB, ids.doB, ids.b1, '2026-11-02')

  // Indicação recebida há 10 dias e sem contato: sinal "agora" (L2427).
  const lead = (g: string, nome: string, resp: string | null) =>
    um(
      `INSERT INTO leads_comerciais (nome, grupo_id, origem, temperatura, recebida_em, responsavel_usuario_gestao_id, valor_estimado_centavos)
       VALUES ($1, $2, 'Indicação pessoal', 'quente', '2026-11-01', $3, 300000) RETURNING id`,
      [nome, g, resp],
    )
  ids.leadA = await lead(ids.grupoA, `Dra. Lead A ${sufixo}`, ids.minha)
  ids.leadB = await lead(ids.grupoB, NOME.leadB, null)

  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(RELOGIO).useValue(new RelogioFixo(AGORA)).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  cookie.diretoria = await entrar(`diretoria.${sufixo}`)
  cookie.semValores = await entrar(`semvalores.${sufixo}`)
  cookie.minha = await entrar(`minha.${sufixo}`)
  cookie.doA = await entrar(`doa.${sufixo}`)
  cookie.doB = await entrar(`dob.${sufixo}`)
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const clientes = [ids.a1, ids.a2, ids.b1, ids.b2].filter(Boolean)
  const grupos = [ids.grupoA, ids.grupoB].filter(Boolean)
  const usuarios = [ids.diretoria, ids.semValores, ids.minha, ids.doA, ids.doB].filter(Boolean)
  await migrate.query('DELETE FROM tarefas_internas WHERE grupo_id = ANY($1)', [grupos])
  await migrate.query('DELETE FROM acoes_do_plano WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM checkins_internos WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM leads_comerciais WHERE id = ANY($1)', [[ids.leadA, ids.leadB].filter(Boolean)])
  await migrate.query('DELETE FROM auditoria_da_carteira WHERE grupo_id = ANY($1)', [grupos])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [usuarios])
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador = ANY($1)', [
    ['diretoria', 'semvalores', 'minha', 'doa', 'dob'].map((u) => `${u}.${sufixo}`),
  ])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [usuarios])
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [grupos])
  await migrate.end()
  await app.close()
})

describe('isolamento de grupo', () => {
  it('escopo de grupo não entra na Visão geral: 403, mesmo com o módulo gravado (A-5)', async () => {
    await http().get('/v1/carteira/painel').set('cookie', cookie.doA).expect(403)
    await http().get('/v1/carteira/painel').set('cookie', cookie.doB).expect(403)
  })

  it('sem sessão de carteira, 404 nas duas rotas', async () => {
    await http().get('/v1/carteira/painel').expect(404)
    await http().get('/v1/carteira/eu/contadores').expect(404)
  })

  it('os badges do menu de cada grupo contam só o próprio grupo', async () => {
    // A: as vencidas do próprio doA (uma; a de hoje não conta); o lead "agora" é só o de A.
    expect(await contadores(cookie.doA)).toEqual({ tarefasVencidas: 1, contatosAgora: 1 })
    // B: as duas vencidas de doB; o lead "agora" é só o de B.
    expect(await contadores(cookie.doB)).toEqual({ tarefasVencidas: 2, contatosAgora: 1 })
  })

  it('a RLS sozinha confina o serviço ao grupo da sessão (segunda camada, sem o guard)', async () => {
    const sessao: UsuarioDeGestaoPublico = {
      id: ids.doA,
      usuario: `doa.${sufixo}`,
      nome: `doa ${sufixo}`,
      escopo: 'grupo',
      grupoId: ids.grupoA,
      senhaProvisoria: false,
      valores: true,
      carteira: 'todos',
      modulos: [...CHAVES_DE_MODULO],
      administrar: false,
      setor: null,
      funcao: null,
      telefone: null,
    }
    const v = await app.get(VisaoGeralService).visaoGeral(sessao)
    expect(v.kpis).toMatchObject({ clientesAtivos: 2, emOnboarding: 1, mrr: '150001', ticketMedio: '75001', acoesAtrasadas: 1 })
    expect(v.clientesAtivos.map((c) => c.id).sort()).toEqual([ids.a1, ids.a2].sort())
    const texto = JSON.stringify(v)
    expect(texto).not.toContain(ids.b1)
    expect(texto).not.toContain(NOME.b1)
    expect(texto).not.toContain(NOME.leadB)
  })
})

describe('"só a minha carteira" nos agregados (A-3)', () => {
  it('todos os blocos são da própria carteira, com as contas exatas', async () => {
    const v = await painel(cookie.minha)
    expect(v.hoje).toBe('2026-11-11')
    expect(v.kpis).toMatchObject({
      clientesAtivos: 1,
      emOnboarding: 0,
      mrr: '100000',
      ticketMedio: '100000',
      acoesAtrasadas: 1,
      clientesComAcaoAtrasada: 1,
    })
    expect(v.kpis.tarefasVencidas).toBeGreaterThanOrEqual(1)
    expect(v.saude).toMatchObject({ bom: 0, atencao: 0, critico: 1, semSaude: 0 })
    expect(v.saude.emRisco).toEqual([
      { id: ids.a1, nome: NOME.a1, saude: 'critico', resumoDaUltimaReuniao: null, acoesAtrasadas: 1, responsavelNome: `minha ${sufixo}` },
    ])
    expect(v.reunioesDaSemana).toEqual([{ clienteId: ids.a1, nome: NOME.a1, diaDaSemana: 3, hora: '10:00', ehHoje: true }])
    expect(v.aniversarios.filter((a) => a.tipo === 'cliente').map((a) => a.id)).toEqual([ids.a1])
    expect(v.contatosRecomendados?.map((l) => l.id)).toEqual([ids.leadA])
    expect(v.proximasEntregas.map((a) => a.clienteCarteiraId)).toEqual([ids.a1])
    expect(v.proximasEntregas[0]).toMatchObject({ clienteNome: NOME.a1, atrasada: true, diasDeAtraso: 10 })
    const eu = v.equipe.pessoas.find((p) => p.id === ids.minha)
    expect(eu).toMatchObject({ clientes: 1, pendentes: 1, vencidas: 1 })
  })

  it('nenhum id ou nome de cliente, decisora ou lead alheio aparece na resposta', async () => {
    const texto = JSON.stringify(await painel(cookie.minha))
    for (const alheio of [ids.a2, ids.b1, ids.b2, ids.leadB, NOME.a2, NOME.b1, NOME.leadB, `Decisora B1 ${sufixo}`]) {
      expect(texto).not.toContain(alheio)
    }
  })
})

describe('diretoria (escopo geral, todas as clientes)', () => {
  it('vê os dois grupos: em risco, reuniões, entregas e aniversários de A e de B', async () => {
    const v = await painel(cookie.diretoria)
    const emRisco = v.saude.emRisco.map((c) => c.id)
    expect(emRisco).toEqual(expect.arrayContaining([ids.a1, ids.a2, ids.b1]))
    // Crítico antes de atenção (L1287).
    expect(emRisco.indexOf(ids.a1)).toBeLessThan(emRisco.indexOf(ids.a2))
    expect(v.reunioesDaSemana.map((r) => r.clienteId)).toEqual(expect.arrayContaining([ids.a1, ids.b1]))
    expect(v.proximasEntregas.map((a) => a.clienteCarteiraId)).toEqual(expect.arrayContaining([ids.a1, ids.a2, ids.b1]))
    expect(v.aniversarios.map((a) => a.id)).toEqual(expect.arrayContaining([ids.a1, ids.b1]))
    // O encerrado não é ativo nem aparece no atalho de reunião.
    expect(v.clientesAtivos.map((c) => c.id)).not.toContain(ids.b2)
    // A diretoria não está na lista da equipe (L1289); quem não administra, está.
    // Escopo de grupo também não (A-5: pode ser gente da rede-cliente).
    const equipe = v.equipe.pessoas.map((p) => p.id)
    expect(equipe).not.toContain(ids.diretoria)
    expect(equipe).toEqual(expect.arrayContaining([ids.semValores, ids.minha]))
    expect(equipe).not.toContain(ids.doA)
    expect(equipe).not.toContain(ids.doB)
  })

  it('o badge de tarefas da diretoria conta as vencidas de todo mundo', async () => {
    const c = await contadores(cookie.diretoria)
    expect(c.tarefasVencidas).toBeGreaterThanOrEqual(4)
    expect(c.contatosAgora).toBeGreaterThanOrEqual(2)
  })
})

describe('redação de valores pelo ponto único', () => {
  it('com valores: MRR, ticket e o valor estimado dos contatos atravessam', async () => {
    const v = await painel(cookie.diretoria)
    expect(v.podeVerValores).toBe(true)
    expect(v.kpis.mrr).toMatch(/^\d+$/)
    expect(v.kpis.ticketMedio).toMatch(/^\d+$/)
    // O valor do contato, no universo exato do usuário "minha" (que tem valores).
    const minha = await painel(cookie.minha)
    expect(minha.contatosRecomendados?.[0]?.valorEstimado).toBe('300000')
  })

  it('sem valores: MRR, ticket e o valor estimado de todo contato saem null; as contagens ficam', async () => {
    const v = await painel(cookie.semValores)
    expect(v.podeVerValores).toBe(false)
    expect(v.kpis.mrr).toBeNull()
    expect(v.kpis.ticketMedio).toBeNull()
    expect(v.kpis.clientesAtivos).toBeGreaterThanOrEqual(3)
    expect(v.contatosRecomendados?.length).toBeGreaterThan(0)
    for (const l of v.contatosRecomendados ?? []) expect(l.valorEstimado).toBeNull()
  })
})
