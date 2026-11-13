import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { RelogioFixo } from '@fir/domain'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'

/**
 * B1 + I3 + I4 (revisão LGPD/appsec): o que a jornada carrega — o histórico em
 * texto livre, o programa orçado com a dose e os PROCEDIMENTOS por paciente
 * identificado (dado de saúde, regra 18) — sai de QUATRO rotas, e as quatro
 * têm de dar a mesma resposta a quem não tem `jornada`.
 *
 * Também: o telefone do paciente DESATIVADO não sai em lista nenhuma (I3), e a
 * trilha de acesso da lista de tarefas da campanha grava o id da CAMPANHA (I4).
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const SENHA = 'seis-janelas-de-madeira-clara'
const codigo = `privjor-${Date.now()}`
const HOJE = '2026-11-18'
const AGORA = new RelogioFixo(new Date('2026-11-18T12:00:00.000Z'))

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let campanha: string
let paciente: string
let desativado: string
let tarefa: string
let tarefaDoDesativado: string
let tarefaComPrograma: string
const cookies: Record<string, string[]> = {}
const PROC = '11111111-1111-4111-8111-111111111111'

const srv = () => request(app.getHttpServer())
const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

// `tarefas.equipe` em todos: o que se mede aqui é `jornada`, não escopo.
const PERFIS: Record<string, string[]> = {
  // campanhas, sem pacientes e sem jornada
  camp: ['campanhas', 'tarefas.equipe'],
  camppac: ['campanhas', 'pacientes', 'tarefas.equipe'],
  pac: ['pacientes', 'tarefas.equipe'],
  jor: ['campanhas', 'pacientes', 'jornada', 'tarefas.equipe'],
  // gerir campanhas, mas sem `valores`: não enxerga nem digita meta em reais
  gerir: ['campanhas', 'campanhas.gerir'],
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', () => undefined)
  await migrate.connect()
  await declararAtorSistema(migrate)
  clinica = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Privacidade') RETURNING id`,
      [codigo],
    )
  ).rows[0]!.id
  const hash = await hashDeSenha(SENHA)
  for (const [chave, perms] of Object.entries(PERFIS)) {
    const pf = (
      await migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, $2, $2, $3) RETURNING id`,
        [clinica, `pf_${chave}`, perms],
      )
    ).rows[0]!.id
    await migrate.query(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
       VALUES ($1, $2, $3, $4, false, $5)`,
      [clinica, `Pessoa ${chave}`, chave, hash, pf],
    )
  }
  const resp = (
    await migrate.query<{ id: string }>(`SELECT id FROM pessoas WHERE clinica_id = $1 AND usuario = 'jor'`, [clinica])
  ).rows[0]!.id
  campanha = (
    await migrate.query<{ id: string }>(
      `INSERT INTO campanhas (clinica_id, nome, categoria, inicio, fim, metrica, meta)
       VALUES ($1, 'Novembro', 'Sazonal', '2026-11-01', '2026-11-30', 'receita', 1000000) RETURNING id`,
      [clinica],
    )
  ).rows[0]!.id
  const pac = async (nome: string, ativo: boolean) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO pacientes (clinica_id, nome, telefone, ativo, desativado_em) VALUES ($1, $2, '71999990000', $3, CASE WHEN $3 THEN NULL ELSE now() END) RETURNING id`,
        [clinica, nome, ativo],
      )
    ).rows[0]!.id
  paciente = await pac('Marta Alves', true)
  desativado = await pac('Rosa Lima', false)
  const nova = async (pacienteId: string, comPrograma = false) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO tarefas
           (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em, paciente_id, tipo,
            campanha_id, etapa, historico, proximo_passo_em, programa_orcado, itens_orcamento, valor_orcamento)
         VALUES ($1, $2, $2, 'orcamento', $3::date, 'concluida', now(), $4, 'Consulta realizada',
            $5, 'orcamento', $6::jsonb, '2026-11-20', $7::jsonb, $8::jsonb, 100000)
         RETURNING id`,
        [
          clinica,
          resp,
          HOJE,
          pacienteId,
          campanha,
          JSON.stringify([{ acao: 'orcamento', etapa: 'orcamento', em: '2026-11-10T10:00:00Z', nota: 'quer harmonizacao facial' }]),
          comPrograma ? JSON.stringify([{ procedimentoId: PROC, sessoes: 2, intervaloDias: 30, chave: 'i1', dose: '20 UI' }]) : null,
          comPrograma ? null : JSON.stringify([{ chave: 'i1', procedimentoId: PROC }]),
        ],
      )
    ).rows[0]!.id
  tarefa = await nova(paciente)
  tarefaDoDesativado = await nova(desativado)
  tarefaComPrograma = await nova(paciente, true)

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(AGORA)
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  for (const chave of Object.keys(PERFIS)) {
    cookies[chave] = cookieDe(
      await srv().post('/v1/entrar').send({ clinica: codigo, usuario: chave, senha: SENHA }).expect(200),
    )
  }
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await app.close()
})

type Cartao = {
  id: string
  pacienteNome: string | null
  pacienteTelefone: string | null
  historico: unknown[]
  proximoPassoEm: string | null
  programaOrcado: unknown[] | null
  itensOrcamento: unknown[] | null
}

/** Cada rota devolve os cartões de um jeito; aqui elas viram a mesma lista. */
const ROTAS: Record<string, (quem: string) => Promise<Cartao[]>> = {
  'GET /v1/campanhas/:id/tarefas': async (q) =>
    (await srv().get(`/v1/campanhas/${campanha}/tarefas`).set('Cookie', cookies[q]!).expect(200)).body.tarefas,
  'GET /v1/tarefas': async (q) =>
    (await srv().get('/v1/tarefas?escopo=equipe&situacao=todas&periodo=qualquer').set('Cookie', cookies[q]!).expect(200))
      .body.tarefas,
  'GET /v1/hoje': async (q) => {
    const b = (await srv().get('/v1/hoje?escopo=equipe').set('Cookie', cookies[q]!).expect(200)).body
    return [...b.tarefas, ...b.pendentes.itens, ...b.concluidas]
  },
  'GET /v1/pacientes/:id (ficha)': async (q) =>
    (await srv().get(`/v1/pacientes/${paciente}`).set('Cookie', cookies[q]!)).body.tarefas ?? [],
  'GET /v1/tarefas/:id': async (q) => {
    const saida: Cartao[] = []
    for (const id of [tarefa, tarefaComPrograma]) {
      const r = await srv().get(`/v1/tarefas/${id}`).set('Cookie', cookies[q]!)
      if (r.statusCode === 200) saida.push(r.body.tarefa)
    }
    return saida
  },
}

