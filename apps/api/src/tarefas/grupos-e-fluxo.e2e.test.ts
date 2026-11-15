import { randomBytes } from 'node:crypto'
import { ACOES_DO_FLUXO } from '@fir/contracts'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BancoService } from '../banco/banco.service'
import { SISTEMA } from '../banco/ator'
import { consultarPrazos } from '../painel-geral/metricas-diarias'
import { reiniciarLimiteDeEscritaDoFluxo } from './limite-de-escrita.guard'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarOperadorDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
  remendar,
  botar,
  tarefaCrua,
} from './__tests__/cenario'

/**
 * GRUPOS DE COLABORADORES, TAREFA PARA GRUPO, ASSUMIR, TRANSFERIR E FLUXO
 * (ADR 2026-11-14; emendas E-S e E-L do spec).
 *
 * Postgres real, HTTP real, duas clínicas. Personas do `cenario`:
 *   beatriz  supervisão: `config` + `tarefas.equipe` + `pacientes` (NÃO é do grupo)
 *   juliana  recepção (`jornada`,`pacientes`) — MEMBRO de `Recepção`
 *   camila   comercial — MEMBRO de `Recepção`
 *   nara     enfermagem — membro só de `Enfermagem` (NÃO de `Recepção`)
 *   rita     balcão — sem grupo nenhum
 *   davi     criado aqui: só `jornada`, SEM `pacientes`
 */
// Gancho de TOCTOU: roda DEPOIS que o serviço leu os grupos do autor e ANTES do UPDATE.
const gancho = vi.hoisted(() => ({ depoisDeLerGrupos: null as null | (() => Promise<void>) }))
vi.mock('./grupos-do-autor', async (original) => {
  const m = await original<typeof import('./grupos-do-autor')>()
  return {
    ...m,
    comGrupos: async (...a: Parameters<typeof m.comGrupos>) => {
      const r = await m.comGrupos(...a)
      const f = gancho.depoisDeLerGrupos
      gancho.depoisDeLerGrupos = null
      if (f !== null) await f()
      return r
    },
  }
})

let c: Cenario
const sufixo = randomBytes(4).toString('hex')
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP =
  process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'
const USUARIO_OP = `grp.${sufixo}`
const SENHA_OP = 'doze-pedras-no-caminho'
const SENHA_DAVI = 'senha-de-teste-tarefas'

let recepcao: string
let enfermagem: string
let operadorId: string
let suporte: string
let cookieDavi: string[]
let davi: string

const http = () => request(c.app.getHttpServer())
const pares = (r: { headers: Record<string, string> }): string => {
  const v = r.headers['set-cookie'] as unknown
  const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
  return lista.map((x) => x.split(';')[0]!).join('; ')
}

const criarGrupo = (nome: string, quem = 'beatriz') => postar(c, '/v1/grupos', { nome }, quem)
const definirGrupos = (pessoa: string, grupoIds: string[], quem = 'beatriz') =>
  botar(c, `/v1/pessoas/${pessoa}/grupos`, { grupoIds }, quem)

/** Tarefa interna para um GRUPO, aberta para hoje. */
const tarefaDeGrupo = (extra: Record<string, unknown> = {}, quem = 'beatriz') =>
  postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'interna',
      grupoId: recepcao,
      descricao: 'Ligar para o laboratório',
      quando: { modo: 'agendada', prazo: HOJE },
      ...extra,
    },
    quem,
  )

const idDaTarefaDeGrupo = async (extra: Record<string, unknown> = {}): Promise<string> =>
  (await tarefaDeGrupo(extra).expect(201)).body.tarefa.id

const tarefaDePessoa = async (responsavel: string, extra: Record<string, unknown> = {}, quem = 'beatriz') =>
  (
    await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'interna',
        responsavelId: c.pessoas[responsavel],
        descricao: 'Conferir a agenda',
        quando: { modo: 'agendada', prazo: HOJE },
        ...extra,
      },
      quem,
    ).expect(201)
  ).body.tarefa.id as string

const eventosDe = async (id: string): Promise<{ acao: string; porId?: string }[]> => {
  const t = await tarefaCrua(c, id)
  return (t!['historico'] as { acao: string; porId?: string }[]).filter((e) =>
    (ACOES_DO_FLUXO as readonly string[]).includes(e.acao),
  )
}

beforeAll(async () => {
  c = await montarCenario('grupos-fluxo')

  // Uma pessoa SEM `pacientes`: prova que o nó com paciente exige o acesso de paciente.
  const codigoDaClinica = (
    await c.migrate.query<{ codigo: string }>('SELECT codigo FROM clinicas WHERE id = $1', [c.clinica])
  ).rows[0]!.codigo
  const perfil = (
    await c.migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, 'pf_semp', 'Sem pacientes', ARRAY['jornada']) RETURNING id`,
      [c.clinica],
    )
  ).rows[0]!.id
  davi = (
    await c.migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
       VALUES ($1, 'Davi', 'davi', $2, $3) RETURNING id`,
      [c.clinica, await hashDeSenha(SENHA_DAVI), perfil],
    )
  ).rows[0]!.id
  const entrada = await http()
    .post('/v1/entrar')
    .send({ clinica: codigoDaClinica, usuario: 'davi', senha: SENHA_DAVI })
    .expect(200)
  const v = entrada.headers['set-cookie'] as unknown
  cookieDavi = Array.isArray(v) ? (v as string[]) : [String(v)]
  c.cookies['davi'] = cookieDavi
  c.pessoas['davi'] = davi

  recepcao = (await criarGrupo('Recepção').expect(201)).body.id
  enfermagem = (await criarGrupo('Enfermagem').expect(201)).body.id
  await definirGrupos(c.pessoas['juliana']!, [recepcao]).expect(200)
  await definirGrupos(c.pessoas['camila']!, [recepcao]).expect(200)
  await definirGrupos(c.pessoas['nara']!, [enfermagem]).expect(200)

  // A sessão de suporte (D-13): o operador "assina como administradora".
  operadorId = (
    await c.migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono do Painel', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id
  const painel = pares(
    await http().post('/v1/superadmin/entrar').send({ usuario: USUARIO_OP, senha: SENHA_OP }).expect(200),
  )
  suporte = pares(
    await http()
      .post(`/v1/superadmin/clinicas/${c.clinica}/sessao-de-suporte`)
      .set('Cookie', painel)
      .expect(201),
  )
})

afterAll(async () => {
  await declararAtorSistema(c.migrate)
  await c.migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await c.migrate.query('DELETE FROM sessoes WHERE operador_id = $1', [operadorId])
  await desmontarCenario(c)
  const m = new pg.Client({ connectionString: URL_MIG })
  await m.connect()
  await declararAtorSistema(m)
  await apagarOperadorDeTeste(m, operadorId)
  await m.end()
})

beforeEach(async () => {
  await limparTarefas(c)
  reiniciarLimiteDeEscritaDoFluxo()
  gancho.depoisDeLerGrupos = null
})

/* ------------------------------------------------------------------ grupos */

