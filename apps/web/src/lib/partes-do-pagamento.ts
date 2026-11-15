import { CODIGO_PARTES_ACIMA_DA_DIVIDA, type FORMAS } from '@fir/contracts'
import {
  Dinheiro,
  FORA_DA_CONFERENCIA,
  FORMAS_DE_CONFERENCIA,
  MAX_PARTES,
  quantoFalta,
  validarPartes,
} from '@fir/domain'
import { formatarDinheiro } from '@fir/ui'
import { ErroDaApi } from './api'
import { centavosDoTexto, textoDeCentavos } from './dinheiro-digitado'

/**
 * **"Incluir mais de uma forma de pagamento"** — o estado do formulário, puro.
 *
 * Nada aqui decide: a soma que a tela mostra ("Falta R$ X") só GUIA a pessoa. Quem
 * valida é o servidor (`validarPartes`, a mesma função, no domínio), e o botão de
 * registrar só se libera quando a soma fecha porque mandar uma lista que o
 * servidor vai recusar é um toque perdido no balcão.
 *
 * Fica fora do componente para ser testável sem montar tela.
 */

export type FormaDePagamento = (typeof FORMAS)[number]

export const FORMAS_DE_PAGAMENTO: readonly FormaDePagamento[] = [
  ...FORMAS_DE_CONFERENCIA,
  FORA_DA_CONFERENCIA,
]

export const NOTA_PROMISSORIA: FormaDePagamento = FORA_DA_CONFERENCIA

export type LinhaDeParte = {
  /** Chave estável da linha — a forma pode mudar, e o foco não pode pular. */
  readonly id: number
  readonly forma: FormaDePagamento
  /** O que foi DIGITADO (`1.200,00`). Vira centavos só em `situacaoDasPartes`. */
  readonly valor: string
}

export type EstadoDasFormas = {
  readonly multiplas: boolean
  /** A forma única, quando `multiplas` é falso (o comportamento de sempre). */
  readonly forma: FormaDePagamento
  readonly linhas: readonly LinhaDeParte[]
  readonly proximoId: number
}

export const estadoInicialDasFormas = (forma: FormaDePagamento = 'Pix'): EstadoDasFormas => ({
  multiplas: false,
  forma,
  linhas: [],
  proximoId: 1,
})

/** A primeira forma da lista que ainda não está em uso (nunca a promissória). */
function formaLivre(usadas: readonly string[]): FormaDePagamento | undefined {
  return FORMAS_DE_CONFERENCIA.find((f) => !usadas.includes(f))
}

/** Abre as linhas: a primeira com a forma que já estava escolhida, a segunda com outra. */
export function abrirMultiplas(e: EstadoDasFormas): EstadoDasFormas {
  const primeira: FormaDePagamento = e.forma
  const linhas: LinhaDeParte[] = [{ id: e.proximoId, forma: primeira, valor: '' }]
  let proximoId = e.proximoId + 1
  // Promissória não se mistura: abrir a partir dela deixa uma linha só.
  const segunda = primeira === NOTA_PROMISSORIA ? undefined : formaLivre([primeira])
  if (segunda !== undefined) {
    linhas.push({ id: proximoId, forma: segunda, valor: '' })
    proximoId += 1
  }
  return { ...e, multiplas: true, linhas, proximoId }
}

/** Volta à forma única, ficando com a da primeira linha. */
export function voltarParaUma(e: EstadoDasFormas): EstadoDasFormas {
  const primeira = e.linhas[0]
  return { ...e, multiplas: false, forma: primeira?.forma ?? e.forma, linhas: [] }
}

export function podeAdicionarLinha(e: EstadoDasFormas): boolean {
  return (
    e.multiplas &&
    e.linhas.length < MAX_PARTES &&
    !e.linhas.some((l) => l.forma === NOTA_PROMISSORIA) &&
    formaLivre(e.linhas.map((l) => l.forma)) !== undefined
  )
}

export function adicionarLinha(e: EstadoDasFormas): EstadoDasFormas {
  if (!podeAdicionarLinha(e)) return e
  const forma = formaLivre(e.linhas.map((l) => l.forma))
  if (forma === undefined) return e
  return {
    ...e,
    linhas: [...e.linhas, { id: e.proximoId, forma, valor: '' }],
    proximoId: e.proximoId + 1,
  }
}

export function removerLinha(e: EstadoDasFormas, id: number): EstadoDasFormas {
  if (e.linhas.length <= 1) return e
  return { ...e, linhas: e.linhas.filter((l) => l.id !== id) }
}

