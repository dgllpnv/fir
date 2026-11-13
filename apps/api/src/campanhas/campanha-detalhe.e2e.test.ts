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
 * **O detalhe da campanha** (`vCampanha` do protótipo) — o pedido da cliente:
 * "abria a campanha e apareciam todas as tarefas dali".
 *
 * O que este arquivo cobra, na ordem do risco:
 *
 *  1. **Escopo:** quem tem `campanhas` vê as tarefas da campanha TODA, e não
 *     o recorte de `escopo` de `/v1/tarefas` (ADR 2026-11-13).
 *  2. **Redação (regra 17):** sem `valores`, nenhum centavo atravessa — nem o
 *     da receita, nem o do que falta, nem o do total do drill-down, nem o do
 *     pagamento embutido no cartão. As contagens ficam.
 *  3. **Telefone da paciente** omitido sem `pacientes` (regra 18).
 *  4. **Isolamento de clínica** (regra 19).
 *  5. **Receita que não dobra** (regra 3) e que não conta estorno nem
 *     orçamento (regra 4).
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'seis-janelas-de-madeira-clara'
const codigo = `campdet-${Date.now()}`
const codigoB = `campdetb-${Date.now()}`

/** 18/11/2026, 12:00 UTC — 09:00 em `America/Bahia`. */
const AGORA = new Date('2026-11-18T12:00:00.000Z')
const relogioDeTeste: Relogio = { agora: () => AGORA }

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let clinicaB: string
let gestora: string
let recepcao: string
let gestao: string[]
let semValores: string[]
let semCampanhas: string[]
let deOutraClinica: string[]

const srv = () => request(app.getHttpServer())
const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

