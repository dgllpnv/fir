import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { diasEntre } from './relogio'
import {
  type CelulaDaPlanilha,
  type PlanilhaInterpretada,
  FRENTES_DA_PLANILHA,
  PLANILHA_DE_INDICADORES,
  TITULOS_DA_SEMANA,
  TITULOS_DO_MES,
  escolherAbasDaPlanilha,
  interpretarPlanilha,
  normalizarNomeDaPlanilha,
  situacaoDaFrente,
} from './planilhas-indicadores'

// Planilha no formato real (T1, T2): só títulos de pergunta de formulário e dados sintéticos.

const BAHIA = 'America/Bahia'

const interpretar = (abas: { titulo: string; linhas: CelulaDaPlanilha[][] }[]): PlanilhaInterpretada =>
  interpretarPlanilha({
    escolhas: escolherAbasDaPlanilha(abas.map((a) => a.titulo)),
    abas,
    fusoDaPlanilha: BAHIA,
    fusoDaClinica: BAHIA,
  })

const num = (n: number): CelulaDaPlanilha => ({ numeroDecimal: String(n) })
const dataSerial = (dia: string): CelulaDaPlanilha => ({ numeroDecimal: String(diasEntre('1899-12-30', dia)) })
const carimbo = (dia: string): CelulaDaPlanilha => ({ numeroDecimal: `${diasEntre('1899-12-30', dia)}.4166666667` })

const PRIMEIRO_DIA = 'Qual o primeiro dia da semana analisada?'
const CABECALHO_REAL: Readonly<Record<'trafego' | 'marketing' | 'comercial', string[]>> = {
  trafego: [
    'Carimbo de data/hora',
    PRIMEIRO_DIA,
    'Qual mês será analisado?',
    'Quantas campanhas rodaram na semana em questão?',
    'Descreva os dados referente a campanha do Google (Cite separadamente)',
    'Descreva os dados referente a campanha do Meta',
    'Faça uma análise estratégica sobre o tráfego pago desse cliente durante essa semana',
  ],
  marketing: [
    'Carimbo de data/hora',
    PRIMEIRO_DIA,
    'Qual mês será analisado?',
    'Quantos novos seguidores chegaram durante esta semana?',
    'Quantos criativos foram publicados na semana?',
    'Qual criativo teve maior performance durante a semana?',
    'Informe o alcance total da semana',
  ],
  comercial: [
    'Carimbo de data/hora',
    PRIMEIRO_DIA,
    'Que mês será analisado?',
    'Quantos leads chegaram do site?',
    'Quantos leads chegaram do Google?',
    'Quantos leads chegaram do Instagram?',
    'Quantos leads do site foram convertidos essa semana?',
    'Quantos leads do Google foram convertidos essa semana?',
    'Quantos leads do Instagram foram convertidos essa semana?',
    'Quantos leads frios fora de perfil de plano chegaram essa semana?',
    'Faça uma análise estratégica sobre o desempenho do comercial durante essa semana',
  ],
}

describe('a escolha de aba com os quatro nomes reais (caracterização)', () => {
  it('"Formulário …" casa com a frente por palavras inteiras, em qualquer ordem', () => {
    const reais = ['Formulário Tráfego Pago', 'Formulário Marketing', 'Formulário Comercial', 'Formulário Financeiro']
    fc.assert(
      fc.property(fc.shuffledSubarray(reais, { minLength: 4, maxLength: 4 }), (abas) => {
        const e = escolherAbasDaPlanilha(abas)
        expect(e.map((x) => [x.frente, x.titulo])).toEqual([
          ['financeiro', 'Formulário Financeiro'],
          ['comercial', 'Formulário Comercial'],
          ['trafego', 'Formulário Tráfego Pago'],
          ['marketing', 'Formulário Marketing'],
        ])
      }),
    )
  })

  it('"Formulário" não vira apelido: duas abas de comercial continuam ambíguas', () => {
    const [, comercial] = escolherAbasDaPlanilha(['Formulário Comercial', 'Formulário Comercial (cópia)'])
    expect(comercial).toMatchObject({ frente: 'comercial', titulo: null })
  })
})

