import { diasEntre, somarDias } from './relogio'
import { erro, erroDe, ok, type Result } from './resultado'

/**
 * O CRONOGRAMA DO PROGRAMA — puro, sobre listas, sem relógio e sem I/O.
 *
 * O programa não recalcula a agenda a cada leitura: ele a escreve UMA vez, na
 * montagem, e só a move quando alguém pede. É o que torna verdadeira a frase
 * do MANUAL cap. 11 — *"Mudanças de sessões e intervalo valem para novas
 * adesões; quem já está no programa mantém as sessões programadas"* — sem
 * nenhum código a defendendo.
 */

export type ItemParaCronograma = {
  readonly chave: string
  readonly sessoes: number
  readonly intervaloDias: number
  /** `null` = começa no início do programa, ou logo depois do item de `depoisDe`. */
  readonly inicio: string | null
  readonly depoisDe: string | null
}

export type SessaoProgramada = {
  readonly itemChave: string
  readonly indice: number // 1..total, DENTRO do item
  readonly total: number
  readonly prazo: string // dia civil
}

/**
 * A ordem em que os itens podem ser datados: pai antes de filho.
 *
 * Busca em profundidade com marcação tripla (branco/cinza/preto): o cinza
 * reencontrado **é** o ciclo, e o caminho cinza dá os nomes para a mensagem.
 * Contar graus de entrada (Kahn) detecta o ciclo mas não sabe dizer quais
 * itens o formam — e "há um ciclo no programa" sem dizer onde é um erro que a
 * recepção não consegue corrigir.
 */
export function ordenarItens(itens: readonly ItemParaCronograma[]): Result<readonly string[]> {
  const porChave = new Map<string, ItemParaCronograma>()
  for (const it of itens) {
    if (porChave.has(it.chave)) {
      return erro(
        erroDe('CHAVE_REPETIDA', `O item "${it.chave}" aparece duas vezes no programa.`),
      )
    }
    porChave.set(it.chave, it)
  }

  const cor = new Map<string, 'cinza' | 'preto'>()
  const ordem: string[] = []
  const caminho: string[] = []

  const visitar = (chave: string): Result<true> => {
    const c = cor.get(chave)
    if (c === 'preto') return ok(true)
    if (c === 'cinza') {
      const dai = caminho.slice(caminho.indexOf(chave))
      return erro(
        erroDe(
          'CICLO_NO_PROGRAMA',
          `Os itens ${dai.map((x) => `"${x}"`).join(', ')} dependem uns dos outros em círculo. ` +
            'Escolha um deles para começar na data de início do programa.',
        ),
      )
    }

    const it = porChave.get(chave)
    if (it === undefined) {
      return erro(
        erroDe('ITEM_INEXISTENTE', `O item "${chave}" não existe neste programa.`),
      )
    }

    cor.set(chave, 'cinza')
    caminho.push(chave)
    if (it.depoisDe !== null) {
      const r = visitar(it.depoisDe)
      if (r.tipo === 'erro') return r
    }
    caminho.pop()
    cor.set(chave, 'preto')
    ordem.push(chave)
    return ok(true)
  }

  for (const it of itens) {
    const r = visitar(it.chave)
    if (r.tipo === 'erro') return r
  }
  return ok(ordem)
}

/** `n` datas a partir de `inicio`, de `intervaloDias` em `intervaloDias`. */
export function datasDasSessoes(
  inicio: string,
  n: number,
  intervaloDias: number,
): readonly string[] {
  return Array.from({ length: n }, (_, i) => somarDias(inicio, i * intervaloDias))
}

/**
 * Todas as sessões do programa, em ordem cronológica estável.
 *
 * O início de cada item, na ordem de precedência MEDIDA no protótipo
 * (`agendaItens`, linha 5428):
 *
 *   1. `inicio` próprio, quando houver — é a resolução já tomada, e remontar o
 *      cronograma a partir da linha gravada não pode mover a agenda de novo;
 *   2. senão, a última do item de `depoisDe` **mais o intervalo DESTE item** —
 *      é o intervalo do dependente, não o do pai, e os dois só coincidem
 *      quando são iguais, que é o caso com que todo mundo confere;
 *   3. senão, o início do programa.
 */
