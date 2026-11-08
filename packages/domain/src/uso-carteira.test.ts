import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from './dinheiro'
import { somarDias } from './relogio'
import {
  alertaDeUso,
  type LinhaDeUsoDiario,
  metricasDeUso,
  resumoDasSituacoes,
  saudeDoUso,
  serieDeConcluidas,
  semanaAnteriorDe,
  semanaDe,
  textoDoRelatorioDeUso,
  usoDoCliente,
  usoNaVisaoGeral,
} from './uso-carteira'

/**
 * Seam: `packages/domain` puro. As fórmulas do uso diário da FIR Clinic
 * (protótipo `metricasUso`/`saudeUso`/`cUso`, L1555–1640) com os ajustes 30 a
 * 34 do gate de números e A15/A16 do gate de LGPD.
 */

// 2026-11-16 é uma SEGUNDA-feira. A semana [09/11, 16/11) tem 5 dias úteis.
const HOJE = '2026-11-16'

const vazia = (dia: string): LinhaDeUsoDiario => ({
  dia,
  usuariosCadastrados: 3,
  usuariosAtivos: 0,
  tarefasCriadas: 0,
  tarefasConcluidas: 0,
  tarefasNoPrazo: 0,
  tarefasVencidasAbertas: 0,
  contatosPacientes: 0,
  orcamentosEnviados: 0,
  orcamentosPagos: 0,
  faltas: 0,
  faltasRecontatadas: 0,
  receitaRegistrada: Dinheiro.zero(),
})

const comUso = (dia: string, extra: Partial<LinhaDeUsoDiario> = {}): LinhaDeUsoDiario => ({
  ...vazia(dia),
  usuariosAtivos: 2,
  tarefasCriadas: 6,
  tarefasConcluidas: 5,
  tarefasNoPrazo: 5,
  contatosPacientes: 4,
  ...extra,
})

const ehUtil = (dia: string): boolean => {
  const [a, m, d] = dia.split('-').map(Number)
  const w = new Date(Date.UTC(a!, m! - 1, d!)).getUTCDay()
  return w !== 0 && w !== 6
}

/** Os sete dias da semana [hoje−7, hoje). */
const diasDaSemana = (hoje: string): string[] => Array.from({ length: 7 }, (_, i) => somarDias(hoje, i - 7))

describe('semanaDe / semanaAnteriorDe — ajuste 30: sete dias COMPLETOS, hoje nunca entra', () => {
  it('[hoje−7, hoje) e [hoje−14, hoje−7)', () => {
    expect(semanaDe(HOJE)).toEqual({ de: '2026-11-09', ate: '2026-11-16' })
    expect(semanaAnteriorDe(HOJE)).toEqual({ de: '2026-11-02', ate: '2026-11-09' })
  })
})

