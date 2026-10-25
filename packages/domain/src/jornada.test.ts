import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  ACOES,
  ACOES_DO_FUNIL,
  anexar,
  type AcaoDeJornada,
  ehDaJornada,
  type Etapa,
  ETAPAS,
  ETAPA_AO_CANCELAR,
  ETAPAS_EM_RECONTATO,
  ETAPAS_SEM_SAIDA,
  ETAPAS_TERMINAIS,
  etapaDerivada,
  type EventoDeJornada,
  ROTULO_DE_ACAO,
  ROTULO_DE_ETAPA,
  statusDaEtapa,
  transicao,
  TRANSICOES,
} from './jornada'
import { ehErro, ehOk, exigir, type Result } from './resultado'

const aberta = (etapa: Etapa, h: EventoDeJornada[] = []) =>
  ({ etapa, status: 'aberta', historico: h }) as const
const feita = (etapa: Etapa, h: EventoDeJornada[] = []) =>
  ({ etapa, status: 'concluida', historico: h }) as const

const ev = (acao: AcaoDeJornada, etapa: Etapa): EventoDeJornada => ({
  acao,
  etapa,
  em: '2026-10-24T12:00:00.000Z',
  porId: 'p1',
})

/** O estado consistente de uma etapa — o mesmo par que o `CHECK` do banco amarra. */
const estadoDe = (etapa: Etapa, h: EventoDeJornada[] = []) =>
  ({ etapa, status: statusDaEtapa(etapa), historico: h }) as const

const codigoDe = (r: Result<unknown>): string => (ehErro(r) ? r.erro.codigo : 'OK')
const mensagemDe = (r: Result<unknown>): string => (ehErro(r) ? r.erro.mensagem : '')

/* ----------------------------------------------------------- caminho feliz */

describe('transicao — o caminho que a clínica percorre', () => {
  it('o caminho feliz inteiro, uma tarefa só', () => {
    let e = estadoDe('agendado')
    for (const [acao, destino] of [
      ['confirmar', 'confirmado'],
      ['concluir', 'realizado'],
      ['registrarOrcamento', 'orcamento'],
      ['fechar', 'fechado'],
    ] as const) {
      const r = exigir(transicao(e, acao))
      expect(r.etapa).toBe(destino)
      e = { ...e, etapa: r.etapa, status: r.status }
    }
  })

  it('FALTOU MANTÉM O CARTÃO ABERTO — é o invariante do épico', () => {
    const r = exigir(transicao(aberta('confirmado'), 'noshow'))
    expect(r.etapa).toBe('faltou')
    expect(r.status).toBe('aberta') // NÃO concluida, NÃO cancelada
  })

  it('DESMARCOU MANTÉM O CARTÃO ABERTO', () => {
    expect(exigir(transicao(aberta('agendado'), 'desmarcar')).status).toBe('aberta')
  })

  it('de faltou só saem reagendar, encerrar e concluir', () => {
    const permitidas = ACOES.filter((a) => ehOk(transicao(aberta('faltou'), a)))
    expect([...permitidas].sort()).toEqual(['concluir', 'encerrar', 'reagendar'])
  })

  it('de desmarcou saem as mesmas três', () => {
    const permitidas = ACOES.filter((a) => ehOk(transicao(aberta('desmarcou'), a)))
    expect([...permitidas].sort()).toEqual(['concluir', 'encerrar', 'reagendar'])
  })

  it('reagendar devolve o cartão para agendado, e NÃO conta no funil', () => {
    const r = exigir(transicao(aberta('faltou'), 'reagendar'))
    expect(r.etapa).toBe('agendado')
    expect(r.contaNoFunil).toBe(false)
  })

  it('encerrar leva a encerrado e CANCELA — não some do banco', () => {
    const r = exigir(transicao(aberta('desmarcou'), 'encerrar'))
    expect(r.etapa).toBe('encerrado')
    expect(r.status).toBe('cancelada')
  })

  it('enviar confirmação não muda a etapa e não conta no funil', () => {
    const r = exigir(transicao(aberta('agendado'), 'enviarConfirmacao'))
    expect(r.etapa).toBe('agendado')
    expect(r.contaNoFunil).toBe(false)
  })

  it('follow-up não muda a etapa e não conta no funil', () => {
    const r = exigir(transicao(feita('orcamento'), 'followUp'))
    expect(r.etapa).toBe('orcamento')
    expect(r.contaNoFunil).toBe(false)
  })

  it('fechar sai de realizado também — sem orçamento pelo meio', () => {
    expect(exigir(transicao(feita('realizado'), 'fechar')).etapa).toBe('fechado')
  })
})

