import { CampanhaSugerida, CampanhasVinculaveis } from '@fir/contracts'
import { CAMPOS_MONETARIOS, type DadosDaV20, Dinheiro, type Relogio } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import fc from 'fast-check'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { SISTEMA } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../banco/clinica-id'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { executarSincronizacaoDeCampanhas } from '../carteira/campanhas/sincronizar-campanhas'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'
import { conferirMigracao } from '../migracao/conferencia.service'

/**
 * **A3 — campanha na tarefa e no recebimento**, contra Postgres real
 * (correções da PO 2026-11-09; gates appsec S-9…S-14, LGPD L-A3-*, números
 * N-1…N-8).
 *
 * O que este arquivo prova, e de onde vem cada exigência:
 *
 *  - a lista vinculável entrega **só `{id, nome}`** a quem não tem `campanhas`
 *    (AB-A3-1, L-A3-2, N-8), na janela do domínio (N-7) e com `incluir` (N-4);
 *  - a escrita recusa a campanha de outra clínica, a inventada e a excluída
 *    com o MESMO erro (AB-A3-2, S-11), a encerrada há 31 dias (AB-A3-3);
 *  - o índice `tarefa_viva_da_campanha` com `tipo` (N-6) e o 409 legível sem
 *    dado da outra tarefa (AB-A3-5, L-A3-4, S-13);
 *  - editar em TRÊS estados (N-4) e a troca na trilha (L-A3-7, N-5);
 *  - o recebimento avulso idempotente com campanha (N-3);
 *  - **os contraexemplos nomeados do gate de números**: o cenário de
 *    referência linha a linha (R$ 1.000 · R$ 1.500 · R$ 1.700 · R$ 700 · a
 *    troca que mantém o total) em `montar` **e** na conferência da migração
 *    **e** na soma mensal da carteira (N-2); orçamento nunca é receita (regra
 *    4, AB-A3-6); o ciclo concluir/reabrir; a paciente "da campanha" sem
 *    tarefa da campanha (N-1); e as duas propriedades (partição e troca).
 */

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'sete-telhas-de-barro-cozido'
const codigo = `vinc-${Date.now()}`
const codigoB = `vinc-b-${Date.now()}`
const FUSO = 'America/Sao_Paulo'

/** 09/11/2026, 13:00 UTC — 10:00 em São Paulo. `hoje` = 2026-11-09. */
const AGORA = new Date('2026-11-09T13:00:00.000Z')
const relogio: Relogio = { agora: () => AGORA }

let app: NestFastifyApplication
let migrate: pg.Client
let banco: BancoService
let clinica: string
let clinicaB: string
let gestora: string
let gestao: string[] // tudo, inclusive `campanhas` e `valores`
let recepcao: string[] // `receber` e `pacientes` — SEM `campanhas` e SEM `valores`
let semPacientes: string[] // nenhuma permissão
let p1: string
let p2: string
const NOME_P1 = `Ana Teste ${codigo}`
const TELEFONE_P1 = '71999887766'

// As campanhas, pelo papel que cada uma tem na janela de 09/11/2026.
let C: string // em andamento, 01/11 a 30/11
let D: string // em andamento, 05/11 a 15/12
let LIMITE: string // encerrada em 10/10 = hoje − 30: entra
let VELHA: string // encerrada em 09/10 = hoje − 31: não entra
let ANTIGA: string // encerrada em 10/08, ~90 dias
let EXCLUIDA: string // em andamento, mas excluída
let FUTURA: string // 01/12 a 31/12
let DE_OUTRA: string // da clínica B

let grupoCarteira: string
let clienteCarteira: string

const srv = () => request(app.getHttpServer())
const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

const novaCampanha = async (
  clinicaId: string,
  nome: string,
  inicio: string,
  fim: string,
  excluida = false,
): Promise<string> =>
  (
    await migrate.query<{ id: string }>(
      `INSERT INTO campanhas (clinica_id, nome, inicio, fim, metrica, meta, excluida_em)
       VALUES ($1, $2, $3, $4, 'receita', 100000, $5) RETURNING id`,
      [clinicaId, nome, inicio, fim, excluida ? new Date('2026-11-08T12:00:00Z') : null],
    )
  ).rows[0]!.id

const vinculaveis = (cookie: string[], consulta: string) =>
  srv().get(`/v1/campanhas/vinculaveis?${consulta}`).set('Cookie', cookie)

const agendar = (
  corpo: { pacienteId: string; tipo: string; campanhaId?: string | null; prazo?: string },
  cookie = gestao,
) =>
  srv()
    .post('/v1/tarefas')
    .set('Cookie', cookie)
    .send({
      vinculo: 'paciente',
      pacienteId: corpo.pacienteId,
      tipo: corpo.tipo,
      responsavelId: gestora,
      quando: { modo: 'agendada', prazo: corpo.prazo ?? '2026-11-12' },
      ...(corpo.campanhaId === undefined ? {} : { campanhaId: corpo.campanhaId }),
    })

const retroativa = (
  corpo: { pacienteId: string; tipo: string; campanhaId?: string; pagamento?: bigint },
) =>
  srv()
    .post('/v1/tarefas')
    .set('Cookie', gestao)
    .send({
      vinculo: 'paciente',
      pacienteId: corpo.pacienteId,
      tipo: corpo.tipo,
      responsavelId: gestora,
      confirmarDuplicidade: true,
      confirmarCaixaFechado: true,
      quando: {
        modo: 'retroativo',
        em: '2026-11-09',
        ...(corpo.pagamento === undefined
          ? {}
          : { pagamento: { valor: corpo.pagamento.toString(), forma: 'Pix', valorAberto: '0' } }),
      },
      ...(corpo.campanhaId === undefined ? {} : { campanhaId: corpo.campanhaId }),
    })

const receber = (corpo: {
  pacienteId: string
  valor: bigint
  ref?: 'consulta' | 'saldo'
  campanhaId?: string | null
  requisicaoId?: string
}) =>
  srv()
    .post('/v1/recebimentos')
    .set('Cookie', gestao)
    .send({
      requisicaoId: corpo.requisicaoId ?? randomUUID(),
      pacienteId: corpo.pacienteId,
      valor: corpo.valor.toString(),
      forma: 'Pix',
      em: '2026-11-09',
      ref: corpo.ref ?? 'consulta',
      confirmarDuplicidade: true,
      confirmarCaixaFechado: true,
      ...(corpo.campanhaId === undefined ? {} : { campanhaId: corpo.campanhaId }),
    })

const concluirComPagamento = (id: string, valor: bigint) =>
  srv()
    .post(`/v1/tarefas/${id}/concluir`)
    .set('Cookie', gestao)
    .send({
      em: '2026-11-09',
      pagamento: { valor: valor.toString(), forma: 'Pix', valorAberto: '0' },
      confirmarDuplicidade: true,
      confirmarCaixaFechado: true,
    })

