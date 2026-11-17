import { describe, expect, it } from 'vitest'
import { hashDoPedido } from './campanha.service'

/**
 * O hash do pedido é gravado ao lado da chave de idempotência (0109): o
 * retry de uma campanha já criada só é reconhecido se o hash for o mesmo.
 * Este valor foi calculado com a implementação ANTERIOR à troca do `as`
 * (revisão P3) — mudar a forma canônica quebraria os retries em voo.
 */
describe('hashDoPedido', () => {
  it('o mesmo hash de antes: chaves em ordem UTF-16, bigint como texto, undefined fora', () => {
    const pedido = {
      relatorio: 'pacientes-sem-compra',
      z: undefined,
      filtros: { meses: 6, b: [1, { y: 2n, x: 'á' }], A: null, _: true, Ç: 1, a10: 1, a2: 2 },
      meta: 123456n,
      nome: 'Campanha',
    }
    expect(hashDoPedido(pedido)).toBe('facb1e8053ea9a40a1a9ee2161a79b92d7ac0ed7b35fca55fd333fa74a2fd8cd')
  })

  it('a ordem em que as chaves chegam não muda o hash', () => {
    expect(hashDoPedido({ a: 1, b: { c: 2, d: 3 } })).toBe(hashDoPedido({ b: { d: 3, c: 2 }, a: 1 }))
  })
})