describe('o cabeçalho real, lido por inteiro (T1)', () => {
  it('Tráfego: todas as perguntas casam e a semana vem da data informada, sem carimbo', () => {
    const linha: CelulaDaPlanilha[] = ['', dataSerial('2026-11-07'), 'Novembro', num(3), 'x', 'y', 'z']
    const aba = interpretar([{ titulo: 'Formulário Tráfego Pago', linhas: [CABECALHO_REAL.trafego, linha] }]).abas.find(
      (a) => a.frente === 'trafego',
    )!
    expect(aba.colunasFaltando).toEqual([])
    expect(aba.linhas[0]!.semana).toBe('2026-11-09') // sábado vai para a segunda seguinte
    expect(aba.linhas[0]!.valores['campanhas']).toEqual({ estado: 'numero', inteiro: '3' })
    expect(aba.linhas[0]!.valores['analise']).toEqual({ estado: 'preenchido' })
    expect(aba.linhas[0]!.preenchidas).toBe(4)
  })

  it('Marketing: todas as perguntas casam', () => {
    const linha: CelulaDaPlanilha[] = ['', dataSerial('2026-11-09'), 'Novembro', num(12), num(4), 'reels', num(10_500)]
    const aba = interpretar([{ titulo: 'Formulário Marketing', linhas: [CABECALHO_REAL.marketing, linha] }]).abas.find(
      (a) => a.frente === 'marketing',
    )!
    expect(aba.colunasFaltando).toEqual([])
    expect(aba.linhas[0]!.valores['alcance']).toEqual({ estado: 'numero', inteiro: '10500' })
    expect(aba.linhas[0]!.valores['melhor']).toEqual({ estado: 'preenchido' })
  })

  it('Comercial: todas as perguntas casam, inclusive as três conversões e os frios', () => {
    const linha: CelulaDaPlanilha[] = ['', dataSerial('2026-11-09'), 'Novembro', num(9), num(8), num(7), num(3), num(2), num(1), num(5), '']
    const aba = interpretar([{ titulo: 'Formulário Comercial', linhas: [CABECALHO_REAL.comercial, linha] }]).abas.find(
      (a) => a.frente === 'comercial',
    )!
    expect(aba.colunasFaltando).toEqual([])
    expect(aba.linhas[0]!.valores['conv_google']).toEqual({ estado: 'numero', inteiro: '2' })
    expect(aba.linhas[0]!.valores['frios']).toEqual({ estado: 'numero', inteiro: '5' })
    expect(aba.linhas[0]!.valores['analise']).toEqual({ estado: 'vazio' })
  })

  it('"Qual mês" e "Que mês" são achadas como coluna de mês', () => {
    const nomes = { trafego: 'Formulário Tráfego Pago', marketing: 'Formulário Marketing', comercial: 'Formulário Comercial' }
    for (const c of ['trafego', 'marketing', 'comercial'] as const) {
      const cab = CABECALHO_REAL[c]
      const mesCol = cab.findIndex((t) => /m[eê]s/i.test(t))
      const linha = cab.map((_, i) => (i === 1 ? dataSerial('2026-11-09') : i === mesCol ? 'Outubro' : ''))
      const aba = interpretar([{ titulo: nomes[c], linhas: [cab, linha] }]).abas.find((a) => a.frente === c)!
      expect(aba.linhas[0]!.mesConfere).toBe(false) // outubro numa data de novembro: a coluna foi achada
    }
  })

  it('toda pergunta, em qualquer alias e variação de caixa, acento e pontuação, é achada', () => {
    const variar = (t: string, v: { alto: boolean; acento: boolean; ponto: boolean }): string => {
      let r = v.acento ? t.normalize('NFD').replace(/\p{M}/gu, '') : t
      r = v.alto ? r.toUpperCase() : r.toLowerCase()
      return `\n ${r}${v.ponto ? '?.' : ''} `
    }
    const v = fc.record({ alto: fc.boolean(), acento: fc.boolean(), ponto: fc.boolean() })
    for (const f of FRENTES_DA_PLANILHA) {
      const spec = PLANILHA_DE_INDICADORES[f]
      for (const c of spec.campos) {
        expect(c.titulos[0]).toBe(c.titulo)
        for (const alias of c.titulos) {
          fc.assert(
            fc.property(v, (x) => {
              const outros = spec.campos.filter((o) => o !== c).map((o) => o.titulo)
              const cab = ['Carimbo de data/hora', variar(alias, x), ...outros]
              const aba = interpretar([{ titulo: spec.aba, linhas: [cab] }]).abas.find((a) => a.frente === f)!
              expect(aba.colunasFaltando).toEqual([])
            }),
            { numRuns: 25 },
          )
        }
      }
    }
  })

  it('os aliases de uma mesma frente nunca se confundem depois de normalizados', () => {
    for (const f of FRENTES_DA_PLANILHA) {
      const todos = PLANILHA_DE_INDICADORES[f].campos.flatMap((c) => c.titulos.map(normalizarNomeDaPlanilha))
      expect(new Set(todos).size).toBe(todos.length)
    }
  })

  it('os títulos de semana e de mês incluem as perguntas reais', () => {
    const n = (l: readonly string[]) => l.map(normalizarNomeDaPlanilha)
    expect(n(TITULOS_DA_SEMANA)).toContain('qual o primeiro dia da semana analisada')
    expect(n(TITULOS_DO_MES)).toEqual(expect.arrayContaining(['qual mes sera analisado', 'que mes sera analisado']))
  })
})