/** A receita, em centavos, pela TELA de Campanhas (`CampanhasService.montar`). */
const receitaNaTela = async (campanha: string): Promise<bigint> => {
  const r = await srv().get('/v1/campanhas').set('Cookie', gestao).expect(200)
  const c = (r.body.campanhas as { id: string; receita: string }[]).find((x) => x.id === campanha)
  return BigInt(c!.receita)
}

/** A receita pela CONFERÊNCIA DA MIGRAÇÃO (regra 28) — a consulta de produção dela. */
const receitaNaConferencia = async (campanhas: readonly string[]): Promise<Map<string, bigint>> => {
  const dados: DadosDaV20 = {
    equipe: [],
    pacientes: [],
    unidades: [],
    campanhas: campanhas.map((_, i) => ({
      id: `v20-${i}`,
      nome: `v20-${i}`,
      objetivo: '',
      inicio: null,
      fim: null,
      meta: Dinheiro.zero(),
      metaEmNumero: 0,
      metrica: 'receita',
      tipoMetrica: '',
      categoria: '',
      foco: '',
      criadaEm: null,
    })),
    planos: [],
    adesoes: [],
    tarefas: [],
    arredondamentos: 0,
    achados: [],
  }
  const relatorio = await banco.naClinica(clinicaIdDeFonteConfiavel(clinica), SISTEMA, (c) =>
    conferirMigracao(c, clinica, dados, FUSO, []),
  )
  const linha = relatorio.linhas.find((l) => l.nome === 'Receita por campanha')!
  // A origem tem zero em cada campanha: o DESTINO de cada uma aparece na
  // divergência, ou é zero quando não diverge.
  return new Map(
    campanhas.map((id, i) => [
      id,
      BigInt(linha.divergencias.find((d) => d.chave === `v20-${i}`)?.destino ?? '0'),
    ]),
  )
}

/** A receita pela SOMA MENSAL da carteira (`sincronizar-campanhas.ts`). */
const receitaNaCarteira = async (campanhas: readonly string[]): Promise<Map<string, bigint>> => {
  const resumo = await executarSincronizacaoDeCampanhas(banco, relogio, {
    clienteIds: [clienteCarteira],
  })
  expect(resumo.falhas).toEqual([])
  const r = await migrate.query<{ id: string; total: string }>(
    `SELECT campanha_origem_id::text AS id, sum(receita_centavos)::text AS total
       FROM campanhas_carteira WHERE cliente_carteira_id = $1 GROUP BY 1`,
    [clienteCarteira],
  )
  return new Map(campanhas.map((id) => [id, BigInt(r.rows.find((x) => x.id === id)?.total ?? '0')]))
}

