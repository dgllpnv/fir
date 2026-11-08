import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  agregarLancamentos,
  avaliarMeta,
  percentualDoHistorico,
  segundasDoMes,
  semanaDaReuniao,
  semanasPassadasDoMes,
  validarModeloDeMeta,
  valorParaExibicao,
  type AgregacaoDeMeta,
  type AvaliacaoDaMeta,
  type EntradaDaAvaliacao,
  type EstadoDaMeta,
  type Racional,
  type SentidoDeMeta,
  type TipoDeMeta,
} from './metas-carteira'
import { somarDias } from './relogio'
import { exigir } from './resultado'

const r = (num: bigint, den = 1n): Racional => ({ num, den })
const avaliar = (e: EntradaDaAvaliacao): AvaliacaoDaMeta => exigir(avaliarMeta(e))

const BASE: EntradaDaAvaliacao = {
  tipo: 'mensal',
  agregacao: 'soma',
  sentido: 'maior_melhor',
  valorInicial: null,
  alvo: 100n,
  atual: null,
  semanasPassadas: 0,
  semanasTotais: 5,
  inicio: null,
  prazo: null,
  hoje: '2026-11-05',
}

/* ────────────────────────────────────────────────────────────────────────
 * Semanas
 * ──────────────────────────────────────────────────────────────────────── */

