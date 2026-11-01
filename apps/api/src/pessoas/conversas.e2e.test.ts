import type { Relogio } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'

/**
 * **As CONVERSAS 1:1** e as duas rotinas mensais da tela Equipe (MANUAL cap. 13).
 *
 * O teste que define este arquivo é **"os N combinados viram N tarefas numa
 * transação só"**. No protótipo é um laço na TELA chamando a API uma vez por
 * linha (`for (const c of combs) await tarefaRef(...)`): se a terceira falhar,
 * a conversa fica gravada com dois combinados virados em tarefa e um não — e
 * nada diz qual.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'tres-telhados-de-barro-velho'
const codigo = `conv-${Date.now()}`

/** 18/11/2026, 12:00 UTC — 09:00 em `America/Bahia`. */
const INICIO = new Date('2026-11-18T12:00:00.000Z')
let agora = new Date(INICIO)
const relogioDeTeste: Relogio = { agora: () => agora }

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let gestora: string
let ana: string
let fichaDaAna: string
let fichaSemLogin: string
let fichaSemGestor: string
let rh: string[]

const srv = () => request(app.getHttpServer())
const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

type Conversa = {
  id: string
  fichaId: string
  nome: string
  data: string
  mes: string
  por: string
  fortes: string[]
  desenvolver: string[]
  combinados: string[]
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[conversas] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinica = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica das 1:1') RETURNING id`,
      [codigo],
    )
  ).rows[0]!.id
  const perfil = (
    await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms)
       VALUES ($1, 'pf_rh', 'RH', $2) RETURNING id`,
      [clinica, ['pessoas.gerir']],
    )
  ).rows[0]!.id

  const hash = await hashDeSenha(SENHA)
  const novaPessoa = async (nome: string, usuario: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
         VALUES ($1, $2, $3, $4, false, $5) RETURNING id`,
        [clinica, nome, usuario, hash, perfil],
      )
    ).rows[0]!.id
  gestora = await novaPessoa('Helena Prado', 'helena')
  ana = await novaPessoa('Ana Silva', 'ana.silva')

  const novaFicha = async (nome: string, pessoaId: string | null, gestorId: string | null) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO fichas_de_pessoa (clinica_id, nome, cargo, pessoa_id, gestor_id)
         VALUES ($1, $2, 'Recepcionista', $3, $4) RETURNING id`,
        [clinica, nome, pessoaId, gestorId],
      )
    ).rows[0]!.id
  fichaDaAna = await novaFicha('Ana Silva', ana, gestora)
  // A FAXINEIRA COM FICHA E SEM LOGIN: a tarefa do combinado dela não tem
  // responsável possível além de quem conduziu a conversa.
  fichaSemLogin = await novaFicha('Zilda Nunes', null, gestora)
  // SEM GESTOR: não aparece em "pendentes" — ninguém é responsável por conduzir.
  fichaSemGestor = await novaFicha('Carla Dias', null, null)

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(relogioDeTeste)
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  rh = cookieDe(
    await srv().post('/v1/entrar').send({ clinica: codigo, usuario: 'helena', senha: SENHA }).expect(200),
  )
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await app.close()
})

beforeEach(async () => {
  agora = new Date(INICIO)
  await migrate.query(`DELETE FROM conversas_1a1 WHERE clinica_id = $1`, [clinica])
  await migrate.query(`DELETE FROM tarefas WHERE clinica_id = $1`, [clinica])
})

const registrar = (corpo: Record<string, unknown>) =>
  srv().post('/v1/conversas').set('Cookie', rh).send(corpo)

const BASE = {
  fichaId: '',
  data: '2026-11-18',
  mes: '2026-10',
  fortes: 'Boa conversão nos orçamentos',
  desenvolver: 'Follow-up em até 2 dias',
  combinados: 'Retomar os orçamentos de setembro\n\nLigar para a Dona Marta\nRever o roteiro',
}

describe('POST /v1/conversas — o registro, e os combinados em tarefa', () => {
  /**
   * TRÊS combinados, TRÊS tarefas, **uma transação**. As linhas em branco do
   * texto não contam: `emLinhas` faz `split`, `trim` e descarta vazia, e isso
   * mora no SERVIDOR — duas implementações do mesmo `filter(Boolean)` divergem
   * no dia em que uma aceitar a linha em branco, e aí a 1:1 ganha um combinado
   * vazio virando tarefa.
   */
  it('cada combinado vira UMA tarefa, com prazo de 30 dias, para A PESSOA', async () => {
    const r = await registrar({ ...BASE, fichaId: fichaDaAna }).expect(201)
    expect(r.body.tarefasCriadas).toBe(3)

    const tarefas = await migrate.query<{
      descricao: string
      prazo: string
      responsavel_id: string
      obs: string
    }>(
      `SELECT descricao, prazo::text AS prazo, responsavel_id, obs FROM tarefas
        WHERE clinica_id = $1 ORDER BY descricao`,
      [clinica],
    )
    expect(tarefas.rows).toHaveLength(3)
    for (const t of tarefas.rows) {
      expect(t.descricao.startsWith('Combinado 1:1: ')).toBe(true)
      // 18/11 + 30 dias = 18/12, no fuso da clínica e pelo relógio do SERVIDOR.
      expect(t.prazo).toBe('2026-12-18')
      expect(t.responsavel_id).toBe(ana)
      expect(t.obs).toContain('Conversa 1:1 de Ana Silva · 2026-10')
    }
    expect(tarefas.rows.map((t) => t.descricao).sort()).toEqual([
      'Combinado 1:1: Ligar para a Dona Marta',
      'Combinado 1:1: Retomar os orçamentos de setembro',
      'Combinado 1:1: Rever o roteiro',
    ])
  })

  /**
   * A ficha SEM login: a tarefa fica com quem CONDUZIU. É o `f.userId ||
   * S.user.id` dela, e é o único destino possível — `responsavel_id` é `NOT
   * NULL`, e uma tarefa precisa de responsável.
   */
  it('o combinado de quem não usa a ferramenta fica com quem conduziu', async () => {
    await registrar({ ...BASE, fichaId: fichaSemLogin, combinados: 'Comprar o material' }).expect(201)
    const t = await migrate.query<{ responsavel_id: string }>(
      `SELECT responsavel_id FROM tarefas WHERE clinica_id = $1`,
      [clinica],
    )
    expect(t.rows[0]!.responsavel_id).toBe(gestora)
  })

  it('`criarTarefas: false` grava a conversa e NÃO cria tarefa nenhuma', async () => {
    const r = await registrar({ ...BASE, fichaId: fichaDaAna, criarTarefas: false }).expect(201)
    expect(r.body.tarefasCriadas).toBe(0)
    expect(r.body.conversas).toHaveLength(1)
    const n = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tarefas WHERE clinica_id = $1`,
      [clinica],
    )
    expect(n.rows[0]!.n).toBe('0')
  })

  /**
   * **CONVERSA VAZIA NÃO É CONVERSA.** O protótipo cobra isso na TELA, o que
   * deixa a API aceitando um registro que diz *"a 1:1 de outubro aconteceu"* e
   * não guarda nada dela — pior que a ausência, porque cala o aviso de
   * pendente. Aqui é 400 no contrato e `CHECK conversa_tem_conteudo` no banco.
   */
  it('conversa sem nenhum dos três blocos é 400', async () => {
    const r = await registrar({
      ...BASE,
      fichaId: fichaDaAna,
      fortes: '',
      desenvolver: '',
      combinados: '   ',
    })
    expect(r.status).toBe(400)
  })

  /**
   * **DATA FUTURA É RECUSADA, e `hoje` é o do SERVIDOR** (regra 24). A tela
   * dela põe `max` no campo e nada mais — e um `max` de HTML é sugestão.
   */
  it('data futura é 422, medida pelo dia da CLÍNICA e não pelo navegador', async () => {
    const r = await registrar({ ...BASE, fichaId: fichaDaAna, data: '2026-11-19' })
    expect(r.status).toBe(422)
    // E o dia de HOJE passa: `<=`, nunca `<`.
    await registrar({ ...BASE, fichaId: fichaDaAna, data: '2026-11-18' }).expect(201)
  })

  /**
   * **O MÊS DE REFERÊNCIA NÃO É O MÊS EM QUE ELA ACONTECEU.** A conversa de
   * outubro acontece em 3 de novembro, e é com as metas de outubro que ela se
   * compara. Dois campos porque são dois fatos.
   */
  it('a conversa de outubro feita em novembro guarda os DOIS, e o servidor quebra em linhas', async () => {
    await registrar({ ...BASE, fichaId: fichaDaAna }).expect(201)
    const r = await srv().get('/v1/conversas').set('Cookie', rh).expect(200)
    const c = (r.body.conversas as Conversa[])[0]!
    expect(c.data).toBe('2026-11-18')
    expect(c.mes).toBe('2026-10')
    expect(c.por).toBe('Helena')
    expect(c.combinados).toEqual([
      'Retomar os orçamentos de setembro',
      'Ligar para a Dona Marta',
      'Rever o roteiro',
    ])
    expect(c.fortes).toEqual(['Boa conversão nos orçamentos'])
  })
})

