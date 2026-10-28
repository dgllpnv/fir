import { RelogioFixo } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'

/**
 * Pacientes pelo caminho HTTP de verdade.
 *
 * O relógio é FIXO: sem isso, "aniversariantes do mês" e "sem retorno há 6+
 * meses" passariam a depender do dia em que a suíte roda, e o teste que prova
 * que o mês vem do fuso DA CLÍNICA (e não do UTC) seria impossível de
 * escrever — ele precisa de um instante em que os dois discordam.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'senha-de-teste-pacientes'
const FUSO = 'America/Bahia'

/**
 * 01/10/2026 às 01:00 UTC. Em America/Bahia (UTC−3) ainda é **30/09/2026**.
 *
 * É o instante que separa "o mês da clínica" de "o mês do servidor": com UTC,
 * o atalho de aniversariantes mostraria outubro enquanto a recepção vê
 * setembro no calendário da parede.
 */
const AGORA = new Date('2026-10-01T01:00:00Z')
const HOJE_DA_CLINICA = '2026-09-30'

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let outraClinica: string
let pacienteDaOutra: string
let unidadeDaOutra: string
const codigo = `pac-${Date.now()}`

const cookies: Record<string, string[]> = {}

const umId = async (sql: string, params: unknown[]): Promise<string> =>
  (await migrate.query<{ id: string }>(sql, params)).rows[0]!.id

const entrar = async (usuario: string): Promise<string[]> => {
  const r = await request(app.getHttpServer())
    .post('/v1/entrar')
    .send({ clinica: codigo, usuario, senha: SENHA })
    .expect(200)
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

type Corpo = Record<string, unknown>

const criar = (corpo: Corpo, quem = 'juliana') =>
  request(app.getHttpServer()).post('/v1/pacientes').set('Cookie', cookies[quem]!).send(corpo)

const listar = (consulta: Record<string, string> = {}, quem = 'juliana') =>
  request(app.getHttpServer())
    .get('/v1/pacientes')
    .query(consulta)
    .set('Cookie', cookies[quem]!)

const ficha = (id: string, quem = 'juliana') =>
  request(app.getHttpServer()).get(`/v1/pacientes/${id}`).set('Cookie', cookies[quem]!)

const editar = (id: string, corpo: Corpo, quem = 'juliana') =>
  request(app.getHttpServer()).patch(`/v1/pacientes/${id}`).set('Cookie', cookies[quem]!).send(corpo)

const nomesDe = (corpo: { pacientes: { nome: string }[] }): string[] =>
  corpo.pacientes.map((p) => p.nome)

/** Cria uma tarefa concluída de atendimento, direto no banco. */
async function atendimentoEm(pacienteId: string, dia: string): Promise<void> {
  await migrate.query(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, paciente_id, tipo, status, concluida_em)
     VALUES ($1, $2, $2, 'Consulta', $3, $4, 'Consulta realizada', 'concluida', $3::date + time '12:00' AT TIME ZONE $5)`,
    [clinica, pessoas['juliana'], dia, pacienteId, FUSO],
  )
}

const pessoas: Record<string, string> = {}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[pacientes.e2e] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinica = await umId(
    `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, 'Clínica Pacientes', $2) RETURNING id`,
    [codigo, FUSO],
  )
  outraClinica = await umId(
    `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, 'Clínica Vizinha', $2) RETURNING id`,
    [`${codigo}-v`, FUSO],
  )

  // `pf_rec` tem `pacientes` e NÃO tem `valores` nem `pacientes.gerir`: é a
  // persona que prova a redação e o 403 de desativar.
  const rec = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', ARRAY['pacientes']) RETURNING id`,
    [clinica],
  )
  // `pf_sup` tem tudo o que estas rotas pedem, incluindo `valores`.
  const sup = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_sup', 'Supervisão', ARRAY['pacientes','pacientes.gerir','valores']) RETURNING id`,
    [clinica],
  )
  // `pf_enf` NÃO tem `pacientes`: é o 403 da lista.
  const enf = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_enf', 'Enfermagem', ARRAY['estoque']) RETURNING id`,
    [clinica],
  )

  const hash = await hashDeSenha(SENHA)
  const pessoa = async (nome: string, usuario: string, perfil: string): Promise<string> =>
    umId(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [clinica, nome, usuario, hash, perfil],
    )

  pessoas['juliana'] = await pessoa('Juliana', 'juliana', rec)
  pessoas['beatriz'] = await pessoa('Beatriz', 'beatriz', sup)
  pessoas['camila'] = await pessoa('Camila', 'camila', enf)

  await migrate.query(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', ARRAY['pacientes'])`,
    [outraClinica],
  )
  pacienteDaOutra = await umId(
    `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, 'Vizinha Secreta') RETURNING id`,
    [outraClinica],
  )
  unidadeDaOutra = await umId(
    `INSERT INTO unidades (clinica_id, nome) VALUES ($1, 'Unidade Da Vizinha') RETURNING id`,
    [outraClinica],
  )

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(new RelogioFixo(AGORA))
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  for (const quem of ['juliana', 'beatriz', 'camila']) cookies[quem] = await entrar(quem)
})

