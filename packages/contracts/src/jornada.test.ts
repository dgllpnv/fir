import { describe, expect, it } from 'vitest'
import { MoverEtapa } from './jornada'

const uuid = '11111111-1111-4111-8111-111111111111'
const outro = '22222222-2222-4222-8222-222222222222'

/** `safeParse` dá `false`; a forma curta deixa os `it` lendo o que importa. */
const passa = (corpo: unknown): boolean => MoverEtapa.safeParse(corpo).success
const erroDe = (corpo: unknown): string =>
  MoverEtapa.safeParse(corpo).success
    ? ''
    : (MoverEtapa.safeParse(corpo) as { error: { issues: { message: string }[] } }).error.issues
        .map((i) => i.message)
        .join(' · ')

describe('MoverEtapa — uma ação, um corpo', () => {
  it('perder SEM motivo é recusado pelo PARSE, não pelo serviço', () => {
    // O protótipo aceita e grava `nota: ""`. Medido: `api('moverEtapa',
    // {id, acao:'perder'})` devolve OK. E o KPI diz "veja os motivos no
    // histórico", apontando para um histórico sem motivo nenhum.
    expect(passa({ acao: 'perder', nota: 'desistiu' })).toBe(false)
    expect(passa({ acao: 'perder', motivoId: uuid })).toBe(true)
  })

  it('motivo que não é uuid é recusado — nada de texto livre no lugar do id', () => {
    expect(passa({ acao: 'perder', motivoId: 'Preço' })).toBe(false)
  })

  it('reagendar sem prazo é recusado', () => {
    expect(passa({ acao: 'reagendar' })).toBe(false)
    expect(passa({ acao: 'reagendar', prazo: '2026-11-03' })).toBe(true)
    expect(passa({ acao: 'reagendar', prazo: '03/11/2026' })).toBe(false)
  })

  it('reagendar com hora fora da faixa é recusado', () => {
    expect(passa({ acao: 'reagendar', prazo: '2026-11-03', hora: '09:30' })).toBe(true)
    expect(passa({ acao: 'reagendar', prazo: '2026-11-03', hora: '24:00' })).toBe(false)
    expect(passa({ acao: 'reagendar', prazo: '2026-11-03', hora: '09:60' })).toBe(false)
  })

  it('registrar orçamento sem valor é recusado', () => {
    expect(passa({ acao: 'registrarOrcamento' })).toBe(false)
  })

  it('orçamento de valor zero é recusado — isso não é proposta', () => {
    expect(passa({ acao: 'registrarOrcamento', valor: '0' })).toBe(false)
    expect(passa({ acao: 'registrarOrcamento', valor: '-100' })).toBe(false)
    expect(passa({ acao: 'registrarOrcamento', valor: null })).toBe(false)
  })

  it('o valor do orçamento chega como CENTAVOS INTEIROS, nunca como float', () => {
    const r = MoverEtapa.parse({ acao: 'registrarOrcamento', valor: '360000' })
    expect(r).toMatchObject({ acao: 'registrarOrcamento', valor: 360000n })
    // `3600.00` não é centavos: é a assinatura do float que a regra 1 proíbe.
    expect(passa({ acao: 'registrarOrcamento', valor: '3600.00' })).toBe(false)
    expect(passa({ acao: 'registrarOrcamento', valor: 360000 })).toBe(false)
  })

  it('CAMPO QUE NÃO É DA AÇÃO é recusado — nada de corpo-saco', () => {
    // `.strict()`: `reagendar` com `valor` no corpo significa que quem chamou
    // entendeu errado o que está fazendo, e o silêncio é pior que o 400.
    expect(passa({ acao: 'reagendar', prazo: '2026-11-03', valor: '100' })).toBe(false)
    expect(passa({ acao: 'confirmar', nota: 'veio' })).toBe(false)
    expect(passa({ acao: 'noshow', prazo: '2026-11-03' })).toBe(false)
    expect(passa({ acao: 'perder', motivoId: uuid, valor: '100' })).toBe(false)
  })

  it('A ETAPA NÃO ESTÁ NO CONTRATO: o cliente não escolhe o destino', () => {
    // É a diferença entre uma máquina de estados e um campo editável. Quem
    // chama diz o que a recepção FEZ; o servidor decide para onde o cartão vai,
    // pela tabela de `packages/domain`.
    for (const corpo of [
      { acao: 'confirmar', etapa: 'fechado' },
      { acao: 'noshow', etapa: 'realizado' },
      { acao: 'reagendar', prazo: '2026-11-03', etapa: 'agendado' },
    ]) {
      expect(passa(corpo), JSON.stringify(corpo)).toBe(false)
    }
  })

  it('ação desconhecida é recusada — e `agendar`/`concluir` não são desta rota', () => {
    expect(passa({ acao: 'arquivar' })).toBe(false)
    // Criar e concluir são `POST /v1/tarefas` e `.../concluir` (épico 2). Eles
    // escrevem etapa e histórico por lá, e aceitá-los aqui seria o segundo
    // caminho — que é sempre o que diverge.
    expect(passa({ acao: 'agendar' })).toBe(false)
    expect(passa({ acao: 'concluir' })).toBe(false)
  })

  it('a nota é limitada a 160 e vem APARADA', () => {
    const r = MoverEtapa.parse({ acao: 'desmarcar', nota: '   viagem   ' })
    expect(r).toMatchObject({ nota: 'viagem' })
    expect(passa({ acao: 'desmarcar', nota: 'x'.repeat(160) })).toBe(true)
    expect(passa({ acao: 'desmarcar', nota: 'x'.repeat(161) })).toBe(false)
  })

  it('as sete ações sem dinheiro aceitam o corpo mínimo', () => {
    expect(passa({ acao: 'enviarConfirmacao' })).toBe(true)
    expect(passa({ acao: 'confirmar' })).toBe(true)
    expect(passa({ acao: 'noshow' })).toBe(true)
    expect(passa({ acao: 'desmarcar' })).toBe(true)
    expect(passa({ acao: 'encerrar' })).toBe(true)
    expect(passa({ acao: 'reabrir' })).toBe(true)
    expect(passa({ acao: 'followUp' })).toBe(true)
  })

  it('`retomarEm` é opcional: o padrão é do SERVIDOR, no fuso da clínica', () => {
    // O protótipo calcula `hoje+2` e `hoje+3` NA TELA e manda a data. Com o
    // relógio do cliente adiantado, o orçamento voltaria a pedir ação no dia
    // errado (regra 24).
    expect(passa({ acao: 'followUp', nota: 'vai decidir' })).toBe(true)
    expect(passa({ acao: 'followUp', retomarEm: '2026-11-03' })).toBe(true)
    expect(passa({ acao: 'registrarOrcamento', valor: '360000', retomarEm: '2026-10-26' })).toBe(
      true,
    )
  })
})

