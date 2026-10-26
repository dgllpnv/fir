import { describe, expect, it } from 'vitest'
import { TEMAS, TEMA_PADRAO, atributoDoTema, ehTema } from './tema'

describe('preferência de tema', () => {
  it('o padrão é claro, porque a identidade é papel e dourado', () => {
    // A PO desenhou e revisou o protótipo no claro, e é a versão que as
    // clínicas conhecem. O escuro é acréscimo nosso; quem quiser, escolhe.
    expect(TEMA_PADRAO).toBe('claro')
  })

  it('"sistema" não escreve atributo — senão deixaria de seguir o aparelho', () => {
    // Escrever data-theme="light" aqui congelaria o claro e quebraria o que
    // "Sistema" promete: acompanhar o aparelho quando ele mudar.
    expect(atributoDoTema('sistema')).toBeNull()
    expect(atributoDoTema('claro')).toBe('light')
    expect(atributoDoTema('escuro')).toBe('dark')
  })

  it('valor estranho guardado não vira tema', () => {
    for (const lixo of ['dark', 'light', '', 'CLARO', null, 42, undefined]) {
      expect(ehTema(lixo), `${String(lixo)} passou por tema`).toBe(false)
    }
    for (const t of TEMAS) expect(ehTema(t)).toBe(true)
  })

  it('todo tema tem atributo definido — nenhum cai em undefined', () => {
    for (const t of TEMAS) {
      const a = atributoDoTema(t)
      expect(a === null || a === 'light' || a === 'dark', `${t} devolveu ${String(a)}`).toBe(true)
    }
  })
})
