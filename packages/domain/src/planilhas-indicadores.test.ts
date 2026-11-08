import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { diasEntre, somarDias } from './relogio'
import {
  type AbaInterpretada,
  type CelulaDaPlanilha,
  type FrenteDaPlanilha,
  type LinhaDaFrente,
  type PlanilhaInterpretada,
  type RacionalDaPlanilha,
  FRENTES_DA_PLANILHA,
  PLANILHA_DE_INDICADORES,
  arredondarRacionalDaPlanilha,
  centavosDaCelula,
  escolherAbasDaPlanilha,
  foraDoPadrao,
  idDaPlanilha,
  instanteDoCarimbo,
  inteiroDaCelula,
  interpretarPlanilha,
  lerFonteDaPlanilha,
  leituraDaMetrica,
  medianaDaPlanilha,
  metricaDaPlanilha,
  normalizarNomeDaPlanilha,
  resumirPlanilha,
  segundaDaSemanaDaPlanilha,
  semanaDaDataInformada,
  semanaDoEnvio,
  situacaoDaFrente,
} from './planilhas-indicadores'

const BAHIA = 'America/Bahia'
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-xy'

/** Dia civil gerado: 2000-01-01 + n dias. */
const diaArb = fc.integer({ min: 0, max: 20_000 }).map((n) => somarDias('2000-01-01', n))
const diaDaSemana = (d: string): number => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7

describe('semana (segunda a domingo)', () => {
  it('segundaDaSemanaDaPlanilha: é segunda, não depois do dia, a menos de 7 dias dele (T-11)', () => {
    fc.assert(
      fc.property(diaArb, (d) => {
        const s = segundaDaSemanaDaPlanilha(d)
        expect(diaDaSemana(s)).toBe(0)
        expect(s <= d).toBe(true)
        expect(diasEntre(s, d)).toBeLessThan(7)
      }),
    )
  })

  it('envio sem data: a semana é a da segunda anterior à sexta de corte (4 a 10 dias antes)', () => {
    fc.assert(
      fc.property(diaArb, (d) => {
        const s = semanaDoEnvio(d)
        expect(diaDaSemana(s)).toBe(0)
        const atraso = diasEntre(s, d)
        expect(atraso).toBeGreaterThanOrEqual(4)
        expect(atraso).toBeLessThanOrEqual(10)
      }),
    )
    // Segunda 09/11/2026: fala da semana de 02/11. Quinta 12/11 também. Sexta 13/11 já é a de 09/11.
    expect(semanaDoEnvio('2026-11-09')).toBe('2026-11-02')
    expect(semanaDoEnvio('2026-11-12')).toBe('2026-11-02')
    expect(semanaDoEnvio('2026-11-13')).toBe('2026-11-09')
  })

  it('data informada: tolerância de −2 a +4 dias da segunda (linhasDaSemana, L686)', () => {
    fc.assert(
      fc.property(diaArb, (d) => {
        const s = semanaDaDataInformada(d)
        expect(diaDaSemana(s)).toBe(0)
        const df = diasEntre(s, d)
        expect(df).toBeGreaterThanOrEqual(-2)
        expect(df).toBeLessThanOrEqual(4)
      }),
    )
  })
})