describe('Grupos — cadastro e vínculo (config, nunca o próprio, nunca o suporte)', () => {
  it('criar grupo exige `config`: a recepção recebe 403', async () => {
    expect((await criarGrupo('Financeiro', 'juliana')).statusCode).toBe(403)
  })

  it('o nome é único por clínica SEM caixa nem acento', async () => {
    const r = await criarGrupo('recepcao')
    expect(r.statusCode).toBe(409)
    expect((await criarGrupo('RECEPÇÃO')).statusCode).toBe(409)
  })

  it('o nome tem de ter de 2 a 60 letras (o contrato manda)', async () => {
    expect((await criarGrupo('A')).statusCode).toBe(400)
    expect((await criarGrupo('x'.repeat(61))).statusCode).toBe(400)
  })

  it('o nome dos grupos ATIVOS é de todos; a composição é só de `config`', async () => {
    const aberta = await pegar(c, '/v1/grupos', {}, 'juliana').expect(200)
    expect(aberta.body.grupos.map((g: { nome: string }) => g.nome)).toEqual(['Enfermagem', 'Recepção'])
    // Nenhum campo de composição na lista aberta.
    expect(JSON.stringify(aberta.body)).not.toMatch(/membroIds|pessoaId/)
    expect((await pegar(c, '/v1/grupos/administracao', {}, 'juliana')).statusCode).toBe(403)

    const admin = await pegar(c, '/v1/grupos/administracao', {}, 'beatriz').expect(200)
    const rec = admin.body.grupos.find((g: { id: string }) => g.id === recepcao)
    expect([...rec.membroIds].sort()).toEqual(
      [c.pessoas['juliana']!, c.pessoas['camila']!].sort(),
    )
  })

  it('PUT do vínculo: `config`, nunca o próprio id, e é idempotente (a trilha não enche)', async () => {
    expect((await definirGrupos(c.pessoas['rita']!, [recepcao], 'juliana')).statusCode).toBe(403)
    // E4: ninguém se põe num grupo sozinho — nem quem tem `config`.
    expect((await definirGrupos(c.pessoas['beatriz']!, [recepcao], 'beatriz')).statusCode).toBe(400)

    await definirGrupos(c.pessoas['rita']!, [recepcao]).expect(200)
    const contar = async (): Promise<number> =>
      Number(
        (
          await c.migrate.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM auditoria WHERE clinica_id = $1 AND entidade = 'membros_de_grupo'`,
            [c.clinica],
          )
        ).rows[0]!.n,
      )
    const antes = await contar()
    for (let i = 0; i < 3; i++) await definirGrupos(c.pessoas['rita']!, [recepcao]).expect(200)
    expect(await contar()).toBe(antes)

    // Sair é estado (removido_em), nunca DELETE — e voltar reaproveita a linha.
    const saiu = await definirGrupos(c.pessoas['rita']!, []).expect(200)
    expect(saiu.body.grupoIds).toEqual([])
    const linhas = await c.migrate.query(
      'SELECT removido_em FROM membros_de_grupo WHERE clinica_id = $1 AND pessoa_id = $2',
      [c.clinica, c.pessoas['rita']],
    )
    expect(linhas.rows).toHaveLength(1)
    expect(linhas.rows[0].removido_em).not.toBeNull()
    await definirGrupos(c.pessoas['rita']!, [recepcao]).expect(200)
    await definirGrupos(c.pessoas['rita']!, []).expect(200)
  })

  it('grupo de OUTRA clínica e grupo repetido são 400', async () => {
    const dela = (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO grupos_da_equipe (clinica_id, nome) VALUES ($1, 'Da Vizinha') RETURNING id`,
        [c.outraClinica],
      )
    ).rows[0]!.id
    expect((await definirGrupos(c.pessoas['rita']!, [dela])).statusCode).toBe(400)
    expect((await definirGrupos(c.pessoas['rita']!, [recepcao, recepcao])).statusCode).toBe(400)
  })

  it('pessoa desativada não entra em grupo (400) e some da composição', async () => {
    expect((await definirGrupos(c.pessoas['marta']!, [recepcao])).statusCode).toBe(400)
  })

  it('a SESSÃO DE SUPORTE é recusada em toda escrita de grupo e de vínculo (E3)', async () => {
    const h = (r: request.Test) => r.set('Cookie', suporte)
    expect((await h(http().post('/v1/grupos').send({ nome: 'Do Suporte' }))).statusCode).toBe(403)
    expect((await h(http().patch(`/v1/grupos/${recepcao}`).send({ nome: 'Outro Nome' }))).statusCode).toBe(403)
    expect(
      (await h(http().put(`/v1/pessoas/${c.pessoas['rita']}/grupos`).send({ grupoIds: [recepcao] }))).statusCode,
    ).toBe(403)
    // ...e nada mudou.
    const nome = await c.migrate.query('SELECT nome FROM grupos_da_equipe WHERE id = $1', [recepcao])
    expect(nome.rows[0].nome).toBe('Recepção')
  })

  it('/v1/atividades mostra só os NOMES dos campos do vínculo — nunca de→para nem quem está no grupo', async () => {
    const r = await pegar(c, '/v1/atividades', {}, 'beatriz').expect(200)
    const doVinculo = r.body.itens.filter((i: { assunto: string }) => i.assunto === 'membros_de_grupo')
    expect(doVinculo.length).toBeGreaterThan(0)
    // Só as linhas do grupo e do vínculo: o resto da trilha tem as sessões de login
    // de todo mundo, e isso não é o que se está provando.
    const texto = JSON.stringify(
      r.body.itens.filter((i: { assunto: string }) =>
        ['membros_de_grupo', 'grupos_da_equipe'].includes(i.assunto),
      ),
    )
    expect(texto).not.toContain(c.pessoas['juliana'])
    expect(texto).not.toContain(c.pessoas['camila'])
    expect(texto).not.toContain(recepcao)
    expect(texto).not.toMatch(/"de"|"para"|Recepção|Enfermagem/)
    // Cada linha: só quem fez, quando, o quê e os NOMES dos campos.
    for (const i of doVinculo) {
      expect(Object.keys(i).sort()).toEqual(['acao', 'assunto', 'campos', 'chave', 'em', 'entidadeId', 'motivo', 'quem'])
    }
  })
})

describe('Desativar grupo — nunca excluir, com confirmação quando há tarefa aberta', () => {
  it('com tarefa aberta: 409 com a contagem; confirmado, desativa; a tarefa NÃO some', async () => {
    const g = (await criarGrupo('Temporário').expect(201)).body.id
    await definirGrupos(c.pessoas['rita']!, [g]).expect(200)
    const t = (await tarefaDeGrupo({ grupoId: g }).expect(201)).body.tarefa.id

    const sem = await remendar(c, `/v1/grupos/${g}`, { ativo: false }, 'beatriz')
    expect(sem.statusCode).toBe(409)
    expect(sem.body).toMatchObject({ codigo: 'GRUPO_COM_TAREFAS_ABERTAS', tarefasAbertas: 1 })
    // Só a contagem: nenhuma descrição de tarefa, nenhum nome de pessoa no 409.
    expect(JSON.stringify(sem.body)).not.toMatch(/laborat|Rita/)
    expect((await c.migrate.query('SELECT ativo FROM grupos_da_equipe WHERE id = $1', [g])).rows[0].ativo).toBe(true)

    await remendar(c, `/v1/grupos/${g}`, { ativo: false, confirmar: true }, 'beatriz').expect(200)

    // A tarefa continua: visível a `tarefas.equipe` e a quem a criou; o membro (rita) perde.
    expect((await pegar(c, `/v1/tarefas/${t}`, {}, 'beatriz')).statusCode).toBe(200)
    expect((await pegar(c, `/v1/tarefas/${t}`, {}, 'rita')).statusCode).toBe(403)
    // E o grupo desativado some da lista aberta, mas ninguém foi excluído.
    const aberta = await pegar(c, '/v1/grupos', {}, 'juliana').expect(200)
    expect(aberta.body.grupos.some((x: { id: string }) => x.id === g)).toBe(false)
    expect((await c.migrate.query('SELECT 1 FROM grupos_da_equipe WHERE id = $1', [g])).rowCount).toBe(1)

    // Quem a criou (solicitante) a transfere para o grupo ativo — a tarefa não fica presa.
    const criadaPorJuliana = (await tarefaDeGrupo({ grupoId: recepcao }, 'juliana').expect(201)).body.tarefa.id
    await c.migrate.query(`UPDATE tarefas SET grupo_id = $2 WHERE id = $1`, [criadaPorJuliana, g])
    const presa = await postar(
      c,
      `/v1/tarefas/${criadaPorJuliana}/transferir`,
      { para: { tipo: 'grupo', id: recepcao } },
      'juliana',
    )
    expect(presa.statusCode).toBe(200)

    // Reativar devolve o nome (e quem era do grupo).
    await remendar(c, `/v1/grupos/${g}`, { ativo: true }, 'beatriz').expect(200)
    expect((await pegar(c, `/v1/tarefas/${t}`, {}, 'rita')).statusCode).toBe(200)
  })

  it('desativar grupo SEM tarefa aberta não pede confirmação', async () => {
    const g = (await criarGrupo('Vazio Mesmo').expect(201)).body.id
    await remendar(c, `/v1/grupos/${g}`, { ativo: false }, 'beatriz').expect(200)
  })

  it('reativar um grupo cujo nome foi reusado é 409', async () => {
    const g = (await criarGrupo('Nome Reusado').expect(201)).body.id
    await remendar(c, `/v1/grupos/${g}`, { ativo: false }, 'beatriz').expect(200)
    await criarGrupo('Nome Reusado').expect(201)
    expect((await remendar(c, `/v1/grupos/${g}`, { ativo: true }, 'beatriz')).statusCode).toBe(409)
  })
})

/* ----------------------------------------------------------------- criação */