describe('metricasDeUso — exemplos', () => {
  it('cinco dias úteis com uso, fim de semana parado', () => {
    const linhas = diasDaSemana(HOJE).map((d) => (ehUtil(d) ? comUso(d) : vazia(d)))
    const m = metricasDeUso(linhas, semanaDe(HOJE))
    expect(m.diasUteis).toBe(5)
    expect(m.diasComUso).toBe(5)
    expect(m.diasSemDado).toBe(0)
    expect(m.tarefasConcluidas).toBe(25)
    expect(m.percentualNoPrazo).toBe(100)
    expect(m.contatos).toBe(20)
    expect(m.pessoasAtivas).toBe(2)
    expect(m.pessoasCadastradas).toBe(3)
  })

  it('ajuste 31: dia útil sem linha é "sem dado", fica no denominador e não vira "sem uso"', () => {
    const linhas = diasDaSemana(HOJE)
      .filter((d) => d !== '2026-11-11')
      .map((d) => (ehUtil(d) ? comUso(d) : vazia(d)))
    const m = metricasDeUso(linhas, semanaDe(HOJE))
    expect(m.diasUteis).toBe(5)
    expect(m.diasComUso).toBe(4)
    expect(m.diasSemDado).toBe(1)
  })

  it('ajuste 32: "no prazo" com 0 concluídas é null, nunca 0%', () => {
    const m = metricasDeUso(diasDaSemana(HOJE).map(vazia), semanaDe(HOJE))
    expect(m.percentualNoPrazo).toBeNull()
    expect(m.percentualConversao).toBeNull()
  })

  it('ajuste 32: conversão acima de 100% é exibida como o número, nunca limitada', () => {
    const linhas = [comUso('2026-11-10', { orcamentosEnviados: 1, orcamentosPagos: 3 })]
    expect(metricasDeUso(linhas, semanaDe(HOJE)).percentualConversao).toBe(300)
  })

  it('arredonda o percentual meio para cima, por inteiros (2 de 3 = 67)', () => {
    const linhas = [comUso('2026-11-10', { tarefasConcluidas: 3, tarefasNoPrazo: 2 })]
    expect(metricasDeUso(linhas, semanaDe(HOJE)).percentualNoPrazo).toBe(67)
  })

  it('vencidas em aberto é o SNAPSHOT do último dia com linha, nunca uma soma', () => {
    const linhas = [
      comUso('2026-11-10', { tarefasVencidasAbertas: 9 }),
      comUso('2026-11-12', { tarefasVencidasAbertas: 4 }),
    ]
    expect(metricasDeUso(linhas, semanaDe(HOJE)).tarefasVencidasAbertas).toBe(4)
  })

  it('a receita soma centavos exatos, como Dinheiro', () => {
    const linhas = [
      comUso('2026-11-10', { receitaRegistrada: Dinheiro.deCentavos(15001n) }),
      comUso('2026-11-11', { receitaRegistrada: Dinheiro.deCentavos(32099n) }),
    ]
    expect(metricasDeUso(linhas, semanaDe(HOJE)).receita.centavos).toBe(47100n)
  })

  it('faltas recontatadas: null se QUALQUER linha da janela ainda não foi calculada (PP-8)', () => {
    const linhas = [
      comUso('2026-11-10', { faltas: 2, faltasRecontatadas: 1 }),
      comUso('2026-11-11', { faltas: 1, faltasRecontatadas: null }),
    ]
    const m = metricasDeUso(linhas, semanaDe(HOJE))
    expect(m.faltas).toBe(3)
    expect(m.faltasRecontatadas).toBeNull()
    expect(metricasDeUso([linhas[0]!], semanaDe(HOJE)).faltasRecontatadas).toBe(1)
  })

  it('sem nenhuma linha na janela, faltas recontatadas é null, não 0', () => {
    expect(metricasDeUso([], semanaDe(HOJE)).faltasRecontatadas).toBeNull()
    expect(metricasDeUso([], semanaDe(HOJE)).comDados).toBe(false)
  })
})

describe('saudeDoUso — a regra do protótipo (L1564–1570), com hoje fora e "sem dado" honesto', () => {
  it('sem linha nenhuma: sem situação', () => {
    expect(saudeDoUso([], HOJE)).toEqual({ situacao: null, rotulo: 'Sem dados' })
  })

  it('uso todo dia útil e 100% no prazo: Uso em dia', () => {
    const linhas = diasDaSemana(HOJE).map((d) => (ehUtil(d) ? comUso(d) : vazia(d)))
    expect(saudeDoUso(linhas, HOJE)).toEqual({ situacao: 'bom', rotulo: 'Uso em dia' })
  })

  it('três dias úteis seguidos com linha e sem uso: Três dias sem uso', () => {
    // Úteis da semana: 9, 10, 11, 12, 13. Os três últimos (11, 12, 13) parados.
    const linhas = diasDaSemana(HOJE).map((d) =>
      ['2026-11-09', '2026-11-10'].includes(d) ? comUso(d) : vazia(d),
    )
    expect(saudeDoUso(linhas, HOJE)).toEqual({ situacao: 'critico', rotulo: 'Três dias sem uso' })
  })

  it('três dias úteis sem LINHA não são "três dias sem uso" — é job que falhou, não clínica parada', () => {
    const linhas = diasDaSemana(HOJE)
      .filter((d) => !['2026-11-11', '2026-11-12', '2026-11-13'].includes(d))
      .map((d) => (ehUtil(d) ? comUso(d) : vazia(d)))
    const s = saudeDoUso(linhas, HOJE)
    expect(s.rotulo).not.toBe('Três dias sem uso')
    expect(s.situacao).not.toBe('critico')
  })

  it('dois dias de uso na semana: Uso muito baixo', () => {
    const linhas = diasDaSemana(HOJE).map((d) =>
      ['2026-11-09', '2026-11-12'].includes(d) ? comUso(d) : vazia(d),
    )
    expect(saudeDoUso(linhas, HOJE)).toEqual({ situacao: 'critico', rotulo: 'Uso muito baixo' })
  })

  it('quatro dias de uso, mas 50% no prazo: Uso irregular', () => {
    const linhas = diasDaSemana(HOJE).map((d) =>
      ehUtil(d) && d !== '2026-11-11' ? comUso(d, { tarefasConcluidas: 4, tarefasNoPrazo: 2 }) : vazia(d),
    )
    expect(saudeDoUso(linhas, HOJE)).toEqual({ situacao: 'atencao', rotulo: 'Uso irregular' })
  })

  it('a semana sem nenhuma linha (job parado): sem situação, nunca "muito baixo"', () => {
    const linhas = [comUso('2026-10-20')]
    expect(saudeDoUso(linhas, HOJE)).toEqual({ situacao: null, rotulo: 'Sem dados na semana' })
  })
})

