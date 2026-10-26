import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { diasEntre } from './relogio'
import {
  datasDasSessoes,
  montarCronograma,
  ordenarItens,
  reprogramar,
  situacaoDoPrograma,
  type ItemParaCronograma,
  type SessaoExistente,
} from './programa'
import { ehErro, exigir } from './resultado'

const item = (
  chave: string,
  sessoes: number,
  intervaloDias: number,
  extra: Partial<ItemParaCronograma> = {},
): ItemParaCronograma => ({
  chave,
  sessoes,
  intervaloDias,
  inicio: null,
  depoisDe: null,
  ...extra,
})

/** As sessões de um item, a partir das datas, todas abertas. */
const abertas = (
  itemChave: string,
  prazos: readonly string[],
  prefixo = itemChave,
): SessaoExistente[] =>
  prazos.map((prazo, i) => ({
    tarefaId: `${prefixo}-${i + 1}`,
    itemChave,
    indice: i + 1,
    prazo,
    status: 'aberta' as const,
  }))

const com = (
  s: readonly SessaoExistente[],
  indice: number,
  status: SessaoExistente['status'],
): SessaoExistente[] => s.map((x) => (x.indice === indice ? { ...x, status } : x))

describe('montarCronograma — a agenda que o programa escreve UMA vez', () => {
  it('um item: N sessões, de intervalo em intervalo, a partir do início', () => {
    const r = exigir(montarCronograma('2026-11-02', [item('i1', 4, 7)]))
    expect(r.map((s) => s.prazo)).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
    ])
    expect(r.map((s) => s.indice)).toEqual([1, 2, 3, 4])
    expect(r.every((s) => s.total === 4)).toBe(true)
  })

  it('A ESCALADA DE DOSE: o item 2 começa UM INTERVALO depois da última do item 1', () => {
    // Tirzepatida 2,5 mg 4x semanal, depois 5 mg 4x semanal. É o exemplo do
    // MANUAL cap. 8, e é a razão de `itens[]` existir.
    const r = exigir(
      montarCronograma('2026-11-02', [item('i1', 4, 7), item('i2', 4, 7, { depoisDe: 'i1' })]),
    )
    expect(r.filter((s) => s.itemChave === 'i1').at(-1)!.prazo).toBe('2026-11-23')
    expect(r.filter((s) => s.itemChave === 'i2')[0]!.prazo).toBe('2026-11-30')
  })

  it('O INTERVALO DO ENCADEAMENTO É O DO FILHO, não o do pai', () => {
    // MEDIDO no protótipo rodando (`agendaItens`, linha 5428):
    //   `ini = addDays(out[depoisDe].at(-1), Number(it.intervaloDias) || 7)`
    // — `it` é o DEPENDENTE. Com i1 semanal e i2 mensal, i2 começa 30 dias
    // depois da última de i1, não 7. O teste da escalada acima não distingue
    // os dois, porque lá os intervalos são iguais — que é exatamente o caso
    // com que todo mundo confere.
    const r = exigir(
      montarCronograma('2026-11-02', [item('i1', 4, 7), item('i2', 3, 30, { depoisDe: 'i1' })]),
    )
    expect(r.filter((s) => s.itemChave === 'i2').map((s) => s.prazo)).toEqual([
      '2026-12-23',
      '2027-01-22',
      '2027-02-21',
    ])
  })

  it('item com data PRÓPRIA ignora o início do programa', () => {
    const r = exigir(
      montarCronograma('2026-11-02', [item('i1', 2, 30, { inicio: '2026-12-01' })]),
    )
    expect(r[0]!.prazo).toBe('2026-12-01')
  })

  it('a data PRÓPRIA vence o `depoisDe` — `inicio` é a resolução já tomada', () => {
    // O montador grava `inicio` resolvido E `depois_de` como registro de COMO
    // foi montado (a reprogramação em cascata o usa). Remontar o cronograma a
    // partir da linha gravada não pode mover a agenda de novo.
    const r = exigir(
      montarCronograma('2026-11-02', [
        item('i1', 4, 7),
        item('i2', 2, 7, { depoisDe: 'i1', inicio: '2027-03-01' }),
      ]),
    )
    expect(r.filter((s) => s.itemChave === 'i2')[0]!.prazo).toBe('2027-03-01')
  })

  it('a numeração é DENTRO do item, não do programa', () => {
    // "Aplicação 1/4 · Tirzepatida 5 mg" e não "Aplicação 5/8". É o rótulo que
    // a enfermagem lê no frasco, e contar o programa inteiro confunde a dose.
    const r = exigir(
      montarCronograma('2026-11-02', [item('i1', 4, 7), item('i2', 4, 7, { depoisDe: 'i1' })]),
    )
    expect(r.filter((s) => s.itemChave === 'i2').map((s) => s.indice)).toEqual([1, 2, 3, 4])
    expect(r.filter((s) => s.itemChave === 'i2').every((s) => s.total === 4)).toBe(true)
  })

  it('CICLO é erro de domínio, com os itens nomeados — o protótipo aceita', () => {
    const r = montarCronograma('2026-11-02', [
      item('i1', 2, 7, { depoisDe: 'i2' }),
      item('i2', 2, 7, { depoisDe: 'i1' }),
    ])
    expect(ehErro(r)).toBe(true)
    if (!ehErro(r)) return
    expect(r.erro.codigo).toBe('CICLO_NO_PROGRAMA')
    expect(r.erro.mensagem).toContain('i1')
    expect(r.erro.mensagem).toContain('i2')
  })

  it('ciclo de TRÊS itens também é recusado, e a mensagem nomeia os três', () => {
    const r = montarCronograma('2026-11-02', [
      item('i1', 1, 7, { depoisDe: 'i3' }),
      item('i2', 1, 7, { depoisDe: 'i1' }),
      item('i3', 1, 7, { depoisDe: 'i2' }),
    ])
    expect(ehErro(r)).toBe(true)
    if (!ehErro(r)) return
    expect(r.erro.codigo).toBe('CICLO_NO_PROGRAMA')
    for (const c of ['i1', 'i2', 'i3']) expect(r.erro.mensagem).toContain(c)
  })

  it('`depoisDe` órfão é erro, mesmo o contrato do épico 3 já cobrindo', () => {
    // Duas camadas de propósito: o contrato protege a ROTA, esta função protege
    // a MONTAGEM — e a montagem também é chamada pelo migrador do épico 9, que
    // não passa por contrato nenhum.
    const r = montarCronograma('2026-11-02', [item('i1', 2, 7, { depoisDe: 'ix' })])
    expect(ehErro(r)).toBe(true)
    if (!ehErro(r)) return
    expect(r.erro.codigo).toBe('ITEM_INEXISTENTE')
    expect(r.erro.mensagem).toContain('ix')
  })

  it('chave repetida é erro — duas sessões 1/4 no mesmo item são indistinguíveis', () => {
    const r = montarCronograma('2026-11-02', [item('i1', 2, 7), item('i1', 3, 7)])
    expect(ehErro(r)).toBe(true)
    if (!ehErro(r)) return
    expect(r.erro.codigo).toBe('CHAVE_REPETIDA')
  })

  it('cadeia de três itens encadeados é datada na ordem certa, venha como vier', () => {
    const r = exigir(
      montarCronograma('2026-11-02', [
        item('i3', 1, 7, { depoisDe: 'i2' }),
        item('i1', 2, 7),
        item('i2', 2, 7, { depoisDe: 'i1' }),
      ]),
    )
    expect(r.at(-1)!.itemChave).toBe('i3')
    expect(r.map((s) => s.prazo)).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ])
  })

  it('programa sem item nenhum é erro, não um cronograma vazio', () => {
    expect(ehErro(montarCronograma('2026-11-02', []))).toBe(true)
  })

  it('`ordenarItens` devolve pai antes de filho', () => {
    const ordem = exigir(
      ordenarItens([item('i3', 1, 7, { depoisDe: 'i2' }), item('i1', 1, 7), item('i2', 1, 7, { depoisDe: 'i1' })]),
    )
    expect(ordem.indexOf('i1')).toBeLessThan(ordem.indexOf('i2'))
    expect(ordem.indexOf('i2')).toBeLessThan(ordem.indexOf('i3'))
  })
})