const BASE = {
  categoria: 'Sazonal',
  foco: '',
  nome: 'Novembro Azul',
  objetivo: 'Trazer os homens para o check-up',
  inicio: '2026-11-01',
  fim: '2026-11-30',
  metrica: 'receita',
  tipoMetrica: '',
  metaEmDinheiro: '1000000',
  metaEmNumero: null,
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[campanha-detalhe] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  const novaClinica = async (cod: string, nome: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id`,
        [cod, nome],
      )
    ).rows[0]!.id
  clinica = await novaClinica(codigo, 'Clínica do Detalhe')
  clinicaB = await novaClinica(codigoB, 'Outra Clínica')

  const perfil = async (cl: string, chave: string, nome: string, perms: string[]) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, $2, $3, $4) RETURNING id`,
        [cl, chave, nome, perms],
      )
    ).rows[0]!.id
  const pfGestao = await perfil(clinica, 'pf_sup', 'Supervisão', [
    'campanhas',
    'campanhas.gerir',
    'valores',
    'pacientes',
  ])
  // A RECEPÇÃO desta tela: `campanhas`, sem `valores`, sem `pacientes` e sem
  // `tarefas.equipe` — o pior caso para escopo, redação e telefone.
  const pfRecepcao = await perfil(clinica, 'pf_rec', 'Recepção', ['campanhas'])
  const pfEnf = await perfil(clinica, 'pf_enf', 'Enfermagem', ['estoque'])
  const pfOutra = await perfil(clinicaB, 'pf_sup', 'Supervisão', [
    'campanhas',
    'campanhas.gerir',
    'valores',
    'pacientes',
  ])

  const hash = await hashDeSenha(SENHA)
  const pessoa = async (cl: string, nome: string, usuario: string, perfilId: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
         VALUES ($1, $2, $3, $4, false, $5) RETURNING id`,
        [cl, nome, usuario, hash, perfilId],
      )
    ).rows[0]!.id
  gestora = await pessoa(clinica, 'Helena Prado', 'helena', pfGestao)
  recepcao = await pessoa(clinica, 'Juliana Santos', 'juliana', pfRecepcao)
  await pessoa(clinica, 'Bruna Reis', 'bruna', pfEnf)
  await pessoa(clinicaB, 'Outra Gestora', 'outra', pfOutra)

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(relogioDeTeste)
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const entrar = (cod: string, usuario: string) =>
    srv().post('/v1/entrar').send({ clinica: cod, usuario, senha: SENHA }).expect(200)
  gestao = cookieDe(await entrar(codigo, 'helena'))
  semValores = cookieDe(await entrar(codigo, 'juliana'))
  semCampanhas = cookieDe(await entrar(codigo, 'bruna'))
  deOutraClinica = cookieDe(await entrar(codigoB, 'outra'))
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, clinicaB)
  await migrate.end()
  await app.close()
})

beforeEach(async () => {
  for (const cl of [clinica, clinicaB]) {
    await migrate.query(`DELETE FROM recebimentos WHERE clinica_id = $1`, [cl])
    await migrate.query(`DELETE FROM tarefas WHERE clinica_id = $1`, [cl])
    await migrate.query(`UPDATE pacientes SET campanha_id = NULL WHERE clinica_id = $1`, [cl])
    await migrate.query(`DELETE FROM pacientes WHERE clinica_id = $1`, [cl])
    await migrate.query(`DELETE FROM campanhas WHERE clinica_id = $1`, [cl])
  }
})

const criar = async (corpo: Record<string, unknown> = BASE, cookie = gestao): Promise<string> => {
  const r = await srv().post('/v1/campanhas').set('Cookie', cookie).send(corpo).expect(201)
  const c = (r.body.campanhas as { id: string; nome: string }[]).find((x) => x.nome === corpo['nome'])!
  return c.id
}
const detalhe = (id: string, cookie = gestao) =>
  srv().get(`/v1/campanhas/${id}`).set('Cookie', cookie)
const tarefas = (id: string, q = '', cookie = gestao) =>
  srv().get(`/v1/campanhas/${id}/tarefas${q}`).set('Cookie', cookie)

type T = { descricao: string; status: string; pacienteNome: string | null; pacienteTelefone: string | null; pagamento: { valor: string | null } | null }

// ---------------------------------------------------------------------------
// O DETALHE
// ---------------------------------------------------------------------------

describe('GET /v1/campanhas/:id — o detalhe', () => {
  it('traz meta, funil, ações por tipo, quem executou e o histórico do mesmo tipo', async () => {
    const id = await criar()
    const antiga = await criar({
      ...BASE,
      nome: 'Novembro Azul 2025',
      inicio: '2025-11-01',
      fim: '2025-11-30',
    })
    const marta = await umPaciente('Marta Alves')
    const rosa = await umPaciente('Rosa Lima')
    const t1 = await umaTarefa(id, marta, 'Consulta realizada', 'concluida', { responsavel: gestora })
    await umRecebimento(t1, marta, 'Consulta realizada', 250000n)
    await umaTarefa(id, marta, 'Follow-up', 'concluida', { responsavel: recepcao })
    await umaTarefa(id, rosa, 'Recaptação', 'aberta', { responsavel: recepcao })
    await umaTarefa(id, null, '', 'aberta', { responsavel: gestora })
    await umaTarefa(id, rosa, 'Follow-up', 'cancelada', { responsavel: recepcao })

    const r = await detalhe(id).expect(200)
    expect(r.body.campanha).toMatchObject({
      nome: 'Novembro Azul',
      situacao: 'andamento',
      // 250000 de 1000000.
      percentualDaMeta: 25,
      tarefas: 4,
    })
    expect(r.body.funil).toEqual({
      planejadas: 4,
      emAberto: 2,
      realizadas: 2,
      percentualRealizado: 50,
      alcancados: 1,
      convertidos: 1,
      taxaDeConversao: 100,
      conversoes: 1,
      receita: '250000',
    })
    expect(r.body.metaAtingida).toBe(false)
    expect(r.body.faltaEmDinheiro).toBe('750000')
    expect(r.body.faltaEmNumero).toBeNull()

    const tipos = r.body.porTipo as { tipo: string; planejadas: number; realizadas: number; valor: string }[]
    expect(tipos.find((x) => x.tipo === 'Consulta realizada')).toMatchObject({
      planejadas: 1,
      realizadas: 1,
      valor: '250000',
    })
    // A cancelada não é planejada: Follow-up tem 1 planejada, não 2.
    expect(tipos.find((x) => x.tipo === 'Follow-up')).toMatchObject({ planejadas: 1, realizadas: 1 })
    const pessoas = r.body.porPessoa as { nome: string; planejadas: number; realizadas: number }[]
    expect(pessoas.map((p) => [p.nome, p.planejadas, p.realizadas])).toEqual([
      ['Helena Prado', 2, 1],
      ['Juliana Santos', 2, 1],
    ])

    expect(r.body.tituloDoHistorico).toBe('Sazonal')
    expect((r.body.historico as { id: string }[]).map((h) => h.id)).toEqual([id, antiga])
  })

  it('campanha inexistente ou de OUTRA clínica é 404 (RLS)', async () => {
    const id = await criar()
    await detalhe('00000000-0000-4000-8000-000000000000').expect(404)
    await detalhe(id, deOutraClinica).expect(404)
    await tarefas(id, '', deOutraClinica).expect(404)
  })

  it('sem a permissão `campanhas` é 403, nas duas rotas', async () => {
    const id = await criar()
    await detalhe(id, semCampanhas).expect(403)
    await tarefas(id, '', semCampanhas).expect(403)
  })
})

// ---------------------------------------------------------------------------
// AS TAREFAS DA CAMPANHA
// ---------------------------------------------------------------------------

describe('GET /v1/campanhas/:id/tarefas', () => {
  it('a Recepção SEM `tarefas.equipe` vê as tarefas da campanha toda, de todo mundo', async () => {
    const id = await criar()
    const marta = await umPaciente('Marta Alves')
    // Nenhuma é da Juliana: nem responsável, nem solicitante.
    await umaTarefa(id, marta, 'Follow-up', 'aberta', { responsavel: gestora, descricao: 'da Helena' })
    await umaTarefa(id, marta, 'Recaptação', 'concluida', { responsavel: gestora, descricao: 'outra da Helena' })

    // Em /v1/tarefas, o escopo dela daria zero — é a regressão da cliente.
    const dela = await srv().get('/v1/tarefas?escopo=meu').set('Cookie', semValores).expect(200)
    expect(dela.body.total).toBe(0)

    const r = await tarefas(id, '', semValores).expect(200)
    expect(r.body.total).toBe(2)
    expect((r.body.tarefas as T[]).map((t) => t.descricao).sort()).toEqual([
      'da Helena',
      'outra da Helena',
    ])
  })

  it('abertas primeiro, depois por data desc; canceladas só em "tudo"; filtro por situação', async () => {
    const id = await criar()
    const m = await umPaciente('Marta Alves')
    await umaTarefa(id, m, 'Follow-up', 'concluida', { descricao: 'feita-10', prazo: '2026-11-05', concluidaEm: '2026-11-10T15:00:00.000Z' })
    await umaTarefa(id, m, 'Follow-up', 'concluida', { descricao: 'feita-12', prazo: '2026-11-05', concluidaEm: '2026-11-12T15:00:00.000Z' })
    await umaTarefa(id, m, 'Recaptação', 'aberta', { descricao: 'aberta-20', prazo: '2026-11-20' })
    await umaTarefa(id, m, 'Retorno', 'aberta', { descricao: 'aberta-01', prazo: '2026-11-01' })
    await umaTarefa(id, m, 'Follow-up', 'cancelada', { descricao: 'cancelada', prazo: '2026-11-15' })

    const tudo = await tarefas(id).expect(200)
    expect((tudo.body.tarefas as T[]).map((t) => t.descricao)).toEqual([
      'aberta-20',
      'aberta-01',
      'cancelada', // dataRef = prazo (15/11), como no protótipo: não vai para o fim
      'feita-12',
      'feita-10',
    ])
    const abertas = await tarefas(id, '?situacao=abertas').expect(200)
    expect((abertas.body.tarefas as T[]).map((t) => t.descricao)).toEqual(['aberta-20', 'aberta-01'])
    const concl = await tarefas(id, '?situacao=concluidas').expect(200)
    expect((concl.body.tarefas as T[]).map((t) => t.descricao)).toEqual(['feita-12', 'feita-10'])
  })

  it('não vaza tarefa de outra campanha, nem excluída, e pagina com o total certo', async () => {
    const id = await criar()
    const outra = await criar({ ...BASE, nome: 'Outra campanha' })
    const m = await umPaciente('Marta Alves')
    for (let i = 0; i < 3; i++) {
      await umaTarefa(id, await umPaciente(`Paciente ${i}`), 'Follow-up', 'aberta', { descricao: `n${i}` })
    }
    await umaTarefa(outra, m, 'Follow-up', 'aberta', { descricao: 'de outra' })
    const apagada = await umaTarefa(id, m, 'Follow-up', 'aberta', { descricao: 'apagada' })
    await migrate.query(`UPDATE tarefas SET excluida_em = now() WHERE id = $1`, [apagada])

    const r = await tarefas(id, '?limite=2').expect(200)
    expect(r.body.total).toBe(3)
    expect(r.body.tarefas).toHaveLength(2)
    const pag2 = await tarefas(id, '?limite=2&deslocamento=2').expect(200)
    expect(pag2.body.tarefas).toHaveLength(1)
  })

  it('parâmetro inválido é 400 (`.strict()`), e recorte por tipo exige o tipo', async () => {
    const id = await criar()
    await tarefas(id, '?escopo=equipe').expect(400)
    await tarefas(id, '?recorte=inventado').expect(400)
    await tarefas(id, '?recorte=tipo-realizadas').expect(400)
    await tarefas(id, '?recorte=pessoa-planejadas').expect(400)
  })

  it('os recortes do drill-down batem com os números do funil, e somam o valor', async () => {
    const id = await criar()
    const marta = await umPaciente('Marta Alves')
    const rosa = await umPaciente('Rosa Lima')
    const t1 = await umaTarefa(id, marta, 'Consulta realizada', 'concluida', { responsavel: gestora })
    await umRecebimento(t1, marta, 'Consulta realizada', 100000n)
    const t2 = await umaTarefa(id, rosa, 'Pagamento de orçamento', 'concluida', { responsavel: recepcao })
    await umRecebimento(t2, rosa, 'Pagamento de orçamento', 50050n)
    await umaTarefa(id, rosa, 'Follow-up', 'concluida', { responsavel: recepcao })
    await umaTarefa(id, rosa, 'Recaptação', 'aberta', { responsavel: recepcao })
    await umaTarefa(id, null, '', 'aberta', { responsavel: gestora })

    const d = (await detalhe(id).expect(200)).body
    const casos: [string, number][] = [
      ['planejadas', d.funil.planejadas],
      ['realizadas', d.funil.realizadas],
      ['alcancadas', d.funil.realizadas],
      ['conversoes', d.funil.conversoes],
      // Métrica `receita`: o resultado são as tarefas que pagaram.
      ['resultado', 2],
    ]
    for (const [recorte, n] of casos) {
      const r = await tarefas(id, `?recorte=${recorte}`).expect(200)
      expect(r.body.total, recorte).toBe(n)
    }
    const res = await tarefas(id, '?recorte=resultado').expect(200)
    expect(res.body.valorTotal).toBe('150050')

    const interna = await tarefas(id, '?recorte=tipo-planejadas&tipo=__interna').expect(200)
    expect(interna.body.total).toBe(1)
    const daRecep = await tarefas(id, `?recorte=pessoa-realizadas&pessoaId=${recepcao}`).expect(200)
    expect(daRecep.body.total).toBe(2)
    expect(daRecep.body.valorTotal).toBe('50050')
    // Sem recorte, não há total em dinheiro.
    expect((await tarefas(id).expect(200)).body.valorTotal).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// REDAÇÃO E TELEFONE
// ---------------------------------------------------------------------------

describe('sem `valores`, nenhum centavo; sem `pacientes`, sem telefone', () => {
  it('o detalhe entrega só contagens; sem percentual na campanha de receita', async () => {
    const id = await criar()
    const m = await umPaciente('Marta Alves')
    const t = await umaTarefa(id, m, 'Consulta realizada', 'concluida')
    await umRecebimento(t, m, 'Consulta realizada', 250000n)

    const r = (await detalhe(id, semValores).expect(200)).body
    const texto = JSON.stringify(r)
    expect(texto).not.toContain('250000')
    expect(texto).not.toContain('1000000')
    expect(r.funil.receita).toBeNull()
    expect(r.faltaEmDinheiro).toBeNull()
    expect(r.campanha.metaEmDinheiro).toBeNull()
    expect(r.campanha.resultadoEmDinheiro).toBeNull()
    expect(r.porTipo[0].valor).toBeNull()
    expect(r.historico).toEqual([]) // só uma do tipo
    // O percentual de uma campanha de RECEITA devolveria a receita (250000 de
    // 1000000 = 25%): sem `valores` sai null. Sobram as contagens.
    expect(r.campanha.percentualDaMeta).toBeNull()
    // Nem o booleano "bateu a meta" pode sair: seria o percentual por outro caminho.
    expect(r.metaAtingida).toBe(false)
    expect(r.funil.planejadas).toBe(1)
    expect(r.funil.convertidos).toBe(1)
  })

  it('a lista do mês esconde o valor convertido e mantém as contagens', async () => {
    const id = await criar()
    const m = await umPaciente('Marta Alves')
    const t = await umaTarefa(id, m, 'Consulta realizada', 'concluida')
    await umRecebimento(t, m, 'Consulta realizada', 250000n)

    const com = (await srv().get('/v1/campanhas?mes=atual').set('Cookie', gestao).expect(200)).body
    expect(com.totais).toEqual({
      campanhas: 1,
      valorConvertido: '250000',
      pacientesConvertidos: 1,
      acoesRealizadas: 1,
    })
    const sem = (await srv().get('/v1/campanhas?mes=atual').set('Cookie', semValores).expect(200)).body
    expect(sem.totais).toEqual({
      campanhas: 1,
      valorConvertido: null,
      pacientesConvertidos: 1,
      acoesRealizadas: 1,
    })
  })

  it('o cartão da tarefa não carrega o valor do pagamento embutido', async () => {
    const id = await criar()
    const m = await umPaciente('Marta Alves')
    const t = await umaTarefa(id, m, 'Consulta realizada', 'concluida')
    await umRecebimento(t, m, 'Consulta realizada', 250000n)

    const com = (await tarefas(id, '', gestao).expect(200)).body.tarefas as T[]
    expect(com[0]!.pagamento?.valor).toBe('250000')
    const semV = await tarefas(id, '?recorte=resultado', semValores).expect(200)
    expect(JSON.stringify(semV.body)).not.toContain('250000')
    expect(semV.body.valorTotal).toBeNull()
    expect(semV.body.total).toBe(1)
  })

  it('o telefone da paciente sai null sem `pacientes`; o nome fica', async () => {
    const id = await criar()
    const m = await umPaciente('Marta Alves', '71988887777')
    await umaTarefa(id, m, 'Follow-up', 'aberta')

    const com = (await tarefas(id, '', gestao).expect(200)).body.tarefas as T[]
    expect(com[0]!.pacienteTelefone).toBe('71988887777')
    const sem = (await tarefas(id, '', semValores).expect(200)).body.tarefas as T[]
    expect(sem[0]!.pacienteNome).toBe('Marta Alves')
    expect(sem[0]!.pacienteTelefone).toBeNull()
    expect(JSON.stringify(sem)).not.toContain('71988887777')
  })

  it('a leitura das tarefas deixa trilha de ACESSO (regra 18); o detalhe, não', async () => {
    const id = await criar()
    const m = await umPaciente('Marta Alves')
    await umaTarefa(id, m, 'Follow-up', 'aberta')
    const conta = async () =>
      Number(
        (
          await migrate.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM auditoria
              WHERE clinica_id = $1 AND acao = 'acessou' AND entidade = 'campanhas'
                AND entidade_id = $2`,
            [clinica, id],
          )
        ).rows[0]!.n,
      )
    const antes = await conta()
    await detalhe(id).expect(200)
    expect(await conta()).toBe(antes)
    await tarefas(id).expect(200)
    expect(await conta()).toBe(antes + 1)
  })
})