/* -------------------------------------------------------------- o proibido */

describe('transicao — o que é proibido, cada caso', () => {
  it('registrar orçamento duas vezes é recusado', () => {
    const r = transicao(feita('orcamento'), 'registrarOrcamento')
    expect(codigoDe(r)).toBe('TRANSICAO_INVALIDA')
  })

  it('não se orça um atendimento que ainda não aconteceu', () => {
    const r = transicao(aberta('confirmado'), 'registrarOrcamento')
    expect(mensagemDe(r)).toContain('ainda não aconteceu')
  })

  it('de fechado e perdido NADA sai — nem reabrir', () => {
    for (const t of ETAPAS_SEM_SAIDA) {
      for (const a of ACOES) {
        expect(ehErro(transicao(estadoDe(t), a)), `${t} + ${a}`).toBe(true)
      }
    }
  })

  it('de encerrado sai SÓ reabrir — porque cancelar por engano acontece', () => {
    const permitidas = ACOES.filter((a) => ehOk(transicao(estadoDe('encerrado'), a)))
    expect(permitidas).toEqual(['reabrir'])
    // E `encerrado` continua terminal no FUNIL: a jornada não avança dali.
    expect(ETAPAS_TERMINAIS).toContain('encerrado')
  })

  it('a etapa de uma tarefa cancelada é a única com status cancelada', () => {
    // O `CHECK etapa_combina_com_status` não deixa escolha: cancelar pela rota
    // do épico 2 tem de gravar esta etapa, e existe exatamente uma.
    expect(statusDaEtapa(ETAPA_AO_CANCELAR)).toBe('cancelada')
    expect(ETAPAS.filter((e) => statusDaEtapa(e) === 'cancelada')).toEqual([ETAPA_AO_CANCELAR])
  })

  it('A MATRIZ INTEIRA: 9 etapas × 13 ações, e só as 23 combinações da tabela passam', () => {
    // 117 combinações, uma por uma, e as 94 restantes são recusadas. É o
    // único jeito de provar que CADA transição proibida é recusada — "de
    // faltou só saem três" prova três linhas, não as outras 114.
    //
    // A lista abaixo é LITERAL de propósito: a propriedade "ou está na tabela
    // ou é erro" deriva o esperado da PRÓPRIA tabela, então acrescentar uma
    // linha a `TRANSICOES` a mantém verde. Este teste é o que prende a tabela
    // à especificação escrita, e foi ele que pegou as duas mutações.
    const permitidas: string[] = []
    for (const etapa of ETAPAS) {
      for (const acao of ACOES) {
        const r = transicao(estadoDe(etapa), acao)
        if (ehOk(r)) permitidas.push(`${etapa} -${acao}-> ${r.valor.etapa}/${r.valor.status}`)
        else expect(codigoDe(r), `${etapa} + ${acao}`).toBe('TRANSICAO_INVALIDA')
      }
    }
    expect([...permitidas].sort()).toEqual(
      [
        'agendado -confirmar-> confirmado/aberta',
        'agendado -concluir-> realizado/concluida',
        'agendado -desmarcar-> desmarcou/aberta',
        'agendado -enviarConfirmacao-> agendado/aberta',
        'agendado -noshow-> faltou/aberta',
        'agendado -reagendar-> agendado/aberta',
        'confirmado -concluir-> realizado/concluida',
        'confirmado -desmarcar-> desmarcou/aberta',
        'confirmado -noshow-> faltou/aberta',
        'confirmado -reagendar-> agendado/aberta',
        'encerrado -reabrir-> agendado/aberta',
        'desmarcou -concluir-> realizado/concluida',
        'desmarcou -encerrar-> encerrado/cancelada',
        'desmarcou -reagendar-> agendado/aberta',
        'faltou -concluir-> realizado/concluida',
        'faltou -encerrar-> encerrado/cancelada',
        'faltou -reagendar-> agendado/aberta',
        'orcamento -fechar-> fechado/concluida',
        'orcamento -followUp-> orcamento/concluida',
        'orcamento -perder-> perdido/concluida',
        'realizado -fechar-> fechado/concluida',
        'realizado -reabrir-> agendado/aberta',
        'realizado -registrarOrcamento-> orcamento/concluida',
      ].sort(),
    )
    expect(permitidas).toHaveLength(23)
  })

  it('nenhuma ação de agenda alcança um cartão concluído', () => {
    for (const acao of ['confirmar', 'noshow', 'desmarcar', 'reagendar', 'enviarConfirmacao'] as const) {
      for (const etapa of ['realizado', 'orcamento', 'fechado', 'perdido'] as const) {
        expect(ehErro(transicao(estadoDe(etapa), acao)), `${etapa} + ${acao}`).toBe(true)
      }
    }
  })

  it('nenhuma ação de orçamento alcança um cartão em aberto', () => {
    for (const acao of ['registrarOrcamento', 'followUp', 'fechar', 'perder'] as const) {
      for (const etapa of ['agendado', 'confirmado', 'faltou', 'desmarcou'] as const) {
        expect(ehErro(transicao(aberta(etapa), acao)), `${etapa} + ${acao}`).toBe(true)
      }
    }
  })

  it('encerrar SÓ sai de faltou ou desmarcou', () => {
    for (const etapa of ETAPAS) {
      const r = transicao(estadoDe(etapa), 'encerrar')
      expect(ehOk(r), etapa).toBe(ETAPAS_EM_RECONTATO.includes(etapa))
    }
  })

  it('agendar não é transição: é criação, e não sai de etapa nenhuma', () => {
    for (const etapa of ETAPAS) {
      expect(ehErro(transicao(estadoDe(etapa), 'agendar')), etapa).toBe(true)
    }
  })

  it('reabrir é recusado depois do orçamento — o dinheiro não pode ficar órfão', () => {
    for (const etapa of ['orcamento', 'fechado', 'perdido'] as const) {
      const r = transicao(estadoDe(etapa), 'reabrir')
      expect(codigoDe(r)).toBe('TRANSICAO_INVALIDA')
      expect(mensagemDe(r)).toContain('orçamento')
    }
  })

  it('estado impossível é recusado, não interpretado', () => {
    // O `CHECK etapa_combina_com_status` da 0007 torna isto impossível no
    // banco. Se um dado migrado chegar assim, a resposta é recusar — não
    // escolher um dos dois e seguir.
    const r = transicao({ etapa: 'faltou', status: 'concluida', historico: [] }, 'reagendar')
    expect(codigoDe(r)).toBe('ESTADO_IMPOSSIVEL')
  })
})

