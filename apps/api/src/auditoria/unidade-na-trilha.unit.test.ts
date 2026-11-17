import { CAMPOS_MONETARIOS } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { comDinheiroNomeado } from './unidade-na-trilha'

describe('comDinheiroNomeado (D-I7)', () => {
  it('a meta em reais troca `alvo` por um nome que a redação conhece', () => {
    const r = comDinheiroNomeado('metas_de_pessoa', { indicador: 'orc_valor', alvo: 500000, mes: '2026-10' })
    expect(r).toEqual({ indicador: 'orc_valor', metaEmDinheiro: 500000, mes: '2026-10' })
    expect((CAMPOS_MONETARIOS as readonly string[]).includes('metaEmDinheiro')).toBe(true)
    expect((CAMPOS_MONETARIOS as readonly string[]).includes('alvo')).toBe(false)
  })

  it('quantidade e percentual ficam como estão', () => {
    for (const indicador of ['orc_qtd', 'tarefas_prazo', 'manual']) {
      const linha = { indicador, alvo: 12 }
      expect(comDinheiroNomeado('metas_de_pessoa', linha)).toBe(linha)
    }
  })

  it('indicador desconhecido ou ausente conta como dinheiro: na dúvida, apaga', () => {
    expect(comDinheiroNomeado('metas_de_pessoa', { indicador: 'novo', alvo: 1 })).toEqual({ indicador: 'novo', metaEmDinheiro: 1 })
    expect(comDinheiroNomeado('metas_de_pessoa', { alvo: 1 })).toEqual({ metaEmDinheiro: 1 })
  })

  it('outra entidade, null e não-objeto passam intactos', () => {
    const linha = { indicador: 'orc_valor', alvo: 1 }
    expect(comDinheiroNomeado('kpis', linha)).toBe(linha)
    expect(comDinheiroNomeado('metas_de_pessoa', null)).toBeNull()
    expect(comDinheiroNomeado('metas_de_pessoa', 'x')).toBe('x')
  })
})
