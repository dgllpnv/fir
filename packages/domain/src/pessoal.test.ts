import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type Contrato,
  DIAS_DE_FERIAS_POR_PERIODO,
  type FeriasRegistradas,
  type PessoaParaAlerta,
  alertasDaPessoa,
  diasDeFerias,
  feriasSeSobrepoem,
  mesesDeCasa,
  ordenarAlertas,
  periodosAquisitivos,
} from './pessoal'
import { diasEntre, somarDias } from './relogio'

const periodos = (
  admissao: string | null,
  hoje: string,
  ferias: readonly FeriasRegistradas[] = [],
  contrato: Contrato = 'CLT',
) => periodosAquisitivos({ contrato, admissao, ferias, hoje })

describe('periodosAquisitivos — o que a CLT cobra e o que custa em dobro', () => {
  it('só período COMPLETO aparece: no primeiro ano não há nada a conceder', () => {
    // Admissão em 01/03/2026, hoje 28/02/2027: o primeiro período fecha em
    // 28/02/2027, que é HOJE — ele ainda não terminou.
    expect(periodos('2026-03-01', '2027-02-28')).toEqual([])
    // Um dia depois ele terminou, e os 30 dias estão adquiridos.
    expect(periodos('2026-03-01', '2027-03-01')).toHaveLength(1)
  })

  it('o prazo de concessão é o fim do período SEGUINTE (art. 134)', () => {
    const [p] = periodos('2024-03-01', '2026-06-01')
    expect(p).toMatchObject({
      indice: 1,
      inicio: '2024-03-01',
      fim: '2025-02-28',
      concederAte: '2026-02-28',
      diasConcedidos: 0,
      diasRestantes: 30,
      vencido: true,
    })
  })

  it('abate os dias registrados do período MAIS ANTIGO primeiro', () => {
    // Três períodos completos (admissão 2022, hoje 2026) e 40 dias de férias
    // registrados: 30 no primeiro, 10 no segundo, 0 no terceiro.
    const ps = periodos('2022-01-10', '2026-02-01', [
      { inicio: '2023-02-01', fim: '2023-03-02' }, // 30 dias
      { inicio: '2024-05-01', fim: '2024-05-10' }, // 10 dias
    ])
    expect(ps).toHaveLength(4)
    expect(ps.map((p) => p.diasConcedidos)).toEqual([30, 10, 0, 0])
    expect(ps.map((p) => p.diasRestantes)).toEqual([0, 20, 30, 30])
  })

  it('as datas vêm de somarMeses, e 29/02 não abre buraco nem conta duas vezes', () => {
    const ps = periodos('2024-02-29', '2027-06-01')
    expect(ps.map((p) => [p.inicio, p.fim])).toEqual([
      // `somarMeses` clampa 29/02 → 28/02 no ano comum, e o fim é o dia
      // anterior ao início do período seguinte — SEMPRE.
      ['2024-02-29', '2025-02-27'],
      ['2025-02-28', '2026-02-27'],
      ['2026-02-28', '2027-02-27'],
    ])
  })

  it('só CLT tem período aquisitivo, e sem admissão não há o que calcular', () => {
    for (const c of ['PJ', 'Estágio', 'Autônomo', 'Sócia'] as const) {
      expect(periodos('2020-01-01', '2026-01-01', [], c)).toEqual([])
    }
    expect(periodos(null, '2026-01-01')).toEqual([])
  })

  it('diasDeFerias conta as DUAS pontas: 01→01 é um dia', () => {
    expect(diasDeFerias({ inicio: '2026-01-01', fim: '2026-01-01' })).toBe(1)
    expect(diasDeFerias({ inicio: '2026-01-01', fim: '2026-01-30' })).toBe(30)
  })

  it('vencido exige dias RESTANTES: período quitado fora do prazo não alarma', () => {
    const [p] = periodos('2024-03-01', '2026-06-01', [{ inicio: '2025-04-01', fim: '2025-04-30' }])
    expect(p?.diasConcedidos).toBe(30)
    expect(p?.vencido).toBe(false)
  })
})

/**
 * A FRONTEIRA É CONSTRUÍDA, não sorteada.
 *
 * Gerador uniforme de datas nunca cai em 29/02, nunca cai no dia exato em que
 * o período fecha, e nunca produz um total de férias que é múltiplo exato de
 * 30 — que são os três casos em que esta aritmética erra. Então as datas de
 * admissão vêm de uma lista construída (viradas de mês, bissextos, dia 31) e
 * os dias de férias são gerados **ao redor dos múltiplos de 30**.
 */
