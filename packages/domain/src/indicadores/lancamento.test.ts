import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { somarDias } from '../relogio'
import {
  ehMarcadorDeLancamento,
  HORIZONTE_DAS_TAREFAS_DE_LANCAMENTO,
  lancamentosAGerar,
  marcadorDeLancamento,
  validarLancamento,
} from './lancamento'
import { ehReferencia, referenciaDoPeriodo } from './periodos'

/**
 * T3 — o lançamento de KPI manual e as tarefas que o pedem (spec I-30, I-31).
 * Puro: `hoje` e o cursor vêm de quem chama.
 */

const KPI = '6f2c1d7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f'

describe('marcador de lançamento (appsec C27)', () => {
  it('cabe na coluna `tarefas.marcador` (60) e é reconhecido em qualquer caixa e com espaço na frente', () => {
    expect(marcadorDeLancamento(KPI)).toBe(`lancamento-kpi:${KPI}`)
    expect(marcadorDeLancamento(KPI).length).toBeLessThanOrEqual(60)
    expect(ehMarcadorDeLancamento(`lancamento-kpi:${KPI}`)).toBe(true)
    expect(ehMarcadorDeLancamento('  LANCAMENTO-KPI:x')).toBe(true)
    expect(ehMarcadorDeLancamento('fechamento-do-mes')).toBe(false)
    expect(ehMarcadorDeLancamento(undefined)).toBe(false)
    expect(ehMarcadorDeLancamento(42)).toBe(false)
  })
})

describe('lancamentosAGerar (I-30): para a frente a partir do cursor, nunca para trás', () => {
  it('primeira rodada: o período corrente (mesmo com o prazo já passado) até hoje + 35', () => {
    // Terça 17/11/2026; semanal, dia 1 (segunda).
    const r = lancamentosAGerar({ frequencia: 'semanal', diaDeLancamento: 1 }, null, '2026-11-17')
    // O cursor é o prazo da última tarefa gerada, dentro de hoje + 35.
    expect(r.geradasAte).toBe('2026-12-21')
    expect(r.geradasAte! <= somarDias('2026-11-17', HORIZONTE_DAS_TAREFAS_DE_LANCAMENTO)).toBe(true)
    expect(r.tarefas[0]).toEqual({ referencia: '2026-11-16', prazo: '2026-11-16' })
    expect(r.tarefas.map((t) => t.prazo)).toEqual(['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21'])
  })

  it('mensal no dia 31: fevereiro cai no último dia (regra 25)', () => {
    const r = lancamentosAGerar({ frequencia: 'mensal', diaDeLancamento: 31 }, null, '2027-01-25')
    expect(r.tarefas).toEqual([
      { referencia: '2027-01-01', prazo: '2027-01-31' },
      { referencia: '2027-02-01', prazo: '2027-02-28' },
    ])
  })

  it('rodar de novo no mesmo dia não gera nada; no dia seguinte, só o que entrou no horizonte', () => {
    const k = { frequencia: 'semanal' as const, diaDeLancamento: 3 }
    const a = lancamentosAGerar(k, null, '2026-11-17')
    expect(lancamentosAGerar(k, a.geradasAte, '2026-11-17').tarefas).toEqual([])
    // Horizonte 22/12; a quarta 23/12 entra no dia seguinte.
    const b = lancamentosAGerar(k, a.geradasAte, '2026-11-18')
    expect(b.tarefas).toEqual([{ referencia: '2026-12-21', prazo: '2026-12-23' }])
    expect(lancamentosAGerar(k, b.geradasAte, '2026-11-24').tarefas).toEqual([])
    expect(lancamentosAGerar(k, b.geradasAte, '2026-11-25').tarefas.map((t) => t.prazo)).toEqual(['2026-12-30'])
  })

  it('property: o cursor nunca anda para trás, e nada gerado tem prazo até o cursor anterior', () => {
    const dia = fc.integer({ min: 0, max: 900 }).map((n) => somarDias('2026-01-01', n))
    fc.assert(
      fc.property(
        fc.constantFrom('semanal' as const, 'mensal' as const),
        fc.integer({ min: 1, max: 31 }),
        dia,
        fc.option(dia, { nil: null }),
        (frequencia, d, hoje, cursor) => {
          const diaDeLancamento = frequencia === 'semanal' ? ((d - 1) % 7) + 1 : d
          const r = lancamentosAGerar({ frequencia, diaDeLancamento }, cursor, hoje)
          const ate = r.geradasAte ?? ''
          expect(ate).not.toBe('')
          if (cursor !== null) {
            expect(ate >= cursor).toBe(true)
            for (const t of r.tarefas) expect(t.prazo > cursor).toBe(true)
          }
          for (const t of r.tarefas) {
            expect(t.prazo <= ate).toBe(true)
            expect(ehReferencia(frequencia, t.referencia)).toBe(true)
            expect(referenciaDoPeriodo(frequencia, t.prazo)).toBe(t.referencia)
          }
          // Prazos estritamente crescentes: o índice `(clinica, marcador, prazo)` não colide.
          const prazos = r.tarefas.map((t) => t.prazo)
          expect([...prazos].sort()).toEqual(prazos)
          expect(new Set(prazos).size).toBe(prazos.length)
          // Reentrante: a segunda rodada com o cursor novo não gera nada.
          expect(lancamentosAGerar({ frequencia, diaDeLancamento }, r.geradasAte, hoje).tarefas).toEqual([])
        },
      ),
    )
  })
})

describe('validarLancamento (I-31)', () => {
  it('referência da semana corrente e valor no domínio: ok', () => {
    const r = validarLancamento({ frequencia: 'semanal', unidade: 'quantidade' }, '2026-11-16', 1250n, '2026-11-17')
    expect(r.tipo).toBe('ok')
  })

  it('referência futura, que não é segunda ou dia 1º, e valor fora do domínio: erro', () => {
    expect(validarLancamento({ frequencia: 'semanal', unidade: 'quantidade' }, '2026-11-23', 1n, '2026-11-17')).toMatchObject({
      tipo: 'erro',
      erro: { codigo: 'ReferenciaFutura' },
    })
    expect(validarLancamento({ frequencia: 'semanal', unidade: 'quantidade' }, '2026-11-17', 1n, '2026-11-17')).toMatchObject({
      tipo: 'erro',
      erro: { codigo: 'ReferenciaInvalida' },
    })
    expect(validarLancamento({ frequencia: 'mensal', unidade: 'nota' }, '2026-11-01', 1001n, '2026-11-17')).toMatchObject({
      tipo: 'erro',
      erro: { codigo: 'ValorForaDoDominio' },
    })
    expect(validarLancamento({ frequencia: 'mensal', unidade: 'reais' }, '2026-11-01', -1n, '2026-11-17')).toMatchObject({
      tipo: 'erro',
      erro: { codigo: 'ValorForaDoDominio' },
    })
  })

  it('a mensagem de erro nunca repete o valor digitado (appsec C29)', () => {
    const r = validarLancamento({ frequencia: 'mensal', unidade: 'nota' }, '2026-11-01', 987654n, '2026-11-17')
    expect(r.tipo === 'erro' && r.erro.mensagem.includes('987654')).toBe(false)
  })
})
