import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  MINUTOS_POR_HORA,
  SALDO_MAXIMO_EM_MINUTOS,
  formatarHoras,
  formatarSaldoDeHoras,
  lerSaldoDeHoras,
} from './banco-de-horas'
import { ehErro, ehOk, exigir } from './resultado'

const ler = (s: string) => exigir(lerSaldoDeHoras(s))

describe('lerSaldoDeHoras — o que a gestora digita olhando o app de ponto', () => {
  it('lê as duas formas que o MANUAL mostra', () => {
    expect(ler('+6:30')).toBe(390)
    expect(ler('−2:15')).toBe(-135)
    expect(ler('-2:15')).toBe(-135)
  })

  it('lê a forma que a própria tela imprime — a ida e a volta falam a mesma língua', () => {
    expect(ler('+6h30')).toBe(390)
    expect(ler('−4h15')).toBe(-255)
    expect(ler('+1h')).toBe(60)
    expect(ler('0h')).toBe(0)
  })

  it('lê hora decimal por aritmética INTEIRA, sem passar por ponto flutuante', () => {
    expect(ler('6,5')).toBe(390)
    expect(ler('6.5')).toBe(390)
    expect(ler('-4,25')).toBe(-255)
    // 0,51 h = 30,6 min. Meio para cima, e a conta é sobre os DÍGITOS.
    expect(ler('0,51')).toBe(31)
    expect(ler('0,008')).toBe(0)
    expect(ler('8')).toBe(480)
  })

  it('campo vazio é `null`, e `null` NÃO é zero', () => {
    expect(ler('')).toBe(null)
    expect(ler('   ')).toBe(null)
    // Zero é saldo legítimo: a pessoa fechou o mês quitada.
    expect(ler('0')).toBe(0)
    expect(ler('0h')).toBe(0)
  })

  it('MINUTOS EM DOIS DÍGITOS, ou nenhum — `6:3` é recusado, não adivinhado', () => {
    // O protótipo lê `Number("3")` = 3 minutos. "6:3" pode ser 6h03 ou 6h30, e
    // 27 minutos de diferença num banco de horas é dinheiro.
    expect(ehErro(lerSaldoDeHoras('6:3'))).toBe(true)
    expect(ehErro(lerSaldoDeHoras('6:303'))).toBe(true)
  })

  it('recusa o que não é saldo, com mensagem de tela', () => {
    for (const ruim of ['abc', '6h30m', '+-3', '3:60:00', 'R$ 10', '--5']) {
      const r = lerSaldoDeHoras(ruim)
      expect(ehErro(r), `"${ruim}" deveria ser recusado`).toBe(true)
      if (ehErro(r)) expect(r.erro.codigo).toBe('SALDO_DE_HORAS_INVALIDO')
    }
  })

  it('`:60` passa a ser 60 minutos declarados, nunca uma hora escondida', () => {
    // `3:60` é 3h60 = 240 min. Não se recusa (o app de ponto escreve assim ao
    // somar), mas também não se "conserta" em silêncio para 4:00 com outro
    // número: 240 É quatro horas, e a ida-e-volta devolve `+4h`.
    expect(ler('3:60')).toBe(240)
    expect(formatarSaldoDeHoras(240)).toBe('+4h')
  })

  it('recusa saldo fora da faixa — e a faixa é generosa de propósito', () => {
    const r = lerSaldoDeHoras(`${SALDO_MAXIMO_EM_MINUTOS / MINUTOS_POR_HORA + 1}:00`)
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('SALDO_DE_HORAS_FORA_DA_FAIXA')
    expect(ler(`${SALDO_MAXIMO_EM_MINUTOS / MINUTOS_POR_HORA}:00`)).toBe(SALDO_MAXIMO_EM_MINUTOS)
  })
})

