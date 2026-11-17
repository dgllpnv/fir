import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { diasEntre, somarDias } from '../relogio'
import { kpiDoCatalogo } from './catalogo'
import { classificarDesfecho, contarDesfechos } from './jornada'
import { type MetaParaConta, projecao, ritmoEsperado, situacao, validarMeta } from './meta'
import { progressoDoOkr } from './okr'
import { corteDosDiasQueContam, diasUteisEntre } from './periodos'
import { NumeroDoKpi, type UnidadeDeKpi } from './unidades'

/**
 * Validação de números do T1 (validador-numeros, 2026-11-17). Contraexemplos
 * congelados e propriedades com oráculo independente. Os testes marcados
 * DEFEITO falham hoje de propósito: são a prova, e a correção é do T1.
 */

const num = (u: UnidadeDeKpi, v: bigint) => NumeroDoKpi.de(u, v)
const ev = (acao: string, etapa: string, em: string) =>
  ({ acao, etapa, em }) as Parameters<typeof classificarDesfecho>[0][number]
const JANELA = { de: new Date('2026-11-01T03:00:00Z'), ate: new Date('2026-12-01T03:00:00Z') }

describe('DEFEITO V1 — comparecimento conta o mesmo atendimento duas vezes (I-10)', () => {
  it('comparecimento-excluir-orcamento-nao-conta-segundo-realizado', () => {
    // Um atendimento, um orçamento lançado por engano e excluído: excluirOrcamento
    // devolve o cartão a `realizado`, e "entrar em realizado" conta de novo.
    const h = [
      ev('agendar', 'agendado', '2026-11-02T12:00:00Z'),
      ev('concluir', 'realizado', '2026-11-03T12:00:00Z'),
      ev('registrarOrcamento', 'orcamento', '2026-11-03T12:10:00Z'),
      ev('excluirOrcamento', 'realizado', '2026-11-03T12:20:00Z'),
    ]
    expect(contarDesfechos(classificarDesfecho(h), JANELA)).toEqual({ realizados: 1, faltas: 0 })
  })

  it('comparecimento-reabrir-de-orcamento-e-concluir-conta-um', () => {
    // reabrir de `orcamento` volta à última etapa aberta (agendado); o realizado
    // anterior foi desfeito, mas o "reabrir logo em seguida" não o alcança
    // porque o evento seguinte ao concluir é o registrarOrcamento.
    const h = [
      ev('agendar', 'agendado', '2026-11-02T12:00:00Z'),
      ev('concluir', 'realizado', '2026-11-03T12:00:00Z'),
      ev('registrarOrcamento', 'orcamento', '2026-11-03T12:10:00Z'),
      ev('reabrir', 'agendado', '2026-11-03T12:20:00Z'),
      ev('concluir', 'realizado', '2026-11-04T12:00:00Z'),
    ]
    expect(contarDesfechos(classificarDesfecho(h), JANELA)).toEqual({ realizados: 1, faltas: 0 })
  })
})

describe('DEFEITO V2 — projeção de taxa/posição usa outra régua que o ritmo (I-19 × I-21)', () => {
  const meta: MetaParaConta = {
    agregacao: 'taxa',
    direcao: 'maior',
    inicio: '2026-11-01',
    prazo: '2026-11-30',
    partida: num('percentual', 5_000n),
    alvo: num('percentual', 8_000n),
  }
  const dominio = { admiteNegativo: false, teto: 10_000n }

  it('projecao-taxa-no-ritmo-projeta-o-alvo: 50% → 80% em 30 dias, no fim do dia 10 o ritmo é 60%; estar em 60% projeta 80%', () => {
    // I-19: 5000 + 3000 × 10 ÷ 30 = 6000 exatos.
    expect(ritmoEsperado(meta, '2026-11-10')).toEqual({ numerador: 180_000n, denominador: 30n })
    expect(situacao(meta, num('percentual', 6_000n), '2026-11-10', '2026-11-10')).toBe('no_ritmo')
    // Hoje: 5000 + 1000 × 29 ÷ 9 = 8222 (82,22%) — quem está exatamente no ritmo "passa da meta".
    expect(projecao(meta, num('percentual', 6_000n), '2026-11-10', dominio).valor?.emMenorUnidade).toBe(8_000n)
  })

  it('projecao-taxa-atencao-nao-projeta-meta-atingida: 59,5% está em atenção e não pode projetar ≥ 80%', () => {
    expect(situacao(meta, num('percentual', 5_950n), '2026-11-10', '2026-11-10')).toBe('atencao')
    // Hoje projeta 5000 + 950 × 29 ÷ 9 = 8061: o cartão diz "atenção" e "vai atingir".
    const p = projecao(meta, num('percentual', 5_950n), '2026-11-10', dominio).valor!.emMenorUnidade
    expect(p < 8_000n).toBe(true)
  })

  it('property: em taxa/posição/media_mensal, atual = ritmo exato ⇒ projeção = alvo (a soma já cumpre)', () => {
    // Corte a partir do 2º dia: isola a régua da questão de c.16 (corte = início).
    fc.assert(
      fc.property(
        fc.constantFrom('taxa' as const, 'posicao' as const, 'media_mensal' as const),
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 1, max: 60 }),
        fc.bigInt({ min: 0n, max: 5_000n }),
        fc.bigInt({ min: 1n, max: 5_000n }),
        (agregacao, dur, off, partida, delta) => {
          const inicio = '2026-06-01'
          const prazo = somarDias(inicio, dur)
          const corte = somarDias(inicio, Math.min(off, dur))
          // Oráculo próprio: régua de corridos, inclusiva, fim do dia (I-19).
          const U = BigInt(diasEntre(inicio, prazo) + 1)
          const u = BigInt(diasEntre(inicio, corte) + 1)
          const alvo = partida + delta * U // múltiplo de U: o ritmo é inteiro
          const ritmo = partida + delta * u
          const m: MetaParaConta = { agregacao, direcao: 'maior', inicio, prazo, partida: num('quantidade', partida), alvo: num('quantidade', alvo) }
          expect(ritmoEsperado(m, corte)).toEqual({ numerador: ritmo * U, denominador: U })
          const p = projecao(m, num('quantidade', ritmo), corte, { admiteNegativo: false, teto: null })
          expect(p.valor?.emMenorUnidade).toBe(alvo)
        },
      ),
    )
  })
})