describe('Criar tarefa — pessoa OU grupo, exatamente um', () => {
  it('para um grupo: sem responsável, com destino e o evento `atribuir`', async () => {
    const r = await tarefaDeGrupo().expect(201)
    const t = r.body.tarefa
    expect(t.responsavelId).toBeNull()
    expect(t.responsavelNome).toBeNull()
    expect(t.grupoId).toBe(recepcao)
    expect(t.destino).toEqual({ tipo: 'grupo', id: recepcao, nome: 'Recepção' })
    expect(t.fluxo).toHaveLength(1)
    expect(t.fluxo[0]).toMatchObject({
      acao: 'atribuir',
      de: null,
      para: { tipo: 'grupo', id: recepcao },
      porId: c.pessoas['beatriz'],
    })
    // A tarefa de PESSOA continua sem evento nenhum.
    const p = await tarefaDePessoa('juliana')
    expect(await eventosDe(p)).toEqual([])
  })

  it('os dois, ou nenhum, é 400', async () => {
    expect((await tarefaDeGrupo({ responsavelId: c.pessoas['juliana'] })).statusCode).toBe(400)
    const nenhum = await postar(c, '/v1/tarefas', {
      vinculo: 'interna',
      descricao: 'Sem destino',
      quando: { modo: 'agendada', prazo: HOJE },
    })
    expect(nenhum.statusCode).toBe(400)
  })

  it('grupo desativado, grupo de outra clínica e lançamento retroativo são 400', async () => {
    const dela = (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO grupos_da_equipe (clinica_id, nome) VALUES ($1, 'Do Vizinho') RETURNING id`,
        [c.outraClinica],
      )
    ).rows[0]!.id
    expect((await tarefaDeGrupo({ grupoId: dela })).statusCode).toBe(400)
    expect((await tarefaDeGrupo({ quando: { modo: 'retroativo', em: HOJE } })).statusCode).toBe(400)
    const g = (await criarGrupo('Desligado').expect(201)).body.id
    await remendar(c, `/v1/grupos/${g}`, { ativo: false }, 'beatriz').expect(200)
    expect((await tarefaDeGrupo({ grupoId: g })).statusCode).toBe(400)
  })

  it('a SESSÃO DE SUPORTE não cria tarefa para um grupo (E3)', async () => {
    const r = await http()
      .post('/v1/tarefas')
      .set('Cookie', suporte)
      .send({
        vinculo: 'interna',
        grupoId: recepcao,
        descricao: 'Do suporte',
        quando: { modo: 'agendada', prazo: HOJE },
      })
    expect(r.statusCode).toBe(403)
  })

  it('`tarefaOrigemId`: mesma clínica, visível a quem cria, e do mesmo paciente ou sem paciente', async () => {
    const a = await tarefaDePessoa('beatriz')
    const filha = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'interna',
        responsavelId: c.pessoas['beatriz'],
        descricao: 'Segunda etapa',
        tarefaOrigemId: a,
        quando: { modo: 'agendada', prazo: HOJE },
      },
      'beatriz',
    ).expect(201)
    expect(filha.body.tarefa.tarefaOrigemId).toBe(a)

    // A origem que a pessoa NÃO enxerga é "não encontrada", como a da vizinha.
    const daJuliana = await tarefaDePessoa('juliana', {}, 'juliana')
    const invisivel = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'interna',
        responsavelId: c.pessoas['camila'],
        descricao: 'Tentando ligar',
        tarefaOrigemId: daJuliana,
        quando: { modo: 'agendada', prazo: HOJE },
      },
      'camila',
    )
    expect(invisivel.statusCode).toBe(400)
    const daVizinha = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'interna',
        responsavelId: c.pessoas['beatriz'],
        descricao: 'Elo para fora',
        tarefaOrigemId: c.tarefaDaOutra,
        quando: { modo: 'agendada', prazo: HOJE },
      },
      'beatriz',
    )
    expect(daVizinha.statusCode).toBe(400)

    // Origem de OUTRO paciente: a cadeia nunca atravessa de um para outro.
    const comoBeatriz = (corpo: Record<string, unknown>) =>
      postar(
        c,
        '/v1/tarefas',
        { responsavelId: c.pessoas['beatriz'], quando: { modo: 'agendada', prazo: HOJE }, ...corpo },
        'beatriz',
      )
    const deAna = (
      await comoBeatriz({ vinculo: 'paciente', pacienteId: c.pacientes['ana'], tipo: 'Follow-up' }).expect(201)
    ).body.tarefa.id
    const paraBruna = await comoBeatriz({
      vinculo: 'paciente',
      pacienteId: c.pacientes['bruna'],
      tipo: 'Follow-up',
      tarefaOrigemId: deAna,
    })
    expect(paraBruna.statusCode).toBe(400)
    // Interna (sem paciente) a partir de tarefa COM paciente também não.
    const internaDeAna = await comoBeatriz({ vinculo: 'interna', descricao: 'Interna', tarefaOrigemId: deAna })
    expect(internaDeAna.statusCode).toBe(400)
    // Sem paciente → com paciente: permitido ("sem paciente" é neutro).
    await comoBeatriz({
      vinculo: 'paciente',
      pacienteId: c.pacientes['bruna'],
      tipo: 'Follow-up',
      tarefaOrigemId: a,
    }).expect(201)
  })
})

/* -------------------------------------------------------- Hoje / consultas */

describe('"Para mim" inclui as tarefas dos MEUS grupos', () => {
  it('Tarefas, Hoje e a faixa da semana — membro vê; quem não é, não', async () => {
    const t = await idDaTarefaDeGrupo()
    const ids = (r: { body: { tarefas: { id: string }[] } }) => r.body.tarefas.map((x) => x.id)

    for (const quem of ['juliana', 'camila']) {
      const lista = await pegar(c, '/v1/tarefas', { escopo: 'meu' }, quem).expect(200)
      expect(ids(lista)).toContain(t)
      const hoje = await pegar(c, '/v1/hoje', { escopo: 'meu' }, quem).expect(200)
      expect(ids(hoje)).toContain(t)
      const dia = hoje.body.semana.find((d: { dia: string }) => d.dia === HOJE)
      expect(dia.abertas).toBe(1)
    }

    const nara = await pegar(c, '/v1/tarefas', { escopo: 'meu' }, 'nara').expect(200)
    expect(ids(nara)).not.toContain(t)
    const haraHoje = await pegar(c, '/v1/hoje', { escopo: 'meu' }, 'nara').expect(200)
    expect(ids(haraHoje)).not.toContain(t)
    expect(haraHoje.body.semana.find((d: { dia: string }) => d.dia === HOJE).abertas).toBe(0)
    // O aviso "N não aparecem aqui" CONTA a tarefa de grupo para quem NÃO é do grupo:
    // sem o `coalesce`, `NOT (NULL)` descartaria a linha em silêncio. Beatriz acompanha a
    // equipe (o aviso aponta para "Equipe toda") e não é membro de nada.
    const beatriz = await pegar(c, '/v1/hoje', { escopo: 'meu' }, 'beatriz').expect(200)
    expect(beatriz.body.ocultasPeloFiltro).toBe(1)
    expect(beatriz.body.escopoComAsOcultas).toBe('equipe')
  })

  it('o membro que sai do grupo deixa de ver na requisição seguinte', async () => {
    const t = await idDaTarefaDeGrupo()
    const ver = async () =>
      (await pegar(c, '/v1/tarefas', { escopo: 'meu' }, 'rita').expect(200)).body.tarefas.map(
        (x: { id: string }) => x.id,
      )
    expect(await ver()).not.toContain(t)
    await definirGrupos(c.pessoas['rita']!, [recepcao]).expect(200)
    expect(await ver()).toContain(t)
    await definirGrupos(c.pessoas['rita']!, []).expect(200)
    expect(await ver()).not.toContain(t)
  })

  it('pessoa DESATIVADA perde o grupo na hora (a consulta olha `pessoas.ativo`)', async () => {
    const { gruposDoAutor } = await import('./grupos-do-autor')
    const viva = await gruposDoAutor(
      c.migrate as unknown as pg.PoolClient,
      c.clinica as never,
      c.pessoas['camila']!,
    )
    expect(viva).toContain(recepcao)
    await c.migrate.query(`UPDATE pessoas SET ativo = false, desativada_em = now() WHERE id = $1`, [
      c.pessoas['camila'],
    ])
    try {
      expect(
        await gruposDoAutor(c.migrate as unknown as pg.PoolClient, c.clinica as never, c.pessoas['camila']!),
      ).toEqual([])
    } finally {
      await c.migrate.query(`UPDATE pessoas SET ativo = true, desativada_em = NULL WHERE id = $1`, [
        c.pessoas['camila'],
      ])
    }
  })
})

/* ------------------------------------------------------------- concluir */

describe('Concluir tarefa de grupo — só membro (ou `tarefas.equipe`), e registra QUEM', () => {
  it('quem não é do grupo recebe 403 e a tarefa continua aberta', async () => {
    const t = await idDaTarefaDeGrupo()
    const r = await postar(c, `/v1/tarefas/${t}/concluir`, { em: HOJE }, 'nara')
    expect(r.statusCode).toBe(403)
    // Nem quem pediu a tarefa (o solicitante não é o grupo).
    expect((await postar(c, `/v1/tarefas/${t}/concluir`, { em: HOJE }, 'rita')).statusCode).toBe(403)
    expect((await tarefaCrua(c, t))!['status']).toBe('aberta')
  })

  it('o membro conclui, e o evento guarda a PESSOA (porId), não o grupo', async () => {
    const t = await idDaTarefaDeGrupo()
    const r = await postar(c, `/v1/tarefas/${t}/concluir`, { em: HOJE }, 'camila').expect(200)
    expect(r.body.tarefa.status).toBe('concluida')
    const ev = (await eventosDe(t)).at(-1)!
    expect(ev).toMatchObject({ acao: 'concluirPeloGrupo', porId: c.pessoas['camila'] })
  })

  it('`tarefas.equipe` conclui mesmo sem ser do grupo', async () => {
    const t = await idDaTarefaDeGrupo()
    await postar(c, `/v1/tarefas/${t}/concluir`, { em: HOJE }, 'beatriz').expect(200)
  })

  /** Consulta de PACIENTE para `juliana`, pedida por ela mesma. */
  const consultaDaJuliana = async (): Promise<string> =>
    (
      await postar(
        c,
        '/v1/tarefas',
        {
          vinculo: 'paciente',
          pacienteId: c.pacientes['ana'],
          tipo: 'Consulta agendada',
          responsavelId: c.pessoas['juliana'],
          quando: { modo: 'agendada', prazo: HOJE },
        },
        'juliana',
      ).expect(201)
    ).body.tarefa.id as string

  it('F7 — tarefa INTERNA de outra pessoa: quem não a enxerga recebe 403 e ela continua aberta', async () => {
    // `nara` não pediu, não é responsável e não tem `tarefas.equipe`.
    const t = await tarefaDePessoa('juliana')
    const r = await postar(c, `/v1/tarefas/${t}/concluir`, { em: HOJE }, 'nara')
    expect(r.statusCode).toBe(403)
    expect(r.body.tarefa).toBeUndefined() // nada da tarefa atravessa
    // A mesma resposta da leitura da tarefa.
    expect((await pegar(c, `/v1/tarefas/${t}`, {}, 'nara')).statusCode).toBe(403)
    const crua = await tarefaCrua(c, t)
    expect(crua!['status']).toBe('aberta')
    expect(crua!['concluida_em']).toBeNull()
  })

  it('F7 — tarefa de PACIENTE: sem `pacientes`, 403, sem nome nem telefone, e continua aberta', async () => {
    const t = await consultaDaJuliana()
    const r = await postar(c, `/v1/tarefas/${t}/concluir`, { em: HOJE }, 'davi')
    expect(r.statusCode).toBe(403)
    expect(JSON.stringify(r.body)).not.toMatch(/pacienteNome|pacienteTelefone/)
    expect((await tarefaCrua(c, t))!['status']).toBe('aberta')
  })

  it('F7 — o 403 vem ANTES do estado: tarefa já concluída não revela que está concluída', async () => {
    const t = await tarefaDePessoa('juliana')
    await postar(c, `/v1/tarefas/${t}/concluir`, { em: HOJE }, 'juliana').expect(200)
    expect((await postar(c, `/v1/tarefas/${t}/concluir`, { em: HOJE }, 'nara')).statusCode).toBe(403)
  })

  it('tarefa de PESSOA concluída por outra (`tarefas.equipe`): `executar` guarda QUEM fez, não o responsável (pedido 3)', async () => {
    // Pedida e executada por `juliana`; `beatriz` acompanha a equipe e conclui.
    const t = await tarefaDePessoa('juliana', {}, 'juliana')
    await postar(c, `/v1/tarefas/${t}/concluir`, { em: HOJE }, 'beatriz').expect(200)
    const ev = (await eventosDe(t)).at(-1)!
    expect(ev).toMatchObject({
      acao: 'executar',
      porId: c.pessoas['beatriz'],
      de: { tipo: 'pessoa', id: c.pessoas['juliana'] },
    })
  })

  it('consulta de PACIENTE da colega: quem tem `pacientes` conclui, e `executar` guarda QUEM fez (pedido 3)', async () => {
    // `nara` enxerga a paciente (a ficha lista todas as tarefas dela), como no
    // protótipo, onde tarefa com paciente é visível a todos.
    const t = await consultaDaJuliana()
    await postar(c, `/v1/tarefas/${t}/concluir`, { em: HOJE }, 'nara').expect(200)
    const ev = (await eventosDe(t)).at(-1)!
    expect(ev).toMatchObject({
      acao: 'executar',
      porId: c.pessoas['nara'],
      de: { tipo: 'pessoa', id: c.pessoas['juliana'] },
    })
  })

  it('o solicitante conclui a tarefa que pediu para outra pessoa', async () => {
    const t = await tarefaDePessoa('juliana', {}, 'camila')
    await postar(c, `/v1/tarefas/${t}/concluir`, { em: HOJE }, 'camila').expect(200)
  })

  it('editar o responsável de tarefa de grupo é 400 (muda por Assumir/Transferir)', async () => {
    const t = await idDaTarefaDeGrupo()
    const r = await remendar(c, `/v1/tarefas/${t}`, { responsavelId: c.pessoas['nara'] }, 'beatriz')
    expect(r.statusCode).toBe(400)
    expect((await tarefaCrua(c, t))!['responsavel_id']).toBeNull()
  })
})

/* -------------------------------------------------------------- assumir */

describe('Assumir', () => {
  it('o membro fixa a tarefa em si: responsável = ele, grupo = nulo, evento `assumir`', async () => {
    const t = await idDaTarefaDeGrupo()
    const r = await postar(c, `/v1/tarefas/${t}/assumir`, {}, 'camila').expect(200)
    expect(r.body.tarefa.responsavelId).toBe(c.pessoas['camila'])
    expect(r.body.tarefa.grupoId).toBeNull()
    expect(r.body.tarefa.destino.tipo).toBe('pessoa')
    expect((await eventosDe(t)).map((e) => e.acao)).toEqual(['atribuir', 'assumir'])
    // A tarefa agora conta em "Para mim" só dela.
    const ids = async (quem: string) =>
      (await pegar(c, '/v1/tarefas', { escopo: 'meu' }, quem).expect(200)).body.tarefas.map(
        (x: { id: string }) => x.id,
      )
    expect(await ids('camila')).toContain(t)
    expect(await ids('juliana')).not.toContain(t)
  })

  it('quem não é do grupo é 403; tarefa de pessoa e tarefa fechada são 409', async () => {
    const t = await idDaTarefaDeGrupo()
    expect((await postar(c, `/v1/tarefas/${t}/assumir`, {}, 'nara')).statusCode).toBe(403)
    expect((await postar(c, `/v1/tarefas/${await tarefaDePessoa('juliana')}/assumir`, {}, 'juliana')).statusCode).toBe(409)
    await postar(c, `/v1/tarefas/${t}/concluir`, { em: HOJE }, 'camila').expect(200)
    expect((await postar(c, `/v1/tarefas/${t}/assumir`, {}, 'juliana')).statusCode).toBe(409)
  })

  it('assumir DE NOVO (quem perdeu) é 409 e NÃO acrescenta evento', async () => {
    const t = await idDaTarefaDeGrupo()
    await postar(c, `/v1/tarefas/${t}/assumir`, {}, 'camila').expect(200)
    expect((await postar(c, `/v1/tarefas/${t}/assumir`, {}, 'juliana')).statusCode).toBe(409)
    expect((await postar(c, `/v1/tarefas/${t}/assumir`, {}, 'camila')).statusCode).toBe(409)
    expect((await eventosDe(t)).filter((e) => e.acao === 'assumir')).toHaveLength(1)
  })

  it('DUAS CONEXÕES ao mesmo tempo: exatamente uma vence, uma perde com 409, um evento só', async () => {
    for (let i = 0; i < 6; i++) {
      const t = await idDaTarefaDeGrupo({ descricao: `Corrida ${i}` })
      const [a, b] = await Promise.all([
        postar(c, `/v1/tarefas/${t}/assumir`, {}, 'camila'),
        postar(c, `/v1/tarefas/${t}/assumir`, {}, 'juliana'),
      ])
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
      const venceu = a.statusCode === 200 ? 'camila' : 'juliana'
      const crua = await tarefaCrua(c, t)
      expect(crua!['responsavel_id']).toBe(c.pessoas[venceu])
      const g = await c.migrate.query('SELECT grupo_id FROM tarefas WHERE id = $1', [t])
      expect(g.rows[0].grupo_id).toBeNull()
      const assumiu = (await eventosDe(t)).filter((e) => e.acao === 'assumir')
      expect(assumiu).toHaveLength(1)
      expect(assumiu[0]!.porId).toBe(c.pessoas[venceu])
    }
  })

  it('a SESSÃO DE SUPORTE é recusada em assumir e em transferir (E3)', async () => {
    const t = await idDaTarefaDeGrupo()
    expect((await http().post(`/v1/tarefas/${t}/assumir`).set('Cookie', suporte).send({})).statusCode).toBe(403)
    expect(
      (
        await http()
          .post(`/v1/tarefas/${t}/transferir`)
          .set('Cookie', suporte)
          .send({ para: { tipo: 'pessoa', id: c.pessoas['camila'] } })
      ).statusCode,
    ).toBe(403)
    expect(await eventosDe(t)).toHaveLength(1) // só o `atribuir` de quando nasceu
  })

  it('tarefa da OUTRA clínica é 404, nunca 403 (não confirma que existe)', async () => {
    expect((await postar(c, `/v1/tarefas/${c.tarefaDaOutra}/assumir`, {}, 'camila')).statusCode).toBe(404)
    expect(
      (await postar(c, `/v1/tarefas/${c.tarefaDaOutra}/transferir`, { para: { tipo: 'pessoa', id: c.pessoas['camila'] } }, 'beatriz')).statusCode,
    ).toBe(404)
  })
})

/* ------------------------------------------------------------ transferir */

describe('Transferir', () => {
  const transferir = (id: string, para: unknown, quem: string, nota?: string) =>
    postar(c, `/v1/tarefas/${id}/transferir`, { para, ...(nota === undefined ? {} : { nota }) } as never, quem)

  it('de um grupo para uma pessoa, e de uma pessoa para outro grupo, com o evento {de, para, porId}', async () => {
    const t = await idDaTarefaDeGrupo()
    const r = await transferir(t, { tipo: 'pessoa', id: c.pessoas['nara'] }, 'camila', 'ela cuida disso').expect(200)
    expect(r.body.tarefa.responsavelId).toBe(c.pessoas['nara'])
    expect(r.body.tarefa.grupoId).toBeNull()
    const ev = (await eventosDe(t)).at(-1) as Record<string, unknown>
    expect(ev).toMatchObject({
      acao: 'transferir',
      porId: c.pessoas['camila'],
      de: { tipo: 'grupo', id: recepcao },
      para: { tipo: 'pessoa', id: c.pessoas['nara'] },
      nota: 'ela cuida disso',
    })

    // A responsável atual a devolve para um grupo.
    const volta = await transferir(t, { tipo: 'grupo', id: enfermagem }, 'nara').expect(200)
    expect(volta.body.tarefa.responsavelId).toBeNull()
    expect(volta.body.tarefa.grupoId).toBe(enfermagem)
    expect((await eventosDe(t)).map((e) => e.acao)).toEqual(['atribuir', 'transferir', 'transferir'])
  })

  it('para o MESMO destino é no-op: 200, sem evento, sem escrita', async () => {
    const t = await idDaTarefaDeGrupo()
    for (let i = 0; i < 3; i++) {
      await transferir(t, { tipo: 'grupo', id: recepcao }, 'camila').expect(200)
    }
    expect(await eventosDe(t)).toHaveLength(1)
    const p = await tarefaDePessoa('juliana')
    for (let i = 0; i < 3; i++) {
      await transferir(p, { tipo: 'pessoa', id: c.pessoas['juliana'] }, 'juliana').expect(200)
    }
    expect(await eventosDe(p)).toEqual([])
  })

  it('quem pode: o responsável, o membro do grupo atual ou `tarefas.equipe` — mais ninguém', async () => {
    const dela = await tarefaDePessoa('juliana')
    expect((await transferir(dela, { tipo: 'pessoa', id: c.pessoas['camila'] }, 'rita')).statusCode).toBe(403)
    // Nem quem a CRIOU, se é de pessoa (o spec diz quem pode).
    expect((await transferir(dela, { tipo: 'pessoa', id: c.pessoas['camila'] }, 'beatriz')).statusCode).toBe(200) // equipe
    const g = await idDaTarefaDeGrupo()
    expect((await transferir(g, { tipo: 'pessoa', id: c.pessoas['rita'] }, 'nara')).statusCode).toBe(403)
    expect((await transferir(g, { tipo: 'pessoa', id: c.pessoas['rita'] }, 'juliana')).statusCode).toBe(200)
  })

  it('só tarefa ABERTA; destino ativo e da clínica; nota de até 200', async () => {
    const t = await idDaTarefaDeGrupo()
    expect((await transferir(t, { tipo: 'pessoa', id: c.pessoas['marta'] }, 'camila')).statusCode).toBe(400)
    const dela = (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO grupos_da_equipe (clinica_id, nome) VALUES ($1, 'Do Vizinho 2') RETURNING id`,
        [c.outraClinica],
      )
    ).rows[0]!.id
    expect((await transferir(t, { tipo: 'grupo', id: dela }, 'camila')).statusCode).toBe(400)
    expect(
      (await transferir(t, { tipo: 'pessoa', id: c.pessoas['nara'] }, 'camila', 'x'.repeat(201))).statusCode,
    ).toBe(400)
    // Os dois ao mesmo tempo, ou lixo: o contrato recusa.
    expect(
      (await postar(c, `/v1/tarefas/${t}/transferir`, { para: { tipo: 'pessoa', id: c.pessoas['nara'], extra: 1 } }, 'camila')).statusCode,
    ).toBe(400)
    await postar(c, `/v1/tarefas/${t}/concluir`, { em: HOJE }, 'camila').expect(200)
    expect((await transferir(t, { tipo: 'pessoa', id: c.pessoas['nara'] }, 'camila')).statusCode).toBe(409)
  })

  it('duas transferências simultâneas: os eventos NÃO se perdem (append atômico)', async () => {
    const t = await tarefaDePessoa('juliana')
    // A segunda espera o `FOR UPDATE` da primeira e decide contra o que ela deixou.
    const [a, b] = await Promise.all([
      transferir(t, { tipo: 'pessoa', id: c.pessoas['camila'] }, 'juliana'),
      transferir(t, { tipo: 'pessoa', id: c.pessoas['nara'] }, 'beatriz'),
    ])
    expect([a.statusCode, b.statusCode]).toEqual([200, 200])
    const evs = (await eventosDe(t)).filter((e) => e.acao === 'transferir')
    expect(evs).toHaveLength(2)
    const crua = await tarefaCrua(c, t)
    // O dono final é o PARA do último evento — nunca um estado que nenhum evento explica.
    const ultimo = (await c.migrate.query('SELECT historico FROM tarefas WHERE id = $1', [t])).rows[0].historico.at(-1)
    expect(crua!['responsavel_id']).toBe(ultimo.para.id)
  })

  it('o histórico tem TETO: cheio, é 409 e nada é gravado', async () => {
    const t = await idDaTarefaDeGrupo()
    await c.migrate.query(
      `UPDATE tarefas SET historico = (SELECT jsonb_agg(jsonb_build_object('acao','atribuir','em',now(),'porId',$2::text,'de',NULL,'para',jsonb_build_object('tipo','grupo','id',$3::text)))
                                         FROM generate_series(1, 500)) WHERE id = $1`,
      [t, c.pessoas['beatriz'], recepcao],
    )
    expect((await transferir(t, { tipo: 'pessoa', id: c.pessoas['nara'] }, 'camila')).statusCode).toBe(409)
    expect((await postar(c, `/v1/tarefas/${t}/assumir`, {}, 'camila')).statusCode).toBe(409)
    const n = await c.migrate.query('SELECT jsonb_array_length(historico) AS n FROM tarefas WHERE id = $1', [t])
    expect(n.rows[0].n).toBe(500)
  })

  it('o histórico da jornada convive com o do fluxo: tarefa de paciente transferida segue a mesma tarefa', async () => {
    const r = await postar(c, '/v1/tarefas', {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['juliana'],
      quando: { modo: 'agendada', prazo: HOJE },
    }).expect(201)
    const id = r.body.tarefa.id
    const t = await transferir(id, { tipo: 'pessoa', id: c.pessoas['camila'] }, 'juliana').expect(200)
    // O evento do fluxo NÃO aparece como evento da jornada, e a etapa não muda.
    expect(t.body.tarefa.etapa).toBe('agendado')
    expect(t.body.tarefa.historico.map((e: { acao: string }) => e.acao)).toEqual(['agendar'])
    expect(t.body.tarefa.fluxo.map((e: { acao: string }) => e.acao)).toEqual(['transferir'])
    // E o fluxo da jornada ainda anda (concluir move para realizado).
    const c2 = await postar(c, `/v1/tarefas/${id}/concluir`, { em: HOJE }, 'camila').expect(200)
    expect(c2.body.tarefa.etapa).toBe('realizado')
  })
})