const ADMISSOES = [
  '2020-01-01',
  '2020-01-31',
  '2020-02-29', // bissexto
  '2020-03-01',
  '2020-12-31',
  '2021-02-28',
  '2022-05-31',
  '2023-08-15',
  '2024-02-29', // bissexto
  '2024-04-30',
  '2024-12-01',
]

const HOJES = [
  '2026-01-01',
  '2026-02-28',
  '2026-02-29', // não existe, mas a comparação é lexicográfica — é o caso torto
  '2026-03-01',
  '2026-11-01',
  '2027-12-31',
  '2030-06-15',
]

/** Dias de férias AO REDOR dos múltiplos de 30 — a fronteira do abatimento. */
const diasTotais = fc.oneof(
  {
    weight: 4,
    arbitrary: fc
      .tuple(fc.integer({ min: 0, max: 8 }), fc.integer({ min: -1, max: 1 }))
      .map(([k, d]) => Math.max(0, k * DIAS_DE_FERIAS_POR_PERIODO + d)),
  },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 300 }) },
)

/** Registros de férias que SOMAM exatamente `total`, sem se sobrepor. */
const feriasQueSomam = (total: number): FeriasRegistradas[] => {
  const saida: FeriasRegistradas[] = []
  let restante = total
  let cursor = '2000-01-01'
  while (restante > 0) {
    const bloco = Math.min(restante, 17)
    saida.push({ inicio: cursor, fim: somarDias(cursor, bloco - 1) })
    restante -= bloco
    cursor = somarDias(cursor, bloco + 5)
  }
  return saida
}

const cenario = fc
  .tuple(fc.constantFrom(...ADMISSOES), fc.constantFrom(...HOJES), diasTotais)
  .map(([admissao, hoje, total]) => ({
    admissao,
    hoje,
    total,
    ferias: feriasQueSomam(total),
  }))