describe('casamento por nome', () => {
  const variacao = (titulo: string) =>
    fc
      .record({
        caixa: fc.constantFrom('igual', 'maiusculo', 'minusculo'),
        semAcento: fc.boolean(),
        espacos: fc.integer({ min: 0, max: 3 }),
        interrogacao: fc.boolean(),
        parenteses: fc.boolean(),
      })
      .map(({ caixa, semAcento, espacos, interrogacao, parenteses }) => {
        let t = titulo
        if (semAcento) t = t.normalize('NFD').replace(/\p{M}/gu, '')
        if (caixa === 'maiusculo') t = t.toUpperCase()
        if (caixa === 'minusculo') t = t.toLowerCase()
        t = t.replace(/ /g, ' '.repeat(espacos + 1))
        if (interrogacao && !t.endsWith('?')) t += '?'
        if (parenteses) t += ' (R$)'
        return `${' '.repeat(espacos)}${t}${' '.repeat(espacos)}`
      })

  it('toda pergunta casa com qualquer variação de caixa, acento, espaço, "?" e parênteses', () => {
    for (const f of FRENTES_DA_PLANILHA) {
      for (const c of PLANILHA_DE_INDICADORES[f].campos) {
        fc.assert(
          fc.property(variacao(c.titulo), (v) => {
            expect(normalizarNomeDaPlanilha(v)).toBe(normalizarNomeDaPlanilha(c.titulo))
          }),
        )
      }
    }
  })

  it('duas perguntas da mesma frente nunca se confundem depois de normalizadas', () => {
    for (const f of FRENTES_DA_PLANILHA) {
      const n = PLANILHA_DE_INDICADORES[f].campos.map((c) => normalizarNomeDaPlanilha(c.titulo))
      expect(new Set(n).size).toBe(n.length)
    }
  })

  it('aba → frente pelo nome, em qualquer ordem e grafia', () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(['FINANCEIRO', 'comercial', 'Trafego Pago', '  Marketing ', 'Instruções'], {
          minLength: 5,
          maxLength: 5,
        }),
        (abas) => {
          const e = escolherAbasDaPlanilha(abas)
          expect(e.map((x) => x.titulo)).toEqual(['FINANCEIRO', 'comercial', 'Trafego Pago', '  Marketing '])
        },
      ),
    )
  })

  it('nome que contém o da frente casa só se for a única candidata', () => {
    const [, comercial] = escolherAbasDaPlanilha(['Respostas - Comercial', 'Outra'])
    expect(comercial).toEqual({ frente: 'comercial', titulo: 'Respostas - Comercial' })
    const [, ambigua] = escolherAbasDaPlanilha(['Comercial 2025', 'Comercial 2026'])
    expect(ambigua).toEqual({ frente: 'comercial', titulo: null, candidatas: ['Comercial 2025', 'Comercial 2026'] })
    // "Tráfego" sozinho é apelido; "Comercialização" não é "Comercial".
    expect(escolherAbasDaPlanilha(['Tráfego'])[2]).toEqual({ frente: 'trafego', titulo: 'Tráfego' })
    expect(escolherAbasDaPlanilha(['Comercialização'])[1]!.titulo).toBeNull()
  })
})

