import { describe, expect, it } from 'vitest'
import { conferirSenha, hashDeSenha } from './senha.js'

describe('senha', () => {
  it('o hash não contém a senha e é verificável', async () => {
    const hash = await hashDeSenha('firmare-demonstracao')
    expect(hash).not.toContain('firmare-demonstracao')
    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(await conferirSenha('firmare-demonstracao', hash)).toBe(true)
  })

  it('recusa a senha errada', async () => {
    const hash = await hashDeSenha('firmare-demonstracao')
    expect(await conferirSenha('firmare-demonstracaa', hash)).toBe(false)
  })

  it('dois hashes da mesma senha são diferentes — o sal é por hash', async () => {
    expect(await hashDeSenha('igual')).not.toBe(await hashDeSenha('igual'))
  })

  it('hash corrompido devolve false em vez de lançar', async () => {
    expect(await conferirSenha('qualquer', 'nao-e-um-hash')).toBe(false)
  })
})
