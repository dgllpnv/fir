import { describe, expect, it } from 'vitest'
import {
  aceitaPagamento,
  ehAtendimento,
  ehContato,
  ehPagamento,
  ehReceita,
  TIPO_ANTIGO,
  TIPOS,
  tipoAoConcluir,
} from './tipos-de-tarefa'

describe('classificação dos tipos', () => {
  it('o grupo Pagamentos é receita', () => {
    expect(ehPagamento('Pagamento de consulta')).toBe(true)
    expect(ehPagamento('Sinal de consulta')).toBe(true)
    expect(ehPagamento('Pagamento de orçamento')).toBe(true)
    expect(ehPagamento('Pagamento de saldo em aberto')).toBe(true)
  })

  it('atendimento com valor pago é receita; sem valor, não', () => {
    expect(ehReceita({ tipo: 'Consulta realizada', valor: 15000n })).toBe(true)
    expect(ehReceita({ tipo: 'Consulta realizada', valor: 0n })).toBe(false)
  })

  it('ORÇAMENTO NÃO É RECEITA — nem com valor', () => {
    expect(ehReceita({ tipo: 'Orçamento enviado', valor: 500000n })).toBe(false)
  })

  it('relacionamento é contato, atendimento e pagamento não são', () => {
    expect(ehContato({ tipo: 'Follow-up', valor: 0n })).toBe(true)
    expect(ehContato({ tipo: 'Aniversário', valor: 0n })).toBe(true)
    expect(ehContato({ tipo: 'Consulta realizada', valor: 0n })).toBe(false)
    expect(ehContato({ tipo: 'Pagamento de consulta', valor: 0n })).toBe(false)
  })

  it('conta como paciente atendido', () => {
    expect(ehAtendimento({ tipo: 'Consulta realizada', valor: 0n })).toBe(true)
    expect(ehAtendimento({ tipo: 'Sessão de plano', valor: 0n })).toBe(true)
    expect(ehAtendimento({ tipo: 'Consulta agendada', valor: 0n })).toBe(false)
  })

  it('o atendimento guarda o pagamento na própria tarefa', () => {
    expect(aceitaPagamento('Consulta realizada')).toBe(true)
    expect(aceitaPagamento('Procedimento realizado')).toBe(true)
    expect(aceitaPagamento('Sessão de plano')).toBe(true)
    expect(aceitaPagamento('Follow-up')).toBe(false)
  })
})

describe('agendado vira realizado — a mesma tarefa', () => {
  it('consulta e procedimento têm destino', () => {
    expect(tipoAoConcluir('Consulta agendada')).toBe('Consulta realizada')
    expect(tipoAoConcluir('Procedimento agendado')).toBe('Procedimento realizado')
  })

  it('tipo sem destino não muda', () => {
    expect(tipoAoConcluir('Follow-up')).toBe('Follow-up')
  })
})

describe('tipos de versões anteriores', () => {
  it('mapeiam para os atuais — a migração depende disto', () => {
    expect(TIPO_ANTIGO['Orçamento fechado']).toBe('Pagamento de orçamento')
    expect(TIPO_ANTIGO['Orçamento pago']).toBe('Pagamento de orçamento')
    expect(TIPO_ANTIGO['Recebimento de saldo']).toBe('Pagamento de saldo em aberto')
    expect(TIPO_ANTIGO['Agendamento']).toBe('Consulta agendada')
  })
})

describe('a tabela', () => {
  it('tem os 19 tipos do protótipo, sem repetição', () => {
    expect(TIPOS).toHaveLength(19)
    expect(new Set(TIPOS.map((t) => t.nome)).size).toBe(19)
  })

  it('todo destino de conclusão existe na tabela', () => {
    const nomes = new Set(TIPOS.map((t) => t.nome))
    for (const t of TIPOS) if (t.vira) expect(nomes.has(t.vira)).toBe(true)
  })
})
