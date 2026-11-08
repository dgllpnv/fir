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

/**
 * O dia civil (`yyyy-MM-dd`) em que o instante cai, **no fuso da clínica**.
 *
 * Usa `formatToParts` em vez de `format`: a ordem e o separador que um locale
 * produz são dado de CLDR, não contrato do ECMA-402 — podem mudar entre
 * versões de ICU sem erro de compilação e sem exceção, só trocando o formato
 * em silêncio. Este valor é chave de agrupamento de tarefas por dia no
 * produto inteiro, então montamos a string à mão a partir das partes
 * nomeadas, como `deslocamentoMinutos` já faz.
 */
export function diaCivil(instante: Date, fuso: string): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instante)

  const p: Record<string, string> = {}
  for (const x of partes) if (x.type !== 'literal') p[x.type] = x.value

  return `${p['year']}-${p['month']}-${p['day']}`
}

/**
 * O instante UTC de um relógio de parede `dia` + `HH:mm` **no fuso da clínica**.
 *
 * Existe para o épico 9: a v20 grava `criadaEm`, `concluidaEm` e `criadoEm`
 * com `Utilities.formatDate(…, 'America/Bahia', …)`, ou seja o arquivo tem a
 * hora LOCAL da clínica sem marcador de fuso. Montá-la com `new Date(texto)`
 * a interpretaria como UTC e deslocaria o histórico inteiro de três horas —
 * e o deslocamento muda o DIA de tudo o que foi lançado antes das 03:00
 * (regra 22).
 *
 * As duas passadas são as mesmas de `inicioDoDia`, pela mesma razão: o
 * deslocamento depende do instante, e o palpite pode cair do outro lado de
 * uma mudança de horário de verão. Bahia teve horário de verão até 2012 e
 * **há dado migrado desse período** nas clínicas; com uma passada só, uma
 * hora de 2011 entraria com uma hora de erro.
 *
 * Hora inexistente (o salto para o horário de verão) **não** é corrigida para
 * frente aqui, diferente de `inicioDoDia`: `01:30` num dia em que o relógio
 * pulou de 00:00 para 01:00 nunca foi gravado pela v20 — ela formatou a hora
 * a partir de um instante que existiu. O que esta função garante é a volta
 * exata para qualquer hora que exista.
 */
export function instanteLocal(dia: string, hora: string, fuso: string): Date {
  const [a, m, d] = dia.split('-').map(Number)
  const [hh, mm] = hora.split(':').map(Number)
  const comoUtc = Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0)
  const primeiro = new Date(comoUtc - deslocamentoMinutos(new Date(comoUtc), fuso) * 60_000)
  return new Date(comoUtc - deslocamentoMinutos(primeiro, fuso) * 60_000)
}

/** O instante UTC em que o dia civil começa no fuso da clínica. */
export function inicioDoDia(dia: string, fuso: string): Date {
  const [a, m, d] = dia.split('-').map(Number)
  const comoUtc = Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0)

  // Duas passadas: a primeira usa o deslocamento no palpite, a segunda corrige
  // quando o palpite cair do outro lado de uma mudança de horário de verão.
  const primeiro = new Date(comoUtc - deslocamentoMinutos(new Date(comoUtc), fuso) * 60_000)
  const segundo = new Date(comoUtc - deslocamentoMinutos(primeiro, fuso) * 60_000)

  // Hora inexistente: na virada PARA o horário de verão, a meia-noite local
  // não acontece — o relógio salta (ex.: 23:59:59 → 01:00:00). As duas
  // passadas acima, nesse caso, devolvem um instante do dia ANTERIOR ao
  // pedido. O dia começa, então, no primeiro instante que de fato existe,
  // logo depois do salto — encontrado por busca binária no espaço de um dia.
  if (diaCivil(segundo, fuso) === dia) return segundo

  let antes = segundo.getTime()
  let depois = antes + 24 * 60 * 60_000
  while (depois - antes > 1) {
    const meio = antes + Math.floor((depois - antes) / 2)
    // Comparação lexicográfica: para `yyyy-MM-dd` é a mesma ordem da cronológica.
    if (diaCivil(new Date(meio), fuso) < dia) antes = meio
    else depois = meio
  }
  return new Date(depois)
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
 * Dias civis entre dois dias, `ate − de`. Negativo quando `ate` é anterior.
 *
 * Aritmética de calendário em UTC, sem fuso: `Date.UTC` ignora horário de
 * verão, então a diferença é sempre múltiplo exato de 24 h e a divisão é
 * inteira. O protótipo faz `Math.round((parse(b) - parse(a)) / 864e5)` sobre
 * datas LOCAIS — e o `Math.round` existe lá exatamente porque, no fuso local,
 * um dia de virada de horário de verão tem 23 ou 25 horas.
 */
