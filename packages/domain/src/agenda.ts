/**
 * A agenda do sistema da clínica → o cartão da jornada (ADR 0019).
 *
 * Tudo aqui é PURO: o que extrair de um compromisso, quando dois telefones
 * são o mesmo, e o que a sincronização faz com o cartão. Ler o feed, falar
 * com o banco e escrever o histórico ficam no adaptador da API. A heurística
 * de extração mora neste arquivo e só aqui, porque o formato que cada sistema
 * grava no título (P-7) ainda vai ser calibrado na clínica piloto, e calibrar
 * deve significar mexer num lugar só, com teste.
 */
import type { Etapa } from './jornada'
import { normalizarNome } from './semelhanca'

// ---------------------------------------------------------------------------
// Telefone
// ---------------------------------------------------------------------------

/**
 * Só os dígitos, sem zero de discagem e sem o 55 do Brasil.
 *
 * O compromisso vem com `+55 (71) 99999-0000` e o cadastro com `71999990000`:
 * a mesma pessoa. O `55` só cai quando sobra um número nacional completo
 * (10 ou 11 dígitos), senão um DDD 55 (RS) seria comido.
 */
export function telefoneNacional(texto: string): string {
  let d = texto.replace(/\D/g, '').replace(/^0+/, '')
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
  return d
}

/**
 * Os dois telefones são da mesma pessoa?
 *
 * Aceita a diferença do NONO DÍGITO: cadastro antigo com `71 9999-0000` e
 * compromisso novo com `71 99999-0000`. Mesmo DDD e mesmos 8 finais, um com
 * o 9 na frente e o outro sem, é o mesmo celular. Número curto (sem DDD) não
 * casa com nada: oito dígitos iguais em DDDs diferentes são pessoas
 * diferentes, e vínculo errado com paciente é pior que cadastro duplicado
 * marcado para conferir.
 */
export function mesmoTelefone(a: string, b: string): boolean {
  const x = telefoneNacional(a)
  const y = telefoneNacional(b)
  if (x.length < 10 || y.length < 10 || x.length > 11 || y.length > 11) return false
  if (x === y) return true
  const semNono = (n: string): string => (n.length === 11 && n[2] === '9' ? n.slice(0, 2) + n.slice(3) : n)
  return semNono(x) === semNono(y)
}

/** Os 8 finais: o pré-filtro que o banco consegue usar antes de `mesmoTelefone`. */
export function finalDoTelefone(texto: string): string | null {
  const d = telefoneNacional(texto)
  return d.length >= 10 ? d.slice(-8) : null
}

// ---------------------------------------------------------------------------
// Extração do compromisso
// ---------------------------------------------------------------------------

export type TextoDoCompromisso = {
  readonly titulo: string
  readonly descricao: string
}

export type DadosDoCompromisso = {
  readonly nome: string | null
  readonly telefone: string | null
}

/**
 * Sequência que parece telefone: 10 a 13 dígitos, com os separadores que as
 * agendas usam. Menos de 10 é número de prontuário, sala ou horário.
 */
const PARECE_TELEFONE = /(?:\+?\d[\d\s().-]{8,18}\d)/g

function primeiroTelefone(texto: string): string | null {
  for (const m of texto.match(PARECE_TELEFONE) ?? []) {
    const d = telefoneNacional(m)
    if (d.length === 10 || d.length === 11) return d
  }
  return null
}

/** `Paciente: Maria`, `Nome - Maria`, `Telefone: (71) …` na descrição. */
function campoRotulado(descricao: string, rotulos: readonly string[]): string | null {
  for (const linha of descricao.split(/\r?\n/)) {
    const m = /^\s*([\p{L} ]{3,20})\s*[:=-]\s*(.+?)\s*$/u.exec(linha)
    if (m === null) continue
    if (rotulos.includes(normalizarNome(m[1] ?? ''))) return m[2] ?? null
  }
  return null
}

const ROTULOS_DE_NOME = ['paciente', 'nome', 'cliente', 'nome do paciente', 'nome da paciente']
const ROTULOS_DE_TELEFONE = ['telefone', 'celular', 'whatsapp', 'fone', 'tel', 'contato']

/**
 * Palavras que, sozinhas num pedaço do título, dizem o TIPO e não o nome.
 * "Consulta - Maria Silva" e "Maria Silva | Retorno" têm de dar "Maria Silva".
 */
