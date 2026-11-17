import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { diasUteisAte, percentualInteiro } from '../financeiro/visao-do-mes'
import { somarDias } from '../relogio'
import { arredondar } from './aritmetica'
import { kpiDoCatalogo } from './catalogo'
import {
  type MetaParaConta,
  janelaDaMeta,
  percentualDaMeta,
  progresso,
  projecao,
  ritmoEsperado,
  situacao,
  validarMeta,
} from './meta'
import { corteDosDiasQueContam, diasUteisEntre } from './periodos'
import { NumeroDoKpi, type UnidadeDeKpi } from './unidades'

const reais = (c: bigint) => NumeroDoKpi.de('reais', c)
const num = (u: UnidadeDeKpi, v: bigint) => NumeroDoKpi.de(u, v)

const metaDeSoma = (inicio: string, prazo: string, alvo: bigint, direcao: 'maior' | 'menor' = 'maior'): MetaParaConta => ({
  agregacao: 'soma',
  direcao,
  inicio,
  prazo,
  partida: reais(0n),
  alvo: reais(alvo),
})

describe('janela da meta (I-16)', () => {
  it('o prazo é inclusivo na tela e exclusivo na conta: [início, prazo + 1)', () => {
    expect(janelaDaMeta('2026-12-01', '2026-12-31')).toEqual({ tipo: 'ok', valor: { de: '2026-12-01', ate: '2027-01-01' } })
    expect(janelaDaMeta('2026-12-31', '2026-12-01').tipo).toBe('erro')
  })
})

describe('ritmo esperado (I-19, números B2)', () => {
  it('ritmo-dezembro-2026: R$ 120.000, U = 23; 01/12 → 521.739 centavos e 31/12 → 12.000.000', () => {
    // Os números da conta do validador (scratchpad do gate, conta.test.ts).
    expect(diasUteisAte('2026-12', '2026-12-31')).toBe(23)
    expect(diasUteisAte('2026-12', '2026-12-01')).toBe(1)
    expect(diasUteisEntre('2026-12-01', '2026-12-31')).toBe(23)

    const m = metaDeSoma('2026-12-01', '2026-12-31', 12_000_000n)
    const r1 = ritmoEsperado(m, '2026-12-01')
    expect(r1).toEqual({ numerador: 12_000_000n, denominador: 23n })
    expect(arredondar(r1)).toBe(521_739n)
    expect(arredondar(ritmoEsperado(m, '2026-12-31'))).toBe(12_000_000n)
    // Depois do prazo, congela no alvo.
    expect(arredondar(ritmoEsperado(m, '2027-01-15'))).toBe(12_000_000n)
  })

  const arbMeta = fc
    .record({
      agregacao: fc.constantFrom('soma' as const, 'taxa' as const, 'posicao' as const, 'media_mensal' as const),
      direcao: fc.constantFrom('maior' as const, 'menor' as const),
      inicioOffset: fc.integer({ min: 0, max: 800 }),
      duracao: fc.integer({ min: 0, max: 120 }),
      partida: fc.bigInt({ min: 0n, max: 10_000_000n }),
      alvo: fc.bigInt({ min: 0n, max: 10_000_000n }),
    })
    .map(({ agregacao, direcao, inicioOffset, duracao, partida, alvo }) => {
      const inicio = somarDias('2025-01-01', inicioOffset)
      const m: MetaParaConta = {
        agregacao,
        direcao,
        inicio,
        prazo: somarDias(inicio, duracao),
        partida: num('quantidade', agregacao === 'soma' ? 0n : partida),
        alvo: num('quantidade', alvo),
      }
      return m
    })

  it('ritmo-vespera-e-prazo (property): véspera = partida, prazo = alvo, monótono e entre os extremos', () => {
    fc.assert(
      fc.property(arbMeta, fc.integer({ min: -3, max: 130 }), fc.integer({ min: -3, max: 130 }), (m, a, b) => {
        const p = m.partida.emMenorUnidade
        const alvo = m.alvo.emMenorUnidade
        const vespera = ritmoEsperado(m, somarDias(m.inicio, -1))
        expect(vespera.numerador).toBe(p * vespera.denominador)
        const noPrazo = ritmoEsperado(m, m.prazo)
        expect(noPrazo.numerador).toBe(alvo * noPrazo.denominador)

        const [t1, t2] = a <= b ? [a, b] : [b, a]
        const r1 = ritmoEsperado(m, somarDias(m.inicio, t1))
        const r2 = ritmoEsperado(m, somarDias(m.inicio, t2))
        // Monótono na direção partida → alvo (comparação cruzada, sem arredondar).
        const s = alvo >= p ? 1n : -1n
        expect(s * (r2.numerador * r1.denominador - r1.numerador * r2.denominador) >= 0n).toBe(true)
        // Entre os extremos.
        const lo = p < alvo ? p : alvo
        const hi = p < alvo ? alvo : p
        expect(r1.numerador >= lo * r1.denominador && r1.numerador <= hi * r1.denominador).toBe(true)
      }),
    )
  })
})

