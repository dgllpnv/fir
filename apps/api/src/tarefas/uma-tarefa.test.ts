import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from './__tests__/cenario'

/**
 * `GET /v1/tarefas/:id` — a tarefa inteira, para o painel de edição.
 *
 * A rota nasceu de um pedido da PO (botão de editar na ficha do paciente), e o
 * que ela precisa provar não é que devolve a tarefa: é que **a leitura não é
 * mais frouxa que a escrita**. Se fosse, a ficha abriria o formulário
 * preenchido com o orçamento e o pagamento de uma tarefa que a pessoa não pode
 * salvar — e valor na tela de quem não deveria vê-lo é exatamente o que a
 * regra 17 existe para impedir.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('uma-tarefa')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
})

/** Uma tarefa interna cujo solicitante E responsável é `beatriz`. */
async function daBeatriz(): Promise<string> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'interna',
      responsavelId: c.pessoas['beatriz'],
      descricao: 'Conferir a geladeira da enfermagem',
      quando: { modo: 'agendada', prazo: '2026-11-10' },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.tarefa.id as string
}

describe('uma tarefa, pelo id', () => {
  it('o responsável lê a própria tarefa, na forma completa', async () => {
    const id = await daBeatriz()
    const r = await pegar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.tarefa.id).toBe(id)
    expect(r.body.tarefa.descricao).toBe('Conferir a geladeira da enfermagem')
    // Os campos que a ficha NÃO tem e o painel precisa — é a razão da rota.
    expect(Object.keys(r.body.tarefa)).toContain('serieId')
    expect(Object.keys(r.body.tarefa)).toContain('obs')
    expect(Object.keys(r.body.tarefa)).toContain('unidadeId')
  })

  it('`hoje` vem do SERVIDOR, não do relógio de quem pediu (regra 24)', async () => {
    const id = await daBeatriz()
    const r = await pegar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
    // O painel usa `hoje` como teto da data de realização. Sem ele na
    // resposta, a tela usaria `new Date()` do navegador — e um computador de
    // recepção com a data errada gravaria conclusão no dia errado.
    expect(r.body.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('403 para quem não é responsável, não é solicitante e não tem `tarefas.equipe`', async () => {
    const id = await daBeatriz()
    // `juliana` é recepção: tem `jornada`, não tem `tarefas.equipe`.
    const r = await pegar(c, `/v1/tarefas/${id}`, {}, 'juliana')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(403)
  })

  it('a MESMA pessoa que leva 403 na leitura leva 403 no PATCH — e vice-versa', async () => {
    // A asserção que dá dentes à anterior: um 403 na leitura que convivesse
    // com um 200 na escrita (ou o contrário) seria duas regras de permissão,
    // e a segunda é a que envelhece. Aqui as duas são a mesma `podeEditar`.
    const id = await daBeatriz()

    const leituraNegada = await pegar(c, `/v1/tarefas/${id}`, {}, 'juliana')
    const escritaNegada = await postar(c, `/v1/tarefas/${id}/cancelar`, {}, 'juliana')
    expect([leituraNegada.statusCode, escritaNegada.statusCode]).toEqual([403, 403])

    const leituraOk = await pegar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
    expect(leituraOk.statusCode).toBe(200)
  })

  it('404 para id que não existe, e para tarefa de OUTRA clínica', async () => {
    const r = await pegar(c, '/v1/tarefas/00000000-0000-4000-8000-000000000000', {}, 'beatriz')
    expect(r.statusCode).toBe(404)

    // A tarefa da clínica VIZINHA do cenário: a RLS a esconde, e o 404 é o
    // comportamento certo — um 403 confirmaria que o id existe.
    //
    // Sem `if`: um `if (achou)` aqui deixaria o teste passar calado no dia em
    // que a tarefa da vizinha deixasse de ser montada, e o isolamento de
    // clínica é justamente o que não pode passar calado.
    const outra = await c.migrate.query<{ id: string }>(
      'SELECT id FROM tarefas WHERE clinica_id <> $1 AND excluida_em IS NULL LIMIT 1',
      [c.clinica],
    )
    expect(outra.rowCount, 'o cenário deveria ter a tarefa da clínica vizinha').toBe(1)
    const vizinha = await pegar(c, `/v1/tarefas/${outra.rows[0]!.id}`, {}, 'beatriz')
    expect(vizinha.statusCode, 'tarefa de outra clínica NÃO pode responder 200').toBe(404)
  })

  it('sem sessão, 401 — não 404, não 200', async () => {
    const id = await daBeatriz()
    const r = await pegar(c, `/v1/tarefas/${id}`, {}, 'ninguem')
    expect(r.statusCode).toBe(401)
  })
})
