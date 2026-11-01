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
import { hashDeSenha } from '../autenticacao/senha'

/**
 * **Pessoas › Equipe** — a ficha, as férias, os documentos e o banco de horas.
 *
 * O teste que define este arquivo é **"o salário não atravessa"**, e ele tem
 * três partes, porque a defesa tem três camadas:
 *
 *  1. A rota é **403** sem `pessoas.gerir`.
 *  2. Com `pessoas.gerir` e **sem** `valores`, o salário atravessa INTEIRO —
 *     dado de RH não se libera junto com receita, e o contrário faria a
 *     gestora que não fecha caixa não ver salário nenhum.
 *  3. Com `config` + `valores` e **sem** `pessoas.gerir`, `GET /v1/auditoria`
 *     entrega o `de`/`para` da escrita com `salario` em **`null`**. Esta é a
 *     que mata a mutação: sem o mapeamento `salario → pessoas.gerir` em
 *     `CHAVE_DO_CAMPO`, a redação cairia no padrão `valores`, que esta pessoa
 *     TEM — e o salário vazaria pela rota que entrega toda escrita da clínica.
 *     Um teste feito só com quem não tem `valores` passaria com a mutação
 *     aplicada.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'montanha-de-vidro-aberta'
const codigo = `eq-${Date.now()}`

/** 01/11/2026, 12:00 UTC — 09:00 em `America/Bahia`, que é o fuso padrão. */
const INICIO = new Date('2026-11-01T12:00:00.000Z')
let agora = new Date(INICIO)
const relogioDeTeste: Relogio = { agora: () => agora }

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let outraClinica: string
let perfilRh: string
let perfilAdministrativo: string
let idDaBia: string

let admin: string[]
/** `pessoas.gerir` e NADA de `valores`: a gestora de RH. */
let rh: string[]
/** `config` + `valores`, SEM `pessoas.gerir`: o administrativo financeiro. */
let administrativo: string[]
let adminDaOutra: string[]

const srv = () => request(app.getHttpServer())
const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const entrar = (usuario: string, cod = codigo) =>
  srv().post('/v1/entrar').send({ clinica: cod, usuario, senha: SENHA })

type Corpo = Record<string, unknown>
const FICHA_BASE: Corpo = {
  nome: 'Juliana Matos',
  cargo: 'Recepcionista',
  contrato: 'CLT',
  admissao: '2024-03-01',
  aniversario: '1994-11-12',
  salario: '350000',
  pessoaId: null,
  gestorId: null,
  ativo: true,
}

