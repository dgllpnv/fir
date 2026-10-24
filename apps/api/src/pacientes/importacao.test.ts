import { MAX_IMPORT_PACIENTES } from '@fir/contracts'
import { RelogioFixo } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { SISTEMA } from '../banco/ator'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'
import { ImportacaoDePacientesService } from './importacao.service'

/**
 * A importação de pacientes — regra 26: **idempotente, três vezes**.
 *
 * Clínica própria, separada do `pacientes.e2e.test.ts`: estes testes contam
 * `novos`, `atualizados` e `ignorados`, e compartilhar a clínica com vinte
 * cadastros de outro arquivo tornaria a contagem frágil de um jeito que
 * ninguém saberia explicar seis meses depois.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'senha-de-teste-importacao'
const FUSO = 'America/Bahia'
/** 01/10 01:00 UTC = 30/09 na clínica. O mesmo instante do outro e2e. */
const AGORA = new Date('2026-10-01T01:00:00Z')

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
const codigo = `imp-${Date.now()}`
const cookies: Record<string, string[]> = {}

type Linha = {
  nome?: string
  telefone?: string
  aniversario?: string
  ultimaConsulta?: string
}

const umId = async (sql: string, params: unknown[]): Promise<string> =>
  (await migrate.query<{ id: string }>(sql, params)).rows[0]!.id

const importar = (linhas: Linha[], quem = 'beatriz', extra: Record<string, unknown> = {}) =>
  request(app.getHttpServer())
    .post('/v1/pacientes/importar')
    .set('Cookie', cookies[quem]!)
    .send({ linhas, ...extra })

const criar = (corpo: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/v1/pacientes').set('Cookie', cookies['beatriz']!).send(corpo)

const porNome = async (nome: string) => {
  const r = await migrate.query<{
    id: string
    nome: string
    telefone: string
    aniversario: Date | null
    ultima_consulta: string | null
    ativo: boolean
    unidade_id: string | null
  }>(
    `SELECT id, nome, telefone, aniversario, ultima_consulta::text AS ultima_consulta, ativo, unidade_id
       FROM pacientes WHERE clinica_id = $1 AND nome_chave = normalizar_nome($2)
      ORDER BY criado_em`,
    [clinica, nome],
  )
  return r.rows
}

const contar = async (): Promise<number> =>
  Number(
    (
      await migrate.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM pacientes WHERE clinica_id = $1',
        [clinica],
      )
    ).rows[0]!.n,
  )

