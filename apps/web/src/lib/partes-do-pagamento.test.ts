import { describe, expect, it } from 'vitest'
import { ErroDaApi } from './api'
import {
  abrirMultiplas,
  adicionarLinha,
  corpoDaForma,
  corpoDaFormaEmTexto,
  estadoInicialDasFormas,
  formasDaLinha,
  mudarForma,
  mudarValor,
  pagamentoEmbutidoEmTexto,
  partesAcimaDaDivida,
  tetoEfetivo,
  podeAdicionarLinha,
  removerLinha,
  resumoDasPartes,
  situacaoDasPartes,
  voltarParaUma,
} from './partes-do-pagamento'

const abertoCom = (...valores: string[]) => {
  let e = abrirMultiplas(estadoInicialDasFormas('Pix'))
  while (e.linhas.length < valores.length) e = adicionarLinha(e)
  valores.forEach((v, i) => {
    e = mudarValor(e, e.linhas[i]!.id, v)
  })
  return e
}

describe('partes do pagamento — o estado do formulário', () => {
  it('em forma única não muda nada: manda `forma`, e só ela', () => {
    const r = corpoDaForma(10000n, estadoInicialDasFormas('Dinheiro'))
    expect(r).toEqual({ tipo: 'ok', corpo: { forma: 'Dinheiro' } })
  })

  it('abrir a lista parte da forma que já estava escolhida, com uma segunda diferente', () => {
    const e = abrirMultiplas(estadoInicialDasFormas('Dinheiro'))
    expect(e.linhas.map((l) => l.forma)).toEqual(['Dinheiro', 'Pix'])
  })

  it('"Falta" e "Passou" vêm do domínio, e só fecha com a soma exata', () => {
    expect(situacaoDasPartes(10000n, abertoCom('40,00', ''))).toEqual({
      tipo: 'falta',
      diferenca: 6000n,
    })
    expect(situacaoDasPartes(10000n, abertoCom('40,00', '70,00'))).toEqual({
      tipo: 'passou',
      diferenca: 1000n,
    })
    const fecha = situacaoDasPartes(10000n, abertoCom('40,00', '60,00'))
    expect(fecha.tipo).toBe('fecha')
  })

  it('sem o valor total não há contra o que somar', () => {
    expect(situacaoDasPartes(null, abertoCom('40,00', '60,00')).tipo).toBe('sem-total')
    expect(situacaoDasPartes(0n, abertoCom('40,00', '60,00')).tipo).toBe('sem-total')
  })

  it('soma que fecha com uma linha vazia ainda não libera', () => {
    // 100,00 numa linha e a outra em branco: fecha a conta, mas a linha vazia pede decisão.
    expect(situacaoDasPartes(10000n, abertoCom('100,00', '')).tipo).toBe('incompleta')
  })

  it('manda `partes` (e não `forma`) com centavos em texto', () => {
    const r = corpoDaForma(10000n, abertoCom('40,00', '60,00'))
    expect(r.tipo).toBe('ok')
    if (r.tipo !== 'ok') return
    expect('forma' in r.corpo).toBe(false)
    expect(corpoDaFormaEmTexto(r.corpo)).toEqual({
      partes: [
        { forma: 'Pix', valor: '4000' },
        { forma: 'Dinheiro', valor: '6000' },
      ],
    })
  })

  it('não deixa mandar partes que não fecham', () => {
    const r = corpoDaForma(10000n, abertoCom('40,00', '50,00'))
    expect(r.tipo).toBe('erro')
    if (r.tipo === 'erro') expect(r.mensagem).toContain('Falta')
  })

  it('cada forma aparece uma vez: a lista de uma linha não oferece a das outras', () => {
    const e = abertoCom('', '')
    const [a, b] = e.linhas
    expect(formasDaLinha(e, a!.id)).not.toContain(b!.forma)
    expect(formasDaLinha(e, a!.id)).toContain(a!.forma)
  })

  it('nota promissória não se mistura: escolhida, é a única parte', () => {
    const f = abertoCom('40,00', '60,00')
    const g = mudarForma(f, f.linhas[1]!.id, 'Nota promissória', 10000n)
    expect(g.linhas).toHaveLength(1)
    expect(g.linhas[0]).toMatchObject({ forma: 'Nota promissória', valor: '100,00' })
    expect(podeAdicionarLinha(g)).toBe(false)
  })

  it('com outra parte na lista, promissória nem é oferecida', () => {
    const e = abertoCom('', '')
    expect(formasDaLinha(e, e.linhas[0]!.id)).not.toContain('Nota promissória')
  })

  it('no máximo uma linha por forma da gaveta (4), e tirar não deixa a lista vazia', () => {
    let e = abertoCom('', '')
    e = adicionarLinha(adicionarLinha(e))
    expect(e.linhas).toHaveLength(4)
    expect(podeAdicionarLinha(e)).toBe(false)
    e = removerLinha(e, e.linhas[3]!.id)
    expect(e.linhas).toHaveLength(3)
    let um = e
    for (let i = 0; i < 5; i++) um = removerLinha(um, um.linhas[0]!.id)
    expect(um.linhas).toHaveLength(1)
  })

  it('voltar para uma forma só fica com a da primeira linha', () => {
    const e = voltarParaUma(abrirMultiplas(estadoInicialDasFormas('Dinheiro')))
    expect(e.multiplas).toBe(false)
    expect(e.forma).toBe('Dinheiro')
  })
})