/** As TRÊS leituras da receita da campanha precisam dar o mesmo número (N-2). */
const receitaNosTresLugares = async (campanha: string): Promise<bigint> => {
  const tela = await receitaNaTela(campanha)
  expect((await receitaNaConferencia([campanha])).get(campanha)).toBe(tela)
  expect((await receitaNaCarteira([campanha])).get(campanha)).toBe(tela)
  return tela
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[vinculo] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  const novaClinica = async (cod: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, 'Clínica do vínculo', $2) RETURNING id`,
        [cod, FUSO],
      )
    ).rows[0]!.id
  clinica = await novaClinica(codigo)
  clinicaB = await novaClinica(codigoB)

  const perfil = async (chave: string, perms: string[]) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, $2, $2, $3) RETURNING id`,
        [clinica, chave, perms],
      )
    ).rows[0]!.id
  const hash = await hashDeSenha(SENHA)
  const pessoa = async (usuario: string, perfilId: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
         VALUES ($1, $2, $2, $3, false, $4) RETURNING id`,
        [clinica, usuario, hash, perfilId],
      )
    ).rows[0]!.id
  gestora = await pessoa(
    'helena',
    await perfil('pf_sup', [
      'campanhas',
      'campanhas.gerir',
      'valores',
      'pacientes',
      'receber',
      'jornada',
      'tarefas.equipe',
    ]),
  )
  await pessoa('juliana', await perfil('pf_rec', ['receber', 'pacientes']))
  await pessoa('marta', await perfil('pf_nada', []))

  const paciente = async (nome: string, telefone: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO pacientes (clinica_id, nome, telefone) VALUES ($1, $2, $3) RETURNING id`,
        [clinica, nome, telefone],
      )
    ).rows[0]!.id
  p1 = await paciente(NOME_P1, TELEFONE_P1)
  p2 = await paciente(`Bia Teste ${codigo}`, '71988776655')

  C = await novaCampanha(clinica, 'Novembro Azul', '2026-11-01', '2026-11-30')
  D = await novaCampanha(clinica, 'Retorno de verão', '2026-11-05', '2026-12-15')
  LIMITE = await novaCampanha(clinica, 'Outubro no limite', '2026-09-01', '2026-10-10')
  VELHA = await novaCampanha(clinica, 'Outubro passado', '2026-09-01', '2026-10-09')
  ANTIGA = await novaCampanha(clinica, 'Inverno', '2026-07-01', '2026-08-10')
  EXCLUIDA = await novaCampanha(clinica, 'Removida', '2026-11-01', '2026-11-30', true)
  FUTURA = await novaCampanha(clinica, 'Natal', '2026-12-01', '2026-12-31')
  DE_OUTRA = await novaCampanha(clinicaB, 'Da vizinha', '2026-11-01', '2026-11-30')

  // A carteira, para a soma mensal da sincronização (N-2).
  grupoCarteira = (
    await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [
      `Grupo ${codigo}`,
    ])
  ).rows[0]!.id
  clienteCarteira = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status)
       VALUES ($1, $2, 'Clínica do vínculo', 'FIR Clinic', 'ativo') RETURNING id`,
      [grupoCarteira, clinica],
    )
  ).rows[0]!.id
  await migrate.query(
    `INSERT INTO origens_da_v20 (clinica_id, entidade, id_externo, tabela, id_interno)
     VALUES ($1, 'Campanhas', 'v20-0', 'campanhas', $2)`,
    [clinica, C],
  )

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(relogio)
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  banco = app.get(BancoService)

  const entrar = (usuario: string) =>
    srv().post('/v1/entrar').send({ clinica: codigo, usuario, senha: SENHA }).expect(200)
  gestao = cookieDe(await entrar('helena'))
  recepcao = cookieDe(await entrar('juliana'))
  semPacientes = cookieDe(await entrar('marta'))
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM auditoria_da_carteira WHERE grupo_id = $1', [grupoCarteira])
  await migrate.query('DELETE FROM campanhas_carteira WHERE cliente_carteira_id = $1', [clienteCarteira])
  await migrate.query(
    'DELETE FROM sincronizacao_campanhas_carteira WHERE cliente_carteira_id = $1',
    [clienteCarteira],
  )
  await migrate.query('DELETE FROM clientes_carteira WHERE id = $1', [clienteCarteira])
  await migrate.query('DELETE FROM grupos WHERE id = $1', [grupoCarteira])
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, clinicaB)
  await migrate.end()
  await app.close()
})

beforeEach(async () => {
  await migrate.query('DELETE FROM recebimentos WHERE clinica_id = $1', [clinica])
  await migrate.query('DELETE FROM tarefas WHERE clinica_id = $1', [clinica])
  await migrate.query('UPDATE pacientes SET campanha_id = NULL WHERE clinica_id = $1', [clinica])
})

const tarefasDaClinica = async (): Promise<number> =>
  Number(
    (
      await migrate.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM tarefas WHERE clinica_id = $1',
        [clinica],
      )
    ).rows[0]!.n,
  )

// ---------------------------------------------------------------------------
// A LISTA VINCULÁVEL
// ---------------------------------------------------------------------------

describe('GET /v1/campanhas/vinculaveis — só {id, nome}, na janela do domínio', () => {
  it('AB-A3-1 · quem NÃO tem `campanhas` recebe exatamente `{id, nome}` por item', async () => {
    const r = await vinculaveis(recepcao, 'contexto=tarefa').expect(200)
    // L-A3-8: a lista volta a ser SÓ `{ itens }` — a sugestão tem rota própria.
    expect(Object.keys(r.body).sort()).toEqual(['itens'])
    expect(r.body.itens.length).toBeGreaterThan(0)
    for (const item of r.body.itens as Record<string, unknown>[]) {
      expect(Object.keys(item).sort()).toEqual(['id', 'nome'])
    }
    // E o contrato `.strict()` aceita a resposta inteira.
    expect(CampanhasVinculaveis.safeParse(r.body).success).toBe(true)
  })

  it('N-8 · nenhuma chave monetária nem `meta`/`receita`/`resultado`, com e sem `valores`', async () => {
    const proibidas = new Set<string>([...CAMPOS_MONETARIOS, 'meta', 'receita', 'resultado'])
    for (const cookie of [recepcao, gestao]) {
      const texto = JSON.stringify((await vinculaveis(cookie, 'contexto=tarefa').expect(200)).body)
      const chaves = [...texto.matchAll(/"([A-Za-z_]+)":/g)].map((m) => m[1]!)
      expect(chaves.filter((k) => proibidas.has(k) || /meta|receita|resultado/i.test(k))).toEqual([])
    }
  })

  it('tarefa: em andamento primeiro, depois as outras por início; fora a de 31 dias, a excluída e a da vizinha', async () => {
    const r = await vinculaveis(gestao, 'contexto=tarefa').expect(200)
    expect((r.body.itens as { id: string }[]).map((x) => x.id)).toEqual([D, C, FUTURA, LIMITE])
  })

  it('paciente: só as ativas hoje', async () => {
    const r = await vinculaveis(gestao, 'contexto=paciente').expect(200)
    expect((r.body.itens as { id: string }[]).map((x) => x.id)).toEqual([D, C])
  })

  it('N-4 · `incluir` traz a campanha atual mesmo antiga ou excluída — mas nunca a da vizinha', async () => {
    const ids = async (q: string) =>
      ((await vinculaveis(gestao, q).expect(200)).body.itens as { id: string }[]).map((x) => x.id)
    expect(await ids(`contexto=tarefa&incluir=${ANTIGA}`)).toContain(ANTIGA)
    expect(await ids(`contexto=tarefa&incluir=${EXCLUIDA}`)).toContain(EXCLUIDA)
    expect(await ids(`contexto=tarefa&incluir=${DE_OUTRA}`)).not.toContain(DE_OUTRA)
  })

  it('contexto ausente, inválido ou chave a mais: 400', async () => {
    await vinculaveis(gestao, '').expect(400)
    await vinculaveis(gestao, 'contexto=painel').expect(400)
    await vinculaveis(gestao, 'contexto=tarefa&meta=1').expect(400)
  })

  it('L-A3-8 · `?paciente=` é 400 (`.strict()`), para quem tem e para quem não tem `pacientes`', async () => {
    for (const cookie of [recepcao, semPacientes, gestao]) {
      await vinculaveis(cookie, `contexto=tarefa&paciente=${p1}`).expect(400)
    }
  })
})

// ---------------------------------------------------------------------------
// A SUGESTÃO — GET /v1/pacientes/:id/campanha-sugerida (L-A3-8 a L-A3-10)
// ---------------------------------------------------------------------------

describe('GET /v1/pacientes/:id/campanha-sugerida — rota própria, com trilha de acesso', () => {
  const sugerida = (cookie: string[], paciente: string) =>
    srv().get(`/v1/pacientes/${paciente}/campanha-sugerida`).set('Cookie', cookie)

  /** As linhas `acessou` da trilha para a paciente, depois de `desde`. */
  const acessosDe = async (paciente: string, desde: string) =>
    (
      await migrate.query<{ entidade: string; entidade_id: string; ator_id: string }>(
        `SELECT entidade, entidade_id, ator_id FROM auditoria
          WHERE clinica_id = $1 AND id > $2 AND acao = 'acessou' AND entidade_id = $3`,
        [clinica, desde, paciente],
      )
    ).rows
  const ultimoId = async (): Promise<string> =>
    (
      await migrate.query<{ u: string }>(
        'SELECT coalesce(max(id), 0)::text AS u FROM auditoria WHERE clinica_id = $1',
        [clinica],
      )
    ).rows[0]!.u

  it('LGPD-1 · com `pacientes`: UMA linha `acessou`, entidade `pacientes`, id da PACIENTE', async () => {
    await migrate.query('UPDATE pacientes SET campanha_id = $2 WHERE id = $1', [p1, C])
    const desde = await ultimoId()
    await sugerida(recepcao, p1).expect(200)
    const linhas = await acessosDe(p1, desde)
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.entidade).toBe('pacientes')
    expect(linhas[0]!.entidade_id).toBe(p1)
  })

  it('LGPD-1 · sem `pacientes`: 403, e nada gravado', async () => {
    const desde = await ultimoId()
    await sugerida(semPacientes, p1).expect(403)
    expect(await acessosDe(p1, desde)).toEqual([])
  })

  it('L-A3-10 · desativada, inventada e de outra clínica: o MESMO 404, e nada gravado', async () => {
    const desativada = (
      await migrate.query<{ id: string }>(
        `INSERT INTO pacientes (clinica_id, nome, telefone, campanha_id, ativo, desativado_em)
         VALUES ($1, $2, '', $3, false, now()) RETURNING id`,
        [clinica, `Saiu ${codigo}`, C],
      )
    ).rows[0]!.id
    const daVizinha = (
      await migrate.query<{ id: string }>(
        `INSERT INTO pacientes (clinica_id, nome, telefone) VALUES ($1, $2, '') RETURNING id`,
        [clinicaB, `Vizinha ${codigo}`],
      )
    ).rows[0]!.id
    const inventada = randomUUID()
    const desde = await ultimoId()
    const corpos = new Set<string>()
    for (const id of [desativada, inventada, daVizinha]) {
      const r = await sugerida(recepcao, id).expect(404)
      corpos.add(JSON.stringify(r.body))
      expect(await acessosDe(id, desde)).toEqual([])
    }
    // Uma resposta só: a mensagem não diz qual dos três existe.
    expect(corpos.size).toBe(1)
    await migrate.query('DELETE FROM pacientes WHERE id = $1', [desativada])
  })

  it('L-A3-9 · as chaves são EXATAMENTE `{sugerida, motivo}` — com origem, com tarefa e sem nada', async () => {
    // Origem em andamento.
    await migrate.query('UPDATE pacientes SET campanha_id = $2 WHERE id = $1', [p1, C])
    const origem = await sugerida(recepcao, p1).expect(200)
    expect(Object.keys(origem.body).sort()).toEqual(['motivo', 'sugerida'])
    expect(origem.body).toEqual({ sugerida: C, motivo: 'origem' })
    expect(CampanhaSugerida.safeParse(origem.body).success).toBe(true)

    // Sem origem: a tarefa mais recente numa campanha em andamento.
    await agendar({ pacienteId: p2, tipo: 'Recaptação', campanhaId: C }).expect(201)
    await agendar({ pacienteId: p2, tipo: 'Follow-up', campanhaId: D }).expect(201)
    const tarefa = await sugerida(recepcao, p2).expect(200)
    expect(Object.keys(tarefa.body).sort()).toEqual(['motivo', 'sugerida'])
    expect(tarefa.body).toEqual({ sugerida: D, motivo: 'tarefa' })
    // Nada de tarefa na resposta: nem id, nem tipo, nem data.
    const texto = JSON.stringify(tarefa.body)
    expect(texto).not.toContain('Follow-up')
    expect(texto).not.toContain('2026-11-12')
    expect(texto).not.toContain('Retorno de verão')

    // Origem ENCERRADA não atravessa: `null`, sem dizer qual era.
    await migrate.query('UPDATE pacientes SET campanha_id = $2 WHERE id = $1', [p1, ANTIGA])
    const nada = await sugerida(recepcao, p1).expect(200)
    expect(nada.body).toEqual({ sugerida: null, motivo: null })
    expect(JSON.stringify(nada.body)).not.toContain(ANTIGA)
  })

  it('o `:id` que não é uuid é 400, antes de ler qualquer coisa', async () => {
    await sugerida(recepcao, 'nao-e-uuid').expect(400)
  })
})

// ---------------------------------------------------------------------------
// A ESCRITA NA TAREFA
// ---------------------------------------------------------------------------

describe('criar tarefa com campanha — validada no servidor', () => {
  it('a campanha em andamento é gravada e volta na tarefa', async () => {
    const r = await agendar({ pacienteId: p1, tipo: 'Consulta agendada', campanhaId: C }).expect(201)
    expect(r.body.tarefa.campanhaId).toBe(C)
    // Sem campanha, `null` — a forma não muda.
    const s = await agendar({ pacienteId: p2, tipo: 'Recaptação' }).expect(201)
    expect(s.body.tarefa.campanhaId).toBeNull()
  })

  it('AB-A3-2 · da outra clínica, inventada e excluída: o MESMO 400, e nada gravado', async () => {
    const respostas = await Promise.all(
      [DE_OUTRA, randomUUID(), EXCLUIDA].map((id) =>
        agendar({ pacienteId: p1, tipo: 'Recaptação', campanhaId: id }),
      ),
    )
    for (const r of respostas) expect(r.status).toBe(400)
    const mensagens = new Set(respostas.map((r) => r.body.message as string))
    expect(mensagens.size).toBe(1)
    expect(await tarefasDaClinica()).toBe(0)
  })

  it('AB-A3-3 · encerrada há 31 dias: 400; há 30: aceita (borda de N-7)', async () => {
    await agendar({ pacienteId: p1, tipo: 'Recaptação', campanhaId: VELHA }).expect(400)
    await agendar({ pacienteId: p1, tipo: 'Recaptação', campanhaId: LIMITE }).expect(201)
    expect(await tarefasDaClinica()).toBe(1)
  })

  it('a série inteira herda a campanha, e o índice não a recusa (série fica fora dele)', async () => {
    const r = await srv()
      .post('/v1/tarefas')
      .set('Cookie', gestao)
      .send({
        vinculo: 'paciente',
        pacienteId: p1,
        tipo: 'Pós-consulta',
        responsavelId: gestora,
        campanhaId: C,
        quando: { modo: 'serie', inicio: '2026-11-10', freq: 'semanal', ate: '2026-12-01' },
      })
      .expect(201)
    expect(r.body.todas.length).toBeGreaterThan(1)
    for (const t of r.body.todas as { campanhaId: string }[]) expect(t.campanhaId).toBe(C)
  })

  it('N-6 · a ligação importada aberta e a consulta agendada da mesma paciente na mesma campanha convivem', async () => {
    await agendar({ pacienteId: p1, tipo: 'Recaptação', campanhaId: C }).expect(201)
    await agendar({ pacienteId: p1, tipo: 'Consulta agendada', campanhaId: C }).expect(201)
  })

  it('AB-A3-5 · duas criações simultâneas iguais: uma 201, uma 409 legível — nunca 500, nunca duas', async () => {
    const [a, b] = await Promise.all([
      agendar({ pacienteId: p1, tipo: 'Recaptação', campanhaId: C }),
      agendar({ pacienteId: p1, tipo: 'Recaptação', campanhaId: C }),
    ])
    expect([a.status, b.status].sort()).toEqual([201, 409])
    const conflito = a.status === 409 ? a : b
    expect(conflito.body.codigo).toBe('TAREFA_VIVA_DA_CAMPANHA')
    // L-A3-4 / S-13: nem nome, nem telefone da paciente, nem dado da outra tarefa.
    const corpo = JSON.stringify(conflito.body)
    expect(corpo).not.toContain(NOME_P1)
    expect(corpo).not.toContain(TELEFONE_P1)
    expect(corpo).not.toContain('Recaptação')
    const outra = (a.status === 201 ? a : b).body.tarefa.id as string
    expect(corpo).not.toContain(outra)
    expect(await tarefasDaClinica()).toBe(1)
  })

  it('reabrir uma tarefa que bate no índice também é 409 legível, não 500', async () => {
    const feita = await retroativa({ pacienteId: p1, tipo: 'Recaptação', campanhaId: C }).expect(201)
    await agendar({ pacienteId: p1, tipo: 'Recaptação', campanhaId: C }).expect(201)
    const r = await srv()
      .post(`/v1/tarefas/${feita.body.tarefa.id as string}/reabrir`)
      .set('Cookie', gestao)
      .expect(409)
    expect(r.body.codigo).toBe('TAREFA_VIVA_DA_CAMPANHA')
  })

  it('editar para uma campanha que bate no índice: 409 legível, e a tarefa fica como estava', async () => {
    await agendar({ pacienteId: p1, tipo: 'Recaptação', campanhaId: C }).expect(201)
    const t = await agendar({ pacienteId: p1, tipo: 'Recaptação', campanhaId: D }).expect(201)
    const r = await srv()
      .patch(`/v1/tarefas/${t.body.tarefa.id as string}`)
      .set('Cookie', gestao)
      .send({ campanhaId: C })
      .expect(409)
    expect(r.body.codigo).toBe('TAREFA_VIVA_DA_CAMPANHA')
    const depois = await srv().get(`/v1/tarefas/${t.body.tarefa.id as string}`).set('Cookie', gestao)
    expect(depois.body.tarefa.campanhaId).toBe(D)
  })
})

describe('editar a campanha — TRÊS estados (N-4) e a trilha (L-A3-7)', () => {
  /** Uma tarefa aberta de uma campanha que a escrita já não aceitaria. */
  const tarefaDe = async (campanha: string): Promise<string> =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo,
                              status, paciente_id, tipo, historico, campanha_id)
         VALUES ($1, $2, $2, 'Recaptação', '2026-11-12', 'aberta', $3, 'Recaptação', '[]', $4)
         RETURNING id`,
        [clinica, gestora, p1, campanha],
      )
    ).rows[0]!.id
  const editar = (id: string, corpo: Record<string, unknown>) =>
    srv().patch(`/v1/tarefas/${id}`).set('Cookie', gestao).send(corpo)

  it('AUSENTE mantém — inclusive campanha encerrada há 90 dias e campanha excluída', async () => {
    for (const campanha of [ANTIGA, EXCLUIDA]) {
      await migrate.query('DELETE FROM tarefas WHERE clinica_id = $1', [clinica])
      const id = await tarefaDe(campanha)
      const r = await editar(id, { descricao: 'Ligar de novo' }).expect(200)
      expect(r.body.tarefa.campanhaId).toBe(campanha)
      // Reenviar a ATUAL também é "não mexi": passa.
      const s = await editar(id, { descricao: 'Ligar de novo', campanhaId: campanha }).expect(200)
      expect(s.body.tarefa.campanhaId).toBe(campanha)
    }
  })

  it('`null` remove; um id troca; uma campanha fora da janela é recusada', async () => {
    const id = await tarefaDe(C)
    expect((await editar(id, { campanhaId: D }).expect(200)).body.tarefa.campanhaId).toBe(D)
    expect((await editar(id, { campanhaId: null }).expect(200)).body.tarefa.campanhaId).toBeNull()
    await editar(id, { campanhaId: VELHA }).expect(400)
    await editar(id, { campanhaId: DE_OUTRA }).expect(400)
  })

  it('a troca fica na trilha: `de` e `para` com os ids', async () => {
    const id = await tarefaDe(C)
    const antes = (
      await migrate.query<{ ultimo: string }>(
        'SELECT coalesce(max(id), 0)::text AS ultimo FROM auditoria WHERE clinica_id = $1',
        [clinica],
      )
    ).rows[0]!.ultimo
    await editar(id, { campanhaId: D }).expect(200)
    const trilha = await migrate.query<{ de: Record<string, unknown>; para: Record<string, unknown> }>(
      `SELECT de, para FROM auditoria
        WHERE clinica_id = $1 AND id > $2 AND entidade = 'tarefas' AND entidade_id = $3
          AND acao = 'alterou'`,
      [clinica, antes, id],
    )
    expect(trilha.rows).toHaveLength(1)
    expect(trilha.rows[0]!.de['campanha_id']).toBe(C)
    expect(trilha.rows[0]!.para['campanha_id']).toBe(D)
  })

  it('com `serie: true`, a campanha alcança as próximas abertas da série', async () => {
    const r = await srv()
      .post('/v1/tarefas')
      .set('Cookie', gestao)
      .send({
        vinculo: 'paciente',
        pacienteId: p2,
        tipo: 'Pós-consulta',
        responsavelId: gestora,
        quando: { modo: 'serie', inicio: '2026-11-10', freq: 'semanal', ate: '2026-11-24' },
      })
      .expect(201)
    const primeira = (r.body.todas as { id: string; prazo: string }[]).sort((a, b) =>
      a.prazo.localeCompare(b.prazo),
    )[0]!
    const e = await editar(primeira.id, { campanhaId: C, serie: true }).expect(200)
    expect(e.body.todas.length).toBe(r.body.todas.length)
    for (const t of e.body.todas as { campanhaId: string }[]) expect(t.campanhaId).toBe(C)
  })
})