describe('situação por multiplicação cruzada (I-20, números c.7)', () => {
  it('situacao-multiplicacao-cruzada: alvo 100, U = 3, u = 1, atual 33 → atencao (o ritmo arredondado diria no_ritmo)', () => {
    // seg 16/11 a qua 18/11/2026: 3 dias úteis; corte no primeiro.
    const m = metaDeSoma('2026-11-16', '2026-11-18', 100n)
    expect(arredondar(ritmoEsperado(m, '2026-11-16'))).toBe(33n)
    expect(situacao(m, reais(33n), '2026-11-16', '2026-11-16')).toBe('atencao')
    expect(situacao(m, reais(34n), '2026-11-16', '2026-11-16')).toBe('no_ritmo')
  })

  it('ritmo 10.000 com atual 9.000 → atencao; com 8.999 → abaixo', () => {
    // 2 dias úteis (seg e ter), corte no primeiro: ritmo = 20.000 × 1 ÷ 2 = 10.000.
    const m = metaDeSoma('2026-11-16', '2026-11-17', 20_000n)
    expect(ritmoEsperado(m, '2026-11-16')).toEqual({ numerador: 20_000n, denominador: 2n })
    expect(situacao(m, reais(9_000n), '2026-11-16', '2026-11-16')).toBe('atencao')
    expect(situacao(m, reais(8_999n), '2026-11-16', '2026-11-16')).toBe('abaixo')
  })

  it('NPS de 60 para 70 com atual 60 e ritmo 65 → abaixo', () => {
    const m: MetaParaConta = {
      agregacao: 'posicao',
      direcao: 'maior',
      inicio: '2026-11-01',
      prazo: '2026-11-10',
      partida: num('quantidade', 6_000n),
      alvo: num('quantidade', 7_000n),
    }
    const r = ritmoEsperado(m, '2026-11-05')
    expect(arredondar(r)).toBe(6_500n)
    expect(situacao(m, num('quantidade', 6_000n), '2026-11-05', '2026-11-05')).toBe('abaixo')
  })

  it('prazo vencido sem atingir é abaixo; atingir antes do prazo é atingida', () => {
    const m = metaDeSoma('2026-11-02', '2026-11-06', 1_000n)
    expect(situacao(m, reais(999n), '2026-11-06', '2026-11-07')).toBe('abaixo')
    expect(situacao(m, reais(1_000n), '2026-11-03', '2026-11-03')).toBe('atingida')
  })

  it('property: nunca compara contra o ritmo arredondado (no_ritmo ⇔ atual·U ≥ alvo·u)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 100_000_000n }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 30 }),
        fc.bigInt({ min: 0n, max: 100_000_000n }),
        (alvo, dur, corteOff, atual) => {
          const inicio = '2026-03-02'
          const m = metaDeSoma(inicio, somarDias(inicio, dur), alvo)
          const corte = somarDias(inicio, Math.min(corteOff, dur))
          const r = ritmoEsperado(m, corte)
          const s = situacao(m, reais(atual), corte, corte)
          if (atual >= alvo) expect(s).toBe('atingida')
          else expect(s === 'no_ritmo').toBe(atual * r.denominador >= r.numerador)
        },
      ),
    )
  })
})

