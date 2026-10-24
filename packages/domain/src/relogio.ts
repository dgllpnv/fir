/**
 * O relógio é dependência injetada. Nenhuma regra chama `new Date()`:
 * data de negócio vem do servidor, e um teste precisa poder fixar o instante.
 */
export interface Relogio {
  agora(): Date
}

export class RelogioDoSistema implements Relogio {
  agora(): Date {
    return new Date()
  }
}

export class RelogioFixo implements Relogio {
  constructor(private readonly instante: Date) {}
  agora(): Date {
    return this.instante
  }
}

const dois = (n: number) => String(n).padStart(2, '0')

/** Minutos que o fuso está à frente do UTC no instante dado. */
function deslocamentoMinutos(instante: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante)

  const p: Record<string, string> = {}
  for (const x of partes) if (x.type !== 'literal') p[x.type] = x.value

  const hora = Number(p['hour']) === 24 ? 0 : Number(p['hour'])
  const comoSeFosseUtc = Date.UTC(
    Number(p['year']),
    Number(p['month']) - 1,
    Number(p['day']),
    hora,
    Number(p['minute']),
    Number(p['second']),
  )
  return (comoSeFosseUtc - instante.getTime()) / 60_000
}

/** O dia civil (`yyyy-MM-dd`) em que o instante cai, **no fuso da clínica**. */
export function diaCivil(instante: Date, fuso: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante)
  return partes // en-CA já formata como yyyy-MM-dd
}

/** O instante UTC em que o dia civil começa no fuso da clínica. */
export function inicioDoDia(dia: string, fuso: string): Date {
  const [a, m, d] = dia.split('-').map(Number)
  const comoUtc = Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0)

  // Duas passadas: a primeira usa o deslocamento no palpite, a segunda corrige
  // quando o palpite cair do outro lado de uma mudança de horário de verão.
  const primeiro = new Date(comoUtc - deslocamentoMinutos(new Date(comoUtc), fuso) * 60_000)
  const segundo = new Date(comoUtc - deslocamentoMinutos(primeiro, fuso) * 60_000)
  return segundo
}

/**
 * Janela **semiaberta** `[de, ate)` em instantes UTC, com as bordas calculadas
 * no fuso da clínica. `ate` é o início do dia **seguinte** ao último dia pedido,
 * de modo que o último instante do último dia entra e o primeiro do dia
 * seguinte não. Uma convenção só, em todo o sistema.
 */
export function janela(de: string, ate: string, fuso: string): { de: Date; ate: Date } {
  return { de: inicioDoDia(de, fuso), ate: inicioDoDia(somarDias(ate, 1), fuso) }
}

/** Soma dias a um dia civil, sem tocar em fuso — aritmética de calendário. */
export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  const t = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, (d ?? 1) + n))
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`
}

/**
 * Soma meses. Dia 29, 30 ou 31 em mês curto **cai no último dia do mês** — é a
 * regra da v20, e as 4 clínicas dependem dela.
 *
 * `diaOriginal` permite que uma série mensal iniciada em 31/01 volte ao dia 31
 * em março, em vez de ficar presa no 28 de fevereiro.
 */
export function somarMeses(dia: string, n: number, diaOriginal?: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  const alvo = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1 + n, 1))
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
  const escolhido = Math.min(diaOriginal ?? d ?? 1, ultimo)
  return `${alvo.getUTCFullYear()}-${dois(alvo.getUTCMonth() + 1)}-${dois(escolhido)}`
}

/** Último dia civil de um mês `yyyy-MM`. */
export function fimDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  const t = new Date(Date.UTC(a ?? 1970, m ?? 1, 0))
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`
}
