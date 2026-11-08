import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  MAX_ENCAMINHAMENTOS,
  linhasDeEncaminhamento,
  materiaisParaOCliente,
  podeAdministrarConteudo,
  programaDoCliente,
  saudeDerivadaDoCliente,
} from './conteudo-carteira'
import { ehErro, ehOk } from './resultado'

describe('linhasDeEncaminhamento — "um por linha" (protótipo L1706)', () => {
  it('tira marcador de lista, número e espaço do começo, e descarta linha vazia', () => {
    const r = linhasDeEncaminhamento('• Ligar para a gerente\n\n2) Mandar a planilha\n - revisar metas  \n   ')
    expect(ehOk(r) && r.valor).toEqual(['Ligar para a gerente', 'Mandar a planilha', 'revisar metas'])
  })

  it('aceita CRLF do textarea do Windows', () => {
    const r = linhasDeEncaminhamento('a\r\nb')
    expect(ehOk(r) && r.valor).toEqual(['a', 'b'])
  })

  it('texto vazio é lista vazia, não erro', () => {
    const r = linhasDeEncaminhamento('')
    expect(ehOk(r) && r.valor).toEqual([])
  })

  it('recusa mais linhas do que o teto, em vez de criar tarefas em massa', () => {
    const texto = Array.from({ length: MAX_ENCAMINHAMENTOS + 1 }, (_, i) => `item ${i}`).join('\n')
    const r = linhasDeEncaminhamento(texto)
    expect(ehErro(r) && r.erro.codigo).toBe('ENCAMINHAMENTOS_DEMAIS')
  })

  it('recusa linha longa demais para virar título de tarefa', () => {
    const r = linhasDeEncaminhamento('x'.repeat(301))
    expect(ehErro(r) && r.erro.codigo).toBe('ENCAMINHAMENTO_LONGO')
  })

  it('propriedade: toda linha devolvida é não vazia, aparada e veio do texto', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 40 }), { maxLength: 20 }), (linhas) => {
        const r = linhasDeEncaminhamento(linhas.join('\n'))
        if (!ehOk(r)) return true
        return r.valor.every((l) => l.length > 0 && l === l.trim() && linhas.some((o) => o.includes(l)))
      }),
    )
  })
})

describe('saudeDerivadaDoCliente — PP-3: o registro mais recente entre checkin e reunião', () => {
  it('sem registro, sem saúde', () => {
    expect(saudeDerivadaDoCliente([])).toBeNull()
  })

  it('a reunião registrada depois do checkin decide', () => {
    expect(
      saudeDerivadaDoCliente([
        { em: '2026-11-01T10:00:00.000Z', saude: 'bom' },
        { em: '2026-11-03T10:00:00.000Z', saude: 'critico' },
      ]),
    ).toBe('critico')
  })

  it('reunião sem saúde registrada não apaga a saúde que havia', () => {
    expect(
      saudeDerivadaDoCliente([
        { em: '2026-11-01T10:00:00.000Z', saude: 'atencao' },
        { em: '2026-11-05T10:00:00.000Z', saude: null },
      ]),
    ).toBe('atencao')
  })

  it('não depende da ordem de entrada', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            em: fc.integer({ min: 0, max: 10_000 }).map((n) => new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString()),
            saude: fc.constantFrom('bom' as const, 'atencao' as const, 'critico' as const, null),
          }),
          { maxLength: 12 },
        ),
        (regs) => {
          // Instantes únicos: o empate não tem ordem definida, e a propriedade
          // é sobre a ordem de ENTRADA, não sobre empate.
          const unicos = [...new Map(regs.map((r) => [r.em, r])).values()]
          return saudeDerivadaDoCliente(unicos) === saudeDerivadaDoCliente([...unicos].reverse())
        },
      ),
    )
  })
})

describe('programaDoCliente — programaPadrao (protótipo L2205)', () => {
  it('Gestão por área ou por "Gestão FIR" no produto', () => {
    expect(programaDoCliente({ areaFoco: 'Gestão', produto: 'x' })).toBe('Gestão')
    expect(programaDoCliente({ areaFoco: null, produto: 'Gestão FIR Clinic' })).toBe('Gestão')
  })
  it('área que é programa vale como está; Processos e Pessoas viram Operações', () => {
    expect(programaDoCliente({ areaFoco: 'Financeiro', produto: '' })).toBe('Financeiro')
    expect(programaDoCliente({ areaFoco: 'Processos', produto: '' })).toBe('Operações')
    expect(programaDoCliente({ areaFoco: 'Pessoas', produto: '' })).toBe('Operações')
  })
  it('o resto é Comercial', () => {
    expect(programaDoCliente({ areaFoco: null, produto: 'Consultoria' })).toBe('Comercial')
  })
})

describe('materiaisParaOCliente — materiaisDoCliente (protótipo L2706–2712)', () => {
  const m = (id: string, programas: string[], usoInterno = false) => ({ id, programas, usoInterno })
  it('separa os do programa (ou "Todos") dos de outros programas, e nunca mostra o de uso interno', () => {
    const r = materiaisParaOCliente('Comercial', [
      m('a', ['Comercial']),
      m('b', ['Todos']),
      m('c', ['Financeiro']),
      m('d', ['Comercial'], true),
    ])
    expect(r.doPrograma.map((x) => x.id)).toEqual(['a', 'b'])
    expect(r.deOutrosProgramas.map((x) => x.id)).toEqual(['c'])
  })
})

describe('podeAdministrarConteudo — escopo geral E `carteira.administrar` (A-5, A-9, ticket 0.5)', () => {
  const perfil = { valores: false, carteira: 'todos' as const, modulos: [], administrar: true }
  it('geral com a chave administra; sem a chave, não', () => {
    expect(podeAdministrarConteudo({ escopo: 'geral', grupoId: null, ...perfil })).toBe(true)
    expect(podeAdministrarConteudo({ escopo: 'geral', grupoId: null, ...perfil, administrar: false })).toBe(false)
  })
  it('escopo grupo nunca administra, nem com a chave gravada', () => {
    expect(podeAdministrarConteudo({ escopo: 'grupo', grupoId: 'g', ...perfil })).toBe(false)
  })
})
