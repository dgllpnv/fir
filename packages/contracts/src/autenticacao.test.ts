import { describe, expect, it } from 'vitest'
import {
  CadastrarMeuEmailEntrada,
  CriarPessoaEntrada,
  dinheiroEmTexto,
  EditarPessoa,
  EntrarEntrada,
  EsqueciSenhaEntrada,
  PessoaCriada,
  TokenDeLink,
  UsarLinkEntrada,
} from './index'

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

  it('o campo é "usuário ou e-mail": com @, canoniza como e-mail e o @ sobrevive', () => {
    // ADR 2026-11-16, appsec 10: o ramo do @ é decidido ANTES de
    // `canonizarUsuario`, que não preserva o e-mail. O corpo continua com os
    // mesmos três campos — não há um campo `email` à parte.
    const r = EntrarEntrada.parse({ clinica: 'demo', usuario: '  Ana.Souza@Gmail.COM ', senha: 'x' })
    expect(r.usuario).toBe('ana.souza@gmail.com')
    expect(Object.keys(r).sort()).toEqual(['clinica', 'senha', 'usuario'])
  })

  it('sem @ continua sendo usuário, com a canonização de sempre', () => {
    expect(EntrarEntrada.parse({ clinica: 'demo', usuario: 'Ána', senha: 'x' }).usuario).toBe('ana')
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

describe('contratos do acesso por e-mail', () => {
  it('esqueci-senha canoniza o e-mail e recusa campo a mais', () => {
    expect(EsqueciSenhaEntrada.parse({ clinica: ' Demo ', email: ' Ana@X.com ' })).toEqual({
      clinica: 'demo',
      email: 'ana@x.com',
    })
    expect(EsqueciSenhaEntrada.safeParse({ clinica: 'demo', email: 'semarroba' }).success).toBe(false)
    expect(
      EsqueciSenhaEntrada.safeParse({ clinica: 'demo', email: 'a@x.com', usuario: 'ana' }).success,
    ).toBe(false)
  })

  it('o token do link é base64url de 32 bytes, e nada mais', () => {
    expect(TokenDeLink.safeParse('A'.repeat(43)).success).toBe(true)
    expect(TokenDeLink.safeParse('A'.repeat(42)).success).toBe(false)
    expect(TokenDeLink.safeParse(`${'A'.repeat(42)}%`).success).toBe(false)
  })

  it('usar o link aceita a senha opcional e recusa campo a mais', () => {
    expect(UsarLinkEntrada.safeParse({ token: 't' }).success).toBe(true)
    expect(UsarLinkEntrada.safeParse({ token: 't', senha: 'x', email: 'a@b.com' }).success).toBe(false)
  })

  it('o próprio e-mail exige a senha atual, e aceita null para retirar', () => {
    expect(CadastrarMeuEmailEntrada.safeParse({ email: 'a@b.com' }).success).toBe(false)
    expect(CadastrarMeuEmailEntrada.parse({ email: null, senha: 'x' }).email).toBeNull()
  })

  it('criar pessoa EXIGE o e-mail; editar aceita corrigir e retirar', () => {
    const base = { nome: 'Ana Souza', usuario: 'ana', acesso: { admin: true } }
    expect(CriarPessoaEntrada.safeParse(base).success).toBe(false)
    expect(CriarPessoaEntrada.parse({ ...base, email: 'Ana@X.com' }).email).toBe('ana@x.com')
    expect(EditarPessoa.parse({ email: null }).email).toBeNull()
    expect(EditarPessoa.safeParse({ email: 'ruim' }).success).toBe(false)
  })

  it('a pessoa criada é um caminho OU o outro: provisória sem convite, convite sem provisória', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      nome: 'Ana',
      usuario: 'ana',
      funcao: '',
      admin: false,
      perfilId: null,
      emailPendente: 'ana@x.com',
    }
    expect(
      PessoaCriada.safeParse({ ...base, convite: null, senhaProvisoria: 'a b c d', senhaProvisoriaExpiraEm: 'x' })
        .success,
    ).toBe(true)
    expect(
      PessoaCriada.safeParse({ ...base, convite: 'enviado', senhaProvisoria: null, senhaProvisoriaExpiraEm: null })
        .success,
    ).toBe(true)
    // Os dois juntos não existem: convite enviado E provisória em claro.
    expect(
      PessoaCriada.safeParse({ ...base, convite: 'enviado', senhaProvisoria: 'a b c d', senhaProvisoriaExpiraEm: 'x' })
        .success,
    ).toBe(false)
  })
})