// ---------------------------------------------------------------------------
// RECEITA QUE NÃO DOBRA
// ---------------------------------------------------------------------------

describe('a receita da campanha conta cada pagamento uma vez', () => {
  it('embutido conta uma vez; avulso (sem tarefa), estornado e orçamento ficam fora', async () => {
    const id = await criar()
    const m = await umPaciente('Marta Alves')

    // 1) Atendimento com o pagamento EMBUTIDO: 100,00.
    const embutido = await umaTarefa(id, m, 'Consulta realizada', 'concluida')
    await umRecebimento(embutido, m, 'Consulta realizada', 10000n)
    // 2) Recebimento AVULSO da mesma paciente, sem tarefa: não pertence à campanha.
    await umRecebimento(null, m, 'Pagamento de saldo em aberto', 77700n)
    // 3) Recebimento ESTORNADO de outra tarefa: não é receita.
    const estornada = await umaTarefa(id, m, 'Procedimento realizado', 'concluida')
    const rec = await umRecebimento(estornada, m, 'Procedimento realizado', 55500n)
    await migrate.query(`UPDATE recebimentos SET estornado_em = now() WHERE id = $1`, [rec])
    // 4) Orçamento apresentado: valor_orcamento NÃO é receita (regra 4).
    const orc = await umaTarefa(id, m, 'Orçamento enviado', 'aberta')
    await migrate.query(`UPDATE tarefas SET valor_orcamento = 999900 WHERE id = $1`, [orc])

    const d = (await detalhe(id).expect(200)).body
    expect(d.funil.receita).toBe('10000')
    expect(d.campanha.receita).toBe('10000')
    expect(d.campanha.resultadoEmDinheiro).toBe('10000')
    const somaPorTipo = (d.porTipo as { valor: string }[]).reduce((a, x) => a + BigInt(x.valor), 0n)
    expect(somaPorTipo).toBe(10000n)
    // O drill-down fecha com o funil.
    const drill = await tarefas(id, '?recorte=resultado').expect(200)
    expect(drill.body.valorTotal).toBe('10000')
    expect(drill.body.total).toBe(1)
    const lista = (await srv().get('/v1/campanhas?mes=atual').set('Cookie', gestao).expect(200)).body
    expect(lista.totais.valorConvertido).toBe('10000')
  })
})

