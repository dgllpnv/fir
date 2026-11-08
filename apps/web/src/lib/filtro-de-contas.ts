import { ConsultaDeContas, type ContaNaLista } from '@fir/contracts'
import { FORMA_NAO_INFORMADA, FORMAS_DE_SAIDA } from '@fir/domain'

/**
 * O filtro da tela Contas a pagar, como ele mora na URL (ADR 0020).
 *
 * `/contas?situacao=pagas&mes=AAAA-MM&forma=…` é lido no `page.tsx` DO
 * SERVIDOR e chega à tela como prop. Nunca `useSearchParams` sem `Suspense`:
 * foi o que quebrou o build de produção de 2026-11-04.
 *
 * Cada parâmetro é validado pelo MESMO schema que a API usa
 * (`ConsultaDeContas`), campo a campo: um `mes` torto na URL cai para o mês
 * corrente sem derrubar a forma, e a tela nunca manda à API o que ela
 * recusaria com 400.
 */
export type FiltroDeContas = {
  readonly situacao: 'abertas' | 'pagas' | 'todas'
  /** `null` = o mês corrente da clínica, que o servidor decide. */
  readonly mes: string | null
  /** `null` = todas as formas. `FORMA_NAO_INFORMADA` casa com `''`. */
  readonly forma: string | null
}

export const SEM_FILTRO: FiltroDeContas = { situacao: 'todas', mes: null, forma: null }

type Parametros = Record<string, string | string[] | undefined>

const primeiro = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v

export function lerFiltroDeContas(p: Parametros): FiltroDeContas {
  const forma = ConsultaDeContas.shape.forma.safeParse(primeiro(p['forma']))
  const mes = ConsultaDeContas.shape.mes.safeParse(primeiro(p['mes']))
  const situacao = ConsultaDeContas.shape.situacao.safeParse(primeiro(p['situacao']))
  return {
    situacao: situacao.success ? situacao.data : 'todas',
    // O `Mes` do contrato só confere o desenho `aaaa-mm` e deixa passar
    // `2026-13`; a tela, que escreve o nome do mês no título, recusa aqui.
    mes: mes.success && mes.data !== undefined && /-(0[1-9]|1[0-2])$/.test(mes.data) ? mes.data : null,
    forma: forma.success && forma.data !== undefined ? forma.data : null,
  }
}

/** A consulta que vai à API — os mesmos três campos, sem os vazios. */
export function consultaDaApi(f: FiltroDeContas): string {
  // Sem `consultaEmTexto` de `./dados` de propósito: aquele módulo é
  // `'use client'`, e este é lido também pelo `page.tsx` do servidor.
  const p = new URLSearchParams()
  if (f.situacao !== 'todas') p.set('situacao', f.situacao)
  if (f.mes !== null) p.set('mes', f.mes)
  if (f.forma !== null) p.set('forma', f.forma)
  const texto = p.toString()
  return texto === '' ? '' : `?${texto}`
}

/** O endereço da tela para um filtro — é o que o toque na Visão do mês abre. */
export function caminhoDeContas(f: Partial<FiltroDeContas>): string {
  return `/contas${consultaDaApi({ ...SEM_FILTRO, ...f })}`
}

/**
 * A forma que o filtro olha numa linha: a USADA numa conta paga, a PREVISTA
 * numa aberta — o mesmo critério do servidor. Só serve para montar as opções;
 * quem filtra é a API.
 */
const formaDaLinha = (c: ContaNaLista): string =>
  (c.pagoEm === null ? c.formaPrevista : c.formaPagamento).trim()

/**
 * As opções do filtro: as formas da lista, "Não informada" e qualquer forma
 * já gravada fora da lista (legada, renomeada), como o protótipo faz com as
 * origens. A forma do filtro atual entra sempre — na lista já filtrada ela é
 * a única que sobra, e o `<select>` não pode perder o próprio valor.
 */
export function opcoesDeForma(itens: readonly ContaNaLista[], atual: string | null): string[] {
  const conhecidas = new Set<string>([...FORMAS_DE_SAIDA, FORMA_NAO_INFORMADA])
  const extras = new Set<string>()
  for (const c of itens) {
    const f = formaDaLinha(c)
    if (f !== '' && !conhecidas.has(f)) extras.add(f)
  }
  if (atual !== null && !conhecidas.has(atual)) extras.add(atual)
  return [
    ...FORMAS_DE_SAIDA,
    FORMA_NAO_INFORMADA,
    ...[...extras].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  ]
}

/**
 * A forma que o Paguei mostra ao abrir: a prevista, quando é uma forma que o
 * servidor aceita no pagamento; senão "Não informada" (`''`). A tela SEMPRE
 * manda o que está no campo — o servidor não tem fallback (ADR 0020).
 */
export function formaInicialDoPagamento(prevista: string): string {
  return FORMAS_DE_SAIDA.find((f) => f === prevista) ?? ''
}