const PALAVRAS_DE_TIPO = new Set([
  'consulta',
  'retorno',
  'procedimento',
  'avaliacao',
  'sessao',
  'primeira vez',
  'primeira consulta',
  'reconsulta',
  'aplicacao',
  'atendimento',
  'agendamento',
  'online',
  'presencial',
  'teleconsulta',
])

/**
 * Nome e telefone de um compromisso.
 *
 * Ordem: campo rotulado na descrição ("Paciente: …", "Telefone: …") vence;
 * senão o título, partido nos separadores que as agendas usam, sem os
 * pedaços que são telefone, tipo ou procedimento do catálogo. Nome sem
 * nenhuma letra é `null`: compromisso sem nome não vira paciente.
 */
export function dadosDoCompromisso(
  t: TextoDoCompromisso,
  procedimentos: readonly string[] = [],
): DadosDoCompromisso {
  const telefone =
    primeiroTelefone(campoRotulado(t.descricao, ROTULOS_DE_TELEFONE) ?? '') ??
    primeiroTelefone(t.titulo) ??
    primeiroTelefone(t.descricao)

  const doCatalogo = new Set(procedimentos.map(normalizarNome))
  const limpar = (s: string): string =>
    s
      .replace(PARECE_TELEFONE, ' ')
      // O hífen fica: "Ana-Clara" cadastrada com hífen só casa pelo nome
      // exato se o hífen sobreviver aqui.
      .replace(/[^\p{L}\p{M}' .-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[-. ]+|[-. ]+$/g, '')

  const rotulado = campoRotulado(t.descricao, ROTULOS_DE_NOME)
  if (rotulado !== null) {
    const nome = limpar(rotulado)
    if (/\p{L}/u.test(nome)) return { nome: nome.slice(0, 120), telefone }
  }

  const pedacos = t.titulo
    .split(/\s[-–—|/:•]\s|:\s|[|•()[\]]|\s[-–—]|[-–—]\s/)
    .map(limpar)
    .filter((p) => /\p{L}/u.test(p))
    .filter((p) => !PALAVRAS_DE_TIPO.has(normalizarNome(p)) && !doCatalogo.has(normalizarNome(p)))
    // "Dra. Ana" / "Dr Paulo" é o PROFISSIONAL, não a paciente.
    .filter((p) => !/^dr[a]?\.?\s/i.test(p))

  const nome = pedacos[0]
  return { nome: nome === undefined ? null : nome.slice(0, 120), telefone }
}

export type TipoDaAgenda = 'Consulta agendada' | 'Procedimento agendado'

/**
 * Procedimento quando o texto diz "procedimento" ou cita um procedimento
 * ativo do catálogo DA CLÍNICA; consulta em todo o resto. Palavra inteira:
 * "Botox" casa "botox facial", e "Lipo" não casa "Lipoaspiração" por acaso.
 */
export function tipoDoCompromisso(
  t: TextoDoCompromisso,
  procedimentos: readonly string[] = [],
): TipoDaAgenda {
  const texto = ` ${normalizarNome(`${t.titulo} ${t.descricao}`).replace(/[^a-z0-9]+/g, ' ')} `
  if (texto.includes(' procedimento ')) return 'Procedimento agendado'
  for (const p of procedimentos) {
    const n = normalizarNome(p).replace(/[^a-z0-9]+/g, ' ').trim()
    if (n.length >= 3 && texto.includes(` ${n} `)) return 'Procedimento agendado'
  }
  return 'Consulta agendada'
}

/** A lista padrão de "isto não é paciente" (ADR 0019, decisão 10). */
export const PALAVRAS_PARA_IGNORAR_PADRAO: readonly string[] = [
  'bloqueio',
  'bloqueado',
  'almoco',
  'reuniao',
  'ferias',
  'feriado',
  'intervalo',
  'indisponivel',
]

/**
 * Por que este compromisso NÃO vira cartão — ou `null` quando vira.
 * O motivo é para o resumo da tela ("12 ignorados"), nunca para log com o
 * título, que tem nome de paciente (regra 21).
 */
export function motivoParaIgnorar(
  c: TextoDoCompromisso & { readonly diaInteiro: boolean },
  palavras: readonly string[],
  procedimentos: readonly string[] = [],
): 'dia-inteiro' | 'palavra-ignorada' | 'sem-nome' | null {
  if (c.diaInteiro) return 'dia-inteiro'
  const titulo = ` ${normalizarNome(c.titulo).replace(/[^a-z0-9]+/g, ' ')} `
  for (const p of palavras) {
    const n = normalizarNome(p).replace(/[^a-z0-9]+/g, ' ').trim()
    if (n !== '' && titulo.includes(` ${n} `)) return 'palavra-ignorada'
  }
  if (dadosDoCompromisso(c, procedimentos).nome === null) return 'sem-nome'
  return null
}

// ---------------------------------------------------------------------------
// A decisão
// ---------------------------------------------------------------------------

/** O cartão que a sincronização já criou para este compromisso. */
export type CartaoDaAgenda = {
  readonly etapa: Etapa | null
  readonly excluido: boolean
  /** `aaaa-mm-dd`, dia civil da clínica. */
  readonly prazo: string
  /** `HH:MM` ou `null`. */
  readonly hora: string | null
}

/** O compromisso como a clínica o vê: dia e hora no fuso DELA. */
export type CompromissoNaClinica = {
  readonly dia: string
  readonly hora: string
  readonly cancelado: boolean
}

export type AcaoDaAgenda =
  | { readonly tipo: 'criar' }
  | { readonly tipo: 'reagendar'; readonly prazo: string; readonly hora: string }
  | { readonly tipo: 'desmarcar'; readonly porque: 'cancelado' | 'removido' }
  | { readonly tipo: 'nada' }

/** As etapas em que a agenda ainda manda no cartão. Depois delas, manda a recepção. */
const ETAPAS_QUE_A_AGENDA_MOVE: readonly (Etapa | null)[] = ['agendado', 'confirmado']

/**
 * O que fazer com o cartão, dado o que a agenda diz agora.
 *
 * `compromisso === null` é "sumiu do feed". Quem chama só pergunta por um
 * sumiço depois de conferir que o feed é saudável (`podeConsiderarRemocoes`),
 * e só para compromisso que estava no futuro.
 *
 * As regras, na ordem da ADR 0019:
 *  - cartão excluído à mão: nada, nunca recria (regra 27);
 *  - etapa que a recepção já moveu (faltou, realizado, desmarcou, …): nada;
 *  - consulta que já passou: nada, continua aberta em Hoje e nos pendentes;
 *  - cancelado ou sumido: `desmarcar`, e o cartão entra em Recontatar;
 *  - dia ou hora diferentes: `reagendar`.
 */
export function decidirPelaAgenda(
  cartao: CartaoDaAgenda | null,
  compromisso: CompromissoNaClinica | null,
  hoje: string,
): AcaoDaAgenda {
  if (cartao === null) {
    if (compromisso === null || compromisso.cancelado || compromisso.dia < hoje) return { tipo: 'nada' }
    return { tipo: 'criar' }
  }
  if (cartao.excluido || !ETAPAS_QUE_A_AGENDA_MOVE.includes(cartao.etapa)) return { tipo: 'nada' }
  if (cartao.prazo < hoje) return { tipo: 'nada' }

  if (compromisso === null) return { tipo: 'desmarcar', porque: 'removido' }
  if (compromisso.cancelado) return { tipo: 'desmarcar', porque: 'cancelado' }

  const mudou = compromisso.dia !== cartao.prazo || compromisso.hora !== cartao.hora
  if (mudou && compromisso.dia >= hoje) {
    return { tipo: 'reagendar', prazo: compromisso.dia, hora: compromisso.hora }
  }
  return { tipo: 'nada' }
}

/**
 * Feed vazio com compromissos futuros conhecidos é feed quebrado, não uma
 * clínica que cancelou a agenda inteira. Sem esta trava, um link revogado
 * que passe a responder um calendário vazio desmarca o mês todo às 3 da
 * manhã — e a recepção chega com sessenta cartões em Recontatar.
 */
export function podeConsiderarRemocoes(noFeed: number, futurosConhecidos: number): boolean {
  return !(noFeed === 0 && futurosConhecidos > 0)
}

/** `webcal://` é `https://` com outro nome; o resto é recusado pelo contrato. */
export function urlDaAgenda(texto: string): string {
  const t = texto.trim()
  return /^webcals?:\/\//i.test(t) ? t.replace(/^webcals?:\/\//i, 'https://') : t
}

/** O link é segredo: a tela vê o host e os 4 últimos caracteres, nada mais. */
export function urlMascarada(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}/…${url.slice(-4)}`
  } catch {
    return '…'
  }
}
