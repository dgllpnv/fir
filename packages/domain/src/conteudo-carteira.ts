/**
 * G8 1B — reuniões, documentos e materiais da carteira (V13, V14, X2).
 *
 * Só as DECISÕES, puras: que linhas de encaminhamento viram tarefa, qual é a
 * saúde derivada do cliente, qual é o programa dele e que materiais ele vê.
 * Gravar, ler e conferir grupo é do serviço (`apps/api/src/carteira/conteudo`).
 */
import { type PerfilDaCarteira, temPermCarteira } from './carteira'
import type { SaudeDoCliente, SessaoDaCarteira } from './prospeccao'
import { erro, erroDe, ok, type Result } from './resultado'

/* ────────────────────────────────────────────────────────────────────────
 * ENCAMINHAMENTOS — "um por linha", e cada linha pode virar uma tarefa
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Teto de tarefas por ata. O protótipo não tem teto; aqui ele existe porque
 * cada linha vira uma `Tarefa interna` numa transação só, e um texto colado
 * com trezentas linhas lotaria a rotina de alguém sem ninguém perceber.
 * 50 é o limite do CHECK de `encaminhamentos_de_reuniao.ordem`.
 */
export const MAX_ENCAMINHAMENTOS = 50
/** O título de uma `Tarefa interna` que nasce de um encaminhamento. */
export const MAX_CARACTERES_DO_ENCAMINHAMENTO = 300

/**
 * O mesmo recorte de `salvarReuniao` (protótipo L1706):
 * `x.replace(/^[\s•*\-–\d.)]+/, "").trim()`, descartando linha vazia.
 */
export function linhasDeEncaminhamento(texto: string): Result<string[]> {
  const linhas = texto
    .split(/\r?\n/)
    .map((x) => x.replace(/^[\s•*\-–\d.)]+/, '').trim())
    .filter((x) => x.length > 0)
  if (linhas.length > MAX_ENCAMINHAMENTOS) {
    return erro(
      erroDe(
        'ENCAMINHAMENTOS_DEMAIS',
        `Uma reunião cria no máximo ${MAX_ENCAMINHAMENTOS} tarefas. Junte os encaminhamentos parecidos.`,
      ),
    )
  }
  if (linhas.some((l) => l.length > MAX_CARACTERES_DO_ENCAMINHAMENTO)) {
    return erro(
      erroDe(
        'ENCAMINHAMENTO_LONGO',
        `Cada encaminhamento vira o título de uma tarefa: até ${MAX_CARACTERES_DO_ENCAMINHAMENTO} caracteres por linha.`,
      ),
    )
  }
  return ok(linhas)
}

/* ────────────────────────────────────────────────────────────────────────
 * SAÚDE DERIVADA (PP-3)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * A saúde do cliente é o registro MAIS RECENTE entre checkin interno e
 * reunião registrada (PP-3). No protótipo, salvar a reunião sobrescreve
 * `c.saude` (L1711) — "o último que escreveu vence". Aqui ela continua
 * DERIVADA (nunca um campo editável, CONTEXT.md), com a reunião como fonte.
 *
 * `em` é o instante do registro (ISO-8601 UTC), não a data da reunião: uma
 * ata de um mês atrás, registrada hoje, decide hoje — como no protótipo.
 * Registro sem saúde (ata antiga, sem o campo) não apaga a anterior.
 */
export function saudeDerivadaDoCliente(
  registros: readonly { readonly em: string; readonly saude: SaudeDoCliente | null }[],
): SaudeDoCliente | null {
  let melhor: { em: number; saude: SaudeDoCliente } | null = null
  for (const r of registros) {
    if (r.saude === null) continue
    const em = Date.parse(r.em)
    if (melhor === null || em > melhor.em) melhor = { em, saude: r.saude }
  }
  return melhor?.saude ?? null
}

/* ────────────────────────────────────────────────────────────────────────
 * PROGRAMA E MATERIAIS
 * ──────────────────────────────────────────────────────────────────────── */

export const PROGRAMAS_DO_METODO = ['Comercial', 'Financeiro', 'Operações', 'Gestão'] as const
export type ProgramaDoMetodo = (typeof PROGRAMAS_DO_METODO)[number]

/**
 * `programaPadrao` (protótipo L2205). `areaFoco` ainda não existe no cadastro
 * (ticket 0.4); até lá chega `null` e o programa sai do produto.
 */
export function programaDoCliente(c: { readonly areaFoco: string | null; readonly produto: string }): ProgramaDoMetodo {
  const a = c.areaFoco ?? ''
  if (a === 'Gestão' || /Gestão FIR/.test(c.produto)) return 'Gestão'
  if ((PROGRAMAS_DO_METODO as readonly string[]).includes(a)) return a as ProgramaDoMetodo // estreitado pelo includes acima
  if (a === 'Processos' || a === 'Pessoas') return 'Operações'
  return 'Comercial'
}

/**
 * `materiaisDoCliente` (L2706–2712): dos materiais GERAIS que podem ir para a
 * cliente, os que o programa dela inclui (ou "Todos") e os de outros
 * programas — "porta natural para a próxima contratação". O de uso interno
 * nunca aparece na ficha do cliente.
 */
export function materiaisParaOCliente<M extends { readonly programas: readonly string[]; readonly usoInterno: boolean }>(
  programa: ProgramaDoMetodo,
  materiais: readonly M[],
): { doPrograma: M[]; deOutrosProgramas: M[] } {
  const podemIr = materiais.filter((m) => !m.usoInterno)
  const doPrograma = podemIr.filter((m) => m.programas.includes(programa) || m.programas.includes('Todos'))
  return { doPrograma, deOutrosProgramas: podemIr.filter((m) => !doPrograma.includes(m)) }
}

/* ────────────────────────────────────────────────────────────────────────
 * QUEM ADMINISTRA O CONTEÚDO
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Arquivar reunião ou documento, "Compartilhar todas" e escrever na
 * biblioteca geral: no protótipo, só a diretoria (`admin()`). O gate de
 * segurança (A-9, A-18) pede a chave `carteira.administrar` concedida pelo
 * Operador (ticket 0.5). `temPermCarteira` já nega a chave a `escopo='grupo'`
 * (A-5); o `escopo === 'geral'` explícito fica como a segunda trava.
 */
export function podeAdministrarConteudo(sessao: SessaoDaCarteira & PerfilDaCarteira): boolean {
  return sessao.escopo === 'geral' && temPermCarteira(sessao, 'carteira.administrar')
}