describe('propriedade: a aritmética de férias fecha', () => {
  it('os períodos são CONTÍGUOS — o fim de um é o dia anterior ao início do seguinte', () => {
    fc.assert(
      fc.property(cenario, ({ admissao, hoje, ferias }) => {
        const ps = periodos(admissao, hoje, ferias)
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i]!
          expect(p.inicio <= p.fim, `${p.inicio}..${p.fim} invertido`).toBe(true)
          const seguinte = ps[i + 1]
          if (seguinte !== undefined) {
            expect(somarDias(p.fim, 1), `buraco entre ${p.fim} e ${seguinte.inicio}`).toBe(
              seguinte.inicio,
            )
          }
          // O prazo de concessão é SEMPRE depois do fim do período.
          expect(p.concederAte > p.fim).toBe(true)
          expect(p.indice).toBe(i + 1)
          /**
           * E ele é EXATAMENTE o fim do período seguinte.
           *
           * Esta linha nasceu de uma mutação que SOBREVIVEU: trocar a âncora
           * na admissão por `somarMeses(fim, 12)` passava os 25 testes. As
           * duas expressões concordam quase sempre e divergem quando o clamp
           * de `somarMeses` morde — medido em admissão 01/03/2020, 4º
           * período, onde a versão derivada devolve 28/02/2024 em vez de
           * 29/02/2024 e antecipa em um dia o prazo que custa férias em
           * dobro. `concederAte > fim` não distinguia os dois.
           */
          if (seguinte !== undefined) expect(p.concederAte).toBe(seguinte.fim)
        }
      }),
      { numRuns: 600 },
    )
  })

  it('o prazo de concessão é ancorado na ADMISSÃO, não derivado do fim do período', () => {
    // 01/03/2020: o 4º período fecha em 28/02/2024 e o prazo dele é
    // 28/02/2025. Mas o prazo do 3º é 29/02/2024 — 2024 é bissexto, e
    // `somarMeses('2023-02-28', 12)` clampa em 28 porque perdeu a âncora.
    const ps = periodos('2020-03-01', '2026-01-01')
    expect(ps.map((p) => p.concederAte)).toEqual([
      '2022-02-28',
      '2023-02-28',
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
    ])
    expect(ps.map((p) => p.fim)).toEqual([
      '2021-02-28',
      '2022-02-28',
      '2023-02-28',
      '2024-02-29',
      '2025-02-28',
    ])
  })

  it('Σ diasConcedidos === min(dias registrados, 30 × períodos) — EXATO', () => {
    fc.assert(
      fc.property(cenario, ({ admissao, hoje, total, ferias }) => {
        const ps = periodos(admissao, hoje, ferias)
        const somaConcedida = ps.reduce((s, p) => s + p.diasConcedidos, 0)
        expect(somaConcedida).toBe(
          Math.min(total, DIAS_DE_FERIAS_POR_PERIODO * ps.length),
        )
      }),
      { numRuns: 600 },
    )
  })

  it('diasConcedidos ∈ [0,30] e diasRestantes é o complemento — nunca um terceiro número', () => {
    fc.assert(
      fc.property(cenario, ({ admissao, hoje, ferias }) => {
        for (const p of periodos(admissao, hoje, ferias)) {
          expect(p.diasConcedidos).toBeGreaterThanOrEqual(0)
          expect(p.diasConcedidos).toBeLessThanOrEqual(DIAS_DE_FERIAS_POR_PERIODO)
          expect(p.diasConcedidos + p.diasRestantes).toBe(DIAS_DE_FERIAS_POR_PERIODO)
        }
      }),
      { numRuns: 400 },
    )
  })

  it('FIFO: depois do primeiro período com saldo, nenhum outro recebeu dia nenhum', () => {
    // É esta propriedade que distingue "abate o mais antigo primeiro" de
    // "distribui igualmente", e as duas dão o MESMO resultado quando o total é
    // múltiplo de 30 — que é justamente o caso com que todo mundo confere.
    fc.assert(
      fc.property(cenario, ({ admissao, hoje, ferias }) => {
        const ps = periodos(admissao, hoje, ferias)
        const primeiroComSaldo = ps.findIndex((p) => p.diasRestantes > 0)
        if (primeiroComSaldo === -1) return
        for (const p of ps.slice(primeiroComSaldo + 1)) {
          expect(p.diasConcedidos, 'período posterior recebeu dias antes de o anterior fechar').toBe(0)
        }
      }),
      { numRuns: 400 },
    )
  })

  it('todo período listado já TERMINOU — nenhum fim no futuro ou hoje', () => {
    fc.assert(
      fc.property(cenario, ({ admissao, hoje, ferias }) => {
        for (const p of periodos(admissao, hoje, ferias)) {
          expect(p.fim < hoje, `${p.fim} não terminou antes de ${hoje}`).toBe(true)
        }
      }),
      { numRuns: 400 },
    )
  })
})

describe('feriasSeSobrepoem — a divergência consciente do protótipo', () => {
  it('pega a sobreposição nas quatro formas, inclusive a de um dia só', () => {
    const existente = [{ inicio: '2026-03-10', fim: '2026-03-20' }]
    for (const nova of [
      { inicio: '2026-03-10', fim: '2026-03-20' }, // idêntica
      { inicio: '2026-03-15', fim: '2026-03-16' }, // dentro
      { inicio: '2026-03-01', fim: '2026-04-01' }, // em volta
      { inicio: '2026-03-20', fim: '2026-03-25' }, // encosta no último dia
      { inicio: '2026-03-01', fim: '2026-03-10' }, // encosta no primeiro
    ]) {
      expect(feriasSeSobrepoem(nova, existente), JSON.stringify(nova)).toBe(true)
    }
  })

  it('período adjacente NÃO se sobrepõe — 21/03 começa depois de 20/03 acabar', () => {
    const existente = [{ inicio: '2026-03-10', fim: '2026-03-20' }]
    expect(feriasSeSobrepoem({ inicio: '2026-03-21', fim: '2026-03-30' }, existente)).toBe(false)
    expect(feriasSeSobrepoem({ inicio: '2026-03-01', fim: '2026-03-09' }, existente)).toBe(false)
    expect(feriasSeSobrepoem({ inicio: '2026-03-10', fim: '2026-03-20' }, [])).toBe(false)
  })
})

