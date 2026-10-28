import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { REGEX_USUARIO, canonizarUsuario, validarUsuario } from './usuario'
import { ehErro, ehOk } from './resultado'

describe('canonizarUsuario', () => {
  it('dobra caixa, tira acento e apara as pontas', () => {
    expect(canonizarUsuario('  Ana.Sílva  ')).toBe('ana.silva')
  })

  it('não inventa: espaço continua espaço, e espaço é inválido', () => {
    // A canonização NÃO conserta o que o humano digitou errado. Trocar espaço
    // por ponto em silêncio criaria `ana.silva` a partir de "Ana Silva", e a
    // pessoa nunca saberia qual é o próprio usuário.
    expect(canonizarUsuario('Ana Silva')).toBe('ana silva')
    expect(ehErro(validarUsuario('ana silva'))).toBe(true)
  })
})

describe('validarUsuario', () => {
  it.each(['ana', 'ana.silva', 'recepcao2', 'maria-jose', 'j_p', 'a'.repeat(32)])(
    'aceita %s',
    (u) => expect(ehOk(validarUsuario(u))).toBe(true),
  )

  it.each([
    ['', 'VAZIO'],
    ['ab', 'CURTO'],
    ['a'.repeat(33), 'LONGO'],
    ['Ana', 'FORMA'], // quem valida recebe o canônico; maiúscula é defeito de quem chamou
    ['ana silva', 'FORMA'],
    ['ana..silva', 'FORMA'], // dois separadores seguidos
    ['ana.', 'FORMA'], // separador no fim
    ['.ana', 'FORMA'], // separador no começo
    ['1ana', 'FORMA'], // não começa por letra
    ['ana@clinica', 'FORMA'], // o e-mail não entra por acidente
    ['aná', 'FORMA'],
  ])('recusa %s com %s', (u, codigo) => {
    const r = validarUsuario(u)
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe(codigo)
  })

  it('canonizar é idempotente, e todo canônico aceito casa o regex', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (s) => {
        const uma = canonizarUsuario(s)
        expect(canonizarUsuario(uma)).toBe(uma)
        if (ehOk(validarUsuario(uma))) expect(uma).toMatch(REGEX_USUARIO)
      }),
    )
  })
})
