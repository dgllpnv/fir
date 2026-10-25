import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  FUSO,
  HOJE,
  montarCenario,
  pegar,
} from '../tarefas/__tests__/cenario'

let c: Cenario

beforeAll(async () => {
  c = await montarCenario('clinica')
})
afterAll(async () => {
  await desmontarCenario(c)
})

describe('GET /v1/clinica', () => {
  it('devolve a clínica aberta e o fuso dela', async () => {
    const r = await pegar(c, '/v1/clinica').expect(200)
    expect(r.body.nome).toBe('Clínica Tarefas')
    expect(r.body.fuso).toBe(FUSO)
  })

  /**
   * O relógio do cenário é 25/10 às 02:00 UTC, que em America/Bahia ainda é
   * 23:00 de 24/10. Com `new Date()` no navegador — ou com UTC no servidor —
   * esta rota diria 25/10, e "Nova tarefa" abriria no dia seguinte enquanto a
   * clínica ainda está no expediente de hoje. É a regra 24 inteira num campo.
   */
  it('`hoje` é o dia civil NO FUSO DA CLÍNICA, não em UTC', async () => {
    const r = await pegar(c, '/v1/clinica').expect(200)
    expect(r.body.hoje).toBe(HOJE)
  })

  it('não devolve nada além de id, código, nome, fuso e hoje', async () => {
    const r = await pegar(c, '/v1/clinica').expect(200)
    expect(Object.keys(r.body as Record<string, unknown>).sort()).toEqual([
      'codigo',
      'fuso',
      'hoje',
      'id',
      'nome',
    ])
  })

  it('sem cookie é 401 — a clínica aberta não é pública', async () => {
    await pegar(c, '/v1/clinica', {}, 'ninguem').expect(401)
  })
})

describe('GET /v1/equipe', () => {
  it('lista a equipe da clínica, com as ativas primeiro', async () => {
    const r = await pegar(c, '/v1/equipe').expect(200)
    const nomes = (r.body.equipe as { nome: string }[]).map((p) => p.nome)
    expect(nomes).toContain('Juliana')
    expect(nomes).toContain('Beatriz')
    // Marta saiu da clínica: continua na lista (ela nomeia tarefas antigas)
    // mas por último, e marcada.
    expect(nomes.at(-1)).toBe('Marta')
    const marta = (r.body.equipe as { nome: string; ativo: boolean }[]).find(
      (p) => p.nome === 'Marta',
    )
    expect(marta!.ativo).toBe(false)
  })

  it('NÃO devolve e-mail, hash de senha nem perfil', async () => {
    // A lista existe para escolher o responsável de uma tarefa. Tudo além do
    // nome é da tela de Usuários, que tem permissão própria.
    const r = await pegar(c, '/v1/equipe').expect(200)
    const chaves = Object.keys(r.body.equipe[0] as Record<string, unknown>).sort()
    expect(chaves).toEqual(['ativo', 'funcao', 'id', 'nome'])
  })

  it('a equipe de outra clínica não aparece', async () => {
    const r = await pegar(c, '/v1/equipe').expect(200)
    expect((r.body.equipe as { nome: string }[]).map((p) => p.nome)).not.toContain('Vizinha')
  })

  it('sem cookie é 401 — a lista de quem trabalha aqui não é pública', async () => {
    const r = await pegar(c, '/v1/equipe', {}, 'ninguem').expect(401)
    expect(r.statusCode).toBe(401)
  })
})

describe('GET /v1/unidades', () => {
  it('lista as unidades da clínica', async () => {
    const r = await pegar(c, '/v1/unidades').expect(200)
    const nomes = (r.body.unidades as { nome: string }[]).map((u) => u.nome).sort()
    expect(nomes).toEqual(['Unidade Centro', 'Unidade Pituba'])
  })

  it('a unidade de outra clínica não aparece', async () => {
    await c.migrate.query(`INSERT INTO unidades (clinica_id, nome) VALUES ($1, 'Unidade Vizinha')`, [
      c.outraClinica,
    ])
    const r = await pegar(c, '/v1/unidades').expect(200)
    expect((r.body.unidades as { nome: string }[]).map((u) => u.nome)).not.toContain(
      'Unidade Vizinha',
    )
  })
})
