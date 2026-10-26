import { describe, expect, it } from 'vitest'
import {
  diaCivil,
  diasEntre,
  fimDoMes,
  inicioDoDia,
  janela,
  RelogioFixo,
  somarDias,
  somarMeses,
} from './relogio'

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
    // enquanto o instante imediatamente anterior pertence. Prova a exclusão de
    // borda de fato (a asserção `ate >= de && ate < ate` do brief original era
    // trivialmente falsa — nada é menor que si mesmo — e foi removida).
    const imediatamenteAntesDoFim = new Date(ate.getTime() - 1)
    expect(imediatamenteAntesDoFim >= de && imediatamenteAntesDoFim < ate).toBe(true)
  })
})

describe('horário de verão', () => {
  const SP = 'America/Sao_Paulo' // tinha horário de verão em 2018

  it('hora repetida (fim do horário de verão) não desloca o dia', () => {
    const t = inicioDoDia('2018-02-18', SP)
    expect(diaCivil(t, SP)).toBe('2018-02-18')
  })

  it('hora inexistente (início do horário de verão) começa no primeiro instante que existe', () => {
    // Em 04/11/2018 o relógio saltou de 23:59:59 para 01:00:00: a meia-noite
    // local não aconteceu. O dia precisa começar dentro do próprio dia.
    const t = inicioDoDia('2018-11-04', SP)
    expect(diaCivil(t, SP)).toBe('2018-11-04')
    expect(t.toISOString()).toBe('2018-11-04T03:00:00.000Z')
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

describe('diasEntre', () => {
  it('conta os dias civis de um para o outro, e é negativo ao voltar', () => {
    expect(diasEntre('2026-11-02', '2026-11-09')).toBe(7)
    expect(diasEntre('2026-11-09', '2026-11-02')).toBe(-7)
    expect(diasEntre('2026-11-02', '2026-11-02')).toBe(0)
  })

  it('atravessa fevereiro e a virada do ano', () => {
    expect(diasEntre('2026-02-26', '2026-03-01')).toBe(3)
    expect(diasEntre('2028-02-26', '2028-03-01')).toBe(4) // bissexto
    expect(diasEntre('2026-12-28', '2027-01-04')).toBe(7)
  })

  it('NÃO depende do fuso: o dia de 23 horas do horário de verão continua UM dia', () => {
    // O protótipo faz `Math.round((parse(b) - parse(a)) / 864e5)` sobre datas
    // LOCAIS, e o `Math.round` está lá exatamente porque, no fuso local, o dia
    // da virada tem 23 ou 25 horas. Aqui a conta é em UTC e não há o que
    // arredondar.
    expect(diasEntre('2018-11-03', '2018-11-04')).toBe(1)
    expect(diasEntre('2019-02-16', '2019-02-17')).toBe(1)
  })

  it('`somarDias` e `diasEntre` são inversos', () => {
    expect(diasEntre('2026-01-31', somarDias('2026-01-31', 400))).toBe(400)
  })
})
