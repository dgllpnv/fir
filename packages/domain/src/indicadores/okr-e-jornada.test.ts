import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { classificarDesfecho, contarDesfechos, DIAS_SEM_RETORNO, ehRecaptacao, faltaMadura, recontatoEmAteDoisDias } from './jornada'
import { ordenarOkrs, progressoDoOkr, situacaoDoOkr } from './okr'

describe('OKR (números c.12)', () => {
  it('okr-media-dos-exibidos: 10,5 / 10,5 / 10,4 exibidos como 11 / 11 / 10 dão 11, não 10', () => {
    expect(progressoDoOkr([11, 11, 10])).toBe(11)
    expect(progressoDoOkr([30, 60, 90])).toBe(60)
    expect(progressoDoOkr([null, 40])).toBe(40)
    expect(progressoDoOkr([])).toBeNull()
    expect(() => progressoDoOkr([10.5])).toThrow()
  })

  it('property: o progresso do OKR é inteiro e fica entre o menor e o maior KR', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 5 }), (xs) => {
        const p = progressoDoOkr(xs)!
        expect(Number.isInteger(p)).toBe(true)
        expect(p).toBeGreaterThanOrEqual(Math.min(...xs))
        expect(p).toBeLessThanOrEqual(Math.max(...xs))
      }),
    )
  })

  it('a situação é a pior; a lista vai do menor progresso para o maior', () => {
    expect(situacaoDoOkr(['atingida', 'atencao', 'no_ritmo'])).toBe('atencao')
    expect(situacaoDoOkr(['atingida', 'sem_dado'])).toBe('atingida')
    expect(situacaoDoOkr(['sem_dado'])).toBe('sem_dado')
    expect(
      ordenarOkrs([
        { objetivo: 'B', progresso: 70 },
        { objetivo: 'A', progresso: null },
        { objetivo: 'C', progresso: 20 },
      ]).map((o) => o.objetivo),
    ).toEqual(['C', 'B', 'A'])
  })
})

const ev = (acao: string, etapa: string, em: string) =>
  ({ acao, etapa, em }) as Parameters<typeof classificarDesfecho>[0][number]

describe('jornada dos KPIs (I-10 a I-12)', () => {
  it('comparecimento: realizado ao entrar na etapa, falta no noshow, desmarcação não é falta, reabrir desfaz', () => {
    const h = [
      ev('agendar', 'agendado', '2026-11-02T12:00:00Z'),
      ev('noshow', 'faltou', '2026-11-03T12:00:00Z'),
      ev('reagendar', 'agendado', '2026-11-04T12:00:00Z'),
      ev('desmarcar', 'desmarcou', '2026-11-05T12:00:00Z'),
      ev('reagendar', 'agendado', '2026-11-06T12:00:00Z'),
      ev('concluir', 'realizado', '2026-11-09T12:00:00Z'),
      ev('reabrir', 'agendado', '2026-11-09T12:05:00Z'),
      ev('concluir', 'realizado', '2026-11-10T12:00:00Z'),
      ev('registrarOrcamento', 'orcamento', '2026-11-10T12:10:00Z'),
    ]
    const d = classificarDesfecho(h)
    expect(d).toEqual([
      { tipo: 'falta', em: '2026-11-03T12:00:00Z' },
      { tipo: 'realizado', em: '2026-11-10T12:00:00Z' },
    ])
    expect(contarDesfechos(d, { de: new Date('2026-11-01T03:00:00Z'), ate: new Date('2026-11-10T03:00:00Z') })).toEqual({ realizados: 0, faltas: 1 })
  })

  it('recontato em até 2 dias, no fuso da clínica; a madura é dia + 2 < hoje', () => {
    const fuso = 'America/Sao_Paulo'
    const h = [
      ev('agendar', 'agendado', '2026-11-02T12:00:00Z'),
      // 02:00Z de 04/11 ainda é 03/11 em São Paulo.
      ev('noshow', 'faltou', '2026-11-04T02:00:00Z'),
      ev('reagendar', 'agendado', '2026-11-06T02:30:00Z'), // 05/11 local: dentro de 03 + 2
      ev('desmarcar', 'desmarcou', '2026-11-10T15:00:00Z'),
      ev('reagendar', 'agendado', '2026-11-13T15:00:00Z'), // 13 > 10 + 2
      ev('noshow', 'faltou', '2026-11-16T15:00:00Z'),
    ]
    const r = recontatoEmAteDoisDias(h, fuso)
    expect(r.map((x) => [x.dia, x.recontatadaNoDia, x.emAteDoisDias])).toEqual([
      ['2026-11-03', '2026-11-05', true],
      ['2026-11-10', '2026-11-13', false],
      ['2026-11-16', null, false],
    ])
    expect(faltaMadura('2026-11-14', '2026-11-17')).toBe(true)
    expect(faltaMadura('2026-11-15', '2026-11-17')).toBe(false)
  })

  it('recaptação: 182 dias ou mais desde o atendimento anterior; sem anterior não conta', () => {
    expect(DIAS_SEM_RETORNO).toBe(182)
    expect(ehRecaptacao('2026-11-17', '2026-05-19')).toBe(true) // 182 dias
    expect(ehRecaptacao('2026-11-17', '2026-05-20')).toBe(false) // 181
    expect(ehRecaptacao('2026-11-17', null)).toBe(false)
  })
})
