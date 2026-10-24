import { describe, expect, it } from 'vitest'
import { LimitePorOrigem } from './limite-por-origem'

/**
 * `agora` é parâmetro de propósito: o relógio entra por fora para que a
 * janela deslizante seja testada sem `setTimeout` de cinco minutos nem mock
 * de `Date.now`.
 */
describe('LimitePorOrigem', () => {
  it('deixa passar até o máximo e recusa a seguinte', () => {
    const l = new LimitePorOrigem(3, 60_000)
    expect(l.registrar('203.0.113.7', 0)).toBe(true)
    expect(l.registrar('203.0.113.7', 1)).toBe(true)
    expect(l.registrar('203.0.113.7', 2)).toBe(true)
    expect(l.registrar('203.0.113.7', 3)).toBe(false)
  })

  it('separa as origens: a rajada de uma não bloqueia a outra', () => {
    const l = new LimitePorOrigem(2, 60_000)
    expect(l.registrar('a', 0)).toBe(true)
    expect(l.registrar('a', 1)).toBe(true)
    expect(l.registrar('a', 2)).toBe(false)
    // A clínica do outro endereço não tem nada com a rajada da primeira.
    expect(l.registrar('b', 3)).toBe(true)
    expect(l.registrar('b', 4)).toBe(true)
  })

  it('a janela DESLIZA: o que saiu dela deixa de contar', () => {
    const l = new LimitePorOrigem(2, 1_000)
    expect(l.registrar('a', 0)).toBe(true)
    expect(l.registrar('a', 500)).toBe(true)
    expect(l.registrar('a', 900)).toBe(false)
    // Em t=1_600 o corte é 600: as marcas de t=0 e t=500 saíram da janela de
    // 1 s, sobrou a de t=900 (recusada, mas registrada) — duas com esta,
    // dentro do teto.
    expect(l.registrar('a', 1_600)).toBe(true)
    // Em t=1_700 o corte é 700: t=900 e t=1_600 continuam dentro, e esta é a
    // terceira.
    expect(l.registrar('a', 1_700)).toBe(false)
    // Em t=2_800 o corte é 1_800: só a de t=1_700 sobrevive.
    expect(l.registrar('a', 2_800)).toBe(true)
  })

  it('registra a tentativa que estoura — insistir não libera uma por janela', () => {
    const l = new LimitePorOrigem(1, 1_000)
    expect(l.registrar('a', 0)).toBe(true)
    // Rajada contínua: cada recusa também entra na janela, então a origem
    // continua bloqueada enquanto insiste.
    for (let t = 100; t < 1_000; t += 100) expect(l.registrar('a', t)).toBe(false)
    expect(l.registrar('a', 1_050)).toBe(false)
  })

  it('o Retry-After é o tempo até a marca mais antiga sair da janela', () => {
    const l = new LimitePorOrigem(1, 60_000)
    l.registrar('a', 10_000)
    // 10_000 + 60_000 − 20_000 = 50_000 ms = 50 s.
    expect(l.esperaEmSegundos('a', 20_000)).toBe(50)
    // Nunca 0 para quem tem marca: "tente de novo agora" seria um convite.
    expect(l.esperaEmSegundos('a', 999_000)).toBe(1)
    expect(l.esperaEmSegundos('nunca-vista', 0)).toBe(0)
  })

  it('poda as origens vencidas em vez de crescer sem fim', () => {
    // `maxOrigens` baixo para disparar a poda: sem ela, um atacante com
    // milhões de IPs distintos derrubaria a API por memória — o mapa é o
    // único estado ilimitado deste caminho.
    const l = new LimitePorOrigem(5, 1_000, 10)
    for (let i = 0; i < 50; i++) l.registrar(`origem-${i}`, 0)
    // Muito depois da janela: a 51ª chamada passa do teto e poda as 50.
    l.registrar('nova', 100_000)
    expect(l.tamanho).toBe(1)
  })
})