/** O arquivo que será importado três vezes. */
const ARQUIVO: Linha[] = [
  { nome: 'Marina Prado', telefone: '(71) 98111-2233', aniversario: '1990-05-04' },
  { nome: 'Rodrigo Teles', telefone: '71982224455' },
  { nome: 'Sônia Vieira', ultimaConsulta: '2025-11-02' },
]

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[importacao] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinica = await umId(
    `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, 'Clínica Importação', $2) RETURNING id`,
    [codigo, FUSO],
  )
  const sup = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_sup', 'Supervisão', ARRAY['pacientes','pacientes.gerir']) RETURNING id`,
    [clinica],
  )
  const rec = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', ARRAY['pacientes']) RETURNING id`,
    [clinica],
  )
  const hash = await hashDeSenha(SENHA)
  for (const [nome, perfil] of [
    ['beatriz', sup],
    ['juliana', rec],
  ] as const) {
    await migrate.query(
      `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, perfil_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [clinica, nome, `${nome}@${codigo}.local`, hash, perfil],
    )
  }

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(new RelogioFixo(AGORA))
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  for (const quem of ['beatriz', 'juliana']) {
    const r = await request(app.getHttpServer())
      .post('/v1/entrar')
      .send({ clinica: codigo, email: `${quem}@${codigo}.local`, senha: SENHA })
      .expect(200)
    const v = r.headers['set-cookie'] as unknown
    cookies[quem] = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
  }
})

afterAll(async () => {
  await app.close()
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
})

describe('a importação é idempotente — regra 26', () => {
  it('importar o MESMO arquivo três vezes não cria nada novo', async () => {
    const antes = await contar()
    const a = (await importar(ARQUIVO).expect(200)).body
    const b = (await importar(ARQUIVO).expect(200)).body
    const c = (await importar(ARQUIVO).expect(200)).body

    expect(a.novos).toBe(ARQUIVO.length)
    expect(b.novos).toBe(0)
    expect(c.novos).toBe(0)
    // A segunda já não tem o que completar — tudo entrou na primeira.
    expect(b.atualizados).toBe(0)
    expect(c.atualizados).toBe(0)
    expect(b.ignorados).toBe(ARQUIVO.length)
    expect(await contar()).toBe(antes + ARQUIVO.length)
  })

  it('duas linhas com o mesmo telefone no MESMO arquivo criam um paciente só', async () => {
    const r = (
      await importar([
        { nome: 'Ana Souza Lima', telefone: '(71) 98888-7777' },
        { nome: 'Ana S. Lima', telefone: '71988887777' },
      ]).expect(200)
    ).body
    expect(r.novos).toBe(1)
    expect(r.ignorados).toBe(1)
  })

  it('duas linhas com o mesmo NOME no mesmo arquivo criam um paciente só', async () => {
    const r = (
      await importar([
        { nome: 'Júlio César Matos' },
        { nome: 'julio cesar  matos', telefone: '71999990000' },
      ]).expect(200)
    ).body
    expect(r.novos).toBe(1)
    expect(r.ignorados).toBe(1)
    expect(await porNome('Júlio César Matos')).toHaveLength(1)
  })

  it('nome em NFD (planilha de macOS) é a MESMA paciente, não uma segunda', async () => {
    // `Ângela` com acento COMBINANTE — é assim que um CSV exportado no macOS
    // chega. A chave de nome precisa sair do Postgres, não de um
    // `normalize('NFD')` em TypeScript: o `translate()` do SQL cobre uma
    // lista fixa de caracteres e o NFD tira qualquer diacrítico, então as duas
    // discordam exatamente aqui. Com duas chaves diferentes, a importação
    // conclui "cadastro novo" e o índice conclui "já existe" — e o que a
    // clínica vê é uma importação que estoura, ou uma paciente duplicada com
    // o LTV partido em dois.
    const nfd = 'Ângela Matos'
    const primeira = (await importar([{ nome: nfd }]).expect(200)).body
    expect(primeira.novos).toBe(1)

    const segunda = (await importar([{ nome: nfd }]).expect(200)).body
    expect(segunda.novos).toBe(0)
    expect(segunda.ignorados).toBe(1)

    const r = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pacientes
        WHERE clinica_id = $1 AND nome_chave = normalizar_nome($2)`,
      [clinica, nfd],
    )
    expect(r.rows[0]!.n).toBe('1')
  })

  it('telefone curto NÃO deduplica — é código de sala, não telefone', async () => {
    // A chave é telefone com 10+ dígitos. Dois cadastros com "1234" não são a
    // mesma pessoa, e tratá-los assim fundiria pacientes diferentes.
    const r = (
      await importar([
        { nome: 'Curto Um', telefone: '1234' },
        { nome: 'Curto Dois', telefone: '1234' },
      ]).expect(200)
    ).body
    expect(r.novos).toBe(2)
  })
})

describe('o que a importação completa, e o que ela não toca', () => {
  it('completa o vazio e NÃO sobrescreve o preenchido', async () => {
    await criar({ nome: 'Ana Preenchida', telefone: '71999990000' }).expect(201)
    const r = (
      await importar([
        { nome: 'Ana Preenchida', telefone: '71988887777', aniversario: '1990-03-02' },
      ]).expect(200)
    ).body
    const p = (await porNome('Ana Preenchida'))[0]!
    expect(p.telefone).toBe('71999990000') // intocado — regra 27
    expect(p.aniversario).not.toBeNull() // estava vazio: completou
    expect(r.atualizados).toBe(1)
    expect(r.novos).toBe(0)
  })

  it('`ultimaConsulta` só avança, nunca retrocede', async () => {
    await criar({ nome: 'Ultima Consulta', ultimaConsulta: '2026-05-10' }).expect(201)

    const recua = (await importar([{ nome: 'Ultima Consulta', ultimaConsulta: '2024-01-01' }]).expect(200)).body
    expect(recua.atualizados).toBe(0)
    expect((await porNome('Ultima Consulta'))[0]!.ultima_consulta).toBe('2026-05-10')

    const avanca = (await importar([{ nome: 'Ultima Consulta', ultimaConsulta: '2026-08-20' }]).expect(200)).body
    expect(avanca.atualizados).toBe(1)
    expect((await porNome('Ultima Consulta'))[0]!.ultima_consulta).toBe('2026-08-20')
  })

  it('datas no futuro são descartadas, e a linha entra assim mesmo', async () => {
    const r = (
      await importar([
        { nome: 'Data Do Futuro', aniversario: '2030-01-01', ultimaConsulta: '2026-10-01' },
      ]).expect(200)
    ).body
    expect(r.novos).toBe(1)
    const p = (await porNome('Data Do Futuro'))[0]!
    expect(p.aniversario).toBeNull()
    expect(p.ultima_consulta).toBeNull()
  })

  it('paciente DESATIVADO não é ressuscitado pela importação', async () => {
    // Regra 27: nunca se recria o que o usuário apagou.
    const id = (await criar({ nome: 'Foi Desativada', telefone: '71955554444' }).expect(201)).body.id
    await request(app.getHttpServer())
      .delete(`/v1/pacientes/${id}`)
      .set('Cookie', cookies['beatriz']!)
      .expect(200)

    const r = (await importar([{ nome: 'Foi Desativada', telefone: '71955554444' }]).expect(200))
      .body
    expect(r.novos).toBe(1)

    const linhas = await porNome('Foi Desativada')
    expect(linhas).toHaveLength(2)
    expect(linhas[0]!.id).toBe(id)
    expect(linhas[0]!.ativo).toBe(false)
    expect(linhas[1]!.ativo).toBe(true)
  })

  it('a unidade do lote só entra em quem ainda não tem', async () => {
    const unidade = await umId(
      `INSERT INTO unidades (clinica_id, nome) VALUES ($1, 'Pituba') RETURNING id`,
      [clinica],
    )
    const outra = await umId(
      `INSERT INTO unidades (clinica_id, nome) VALUES ($1, 'Itaigara') RETURNING id`,
      [clinica],
    )
    await criar({ nome: 'Ja Tem Unidade', unidadeId: outra }).expect(201)
    await importar(
      [{ nome: 'Ja Tem Unidade' }, { nome: 'Nao Tem Unidade' }],
      'beatriz',
      { unidadeId: unidade },
    ).expect(200)
    expect((await porNome('Ja Tem Unidade'))[0]!.unidade_id).toBe(outra)
    expect((await porNome('Nao Tem Unidade'))[0]!.unidade_id).toBe(unidade)
  })
})

