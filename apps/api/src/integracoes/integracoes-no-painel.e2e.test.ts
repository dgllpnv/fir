import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, apagarOperadorDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'
import { AberturaDeIntegracoes } from './cofre-de-integracoes'
import { PEDIDO_DE_TESTE_DE_INTEGRACAO } from './integracoes-no-painel.service'

/**
 * T1 da integração MedX (spec `integracao-medx.md`, A.0–A.10): o cofre da
 * chave, o termo e as ligações, pelo painel do superadmin, contra o Postgres real.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_PAINEL = 'postgresql://fir_painel:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP = 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'
const SENHA_OP = 'quatro-pedras-no-caminho'

let app: NestFastifyApplication
let migrate: pg.Client
let operador: string
let painel: string
const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `integra.${sufixo}`
const clinicas: string[] = []
const pedidos: Array<{ clinicaId: string; pedidoId: string }> = []

const TOKEN = `medx_${randomBytes(24).toString('hex')}`
const OUTRO_TOKEN = `medx_${randomBytes(24).toString('hex')}`

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const http = () => request(app.getHttpServer())
const rota = (id: string, resto = '') => `/v1/superadmin/clinicas/${id}/integracoes${resto}`
let seq = 0

async function novaClinica(): Promise<string> {
  const r = await http()
    .post('/v1/superadmin/clinicas')
    .set('Cookie', painel)
    .send({
      codigo: `integra-${sufixo}-${++seq}`,
      nome: `Clínica Integra ${seq}`,
      fuso: 'America/Bahia',
      admin: { nome: 'Dra. Teste', usuario: 'teste' },
    })
    .expect(201)
  const id = r.body.id as string
  clinicas.push(id)
  return id
}

/** O que o worker (T2) gravaria depois de um teste verde. */
async function simularVerificacaoOk(clinicaId: string, escopos: string[], conta = `conta-${clinicaId}`) {
  await declararAtorSistema(migrate)
  await migrate.query(
    `UPDATE integracoes_da_clinica
        SET verificacao = 'ok', verificada_em = now(), conta_externa_id = $2,
            usuario_externo_nome = 'Integração FIR', escopos = $3, unidades_externas = 1
      WHERE clinica_id = $1`,
    [clinicaId, conta, escopos],
  )
}

const termo = { assinadoEm: '2026-11-16', assinadoPor: 'Dra. Responsável', versao: 'v1' }

beforeAll(async () => {
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
    .overrideProvider(PEDIDO_DE_TESTE_DE_INTEGRACAO)
    .useValue({ pedir: async (clinicaId: string, pedidoId: string) => void pedidos.push({ clinicaId, pedidoId }) })
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  painel = cookies(
    await http().post('/v1/superadmin/entrar').send({ usuario: USUARIO_OP, senha: SENHA_OP }).expect(200),
  )
    .map((c) => c.split(';')[0]!)
    .join('; ')
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM integracoes_da_clinica WHERE clinica_id = ANY($1)', [clinicas])
  await migrate.query(
    'DELETE FROM clientes_carteira WHERE clinica_id = ANY($1)',
    [clinicas],
  ).catch(() => undefined)
  for (const c of clinicas) await apagarClinicaDeTeste(migrate, c)
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await apagarOperadorDeTeste(migrate, operador)
  await migrate.end()
  await app.close()
})