/* ---------------------------------------------------------------- reabrir */

describe('reabrir — a etapa vem do histórico', () => {
  it('restaura a etapa anterior ao realizado, não "agendado" por padrão', () => {
    const h = [ev('confirmar', 'confirmado'), ev('noshow', 'faltou'), ev('concluir', 'realizado')]
    expect(exigir(transicao(feita('realizado', h), 'reabrir')).etapa).toBe('faltou')
  })

  it('restaura confirmado quando foi dali que a tarefa foi concluída', () => {
    const h = [ev('agendar', 'agendado'), ev('confirmar', 'confirmado'), ev('concluir', 'realizado')]
    expect(exigir(transicao(feita('realizado', h), 'reabrir')).etapa).toBe('confirmado')
  })

  it('reabrir um cartão ENCERRADO o devolve para o Recontatar', () => {
    // Cancelar por engano acontece. O cartão volta para onde estava —
    // `desmarcou` —, não para `agendado`, senão a recepção perde o recontato.
    const h = [ev('agendar', 'agendado'), ev('desmarcar', 'desmarcou'), ev('encerrar', 'encerrado')]
    const r = exigir(transicao({ etapa: 'encerrado', status: 'cancelada', historico: h }, 'reabrir'))
    expect(r.etapa).toBe('desmarcou')
    expect(r.status).toBe('aberta')
  })

  it('histórico vazio ou sem etapa em aberto volta para agendado', () => {
    expect(exigir(transicao(feita('realizado'), 'reabrir')).etapa).toBe('agendado')
    const h = [ev('concluir', 'realizado')]
    expect(exigir(transicao(feita('realizado', h), 'reabrir')).etapa).toBe('agendado')
  })

  it('reabrir nunca conta no funil', () => {
    expect(exigir(transicao(feita('realizado'), 'reabrir')).contaNoFunil).toBe(false)
  })
})

/* -------------------------------------------------------------- histórico */