describe('células: dinheiro e contagem, sem ponto flutuante', () => {
  const centavos = fc.bigInt({ min: -100_000_000_000n, max: 100_000_000_000n })
  const brl = (c: bigint): string => {
    const neg = c < 0n
    const a = neg ? -c : c
    const reais = new Intl.NumberFormat('pt-BR').format(a / 100n)
    return `${neg ? '-' : ''}R$ ${reais},${String(a % 100n).padStart(2, '0')}`
  }
  const decimal = (c: bigint): string => {
    const neg = c < 0n
    const a = neg ? -c : c
    return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`
  }

  it('texto brasileiro "R$ 1.234,56" → centavos exatos', () => {
    fc.assert(
      fc.property(centavos, (c) => {
        expect(centavosDaCelula(brl(c))).toBe(c)
      }),
    )
  })

  it('número da planilha (texto decimal do double) → centavos exatos, com zeros à direita ou sem', () => {
    fc.assert(
      fc.property(centavos, (c) => {
        expect(centavosDaCelula({ numeroDecimal: decimal(c) })).toBe(c)
        // `String(42000.5)` é "42000.5": o zero final some no double.
        expect(centavosDaCelula({ numeroDecimal: decimal(c).replace(/\.?0+$/, '') })).toBe(c)
      }),
    )
  })

  it('milhar com ponto não vira decimal; fração além do centavo é recusada, não arredondada', () => {
    expect(centavosDaCelula('42.000')).toBe(4_200_000n)
    expect(centavosDaCelula('42000.50')).toBe(4_200_050n)
    expect(centavosDaCelula('42000,5')).toBe(4_200_050n)
    expect(centavosDaCelula({ numeroDecimal: '42.123' })).toBeNull()
    expect(centavosDaCelula('quarenta mil')).toBeNull()
    expect(centavosDaCelula('')).toBeNull()
  })

  it('contagem: inteiro com e sem milhar; fração é "não é número"', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000_000n }), (n) => {
        expect(inteiroDaCelula(String(n))).toBe(n)
        expect(inteiroDaCelula({ numeroDecimal: String(n) })).toBe(n)
        expect(inteiroDaCelula(new Intl.NumberFormat('pt-BR').format(n))).toBe(n)
      }),
    )
    expect(inteiroDaCelula({ numeroDecimal: '28.5' })).toBeNull()
    expect(inteiroDaCelula('28 leads')).toBeNull()
  })
})

describe('carimbo de data/hora', () => {
  it('número de série do Sheets volta ao mesmo instante, ao segundo, no fuso da planilha', () => {
    // De 2010 a 2040, ao segundo.
    fc.assert(
      fc.property(fc.integer({ min: 1_262_304_000, max: 2_208_988_800 }), (epoca) => {
        const instante = new Date(epoca * 1000)
        // O relógio de parede na Bahia (UTC−3 fixo desde 2012; o gerador fica além disso) → série textual.
        const local = new Date(instante.getTime() - 3 * 3600 * 1000)
        const dia = local.toISOString().slice(0, 10)
        const segundos = BigInt(local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds())
        const dias = diasEntre('1899-12-30', dia)
        const fracao = (segundos * 10n ** 10n * 2n + 86_400n) / (2n * 86_400n)
        const serial = `${dias}.${String(fracao).padStart(10, '0')}`
        if (epoca < 1_356_998_400) return // antes de 2013 a Bahia teve horário de verão
        expect(instanteDoCarimbo({ numeroDecimal: serial }, BAHIA)).toBe(instante.toISOString())
      }),
    )
  })

  it('texto do Forms em português e ISO', () => {
    expect(instanteDoCarimbo('09/11/2026 14:22:05', BAHIA)).toBe('2026-11-09T17:22:05.000Z')
    expect(instanteDoCarimbo('2026-11-09 14:22', BAHIA)).toBe('2026-11-09T17:22:00.000Z')
    expect(instanteDoCarimbo('31/02/2026 10:00', BAHIA)).toBeNull()
    expect(instanteDoCarimbo('ontem', BAHIA)).toBeNull()
  })
})

describe('o link da planilha (A-16: só o id, nunca a URL)', () => {
  const idArb = fc.stringMatching(/^[A-Za-z0-9_-]{20,60}$/)

  it('extrai o id de toda forma de link de planilha do Google', () => {
    fc.assert(
      fc.property(idArb, fc.constantFrom('', '/edit', '/edit#gid=0', '/edit?usp=sharing', '/'), (id, resto) => {
        expect(idDaPlanilha(`https://docs.google.com/spreadsheets/d/${id}${resto}`)).toEqual({ tipo: 'ok', valor: id })
        expect(idDaPlanilha(`https://docs.google.com/spreadsheets/u/1/d/${id}${resto}`)).toEqual({ tipo: 'ok', valor: id })
      }),
    )
  })

  it('recusa outro host, http, usuário na URL, porta e link publicado', () => {
    const recusados = [
      `http://docs.google.com/spreadsheets/d/${ID}`,
      `https://docs.google.com.evil.example/spreadsheets/d/${ID}`,
      `https://evil.example/docs.google.com/spreadsheets/d/${ID}`,
      `https://x@docs.google.com/spreadsheets/d/${ID}`,
      `https://docs.google.com:8443/spreadsheets/d/${ID}`,
      `https://drive.google.com/spreadsheets/d/${ID}`,
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ/pubhtml',
      'https://169.254.169.254/latest/meta-data',
      `https://docs.google.com/document/d/${ID}`,
      'docs.google.com/spreadsheets/d/' + ID,
      '',
    ]
    for (const link of recusados) expect(idDaPlanilha(link).tipo, link).toBe('erro')
  })
})

// ---------------------------------------------------------------------------
// Interpretação e validação
// ---------------------------------------------------------------------------