// ---------------------------------------------------------------------------
// O RECEBIMENTO AVULSO
// ---------------------------------------------------------------------------

describe('recebimento avulso com campanha (N-3)', () => {
  it('a campanha vai para a TAREFA companheira; `recebimentos` não ganha coluna', async () => {
    const r = await receber({ pacienteId: p1, valor: 50000n, campanhaId: C }).expect(201)
    const t = await migrate.query<{ campanha_id: string }>(
      'SELECT campanha_id::text AS campanha_id FROM tarefas WHERE id = $1',
      [r.body.tarefaId],
    )
    expect(t.rows[0]!.campanha_id).toBe(C)
    const coluna = await migrate.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'recebimentos' AND column_name = 'campanha_id'`,
    )
    expect(coluna.rowCount).toBe(0)
  })

  it('o MESMO `requisicaoId` duas vezes: um recebimento, uma tarefa — mesmo com a campanha excluída no meio', async () => {
    const requisicaoId = randomUUID()
    const tarefasDaCampanha = async () =>
      Number(
        (
          await migrate.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM tarefas WHERE campanha_id = $1 AND excluida_em IS NULL',
            [D],
          )
        ).rows[0]!.n,
      )
    const antes = await tarefasDaCampanha()
    const a = await receber({ pacienteId: p1, valor: 30000n, campanhaId: D, requisicaoId }).expect(201)
    await migrate.query('UPDATE campanhas SET excluida_em = now() WHERE id = $1', [D])
    try {
      const b = await receber({ pacienteId: p1, valor: 30000n, campanhaId: D, requisicaoId })
      expect(b.status).toBe(201)
      expect(b.body.id).toBe(a.body.id)
      const c = await receber({ pacienteId: p1, valor: 30000n, campanhaId: D, requisicaoId })
      expect(c.body.id).toBe(a.body.id)
    } finally {
      await migrate.query('UPDATE campanhas SET excluida_em = NULL WHERE id = $1', [D])
    }
    expect(await tarefasDaCampanha()).toBe(antes + 1)
    const n = await migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM recebimentos WHERE requisicao_id = $1',
      [requisicaoId],
    )
    expect(n.rows[0]!.n).toBe('1')
  })

  it('campanha da outra clínica no recebimento: 400, e nada gravado', async () => {
    const r = await receber({ pacienteId: p1, valor: 10000n, campanhaId: DE_OUTRA })
    expect(r.status).toBe(400)
    expect(await tarefasDaClinica()).toBe(0)
  })

  it('S-23 · recebimento sem paciente continua 400', async () => {
    await srv()
      .post('/v1/recebimentos')
      .set('Cookie', gestao)
      .send({ requisicaoId: randomUUID(), valor: '1000', forma: 'Pix', em: '2026-11-09', ref: 'consulta' })
      .expect(400)
  })
})

// ---------------------------------------------------------------------------
// A RECEITA DA CAMPANHA — os contraexemplos nomeados do gate de números
// ---------------------------------------------------------------------------

describe('receita da campanha: o cenário de referência do gate, nos três lugares (N-2)', () => {
  it('R$ 0 → R$ 1.000 → R$ 1.500 → R$ 1.700 → R$ 700 → troca C→D mantém o total', async () => {
    // P1: cartão "Consulta realizada" com campanha C e orçamento de R$ 3.000.
    // O orçamento é da jornada; aqui ele é gravado como a jornada o grava.
    const cartao = (
      await retroativa({ pacienteId: p1, tipo: 'Consulta realizada', campanhaId: C }).expect(201)
    ).body.tarefa.id as string
    await migrate.query(
      `UPDATE tarefas SET etapa = 'orcamento', valor_orcamento = 300000 WHERE id = $1`,
      [cartao],
    )
    expect(await receitaNosTresLugares(C)).toBe(0n) // regra 4: orçamento não é receita

    // P1: fechar com entrada de R$ 1.000 e R$ 2.000 em aberto, no próprio cartão.
    await migrate.query(`UPDATE tarefas SET etapa = 'fechado' WHERE id = $1`, [cartao])
    const fechamento = (
      await migrate.query<{ id: string }>(
        `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, tipo, valor, forma,
                                   valor_aberto, recebido_em, registrado_por)
         VALUES ($1, $2, $3, 'Consulta realizada', 100000, 'Pix', 200000, $4, $5) RETURNING id`,
        [clinica, p1, cartao, AGORA, gestora],
      )
    ).rows[0]!.id
    expect(await receitaNosTresLugares(C)).toBe(100000n) // nem 300000 (negócio) nem 200000 (aberto)

    // P1: avulso "saldo" de R$ 500 com campanha C.
    await receber({ pacienteId: p1, valor: 50000n, ref: 'saldo', campanhaId: C }).expect(201)
    expect(await receitaNosTresLugares(C)).toBe(150000n)

    // P2: "Consulta realizada" com C sem pagamento, mais avulso "consulta" de R$ 200 com C.
    await retroativa({ pacienteId: p2, tipo: 'Consulta realizada', campanhaId: C }).expect(201)
    const avulsoP2 = await receber({ pacienteId: p2, valor: 20000n, campanhaId: C }).expect(201)
    expect(await receitaNosTresLugares(C)).toBe(170000n) // o atendimento sem recebimento não dobra

    // P1: reabrir o cartão estorna os R$ 1.000.
    await migrate.query('UPDATE recebimentos SET estornado_em = now() WHERE id = $1', [fechamento])
    expect(await receitaNosTresLugares(C)).toBe(70000n)

    // Trocar a campanha do avulso de P2 de C para D: C = 500, D = 200, total igual.
    await srv()
      .patch(`/v1/tarefas/${avulsoP2.body.tarefaId as string}`)
      .set('Cookie', gestao)
      .send({ campanhaId: D })
      .expect(200)
    expect(await receitaNaTela(C)).toBe(50000n)
    expect(await receitaNaTela(D)).toBe(20000n)
    const carteira = await receitaNaCarteira([C, D])
    expect(carteira.get(C)).toBe(50000n)
    expect(carteira.get(D)).toBe(20000n)
    expect((await receitaNaConferencia([C])).get(C)).toBe(50000n)
  })
})

describe('receita da campanha: os outros contraexemplos', () => {
  it('AB-A3-6 · orçamento de R$ 20.000 sem recebimento dá 0; fechar com entrada de R$ 5.000 dá R$ 5.000', async () => {
    const cartao = (
      await retroativa({ pacienteId: p1, tipo: 'Consulta realizada', campanhaId: C }).expect(201)
    ).body.tarefa.id as string
    await migrate.query(
      `UPDATE tarefas SET etapa = 'orcamento', valor_orcamento = 2000000 WHERE id = $1`,
      [cartao],
    )
    expect(await receitaNaTela(C)).toBe(0n)
    await migrate.query(`UPDATE tarefas SET etapa = 'fechado' WHERE id = $1`, [cartao])
    await migrate.query(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, tipo, valor, forma,
                                 valor_aberto, recebido_em, registrado_por)
       VALUES ($1, $2, $3, 'Consulta realizada', 500000, 'Pix', 1500000, $4, $5)`,
      [clinica, p1, cartao, AGORA, gestora],
    )
    expect(await receitaNaTela(C)).toBe(500000n)
  })

  it('o ciclo concluir com pagamento → reabrir → concluir → reabrir: sempre UM pagamento, e volta a 0', async () => {
    const id = (await agendar({ pacienteId: p1, tipo: 'Consulta agendada', campanhaId: C }).expect(201))
      .body.tarefa.id as string
    await concluirComPagamento(id, 100000n).expect(200)
    expect(await receitaNaTela(C)).toBe(100000n)
    await srv().post(`/v1/tarefas/${id}/reabrir`).set('Cookie', gestao).expect(200)
    expect(await receitaNaTela(C)).toBe(0n)
    await concluirComPagamento(id, 80000n).expect(200)
    expect(await receitaNaTela(C)).toBe(80000n)
    await srv().post(`/v1/tarefas/${id}/reabrir`).set('Cookie', gestao).expect(200)
    expect(await receitaNaTela(C)).toBe(0n)
  })

  it('N-2 · dinheiro numa tarefa de CONTATO (dado migrado) não é receita — nos três lugares', async () => {
    // A API não deixa guardar pagamento numa "Recaptação"; a planilha da v20
    // deixava. Era exatamente aqui que a conferência antiga divergia da tela.
    const t = (
      await migrate.query<{ id: string }>(
        `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo,
                              status, concluida_em, paciente_id, tipo, historico, campanha_id)
         VALUES ($1, $2, $2, 'migrada', '2026-11-09', 'concluida', $3, $4, 'Recaptação', '[]', $5)
         RETURNING id`,
        [clinica, gestora, AGORA, p1, C],
      )
    ).rows[0]!.id
    await migrate.query(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, tipo, valor, forma,
                                 valor_aberto, recebido_em, registrado_por)
       VALUES ($1, $2, $3, 'Recaptação', 12345, 'Pix', 0, $4, $5)`,
      [clinica, p1, t, AGORA, gestora],
    )
    expect(await receitaNosTresLugares(C)).toBe(0n)
  })

  it('N-1 · paciente que CHEGOU pela campanha, com recebimento avulso SEM campanha: receita 0', async () => {
    await migrate.query('UPDATE pacientes SET campanha_id = $2 WHERE id = $1', [p1, C])
    await receber({ pacienteId: p1, valor: 40000n }).expect(201)
    expect(await receitaNaTela(C)).toBe(0n)
  })
})

// ---------------------------------------------------------------------------
// A SÉRIE COM CAMPANHA — o índice da 0065 com `serie_id IS NULL` (gate de números)
// ---------------------------------------------------------------------------

describe('série com campanha: T-A3-S1 e T-A3-S2 (0065, `serie_id`)', () => {
  /** Uma série de 3 ocorrências de `tipo` em C, pela API. Devolve os ids em ordem de prazo. */
  const serie = async (paciente: string, tipo: string): Promise<string[]> => {
    const r = await srv()
      .post('/v1/tarefas')
      .set('Cookie', gestao)
      .send({
        vinculo: 'paciente',
        pacienteId: paciente,
        tipo,
        responsavelId: gestora,
        campanhaId: C,
        quando: { modo: 'serie', inicio: '2026-11-10', freq: 'semanal', ate: '2026-11-24' },
      })
      .expect(201)
    const todas = (r.body.todas as { id: string; prazo: string }[]).sort((a, b) =>
      a.prazo.localeCompare(b.prazo),
    )
    expect(todas).toHaveLength(3)
    // É série de verdade: as três têm `serie_id`, fora do índice da 0065.
    const comSerie = await migrate.query<{ n: string }>(
      'SELECT count(DISTINCT serie_id)::text AS n FROM tarefas WHERE id = ANY($1::uuid[]) AND serie_id IS NOT NULL',
      [todas.map((t) => t.id)],
    )
    expect(comSerie.rows[0]!.n).toBe('1')
    return todas.map((t) => t.id)
  }
  const concluir = (id: string) =>
    srv()
      .post(`/v1/tarefas/${id}/concluir`)
      .set('Cookie', gestao)
      .send({ em: '2026-11-09', confirmarDuplicidade: true, confirmarCaixaFechado: true })
  const naTela = async () => {
    const r = await srv().get('/v1/campanhas').set('Cookie', gestao).expect(200)
    return (
      r.body.campanhas as { id: string; contatos: number; pacientesConvertidos: number }[]
    ).find((x) => x.id === C)!
  }

  it('T-A3-S1 · receita 15000 nos três lugares, 1 convertido, 2 contatos; estorno dos R$ 50 → 10000', async () => {
    // S1: 3 × Consulta realizada; duas concluídas com R$ 100,00 e R$ 50,00, uma aberta.
    const s1 = await serie(p1, 'Consulta realizada')
    await concluirComPagamento(s1[0]!, 10000n).expect(200)
    await concluirComPagamento(s1[1]!, 5000n).expect(200)
    // S2: 3 × Pós-consulta; duas concluídas, uma aberta.
    const s2 = await serie(p1, 'Pós-consulta')
    await concluir(s2[0]!).expect(200)
    await concluir(s2[1]!).expect(200)

    expect(await receitaNosTresLugares(C)).toBe(15000n)
    const c = await naTela()
    expect(c.pacientesConvertidos).toBe(1)
    expect(c.contatos).toBe(2)

    // Estornar o recebimento de R$ 50,00: reabrir a ocorrência estorna o
    // pagamento embutido dela (append-only: o recebimento fica, estornado).
    await srv().post(`/v1/tarefas/${s1[1]!}/reabrir`).set('Cookie', gestao).expect(200)
    const estornado = await migrate.query<{ estornado: boolean }>(
      `SELECT estornado_em IS NOT NULL AS estornado FROM recebimentos WHERE tarefa_id = $1 AND valor = 5000`,
      [s1[1]!],
    )
    expect(estornado.rows.map((x) => x.estornado)).toEqual([true])
    expect(await receitaNosTresLugares(C)).toBe(10000n)
  })

  it('T-A3-S2 · importar P ao lado de série ABERTA de Pós-consulta: criadas 1/0/0, ignoradas 0/1/1 (regra de hoje)', async () => {
    await serie(p1, 'Pós-consulta')
    const corpo = {
      tipo: 'Pós-consulta',
      descricao: '',
      linhas: [
        {
          nome: NOME_P1,
          telefone: TELEFONE_P1,
          aniversario: '',
          prazo: '2026-11-25',
          responsavelId: gestora,
          obs: '',
        },
      ],
    }
    const criadas: number[] = []
    const ignoradas: number[] = []
    for (let vez = 0; vez < 3; vez++) {
      const r = await srv()
        .post(`/v1/campanhas/${C}/importar`)
        .set('Cookie', gestao)
        .send(corpo)
        .expect(200)
      criadas.push(r.body.criadas as number)
      ignoradas.push(r.body.ignoradas as number)
    }
    // A série aberta NÃO conta como "já está na campanha" para a importação:
    // a 0065 tirou a série do índice (D-25 item 7). Se o dono decidir o
    // contrário, o lugar é um `NOT EXISTS` na importação — e este teste muda junto.
    expect(criadas).toEqual([1, 0, 0])
    expect(ignoradas).toEqual([0, 1, 1])
    const avulsas = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tarefas
        WHERE clinica_id = $1 AND campanha_id = $2 AND serie_id IS NULL`,
      [clinica, C],
    )
    expect(avulsas.rows[0]!.n).toBe('1')
  })
})

