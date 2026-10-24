import { describe, expect, it } from 'vitest'
import { nomesForaDoPadrao } from './nome-de-migration'

describe('nomesForaDoPadrao', () => {
  it('aceita o padrão correto', () => {
    expect(nomesForaDoPadrao(['0001_fundacao.sql', '0002_identidade.sql'])).toEqual([])
  })

  /**
   * Achado 7 da re-revisão: `0009_Prova.SQL` escapava porque o antigo
   * `readdir(...).filter(f => f.endsWith('.sql'))` rodava ANTES desta
   * checagem e descartava o arquivo em silêncio — nunca chegava a ser
   * testado contra `NOME_DE_MIGRATION`. Com a validação recebendo a lista
   * crua do diretório, a extensão maiúscula precisa ser RECUSADA, nomeando o
   * arquivo, em vez de sumir sem aviso.
   */
  it('recusa extensão maiúscula (.SQL) em vez de ignorar em silêncio', () => {
    expect(nomesForaDoPadrao(['0001_fundacao.sql', '0009_Prova.SQL'])).toEqual(['0009_Prova.SQL'])
  })

  it('recusa nome com maiúscula no corpo', () => {
    expect(nomesForaDoPadrao(['0004_Relatorios.sql'])).toEqual(['0004_Relatorios.sql'])
  })

  it('recusa prefixo numérico fora de quatro dígitos', () => {
    expect(nomesForaDoPadrao(['10_relatorios.sql', '9_x.sql'])).toEqual(['10_relatorios.sql', '9_x.sql'])
  })

  it('recusa espaço no nome', () => {
    expect(nomesForaDoPadrao(['0001_com espaco.sql'])).toEqual(['0001_com espaco.sql'])
  })

  it('recusa extensão ausente ou diferente', () => {
    expect(nomesForaDoPadrao(['0001_fundacao', '0001_fundacao.txt'])).toEqual([
      '0001_fundacao',
      '0001_fundacao.txt',
    ])
  })

  it('lista vazia não acusa nada fora do padrão', () => {
    expect(nomesForaDoPadrao([])).toEqual([])
  })
})
