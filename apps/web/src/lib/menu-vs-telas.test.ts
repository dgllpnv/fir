import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MENU } from './menu'

/**
 * O `epico` de cada item do menu diz se a tela existe (`null`) ou qual épico a
 * constrói. Esse campo é uma afirmação sobre o disco, e afirmação sobre o disco
 * envelhece em silêncio: quem construir `Tarefas` no épico 2 e esquecer de
 * trocar `epico: 2` por `epico: null` deixa a tela nova inalcançável — a rota
 * cai no catch-all e segue dizendo "ainda não construída", com a tela pronta
 * logo ali.
 *
 * Esta varredura compara os dois lados. É o mesmo padrão das varreduras de RLS:
 * confrontar a declaração com o estado real, em vez de confiar numa lista.
 */
const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', '(app)')

const temPagina = (href: string): boolean =>
  existsSync(join(APP, href.replace(/^\//, ''), 'page.tsx'))

describe('o menu não mente sobre quais telas existem', () => {
  it('a varredura olhou o menu inteiro', () => {
    expect(MENU.length, 'MENU vazio — a varredura não verificaria nada').toBeGreaterThan(10)
  })

  it('item com epico: null tem página no disco', () => {
    const mentem = MENU.filter((i) => i.epico === null && !temPagina(i.href))
    expect(
      mentem.map((i) => i.href),
      'declarado como pronto, mas sem page.tsx — a rota cairia no catch-all e seria notFound()',
    ).toEqual([])
  })

  it('item com epico numerado NÃO tem página no disco', () => {
    const atrasados = MENU.filter((i) => i.epico !== null && temPagina(i.href))
    expect(
      atrasados.map((i) => i.href),
      'a tela foi construída mas o menu ainda diz "ainda não construída": troque o epico por null',
    ).toEqual([])
  })

  it('toda promessa é uma frase de verdade, não um rótulo repetido', () => {
    for (const i of MENU) {
      expect(i.promessa.length, `promessa de ${i.href} curta demais`).toBeGreaterThan(30)
      expect(i.promessa.endsWith('.'), `promessa de ${i.href} não termina em ponto`).toBe(true)
    }
  })
})
