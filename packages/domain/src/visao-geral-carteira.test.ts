import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from './dinheiro'
import { somarDias } from './relogio'
import type { SaudeDoCliente } from './prospeccao'
import {
  type AcaoNaVisaoGeral,
  type ClienteNaVisaoGeral,
  contadoresDoMenu,
  montarVisaoGeral,
  segmentosDaBarra,
  type TarefaNaVisaoGeral,
} from './visao-geral-carteira'

/**
 * Seam: `packages/domain` puro. A Visão geral da carteira (`vPainel`,
 * protótipo L1278–1331) com os ajustes 11 a 13 do gate de números e a
 * decisão D-22 item 12 (ticket médio só de quem tem mensalidade).
 */

// 2026-11-11 é uma QUARTA-feira (ISO 3).
const HOJE = '2026-11-11'

const cliente = (p: Partial<ClienteNaVisaoGeral> & { id: string }): ClienteNaVisaoGeral => ({
  nome: `Cliente ${p.id}`,
  status: 'ativo',
  mensalidade: Dinheiro.zero(),
  saude: null,
  responsavelId: null,
  responsavelNome: null,
  reuniaoDiaSemana: null,
  reuniaoHora: null,
  resumoDaUltimaReuniao: null,
  ...p,
})

const acao = (p: Partial<AcaoNaVisaoGeral> & { id: string; clienteId: string }): AcaoNaVisaoGeral => ({
  aberta: true,
  prazo: null,
  ...p,
})

const tarefa = (prazo: string, responsavelId: string | null = null): TarefaNaVisaoGeral => ({ prazo, responsavelId })

const vazia = { clientes: [], acoes: [], tarefas: [], pessoas: [] }

describe('os quatro KPIs (P1, L1296-1301)', () => {
  it('clientes ativos = ativo + onboarding; pausado e encerrado ficam de fora', () => {
    const v = montarVisaoGeral(
      {
        ...vazia,
        clientes: [
          cliente({ id: 'a', status: 'ativo' }),
          cliente({ id: 'b', status: 'onboarding' }),
          cliente({ id: 'c', status: 'pausado' }),
          cliente({ id: 'd', status: 'encerrado' }),
        ],
      },
      HOJE,
    )
    expect(v.kpis.clientesAtivos).toBe(2)
    expect(v.kpis.emOnboarding).toBe(1)
  })

  it('MRR soma a mensalidade dos ativos; ticket médio divide só pelos que têm mensalidade (D-22 item 12)', () => {
    const v = montarVisaoGeral(
      {
        ...vazia,
        clientes: [
          cliente({ id: 'a', mensalidade: Dinheiro.deCentavos(100_000n) }),
          cliente({ id: 'b', mensalidade: Dinheiro.deCentavos(50_001n) }),
          cliente({ id: 'c', mensalidade: Dinheiro.zero() }),
          cliente({ id: 'd', status: 'pausado', mensalidade: Dinheiro.deCentavos(999_999n) }),
        ],
      },
      HOJE,
    )
    expect(v.kpis.mrr.centavos).toBe(150_001n)
    // 150.001 / 2 = 75.000,5 → meio para cima → 75.001 (Dinheiro.media).
    expect(v.kpis.ticketMedio?.centavos).toBe(75_001n)
  })

  it('PROPRIEDADE: MRR é a soma exata dos ativos, e o ticket é a média (meio para cima) só de quem tem mensalidade', () => {
    const arbStatus = fc.constantFrom<ClienteNaVisaoGeral['status']>('ativo', 'onboarding', 'pausado', 'encerrado')
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.bigInt({ min: 0n, max: 10n ** 12n }), arbStatus), { maxLength: 30 }), (xs) => {
        const v = montarVisaoGeral(
          {
            ...vazia,
            clientes: xs.map(([c, status], i) => cliente({ id: String(i), status, mensalidade: Dinheiro.deCentavos(c) })),
          },
          HOJE,
        )
        const ativos = xs.filter(([, s]) => s === 'ativo' || s === 'onboarding')
        const soma = ativos.reduce((t, [c]) => t + c, 0n)
        const n = BigInt(ativos.filter(([c]) => c > 0n).length)
        expect(v.kpis.mrr.centavos).toBe(soma)
        if (n === 0n) expect(v.kpis.ticketMedio).toBeNull()
        else expect(v.kpis.ticketMedio?.centavos).toBe((2n * soma + n) / (2n * n))
      }),
    )
  })

  it('sem cliente com mensalidade, o ticket médio não existe (nunca R$ 0,00)', () => {
    const v = montarVisaoGeral({ ...vazia, clientes: [cliente({ id: 'a' })] }, HOJE)
    expect(v.kpis.ticketMedio).toBeNull()
    expect(v.kpis.mrr.ehZero()).toBe(true)
  })

  it('ações atrasadas contam só as dos clientes ativos, e em quantos clientes', () => {
    const v = montarVisaoGeral(
      {
        ...vazia,
        clientes: [cliente({ id: 'a' }), cliente({ id: 'b' }), cliente({ id: 'z', status: 'encerrado' })],
        acoes: [
          acao({ id: '1', clienteId: 'a', prazo: '2026-11-10' }),
          acao({ id: '2', clienteId: 'a', prazo: '2026-11-01' }),
          acao({ id: '3', clienteId: 'b', prazo: '2026-11-09' }),
          acao({ id: '4', clienteId: 'b', prazo: HOJE }), // hoje não é atrasada
          acao({ id: '5', clienteId: 'b', prazo: '2026-11-01', aberta: false }),
          acao({ id: '6', clienteId: 'z', prazo: '2026-11-01' }), // encerrado
          acao({ id: '7', clienteId: 'a', prazo: null }),
        ],
      },
      HOJE,
    )
    expect(v.kpis.acoesAtrasadas).toBe(3)
    expect(v.kpis.clientesComAcaoAtrasada).toBe(2)
  })

  it('tarefas vencidas são as de prazo antes de hoje; as de hoje são contadas à parte', () => {
    const v = montarVisaoGeral(
      { ...vazia, tarefas: [tarefa('2026-11-10'), tarefa('2026-10-01'), tarefa(HOJE), tarefa('2026-11-12')] },
      HOJE,
    )
    expect(v.kpis.tarefasVencidas).toBe(2)
    expect(v.kpis.tarefasVencemHoje).toBe(1)
  })
})

