import { Quantidade, ehOk } from '@fir/domain'

/**
 * O que a pessoa digita → **milésimos inteiros**, pelo parser do DOMÍNIO.
 *
 * `Quantidade.deTexto` já existe, já tem teste e já é a regra: aceita `2`,
 * `2,5`, `0,25` e `1.250,5`, recusa mais de três casas, e nunca passa por
 * ponto flutuante (regra 8). Escrever um segundo parser aqui seria a segunda
 * versão da mesma leitura — e seria esta, a da tela, que divergiria no dia em
 * que alguém mudasse a outra.
 *
 * A diferença de contrato é uma só, e é de TELA: campo **vazio** é `null`
 * (&ldquo;não informei&rdquo;), e não zero. Zero é uma informação — é a
 * prateleira vazia —, e confundir os dois faria a contagem em branco virar
 * &ldquo;contei e não achei nada&rdquo;.
 */
export function milesimosDoTexto(bruto: string): bigint | null {
  if (String(bruto ?? '').trim() === '') return null
  const r = Quantidade.deTexto(bruto, 'un.')
  return ehOk(r) ? r.valor.milesimos : null
}

/** Milésimos (texto ou `bigint`) → o que a pessoa digita: "4", "2,5". */
export function textoDeMilesimos(milesimos: string | bigint | null | undefined): string {
  if (milesimos === null || milesimos === undefined) return ''
  const m = BigInt(milesimos)
  const negativa = m < 0n
  const abs = negativa ? -m : m
  const inteiros = abs / 1000n
  const decimais = (abs % 1000n).toString().padStart(3, '0').replace(/0+$/, '')
  const numero = decimais === '' ? `${inteiros}` : `${inteiros},${decimais}`
  return `${negativa ? '-' : ''}${numero}`
}
