import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  botar,
  type Cenario,
  desmontarCenario,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'
import { criarPersona } from '../tarefas/__tests__/persona-extra'

/**
 * F10 (appsec, regra 17): quem gerencia campanhas e NÃO tem `valores` não pode
 * usar o `percentualDaMeta` — que atravessa a redação — como oráculo da
 * receita.
 *
 * O ataque: editar a campanha para `metrica: 'receita'` com `metaEmDinheiro:
 * '1'` (R$ 0,01). O percentual vira `receita / 1 * 100`, a receita em claro.
 * A defesa é impedir que quem não vê valor DEFINA a meta em reais, ou tire a
 * métrica de 'receita' (o que sobrescreveria a meta que ele não pode ver).
 */
let c: Cenario
const BASE = {
  categoria: 'Sazonal',
  foco: 'Outubro',
  inicio: '2026-10-01',
  fim: '2026-10-31',
  objetivo: 'Voltar',
  tipoMetrica: '',
}
const DE_CONTATOS = { ...BASE, nome: 'Contatos', metrica: 'contatos', metaEmDinheiro: null, metaEmNumero: 40 }
const DE_RECEITA = { ...BASE, nome: 'Receita', metrica: 'receita', metaEmDinheiro: '1000000', metaEmNumero: null }

let idContatos: string
let idReceita: string

const meta = async (id: string) =>
  (
    await c.migrate.query<{ metrica: string; meta: string }>(
      'SELECT metrica, meta::text AS meta FROM campanhas WHERE id = $1',
      [id],
    )
  ).rows[0]!

beforeAll(async () => {
  c = await montarCenario('campanha-sem-valores')
  await criarPersona(c, 'gerente', ['campanhas', 'campanhas.gerir'])
  for (const corpo of [DE_CONTATOS, DE_RECEITA]) {
    expect((await postar(c, '/v1/campanhas', corpo, 'beatriz')).statusCode).toBe(201)
  }
  const lista = (await pegar(c, '/v1/campanhas', { mes: '2026-10' }, 'beatriz')).body.campanhas as {
    id: string
    nome: string
  }[]
  idContatos = lista.find((x) => x.nome === 'Contatos')!.id
  idReceita = lista.find((x) => x.nome === 'Receita')!.id
})
afterAll(async () => {
  await desmontarCenario(c)
})

describe('F10 — sem `valores`, a meta em R$ não se define', () => {
  it('o ataque: trocar a métrica para receita com meta de R$ 0,01 é 403 e nada muda', async () => {
    const r = await botar(
      c,
      `/v1/campanhas/${idContatos}`,
      { ...DE_CONTATOS, metrica: 'receita', metaEmDinheiro: '1', metaEmNumero: null },
      'gerente',
    )
    expect(r.statusCode, JSON.stringify(r.body)).toBe(403)
    expect(JSON.stringify(r.body)).toMatch(/valores/)
    expect(await meta(idContatos)).toEqual({ metrica: 'contatos', meta: '40' })
  })

  it('criar campanha em R$ também é 403, e nada nasce', async () => {
    const r = await postar(c, '/v1/campanhas', { ...DE_RECEITA, nome: 'Criada pelo atacante', metaEmDinheiro: '1' }, 'gerente')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(403)
    const n = await c.migrate.query(`SELECT 1 FROM campanhas WHERE clinica_id = $1 AND nome = 'Criada pelo atacante'`, [c.clinica])
    expect(n.rowCount).toBe(0)
  })

  it('tirar uma campanha da métrica receita é 403 (sobrescreveria a meta em R$ que ele não vê)', async () => {
    const r = await botar(c, `/v1/campanhas/${idReceita}`, { ...DE_RECEITA, metrica: 'contatos', metaEmDinheiro: null, metaEmNumero: 5 }, 'gerente')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(403)
    expect(await meta(idReceita)).toEqual({ metrica: 'receita', meta: '1000000' })
  })

  it('editar uma campanha que não é em R$ continua permitido', async () => {
    const r = await botar(c, `/v1/campanhas/${idContatos}`, { ...DE_CONTATOS, metaEmNumero: 50 }, 'gerente')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(await meta(idContatos)).toEqual({ metrica: 'contatos', meta: '50' })
  })

  it('com `valores`, definir e trocar a meta em R$ continua funcionando', async () => {
    const r = await botar(c, `/v1/campanhas/${idContatos}`, { ...DE_CONTATOS, metrica: 'receita', metaEmDinheiro: '2000000', metaEmNumero: null }, 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(await meta(idContatos)).toEqual({ metrica: 'receita', meta: '2000000' })
  })
})