describe('saúde da carteira (P2, L1303-1310)', () => {
  it('quem está em atenção ou crítico, crítico primeiro, com resumo, ações atrasadas e responsável', () => {
    const v = montarVisaoGeral(
      {
        ...vazia,
        clientes: [
          cliente({ id: 'a', saude: 'atencao', resumoDaUltimaReuniao: 'Falamos de agenda.', responsavelNome: 'Ana' }),
          cliente({ id: 'b', saude: 'bom' }),
          cliente({ id: 'c', saude: 'critico' }),
          cliente({ id: 'd', saude: null }),
        ],
        acoes: [acao({ id: '1', clienteId: 'a', prazo: '2026-11-01' })],
      },
      HOJE,
    )
    expect(v.saude.emRisco.map((c) => c.id)).toEqual(['c', 'a'])
    expect(v.saude.emRisco[1]).toMatchObject({
      saude: 'atencao',
      resumoDaUltimaReuniao: 'Falamos de agenda.',
      acoesAtrasadas: 1,
      responsavelNome: 'Ana',
    })
  })

  it('cliente sem saúde registrada é um balde próprio e não entra em "em risco" (ajuste 13)', () => {
    const v = montarVisaoGeral({ ...vazia, clientes: [cliente({ id: 'd' })] }, HOJE)
    expect(v.saude).toMatchObject({ bom: 0, atencao: 0, critico: 0, semSaude: 1, emRisco: [] })
  })

  it('PROPRIEDADE: bom + atenção + crítico + sem saúde = clientes ativos (ajuste 13)', () => {
    const arbSaude = fc.constantFrom<SaudeDoCliente | null>('bom', 'atencao', 'critico', null)
    const arbStatus = fc.constantFrom<ClienteNaVisaoGeral['status']>('ativo', 'onboarding', 'pausado', 'encerrado')
    fc.assert(
      fc.property(fc.array(fc.tuple(arbSaude, arbStatus), { maxLength: 40 }), (xs) => {
        const v = montarVisaoGeral(
          { ...vazia, clientes: xs.map(([saude, status], i) => cliente({ id: String(i), saude, status })) },
          HOJE,
        )
        const s = v.saude
        expect(s.bom + s.atencao + s.critico + s.semSaude).toBe(v.kpis.clientesAtivos)
        // A barra cobre exatamente o total, sem buraco nem sobreposição.
        expect(s.barra.reduce((t, x) => t + x.largura, 0)).toBe(v.kpis.clientesAtivos)
      }),
    )
  })
})

describe('equipe (P3, L1289-1292, L1312-1317)', () => {
  it('clientes na carteira, tarefas pendentes e vencidas por pessoa', () => {
    const v = montarVisaoGeral(
      {
        clientes: [
          cliente({ id: 'a', responsavelId: 'p1' }),
          cliente({ id: 'b', responsavelId: 'p1' }),
          cliente({ id: 'c', responsavelId: 'p1', status: 'encerrado' }),
          cliente({ id: 'd', responsavelId: 'p2' }),
        ],
        acoes: [],
        tarefas: [tarefa('2026-11-01', 'p1'), tarefa(HOJE, 'p1'), tarefa('2026-11-20', 'p2'), tarefa('2026-11-01', null)],
        pessoas: [
          { id: 'p1', nome: 'Ana Souza' },
          { id: 'p2', nome: 'Bia' },
        ],
      },
      HOJE,
    )
    expect(v.equipe.pessoas).toEqual([
      expect.objectContaining({ id: 'p1', iniciais: 'AS', clientes: 2, pendentes: 2, vencidas: 1 }),
      expect.objectContaining({ id: 'p2', iniciais: 'B', clientes: 1, pendentes: 1, vencidas: 0 }),
    ])
    expect(v.equipe.escala).toBe(2)
  })

  it('a escala nunca é zero (Math.max(1, ...), L1292)', () => {
    const v = montarVisaoGeral({ ...vazia, pessoas: [{ id: 'p', nome: 'Pessoa' }] }, HOJE)
    expect(v.equipe.escala).toBe(1)
  })
})

