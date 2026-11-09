import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from './dinheiro'
import {
  ACOES_DO_FUNIL,
  corrigirOrcamento,
  type EventoDeJornada,
  orcadoNaJanela,
  orcamentoVigente,
  type PedidoDeCorrecao,
  programaCabeNoOrcamento,
  TETO_DO_ORCAMENTO,
  transicao,
  type TarefaParaCorrigir,
} from './jornada'
import { ehErro, ehOk, exigir, type Result } from './resultado'

/**
 * CORRIGIR O ORÇAMENTO JÁ ENVIADO (B1, gates S-24..S-30 e N-13..N-18).
 *
 * A correção ACRESCENTA um evento `corrigirOrcamento`; o `registrarOrcamento`
 * original fica byte a byte igual. O "R$ orçado" de uma janela é o valor
 * VIGENTE NO FIM DA JANELA (N-14, leitura b): mês fechado nunca muda.
 */

const SOLICITANTE = 'p-sol'
const RESPONSAVEL = 'p-resp'
const ESTRANHA = 'p-estranha'
const HOJE = '2026-11-05'
const AGORA = new Date('2026-11-05T15:00:00.000Z')
const CHAVE = '11111111-1111-4111-8111-111111111111'

const registro = (valor: string, em = '2026-10-15T15:00:00.000Z', nota?: string): EventoDeJornada => ({
  acao: 'registrarOrcamento',
  etapa: 'orcamento',
  em,
  porId: RESPONSAVEL,
  valor,
  ...(nota === undefined ? {} : { nota }),
})

const cartao = (extra: Partial<TarefaParaCorrigir> = {}): TarefaParaCorrigir => ({
  etapa: 'orcamento',
  status: 'concluida',
  solicitanteId: SOLICITANTE,
  responsavelId: RESPONSAVEL,
  historico: [registro('300000', undefined, 'programa Tirzepatida')],
  valorOrcamento: 300000n,
  proximoPassoEm: '2026-10-17',
  programaOrcado: null,
  ...extra,
})

const pedido = (extra: Partial<PedidoDeCorrecao> = {}): PedidoDeCorrecao => ({
  chaveIdempotencia: CHAVE,
  ...extra,
})

const corrigir = (
  t: TarefaParaCorrigir,
  p: PedidoDeCorrecao,
  quem: { id?: string; podeEquipe?: boolean; podeVerValores?: boolean } = {},
) =>
  corrigirOrcamento({
    tarefa: t,
    autor: { id: quem.id ?? RESPONSAVEL, podeEquipe: quem.podeEquipe ?? false },
    podeVerValores: quem.podeVerValores ?? true,
    pedido: p,
    hoje: HOJE,
    agora: AGORA,
  })

const codigoDe = (r: Result<unknown>): string => (ehErro(r) ? r.erro.codigo : 'OK')

/* ------------------------------------------------------------- a máquina */

describe('corrigirOrcamento na tabela de transições', () => {
  it('só sai de `orcamento`, e para `orcamento` — a etapa NÃO muda', () => {
    const r = exigir(transicao({ etapa: 'orcamento', status: 'concluida', historico: [] }, 'corrigirOrcamento'))
    expect(r).toEqual({ etapa: 'orcamento', status: 'concluida', contaNoFunil: false })
  })

  it('NÃO conta no funil: dobraria "enviados" no funil, no Painel e na carteira (N-13)', () => {
    expect(ACOES_DO_FUNIL).not.toContain('corrigirOrcamento')
  })

  it('realizado, fechado, perdido, agendado e encerrado recusam a correção', () => {
    for (const etapa of ['realizado', 'fechado', 'perdido'] as const) {
      expect(codigoDe(corrigir(cartao({ etapa, status: 'concluida' }), pedido({ valor: 30000n }))), etapa).toBe(
        'TRANSICAO_INVALIDA',
      )
    }
    expect(codigoDe(corrigir(cartao({ etapa: 'agendado', status: 'aberta' }), pedido({ valor: 30000n })))).toBe(
      'TRANSICAO_INVALIDA',
    )
    expect(
      codigoDe(corrigir(cartao({ etapa: 'encerrado', status: 'cancelada' }), pedido({ valor: 30000n }))),
    ).toBe('TRANSICAO_INVALIDA')
  })
})

/* ------------------------------------------------------------ quem corrige */