describe('mesesDeCasa', () => {
  it('conta meses de CALENDÁRIO, e o mês só fecha quando o dia chega', () => {
    expect(mesesDeCasa('2026-01-15', '2026-02-14')).toBe(0)
    expect(mesesDeCasa('2026-01-15', '2026-02-15')).toBe(1)
    expect(mesesDeCasa('2025-11-01', '2026-11-01')).toBe(12)
    // O defeito do 30,44: 11 meses e 29 dias viram 12 na divisão por média.
    expect(mesesDeCasa('2025-01-01', '2025-12-30')).toBe(11)
    expect(mesesDeCasa(null, '2026-01-01')).toBe(null)
    // Admissão no futuro (a gestora cadastrou antes de a pessoa começar).
    expect(mesesDeCasa('2027-01-01', '2026-01-01')).toBe(null)
  })

  it('nunca é negativo e nunca passa dos meses de calendário', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ADMISSOES),
        fc.constantFrom(...HOJES),
        (admissao, hoje) => {
          const m = mesesDeCasa(admissao, hoje)
          if (m === null) return
          expect(m).toBeGreaterThanOrEqual(0)
          // Nunca mais que os dias decorridos divididos por 28.
          expect(m).toBeLessThanOrEqual(Math.ceil(diasEntre(admissao, hoje) / 28))
        },
      ),
    )
  })
})

const pessoa = (over: Partial<PessoaParaAlerta> = {}): PessoaParaAlerta => ({
  contrato: 'CLT',
  admissao: '2020-01-01',
  ativo: true,
  ferias: [],
  documentos: [],
  ultimoSaldoDeHoras: null,
  ...over,
})