/* ---------------------------------------------------------------- fluxo */

describe('GET /v1/tarefas/:id/fluxo', () => {
  /** Encadeia por SQL: a rota recusa elos que a API não criaria (ciclo, profundidade). */
  const ligar = (filha: string, origem: string | null) =>
    c.migrate.query('UPDATE tarefas SET tarefa_origem_id = $2 WHERE id = $1', [filha, origem])

  it('devolve a cadeia do mais antigo ao mais novo, com os eventos', async () => {
    const a = await tarefaDePessoa('beatriz')
    const b = (
      await postar(
        c,
        '/v1/tarefas',
        {
          vinculo: 'interna',
          grupoId: recepcao,
          descricao: 'B',
          tarefaOrigemId: a,
          quando: { modo: 'agendada', prazo: HOJE },
        },
        'beatriz',
      ).expect(201)
    ).body.tarefa.id
    const cc = (
      await postar(
        c,
        '/v1/tarefas',
        {
          vinculo: 'interna',
          responsavelId: c.pessoas['beatriz'],
          descricao: 'C',
          tarefaOrigemId: b,
          quando: { modo: 'agendada', prazo: HOJE },
        },
        'beatriz',
      ).expect(201)
    ).body.tarefa.id

    for (const pedida of [a, b, cc]) {
      const r = await pegar(c, `/v1/tarefas/${pedida}/fluxo`, {}, 'beatriz').expect(200)
      expect(r.body.nos.map((n: { id: string }) => n.id)).toEqual([a, b, cc])
      expect(r.body.nos.map((n: { posicao: number }) => n.posicao)).toEqual([0, 1, 2])
      expect(r.body.truncado).toBe(false)
    }
    const r = await pegar(c, `/v1/tarefas/${b}/fluxo`, {}, 'beatriz').expect(200)
    expect(r.body.nos[1].eventos[0]).toMatchObject({ acao: 'atribuir' })
    // Só ids nos eventos: nenhum NOME de pessoa atravessa pela cadeia.
    expect(JSON.stringify(r.body.nos.map((n: { eventos: unknown }) => n.eventos))).not.toMatch(/Beatriz|Camila/)
  })

  it('cada nó passa pelo filtro de visibilidade: o que não se vê é um marcador OPACO', async () => {
    const a = await tarefaDePessoa('beatriz', { descricao: 'Segredo do A' }) // só beatriz (e a equipe) vê
    const b = await tarefaDePessoa('juliana', { descricao: 'B da Juliana' }, 'juliana')
    await ligar(b, a)
    const r = await pegar(c, `/v1/tarefas/${b}/fluxo`, {}, 'juliana').expect(200)
    expect(r.body.nos).toHaveLength(2)
    const oculto = r.body.nos[0]
    expect(oculto).toEqual({ visivel: false, id: a, posicao: 0 })
    expect(JSON.stringify(r.body)).not.toContain('Segredo do A')
    expect(r.body.nos[1]).toMatchObject({ visivel: true, id: b, descricao: 'B da Juliana' })
    // `tarefas.equipe` vê a cadeia inteira.
    const eq = await pegar(c, `/v1/tarefas/${b}/fluxo`, {}, 'beatriz').expect(200)
    expect(eq.body.nos.every((n: { visivel: boolean }) => n.visivel)).toBe(true)
    // A tarefa PEDIDA que a pessoa não enxerga é 403, como em GET tarefas/:id.
    expect((await pegar(c, `/v1/tarefas/${a}/fluxo`, {}, 'juliana')).statusCode).toBe(403)
  })

  it('nó com paciente exige o acesso de paciente — até para `tarefas.equipe`', async () => {
    // Origem interna (sem paciente) → filha COM paciente: é o elo que a regra permite.
    const a = await tarefaDePessoa('davi')
    const b = (
      await postar(
        c,
        '/v1/tarefas',
        {
          vinculo: 'paciente',
          pacienteId: c.pacientes['ana'],
          tipo: 'Follow-up',
          responsavelId: c.pessoas['davi'],
          tarefaOrigemId: a,
          quando: { modo: 'agendada', prazo: HOJE },
        },
        'beatriz',
      ).expect(201)
    ).body.tarefa.id
    // Davi vê A (dele) mas NÃO o paciente de B: o nó sai opaco.
    const r = await pegar(c, `/v1/tarefas/${a}/fluxo`, {}, 'davi').expect(200)
    expect(r.body.nos[1]).toEqual({ visivel: false, id: b, posicao: 1 })
    expect(JSON.stringify(r.body)).not.toContain(c.pacientes['ana'])
    // E se a tarefa PEDIDA é a do paciente, é 403.
    expect((await pegar(c, `/v1/tarefas/${b}/fluxo`, {}, 'davi')).statusCode).toBe(403)
    // Com `pacientes` (beatriz) o nó aparece.
    const ok = await pegar(c, `/v1/tarefas/${a}/fluxo`, {}, 'beatriz').expect(200)
    expect(ok.body.nos[1]).toMatchObject({ visivel: true, id: b, pacienteId: c.pacientes['ana'] })
  })

  it('CICLO (A→B→A, por SQL) não gira: devolve cada nó uma vez e marca `truncado`', async () => {
    const a = await tarefaDePessoa('beatriz')
    const b = await tarefaDePessoa('beatriz')
    await ligar(b, a)
    await ligar(a, b)
    const r = await pegar(c, `/v1/tarefas/${a}/fluxo`, {}, 'beatriz').expect(200)
    const ids = r.body.nos.map((n: { id: string }) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual([a, b].sort())
    expect(r.body.truncado).toBe(true)
  })

  it('PROFUNDIDADE: uma cadeia de 30 sai cortada em 20 e marcada como `truncado`', async () => {
    const ids: string[] = []
    for (let i = 0; i < 30; i++) ids.push(await tarefaDePessoa('beatriz', { descricao: `n${i}` }))
    for (let i = 1; i < ids.length; i++) await ligar(ids[i]!, ids[i - 1]!)
    const r = await pegar(c, `/v1/tarefas/${ids[29]}/fluxo`, {}, 'beatriz').expect(200)
    expect(r.body.nos.length).toBeLessThanOrEqual(20)
    expect(r.body.truncado).toBe(true)
  })

  it('o elo para si mesma é recusado pelo banco; tarefa da outra clínica é 404', async () => {
    const a = await tarefaDePessoa('beatriz')
    await expect(ligar(a, a)).rejects.toThrow(/tarefa_origem_nao_e_ela_mesma/)
    expect((await pegar(c, `/v1/tarefas/${c.tarefaDaOutra}/fluxo`, {}, 'beatriz')).statusCode).toBe(404)
  })

  it('o acesso fica na trilha (regra 18): a rota é @DadoSensivel("pacientes")', async () => {
    const a = await tarefaDePessoa('beatriz')
    await pegar(c, `/v1/tarefas/${a}/fluxo`, {}, 'beatriz').expect(200)
    const n = await c.migrate.query(
      `SELECT count(*)::int AS n FROM auditoria WHERE clinica_id = $1 AND acao = 'acessou' AND entidade = 'pacientes' AND entidade_id = $2`,
      [c.clinica, a],
    )
    expect(n.rows[0].n).toBe(1)
  })
})

/* ------------------------------------------------------- banco: S1 / RLS */

describe('Banco — FKs compostas, CHECKs e RLS (S1, S4)', () => {
  const sql = (texto: string, params: unknown[] = []) => c.migrate.query(texto, params)

  it('id de OUTRA clínica falha POR CONSTRAINT, não só some na leitura', async () => {
    const deleVizinha = (
      await sql(`INSERT INTO grupos_da_equipe (clinica_id, nome) VALUES ($1, 'Constraint') RETURNING id`, [c.outraClinica])
    ).rows[0].id
    // tarefa daqui → grupo de lá
    await expect(
      sql(
        `INSERT INTO tarefas (clinica_id, solicitante_id, grupo_id, descricao, prazo) VALUES ($1, $2, $3, 'x', $4)`,
        [c.clinica, c.pessoas['beatriz'], deleVizinha, HOJE],
      ),
    ).rejects.toThrow(/tarefa_e_do_grupo_da_clinica/)
    // tarefa daqui → origem de lá
    await expect(
      sql(
        `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tarefa_origem_id) VALUES ($1, $2, $2, 'x', $3, $4)`,
        [c.clinica, c.pessoas['beatriz'], HOJE, c.tarefaDaOutra],
      ),
    ).rejects.toThrow(/tarefa_vem_de_tarefa_da_clinica/)
    // tarefa daqui → responsável de lá
    const pessoaDeLa = (await sql('SELECT id FROM pessoas WHERE clinica_id = $1 LIMIT 1', [c.outraClinica])).rows[0].id
    await expect(
      sql(
        `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo) VALUES ($1, $2, $3, 'x', $4)`,
        [c.clinica, c.pessoas['beatriz'], pessoaDeLa, HOJE],
      ),
    ).rejects.toThrow(/tarefa_responsavel_e_da_clinica/)
    // membro: grupo de lá com pessoa daqui, e pessoa de lá com grupo daqui
    await expect(
      sql(`INSERT INTO membros_de_grupo (clinica_id, grupo_id, pessoa_id) VALUES ($1, $2, $3)`, [c.clinica, deleVizinha, c.pessoas['rita']]),
    ).rejects.toThrow(/membro_e_do_grupo_da_clinica/)
    await expect(
      sql(`INSERT INTO membros_de_grupo (clinica_id, grupo_id, pessoa_id) VALUES ($1, $2, $3)`, [c.clinica, recepcao, pessoaDeLa]),
    ).rejects.toThrow(/membro_e_pessoa_da_clinica/)
  })

  it('destino exclusivo: os dois, ou nenhum, é recusado pelo CHECK `tarefa_tem_destino`', async () => {
    await expect(
      sql(
        `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, grupo_id, descricao, prazo) VALUES ($1, $2, $2, $3, 'x', $4)`,
        [c.clinica, c.pessoas['beatriz'], recepcao, HOJE],
      ),
    ).rejects.toThrow(/tarefa_tem_destino/)
    await expect(
      sql(`INSERT INTO tarefas (clinica_id, solicitante_id, descricao, prazo) VALUES ($1, $2, 'x', $3)`, [c.clinica, c.pessoas['beatriz'], HOJE]),
    ).rejects.toThrow(/tarefa_tem_destino/)
  })

  it('`fir_app` fixado numa clínica não vê o grupo da outra, e não apaga grupo nem vínculo', async () => {
    const app = new pg.Client({ connectionString: URL_APP })
    await app.connect()
    try {
      await app.query('BEGIN')
      await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', c.clinica])
      await app.query('SELECT set_config($1, $2, true)', ['app.pessoa_id', 'sistema'])
      const vizinho = await app.query('SELECT id FROM grupos_da_equipe WHERE clinica_id = $1', [c.outraClinica])
      expect(vizinho.rows).toEqual([])
      const meus = await app.query('SELECT id FROM grupos_da_equipe WHERE id = $1', [recepcao])
      expect(meus.rowCount).toBe(1)
      // O WITH CHECK recusa escrever na vizinha.
      await expect(
        app.query(`INSERT INTO grupos_da_equipe (clinica_id, nome) VALUES ($1, 'Invasor')`, [c.outraClinica]),
      ).rejects.toThrow(/row-level security|política|policy/i)
      await app.query('ROLLBACK')

      // Sem DELETE (regra 20): o privilégio nem existe.
      for (const tabela of ['grupos_da_equipe', 'membros_de_grupo']) {
        await app.query('BEGIN')
        await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', c.clinica])
        await expect(app.query(`DELETE FROM ${tabela} WHERE clinica_id = $1`, [c.clinica])).rejects.toThrow(/permission denied|permissão negada/i)
        await app.query('ROLLBACK')
      }
    } finally {
      await app.end()
    }
  })

  it('as duas tabelas têm RLS ligada e FORÇADA, e trilha de auditoria', async () => {
    const r = await sql(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1)`,
      [['grupos_da_equipe', 'membros_de_grupo']],
    )
    expect(r.rows).toHaveLength(2)
    for (const x of r.rows) expect([x.relname, x.relrowsecurity, x.relforcerowsecurity]).toEqual([x.relname, true, true])
    const trilha = await sql(
      `SELECT count(*)::int AS n FROM auditoria WHERE clinica_id = $1 AND entidade = 'grupos_da_equipe' AND acao = 'criou'`,
      [c.clinica],
    )
    expect(trilha.rows[0].n).toBeGreaterThanOrEqual(2)
  })
})

/* ------------------------------------------------------------------ logs */

describe('Logs (E6, L3): nota, nome de grupo e descrição nunca saem em log nem em erro', () => {
  it('assumir, transferir, desativar e o fluxo não deixam texto livre em nenhum log', async () => {
    const linhas: string[] = []
    for (const metodo of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, metodo).mockImplementation((...args: unknown[]) => {
        linhas.push(args.map((a) => String(a)).join(' '))
      })
    }
    // O `Logger` do Nest e o do Fastify escrevem direto no stdout/stderr, não em
    // `console.*`: a varredura precisa dos dois.
    for (const fluxo of [process.stdout, process.stderr]) {
      vi.spyOn(fluxo, 'write').mockImplementation(((texto: unknown) => {
        linhas.push(String(texto))
        return true
      }) as never)
    }
    try {
      const g = (await criarGrupo('GrupoSigiloso').expect(201)).body.id
      const t = (
        await tarefaDeGrupo({ grupoId: g, descricao: 'DescricaoSigilosa paciente Fulano' }).expect(201)
      ).body.tarefa.id
      await definirGrupos(c.pessoas['rita']!, [g]).expect(200)
      await postar(c, `/v1/tarefas/${t}/transferir`, { para: { tipo: 'pessoa', id: c.pessoas['rita'] }, nota: 'NotaSigilosa Fulano de Tal' }, 'rita').expect(200)
      // Caminhos de erro: onde o corpo costuma vazar.
      await postar(c, `/v1/tarefas/${t}/transferir`, { para: { tipo: 'pessoa', id: c.pessoas['marta'] }, nota: 'NotaSigilosa Fulano de Tal' }, 'rita')
      await postar(c, `/v1/tarefas/${t}/transferir`, { para: { tipo: 'pessoa', id: c.pessoas['nara'] }, nota: 'x'.repeat(250) }, 'rita')
      await postar(c, `/v1/tarefas/${t}/assumir`, { nota: 'NotaSigilosa Fulano de Tal' }, 'nara')
      await remendar(c, `/v1/grupos/${g}`, { ativo: false }, 'beatriz')
      await pegar(c, `/v1/tarefas/${t}/fluxo`, {}, 'beatriz')
    } finally {
      vi.restoreAllMocks()
    }
    const tudo = linhas.join('\n')
    expect(tudo).not.toMatch(/NotaSigilosa|Fulano|DescricaoSigilosa|GrupoSigiloso/)
  })

  it('a mensagem de erro de nota longa não ecoa o texto', async () => {
    const t = await idDaTarefaDeGrupo()
    const r = await postar(c, `/v1/tarefas/${t}/transferir`, { para: { tipo: 'pessoa', id: c.pessoas['nara'] }, nota: `Fulano${'x'.repeat(250)}` }, 'camila')
    expect(r.statusCode).toBe(400)
    expect(JSON.stringify(r.body)).not.toContain('Fulano')
  })
})

/* ------------------------------------------------- revisão independente */

describe('B1 — a cadeia nunca cruza de um paciente para outro', () => {
  const comoBeatriz = (corpo: Record<string, unknown>) =>
    postar(
      c,
      '/v1/tarefas',
      { responsavelId: c.pessoas['beatriz'], quando: { modo: 'agendada', prazo: HOJE }, ...corpo },
      'beatriz',
    )
  const paciente = (nome: string) => ({
    vinculo: 'paciente',
    pacienteId: c.pacientes[nome],
    tipo: 'Follow-up',
  })

  it('PATCH de pacienteId em tarefa COM ORIGEM de outro paciente é 400; do mesmo é 200', async () => {
    const origem = (await comoBeatriz(paciente('ana')).expect(201)).body.tarefa.id
    const filha = (await comoBeatriz({ ...paciente('ana'), tarefaOrigemId: origem }).expect(201)).body.tarefa.id
    const r = await remendar(c, `/v1/tarefas/${filha}`, { pacienteId: c.pacientes['bruna'] }, 'beatriz')
    expect(r.statusCode).toBe(400)
    expect((await tarefaCrua(c, filha))!['paciente_id']).toBe(c.pacientes['ana'])
    // Reenviar o mesmo paciente é "não mexi".
    await remendar(c, `/v1/tarefas/${filha}`, { pacienteId: c.pacientes['ana'] }, 'beatriz').expect(200)
    // Tirar o paciente de uma filha de origem COM paciente também quebraria a regra.
    expect((await remendar(c, `/v1/tarefas/${filha}`, { pacienteId: null }, 'beatriz')).statusCode).toBe(400)
  })

  it('PATCH de pacienteId em tarefa COM FILHAS de outro paciente é 400; origem sem paciente deixa trocar', async () => {
    const origem = (await comoBeatriz(paciente('ana')).expect(201)).body.tarefa.id
    await comoBeatriz({ ...paciente('ana'), tarefaOrigemId: origem }).expect(201)
    expect(
      (await remendar(c, `/v1/tarefas/${origem}`, { pacienteId: c.pacientes['bruna'] }, 'beatriz')).statusCode,
    ).toBe(400)
    expect((await tarefaCrua(c, origem))!['paciente_id']).toBe(c.pacientes['ana'])

    // Origem interna (sem paciente): ganha um paciente se as filhas forem desse paciente.
    const interna = await tarefaDePessoa('beatriz')
    await comoBeatriz({ ...paciente('ana'), tarefaOrigemId: interna }).expect(201)
    await remendar(
      c,
      `/v1/tarefas/${interna}`,
      { pacienteId: c.pacientes['ana'], tipo: 'Follow-up' },
      'beatriz',
    ).expect(200)
    // ...e agora que tem Ana, trocar para Bruna é recusado pela filha de Ana.
    expect(
      (await remendar(c, `/v1/tarefas/${interna}`, { pacienteId: c.pacientes['bruna'] }, 'beatriz')).statusCode,
    ).toBe(400)
  })

  it('o TRIGGER recusa por SQL, direto, as duas direções (23514)', async () => {
    const sql = (q: string, p: unknown[] = []) => c.migrate.query(q, p)
    const nova = async (pacienteId: string | null, origem: string | null): Promise<string> =>
      (
        await sql(
          `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, paciente_id, tipo, tarefa_origem_id)
           VALUES ($1, $2, $2, 'x', $3, $4, $5, $6) RETURNING id`,
          [c.clinica, c.pessoas['beatriz'], HOJE, pacienteId, pacienteId === null ? '' : 'Follow-up', origem],
        )
      ).rows[0].id
    const origemAna = await nova(c.pacientes['ana']!, null)
    // INSERT: filha de outro paciente, e filha sem paciente de origem com paciente.
    await expect(nova(c.pacientes['bruna']!, origemAna)).rejects.toMatchObject({
      code: '23514',
      constraint: 'tarefa_origem_do_mesmo_paciente',
    })
    await expect(nova(null, origemAna)).rejects.toThrow(/tarefa_origem_do_mesmo_paciente/)
    // O mesmo paciente passa; origem sem paciente aceita qualquer um.
    const filha = await nova(c.pacientes['ana']!, origemAna)
    const semPaciente = await nova(null, null)
    await nova(c.pacientes['bruna']!, semPaciente)
    // UPDATE do paciente da filha, e UPDATE do paciente de quem TEM filha.
    await expect(
      sql('UPDATE tarefas SET paciente_id = $2 WHERE id = $1', [filha, c.pacientes['bruna']]),
    ).rejects.toThrow(/tarefa_origem_do_mesmo_paciente/)
    await expect(
      sql('UPDATE tarefas SET paciente_id = $2 WHERE id = $1', [origemAna, c.pacientes['bruna']]),
    ).rejects.toThrow(/tarefa_origem_do_mesmo_paciente/)
    // Religar a origem a uma tarefa de outro paciente também.
    const deBruna = await nova(c.pacientes['bruna']!, null)
    await expect(
      sql('UPDATE tarefas SET tarefa_origem_id = $2 WHERE id = $1', [filha, deBruna]),
    ).rejects.toThrow(/tarefa_origem_do_mesmo_paciente/)
  })

  it('DEFESA NA LEITURA: nó de outro paciente (dado que passou por fora) sai opaco, sem vazar', async () => {
    const sql = (q: string, p: unknown[] = []) => c.migrate.query(q, p)
    const raiz = (await comoBeatriz(paciente('ana')).expect(201)).body.tarefa.id
    const filha = await tarefaDePessoa('beatriz', { descricao: 'Interna da cadeia' })
    // Constrói a cadeia divergente com o trigger desligado (só o dono da tabela pode).
    await sql('ALTER TABLE tarefas DISABLE TRIGGER tarefa_origem_do_mesmo_paciente')
    try {
      await sql(
        `UPDATE tarefas SET tarefa_origem_id = $2, paciente_id = $3, tipo = 'Follow-up', descricao = 'Segredo de Bruna' WHERE id = $1`,
        [filha, raiz, c.pacientes['bruna']],
      )
      const r = await pegar(c, `/v1/tarefas/${raiz}/fluxo`, {}, 'beatriz').expect(200)
      const no = r.body.nos.find((n: { id: string }) => n.id === filha)
      expect(no).toMatchObject({ visivel: false })
      expect(Object.keys(no).sort()).toEqual(['id', 'posicao', 'visivel'])
      expect(JSON.stringify(r.body)).not.toMatch(/Segredo de Bruna/)
      expect(JSON.stringify(r.body)).not.toContain(c.pacientes['bruna'])
    } finally {
      await sql('ALTER TABLE tarefas ENABLE TRIGGER tarefa_origem_do_mesmo_paciente')
    }
  })
})

describe('Fluxo — ressalvas da revisão', () => {
  it('C2: mais de 200 nós — a tarefa PEDIDA nunca fica de fora e o resultado sai marcado como truncado', async () => {
    const raiz = await tarefaDePessoa('beatriz', { descricao: 'Raiz com muitas filhas' })
    await c.migrate.query(
      `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tarefa_origem_id)
       SELECT $1, $2, $2, 'filha ' || g, $3, $4 FROM generate_series(1, 230) g`,
      [c.clinica, c.pessoas['beatriz'], HOJE, raiz],
    )
    const r = await pegar(c, `/v1/tarefas/${raiz}/fluxo`, {}, 'beatriz').expect(200)
    expect(r.body.nos.length).toBeLessThanOrEqual(200)
    expect(r.body.nos.some((n: { id: string }) => n.id === raiz)).toBe(true)
    expect(r.body.truncado).toBe(true)
    // Pedindo por uma das filhas, a raiz (distância 1) também entra.
    const filha = (
      await c.migrate.query('SELECT id FROM tarefas WHERE tarefa_origem_id = $1 LIMIT 1', [raiz])
    ).rows[0].id
    const doFilho = await pegar(c, `/v1/tarefas/${filha}/fluxo`, {}, 'beatriz').expect(200)
    expect(doFilho.body.nos.map((n: { id: string }) => n.id)).toEqual(expect.arrayContaining([raiz, filha]))
  })

  it('origem excluída marca o corte; nó de paciente DESATIVADO (tarefa aberta) vira opaco', async () => {
    const a = await tarefaDePessoa('beatriz', { descricao: 'Origem apagada' })
    const b = (
      await postar(
        c,
        '/v1/tarefas',
        {
          vinculo: 'interna',
          responsavelId: c.pessoas['beatriz'],
          descricao: 'B',
          tarefaOrigemId: a,
          quando: { modo: 'agendada', prazo: HOJE },
        },
        'beatriz',
      ).expect(201)
    ).body.tarefa.id
    await c.migrate.query('UPDATE tarefas SET excluida_em = now() WHERE id = $1', [a])
    const r = await pegar(c, `/v1/tarefas/${b}/fluxo`, {}, 'beatriz').expect(200)
    expect(r.body.nos.map((n: { id: string }) => n.id)).toEqual([b])
    expect(r.body.truncado).toBe(true)

    const nova = (extra: Record<string, unknown>) =>
      postar(
        c,
        '/v1/tarefas',
        {
          vinculo: 'paciente',
          pacienteId: c.pacientes['bruna'],
          tipo: 'Follow-up',
          responsavelId: c.pessoas['beatriz'],
          quando: { modo: 'agendada', prazo: HOJE },
          ...extra,
        },
        'beatriz',
      ).expect(201)
    const origem = (await nova({})).body.tarefa.id
    const filha = (await nova({ tarefaOrigemId: origem })).body.tarefa.id
    await c.migrate.query('UPDATE pacientes SET ativo = false, desativado_em = now() WHERE id = $1', [
      c.pacientes['bruna'],
    ])
    try {
      const d = await pegar(c, `/v1/tarefas/${origem}/fluxo`, {}, 'beatriz').expect(200)
      expect(d.body.nos.find((n: { id: string }) => n.id === filha)).toEqual({
        visivel: false,
        id: filha,
        posicao: expect.any(Number),
      })
    } finally {
      await c.migrate.query('UPDATE pacientes SET ativo = true, desativado_em = NULL WHERE id = $1', [
        c.pacientes['bruna'],
      ])
    }
  })
})

describe('C3 — transferir repete a autorização no UPDATE (TOCTOU)', () => {
  it('membro removido ENTRE a leitura e o UPDATE perde (409), sem evento e sem mudar o dono', async () => {
    const t = await idDaTarefaDeGrupo()
    gancho.depoisDeLerGrupos = async () => {
      await c.migrate.query(
        'UPDATE membros_de_grupo SET removido_em = now() WHERE clinica_id = $1 AND pessoa_id = $2 AND grupo_id = $3',
        [c.clinica, c.pessoas['camila'], recepcao],
      )
    }
    try {
      const r = await postar(
        c,
        `/v1/tarefas/${t}/transferir`,
        { para: { tipo: 'pessoa', id: c.pessoas['nara'] } },
        'camila',
      )
      expect(r.statusCode).toBe(409)
      expect(await eventosDe(t)).toHaveLength(1)
      const linha = (
        await c.migrate.query('SELECT grupo_id, responsavel_id FROM tarefas WHERE id = $1', [t])
      ).rows[0]
      expect(linha).toEqual({ grupo_id: recepcao, responsavel_id: null })
    } finally {
      await definirGrupos(c.pessoas['camila']!, [recepcao]).expect(200)
    }
  })

  it('quem NÃO é membro mas tem tarefas.equipe continua transferindo (a regra repetida é a do domínio)', async () => {
    const t = await idDaTarefaDeGrupo()
    await postar(
      c,
      `/v1/tarefas/${t}/transferir`,
      { para: { tipo: 'pessoa', id: c.pessoas['nara'] } },
      'beatriz',
    ).expect(200)
  })
})

describe('C5 — responsável nulo não confunde o painel', () => {
  it('cumprimento de prazos: a tarefa de grupo NÃO assumida entra no total e não vira "pessoa"', async () => {
    await tarefaDeGrupo().expect(201)
    await tarefaDePessoa('juliana')
    const banco = c.app.get(BancoService)
    const r = await banco.naClinica(c.clinica as never, SISTEMA, (cli) =>
      consultarPrazos(cli, c.clinica, { de: HOJE, ate: HOJE }, HOJE, 'America/Bahia'),
    )
    expect(r.total.total).toBe(2)
    expect(r.porPessoa.map((p) => p.pessoaId)).toEqual([c.pessoas['juliana']])
    expect(r.porPessoa[0]!.total).toBe(1)
  })
})

describe('E5 — freio nas escritas do fluxo e dos grupos', () => {
  it('a 61a escrita em um minuto é 429, a cota é uma só por pessoa e a de outra pessoa não é afetada', async () => {
    const t = await tarefaDePessoa('beatriz')
    const para = { para: { tipo: 'pessoa', id: c.pessoas['beatriz'] } } // no-op: barato e idempotente
    for (let i = 0; i < 60; i++) {
      expect((await postar(c, `/v1/tarefas/${t}/transferir`, para, 'beatriz')).statusCode).toBe(200)
    }
    const estourou = await postar(c, `/v1/tarefas/${t}/transferir`, para, 'beatriz')
    expect(estourou.statusCode).toBe(429)
    expect(estourou.body.retryAfter).toBeGreaterThan(0)
    // Outra rota protegida, mesma pessoa: a cota é UMA só.
    expect((await criarGrupo('Qualquer Coisa')).statusCode).toBe(429)
    // Outra pessoa: cota dela (o assumir recusa por outro motivo, nunca 429).
    expect((await postar(c, `/v1/tarefas/${t}/assumir`, {}, 'camila')).statusCode).not.toBe(429)
    // Leituras não contam.
    expect((await pegar(c, '/v1/grupos', {}, 'beatriz')).statusCode).toBe(200)
  })
})

describe('Ressalvas — grupo e conclusão', () => {
  it('desativar grupo JÁ inativo não reescreve desativado_em', async () => {
    const g = (await criarGrupo('Duas Vezes').expect(201)).body.id
    await remendar(c, `/v1/grupos/${g}`, { ativo: false }, 'beatriz').expect(200)
    const ler = async (): Promise<Date> =>
      (await c.migrate.query('SELECT desativado_em FROM grupos_da_equipe WHERE id = $1', [g])).rows[0]
        .desativado_em
    const antes = await ler()
    await new Promise((r) => setTimeout(r, 20))
    await remendar(c, `/v1/grupos/${g}`, { ativo: false }, 'beatriz').expect(200)
    expect((await ler()).getTime()).toBe(antes.getTime())
  })

  it('concluir tarefa de grupo respeita o teto de 500 eventos (409, nada gravado)', async () => {
    const t = await idDaTarefaDeGrupo()
    await c.migrate.query(
      `UPDATE tarefas SET historico = (SELECT jsonb_agg(jsonb_build_object('acao','atribuir','em',now(),'porId',$2::text,'de',NULL,'para',jsonb_build_object('tipo','grupo','id',$3::text)))
                                         FROM generate_series(1, 500)) WHERE id = $1`,
      [t, c.pessoas['beatriz'], recepcao],
    )
    expect((await postar(c, `/v1/tarefas/${t}/concluir`, { em: HOJE }, 'camila')).statusCode).toBe(409)
    expect((await tarefaCrua(c, t))!['status']).toBe('aberta')
  })
})