/** Série do Sheets de um dia às 10:00 (fração 10/24 = 0,41666…). */
const serie = (dia: string): CelulaDaPlanilha => ({ numeroDecimal: `${diasEntre('1899-12-30', dia)}.4166666667` })

const CABECALHO_COMERCIAL = [
  'Carimbo de data/hora',
  'Endereço de e-mail',
  'quantos leads chegaram do site',
  'Quantos leads chegaram do Google?',
  'Quantos leads chegaram do INSTAGRAM?',
  'Leads do site convertidos',
  'Leads do google convertidos',
  'Leads do Instagram convertidos',
  'Leads frios ou fora de perfil',
  'Análise estratégica do comercial',
]
const linhaComercial = (dia: string, site: number | string, analise = 'ok'): CelulaDaPlanilha[] => [
  serie(dia),
  'parceiro@exemplo.com',
  typeof site === 'number' ? { numeroDecimal: String(site) } : site,
  { numeroDecimal: '7' },
  { numeroDecimal: '9' },
  { numeroDecimal: '3' },
  { numeroDecimal: '1' },
  { numeroDecimal: '1' },
  { numeroDecimal: '9' },
  analise,
]

const interpretar = (abas: { titulo: string; linhas: CelulaDaPlanilha[][] }[]): PlanilhaInterpretada =>
  interpretarPlanilha({
    escolhas: escolherAbasDaPlanilha(abas.map((a) => a.titulo)),
    abas,
    fusoDaPlanilha: BAHIA,
    fusoDaClinica: BAHIA,
  })

describe('interpretarPlanilha', () => {
  it('lê só as perguntas da especificação; o e-mail do respondente e o texto livre não entram', () => {
    const p = interpretar([{ titulo: 'Comercial', linhas: [CABECALHO_COMERCIAL, linhaComercial('2026-11-09', 28)] }])
    const aba = p.abas.find((a) => a.frente === 'comercial')!
    expect(aba.colunasFaltando).toEqual([])
    expect(aba.linhas).toHaveLength(1)
    const l = aba.linhas[0]!
    expect(l.carimbo).toBe('2026-11-09T13:00:00.000Z')
    expect(l.semana).toBe('2026-11-02')
    expect(l.preenchidas).toBe(8)
    expect(l.total).toBe(8)
    expect(l.valores['leads_site']).toEqual({ estado: 'numero', inteiro: '28' })
    expect(l.valores['analise']).toEqual({ estado: 'preenchido' })
    expect(JSON.stringify(p)).not.toContain('parceiro@exemplo.com')
    expect(JSON.stringify(p)).not.toContain('"ok"')
  })

  it('a frente sem aba fica sem aba, e a coluna que falta é nomeada', () => {
    const semFrios = CABECALHO_COMERCIAL.map((t) => (t === 'Leads frios ou fora de perfil' ? 'Outra coisa' : t))
    const p = interpretar([{ titulo: 'Comercial', linhas: [semFrios, linhaComercial('2026-11-09', 1)] }])
    expect(p.abas.find((a) => a.frente === 'financeiro')!.titulo).toBeNull()
    expect(p.abas.find((a) => a.frente === 'comercial')!.colunasFaltando).toEqual(['Leads frios ou fora de perfil'])
  })
})

