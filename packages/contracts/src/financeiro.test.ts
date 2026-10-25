import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CaixaAberto,
  CaixaFechado,
  ConferenciaDeCaixa,
  FecharCaixa,
  FORMAS_DE_ENTRADA,
  PagarConta,
  RegistrarRecebimento,
  SalvarConta,
  SalvarMeta,
} from './financeiro'

const BASE = {
  requisicaoId: randomUUID(),
  pacienteId: randomUUID(),
  valor: '45000',
  forma: 'Pix',
  em: '2026-10-24',
}

const CONTA = {
  descricao: 'Aluguel da sala',
  categoria: 'Ocupação',
  valor: '650000',
  vencimento: '2027-01-31',
  responsavelId: randomUUID(),
}

const PAG = { em: '2026-10-24', valor: '650000' }

describe('RegistrarRecebimento — a união discriminada das cinco referências', () => {
  it('"programa em andamento" sem programa é recusado pelo PARSE', () => {
    expect(RegistrarRecebimento.safeParse({ ...BASE, ref: 'programa' }).success).toBe(false)
  })

  it('"programa em andamento" COM programa faz parse', () => {
    expect(
      RegistrarRecebimento.safeParse({ ...BASE, ref: 'programa', programaId: randomUUID() }).success,
    ).toBe(true)
  })

  it('abater saldo com "ficou valor em aberto" não compila nem faz parse', () => {
    // Sem `.strict()` esta chave seria DESCARTADA em silêncio e o parse
    // passaria — com o saldo da paciente errado e nenhum erro na tela. É a
    // razão de esta união não ser `z.object({…}).and(Referencia)`: interseção
    // impede o `.strict()`.
    expect(RegistrarRecebimento.safeParse({ ...BASE, ref: 'saldo', valorAberto: '50000' }).success).toBe(
      false,
    )
  })

  it('programaId num ramo que não é o de programa também é recusado', () => {
    expect(
      RegistrarRecebimento.safeParse({ ...BASE, ref: 'consulta', programaId: randomUUID() }).success,
    ).toBe(false)
  })

  it('consulta, sinal e novo ACEITAM valor em aberto — inclusive zero', () => {
    for (const ref of ['consulta', 'sinal', 'novo']) {
      expect(RegistrarRecebimento.safeParse({ ...BASE, ref, valorAberto: '20000' }).success).toBe(true)
      expect(RegistrarRecebimento.safeParse({ ...BASE, ref, valorAberto: '0' }).success).toBe(true)
    }
  })

  it('valor zero é recusado — recebimento de nada não é recebimento', () => {
    expect(RegistrarRecebimento.safeParse({ ...BASE, ref: 'consulta', valor: '0' }).success).toBe(false)
    expect(RegistrarRecebimento.safeParse({ ...BASE, ref: 'consulta', valor: '-1' }).success).toBe(false)
  })

  it('o valor chega como bigint de centavos, nunca como número', () => {
    const r = RegistrarRecebimento.parse({ ...BASE, ref: 'consulta', valor: '45000' })
    expect(r.valor).toBe(45000n)
    expect(typeof r.valor).toBe('bigint')
  })

  it('valor com vírgula ou ponto é recusado — o transporte é centavos inteiros', () => {
    expect(RegistrarRecebimento.safeParse({ ...BASE, ref: 'consulta', valor: '450,00' }).success).toBe(
      false,
    )
    expect(RegistrarRecebimento.safeParse({ ...BASE, ref: 'consulta', valor: '450.00' }).success).toBe(
      false,
    )
  })

  it('o `requisicaoId` é obrigatório — sem ele o duplo toque dobra a receita', () => {
    const { requisicaoId: _, ...sem } = BASE
    expect(RegistrarRecebimento.safeParse({ ...sem, ref: 'consulta' }).success).toBe(false)
  })

  it('as cinco formas de ENTRADA incluem a promissória; nenhuma forma de saída entra', () => {
    expect(FORMAS_DE_ENTRADA).toContain('Nota promissória')
    expect(FORMAS_DE_ENTRADA).not.toContain('Boleto')
    expect(RegistrarRecebimento.safeParse({ ...BASE, ref: 'consulta', forma: 'Boleto' }).success).toBe(
      false,
    )
  })
})