/**
 * Trocar a forma de uma linha. A promissória não se mistura: escolhida, ela vira a
 * ÚNICA parte e as outras somem (levando o valor total, para não deixar a pessoa
 * digitando de novo o que já digitou acima).
 */
export function mudarForma(
  e: EstadoDasFormas,
  id: number,
  forma: FormaDePagamento,
  total: bigint | null,
): EstadoDasFormas {
  if (forma === NOTA_PROMISSORIA) {
    const linha = e.linhas.find((l) => l.id === id)
    if (linha === undefined) return e
    const valor = total !== null && total > 0n ? textoDeCentavos(total) : linha.valor
    return { ...e, linhas: [{ id, forma, valor }] }
  }
  return { ...e, linhas: e.linhas.map((l) => (l.id === id ? { ...l, forma } : l)) }
}

export function mudarValor(e: EstadoDasFormas, id: number, valor: string): EstadoDasFormas {
  return { ...e, linhas: e.linhas.map((l) => (l.id === id ? { ...l, valor } : l)) }
}

/** As formas que a linha `id` pode escolher: as livres, e a dela própria. */
export function formasDaLinha(e: EstadoDasFormas, id: number): readonly FormaDePagamento[] {
  const outras = e.linhas.filter((l) => l.id !== id).map((l) => l.forma)
  // Com outra parte na lista, promissória não é opção (não se mistura).
  return FORMAS_DE_PAGAMENTO.filter(
    (f) => !outras.includes(f) && !(f === NOTA_PROMISSORIA && outras.length > 0),
  )
}

export type SituacaoDasPartes =
  /** O valor total ainda não foi digitado: não há contra o que somar. */
  | { readonly tipo: 'sem-total' }
  /** Alguma linha sem valor, ou com valor que não se lê. */
  | { readonly tipo: 'incompleta' }
  | { readonly tipo: 'falta'; readonly diferenca: bigint }
  | { readonly tipo: 'passou'; readonly diferenca: bigint }
  /** Fecha na soma, mas o domínio recusa por outro motivo (a mensagem é dele). */
  | { readonly tipo: 'invalida'; readonly mensagem: string }
  | {
      readonly tipo: 'fecha'
      readonly partes: { readonly forma: FormaDePagamento; readonly valor: bigint }[]
    }

/**
 * Compara o que foi digitado nas linhas com o valor do recebimento. A conta é a do
 * domínio (`quantoFalta`, `validarPartes`) — a tela não tem aritmética própria.
 */
export function situacaoDasPartes(total: bigint | null, e: EstadoDasFormas): SituacaoDasPartes {
  if (total === null || total <= 0n) return { tipo: 'sem-total' }
  const lidas: { forma: FormaDePagamento; valor: bigint }[] = []
  let incompleta = false
  for (const l of e.linhas) {
    const c = l.valor.trim() === '' ? null : centavosDoTexto(l.valor)
    if (c === null || c <= 0n) incompleta = true
    else lidas.push({ forma: l.forma, valor: c })
  }
  const dominio = lidas.map((p) => ({ forma: p.forma, valor: Dinheiro.deCentavos(p.valor) }))
  const falta = quantoFalta(Dinheiro.deCentavos(total), dominio).centavos
  if (falta > 0n) return { tipo: 'falta', diferenca: falta }
  if (falta < 0n) return { tipo: 'passou', diferenca: -falta }
  if (incompleta) return { tipo: 'incompleta' }
  const r = validarPartes(Dinheiro.deCentavos(total), dominio)
  if (r.tipo === 'erro') return { tipo: 'invalida', mensagem: r.erro.mensagem }
  return { tipo: 'fecha', partes: lidas }
}

export type CorpoDaForma =
  | { readonly forma: FormaDePagamento }
  | { readonly partes: { readonly forma: FormaDePagamento; readonly valor: bigint }[] }

/**
 * O que vai no corpo: `forma` (uma só) OU `partes` — nunca as duas. Com a lista
 * aberta mas só uma linha, ainda vai `partes` (o servidor aceita de 1 a 5).
 */
export function corpoDaForma(
  total: bigint | null,
  e: EstadoDasFormas,
): { readonly tipo: 'ok'; readonly corpo: CorpoDaForma } | { readonly tipo: 'erro'; readonly mensagem: string } {
  if (!e.multiplas) return { tipo: 'ok', corpo: { forma: e.forma } }
  const s = situacaoDasPartes(total, e)
  if (s.tipo === 'fecha') return { tipo: 'ok', corpo: { partes: s.partes } }
  return { tipo: 'erro', mensagem: mensagemDaSituacao(s, textoDinheiro) }
}