describe('alertaDeUso — R13, só com o nome da clínica e a situação (A19)', () => {
  it('crítico gera o título do protótipo', () => {
    expect(alertaDeUso('Clínica Sol', { situacao: 'critico', rotulo: 'Três dias sem uso' })).toEqual({
      titulo: 'FIR Clinic sem uso em Clínica Sol: ligar para a recepção',
      descricao: 'Três dias sem uso',
    })
  })
  it('atenção, bom ou sem dados: nada', () => {
    expect(alertaDeUso('X', { situacao: 'atencao', rotulo: 'Uso irregular' })).toBeNull()
    expect(alertaDeUso('X', { situacao: null, rotulo: 'Sem dados' })).toBeNull()
  })
})

describe('serieDeConcluidas — 30 dias civis, só contagem de tarefas (A16)', () => {
  it('um ponto por dia de [hoje−30, hoje), null onde não há linha', () => {
    const s = serieDeConcluidas([comUso('2026-11-15', { tarefasConcluidas: 7 })], HOJE)
    expect(s).toHaveLength(30)
    expect(s[0]!.dia).toBe('2026-10-17')
    expect(s.at(-1)).toEqual({ dia: '2026-11-15', tarefasConcluidas: 7 })
    expect(s[0]!.tarefasConcluidas).toBeNull()
    // A série nunca carrega pessoas ativas.
    expect(Object.keys(s[0]!).sort()).toEqual(['dia', 'tarefasConcluidas'])
  })
})

describe('usoDoCliente — o relatório de uso (ajuste 34)', () => {
  const ini = '2026-09-01'
  const linhas: LinhaDeUsoDiario[] = []
  for (let d = ini; d < HOJE; d = somarDias(d, 1)) {
    if (!ehUtil(d)) linhas.push(vazia(d))
    else if (d < '2026-09-15') linhas.push(d.endsWith('1') || d.endsWith('3') ? comUso(d) : vazia(d))
    else linhas.push(comUso(d, { contatosPacientes: 3 }))
  }
  const v = usoDoCliente(linhas, HOJE)!

  it('em uso desde o primeiro dia com linha, e os marcos 30/60/90', () => {
    expect(v.relatorio.emUsoDesde).toBe(ini)
    expect(v.relatorio.diasDesde).toBe(76)
    expect(v.relatorio.marcos).toEqual([
      { dia: 30, atingido: true, faltam: 0 },
      { dia: 60, atingido: true, faltam: 0 },
      { dia: 90, atingido: false, faltam: 14 },
    ])
  })

  it('dias com uso por semana em DÉCIMOS: (2·50·diasUso + úteis) div (2·úteis)', () => {
    const dias = v.relatorio.indicadores.find((i) => i.chave === 'diasComUsoPorSemana')!
    expect(dias.unidade).toBe('decimos')
    // Início [01/09, 15/09): 10 úteis; com uso: 01, 03, 11 = 3 → 3/10·5 = 1,5 → 15.
    expect(dias.inicio).toBe(15)
    // Agora: as duas últimas semanas, todo dia útil → 50.
    expect(dias.agora).toBe(50)
    // Ajuste 33: a evolução é a diferença dos valores EXIBIDOS.
    expect(dias.evolucao).toBe(35)
  })

  it('não traz "rotinas cumpridas" (ADR 0014: sem fonte)', () => {
    expect(v.relatorio.indicadores.map((i) => i.chave)).toEqual([
      'diasComUsoPorSemana',
      'tarefasNoPrazo',
      'contatosPorSemana',
      'tarefasVencidasAbertas',
    ])
  })

  it('o texto do "Copiar relatório" não tem valor monetário nem rotinas', () => {
    const t = textoDoRelatorioDeUso('Clínica Sol', v)
    expect(t).toContain('USO DA FIR CLINIC · Clínica Sol')
    expect(t).toContain('Em uso desde 01/09/2026')
    expect(t).not.toMatch(/R\$|rotinas/i)
  })

  it('sem linha nenhuma, nada a mostrar', () => {
    expect(usoDoCliente([], HOJE)).toBeNull()
  })
})

