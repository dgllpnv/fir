import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { CelulaDeCampanha } from './campanhas-carteira'
import { Dinheiro } from './dinheiro'
import { somarDias } from './relogio'
import {
  type AcaoNoResumo,
  type ClienteNoResumo,
  type EntradaDoResumoSemanal,
  montarResumoSemanal,
  semanaDoResumo,
} from './resumo-semanal-carteira'

const diaDaSemana = (dia: string): number => {
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(a!, m! - 1, d!)).getUTCDay()
}

const cliente = (id: string, nome: string, extra: Partial<ClienteNoResumo> = {}): ClienteNoResumo => ({
  id,
  nome,
  ativo: true,
  saude: 'bom',
  mensalidade: Dinheiro.zero(),
  ultimaReuniao: null,
  ...extra,
})

const celula = (extra: Partial<CelulaDeCampanha> & Pick<CelulaDeCampanha, 'id' | 'clienteId'>): CelulaDeCampanha => ({
  campanhaChave: extra.id,
  nome: 'Aniversariantes',
  tipo: 'Aniversariantes',
  mes: '2026-11-01',
  status: 'ativa',
  receita: null,
  investimento: null,
  orcamentosPagos: 9,
  exigeContagem: true,
  resultado: 12n,
  meta: 20n,
  resultadoEmDinheiro: false,
  ...extra,
})

const base = (extra: Partial<EntradaDoResumoSemanal> = {}): EntradaDoResumoSemanal => ({
  hoje: '2026-11-05',
  podeVerValores: true,
  clientes: [],
  acoes: [],
  campanhas: [],
  equipe: [],
  ...extra,
})

describe('semanaDoResumo', () => {
  it('a semana do cabeçalho é [segunda, segunda+7) e contém hoje (property)', () => {
    const dia = fc
      .date({ min: new Date(Date.UTC(2000, 0, 1)), max: new Date(Date.UTC(2100, 11, 31)), noInvalidDate: true })
      .map((d) => d.toISOString().slice(0, 10))
    fc.assert(
      fc.property(dia, (hoje) => {
        const s = semanaDoResumo(hoje)
        expect(diaDaSemana(s.inicio)).toBe(1)
        expect(s.inicio <= hoje).toBe(true)
        expect(hoje < s.fimExclusivo).toBe(true)
        expect(s.fimExclusivo).toBe(somarDias(s.inicio, 7))
        expect(s.ultimoDia).toBe(somarDias(s.inicio, 6))
      }),
    )
  })

  it('domingo pertence à semana que começou na segunda anterior', () => {
    expect(semanaDoResumo('2026-11-08')).toEqual({ inicio: '2026-11-02', ultimoDia: '2026-11-08', fimExclusivo: '2026-11-09' })
    expect(semanaDoResumo('2026-11-09').inicio).toBe('2026-11-09')
  })
})