// ---------------------------------------------------------------------------
// MÊS E TIPO
// ---------------------------------------------------------------------------

describe('GET /v1/campanhas?mes=&tipo=', () => {
  it('o mês filtra pelo que a campanha CRUZA, com "em andamento" na frente', async () => {
    await criar({ ...BASE, nome: 'Passada', inicio: '2026-09-01', fim: '2026-09-30' })
    await criar({ ...BASE, nome: 'Atravessa', inicio: '2026-10-20', fim: '2026-11-05', categoria: 'Recaptação' })
    await criar({ ...BASE, nome: 'Futura de novembro', inicio: '2026-11-25', fim: '2026-11-30' })
    await criar({ ...BASE, nome: 'Em andamento', inicio: '2026-11-10', fim: '2026-11-20' })
    await criar({ ...BASE, nome: 'Dezembro', inicio: '2026-12-01', fim: '2026-12-31' })

    const nov = (await srv().get('/v1/campanhas?mes=2026-11').set('Cookie', gestao).expect(200)).body
    expect(nov.mes).toBe('2026-11')
    // Em andamento primeiro; depois as demais pelo início (Atravessa já encerrou).
    expect((nov.campanhas as { nome: string }[]).map((c) => c.nome)).toEqual([
      'Em andamento',
      'Atravessa',
      'Futura de novembro',
    ])
    // `atual` é o mês de HOJE na clínica.
    const atual = (await srv().get('/v1/campanhas?mes=atual').set('Cookie', gestao).expect(200)).body
    expect(atual.mes).toBe('2026-11')
    // As categorias são as da clínica inteira, não as do mês.
    expect(nov.categorias).toEqual(['Recaptação', 'Sazonal'])
    const tipo = (
      await srv().get('/v1/campanhas?mes=2026-11&tipo=Recaptação').set('Cookie', gestao).expect(200)
    ).body
    expect((tipo.campanhas as { nome: string }[]).map((c) => c.nome)).toEqual(['Atravessa'])
    expect(tipo.totais.campanhas).toBe(1)
    // Mês malformado e parâmetro desconhecido: 400.
    await srv().get('/v1/campanhas?mes=2026-13').set('Cookie', gestao).expect(400)
    await srv().get('/v1/campanhas?x=1').set('Cookie', gestao).expect(400)
  })

  it('sem `mes` a lista vem inteira, como antes (painel e formulário)', async () => {
    await criar({ ...BASE, nome: 'Passada', inicio: '2026-09-01', fim: '2026-09-30' })
    await criar()
    const r = (await srv().get('/v1/campanhas').set('Cookie', gestao).expect(200)).body
    expect(r.mes).toBeNull()
    expect(r.campanhas).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// REPETIR NO PRÓXIMO MÊS
// ---------------------------------------------------------------------------

describe('GET /v1/campanhas/:id/proximo-mes', () => {
  it('o mês inteiro vira o mês seguinte inteiro (e dezembro vira janeiro)', async () => {
    const id = await criar({ ...BASE, nome: 'Fevereiro', inicio: '2027-02-01', fim: '2027-02-28' })
    const r = (await srv().get(`/v1/campanhas/${id}/proximo-mes`).set('Cookie', gestao).expect(200)).body
    expect(r).toMatchObject({ nome: 'Fevereiro', inicio: '2027-03-01', fim: '2027-03-31', metaEmDinheiro: '1000000' })

    const dez = await criar({ ...BASE, nome: 'Dezembro', inicio: '2026-12-01', fim: '2026-12-31' })
    const j = (await srv().get(`/v1/campanhas/${dez}/proximo-mes`).set('Cookie', gestao).expect(200)).body
    expect(j).toMatchObject({ inicio: '2027-01-01', fim: '2027-01-31' })
  })

  it('período parcial anda um mês; dia 31 cai no último dia do mês curto (regra 25)', async () => {
    const id = await criar({ ...BASE, nome: 'Parcial', inicio: '2026-12-31', fim: '2027-01-31' })
    const r = (await srv().get(`/v1/campanhas/${id}/proximo-mes`).set('Cookie', gestao).expect(200)).body
    expect(r.inicio).toBe('2027-01-31')
    expect(r.fim).toBe('2027-02-28')
  })

  it('não grava nada, é só para `campanhas.gerir`, e a meta em R$ vem redigida sem `valores`', async () => {
    const id = await criar()
    await srv().get(`/v1/campanhas/${id}/proximo-mes`).set('Cookie', semValores).expect(403)
    const antes = (await migrate.query(`SELECT 1 FROM campanhas WHERE clinica_id = $1`, [clinica])).rowCount
    await srv().get(`/v1/campanhas/${id}/proximo-mes`).set('Cookie', gestao).expect(200)
    expect((await migrate.query(`SELECT 1 FROM campanhas WHERE clinica_id = $1`, [clinica])).rowCount).toBe(antes)
  })
})

// ---------------------------------------------------------------------------
// PACIENTE DESATIVADO: a tarefa ABERTA some, a concluída continua contando
// ---------------------------------------------------------------------------

describe('paciente desativado na campanha', () => {
  it('a tarefa aberta some da lista e das contagens; a concluída fica; reativar devolve', async () => {
    const id = await criar()
    const ativa = await umPaciente('Marta Alves')
    const saiu = await umPaciente('Rosa Lima')
    await umaTarefa(id, ativa, 'Follow-up', 'aberta', { descricao: 'da-ativa' })
    await umaTarefa(id, saiu, 'Follow-up', 'aberta', { descricao: 'aberta-da-desativada' })
    await umaTarefa(id, saiu, 'Follow-up', 'concluida', { descricao: 'feita-da-desativada' })

    const lidas = async () => {
      const lista = ((await tarefas(id).expect(200)).body.tarefas as T[]).map((t) => t.descricao).sort()
      const camp = (await detalhe(id).expect(200)).body.campanha
      return { lista, abertas: camp.tarefasAbertas as number, total: camp.tarefas as number }
    }
    expect(await lidas()).toEqual({
      lista: ['aberta-da-desativada', 'da-ativa', 'feita-da-desativada'],
      abertas: 2,
      total: 3,
    })

    await migrate.query('UPDATE pacientes SET ativo = false, desativado_em = now() WHERE id = $1', [saiu])
    expect(await lidas()).toEqual({
      lista: ['da-ativa', 'feita-da-desativada'],
      abertas: 1,
      total: 2,
    })

    await migrate.query('UPDATE pacientes SET ativo = true, desativado_em = NULL WHERE id = $1', [saiu])
    expect((await lidas()).abertas).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// IMPORTAÇÃO COM ÍNDICE E VALOR NO NOME (planilha da cliente, vídeo de 12/11)
// ---------------------------------------------------------------------------

describe('importar: o nome do paciente chega limpo', () => {
  const linha = (nome: string) => ({
    nome,
    telefone: '',
    aniversario: '',
    prazo: '2026-11-25',
    responsavelId: '',
    obs: '',
  })

  it('"6. Maria Souza - R$ 15.200" grava "Maria Souza", sem valor em lugar nenhum, e reimportar três vezes não cria nada', async () => {
    const id = await criar()
    const corpo = {
      tipo: 'Recaptação',
      descricao: '',
      linhas: [
        { ...linha('6. Maria Souza - R$ 15.200'), responsavelId: gestora },
        { ...linha('Marta Alves (Faturado: R$ 8.000,50)'), responsavelId: gestora },
      ],
    }
    const um = await srv().post(`/v1/campanhas/${id}/importar`).set('Cookie', gestao).send(corpo).expect(200)
    expect(um.body).toMatchObject({ criadas: 2, novosPacientes: 2 })

    const nomes = (
      await migrate.query<{ nome: string }>(
        `SELECT nome FROM pacientes WHERE clinica_id = $1 ORDER BY nome`,
        [clinica],
      )
    ).rows.map((r) => r.nome)
    expect(nomes).toEqual(['Maria Souza', 'Marta Alves'])

    // O valor não vaza para texto visível à equipe (regra 17).
    const texto = JSON.stringify(
      (await migrate.query(`SELECT descricao, obs FROM tarefas WHERE clinica_id = $1`, [clinica])).rows,
    )
    expect(texto).not.toMatch(/15.200|8.000|R$/)

    // Reimportar a MESMA lista, e a mesma sem o sufixo: nada novo.
    for (const n of [2, 3]) {
      const r = await srv().post(`/v1/campanhas/${id}/importar`).set('Cookie', gestao).send(corpo).expect(200)
      expect(r.body, `importação ${n}`).toMatchObject({ criadas: 0, novosPacientes: 0 })
    }
    const limpa = await srv()
      .post(`/v1/campanhas/${id}/importar`)
      .set('Cookie', gestao)
      .send({ ...corpo, linhas: [{ ...linha('Maria Souza'), responsavelId: gestora }] })
      .expect(200)
    expect(limpa.body).toMatchObject({ criadas: 0, novosPacientes: 0 })
    expect(
      (await migrate.query(`SELECT 1 FROM pacientes WHERE clinica_id = $1`, [clinica])).rowCount,
    ).toBe(2)
  })

  /**
   * **O VALOR DA LISTA É GRAVADO, COMO REFERÊNCIA** (migration 0080): vem no
   * campo `valorDeReferencia` (a tela tira o "- R$" do nome) ou, na falta
   * dele, do próprio nome. Nunca é receita, e some sem `valores`.
   */
  it('grava o valor da lista em centavos, redige sem `valores`, e não vira receita', async () => {
    const id = await criar()
    const corpo = {
      tipo: 'Recaptação',
      descricao: '',
      linhas: [
        { ...linha('Maria Souza'), responsavelId: gestora, valorDeReferencia: '1520000' },
        { ...linha('Marta Alves (Faturado: R$ 8.000,50)'), responsavelId: gestora },
        { ...linha('Rosa Lima'), responsavelId: gestora },
      ],
    }
    await srv().post(`/v1/campanhas/${id}/importar`).set('Cookie', gestao).send(corpo).expect(200)

    const noBanco = (
      await migrate.query<{ nome: string; v: string | null }>(
        `SELECT p.nome, t.valor_de_referencia::text AS v
           FROM tarefas t JOIN pacientes p ON p.id = t.paciente_id
          WHERE t.clinica_id = $1 ORDER BY p.nome`,
        [clinica],
      )
    ).rows
    expect(noBanco).toEqual([
      { nome: 'Maria Souza', v: '1520000' },
      { nome: 'Marta Alves', v: '800050' },
      { nome: 'Rosa Lima', v: null },
    ])

    const com = (await tarefas(id).expect(200)).body.tarefas as { pacienteNome: string; valorDeReferencia: string | null }[]
    expect(com.map((t) => [t.pacienteNome, t.valorDeReferencia])).toEqual(
      expect.arrayContaining([
        ['Maria Souza', '1520000'],
        ['Marta Alves', '800050'],
        ['Rosa Lima', null],
      ]),
    )
    // Sem `valores`: apagado pelo ponto único (regra 17), nem como texto.
    const sem = await tarefas(id, '', semValores).expect(200)
    expect((sem.body.tarefas as { valorDeReferencia: string | null }[]).every((t) => t.valorDeReferencia === null)).toBe(true)
    expect(JSON.stringify(sem.body)).not.toMatch(/1520000|800050/)

    // Não é receita (regras 3 e 4): a lista do mês não soma nada.
    const lista = (await srv().get('/v1/campanhas?mes=atual').set('Cookie', gestao).expect(200)).body
    expect(lista.totais.valorConvertido).toBe('0')
    expect(lista.campanhas.find((c: { id: string }) => c.id === id).receita).toBe('0')

    // Idempotente: reimportar o mesmo arquivo não cria nem altera nada.
    const outra = await srv().post(`/v1/campanhas/${id}/importar`).set('Cookie', gestao).send(corpo).expect(200)
    expect(outra.body).toMatchObject({ criadas: 0, novosPacientes: 0 })
    expect(
      (await migrate.query(`SELECT 1 FROM tarefas WHERE clinica_id = $1`, [clinica])).rowCount,
    ).toBe(3)
  })

  it('valor negativo ou fora do inteiro não entra (422/400), e nunca derruba a importação em 500', async () => {
    const id = await criar()
    const r = await srv()
      .post(`/v1/campanhas/${id}/importar`)
      .set('Cookie', gestao)
      .send({
        tipo: 'Recaptação',
        descricao: '',
        linhas: [{ ...linha('Ana Souza'), responsavelId: gestora, valorDeReferencia: '-5' }],
      })
    expect(r.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// FIXTURE
// ---------------------------------------------------------------------------

async function umPaciente(nome: string, telefone = ''): Promise<string> {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO pacientes (clinica_id, nome, telefone) VALUES ($1, $2, $3) RETURNING id`,
    [clinica, nome, telefone],
  )
  return r.rows[0]!.id
}

async function umaTarefa(
  campanhaId: string,
  pacienteId: string | null,
  tipo: string,
  status: 'aberta' | 'concluida' | 'cancelada',
  o: {
    responsavel?: string
    descricao?: string
    prazo?: string
    concluidaEm?: string
  } = {},
): Promise<string> {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em,
        paciente_id, tipo, campanha_id)
     VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      clinica,
      gestora,
      o.responsavel ?? gestora,
      o.descricao ?? 'fixture',
      o.prazo ?? '2026-11-10',
      status,
      status === 'concluida' ? (o.concluidaEm ?? '2026-11-10T15:00:00.000Z') : null,
      pacienteId,
      tipo,
      campanhaId,
    ],
  )
  return r.rows[0]!.id
}

async function umRecebimento(
  tarefaId: string | null,
  pacienteId: string,
  tipo: string,
  valor: bigint,
): Promise<string> {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO recebimentos
       (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto,
        recebido_em, registrado_por)
     VALUES ($1, $2, $3, $4, $5, 'Pix', 0, '2026-11-10T15:00:00.000Z', $6)
     RETURNING id`,
    [clinica, pacienteId, tarefaId, tipo, valor.toString(), gestora],
  )
  return r.rows[0]!.id
}

