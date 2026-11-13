import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * GET /v1/atividades — o log da equipe, visto pela PRÓPRIA clínica.
 *
 * O que não pode quebrar: só quem administra (`config`) lê; a clínica vem da
 * sessão (a vizinha nunca aparece); e só metadado sai — nunca o `de`/`para`.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('atividades-da-clinica')
})
afterAll(async () => {
  await desmontarCenario(c)
})

type Item = {
  chave: string
  em: string
  quem: { tipo: string; id: string | null; nome: string | null }
  acao: string
  assunto: string
  campos: string[]
}

describe('GET /v1/atividades', () => {
  it('quem não administra recebe 403; sem sessão, 401', async () => {
    const sem = await pegar(c, '/v1/atividades', {}, 'juliana')
    expect(sem.statusCode).toBe(403)
    const anon = await pegar(c, '/v1/atividades', {}, 'ninguem')
    expect(anon.statusCode).toBe(401)
  })

  it('o administrador vê o que a equipe fez, com quem e o quê', async () => {
    // Uma escrita da recepção, que a trilha registra.
    const r = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'paciente',
        pacienteId: c.pacientes['ana'],
        tipo: 'Consulta agendada',
        responsavelId: c.pessoas['juliana'],
        quando: { modo: 'retroativo', em: HOJE },
      },
      'juliana',
    )
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)

    const l = await pegar(c, '/v1/atividades', { acao: 'criou' }, 'beatriz')
    expect(l.statusCode, JSON.stringify(l.body)).toBe(200)
    const itens = l.body.itens as Item[]
    const dela = itens.find(
      (i) => i.assunto === 'tarefas' && i.quem.id === c.pessoas['juliana'] && i.quem.nome === 'Juliana',
    )
    expect(dela, JSON.stringify(itens.slice(0, 3))).toBeDefined()
    expect(dela!.quem.tipo).toBe('equipe')
  })

  it('NUNCA devolve o de/para: só chaves, sem valores', async () => {
    const l = await pegar(c, '/v1/atividades', {}, 'beatriz')
    expect(l.statusCode).toBe(200)
    for (const i of l.body.itens as Item[]) {
      expect(Object.keys(i).sort()).toEqual(['acao', 'assunto', 'campos', 'chave', 'em', 'entidadeId', 'motivo', 'quem'])
      expect(i.campos.every((k) => /^[a-z_0-9]+$/.test(k))).toBe(true)
    }
    expect(JSON.stringify(l.body)).not.toMatch(/"(de|para|salario|valor)"/)
  })

  it('a clínica vizinha NUNCA aparece, mesmo pedindo', async () => {
    await c.migrate.query(
      `INSERT INTO auditoria (clinica_id, ator_tipo, acao, entidade, entidade_id)
       VALUES ($1, 'sistema', 'criou', 'assunto_da_vizinha', 'x')`,
      [c.outraClinica],
    )
    const l = await pegar(c, '/v1/atividades', {}, 'beatriz')
    expect((l.body.itens as Item[]).some((i) => i.assunto === 'assunto_da_vizinha')).toBe(false)
    // `clinicaId` não é um filtro desta rota: pedir outra clínica é 400.
    const ruim = await pegar(c, '/v1/atividades', { clinicaId: c.outraClinica }, 'beatriz')
    expect(ruim.statusCode).toBe(400)
  })

  it('filtra por pessoa, assunto e período; cursor inválido não quebra', async () => {
    const porPessoa = await pegar(c, '/v1/atividades', { pessoaId: c.pessoas['juliana']! }, 'beatriz')
    expect(porPessoa.statusCode).toBe(200)
    for (const i of porPessoa.body.itens as Item[]) expect(i.quem.id).toBe(c.pessoas['juliana'])

    const porAssunto = await pegar(c, '/v1/atividades', { assunto: 'tarefas' }, 'beatriz')
    for (const i of porAssunto.body.itens as Item[]) expect(i.assunto).toBe('tarefas')

    const futuro = await pegar(c, '/v1/atividades', { de: '2099-01-01' }, 'beatriz')
    expect(futuro.body.itens).toEqual([])

    const cursor = await pegar(c, '/v1/atividades', { antes: 'lixo' }, 'beatriz')
    expect(cursor.statusCode).toBe(200)
  })
})