describe('montarResumoSemanal — o texto do protótipo (L2004-2020)', () => {
  it('monta as seções na ordem do protótipo', () => {
    const r = montarResumoSemanal(
      base({
        clientes: [
          cliente('a', 'Clínica Sol', { saude: 'critico', mensalidade: Dinheiro.deCentavos(150000n), ultimaReuniao: { resumo: 'Agenda vazia.', encaminhamentos: 'Rever preços' } }),
          cliente('b', 'Clínica Lua', { saude: 'bom', mensalidade: Dinheiro.deCentavos(99999n) }),
          cliente('c', 'Clínica Mar', { saude: 'atencao' }),
        ],
        acoes: [
          { clienteId: 'a', status: 'pendente', prazo: '2026-11-01', concluidaNoDia: null },
          { clienteId: 'a', status: 'pendente', prazo: '2026-11-03', concluidaNoDia: null },
          { clienteId: 'b', status: 'concluida', prazo: null, concluidaNoDia: '2026-11-02' },
        ],
        campanhas: [{ celula: celula({ id: 'k', clienteId: 'b' }), rotuloDaMetrica: 'Convertidos' }],
        equipe: [
          { nome: 'Manu', prazosPendentes: ['2026-11-01', '2026-11-20'] },
          { nome: 'Bia', prazosPendentes: [] },
        ],
      }),
    )
    expect(r.texto).toBe(
      [
        'RESUMO SEMANAL · semana de 02/11 a 08/11',
        '',
        'CARTEIRA',
        '3 clientes ativos: 1 em bom, 1 em atenção, 1 crítico.',
        'Receita recorrente mensal: R$ 2.499,99.',
        '',
        'EM RISCO',
        '• Clínica Sol (crítico): Agenda vazia. 2 ações atrasadas. Encaminhamento: Rever preços',
        '• Clínica Mar (atenção): sem reunião registrada. Encaminhamento: a definir',
        '',
        'PLANO DE AÇÃO',
        'Foi concluída 1 ação nesta semana. Permanecem 2 ações atrasadas, concentradas em: Clínica Sol.',
        '',
        'CAMPANHAS ATIVAS',
        '• Clínica Lua · Aniversariantes: 12 de 20 convertidos (60%)',
        '',
        'EQUIPE',
        '• Manu: 2 tarefas pendentes, 1 vencida.',
        '• Bia: 0 tarefas pendentes, nenhuma vencida.',
        '',
        'PRIORIDADE DA SEMANA',
        'Atuar nos clientes em risco (Clínica Sol, Clínica Mar) e zerar as ações e tarefas atrasadas.',
      ].join('\n'),
    )
    expect(r.atasCitadas).toEqual(['a'])
  })

  it('sem risco, sem atraso e sem campanha: as frases curtas do protótipo', () => {
    const r = montarResumoSemanal(base({ clientes: [cliente('a', 'Sol')] }))
    expect(r.texto).toContain('EM RISCO\nNenhum cliente em risco.')
    expect(r.texto).toContain('Permanecem 0 ações atrasadas.')
    expect(r.texto).not.toContain('CAMPANHAS ATIVAS')
    expect(r.texto).toContain('PRIORIDADE DA SEMANA\nZerar as ações e tarefas atrasadas.')
  })

  it('cliente sem saúde registrada é contado à parte e não entra em risco', () => {
    const r = montarResumoSemanal(base({ clientes: [cliente('a', 'Sol', { saude: null }), cliente('b', 'Lua')] }))
    expect(r.texto).toContain('2 clientes ativos: 1 em bom, 0 em atenção, 0 críticos, 1 sem saúde registrada.')
    expect(r.texto).toContain('Nenhum cliente em risco.')
  })

  it('cliente pausado não entra na carteira nem no risco, mas a ação atrasada dele conta', () => {
    const r = montarResumoSemanal(
      base({
        clientes: [cliente('p', 'Pausada', { ativo: false, saude: 'critico' })],
        acoes: [{ clienteId: 'p', status: 'em_andamento', prazo: '2026-11-01', concluidaNoDia: null }],
      }),
    )
    expect(r.texto).toContain('0 clientes ativos')
    expect(r.texto).toContain('Nenhum cliente em risco.')
    expect(r.texto).toContain('Permanece 1 ação atrasada, concentrada em: Pausada.')
  })

  it('um escopo só (ajuste 35): ação e campanha de cliente fora da entrada não entram', () => {
    const r = montarResumoSemanal(
      base({
        clientes: [cliente('a', 'Sol')],
        acoes: [{ clienteId: 'fora', status: 'pendente', prazo: '2026-01-01', concluidaNoDia: null }],
        campanhas: [{ celula: celula({ id: 'k', clienteId: 'fora' }), rotuloDaMetrica: 'Convertidos' }],
      }),
    )
    expect(r.texto).toContain('Permanecem 0 ações atrasadas.')
    expect(r.texto).not.toContain('CAMPANHAS ATIVAS')
  })

  it('campanha suprimida (k = 5) não aparece pelo nome; só a contagem', () => {
    const r = montarResumoSemanal(
      base({
        clientes: [cliente('a', 'Sol')],
        campanhas: [
          { celula: celula({ id: 'k1', clienteId: 'a', nome: 'Secreta', orcamentosPagos: 2 }), rotuloDaMetrica: 'Convertidos' },
          { celula: celula({ id: 'k2', clienteId: 'a', nome: 'Visível' }), rotuloDaMetrica: 'Convertidos' },
        ],
      }),
    )
    expect(r.texto).not.toContain('Secreta')
    expect(r.texto).toContain('• Sol · Visível: 12 de 20 convertidos (60%)')
    expect(r.texto).toContain('• Mais 1 campanha ativa sem detalhe (poucos pagamentos para exibir).')
  })

  it('a mesma campanha em vários meses aparece uma vez, pela célula mais recente', () => {
    const r = montarResumoSemanal(
      base({
        clientes: [cliente('a', 'Sol')],
        campanhas: [
          { celula: celula({ id: 'out', clienteId: 'a', campanhaChave: 'X', mes: '2026-10-01', resultado: 3n }), rotuloDaMetrica: 'Convertidos' },
          { celula: celula({ id: 'nov', clienteId: 'a', campanhaChave: 'X', mes: '2026-11-01', resultado: 15n }), rotuloDaMetrica: 'Convertidos' },
        ],
      }),
    )
    expect(r.texto.match(/Aniversariantes/g)?.length).toBe(1)
    expect(r.texto).toContain('15 de 20')
  })

  it('campanha sem rótulo de métrica (o padrão da coluna é vazio) não deixa espaço sobrando', () => {
    const r = montarResumoSemanal(
      base({ clientes: [cliente('a', 'Sol')], campanhas: [{ celula: celula({ id: 'k', clienteId: 'a' }), rotuloDaMetrica: '' }] }),
    )
    expect(r.texto).toContain('• Sol · Aniversariantes: 12 de 20 (60%)')
    const sem = montarResumoSemanal(
      base({
        podeVerValores: false,
        clientes: [cliente('a', 'Sol')],
        campanhas: [{ celula: celula({ id: 'k', clienteId: 'a', resultadoEmDinheiro: true }), rotuloDaMetrica: '' }],
      }),
    )
    expect(sem.texto).toContain('• Sol · Aniversariantes: 60% da meta\n')
  })

  it('campanha de receita com `valores` sai pelo formatador central; sem `valores`, só o percentual', () => {
    const camp = {
      celula: celula({ id: 'r', clienteId: 'a', nome: 'Botox', resultadoEmDinheiro: true, resultado: 123456n, meta: 200000n }),
      rotuloDaMetrica: 'Receita',
    }
    const com = montarResumoSemanal(base({ clientes: [cliente('a', 'Sol')], campanhas: [camp] }))
    expect(com.texto).toContain('• Sol · Botox: R$ 1.234,56 de R$ 2.000,00 receita (62%)')
    const sem = montarResumoSemanal(base({ podeVerValores: false, clientes: [cliente('a', 'Sol')], campanhas: [camp] }))
    expect(sem.texto).toContain('• Sol · Botox: 62% da meta de receita')
    expect(sem.texto).not.toContain('1.234')
    expect(sem.texto).not.toContain('123456')
  })
})