describe('DEFEITO V3 — meta com alvo acima do teto do KPI é aceita', () => {
  it('validar-meta-recusa-alvo-acima-do-teto: comparecimento com alvo 150% nunca é atingível', () => {
    const k = kpiDoCatalogo('comparecimento')
    expect(k.teto).toBe(10_000n)
    const r = validarMeta(
      { ...k, unidade: 'percentual' },
      { tipo: 'ate_data', inicio: '2026-11-01', prazo: '2026-12-20', partida: num('percentual', 7_000n), alvo: num('percentual', 15_000n) },
    )
    expect(r.tipo === 'erro' && r.erro.codigo).toBe('ValorForaDoDominio')
  })
})

describe('propriedades que passam (oráculo independente)', () => {
  it('faturamento-conferido-dia-aguardando-nao-mexe-no-ritmo: acrescentar dias que não contam não muda ritmo nem projeção (B1)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 28, maxLength: 28 }),
        fc.array(fc.boolean(), { minLength: 28, maxLength: 28 }),
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        (contaMask, extraMask, atual) => {
          const dias = Array.from({ length: 28 }, (_, i) => somarDias('2027-02-01', i))
          const so = corteDosDiasQueContam(dias.filter((_, i) => contaMask[i]).map((dia) => ({ dia, conta: true })))
          const comAguardando = corteDosDiasQueContam(
            dias.map((dia, i) => ({ dia, conta: contaMask[i]! })).filter((d, i) => d.conta || extraMask[i]),
          )
          const m: MetaParaConta = { agregacao: 'soma', direcao: 'maior', inicio: '2027-02-01', prazo: '2027-02-28', partida: num('reais', 0n), alvo: num('reais', 3_000_000n) }
          expect(ritmoEsperado(m, comAguardando)).toEqual(ritmoEsperado(m, so))
          const d = { admiteNegativo: false, teto: null }
          expect(projecao(m, num('reais', atual), comAguardando, d)).toEqual(projecao(m, num('reais', atual), so, d))
          // E os decorridos são os úteis de D, conferidos por contagem própria.
          const uteisDeD = so.dias.filter((x) => diasUteisEntre(x, x) === 1).length
          const p = projecao(m, num('reais', atual), so, d)
          if (uteisDeD === 0) expect(p.valor).toBeNull()
          else expect(p.valor!.emMenorUnidade).toBe((2n * atual * 20n + BigInt(uteisDeD)) / (2n * BigInt(uteisDeD)))
        },
      ),
    )
  })

  it('situacao-oraculo-racional (c.7): toda agregação e direção, antes do prazo, bate com a classificação exata em frações', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('taxa' as const, 'posicao' as const, 'media_mensal' as const),
        fc.constantFrom('maior' as const, 'menor' as const),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        fc.bigInt({ min: 0n, max: 100_000n }),
        fc.bigInt({ min: 1n, max: 100_000n }),
        fc.bigInt({ min: 0n, max: 300_000n }),
        (agregacao, direcao, dur, off, partida, delta, x) => {
          const inicio = '2026-06-01'
          const prazo = somarDias(inicio, dur)
          const corte = somarDias(inicio, Math.min(off, dur))
          const alvo = direcao === 'maior' ? partida + delta : partida - delta
          if (alvo < 0n) return
          const m: MetaParaConta = { agregacao, direcao, inicio, prazo, partida: num('quantidade', partida), alvo: num('quantidade', alvo) }
          const s = situacao(m, num('quantidade', x), corte, corte)
          const atingiu = direcao === 'maior' ? x >= alvo : x <= alvo
          if (atingiu) {
            expect(s).toBe('atingida')
            return
          }
          const U = BigInt(diasEntre(inicio, prazo) + 1)
          const u = BigInt(diasEntre(inicio, corte) + 1)
          // ritmo = partida + (alvo − partida)·u/U; tudo × U.
          const rU = partida * U + (alvo - partida) * u
          const sinal = direcao === 'maior' ? 1n : -1n
          const dif = sinal * (x * U - rU)
          const avanco = rU - partida * U < 0n ? partida * U - rU : rU - partida * U
          const esperado = dif >= 0n ? 'no_ritmo' : 10n * dif >= -avanco ? 'atencao' : 'abaixo'
          expect(s).toBe(esperado)
          return undefined
        },
      ),
    )
  })

  it('okr-media-meio-para-cima (c.12): progressoDoOkr = ⌊Σ/n + ½⌋ dos exibidos', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 5 }), (xs) => {
        const s = BigInt(xs.reduce((a, b) => a + b, 0))
        const n = BigInt(xs.length)
        expect(BigInt(progressoDoOkr(xs)!)).toBe((2n * s + n) / (2n * n))
      }),
    )
  })
})
