import { describe, expect, it } from 'vitest'
import { hashDoToken, limiteExcedido, novoToken } from './sessao'

describe('token de sessão', () => {
  it('gera token opaco e o hash correspondente', () => {
    const { token, hash } = novoToken()
    expect(token).toHaveLength(43) // 32 bytes em base64url
    expect(hash).toBe(hashDoToken(token))
    expect(hash).not.toContain(token)
  })

  it('dois tokens nunca são iguais', () => {
    const vistos = new Set(Array.from({ length: 200 }, () => novoToken().token))
    expect(vistos.size).toBe(200)
  })
})

describe('limite de tentativas', () => {
  const agora = new Date('2026-10-23T12:00:00Z')
  const falha = (minutosAtras: number) => ({
    em: new Date(agora.getTime() - minutosAtras * 60_000),
    sucesso: false,
  })

  it('cinco falhas na janela bloqueiam', () => {
    expect(limiteExcedido([falha(1), falha(2), falha(3), falha(4), falha(5)], agora)).toBe(true)
  })

  it('quatro falhas ainda passam', () => {
    expect(limiteExcedido([falha(1), falha(2), falha(3), falha(4)], agora)).toBe(false)
  })

  it('falhas fora da janela de 15 minutos não contam', () => {
    expect(limiteExcedido([falha(20), falha(21), falha(22), falha(23), falha(24)], agora)).toBe(false)
  })

  it('um sucesso zera a contagem', () => {
    const t = [falha(10), falha(9), { em: new Date(agora.getTime() - 8 * 60_000), sucesso: true }, falha(2)]
    expect(limiteExcedido(t, agora)).toBe(false)
  })
})
