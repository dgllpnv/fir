import { CHAVES_DE_RELATORIO, FILTROS_DOS_RELATORIOS } from '@fir/contracts'
import { describe, expect, it } from 'vitest'
import { type Campos, camposIniciais, deFiltros, paraFiltros, temMaisOpcoesEmUso } from './campos-do-filtro'

const HOJE = '2026-11-17'
const ID = '00000000-0000-4000-8000-000000000001'

/** Todos os filtros da 1.8 preenchidos de uma vez: cada relatório leva só os dele. */
const cheios: Campos = {
  ...camposIniciais(HOJE),
  unidadeId: ID,
  origem: 'Instagram',
  tipo: 'Consulta realizada',
  comPeriodo: true,
  minimoDeIndicacoes: '2',
  procedimentoIds: [ID],
  situacaoDoPrograma: 'concluido',
  forma: 'Pix',
  registradoPorId: ID,
  categoria: 'Marketing',
  motivoDaSaida: 'descarte',
  localId: ID,
  fornecedorId: ID,
  situacaoDoOrcamento: 'perdido',
  motivoDePerdaId: ID,
  recontatada: 'nao',
  situacaoDoPrazo: 'atrasada',
}

describe('os campos dos filtros da 1.8 (S2) e o contrato', () => {
  for (const chave of CHAVES_DE_RELATORIO) {
    it(`${chave}: com tudo preenchido, o que a tela manda passa no schema .strict() e volta igual`, () => {
      const m = paraFiltros(chave, cheios)
      if ('erro' in m) throw new Error(m.erro)
      const r = FILTROS_DOS_RELATORIOS[chave].safeParse(m.filtros)
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
      expect(paraFiltros(chave, deFiltros(chave, m.filtros, camposIniciais('2025-01-31')))).toEqual(m)
    })
  }

  it('relatório 2 em dias manda só os dias', () => {
    expect(paraFiltros('pacientes-sem-atendimento', { ...camposIniciais(HOJE), emDias: true, dias: '45' })).toEqual({
      filtros: { semAtendimentoHaDias: 45 },
    })
  })

  it('os favoritos de antes do relatório 5 voltam à tela e saem no formato novo, que o servidor aceita', () => {
    const antigo = deFiltros('pacientes-por-procedimento', { procedimentoId: ID, incluirEncerrados: true }, camposIniciais(HOJE))
    expect(antigo.procedimentoIds).toEqual([ID])
    expect(antigo.situacaoDoPrograma).toBe('todos')
    const m = paraFiltros('pacientes-por-procedimento', antigo)
    expect(m).toEqual({ filtros: { situacoes: ['ativo', 'concluido', 'encerrado'], procedimentoIds: [ID] } })
    expect(deFiltros('pacientes-por-procedimento', {}, camposIniciais(HOJE)).situacaoDoPrograma).toBe('ativos-e-concluidos')
  })

  it('o favorito de antes do relatório 13 (etapa) volta como situação, e sai no formato novo', () => {
    const OUT = { de: '2026-10-01', ate: '2026-10-31' }
    expect(paraFiltros('orcamentos', deFiltros('orcamentos', { ...OUT, etapa: 'orcamento' }, camposIniciais(HOJE)))).toEqual({
      filtros: { ...OUT, situacao: 'enviado' },
    })
    expect(paraFiltros('orcamentos', deFiltros('orcamentos', { ...OUT, etapa: 'perdido' }, camposIniciais(HOJE)))).toEqual({
      filtros: { ...OUT, situacao: 'perdido' },
    })
    // Etapa sem orçamento (agendado) não tem situação: cai em "todas".
    expect(paraFiltros('orcamentos', deFiltros('orcamentos', { ...OUT, etapa: 'agendado' }, camposIniciais(HOJE)))).toEqual({ filtros: OUT })
  })

  it('o motivo "ajuste" do relatório 11 vai e volta', () => {
    const m = paraFiltros('saidas-de-estoque', { ...camposIniciais(HOJE), motivoDaSaida: 'ajuste' })
    if ('erro' in m) throw new Error(m.erro)
    expect(m.filtros['motivo']).toBe('ajuste')
    expect(FILTROS_DOS_RELATORIOS['saidas-de-estoque'].safeParse(m.filtros).success).toBe(true)
    expect(deFiltros('saidas-de-estoque', m.filtros, camposIniciais(HOJE)).motivoDaSaida).toBe('ajuste')
  })

  it('o aniversário por intervalo manda o par De/Até, e o mês some', () => {
    const c = { ...camposIniciais(HOJE), aniversarioNoIntervalo: true, de: '2026-11-20', ate: '2026-12-10' }
    expect(paraFiltros('aniversariantes', c)).toEqual({ filtros: { de: '2026-11-20', ate: '2026-12-10' } })
  })

  it('"+ Mais opções" abre sozinho quando um filtro raro está em uso', () => {
    expect(temMaisOpcoesEmUso('recebimentos', camposIniciais(HOJE))).toBe(false)
    expect(temMaisOpcoesEmUso('recebimentos', { ...camposIniciais(HOJE), registradoPorId: ID })).toBe(true)
    expect(temMaisOpcoesEmUso('tarefas-da-equipe', { ...camposIniciais(HOJE), tipo: 'Follow-up' })).toBe(true)
  })
})