export function diasEntre(de: string, ate: string): number {
  const [a1, m1, d1] = de.split('-').map(Number)
  const [a2, m2, d2] = ate.split('-').map(Number)
  const t1 = Date.UTC(a1 ?? 1970, (m1 ?? 1) - 1, d1 ?? 1)
  const t2 = Date.UTC(a2 ?? 1970, (m2 ?? 1) - 1, d2 ?? 1)
  return (t2 - t1) / 86_400_000
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

/* ──────────────────────────────────────────────────────────────────────────
 * A SESSÃO DO BALCÃO — P-1, decidida pelo dono em 2026-11-04
 * ────────────────────────────────────────────────────────────────────────── */

/** Doze horas: o teto, para quem entra de madrugada. */
const TETO_DA_SESSAO_MS = 12 * 60 * 60 * 1000

/** Uma hora: o piso, para quem entra às 23h55. */
const PISO_DA_SESSAO_MS = 60 * 60 * 1000

/**
 * Quando a sessão do balcão termina: **no fim do dia da clínica**, nunca
 * passando de 12 horas e nunca menos de 1 hora.
 *
 * ## Por que o dia da clínica, e não um prazo deslizante
 *
 * A sessão durava **30 dias**, e o preço não era segurança — quem sai da
 * clínica perde o acesso na hora, porque a resolução de contexto filtra
 * `AND ativo`. O preço era **atribuição**, e ele atacava justamente a trilha
 * de auditoria que a D-5 existe para construir.
 *
 * Num computador de recepção que três pessoas usam, uma sessão de 30 dias
 * atribui **um mês inteiro de ações a quem entrou primeiro**. A trilha fica
 * precisa e errada — pior do que trilha nenhuma, porque todo mundo confia
 * nela. E dói exatamente onde mais importa: quem fechou o caixa, quem aplicou
 * a dose, quem mexeu num salário.
 *
 * Medido em produção antes da correção: uma única conta tinha **211 sessões
 * válidas**, a mais antiga de dois dias antes, todas boas por mais um mês.
 *
 * Um prazo deslizante de 12 horas resolveria o número e não resolveria o
 * problema: quem entra às 14h ficaria logado até as 2h da manhã, e o turno da
 * manhã seguinte herdaria a sessão da tarde anterior. **A fronteira tem de
 * ser o dia**, para que cada dia de trabalho comece com uma entrada — que é a
 * granularidade com que a clínica de fato pergunta "quem fez isso".
 *
 * ## Os dois limites, e por que existem
 *
 * **Teto de 12 horas.** Sem ele, entrar à meia-noite e um daria uma sessão de
 * quase 24 horas — o caso que a regra existe para impedir, pela porta dos
 * fundos.
 *
 * **Piso de 1 hora.** Sem ele, entrar às 23h55 daria uma sessão de cinco
 * minutos: a pessoa abre o sistema para registrar uma coisa e é desconectada
 * no meio. Clínica com atendimento à noite faz isso, e uma sessão que morre
 * ao nascer transforma a regra em defeito. A atribuição segue limitada a uma
 * hora, que é o que importa.
 *
 * **Não há renovação por uso.** Deslizar o prazo a cada requisição é como uma
 * sessão de 12 horas fica viva uma semana, com uma aba esquecida recarregando
 * sozinha. É a mesma razão escrita na sessão de suporte.
 */
export function fimDaSessaoDoBalcao(agora: Date, fuso: string): Date {
  const fimDoDia = inicioDoDia(somarDias(diaCivil(agora, fuso), 1), fuso).getTime()
  const teto = agora.getTime() + TETO_DA_SESSAO_MS
  const piso = agora.getTime() + PISO_DA_SESSAO_MS
  return new Date(Math.max(piso, Math.min(fimDoDia, teto)))
}

/**
 * A hora de parede `HH:MM` de um instante, no fuso da clínica.
 *
 * Par de `diaCivil`: o compromisso da agenda externa chega como instante, e o
 * cartão guarda `prazo` (dia) e `hora` no calendário da clínica. `h23` e não
 * `hour12: false`: o segundo devolve `24:00` à meia-noite em algumas versões
 * do ICU.
 */
export function horaCivil(instante: Date, fuso: string): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante)
  const p: Record<string, string> = {}
  for (const x of partes) if (x.type !== 'literal') p[x.type] = x.value
  return `${p['hour']}:${p['minute']}`
}