describe('usoNaVisaoGeral — deltas pela diferença dos exibidos (ajuste 33)', () => {
  it('no prazo 100 contra 50 da semana anterior dá +50', () => {
    const linhas = [
      comUso('2026-11-04', { tarefasConcluidas: 4, tarefasNoPrazo: 2, contatosPacientes: 10 }),
      comUso('2026-11-10', { tarefasConcluidas: 4, tarefasNoPrazo: 4, contatosPacientes: 7 }),
    ]
    const v = usoNaVisaoGeral(linhas, HOJE)
    expect(v.deltaNoPrazo).toBe(50)
    expect(v.deltaContatos).toBe(-3)
  })
})

// ---------------------------------------------------------------------------
// Property-based
// ---------------------------------------------------------------------------

const diaArb = fc.integer({ min: 0, max: 40 }).map((n) => somarDias('2026-10-10', n))

const linhaArb: fc.Arbitrary<LinhaDeUsoDiario> = fc
  .record({
    dia: diaArb,
    usuariosCadastrados: fc.integer({ min: 0, max: 20 }),
    usuariosAtivos: fc.integer({ min: 0, max: 20 }),
    tarefasCriadas: fc.integer({ min: 0, max: 50 }),
    tarefasConcluidas: fc.integer({ min: 0, max: 50 }),
    noPrazoFracao: fc.integer({ min: 0, max: 50 }),
    tarefasVencidasAbertas: fc.integer({ min: 0, max: 30 }),
    contatosPacientes: fc.integer({ min: 0, max: 50 }),
    orcamentosEnviados: fc.integer({ min: 0, max: 10 }),
    orcamentosPagos: fc.integer({ min: 0, max: 10 }),
    faltas: fc.integer({ min: 0, max: 10 }),
    faltasRecontatadas: fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
    receita: fc.bigInt({ min: 0n, max: 10_000_000n }),
  })
  .map((r) => ({
    dia: r.dia,
    usuariosCadastrados: r.usuariosCadastrados,
    usuariosAtivos: r.usuariosAtivos,
    tarefasCriadas: r.tarefasCriadas,
    tarefasConcluidas: r.tarefasConcluidas,
    tarefasNoPrazo: Math.min(r.noPrazoFracao, r.tarefasConcluidas),
    tarefasVencidasAbertas: r.tarefasVencidasAbertas,
    contatosPacientes: r.contatosPacientes,
    orcamentosEnviados: r.orcamentosEnviados,
    orcamentosPagos: r.orcamentosPagos,
    faltas: r.faltas,
    faltasRecontatadas: r.faltasRecontatadas,
    receitaRegistrada: Dinheiro.deCentavos(r.receita),
  }))

/** Uma linha por dia, como a UNIQUE `(cliente_carteira_id, dia)` garante. */
const linhasArb = fc
  .uniqueArray(linhaArb, { selector: (l) => l.dia, maxLength: 40 })
const hojeArb = fc.integer({ min: 0, max: 45 }).map((n) => somarDias('2026-10-12', n))