describe('corpo do pagamento embutido', () => {
  it('forma única segue como sempre, com os centavos em texto', () => {
    expect(pagamentoEmbutidoEmTexto({ valor: 5000n, forma: 'Pix', valorAberto: 300n })).toEqual({
      valor: '5000',
      valorAberto: '300',
      forma: 'Pix',
    })
  })

  it('partes substituem a forma — nunca as duas', () => {
    const c = pagamentoEmbutidoEmTexto({
      valor: 10000n,
      partes: [
        { forma: 'Pix', valor: 4000n },
        { forma: 'Cartão de crédito', valor: 6000n },
      ],
    })
    expect(c).toEqual({
      valor: '10000',
      valorAberto: '0',
      partes: [
        { forma: 'Pix', valor: '4000' },
        { forma: 'Cartão de crédito', valor: '6000' },
      ],
    })
    expect('forma' in c).toBe(false)
  })
})

describe('resumo das partes nas listas', () => {
  const emTexto = (c: bigint) => `R$ ${c / 100n},${(c % 100n).toString().padStart(2, '0')}`

  it('uma parte só: deixa a lista como sempre', () => {
    expect(resumoDasPartes([{ forma: 'Pix', valor: '10000' }], emTexto)).toBeNull()
  })

  it('duas ou mais: "Pix R$ 40,00 + Cartão de crédito R$ 60,00"', () => {
    expect(
      resumoDasPartes(
        [
          { forma: 'Pix', valor: '4000' },
          { forma: 'Cartão de crédito', valor: '6000' },
        ],
        emTexto,
      ),
    ).toBe('Pix R$ 40,00 + Cartão de crédito R$ 60,00')
  })

  it('sem `valores` (valor nulo) só os nomes, sem inventar número', () => {
    expect(
      resumoDasPartes(
        [
          { forma: 'Pix', valor: null },
          { forma: 'Dinheiro', valor: null },
        ],
        emTexto,
      ),
    ).toBe('Pix + Dinheiro')
  })
})

describe('várias formas acima da dívida (V-1)', () => {
  const MSG = 'O valor passa do que a paciente deve nesta dívida. Divida de novo entre as formas, sem passar do valor em aberto.'
  const erro = (corpo: Record<string, unknown>) =>
    new ErroDaApi(409, MSG, 'PARTES_ACIMA_DA_DIVIDA', undefined, {
      statusCode: 409,
      codigo: 'PARTES_ACIMA_DA_DIVIDA',
      message: MSG,
      ...corpo,
    })

  it('lê a mensagem e o devido em centavos', () => {
    expect(partesAcimaDaDivida(erro({ devido: '40000' }))).toEqual({ mensagem: MSG, devido: 40000n })
  })

  it('sem `valores` o devido não existe: só a mensagem, sem inventar teto', () => {
    expect(partesAcimaDaDivida(erro({}))).toEqual({ mensagem: MSG, devido: null })
  })

  it('devido fora do formato não vira número', () => {
    expect(partesAcimaDaDivida(erro({ devido: '400,00' }))?.devido).toBeNull()
  })

  it('outro 409 não é este', () => {
    expect(partesAcimaDaDivida(new ErroDaApi(409, 'x', 'CONFIRMACAO_NECESSARIA'))).toBeNull()
    expect(partesAcimaDaDivida(new Error('x'))).toBeNull()
  })

  it('o teto que vale é o menor dos dois que o servidor mandou', () => {
    expect(tetoEfetivo(50000n, 40000n)).toBe(40000n)
    expect(tetoEfetivo(30000n, 40000n)).toBe(30000n)
    expect(tetoEfetivo(null, 40000n)).toBe(40000n)
    expect(tetoEfetivo(50000n, null)).toBe(50000n)
    expect(tetoEfetivo(null, null)).toBeNull()
  })

  it('o teto caiu depois de dividir: "Passou — ajuste as formas", e nada é enviado', () => {
    // Dividido em 300 + 200 = 500; o teto caiu para 400 e o total foi ajustado.
    let e = abrirMultiplas(estadoInicialDasFormas('Pix'))
    e = mudarValor(e, e.linhas[0]!.id, '300,00')
    e = mudarValor(e, e.linhas[1]!.id, '200,00')
    const s = situacaoDasPartes(40000n, e)
    expect(s).toEqual({ tipo: 'passou', diferenca: 10000n })
    const r = corpoDaForma(40000n, e)
    expect(r.tipo).toBe('erro')
    if (r.tipo === 'erro') expect(r.mensagem).toMatch(/^Passou .+ — ajuste as formas$/)
  })
})