type EmTexto = (centavos: bigint) => string
const textoDinheiro: EmTexto = (c) => formatarDinheiro(c)

export function mensagemDaSituacao(s: SituacaoDasPartes, emTexto: EmTexto): string {
  switch (s.tipo) {
    case 'sem-total':
      return 'Informe o valor recebido para dividir entre as formas de pagamento.'
    case 'incompleta':
      return 'Preencha o valor de cada forma de pagamento ou tire a linha que não vai usar.'
    case 'falta':
      return `Falta ${emTexto(s.diferenca)}`
    case 'passou':
      return `Passou ${emTexto(s.diferenca)} — ajuste as formas`
    case 'invalida':
      return s.mensagem
    case 'fecha':
      return 'Fecha com o valor recebido.'
  }
}

/** Para o corpo JSON: centavos como string, nunca número (regra 1). */
export function corpoDaFormaEmTexto(
  c: CorpoDaForma,
): { forma: string } | { partes: { forma: string; valor: string }[] } {
  return 'forma' in c
    ? { forma: c.forma }
    : { partes: c.partes.map((p) => ({ forma: p.forma, valor: p.valor.toString() })) }
}

/**
 * "Pix R$ 40,00 + Cartão de crédito R$ 60,00" — a forma como as listas a mostram
 * quando há mais de uma parte. Com uma só, devolve `null` e a lista segue como
 * sempre. `valor` nulo (sem `valores`): só os nomes, "Pix + Cartão de crédito".
 */
export function resumoDasPartes(
  partes: readonly { readonly forma: string; readonly valor: string | null }[],
  emTexto: (centavos: bigint) => string,
): string | null {
  if (partes.length < 2) return null
  return partes
    .map((p) => {
      const nome = p.forma === '' ? 'Forma não informada' : p.forma
      return p.valor === null ? nome : `${nome} ${emTexto(BigInt(p.valor))}`
    })
    .join(' + ')
}

/**
 * O pagamento embutido (tarefa, conclusão) no corpo JSON: centavos como string e
 * `forma` OU `partes`. Um ponto só — o cartão da tarefa e a Nova tarefa mandam o
 * mesmo corpo, e escrito duas vezes ele diverge.
 */
export function pagamentoEmbutidoEmTexto(p: {
  readonly valor: bigint
  readonly forma?: string | undefined
  readonly partes?: readonly { readonly forma: string; readonly valor: bigint }[] | undefined
  readonly valorAberto?: bigint | undefined
}): {
  valor: string
  valorAberto: string
  forma?: string
  partes?: { forma: string; valor: string }[]
} {
  const base = { valor: p.valor.toString(), valorAberto: (p.valorAberto ?? 0n).toString() }
  if (p.partes !== undefined) {
    return { ...base, partes: p.partes.map((x) => ({ forma: x.forma, valor: x.valor.toString() })) }
  }
  return p.forma === undefined ? base : { ...base, forma: p.forma }
}

/**
 * O 409 `PARTES_ACIMA_DA_DIVIDA` (veto V-1): com várias formas, o servidor não
 * corta — recusa, porque cortar exigiria escolher DE QUAL forma tirar, e essa
 * escolha é da pessoa. Uma forma só continua sendo cortada no devido.
 *
 * `devido` só vem para quem tem `valores`; sem ele, a tela mostra só a mensagem.
 * Nada aqui reenvia nem redistribui: a tela ajusta o total e pede nova divisão.
 */
export function partesAcimaDaDivida(
  e: unknown,
): { readonly mensagem: string; readonly devido: bigint | null } | null {
  if (!(e instanceof ErroDaApi) || e.status !== 409 || e.codigo !== CODIGO_PARTES_ACIMA_DA_DIVIDA) {
    return null
  }
  const bruto = e.corpo?.['devido']
  return {
    mensagem:
      e.message !== ''
        ? e.message
        : 'O valor passa do que a paciente deve nesta dívida. Divida de novo entre as formas.',
    devido: typeof bruto === 'string' && /^\d+$/.test(bruto) ? BigInt(bruto) : null,
  }
}

/**
 * O teto que vale no campo de valor: o menor entre o saldo que a tela leu e o
 * devido que o servidor mandou no 409. Comparar dois limites não é calcular
 * saldo — os dois números vêm do servidor.
 */
export function tetoEfetivo(daLista: bigint | null, doServidor: bigint | null): bigint | null {
  if (daLista === null) return doServidor
  if (doServidor === null) return daLista
  return doServidor < daLista ? doServidor : daLista
}
