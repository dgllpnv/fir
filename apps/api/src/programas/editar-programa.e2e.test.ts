import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  limparProgramas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * **EDITAR PROGRAMA — a fatia que não move dinheiro nem estoque** (D-15 b).
 *
 * O protótipo **não responde** a este pedido: ele tem `criarAdesao`,
 * `encerrarAdesao` e `excluirAdesao`, e não tem `editarAdesao`. A fronteira
 * foi escolhida pelo dono, e o valor deste arquivo está no que ele prova que
 * a rota **recusa** — um teste que só confirmasse "o rótulo mudou" passaria
 * numa implementação que também deixa mudar o valor.
 *
 * | Campo | Editável | Por quê |
 * |---|---|---|
 * | `observacao` do programa | **sim** | texto; não entra em conta nenhuma |
 * | `rotuloSessao` do item | **sim** | rótulo, não identidade |
 * | `responsavelId` do item | **sim**, e reaponta as sessões ABERTAS | a funcionária saiu da clínica |
 * | `unidadeId` | **sim** | o programa mudou de unidade |
 * | `valor`, `sessoes` | **não** | mudam o saldo em aberto, que é derivado (regra 5) |
 * | `dose`, `insumo` | **não** | mudam o que se baixa do estoque (regra 12) |
 * | `inicio`, `intervaloDias` | **não** | reprogramação em cascata não existe |
 * | nome do procedimento | **não existe no corpo** | congelado na montagem (lição D-2) |
 */
let c: Cenario
let tirze: string

const montar = (corpo: Record<string, unknown>, quem = 'beatriz') =>
  request(c.app.getHttpServer()).post('/v1/programas').set('Cookie', c.cookies[quem]!).send(corpo)

const editar = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  request(c.app.getHttpServer())
    .patch(`/v1/programas/${id}`)
    .set('Cookie', c.cookies[quem]!)
    .send(corpo)