// ---------------------------------------------------------------------------
// AS DUAS PROPRIEDADES
// ---------------------------------------------------------------------------

/** O universo do gerador: tipos de receita, pagáveis e de contato. */
const TIPOS = ['Pagamento de consulta', 'Consulta realizada', 'Recaptação', 'Orçamento enviado'] as const
const RECEITA_SEMPRE = new Set(['Pagamento de consulta'])
const PAGAVEL = new Set(['Consulta realizada'])

type TarefaGerada = {
  tipo: (typeof TIPOS)[number] | ''
  status: 'aberta' | 'concluida' | 'cancelada'
  campanha: 0 | 1 | 2 // nenhuma, C, D
  recebimento: null | { valor: bigint; estornado: boolean }
}

const tarefaGerada: fc.Arbitrary<TarefaGerada> = fc
  .record({
    comPaciente: fc.boolean(),
    tipo: fc.constantFrom(...TIPOS),
    status: fc.constantFrom('aberta' as const, 'concluida' as const, 'cancelada' as const),
    campanha: fc.constantFrom(0 as const, 1 as const, 2 as const),
    recebimento: fc.option(
      fc.record({ valor: fc.bigInt({ min: 0n, max: 900000n }), estornado: fc.boolean() }),
      { nil: null },
    ),
  })
  // Sem paciente não há tipo (CHECK `tipo_exige_paciente`) nem recebimento
  // (`recebimentos.paciente_id` é NOT NULL): o dinheiro precisa de dono.
  .map((x) =>
    x.comPaciente
      ? { tipo: x.tipo, status: x.status, campanha: x.campanha, recebimento: x.recebimento }
      : { tipo: '' as const, status: x.status, campanha: x.campanha, recebimento: null },
  )