describe('propriedades', () => {
  it('T-10: diasComUso + diasSemDado <= diasUteis do CALENDÁRIO', () => {
    fc.assert(
      fc.property(linhasArb, hojeArb, (linhas, hoje) => {
        const m = metricasDeUso(linhas, semanaDe(hoje))
        expect(m.diasUteis).toBe(diasDaSemana(hoje).filter(ehUtil).length)
        expect(m.diasComUso + m.diasSemDado).toBeLessThanOrEqual(m.diasUteis)
      }),
    )
  })

  it('T-10: remover uma linha de fim de semana não muda os dias; remover a de um dia útil muda só "sem dado"', () => {
    fc.assert(
      fc.property(linhasArb, hojeArb, fc.nat(), (linhas, hoje, k) => {
        if (linhas.length === 0) return
        const alvo = linhas[k % linhas.length]!
        const antes = metricasDeUso(linhas, semanaDe(hoje))
        const depois = metricasDeUso(
          linhas.filter((l) => l !== alvo),
          semanaDe(hoje),
        )
        expect(depois.diasUteis).toBe(antes.diasUteis)
        const naJanela = alvo.dia >= semanaDe(hoje).de && alvo.dia < hoje
        if (!ehUtil(alvo.dia) || !naJanela) {
          expect(depois.diasComUso).toBe(antes.diasComUso)
          expect(depois.diasSemDado).toBe(antes.diasSemDado)
        } else {
          expect(depois.diasSemDado).toBe(antes.diasSemDado + 1)
        }
      }),
    )
  })

  it('ajuste 30: a linha de HOJE nunca muda as métricas nem a saúde', () => {
    fc.assert(
      fc.property(linhasArb, hojeArb, linhaArb, (linhas, hoje, l) => {
        const sem = linhas.filter((x) => x.dia !== hoje)
        if (sem.length === 0) return
        const com = [...sem, { ...l, dia: hoje }]
        expect(metricasDeUso(com, semanaDe(hoje))).toEqual(metricasDeUso(sem, semanaDe(hoje)))
        expect(saudeDoUso(com, hoje)).toEqual(saudeDoUso(sem, hoje))
      }),
    )
  })

  it('a ordem das linhas não importa', () => {
    fc.assert(
      fc.property(linhasArb, hojeArb, (linhas, hoje) => {
        const invertidas = [...linhas].reverse()
        expect(metricasDeUso(invertidas, semanaDe(hoje))).toEqual(metricasDeUso(linhas, semanaDe(hoje)))
        expect(saudeDoUso(invertidas, hoje)).toEqual(saudeDoUso(linhas, hoje))
      }),
    )
  })

  it('a receita da janela é EXATAMENTE a soma dos centavos das linhas da janela', () => {
    fc.assert(
      fc.property(linhasArb, hojeArb, (linhas, hoje) => {
        const j = semanaDe(hoje)
        const esperado = linhas
          .filter((l) => l.dia >= j.de && l.dia < j.ate)
          .reduce((s, l) => s + l.receitaRegistrada.centavos, 0n)
        expect(metricasDeUso(linhas, j).receita.centavos).toBe(esperado)
      }),
    )
  })

  it('percentual no prazo: a menos de meio ponto de 100·prazo/conc, verificado em inteiros', () => {
    fc.assert(
      fc.property(linhasArb, hojeArb, (linhas, hoje) => {
        const m = metricasDeUso(linhas, semanaDe(hoje))
        if (m.tarefasConcluidas === 0) {
          expect(m.percentualNoPrazo).toBeNull()
          return
        }
        const p = BigInt(m.percentualNoPrazo!)
        const a = BigInt(m.tarefasNoPrazo)
        const b = BigInt(m.tarefasConcluidas)
        // |p·b − 100·a| ≤ b/2  ⇔  |2·p·b − 200·a| ≤ b
        const dif = 2n * p * b - 200n * a
        expect(dif <= b && -dif <= b).toBe(true)
      }),
    )
  })

  it('dias com uso por semana em décimos: a menos de meio décimo de 50·diasUso/úteis', () => {
    fc.assert(
      fc.property(linhasArb, hojeArb, (linhas, hoje) => {
        const v = usoDoCliente(linhas, hoje)
        if (v === null) return
        const ind = v.relatorio.indicadores.find((i) => i.chave === 'diasComUsoPorSemana')!
        const m = metricasDeUso(linhas, { de: somarDias(hoje, -14), ate: hoje })
        if (m.diasUteis === 0) {
          expect(ind.agora).toBeNull()
          return
        }
        const dif = 2 * ind.agora! * m.diasUteis - 100 * m.diasComUso
        expect(Math.abs(dif)).toBeLessThanOrEqual(m.diasUteis)
      }),
    )
  })

  it('ajuste 33: a evolução é sempre agora − início, dos valores exibidos', () => {
    fc.assert(
      fc.property(linhasArb, hojeArb, (linhas, hoje) => {
        const v = usoDoCliente(linhas, hoje)
        if (v === null) return
        for (const i of v.relatorio.indicadores) {
          if (i.inicio === null || i.agora === null) expect(i.evolucao).toBeNull()
          else expect(i.evolucao).toBe(i.agora - i.inicio)
        }
      }),
    )
  })

  it('as situações fecham: bom + atenção + crítico + sem situação = clínicas', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(linhasArb, hojeArb), { maxLength: 8 }), (clientes) => {
        const saudes = clientes.map(([l, h]) => saudeDoUso(l, h))
        const r = resumoDasSituacoes(saudes)
        expect(r.bom + r.atencao + r.critico + r.semSituacao).toBe(r.clinicas)
        expect(r.clinicas).toBe(clientes.length)
      }),
    )
  })

  it('crítico só quando provado: "Uso muito baixo" exige que nem os dias sem dado salvariam a semana', () => {
    fc.assert(
      fc.property(linhasArb, hojeArb, (linhas, hoje) => {
        const s = saudeDoUso(linhas, hoje)
        if (s.rotulo !== 'Uso muito baixo') return
        const m = metricasDeUso(linhas, semanaDe(hoje))
        expect(m.diasComUso + m.diasSemDado).toBeLessThanOrEqual(2)
      }),
    )
  })
})