export function montarCronograma(
  inicioDoPrograma: string,
  itens: readonly ItemParaCronograma[],
): Result<readonly SessaoProgramada[]> {
  if (itens.length === 0) {
    return erro(erroDe('PROGRAMA_SEM_ITEM', 'Um programa precisa de pelo menos um procedimento.'))
  }

  const ordem = ordenarItens(itens)
  if (ordem.tipo === 'erro') return ordem

  const porChave = new Map(itens.map((it) => [it.chave, it]))
  const posicao = new Map(itens.map((it, i) => [it.chave, i]))
  const datasPorItem = new Map<string, readonly string[]>()

  for (const chave of ordem.valor) {
    const it = porChave.get(chave)!
    let inicio: string
    if (it.inicio !== null) inicio = it.inicio
    else if (it.depoisDe !== null) {
      // O pai já foi datado: a ordenação topológica garante isso.
      const doPai = datasPorItem.get(it.depoisDe)!
      inicio = somarDias(doPai[doPai.length - 1]!, it.intervaloDias)
    } else inicio = inicioDoPrograma

    datasPorItem.set(chave, datasDasSessoes(inicio, it.sessoes, it.intervaloDias))
  }

  const sessoes: SessaoProgramada[] = []
  for (const [chave, datas] of datasPorItem) {
    const total = porChave.get(chave)!.sessoes
    datas.forEach((prazo, i) => sessoes.push({ itemChave: chave, indice: i + 1, total, prazo }))
  }

  // Cronológica e ESTÁVEL: empate de data resolve pela ordem em que o item foi
  // declarado, depois pelo índice da sessão. Sem o desempate, dois itens que
  // começam no mesmo dia alternariam de posição entre leituras, e a tela da
  // enfermagem mudaria de ordem sem nada ter mudado.
  sessoes.sort(
    (a, b) =>
      (a.prazo < b.prazo ? -1 : a.prazo > b.prazo ? 1 : 0) ||
      posicao.get(a.itemChave)! - posicao.get(b.itemChave)! ||
      a.indice - b.indice,
  )
  return ok(sessoes)
}

export type SessaoExistente = {
  readonly tarefaId: string
  readonly itemChave: string
  readonly indice: number
  readonly prazo: string
  readonly status: 'aberta' | 'concluida' | 'cancelada'
}

export type MudancaDePrazo = { readonly tarefaId: string; readonly prazo: string }

/**
 * O que muda de prazo quando a sessão `indice` do item `itemChave` foi
 * realizada em `realizadaEm`. Devolve SÓ as mudanças — nunca a lista inteira.
 *
 * Quem devolve a lista inteira faz o serviço reescrever 12 linhas para mover
 * 3, e a trilha de auditoria passa a registrar nove mudanças que não
 * aconteceram. A trilha é prova (regra 20), e prova com ruído é prova que
 * ninguém lê.
 *
 * Alcança: as sessões ABERTAS do mesmo item com `indice` maior, e, em cascata,
 * os itens que começam depois dele **e ainda não começaram** (nenhuma sessão
 * concluída). Nunca toca no passado, nunca toca em concluída ou cancelada.
 */
