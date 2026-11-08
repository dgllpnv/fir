import { describe, expect, it } from 'vitest'
import { escalaDaUnidade, lerCsv, lerMetasDoCsv, linhaVazia, metaDaLinha } from './checklist-metas-csv'

describe('lerCsv', () => {
  it('separador pelo cabeçalho, aspas com aspas dobradas, BOM e CRLF', () => {
    expect(lerCsv('﻿a;b\r\n"x;1";"di""z"\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['x;1', 'di"z'],
    ])
    expect(lerCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('escalaDaUnidade — sem ponto flutuante', () => {
  it('R$ em centavos, % em centésimos, un e dias inteiros', () => {
    expect(escalaDaUnidade('R$', '150.000,00')).toBe('15000000')
    expect(escalaDaUnidade('R$', 'R$ 19,99')).toBe('1999')
    expect(escalaDaUnidade('%', '12,5')).toBe('1250')
    expect(escalaDaUnidade('%', '35%')).toBe('3500')
    expect(escalaDaUnidade('un', '1.200')).toBe('1200')
    expect(escalaDaUnidade('dias', '7')).toBe('7')
    expect(escalaDaUnidade('un', '7,5')).toBeNull()
    expect(escalaDaUnidade('R$', 'muito')).toBeNull()
    expect(escalaDaUnidade('R$', '-10')).toBeNull()
  })
})

describe('lerMetasDoCsv — linhas inválidas recusadas com mensagem', () => {
  const csv = [
    'Meta;Indicador;Unidade;Tipo;Quando entrou;Hoje;Alvo;Prazo',
    'Faturamento mensal;Faturamento;R$;Mensal;100.000,00;120.000,00;150.000,00;',
    'Novos pacientes;;un;Com prazo;20;28;40;28/02/2027',
    'Ticket médio;;reais;Mensal;;;500;',
    ';;un;Mensal;;;10;',
    'Taxa de retorno;;%;Com prazo;;;35;',
    'Conversão;;%;Mensal;;;trinta;',
    'Prazo médio;;dias;Trimestral;;;5;',
  ].join('\n')

  it('aceita as válidas, já na escala do indicador, e recusa cada inválida com o número da linha', () => {
    const r = lerMetasDoCsv(csv)
    expect(r.erro).toBeNull()
    expect(r.linhas.map((l) => [l.titulo, l.unidade, l.tipo, l.prazo])).toEqual([
      ['Faturamento mensal', 'R$', 'mensal', ''],
      ['Novos pacientes', 'un', 'prazo', '2027-02-28'],
    ])
    expect(r.recusadas).toEqual([
      { linha: 4, motivo: 'unidade fora da lista (R$, %, un, dias)' },
      { linha: 5, motivo: 'falta o nome da meta' },
      { linha: 6, motivo: 'A meta com prazo precisa da data.' },
      { linha: 7, motivo: 'o alvo não é um número' },
      { linha: 8, motivo: 'tipo fora da lista (Mensal ou Com prazo)' },
    ])
    const primeira = metaDaLinha(r.linhas[0]!)
    expect(primeira).toEqual({
      ok: true,
      meta: {
        titulo: 'Faturamento mensal',
        indicador: 'Faturamento',
        unidade: 'R$',
        tipo: 'mensal',
        valorInicial: '10000000',
        valorAtual: '12000000',
        valorMeta: '15000000',
        prazo: null,
      },
    })
  })

  it('sem as colunas Meta e Alvo, o arquivo inteiro é recusado com motivo', () => {
    expect(lerMetasDoCsv('Nome;Valor\nx;1').erro).toBe('O arquivo precisa das colunas "Meta" e "Alvo".')
    expect(lerMetasDoCsv('Meta;Alvo').erro).toBe('O arquivo não tem cabeçalho e ao menos uma meta.')
  })

  it('a linha digitada na tabela passa pela mesma validação', () => {
    expect(metaDaLinha({ ...linhaVazia(), titulo: 'X' })).toEqual({ ok: false, motivo: 'falta o alvo' })
    expect(metaDaLinha({ ...linhaVazia(), titulo: 'X', valorMeta: '10', prazo: '31/02' })).toEqual({
      ok: false,
      motivo: 'o prazo não é uma data (use dd/mm/aaaa)',
    })
  })
})