describe('B1 — a jornada só sai para quem tem `jornada`', () => {
  for (const [rota, ler] of Object.entries(ROTAS)) {
    describe(rota, () => {
      for (const quem of ['camp', 'camppac', 'pac']) {
        // A ficha exige `pacientes`; a campanha exige `campanhas`.
        const entra =
          rota.includes('campanhas') ? PERFIS[quem]!.includes('campanhas') : rota.includes('pacientes') ? PERFIS[quem]!.includes('pacientes') : true
        if (!entra) continue
        it(`${quem} (sem jornada) não recebe histórico, procedimentos nem dose`, async () => {
          const lista = await ler(quem)
          expect(lista.length).toBeGreaterThan(0)
          expect(lista.some((t) => t.id === tarefaComPrograma || t.id === tarefa)).toBe(true)
          for (const t of lista) {
            expect(t.itensOrcamento, 'itensOrcamento').toBeNull()
            expect(t.programaOrcado, 'programaOrcado').toBeNull()
            expect(t.historico, 'historico').toEqual([])
            expect(t.proximoPassoEm, 'proximoPassoEm').toBeNull()
          }
        })
      }
      it('jor (com jornada) continua recebendo tudo', async () => {
        const lista = await ler('jor')
        const t = lista.find((x) => x.id === tarefa)
        expect(t, 'a tarefa tem de estar na resposta').toBeDefined()
        expect(t!.itensOrcamento).toHaveLength(1)
        expect(t!.historico).toHaveLength(1)
        const p = lista.find((x) => x.id === tarefaComPrograma)
        expect(p!.programaOrcado).toHaveLength(1)
        // sem lista própria, a lista de itens é derivada do programa
        expect(p!.itensOrcamento).toHaveLength(1)
        expect(t!.proximoPassoEm).toBe('2026-11-20')
      })
    })
  }
})

