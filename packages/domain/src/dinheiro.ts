import { erro, erroDe, ok, type Result } from './resultado'

const FORMATADOR = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * Um valor de fora, já em centavos, com o exato ao lado. O exato (em
 * dezmilésimos de real) existe para a Conferência mostrar o resíduo de
 * arredondamento em vez de deixar a diferença para alguém procurar (A9).
 */
export type DecimalExterno = {
  readonly centavos: bigint
  readonly exatoEmDezmilesimos: bigint
  readonly arredondado: boolean
}

/**
 * Valor monetário em centavos inteiros.
 *
 * O legado faz `Math.round(x * 100) / 100` em dezenas de lugares. Esta classe
 * existe para que essa assinatura não atravesse: não há construtor que aceite
 * `number` com fração.
 */
export class Dinheiro {
  private constructor(readonly centavos: bigint) {}

  static deCentavos(centavos: bigint): Dinheiro {
    return new Dinheiro(centavos)
  }

  static zero(): Dinheiro {
    return new Dinheiro(0n)
  }

  /** Aceita `450`, `450,00`, `1.250,50`, `1250.50`, `R$ 1.250,50` e vazio. */
  static deTexto(entrada: string): Result<Dinheiro> {
    let s = String(entrada ?? '').replace(/R\$|\s| /g, '')
    if (s === '') return ok(Dinheiro.zero())

    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')

    if (!/^\d+(\.\d{1,2})?$/.test(s)) {
      return erro(erroDe('ValorInvalido', `"${entrada}" não é um valor em reais.`))
    }

    const [inteiros = '0', decimais = ''] = s.split('.')
    return ok(new Dinheiro(BigInt(inteiros) * 100n + BigInt(decimais.padEnd(2, '0'))))
  }

  /**
   * **O número de um sistema de fora (MedX), lido do TEXTO do JSON.**
   *
   * Não é `deTexto`, e trocar uma pela outra é o defeito medido no parecer de
   * números (N-B4): `deTexto` foi feita para o que a recepção digita, onde o
   * ponto separa milhar — `"1.250"` vira R$ 1.250,00. Num JSON o ponto é
   * sempre a casa decimal, e `"1.250"` é R$ 1,25.
   *
   * Gramática fechada `-?\d+(\.\d{1,4})?`. Expoente, mais de 4 casas, sinal
   * `+`, espaço, vírgula: erro, e quem chama aborta o ciclo da clínica.
   *
   * Arredonda ao centavo **meio para longe do zero** (N-B5), em `bigint`:
   * `sinal × ((|d| + 50) / 100)`. É simétrico — o pagamento de 1,0050 e o
   * estorno dele somam zero, o que "meio para cima" não garante.
   */
  static deDecimalExterno(texto: string): Result<DecimalExterno> {
    const m = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(texto)
    if (m === null) {
      return erro(erroDe('DecimalExternoInvalido', 'O valor recebido não é um número decimal de até 4 casas.'))
    }
    const negativo = m[1] === '-'
    const abs = BigInt(m[2]!) * 10000n + BigInt((m[3] ?? '').padEnd(4, '0'))
    const centavosAbs = (abs + 50n) / 100n
    return ok({
      centavos: negativo ? -centavosAbs : centavosAbs,
      exatoEmDezmilesimos: negativo ? -abs : abs,
      arredondado: abs % 100n !== 0n,
    })
  }

  mais(outro: Dinheiro): Dinheiro {
    return new Dinheiro(this.centavos + outro.centavos)
  }

  menos(outro: Dinheiro): Dinheiro {
    return new Dinheiro(this.centavos - outro.centavos)
  }

  /**
   * Multiplica por um inteiro. `bigint` na assinatura, e não `number`, de
   * propósito: `12 × R$ 300` é "doze sessões", uma contagem, e um `number`
   * aqui abriria a porta para `2.5` — meia sessão, que não existe — e para o
   * `Number` perder precisão acima de 2^53 no produto.
   */
  vezes(n: bigint): Dinheiro {
    return new Dinheiro(this.centavos * n)
  }

  ehZero(): boolean {
    return this.centavos === 0n
  }

  ehNegativo(): boolean {
    return this.centavos < 0n
  }

  ehMaiorQue(outro: Dinheiro): boolean {
    return this.centavos > outro.centavos
  }