describe('segundasDoMes (L747)', () => {
  it('novembro de 2026 tem 5 semanas, e a de 30/11 é de novembro', () => {
    expect(segundasDoMes('2026-11')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
  })
  it('dezembro de 2026 tem 4 semanas', () => {
    expect(segundasDoMes('2026-12')).toEqual(['2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28'])
  })
  it('mês que começa numa segunda inclui o dia 1 (junho de 2026)', () => {
    expect(segundasDoMes('2026-06')[0]).toBe('2026-06-01')
  })
})

describe('semanaDaReuniao (L750)', () => {
  // 2026-11-05 é quinta-feira.
  it('reunião na segunda: hoje quinta → a segunda desta semana', () => {
    expect(semanaDaReuniao('2026-11-05', 1)).toBe('2026-11-02')
  })
  it('reunião na quinta: hoje quinta → esta semana (já chegou)', () => {
    expect(semanaDaReuniao('2026-11-05', 4)).toBe('2026-11-02')
  })
  it('reunião na sexta: hoje quinta → a semana anterior', () => {
    expect(semanaDaReuniao('2026-11-05', 5)).toBe('2026-10-26')
  })
  it('domingo conta como o último dia da semana', () => {
    expect(semanaDaReuniao('2026-11-08', 5)).toBe('2026-11-02')
  })
})

describe('semanasPassadasDoMes (L759)', () => {
  it('a semana da reunião só conta se já foi lançada', () => {
    expect(semanasPassadasDoMes('2026-11', '2026-11-16', ['2026-11-02'])).toBe(2)
    expect(semanasPassadasDoMes('2026-11', '2026-11-16', ['2026-11-16'])).toBe(3)
  })
  it('semana da reunião no mês anterior → nenhuma passada', () => {
    expect(semanasPassadasDoMes('2026-12', '2026-11-30', ['2026-11-30'])).toBe(0)
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * Agregação
 * ──────────────────────────────────────────────────────────────────────── */

describe('agregarLancamentos', () => {
  const FUSO = 'America/Sao_Paulo'
  const agora = new Date('2026-11-05T15:00:00Z')
  const L = [
    { referencia: '2026-10-26', valor: 7n },
    { referencia: '2026-11-09', valor: 4n },
    { referencia: '2026-11-02', valor: 3n },
    { referencia: '2026-11-30', valor: 3n },
  ]

  it('mensal soma: só as segundas do mês, incluída a de 30/11', () => {
    expect(exigir(agregarLancamentos(L, 'mensal', 'soma', { agora, inicio: null }, FUSO))).toEqual(r(10n))
  })
  it('mensal média: o racional exato, sem arredondar a uma casa', () => {
    expect(exigir(agregarLancamentos(L, 'mensal', 'media', { agora, inicio: null }, FUSO))).toEqual(r(10n, 3n))
  })
  it('mensal último: o de referência mais recente, não o último do array', () => {
    expect(exigir(agregarLancamentos(L, 'mensal', 'ultimo', { agora, inicio: null }, FUSO))).toEqual(r(3n))
  })
  it('o mês sai do fuso da carteira: 02:00Z de 01/12 ainda é novembro em São Paulo', () => {
    const virada = new Date('2026-12-01T02:00:00Z')
    expect(exigir(agregarLancamentos(L, 'mensal', 'soma', { agora: virada, inicio: null }, FUSO))).toEqual(r(10n))
    expect(exigir(agregarLancamentos(L, 'mensal', 'soma', { agora: virada, inicio: null }, 'UTC'))).toBeNull()
  })
  it('prazo com início numa quarta: a semana cuja segunda é anterior fica fora (ajuste 21)', () => {
    expect(exigir(agregarLancamentos(L, 'prazo', 'soma', { agora, inicio: '2026-11-04' }, FUSO))).toEqual(r(7n))
  })
  it('sem lançamento no período → null', () => {
    expect(exigir(agregarLancamentos([], 'mensal', 'soma', { agora, inicio: null }, FUSO))).toBeNull()
  })
  it('CE-4: referência fora da segunda é recusada (terça e quinta não somam a semana duas vezes)', () => {
    const terQui = [
      { referencia: '2026-11-03', valor: 5n },
      { referencia: '2026-11-05', valor: 5n },
    ]
    const res = agregarLancamentos(terQui, 'mensal', 'soma', { agora, inicio: null }, FUSO)
    expect(res.tipo === 'erro' && res.erro.codigo).toBe('ReferenciaForaDaSegunda')
  })
  it('referência repetida é recusada', () => {
    const dup = [
      { referencia: '2026-11-02', valor: 5n },
      { referencia: '2026-11-02', valor: 5n },
    ]
    const res = agregarLancamentos(dup, 'mensal', 'soma', { agora, inicio: null }, FUSO)
    expect(res.tipo === 'erro' && res.erro.codigo).toBe('ReferenciaRepetida')
  })
})

describe('valorParaExibicao', () => {
  it('R$: centavos, meio para longe do zero', () => {
    expect(valorParaExibicao(r(100001n, 2n), 'R$')).toEqual({ valor: 50001n, escala: 'centavos' })
    expect(valorParaExibicao(r(-100001n, 2n), 'R$')).toEqual({ valor: -50001n, escala: 'centavos' })
  })
  it('un: décimos', () => {
    expect(valorParaExibicao(r(10n, 3n), 'un')).toEqual({ valor: 33n, escala: 'decimos' })
  })
  it('%: na escala de armazenamento (centésimos)', () => {
    expect(valorParaExibicao(r(9001n, 2n), '%')).toEqual({ valor: 4501n, escala: 'centesimos' })
  })
})

describe('validarModeloDeMeta (ajuste 19)', () => {
  it('recusa % com soma', () => {
    const res = validarModeloDeMeta({ unidade: '%', tipo: 'mensal', agregacao: 'soma', valorInicial: null })
    expect(res.tipo === 'erro' && res.erro.codigo).toBe('PercentualNaoSoma')
  })
  it('aceita prazo + soma com inicial ≠ 0, como o protótipo (D-22; divergência do ajuste 19 registrada no 2B)', () => {
    expect(validarModeloDeMeta({ unidade: 'un', tipo: 'prazo', agregacao: 'soma', valorInicial: 3n }).tipo).toBe('ok')
  })
  it('aceita % com média e prazo + soma com inicial 0', () => {
    expect(validarModeloDeMeta({ unidade: '%', tipo: 'mensal', agregacao: 'media', valorInicial: null }).tipo).toBe('ok')
    expect(validarModeloDeMeta({ unidade: 'un', tipo: 'prazo', agregacao: 'soma', valorInicial: 0n }).tipo).toBe('ok')
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * Casos nomeados do gate de números
 * ──────────────────────────────────────────────────────────────────────── */

describe('CE-2: meta mensal com soma decidida em racionais exatos', () => {
  it('avaliarMeta: mensal com soma, alvo 100, 1 de 5 semanas passadas, acumulado 18, está No ritmo', () => {
    const a = avaliar({ ...BASE, alvo: 100n, atual: r(18n), semanasPassadas: 1, semanasTotais: 5 })
    expect(a.estado).toBe('no_ritmo')
    expect(a.percentual).toBe(18)
    expect(a.ritmoEsperado).toBe(20)
    // O protótipo em ponto flutuante diz Atenção — é exatamente o que este teste barra.
    expect(18 / 100 >= (1 / 5) * 0.9).toBe(false)
  })
  it('a mesma varredura: alvo 50 com 9; alvo 25 com 9 e 2 de 5 semanas', () => {
    expect(avaliar({ ...BASE, alvo: 50n, atual: r(9n), semanasPassadas: 1 }).estado).toBe('no_ritmo')
    expect(avaliar({ ...BASE, alvo: 25n, atual: r(9n), semanasPassadas: 2 }).estado).toBe('no_ritmo')
  })
  it('T-23 ponta a ponta: R$ 18,00 de R$ 100,00, novembro de 2026, hoje 05/11, reunião na segunda', () => {
    const lanc = [{ referencia: '2026-11-02', valor: 1800n }]
    const atual = exigir(
      agregarLancamentos(lanc, 'mensal', 'soma', { agora: new Date('2026-11-05T15:00:00Z'), inicio: null }, 'America/Bahia'),
    )
    const sr = semanaDaReuniao('2026-11-05', 1)
    const a = avaliar({
      ...BASE,
      alvo: 10000n,
      atual,
      semanasPassadas: semanasPassadasDoMes('2026-11', sr, lanc.map((l) => l.referencia)),
      semanasTotais: segundasDoMes('2026-11').length,
    })
    expect(a.estado).toBe('no_ritmo')
  })
  it('um centavo abaixo da fronteira já é Atenção', () => {
    expect(avaliar({ ...BASE, alvo: 10000n, atual: r(1799n), semanasPassadas: 1 }).estado).toBe('atencao')
  })
})

describe('CE-5: prazo, menor é melhor, denominadores negativos', () => {
  const CE5: EntradaDaAvaliacao = {
    ...BASE,
    tipo: 'prazo',
    sentido: 'menor_melhor',
    valorInicial: 100n,
    alvo: 50n,
    inicio: '2026-10-01',
    prazo: '2026-12-30', // 90 dias
    hoje: '2026-11-30', // 60 dias → esp = 2/3, 0,9 × esp = 0,6
  }
  it('avaliarMeta com prazo, menor melhor: inicial 100, alvo 50, atual 70, progresso 60%', () => {
    const a = avaliar({ ...CE5, atual: r(70n) })
    expect(a.progresso).toEqual(r(3n, 5n))
    expect(a.percentual).toBe(60)
    expect(a.ritmoEsperado).toBe(67)
    expect(a.estado).toBe('no_ritmo') // exatamente na fronteira 0,6 ≥ 0,9 × 2/3
  })
  it('um pouco pior (71) cai para Atenção, não sobe — a multiplicação ingênua inverteria', () => {
    expect(avaliar({ ...CE5, atual: r(71n) }).estado).toBe('atencao')
    expect(avaliar({ ...CE5, atual: r(69n) }).estado).toBe('no_ritmo')
    expect(avaliar({ ...CE5, atual: r(100n) }).estado).toBe('critica')
  })
  it('atual com denominador de média (141/2 = 70,5) também decide certo', () => {
    expect(avaliar({ ...CE5, atual: r(141n, 2n) }).estado).toBe('atencao')
  })
})

describe('divisão por zero: casos definidos, nunca Infinity/NaN, nunca "sem lançamento" com lançamento', () => {
  it('prazo, maior melhor, alvo = inicial = 0: com lançamento ≥ 0, bateu (protótipo: Sem lançamento, L767/L774)', () => {
    const a = avaliar({ ...BASE, tipo: 'prazo', valorInicial: 0n, alvo: 0n, atual: r(5n), inicio: '2026-11-01', prazo: '2026-12-01' })
    expect(a.estado).toBe('atingida')
  })
  it('prazo, maior melhor, alvo = 0, atual negativo: crítica, percentual "—"', () => {
    const a = avaliar({ ...BASE, tipo: 'prazo', valorInicial: 0n, alvo: 0n, atual: r(-1n), inicio: '2026-11-01', prazo: '2026-12-01' })
    expect(a.estado).toBe('critica')
    expect(a.percentual).toBeNull()
  })
  it('mensal média, menor melhor, v = 0 e alvo 15: na meta', () => {
    const a = avaliar({ ...BASE, agregacao: 'media', sentido: 'menor_melhor', alvo: 15n, atual: r(0n) })
    expect(a.detalhe).toBe('na_meta')
    expect(a.percentual).toBeNull()
  })
  it('prazo sem inicial, menor melhor, v = 0: progresso máximo 1,2', () => {
    const a = avaliar({ ...BASE, tipo: 'prazo', sentido: 'menor_melhor', alvo: 15n, atual: r(0n), inicio: '2026-11-01', prazo: '2026-12-01' })
    expect(a.estado).toBe('atingida')
    expect(a.percentual).toBe(120)
  })
  it('v = alvo = 0 em todo tipo: bateu, 100%', () => {
    for (const tipo of ['mensal', 'prazo'] as const)
      for (const agregacao of ['soma', 'media', 'ultimo'] as const)
        for (const sentido of ['maior_melhor', 'menor_melhor'] as const) {
          const a = avaliar({ ...BASE, tipo, agregacao, sentido, alvo: 0n, atual: r(0n), semanasPassadas: 2 })
          expect(a.bateu).toBe(true)
          expect(a.percentual).toBe(100)
        }
  })
  it('histórico com divisor zero → null ("—")', () => {
    expect(percentualDoHistorico(r(0n), 15n, 'menor_melhor')).toBeNull()
    expect(percentualDoHistorico(r(7n), 0n, 'maior_melhor')).toBeNull()
    expect(percentualDoHistorico(r(9n), 10n, 'maior_melhor')).toEqual({ percentual: 90, faixa: 'atencao' })
    expect(percentualDoHistorico(r(15n), 15n, 'menor_melhor')).toEqual({ percentual: 100, faixa: 'ok' })
  })
})

describe('regras do protótipo, ramo a ramo', () => {
  it('mensal média/último nunca dá "No ritmo": ≥ 0,9 é Atenção (L775)', () => {
    expect(avaliar({ ...BASE, agregacao: 'ultimo', alvo: 10n, atual: r(9n) }).estado).toBe('atencao')
    expect(avaliar({ ...BASE, agregacao: 'ultimo', alvo: 10n, atual: r(8n) }).estado).toBe('critica')
  })
  it('os limiares são exatamente 0,9 e 0,7: uma parte em um bilhão abaixo já cai de faixa', () => {
    const bi = 1_000_000_000n
    // L775: mensal por razão, 0,9.
    expect(avaliar({ ...BASE, agregacao: 'ultimo', alvo: bi, atual: r(900_000_000n) }).estado).toBe('atencao')
    expect(avaliar({ ...BASE, agregacao: 'ultimo', alvo: bi, atual: r(899_999_999n) }).estado).toBe('critica')
    // L776: 0,9 × esp, esp = 1/5 → 0,18.
    expect(avaliar({ ...BASE, alvo: bi, atual: r(180_000_000n), semanasPassadas: 1 }).estado).toBe('no_ritmo')
    expect(avaliar({ ...BASE, alvo: bi, atual: r(179_999_999n), semanasPassadas: 1 }).estado).toBe('atencao')
    // L777: 0,7 × esp → 0,14.
    expect(avaliar({ ...BASE, alvo: bi, atual: r(140_000_000n), semanasPassadas: 1 }).estado).toBe('atencao')
    expect(avaliar({ ...BASE, alvo: bi, atual: r(139_999_999n), semanasPassadas: 1 }).estado).toBe('critica')
    // Histórico (L790): 1 e 0,9.
    expect(percentualDoHistorico(r(899_999_999n), bi, 'maior_melhor')!.faixa).toBe('critica')
    expect(percentualDoHistorico(r(999_999_999n), bi, 'maior_melhor')!.faixa).toBe('atencao')
  })
  it('prazo vencido vem antes de "sem lançamento" e de ritmo (L773)', () => {
    const e: EntradaDaAvaliacao = { ...BASE, tipo: 'prazo', alvo: 10n, inicio: '2026-10-01', prazo: '2026-11-04' }
    expect(avaliar({ ...e, atual: null }).detalhe).toBe('prazo_vencido')
    expect(avaliar({ ...e, atual: r(9n) }).detalhe).toBe('prazo_vencido')
    expect(avaliar({ ...e, atual: r(10n) }).estado).toBe('atingida')
    expect(avaliar({ ...e, prazo: '2026-11-05', atual: r(9n) }).estado).toBe('no_ritmo') // vence hoje ainda não venceu
  })
  it('sem lançamento → sem_lancamento', () => {
    expect(avaliar({ ...BASE, atual: null }).estado).toBe('sem_lancamento')
  })
  it('prazo: progresso limitado a [0, 1,2] (L767)', () => {
    const e: EntradaDaAvaliacao = { ...BASE, tipo: 'prazo', valorInicial: 10n, alvo: 20n, inicio: '2026-11-01', prazo: '2026-12-01' }
    expect(avaliar({ ...e, atual: r(5n) }).percentual).toBe(0)
    expect(avaliar({ ...e, alvo: 8n, atual: r(5n) }).percentual).toBe(120)
  })
  it('esperado com início no futuro é 0 e depois do prazo é 1 (L768)', () => {
    const e: EntradaDaAvaliacao = { ...BASE, tipo: 'prazo', alvo: 10n, atual: r(1n), inicio: '2026-12-01', prazo: '2027-01-01' }
    expect(avaliar(e).ritmoEsperado).toBe(0)
    expect(avaliar({ ...e, inicio: '2026-01-01', prazo: '2026-02-01' }).ritmoEsperado).toBe(100)
  })
  it('entrada impossível é erro, não exceção', () => {
    expect(avaliarMeta({ ...BASE, semanasPassadas: 6, semanasTotais: 5 }).tipo).toBe('erro')
    expect(avaliarMeta({ ...BASE, semanasTotais: 0 }).tipo).toBe('erro')
    expect(avaliarMeta({ ...BASE, atual: r(1n, 0n) }).tipo).toBe('erro')
    expect(avaliarMeta({ ...BASE, hoje: '05/11/2026' }).tipo).toBe('erro')
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * Os exemplos do protótipo (seed L948-955, TIPO_META L642), hoje = 05/11/2026
 * ──────────────────────────────────────────────────────────────────────── */

describe('exemplos do protótipo (TIPO_META m1–m8)', () => {
  const H = '2026-11-05'
  const dia = (n: number): string => somarDias(H, n)
  const prazo = (alvo: bigint, ini: bigint, atual: bigint, i: number, p: number, agregacao: AgregacaoDeMeta = 'soma') =>
    avaliar({ ...BASE, tipo: 'prazo', agregacao, valorInicial: ini, alvo, atual: r(atual), inicio: dia(i), prazo: dia(p), hoje: H })

  it('m1 mensal soma, faturamento R$ 180 mil: 2 de 5 semanas, R$ 65 mil → No ritmo', () => {
    // esp = 2/5; 0,9 × 0,4 = 0,36; 65/180 = 0,361…
    const a = avaliar({ ...BASE, alvo: 18_000_000n, atual: r(6_500_000n), semanasPassadas: 2, semanasTotais: 5 })
    expect(a.estado).toBe('no_ritmo')
    expect(a.percentual).toBe(36)
  })
  it('m2 mensal média, conversão 45%: atual 42 → Atenção (93%)', () => {
    const a = avaliar({ ...BASE, agregacao: 'media', alvo: 4500n, atual: r(4200n) })
    expect([a.estado, a.percentual]).toEqual(['atencao', 93])
  })
  it('m3 prazo soma, 60 reativações: 18 com 50 de 75 dias → Abaixo do ritmo', () => {
    const a = prazo(60n, 0n, 18n, -50, 25)
    expect([a.detalhe, a.percentual, a.ritmoEsperado]).toEqual(['abaixo_do_ritmo', 30, 67])
  })
  it('m4 mensal último, margem 35%: atual 32 → Atenção (91%)', () => {
    const a = avaliar({ ...BASE, agregacao: 'ultimo', alvo: 3500n, atual: r(3200n) })
    expect([a.estado, a.percentual]).toEqual(['atencao', 91])
  })
  it('m5 mensal último, menor melhor, prazo de entrega 15 dias: atual 21 → Abaixo (71%)', () => {
    const a = avaliar({ ...BASE, agregacao: 'ultimo', sentido: 'menor_melhor', alvo: 15n, atual: r(21n) })
    expect([a.detalhe, a.percentual]).toEqual(['abaixo_do_ritmo', 71])
  })
  it('m6 mensal soma, 120 leads: 3 de 5 semanas, 50 → Atenção', () => {
    // esp = 3/5; 50/120 = 0,4167; 0,9 esp = 0,54; 0,7 esp = 0,42 → abaixo; 51/120 = 0,425 → atenção
    expect(avaliar({ ...BASE, alvo: 120n, atual: r(50n), semanasPassadas: 3 }).estado).toBe('critica')
    expect(avaliar({ ...BASE, alvo: 120n, atual: r(51n), semanasPassadas: 3 }).estado).toBe('atencao')
  })
  it('m7 prazo soma, 20 vendas: 11 com 110 de 180 dias → No ritmo, exatamente na fronteira 0,55', () => {
    const a = prazo(20n, 0n, 11n, -110, 70)
    expect([a.estado, a.percentual, a.ritmoEsperado]).toEqual(['no_ritmo', 55, 61])
    expect(avaliar({ ...BASE, tipo: 'prazo', alvo: 2000n, valorInicial: 0n, atual: r(1099n), inicio: dia(-110), prazo: dia(70), hoje: H }).estado).toBe('atencao')
  })
  it('m8 prazo último, faturamento semanal R$ 38 mil: de 31 mil para 36 mil, 40 de 90 dias → No ritmo', () => {
    const a = prazo(3_800_000n, 3_100_000n, 3_600_000n, -40, 50, 'ultimo')
    expect([a.estado, a.percentual, a.ritmoEsperado]).toEqual(['no_ritmo', 71, 44])
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * Property-based
 * ──────────────────────────────────────────────────────────────────────── */

const RANK: Record<Exclude<EstadoDaMeta, 'sem_lancamento'>, number> = { critica: 0, atencao: 1, no_ritmo: 2, atingida: 3 }
const rank = (e: EstadoDaMeta): number => {
  if (e === 'sem_lancamento') throw new Error('sem_lancamento com lançamento')
  return RANK[e]
}

/** Inteiros pequenos, com peso nas bordas: 0, ±1 e os iguais entre si. */
const inteiro = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: -3, max: 3 }) },
  { weight: 5, arbitrary: fc.integer({ min: -60, max: 250 }) },
).map(BigInt)

const dia = fc.integer({ min: -120, max: 120 }).map((n) => somarDias('2026-11-05', n))

const entrada = fc
  .record({
    tipo: fc.constantFrom<TipoDeMeta>('mensal', 'prazo'),
    agregacao: fc.constantFrom<AgregacaoDeMeta>('soma', 'media', 'ultimo'),
    sentido: fc.constantFrom<SentidoDeMeta>('maior_melhor', 'menor_melhor'),
    alvo: inteiro,
    ini: fc.option(inteiro, { nil: null }),
    iniIgualAlvo: fc.boolean(),
    totais: fc.constantFrom(4, 5),
    passadasFracao: fc.integer({ min: 0, max: 5 }),
    inicio: fc.option(dia, { nil: null }),
    prazo: fc.option(dia, { nil: null }),
    num: inteiro,
    den: fc.integer({ min: 1, max: 6 }).map(BigInt),
  })
  .map((g): EntradaDaAvaliacao => ({
    tipo: g.tipo,
    agregacao: g.agregacao,
    sentido: g.sentido,
    alvo: g.alvo,
    valorInicial: g.iniIgualAlvo ? g.alvo : g.ini,
    atual: r(g.num, g.den),
    semanasPassadas: Math.min(g.passadasFracao, g.totais),
    semanasTotais: g.totais,
    inicio: g.inicio,
    prazo: g.prazo,
    hoje: '2026-11-05',
  }))

describe('propriedades de avaliarMeta', () => {
  it('nunca lança, nunca NaN/Infinity, e com lançamento nunca "sem lançamento"', () => {
    fc.assert(
      fc.property(entrada, (e) => {
        const a = avaliar(e)
        expect(a.estado).not.toBe('sem_lancamento')
        if (a.percentual !== null) expect(Number.isFinite(a.percentual)).toBe(true)
        expect(Number.isFinite(a.ritmoEsperado)).toBe(true)
        expect(a.ritmoEsperado).toBeGreaterThanOrEqual(0)
        expect(a.ritmoEsperado).toBeLessThanOrEqual(100)
      }),
      { numRuns: 3000 },
    )
  })

  it('monotonicidade: mais progresso nunca piora o estado (maior-melhor); espelhado para menor-melhor', () => {
    fc.assert(
      fc.property(entrada, fc.integer({ min: 1, max: 80 }).map(BigInt), (e, delta) => {
        const v = e.atual!
        const mais: EntradaDaAvaliacao = { ...e, atual: r(v.num + delta * v.den, v.den) } // v + delta
        const a = rank(avaliar(e).estado)
        const b = rank(avaliar(mais).estado)
        if (e.sentido === 'maior_melhor') expect(b).toBeGreaterThanOrEqual(a)
        else expect(b).toBeLessThanOrEqual(a)
      }),
      { numRuns: 3000 },
    )
  })

  it('invariância de escala: multiplicar alvo, inicial e atual por k > 0 não muda estado nem percentual', () => {
    fc.assert(
      fc.property(entrada, fc.integer({ min: 2, max: 10_000 }).map(BigInt), (e, k) => {
        const v = e.atual!
        const escalada: EntradaDaAvaliacao = {
          ...e,
          alvo: e.alvo * k,
          valorInicial: e.valorInicial === null ? null : e.valorInicial * k,
          atual: r(v.num * k, v.den),
        }
        const a = avaliar(e)
        const b = avaliar(escalada)
        expect([b.estado, b.detalhe, b.percentual, b.ritmoEsperado]).toEqual([a.estado, a.detalhe, a.percentual, a.ritmoEsperado])
      }),
      { numRuns: 2000 },
    )
  })

  it('T-4 oráculo racional: igual a uma reescrita literal do protótipo em frações exatas', () => {
    fc.assert(
      fc.property(entrada, (e) => {
        expect(avaliar(e).detalhe).toBe(oraculo(e))
      }),
      { numRuns: 5000 },
    )
  })

  it('fidelidade ao protótipo: igual ao avaliarMeta em float sempre que o float não está numa fronteira', () => {
    fc.assert(
      fc.property(entrada, (e) => {
        const p = prototipoEmFloat(e)
        if (p === 'indefinido') return // fronteira, 0/0, ou alvo 0 no ramo L767 (divergências intencionais)
        expect(avaliar(e).detalhe).toBe(p)
      }),
      { numRuns: 5000 },
    )
  })
})

describe('agregação + avaliação, ponta a ponta', () => {
  it('a soma agregada é exatamente a soma dos lançamentos do mês, e a média vezes n também', () => {
    const segundas = segundasDoMes('2026-11')
    fc.assert(
      fc.property(fc.subarray(segundas, { minLength: 1 }), fc.array(inteiro, { minLength: 5, maxLength: 5 }), (refs, vals) => {
        const L = refs.map((referencia, i) => ({ referencia, valor: vals[i]! }))
        const total = L.reduce((s, l) => s + l.valor, 0n)
        const p = { agora: new Date('2026-11-20T12:00:00Z'), inicio: null }
        expect(exigir(agregarLancamentos(L, 'mensal', 'soma', p, 'America/Bahia'))!).toEqual(normal(total, 1n))
        const m = exigir(agregarLancamentos(L, 'mensal', 'media', p, 'America/Bahia'))!
        expect(m.num * BigInt(L.length)).toBe(total * m.den)
      }),
    )
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * Oráculos
 * ──────────────────────────────────────────────────────────────────────── */

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a
  b = b < 0n ? -b : b
  while (b) [a, b] = [b, a % b]
  return a
}
const normal = (n: bigint, d: bigint): Racional => {
  const s = d < 0n ? -1n : 1n
  const g = gcd(n, d) || 1n
  return { num: (s * n) / g, den: (s * d) / g }
}

/**
 * Fração exata do oráculo: ±∞ como `{inf: ±1}`. A comparação é pelo SINAL de
 * `a − b` — técnica diferente da multiplicação cruzada do módulo, e que
 * trata denominador negativo sem normalizar (o sinal do produto dos
 * denominadores entra explicitamente).
 */
type Q = { n: bigint; d: bigint } | { inf: 1 | -1 }
const q = (n: bigint, d: bigint = 1n): Q => ({ n, d })
const sinal = (x: bigint): number => (x > 0n ? 1 : x < 0n ? -1 : 0)
const cmpQ = (a: Q, b: Q): number => {
  if ('inf' in a && 'inf' in b) return Math.sign(a.inf - b.inf)
  if ('inf' in a) return a.inf
  if ('inf' in b) return -b.inf
  return sinal(a.n * b.d - b.n * a.d) * sinal(a.d * b.d)
}
const divQ = (a: Q, b: Q): Q => {
  if ('inf' in a || 'inf' in b) throw new Error('oráculo: divisão com infinito')
  if (b.n === 0n) {
    if (a.n === 0n) return q(1n) // 0/0 só acontece quando bateu; o valor não decide
    return { inf: (sinal(a.n) * sinal(a.d) * sinal(b.d)) as 1 | -1 }
  }
  return q(a.n * b.d, a.d * b.n)
}
const mulQ = (a: Q, b: Q): Q => {
  if ('inf' in a || 'inf' in b) throw new Error('oráculo: produto com infinito')
  return q(a.n * b.n, a.d * b.d)
}
const minQ = (a: Q, b: Q): Q => (cmpQ(a, b) <= 0 ? a : b)
const maxQ = (a: Q, b: Q): Q => (cmpQ(a, b) >= 0 ? a : b)
const diasQ = (de: string, ate: string): number =>
  (Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10)) -
    Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10))) /
  86_400_000

/** O `avaliarMeta` do protótipo (L751-780), linha por linha, com `Q` no lugar de `number`. */
function oraculo(e: EntradaDaAvaliacao): string {
  const alvo = q(e.alvo)
  const menor = e.sentido === 'menor_melhor'
  const vn = e.atual!.num
  const vd = e.atual!.den
  const v = q(vn, vd)
  let prog: Q | null = null
  let esp: Q
  const bateu = menor ? cmpQ(v, alvo) <= 0 : cmpQ(v, alvo) >= 0
  if (e.tipo === 'mensal') {
    if (e.agregacao === 'soma') {
      esp = q(BigInt(e.semanasPassadas), BigInt(e.semanasTotais))
      prog = divQ(v, alvo)
    } else {
      esp = q(1n)
      prog = menor ? divQ(alvo, v) : divQ(v, alvo)
    }
  } else {
    const ini = e.valorInicial !== null ? e.valorInicial : menor ? null : 0n
    if (ini !== null && ini !== e.alvo) {
      // (v − ini) / (alvo − ini) SEM normalizar o denominador: o cmpQ cuida do sinal.
      prog = maxQ(q(0n), minQ(q(6n, 5n), divQ({ n: vn - ini * vd, d: vd }, q(e.alvo - ini))))
    } else {
      prog = minQ(q(6n, 5n), menor ? divQ(alvo, v) : divQ(v, alvo))
    }
    const a = e.inicio ?? e.hoje
    const b = e.prazo ?? e.hoje
    const tot = Math.max(1, diasQ(a, b))
    esp = maxQ(q(0n), minQ(q(1n), q(BigInt(diasQ(a, e.hoje)), BigInt(tot))))
  }
  if (bateu) return e.tipo === 'mensal' && e.agregacao !== 'soma' ? 'na_meta' : 'atingida'
  if (e.tipo !== 'mensal' && e.prazo && diasQ(e.hoje, e.prazo) < 0) return 'prazo_vencido'
  if (e.tipo === 'mensal' && e.agregacao !== 'soma') return cmpQ(prog, q(9n, 10n)) >= 0 ? 'atencao' : 'abaixo_do_ritmo'
  if (cmpQ(prog, mulQ(esp, q(9n, 10n))) >= 0) return 'no_ritmo'
  if (cmpQ(prog, mulQ(esp, q(7n, 10n))) >= 0) return 'atencao'
  return 'abaixo_do_ritmo'
}

/**
 * O `avaliarMeta` do protótipo em `number`, como está no HTML. Devolve
 * "indefinido" quando o float não é confiável (a menos de 1e-9 de um limiar),
 * quando dá NaN, ou no ramo de L767 com `alvo = 0` (o protótipo devolve
 * "Sem lançamento" com lançamento — divergência intencional, ajuste 16).
 */
function prototipoEmFloat(e: EntradaDaAvaliacao): string {
  const alvo = Number(e.alvo)
  const menor = e.sentido === 'menor_melhor'
  const v = Number(e.atual!.num) / Number(e.atual!.den)
  const perto = (a: number, b: number) => Math.abs(a - b) < 1e-9
  let prog: number | null = null
  let esp = 0
  if (perto(v, alvo) && v !== alvo) return 'indefinido'
  const bateu = menor ? v <= alvo : v >= alvo
  if (e.tipo === 'mensal') {
    if (e.agregacao === 'soma') {
      esp = e.semanasPassadas / e.semanasTotais
      prog = v / alvo
    } else {
      esp = 1
      prog = menor ? alvo / v : v / alvo
    }
  } else {
    const ini = e.valorInicial === null ? (menor ? null : 0) : Number(e.valorInicial)
    if (ini !== null && alvo !== ini) prog = Math.max(0, Math.min(1.2, (v - ini) / (alvo - ini)))
    else if (alvo) prog = menor ? Math.min(1.2, alvo / v) : Math.min(1.2, v / alvo)
    else if (!bateu) return 'indefinido'
    const a = diasQ('2026-11-05', e.inicio ?? e.hoje)
    const b = diasQ('2026-11-05', e.prazo ?? e.hoje)
    const tot = Math.max(1, b - a)
    esp = Math.max(0, Math.min(1, (0 - a) / tot))
  }
  if (bateu) return e.tipo === 'mensal' && e.agregacao !== 'soma' ? 'na_meta' : 'atingida'
  if (e.tipo !== 'mensal' && e.prazo && diasQ(e.hoje, e.prazo) < 0) return 'prazo_vencido'
  if (prog === null || Number.isNaN(prog)) return 'indefinido'
  if (e.tipo === 'mensal' && e.agregacao !== 'soma') {
    if (perto(prog, 0.9)) return 'indefinido'
    return prog >= 0.9 ? 'atencao' : 'abaixo_do_ritmo'
  }
  if (perto(prog, esp * 0.9) || perto(prog, esp * 0.7)) return 'indefinido'
  if (prog >= esp * 0.9) return 'no_ritmo'
  if (prog >= esp * 0.7) return 'atencao'
  return 'abaixo_do_ritmo'
}