describe('contas a pagar', () => {
  it('a conta a pagar só aceita as categorias do domínio', () => {
    expect(SalvarConta.safeParse({ ...CONTA, categoria: 'Cerveja' }).success).toBe(false)
    expect(SalvarConta.safeParse({ ...CONTA, categoria: 'Ocupação' }).success).toBe(true)
  })

  it('a âncora NÃO vem do cliente — só `mensal`', () => {
    // Pedir o dia à parte permitiria cadastrar uma conta que vence dia 10 e
    // repete dia 31. O servidor deriva a âncora do primeiro vencimento.
    expect(SalvarConta.safeParse({ ...CONTA, mensal: true }).success).toBe(true)
    expect(SalvarConta.safeParse({ ...CONTA, mensal: true, diaVencimento: 31 }).success).toBe(false)
  })

  it('conta de valor zero é recusada', () => {
    expect(SalvarConta.safeParse({ ...CONTA, valor: '0' }).success).toBe(false)
  })

  it('a forma de pagamento da CONTA não é a do RECEBIMENTO', () => {
    expect(PagarConta.safeParse({ ...PAG, formaPagamento: 'Boleto' }).success).toBe(true)
    expect(PagarConta.safeParse({ ...PAG, formaPagamento: 'Débito automático' }).success).toBe(true)
    expect(PagarConta.safeParse({ ...PAG, formaPagamento: 'Nota promissória' }).success).toBe(false)
    expect(PagarConta.safeParse({ ...PAG, formaPagamento: 'Cartão de débito' }).success).toBe(false)
  })

  it('a forma de pagamento é opcional — o protótipo também a tem como opcional', () => {
    expect(PagarConta.safeParse(PAG).success).toBe(true)
  })
})

describe('caixa do dia', () => {
  it('o contado do caixa não aceita nota promissória', () => {
    expect(
      FecharCaixa.safeParse({
        dia: '2026-10-24',
        contado: [{ forma: 'Nota promissória', valor: '100' }],
      }).success,
    ).toBe(false)
  })

  it('o contado é ARRAY, e a mesma forma não entra duas vezes', () => {
    expect(
      FecharCaixa.safeParse({
        dia: '2026-10-24',
        contado: [
          { forma: 'Pix', valor: '45000' },
          { forma: 'Pix', valor: '1' },
        ],
      }).success,
    ).toBe(false)
  })

  it('contado zero numa forma é válido — a gaveta vazia é informação', () => {
    const r = FecharCaixa.safeParse({ dia: '2026-10-24', contado: [{ forma: 'Dinheiro', valor: '0' }] })
    expect(r.success).toBe(true)
  })

  it('NENHUMA resposta deste arquivo tem dinheiro dentro de um mapa', () => {
    // Já coberto pela varredura de fonte em `teste/`; aqui é a leitura humana
    // do mesmo fato, para quem abrir este arquivo primeiro.
    expect(CaixaFechado.shape.porForma).toBeInstanceOf(z.ZodArray)
  })

  it('O CAIXA ABERTO NÃO TEM ONDE GUARDAR O ESPERADO', () => {
    // A regra 6 é a FORMA, não um `if` no controlador: as chaves não existem
    // no esquema do dia aberto, então não há como construir a resposta com
    // elas dentro. `null` não serviria — contaria ao cliente que há um número
    // ali, e o próximo refactor o "consertaria".
    const chaves = Object.keys(CaixaAberto.shape)
    expect(chaves).not.toContain('esperado')
    expect(chaves).not.toContain('contado')
    expect(chaves).not.toContain('diferenca')
    expect(chaves).not.toContain('porForma')
    expect(chaves).not.toContain('conferido')
  })

  it('o dia aberto é `.strict()`: um campo a mais é recusado, não ignorado', () => {
    const aberto = { dia: '2026-10-24', fechado: false, formas: ['Pix'], responsavel: null }
    expect(ConferenciaDeCaixa.safeParse(aberto).success).toBe(true)
    expect(ConferenciaDeCaixa.safeParse({ ...aberto, esperado: '57000' }).success).toBe(false)
    expect(ConferenciaDeCaixa.safeParse({ ...aberto, previsto: '57000' }).success).toBe(false)
  })
})

describe('meta', () => {
  it('meta zero faz parse — e é ela que REMOVE a meta', () => {
    expect(SalvarMeta.parse({ valor: '0' }).valor).toBe(0n)
  })

  it('meta negativa é recusada', () => {
    expect(SalvarMeta.safeParse({ valor: '-1' }).success).toBe(false)
  })
})