describe('perda e teto (I-20, números B4 — parte pura)', () => {
  const perda: MetaParaConta = {
    agregacao: 'analise',
    direcao: 'menor',
    inicio: '2026-10-01',
    prazo: '2026-10-31',
    partida: reais(0n),
    alvo: reais(50_000n),
  }

  it('perda-sem-contagem-nao-atinge-teto: valor null depois do prazo é sem_dado, nunca atingida', () => {
    expect(situacao(perda, null, '2026-10-31', '2026-11-05')).toBe('sem_dado')
    expect(progresso(perda, null, '2026-10-31')).toBeNull()
    // Contraste: R$ 0 de perda MEDIDO, depois do prazo, atinge o teto.
    expect(situacao(perda, reais(0n), '2026-10-31', '2026-11-05')).toBe('atingida')
  })

  it('o teto não fica atingido antes do prazo, mesmo abaixo do alvo', () => {
    expect(situacao(perda, reais(10_000n), '2026-10-15', '2026-10-15')).not.toBe('atingida')
    expect(situacao(perda, reais(60_000n), '2026-10-31', '2026-11-01')).toBe('abaixo')
  })
})

describe('projeção (I-21)', () => {
  it('faturamento-conferido-dia-aberto-no-meio-nao-infla-projecao: 20 úteis, R$ 1.000 nos dias 1, 2 e 4, dia 3 aberto → 2.000.000', () => {
    // Fevereiro de 2027: seg 01 a dom 28, 20 dias úteis.
    expect(diasUteisEntre('2027-02-01', '2027-02-28')).toBe(20)
    const m = metaDeSoma('2027-02-01', '2027-02-28', 3_000_000n)
    const corte = corteDosDiasQueContam([
      { dia: '2027-02-01', conta: true },
      { dia: '2027-02-02', conta: true },
      { dia: '2027-02-03', conta: false },
      { dia: '2027-02-04', conta: true },
    ])
    expect(corte).toEqual({ ultimo: '2027-02-04', dias: ['2027-02-01', '2027-02-02', '2027-02-04'] })
    const atual = reais(300_000n)
    const p = projecao(m, atual, corte, { admiteNegativo: false, teto: null })
    expect(p.valor?.emMenorUnidade).toBe(2_000_000n)
    // O ritmo é pelos 3 dias úteis de D, não pelo prefixo até o dia aberto.
    expect(ritmoEsperado(m, corte)).toEqual({ numerador: 3_000_000n * 3n, denominador: 20n })
    // O que o spec dizia antes do gate (prefixo até o dia 2) inflava para R$ 30.000.
    expect(projecao(m, atual, '2027-02-02', { admiteNegativo: false, teto: null }).valor?.emMenorUnidade).toBe(3_000_000n)
  })

  it('projecao-com-corte-no-inicio-e-null: taxa/posição sem dia decorrido não divide por zero', () => {
    const m: MetaParaConta = {
      agregacao: 'taxa',
      direcao: 'maior',
      inicio: '2026-11-01',
      prazo: '2026-11-30',
      partida: num('percentual', 5_000n),
      alvo: num('percentual', 8_000n),
    }
    expect(projecao(m, num('percentual', 5_500n), '2026-11-01', { admiteNegativo: false, teto: 10_000n })).toEqual({
      valor: null,
      motivo: 'corte_no_inicio',
    })
    // Linear, na régua do RITMO (I-19, inclusiva — validação do T1, V2):
    // u = 11 dias de U = 30 subiram 5 p.p. → 50 + 5 × 30/11 = 63,64%.
    const p = projecao(m, num('percentual', 5_500n), '2026-11-11', { admiteNegativo: false, teto: 10_000n })
    expect(p.valor?.emMenorUnidade).toBe(6_364n)
    // Limitada ao domínio: uma taxa não projeta acima de 100%.
    const alta = projecao(m, num('percentual', 9_900n), '2026-11-02', { admiteNegativo: false, teto: 10_000n })
    expect(alta.valor?.emMenorUnidade).toBe(10_000n)
  })

  it('fonte fora do domínio vira null com motivo, nunca um max escondendo o negativo (números c.16)', () => {
    const m = metaDeSoma('2026-11-02', '2026-11-30', 1_000_000n)
    expect(projecao(m, reais(-5n), '2026-11-10', { admiteNegativo: false, teto: null })).toEqual({
      valor: null,
      motivo: 'fonte_fora_do_dominio',
    })
    // O resultado do mês admite negativo, e projeta negativo.
    const r = projecao(m, reais(-100n), '2026-11-02', { admiteNegativo: true, teto: null })
    expect(r.valor?.emMenorUnidade).toBeLessThan(0n)
  })

  it('soma sem dia útil decorrido é "cedo para projetar"', () => {
    const m = metaDeSoma('2026-11-07', '2026-11-30', 1_000_000n) // sábado
    expect(projecao(m, reais(0n), '2026-11-08', { admiteNegativo: false, teto: null }).motivo).toBe('cedo_para_projetar')
  })

  it('property: na soma, projeção = round(atual × U ÷ u), e com u = U é o próprio atual', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 0, max: 60 }), fc.bigInt({ min: 0n, max: 10n ** 12n }), (dur, off, atual) => {
        const inicio = '2026-06-01'
        const m = metaDeSoma(inicio, somarDias(inicio, dur), 1n)
        const corte = somarDias(inicio, Math.min(off, dur))
        const U = BigInt(diasUteisEntre(inicio, m.prazo))
        const u = BigInt(diasUteisEntre(inicio, corte))
        const p = projecao(m, reais(atual), corte, { admiteNegativo: false, teto: null })
        if (u === 0n) expect(p.valor).toBeNull()
        else expect(p.valor!.emMenorUnidade).toBe((2n * atual * U + u) / (2n * u))
        if (corte === m.prazo && u > 0n) expect(p.valor!.emMenorUnidade).toBe(atual)
      }),
    )
  })
})