describe('quem corrige: `podeEditar` da tarefa (S-24)', () => {
  it('solicitante, responsável e quem acompanha a equipe corrigem', () => {
    expect(ehOk(corrigir(cartao(), pedido({ valor: 30000n }), { id: SOLICITANTE }))).toBe(true)
    expect(ehOk(corrigir(cartao(), pedido({ valor: 30000n }), { id: RESPONSAVEL }))).toBe(true)
    expect(ehOk(corrigir(cartao(), pedido({ valor: 30000n }), { id: ESTRANHA, podeEquipe: true }))).toBe(true)
  })

  it('quem não pediu, não executa e não acompanha a equipe NÃO corrige', () => {
    expect(codigoDe(corrigir(cartao(), pedido({ valor: 30000n }), { id: ESTRANHA }))).toBe(
      'SEM_ACESSO_A_TAREFA',
    )
  })

  it('a autorização vem ANTES do estado: quem não pode não fica sabendo a etapa', () => {
    const fechado = cartao({ etapa: 'fechado' })
    expect(codigoDe(corrigir(fechado, pedido({ valor: 30000n }), { id: ESTRANHA }))).toBe(
      'SEM_ACESSO_A_TAREFA',
    )
  })
})

/* --------------------------------------------------------- append-only */

describe('a correção é um evento NOVO — o original não se reescreve (N-13, S-26)', () => {
  it('devolve o evento com de → para dos três campos, e nunca toca o original', () => {
    const t = cartao()
    const antes = structuredClone(t.historico)
    const r = exigir(corrigir(t, pedido({ valor: 30000n, retomarEm: '2026-11-10', nota: 'corrigido' })))
    expect(r.tipo).toBe('corrigir')
    if (r.tipo !== 'corrigir') return
    expect(r.evento).toEqual({
      acao: 'corrigirOrcamento',
      etapa: 'orcamento',
      em: AGORA.toISOString(),
      porId: RESPONSAVEL,
      chaveIdempotencia: CHAVE,
      de: { valor: '300000', retomarEm: '2026-10-17', nota: 'programa Tirzepatida' },
      para: { valor: '30000', retomarEm: '2026-11-10', nota: 'corrigido' },
    })
    // O dinheiro mora SÓ dentro de `de`/`para`, chaves que a redação conhece
    // (`valor`, em qualquer profundidade). Nada de `valor` no topo: o funil
    // somaria o evento de correção como um segundo orçamento.
    expect(r.evento).not.toHaveProperty('valor')
    expect(r.evento).not.toHaveProperty('nota')
    expect(r.valorOrcamento).toBe(30000n)
    expect(r.proximoPassoEm).toBe('2026-11-10')
    expect(t.historico).toEqual(antes)
  })

  it('o que não veio no pedido é MANTIDO, não apagado', () => {
    const r = exigir(corrigir(cartao(), pedido({ retomarEm: '2026-11-12' })))
    if (r.tipo !== 'corrigir') throw new Error('esperava correção')
    expect(r.evento.para).toEqual({ valor: '300000', retomarEm: '2026-11-12', nota: 'programa Tirzepatida' })
    expect(r.valorOrcamento).toBe(300000n)
  })

  it('nota vazia LIMPA a nota; nota ausente a mantém', () => {
    const r = exigir(corrigir(cartao(), pedido({ nota: '' })))
    if (r.tipo !== 'corrigir') throw new Error('esperava correção')
    expect(r.evento.para?.nota).toBeNull()
  })

  it('a segunda correção parte do que a primeira deixou', () => {
    const primeira = exigir(corrigir(cartao(), pedido({ valor: 30000n })))
    if (primeira.tipo !== 'corrigir') throw new Error('esperava correção')
    const t2 = cartao({
      historico: [...cartao().historico, primeira.evento],
      valorOrcamento: primeira.valorOrcamento,
    })
    const segunda = exigir(
      corrigir(t2, pedido({ chaveIdempotencia: '22222222-2222-4222-8222-222222222222', nota: 'outra' })),
    )
    if (segunda.tipo !== 'corrigir') throw new Error('esperava correção')
    expect(segunda.evento.de).toEqual({ valor: '30000', retomarEm: '2026-10-17', nota: 'programa Tirzepatida' })
    expect(segunda.evento.para).toEqual({ valor: '30000', retomarEm: '2026-10-17', nota: 'outra' })
  })
})

/* ------------------------------------------------- idempotência e oráculo */