describe('situacaoDaFrente (validarFrente, L688-702)', () => {
  const REF = '2026-11-02'
  const semanasAnteriores = (n: number): string[] => Array.from({ length: n }, (_, i) => somarDias(REF, -7 * (n - i)))
  const envioDa = (semana: string): string => somarDias(semana, 7) // a segunda seguinte

  const comercial = (linhas: CelulaDaPlanilha[][]): AbaInterpretada =>
    interpretar([{ titulo: 'Comercial', linhas: [CABECALHO_COMERCIAL, ...linhas] }]).abas.find((a) => a.frente === 'comercial')!

  it('sem linha da semana: não recebida', () => {
    const s = situacaoDaFrente(comercial([linhaComercial(envioDa('2026-10-26'), 28)]), 'comercial', REF)
    expect(s.status).toBe('pendente')
    expect(s.problemas[0]!.mensagem).toBe('Nenhuma linha desta semana na aba Comercial.')
  })

  it('completa e dentro do padrão: ok, com "8 de 8 perguntas"', () => {
    const linhas = [...semanasAnteriores(8), REF].map((s) => linhaComercial(envioDa(s), 28))
    const s = situacaoDaFrente(comercial(linhas), 'comercial', REF)
    expect(s).toMatchObject({ status: 'ok', problemas: [], envios: 1, linha: { preenchidas: 8, total: 8 } })
  })

  it('semana repetida, campo vazio, não-número e valor fora do padrão: atenção', () => {
    const anteriores = semanasAnteriores(8).map((s) => linhaComercial(envioDa(s), 28))
    expect(
      situacaoDaFrente(comercial([...anteriores, linhaComercial(envioDa(REF), 28), linhaComercial(envioDa(REF), 30)]), 'comercial', REF)
        .problemas.map((p) => p.codigo),
    ).toEqual(['semana_repetida'])
    expect(situacaoDaFrente(comercial([...anteriores, linhaComercial(envioDa(REF), '')]), 'comercial', REF).problemas).toEqual([
      { codigo: 'campo_vazio', mensagem: 'Campo vazio: Quantos leads chegaram do site?.' },
    ])
    expect(
      situacaoDaFrente(comercial([...anteriores, linhaComercial(envioDa(REF), 'vinte')]), 'comercial', REF).problemas[0]!.codigo,
    ).toBe('nao_e_numero')
    const fora = situacaoDaFrente(comercial([...anteriores, linhaComercial(envioDa(REF), 112)]), 'comercial', REF)
    expect(fora.status).toBe('atencao')
    expect(fora.problemas[0]!.mensagem).toBe(
      'Valor fora do padrão em "Quantos leads chegaram do site?": 112 (o normal é perto de 28).',
    )
  })

  it('valor fora do padrão em dinheiro avisa SEM o valor (a redação não alcança texto)', () => {
    const cab = ['Carimbo de data/hora', 'Faturamento da semana', 'Valor recebido', 'Despesas pagas', 'Análise estratégica']
    const linha = (semana: string, fat: string): CelulaDaPlanilha[] => [serie(envioDa(semana)), fat, '38.000,00', '25.000,00', '']
    const aba = interpretar([
      { titulo: 'Financeiro', linhas: [cab, ...semanasAnteriores(8).map((s) => linha(s, '42.000,00')), linha(REF, '420.000,00')] },
    ]).abas.find((a) => a.frente === 'financeiro')!
    const s = situacaoDaFrente(aba, 'financeiro', REF)
    expect(s.problemas.map((p) => p.codigo)).toEqual(['fora_do_padrao'])
    expect(s.problemas[0]!.mensagem).not.toMatch(/\d/)
  })

  it('data da semana sem ano e mês que não bate (colunas opcionais)', () => {
    const cab = ['Carimbo de data/hora', 'Data da semana', 'Mês', 'Quantas campanhas rodaram na semana?', 'Dados da campanha do Google', 'Dados da campanha do Meta']
    const aba = interpretar([
      { titulo: 'Tráfego pago', linhas: [cab, [serie('2026-11-09'), '2/11', 'Outubro', { numeroDecimal: '3' }, 'x', 'y']] },
    ]).abas.find((a) => a.frente === 'trafego')!
    const s = situacaoDaFrente(aba, 'trafego', REF)
    expect(s.problemas.map((p) => p.codigo)).toEqual(['semana_sem_ano', 'mes_nao_confere'])
  })

  it('aba ausente: atenção, com o nome esperado', () => {
    expect(situacaoDaFrente(undefined, 'marketing', REF)).toMatchObject({
      status: 'atencao',
      problemas: [{ codigo: 'aba_nao_encontrada', mensagem: 'Aba Marketing não encontrada na planilha.' }],
    })
  })
})

