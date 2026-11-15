import { describe, expect, it } from 'vitest'
import { ConsultaDeRecebimentos } from './index'

/**
 * `incluirEstornados` vem da QUERY STRING, onde tudo é texto. Era
 * `z.coerce.boolean()`, e `Boolean('false')` é `true`: pedir a lista SEM os
 * estornados devolvia a lista COM eles. Agora é `BooleanoDeConsulta`, o mesmo
 * de `serie` (tarefas) e `incluirEstornadas` (outras entradas).
 */
describe('ConsultaDeRecebimentos.incluirEstornados', () => {
  it('"false" e "0" são FALSOS; "true" e "1" são verdadeiros', () => {
    expect(ConsultaDeRecebimentos.parse({ incluirEstornados: 'false' }).incluirEstornados).toBe(false)
    expect(ConsultaDeRecebimentos.parse({ incluirEstornados: '0' }).incluirEstornados).toBe(false)
    expect(ConsultaDeRecebimentos.parse({ incluirEstornados: 'true' }).incluirEstornados).toBe(true)
    expect(ConsultaDeRecebimentos.parse({ incluirEstornados: '1' }).incluirEstornados).toBe(true)
  })

  it('ausente continua ausente; texto que não é booleano é recusado', () => {
    expect(ConsultaDeRecebimentos.parse({}).incluirEstornados).toBeUndefined()
    expect(ConsultaDeRecebimentos.safeParse({ incluirEstornados: 'talvez' }).success).toBe(false)
    expect(ConsultaDeRecebimentos.safeParse({ incluirEstornados: '' }).success).toBe(false)
  })
})
