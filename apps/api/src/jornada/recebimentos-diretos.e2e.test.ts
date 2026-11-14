import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  apagar,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparProgramas,
  montarCenario,
  pegar,
  postar,
  receitaDoDia,
} from '../tarefas/__tests__/cenario'

/**
 * RECEBIMENTOS DIRETOS NA JORNADA (pedido da cliente, 2026-11-13).
 *
 * Quem paga por "Registrar recebimento" não passa por cartão da jornada, e a
 * paciente em programa ficava invisível ali. A lista só ENXERGA o avulso: o
 * dinheiro embutido no atendimento já está no funil, e contá-lo de novo seria a
 * receita dobrando (regra 3).
 */
let c: Cenario
beforeAll(async () => {
  c = await montarCenario('recebimentos-diretos')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparProgramas(c)
})

let n = 0
const avulso = (valor: string, paciente = 'ana', quem = 'beatriz') =>
  postar(
    c,
    '/v1/recebimentos',
    {
      requisicaoId: `33333333-3333-4333-8333-${String(++n).padStart(12, '0')}`,
      pacienteId: c.pacientes[paciente],
      valor,
      forma: 'Pix',
      em: HOJE,
      obs: '',
      ref: 'consulta',
    },
    quem,
  )
const lista = (quem = 'beatriz') => pegar(c, '/v1/jornada/recebimentos-diretos?periodo=30dias', {}, quem)

describe('GET /v1/jornada/recebimentos-diretos', () => {
  it('lista o recebimento avulso, com paciente, tipo, dia e valor', async () => {
    expect((await avulso('45000')).statusCode).toBe(201)
    const r = await lista()
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.itens).toHaveLength(1)
    expect(r.body.itens[0]).toMatchObject({
      paciente: 'Ana Lúcia Souza',
      tipo: 'Pagamento de consulta',
      valor: '45000',
      em: HOJE,
    })
  })

  it('o pagamento EMBUTIDO no atendimento não entra (a receita não dobra)', async () => {
    const t = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'paciente',
        pacienteId: c.pacientes['ana'],
        tipo: 'Consulta agendada',
        responsavelId: c.pessoas['beatriz'],
        quando: { modo: 'retroativo', em: HOJE },
      },
      'beatriz',
    )
    const id = t.body.tarefa.id as string
    await postar(c, `/v1/tarefas/${id}/jornada`, { acao: 'registrarOrcamento', valor: '300000' }, 'beatriz')
    const f = await postar(
      c,
      `/v1/tarefas/${id}/jornada`,
      { acao: 'fechar', fechamento: 'tudo', recebimento: { valor: '300000', forma: 'Pix' } },
      'beatriz',
    )
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    await avulso('45000')
    // A receita do dia conta cada real uma vez; a lista só mostra o avulso.
    expect(await receitaDoDia(c)).toBe(345000n)
    const r = await lista()
    expect(r.body.itens.map((x: { valor: string }) => x.valor)).toEqual(['45000'])
  })

  it('estornado some da lista', async () => {
    const a = await avulso('45000')
    expect((await apagar(c, `/v1/recebimentos/${a.body.id}`, {}, 'beatriz')).statusCode).toBe(204)
    expect((await lista()).body.itens).toHaveLength(0)
  })

  it('sem `valores` o nome aparece e o valor não', async () => {
    await avulso('45000')
    const r = await lista('juliana')
    expect(r.statusCode).toBe(200)
    expect(r.body.itens).toHaveLength(1)
    expect(JSON.stringify(r.body)).not.toContain('45000')
  })

  it('quem não tem `jornada` não lê (403)', async () => {
    expect((await lista('sonia')).statusCode).toBe(403)
  })

  it('não vaza para outra clínica', async () => {
    await c.migrate.query(
      `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, 'Paciente de Fora')`,
      [c.outraClinica],
    )
    const fora = await c.migrate.query<{ id: string }>(
      `SELECT id FROM pacientes WHERE clinica_id = $1 AND nome = 'Paciente de Fora'`,
      [c.outraClinica],
    )
    const pessoaFora = await c.migrate.query<{ id: string }>(
      `SELECT id FROM pessoas WHERE clinica_id = $1 LIMIT 1`,
      [c.outraClinica],
    )
    await c.migrate.query(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por, requisicao_id)
       VALUES ($1,$2,'Pagamento de consulta',99900,'Pix', now(), $3, gen_random_uuid())`,
      [c.outraClinica, fora.rows[0]!.id, pessoaFora.rows[0]!.id],
    )
    await avulso('45000')
    const r = await lista()
    expect(JSON.stringify(r.body)).not.toContain('99900')
    expect(JSON.stringify(r.body)).not.toContain('Paciente de Fora')
  })
})
