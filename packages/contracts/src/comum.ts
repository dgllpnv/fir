import { z } from 'zod'

/**
 * Dinheiro trafega como **string de centavos**.
 *
 * `JSON.stringify(125050n)` lança, e `Number(centavos)` perde precisão acima de
 * 2^53. String resolve os dois, e tem um efeito colateral desejado: o cliente
 * não consegue somar dois valores sem converter de propósito — o que o faria
 * cair na regra de que o front não calcula dinheiro.
 */
export const dinheiroEmTexto = z
  .union([z.string().regex(/^-?\d+$/, 'centavos precisam ser um inteiro'), z.null()])
  .transform((v) => (v === null ? null : BigInt(v)))

/** Quantidade trafega como string de milésimos, pela mesma razão. */
export const quantidadeEmTexto = z
  .union([z.string().regex(/^-?\d+$/, 'milésimos precisam ser um inteiro'), z.null()])
  .transform((v) => (v === null ? null : BigInt(v)))

export const DiaCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato aaaa-mm-dd')
export const Mes = z.string().regex(/^\d{4}-\d{2}$/, 'use o formato aaaa-mm')
export const Uuid = z.string().uuid()

export const Erro = z.object({ codigo: z.string(), mensagem: z.string() })
export type Erro = z.infer<typeof Erro>
