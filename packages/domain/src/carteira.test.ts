import { describe, expect, it } from 'vitest'
import { criarUsuarioDeGestao, podeVerGrupo } from './carteira'

describe('criarUsuarioDeGestao: a invariante de Escopo', () => {
  it('escopo=grupo sem grupoId lança', () => {
    expect(() =>
      criarUsuarioDeGestao({ id: 'u1', escopo: 'grupo', grupoId: null, ativo: true }),
    ).toThrow(/grupoId/)
  })

  it('escopo=geral com grupoId lança', () => {
    expect(() =>
      criarUsuarioDeGestao({ id: 'u1', escopo: 'geral', grupoId: 'g1', ativo: true }),
    ).toThrow(/grupoId/)
  })

  it('escopo=grupo com grupoId é aceito', () => {
    const u = criarUsuarioDeGestao({ id: 'u1', escopo: 'grupo', grupoId: 'g1', ativo: true })
    expect(u).toEqual({ id: 'u1', escopo: 'grupo', grupoId: 'g1', ativo: true })
  })

  it('escopo=geral sem grupoId é aceito', () => {
    const u = criarUsuarioDeGestao({ id: 'u1', escopo: 'geral', grupoId: null, ativo: true })
    expect(u.grupoId).toBeNull()
  })
})

describe('podeVerGrupo', () => {
  it('escopo=geral vê qualquer grupo', () => {
    const u = criarUsuarioDeGestao({ id: 'u1', escopo: 'geral', grupoId: null, ativo: true })
    expect(podeVerGrupo(u, 'g1')).toBe(true)
    expect(podeVerGrupo(u, 'g2')).toBe(true)
  })

  it('escopo=grupo vê só o próprio', () => {
    const u = criarUsuarioDeGestao({ id: 'u1', escopo: 'grupo', grupoId: 'g1', ativo: true })
    expect(podeVerGrupo(u, 'g1')).toBe(true)
    expect(podeVerGrupo(u, 'g2')).toBe(false)
  })

  it('P-12: inativo nunca vê nada, nem o próprio grupo nem escopo geral', () => {
    const doGrupo = criarUsuarioDeGestao({ id: 'u1', escopo: 'grupo', grupoId: 'g1', ativo: false })
    expect(podeVerGrupo(doGrupo, 'g1')).toBe(false)

    const geral = criarUsuarioDeGestao({ id: 'u2', escopo: 'geral', grupoId: null, ativo: false })
    expect(podeVerGrupo(geral, 'g1')).toBe(false)
  })
})
