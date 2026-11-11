import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * A tela de Usuários e acessos depois do ADR 2026-11-11 — varredura sobre a
 * FONTE (não há Testing Library na árvore, dívida registrada). O servidor é a
 * barreira; estes testes seguram a conveniência e os textos que a LGPD exige.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
const ler = (...p: string[]) => readFileSync(join(AQUI, ...p), 'utf8')
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const USUARIOS = semComentarios(ler('tela-usuarios.tsx'))
const METAS = semComentarios(ler('tela-minhas-metas.tsx'))

describe('Usuários e acessos', () => {
  it('"Administradora" só aparece para quem é administradora (ou já edita uma)', () => {
    expect(USUARIOS).toMatch(/souAdmin \|\| \(p\?\.admin \?\? false\)/)
  })

  it('a criação manda `acesso` discriminado, e a recusa antiga do suporte sumiu', () => {
    expect(USUARIOS).toMatch(/acesso: acesso === '__admin' \? \{ admin: true \}/)
    expect(USUARIOS).not.toMatch(/Quem cria uma administradora é o suporte/)
  })

  it('conceder e retirar administração pedem confirmação que diz o que muda', () => {
    expect(USUARIOS).toMatch(/Administradora tem acesso total/)
    expect(USUARIOS).toMatch(/A clínica responde por quem escolhe/)
    expect(USUARIOS).toMatch(/derruba as sessões abertas/)
  })

  it('o perfil com pessoas.gerir avisa que enxerga salário', () => {
    expect(USUARIOS).toMatch(/Este perfil enxerga salário e dados de RH da equipe/)
  })

  it('a senha de administradora não oferece campo de escolha', () => {
    expect(USUARIOS).toMatch(/sempre gerada pelo sistema/)
  })

  it('o aviso da administradora nova diz só quem e quando', () => {
    expect(USUARIOS).toMatch(/administradora criada/)
    expect(USUARIOS).toMatch(/promovida a administradora/)
  })
})

describe('Minhas metas sem ficha de RH', () => {
  it('diz a mensagem do spec, sem citar permissão nem nome de pessoa', () => {
    expect(METAS).toMatch(/Você ainda não tem ficha de RH\./)
    expect(METAS).toMatch(/Quem cuida da equipe na clínica precisa criar a sua ficha para as metas aparecerem\./)
    expect(METAS).not.toMatch(/administrativo|outra permissão/)
  })

  it('o atalho "Ir para Equipe" só aparece para quem tem pessoas.gerir', () => {
    expect(METAS).toMatch(/podeGerirEquipe \? \(/)
    expect(METAS).toMatch(/Ir para Equipe/)
  })
})