describe('anexar — append-only', () => {
  it('o histórico é append-only: o prefixo nunca muda', () => {
    const antes = [ev('agendar', 'agendado')]
    const depois = anexar(antes, ev('confirmar', 'confirmado'))
    expect(depois.slice(0, 1)).toEqual(antes)
    expect(antes).toHaveLength(1) // o original não foi mutado
    expect(depois).toHaveLength(2)
  })
})

/* ------------------------------------------------------------ etapa derivada */

describe('etapaDerivada — só para o dado migrado do épico 9', () => {
  it('conserta o cartão morto do protótipo', () => {
    // "Consulta agendada" CONCLUÍDA: o protótipo devolve "agendado" e o cartão
    // fica sem nenhuma ação possível, no lugar errado do kanban.
    expect(
      etapaDerivada({ tipo: 'Consulta agendada', status: 'concluida', pacienteId: 'p1' }),
    ).toBe('realizado')
    expect(etapaDerivada({ tipo: 'Consulta agendada', status: 'aberta', pacienteId: 'p1' })).toBe(
      'agendado',
    )
    expect(etapaDerivada({ tipo: 'Follow-up', status: 'aberta', pacienteId: 'p1' })).toBeNull()
    expect(
      etapaDerivada({ tipo: 'Consulta agendada', status: 'aberta', pacienteId: null }),
    ).toBeNull()
  })

  it('cancelada vira encerrado, nunca desmarcou', () => {
    // O protótipo devolve "desmarcou" para cancelada, e aí o cartão aparece em
    // Recontatar para sempre — cancelado e pedindo recontato ao mesmo tempo.
    expect(
      etapaDerivada({ tipo: 'Consulta agendada', status: 'cancelada', pacienteId: 'p1' }),
    ).toBe('encerrado')
  })

  it('atendimento já realizado derivado aberto é agendado', () => {
    expect(etapaDerivada({ tipo: 'Consulta realizada', status: 'aberta', pacienteId: 'p1' })).toBe(
      'agendado',
    )
    expect(
      etapaDerivada({ tipo: 'Consulta realizada', status: 'concluida', pacienteId: 'p1' }),
    ).toBe('realizado')
  })

  it('sessão de programa NÃO é da jornada comercial', () => {
    expect(ehDaJornada({ tipo: 'Sessão de plano', pacienteId: 'p1' })).toBe(false)
    expect(etapaDerivada({ tipo: 'Sessão de plano', status: 'aberta', pacienteId: 'p1' })).toBeNull()
  })

  it('toda etapa derivada é consistente com o status — o CHECK do banco aceita', () => {
    for (const tipo of ['Consulta agendada', 'Procedimento agendado', 'Consulta realizada']) {
      for (const status of ['aberta', 'concluida', 'cancelada'] as const) {
        const e = etapaDerivada({ tipo, status, pacienteId: 'p1' })
        if (e === null) continue
        expect(statusDaEtapa(e), `${tipo}/${status}`).toBe(status)
      }
    }
  })
})

/* ------------------------------------------------------------------ tabela */

describe('a tabela é a verdade', () => {
  it('ACOES_DO_FUNIL é DERIVADO da tabela, nunca escrito à mão', () => {
    expect([...ACOES_DO_FUNIL].sort()).toEqual(
      ['agendar', 'confirmar', 'noshow', 'desmarcar', 'concluir', 'registrarOrcamento', 'fechar', 'perder'].sort(),
    )
    for (const a of ['reagendar', 'enviarConfirmacao', 'followUp', 'encerrar', 'reabrir'] as const) {
      expect(ACOES_DO_FUNIL.includes(a), a).toBe(false)
    }
  })

  it('toda ação da união tem exatamente uma linha na tabela', () => {
    for (const a of ACOES) {
      expect(TRANSICOES.filter((t) => t.acao === a), a).toHaveLength(1)
    }
    expect(TRANSICOES).toHaveLength(ACOES.length)
  })

  it('toda etapa tem rótulo, e nenhum rótulo sobra', () => {
    expect(Object.keys(ROTULO_DE_ETAPA).sort()).toEqual([...ETAPAS].sort())
    expect(Object.keys(ROTULO_DE_ACAO).sort()).toEqual([...ACOES].sort())
  })

  it('`exigeMotivo` é só de perder, e `exigeValor` só de orçamento e fechamento', () => {
    expect(TRANSICOES.filter((t) => t.exigeMotivo).map((t) => t.acao)).toEqual(['perder'])
    expect(TRANSICOES.filter((t) => t.exigeValor).map((t) => t.acao)).toEqual([
      'registrarOrcamento',
      'fechar',
    ])
  })
})