describe('alertasDaPessoa — os quatro avisos da tela Equipe', () => {
  it('ficha INATIVA não alerta: quem saiu não tem férias a programar', () => {
    const p = pessoa({
      ativo: false,
      documentos: [{ nome: 'ASO periódico', validade: '2020-01-01' }],
      ultimoSaldoDeHoras: { mes: '2026-10', saldoEmMinutos: -3000 },
    })
    expect(alertasDaPessoa(p, 600, '2026-11-01')).toEqual([])
  })

  it('férias vencidas são CRÍTICAS e dizem o que custa', () => {
    const as = alertasDaPessoa(pessoa({ admissao: '2024-03-01' }), 600, '2026-06-01')
    const f = as.find((a) => a.tipo === 'Férias')
    expect(f?.severidade).toBe('critico')
    expect(f?.texto).toContain('pagas em dobro')
    expect(f?.em).toBe('2026-02-28')
    // O prazo já passou: a tarefa nasce HOJE, nunca atrasada.
    expect(f?.prazoDaTarefa).toBe('2026-06-01')
  })

  it('aviso de férias 60 dias antes — e 61 dias antes ainda não', () => {
    // Admissão 01/03/2024 → período 1 fecha 28/02/2025, prazo 28/02/2026.
    const em60 = alertasDaPessoa(pessoa({ admissao: '2024-03-01' }), 600, '2025-12-30')
    expect(em60.filter((a) => a.tipo === 'Férias')).toHaveLength(1)
    expect(em60[0]?.severidade).toBe('atencao')
    expect(em60[0]?.prazoDaTarefa).toBe('2026-02-21')

    const em61 = alertasDaPessoa(pessoa({ admissao: '2024-03-01' }), 600, '2025-12-29')
    expect(em61.filter((a) => a.tipo === 'Férias')).toHaveLength(0)
  })

  it('experiência: 45 e 90 dias contando a admissão como dia 1', () => {
    // Admissão 01/10/2026 → e1 = 14/11/2026 (44 dias depois), e2 = 29/12/2026.
    const dez = alertasDaPessoa(pessoa({ admissao: '2026-10-01' }), 600, '2026-11-04')
    expect(dez.find((a) => a.tipo === 'Experiência')?.texto).toContain('14/11/2026')
    expect(dez.find((a) => a.tipo === 'Experiência')?.texto).toContain('prorroga')

    // Onze dias antes: ainda não avisa.
    expect(
      alertasDaPessoa(pessoa({ admissao: '2026-10-01' }), 600, '2026-11-03').filter(
        (a) => a.tipo === 'Experiência',
      ),
    ).toHaveLength(0)

    // Passado o primeiro, avisa o segundo — e fala de efetivação.
    const segundo = alertasDaPessoa(pessoa({ admissao: '2026-10-01' }), 600, '2026-12-20')
    expect(segundo.find((a) => a.tipo === 'Experiência')?.texto).toContain('29/12/2026')
    expect(segundo.find((a) => a.tipo === 'Experiência')?.texto).toContain('efetivação')

    // Passados os 90, não há mais nada a decidir.
    expect(
      alertasDaPessoa(pessoa({ admissao: '2026-10-01' }), 600, '2026-12-30').filter(
        (a) => a.tipo === 'Experiência',
      ),
    ).toHaveLength(0)
  })

  it('experiência só em CLT', () => {
    for (const c of ['PJ', 'Estágio', 'Autônomo', 'Sócia'] as const) {
      const as = alertasDaPessoa(pessoa({ contrato: c, admissao: '2026-10-01' }), 600, '2026-11-04')
      expect(as.filter((a) => a.tipo === 'Experiência')).toHaveLength(0)
    }
  })

  it('documento: 30 dias antes avisa, 31 não, e vencido é crítico', () => {
    // `admissao: null` para isolar: com admissão, os alertas de férias desta
    // pessoa de 2020 entrariam na lista e o índice [0] deixaria de ser o doc.
    const doc = (validade: string | null) =>
      pessoa({ admissao: null, documentos: [{ nome: 'COREN', validade }] })

    const em30 = alertasDaPessoa(doc('2026-12-01'), 600, '2026-11-01')
    expect(em30.find((a) => a.tipo === 'Documento')).toMatchObject({
      severidade: 'atencao',
      em: '2026-12-01',
      prazoDaTarefa: '2026-11-24',
    })

    expect(
      alertasDaPessoa(doc('2026-12-02'), 600, '2026-11-01').filter((a) => a.tipo === 'Documento'),
    ).toHaveLength(0)

    const vencido = alertasDaPessoa(doc('2026-10-01'), 600, '2026-11-01')
    expect(vencido.find((a) => a.tipo === 'Documento')).toMatchObject({
      severidade: 'critico',
      prazoDaTarefa: '2026-11-01',
    })
    expect(vencido[0]?.texto).toBe('COREN vencido desde 01/10/2026.')

    // Documento sem validade não alerta — ele é arquivo, e a tela o diz.
    expect(alertasDaPessoa(doc(null), 600, '2026-11-01')).toEqual([])
  })

  it('banco de horas: passa do limite, e o NEGATIVO é o crítico', () => {
    const comSaldo = (minutos: number) =>
      pessoa({ ultimoSaldoDeHoras: { mes: '2026-10', saldoEmMinutos: minutos }, admissao: null })

    // Exatamente no limite NÃO alerta: ±10h é o limite tolerado, não o estouro.
    expect(alertasDaPessoa(comSaldo(600), 600, '2026-11-01')).toEqual([])
    expect(alertasDaPessoa(comSaldo(-600), 600, '2026-11-01')).toEqual([])

    const positivo = alertasDaPessoa(comSaldo(601), 600, '2026-11-01')
    expect(positivo[0]).toMatchObject({
      tipo: 'Banco de horas',
      severidade: 'atencao',
      em: '2026-10-31',
    })
    expect(positivo[0]?.texto).toBe('Saldo de +10h01 em 10/2026 (limite ±10h).')

    expect(alertasDaPessoa(comSaldo(-601), 600, '2026-11-01')[0]?.severidade).toBe('critico')
  })

  it('banco de horas só nos contratos com jornada (CLT e Estágio)', () => {
    const comSaldo = (contrato: Contrato) =>
      alertasDaPessoa(
        pessoa({ contrato, admissao: null, ultimoSaldoDeHoras: { mes: '2026-10', saldoEmMinutos: 3000 } }),
        600,
        '2026-11-01',
      )
    expect(comSaldo('CLT')).toHaveLength(1)
    expect(comSaldo('Estágio')).toHaveLength(1)
    for (const c of ['PJ', 'Autônomo', 'Sócia'] as const) expect(comSaldo(c)).toEqual([])
  })

  it('ordenarAlertas: crítico primeiro, depois o mais antigo por DATA DE REFERÊNCIA', () => {
    const a = { severidade: 'atencao' as const, em: '2026-11-05' }
    const b = { severidade: 'critico' as const, em: '2026-12-01' }
    const c = { severidade: 'critico' as const, em: '2026-06-01' }
    expect(ordenarAlertas([a, b, c])).toEqual([c, b, a])
  })
})