describe('formatarSaldoDeHoras', () => {
  it('imprime o sinal, e o menos é tipográfico para alinhar na coluna', () => {
    expect(formatarSaldoDeHoras(390)).toBe('+6h30')
    expect(formatarSaldoDeHoras(-255)).toBe('−4h15')
    expect(formatarSaldoDeHoras(0)).toBe('0h')
    expect(formatarSaldoDeHoras(60)).toBe('+1h')
    expect(formatarSaldoDeHoras(-1)).toBe('−0h01')
  })

  it('NUNCA imprime 60 minutos — o defeito que a hora decimal do protótipo tem', () => {
    // `fmtH(0.999)` no protótipo: floor(0.999) = 0, round(0.999 % 1 * 60) = 60
    // → "0h60". Aqui a entrada é minuto inteiro e `% 60` fecha o caso.
    for (const m of [59, 60, 61, 119, 120, 3599, 3600]) {
      expect(formatarSaldoDeHoras(m)).not.toMatch(/h60$/)
    }
  })

  it('formatarHoras não tem sinal — é o `±10h` do texto do limite', () => {
    expect(formatarHoras(600)).toBe('10h')
    expect(formatarHoras(-600)).toBe('10h')
    expect(formatarHoras(90)).toBe('1h30')
  })
})

/**
 * A PROPRIEDADE que fecha a classe inteira: a ida e a volta são exatas.
 *
 * O gerador uniforme não acha o caso limite — medido quatro vezes neste
 * projeto —, então a fronteira é **construída**: 0, ±1, ±59, ±60, ±61, as
 * viradas de hora e as duas pontas da faixa. `oneof` mistura a fronteira com
 * o uniforme para que o uniforme ainda tenha chance de achar o que não
 * pensamos.
 */
const FRONTEIRA = [
  0,
  1,
  -1,
  59,
  -59,
  60,
  -60,
  61,
  -61,
  119,
  -119,
  120,
  599,
  600,
  601,
  -600,
  SALDO_MAXIMO_EM_MINUTOS,
  -SALDO_MAXIMO_EM_MINUTOS,
  SALDO_MAXIMO_EM_MINUTOS - 1,
]

const minutos = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...FRONTEIRA) },
  {
    weight: 2,
    arbitrary: fc.integer({ min: -SALDO_MAXIMO_EM_MINUTOS, max: SALDO_MAXIMO_EM_MINUTOS }),
  },
  // A vizinhança das viradas de hora, onde a hora decimal errava.
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.integer({ min: -999, max: 999 }), fc.integer({ min: -2, max: 2 }))
      .map(([h, d]) => h * MINUTOS_POR_HORA + d),
  },
)

describe('propriedade: a ida e a volta do saldo de horas são EXATAS', () => {
  it('lerSaldoDeHoras(formatarSaldoDeHoras(m)) === m, para todo minuto da faixa', () => {
    fc.assert(
      fc.property(minutos, (m) => {
        const texto = formatarSaldoDeHoras(m)
        const volta = lerSaldoDeHoras(texto)
        expect(ehOk(volta), `"${texto}" não foi lido de volta`).toBe(true)
        if (ehOk(volta)) expect(volta.valor).toBe(m)
      }),
      { numRuns: 800 },
    )
  })

  it('o sinal impresso é o sinal do número, e zero não tem sinal', () => {
    fc.assert(
      fc.property(minutos, (m) => {
        const texto = formatarSaldoDeHoras(m)
        if (m < 0) expect(texto.startsWith('−')).toBe(true)
        else if (m > 0) expect(texto.startsWith('+')).toBe(true)
        else expect(texto).toBe('0h')
      }),
    )
  })

  it('`H:MM` com MM em 00..59 é sempre H×60 + MM — sem ponto flutuante no meio', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999 }),
        fc.integer({ min: 0, max: 59 }),
        fc.constantFrom('+', '-', ''),
        (h, m, sinal) => {
          const texto = `${sinal}${h}:${String(m).padStart(2, '0')}`
          const esperado = (sinal === '-' ? -1 : 1) * (h * MINUTOS_POR_HORA + m)
          expect(ler(texto)).toBe(esperado)
        },
      ),
    )
  })
})