describe('progresso (I-22)', () => {
  it('é inteiro de 0 a 100 em qualquer direção', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('maior' as const, 'menor' as const),
        fc.bigInt({ min: 0n, max: 10_000n }),
        fc.bigInt({ min: 1n, max: 10_000n }),
        fc.bigInt({ min: 0n, max: 30_000n }),
        (direcao, partida, delta, atual) => {
          const alvo = direcao === 'maior' ? partida + delta : partida - delta
          const m: MetaParaConta = {
            agregacao: 'posicao',
            direcao,
            inicio: '2026-11-01',
            prazo: '2026-11-30',
            partida: num('quantidade', partida),
            alvo: num('quantidade', alvo),
          }
          const p = progresso(m, num('quantidade', atual), '2026-11-15')!
          expect(Number.isInteger(p)).toBe(true)
          expect(p).toBeGreaterThanOrEqual(0)
          expect(p).toBeLessThanOrEqual(100)
        },
      ),
    )
  })

  it('3 KRs exibidos com 30, 60 e 90 vêm de (atual − partida) ÷ (alvo − partida)', () => {
    const m = (alvo: bigint): MetaParaConta => ({
      agregacao: 'posicao',
      direcao: 'maior',
      inicio: '2026-10-01',
      prazo: '2026-12-31',
      partida: num('quantidade', 0n),
      alvo: num('quantidade', alvo),
    })
    expect(progresso(m(1_000n), num('quantidade', 300n), '2026-11-01')).toBe(30)
    expect(progresso(m(1_000n), num('quantidade', 600n), '2026-11-01')).toBe(60)
    expect(progresso(m(1_000n), num('quantidade', 900n), '2026-11-01')).toBe(90)
    // Menor melhor: de 40 dias para 20, estando em 30 → 50%.
    const menor: MetaParaConta = { ...m(0n), direcao: 'menor', partida: num('dias', 4_000n), alvo: num('dias', 2_000n) }
    expect(progresso(menor, num('dias', 3_000n), '2026-11-01')).toBe(50)
  })

  it('no teto: 100 × fração de tempo × min(1, ritmo ÷ atual)', () => {
    // 10 úteis; corte no 5º útil; ritmo = 500. Gasto 250 (abaixo do ritmo) → 50; gasto 1.000 → 25.
    const m = metaDeSoma('2026-11-02', '2026-11-13', 1_000n, 'menor')
    expect(diasUteisEntre('2026-11-02', '2026-11-13')).toBe(10)
    expect(progresso(m, reais(250n), '2026-11-06')).toBe(50)
    expect(progresso(m, reais(1_000n), '2026-11-06')).toBe(25)
  })
})

