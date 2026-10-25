import { describe, expect, it } from 'vitest'
import { lerColagem } from './colagem'

/**
 * Leitura de formato é o único lugar do front em que um erro vira dado errado
 * no banco de uma clínica — e ele entra 2.000 linhas de uma vez.
 */
describe('lerColagem', () => {
  it('lê uma planilha colada, com tabulação', () => {
    const r = lerColagem('Maria Souza\t(71) 98812-4410\t12/03/1988\t04/02/2026')
    expect(r).toEqual([
      {
        nome: 'Maria Souza',
        telefone: '(71) 98812-4410',
        aniversario: '12/03/1988',
        ultimaConsulta: '04/02/2026',
      },
    ])
  })

  it('lê o CSV brasileiro, com ponto e vírgula', () => {
    expect(lerColagem('Ana Lima;71999990000')).toEqual([
      { nome: 'Ana Lima', telefone: '71999990000' },
    ])
  })

  /**
   * Sem isto, a primeira linha vira uma paciente chamada "Nome completo": o
   * nome NÃO está vazio, então o servidor a aceita — e, como a importação é
   * idempotente, ela reaparece intacta em toda reimportação.
   */
  it('descarta o CABEÇALHO da planilha, com acento e em qualquer caixa', () => {
    expect(lerColagem('NOME COMPLETO;Telefone\nAna Lima;71999990000')).toEqual([
      { nome: 'Ana Lima', telefone: '71999990000' },
    ])
    expect(lerColagem('Paciente\tTelefone\nAna Lima')).toEqual([{ nome: 'Ana Lima' }])
  })

  it('não descarta uma paciente que por acaso se chame como uma coluna seguinte', () => {
    // "Telefone" não é cabeçalho de PRIMEIRA coluna; só a primeira decide.
    expect(lerColagem('Telefone Silva;71999990000')).toEqual([
      { nome: 'Telefone Silva', telefone: '71999990000' },
    ])
  })

  it('linha sem nome é ignorada, e não derruba as boas', () => {
    expect(lerColagem('Maria\n;71999990000\n\nAna')).toEqual([{ nome: 'Maria' }, { nome: 'Ana' }])
  })

  /**
   * "Souza, Maria" numa célula de nome viraria duas colunas, e a paciente
   * entraria como "Souza" com telefone "Maria". Vírgula NÃO separa.
   */
  it('vírgula não separa colunas', () => {
    expect(lerColagem('Souza, Maria')).toEqual([{ nome: 'Souza, Maria' }])
  })

  it('campo vazio no meio não vira string vazia', () => {
    expect(lerColagem('Ana;;12/03/1988')).toEqual([{ nome: 'Ana', aniversario: '12/03/1988' }])
  })

  /**
   * As datas seguem COMO VIERAM. Converter `dd/mm/aaaa` aqui seria uma segunda
   * interpretação de data, e a primeira divergência apareceria numa planilha
   * com mês e dia trocados — calada, num cadastro de paciente.
   */
  it('a data não é interpretada aqui', () => {
    expect(lerColagem('Ana;;31/12/1990')[0]?.aniversario).toBe('31/12/1990')
  })

  it('aceita CRLF, que é o que o Windows cola', () => {
    expect(lerColagem('Maria\r\nAna\r\n')).toEqual([{ nome: 'Maria' }, { nome: 'Ana' }])
  })

  it('texto vazio não é uma importação', () => {
    expect(lerColagem('')).toEqual([])
    expect(lerColagem('\n\n  \n')).toEqual([])
  })
})
