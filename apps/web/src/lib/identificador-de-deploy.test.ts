import { describe, expect, it } from 'vitest'
import { identificadorDeDeploy } from '../../identificador-de-deploy.mjs'

describe('identificadorDeDeploy (C1, AB-C1-1)', () => {
  it('um commit vira os 12 primeiros caracteres', () => {
    expect(identificadorDeDeploy('7fccae0a1b2c3d4e5f60718293a4b5c6d7e8f901')).toBe('7fccae0a1b2c')
  })

  it('o que não é hash não chega ao HTML do visitante', () => {
    for (const valor of [
      undefined,
      '',
      'desconhecido',
      'main; rm -rf /',
      'feature/x',
      '7FCCAE0A1B2C',
      '7fccae0',
      '<script>alert(1)</script>',
      `${'a'.repeat(41)}`,
    ]) {
      expect(identificadorDeDeploy(valor)).toBeUndefined()
    }
  })
})