afterAll(async () => {
  await app.close()
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, outraClinica)
  await migrate.end()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /v1/pacientes', () => {
  it('cadastra e devolve a ficha nova', async () => {
    const r = await criar({ nome: 'Primeira Paciente', telefone: '(71) 98888-0001' }).expect(201)
    expect(r.body.nome).toBe('Primeira Paciente')
    expect(r.body.ativo).toBe(true)
  })

  it('nome repetido, só acento diferente, é 409 com a frase dela', async () => {
    await criar({ nome: 'Ana Lúcia Souza' }).expect(201)
    const r = await criar({ nome: 'ana lucia souza' })
    expect(r.statusCode).toBe(409)
    expect(r.body.message).toContain('Busque pelo nome para selecionar')
  })

  it('`ultimaConsulta` no futuro é descartada, não recusada', async () => {
    // Amanhã NO FUSO DA CLÍNICA. A comparação é do servidor (regra 24).
    const r = await criar({ nome: 'Data Futura', ultimaConsulta: '2026-10-01' }).expect(201)
    expect(r.body.ultimaConsulta).toBeNull()
    const ontem = await criar({ nome: 'Data Passada', ultimaConsulta: '2026-09-29' }).expect(201)
    expect(ontem.body.ultimaConsulta).toBe('2026-09-29')
  })

  it('hoje da clínica AINDA vale — a borda não é o UTC', async () => {
    // `AGORA` é 01/10 em UTC e 30/09 na clínica. Uma última consulta em 30/09
    // precisa ser aceita, e uma em 01/10 recusada.
    const r = await criar({ nome: 'Borda Do Dia', ultimaConsulta: HOJE_DA_CLINICA }).expect(201)
    expect(r.body.ultimaConsulta).toBe(HOJE_DA_CLINICA)
  })

  it('`indicadoPor` só é guardado quando a origem é Indicação', async () => {
    const a = await criar({ nome: 'Veio Por Indicação', origem: 'Indicação', indicadoPor: 'Maria' })
    expect(a.body.indicadoPor).toBe('Maria')
    const b = await criar({ nome: 'Veio Do Instagram', origem: 'Instagram', indicadoPor: 'Maria' })
    expect(b.body.indicadoPor).toBe('')
  })

  it('`unidadeId` de OUTRA clínica é descartado, não gravado', async () => {
    // A FK `pacientes.unidade_id -> unidades(id)` é verificada pelo sistema e
    // ATRAVESSA a RLS: sem esta checagem, um POST com o id de uma unidade da
    // clínica vizinha grava o vínculo e passa. É o `unidadeValida()` do
    // `Code.gs`, que descarta em silêncio em vez de recusar o cadastro.
    const r = await criar({ nome: 'Unidade Invasora', unidadeId: unidadeDaOutra }).expect(201)
    expect(r.body.unidadeId).toBeNull()
  })

  it('`unidadeId` inexistente também é descartado, e o cadastro entra', async () => {
    const r = await criar({
      nome: 'Unidade Fantasma',
      unidadeId: '00000000-0000-4000-8000-000000000001',
    }).expect(201)
    expect(r.body.unidadeId).toBeNull()
  })

  it('nenhum log contém nome nem telefone de paciente', async () => {
    const linhas: string[] = []
    for (const metodo of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, metodo).mockImplementation((...args: unknown[]) => {
        linhas.push(args.map((a) => String(a)).join(' '))
      })
    }
    await criar({ nome: 'Ana Lúcia Discreta', telefone: '71988887777' }).expect(201)
    // Força também o caminho de erro, que é onde o corpo costuma vazar.
    await criar({ nome: 'Ana Lúcia Discreta', telefone: '71988887777' }).expect(409)
    const tudo = linhas.join('\n')
    expect(tudo).not.toMatch(/Ana Lúcia Discreta|988887777/)
  })
})

