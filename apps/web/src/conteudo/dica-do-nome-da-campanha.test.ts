import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DICA_DO_NOME_DA_CAMPANHA } from './dica-do-nome-da-campanha'
import { MANUAL } from './manual'

/** L-A3-12 · a dica é obrigatória no cadastro de campanha, e o MANUAL a repete. */
describe('dica do nome da campanha (L-A3-12)', () => {
  it('a frase é a do gate, palavra por palavra', () => {
    expect(DICA_DO_NOME_DA_CAMPANHA).toBe(
      'Não use nome de medicamento ou de condição de saúde no nome da campanha.',
    )
  })

  it('o MANUAL a repete na seção "Criar uma campanha"', () => {
    const secao = MANUAL.flatMap((c) => c.secoes).find((s) => s.titulo === 'Criar uma campanha')
    expect(secao?.texto).toContain(DICA_DO_NOME_DA_CAMPANHA)
  })

  it('o formulário mostra a dica SEMPRE, junto do campo Nome — não atrás de ícone', () => {
    const aqui = dirname(fileURLToPath(import.meta.url))
    const fonte = readFileSync(join(aqui, '../components/tela-campanhas.tsx'), 'utf8')
    expect(fonte).toMatch(
      /Nome\s*<input[\s\S]*?aria-describedby="dica-nome-da-campanha"[\s\S]*?<small id="dica-nome-da-campanha">\{DICA_DO_NOME_DA_CAMPANHA\}<\/small>\s*<\/label>/,
    )
  })
})