describe('reuniões da semana (P4, L1288, L1318-1319)', () => {
  it('ordenadas pelo dia (e hora), com a de hoje marcada; só clientes ativos com reunião fixa', () => {
    const v = montarVisaoGeral(
      {
        ...vazia,
        clientes: [
          cliente({ id: 'sex', reuniaoDiaSemana: 5, reuniaoHora: '09:00' }),
          cliente({ id: 'qua2', reuniaoDiaSemana: 3, reuniaoHora: '16:00' }),
          cliente({ id: 'qua1', reuniaoDiaSemana: 3, reuniaoHora: '08:30' }),
          cliente({ id: 'seg', reuniaoDiaSemana: 1, reuniaoHora: null }),
          cliente({ id: 'sem' }),
          cliente({ id: 'enc', status: 'encerrado', reuniaoDiaSemana: 2 }),
        ],
      },
      HOJE,
    )
    expect(v.reunioesDaSemana.map((r) => [r.clienteId, r.diaDaSemana, r.ehHoje])).toEqual([
      ['seg', 1, false],
      ['qua1', 3, true],
      ['qua2', 3, true],
      ['sex', 5, false],
    ])
  })
})

describe('próximas entregas do plano (P10, L1327-1330)', () => {
  it('abertas, com prazo, atrasadas ou até 7 dias à frente, por prazo', () => {
    const v = montarVisaoGeral(
      {
        ...vazia,
        clientes: [cliente({ id: 'a' }), cliente({ id: 'z', status: 'encerrado' })],
        acoes: [
          acao({ id: 'longe', clienteId: 'a', prazo: somarDias(HOJE, 8) }),
          acao({ id: 'limite', clienteId: 'a', prazo: somarDias(HOJE, 7) }),
          acao({ id: 'velha', clienteId: 'a', prazo: '2026-10-01' }),
          acao({ id: 'hoje', clienteId: 'a', prazo: HOJE }),
          acao({ id: 'feita', clienteId: 'a', prazo: HOJE, aberta: false }),
          acao({ id: 'sem', clienteId: 'a', prazo: null }),
          // O protótipo filtra por `vis(cli)`, não por `ativos()`: cliente
          // encerrado com ação aberta continua aparecendo.
          acao({ id: 'enc', clienteId: 'z', prazo: HOJE }),
        ],
      },
      HOJE,
    )
    expect(v.proximasEntregas).toEqual(['velha', 'hoje', 'enc', 'limite'])
  })
})

describe('segmentosDaBarra', () => {
  it('posições contíguas, zeros omitidos', () => {
    expect(
      segmentosDaBarra([
        ['a', 2],
        ['b', 0],
        ['c', 3],
      ]),
    ).toEqual([
      { chave: 'a', inicio: 0, largura: 2 },
      { chave: 'c', inicio: 2, largura: 3 },
    ])
  })

  it('PROPRIEDADE: cada segmento começa onde o anterior termina, e a soma é o total', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 1000 }), { maxLength: 10 }), (ns) => {
        const s = segmentosDaBarra(ns.map((n, i) => [String(i), n] as const))
        let fim = 0
        for (const x of s) {
          expect(x.inicio).toBe(fim)
          expect(x.largura).toBeGreaterThan(0)
          fim += x.largura
        }
        expect(fim).toBe(ns.reduce((a, b) => a + b, 0))
      }),
    )
  })
})

describe('contadores do menu (T4, renderNav L1247-1248)', () => {
  it('tarefas vencidas: de todo mundo para quem administra, só as próprias para os demais', () => {
    const tarefas = [tarefa('2026-11-01', 'eu'), tarefa('2026-11-01', 'outra'), tarefa(HOJE, 'eu')]
    expect(contadoresDoMenu({ tarefas, eu: 'eu', veTodas: false, sinais: [] }, HOJE).tarefasVencidas).toBe(1)
    expect(contadoresDoMenu({ tarefas, eu: 'eu', veTodas: true, sinais: [] }, HOJE).tarefasVencidas).toBe(2)
  })

  it('contatos "agora" da prospecção; "hoje" e "semana" não contam', () => {
    const c = contadoresDoMenu({ tarefas: [], eu: 'eu', veTodas: false, sinais: ['agora', 'hoje', 'agora', 'semana', null] }, HOJE)
    expect(c.contatosAgora).toBe(2)
  })
})
