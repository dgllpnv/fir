import type { CarteiraEuComSegundoFatorSaida } from '@fir/contracts'
import { describe, expect, it } from 'vitest'
import { CAMINHO_SEGUNDO_FATOR_DA_CARTEIRA, destinoDepoisDeEntrar, precisaCadastrarSegundoFator } from './destino'

const eu = (senhaProvisoria: boolean, ativo: boolean, exigido: boolean): CarteiraEuComSegundoFatorSaida => ({
  usuarioDeGestao: {
    id: '00000000-0000-4000-8000-000000000001',
    usuario: 'gestora',
    nome: 'Gestora',
    escopo: 'geral',
    grupoId: null,
    senhaProvisoria,
    valores: false,
    carteira: 'todos',
    modulos: ['painel'],
    administrar: false,
    setor: null,
    funcao: null,
    telefone: null,
  },
  segundoFator: { ativo, exigido },
})

describe('para onde vai quem entra na carteira (ADR 0023)', () => {
  it('segundo fator desligado no servidor: nunca o cadastro, com ou sem TOTP ativo', () => {
    expect(precisaCadastrarSegundoFator(eu(false, false, false))).toBe(false)
    expect(destinoDepoisDeEntrar(eu(false, false, false))).toBe('/carteira')
    expect(destinoDepoisDeEntrar(eu(false, true, false))).toBe('/carteira')
  })

  it('ligado e sem TOTP: o cadastro — o comportamento da ADR 0022', () => {
    expect(precisaCadastrarSegundoFator(eu(false, false, true))).toBe(true)
    expect(destinoDepoisDeEntrar(eu(false, false, true))).toBe(CAMINHO_SEGUNDO_FATOR_DA_CARTEIRA)
    expect(destinoDepoisDeEntrar(eu(false, true, true))).toBe('/carteira')
  })

  it('a provisória vem antes de tudo', () => {
    expect(destinoDepoisDeEntrar(eu(true, false, true))).toBe('/carteira/trocar-senha')
    expect(destinoDepoisDeEntrar(eu(true, false, false))).toBe('/carteira/trocar-senha')
  })
})