export function reprogramar(entrada: {
  readonly itens: readonly ItemParaCronograma[]
  readonly sessoes: readonly SessaoExistente[]
  readonly itemChave: string
  readonly indice: number
  readonly realizadaEm: string
}): Result<readonly MudancaDePrazo[]> {
  const { itens, sessoes, itemChave, indice, realizadaEm } = entrada

  const porChave = new Map(itens.map((it) => [it.chave, it]))
  const oItem = porChave.get(itemChave)
  if (oItem === undefined) {
    return erro(erroDe('ITEM_INEXISTENTE', `O item "${itemChave}" não existe neste programa.`))
  }

  // Prazo vigente de cada sessão: começa no gravado e vai sendo substituído
  // pelo que esta reprogramação decidir, porque a cascata lê o fim do pai
  // DEPOIS de o pai ter sido movido.
  const prazoVigente = new Map(sessoes.map((s) => [s.tarefaId, s.prazo]))
  const mudancas: MudancaDePrazo[] = []
  const mover = (s: SessaoExistente, prazo: string) => {
    if (prazoVigente.get(s.tarefaId) === prazo) return
    prazoVigente.set(s.tarefaId, prazo)
    mudancas.push({ tarefaId: s.tarefaId, prazo })
  }

  const doItem = (chave: string) => sessoes.filter((s) => s.itemChave === chave)
  const validasDe = (chave: string) => doItem(chave).filter((s) => s.status !== 'cancelada')

  /**
   * A ÂNCORA É A SESSÃO REALIZADA, não a anterior.
   *
   * `prazo = realizadaEm + (indiceDela − indiceRealizada) × intervalo`. É o
   * que o `Code.gs:444` e o protótipo fazem, e a diferença é visível: ancorar
   * na sessão anterior faz a série deslizar um pouco a cada toque, porque o
   * erro de cada passo entra no passo seguinte. Com a âncora fixa, reprogramar
   * duas vezes seguidas sem nova conclusão não muda nada.
   */
  for (const s of doItem(itemChave)) {
    if (s.status !== 'aberta' || s.indice <= indice) continue
    mover(s, somarDias(realizadaEm, (s.indice - indice) * oItem.intervaloDias))
  }

  // CASCATA, em largura: cada item empurrado pode empurrar os seus.
  const fila = [itemChave]
  const jaVisitado = new Set([itemChave])
  while (fila.length > 0) {
    const pai = fila.shift()!
    const validasDoPai = validasDe(pai)
    if (validasDoPai.length === 0) continue
    const fimDoPai = validasDoPai.map((s) => prazoVigente.get(s.tarefaId)!).sort().at(-1)!

    for (const dep of itens) {
      if (dep.depoisDe !== pai || jaVisitado.has(dep.chave)) continue
      const suas = validasDe(dep.chave)
      // "Ainda não começou": nenhuma sessão viva dele saiu de aberta. Mover a
      // agenda de um item que já teve aplicação seria reescrever o passado da
      // paciente.
      if (suas.length === 0 || !suas.every((s) => s.status === 'aberta')) continue

      const inicio = somarDias(fimDoPai, dep.intervaloDias)
      for (const s of suas) mover(s, somarDias(inicio, (s.indice - 1) * dep.intervaloDias))
      jaVisitado.add(dep.chave)
      fila.push(dep.chave)
    }
  }

  return ok(mudancas)
}

export type SituacaoDoPrograma = 'encerrado' | 'concluido' | 'atrasado' | 'hoje' | 'emdia'

/**
 * A situação que a tela mostra, derivada das sessões — nunca gravada.
 *
 * A ordem é deliberada e é a do protótipo (`statsAdesao`): encerrado vence
 * tudo; concluído exige **nenhuma aberta E alguma feita**, porque um programa
 * cujas sessões foram todas canceladas não é um tratamento concluído;
 * atrasado vence hoje, e hoje vence em dia.
 *
 * Sessão **cancelada** não conta de nenhum dos dois lados. Contá-la como
 * aberta deixaria todo programa encerrado parecendo ativo; contá-la como feita
 * daria "Programa concluído" a um tratamento que ninguém fez.
 */
export function situacaoDoPrograma(entrada: {
  readonly encerrado: boolean
  readonly sessoes: readonly SessaoExistente[]
  readonly hojeDaClinica: string
}): { readonly situacao: SituacaoDoPrograma; readonly diasDeAtraso: number } {
  const { encerrado, sessoes, hojeDaClinica: h } = entrada
  if (encerrado) return { situacao: 'encerrado', diasDeAtraso: 0 }

  const validas = sessoes.filter((s) => s.status !== 'cancelada')
  const abertas = validas.filter((s) => s.status === 'aberta')
  const feitas = validas.filter((s) => s.status === 'concluida')

  if (abertas.length === 0 && feitas.length > 0) return { situacao: 'concluido', diasDeAtraso: 0 }

  const atrasadas = abertas.filter((s) => s.prazo < h)
  if (atrasadas.length > 0) {
    const maisAntiga = atrasadas.map((s) => s.prazo).sort()[0]!
    return { situacao: 'atrasado', diasDeAtraso: diasEntre(maisAntiga, h) }
  }
  if (abertas.some((s) => s.prazo === h)) return { situacao: 'hoje', diasDeAtraso: 0 }
  return { situacao: 'emdia', diasDeAtraso: 0 }
}