describe('datasDasSessoes', () => {
  it('`n` datas a partir do início, de intervalo em intervalo', () => {
    expect(datasDasSessoes('2026-11-02', 3, 7)).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
    ])
  })

  it('atravessa a virada do ano sem tropeçar', () => {
    expect(datasDasSessoes('2026-12-28', 2, 7)).toEqual(['2026-12-28', '2027-01-04'])
  })
})

// -- REPROGRAMAÇÃO ---------------------------------------------------------

const I1 = abertas('i1', ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'], 's')

describe('reprogramar — e a âncora que não pode escorregar', () => {
  it('reprogramar a partir da realizada move SÓ as abertas seguintes do item', () => {
    // Série semanal 02/11..23/11. A 2ª foi realizada em 13/11 (4 dias atrasada).
    const r = exigir(
      reprogramar({
        itens: [item('i1', 4, 7)],
        sessoes: com(I1, 2, 'concluida'),
        itemChave: 'i1',
        indice: 2,
        realizadaEm: '2026-11-13',
      }),
    )
    expect(r).toEqual([
      { tarefaId: 's-3', prazo: '2026-11-20' },
      { tarefaId: 's-4', prazo: '2026-11-27' },
    ])
    // A 1ª e a 2ª NÃO aparecem: o passado não se reescreve.
  })

  it('reprogramar NÃO toca em concluída nem em cancelada posterior', () => {
    const sessoes = com(com(com(I1, 2, 'concluida'), 3, 'cancelada'), 4, 'concluida')
    const r = exigir(
      reprogramar({
        itens: [item('i1', 4, 7)],
        sessoes,
        itemChave: 'i1',
        indice: 2,
        realizadaEm: '2026-11-13',
      }),
    )
    expect(r).toEqual([])
  })

  it('reprogramar devolve SÓ o que muda — nada de lista inteira', () => {
    // Se a sessão já está na data certa, ela não entra no resultado. Senão a
    // trilha registra nove mudanças para mover três.
    const r = exigir(
      reprogramar({
        itens: [item('i1', 4, 7)],
        sessoes: com(I1, 2, 'concluida'),
        itemChave: 'i1',
        indice: 2,
        realizadaEm: '2026-11-09', // o prazo original da 2ª
      }),
    )
    expect(r).toEqual([])
  })

  it('realizada ANTES do prazo puxa as próximas para trás', () => {
    const r = exigir(
      reprogramar({
        itens: [item('i1', 4, 7)],
        sessoes: com(I1, 2, 'concluida'),
        itemChave: 'i1',
        indice: 2,
        realizadaEm: '2026-11-05',
      }),
    )
    expect(r).toEqual([
      { tarefaId: 's-3', prazo: '2026-11-12' },
      { tarefaId: 's-4', prazo: '2026-11-19' },
    ])
  })

  it('CASCATA: o item que começa depois é empurrado, se ainda não começou', () => {
    // MEDIDO no protótipo: i1 passa a terminar em 02/12 e i2 (mensal) começa
    // 30 dias depois.
    const i2 = abertas('i2', ['2026-11-30', '2026-12-30', '2027-01-29'], 'q')
    const r = exigir(
      reprogramar({
        itens: [item('i1', 4, 7), item('i2', 3, 30, { depoisDe: 'i1' })],
        sessoes: [...com(I1, 2, 'concluida'), ...i2],
        itemChave: 'i1',
        indice: 2,
        realizadaEm: '2026-11-13',
      }),
    )
    expect(r).toEqual([
      { tarefaId: 's-3', prazo: '2026-11-20' },
      { tarefaId: 's-4', prazo: '2026-11-27' },
      { tarefaId: 'q-1', prazo: '2026-12-27' },
      { tarefaId: 'q-2', prazo: '2027-01-26' },
      { tarefaId: 'q-3', prazo: '2027-02-25' },
    ])
  })

  it('CASCATA PARA: o item dependente que JÁ COMEÇOU não é empurrado', () => {
    // Uma sessão do item 2 já foi aplicada. Mover a agenda dela por causa do
    // item 1 seria reescrever o passado da paciente. MEDIDO no protótipo.
    const i2 = com(abertas('i2', ['2026-11-30', '2026-12-07', '2026-12-14'], 'q'), 1, 'concluida')
    const r = exigir(
      reprogramar({
        itens: [item('i1', 4, 7), item('i2', 3, 7, { depoisDe: 'i1' })],
        sessoes: [...com(I1, 2, 'concluida'), ...i2],
        itemChave: 'i1',
        indice: 2,
        realizadaEm: '2026-11-13',
      }),
    )
    expect(r.map((x) => x.tarefaId).some((id) => id.startsWith('q-'))).toBe(false)
  })

  it('CASCATA EM CADEIA: i3 depois de i2 depois de i1 também anda', () => {
    const i2 = abertas('i2', ['2026-11-30', '2026-12-07'], 'q')
    const i3 = abertas('i3', ['2026-12-14'], 'z')
    const r = exigir(
      reprogramar({
        itens: [
          item('i1', 4, 7),
          item('i2', 2, 7, { depoisDe: 'i1' }),
          item('i3', 1, 7, { depoisDe: 'i2' }),
        ],
        sessoes: [...com(I1, 2, 'concluida'), ...i2, ...i3],
        itemChave: 'i1',
        indice: 2,
        realizadaEm: '2026-11-13',
      }),
    )
    expect(r.find((x) => x.tarefaId === 'z-1')!.prazo).toBe('2026-12-18')
  })

  it('a sessão CANCELADA do dependente não impede a cascata, e não é movida', () => {
    const i2 = com(abertas('i2', ['2026-11-30', '2026-12-07'], 'q'), 1, 'cancelada')
    const r = exigir(
      reprogramar({
        itens: [item('i1', 4, 7), item('i2', 2, 7, { depoisDe: 'i1' })],
        sessoes: [...com(I1, 2, 'concluida'), ...i2],
        itemChave: 'i1',
        indice: 2,
        realizadaEm: '2026-11-13',
      }),
    )
    expect(r.map((x) => x.tarefaId)).toContain('q-2')
    expect(r.map((x) => x.tarefaId)).not.toContain('q-1')
  })

  it('item inexistente é erro, não silêncio', () => {
    expect(
      ehErro(
        reprogramar({
          itens: [item('i1', 4, 7)],
          sessoes: I1,
          itemChave: 'ix',
          indice: 1,
          realizadaEm: '2026-11-13',
        }),
      ),
    ).toBe(true)
  })
})

// -- SITUAÇÃO --------------------------------------------------------------

const H = '2026-11-10'

describe('situacaoDoPrograma', () => {
  const todas = (status: SessaoExistente['status'], prazos: readonly string[]) =>
    abertas('i1', prazos).map((s) => ({ ...s, status }))

  it('a situação é atrasado > hoje > emdia, e concluído só sem abertas', () => {
    expect(
      situacaoDoPrograma({
        encerrado: false,
        sessoes: todas('concluida', ['2026-11-02', '2026-11-09']),
        hojeDaClinica: H,
      }).situacao,
    ).toBe('concluido')

    expect(
      situacaoDoPrograma({
        encerrado: false,
        sessoes: abertas('i1', ['2026-11-02', '2026-11-20']),
        hojeDaClinica: H,
      }),
    ).toMatchObject({ situacao: 'atrasado', diasDeAtraso: 8 })

    expect(
      situacaoDoPrograma({
        encerrado: true,
        sessoes: abertas('i1', ['2026-11-02']),
        hojeDaClinica: H,
      }).situacao,
    ).toBe('encerrado') // encerrado vence tudo
  })

  it('sessão aberta HOJE é `hoje`, não `atrasado` nem `emdia`', () => {
    expect(
      situacaoDoPrograma({
        encerrado: false,
        sessoes: abertas('i1', [H, '2026-11-20']),
        hojeDaClinica: H,
      }),
    ).toEqual({ situacao: 'hoje', diasDeAtraso: 0 })
  })

  it('tudo no futuro é `emdia`', () => {
    expect(
      situacaoDoPrograma({
        encerrado: false,
        sessoes: abertas('i1', ['2026-11-20']),
        hojeDaClinica: H,
      }).situacao,
    ).toBe('emdia')
  })

  it('sessão CANCELADA não torna o programa concluído nem atrasado', () => {
    // `validas = status !== 'cancelada'` no protótipo. Uma sessão cancelada que
    // contasse como "em aberto" deixaria todo programa encerrado parecendo
    // ativo — e uma que contasse como "feita" daria "Programa concluído" a um
    // tratamento que ninguém fez.
    expect(
      situacaoDoPrograma({
        encerrado: false,
        sessoes: todas('cancelada', ['2026-11-02']),
        hojeDaClinica: H,
      }).situacao,
    ).not.toBe('concluido')

    expect(
      situacaoDoPrograma({
        encerrado: false,
        sessoes: todas('cancelada', ['2026-11-02']),
        hojeDaClinica: H,
      }).situacao,
    ).not.toBe('atrasado')
  })

  it('o atraso é contado da MAIS ANTIGA aberta, não da mais recente', () => {
    expect(
      situacaoDoPrograma({
        encerrado: false,
        sessoes: abertas('i1', ['2026-11-09', '2026-11-02']),
        hojeDaClinica: H,
      }).diasDeAtraso,
    ).toBe(8)
  })
})

// -- PROPRIEDADES ----------------------------------------------------------

const gDia = fc
  .date({ min: new Date('2024-01-01'), max: new Date('2032-12-31'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10))

const gItem = fc.record({
  sessoes: fc.integer({ min: 1, max: 20 }),
  intervaloDias: fc.integer({ min: 1, max: 60 }),
})

/** i2 depoisDe i1, i3 depoisDe i2… — a cadeia que o MANUAL chama de escalada. */
const encadearEmLinha = (
  itens: readonly { sessoes: number; intervaloDias: number }[],
): ItemParaCronograma[] =>
  itens.map((it, i) => item(`i${i + 1}`, it.sessoes, it.intervaloDias, i === 0 ? {} : { depoisDe: `i${i}` }))

const ultimaDe = (s: readonly { itemChave: string; prazo: string }[], chave: string) =>
  s.filter((x) => x.itemChave === chave).map((x) => x.prazo).sort().at(-1)!
const primeiraDe = (s: readonly { itemChave: string; prazo: string }[], chave: string) =>
  s.filter((x) => x.itemChave === chave).map((x) => x.prazo).sort()[0]!

describe('as propriedades do cronograma', () => {
  it('as datas são ESTRITAMENTE crescentes e espaçadas exatamente pelo intervalo', () => {
    fc.assert(
      fc.property(
        gDia,
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 1, max: 365 }),
        (inicio, n, passo) => {
          const d = datasDasSessoes(inicio, n, passo)
          expect(d).toHaveLength(n)
          for (let i = 1; i < d.length; i++) {
            expect(d[i]! > d[i - 1]!).toBe(true)
            expect(diasEntre(d[i - 1]!, d[i]!)).toBe(passo)
          }
        },
      ),
    )
  })

  it('nenhum item encadeado começa antes de o seu pai terminar', () => {
    fc.assert(
      fc.property(gDia, fc.array(gItem, { minLength: 1, maxLength: 12 }), (inicio, itens) => {
        const encadeados = encadearEmLinha(itens)
        const r = montarCronograma(inicio, encadeados)
        if (ehErro(r)) return
        for (const it of encadeados) {
          if (it.depoisDe === null) continue
          expect(primeiraDe(r.valor, it.chave) > ultimaDe(r.valor, it.depoisDe)).toBe(true)
        }
      }),
    )
  })

  it('ou o cronograma sai inteiro, ou é erro — nunca um item sem data', () => {
    // `depoisDe` sorteado entre as chaves existentes E `null`, de modo que
    // ciclo, órfão e cadeia válida apareçam todos.
    const gItens = fc
      .array(gItem, { minLength: 1, maxLength: 8 })
      .chain((base) =>
        fc.tuple(
          fc.constant(base),
          fc.array(
            fc.option(
              fc.integer({ min: 0, max: base.length - 1 }).map((i) => `i${i + 1}`),
              { nil: null },
            ),
            { minLength: base.length, maxLength: base.length },
          ),
        ),
      )
      .map(([base, pais]) =>
        base.map((b, i) =>
          item(`i${i + 1}`, b.sessoes, b.intervaloDias, {
            depoisDe: pais[i] === `i${i + 1}` ? null : (pais[i] ?? null),
          }),
        ),
      )

    fc.assert(
      fc.property(gDia, gItens, (inicio, itens) => {
        const r = montarCronograma(inicio, itens)
        if (ehErro(r)) return
        expect(r.valor).toHaveLength(itens.reduce((s, i) => s + i.sessoes, 0))
        expect(new Set(r.valor.map((s) => s.itemChave)).size).toBe(itens.length)
        // E cada item numerado de 1 ao seu total, sem buraco.
        for (const it of itens) {
          const dele = r.valor.filter((s) => s.itemChave === it.chave)
          expect(dele.map((s) => s.indice).sort((a, b) => a - b)).toEqual(
            Array.from({ length: it.sessoes }, (_, k) => k + 1),
          )
          expect(dele.every((s) => s.total === it.sessoes)).toBe(true)
        }
      }),
    )
  })
})

