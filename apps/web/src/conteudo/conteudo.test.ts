import { describe, expect, it } from 'vitest'
import { AJUDA } from './ajuda'
import { MANUAL } from './manual'
import { rotuloDoCapitulo } from './busca'

/**
 * **A varredura de FIDELIDADE do conteúdo.**
 *
 * O texto é da PO, e a autoridade dele é a do protótipo (`CLAUDE.md` §1). O
 * que este arquivo protege são as duas coisas que um "ajuste rápido" quebra em
 * silêncio:
 *
 *  1. **A contagem** — 14 capítulos, 78 seções, 51 perguntas. Uma seção que
 *     alguém apague ao resolver um conflito não acusa nada sem isto.
 *  2. **A D-10** — nenhuma menção a PIN, a e-mail ou a convite sobrevive. O
 *     e-mail saiu do produto inteiro; um manual que ensina a trocar o PIN
 *     manda a recepção procurar um campo que não existe, e `identidade-sem-email`
 *     já cobra o mesmo do código.
 */
const tudoDaAjuda = AJUDA.map((p) => `${p.pergunta} ${p.resposta} ${p.chaves}`).join('\n')
const tudoDoManual = MANUAL.flatMap((c) =>
  c.secoes.map((s) => `${rotuloDoCapitulo(c)} ${s.titulo} ${s.texto}`),
).join('\n')
const TUDO = `${tudoDaAjuda}\n${tudoDoManual}`

describe('o conteúdo é o dela, inteiro', () => {
  it('14 capítulos, 78 seções, 51 perguntas', () => {
    expect(MANUAL).toHaveLength(14)
    expect(MANUAL.reduce((n, c) => n + c.secoes.length, 0)).toBe(78)
    expect(AJUDA).toHaveLength(51)
  })

  /**
   * **A MUTAÇÃO:** devolver os capítulos na ordem do array dela, em que o 13
   * vem antes do 12. O sumário lia "… 11, 13, 12, 14" — contra a numeração que
   * o próprio título de cada capítulo declara.
   */
  it('os capítulos vão de 1 a 14, em ordem, sem buraco e sem repetição', () => {
    expect(MANUAL.map((c) => c.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    expect(new Set(MANUAL.map((c) => c.id)).size).toBe(14)
  })

  it('nenhum capítulo sem seção, nenhuma seção sem texto', () => {
    for (const c of MANUAL) {
      expect(c.secoes.length, rotuloDoCapitulo(c)).toBeGreaterThan(0)
      expect(c.titulo.length, c.id).toBeGreaterThan(2)
      for (const s of c.secoes) {
        expect(s.titulo.length, `${c.id}/${s.titulo}`).toBeGreaterThan(2)
        expect(s.texto.length, `${c.id}/${s.titulo}`).toBeGreaterThan(40)
      }
    }
  })

  it('nenhuma pergunta sem resposta nem sem palavra-chave', () => {
    for (const p of AJUDA) {
      expect(p.pergunta.endsWith('?') || p.pergunta.endsWith('.'), p.pergunta).toBe(true)
      expect(p.resposta.length, p.pergunta).toBeGreaterThan(40)
      expect(p.chaves.split(' ').length, p.pergunta).toBeGreaterThan(2)
      // As chaves são de BUSCA: sem acento e sem maiúscula, como as dela.
      expect(p.chaves, p.pergunta).toBe(p.chaves.toLowerCase())
      expect(p.chaves.normalize('NFD'), p.pergunta).toBe(p.chaves)
    }
    expect(new Set(AJUDA.map((p) => p.pergunta)).size).toBe(AJUDA.length)
  })
})

describe('a D-10 alcançou o conteúdo', () => {
  /**
   * A mesma varredura de `teste/identidade-sem-email.test.ts`, do lado do
   * texto. O e-mail não existe no produto: não há coluna, não há convite, não
   * há SMTP — e um manual que o mencione é a instrução que sobra depois de a
   * coisa sair.
   */
  it('nenhuma menção a PIN', () => {
    const achados = AJUDA.filter((p) =>
      /\bPIN\b/i.test(`${p.pergunta} ${p.resposta} ${p.chaves}`),
    ).map((p) => p.pergunta)
    const noManual = MANUAL.flatMap((c) =>
      c.secoes.filter((s) => /\bPIN\b/i.test(`${s.titulo} ${s.texto}`)).map(
        (s) => `${rotuloDoCapitulo(c)} / ${s.titulo}`,
      ),
    )
    expect([...achados, ...noManual]).toEqual([])
  })

  it('nenhuma menção a e-mail nem a convite', () => {
    // `/\bconvite\b/` e não `convit`: "convidar" também é proibido, e o `\b`
    // pega os dois sem casar com palavra que só contém as letras.
    const proibidos = [/e-?mail/i, /\bconvites?\b/i, /\bconvid/i, /\bSMTP\b/i]
    for (const p of proibidos) {
      expect(p.test(TUDO) ? `achou ${p} no conteúdo` : 'ok').toBe('ok')
    }
  })

  /**
   * **A varredura tem DENTES.** Sem esta asserção, um conteúdo esvaziado
   * passaria nas duas acima — "nenhuma menção a PIN" é trivialmente verdadeiro
   * num texto vazio. O que entrou no lugar do PIN é a senha, e ela tem de
   * estar lá.
   */
  it('o que entrou no lugar: usuário, senha e senha provisória', () => {
    expect(TUDO).toContain('senha provisória')
    expect(TUDO).toContain('usuário')
    expect(TUDO).toContain('Trocar senha')
    // A D-0 corrigida: ninguém lê a senha de outra pessoa.
    expect(TUDO).toContain('ninguém lê a senha de outra pessoa')
  })
})
