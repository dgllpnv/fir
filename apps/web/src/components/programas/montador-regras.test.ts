import { LIMITES_DO_PROGRAMA, LIMITES_DO_PROGRAMA_ORCADO, MoverEtapa } from '@fir/contracts'
import { describe, expect, it } from 'vitest'
import {
  comecaEmOutraData,
  estaEmOutraData,
  type ItemNoMontador,
  itensParaPrevia,
  numeroDoCampo,
  problemasDoMontador,
  removerItem,
} from './montador-regras'

const UUID = '11111111-1111-4111-8111-111111111111'
const item = (chave: string, extra: Partial<ItemNoMontador> = {}): ItemNoMontador => ({
  chave,
  procedimentoId: UUID,
  sessoes: 4,
  intervaloDias: 7,
  inicio: '',
  depoisDe: '',
  responsavelId: '',
  dose: '',
  valor: '',
  ...extra,
})
const HOJE = '2026-11-14'
const L = LIMITES_DO_PROGRAMA_ORCADO

describe('numeroDoCampo — o campo numérico nunca vira 0 nem passa do contrato', () => {
  it('vazio é 0 (a tela mostra em branco, e o envio recusa)', () => {
    expect(numeroDoCampo('', L.sessoes)).toBe(0)
    expect(numeroDoCampo('abc', L.sessoes)).toBe(0)
  })
  it('limita ao máximo do contrato e descarta fração', () => {
    expect(numeroDoCampo('104', L.sessoes)).toBe(60)
    expect(numeroDoCampo('2.7', L.sessoes)).toBe(2)
    expect(numeroDoCampo('12', L.sessoes)).toBe(12)
  })
})

describe('removerItem — o encadeamento sobrevive à renumeração', () => {
  it('depoisDe de quem sobrou aponta para a NOVA chave do mesmo item', () => {
    // i1, i2, i3 (depois de i2). Remove i1: i2 vira i1 e i3 vira i2, e o i3
    // continua depois do que era i2 — antes apontava para o i2 novo (ele mesmo).
    const r = removerItem([item('i1'), item('i2'), item('i3', { depoisDe: 'i2' })], 0)
    expect(r.map((x) => x.chave)).toEqual(['i1', 'i2'])
    expect(r[1]!.depoisDe).toBe('i1')
  })
  it('quem dependia do removido volta a começar no início do programa', () => {
    const r = removerItem([item('i1'), item('i2', { depoisDe: 'i1' })], 0)
    expect(r[0]!.depoisDe).toBe('')
  })
  it('nunca deixa a lista vazia', () => {
    expect(removerItem([item('i1')], 0)).toHaveLength(1)
  })
})

describe('a prévia usa todos os itens, não só os com procedimento', () => {
  it('"depois de outro item" com o item anterior ainda sem procedimento não é ITEM_INEXISTENTE', () => {
    const itens = [item('i1', { procedimentoId: '' }), item('i2', { depoisDe: 'i1' })]
    const p = itensParaPrevia(itens)
    expect(p.map((x) => x.chave)).toEqual(['i1', 'i2'])
    expect(p[1]!.depoisDe).toBe('i1')
  })
  it('sessões vazias na prévia contam como 1, só para não derrubar o cálculo', () => {
    expect(itensParaPrevia([item('i1', { sessoes: 0 })])[0]!.sessoes).toBe(1)
  })
})

describe('comecaEmOutraData — a tela nunca grava data que a pessoa não escolheu', () => {
  it('entra no modo com o campo vazio e um flag próprio', () => {
    expect(comecaEmOutraData()).toEqual({ inicio: '', depoisDe: '', emOutraData: true })
    expect(estaEmOutraData({ inicio: '', emOutraData: true })).toBe(true)
    expect(estaEmOutraData({ inicio: '', emOutraData: false })).toBe(false)
    expect(estaEmOutraData({ inicio: '2026-12-01' })).toBe(true)
  })
  it('o envio é bloqueado até a data ser escolhida', () => {
    const vazio = { inicio: HOJE, itens: [item('i1', comecaEmOutraData())] }
    expect(problemasDoMontador(vazio, L, HOJE)).toMatch(/escolha a data/i)
    const escolhido = { inicio: HOJE, itens: [item('i1', { ...comecaEmOutraData(), inicio: '2026-12-01' })] }
    expect(problemasDoMontador(escolhido, L, HOJE)).toBeNull()
  })
})

describe('problemasDoMontador — o que o contrato recusaria, dito antes do envio', () => {
  const ok = { inicio: HOJE, itens: [item('i1')] }
  it('estado válido não tem problema', () => {
    expect(problemasDoMontador(ok, L, HOJE)).toBeNull()
  })
  it('sessões vazias ou acima do limite', () => {
    expect(problemasDoMontador({ ...ok, itens: [item('i1', { sessoes: 0 })] }, L, HOJE)).toMatch(/sess/i)
    expect(problemasDoMontador({ ...ok, itens: [item('i1', { sessoes: 61 })] }, L, HOJE)).toMatch(/60/)
    // O limite do programa montado em Nova adesão é outro, e vem do contrato dele.
    expect(
      problemasDoMontador({ ...ok, itens: [item('i1', { sessoes: 61 })] }, LIMITES_DO_PROGRAMA, HOJE),
    ).toBeNull()
  })
  it('dose acima do limite', () => {
    expect(
      problemasDoMontador({ ...ok, itens: [item('i1', { dose: 'x'.repeat(41) })] }, L, HOJE),
    ).toMatch(/dose/i)
  })
  it('itens acima do limite', () => {
    const muitos = Array.from({ length: L.itens.max + 1 }, (_, i) => item(`i${i + 1}`))
    expect(problemasDoMontador({ ...ok, itens: muitos }, L, HOJE)).toMatch(/10/)
  })
  it('item sem procedimento', () => {
    expect(problemasDoMontador({ ...ok, itens: [item('i1', { procedimentoId: '' })] }, L, HOJE)).toMatch(
      /procedimento/i,
    )
  })
  it('data de início mais de um ano à frente', () => {
    expect(problemasDoMontador({ ...ok, itens: [item('i1', { inicio: '2027-11-15' })] }, L, HOJE)).toMatch(
      /ano/i,
    )
    expect(problemasDoMontador({ ...ok, itens: [item('i1', { inicio: '2027-11-14' })] }, L, HOJE)).toBeNull()
  })
})

describe('o que a tela manda é o que o contrato aceita', () => {
  it('um item de limite máximo, com `inicio`, passa no MoverEtapa', () => {
    const r = MoverEtapa.safeParse({
      acao: 'registrarOrcamento',
      valor: '100000',
      programa: [
        {
          chave: 'i1',
          procedimentoId: UUID,
          sessoes: L.sessoes.max,
          intervaloDias: L.intervaloDias.max,
          dose: 'x'.repeat(L.dose.max),
          inicio: '2026-12-01',
        },
      ],
    })
    expect(r.success).toBe(true)
  })
})