  /**
   * Divide em `partes`, distribuindo o resto **um centavo por parte, nas
   * primeiras**. A soma das partes é exatamente o todo, e nenhuma parte
   * difere de outra em mais de um centavo.
   *
   * A propriedade da soma sozinha NÃO distingue esta regra de "todo o resto na
   * primeira parte", e em 3 partes as duas produzem o mesmo resultado — que é
   * justamente o caso com que todo mundo confere. A propriedade que separa é
   * `max − min <= 1`.
   */
  ratear(partes: number): Dinheiro[] {
    if (!Number.isInteger(partes) || partes < 1) {
      throw new Error(`Rateio precisa de pelo menos uma parte, recebeu ${partes}.`)
    }
    const n = BigInt(partes)
    const negativo = this.centavos < 0n
    const total = negativo ? -this.centavos : this.centavos
    const base = total / n
    const resto = total % n
    return Array.from({ length: partes }, (_, i) => {
      const v = base + (BigInt(i) < resto ? 1n : 0n)
      return new Dinheiro(negativo ? -v : v)
    })
  }

  /**
   * **A MÉDIA** deste valor entre `n` ocorrências — o ticket médio.
   *
   * Não é `ratear`, e a distinção é o desenho: `ratear` PARTE um valor em
   * pedaços cuja soma é exatamente o todo; a média é **um valor
   * representativo**, e somar `n` cópias dele não precisa (nem costuma) dar o
   * total de volta. Usar `ratear(n)[0]` daria sempre a parte que recebeu o
   * centavo do resto, ou seja, a média arredondada para CIMA — e um ticket
   * médio sistematicamente um centavo maior é um número errado de propósito.
   *
   * Arredonda ao inteiro mais próximo, **meio para cima**, em aritmética
   * exata de `bigint`: `(2a + n) / 2n` com divisão inteira. `receita /
   * pagamentos` em ponto flutuante é a assinatura que a regra 1 barra, e é
   * exatamente o que o protótipo faz (`brl0(receita / rec.length)`).
   *
   * `n = 0` LANÇA: a média de nada não é zero, é inexistente. Quem pergunta
   * decide o que mostrar — e `R$ 0,00` num ticket médio diria que a clínica
   * vendeu de graça.
   */
  media(n: number): Dinheiro {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`Média precisa de pelo menos uma ocorrência, recebeu ${n}.`)
    }
    const d = BigInt(n)
    const negativo = this.centavos < 0n
    const a = negativo ? -this.centavos : this.centavos
    const v = (2n * a + d) / (2n * d)
    return new Dinheiro(negativo ? -v : v)
  }

  /**
   * A string sai dos DOIS `bigint`, sem passar por `Number` em nenhum ponto.
   *
   * O que havia antes: `FORMATADOR.format(Number(inteiros) + Number(decimais)
   * / 100)` — ponto flutuante colado em dinheiro, a assinatura exata que a
   * regra 1 do CLAUDE.md existe para barrar, e dentro da classe escrita para
   * impedi-la. Medido: `90071992547409919` centavos saía como
   * `R$ 900.719.925.474.099,20` em vez de `...,19`, porque
   * `900719925474099 + 0.19` não é representável em binário de 64 bits.
   *
   * Inócuo abaixo de 90 trilhões de reais, e é justamente por isso que
   * precisava sair: a Task 12 usou ESTA perda de precisão como prova de por
   * que dinheiro trafega como string. Um formatador que a comete é o
   * contra-exemplo do próprio argumento.
   *
   * `formatToParts` com `bigint` (aceito desde ES2020) deixa o `Intl` decidir
   * símbolo, agrupamento e separador decimal — nada disso é escrito à mão
   * aqui — e a parte `fraction` é substituída pelos centavos exatos. O resto
   * da string vem do `Intl` intacto.
   */
  formatar(): string {
    const negativo = this.centavos < 0n
    const abs = negativo ? -this.centavos : this.centavos
    const centavos = (abs % 100n).toString().padStart(2, '0')
    const texto = FORMATADOR.formatToParts(abs / 100n)
      .map((p) => (p.type === 'fraction' ? centavos : p.value))
      .join('')
      // `Intl.NumberFormat` separa "R$" do valor com U+00A0 (espaço sem
      // quebra), não com espaço comum — invisível ao olho, mas falha
      // comparação exata de string. `replaceAll`, não `replace`: a de
      // ocorrência única trocava só o primeiro, e um dia o `Intl` põe dois.
      .replaceAll(' ', ' ')
    return `${negativo ? '-' : ''}${texto}`
  }
}
