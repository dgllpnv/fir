import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aceitaPagamento,
  ehAtendimento,
  ehContato,
  ehPagamento,
  ehReceita,
  esquecerTiposDesconhecidos,
  infoDoTipo,
  TIPO_ANTIGO,
  TIPO_PAGAMENTO_DE_ORCAMENTO,
  TIPOS,
  TIPOS_DE_CONTATO,
  TIPOS_DE_RECEITA,
  TIPOS_PAGAVEIS,
  tipoAoConcluir,
  tiposDesconhecidosAvistados,
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

/**
 * O fallback de `infoDoTipo` era SILENCIOSO: nome desconhecido devolvia um
 * `InfoDoTipo` sem flag nenhuma, `ehReceita` virava `false` e o pagamento
 * saía da receita sem um único erro. Na migração das 4 clínicas é o cenário
 * provável — um acento, uma maiúscula, um espaço no fim — e a regra 28 exige
 * que os totais batam EXATAMENTE.
 */
describe('tipo desconhecido avisa, e não lança', () => {
  let aviso: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    esquecerTiposDesconhecidos()
    aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    aviso.mockRestore()
    esquecerTiposDesconhecidos()
  })

  it('avisa no console, nomeando o tipo e a consequência', () => {
    infoDoTipo('Pagamento de orcamento')
    expect(aviso).toHaveBeenCalledTimes(1)
    const mensagem = String(aviso.mock.calls[0]?.[0])
    // O nome exato, entre aspas, para quem for procurar no dado de origem.
    expect(mensagem).toContain('"Pagamento de orcamento"')
    // E a consequência, porque "tipo desconhecido" não diz a ninguém que o
    // faturamento do mês está subnotificado.
    expect(mensagem).toContain('receita')
  })

  it('NÃO lança: o legado migrado precisa continuar legível', () => {
    expect(() => infoDoTipo('Nome que nunca existiu')).not.toThrow()
    expect(infoDoTipo('Nome que nunca existiu').nome).toBe('Nome que nunca existiu')
    expect(ehReceita({ tipo: 'Nome que nunca existiu', valor: 15_000n })).toBe(false)
  })

  it('o aviso do mesmo nome sai UMA vez — log ilegível é igual a silêncio', () => {
    for (let i = 0; i < 500; i++) ehReceita({ tipo: 'Orçamento Fechado', valor: 1n })
    expect(aviso).toHaveBeenCalledTimes(1)
    expect(tiposDesconhecidosAvistados()).toEqual(['Orçamento Fechado'])
  })

  it('quando o nome está em TIPO_ANTIGO, o aviso diz para qual traduzir', () => {
    infoDoTipo('Orçamento fechado')
    const mensagem = String(aviso.mock.calls[0]?.[0])
    expect(mensagem).toContain('"Pagamento de orçamento"')
    expect(mensagem).toContain('TIPO_ANTIGO')
  })

  it('tipo CONHECIDO não avisa nada', () => {
    for (const t of TIPOS) infoDoTipo(t.nome)
    expect(aviso).not.toHaveBeenCalled()
    expect(tiposDesconhecidosAvistados()).toEqual([])
  })
})

/**
 * **AS TRÊS LISTAS QUE O SQL DOS INDICADORES USA.**
 *
 * Elas existem para que `count(*) FILTER (WHERE t.tipo = ANY($1))` faça no
 * banco a mesma pergunta que `ehContato` faz em TypeScript. O teste compara as
 * duas implementações membro a membro: uma lista escrita à mão passaria o dia
 * em que um tipo novo entrasse em `TIPOS`, e o indicador do mês devolveria um
 * número a menos sem erro nenhum.
 */
describe('as listas derivadas, para o SQL dos indicadores', () => {
  it('TIPOS_DE_CONTATO é exatamente `ehContato`, membro a membro', () => {
    for (const t of TIPOS) {
      expect(TIPOS_DE_CONTATO.includes(t.nome), t.nome).toBe(
        ehContato({ tipo: t.nome, valor: 0n }),
      )
    }
    expect(TIPOS_DE_CONTATO.length).toBeGreaterThan(0)
  })

  it('TIPOS_DE_RECEITA é exatamente `ehPagamento`, e tem os cinco do grupo', () => {
    for (const t of TIPOS) expect(TIPOS_DE_RECEITA.includes(t.nome), t.nome).toBe(ehPagamento(t.nome))
    expect([...TIPOS_DE_RECEITA].sort()).toEqual(
      [
        'Pagamento de consulta',
        'Pagamento de orçamento',
        'Pagamento de saldo em aberto',
        'Sinal de consulta',
      ].sort(),
    )
  })

  it('TIPOS_PAGAVEIS é exatamente `aceitaPagamento`', () => {
    for (const t of TIPOS)
      expect(TIPOS_PAGAVEIS.includes(t.nome), t.nome).toBe(aceitaPagamento(t.nome))
  })

  /**
   * O que faz `contatos` contar só contato com PACIENTE: a tarefa interna tem
   * `tipo = ''`, e `''` não está na lista — embora `ehContato('')` seja true.
   * A divergência é deliberada e está escrita em `indicadores.service.ts`.
   */
  it('a tarefa INTERNA (`tipo: ""`) NÃO está em TIPOS_DE_CONTATO', () => {
    expect(ehContato({ tipo: '', valor: 0n })).toBe(true)
    expect(TIPOS_DE_CONTATO.includes('')).toBe(false)
  })

  it('TIPO_PAGAMENTO_DE_ORCAMENTO é um nome que existe na tabela', () => {
    expect(TIPOS.some((t) => t.nome === TIPO_PAGAMENTO_DE_ORCAMENTO)).toBe(true)
    expect(ehPagamento(TIPO_PAGAMENTO_DE_ORCAMENTO)).toBe(true)
  })
})