describe('mês em número de série de data (T1)', () => {
  const comMes = (mes: CelulaDaPlanilha): boolean | null => {
    const cab = ['Carimbo de data/hora', PRIMEIRO_DIA, 'Que mês será analisado?', 'Quantos leads chegaram do site?']
    const linha: CelulaDaPlanilha[] = ['', dataSerial('2026-11-09'), mes, num(1)]
    return interpretar([{ titulo: 'Formulário Comercial', linhas: [cab, linha] }]).abas.find((a) => a.frente === 'comercial')!
      .linhas[0]!.mesConfere
  }

  it('célula de data formatada "mmmm yyyy" do mesmo mês confere', () => {
    expect(comMes(dataSerial('2026-11-01'))).toBe(true)
  })
  it('célula de data de outro mês não confere', () => {
    expect(comMes(dataSerial('2026-10-01'))).toBe(false)
  })
  it('o texto continua valendo', () => {
    expect(comMes('Novembro')).toBe(true)
    expect(comMes('Outubro')).toBe(false)
  })
})

describe('cabeçalho duplicado e limites (T2)', () => {
  const cab = (...extra: string[]) => ['Carimbo de data/hora', PRIMEIRO_DIA, ...extra]
  const lerAba = (frente: string, linhas: CelulaDaPlanilha[][]) =>
    interpretar([{ titulo: frente, linhas }]).abas.find((a) => a.titulo !== null)!

  it('texto duplicado: preenchido se qualquer das colunas estiver, e só informa', () => {
    const c = cab('Dados da campanha do Google', 'DADOS da campanha do google?', 'Dados da campanha do Meta', 'Quantas campanhas rodaram na semana?')
    const aba = lerAba('Tráfego pago', [
      c,
      ['', dataSerial('2026-11-09'), '', 'texto', 'm', num(2)],
      ['', dataSerial('2026-11-16'), '', '', 'm', num(2)],
    ])
    expect(aba.linhas[0]!.valores['google']).toEqual({ estado: 'preenchido' })
    expect(aba.linhas[1]!.valores['google']).toEqual({ estado: 'vazio' })
    expect(aba.colunasDuplicadas).toEqual([{ titulo: 'Dados da campanha do Google', informativa: true }])
    const s = situacaoDaFrente(aba, 'trafego', '2026-11-09')
    expect(s.problemas.map((p) => p.codigo)).toContain('coluna_duplicada')
  })

  it('o aviso informativo não rebaixa a frente', () => {
    const c = cab('Dados da campanha do Google', 'Dados da campanha do Google', 'Dados da campanha do Meta', 'Quantas campanhas rodaram na semana?')
    const aba = lerAba('Tráfego pago', [c, ['', dataSerial('2026-11-09'), '', 'texto', 'm', num(2)]])
    const s = situacaoDaFrente(aba, 'trafego', '2026-11-09')
    expect(s.problemas.map((p) => p.codigo)).toEqual(['coluna_duplicada'])
    expect(s.status).toBe('ok')
  })

  it('inteiro duplicado é inválido, nunca escolhido por posição, e rebaixa a frente', () => {
    const c = cab(
      'Informe o alcance total da semana',
      'informe o alcance total da semana',
      'Quantos novos seguidores chegaram durante esta semana?',
      'Quantos criativos foram publicados na semana?',
      'Qual criativo teve maior performance durante a semana?',
    )
    const linha: CelulaDaPlanilha[] = ['', dataSerial('2026-11-09'), num(100), num(200), num(1), num(1), 'a']
    const aba = lerAba('Marketing', [c, linha])
    expect(aba.linhas[0]!.valores['alcance']).toEqual({ estado: 'invalido' })
    expect(aba.colunasDuplicadas).toEqual([{ titulo: 'Alcance total da semana', informativa: false }])
    const s = situacaoDaFrente(aba, 'marketing', '2026-11-09')
    expect(s.status).toBe('atencao')
    const codigos = s.problemas.map((p) => p.codigo)
    expect(codigos.filter((x) => x === 'coluna_duplicada')).toHaveLength(1)
    expect(codigos).not.toContain('nao_e_numero')
    expect(codigos).not.toContain('coluna_nao_encontrada')
  })

  it('dinheiro duplicado é inválido', () => {
    const c = cab('Faturamento da semana (R$)', 'Faturamento da semana', 'Valor recebido', 'Despesas pagas')
    const aba = lerAba('Financeiro', [c, ['', dataSerial('2026-11-09'), num(10), num(20), num(1), num(1)]])
    expect(aba.linhas[0]!.valores['faturamento']).toEqual({ estado: 'invalido' })
    expect(aba.linhas[0]!.valores['recebido']).toEqual({ estado: 'numero', inteiro: '100' })
  })

  it('duplicados com as duas células vazias não inventam erro na linha', () => {
    const c = cab('Informe o alcance total da semana', 'Informe o alcance total da semana')
    const aba = lerAba('Marketing', [c, ['', dataSerial('2026-11-09'), '', '']])
    expect(aba.linhas[0]!.valores['alcance']).toEqual({ estado: 'vazio' })
  })

  it('semana duplicada: não escolhe, a linha fica sem semana', () => {
    const c = ['Carimbo de data/hora', PRIMEIRO_DIA, PRIMEIRO_DIA, 'Informe o alcance total da semana']
    const aba = lerAba('Marketing', [c, ['', dataSerial('2026-11-09'), dataSerial('2026-11-16'), num(1)]])
    expect(aba.linhas[0]!.semana).toBeNull()
    expect(aba.colunasDuplicadas).toContainEqual({ titulo: 'Primeiro dia da semana', informativa: false })
  })

  it('carimbo duplicado: não escolhe, sem carimbo na linha', () => {
    const c = ['Carimbo de data/hora', 'carimbo de data hora', PRIMEIRO_DIA, 'Informe o alcance total da semana']
    const aba = lerAba('Marketing', [c, [carimbo('2026-11-09'), carimbo('2026-11-10'), dataSerial('2026-11-09'), num(1)]])
    expect(aba.linhas[0]!.carimbo).toBeNull()
    expect(aba.colunasDuplicadas).toContainEqual({ titulo: 'Carimbo de data/hora', informativa: false })
  })

  it('o aviso nunca carrega o cabeçalho cru da planilha', () => {
    const hostil = 'INFORME o alcance total da semana (=HYPERLINK("http://x.example";"<script>"))\u0000'
    const c = cab('Informe o alcance total da semana', hostil)
    const aba = lerAba('Marketing', [c, ['', dataSerial('2026-11-09'), num(1), num(2)]])
    const texto = JSON.stringify(situacaoDaFrente(aba, 'marketing', '2026-11-09'))
    for (const proibido of ['HYPERLINK', 'script', 'u0000']) expect(texto).not.toContain(proibido)
  })

  it('mais de 200 colunas: a aba não é lida e a frente fica em atenção', () => {
    const c = [...cab('Informe o alcance total da semana'), ...Array.from({ length: 200 }, (_, i) => `Coluna ${i}`)]
    const aba = lerAba('Marketing', [c, ['', dataSerial('2026-11-09'), num(1)]])
    expect(aba.linhas).toEqual([])
    expect(aba.cabecalhoRecusado).toBe(true)
    const s = situacaoDaFrente(aba, 'marketing', '2026-11-09')
    expect(s.status).toBe('atencao')
    expect(s.problemas.map((p) => p.codigo)).toEqual(['cabecalho_fora_do_limite'])
  })

  it('exatamente 200 colunas ainda é lida', () => {
    const c = [...cab('Informe o alcance total da semana'), ...Array.from({ length: 197 }, (_, i) => `Coluna ${i}`)]
    expect(c).toHaveLength(200)
    expect(lerAba('Marketing', [c, ['', dataSerial('2026-11-09'), num(1)]]).cabecalhoRecusado).toBeUndefined()
  })

  it('célula de cabeçalho com mais de 2.000 caracteres: não é lida nem normalizada', () => {
    const c = [...cab('Informe o alcance total da semana'), `<script>${'x'.repeat(10_000)}\u0000`]
    const aba = lerAba('Marketing', [c, ['', dataSerial('2026-11-09'), num(1)]])
    expect(aba.cabecalhoRecusado).toBe(true)
    expect(aba.linhas).toEqual([])
    expect(JSON.stringify(situacaoDaFrente(aba, 'marketing', '2026-11-09'))).not.toContain('script')
  })

  it('cabeçalho de exatamente 2.000 caracteres ainda é lido', () => {
    const c = [...cab('Informe o alcance total da semana'), 'x'.repeat(2000)]
    expect(lerAba('Marketing', [c, ['', dataSerial('2026-11-09'), num(1)]]).cabecalhoRecusado).toBeUndefined()
  })
})