describe('a chave (A.2, A.7, A.8)', () => {
  it('sem integração, a clínica é "Só FIR"', async () => {
    const id = await novaClinica()
    const r = await http().get(rota(id)).set('Cookie', painel).expect(200)
    expect(r.body).toEqual({
      provedor: 'so_fir',
      estado: 'sem_chave',
      finalDaChave: null,
      verificadaEm: null,
      usuarioExterno: null,
      contaExterna: null,
      escopos: [],
      unidades: 0,
      ligadoAgenda: false,
      ligadoFaturamento: false,
      metaMedidaPor: 'fir',
      statusDeCancelado: [],
      catalogoDeStatus: [],
      agenda: null,
      termo: null,
      ultimoErro: '',
    })
  })

  it('colar a chave grava selada; a resposta mostra só o final; o worker abre', async () => {
    const id = await novaClinica()
    const put = await http().put(rota(id, '/chave')).set('Cookie', painel).send({ chave: TOKEN }).expect(200)
    expect(JSON.stringify(put.body)).not.toContain(TOKEN)
    expect(put.body).toMatchObject({ provedor: 'medx', estado: 'nao_verificada', finalDaChave: TOKEN.slice(-4) })

    const get = await http().get(rota(id)).set('Cookie', painel).expect(200)
    expect(JSON.stringify(get.body)).not.toContain(TOKEN.slice(0, 20))

    const linha = (
      await migrate.query<{ segredo_cifrado: Buffer; segredo_versao: number }>(
        'SELECT segredo_cifrado, segredo_versao FROM integracoes_da_clinica WHERE clinica_id = $1',
        [id],
      )
    ).rows[0]!
    expect(linha.segredo_cifrado.includes(Buffer.from(TOKEN))).toBe(false)
    const abertura = AberturaDeIntegracoes.doAmbiente()
    expect(abertura.abrir(id, 'medx', linha.segredo_cifrado, linha.segredo_versao)).toBe(TOKEN)
    // O selado da clínica A não abre com o id de outra.
    expect(abertura.abrir(clinicas[0]!, 'medx', linha.segredo_cifrado, linha.segredo_versao)).toBeNull()
  })

  it('a mesma chave em outra clínica é recusada (S-6)', async () => {
    const id = await novaClinica()
    const r = await http().put(rota(id, '/chave')).set('Cookie', painel).send({ chave: TOKEN }).expect(409)
    expect(r.body.message).toMatch(/outra clínica/)
  })

  it('chave com espaço é 400', async () => {
    const id = await novaClinica()
    await http().put(rota(id, '/chave')).set('Cookie', painel).send({ chave: 'abc def ghi jkl mno pqr' }).expect(400)
  })

  it('nem o painel nem o balcão leem o segredo no banco (GRANT por coluna)', async () => {
    for (const url of [URL_PAINEL, URL_APP]) {
      const c = new pg.Client({ connectionString: url })
      await c.connect()
      try {
        await expect(c.query('SELECT segredo_cifrado FROM integracoes_da_clinica')).rejects.toMatchObject({
          code: '42501',
        })
      } finally {
        await c.end()
      }
    }
  })

  it('remover apaga o segredo de verdade e desliga tudo', async () => {
    const id = await novaClinica()
    await http().put(rota(id, '/chave')).set('Cookie', painel).send({ chave: OUTRO_TOKEN }).expect(200)
    const r = await http().delete(rota(id, '/chave')).set('Cookie', painel).expect(200)
    expect(r.body).toMatchObject({ estado: 'sem_chave', finalDaChave: null, ligadoAgenda: false })
    const linha = (
      await migrate.query(
        'SELECT segredo_cifrado, impressao_da_chave FROM integracoes_da_clinica WHERE clinica_id = $1',
        [id],
      )
    ).rows[0]
    expect(linha).toEqual({ segredo_cifrado: null, impressao_da_chave: null })
    // A chave removida pode ser usada de novo (em outra clínica, por exemplo).
    const outra = await novaClinica()
    await http().put(rota(outra, '/chave')).set('Cookie', painel).send({ chave: OUTRO_TOKEN }).expect(200)
  })
})

