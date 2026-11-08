import { CarteiraModule } from '../carteira.module'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BancoModule } from '../../banco/banco.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { declararAtorSistema } from '../../banco/limpeza-de-teste'
import { registrarCookie } from '../../main'
import { CarteiraGuard } from '../carteira.guard'
import { ProspeccaoCarteiraModule } from './prospeccao-carteira.module'
import { RotinaInternaService } from './rotina-interna.service'

/**
 * G5 — funil de prospecção e rotina interna. ADR 0016.
 *
 * Bootstrap PRÓPRIO (não `AppModule`), mesmo já fiado em
 * `carteira.module.ts`: este harness monta só o necessário para o teste —
 * `BancoModule` (global, `@Global()`), `CarteiraModule` (sessão/guard/
 * decorator da carteira) e `ProspeccaoCarteiraModule`, com `CarteiraGuard`
 * registrado como `APP_GUARD` (o mesmo papel que ele tem em `app.module.ts`).
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let app: NestFastifyApplication
let migrate: pg.Client
let grupoA: string
let grupoB: string
let usuarioAId: string
let usuarioBId: string
let cookieA: string
let cookieB: string

const sufixo = randomBytes(4).toString('hex')
const SENHA = 'quatro-pedras-no-caminho'

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')
const http = () => request(app.getHttpServer())

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  grupoA = (
    await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [
      `Grupo A ${sufixo}`,
    ])
  ).rows[0]!.id
  grupoB = (
    await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [
      `Grupo B ${sufixo}`,
    ])
  ).rows[0]!.id

  const hash = await hashDeSenha(SENHA)
  usuarioAId = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
       VALUES ($1, 'Gestora A', $2, 'grupo', $3) RETURNING id`,
      [`gestora.a.${sufixo}`, hash, grupoA],
    )
  ).rows[0]!.id
  usuarioBId = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
       VALUES ($1, 'Gestora B', $2, 'grupo', $3) RETURNING id`,
      [`gestora.b.${sufixo}`, hash, grupoB],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({
    imports: [BancoModule, CarteiraModule, ProspeccaoCarteiraModule],
    providers: [{ provide: APP_GUARD, useClass: CarteiraGuard }],
  }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  cookieA = paresDe(
    cookies(
      await http()
        .post('/v1/carteira/entrar')
        .send({ usuario: `gestora.a.${sufixo}`, senha: SENHA })
        .expect(200),
    ),
  )
  cookieB = paresDe(
    cookies(
      await http()
        .post('/v1/carteira/entrar')
        .send({ usuario: `gestora.b.${sufixo}`, senha: SENHA })
        .expect(200),
    ),
  )
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query(
    `DELETE FROM checkins_internos WHERE cliente_carteira_id IN
       (SELECT id FROM clientes_carteira WHERE grupo_id = ANY($1))`,
    [[grupoA, grupoB]],
  )
  await migrate.query(`DELETE FROM tarefas_internas WHERE grupo_id = ANY($1)`, [[grupoA, grupoB]])
  await migrate.query(`DELETE FROM rotinas_internas WHERE grupo_id = ANY($1)`, [[grupoA, grupoB]])
  await migrate.query(
    `DELETE FROM interacoes_do_lead WHERE lead_comercial_id IN
       (SELECT id FROM leads_comerciais WHERE grupo_id = ANY($1))`,
    [[grupoA, grupoB]],
  )
  await migrate.query(`DELETE FROM leads_comerciais WHERE grupo_id = ANY($1)`, [[grupoA, grupoB]])
  await migrate.query(`DELETE FROM clientes_carteira WHERE grupo_id = ANY($1)`, [[grupoA, grupoB]])
  await migrate.query(`DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)`, [
    [usuarioAId, usuarioBId],
  ])
  await migrate.query(`DELETE FROM usuarios_gestao WHERE id = ANY($1)`, [[usuarioAId, usuarioBId]])
  await migrate.query(`DELETE FROM grupos WHERE id = ANY($1)`, [[grupoA, grupoB]])
  await migrate.end()
  await app.close()
})

describe('ADR 0016 item 2 — grupo_id/responsavel nunca vêm crus do corpo da requisição', () => {
  it('sessão do grupo A tentando criar lead com grupoIdDeExpansao de B é recusada, e NENHUMA linha é criada', async () => {
    const nome = `Lead Cruzado ${sufixo}`
    await http()
      .post('/v1/carteira/leads')
      .set('Cookie', cookieA)
      .send({ nome, origem: 'indicação', temperatura: 'quente', grupoIdDeExpansao: grupoB })
      .expect(403)

    const r = await migrate.query('SELECT id FROM leads_comerciais WHERE nome = $1', [nome])
    expect(r.rows.length).toBe(0)
  })

  it('sessão do grupo A criando lead sem grupoIdDeExpansao grava SEMPRE o grupo da própria sessão', async () => {
    const r = await http()
      .post('/v1/carteira/leads')
      .set('Cookie', cookieA)
      .send({ nome: `Lead Normal ${sufixo}`, origem: 'site', temperatura: 'morno' })
      .expect(201)
    expect(r.body.lead.grupoId).toBe(grupoA)
  })

  it('responsável de outro grupo é recusado, nenhuma linha criada', async () => {
    const nome = `Lead Responsavel Cruzado ${sufixo}`
    await http()
      .post('/v1/carteira/leads')
      .set('Cookie', cookieA)
      .send({
        nome,
        origem: 'indicação',
        temperatura: 'frio',
        responsavelUsuarioGestaoId: usuarioBId,
      })
      .expect(403)
    const r = await migrate.query('SELECT id FROM leads_comerciais WHERE nome = $1', [nome])
    expect(r.rows.length).toBe(0)
  })
})

describe('tarefa interna — cliente/lead referenciado precisa estar no mesmo grupo (achado de IDOR)', () => {
  it('sessão do grupo A não consegue criar tarefa apontando para um Cliente Firmare do grupo B', async () => {
    const leadB = await http()
      .post('/v1/carteira/leads')
      .set('Cookie', cookieB)
      .send({ nome: `Lead B Para IDOR ${sufixo}`, origem: 'indicação', temperatura: 'quente' })
      .expect(201)
    const fechadoB = await http()
      .post(`/v1/carteira/leads/${leadB.body.lead.id}/etapa`)
      .set('Cookie', cookieB)
      .send({ etapa: 'ganho' })
      .expect(201)
    const clienteB = fechadoB.body.lead.clienteCarteiraId as string

    await http()
      .post('/v1/carteira/tarefas-internas')
      .set('Cookie', cookieA)
      .send({
        titulo: `Tarefa Cruzada ${sufixo}`,
        clienteCarteiraId: clienteB,
        prazo: '2030-01-01',
      })
      .expect(400)

    const r = await migrate.query(
      `SELECT id FROM tarefas_internas WHERE cliente_carteira_id = $1`,
      [clienteB],
    )
    expect(r.rows.length).toBe(0)
  })

  it('sessão do grupo A não consegue criar tarefa apontando para um Lead comercial do grupo B', async () => {
    const leadB = await http()
      .post('/v1/carteira/leads')
      .set('Cookie', cookieB)
      .send({ nome: `Lead B Para IDOR Tarefa ${sufixo}`, origem: 'indicação', temperatura: 'morno' })
      .expect(201)
    const leadBId = leadB.body.lead.id as string

    await http()
      .post('/v1/carteira/tarefas-internas')
      .set('Cookie', cookieA)
      .send({
        titulo: `Tarefa Cruzada Lead ${sufixo}`,
        leadComercialId: leadBId,
        prazo: '2030-01-01',
      })
      .expect(400)

    const r = await migrate.query(`SELECT id FROM tarefas_internas WHERE lead_comercial_id = $1`, [leadBId])
    expect(r.rows.length).toBe(0)
  })
})

describe('isolamento por grupo na leitura', () => {
  it('a sessão do grupo B não vê o lead do grupo A', async () => {
    const criado = await http()
      .post('/v1/carteira/leads')
      .set('Cookie', cookieA)
      .send({ nome: `Lead Isolado ${sufixo}`, origem: 'indicação', temperatura: 'quente' })
      .expect(201)

    const listaB = await http().get('/v1/carteira/leads').set('Cookie', cookieB).expect(200)
    expect(listaB.body.leads.map((l: { id: string }) => l.id)).not.toContain(criado.body.lead.id)

    const listaA = await http().get('/v1/carteira/leads').set('Cookie', cookieA).expect(200)
    expect(listaA.body.leads.map((l: { id: string }) => l.id)).toContain(criado.body.lead.id)
  })
})

describe('transição de etapa e perda', () => {
  it('perdido sem motivo é recusado pelo SERVIDOR', async () => {
    const lead = await http()
      .post('/v1/carteira/leads')
      .set('Cookie', cookieA)
      .send({ nome: `Lead Perda ${sufixo}`, origem: 'indicação', temperatura: 'frio' })
      .expect(201)

    await http()
      .post(`/v1/carteira/leads/${lead.body.lead.id}/etapa`)
      .set('Cookie', cookieA)
      .send({ etapa: 'perdido' })
      .expect(400)
  })

  it('perdido com motivo é aceito e fica terminal', async () => {
    const lead = await http()
      .post('/v1/carteira/leads')
      .set('Cookie', cookieA)
      .send({ nome: `Lead Perda Motivo ${sufixo}`, origem: 'indicação', temperatura: 'frio' })
      .expect(201)

    const r = await http()
      .post(`/v1/carteira/leads/${lead.body.lead.id}/etapa`)
      .set('Cookie', cookieA)
      .send({ etapa: 'perdido', motivoPerda: 'Foi para o concorrente.' })
      .expect(201)
    expect(r.body.lead.etapa).toBe('perdido')
    expect(r.body.lead.motivoPerda).toBe('Foi para o concorrente.')

    // Terminal: nenhuma transição depois.
    await http()
      .post(`/v1/carteira/leads/${lead.body.lead.id}/etapa`)
      .set('Cookie', cookieA)
      .send({ etapa: 'contato' })
      .expect(400)
  })
})

describe('conversão do lead — critério de aceite 2 e 6 do spec G5', () => {
  it('ganho cria EXATAMENTE uma linha em clientes_carteira, com clinica_id NULL, e é idempotente', async () => {
    const lead = await http()
      .post('/v1/carteira/leads')
      .set('Cookie', cookieA)
      .send({ nome: `Lead Fecha ${sufixo}`, origem: 'indicação', temperatura: 'quente' })
      .expect(201)

    const r1 = await http()
      .post(`/v1/carteira/leads/${lead.body.lead.id}/etapa`)
      .set('Cookie', cookieA)
      .send({ etapa: 'ganho' })
      .expect(201)
    const clienteId = r1.body.lead.clienteCarteiraId as string
    expect(clienteId).toBeTruthy()

    // Mesma requisição em dobro — idempotente, nunca uma segunda linha.
    const r2 = await http()
      .post(`/v1/carteira/leads/${lead.body.lead.id}/etapa`)
      .set('Cookie', cookieA)
      .send({ etapa: 'ganho' })
      .expect(201)
    expect(r2.body.lead.clienteCarteiraId).toBe(clienteId)

    const linhas = await migrate.query(
      'SELECT id, clinica_id, status FROM clientes_carteira WHERE id = $1',
      [clienteId],
    )
    expect(linhas.rows.length).toBe(1)
    expect(linhas.rows[0].clinica_id).toBeNull()
    expect(linhas.rows[0].status).toBe('onboarding')

    // Critério 6: a trilha vai para auditoria_do_painel, NUNCA para auditoria
    // com clinica_id NULL (o bloqueador de merge do ADR 0016 §3).
    const doPainel = await migrate.query(
      `SELECT acao, ator_tipo FROM auditoria_do_painel
        WHERE entidade = 'clientes_carteira' AND entidade_id = $1`,
      [clienteId],
    )
    expect(doPainel.rows.length).toBeGreaterThan(0)
    expect(doPainel.rows[0]!.ator_tipo).toBe('usuario_gestao')

    const naDaClinica = await migrate.query(
      `SELECT 1 FROM auditoria WHERE entidade = 'clientes_carteira' AND entidade_id = $1 AND clinica_id IS NULL`,
      [clienteId],
    )
    expect(naDaClinica.rows.length).toBe(0)
  })
})

describe('arquivar — regra 20/27, nunca DELETE', () => {
  it('arquivar não remove a linha do banco', async () => {
    const lead = await http()
      .post('/v1/carteira/leads')
      .set('Cookie', cookieA)
      .send({ nome: `Lead Arquiva ${sufixo}`, origem: 'indicação', temperatura: 'morno' })
      .expect(201)

    await http()
      .post(`/v1/carteira/leads/${lead.body.lead.id}/arquivar`)
      .set('Cookie', cookieA)
      .expect(201)

    const r = await migrate.query('SELECT arquivado_em FROM leads_comerciais WHERE id = $1', [
      lead.body.lead.id,
    ])
    expect(r.rows.length).toBe(1)
    expect(r.rows[0].arquivado_em).not.toBeNull()

    // A trilha de QUEM arquivou (ADR 0016, item 4) — a varredura automática
    // de auditoria-inescapavel.test.ts não alcança leads_comerciais sozinha
    // (sem clinica_id); este é o teste dedicado que o ADR exige.
    const trilha = await migrate.query(
      `SELECT ator_tipo, para FROM auditoria_do_painel
        WHERE entidade = 'leads_comerciais' AND entidade_id = $1 AND acao = 'alterou'
        ORDER BY em DESC LIMIT 1`,
      [lead.body.lead.id],
    )
    expect(trilha.rows.length).toBe(1)
    expect(trilha.rows[0]!.ator_tipo).toBe('usuario_gestao')
    expect(JSON.stringify(trilha.rows[0]!.para)).toContain('arquivado_em')
  })

  it('arquivar um lead já convertido é recusado', async () => {
    const lead = await http()
      .post('/v1/carteira/leads')
      .set('Cookie', cookieA)
      .send({ nome: `Lead Nao Arquiva Convertido ${sufixo}`, origem: 'indicação', temperatura: 'quente' })
      .expect(201)
    await http()
      .post(`/v1/carteira/leads/${lead.body.lead.id}/etapa`)
      .set('Cookie', cookieA)
      .send({ etapa: 'ganho' })
      .expect(201)

    await http()
      .post(`/v1/carteira/leads/${lead.body.lead.id}/arquivar`)
      .set('Cookie', cookieA)
      .expect(403)
  })
})

describe('checkin interno — semana corrente edita, anterior recusa (spec §7, critério 7)', () => {
  it('edita o checkin da semana corrente; recusa o de uma semana anterior', async () => {
    const lead = await http()
      .post('/v1/carteira/leads')
      .set('Cookie', cookieA)
      .send({ nome: `Lead Para Checkin ${sufixo}`, origem: 'indicação', temperatura: 'quente' })
      .expect(201)
    const fechado = await http()
      .post(`/v1/carteira/leads/${lead.body.lead.id}/etapa`)
      .set('Cookie', cookieA)
      .send({ etapa: 'ganho' })
      .expect(201)
    const clienteId = fechado.body.lead.clienteCarteiraId as string

    const criado = await http()
      .post('/v1/carteira/checkins-internos')
      .set('Cookie', cookieA)
      .send({ clienteCarteiraId: clienteId, nota: 'Primeira nota', saude: 'bom' })
      .expect(201)

    const editado = await http()
      .post(`/v1/carteira/checkins-internos/${criado.body.checkin.id}/atualizar`)
      .set('Cookie', cookieA)
      .send({ nota: 'Nota corrigida', saude: 'atencao' })
      .expect(201)
    expect(editado.body.checkin.nota).toBe('Nota corrigida')

    // Um checkin de uma semana ANTERIOR, inserido direto no banco (fixture) —
    // o endpoint de criação nunca permitiria mirar nele, por construção.
    const antigo = await migrate.query<{ id: string }>(
      `INSERT INTO checkins_internos (cliente_carteira_id, grupo_id, semana, nota, saude, por_usuario_gestao_id)
       VALUES ($1, $2, '2000-W01', 'Nota antiga', 'bom', $3) RETURNING id`,
      [clienteId, grupoA, usuarioAId],
    )
    await http()
      .post(`/v1/carteira/checkins-internos/${antigo.rows[0]!.id}/atualizar`)
      .set('Cookie', cookieA)
      .send({ nota: 'Tentando editar o passado', saude: 'critico' })
      .expect(403)
  })
})

describe('Marcador de rotina interna — critério de aceite 5 do spec G5 (§9)', () => {
  it('rodar o job duas vezes no mesmo dia não duplica a tarefa gerada (ON CONFLICT precisa funcionar de verdade)', async () => {
    const servico = app.get(RotinaInternaService)

    // G8 2A: o início da rotina é HOJE, do servidor (regra 24), e salvar já
    // gera as tarefas dos próximos 7 dias (o protótipo também, L2984).
    const rotina = await http()
      .post('/v1/carteira/rotinas-internas')
      .set('Cookie', cookieA)
      .send({
        titulo: `Rotina Idempotente ${sufixo}`,
        frequencia: 'diaria',
        escopoAplicacao: 'global',
      })
      .expect(201)
    const rotinaId = rotina.body.rotina.id as string
    const contar = async (): Promise<number> =>
      (
        await migrate.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM tarefas_internas WHERE rotina_interna_id = $1`,
          [rotinaId],
        )
      ).rows[0]!.n
    const depoisDeSalvar = await contar()
    expect(depoisDeSalvar).toBeGreaterThanOrEqual(1)
    expect(depoisDeSalvar).toBe(rotina.body.geradas)

    // Chama a função do JOB de verdade — não um mock, não uma simulação do
    // `ON CONFLICT` — a mesma que `worker-rotinas-internas.ts` chama.
    await servico.gerarTarefasDeRotinasInternas()
    await servico.gerarTarefasDeRotinasInternas()

    // A prova real: contagem de linhas no banco, não "não deu erro".
    expect(await contar()).toBe(depoisDeSalvar)
  })
})