describe('os limites e quem pode', () => {
  it('linha sem nome é ignorada, e não derruba a importação inteira', async () => {
    const r = (
      await importar([
        { telefone: '71900001111' },
        { nome: '   ' },
        { nome: 'Sobreviveu Ao Arquivo Ruim' },
      ]).expect(200)
    ).body
    expect(r.novos).toBe(1)
    expect(r.ignorados).toBe(2)
    expect(await porNome('Sobreviveu Ao Arquivo Ruim')).toHaveLength(1)
  })

  it('2.001 linhas é recusado, com o número na mensagem', async () => {
    const linhas = Array.from({ length: MAX_IMPORT_PACIENTES + 1 }, (_, i) => ({
      nome: `Paciente Numero ${i}`,
    }))
    const r = await importar(linhas)
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain(String(MAX_IMPORT_PACIENTES))
  })

  it('lista vazia é recusada', async () => {
    expect((await importar([])).statusCode).toBe(400)
  })

  it('sem `pacientes.gerir`, 403 — e nada é criado', async () => {
    const antes = await contar()
    await importar([{ nome: 'Nao Deve Existir' }], 'juliana').expect(403)
    expect(await contar()).toBe(antes)
  })

  it('duas importações CONCORRENTES do mesmo arquivo não duplicam ninguém', async () => {
    // A deduplicação em memória não cobre esta corrida: são duas transações
    // que não se enxergam — as duas fazem o SELECT antes de qualquer COMMIT,
    // as duas concluem que o cadastro não existe, e as duas tentam inserir.
    // Quem cobre é o índice único, e a importação precisa SOBREVIVER a ele
    // (`ON CONFLICT DO NOTHING`) em vez de estourar na cara de quem importou.
    //
    // Pelo serviço, e não por duas requisições HTTP: medido nesta máquina,
    // dois `request()` em `Promise.all` chegam SERIALIZADOS — o segundo já
    // enxerga o primeiro, nenhuma corrida acontece, e o teste passava
    // igualmente com e sem o `ON CONFLICT`. Um teste que não distingue as duas
    // implementações não testa nenhuma.
    const servico = app.get(ImportacaoDePacientesService)
    const clinicaMarcada = clinica as unknown as Parameters<typeof servico.importar>[0]
    const arquivo = [
      { nome: 'Corrida Um', telefone: '71931110000' },
      { nome: 'Corrida Dois', telefone: '71931112222' },
    ]
    const entrada = { unidadeId: null, linhas: arquivo }
    const [a, b] = await Promise.all([
      servico.importar(clinicaMarcada, SISTEMA, FUSO, entrada),
      servico.importar(clinicaMarcada, SISTEMA, FUSO, entrada),
    ])
    expect(a.novos + b.novos).toBe(2)
    expect(await porNome('Corrida Um')).toHaveLength(1)
    expect(await porNome('Corrida Dois')).toHaveLength(1)
  })
})
