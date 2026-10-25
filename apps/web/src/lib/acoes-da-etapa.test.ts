import { type Etapa, ETAPAS, ROTULO_DE_ACAO, TRANSICOES } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { acoesDaEtapa, contextoDaEtapa } from './acoes-da-etapa'

/**
 * A FAIXA É DERIVADA DA TABELA, e este arquivo é o que prova isso.
 *
 * Se alguém escrever uma segunda lista de ações no front — que é exatamente a
 * dívida que este projeto existe para não repetir — ela divergirá da tabela no
 * dia em que uma transição mudar, e a varredura abaixo acusa.
 */
const HOJE = '2026-10-25'

const nomes = (etapa: Etapa, extra: Partial<Parameters<typeof acoesDaEtapa>[0]> = {}) =>
  acoesDaEtapa({ etapa, status: 'aberta', concluidaEm: null, hoje: HOJE, ...extra }).map(
    (a) => a.acao,
  )

describe('a faixa de ações vem da tabela de @fir/domain', () => {
  it('nenhuma ação da faixa está fora da tabela de transições', () => {
    for (const etapa of ETAPAS) {
      for (const acao of nomes(etapa)) {
        const t = TRANSICOES.find((x) => x.acao === acao)
        expect(t, `${acao} não existe na tabela`).toBeDefined()
        expect(t!.de.includes(etapa), `${etapa} -${acao}-> não está na tabela`).toBe(true)
      }
    }
  })

  it('agendado oferece confirmar, enviar confirmação e reagendar antes das recusas', () => {
    expect(nomes('agendado')).toEqual([
      'enviarConfirmacao',
      'confirmar',
      'reagendar',
      'noshow',
      'desmarcar',
    ])
  })

  it('de faltou saem só reagendar e encerrar — concluir é o círculo do cartão', () => {
    expect(nomes('faltou')).toEqual(['reagendar', 'encerrar'])
    expect(nomes('desmarcou')).toEqual(['reagendar', 'encerrar'])
  })

  it('de orçamento saem fechar, follow-up e perder', () => {
    expect(nomes('orcamento', { status: 'concluida' }).sort()).toEqual([
      'fechar',
      'followUp',
      'perder',
    ])
  })

  it('os três terminais não oferecem ação nenhuma', () => {
    for (const etapa of ['fechado', 'perdido', 'encerrado'] as const) {
      expect(nomes(etapa, { status: etapa === 'encerrado' ? 'cancelada' : 'concluida' }), etapa)
        .toEqual([])
    }
  })

  it('agendar, concluir e reabrir NUNCA aparecem na faixa', () => {
    // As três têm porta própria: "Nova tarefa" e o círculo do cartão. Duas
    // portas lado a lado para a mesma coisa, com rótulos diferentes, é a
    // recepção escolhendo errado metade das vezes.
    for (const etapa of ETAPAS) {
      const fora = nomes(etapa, { status: 'concluida' }).filter((a) =>
        (['agendar', 'concluir', 'reabrir'] as string[]).includes(a),
      )
      expect(fora, etapa).toEqual([])
    }
  })

  it('a faixa sem etapa é vazia — tarefa interna não tem jornada', () => {
    expect(acoesDaEtapa({ etapa: null, status: 'aberta', concluidaEm: null, hoje: HOJE })).toEqual(
      [],
    )
  })

  it('todo rótulo da faixa é o da tabela de @fir/domain', () => {
    for (const a of acoesDaEtapa({
      etapa: 'agendado',
      status: 'aberta',
      concluidaEm: null,
      hoje: HOJE,
    })) {
      expect(a.rotulo).toBe(ROTULO_DE_ACAO[a.acao])
    }
  })
})

describe('o limite de 30 dias para orçar é SÓ DA TELA (decisão D-6)', () => {
  const realizado = (concluidaEm: string) =>
    nomes('realizado', { status: 'concluida', concluidaEm })

  it('um atendimento de ontem oferece registrar orçamento', () => {
    expect(realizado('2026-10-24T12:00:00Z')).toContain('registrarOrcamento')
  })

  it('exatamente 30 dias atrás ainda oferece — a borda entra', () => {
    expect(realizado('2026-09-25T12:00:00Z')).toContain('registrarOrcamento')
  })

  it('31 dias atrás não oferece — mas "Fechou" continua', () => {
    const acoes = realizado('2026-09-24T12:00:00Z')
    expect(acoes).not.toContain('registrarOrcamento')
    // O servidor PERMITE orçar: isto é afordância, não regra. Se fosse regra,
    // a migração do épico 9 teria de escrever direto na tabela.
    expect(acoes).toContain('fechar')
  })
})

describe('a linha de contexto da etapa', () => {
  it('diz quando a confirmação foi enviada, e que ninguém respondeu', () => {
    expect(
      contextoDaEtapa({
        etapa: 'agendado',
        confirmacaoEnviadaEm: '2026-10-23T14:30:00Z',
        proximoPassoEm: null,
        hoje: HOJE,
      }),
    ).toBe('confirmação enviada em 23/10, aguardando resposta')
  })

  it('não diz nada num agendado sem confirmação enviada', () => {
    expect(
      contextoDaEtapa({
        etapa: 'agendado',
        confirmacaoEnviadaEm: null,
        proximoPassoEm: null,
        hoje: HOJE,
      }),
    ).toBeNull()
  })

  it('marca o orçamento vencido como ATRASADO', () => {
    const comum = { etapa: 'orcamento' as const, confirmacaoEnviadaEm: null, hoje: HOJE }
    expect(contextoDaEtapa({ ...comum, proximoPassoEm: '2026-10-24' })).toBe(
      'retomar em 24/10 (atrasado)',
    )
    expect(contextoDaEtapa({ ...comum, proximoPassoEm: '2026-10-25' })).toBe('retomar em 25/10')
    expect(contextoDaEtapa({ ...comum, proximoPassoEm: '2026-10-28' })).toBe('retomar em 28/10')
  })

  it('o recontato diz o que fazer', () => {
    for (const etapa of ['faltou', 'desmarcou'] as const) {
      expect(
        contextoDaEtapa({ etapa, confirmacaoEnviadaEm: null, proximoPassoEm: null, hoje: HOJE }),
      ).toBe('recontatar para reagendar')
    }
  })
})