describe('GET /v1/conversas — os pendentes do mês', () => {
  /**
   * Pendente é ficha ATIVA, **com gestor**, sem conversa DESTE mês. O
   * `gestor_id IS NOT NULL` é o `f.gestorId &&` dela: sem gestor definido
   * ninguém é responsável por conduzir, e o aviso apontaria para o vazio.
   *
   * **O mês dos pendentes é o CORRENTE da clínica** (novembro), não o mês de
   * referência da conversa registrada (outubro) — e é por isso que registrar a
   * 1:1 de outubro não tira ninguém da lista de novembro.
   */
  it('lista quem tem gestor e não teve a conversa deste mês', async () => {
    const vazio = await srv().get('/v1/conversas').set('Cookie', rh).expect(200)
    expect(vazio.body.mes).toBe('2026-11')
    const nomes = (vazio.body.pendentes as { nome: string; gestor: string }[]).map((p) => p.nome)
    // Carla não tem gestor e fica de fora; as outras duas entram.
    expect(nomes.sort()).toEqual(['Ana Silva', 'Zilda Nunes'])
    expect(
      (vazio.body.pendentes as { nome: string; gestor: string }[])[0]!.gestor,
    ).toBe('Helena')
    expect(nomes).not.toContain('Carla Dias')
    void fichaSemGestor

    // A 1:1 de OUTUBRO não tira ninguém dos pendentes de NOVEMBRO.
    await registrar({ ...BASE, fichaId: fichaDaAna, mes: '2026-10' }).expect(201)
    const aindaPendente = await srv().get('/v1/conversas').set('Cookie', rh).expect(200)
    expect((aindaPendente.body.pendentes as { nome: string }[]).map((p) => p.nome).sort()).toEqual([
      'Ana Silva',
      'Zilda Nunes',
    ])

    // A de NOVEMBRO tira.
    await registrar({ ...BASE, fichaId: fichaDaAna, mes: '2026-11' }).expect(201)
    const depois = await srv().get('/v1/conversas').set('Cookie', rh).expect(200)
    expect((depois.body.pendentes as { nome: string }[]).map((p) => p.nome)).toEqual(['Zilda Nunes'])
  })

  it('é 403 sem `pessoas.gerir` — a 1:1 é avaliação de desempenho', async () => {
    const perfilZero = (
      await migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms)
         VALUES ($1, $2, 'Sem nada', '{}') RETURNING id`,
        [clinica, `pf_zero_${Date.now()}`],
      )
    ).rows[0]!.id
    const usuario = `semnada${Date.now()}`.slice(0, 20)
    await migrate.query(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
       VALUES ($1, 'Sem Nada', $2, $3, false, $4)`,
      [clinica, usuario, await hashDeSenha(SENHA), perfilZero],
    )
    const dela = cookieDe(
      await srv().post('/v1/entrar').send({ clinica: codigo, usuario, senha: SENHA }).expect(200),
    )
    expect((await srv().get('/v1/conversas').set('Cookie', dela)).status).toBe(403)
    expect(
      (await srv().post('/v1/conversas').set('Cookie', dela).send({ ...BASE, fichaId: fichaDaAna }))
        .status,
    ).toBe(403)
  })
})