// ---------------------------------------------------------------------------
// Property-based: dinheiro, contagens e janela
// ---------------------------------------------------------------------------

const centavos = fc.bigInt({ min: 0n, max: 10_000_000_00n })
const saude = fc.constantFrom('bom' as const, 'atencao' as const, 'critico' as const, null)
const diaPerto = fc.integer({ min: -20, max: 20 }).map((n) => somarDias('2026-11-05', n))

const clientesArb = fc
  .array(fc.record({ saude, mensalidade: centavos, ativo: fc.boolean() }), { maxLength: 15 })
  .map((xs) => xs.map((x, i) => cliente(`c${i}`, `Cliente ${i}`, { saude: x.saude, mensalidade: Dinheiro.deCentavos(x.mensalidade), ativo: x.ativo })))

const acoesArb = (n: number) =>
  fc.array(
    fc.record({
      i: fc.integer({ min: 0, max: Math.max(0, n - 1) }),
      status: fc.constantFrom('pendente' as const, 'em_andamento' as const, 'concluida' as const, 'cancelada' as const),
      prazo: fc.option(diaPerto, { nil: null }),
      dia: diaPerto,
    }),
    { maxLength: 30 },
  )

describe('montarResumoSemanal — propriedades', () => {
  it('MRR = Σ mensalidades dos ativos, pelo value object e pelo formatador central', () => {
    fc.assert(
      fc.property(clientesArb, (clientes) => {
        const r = montarResumoSemanal(base({ clientes }))
        const soma = clientes.filter((c) => c.ativo).reduce((s, c) => s.mais(c.mensalidade), Dinheiro.zero())
        expect(r.texto).toContain(`Receita recorrente mensal: ${soma.formatar()}.`)
      }),
    )
  })

  it('sem `valores`: nenhum "R$" e nenhum valor monetário da entrada no texto (gate T-20)', () => {
    const arb = fc.tuple(clientesArb, fc.array(fc.record({ r: fc.bigInt({ min: 100_000n, max: 10_000_000_00n }), m: fc.bigInt({ min: 100_000n, max: 10_000_000_00n }) }), { maxLength: 5 }))
    fc.assert(
      fc.property(arb, ([clientes0, camps]) => {
        const clientes = clientes0.length === 0 ? [cliente('c0', 'Cliente 0')] : clientes0
        const campanhas = camps.map((x, i) => ({
          celula: celula({ id: `k${i}`, clienteId: clientes[0]!.id, resultadoEmDinheiro: true, resultado: x.r, meta: x.m }),
          rotuloDaMetrica: 'Receita',
        }))
        const r = montarResumoSemanal(base({ podeVerValores: false, clientes, campanhas }))
        expect(r.texto).not.toContain('R$')
        const monetarios = [
          ...clientes.map((c) => c.mensalidade.centavos),
          clientes.filter((c) => c.ativo).reduce((s, c) => s.mais(c.mensalidade), Dinheiro.zero()).centavos,
          ...camps.flatMap((x) => [x.r, x.m]),
        ].filter((v) => v >= 100_000n)
        // O percentual da meta ATRAVESSA (regra 17): "1000000% da meta" contém "100000" por
        // coincidência de algarismos, não por vazamento. Tira os percentuais antes de procurar.
        const semPercentuais = r.texto.replace(/[\d.,]+\s?%/g, '')
        for (const v of monetarios) {
          expect(semPercentuais).not.toContain(Dinheiro.deCentavos(v).formatar().replace('R$ ', ''))
          expect(semPercentuais).not.toContain(v.toString())
        }
      }),
      // A semente que achou o falso positivo (999999500 / 100000 → "1000000%") roda sempre.
      { examples: [[[[], [{ r: 999_999_500n, m: 100_000n }]]]] },
    )
  })

  it('bom + atenção + crítico + sem registro = ativos; risco = atenção + crítico', () => {
    fc.assert(
      fc.property(clientesArb, (clientes) => {
        const r = montarResumoSemanal(base({ clientes }))
        const ativos = clientes.filter((c) => c.ativo)
        const m = /(\d+) clientes? ativos?: (\d+) em bom, (\d+) em atenção, (\d+) críticos?(?:, (\d+) sem saúde registrada)?\./.exec(r.texto)!
        const [n, b, a, c, s] = [m[1], m[2], m[3], m[4], m[5] ?? '0'].map(Number)
        expect(n).toBe(ativos.length)
        expect(b! + a! + c! + s!).toBe(n)
        const risco = ativos.filter((x) => x.saude === 'atencao' || x.saude === 'critico').length
        expect((r.texto.split('EM RISCO\n')[1]!.split('\n\n')[0]!.match(/^• /gm) ?? []).length).toBe(risco)
      }),
    )
  })

  it('concluídas contam só a semana do cabeçalho; o resultado não depende da ordem', () => {
    fc.assert(
      fc.property(
        clientesArb.chain((cs) => fc.tuple(fc.constant(cs.length === 0 ? [cliente('c0', 'Cliente 0')] : cs), acoesArb(Math.max(1, cs.length)))),
        ([clientes, brutas]) => {
          const acoes: AcaoNoResumo[] = brutas.map((x) => ({
            clienteId: clientes[Math.min(x.i, clientes.length - 1)]!.id,
            status: x.status,
            prazo: x.prazo,
            concluidaNoDia: x.status === 'concluida' ? x.dia : null,
          }))
          const s = semanaDoResumo('2026-11-05')
          const esperadas = acoes.filter((a) => a.concluidaNoDia !== null && a.concluidaNoDia >= s.inicio && a.concluidaNoDia < s.fimExclusivo).length
          const atrasadas = acoes.filter((a) => a.status !== 'concluida' && a.status !== 'cancelada' && a.prazo !== null && a.prazo < '2026-11-05').length
          const r1 = montarResumoSemanal(base({ clientes, acoes }))
          const r2 = montarResumoSemanal(base({ clientes, acoes: [...acoes].reverse() }))
          expect(r1.texto).toContain(`${esperadas === 1 ? 'Foi concluída 1 ação' : `Foram concluídas ${esperadas} ações`} nesta semana.`)
          expect(r1.texto).toContain(atrasadas === 1 ? 'Permanece 1 ação atrasada' : `Permanecem ${atrasadas} ações atrasadas`)
          expect(r2.texto.split('PLANO DE AÇÃO')[1]!.split('\n')[1]!.split(',')[0]).toBe(r1.texto.split('PLANO DE AÇÃO')[1]!.split('\n')[1]!.split(',')[0])
        },
      ),
    )
  })
})