describe('termo, verificação e ligações (A.0, A.3, A.6)', () => {
  it('sem termo nem verificação, ligar é recusado', async () => {
    const id = await novaClinica()
    await http().put(rota(id, '/chave')).set('Cookie', painel).send({ chave: `medx_${randomBytes(20).toString('hex')}` }).expect(200)
    const r = await http().put(rota(id, '/ligacoes')).set('Cookie', painel).send({ agenda: true, faturamento: false }).expect(409)
    expect(r.body.message).toMatch(/termo/)

    await http().put(rota(id, '/termo')).set('Cookie', painel).send(termo).expect(200)
    const r2 = await http().put(rota(id, '/ligacoes')).set('Cookie', painel).send({ agenda: true, faturamento: false }).expect(409)
    expect(r2.body.message).toMatch(/Testar conexão/)
  })

  it('com termo e verificação verde, liga a agenda; o faturamento exige o escopo de finanças', async () => {
    const id = await novaClinica()
    await http().put(rota(id, '/chave')).set('Cookie', painel).send({ chave: `medx_${randomBytes(20).toString('hex')}` }).expect(200)
    await http().put(rota(id, '/termo')).set('Cookie', painel).send(termo).expect(200)
    await simularVerificacaoOk(id, ['agenda:read', 'contatos:details:read'])

    const r = await http().put(rota(id, '/ligacoes')).set('Cookie', painel).send({ agenda: true, faturamento: false }).expect(200)
    expect(r.body).toMatchObject({ ligadoAgenda: true, ligadoFaturamento: false, termo })

    const f = await http().put(rota(id, '/ligacoes')).set('Cookie', painel).send({ agenda: true, faturamento: true }).expect(409)
    expect(f.body.message).toMatch(/finanças/)
  })

  it('com o escopo de finanças, só a agenda não liga: ou liga o faturamento junto (B5)', async () => {
    const id = await novaClinica()
    await http().put(rota(id, '/chave')).set('Cookie', painel).send({ chave: `medx_${randomBytes(20).toString('hex')}` }).expect(200)
    await http().put(rota(id, '/termo')).set('Cookie', painel).send(termo).expect(200)
    await simularVerificacaoOk(id, ['agenda:read', 'contatos:details:read', 'financas:read', 'lancamentos:read'])
    const r = await http().put(rota(id, '/ligacoes')).set('Cookie', painel).send({ agenda: true, faturamento: false }).expect(409)
    expect(r.body.message).toMatch(/faturamento/)
    const ligado = await http().put(rota(id, '/ligacoes')).set('Cookie', painel).send({ agenda: true, faturamento: true }).expect(200)
    expect(ligado.body.metaMedidaPor).toBe('fir')

    // A régua das metas novas (C.10): MedX só com o faturamento ligado; desligar volta à FIR.
    const medx = await http()
      .put(rota(id, '/ligacoes'))
      .set('Cookie', painel)
      .send({ agenda: true, faturamento: true, metaMedidaPor: 'medx' })
      .expect(200)
    expect(medx.body.metaMedidaPor).toBe('medx')
    await http()
      .put(rota(id, '/ligacoes'))
      .set('Cookie', painel)
      .send({ agenda: false, faturamento: false, metaMedidaPor: 'medx' })
      .expect(400)
    const desligado = await http().put(rota(id, '/ligacoes')).set('Cookie', painel).send({ agenda: false, faturamento: false }).expect(200)
    expect(desligado.body.metaMedidaPor).toBe('fir')
  })

  it('trocar a chave volta a "não verificada", esquece a conta e desliga', async () => {
    const id = await novaClinica()
    await http().put(rota(id, '/chave')).set('Cookie', painel).send({ chave: `medx_${randomBytes(20).toString('hex')}` }).expect(200)
    await http().put(rota(id, '/termo')).set('Cookie', painel).send(termo).expect(200)
    await simularVerificacaoOk(id, ['agenda:read', 'contatos:details:read'])
    await http().put(rota(id, '/ligacoes')).set('Cookie', painel).send({ agenda: true, faturamento: false }).expect(200)

    const r = await http().put(rota(id, '/chave')).set('Cookie', painel).send({ chave: `medx_${randomBytes(20).toString('hex')}` }).expect(200)
    expect(r.body).toMatchObject({
      estado: 'nao_verificada',
      ligadoAgenda: false,
      contaExterna: null,
      usuarioExterno: null,
      escopos: [],
      termo,
    })
  })
})