describe('as propriedades da reprogramação', () => {
  /** A série aberta de um item, exatamente como o cronograma a escreveu. */
  const serie = (inicio: string, n: number, passo: number) =>
    abertas('i1', datasDasSessoes(inicio, n, passo), 's')

  it('REPROGRAMAR NUNCA MOVE O PASSADO: nenhuma sessão de índice <= k entra no resultado', () => {
    fc.assert(
      fc.property(
        gDia,
        fc.integer({ min: 2, max: 20 }),
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 1, max: 20 }),
        gDia,
        (inicio, n, passo, k0, realizadaEm) => {
          const k = ((k0 - 1) % n) + 1
          const sessoes = com(serie(inicio, n, passo), k, 'concluida')
          const r = reprogramar({
            itens: [item('i1', n, passo)],
            sessoes,
            itemChave: 'i1',
            indice: k,
            realizadaEm,
          })
          if (ehErro(r)) return
          for (const m of r.valor) {
            const s = sessoes.find((x) => x.tarefaId === m.tarefaId)!
            expect(s.indice > k).toBe(true)
          }
        },
      ),
    )
  })

  it('reprogramar é IDEMPOTENTE: aplicar o resultado e reprogramar de novo não muda nada', () => {
    // Sem esta, uma implementação que ancora na sessão ANTERIOR em vez de na
    // realizada desloca a série um pouco mais a cada toque — e a enfermagem
    // descobre quando a última aplicação cai em janeiro.
    //
    // O gerador CONSTRÓI o caso que morde: a série sai do próprio
    // `datasDasSessoes`, e `realizadaEm` é o prazo da k-ésima DESLOCADO por um
    // atraso sorteado. Sorteada ao acaso, `realizadaEm` quase nunca produz a
    // sequência de arrastes que a âncora errada acumula.
    fc.assert(
      fc.property(
        gDia,
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: -30, max: 30 }),
        (inicio, n, passo, k0, atraso) => {
          const k = ((k0 - 1) % n) + 1
          const base = serie(inicio, n, passo)
          const sessoes = com(base, k, 'concluida')
          const realizadaEm = diasDepois(base[k - 1]!.prazo, atraso)
          const entrada = { itens: [item('i1', n, passo)], sessoes, itemChave: 'i1', indice: k, realizadaEm }

          const um = exigir(reprogramar(entrada))
          const aplicadas = sessoes.map((s) => {
            const m = um.find((x) => x.tarefaId === s.tarefaId)
            return m === undefined ? s : { ...s, prazo: m.prazo }
          })
          expect(exigir(reprogramar({ ...entrada, sessoes: aplicadas }))).toEqual([])
        },
      ),
    )
  })

  it('a cascata também é idempotente — e ela é a que acumula erro', () => {
    fc.assert(
      fc.property(
        gDia,
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: -20, max: 20 }),
        (inicio, n, passo, n2, passo2, atraso) => {
          const i1 = serie(inicio, n, passo)
          const inicio2 = diasDepois(i1.at(-1)!.prazo, passo2)
          const i2 = abertas('i2', datasDasSessoes(inicio2, n2, passo2), 'q')
          const itens = [item('i1', n, passo), item('i2', n2, passo2, { depoisDe: 'i1' })]
          const sessoes = [...com(i1, 1, 'concluida'), ...i2]
          const entrada = {
            itens,
            sessoes,
            itemChave: 'i1',
            indice: 1,
            realizadaEm: diasDepois(i1[0]!.prazo, atraso),
          }
          const um = exigir(reprogramar(entrada))
          const aplicadas = sessoes.map((s) => {
            const m = um.find((x) => x.tarefaId === s.tarefaId)
            return m === undefined ? s : { ...s, prazo: m.prazo }
          })
          expect(exigir(reprogramar({ ...entrada, sessoes: aplicadas }))).toEqual([])
        },
      ),
    )
  })
})

// `somarDias` com nome local, para o teste não depender da ordem de import.
function diasDepois(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  const t = new Date(Date.UTC(a!, m! - 1, d! + n))
  const dois = (x: number) => String(x).padStart(2, '0')
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`
}
