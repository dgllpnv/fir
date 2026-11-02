import { describe, expect, it } from 'vitest'
import {
  CHAVE_DA_CLINICA,
  CLINICA_DE_DESENVOLVIMENTO,
  clinicaDoParametro,
  clinicaInicial,
} from './clinica-do-link'

describe('a clínica vem do LINK (?clinica=codigo)', () => {
  it('lê o código do parâmetro, com ou sem interrogação na frente', () => {
    expect(clinicaDoParametro('?clinica=raphaella')).toBe('raphaella')
    expect(clinicaDoParametro('clinica=raphaella')).toBe('raphaella')
    expect(clinicaDoParametro('?pagina=2&clinica=institutorp&x=1')).toBe('institutorp')
  })

  it('canoniza o que o favorito guardou: caixa, espaço e acento', () => {
    // O link vive num favorito digitado há dois anos. `RAPHAELLA` e
    // ` raphaella ` são a mesma clínica, e a forma canônica é a do banco.
    expect(clinicaDoParametro('?clinica=RAPHAELLA')).toBe('raphaella')
    expect(clinicaDoParametro('?clinica=%20Raphaella%20')).toBe('raphaella')
    expect(clinicaDoParametro('?clinica=institutorp')).toBe('institutorp')
  })

  it('aceita as formas que o código de clínica de fato tem', () => {
    // Mesmo alfabeto do identificador de login (CONTEXT.md): letra, depois
    // alfanuméricos, com `.`/`_`/`-` separando.
    for (const c of ['drasuzanalima', 'dra.joice', 'clinica-2', 'inst_rp']) {
      expect(clinicaDoParametro(`?clinica=${c}`), c).toBe(c)
    }
  })

  it('parâmetro fora da forma canônica é IGNORADO, nunca pré-selecionado', () => {
    // Um código que o banco não aceitaria viraria "Usuário ou senha
    // incorretos" sem ninguém entender por quê — e a recepcionista jura que
    // abriu o link certo. Melhor a tela abrir pedindo o código.
    for (const lixo of [
      '?clinica=',
      '?clinica=ab',
      '?clinica=-raphaella',
      '?clinica=raphaella.',
      '?clinica=raphaella..rp',
      '?clinica=clínica/outra',
      '?clinica=' + 'a'.repeat(33),
      '?outra=raphaella',
      '',
    ]) {
      expect(clinicaDoParametro(lixo), lixo).toBe('')
    }
  })
})

describe('qual clínica a tela abre', () => {
  it('o link VENCE o que o aparelho lembra', () => {
    // Quem abriu o link de outra clínica quis a outra clínica. A memória é
    // conveniência; o link é intenção.
    expect(clinicaInicial('?clinica=raphaella', 'institutorp')).toBe('raphaella')
  })

  it('sem link, o aparelho lembra a última — é o que o protótipo faz', () => {
    // "Depois do primeiro acesso, o aparelho lembra a clínica" (MANUAL,
    // cap. 1). O computador do balcão é de uma clínica só.
    expect(clinicaInicial('', 'institutorp')).toBe('institutorp')
    expect(clinicaInicial('?clinica=nao@vale', 'institutorp')).toBe('institutorp')
  })

  it('memória fora da forma canônica não pré-seleciona nada', () => {
    // `localStorage` é escrevível por qualquer script da origem e sobrevive a
    // versões antigas da tela. Passa pelo mesmo portão do parâmetro.
    expect(clinicaInicial('', 'NÃO VALE')).toBe(CLINICA_DE_DESENVOLVIMENTO)
    expect(clinicaInicial('', null)).toBe(CLINICA_DE_DESENVOLVIMENTO)
  })

  it('a chave da memória é estável — trocá-la esquece a clínica de 4 clínicas', () => {
    expect(CHAVE_DA_CLINICA).toBe('fir.clinica')
  })
})