describe('a agenda do MedX pelo painel (B.8, B.9; T3)', () => {
  async function prontaParaLigar(): Promise<string> {
    const id = await novaClinica()
    await http().put(rota(id, '/chave')).set('Cookie', painel).send({ chave: `medx_${randomBytes(20).toString('hex')}` }).expect(200)
    await http().put(rota(id, '/termo')).set('Cookie', painel).send(termo).expect(200)
    await simularVerificacaoOk(id, ['agenda:read', 'contatos:details:read', 'financas:read'])
    return id
  }
  const agendaDa = async (id: string) =>
    (
      await migrate.query(
        `SELECT a.provedor, a.ativa, a.url_secreta, p.admin AS responsavel_admin
           FROM agendas_externas a JOIN pessoas p ON p.id = a.responsavel_id WHERE a.clinica_id = $1`,
        [id],
      )
    ).rows

  it('ligar a agenda põe o MedX na linha única da clínica, com o administrador de responsável; desligar a apaga da leitura', async () => {
    const id = await prontaParaLigar()
    await http().put(rota(id, '/ligacoes')).set('Cookie', painel).send({ agenda: true, faturamento: false }).expect(200)
    expect(await agendaDa(id)).toEqual([{ provedor: 'medx', ativa: true, url_secreta: null, responsavel_admin: true }])

    await http().put(rota(id, '/ligacoes')).set('Cookie', painel).send({ agenda: false, faturamento: false }).expect(200)
    expect(await agendaDa(id)).toEqual([{ provedor: 'medx', ativa: false, url_secreta: null, responsavel_admin: true }])
    // Religar reaproveita a linha: continua uma por clínica.
    await http().put(rota(id, '/ligacoes')).set('Cookie', painel).send({ agenda: true, faturamento: false }).expect(200)
    expect(await agendaDa(id)).toHaveLength(1)
  })

  it('com o link iCal ativo, o MedX não liga por cima (um provedor por clínica)', async () => {
    const id = await prontaParaLigar()
    await declararAtorSistema(migrate)
    await migrate.query(
      `INSERT INTO agendas_externas (clinica_id, provedor, url_secreta, responsavel_id)
       SELECT $1, 'ical', 'https://exemplo.test/agenda.ics', id FROM pessoas WHERE clinica_id = $1 LIMIT 1`,
      [id],
    )
    const r = await http().put(rota(id, '/ligacoes')).set('Cookie', painel).send({ agenda: true, faturamento: false }).expect(409)
    expect(r.body.message).toMatch(/iCal/)
    expect((await agendaDa(id))[0]).toMatchObject({ provedor: 'ical', ativa: true })
  })

  it('trocar ou remover a chave tira a agenda do MedX da leitura', async () => {
    const id = await prontaParaLigar()
    await http().put(rota(id, '/ligacoes')).set('Cookie', painel).send({ agenda: true, faturamento: false }).expect(200)
    await http().delete(rota(id, '/chave')).set('Cookie', painel).expect(200)
    expect((await agendaDa(id))[0]).toMatchObject({ provedor: 'medx', ativa: false })
  })

  it('status de cancelado: configurado por clínica, só 0 a 12, e só com chave', async () => {
    const sem = await novaClinica()
    await http().put(rota(sem, '/status-de-cancelado')).set('Cookie', painel).send({ codigos: [6] }).expect(409)
    const id = await prontaParaLigar()
    const r = await http().put(rota(id, '/status-de-cancelado')).set('Cookie', painel).send({ codigos: [7, 6, 6] }).expect(200)
    expect(r.body.statusDeCancelado).toEqual([6, 7])
    await http().put(rota(id, '/status-de-cancelado')).set('Cookie', painel).send({ codigos: [13] }).expect(400)
    const g = await http().get(rota(id)).set('Cookie', painel).expect(200)
    expect(g.body.statusDeCancelado).toEqual([6, 7])
  })

  it('o painel vê o catálogo de status e o estado técnico da agenda, com os ciclos (D.2)', async () => {
    const id = await prontaParaLigar()
    await declararAtorSistema(migrate)
    await migrate.query(
      `UPDATE integracoes_da_clinica SET catalogo_de_status = '[{"id":0,"nome":"Agendado"},{"id":6,"nome":"Desmarcado"}]'
        WHERE clinica_id = $1`,
      [id],
    )
    const antes = await http().get(rota(id)).set('Cookie', painel).expect(200)
    expect(antes.body.catalogoDeStatus).toEqual([
      { id: 0, nome: 'Agendado' },
      { id: 6, nome: 'Desmarcado' },
    ])
    expect(antes.body.agenda).toBeNull()

    await http().put(rota(id, '/ligacoes')).set('Cookie', painel).send({ agenda: true, faturamento: false }).expect(200)
    await declararAtorSistema(migrate)
    for (const [em, resultado] of [
      ['2026-11-16T10:00:00Z', 'ok'],
      ['2026-11-16T11:00:00Z', 'falhou'],
    ] as const) {
      await migrate.query(
        `INSERT INTO ciclos_da_agenda_externa
           (clinica_id, provedor, janela_de, janela_ate, agendamentos_lidos, paginas, chamadas_de_contato,
            confirmacoes_por_id, resultado, em)
         VALUES ($1, 'medx', '2026-11-16T03:00:00Z', '2027-01-15T03:00:00Z', 12, 1, 2, 0, $2, $3)`,
        [id, resultado, em],
      )
    }
    const r = await http().get(rota(id)).set('Cookie', painel).expect(200)
    expect(r.body.agenda).toMatchObject({ ativa: true, ultimaLeituraEm: null, ultimoErro: '', ultimoResumo: null })
    expect(r.body.agenda.ciclos).toEqual([
      {
        em: '2026-11-16T11:00:00.000Z',
        janelaDe: '2026-11-16T03:00:00.000Z',
        janelaAte: '2027-01-15T03:00:00.000Z',
        agendamentosLidos: 12,
        paginas: 1,
        chamadasDeContato: 2,
        confirmacoesPorId: 0,
        resultado: 'falhou',
      },
      expect.objectContaining({ em: '2026-11-16T10:00:00.000Z', resultado: 'ok' }),
    ])
  })
})