describe('percentual da meta (números c.11a)', () => {
  it('percentual-da-meta-inteiro: inteiro, e o mesmo de percentualInteiro (a rota /percentual)', () => {
    // Os números da conta do validador: meta R$ 120.000, medido 93.600 → 78.
    expect(percentualDaMeta(reais(9_360_000n), reais(12_000_000n))).toBe(78)
    expect(percentualInteiro(9_299_900n, 12_000_000n)).toBe(77)
    expect(percentualDaMeta(reais(9_359_999n), reais(12_000_000n))).toBe(78)
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 13n }), fc.bigInt({ min: 1n, max: 10n ** 13n }), (a, m) => {
        const p = percentualDaMeta(reais(a), reais(m))!
        expect(Number.isInteger(p)).toBe(true)
        expect(p).toBe(percentualInteiro(a, m))
      }),
    )
    expect(percentualDaMeta(null, reais(100n))).toBeNull()
  })
})

describe('validação da meta (422 na borda)', () => {
  const kpi = (chave: Parameters<typeof kpiDoCatalogo>[0]) => {
    const k = kpiDoCatalogo(chave)
    return { ...k, unidade: k.unidade === 'da_metrica' ? ('reais' as const) : k.unidade }
  }

  it('resultado-do-mes-so-mes-civil-422: resultado do mês só com meta de mês inteiro', () => {
    const k = kpi('resultado_do_mes')
    const ateData = validarMeta(k, { tipo: 'ate_data', inicio: '2026-11-01', prazo: '2026-11-30', partida: reais(0n), alvo: reais(1n) })
    expect(ateData.tipo === 'erro' && ateData.erro.codigo).toBe('ResultadoDoMesSoMesCivil')
    expect(validarMeta(k, { tipo: 'mes', inicio: '2026-11-01', prazo: '2026-11-30', partida: reais(0n), alvo: reais(1n) }).tipo).toBe('ok')
    expect(validarMeta(k, { tipo: 'recorrente', inicio: '2026-02-01', prazo: '2026-02-28', partida: reais(0n), alvo: reais(1n) }).tipo).toBe('ok')
    const meio = validarMeta(k, { tipo: 'mes', inicio: '2026-11-01', prazo: '2026-11-15', partida: reais(0n), alvo: reais(1n) })
    expect(meio.tipo === 'erro' && meio.erro.codigo).toBe('MetaDoMesForaDoMes')
  })

  it('alvo pior que a partida → erro; soma com partida diferente de zero → erro', () => {
    const conv = kpi('conversao_de_orcamentos')
    const pior = validarMeta(conv, { tipo: 'ate_data', inicio: '2026-11-01', prazo: '2026-12-20', partida: num('percentual', 4_000n), alvo: num('percentual', 3_000n) })
    expect(pior.tipo === 'erro' && pior.erro.codigo).toBe('AlvoPiorQueAPartida')
    const fat = kpi('faturamento_conferido')
    const partida = validarMeta(fat, { tipo: 'mes', inicio: '2026-11-01', prazo: '2026-11-30', partida: reais(5n), alvo: reais(10n) })
    expect(partida.tipo === 'erro' && partida.erro.codigo).toBe('PartidaDaSomaNaoEZero')
    const unidade = validarMeta(fat, { tipo: 'mes', inicio: '2026-11-01', prazo: '2026-11-30', partida: num('quantidade', 0n), alvo: num('quantidade', 10n) })
    expect(unidade.tipo === 'erro' && unidade.erro.codigo).toBe('UnidadeDaMetaDiferente')
  })
})
