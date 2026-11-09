import { describe, expect, it } from 'vitest'
import { areaDoCaminho, GRUPOS } from './areas'

/**
 * O ITEM ACESO DA LATERAL. Antes cada página passava `atual=` à mão; agora o
 * casco desenha o menu uma vez e descobre o item pelo endereço. Estes casos
 * são os mesmos que as páginas escreviam — mudar um deles é mudar o que a
 * pessoa vê aceso.
 */
describe('areaDoCaminho', () => {
  it.each([
    ['/carteira', '/carteira'],
    ['/carteira/', '/carteira'],
    ['/carteira/rotina', '/carteira/rotina'],
    ['/carteira/rotina/rotinas', '/carteira/rotina'],
    ['/carteira/carga', '/carteira/rotina'],
    ['/carteira/clientes', '/carteira/clientes'],
    ['/carteira/clientes/abc', '/carteira/clientes'],
    ['/carteira/clientes/abc/cadastro', '/carteira/clientes'],
    ['/carteira/entrada/abc', '/carteira/clientes'],
    ['/carteira/entrada/abc/metas', '/carteira/clientes'],
    ['/carteira/fir-clinic', '/carteira/fir-clinic'],
    ['/carteira/metas', '/carteira/metas'],
    ['/carteira/campanhas', '/carteira/campanhas'],
    ['/carteira/campanhas/xyz', '/carteira/campanhas'],
    ['/carteira/resumo', '/carteira/resumo'],
    ['/carteira/mensalidades', '/carteira/mensalidades'],
    ['/carteira/leads', '/carteira/leads'],
    ['/carteira/leads/indicacoes', '/carteira/leads'],
    ['/carteira/leads/123', '/carteira/leads'],
    ['/carteira/metodo/roteiros', '/carteira/metodo/roteiros'],
    ['/carteira/metodo/biblioteca', '/carteira/metodo/biblioteca'],
    ['/carteira/metodo/checklists', '/carteira/metodo/checklists'],
    ['/carteira/metodo/mensagens', '/carteira/metodo/mensagens'],
  ])('%s acende %s', (caminho, area) => {
    expect(areaDoCaminho(caminho)).toBe(area)
  })

  it('a lista de entradas não acende nada, como antes', () => {
    expect(areaDoCaminho('/carteira/entrada')).toBeNull()
  })

  it('não confunde prefixo de palavra com prefixo de rota', () => {
    expect(areaDoCaminho('/carteira/metasx')).toBeNull()
    expect(areaDoCaminho('/carteirax')).toBeNull()
  })

  it('todo item do menu acende a si mesmo', () => {
    for (const g of GRUPOS) for (const a of g.areas) expect(areaDoCaminho(a.href)).toBe(a.href)
  })
})
