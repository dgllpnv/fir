import { ultimoInicioPermitido, type ItemParaCronograma } from '@fir/domain'

/**
 * As regras PURAS do montador — o que dá para testar sem React.
 *
 * Os LIMITES não moram aqui: vêm do contrato (`LIMITES_DO_PROGRAMA_ORCADO`,
 * `LIMITES_DO_PROGRAMA`), e quem monta a tela os entrega ao `Montador`. Um
 * número copiado para cá é como a tela aceita 104 sessões e o servidor responde
 * 400 com o caminho de um campo que a recepção nem vê.
 */

export type ItemNoMontador = {
  readonly chave: string
  readonly procedimentoId: string
  /** `0` = campo em branco (o envio recusa); nunca um `Number('')` mudo. */
  readonly sessoes: number
  readonly intervaloDias: number
  /** `''` = começa no início do programa, ou depois de `depoisDe`. */
  readonly inicio: string
  /**
   * A pessoa escolheu "Em outra data" e ainda não digitou a data. É um flag
   * PRÓPRIO, e não `inicio !== ''`: a tela nunca grava uma data que a pessoa
   * não escolheu (semear "hoje" viraria pergunta falsa de "já passou").
   */
  readonly emOutraData?: boolean
  readonly depoisDe: string
  readonly responsavelId: string
  readonly dose: string
  /** Texto digitado. Vira centavos na borda, nunca aqui. */
  readonly valor: string
}

export type EstadoDoMontador = {
  readonly inicio: string
  readonly itens: readonly ItemNoMontador[]
}

type Faixa = { readonly min: number; readonly max: number }

/** O formato dos limites dos dois contratos (orçamento e programa montado). */
export type LimitesDoMontador = {
  readonly itens: { readonly max: number }
  readonly sessoes: Faixa
  readonly intervaloDias: Faixa
  readonly dose: { readonly max: number }
}

/**
 * Texto de um campo numérico → inteiro dentro do contrato. Vazio e lixo viram
 * `0` (a tela mostra em branco); fração é descartada; acima do máximo, o máximo.
 */
export function numeroDoCampo(texto: string, faixa: { readonly max: number }): number {
  const n = Number.parseInt(texto, 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, faixa.max)
}

/**
 * Tira o item `k` e RENUMERA as chaves (`i1…in`).
 *
 * `depoisDe` é traduzido pela chave NOVA do mesmo item. Sem o mapa, quem
 * dependia do `i2` continuava escrito `i2` depois da renumeração — e passava a
 * apontar para outro item, ou para si mesmo.
 */
export function removerItem(
  itens: readonly ItemNoMontador[],
  k: number,
): readonly ItemNoMontador[] {
  if (itens.length <= 1) return itens
  const novaChave = new Map<string, string>()
  const sobraram = itens.filter((_, i) => i !== k)
  for (const [i, x] of itens.entries()) {
    if (i === k) continue
    novaChave.set(x.chave, `i${(i < k ? i : i - 1) + 1}`)
  }
  return sobraram.map((x) => ({
    ...x,
    chave: novaChave.get(x.chave)!,
    // Dependia do removido: volta a começar no início do programa.
    depoisDe: x.depoisDe === '' ? '' : (novaChave.get(x.depoisDe) ?? ''),
  }))
}

/**
 * Os itens da PRÉVIA: todos, inclusive o que ainda não tem procedimento.
 *
 * Filtrar os incompletos fazia "Depois de outro item" apontar para um item que
 * a prévia não conhecia, e o domínio respondia ITEM_INEXISTENTE. Sessões em
 * branco contam 1 só para a conta não cair — o envio as recusa.
 */
export function itensParaPrevia(itens: readonly ItemNoMontador[]): ItemParaCronograma[] {
  return itens.map((x) => ({
    chave: x.chave,
    sessoes: Math.max(1, x.sessoes),
    intervaloDias: Math.max(1, x.intervaloDias),
    inicio: x.inicio === '' ? null : x.inicio,
    depoisDe: x.depoisDe === '' ? null : x.depoisDe,
  }))
}

/**
 * "Em outra data": o item entra no modo da data própria com o campo VAZIO, e o
 * envio só libera quando a pessoa o preencher. Semear uma data (hoje, amanhã)
 * seria gravar o que ela não escolheu.
 */
export const comecaEmOutraData = () => ({ inicio: '', depoisDe: '', emOutraData: true })

/** O modo "Em outra data" está valendo: por flag (campo ainda vazio) ou por data. */
export const estaEmOutraData = (x: Pick<ItemNoMontador, 'inicio' | 'emOutraData'>): boolean =>
  x.emOutraData === true || x.inicio !== ''

/**
 * O que o contrato recusaria, dito ANTES do envio e com palavra de recepção.
 * `hoje` é o do servidor (a faixa de um ano é conferida de novo lá).
 */
export function problemasDoMontador(
  estado: EstadoDoMontador,
  limites: LimitesDoMontador,
  hoje: string,
): string | null {
  if (estado.itens.length > limites.itens.max) {
    return `Até ${limites.itens.max} procedimentos por programa.`
  }
  const limite = ultimoInicioPermitido(hoje)
  for (const [i, x] of estado.itens.entries()) {
    const n = `Item ${i + 1}: `
    if (x.procedimentoId === '') return 'Escolha o procedimento de cada item do programa.'
    if (!Number.isInteger(x.sessoes) || x.sessoes < limites.sessoes.min || x.sessoes > limites.sessoes.max) {
      return `${n}informe de ${limites.sessoes.min} a ${limites.sessoes.max} sessões.`
    }
    if (
      !Number.isInteger(x.intervaloDias) ||
      x.intervaloDias < limites.intervaloDias.min ||
      x.intervaloDias > limites.intervaloDias.max
    ) {
      return `${n}o intervalo vai de ${limites.intervaloDias.min} a ${limites.intervaloDias.max} dias.`
    }
    if (x.dose.length > limites.dose.max) {
      return `${n}a dose aceita até ${limites.dose.max} caracteres.`
    }
    if (estaEmOutraData(x) && x.inicio === '') {
      return `${n}escolha a data da primeira sessão.`
    }
    if (x.inicio !== '' && x.inicio > limite) {
      return `${n}a data da primeira sessão passa de um ano a partir de hoje.`
    }
  }
  return null
}