describe('repetir não duplica, e a resposta não vira oráculo (S-28, AB-B1-5, AB-B1-6)', () => {
  it('a MESMA chave de envio já aplicada é um nada — um evento só', () => {
    const primeira = exigir(corrigir(cartao(), pedido({ valor: 30000n })))
    if (primeira.tipo !== 'corrigir') throw new Error('esperava correção')
    const t2 = cartao({ historico: [...cartao().historico, primeira.evento], valorOrcamento: 30000n })
    expect(exigir(corrigir(t2, pedido({ valor: 30000n })))).toEqual({ tipo: 'nada' })
    // Mesmo que o corpo do retry seja outro: a chave é do ENVIO.
    expect(exigir(corrigir(t2, pedido({ valor: 99n })))).toEqual({ tipo: 'nada' })
  })

  it('o retry de uma correção que já valeu responde "nada" mesmo depois do Fechou', () => {
    const primeira = exigir(corrigir(cartao(), pedido({ valor: 30000n })))
    if (primeira.tipo !== 'corrigir') throw new Error('esperava correção')
    const fechado = cartao({ etapa: 'fechado', historico: [...cartao().historico, primeira.evento] })
    expect(exigir(corrigir(fechado, pedido({ valor: 30000n })))).toEqual({ tipo: 'nada' })
  })

  it('com `valores`, a correção idêntica ao vigente não grava nada', () => {
    const igual = pedido({ valor: 300000n, retomarEm: '2026-11-05', nota: 'programa Tirzepatida' })
    const t = cartao({ proximoPassoEm: '2026-11-05' })
    expect(exigir(corrigir(t, igual, { podeVerValores: true }))).toEqual({ tipo: 'nada' })
  })

  it('SEM `valores`, mandar o valor certo e o errado dá o MESMO resultado — os dois gravam', () => {
    // Se o "certo" não gravasse, o tamanho do histórico diria a quem não vê
    // valores qual era o valor: é o oráculo que S-28 proíbe.
    const certo = exigir(corrigir(cartao(), pedido({ valor: 300000n }), { podeVerValores: false }))
    const errado = exigir(corrigir(cartao(), pedido({ valor: 123400n }), { podeVerValores: false }))
    expect(certo.tipo).toBe('corrigir')
    expect(errado.tipo).toBe('corrigir')
  })

  it('SEM `valores` e SEM mandar valor, o idêntico não grava — ali não há valor a adivinhar', () => {
    const t = cartao({ proximoPassoEm: '2026-11-07' })
    expect(exigir(corrigir(t, pedido({ retomarEm: '2026-11-07' }), { podeVerValores: false }))).toEqual({
      tipo: 'nada',
    })
  })

  it('pedido vazio é recusado: não há o que corrigir', () => {
    expect(codigoDe(corrigir(cartao(), pedido()))).toBe('NADA_A_CORRIGIR')
  })
})

/* ------------------------------------------------------------ validações */

describe('o que a correção recusa (S-25, N-16, N-18)', () => {
  it('valor zero, negativo ou acima do teto é recusado', () => {
    expect(codigoDe(corrigir(cartao(), pedido({ valor: 0n })))).toBe('VALOR_INVALIDO')
    expect(codigoDe(corrigir(cartao(), pedido({ valor: -1n })))).toBe('VALOR_INVALIDO')
    expect(codigoDe(corrigir(cartao(), pedido({ valor: TETO_DO_ORCAMENTO + 1n })))).toBe('VALOR_INVALIDO')
    expect(codigoDe(corrigir(cartao(), pedido({ valor: TETO_DO_ORCAMENTO })))).toBe('OK')
  })

  it('retomar ANTES do hoje do servidor é recusado; hoje vale', () => {
    expect(codigoDe(corrigir(cartao(), pedido({ retomarEm: '2026-11-04' })))).toBe('RETOMAR_NO_PASSADO')
    expect(codigoDe(corrigir(cartao(), pedido({ retomarEm: HOJE })))).toBe('OK')
  })

  it('data que não existe no calendário é recusada', () => {
    expect(codigoDe(corrigir(cartao(), pedido({ retomarEm: '2026-11-31' })))).toBe('DATA_INVALIDA')
  })

  it('nota acima de 160 é recusada', () => {
    expect(codigoDe(corrigir(cartao(), pedido({ nota: 'x'.repeat(161) })))).toBe('NOTA_LONGA')
  })

  it('a mensagem de erro NUNCA carrega o valor (S-27)', () => {
    const r = corrigir(
      cartao({ programaOrcado: [{ valor: '200000' }] }),
      pedido({ valor: 150000n }),
    )
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) {
      expect(r.erro.mensagem).not.toMatch(/\d/)
    }
  })
})

/* ---------------------------------------------------- o programa orçado */

