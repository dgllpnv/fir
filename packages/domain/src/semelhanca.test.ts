import { describe, expect, it } from 'vitest'
import {
  SEMELHANCA_CONFIAVEL,
  SEMELHANCA_SUGESTAO,
  normalizarNome,
  palavrasDoNome,
  semelhancaDeNome,
} from './semelhanca'

/**
 * O casamento do produto da nota com o item do catálogo.
 *
 * O que este arquivo protege: a nota diz `TIRZEPATIDA 5MG/0,5ML SOL INJ AMP` e
 * o item chama-se `Tirzepatida 5 mg`. O casamento é **sugestão**, e a tela diz
 * à pessoa *por que* sugeriu — "nome parecido" ou "sugestão: confira". A
 * diferença entre as duas frases é a diferença entre ela conferir e não
 * conferir.
 */
describe('normalizarNome — a mesma forma de `normalizar_nome` no Postgres', () => {
  it('minúsculas, sem acento, espaços colapsados', () => {
    expect(normalizarNome('  Tirzepatida   5 MG ')).toBe('tirzepatida 5 mg')
    expect(normalizarNome('Injeção Água Ação')).toBe('injecao agua acao')
  })
})

describe('palavrasDoNome', () => {
  it('descarta as de uma letra e as preposições', () => {
    // "Tirzepatida 5 mg" e "Tirzepatida de 5 mg" têm de dar o mesmo conjunto,
    // senão o "de" baixa a nota de um casamento certo.
    expect(palavrasDoNome('Tirzepatida 5 mg')).toEqual(['tirzepatida', 'mg'])
    expect(palavrasDoNome('Tirzepatida de 5 mg')).toEqual(['tirzepatida', 'mg'])
  })

  it('pontuação vira separador', () => {
    expect(palavrasDoNome('TIRZEPATIDA 5MG/0,5ML SOL INJ AMP')).toEqual([
      'tirzepatida',
      '5mg',
      '5ml',
      'sol',
      'inj',
      'amp',
    ])
  })
})

describe('semelhancaDeNome — inteiro de 0 a 100, assimétrico de propósito', () => {
  it('o nome inteiro dentro da descrição longa é 100', () => {
    // A medida é ASSIMÉTRICA: é a fração das palavras DO ITEM que aparecem na
    // nota. As descrições de nota são longas e cheias de palavra que não é
    // nome ("S/AGULHA"), e dividir pelo tamanho da descrição puniria o
    // casamento certo.
    expect(semelhancaDeNome('Seringa descartável', 'SERINGA DESCARTAVEL 5ML S/AGULHA')).toBe(100)
  })

  it('a UNIDADE COLADA no número não casa, e isso baixa a nota — medido', () => {
    /**
     * `Seringa descartável 5 ml` contra `SERINGA DESCARTAVEL 5ML S/AGULHA`
     * dá **67**, não 100: `ml` não casa com `5ml` porque o casamento por
     * prefixo exige três letras dos dois lados — e é esse mesmo limite que
     * impede `ml` de casar com `mg`.
     *
     * Fica registrado porque é a diferença entre "nome parecido" e "sugestão:
     * confira" em metade do catálogo de uma clínica, e porque é exatamente o
     * comportamento do protótipo. Afrouxar o prefixo para duas letras subiria
     * esta nota e faria `mg` casar com `ml` — a troca não vale.
     */
    expect(semelhancaDeNome('Seringa descartável 5 ml', 'SERINGA DESCARTAVEL 5ML S/AGULHA')).toBe(67)
  })

  it('casa por PREFIXO com três letras ou mais — `ampola` com `amp`', () => {
    expect(semelhancaDeNome('Ampola de vidro', 'AMP VIDRO INCOLOR')).toBe(100)
  })

  it('NÃO casa `mg` com `ml` — duas letras não casam por prefixo', () => {
    // É este limite que impede a dose em miligramas de casar com o volume em
    // mililitros, que é a confusão que acaba em dose errada.
    expect(semelhancaDeNome('Soro 10 ml', 'DIPIRONA 10 MG COMPRIMIDO')).toBeLessThan(
      SEMELHANCA_SUGESTAO,
    )
  })

  it('a MEDIDA do protótipo: metade das palavras do item é "sugestão: confira"', () => {
    // `tirzepatida` casa; `mg` não casa com `5mg`. Uma de duas = 50%.
    const s = semelhancaDeNome('Tirzepatida 5 mg', 'TIRZEPATIDA 5MG/0,5ML SOL INJ AMP')
    expect(s).toBe(50)
    expect(s).toBeGreaterThanOrEqual(SEMELHANCA_SUGESTAO)
    expect(s).toBeLessThan(SEMELHANCA_CONFIAVEL)
  })

  it('nada em comum é zero, e nome vazio é zero — nunca um casamento', () => {
    expect(semelhancaDeNome('Tirzepatida 5 mg', 'TAXA DE ENTREGA')).toBe(0)
    expect(semelhancaDeNome('', 'QUALQUER COISA')).toBe(0)
    expect(semelhancaDeNome('Tirzepatida', '')).toBe(0)
  })

  it('é INTEIRO, sempre — o número cruza a fronteira HTTP', () => {
    // Um `0.7499999999999999` compararia diferente dos dois lados.
    for (const descricao of ['TIRZEPATIDA AMP', 'SERINGA', 'TIRZEPATIDA 5 MG AMP']) {
      const s = semelhancaDeNome('Tirzepatida 5 mg ampola', descricao)
      expect(Number.isInteger(s)).toBe(true)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(100)
    }
  })
})