describe('POST /v1/conversas/rotinas — as duas rotinas mensais', () => {
  /**
   * **IDEMPOTENTE SEM LOCK**, pelo índice `tarefa_de_rotina (clinica_id,
   * marcador, prazo)`: o segundo toque gera exatamente o mesmo conjunto de
   * `(marcador, prazo)` e não escreve nada. É o mesmo mecanismo da rotina de
   * fechamento do mês.
   *
   * Três vezes, como manda a regra 26.
   */
  it('criar a rotina três vezes deixa DOZE tarefas, não trinta e seis', async () => {
    const criar = (rotina: string) =>
      srv().post('/v1/conversas/rotinas').set('Cookie', rh).send({ rotina }).expect(201)

    const um = await criar('conversas')
    expect(um.body.criadas).toBe(12)
    // Hoje é 18/11 e o dia da rotina de 1:1 é 20: ela começa em NOVEMBRO, não
    // em dezembro — o dia ainda não passou.
    expect(um.body.deInicio).toBe('2026-11-20')

    for (const vez of [2, 3]) {
      const r = await criar('conversas')
      expect(r.body.criadas, `vez ${vez}`).toBe(0)
    }
    const n = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tarefas
        WHERE clinica_id = $1 AND marcador = 'pessoas-conversas-1a1'`,
      [clinica],
    )
    expect(n.rows[0]!.n).toBe('12')

    // A do banco de horas é outro marcador, e as duas convivem.
    const horas = await criar('bancoDeHoras')
    expect(horas.body.criadas).toBe(12)
    // O dia 5 JÁ PASSOU em novembro, então ela começa em dezembro — senão a
    // lista de hoje abriria com um cartão vermelho que ninguém atrasou.
    expect(horas.body.deInicio).toBe('2026-12-05')
  })

  it('a rotina criada aparece como `temRotina` na tela', async () => {
    expect((await srv().get('/v1/conversas').set('Cookie', rh).expect(200)).body.temRotina).toBe(
      false,
    )
    await srv().post('/v1/conversas/rotinas').set('Cookie', rh).send({ rotina: 'conversas' }).expect(201)
    expect((await srv().get('/v1/conversas').set('Cookie', rh).expect(200)).body.temRotina).toBe(
      true,
    )
  })
})
