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

  it('hash corrompido devolve false E registra o motivo', async () => {
    // Sem este log, uma falha do mecanismo (binding nativo ausente, memória
    // insuficiente) se apresentaria como "senha errada" para todos os usuários,
    // sem nada no log do operador.
    const escrito: string[] = []
    const original = process.stderr.write
    process.stderr.write = ((t: string) => {
      escrito.push(String(t))
      return true
    }) as typeof process.stderr.write

    try {
      expect(await conferirSenha('qualquer', 'nao-e-um-hash')).toBe(false)
    } finally {
      process.stderr.write = original
    }

    expect(escrito.join('')).toContain('[autenticacao] conferirSenha falhou')
    // E nunca a senha nem o hash na mensagem.
    expect(escrito.join('')).not.toContain('qualquer')
  })
})