/* ---------------------------------------------------- o programa orçado */

const item = (extra: Record<string, unknown> = {}) => ({
  procedimentoId: uuid,
  sessoes: 12,
  intervaloDias: 7,
  chave: 'i1',
  ...extra,
})

const orcar = (programa: unknown) => ({
  acao: 'registrarOrcamento',
  valor: '360000',
  programa,
})

describe('o programa orçado — a costura com o épico 5', () => {
  it('o programa orçado aceita no máximo 10 itens', () => {
    const dez = Array.from({ length: 10 }, (_, i) => item({ chave: `i${i + 1}` }))
    expect(passa(orcar(dez))).toBe(true)
    // O protótipo faz `.slice(0,10)` e DESCARTA o resto em silêncio — a
    // médica prescreve onze e a clínica monta dez.
    expect(passa(orcar([...dez, item({ chave: 'i11' })]))).toBe(false)
  })

  it('programa vazio é recusado: ou tem item, ou o campo não vem', () => {
    expect(passa(orcar([]))).toBe(false)
    expect(passa({ acao: 'registrarOrcamento', valor: '360000' })).toBe(true)
  })

  it('o valor do item também é centavos em texto', () => {
    const r = MoverEtapa.parse(orcar([item({ valor: '30000' })]))
    expect(r).toMatchObject({ programa: [{ valor: 30000n }] })
    expect(passa(orcar([item({ valor: '300.00' })]))).toBe(false)
  })

  it('sessões e intervalo têm faixa — zero sessão não é programa', () => {
    expect(passa(orcar([item({ sessoes: 0 })]))).toBe(false)
    expect(passa(orcar([item({ sessoes: 61 })]))).toBe(false)
    expect(passa(orcar([item({ intervaloDias: 0 })]))).toBe(false)
    expect(passa(orcar([item({ intervaloDias: 366 })]))).toBe(false)
    expect(passa(orcar([item({ sessoes: 1.5 })]))).toBe(false)
  })

  it('CHAVE REPETIDA é recusada — `depoisDe` deixaria de ter resposta única', () => {
    const r = MoverEtapa.safeParse(orcar([item({ chave: 'i1' }), item({ chave: 'i1' })]))
    expect(r.success).toBe(false)
    expect(erroDe(orcar([item({ chave: 'i1' }), item({ chave: 'i1' })]))).toContain('repetida')
  })

  it('`depoisDe` que aponta para item inexistente é recusado', () => {
    // Uma proposta cujo encadeamento não fecha chegaria inteira ao épico 5,
    // que montaria sessões sem data de início — e a descoberta seria na
    // agenda da enfermagem.
    expect(passa(orcar([item({ chave: 'i1', depoisDe: 'i9' })]))).toBe(false)
    expect(
      passa(orcar([item({ chave: 'i1' }), item({ chave: 'i2', depoisDe: 'i1' })])),
    ).toBe(true)
  })

  it('`depoisDe` apontando para si mesmo é recusado', () => {
    expect(passa(orcar([item({ chave: 'i1', depoisDe: 'i1' })]))).toBe(false)
  })
})