describe('PATCH /v1/pacientes/:id', () => {
  it('edita o que foi mandado e deixa o resto em paz', async () => {
    const id = (await criar({ nome: 'Para Editar', telefone: '71911110000' }).expect(201)).body.id
    const r = await editar(id, { telefone: '71922220000' }).expect(200)
    expect(r.body.telefone).toBe('71922220000')
    expect(r.body.nome).toBe('Para Editar')
  })

  it('renomear para um nome que já existe é 409', async () => {
    await criar({ nome: 'Nome Ocupado' }).expect(201)
    const id = (await criar({ nome: 'Nome Livre' }).expect(201)).body.id
    expect((await editar(id, { nome: 'nome ocupado' })).statusCode).toBe(409)
  })

  it('editar paciente de OUTRA clínica é 404, nunca 403', async () => {
    // 403 confirmaria que ela existe. A RLS já devolve zero linhas.
    expect((await editar(pacienteDaOutra, { telefone: '71900000000' })).statusCode).toBe(404)
  })
})

describe('GET /v1/pacientes — a lista que a tela usa', () => {
  it('sem a permissão `pacientes`, a lista é 403', async () => {
    await listar({}, 'camila').expect(403)
    await criar({ nome: 'Qualquer Uma' }, 'camila').expect(403)
  })

  it('busca por nome ignora acento, caixa e espaço a mais', async () => {
    await criar({ nome: 'Luciana Barreto Nogueira' }).expect(201)
    const r = await listar({ q: 'LUCIANA  barreto' }).expect(200)
    expect(nomesDe(r.body)).toContain('Luciana Barreto Nogueira')
  })

  it('busca por telefone ignora a máscara', async () => {
    await criar({ nome: 'Telefone Mascarado', telefone: '(71) 98765-4321' }).expect(201)
    const r = await listar({ q: '987654321' }).expect(200)
    expect(nomesDe(r.body)).toContain('Telefone Mascarado')
  })

  it('o atalho "aniversariantes" usa o mês do fuso DA CLÍNICA', async () => {
    // Em UTC `AGORA` já é outubro; na clínica ainda é setembro.
    await criar({ nome: 'Faz Anos Em Setembro', aniversario: '1984-09-14' }).expect(201)
    await criar({ nome: 'Faz Anos Em Outubro', aniversario: '1984-10-14' }).expect(201)
    const r = await listar({ atalho: 'aniversariantes' }).expect(200)
    expect(nomesDe(r.body)).toContain('Faz Anos Em Setembro')
    expect(nomesDe(r.body)).not.toContain('Faz Anos Em Outubro')
  })

  it('o atalho "com tarefa em aberto" mostra só quem tem', async () => {
    const comTarefa = (await criar({ nome: 'Tem Tarefa Aberta' }).expect(201)).body.id
    await criar({ nome: 'Nao Tem Tarefa' }).expect(201)
    await migrate.query(
      `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, paciente_id, tipo)
       VALUES ($1, $2, $2, 'Confirmar', '2026-09-30', $3, 'Confirmação')`,
      [clinica, pessoas['juliana'], comTarefa],
    )
    const r = await listar({ atalho: 'com-tarefa-aberta' }).expect(200)
    expect(nomesDe(r.body)).toContain('Tem Tarefa Aberta')
    expect(nomesDe(r.body)).not.toContain('Nao Tem Tarefa')
  })

  it('o atalho "sem retorno" usa o MAIS RECENTE entre atendimento e ultimaConsulta', async () => {
    // Uma paciente com `ultimaConsulta` antiga mas atendimento RECENTE não é
    // candidata a recaptação. Confundir os dois faz a clínica ligar para quem
    // esteve lá na semana passada.
    const sumida = (await criar({ nome: 'Sumida De Verdade', ultimaConsulta: '2025-01-10' }))
      .body.id
    const falsaSumida = (
      await criar({ nome: 'Falsa Sumida', ultimaConsulta: '2025-01-10' }).expect(201)
    ).body.id
    await atendimentoEm(falsaSumida, '2026-09-20')
    expect(sumida).toBeDefined()

    const r = await listar({ atalho: 'sem-retorno' }).expect(200)
    expect(nomesDe(r.body)).toContain('Sumida De Verdade')
    expect(nomesDe(r.body)).not.toContain('Falsa Sumida')
  })

  it('"sem retorno" exclui quem nunca teve movimento nenhum', async () => {
    // O protótipo filtra `x.s.ultAtend && x.s.ultAtend < lim6`: quem nunca
    // apareceu não "deixou de voltar", e encher a campanha de recaptação com
    // cadastros vazios é como ela deixa de ser usada.
    await criar({ nome: 'Nunca Veio' }).expect(201)
    const r = await listar({ atalho: 'sem-retorno' }).expect(200)
    expect(nomesDe(r.body)).not.toContain('Nunca Veio')
  })

  it('"sem retorno" vem do mais antigo para o mais recente', async () => {
    await criar({ nome: 'Sumiu Em 2024', ultimaConsulta: '2024-03-01' }).expect(201)
    await criar({ nome: 'Sumiu Em 2026', ultimaConsulta: '2026-01-05' }).expect(201)
    const nomes = nomesDe((await listar({ atalho: 'sem-retorno' }).expect(200)).body)
    expect(nomes.indexOf('Sumiu Em 2024')).toBeLessThan(nomes.indexOf('Sumiu Em 2026'))
  })

  it('a lista não traz paciente de outra clínica', async () => {
    const r = await listar({ limite: '200' }).expect(200)
    expect(nomesDe(r.body)).not.toContain('Vizinha Secreta')
  })
})