const criarFicha = (sessao: string[], corpo: Corpo = FICHA_BASE) =>
  srv().post('/v1/fichas').set('Cookie', sessao).send(corpo)

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[equipe] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  const novaClinica = async (cod: string): Promise<string> =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica da Equipe') RETURNING id`,
        [cod],
      )
    ).rows[0]!.id
  clinica = await novaClinica(codigo)
  outraClinica = await novaClinica(`${codigo}-b`)

  const novoPerfil = async (c: string, chave: string, nome: string, perms: string[]) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, $2, $3, $4) RETURNING id`,
        [c, chave, nome, perms],
      )
    ).rows[0]!.id

  perfilRh = await novoPerfil(clinica, 'pf_rh', 'RH', ['pessoas.gerir'])
  /**
   * O PERFIL QUE MATA A MUTAÇÃO: `config` para ler a trilha, `valores` para
   * ver dinheiro, e **nada** de `pessoas.gerir`. É o administrativo que
   * administra a clínica e não deve ver o salário da equipe.
   */
  perfilAdministrativo = await novoPerfil(clinica, 'pf_adm', 'Administrativo', [
    'config',
    'valores',
  ])

  const hash = await hashDeSenha(SENHA)
  const novaPessoa = async (c: string, nome: string, usuario: string, perfil: string | null) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [c, nome, usuario, hash, perfil === null, perfil],
      )
    ).rows[0]!.id

  await novaPessoa(clinica, 'Helena Prado', 'helena', null)
  await novaPessoa(clinica, 'Marta Lima', 'marta', perfilRh)
  await novaPessoa(clinica, 'Sandra Reis', 'sandra', perfilAdministrativo)
  idDaBia = await novaPessoa(clinica, 'Bia Costa', 'bia', perfilRh)
  await novaPessoa(outraClinica, 'Vizinha', 'vizinha', null)

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(relogioDeTeste)
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  admin = cookieDe(await entrar('helena').expect(200))
  rh = cookieDe(await entrar('marta').expect(200))
  administrativo = cookieDe(await entrar('sandra').expect(200))
  adminDaOutra = cookieDe(await entrar('vizinha', `${codigo}-b`).expect(200))
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, outraClinica)
  await migrate.end()
  await app.close()
})

beforeEach(async () => {
  agora = new Date(INICIO)
  // A ficha e os filhos dela, zerados entre testes. `DELETE` e não soft
  // delete: isto é limpeza de teste, não caminho de produção.
  for (const t of [
    'banco_de_horas',
    'documentos_da_pessoa',
    'ferias_da_pessoa',
    'fichas_de_pessoa',
    'configuracao_de_pessoal',
  ]) {
    await migrate.query(`DELETE FROM ${t} WHERE clinica_id = $1`, [clinica])
  }
})

// ---------------------------------------------------------------------------
// A PROVA DO SALÁRIO
// ---------------------------------------------------------------------------

describe('o salário não atravessa sem pessoas.gerir', () => {
  it('a Equipe inteira é 403 para quem tem config e valores, mas não pessoas.gerir', async () => {
    const criada = await criarFicha(admin)
    expect(criada.status).toBe(201)
    const id = criada.body.id as string

    for (const [metodo, caminho] of [
      ['get', '/v1/fichas'],
      ['get', `/v1/fichas/${id}`],
      ['get', '/v1/fichas/horas/2026-10'],
      ['get', '/v1/fichas/configuracao'],
    ] as const) {
      const r = await srv()[metodo](caminho).set('Cookie', administrativo)
      expect(r.status, `${metodo} ${caminho}`).toBe(403)
    }
    expect((await criarFicha(administrativo)).status).toBe(403)
    expect(
      (await srv().put(`/v1/fichas/${id}`).set('Cookie', administrativo).send(FICHA_BASE)).status,
    ).toBe(403)
  })

  /**
   * A MUTAÇÃO QUE ESTE TESTE PEGA: apagar `{ salario: 'pessoas.gerir' }` de
   * `CHAVE_DO_CAMPO` no `RedacaoInterceptor`.
   *
   * Sem a entrada, a redação cai no padrão `valores` — que Sandra TEM —, e o
   * salário de Juliana atravessa inteiro na rota que entrega o `de`/`para` de
   * toda escrita da clínica. Feito com uma pessoa sem `valores`, o teste
   * passaria com a mutação aplicada, porque a redação apagaria o campo pelo
   * caminho errado e com o resultado certo.
   */
  it('na TRILHA, o salário sai null para quem tem valores e não tem pessoas.gerir', async () => {
    const criada = await criarFicha(admin, { ...FICHA_BASE, salario: '350000' })
    expect(criada.status).toBe(201)
    const id = criada.body.id as string
    // Um segundo salário, para que a trilha tenha `de` E `para`.
    await srv()
      .put(`/v1/fichas/${id}`)
      .set('Cookie', admin)
      .send({ ...FICHA_BASE, salario: '450000' })
      .expect(200)

    const comoSandra = await srv()
      .get('/v1/auditoria?entidade=fichas_de_pessoa&limite=50')
      .set('Cookie', administrativo)
      .expect(200)

    const itens = comoSandra.body.itens as { de: Corpo | null; para: Corpo | null }[]
    expect(itens.length).toBeGreaterThan(1)
    for (const i of itens) {
      // A CHAVE FICA, o valor some: a forma da resposta não muda com a
      // permissão, e o cliente distingue "sem acesso" de "sem valor".
      if (i.para !== null && 'salario' in i.para) expect(i.para['salario']).toBe(null)
      if (i.de !== null && 'salario' in i.de) expect(i.de['salario']).toBe(null)
    }
    // E a prova POSITIVA: Sandra lê a trilha de verdade. Sem ela, o teste
    // acima passaria num corpo vazio.
    expect(itens.some((i) => i.para !== null && i.para['nome'] === 'Juliana Matos')).toBe(true)
    // O que não é dinheiro continua inteiro — a trilha é dado da clínica.
    expect(itens.some((i) => i.para !== null && i.para['cargo'] === 'Recepcionista')).toBe(true)
    // E NENHUM dos dois valores aparece em lugar nenhum do corpo.
    expect(JSON.stringify(comoSandra.body)).not.toContain('350000')
    expect(JSON.stringify(comoSandra.body)).not.toContain('450000')
  })

  it('com pessoas.gerir e SEM valores, o salário atravessa INTEIRO', async () => {
    // Dado de RH não se libera junto com receita: a gestora que não fecha o
    // caixa precisa ver o salário da equipe dela. É o outro lado da regra, e
    // sem este teste a mutação "mapear salario para valores" sobreviveria nos
    // dois sentidos.
    const criada = await criarFicha(rh, { ...FICHA_BASE, salario: '350000' })
    expect(criada.status).toBe(201)
    expect(criada.body.salario).toBe('350000')

    const lida = await srv().get(`/v1/fichas/${criada.body.id}`).set('Cookie', rh).expect(200)
    expect(lida.body.salario).toBe('350000')
  })

  it('a LISTA não carrega salário — é por isso que só a ficha é @DadoSensivel', async () => {
    await criarFicha(admin).expect(201)
    const lista = await srv().get('/v1/fichas').set('Cookie', admin).expect(200)
    expect(lista.body.fichas).toHaveLength(1)
    expect('salario' in lista.body.fichas[0]).toBe(false)
    expect(JSON.stringify(lista.body)).not.toContain('350000')
  })

  it('abrir a ficha fica na TRILHA — a pergunta é "quem olhou o salário dela"', async () => {
    const criada = await criarFicha(admin).expect(201)
    const id = criada.body.id as string
    await srv().get(`/v1/fichas/${id}`).set('Cookie', rh).expect(200)

    // Por `entidade_id`, não por contagem global: `beforeEach` limpa as
    // fichas e NÃO a trilha — ela é append-only, e apagá-la entre testes
    // seria apagar exatamente o que este teste mede.
    const r = await migrate.query<{ ator_id: string | null }>(
      `SELECT ator_id FROM auditoria
        WHERE clinica_id = $1 AND acao = 'acessou'
          AND entidade = 'fichas_de_pessoa' AND entidade_id = $2`,
      [clinica, id],
    )
    expect(r.rows).toHaveLength(1)
    // E o ator é QUEM ABRIU — Marta, não a admin que criou a ficha.
    const marta = await migrate.query<{ id: string }>(
      'SELECT id FROM pessoas WHERE clinica_id = $1 AND usuario = $2',
      [clinica, 'marta'],
    )
    expect(r.rows[0]!.ator_id).toBe(marta.rows[0]!.id)
  })

  it('a ficha da clínica vizinha não existe vista daqui', async () => {
    const criada = await criarFicha(admin).expect(201)
    await srv().get(`/v1/fichas/${criada.body.id}`).set('Cookie', adminDaOutra).expect(404)
    const dela = await srv().get('/v1/fichas').set('Cookie', adminDaOutra).expect(200)
    expect(dela.body.fichas).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// A FICHA
// ---------------------------------------------------------------------------

describe('a ficha de pessoa', () => {
  it('existe para quem NÃO usa a ferramenta — é o que o MANUAL promete', async () => {
    const r = await criarFicha(admin, { ...FICHA_BASE, nome: 'Dona Cida', pessoaId: null })
    expect(r.status).toBe(201)
    expect(r.body.pessoaId).toBe(null)
    expect(r.body.pessoaNome).toBe(null)
  })

  it('tempo de casa e meses saem do SERVIDOR, nunca gravados', async () => {
    // Admissão 01/03/2024, hoje 01/11/2026 → 32 meses.
    const r = await criarFicha(admin).expect(201)
    expect(r.body.mesesDeCasa).toBe(32)
    const linha = await migrate.query<Corpo>('SELECT * FROM fichas_de_pessoa WHERE id = $1', [
      r.body.id,
    ])
    // NENHUM derivado é coluna (regra 11).
    for (const campo of ['meses_de_casa', 'tempo_de_casa', 'dias_de_ferias', 'quantos_alertas']) {
      expect(campo in linha.rows[0]!).toBe(false)
    }
  })

  it('UMA ficha por usuário, e a recusa NOMEIA quem já o tem', async () => {
    await criarFicha(admin, { ...FICHA_BASE, pessoaId: idDaBia }).expect(201)
    const segunda = await criarFicha(admin, {
      ...FICHA_BASE,
      nome: 'Outra Pessoa',
      pessoaId: idDaBia,
    })
    expect(segunda.status).toBe(409)
    expect(segunda.body.message).toContain('Juliana Matos')
  })

  it('o usuário de OUTRA clínica é recusado — a FK composta não o aceita', async () => {
    const vizinha = (
      await migrate.query<{ id: string }>('SELECT id FROM pessoas WHERE clinica_id = $1', [
        outraClinica,
      ])
    ).rows[0]!.id
    const r = await criarFicha(admin, { ...FICHA_BASE, pessoaId: vizinha })
    // 422: o corpo está bem formado e a permissão existe — o que se recusa é
    // o estado. A RLS faz a pessoa da vizinha simplesmente não existir aqui.
    expect(r.status).toBe(422)
  })

  it('desativar é um ESTADO: não há DELETE de ficha', async () => {
    const criada = await criarFicha(admin).expect(201)
    const r = await srv().delete(`/v1/fichas/${criada.body.id}`).set('Cookie', admin)
    expect(r.status).toBe(404)

    const desativada = await srv()
      .put(`/v1/fichas/${criada.body.id}`)
      .set('Cookie', admin)
      .send({ ...FICHA_BASE, ativo: false })
      .expect(200)
    expect(desativada.body.ativo).toBe(false)
    // Ficha inativa não alerta — quem saiu não tem férias a programar.
    expect(desativada.body.alertas).toEqual([])
  })

  it('"sem ficha" lista os usuários ativos ainda sem ficha, e a lista encolhe', async () => {
    const antes = await srv().get('/v1/fichas').set('Cookie', admin).expect(200)
    const quantosAntes = (antes.body.semFicha as Corpo[]).length
    expect(quantosAntes).toBe(4)

    await criarFicha(admin, { ...FICHA_BASE, pessoaId: idDaBia }).expect(201)
    const depois = await srv().get('/v1/fichas').set('Cookie', admin).expect(200)
    expect((depois.body.semFicha as Corpo[]).length).toBe(quantosAntes - 1)
    expect((depois.body.semFicha as Corpo[]).some((u) => u['pessoaId'] === idDaBia)).toBe(false)
  })

  it('aniversariantes são os do MÊS DA CLÍNICA, não do UTC', async () => {
    // 12/11 em novembro: entra. 01/12: não.
    await criarFicha(admin, { ...FICHA_BASE, aniversario: '1994-11-12' }).expect(201)
    await criarFicha(admin, {
      ...FICHA_BASE,
      nome: 'Outra Pessoa',
      aniversario: '1990-12-01',
    }).expect(201)
    const r = await srv().get('/v1/fichas').set('Cookie', admin).expect(200)
    expect(r.body.aniversariantesDoMes).toHaveLength(1)
    expect(r.body.aniversariantesDoMes[0].nome).toBe('Juliana Matos')
  })

  it('corpo com campo desconhecido é 400 — `.strict()` tem dentes', async () => {
    const r = await criarFicha(admin, { ...FICHA_BASE, pin: '1234' })
    expect(r.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// FÉRIAS
// ---------------------------------------------------------------------------

describe('férias', () => {
  const novaFicha = async (over: Corpo = {}) =>
    (await criarFicha(admin, { ...FICHA_BASE, ...over }).expect(201)).body.id as string

  it('o período aquisitivo e o prazo legal saem prontos do servidor', async () => {
    // Admissão 01/03/2024, hoje 01/11/2026: dois períodos completos.
    const id = await novaFicha()
    const r = await srv().get(`/v1/fichas/${id}`).set('Cookie', admin).expect(200)
    expect(r.body.periodosAquisitivos).toMatchObject([
      {
        indice: 1,
        inicio: '2024-03-01',
        fim: '2025-02-28',
        concederAte: '2026-02-28',
        diasRestantes: 30,
        vencido: true,
      },
      { indice: 2, inicio: '2025-03-01', fim: '2026-02-28', concederAte: '2027-02-28' },
    ])
    expect(r.body.primeiroPeriodoCompletaEm).toBe(null)
  })

  it('sem período completo, a tela ganha a data em que o primeiro completa', async () => {
    const id = await novaFicha({ admissao: '2026-06-01' })
    const r = await srv().get(`/v1/fichas/${id}`).set('Cookie', admin).expect(200)
    expect(r.body.periodosAquisitivos).toEqual([])
    expect(r.body.primeiroPeriodoCompletaEm).toBe('2027-05-31')
  })

  it('registrar férias abate o período mais antigo, e `dias` vem do servidor', async () => {
    const id = await novaFicha()
    const r = await srv()
      .post(`/v1/fichas/${id}/ferias`)
      .set('Cookie', admin)
      .send({ inicio: '2025-07-01', fim: '2025-07-30', situacao: 'gozada' })
      .expect(201)
    // 01→30 são 30 dias, não 29: as duas pontas contam.
    expect(r.body.ferias).toMatchObject([{ dias: 30, situacao: 'gozada' }])
    expect(r.body.periodosAquisitivos[0]).toMatchObject({
      diasConcedidos: 30,
      diasRestantes: 0,
      vencido: false,
    })
    expect(r.body.periodosAquisitivos[1].diasConcedidos).toBe(0)
  })

  it('PERÍODO SOBREPOSTO É RECUSADO — a divergência consciente do protótipo', async () => {
    const id = await novaFicha()
    await srv()
      .post(`/v1/fichas/${id}/ferias`)
      .set('Cookie', admin)
      .send({ inicio: '2025-07-01', fim: '2025-07-30' })
      .expect(201)

    // Idêntico, dentro, em volta e encostando no último dia: os quatro.
    for (const periodo of [
      { inicio: '2025-07-01', fim: '2025-07-30' },
      { inicio: '2025-07-10', fim: '2025-07-12' },
      { inicio: '2025-06-01', fim: '2025-08-01' },
      { inicio: '2025-07-30', fim: '2025-08-05' },
    ]) {
      const r = await srv().post(`/v1/fichas/${id}/ferias`).set('Cookie', admin).send(periodo)
      expect(r.status, JSON.stringify(periodo)).toBe(409)
    }
    // Adjacente passa: 31/07 começa depois de 30/07 acabar.
    await srv()
      .post(`/v1/fichas/${id}/ferias`)
      .set('Cookie', admin)
      .send({ inicio: '2025-07-31', fim: '2025-08-02' })
      .expect(201)
  })

  it('a sobreposição é recusada pelo BANCO também, não só pelo serviço', async () => {
    const id = await novaFicha()
    await srv()
      .post(`/v1/fichas/${id}/ferias`)
      .set('Cookie', admin)
      .send({ inicio: '2025-07-01', fim: '2025-07-30' })
      .expect(201)

    // A aplicação erra DE PROPÓSITO, por fora do serviço, e é o `EXCLUDE` que
    // recusa. É isto que fecha a corrida entre duas abas, que nenhuma
    // leitura-antes-de-escrita fecha.
    await declararAtorSistema(migrate)
    await expect(
      migrate.query(
        `INSERT INTO ferias_da_pessoa (clinica_id, ficha_id, inicio, fim)
         VALUES ($1, $2, '2025-07-15', '2025-07-20')`,
        [clinica, id],
      ),
    ).rejects.toThrow(/ferias_nao_se_sobrepoem|conflicting key/i)
  })

  it('remover férias é SOFT DELETE, e o período volta a dever', async () => {
    const id = await novaFicha()
    const criada = await srv()
      .post(`/v1/fichas/${id}/ferias`)
      .set('Cookie', admin)
      .send({ inicio: '2025-07-01', fim: '2025-07-30' })
      .expect(201)
    const feriasId = criada.body.ferias[0].id as string

    const depois = await srv()
      .delete(`/v1/fichas/${id}/ferias/${feriasId}`)
      .set('Cookie', admin)
      .expect(200)
    expect(depois.body.ferias).toEqual([])
    expect(depois.body.periodosAquisitivos[0].diasRestantes).toBe(30)

    // A linha continua lá, com o instante da exclusão.
    const linha = await migrate.query<{ excluida_em: Date | null }>(
      'SELECT excluida_em FROM ferias_da_pessoa WHERE id = $1',
      [feriasId],
    )
    expect(linha.rows[0]!.excluida_em).not.toBe(null)

    // E o período liberado pode ser registrado de novo — o `EXCLUDE` é parcial.
    await srv()
      .post(`/v1/fichas/${id}/ferias`)
      .set('Cookie', admin)
      .send({ inicio: '2025-07-01', fim: '2025-07-30' })
      .expect(201)
  })

  it('fim antes do início é 400, com a mensagem dela', async () => {
    const id = await novaFicha()
    const r = await srv()
      .post(`/v1/fichas/${id}/ferias`)
      .set('Cookie', admin)
      .send({ inicio: '2025-07-30', fim: '2025-07-01' })
    expect(r.status).toBe(400)
    expect(r.body.message).toContain('Confira as datas das férias')
  })

  it('férias vencidas viram alerta CRÍTICO com o prazo da tarefa em hoje', async () => {
    const id = await novaFicha()
    const r = await srv().get(`/v1/fichas/${id}`).set('Cookie', admin).expect(200)
    const f = (r.body.alertas as Corpo[]).find((a) => a['tipo'] === 'Férias')
    expect(f).toMatchObject({ severidade: 'critico', em: '2026-02-28', prazoDaTarefa: '2026-11-01' })
    expect(f!['texto']).toContain('pagas em dobro')
    // A descrição da tarefa sai do SERVIDOR, com o nome de quem é.
    expect(f!['descricaoDaTarefa']).toContain('Juliana Matos')
  })
})

// ---------------------------------------------------------------------------
// DOCUMENTOS
// ---------------------------------------------------------------------------

describe('documentos com validade', () => {
  const novaFicha = async (over: Corpo = {}) =>
    (await criarFicha(admin, { ...FICHA_BASE, admissao: null, ...over }).expect(201)).body
      .id as string

  it('o VALOR do documento é o alerta: 30 dias antes avisa, 31 não', async () => {
    const id = await novaFicha()
    const em30 = await srv()
      .post(`/v1/fichas/${id}/documentos`)
      .set('Cookie', admin)
      .send({ nome: 'ASO periódico', validade: '2026-12-01' })
      .expect(201)
    expect(em30.body.documentos[0]).toMatchObject({
      nome: 'ASO periódico',
      validade: '2026-12-01',
      diasParaVencer: 30,
    })
    expect(em30.body.alertas).toMatchObject([
      { tipo: 'Documento', severidade: 'atencao', prazoDaTarefa: '2026-11-24' },
    ])

    const em31 = await srv()
      .post(`/v1/fichas/${id}/documentos`)
      .set('Cookie', admin)
      .send({ nome: 'Vacinação', validade: '2026-12-02' })
      .expect(201)
    expect((em31.body.alertas as Corpo[]).filter((a) => a['tipo'] === 'Documento')).toHaveLength(1)
  })

  it('documento vencido é CRÍTICO, com dias negativos', async () => {
    const id = await novaFicha()
    const r = await srv()
      .post(`/v1/fichas/${id}/documentos`)
      .set('Cookie', admin)
      .send({ nome: 'COREN', validade: '2026-10-01' })
      .expect(201)
    expect(r.body.documentos[0].diasParaVencer).toBe(-31)
    expect(r.body.alertas[0]).toMatchObject({ tipo: 'Documento', severidade: 'critico' })
    expect(r.body.alertas[0].texto).toBe('COREN vencido desde 01/10/2026.')
  })

  it('documento sem validade é aceito e NÃO gera alerta', async () => {
    const id = await novaFicha()
    const r = await srv()
      .post(`/v1/fichas/${id}/documentos`)
      .set('Cookie', admin)
      .send({ nome: 'Contrato assinado' })
      .expect(201)
    expect(r.body.documentos[0]).toMatchObject({ validade: null, diasParaVencer: null })
    expect(r.body.alertas).toEqual([])
  })

  it('excluir documento é soft delete', async () => {
    const id = await novaFicha()
    const criado = await srv()
      .post(`/v1/fichas/${id}/documentos`)
      .set('Cookie', admin)
      .send({ nome: 'COREN', validade: '2026-10-01' })
      .expect(201)
    const docId = criado.body.documentos[0].id as string

    const depois = await srv()
      .delete(`/v1/fichas/${id}/documentos/${docId}`)
      .set('Cookie', admin)
      .expect(200)
    expect(depois.body.documentos).toEqual([])
    expect(depois.body.alertas).toEqual([])

    const linha = await migrate.query<{ excluido_em: Date | null }>(
      'SELECT excluido_em FROM documentos_da_pessoa WHERE id = $1',
      [docId],
    )
    expect(linha.rows[0]!.excluido_em).not.toBe(null)
    // Excluir duas vezes é 404, não um segundo soft delete.
    await srv().delete(`/v1/fichas/${id}/documentos/${docId}`).set('Cookie', admin).expect(404)
  })
})

// ---------------------------------------------------------------------------
// BANCO DE HORAS
// ---------------------------------------------------------------------------

describe('banco de horas', () => {
  const novaFicha = async (over: Corpo = {}) =>
    (await criarFicha(admin, { ...FICHA_BASE, admissao: null, ...over }).expect(201)).body
      .id as string

  it('só fichas ativas de contrato com jornada entram na tabela', async () => {
    await novaFicha({ nome: 'CLT Ativa', contrato: 'CLT' })
    await novaFicha({ nome: 'Estagiária', contrato: 'Estágio' })
    await novaFicha({ nome: 'PJ', contrato: 'PJ' })
    await novaFicha({ nome: 'Desligada', contrato: 'CLT', ativo: false })

    const r = await srv().get('/v1/fichas/horas/2026-10').set('Cookie', admin).expect(200)
    expect((r.body.linhas as Corpo[]).map((l) => l['nome'])).toEqual(['CLT Ativa', 'Estagiária'])
    expect(r.body.mes).toBe('2026-10')
    // Cinco meses anteriores, do mais antigo para o mais recente.
    expect((r.body.linhas[0].anteriores as Corpo[]).map((a) => a['mes'])).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ])
  })

  it('o saldo é MINUTO INTEIRO, e o campo é `saldoEmMinutos` — nunca `saldo`', async () => {
    const id = await novaFicha()
    const r = await srv()
      .put('/v1/fichas/horas/2026-10')
      .set('Cookie', admin)
      .send({ linhas: [{ fichaId: id, saldoEmMinutos: 390, obs: 'Cobriu férias' }] })
      .expect(200)
    expect(r.body.linhas[0]).toMatchObject({ saldoEmMinutos: 390, obs: 'Cobriu férias' })
    expect('saldo' in r.body.linhas[0]).toBe(false)

    // E o número ATRAVESSA para quem não tem `valores`: a gestora de RH não
    // fecha caixa. Chamado `saldo`, a redação apagaria a tabela inteira.
    const comoRh = await srv().get('/v1/fichas/horas/2026-10').set('Cookie', rh).expect(200)
    expect(comoRh.body.linhas[0].saldoEmMinutos).toBe(390)
    expect(comoRh.body.limiteDeHorasEmMinutos).toBe(600)
  })

  it('hora decimal é 400: o contrato aceita INTEIRO de minutos', async () => {
    const id = await novaFicha()
    const r = await srv()
      .put('/v1/fichas/horas/2026-10')
      .set('Cookie', admin)
      .send({ linhas: [{ fichaId: id, saldoEmMinutos: 6.5 }] })
    expect(r.status).toBe(400)
  })

  it('salvar o mesmo mês três vezes deixa UMA linha — idempotência de esquema', async () => {
    const id = await novaFicha()
    for (const minutos of [390, 400, 410]) {
      await srv()
        .put('/v1/fichas/horas/2026-10')
        .set('Cookie', admin)
        .send({ linhas: [{ fichaId: id, saldoEmMinutos: minutos }] })
        .expect(200)
    }
    const linhas = await migrate.query(
      `SELECT 1 FROM banco_de_horas WHERE ficha_id = $1 AND mes = '2026-10' AND excluido_em IS NULL`,
      [id],
    )
    expect(linhas.rowCount).toBe(1)
    const r = await srv().get('/v1/fichas/horas/2026-10').set('Cookie', admin).expect(200)
    expect(r.body.linhas[0].saldoEmMinutos).toBe(410)
  })

  it('`null` LIMPA o mês, por soft delete — e o mês volta a aceitar lançamento', async () => {
    const id = await novaFicha()
    await srv()
      .put('/v1/fichas/horas/2026-10')
      .set('Cookie', admin)
      .send({ linhas: [{ fichaId: id, saldoEmMinutos: 390 }] })
      .expect(200)
    const limpo = await srv()
      .put('/v1/fichas/horas/2026-10')
      .set('Cookie', admin)
      .send({ linhas: [{ fichaId: id, saldoEmMinutos: null }] })
      .expect(200)
    expect(limpo.body.linhas[0].saldoEmMinutos).toBe(null)

    const linha = await migrate.query<{ excluido_em: Date | null }>(
      `SELECT excluido_em FROM banco_de_horas WHERE ficha_id = $1 AND mes = '2026-10'`,
      [id],
    )
    expect(linha.rows[0]!.excluido_em).not.toBe(null)

    const devolta = await srv()
      .put('/v1/fichas/horas/2026-10')
      .set('Cookie', admin)
      .send({ linhas: [{ fichaId: id, saldoEmMinutos: -120 }] })
      .expect(200)
    expect(devolta.body.linhas[0].saldoEmMinutos).toBe(-120)
  })

  it('o alerta fala do mês MAIS RECENTE, nunca do pior do histórico', async () => {
    const id = await novaFicha()
    // Março estourou; abril foi corrigido. O alerta não pode ficar vivo.
    await srv()
      .put('/v1/fichas/horas/2026-03')
      .set('Cookie', admin)
      .send({ linhas: [{ fichaId: id, saldoEmMinutos: -3000 }] })
      .expect(200)
    await srv()
      .put('/v1/fichas/horas/2026-04')
      .set('Cookie', admin)
      .send({ linhas: [{ fichaId: id, saldoEmMinutos: 0 }] })
      .expect(200)

    const ficha = await srv().get(`/v1/fichas/${id}`).set('Cookie', admin).expect(200)
    expect((ficha.body.alertas as Corpo[]).filter((a) => a['tipo'] === 'Banco de horas')).toEqual([])
    // Mas o histórico continua lá, com a marca de quem passou do limite.
    expect(ficha.body.horas).toMatchObject([
      { mes: '2026-04', saldoEmMinutos: 0, acimaDoLimite: false },
      { mes: '2026-03', saldoEmMinutos: -3000, acimaDoLimite: true },
    ])
  })

  it('o limite é dado da CLÍNICA, e mexer nele muda o alerta', async () => {
    const id = await novaFicha()
    await srv()
      .put('/v1/fichas/horas/2026-10')
      .set('Cookie', admin)
      .send({ linhas: [{ fichaId: id, saldoEmMinutos: 601 }] })
      .expect(200)

    const comPadrao = await srv().get(`/v1/fichas/${id}`).set('Cookie', admin).expect(200)
    expect(comPadrao.body.alertas[0]).toMatchObject({
      tipo: 'Banco de horas',
      severidade: 'atencao',
      em: '2026-10-31',
    })
    expect(comPadrao.body.alertas[0].texto).toBe('Saldo de +10h01 em 10/2026 (limite ±10h).')

    // Sobe o limite para 20 h: o alerta some, sem nenhuma outra escrita.
    const cfg = await srv()
      .put('/v1/fichas/configuracao')
      .set('Cookie', admin)
      .send({ limiteDeHorasEmMinutos: 1200 })
      .expect(200)
    expect(cfg.body.limiteDeHorasEmMinutos).toBe(1200)
    const depois = await srv().get(`/v1/fichas/${id}`).set('Cookie', admin).expect(200)
    expect(depois.body.alertas).toEqual([])
  })

  it('o padrão do limite é o do DOMÍNIO, e o DEFAULT da coluna concorda', async () => {
    // Nenhuma configuração gravada: a resposta é o padrão de toda clínica nova.
    const r = await srv().get('/v1/fichas/configuracao').set('Cookie', admin).expect(200)
    expect(r.body.limiteDeHorasEmMinutos).toBe(600)
    const padraoDaColuna = await migrate.query<{ padrao: string | null }>(
      `SELECT column_default AS padrao FROM information_schema.columns
        WHERE table_name = 'configuracao_de_pessoal' AND column_name = 'limite_de_horas_minutos'`,
    )
    expect(padraoDaColuna.rows[0]!.padrao).toBe('600')
  })

  it('limite fora da faixa é 400, e mês mal formado também', async () => {
    expect(
      (
        await srv()
          .put('/v1/fichas/configuracao')
          .set('Cookie', admin)
          .send({ limiteDeHorasEmMinutos: 30 })
      ).status,
    ).toBe(400)
    // HORA INTEIRA: 90 minutos vira `1,5` no campo da tela, e o campo recusaria
    // salvar de volta o valor que o próprio servidor devolveu.
    expect(
      (
        await srv()
          .put('/v1/fichas/configuracao')
          .set('Cookie', admin)
          .send({ limiteDeHorasEmMinutos: 90 })
      ).status,
    ).toBe(400)
    expect(
      (await srv().get('/v1/fichas/horas/outubro').set('Cookie', admin)).status,
    ).toBe(400)
  })

  it('contrato SEM banco de horas é recusado — dado que nenhuma tela mostraria', async () => {
    // A tabela não lista PJ e o alerta não a olha: um saldo gravado nela
    // ficaria no banco sem nunca aparecer, e a conferência de totais do épico
    // 9 acharia uma linha que não deveria existir.
    const pj = await novaFicha({ nome: 'PJ Fulana', contrato: 'PJ' })
    const r = await srv()
      .put('/v1/fichas/horas/2026-10')
      .set('Cookie', admin)
      .send({ linhas: [{ fichaId: pj, saldoEmMinutos: 390 }] })
    expect(r.status).toBe(422)
    expect(r.body.message).toContain('PJ Fulana')
    expect(r.body.message).toContain('CLT')

    // E a desligada CONTINUA aceitando: ela foi embora no dia 20 e o saldo do
    // mês ainda precisa ser lançado.
    const saiu = await novaFicha({ nome: 'Saiu Em Outubro', contrato: 'CLT', ativo: false })
    await srv()
      .put('/v1/fichas/horas/2026-10')
      .set('Cookie', admin)
      .send({ linhas: [{ fichaId: saiu, saldoEmMinutos: 120 }] })
      .expect(200)
  })

  it('a ficha de OUTRA clínica não recebe saldo', async () => {
    const idDaOutra = (
      await srv()
        .post('/v1/fichas')
        .set('Cookie', adminDaOutra)
        .send({ ...FICHA_BASE, admissao: null })
        .expect(201)
    ).body.id as string
    const r = await srv()
      .put('/v1/fichas/horas/2026-10')
      .set('Cookie', admin)
      .send({ linhas: [{ fichaId: idDaOutra, saldoEmMinutos: 390 }] })
    expect(r.status).toBe(404)
  })
})