describe('o programa orçado continua cabendo no orçamento (N-17)', () => {
  it('Σ itens com valor > valor corrigido é recusado', () => {
    const t = cartao({ programaOrcado: [{ valor: '200000' }, { valor: null }, {}] })
    expect(codigoDe(corrigir(t, pedido({ valor: 199999n })))).toBe('PROGRAMA_PASSA_DO_ORCAMENTO')
    expect(codigoDe(corrigir(t, pedido({ valor: 200000n })))).toBe('OK')
  })

  it('SEM `valores`, corrigir o VALOR de um programa com preço por item é recusado sem olhar o número', () => {
    // A resposta depende do ESTADO (o programa tem preço por item), nunca do
    // valor mandado: sem isto, 409/200 seria uma busca binária da soma.
    const t = cartao({ programaOrcado: [{ valor: '200000' }] })
    expect(codigoDe(corrigir(t, pedido({ valor: 300000n }), { podeVerValores: false }))).toBe(
      'CORRECAO_EXIGE_VALORES',
    )
    expect(codigoDe(corrigir(t, pedido({ valor: 100n }), { podeVerValores: false }))).toBe(
      'CORRECAO_EXIGE_VALORES',
    )
    // A data e a nota continuam corrigíveis.
    expect(codigoDe(corrigir(t, pedido({ retomarEm: '2026-11-09' }), { podeVerValores: false }))).toBe('OK')
  })

  it('programaCabeNoOrcamento é a MESMA regra do registrar', () => {
    const d = Dinheiro.deCentavos
    expect(ehOk(programaCabeNoOrcamento(d(100n), [{ valor: d(60n) }, { valor: d(40n) }]))).toBe(true)
    expect(ehOk(programaCabeNoOrcamento(d(99n), [{ valor: d(60n) }, { valor: d(40n) }]))).toBe(false)
    expect(ehOk(programaCabeNoOrcamento(d(1n), [{ valor: null }, {}]))).toBe(true)
    expect(ehOk(programaCabeNoOrcamento(d(1n), null))).toBe(true)
  })
})

/* ------------------------------------------- o valor vigente e a janela */

const correcao = (valor: string, em: string, porId = RESPONSAVEL): EventoDeJornada => ({
  acao: 'corrigirOrcamento',
  etapa: 'orcamento',
  em,
  porId,
  de: { valor: null, retomarEm: null, nota: null },
  para: { valor, retomarEm: null, nota: null },
})

const OUT_DE = new Date('2026-10-01T03:00:00.000Z') // 01/10 00:00 em America/Bahia
const OUT_ATE = new Date('2026-11-01T03:00:00.000Z')
const NOV_DE = OUT_ATE
const NOV_ATE = new Date('2026-12-01T03:00:00.000Z')

describe('orcamento-corrigido-depois-do-mes (N-14 leitura b)', () => {
  it('R$ 3.000 de 15/10 corrigido para R$ 300 em 05/11: outubro segue R$ 3.000, novembro não conta', () => {
    const antes = [registro('300000', '2026-10-15T15:00:00.000Z')]
    const depois = [...antes, correcao('30000', '2026-11-05T15:00:00.000Z')]
    expect(orcadoNaJanela([antes], OUT_DE, OUT_ATE).centavos).toBe(300000n)
    expect(orcadoNaJanela([depois], OUT_DE, OUT_ATE).centavos).toBe(300000n)
    expect(orcadoNaJanela([depois], NOV_DE, NOV_ATE).centavos).toBe(0n)
    // O vigente HOJE é o corrigido: é o que a coluna "Orçamentos em aberto" mostra.
    expect(orcamentoVigente(depois)?.valor).toBe(30000n)
  })

  it('variante: corrigido em 20/10, outubro mostra o corrigido em qualquer data depois', () => {
    const h = [registro('300000', '2026-10-15T15:00:00.000Z'), correcao('30000', '2026-10-20T15:00:00.000Z')]
    expect(orcadoNaJanela([h], OUT_DE, OUT_ATE).centavos).toBe(30000n)
  })

  it('a nota vigente acompanha a correção', () => {
    const h = [registro('300000', '2026-10-15T15:00:00.000Z', 'antes')]
    expect(orcamentoVigente(h)).toEqual({ valor: 300000n, nota: 'antes' })
    const c2: EventoDeJornada = {
      ...correcao('30000', '2026-10-20T15:00:00.000Z'),
      para: { valor: '30000', retomarEm: null, nota: 'depois' },
    }
    expect(orcamentoVigente([...h, c2])).toEqual({ valor: 30000n, nota: 'depois' })
    expect(orcamentoVigente([...h, c2], new Date('2026-10-20T00:00:00.000Z'))).toEqual({
      valor: 300000n,
      nota: 'antes',
    })
  })

  it('sem orçamento registrado, não há vigente', () => {
    expect(orcamentoVigente([])).toBeNull()
  })
})

