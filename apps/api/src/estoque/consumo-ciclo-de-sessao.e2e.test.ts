import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  limparProgramas,
  montarCenario,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * O CICLO concluir → reabrir → concluir → reabrir pelo FLUXO REAL da sessão
 * (rotas HTTP + `BaixaRelacional`, sem espião e sem INSERT simulado).
 *
 * Mede, na aba Consumo e no saldo, o que a reabertura promete (regra 12): o
 * estorno é movimento compensatório ligado à origem, o saldo volta ao ponto
 * inicial e a soma LÍQUIDA do paciente volta a zero — e depois à dose.
 */
let c: Cenario
let tirze: string
let AMPOLA: string

const montar = (corpo: Record<string, unknown>) =>
  request(c.app.getHttpServer()).post('/v1/programas').set('Cookie', c.cookies['beatriz']!).send(corpo)

const sessao = async (): Promise<string> => {
  const r = await montar({
    pacienteId: c.pacientes['ana'],
    inicio: '2026-10-20',
    itens: [
      {
        chave: 'i1',
        procedimentoId: tirze,
        sessoes: 1,
        intervaloDias: 7,
        insumo: { itemId: AMPOLA, quantidade: '2500', unidade: 'mg' },
      },
    ],
  })
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  const s = await c.migrate.query<{ id: string }>(
    `SELECT id FROM tarefas WHERE programa_id = $1 AND tipo = 'Sessão de plano'`,
    [r.body.id],
  )
  return s.rows[0]!.id
}

const concluir = (id: string) =>
  postar(c, `/v1/programas/sessoes/${id}/concluir`, { em: '2026-10-20', reprogramar: false }, 'beatriz').expect(200)
const reabrir = (id: string) =>
  postar(c, `/v1/programas/sessoes/${id}/reabrir`, {}, 'beatriz').expect(200)

const saldo = async (): Promise<string> => {
  const r = await request(c.app.getHttpServer()).get('/v1/estoque').set('Cookie', c.cookies['beatriz']!).expect(200)
  return (r.body.itens as { id: string; saldoEmEstoque: { milesimos: string } }[]).find((i) => i.id === AMPOLA)!
    .saldoEmEstoque.milesimos
}

const liquido = async (): Promise<string | null> => {
  const r = await request(c.app.getHttpServer())
    .get(`/v1/pacientes/${c.pacientes['ana']}/consumo`)
    .set('Cookie', c.cookies['beatriz']!)
    .expect(200)
  const l = (r.body.liquidoPorItem as { item: string; quantidade: { milesimos: string } }[]).find(
    (x) => x.item === 'Tirzepatida ampola',
  )
  return l === undefined ? null : l.quantidade.milesimos
}

beforeAll(async () => {
  c = await montarCenario('ciclo')
  tirze = (
    await c.migrate.query<{ id: string }>(
      `SELECT id FROM procedimentos WHERE clinica_id = $1 AND nome_chave = 'tirzepatida'`,
      [c.clinica],
    )
  ).rows[0]!.id
  AMPOLA = (
    await c.migrate.query<{ id: string }>(
      `INSERT INTO itens_de_estoque (clinica_id, nome, medida, unid_uso, fator_uso, aproveita_sobra)
       VALUES ($1, 'Tirzepatida ampola', 'ampola', 'mg', 5000, true) RETURNING id`,
      [c.clinica],
    )
  ).rows[0]!.id
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparProgramas(c)
  // Estado inicial: 10 ampolas contadas antes da sessão.
  await c.migrate.query(
    `INSERT INTO movimentos_de_estoque (clinica_id, item_id, tipo, milesimos, dia)
     VALUES ($1, $2, 'contagem', 10000, '2026-10-19')`,
    [c.clinica, AMPOLA],
  )
})

describe('o ciclo da sessão pelo fluxo real', () => {
  it('concluir → reabrir → concluir → reabrir: saldo volta ao inicial e o líquido do Consumo volta a 0, e depois à dose', async () => {
    expect(await saldo()).toBe('10000')
    expect(await liquido()).toBeNull()

    const id = await sessao()

    await concluir(id)
    expect(await saldo()).toBe('9500') // 2,5 mg = 0,5 ampola
    expect(await liquido()).toBe('500')

    await reabrir(id)
    expect(await saldo()).toBe('10000')
    expect(await liquido()).toBe('0') // consumo 0,5 − estorno 0,5

    await concluir(id)
    expect(await saldo()).toBe('9500')
    expect(await liquido()).toBe('500') // a dose, de novo

    await reabrir(id)
    expect(await saldo()).toBe('10000')
    expect(await liquido()).toBe('0')

    // A ficha mostra os 4 movimentos: 2 consumos e 2 estornos ligados à origem.
    const r = await request(c.app.getHttpServer())
      .get(`/v1/pacientes/${c.pacientes['ana']}/consumo`)
      .set('Cookie', c.cookies['beatriz']!)
      .expect(200)
    const itens = r.body.itens as { id: string; estorno: boolean; estornaId: string | null; estornado: boolean }[]
    expect(itens).toHaveLength(4)
    const consumos = itens.filter((x) => !x.estorno)
    expect(consumos).toHaveLength(2)
    expect(consumos.every((x) => x.estornado)).toBe(true)
    expect(new Set(itens.filter((x) => x.estorno).map((x) => x.estornaId))).toEqual(new Set(consumos.map((x) => x.id)))
  })
})
