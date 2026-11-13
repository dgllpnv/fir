import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarOperadorDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import {
  type Cenario,
  desmontarCenario,
  montarCenario,
  pegar,
  postar,
  remendar,
} from '../tarefas/__tests__/cenario'

/**
 * REATIVAR paciente (ADR 2026-11-13) — Postgres real, HTTP de verdade.
 *
 * Personas do cenário: `beatriz` tem `pacientes.gerir`; `juliana` tem só
 * `pacientes`.
 */
let c: Cenario
let n = 0

beforeAll(async () => {
  c = await montarCenario('reativar')
})
afterAll(async () => {
  await desmontarCenario(c)
})

/** Um paciente DESATIVADO, direto no banco, com nome único por teste. */
async function desativado(nome = `Paciente Reativavel ${++n}`): Promise<string> {
  const r = await c.migrate.query<{ id: string }>(
    'INSERT INTO pacientes (clinica_id, nome) VALUES ($1, $2) RETURNING id',
    [c.clinica, nome],
  )
  const id = r.rows[0]!.id
  await c.migrate.query('UPDATE pacientes SET ativo = false, desativado_em = now() WHERE id = $1', [
    id,
  ])
  return id
}

const reativar = (id: string, quem = 'beatriz') =>
  postar(c, `/v1/pacientes/${id}/reativar`, {}, quem)

const estado = async (id: string) =>
  (
    await c.migrate.query<{ ativo: boolean; desativado_em: Date | null }>(
      'SELECT ativo, desativado_em FROM pacientes WHERE id = $1',
      [id],
    )
  ).rows[0]!

