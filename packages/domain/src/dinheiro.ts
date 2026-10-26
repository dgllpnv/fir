import { erro, erroDe, ok, type Result } from './resultado'

const FORMATADOR = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

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