/* ------------------------------------------------------------- fechar */

describe('fechar carrega o corpo do recebimento', () => {
  it('a forma de pagamento vem da LISTA FECHADA, e o valor em centavos', () => {
    const r = MoverEtapa.parse({
      acao: 'fechar',
      recebimento: { valor: '100000', forma: 'Pix', valorAberto: '260000' },
    })
    expect(r).toMatchObject({
      acao: 'fechar',
      recebimento: { valor: 100000n, valorAberto: 260000n, forma: 'Pix' },
    })
  })

  it('fechar sem recebimento é recusado — fechar É o lançamento do dinheiro', () => {
    expect(passa({ acao: 'fechar' })).toBe(false)
  })

  it('forma de pagamento inventada é recusada', () => {
    expect(passa({ acao: 'fechar', recebimento: { valor: '100000', forma: 'Bitcoin' } })).toBe(
      false,
    )
  })

  it('o recebimento usa o MESMO esquema do épico 2, não uma segunda cópia', () => {
    // `PagamentoEmbutido`. Se fosse outro esquema, "valor em aberto pode ser
    // zero" valeria num e não no outro, e a diferença apareceria no saldo.
    expect(passa({ acao: 'fechar', recebimento: { valor: '0', forma: 'Pix' } })).toBe(false)
    expect(
      passa({ acao: 'fechar', recebimento: { valor: '1', forma: 'Pix', valorAberto: '0' } }),
    ).toBe(true)
    expect(
      passa({ acao: 'fechar', recebimento: { valor: '1', forma: 'Pix', troco: '0' } }),
    ).toBe(false)
  })
})

/* -------------------------------------------------- motivos de perda */

describe('o motivo é dado, e o id atravessa', () => {
  it('dois motivos diferentes são dois ids diferentes', () => {
    const a = MoverEtapa.parse({ acao: 'perder', motivoId: uuid })
    const b = MoverEtapa.parse({ acao: 'perder', motivoId: outro, nota: 'foi para o convênio' })
    expect(a).toMatchObject({ motivoId: uuid })
    expect(b).toMatchObject({ motivoId: outro, nota: 'foi para o convênio' })
  })

  it('o NOME do motivo não vem do cliente — o servidor o resolve pelo id', () => {
    // Guardar o nome que o cliente mandou deixaria a história contar o que o
    // navegador disse, não o que a lista da clínica dizia (decisão D-2).
    expect(passa({ acao: 'perder', motivoId: uuid, motivo: 'Preço' })).toBe(false)
  })
})