describe('POST /v1/pacientes/:id/reativar', () => {
  it('reativa: volta às listas e limpa desativado_em', async () => {
    const id = await desativado('Volta Para A Lista')
    const r = await reativar(id).expect(201)
    expect(r.body.id).toBe(id)
    expect(r.body.ativo).toBe(true)
    expect(await estado(id)).toEqual({ ativo: true, desativado_em: null })
    const l = await pegar(c, '/v1/pacientes', { q: 'Volta Para A Lista' }, 'beatriz').expect(200)
    expect(l.body.pacientes.map((p: { nome: string }) => p.nome)).toContain('Volta Para A Lista')
  })

  it('sem `pacientes.gerir`, 403 — e o cadastro segue desativado', async () => {
    const id = await desativado()
    await reativar(id, 'juliana').expect(403)
    expect((await estado(id)).ativo).toBe(false)
  })

  it('reativar duas vezes: a segunda é 409 claro', async () => {
    const id = await desativado()
    await reativar(id).expect(201)
    const r = await reativar(id).expect(409)
    expect(r.body.message).toMatch(/já está ativo/i)
  })

  it('paciente de outra clínica e id inexistente: 404', async () => {
    await c.migrate.query(
      'UPDATE pacientes SET ativo = false, desativado_em = now() WHERE id = $1',
      [c.pacienteDaOutra],
    )
    await reativar(c.pacienteDaOutra).expect(404)
    expect((await estado(c.pacienteDaOutra)).ativo).toBe(false)
    await reativar('00000000-0000-4000-8000-000000000000').expect(404)
  })

  it('colisão de nome com paciente ATIVO: 409 e nada muda', async () => {
    const id = await desativado('Nome Disputado')
    await c.migrate.query("INSERT INTO pacientes (clinica_id, nome) VALUES ($1, 'Nome Disputado')", [
      c.clinica,
    ])
    const r = await reativar(id).expect(409)
    expect(r.body.message).toMatch(/Já existe um paciente ativo com este nome/)
    expect((await estado(id)).ativo).toBe(false)
  })

  it('tarefas, LTV e saldo ficam iguais antes e depois', async () => {
    const id = await desativado('Receita Intocada')
    const tarefa = (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO tarefas
           (clinica_id, solicitante_id, responsavel_id, descricao, prazo, paciente_id, tipo, status, concluida_em)
         VALUES ($1, $2, $2, 'Consulta', '2026-10-20', $3, 'Consulta realizada', 'concluida', now())
         RETURNING id`,
        [c.clinica, c.pessoas['juliana'], id],
      )
    ).rows[0]!.id
    await c.migrate.query(
      `INSERT INTO recebimentos
         (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
       VALUES ($1, $2, $3, 'Pagamento de consulta', 45000, 'Pix', 15000, now(), $4)`,
      [c.clinica, id, tarefa, c.pessoas['juliana']],
    )
    const medir = async () => ({
      tarefas: (
        await c.migrate.query(
          'SELECT id FROM tarefas WHERE paciente_id = $1 AND excluida_em IS NULL',
          [id],
        )
      ).rowCount,
      rec: (
        await c.migrate.query<{ s: string }>(
          'SELECT coalesce(sum(valor),0)::text AS s FROM recebimentos WHERE paciente_id = $1',
          [id],
        )
      ).rows[0]!.s,
      ficha: (await pegar(c, `/v1/pacientes/${id}`, {}, 'beatriz').expect(200)).body,
    })
    const antes = await medir()
    await reativar(id).expect(201)
    const depois = await medir()
    expect(depois.tarefas).toBe(antes.tarefas)
    expect(depois.rec).toBe(antes.rec)
    expect(depois.ficha.tarefas).toHaveLength(1)
    const l = await pegar(c, '/v1/pacientes', { q: 'Receita Intocada' }, 'beatriz').expect(200)
    expect(l.body.pacientes[0].ltv).toBe('45000')
    expect(l.body.pacientes[0].saldo).toBe('15000')
  })

  it('entra na trilha com de/para de `ativo` e o autor', async () => {
    const id = await desativado()
    await reativar(id).expect(201)
    const t = await c.migrate.query<{
      de: { ativo: boolean }
      para: { ativo: boolean }
      ator_id: string
      ator_tipo: string
    }>(
      `SELECT de, para, ator_id, ator_tipo FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pacientes' AND entidade_id = $2 AND acao = 'alterou'
        ORDER BY id DESC LIMIT 1`,
      [c.clinica, id],
    )
    expect(t.rows[0]!.de.ativo).toBe(false)
    expect(t.rows[0]!.para.ativo).toBe(true)
    expect(t.rows[0]!.ator_id).toBe(c.pessoas['beatriz'])
    expect(t.rows[0]!.ator_tipo).toBe('pessoa')
  })
})

describe('PATCH de paciente desativado', () => {
  it('409 "Reative para editar", não o 404 enganoso — e nada é gravado', async () => {
    const id = await desativado('Nao Edita Desativado')
    const r = await remendar(c, `/v1/pacientes/${id}`, { obs: 'tentativa' }, 'beatriz').expect(409)
    expect(r.body.message).toBe('Este cadastro está desativado. Reative para editar.')
    const o = await c.migrate.query<{ obs: string }>('SELECT obs FROM pacientes WHERE id = $1', [id])
    expect(o.rows[0]!.obs).not.toBe('tentativa')
  })

  it('id de outra clínica continua 404', async () => {
    await remendar(c, `/v1/pacientes/${c.pacienteDaOutra}`, { obs: 'x' }, 'beatriz').expect(404)
  })
})

describe('reativar pela sessão de suporte (operador)', () => {
  const SENHA_OP = 'senha-do-operador-reativar'
  let operador = ''
  let suporte = ''

  beforeAll(async () => {
    const usuario = `op.reativar.${Date.now()}`
    operador = (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Operador', $2) RETURNING id`,
        [usuario, await hashDeSenha(SENHA_OP)],
      )
    ).rows[0]!.id
    const http = () => request(c.app.getHttpServer())
    const pares = (r: { headers: Record<string, unknown> }): string => {
      const v = r.headers['set-cookie']
      const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
      return lista.map((x) => x.split(';')[0]!).join('; ')
    }
    const painel = pares(
      await http().post('/v1/superadmin/entrar').send({ usuario, senha: SENHA_OP }).expect(200),
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
    await c.migrate.query('DELETE FROM tentativas_de_operador WHERE identificador LIKE $1', [
      'op.reativar.%',
    ])
    await c.migrate.query('DELETE FROM sessoes WHERE operador_id = $1', [operador])
    if (operador !== '') await apagarOperadorDeTeste(c.migrate, operador)
  })

  it('quando o suporte reativa, a trilha diz OPERADOR, nunca uma pessoa da clínica', async () => {
    const id = await desativado()
    const r = await request(c.app.getHttpServer())
      .post(`/v1/pacientes/${id}/reativar`)
      .set('Cookie', suporte)
      .send({ motivo: 'Chamado 5001: reativar a pedido da gestora' })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    if (r.statusCode === 201) {
      const t = await c.migrate.query<{ ator_tipo: string; ator_id: string; motivo: string | null }>(
        `SELECT ator_tipo, ator_id, motivo FROM auditoria
          WHERE entidade = 'pacientes' AND entidade_id = $1 AND acao = 'alterou'
          ORDER BY id DESC LIMIT 1`,
        [id],
      )
      expect(t.rows[0]!.ator_tipo).toBe('operador')
      expect(t.rows[0]!.ator_id).toBe(operador)
      expect(t.rows[0]!.motivo).toBe('Chamado 5001: reativar a pedido da gestora')
    } else {
      expect((await estado(id)).ativo).toBe(false)
    }
  })
})

/* -------------------------------------------------- desativar com motivo (LGPD) */

const desativarComRazao = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  request(c.app.getHttpServer())
    .delete(`/v1/pacientes/${id}`)
    .set('Cookie', c.cookies[quem]!)
    .send(corpo)

async function ativo(nome = `Paciente Motivo ${++n}`): Promise<string> {
  return (
    await c.migrate.query<{ id: string }>(
      'INSERT INTO pacientes (clinica_id, nome) VALUES ($1, $2) RETURNING id',
      [c.clinica, nome],
    )
  ).rows[0]!.id
}

const razaoGravada = async (id: string) =>
  (
    await c.migrate.query<{ m: string | null; d: string | null }>(
      'SELECT motivo_desativacao AS m, detalhe_desativacao AS d FROM pacientes WHERE id = $1',
      [id],
    )
  ).rows[0]!

describe('DELETE /v1/pacientes/:id com motivo estruturado', () => {
  it('sem razão, 400 claro — e o paciente continua ativo', async () => {
    const id = await ativo()
    const r = await desativarComRazao(id, {}).expect(400)
    expect(r.body.message).toMatch(/motivo da desativação/i)
    expect((await estado(id)).ativo).toBe(true)
  })

  it('razão fora da enumeração, 400', async () => {
    const id = await ativo()
    await desativarComRazao(id, { razao: 'porque-sim' }).expect(400)
    expect((await estado(id)).ativo).toBe(true)
  })

  it('detalhe com mais de 200 caracteres, 400', async () => {
    const id = await ativo()
    await desativarComRazao(id, { razao: 'outro', detalhe: 'x'.repeat(201) }).expect(400)
    expect((await estado(id)).ativo).toBe(true)
  })

  it('grava razão e detalhe, e a trilha leva o motivo e o de/para', async () => {
    const id = await ativo()
    await desativarComRazao(id, { razao: 'pediu-para-sair', detalhe: 'ligou na recepção' }).expect(200)
    expect(await razaoGravada(id)).toEqual({ m: 'pediu-para-sair', d: 'ligou na recepção' })
    const t = await c.migrate.query<{ motivo: string | null; para: { motivo_desativacao: string } }>(
      `SELECT motivo, para FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pacientes' AND entidade_id = $2 AND acao = 'alterou'
        ORDER BY id DESC LIMIT 1`,
      [c.clinica, id],
    )
    expect(t.rows[0]!.motivo).toBe('pediu-para-sair: ligou na recepção')
    expect(t.rows[0]!.para.motivo_desativacao).toBe('pediu-para-sair')
  })

  it('perfil sem `pacientes.gerir`, 403 — e nada muda', async () => {
    const id = await ativo()
    await desativarComRazao(id, { razao: 'duplicado' }, 'juliana').expect(403)
    expect((await estado(id)).ativo).toBe(true)
  })

  it('paciente de outra clínica, 404', async () => {
    await desativarComRazao(c.pacienteDaOutra, { razao: 'duplicado' }).expect(404)
  })
})

describe('reativar depois de "pediu-para-sair"', () => {
  const reativarCom = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
    postar(c, `/v1/pacientes/${id}/reativar`, corpo, quem)

  async function quemPediuParaSair(): Promise<string> {
    const id = await ativo()
    await desativarComRazao(id, { razao: 'pediu-para-sair' }).expect(200)
    return id
  }

  it('sem confirmação, 409 claro — continua desativado', async () => {
    const id = await quemPediuParaSair()
    const r = await reativarCom(id, {}).expect(409)
    expect(r.body.message).toMatch(/titular pediu para não ser contatado/i)
    expect((await estado(id)).ativo).toBe(false)
  })

  it('confirmação sem motivo, 400', async () => {
    const id = await quemPediuParaSair()
    await reativarCom(id, { confirmoQueOTitularPediu: true }).expect(400)
    expect((await estado(id)).ativo).toBe(false)
  })

  it('motivo curto demais, 400', async () => {
    const id = await quemPediuParaSair()
    await reativarCom(id, { confirmoQueOTitularPediu: true, motivo: 'curto' }).expect(400)
    expect((await estado(id)).ativo).toBe(false)
  })

  it('confirmação false não vale', async () => {
    const id = await quemPediuParaSair()
    await reativarCom(id, { confirmoQueOTitularPediu: false, motivo: 'Titular pediu para voltar' }).expect(409)
    expect((await estado(id)).ativo).toBe(false)
  })

  it('com confirmação e motivo: reativa, limpa a razão e o motivo vai à trilha', async () => {
    const id = await quemPediuParaSair()
    const motivo = 'Titular ligou e pediu para voltar'
    await reativarCom(id, { confirmoQueOTitularPediu: true, motivo }).expect(201)
    expect(await estado(id)).toEqual({ ativo: true, desativado_em: null })
    expect(await razaoGravada(id)).toEqual({ m: null, d: null })
    const t = await c.migrate.query<{ motivo: string | null }>(
      `SELECT motivo FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pacientes' AND entidade_id = $2 AND acao = 'alterou'
        ORDER BY id DESC LIMIT 1`,
      [c.clinica, id],
    )
    expect(t.rows[0]!.motivo).toBe(motivo)
  })

  it.each(['duplicado', 'erro-de-cadastro', 'outro'])('razão "%s": reativar segue simples', async (razao) => {
    const id = await ativo()
    await desativarComRazao(id, { razao }).expect(200)
    await reativarCom(id, {}).expect(201)
    expect((await estado(id)).ativo).toBe(true)
  })

  it('perfil sem permissão: 403 mesmo com a confirmação', async () => {
    const id = await quemPediuParaSair()
    await reativarCom(id, { confirmoQueOTitularPediu: true, motivo: 'Titular pediu para voltar' }, 'juliana').expect(403)
    expect((await estado(id)).ativo).toBe(false)
  })

  it('a ficha mostra a razão a quem gerencia, e a esconde de quem não gerencia', async () => {
    const id = await ativo()
    await desativarComRazao(id, { razao: 'pediu-para-sair', detalhe: 'por telefone' }).expect(200)
    const g = await pegar(c, `/v1/pacientes/${id}`, {}, 'beatriz').expect(200)
    expect(g.body.desativacao).toMatchObject({ razao: 'pediu-para-sair', detalhe: 'por telefone' })
    const s = await pegar(c, `/v1/pacientes/${id}`, {}, 'juliana').expect(200)
    expect(s.body.desativacao).toBeNull()
  })
})