describe('o dinheiro na lista, e a redação', () => {
  it('`ltv` e `saldo` são derivados dos recebimentos vivos', async () => {
    const id = (await criar({ nome: 'Paciente Com Dinheiro' }).expect(201)).body.id
    const tarefa = await umId(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, paciente_id, tipo, status, concluida_em)
       VALUES ($1, $2, $2, 'Consulta', '2026-09-20', $3, 'Consulta realizada', 'concluida', now())
       RETURNING id`,
      [clinica, pessoas['juliana'], id],
    )
    await migrate.query(
      `INSERT INTO recebimentos
         (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
       VALUES ($1, $2, $3, 'Pagamento de consulta', 45000, 'Pix', 15000, now(), $4)`,
      [clinica, id, tarefa, pessoas['juliana']],
    )

    const r = await listar({ q: 'Paciente Com Dinheiro' }, 'beatriz').expect(200)
    const p = r.body.pacientes[0]
    expect(p.ltv).toBe('45000')
    expect(p.saldo).toBe('15000')
  })

  it('um "Pagamento de saldo em aberto" ABATE o saldo e NÃO deixa negativo', async () => {
    const id = (await criar({ nome: 'Paciente Que Quitou' }).expect(201)).body.id
    const tarefaA = await umId(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, paciente_id, tipo, status, concluida_em)
       VALUES ($1, $2, $2, 'Consulta', '2026-09-20', $3, 'Consulta realizada', 'concluida', now())
       RETURNING id`,
      [clinica, pessoas['juliana'], id],
    )
    const tarefaB = await umId(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, paciente_id, tipo, status, concluida_em)
       VALUES ($1, $2, $2, 'Quitação', '2026-09-25', $3, 'Pagamento de saldo em aberto', 'concluida', now())
       RETURNING id`,
      [clinica, pessoas['juliana'], id],
    )
    await migrate.query(
      `INSERT INTO recebimentos
         (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
       VALUES ($1,$2,$3,'Pagamento de consulta',45000,'Pix',15000,now(),$5),
              ($1,$2,$4,'Pagamento de saldo em aberto',20000,'Pix',0,now(),$5)`,
      [clinica, id, tarefaA, tarefaB, pessoas['juliana']],
    )
    const p = (await listar({ q: 'Paciente Que Quitou' }, 'beatriz').expect(200)).body.pacientes[0]
    expect(p.ltv).toBe('65000')
    // 15000 aberto − 20000 abatido = −5000, e saldo negativo não existe.
    expect(p.saldo).toBe('0')
  })

  it('sem a permissão `valores`, `ltv` e `saldo` saem NULL — e a forma não muda', async () => {
    const r = await listar({ q: 'Paciente Com Dinheiro' }, 'juliana').expect(200)
    const p = r.body.pacientes[0]
    expect(p.ltv).toBeNull()
    expect(p.saldo).toBeNull()
    expect(p.nome).toBe('Paciente Com Dinheiro')
  })

  it('ordenar por LTV exige `valores` — ordenar por dinheiro revela o dinheiro', async () => {
    // A posição na lista é informação sobre o valor. Liberar a ordenação a
    // quem não vê valores entregaria o ranking de faturamento da clínica
    // numa requisição, com os campos saindo `null` e ninguém percebendo.
    await listar({ ordem: 'ltv' }, 'juliana').expect(403)
    await listar({ ordem: 'ltv' }, 'beatriz').expect(200)
  })
})

describe('GET /v1/pacientes/:id — a ficha', () => {
  it('traz o cadastro e as tarefas do paciente', async () => {
    const id = (await criar({ nome: 'Ficha Completa' }).expect(201)).body.id
    await atendimentoEm(id, '2026-09-10')
    const r = await ficha(id).expect(200)
    expect(r.body.nome).toBe('Ficha Completa')
    expect(r.body.tarefas).toHaveLength(1)
    expect(r.body.tarefas[0].tipo).toBe('Consulta realizada')
    // A tarefa NÃO carrega dinheiro: ele mora em `recebimentos`.
    expect(Object.keys(r.body.tarefas[0])).not.toContain('valor')
  })

  it('abrir a ficha grava "acessou" na trilha, com o id da paciente', async () => {
    const id = (await criar({ nome: 'Ficha Auditada' }).expect(201)).body.id
    await ficha(id).expect(200)
    const t = await migrate.query<{ acao: string; entidade: string; entidade_id: string; ator_id: string }>(
      `SELECT acao, entidade, entidade_id, ator_id FROM auditoria
        WHERE clinica_id = $1 AND acao = 'acessou' AND entidade = 'pacientes'
        ORDER BY id DESC LIMIT 1`,
      [clinica],
    )
    expect(t.rows[0]).toMatchObject({
      acao: 'acessou',
      entidade: 'pacientes',
      entidade_id: id,
      ator_id: pessoas['juliana'],
    })
  })

  it('a ficha de outra clínica é 404 — nem com o id na mão', async () => {
    await ficha(pacienteDaOutra).expect(404)
  })

  it('ficha inexistente é 404, e o 404 não grava acesso', async () => {
    const antes = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM auditoria WHERE clinica_id=$1 AND acao='acessou' AND entidade='pacientes'`,
      [clinica],
    )
    await ficha('00000000-0000-4000-8000-000000000000').expect(404)
    const depois = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM auditoria WHERE clinica_id=$1 AND acao='acessou' AND entidade='pacientes'`,
      [clinica],
    )
    expect(depois.rows[0]!.n).toBe(antes.rows[0]!.n)
  })
})

describe('DELETE /v1/pacientes/:id — desativar, nunca apagar (ADR 0003)', () => {
  const desativar = (id: string, quem = 'beatriz') =>
    request(app.getHttpServer()).delete(`/v1/pacientes/${id}`).set('Cookie', cookies[quem]!)

  it('desativar tira das listas mas NÃO apaga as tarefas', async () => {
    const id = (await criar({ nome: 'Sai Da Lista' }).expect(201)).body.id
    await atendimentoEm(id, '2026-09-11')
    await atendimentoEm(id, '2026-09-12')

    await desativar(id).expect(200)

    const r = await listar({ q: 'Sai Da Lista' }).expect(200)
    expect(nomesDe(r.body)).not.toContain('Sai Da Lista')
    const t = await migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM tarefas WHERE paciente_id = $1 AND excluida_em IS NULL',
      [id],
    )
    expect(Number(t.rows[0]!.n)).toBe(2)
  })

  it('desativar devolve quantas tarefas ficaram — é o que a tela avisa antes', async () => {
    const id = (await criar({ nome: 'Tem Quatro Tarefas' }).expect(201)).body.id
    for (const dia of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']) {
      await atendimentoEm(id, dia)
    }
    const r = await desativar(id).expect(200)
    expect(r.body.tarefas).toBe(4)
    expect(r.body.id).toBe(id)
  })

  it('o histórico continua abrindo — desativar é sair das listas, não sumir', async () => {
    const id = (await criar({ nome: 'Historico Preservado' }).expect(201)).body.id
    await atendimentoEm(id, '2026-09-05')
    await desativar(id).expect(200)
    const f = await ficha(id).expect(200)
    expect(f.body.ativo).toBe(false)
    expect(f.body.tarefas).toHaveLength(1)
  })

  it('o nome volta a ficar livre depois de desativar', async () => {
    const id = (await criar({ nome: 'Nome Reciclado' }).expect(201)).body.id
    await desativar(id).expect(200)
    await criar({ nome: 'Nome Reciclado' }).expect(201)
  })

  it('sem `pacientes.gerir`, 403 — e a paciente continua ativa', async () => {
    const id = (await criar({ nome: 'Nao Pode Desativar' }).expect(201)).body.id
    await desativar(id, 'juliana').expect(403)
    expect((await ficha(id).expect(200)).body.ativo).toBe(true)
  })

  it('desativar duas vezes: a segunda é 404', async () => {
    const id = (await criar({ nome: 'Desativa Uma Vez So' }).expect(201)).body.id
    await desativar(id).expect(200)
    await desativar(id).expect(404)
  })

  it('a desativação entra na trilha com de/para de `ativo`', async () => {
    const id = (await criar({ nome: 'Entra Na Trilha' }).expect(201)).body.id
    await desativar(id).expect(200)
    const t = await migrate.query<{ acao: string; de: { ativo: boolean }; para: { ativo: boolean }; ator_id: string }>(
      `SELECT acao, de, para, ator_id FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pacientes' AND entidade_id = $2 AND acao = 'alterou'
        ORDER BY id DESC LIMIT 1`,
      [clinica, id],
    )
    expect(t.rows[0]!.de.ativo).toBe(true)
    expect(t.rows[0]!.para.ativo).toBe(false)
    // E a trilha diz QUEM — nunca o sistema por uma ação humana.
    expect(t.rows[0]!.ator_id).toBe(pessoas['beatriz'])
  })

  it('desativar paciente de outra clínica é 404', async () => {
    await desativar(pacienteDaOutra).expect(404)
  })
})