describe('I3 — paciente desativado não entrega o telefone', () => {
  it('campanha, /v1/tarefas e Hoje mostram o nome e escondem o telefone', async () => {
    for (const rota of ['GET /v1/campanhas/:id/tarefas', 'GET /v1/tarefas', 'GET /v1/hoje']) {
      const lista = await ROTAS[rota]!('jor')
      const d = lista.find((t) => t.id === tarefaDoDesativado)
      expect(d, rota).toBeDefined()
      expect(d!.pacienteNome, rota).toBe('Rosa Lima')
      expect(d!.pacienteTelefone, rota).toBeNull()
      const ativo = lista.find((t) => t.id === tarefa)
      expect(ativo!.pacienteTelefone, rota).toBe(rota.includes('campanhas') ? '71999990000' : '71999990000')
    }
  })
})

describe('I4 — a trilha de acesso da campanha grava o id da campanha', () => {
  it('uma leitura grava "acessou" em `campanhas`, com o id dela', async () => {
    const antes = (
      await migrate.query<{ n: string }>(`SELECT count(*)::text AS n FROM auditoria WHERE clinica_id = $1 AND acao = 'acessou'`, [clinica])
    ).rows[0]!.n
    await ROTAS['GET /v1/campanhas/:id/tarefas']!('jor')
    const r = await migrate.query<{ entidade: string; entidade_id: string }>(
      `SELECT entidade, entidade_id FROM auditoria WHERE clinica_id = $1 AND acao = 'acessou' ORDER BY em DESC LIMIT 1`,
      [clinica],
    )
    expect(Number(antes)).toBeGreaterThanOrEqual(0)
    expect(r.rows[0]).toEqual({ entidade: 'campanhas', entidade_id: campanha })
  })
})

describe('I5 — quem gerencia campanhas sem `valores` não consegue zerar a meta em R$', () => {
  const metaNoBanco = async (): Promise<string> =>
    (await migrate.query<{ meta: string }>('SELECT meta::text AS meta FROM campanhas WHERE id = $1', [campanha]))
      .rows[0]!.meta

  it('o rascunho de "Repetir no próximo mês" vem SEM a meta em R$ (redação), mas com o resto', async () => {
    const r = await srv().get(`/v1/campanhas/${campanha}/proximo-mes`).set('Cookie', cookies['gerir']!).expect(200)
    expect(r.body.metaEmDinheiro).toBeNull()
    expect(r.body.nome).toBe('Novembro')
    expect(r.body.inicio).toBe('2026-12-01')
  })

  it('salvar a cópia (ou editar a original) sem digitar a meta é 400 — o contrato exige > 0 — e a meta guardada não muda', async () => {
    const rascunho = (
      await srv().get(`/v1/campanhas/${campanha}/proximo-mes`).set('Cookie', cookies['gerir']!).expect(200)
    ).body
    const copia = await srv().post('/v1/campanhas').set('Cookie', cookies['gerir']!).send(rascunho)
    expect(copia.statusCode, JSON.stringify(copia.body)).toBe(400)
    const edicao = await srv().put(`/v1/campanhas/${campanha}`).set('Cookie', cookies['gerir']!).send(rascunho)
    expect(edicao.statusCode, JSON.stringify(edicao.body)).toBe(400)
    const zero = await srv()
      .put(`/v1/campanhas/${campanha}`)
      .set('Cookie', cookies['gerir']!)
      .send({ ...rascunho, metaEmDinheiro: '0' })
    expect(zero.statusCode, JSON.stringify(zero.body)).toBe(400)
    expect(await metaNoBanco()).toBe('1000000')
  })
})
