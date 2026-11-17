import { CHAVES_DE_RELATORIO, FILTROS_DOS_RELATORIOS } from '@fir/contracts'
import { describe, expect, it } from 'vitest'
import { ErroDaApi } from '@/lib/api'
import { mensagemDoErro, resultadoEmTexto } from './campanha-da-lista'
import { camposIniciais, deFiltros, paraFiltros, pedidoDoLink, ROTULO_DA_SITUACAO } from './na-tabela'

const HOJE = '2026-11-17'

describe('os 15 relatórios: os campos iniciais montam filtros que o CONTRATO aceita', () => {
  for (const chave of CHAVES_DE_RELATORIO) {
    it(chave, () => {
      const m = paraFiltros(chave, camposIniciais(HOJE))
      if ('erro' in m) throw new Error(m.erro)
      expect(FILTROS_DOS_RELATORIOS[chave].safeParse(m.filtros).success).toBe(true)
      // E o favorito volta igual.
      const ida = paraFiltros(chave, deFiltros(chave, m.filtros, camposIniciais('2025-01-31')))
      expect(ida).toEqual(m)
    })
  }

  it('saldos: o corte e a faixa em reais viram dia e centavos; sem corte, o servidor usa hoje', () => {
    const c = { ...camposIniciais(HOJE), corte: '2026-10-31', valorMinimo: '1.000,50' }
    expect(paraFiltros('saldos-em-aberto', c)).toEqual({ filtros: { ate: '2026-10-31', valorMinimo: '100050' } })
    expect(paraFiltros('saldos-em-aberto', camposIniciais(HOJE))).toEqual({ filtros: {} })
  })

  it('top N fora de 1..500 não sai da tela', () => {
    expect('erro' in paraFiltros('pacientes-maior-ltv', { ...camposIniciais(HOJE), quantos: '501' })).toBe(true)
  })

  it('situações de todos os relatórios têm rótulo (a etapa vem do domínio)', () => {
    for (const s of ['sim', 'nao', 'falta', 'desmarcacao', 'recontatada', 'sem-recontato', 'aguardando-prazo', 'fechado', 'orcamento']) {
      expect(ROTULO_DA_SITUACAO[s]).toBeTruthy()
    }
  })
})

describe('o link do detalhe do KPI', () => {
  it('lê relatorio, de e ate', () => {
    expect(pedidoDoLink({ relatorio: 'recebimentos', de: '2026-11-01', ate: '2026-11-17' })).toEqual({
      chave: 'recebimentos',
      de: '2026-11-01',
      ate: '2026-11-17',
    })
    expect(pedidoDoLink({ relatorio: 'pacientes-por-origem-e-campanha' })).toEqual({ chave: 'pacientes-por-origem-e-campanha' })
  })
  it('ignora chave fora do catálogo e dia malformado', () => {
    expect(pedidoDoLink({ relatorio: 'salarios' })).toBeNull()
    expect(pedidoDoLink({ relatorio: 'recebimentos', de: '01/11/2026' })).toEqual({ chave: 'recebimentos' })
  })
})

describe('campanha da lista: o que a tela diz', () => {
  it('criadas e ignoradas, com plural', () => {
    expect(resultadoEmTexto({ campanhaId: 'x', pacientes: 3, criadas: 3, ignoradas: 0 }, 'Volta')).toBe('3 tarefas criadas em "Volta".')
    expect(resultadoEmTexto({ campanhaId: 'x', pacientes: 3, criadas: 0, ignoradas: 3 }, 'Volta')).toContain(
      '3 pacientes já tinham a tarefa aberta',
    )
  })
  it('422 e 409 dizem que nada foi criado', () => {
    expect(mensagemDoErro(new ErroDaApi(422, 'A lista está vazia; nada foi criado.'))).toContain('Nada foi criado')
    expect(mensagemDoErro(new ErroDaApi(409, 'Já existe uma campanha chamada "X".'))).toContain('tente de novo')
  })
})
