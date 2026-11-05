import { Dinheiro } from './dinheiro'

/**
 * **A COBRANÇA DO CLIENTE FIRMARE** — dinheiro real que a Firmare fatura de um
 * `Cliente Firmare` (G3, spec `docs/superpowers/plans/g3-spec-metas-e-
 * lancamentos.md`, ADR 0015). Regras 1-7 do CLAUDE.md se aplicam de ponta a
 * ponta: tudo aqui é `bigint`/`Dinheiro`, nunca `number` perto de centavo.
 *
 * `PercentualCentesimos` existe porque a assinatura de referência do spec
 * (`aplicarDesconto(mensalidade: Dinheiro, percentual: number)`) foi reprovada
 * pelo gate de números (ADR 0015, Decisão 1): um `percentual: number` força
 * uma conversão para ponto flutuante em algum ponto da multiplicação por um
 * `bigint` de centavos — a mesma classe de bug que a regra 1 proíbe, do lado
 * do FATOR em vez do valor. `1000` = 10,00%; o intervalo válido é `[0, 10000]`.
 */
export type PercentualCentesimos = bigint

/**
 * Constrói um `PercentualCentesimos` válido, ou lança.
 *
 * `0` e `10000` são os dois extremos legítimos (0% e 100%, critério de borda
 * explícito do ADR 0015).
 */
export function criarPercentualCentesimos(valor: bigint): PercentualCentesimos {
  if (valor < 0n || valor > 10000n) {
    throw new Error(`percentual fora do intervalo [0, 10000] centésimos: ${valor}`)
  }
  return valor
}

/**
 * Divisão inteira com arredondamento para CIMA — `a` e `b` não-negativos.
 *
 * `(a + b - 1) / b` com divisão inteira de `bigint` trunca a fração para
 * baixo, e somar `b - 1` antes empurra qualquer resto para o próximo inteiro.
 * `b = 0n` não é um caso válido aqui (nunca ocorre: o divisor é sempre
 * `10000n`) e lançaria por divisão por zero do próprio `bigint`.
 */
function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b
}

export type DescontoAplicado = {
  /**
   * O desconto do `Benefício de indicação`, arredondado SEMPRE para cima —
   * nunca a favor da Firmare cobrar mais que o percentual exato (ADR 0015,
   * Decisão 1; ADR 0013 §8).
   */
  readonly desconto: Dinheiro
  /** `mensalidade - desconto`. A cobrança final arredonda sempre para baixo. */
  readonly cobranca: Dinheiro
}

/**
 * Aplica um `Benefício de indicação` (desconto percentual) a uma `Mensalidade`.
 *
 * Fórmula exata do ADR 0015: `desconto = ceilDiv(mensalidade_centavos ×
 * percentual_centesimos, 10000)`, `cobranca = mensalidade_centavos − desconto`.
 *
 * Devolve as DUAS partes — nunca só a cobrança — porque o desconto também é
 * um registro auditável (o valor do `Benefício` efetivamente consumido).
 *
 * **Não é o caso da regra 2 do CLAUDE.md** ("ratear em N parcelas iguais,
 * `max − min <= 1`"): aqui há DUAS partes desiguais por desenho (o desconto é
 * tipicamente pequeno, a cobrança é o resto grande). O invariante que vale é
 * mais estreito — ver `cobranca-carteira.test.ts`: a soma é exata, e o
 * desconto nunca é menor que o piso da divisão exata (nunca arredonda a favor
 * da Firmare).
 */
export function aplicarDesconto(mensalidade: Dinheiro, percentual: PercentualCentesimos): DescontoAplicado {
  if (percentual < 0n || percentual > 10000n) {
    throw new Error(`percentual fora do intervalo [0, 10000] centésimos: ${percentual}`)
  }
  const mensalidadeCentavos = mensalidade.centavos
  if (mensalidadeCentavos < 0n) {
    throw new Error(`mensalidade não pode ser negativa: ${mensalidadeCentavos}`)
  }

  const descontoCentavos =
    percentual === 0n || mensalidadeCentavos === 0n ? 0n : ceilDiv(mensalidadeCentavos * percentual, 10000n)
  const cobrancaCentavos = mensalidadeCentavos - descontoCentavos

  return {
    desconto: Dinheiro.deCentavos(descontoCentavos),
    cobranca: Dinheiro.deCentavos(cobrancaCentavos),
  }
}
