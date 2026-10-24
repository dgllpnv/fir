import { describe, expect, it } from 'vitest'
import { diaCivil, fimDoMes, inicioDoDia, janela, RelogioFixo, somarDias, somarMeses } from './relogio.js'

const BAHIA = 'America/Bahia' // UTC−3, sem horário de verão

describe('Relogio', () => {
  it('RelogioFixo devolve sempre o mesmo instante', () => {
    const r = new RelogioFixo(new Date('2026-10-23T12:00:00Z'))
    expect(r.agora().toISOString()).toBe('2026-10-23T12:00:00.000Z')
  })
})

describe('dia civil no fuso da clínica', () => {
  it('22h30 em Salvador ainda é o dia 23, mesmo já sendo 24 em UTC', () => {
    expect(diaCivil(new Date('2026-10-24T01:30:00Z'), BAHIA)).toBe('2026-10-23')
  })

  it('o mesmo instante pode ser outro dia em outro fuso', () => {
    const i = new Date('2026-10-24T01:30:00Z')
    expect(diaCivil(i, BAHIA)).toBe('2026-10-23')
    expect(diaCivil(i, 'UTC')).toBe('2026-10-24')
  })

  it('início do dia em Salvador é 03:00 UTC', () => {
    expect(inicioDoDia('2026-10-23', BAHIA).toISOString()).toBe('2026-10-23T03:00:00.000Z')
  })
})

describe('janela semiaberta [de, ate)', () => {
  it('o último instante do dia final entra; o primeiro do dia seguinte não', () => {
    const { de, ate } = janela('2026-10-01', '2026-10-31', BAHIA)
    expect(de.toISOString()).toBe('2026-10-01T03:00:00.000Z')
    // o fim é o início do dia SEGUINTE ao último: 1º de novembro.
    expect(ate.toISOString()).toBe('2026-11-01T03:00:00.000Z')

    const ultimoInstante = new Date('2026-11-01T02:59:59Z')
    expect(ultimoInstante >= de && ultimoInstante < ate).toBe(true)
    // o instante `ate` exato NÃO pertence à janela — é a borda superior excluída —
    // enquanto o instante imediatamente anterior pertence. (A asserção original do
    // brief, `ate >= de && ate < ate`, é trivialmente falsa — nada é menor que si
    // mesmo — e não prova exclusão de borda; esta a substitui.)
    const imediatamenteAntesDoFim = new Date(ate.getTime() - 1)
    expect(ate >= de && ate < ate).toBe(false)
    expect(imediatamenteAntesDoFim >= de && imediatamenteAntesDoFim < ate).toBe(true)
  })
})

describe('aritmética de datas civis', () => {
  it('soma dias atravessando o mês', () => {
    expect(somarDias('2026-10-30', 3)).toBe('2026-11-02')
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('mensal no dia 31 cai no último dia do mês curto — a regra da v20', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28')
    expect(somarMeses('2026-01-31', 3)).toBe('2026-04-30')
  })

  it('mantém o dia original ao voltar para um mês longo', () => {
    // Quem repete mensalmente a partir de 31/01 deve voltar ao dia 31 em março.
    expect(somarMeses('2026-01-31', 2, 31)).toBe('2026-03-31')
  })

  it('ano bissexto', () => {
    expect(somarMeses('2028-01-31', 1)).toBe('2028-02-29')
    expect(fimDoMes('2028-02')).toBe('2028-02-29')
  })
})
