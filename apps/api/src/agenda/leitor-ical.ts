import { instanteLocal } from '@fir/domain'
import ICAL from 'ical.js'

/**
 * Um compromisso como o feed iCal o descreve — antes de qualquer regra.
 *
 * `inicio` é um INSTANTE (UTC). O dia e a hora que a clínica vê saem dele no
 * fuso dela, no serviço — nunca aqui, para que o leitor não precise saber de
 * clínica nenhuma.
 */
export type CompromissoLido = {
  /** `UID`; ocorrência de recorrente: `UID|RECURRENCE-ID`. */
  readonly chave: string
  readonly inicio: Date
  readonly diaInteiro: boolean
  readonly titulo: string
  readonly descricao: string
  readonly cancelado: boolean
  /** Ocorrência de evento recorrente: só existe dentro da janela expandida. */
  readonly recorrente: boolean
}

export type JanelaDeLeitura = {
  /** Início da expansão de recorrência. */
  readonly de: Date
  /** Fim (exclusivo) da expansão de recorrência. */
  readonly ate: Date
  /** Fuso da clínica: vale para hora "flutuante" e TZID desconhecido. */
  readonly fuso: string
}

export class FeedInvalido extends Error {}

/** Teto de ocorrências por feed: um RRULE sem fim não prende o worker. */
const MAXIMO_DE_COMPROMISSOS = 20_000

/**
 * Lê o texto iCal e devolve os compromissos.
 *
 * Não recorrente: todos, de qualquer data — o serviço decide o que importa, e
 * precisa enxergar o compromisso movido para depois da janela para não
 * confundi-lo com um removido. Recorrente: só as ocorrências em `[de, ate)`.
 *
 * O FUSO NÃO VEM DO VTIMEZONE. O instante é montado com o relógio de parede
 * do evento + o TZID resolvido no banco IANA do próprio Node. Sistemas de
 * agenda mandam TZID sem VTIMEZONE, ou com nome do Windows ("E. South America
 * Standard Time"), e confiar na definição embutida deixaria a hora três horas
 * errada no container em UTC. TZID que o Node não conhece cai no fuso da
 * clínica, que é o que a recepção quis dizer.
 */
export function lerIcal(texto: string, janela: JanelaDeLeitura): CompromissoLido[] {
  let raiz: ICAL.Component
  try {
    raiz = new ICAL.Component(ICAL.parse(texto))
  } catch {
    throw new FeedInvalido('O link não devolveu um calendário iCal válido.')
  }
  if (raiz.name !== 'vcalendar') throw new FeedInvalido('O link não devolveu um calendário iCal.')

  const mestres = new Map<string, ICAL.Event>()
  const excecoes: ICAL.Event[] = []
  for (const v of raiz.getAllSubcomponents('vevent')) {
    const e = new ICAL.Event(v)
    if (!e.uid || !e.startDate) continue
    if (e.isRecurrenceException()) excecoes.push(e)
    else mestres.set(e.uid, e)
  }
  for (const x of excecoes) {
    const m = mestres.get(x.uid)
    if (m !== undefined) m.relateException(x)
  }

  const saida: CompromissoLido[] = []
  const empurrar = (c: CompromissoLido): void => {
    if (saida.length >= MAXIMO_DE_COMPROMISSOS) {
      throw new FeedInvalido('O calendário tem compromissos demais para ler.')
    }
    saida.push(c)
  }

  for (const e of mestres.values()) {
    if (!e.isRecurring()) {
      const status = String(e.component.getFirstPropertyValue('status') ?? '')
      empurrar({
        chave: e.uid,
        inicio: instanteDe(e.startDate, tzidDe(e.component), janela.fuso),
        diaInteiro: e.startDate.isDate,
        titulo: e.summary ?? '',
        descricao: e.description ?? '',
        cancelado: status.toUpperCase() === 'CANCELLED',
        recorrente: false,
      })
      continue
    }

    const tzMestre = tzidDe(e.component)
    const it = e.iterator()
    for (let passo = 0; passo < MAXIMO_DE_COMPROMISSOS; passo++) {
      const proxima = it.next()
      if (!proxima) break
      const d = e.getOccurrenceDetails(proxima)
      const item = d.item
      const inicio = instanteDe(d.startDate, item === e ? tzMestre : tzidDe(item.component), janela.fuso)
      if (inicio >= janela.ate) break
      if (inicio < janela.de) continue
      const status = String(item.component.getFirstPropertyValue('status') ?? '')
      empurrar({
        chave: `${e.uid}|${d.recurrenceId.toString()}`,
        inicio,
        diaInteiro: d.startDate.isDate,
        titulo: item.summary ?? e.summary ?? '',
        descricao: item.description ?? e.description ?? '',
        cancelado: status.toUpperCase() === 'CANCELLED',
        recorrente: true,
      })
    }
  }

  // Exceção órfã (o mestre está fora do feed): vale como compromisso avulso.
  for (const x of excecoes) {
    if (mestres.has(x.uid)) continue
    const status = String(x.component.getFirstPropertyValue('status') ?? '')
    empurrar({
      chave: `${x.uid}|${x.recurrenceId.toString()}`,
      inicio: instanteDe(x.startDate, tzidDe(x.component), janela.fuso),
      diaInteiro: x.startDate.isDate,
      titulo: x.summary ?? '',
      descricao: x.description ?? '',
      cancelado: status.toUpperCase() === 'CANCELLED',
      recorrente: false,
    })
  }

  return saida
}

function tzidDe(c: ICAL.Component): string | null {
  const p = c.getFirstProperty('dtstart')
  const tz = p?.getParameter('tzid')
  return typeof tz === 'string' && tz !== '' ? tz : null
}

/** `/mozilla.org/20050126_1/America/Sao_Paulo` → `America/Sao_Paulo`, se o Node conhecer. */
function fusoIana(tzid: string | null): string | null {
  if (tzid === null) return null
  const candidatos = [tzid, tzid.split('/').slice(-2).join('/'), tzid.split('/').slice(-3).join('/')]
  for (const c of candidatos) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: c })
      return c
    } catch {
      // não é IANA; tenta o próximo recorte
    }
  }
  return null
}

const doisDigitos = (n: number): string => String(n).padStart(2, '0')

function instanteDe(t: ICAL.Time, tzid: string | null, fusoDaClinica: string): Date {
  const dia = `${t.year}-${doisDigitos(t.month)}-${doisDigitos(t.day)}`
  if (t.isDate) return instanteLocal(dia, '00:00', fusoDaClinica)
  // `Z` no valor: o instante já é UTC.
  if (t.zone === ICAL.Timezone.utcTimezone) {
    return new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second))
  }
  const fuso = fusoIana(tzid) ?? fusoDaClinica
  return instanteLocal(dia, `${doisDigitos(t.hour)}:${doisDigitos(t.minute)}`, fuso)
}
