import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  montarCenario,
  pegar,
} from '../tarefas/__tests__/cenario'
import { hashDeSenha } from '../autenticacao/senha'

/**
 * A busca estreita de paciente — **decisão D-7**.
 *
 * O que estes testes protegem não é a busca funcionar: é ela **não virar** a
 * listagem. A tentação, no primeiro chamado de "faltou mostrar a origem", é
 * acrescentar um campo aqui — e aí a rota que existe para não entregar dado
 * financeiro de paciente passa a entregar. Cada `expect` abaixo existe para
 * que isso falhe antes de chegar numa clínica.
 */
describe('busca de paciente para vincular tarefa (D-7)', () => {
  let c: Cenario
  // Nenhum dos três perfis do cenário serve: os três têm `pacientes`. Quem
  // prova a D-7 é exatamente quem NÃO tem — criado aqui para não mexer no
  // fixture compartilhado, que outros arquivos contam.
  let semPacientes: string[]

  beforeAll(async () => {
    c = await montarCenario('busca')
    const perfil = await c.migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms)
       VALUES ($1, 'pf_sem', 'Sem pacientes', ARRAY['jornada']) RETURNING id`,
      [c.clinica],
    )
    const codigo = (
      await c.migrate.query<{ codigo: string }>(`SELECT codigo FROM clinicas WHERE id = $1`, [
        c.clinica,
      ])
    ).rows[0]!.codigo
    await c.migrate.query(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
       VALUES ($1, 'Sandra', 'sandra', $2, $3)`,
      [c.clinica, await hashDeSenha('senha-de-teste-123'), perfil.rows[0]!.id],
    )
    const r = await request(c.app.getHttpServer())
      .post('/v1/entrar')
      .send({ clinica: codigo, usuario: 'sandra', senha: 'senha-de-teste-123' })
      .expect(200)
    const v = r.headers['set-cookie'] as unknown
    semPacientes = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
    c.cookies['sandra'] = semPacientes
  })

  afterAll(async () => {
    await desmontarCenario(c)
  })

  it('quem NÃO tem a permissão `pacientes` consegue buscar — é o ponto da D-7', async () => {
    const r = await pegar(c, '/v1/busca-de-pacientes', { termo: 'ana' }, 'sandra').expect(200)
    expect(r.body.itens.length).toBeGreaterThan(0)
  })

  it('abrir a busca NÃO abriu a listagem para a mesma pessoa', async () => {
    await pegar(c, '/v1/pacientes', {}, 'sandra').expect(403)
  })

  it('devolve três campos, e nenhum deles é dinheiro nem histórico', async () => {
    const r = await pegar(c, '/v1/busca-de-pacientes', { termo: 'ana' }, 'sandra').expect(200)
    expect(Object.keys(r.body.itens[0]).sort()).toEqual(['id', 'nome', 'telefone'])
    const cru = JSON.stringify(r.body)
    for (const proibido of ['ltv', 'saldo', 'origem', 'ultima', 'obs', 'aniversario', 'unidade']) {
      expect(cru, `"${proibido}" vazou pela busca estreita`).not.toContain(proibido)
    }
  })

  it('acha por telefone com a máscara que a pessoa digita', async () => {
    // Ana está gravada como "(71) 98888-7777". Quem digita só os dígitos, ou
    // com outra máscara, tem de achar — senão a busca por telefone só serve
    // para quem digitou exatamente igual.
    const r = await pegar(c, '/v1/busca-de-pacientes', { termo: '71988887777' }, 'sandra').expect(200)
    expect(r.body.itens).toHaveLength(1)
  })

  it('não atravessa para a clínica vizinha', async () => {
    const r = await pegar(c, '/v1/busca-de-pacientes', { termo: 'vizinha' }, 'sandra').expect(200)
    expect(r.body.itens, 'paciente de outra clínica apareceu na busca').toHaveLength(0)
  })

  it('sem sessão é 401 — autenticada, não pública', async () => {
    await pegar(c, '/v1/busca-de-pacientes', { termo: 'ana' }, 'ninguem').expect(401)
  })

  it('termo de uma letra é recusado — senão a busca devolve a clínica inteira', async () => {
    await pegar(c, '/v1/busca-de-pacientes', { termo: 'a' }, 'sandra').expect(400)
  })
})
