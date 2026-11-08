import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type ItemParaAplicar,
  type PessoaDaEquipe,
  chaveDoModelo,
  faltasDaEntrada,
  progressoDoChecklist,
  quemExecutaItem,
  semanaDaCarga,
  tarefasDoChecklist,
} from './checklists-carteira'
import { somarDias } from './relogio'

const equipe: PessoaDaEquipe[] = [
  { id: 'dir', ativo: true, diretoria: true, setor: null },
  { id: 'com', ativo: true, diretoria: false, setor: 'comercial' },
  { id: 'adm-inativa', ativo: false, diretoria: false, setor: 'administrativo' },
  { id: 'resp', ativo: true, diretoria: false, setor: null },
]

describe('chaveDoModelo (L564)', () => {
  it('produto e frente têm precedência sobre o geral do produto', () => {
    const chaves = ['Acelerador FIR', 'Acelerador FIR · Comercial']
    expect(chaveDoModelo('Acelerador FIR', 'Comercial', chaves)).toBe('Acelerador FIR · Comercial')
    expect(chaveDoModelo('Acelerador FIR', 'Financeiro', chaves)).toBe('Acelerador FIR')
    expect(chaveDoModelo('Acelerador FIR', null, chaves)).toBe('Acelerador FIR')
    expect(chaveDoModelo('Projeto', null, chaves)).toBe('Projeto')
  })
})

describe('quemExecutaItem (L918–923)', () => {
  it('responsável pela carteira, quando ativo', () => {
    expect(quemExecutaItem('responsavel', 'resp', equipe, 'ator')).toBe('resp')
  })
  it('responsável ausente ou inativo cai na diretoria, depois em quem aplicou', () => {
    expect(quemExecutaItem('responsavel', null, equipe, 'ator')).toBe('dir')
    expect(quemExecutaItem('responsavel', 'adm-inativa', equipe, 'ator')).toBe('dir')
    expect(quemExecutaItem('responsavel', null, [], 'ator')).toBe('ator')
  })
  it('diretoria vai à primeira pessoa ativa da diretoria', () => {
    expect(quemExecutaItem('admin', 'resp', equipe, 'ator')).toBe('dir')
  })
  it('setor vai à primeira pessoa ATIVA do setor; sem ninguém, ao responsável', () => {
    expect(quemExecutaItem('comercial', 'resp', equipe, 'ator')).toBe('com')
    expect(quemExecutaItem('administrativo', 'resp', equipe, 'ator')).toBe('resp')
    expect(quemExecutaItem('financeiro', null, equipe, 'ator')).toBe('dir')
  })
  it('PROPRIEDADE: o escolhido é sempre alguém ativo da equipe ou quem aplicou — nunca um inativo', () => {
    const pessoa = fc.record({
      id: fc.constantFrom('a', 'b', 'c', 'd'),
      ativo: fc.boolean(),
      diretoria: fc.boolean(),
      setor: fc.constantFrom(null, 'comercial', 'administrativo', 'financeiro'),
    })
    fc.assert(
      fc.property(
        fc.array(pessoa, { maxLength: 6 }),
        fc.constantFrom('responsavel', 'admin', 'comercial', 'administrativo', 'financeiro'),
        fc.constantFrom(null, 'a', 'b', 'x'),
        (eq, quem, resp) => {
          const id = quemExecutaItem(quem as never, resp, eq as PessoaDaEquipe[], 'ator')
          const ativos = new Set(eq.filter((p) => p.ativo).map((p) => p.id))
          expect(id === 'ator' || ativos.has(id)).toBe(true)
        },
      ),
    )
  })
})

const itens: ItemParaAplicar[] = [
  { id: 'i1', dias: 0, titulo: 'Conferir contrato', quem: 'admin', acao: null, ordem: 1 },
  { id: 'i2', dias: 7, titulo: 'Diagnóstico', quem: 'responsavel', acao: 'diagnostico', ordem: 2 },
  { id: 'i3', dias: 30, titulo: 'Relatório', quem: 'comercial', acao: null, ordem: 3 },
]

