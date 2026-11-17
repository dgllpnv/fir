/**
 * Aritmética inteira comum ao módulo de indicadores. Tudo em `bigint`, nada
 * em ponto flutuante (regras 1 e 8): o ritmo, a projeção e o progresso são
 * frações exatas até o último passo, e o arredondamento acontece uma vez só.
 */

/** Divisão com piso, também para numerador negativo (o `/` do bigint trunca para zero). */
export function dividirComPiso(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error(`dividirComPiso: denominador precisa ser positivo, recebeu ${d}`)
  const q = n / d
  return n % d !== 0n && n < 0n ? q - 1n : q
}

/**
 * `n ÷ d` arredondado ao inteiro mais próximo, **meio para cima** — a regra do
 * `Math.round` e de `percentualInteiro`, também para negativo
 * (`-66,5 → -66`). `(2n + d) ÷ 2d` com piso.
 */
export function dividirMeioParaCima(n: bigint, d: bigint): bigint {
  return dividirComPiso(2n * n + d, 2n * d)
}

/** Uma fração exata, com denominador sempre positivo. */
export type Fracao = { readonly numerador: bigint; readonly denominador: bigint }

export function fracao(numerador: bigint, denominador: bigint): Fracao {
  if (denominador === 0n) throw new Error('fração com denominador zero')
  return denominador < 0n
    ? { numerador: -numerador, denominador: -denominador }
    : { numerador, denominador }
}

/** O inteiro mais próximo da fração, meio para cima. Só para EXIBIR. */
export const arredondar = (f: Fracao): bigint => dividirMeioParaCima(f.numerador, f.denominador)

export const absoluto = (x: bigint): bigint => (x < 0n ? -x : x)
