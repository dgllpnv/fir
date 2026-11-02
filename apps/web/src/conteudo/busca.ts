import { type ChaveDePermissao, type Perfil, temPerm } from '@fir/domain'
import type { CapituloDoManual, PerguntaDaAjuda, SecaoDoManual } from './tipos'

/**
 * **A busca da Ajuda e do manual** — funções puras, nenhuma delas toca a tela.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ISTO NÃO É "CÁLCULO NO FRONT", E A DISTINÇÃO IMPORTA
 *
 * O `CLAUDE.md` proíbe o front calcular **o que o servidor também calcula** —
 * saldo, total, LTV, funil. Busca de texto em conteúdo **estático e versionado
 * no repositório** não é nenhum desses: não há número, não há dado de clínica,
 * e o servidor não tem o conteúdo (ele mora no bundle, igual para as quatro
 * clínicas). Mandá-lo para a API seria uma ida de rede por tecla digitada para
 * procurar numa lista que já está na memória.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Dobra acento e caixa **preservando o comprimento**, caractere por
 * caractere.
 *
 * O `semAcento` dela faz `normalize('NFD').replace(/[\u0300-\u036f]/g, '')` na
 * string inteira, e isso serve para COMPARAR — mas não para DESTACAR: a
 * decomposição muda o comprimento, e um índice achado no texto dobrado não
 * aponta mais para o mesmo caractere do original. Dobrando um caractere por
 * vez, `dobrar(s).length === s.length` sempre, e o índice volta direto.
 *
 * Quando a decomposição de um caractere não couber em um (uma ligadura, por
 * exemplo), o original fica — é melhor não destacar do que destacar deslocado.
 */
export function dobrar(texto: string): string {
  let saida = ''
  for (const c of texto) {
    const sem = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    saida += sem.length === c.length ? sem.toLowerCase() : c.toLowerCase()
  }
  return saida
}

/**
 * O que a pessoa digitou, virado em termos de busca.
 *
 * `length > 1` é dela, e é o que evita que um "a" solto casa com tudo.
 */
export const termosDeBusca = (digitado: string): string[] =>
  dobrar(digitado)
    .split(/\s+/)
    .filter((t) => t.length > 1)

/**
 * **Uma função, e não a expressão dela escrita em dois lugares.**
 *
 * `S.user.admin || pode("painel") || pode("config")` aparece em `vAjuda` e em
 * `vManual`; aqui `temPerm` já devolve verdadeiro para a administradora, então
 * o `admin` não precisa de um terceiro termo — é a matriz que responde (regra
 * 16), não um booleano.
 */
export function podeVerConteudoDeGestao(
  usuario: { admin: boolean; perfilId: string | null },
  perfis: readonly Perfil[],
): boolean {
  const quem = { admin: usuario.admin, perfilId: usuario.perfilId ?? '' }
  const chaves: ChaveDePermissao[] = ['painel', 'config']
  return chaves.some((c) => temPerm(quem, perfis, c))
}

/** As perguntas que esta pessoa vê. */
export const ajudaVisivel = (
  perguntas: readonly PerguntaDaAjuda[],
  gestao: boolean,
): PerguntaDaAjuda[] => perguntas.filter((p) => gestao || p.gestao !== true)

/**
 * Os capítulos que esta pessoa vê — **e as seções de dentro também**.
 *
 * Os dois filtros, como nela: o capítulo 10 inteiro é de gestão, e dentro do
 * capítulo 12 (que não é) há quatro seções que são. Filtrar só o capítulo
 * entregaria "Unidades de medida (administrativo)" à enfermagem; filtrar só a
 * seção entregaria o capítulo "Painel" com o título e nada dentro.
 */
export const manualVisivel = (
  capitulos: readonly CapituloDoManual[],
  gestao: boolean,
): CapituloDoManual[] =>
  capitulos
    .filter((c) => gestao || c.gestao !== true)
    .map((c) => ({ ...c, secoes: c.secoes.filter((s) => gestao || s.gestao !== true) }))
    .filter((c) => c.secoes.length > 0)

/**
 * A pontuação de uma pergunta — portada do `desenhar` de `vAjuda`.
 *
 * `null` quando **algum** termo não casa em lugar nenhum: a busca é `E`, não
 * `OU`. Com `OU`, digitar "pagamento parcial" devolveria as treze respostas
 * que falam de pagamento, e a que responde a pergunta ficaria no meio.
 *
 * Os pesos são os dela: título 3, palavra-chave ou tema 2, corpo 1 — e o
 * `else if` importa, porque um termo pontua **uma vez**, pelo lugar mais
 * forte em que aparece.
 */
export function pontuarPergunta(p: PerguntaDaAjuda, termos: readonly string[]): number | null {
  const titulo = dobrar(p.pergunta)
  const chaves = dobrar(`${p.chaves} ${p.tema}`)
  const corpo = dobrar(p.resposta)
  let pontos = 0
  for (const t of termos) {
    if (titulo.includes(t)) pontos += 3
    else if (chaves.includes(t)) pontos += 2
    else if (corpo.includes(t)) pontos += 1
    else return null
  }
  return pontos
}

/** As perguntas que casam, da mais forte para a mais fraca. */
export function buscarNaAjuda(
  perguntas: readonly PerguntaDaAjuda[],
  termos: readonly string[],
): PerguntaDaAjuda[] {
  if (termos.length === 0) return [...perguntas]
  return perguntas
    .flatMap((p) => {
      const pontos = pontuarPergunta(p, termos)
      return pontos === null ? [] : [{ p, pontos }]
    })
    .sort((a, b) => b.pontos - a.pontos)
    .map((x) => x.p)
}

export type AchadoNoManual = {
  readonly capitulo: CapituloDoManual
  readonly secao: SecaoDoManual
}

/** O rótulo do capítulo, pronto: `10. Painel`. */
export const rotuloDoCapitulo = (c: CapituloDoManual): string => `${c.numero}. ${c.titulo}`

/**
 * Os trechos do manual que casam — portado do `desenhar` de `vManual`.
 *
 * Os pesos dela: título da seção 3, corpo 1, título do capítulo 1. O `**` sai
 * do corpo antes de comparar, senão "mês" não acharia `**Recebido no mês**`.
 */
export function buscarNoManual(
  capitulos: readonly CapituloDoManual[],
  termos: readonly string[],
): AchadoNoManual[] {
  if (termos.length === 0) return []
  const achados: { achado: AchadoNoManual; pontos: number }[] = []
  for (const capitulo of capitulos) {
    const doCapitulo = dobrar(rotuloDoCapitulo(capitulo))
    for (const secao of capitulo.secoes) {
      const titulo = dobrar(secao.titulo)
      const corpo = dobrar(secao.texto.replaceAll('**', ''))
      let pontos = 0
      let casou = true
      for (const t of termos) {
        if (titulo.includes(t)) pontos += 3
        else if (corpo.includes(t)) pontos += 1
        else if (doCapitulo.includes(t)) pontos += 1
        else {
          casou = false
          break
        }
      }
      if (casou) achados.push({ achado: { capitulo, secao }, pontos })
    }
  }
  return achados.sort((a, b) => b.pontos - a.pontos).map((x) => x.achado)
}
