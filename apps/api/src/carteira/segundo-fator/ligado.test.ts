import { describe, expect, it } from 'vitest'
import { CHAVE_SEGUNDO_FATOR_LIGADO, segundoFatorLigado } from './ligado'

const com = (v: string | undefined) => (v === undefined ? {} : { [CHAVE_SEGUNDO_FATOR_LIGADO]: v })

describe('SEGUNDO_FATOR_CARTEIRA_LIGADO (ADR 0023)', () => {
  it('ausente é DESLIGADO — o padrão da D-23', () => {
    expect(segundoFatorLigado(com(undefined))).toBe(false)
  })

  it.each(['false', '0', '', 'FALSE', ' false '])('"%s" desliga', (v) => {
    expect(segundoFatorLigado(com(v))).toBe(false)
  })

  it.each(['true', '1', 'TRUE', ' true '])('"%s" liga', (v) => {
    expect(segundoFatorLigado(com(v))).toBe(true)
  })

  it.each(['ture', 'sim', 'yes', 'on'])('"%s" é erro, nunca um desligado silencioso', (v) => {
    expect(() => segundoFatorLigado(com(v))).toThrow(CHAVE_SEGUNDO_FATOR_LIGADO)
  })

  it('a chave vale também em produção: não há outra variável que a sobreponha', () => {
    expect(segundoFatorLigado({ NODE_ENV: 'production', [CHAVE_SEGUNDO_FATOR_LIGADO]: 'true' })).toBe(true)
    expect(segundoFatorLigado({ NODE_ENV: 'production' })).toBe(false)
  })
})