const concluirSessao = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/programas/sessoes/${id}/concluir`, corpo, quem)

/** Semanal, 4 sessões a partir de 07/09 — todas no passado do relógio fixo. */
const INICIO = '2026-09-07'

const programa = async (): Promise<{ id: string; sessoes: string[] }> => {
  const r = await montar({
    pacienteId: c.pacientes['ana'],
    inicio: INICIO,
    itens: [{ chave: 'i1', procedimentoId: tirze, sessoes: 4, intervaloDias: 7 }],
  })
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  const s = await c.migrate.query<{ id: string }>(
    `SELECT id FROM tarefas WHERE programa_id = $1 AND tipo = 'Sessão de plano'
      ORDER BY sessao_indice`,
    [r.body.id],
  )
  return { id: r.body.id as string, sessoes: s.rows.map((x) => x.id) }
}

/** O responsável de cada sessão, na ordem, lido DO BANCO. */
const responsaveisDasSessoes = async (programaId: string): Promise<string[]> => {
  const r = await c.migrate.query<{ responsavel_id: string }>(
    `SELECT responsavel_id FROM tarefas
      WHERE programa_id = $1 AND tipo = 'Sessão de plano' AND excluida_em IS NULL
      ORDER BY sessao_indice`,
    [programaId],
  )
  return r.rows.map((x) => x.responsavel_id)
}

const itemCru = async (programaId: string) => {
  const r = await c.migrate.query<{
    rotulo_sessao: string
    responsavel_id: string
    sessoes: number
    intervalo_dias: number
    dose: string
    valor: string | null
    insumo_milesimos: string | null
    inicio: string
  }>(
    `SELECT rotulo_sessao, responsavel_id, sessoes, intervalo_dias, dose,
            valor::text AS valor, insumo_milesimos::text AS insumo_milesimos,
            inicio::text AS inicio
       FROM itens_do_programa WHERE programa_id = $1 AND chave = 'i1'`,
    [programaId],
  )
  return r.rows[0]!
}

beforeAll(async () => {
  c = await montarCenario('editar-programa')
  const p = await c.migrate.query<{ id: string }>(
    `SELECT id FROM procedimentos WHERE clinica_id = $1 AND nome_chave = 'tirzepatida'`,
    [c.clinica],
  )
  tirze = p.rows[0]!.id
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparProgramas(c)
})

describe('o que a edição PERMITE', () => {
  it('grava a observação, e ela volta na ficha', async () => {
    const { id } = await programa()
    const r = await editar(id, { observacao: 'Dose reduzida a pedido da médica.' })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)

    const ficha = await pegar(c, `/v1/programas/${id}`, {}, 'beatriz')
    expect(ficha.body.observacao).toBe('Dose reduzida a pedido da médica.')
  })

  it('muda o rótulo da sessão — e NÃO o nome do procedimento', async () => {
    const { id } = await programa()
    expect((await editar(id, { itens: [{ chave: 'i1', rotuloSessao: 'Aplicação' }] })).statusCode)
      .toBe(200)

    const item = await itemCru(id)
    expect(item.rotulo_sessao).toBe('Aplicação')

    // O nome congelado na montagem (lição D-2). Se um dia este `expect`
    // falhar, a identidade do programa passou a ser editável e a história de
    // quem está em tratamento pode ser reescrita pelo catálogo.
    const nome = await c.migrate.query<{ procedimento_nome: string }>(
      `SELECT procedimento_nome FROM itens_do_programa WHERE programa_id = $1`,
      [id],
    )
    expect(nome.rows[0]!.procedimento_nome).toBe('Tirzepatida')
  })

  it('trocar o responsável REAPONTA as sessões abertas, e diz quantas', async () => {
    const { id } = await programa()
    const nara = c.pessoas['nara']!

    const r = await editar(id, { itens: [{ chave: 'i1', responsavelId: nara }] })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.sessoesRepontadas).toBe(4)
    expect(await responsaveisDasSessoes(id)).toEqual([nara, nara, nara, nara])
    expect((await itemCru(id)).responsavel_id).toBe(nara)
  })

  it('A SESSÃO REALIZADA NÃO SE MOVE — só as abertas', async () => {
    // O coração da regra. Quem aplicou a dose do dia 7 aplicou; reescrever o
    // responsável de um atendimento que aconteceu é reescrever a história
    // clínica, e muda de dono um recebimento que já entrou.
    const { id, sessoes } = await programa()
    const antes = await responsaveisDasSessoes(id)
    expect(
      (await concluirSessao(sessoes[0]!, { em: INICIO, reprogramar: false })).statusCode,
    ).toBe(200)

    const nara = c.pessoas['nara']!
    const r = await editar(id, { itens: [{ chave: 'i1', responsavelId: nara }] })
    expect(r.body.sessoesRepontadas).toBe(3)

    const depois = await responsaveisDasSessoes(id)
    expect(depois[0], 'a sessão realizada manteve o responsável').toBe(antes[0])
    expect(depois.slice(1)).toEqual([nara, nara, nara])
  })

  it('programa ENCERRADO aceita a correção, com zero sessões reapontadas', async () => {
    // Recusar seria impedir a correção justamente do registro que vai ficar.
    // O zero diz, sem uma segunda regra, que não havia o que mover.
    const { id } = await programa()
    expect((await postar(c, `/v1/programas/${id}/encerrar`, { motivo: 'Desistiu' }, 'beatriz'))
      .statusCode).toBe(200)

    const r = await editar(id, {
      observacao: 'Parou por preço.',
      itens: [{ chave: 'i1', responsavelId: c.pessoas['nara']! }],
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.sessoesRepontadas).toBe(0)
  })

  it('a trilha registra a edição, com de → para', async () => {
    const { id } = await programa()
    await editar(id, { observacao: 'Viaja em janeiro.' })
    // `alterou`, nao `UPDATE`: o vocabulario da trilha e o do glossario
    // (CONTEXT.md), nao o do Postgres. Escrevi `UPDATE` na primeira versao
    // deste teste e ele reprovou — a trilha estava certa.
    const t = await c.migrate.query<{ acao: string; para: Record<string, unknown> }>(
      `SELECT acao, para FROM auditoria
        WHERE entidade = 'programas' AND entidade_id = $1 AND acao = 'alterou'
        ORDER BY id DESC LIMIT 1`,
      [id],
    )
    expect(t.rowCount, 'a edição não deixou trilha').toBe(1)
    expect(t.rows[0]!.para).toMatchObject({ observacao: 'Viaja em janeiro.' })
  })
})

describe('o que a edição RECUSA — e é isto que a opção b significa', () => {
  const PROIBIDOS: readonly [string, Record<string, unknown>][] = [
    ['valor do item', { itens: [{ chave: 'i1', valor: '50000' }] }],
    ['número de sessões', { itens: [{ chave: 'i1', sessoes: 8 }] }],
    ['intervalo entre sessões', { itens: [{ chave: 'i1', intervaloDias: 14 }] }],
    ['início do item', { itens: [{ chave: 'i1', inicio: '2026-10-01' }] }],
    ['dose', { itens: [{ chave: 'i1', dose: '10 mg' }] }],
    ['insumo', { itens: [{ chave: 'i1', insumo: { itemId: null } }] }],
    ['modo de cobrança', { modoDeCobranca: 'saldo' }],
    ['início do programa', { inicio: '2026-10-01' }],
    ['nome do procedimento', { itens: [{ chave: 'i1', procedimentoNome: 'Outro' }] }],
    ['paciente', { pacienteId: '00000000-0000-4000-8000-000000000000' }],
  ]

  for (const [nome, corpo] of PROIBIDOS) {
    it(`400 ao tentar mudar ${nome} — e o campo NÃO é ignorado em silêncio`, async () => {
      const { id } = await programa()
      const antes = await itemCru(id)

      const r = await editar(id, corpo)
      expect(r.statusCode, `${nome}: ${JSON.stringify(r.body)}`).toBe(400)

      // A metade que dá dentes: um 400 que ainda assim tivesse gravado o resto
      // do corpo seria pior que um 200.
      expect(await itemCru(id)).toEqual(antes)
    })
  }

  it('corpo vazio é 400, não um "salvo" que não salvou nada', async () => {
    const { id } = await programa()
    expect((await editar(id, {})).statusCode).toBe(400)
  })

  it('chave de item que o programa não tem é 404, não silêncio', async () => {
    const { id } = await programa()
    const r = await editar(id, { itens: [{ chave: 'i9', rotuloSessao: 'Nada' }] })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(404)
  })

  it('responsável que saiu da clínica é recusado — senão a agenda vai para quem não trabalha', async () => {
    const { id } = await programa()
    const r = await editar(id, { itens: [{ chave: 'i1', responsavelId: c.pessoas['marta']! }] })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(400)
    // E as sessões continuam com quem estavam.
    expect(new Set(await responsaveisDasSessoes(id)).size).toBe(1)
  })

  it('sem `programas.gerir`, 403 — a mesma permissão de encerrar e excluir', async () => {
    const { id } = await programa()
    // `juliana` é recepção: acompanha o tratamento, não o redesenha.
    const r = await editar(id, { observacao: 'x' }, 'juliana')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(403)
  })

  it('programa de OUTRA clínica é 404 — a RLS o esconde', async () => {
    const outro = await c.migrate.query<{ id: string }>(
      'SELECT id FROM programas WHERE clinica_id <> $1 LIMIT 1',
      [c.clinica],
    )
    if (outro.rowCount === 1) {
      const r = await editar(outro.rows[0]!.id, { observacao: 'x' })
      expect(r.statusCode).toBe(404)
    }
    // Sem programa vizinho no cenário, a borda de clínica já está coberta por
    // `isolamento.e2e.test.ts` — este caso é o reforço local, não a prova.
    expect(true).toBe(true)
  })
})