/* -------------------------------------------------------------- propriedades */

/** BFS sobre a tabela: de `etapa`, chega-se a algum terminal? */
function alcancaTerminal(etapa: Etapa): boolean {
  const vistos = new Set<Etapa>([etapa])
  const fila: Etapa[] = [etapa]
  while (fila.length > 0) {
    const atual = fila.shift()!
    if (ETAPAS_TERMINAIS.includes(atual)) return true
    for (const t of TRANSICOES) {
      if (!t.de.includes(atual)) continue
      // `'anterior'` (reabrir) pode cair em qualquer etapa em aberto.
      const destinos: readonly Etapa[] =
        t.para === 'anterior' ? ['agendado', 'confirmado', 'faltou', 'desmarcou'] : [t.para]
      for (const d of destinos) {
        if (vistos.has(d)) continue
        vistos.add(d)
        fila.push(d)
      }
    }
  }
  return false
}

describe('propriedades — exemplo a dedo não prova tabela de transições', () => {
  it('toda transição ou está na tabela ou é erro — nunca um terceiro resultado', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ETAPAS), fc.constantFrom(...ACOES), (etapa, acao) => {
        const r = transicao(estadoDe(etapa), acao)
        const naTabela = TRANSICOES.some((t) => t.acao === acao && t.de.includes(etapa))
        expect(ehOk(r)).toBe(naTabela)
      }),
    )
  })

  it('o status do destino nunca contradiz a etapa do destino', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ETAPAS), fc.constantFrom(...ACOES), (etapa, acao) => {
        const r = transicao(estadoDe(etapa), acao)
        if (ehErro(r)) return
        expect(r.valor.status).toBe(statusDaEtapa(r.valor.etapa))
      }),
    )
  })

  it('de qualquer caminho alcançável, ainda existe caminho para um terminal', () => {
    // Sem esta propriedade, uma etapa sem saída passa despercebida até a
    // recepção ter um cartão travado na tela, todo dia, sem botão nenhum.
    let andou = 0
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...ACOES), { maxLength: 20 }), (acoes) => {
        let e: { etapa: Etapa; status: ReturnType<typeof statusDaEtapa>; historico: EventoDeJornada[] } =
          { etapa: 'agendado', status: 'aberta', historico: [] }
        for (const a of acoes) {
          const r = transicao(e, a)
          if (ehErro(r)) continue
          andou++
          e = {
            etapa: r.valor.etapa,
            status: r.valor.status,
            historico: anexar(e.historico, ev(a, r.valor.etapa)) as EventoDeJornada[],
          }
        }
        expect(alcancaTerminal(e.etapa)).toBe(true)
      }),
    )
    // Piso: sem ele a propriedade passaria com toda transição devolvendo erro.
    expect(andou).toBeGreaterThan(100)
  })

  it('o estado alcançado por qualquer caminho é sempre consistente', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...ACOES), { maxLength: 20 }), (acoes) => {
        let e: { etapa: Etapa; status: ReturnType<typeof statusDaEtapa>; historico: EventoDeJornada[] } =
          { etapa: 'agendado', status: 'aberta', historico: [] }
        for (const a of acoes) {
          const r = transicao(e, a)
          if (ehErro(r)) continue
          e = {
            etapa: r.valor.etapa,
            status: r.valor.status,
            historico: anexar(e.historico, ev(a, r.valor.etapa)) as EventoDeJornada[],
          }
          expect(e.status).toBe(statusDaEtapa(e.etapa))
        }
      }),
    )
  })

  it('anexar é append-only e preserva a ordem para qualquer sequência', () => {
    const eventoArb = fc.record({
      acao: fc.constantFrom(...ACOES),
      etapa: fc.constantFrom(...ETAPAS),
      em: fc.constant('2026-10-24T12:00:00.000Z'),
      porId: fc.string({ minLength: 1, maxLength: 8 }),
    })
    fc.assert(
      fc.property(fc.array(eventoArb, { maxLength: 30 }), (eventos) => {
        let h: readonly EventoDeJornada[] = []
        const vistos: EventoDeJornada[] = []
        for (const e of eventos) {
          h = anexar(h, e)
          vistos.push(e)
        }
        expect(h).toEqual(vistos)
      }),
    )
  })
})
