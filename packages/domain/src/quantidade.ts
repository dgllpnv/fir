import { erro, erroDe, ok, type Result } from './resultado'

const MIL = 1000n

/**
 * Quantidade de estoque, em **milésimos da unidade declarada**.
 *
 * Milésimos porque o legado faz `Math.round(x * 1000) / 1000` em toda
 * quantidade, e as doses reais são fracionárias (0,25 ampola, 0,5 frasco).
 * Milésimos reproduzem exatamente aquela precisão sem ponto flutuante.
 *
 * A unidade viaja no tipo: somar ampola com mg lança erro em vez de converter
 * em silêncio, que é como se aplica a dose errada num paciente.
 */
export class Quantidade {
  private constructor(
    readonly milesimos: bigint,
    readonly unidade: string,
  ) {}

  static deMilesimos(milesimos: bigint, unidade: string): Quantidade {
    return new Quantidade(milesimos, unidade)
  }

  static zero(unidade: string): Quantidade {
    return new Quantidade(0n, unidade)
  }

  /** Aceita `1`, `0,25`, `2,5`, `1.5` e vazio. Até três casas decimais. */
  static deTexto(entrada: string, unidade: string): Result<Quantidade> {
    let s = String(entrada ?? '').replace(/\s| /g, '')
    if (s === '') return ok(Quantidade.zero(unidade))
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')

    if (!/^\d+(\.\d{1,3})?$/.test(s)) {
      return erro(erroDe('QuantidadeInvalida', `"${entrada}" não é uma quantidade válida (até 3 casas).`))
    }
    const [inteiros = '0', decimais = ''] = s.split('.')
    return ok(new Quantidade(BigInt(inteiros) * MIL + BigInt(decimais.padEnd(3, '0')), unidade))
  }

  private mesmaUnidade(outro: Quantidade): Result<true> {
    if (this.unidade !== outro.unidade) {
      return erro(
        erroDe('UnidadesIncompativeis', `Não é possível operar ${this.unidade} com ${outro.unidade}.`),
      )
    }
    return ok(true)
  }

  mais(outro: Quantidade): Result<Quantidade> {
    const c = this.mesmaUnidade(outro)
    if (c.tipo === 'erro') return c
    return ok(new Quantidade(this.milesimos + outro.milesimos, this.unidade))
  }

  menos(outro: Quantidade): Result<Quantidade> {
    const c = this.mesmaUnidade(outro)
    if (c.tipo === 'erro') return c
    return ok(new Quantidade(this.milesimos - outro.milesimos, this.unidade))
  }

  ehZero(): boolean {
    return this.milesimos === 0n
  }

  ehNegativa(): boolean {
    return this.milesimos < 0n
  }

  formatar(): string {
    const negativa = this.milesimos < 0n
    const abs = negativa ? -this.milesimos : this.milesimos
    const inteiros = abs / MIL
    const decimais = (abs % MIL).toString().padStart(3, '0').replace(/0+$/, '')
    const numero = decimais === '' ? `${inteiros}` : `${inteiros},${decimais}`
    return `${negativa ? '-' : ''}${numero} ${this.unidade}`
  }
}

/**
 * As duas razões do cadastro do item:
 *   `compraParaMedida` — 1 unidCompra = N medida   (1 caixa = 4 ampolas → 4000n)
 *   `medidaParaUso`    — 1 medida     = N unidUso  (1 ampola = 5 mg    → 5000n)
 *
 * Em milésimos, como toda quantidade. Um número de conversão escrito dentro de
 * uma função é defeito mesmo quando o resultado está certo hoje: no dia em que
 * o fornecedor mudar a caixa de 4 para 6, o cadastro muda e o código não.
 */
export type Fatores = { readonly compraParaMedida: bigint; readonly medidaParaUso: bigint }

function aplicar(
  q: Quantidade,
  numerador: bigint,
  denominador: bigint,
  unidadeDestino: string,
): Result<Quantidade> {
  if (denominador === 0n) {
    return erro(erroDe('FatorInvalido', 'O fator de conversão do item é zero.'))
  }
  const produto = q.milesimos * numerador
  if (produto % denominador !== 0n) {
    return erro(
      erroDe(
        'ConversaoInexata',
        `Converter ${q.formatar()} para ${unidadeDestino} não dá um valor exato. ` +
          `Confira os fatores de conversão do item.`,
      ),
    )
  }
  return ok(Quantidade.deMilesimos(produto / denominador, unidadeDestino))
}

export const deCompraParaMedida = (q: Quantidade, f: Fatores, unidadeMedida: string) =>
  aplicar(q, f.compraParaMedida, MIL, unidadeMedida)

export const deMedidaParaCompra = (q: Quantidade, f: Fatores, unidadeCompra: string) =>
  aplicar(q, MIL, f.compraParaMedida, unidadeCompra)

export const deMedidaParaUso = (q: Quantidade, f: Fatores, unidadeUso: string) =>
  aplicar(q, f.medidaParaUso, MIL, unidadeUso)

export const deUsoParaMedida = (q: Quantidade, f: Fatores, unidadeMedida: string) =>
  aplicar(q, MIL, f.medidaParaUso, unidadeMedida)
