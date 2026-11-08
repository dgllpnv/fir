import { normalizarCodigoDeRecuperacao } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { CofreDoSegundoFator, segredoDoSegundoFatorDoAmbiente, sortearCodigosDeRecuperacao } from './cifra'

const SEGREDO = 'x'.repeat(40)
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('CofreDoSegundoFator — AES-256-GCM com AAD = usuário', () => {
  const cofre = new CofreDoSegundoFator(SEGREDO)

  it('ida e volta na mesma linha', () => {
    const s = cofre.novoSegredo()
    const { cifrado, versao } = cofre.cifrar(A, s)
    expect(cofre.decifrar(A, cifrado, versao)).toEqual(s)
  })

  it('o ciphertext de A copiado para B não decifra (caso de abuso 31)', () => {
    const { cifrado, versao } = cofre.cifrar(A, cofre.novoSegredo())
    expect(cofre.decifrar(B, cifrado, versao)).toBeNull()
  })

  it('outra chave, versão desconhecida ou byte adulterado: null, nunca exceção', () => {
    const s = cofre.novoSegredo()
    const { cifrado, versao } = cofre.cifrar(A, s)
    expect(new CofreDoSegundoFator('y'.repeat(40)).decifrar(A, cifrado, versao)).toBeNull()
    expect(cofre.decifrar(A, cifrado, 99)).toBeNull()
    const adulterado = Buffer.from(cifrado)
    adulterado[adulterado.length - 1]! ^= 1
    expect(cofre.decifrar(A, adulterado, versao)).toBeNull()
  })

  it('o ciphertext não contém o segredo em claro, e dois cifrados do mesmo segredo diferem', () => {
    const s = cofre.novoSegredo()
    const um = cofre.cifrar(A, s).cifrado
    expect(um.includes(s)).toBe(false)
    expect(cofre.cifrar(A, s).cifrado.equals(um)).toBe(false)
  })

  it('o hash do código de recuperação depende do usuário e do pepper', () => {
    const h = cofre.hashDoCodigoDeRecuperacao(A, 'ABCDEFGH2345')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(cofre.hashDoCodigoDeRecuperacao(B, 'ABCDEFGH2345')).not.toBe(h)
    expect(new CofreDoSegundoFator('y'.repeat(40)).hashDoCodigoDeRecuperacao(A, 'ABCDEFGH2345')).not.toBe(h)
  })
})

describe('sortearCodigosDeRecuperacao', () => {
  it('dez códigos distintos, cada um na forma aceita pelo domínio', () => {
    const codigos = sortearCodigosDeRecuperacao()
    expect(codigos).toHaveLength(10)
    expect(new Set(codigos).size).toBe(10)
    for (const c of codigos) expect(normalizarCodigoDeRecuperacao(c)).toBe(c)
  })
})

describe('FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA', () => {
  it('em produção, ausente ou curta é erro na subida', () => {
    expect(() => segredoDoSegundoFatorDoAmbiente({ NODE_ENV: 'production' })).toThrow(/FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA/)
    expect(() =>
      segredoDoSegundoFatorDoAmbiente({ NODE_ENV: 'production', FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA: 'curta' }),
    ).toThrow()
    expect(
      segredoDoSegundoFatorDoAmbiente({ NODE_ENV: 'production', FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA: SEGREDO }),
    ).toBe(SEGREDO)
  })

  it('fora de produção, uma chave de desenvolvimento', () => {
    expect(segredoDoSegundoFatorDoAmbiente({ NODE_ENV: 'test' })).toMatch(/desenvolvimento/)
  })
})
