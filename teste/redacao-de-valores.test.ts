import { CAMPOS_MONETARIOS } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { ROTAS_COM_DINHEIRO } from './registro'

/**
 * Este arquivo ainda não tem muito a fazer no plano 1 — nenhuma rota devolve
 * dinheiro. Ele existe desde já porque o plano 4 acrescenta onze rotas de uma
 * vez, e um teste escrito depois de as rotas existirem é um teste escrito para
 * passar.
 */
describe('registro de rotas com dinheiro', () => {
  it('todo campo registrado está na lista do domínio', () => {
    const conhecidos = new Set<string>(CAMPOS_MONETARIOS)
    for (const rota of ROTAS_COM_DINHEIRO) {
      for (const campo of rota.camposDeDinheiro) {
        expect(conhecidos.has(campo), `${rota.caminho}: campo "${campo}" não está em CAMPOS_MONETARIOS`).toBe(true)
      }
    }
  })

  it('nenhuma rota é registrada duas vezes', () => {
    const chaves = ROTAS_COM_DINHEIRO.map((r) => `${r.metodo} ${r.caminho}`)
    expect(new Set(chaves).size).toBe(chaves.length)
  })
})