/* --------------------------------------------------- property-based */

const DIA_MS = 86_400_000
const BASE = Date.UTC(2026, 0, 1)
const centavos = fc.bigInt({ min: 1n, max: TETO_DO_ORCAMENTO })

/** Um cartão: o registro num instante, e correções em instantes crescentes depois dele. */
const cartaoArb = fc
  .record({
    registroEm: fc.integer({ min: 0, max: 300 * DIA_MS }),
    valor: centavos,
    correcoes: fc.array(fc.record({ passo: fc.integer({ min: 1, max: 20 * DIA_MS }), valor: centavos }), {
      maxLength: 6,
    }),
  })
  .map(({ registroEm, valor, correcoes }) => {
    let t = BASE + registroEm
    const h: EventoDeJornada[] = [registro(valor.toString(), new Date(t).toISOString())]
    for (const c of correcoes) {
      t += c.passo
      h.push(correcao(c.valor.toString(), new Date(t).toISOString()))
    }
    return h
  })

describe('propriedades — exemplo a dedo não prova a janela', () => {
  it('o passado não muda: correções com em >= agora não alteram janela com ate <= agora', () => {
    fc.assert(
      fc.property(
        fc.array(cartaoArb, { maxLength: 8 }),
        fc.integer({ min: 0, max: 400 * DIA_MS }),
        fc.integer({ min: 1, max: 60 * DIA_MS }),
        fc.integer({ min: 0, max: 30 * DIA_MS }),
        fc.array(fc.record({ i: fc.nat(), depois: fc.nat({ max: 90 * DIA_MS }), valor: centavos }), {
          maxLength: 6,
        }),
        (cartoes, inicio, largura, folga, futuras) => {
          const de = new Date(BASE + inicio)
          const ate = new Date(BASE + inicio + largura)
          // "agora" é qualquer instante >= ate e >= o último evento já gravado.
          const ultimo = Math.max(
            0,
            ...cartoes.flatMap((h) => h.map((e) => new Date(e.em).getTime())),
          )
          const agora = Math.max(ate.getTime() + folga, ultimo)
          const antes = orcadoNaJanela(cartoes, de, ate)
          const comFuturas = cartoes.map((h) => [...h])
          for (const f of futuras) {
            if (comFuturas.length === 0) break
            const alvo = comFuturas[f.i % comFuturas.length]!
            alvo.push(correcao(f.valor.toString(), new Date(agora + f.depois).toISOString()))
          }
          expect(orcadoNaJanela(comFuturas, de, ate).centavos).toBe(antes.centavos)
        },
      ),
    )
  })

  it('a soma da janela é EXATAMENTE a soma inteira dos vigentes — sem perder um centavo', () => {
    fc.assert(
      fc.property(fc.array(cartaoArb, { maxLength: 10 }), (cartoes) => {
        const de = new Date(BASE)
        const ate = new Date(BASE + 500 * DIA_MS)
        let esperado = 0n
        for (const h of cartoes) esperado += BigInt(h.at(-1)!.acao === 'registrarOrcamento' ? h.at(-1)!.valor! : h.at(-1)!.para!.valor!)
        expect(orcadoNaJanela(cartoes, de, ate).centavos).toBe(esperado)
      }),
    )
  })

  it('o centavo atravessa a correção intacto: para.valor é o pedido, em texto, sem float', () => {
    fc.assert(
      fc.property(centavos, (v) => {
        const r = exigir(corrigir(cartao(), pedido({ valor: v })))
        if (v === 300000n) return
        if (r.tipo !== 'corrigir') throw new Error('esperava correção')
        expect(r.evento.para?.valor).toBe(v.toString())
        expect(BigInt(r.evento.para!.valor!)).toBe(v)
        expect(r.valorOrcamento).toBe(v)
        // O que não veio fica igual, centavo por centavo.
        expect(r.evento.de?.valor).toBe('300000')
      }),
    )
  })

  it('a contagem de "enviados" não muda com correções: só `registrarOrcamento` conta', () => {
    fc.assert(
      fc.property(fc.array(cartaoArb, { maxLength: 10 }), (cartoes) => {
        const enviados = cartoes.flatMap((h) => h.filter((e) => ACOES_DO_FUNIL.includes(e.acao)))
        expect(enviados).toHaveLength(cartoes.length)
      }),
    )
  })
})