/** A receita esperada, recalculada em TS a partir do mesmo cenário. */
const esperada = (ts: readonly TarefaGerada[], campanha: 1 | 2): bigint =>
  ts
    .filter(
      (t) =>
        t.campanha === campanha &&
        t.status === 'concluida' &&
        t.tipo !== '' &&
        t.recebimento !== null &&
        !t.recebimento.estornado &&
        t.recebimento.valor > 0n &&
        (RECEITA_SEMPRE.has(t.tipo) || PAGAVEL.has(t.tipo)),
    )
    .reduce((s, t) => s + t.recebimento!.valor, 0n)

/**
 * Grava o cenário direto no banco — o que se mede é a LEITURA da receita, não
 * a escrita. Uma paciente por tarefa: o índice `tarefa_viva_da_campanha` não
 * é o assunto aqui.
 */
async function gravar(ts: readonly TarefaGerada[], pacientes: readonly string[]): Promise<string[]> {
  await migrate.query('DELETE FROM recebimentos WHERE clinica_id = $1', [clinica])
  await migrate.query('DELETE FROM tarefas WHERE clinica_id = $1', [clinica])
  const ids: string[] = []
  for (const [i, t] of ts.entries()) {
    const paciente = t.tipo === '' ? null : pacientes[i]!
    const id = (
      await migrate.query<{ id: string }>(
        `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo,
                              status, concluida_em, paciente_id, tipo, historico, campanha_id)
         VALUES ($1, $2, $2, 'gerada', '2026-11-09', $3, $4, $5, $6, '[]', $7) RETURNING id`,
        [
          clinica,
          gestora,
          t.status,
          t.status === 'concluida' ? AGORA : null,
          paciente,
          t.tipo,
          t.campanha === 0 ? null : t.campanha === 1 ? C : D,
        ],
      )
    ).rows[0]!.id
    ids.push(id)
    if (t.recebimento !== null && paciente !== null) {
      const venda = t.recebimento.valor === 0n
      await migrate.query(
        `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, tipo, valor, forma,
                                   valor_aberto, recebido_em, registrado_por, estornado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          clinica,
          paciente,
          id,
          t.tipo,
          t.recebimento.valor.toString(),
          venda ? '' : 'Pix',
          venda ? '10000' : '0',
          AGORA,
          gestora,
          t.recebimento.estornado ? AGORA : null,
        ],
      )
    }
  }
  return ids
}

describe('as propriedades da receita da campanha (fast-check sobre Postgres real)', () => {
  let pacientes: string[] = []
  beforeAll(async () => {
    pacientes = []
    for (let i = 0; i < 8; i++) {
      pacientes.push(
        (
          await migrate.query<{ id: string }>(
            `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, $2) RETURNING id`,
            [clinica, `Gerada ${i} ${codigo}`],
          )
        ).rows[0]!.id,
      )
    }
  })

  it('partição: receita(c) é exatamente a soma recalculada, e nenhum recebimento cai em duas', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(tarefaGerada, { minLength: 1, maxLength: 8 }), async (ts) => {
        await gravar(ts, pacientes)
        const c = await receitaNaTela(C)
        const d = await receitaNaTela(D)
        expect(c).toBe(esperada(ts, 1))
        expect(d).toBe(esperada(ts, 2))
        // Σ campanhas = Σ das mesmas tarefas com campanha não nula.
        const comCampanha = ts.filter((t) => t.campanha !== 0)
        expect(c + d).toBe(esperada(comCampanha.map((t) => ({ ...t, campanha: 1 })), 1))
      }),
      { numRuns: 25 },
    )
  })

  it('troca: qualquer sequência de trocas mantém Σ, e a origem cai o que o destino sobe', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(tarefaGerada, { minLength: 1, maxLength: 6 }),
        fc.array(fc.tuple(fc.nat(5), fc.constantFrom(1 as const, 2 as const)), {
          minLength: 1,
          maxLength: 4,
        }),
        async (ts, trocas) => {
          const ids = await gravar(ts, pacientes)
          const atual = ts.map((t) => ({ ...t }))
          for (const [i, para] of trocas) {
            const k = i % ids.length
            const de = atual[k]!.campanha
            const antesC = await receitaNaTela(C)
            const antesD = await receitaNaTela(D)
            await migrate.query('UPDATE tarefas SET campanha_id = $2 WHERE id = $1', [
              ids[k],
              para === 1 ? C : D,
            ])
            atual[k]!.campanha = para
            const depoisC = await receitaNaTela(C)
            const depoisD = await receitaNaTela(D)
            if (de !== 0) expect(depoisC + depoisD).toBe(antesC + antesD)
            const movido = esperada([{ ...atual[k]!, campanha: 1 }], 1)
            if (de === 1 && para === 2) {
              expect(antesC - depoisC).toBe(movido)
              expect(depoisD - antesD).toBe(movido)
            }
            if (de === 2 && para === 1) {
              expect(antesD - depoisD).toBe(movido)
              expect(depoisC - antesC).toBe(movido)
            }
          }
        },
      ),
      { numRuns: 15 },
    )
  })
})
