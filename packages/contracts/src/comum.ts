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
  .union([
    // 18 dígitos: o bigint do Postgres estoura em 9,2e18, e o estouro era um 500.
    z.string().regex(/^-?\d{1,18}$/, 'centavos precisam ser um inteiro de até 18 dígitos'),
    z.null(),
  ])
  .transform((v) => (v === null ? null : BigInt(v)))

/**
 * Dinheiro **na saída**: string de centavos, ou `null`.
 *
 * `null` não é "zero": é *"você não tem a permissão `valores`"*. O
 * `RedacaoInterceptor` troca o valor por `null` num ponto único, e a FORMA da
 * resposta não muda com a permissão — o cliente distingue "sem acesso" de
 * "sem valor" sem um `if` extra.
 *
 * Mora aqui porque três arquivos de contrato precisam dela. Três cópias da
 * mesma expressão regular é como uma delas passa a aceitar `12,50`.
 */
export const centavosNaSaida = z.string().regex(/^-?\d+$/).nullable()

/** Quantidade trafega como string de milésimos, pela mesma razão. */
export const quantidadeEmTexto = z
  .union([z.string().regex(/^-?\d{1,18}$/, 'milésimos precisam ser um inteiro de até 18 dígitos'), z.null()])
  .transform((v) => (v === null ? null : BigInt(v)))

export const DiaCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato aaaa-mm-dd')
  // 2026-02-31 casa o formato e estoura no Postgres: o round-trip pega o dia que não existe.
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= '1900-01-01'
  }, 'essa data não existe no calendário')

/**
 * `HH:MM`, com as faixas conferidas.
 *
 * O `Code.gs` valida só `/^\d{2}:\d{2}$/`, e a coluna `time` do Postgres
 * recusaria `99:99` com um erro de banco em vez de uma mensagem de tela. A
 * faixa entra aqui para que a recusa seja a do contrato.
 *
 * Mora em `comum` porque `tarefas` e `jornada` precisam dela — duas cópias da
 * mesma expressão é como uma delas deixa de recusar `24:00`.
 */
export const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM')
// Mês de 01 a 12: `2026-13` passava no formato e a consulta devolvia lista vazia,
// sem erro — achado no T4 da Prioridade 3.
export const Mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use o formato aaaa-mm')
export const Uuid = z.string().uuid()

export const Erro = z.object({ codigo: z.string(), mensagem: z.string() })
export type Erro = z.infer<typeof Erro>
