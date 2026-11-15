import { describe, expect, it } from 'vitest'
import { mapearComConcorrencia } from './painel-atividades.service'

/**
 * O log de atividades lia TODAS as clínicas ao mesmo tempo (`Promise.all`), e o
 * pool do painel tem 3 conexões: com centenas de clínicas, as excedentes
 * estouravam o `connectionTimeoutMillis`. Isto mede o limite sem banco.
 */
describe('mapearComConcorrencia', () => {
  it('nunca passa do limite em voo, e devolve na ordem da entrada', async () => {
    let emVoo = 0
    let pico = 0
    const itens = Array.from({ length: 40 }, (_, i) => i)
    const r = await mapearComConcorrencia(itens, 2, async (i) => {
      emVoo++
      pico = Math.max(pico, emVoo)
      // Termina fora de ordem de propósito: a saída tem de seguir a ENTRADA.
      await new Promise((ok) => setTimeout(ok, (i * 7) % 3))
      emVoo--
      return i * 10
    })
    expect(pico).toBe(2)
    expect(r).toEqual(itens.map((i) => i * 10))
  })

  it('lista vazia e limite maior que a lista', async () => {
    expect(await mapearComConcorrencia([], 2, async (x: number) => x)).toEqual([])
    expect(await mapearComConcorrencia([1], 4, async (x) => x + 1)).toEqual([2])
  })

  it('um erro rejeita o todo, como o Promise.all que substitui', async () => {
    await expect(
      mapearComConcorrencia([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error('falhou')
        return x
      }),
    ).rejects.toThrow('falhou')
  })
})