describe('mediana e fora do padrão em inteiros', () => {
  it('foraDoPadrao é exatamente "v/m > 3 ou v/m < 1/4" com m ≥ limiar', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.bigInt({ min: 0n, max: 10n ** 12n }), (v, m) => {
        const esperado = m >= 5n && (v > 3n * m || 4n * v < m)
        expect(foraDoPadrao(v, m, 'inteiro')).toBe(esperado)
      }),
    )
  })

  it('a mediana é um elemento da lista e não depende da ordem', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: -1000n, max: 1000n }), { minLength: 1, maxLength: 20 }), (xs) => {
        const m = medianaDaPlanilha(xs)!
        expect(xs).toContain(m)
        expect(medianaDaPlanilha([...xs].reverse())).toBe(m)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

/** Aba de Marketing sintética: uma linha por semana, valores de seguidores (ou ausente). */
function abaDeMarketing(valores: readonly (bigint | null)[], segundaCorrente: string): AbaInterpretada {
  const linhas: LinhaDaFrente[] = valores.map((v, i) => ({
    carimbo: null,
    semana: somarDias(segundaCorrente, -7 * (i + 1)),
    semanaInformada: null,
    mesConfere: null,
    preenchidas: 4,
    total: 4,
    valores: { seguidores: v === null ? { estado: 'vazio' } : { estado: 'numero', inteiro: v.toString() } },
  }))
  return { frente: 'marketing', titulo: 'Marketing', candidatas: [], colunasFaltando: [], semCarimbo: false, linhas }
}

const igual = (a: RacionalDaPlanilha, b: RacionalDaPlanilha): boolean => a.num * b.den === b.num * a.den

describe('metricaDaPlanilha (fonte de meta pl:, valorAtualMeta L735-737)', () => {
  const SEGUNDA = '2026-11-09'
  const valoresArb = fc.array(fc.option(fc.bigInt({ min: 0n, max: 10n ** 9n }), { nil: null }), { minLength: 4, maxLength: 6 })

  it('soma4 é a soma exata; media4 × quantos têm valor = soma4; ultima é o mais recente com valor', () => {
    fc.assert(
      fc.property(valoresArb, fc.boolean(), (valores, embaralhar) => {
        const aba = abaDeMarketing(valores, SEGUNDA)
        const p: PlanilhaInterpretada = {
          abas: [{ ...aba, linhas: embaralhar ? [...aba.linhas].reverse() : aba.linhas }],
        }
        const fonte = (agregacao: 'ultima' | 'media4' | 'soma4') =>
          metricaDaPlanilha(p, { frente: 'marketing', metrica: 'seguidores', agregacao }, SEGUNDA)
        const quatro = valores.slice(0, 4).filter((v): v is bigint => v !== null)
        const soma = fonte('soma4')
        const media = fonte('media4')
        const ultima = fonte('ultima')
        if (quatro.length === 0) {
          expect(soma).toEqual({ tipo: 'ok', valor: null })
          expect(media).toEqual({ tipo: 'ok', valor: null })
          expect(ultima).toEqual({ tipo: 'ok', valor: null })
          return
        }
        if (soma.tipo !== 'ok' || media.tipo !== 'ok' || ultima.tipo !== 'ok') throw new Error('erro inesperado')
        const total = quatro.reduce((a, b) => a + b, 0n)
        expect(igual(soma.valor!, { num: total, den: 1n })).toBe(true)
        expect(igual({ num: media.valor!.num * BigInt(quatro.length), den: media.valor!.den }, soma.valor!)).toBe(true)
        expect(igual(ultima.valor!, { num: quatro[0]!, den: 1n })).toBe(true)
      }),
    )
  })

  it('percentual não se soma; métrica inexistente é erro; a fonte do protótipo é lida pelo nome', () => {
    const p: PlanilhaInterpretada = { abas: [] }
    expect(metricaDaPlanilha(p, { frente: 'comercial', metrica: 'Taxa de conversão', agregacao: 'soma4' }, '2026-11-09').tipo).toBe('erro')
    expect(metricaDaPlanilha(p, { frente: 'comercial', metrica: 'xyz', agregacao: 'ultima' }, '2026-11-09').tipo).toBe('erro')
    expect(lerFonteDaPlanilha('pl:financeiro|Faturamento da semana|media4')).toEqual({
      frente: 'financeiro',
      metrica: 'Faturamento da semana',
      agregacao: 'media4',
    })
    expect(lerFonteDaPlanilha('pl:financeiro|nada|media4')).toBeNull()
    expect(lerFonteDaPlanilha('ind:123')).toBeNull()
  })

  it('taxa de conversão é racional exata: 5 de 44 leads = 500/44 %', () => {
    const m = PLANILHA_DE_INDICADORES.comercial.metricas.find((x) => x.chave === 'taxa_conversao')!
    const n = (x: number) => ({ estado: 'numero' as const, inteiro: String(x) })
    const r = m.calcular({ leads_site: n(28), leads_google: n(7), leads_insta: n(9), conv_site: n(3), conv_google: n(1), conv_insta: n(1) })!
    expect(igual(r, { num: 500n, den: 44n })).toBe(true)
    expect(leituraDaMetrica(r, '%')).toEqual({ centavos: null, quantidadeEmDecimos: null, percentualEmDecimos: 114n })
    expect(m.calcular({})).toBeNull()
  })
})

describe('arredondamento e leitura', () => {
  it('meio para longe do zero, a menos de meia unidade do racional', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), fc.bigInt({ min: 1n, max: 10n ** 6n }), (num, den) => {
        const x = arredondarRacionalDaPlanilha({ num, den })
        const erroDobro = 2n * (x * den - num)
        expect(erroDobro <= den && erroDobro >= -den).toBe(true)
      }),
    )
    expect(arredondarRacionalDaPlanilha({ num: 5n, den: 2n })).toBe(3n)
    expect(arredondarRacionalDaPlanilha({ num: -5n, den: 2n })).toBe(-3n)
  })

  it('dinheiro sai em centavos inteiros', () => {
    expect(leituraDaMetrica({ num: 100001n, den: 2n }, 'R$')).toEqual({ centavos: 50001n, quantidadeEmDecimos: null, percentualEmDecimos: null })
  })
})

