import { describe, expect, it } from 'vitest'
import { dinheiroEmTexto, EntrarEntrada } from './index'

describe('EntrarEntrada', () => {
  it('aceita clínica, usuário e senha, canonizando os dois primeiros', () => {
    const r = EntrarEntrada.parse({
      clinica: '  Demo ',
      usuario: '  Helena ',
      senha: 'quatro-pedras-no-caminho',
    })
    expect(r.clinica).toBe('demo')
    expect(r.usuario).toBe('helena')
  })

  it('perdoa o que o teclado do tablet entrega: caixa, acento e espaço nas pontas', () => {
    // O corretor maiusculiza a primeira letra e a colagem traz espaço. Isso
    // não pode custar um chamado de suporte — e, mais do que isso: o canônico
    // é o que segue para `tentativas_login`, e é ele que faz o limite por
    // conta contar as três grafias como UMA.
    for (const digitado of ['Helena', '  HELENA ', 'heléna', 'HeLeNa']) {
      const r = EntrarEntrada.parse({ clinica: 'demo', usuario: digitado, senha: 'x' })
      expect(r.usuario, digitado).toBe('helena')
    }
  })

  it('a ENTRADA não aplica a regra de força da senha', () => {
    // Quem tem uma senha antiga de oito caracteres precisa conseguir entrar
    // para poder trocá-la. Aplicar a política aqui tranca pessoas para fora
    // por uma mudança de política. A regra vale na criação e na troca.
    expect(EntrarEntrada.safeParse({ clinica: 'demo', usuario: 'ana', senha: 'curta' }).success).toBe(
      true,
    )
  })

  it('recusa usuário vazio, senha vazia e clínica vazia', () => {
    const base = { clinica: 'demo', usuario: 'ana', senha: 'uma-senha-qualquer' }
    expect(EntrarEntrada.safeParse({ ...base, usuario: '   ' }).success).toBe(false)
    expect(EntrarEntrada.safeParse({ ...base, senha: '' }).success).toBe(false)
    expect(EntrarEntrada.safeParse({ ...base, clinica: '   ' }).success).toBe(false)
  })

  it('recusa senha acima do teto de entrada do Argon2', () => {
    const base = { clinica: 'demo', usuario: 'ana' }
    expect(EntrarEntrada.safeParse({ ...base, senha: 'a'.repeat(201) }).success).toBe(false)
  })

  it('não há campo de e-mail: o produto inteiro deixou de ter um', () => {
    const r = EntrarEntrada.parse({ clinica: 'demo', usuario: 'ana', senha: 'x' })
    expect(Object.keys(r).sort()).toEqual(['clinica', 'senha', 'usuario'])
  })
})

describe('dinheiroEmTexto', () => {
  it('serializa centavos como string, para o JSON não perder precisão', () => {
    // JSON.stringify(10n) lança; Number(centavos) perde precisão acima de 2^53.
    // O contrato trafega string e o cliente nunca faz aritmética com ela.
    expect(dinheiroEmTexto.parse('125050')).toBe(125050n)
    expect(dinheiroEmTexto.parse(null)).toBe(null)
  })

  it('recusa texto que não é inteiro', () => {
    expect(dinheiroEmTexto.safeParse('1250.50').success).toBe(false)
  })
})