describe('Testar conexão (A.4)', () => {
  it('enfileira só ids, e o segundo pedido em 30 s é 429', async () => {
    const id = await novaClinica()
    await http().post(rota(id, '/testar')).set('Cookie', painel).expect(409)
    await http().put(rota(id, '/chave')).set('Cookie', painel).send({ chave: `medx_${randomBytes(20).toString('hex')}` }).expect(200)

    const r = await http().post(rota(id, '/testar')).set('Cookie', painel).expect(202)
    expect(r.body).toMatchObject({ estado: 'pedida' })
    const pedido = pedidos.find((p) => p.clinicaId === id)
    expect(pedido).toBeDefined()
    expect(Object.keys(pedido!).sort()).toEqual(['clinicaId', 'pedidoId'])

    await http().post(rota(id, '/testar')).set('Cookie', painel).expect(429)
  })
})

describe('trilha e acesso (A.9, A.10)', () => {
  it('nenhuma trilha guarda a chave, o selado nem a impressão', async () => {
    const id = clinicas[1]!
    const imp = (
      await migrate.query<{ impressao_da_chave: string }>(
        'SELECT impressao_da_chave FROM integracoes_da_clinica WHERE clinica_id = $1',
        [id],
      )
    ).rows[0]!.impressao_da_chave
    const cif = (
      await migrate.query<{ hex: string }>(
        `SELECT encode(segredo_cifrado, 'hex') AS hex FROM integracoes_da_clinica WHERE clinica_id = $1`,
        [id],
      )
    ).rows[0]!.hex
    const trilhas = await migrate.query<{ t: string }>(
      `SELECT coalesce(de::text, '') || coalesce(para::text, '') AS t FROM auditoria WHERE clinica_id = ANY($1)
       UNION ALL
       SELECT coalesce(de::text, '') || coalesce(para::text, '') FROM auditoria_do_painel WHERE ator_id = $2`,
      [clinicas, operador],
    )
    expect(trilhas.rowCount).toBeGreaterThan(0)
    const tudo = trilhas.rows.map((x) => x.t).join('\n')
    for (const segredo of [TOKEN, OUTRO_TOKEN, imp, cif.slice(0, 40)]) expect(tudo).not.toContain(segredo)

    const doPainel = await migrate.query(
      `SELECT acao FROM auditoria_do_painel WHERE ator_id = $1 AND entidade = 'integracoes_da_clinica'`,
      [operador],
    )
    expect(doPainel.rowCount).toBeGreaterThan(0)
  })

  it('sem a sessão do painel, nenhuma rota responde (o painel esconde: 404)', async () => {
    const id = clinicas[0]!
    await http().get(rota(id)).expect(404)
    await http().put(rota(id, '/chave')).send({ chave: TOKEN }).expect(404)
  })
})