describe('resumirPlanilha (cIndicadoresPlanilha, L1496-1514)', () => {
  const SEGUNDA = '2026-11-09'
  const REF = '2026-11-02'

  it('variação contra a segunda imediatamente anterior; sem ela, indefinida (gate de números, ajuste 22)', () => {
    // seguidores: semana de 02/11 = 110, 26/10 = 100, 19/10 ausente, 12/10 = 50
    const aba = abaDeMarketing([110n, 100n, null, 50n], SEGUNDA)
    const [, , , mkt] = resumirPlanilha({ abas: [aba] }, REF, 8)
    const seg = mkt!.metricas.find((m) => m.metrica.chave === 'seguidores')!
    expect(seg.ultimo).toEqual({ semana: REF, valor: { num: 110n, den: 1n } })
    expect(seg.variacaoEmDecimos).toBe(100n) // +10,0%
    expect(igual(seg.media!, { num: 260n, den: 3n })).toBe(true)
    expect(mkt!.semanasComDados).toBe(4) // a linha com o campo vazio também é um envio (L1509)
    expect(mkt!.historico).toHaveLength(8)
    expect(mkt!.historico.at(-1)!.semana).toBe(REF)

    const lacuna = abaDeMarketing([110n, null, 100n], SEGUNDA)
    const [, , , m2] = resumirPlanilha({ abas: [lacuna] }, REF, 8)
    expect(m2!.metricas.find((m) => m.metrica.chave === 'seguidores')!.variacaoEmDecimos).toBeNull()
  })

  it('resume as quatro frentes, sempre na mesma ordem, mesmo sem nenhuma aba', () => {
    const r = resumirPlanilha({ abas: [] }, REF, 13)
    expect(r.map((x) => x.frente)).toEqual<FrenteDaPlanilha[]>(['financeiro', 'comercial', 'trafego', 'marketing'])
    expect(r[0]!.metricas[0]!.pontos).toHaveLength(13)
    expect(r.every((x) => x.situacao.status === 'atencao')).toBe(true)
  })
})