describe('tarefasDoChecklist (L924–931, L1739–1740)', () => {
  it('prazo = início + D+N; cliente nova nada entra feito', () => {
    const t = tarefasDoChecklist(itens, {
      inicio: '2026-11-08',
      hoje: '2026-11-08',
      marcarVencidosComoFeitos: false,
      responsavelId: 'resp',
      equipe,
      atorId: 'ator',
    })
    expect(t.map((x) => [x.itemId, x.prazo, x.responsavelId, x.entraFeito])).toEqual([
      ['i1', '2026-11-08', 'dir', false],
      ['i2', '2026-11-15', 'resp', false],
      ['i3', '2026-12-08', 'com', false],
    ])
  })
  it('cliente que já era da Firmare: prazo ANTES de hoje entra feito; o de hoje não', () => {
    const t = tarefasDoChecklist(itens, {
      inicio: '2026-10-09',
      hoje: '2026-11-08',
      marcarVencidosComoFeitos: true,
      responsavelId: 'resp',
      equipe,
      atorId: 'ator',
    })
    // i1 = 09/10 (passou), i2 = 16/10 (passou), i3 = 08/11 (hoje — pela frente).
    expect(t.map((x) => x.entraFeito)).toEqual([true, true, false])
  })
})

describe('progressoDoChecklist (V3, L2613–2619)', () => {
  it('conta concluídos, atrasados e o próximo aberto por prazo', () => {
    const p = progressoDoChecklist(
      [
        { id: 'a', titulo: 'A', prazo: '2026-11-01', status: 'concluida', responsavelId: 'x' },
        { id: 'b', titulo: 'B', prazo: '2026-11-05', status: 'pendente', responsavelId: 'y' },
        { id: 'c', titulo: 'C', prazo: '2026-11-03', status: 'pendente', responsavelId: 'z' },
        { id: 'd', titulo: 'D', prazo: '2026-11-20', status: 'pendente', responsavelId: 'z' },
        { id: 'e', titulo: 'E', prazo: '2026-11-02', status: 'cancelada', responsavelId: 'z' },
      ],
      '2026-11-08',
    )
    expect(p).toEqual({ total: 4, concluidos: 1, atrasados: 2, proximoId: 'c' })
  })
  it('PROPRIEDADE: concluídos + atrasados <= total, e o próximo é aberto', () => {
    const t = fc.record({
      id: fc.uuid(),
      titulo: fc.constant('x'),
      prazo: fc.integer({ min: -30, max: 30 }).map((n) => somarDias('2026-11-08', n)),
      status: fc.constantFrom('pendente', 'concluida', 'cancelada') as fc.Arbitrary<'pendente' | 'concluida' | 'cancelada'>,
      responsavelId: fc.constant('r'),
    })
    fc.assert(
      fc.property(fc.array(t, { maxLength: 20 }), (ts) => {
        const p = progressoDoChecklist(ts, '2026-11-08')
        expect(p.concluidos + p.atrasados).toBeLessThanOrEqual(p.total)
        if (p.proximoId !== null) expect(ts.find((x) => x.id === p.proximoId)?.status).toBe('pendente')
      }),
    )
  })
})

describe('faltasDaEntrada (L1715–1721)', () => {
  const completo = {
    links: { painel: true, dashFin: true, dashInd: true, rotina: true },
    temMetasEmAndamento: true,
    recebeRelatorioSemanal: false,
    frentesSemParceiroCompleto: [],
  }
  it('cadastro completo não falta nada', () => {
    expect(faltasDaEntrada(completo)).toEqual([])
  })
  it('lista os links que faltam, metas e parceiros (só com relatório semanal)', () => {
    const f = faltasDaEntrada({
      links: { painel: false, dashFin: true, dashInd: false, rotina: true },
      temMetasEmAndamento: false,
      recebeRelatorioSemanal: true,
      frentesSemParceiroCompleto: ['comercial', 'trafego'],
    })
    expect(f).toEqual([
      { codigo: 'links', texto: 'Links: Painel do cliente, Dash de indicadores' },
      { codigo: 'metas', texto: 'Metas em andamento' },
      { codigo: 'parceiros', texto: 'Parceiros e formulários de comercial, tráfego pago' },
    ])
    expect(
      faltasDaEntrada({ ...completo, recebeRelatorioSemanal: false, frentesSemParceiroCompleto: ['comercial'] }),
    ).toEqual([])
  })
})

describe('semanaDaCarga', () => {
  it('segunda a domingo da semana de hoje', () => {
    expect(semanaDaCarga('2026-11-08')).toEqual({ inicio: '2026-11-02', fim: '2026-11-08' })
    expect(semanaDaCarga('2026-11-09')).toEqual({ inicio: '2026-11-09', fim: '2026-11-15' })
  })
})
