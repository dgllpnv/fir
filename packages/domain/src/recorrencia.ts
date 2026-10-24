/**
 * A série recorrente — "Tarefas que se repetem" (MANUAL cap. 4).
 *
 * A recorrência é MATERIALIZADA: N tarefas com o mesmo `serie_id`, como na
 * v20, e não uma regra interpretada na leitura. É o que permite adiar uma das
 * ocorrências sem mexer nas outras, e é o que a recepção vê quando abre o dia.
 *
 * Esta função não reimplementa aritmética de calendário: `somarDias`,
 * `somarMeses` e `fimDoMes` já moram em `relogio.ts`, e `somarMeses` já
 * implementa a regra 25 (dia 29, 30 ou 31 cai no último dia do mês curto).
 */
import { somarDias, somarMeses } from './relogio'
import { erro, erroDe, ok, type Result } from './resultado'

export const FREQUENCIAS = [
  'diaria',
  'uteis',
  'semanal',
  'quinzenal',
  'mensal',
  'ndias',
] as const

export type Frequencia = (typeof FREQUENCIAS)[number]

/** O teto da v20 e do protótipo. Passar disso é erro, nunca corte silencioso. */
export const MAX_SERIE = 150

export const ROTULO_FREQUENCIA = {
  diaria: 'Todos os dias',
  uteis: 'Dias úteis',
  semanal: 'Semanal',
  quinzenal: 'A cada 15 dias',
  mensal: 'Mensal',
  ndias: 'A cada X dias',
} as const satisfies Record<Frequencia, string>

/** O rótulo que a tela mostra. Com o intervalo, "a cada X dias" vira o número. */
export function rotuloDaSerie(f: Frequencia, n?: number): string {
  if (f === 'ndias' && n !== undefined) return `A cada ${n} dias`
  return ROTULO_FREQUENCIA[f]
}

/**
 * O dia da semana de um dia civil, SEM fuso.
 *
 * Um dia civil já é uma data de calendário — não tem hora, não tem fuso.
 * Aplicar o fuso da clínica aqui seria convertê-lo duas vezes, e o resultado
 * dependeria de onde a clínica fica: "dia útil" é propriedade do calendário,
 * não do relógio.
 */
const ehDiaUtil = (dia: string): boolean => {
  const [a, m, d] = dia.split('-').map(Number)
  const semana = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
  return semana >= 1 && semana <= 5
}

/**
 * As datas da série, em ordem crescente.
 *
 * Erros, todos com mensagem que diz o que fazer:
 *   ATE_ANTES      — "repetir até" antes da data inicial
 *   PASSO_INVALIDO — "a cada X dias" sem X, ou fora de 2..365
 *   SERIE_CURTA    — menos de 2 datas; isso não é série
 *   SERIE_LONGA    — passa de `MAX_SERIE`
 */
export function gerarSerie(
  inicio: string,
  freq: Frequencia,
  ate: string,
  aCadaNDias?: number,
): Result<readonly string[]> {
  if (ate < inicio) {
    return erro(erroDe('ATE_ANTES', 'O “repetir até” é antes da data inicial.'))
  }
  if (
    freq === 'ndias' &&
    !(Number.isInteger(aCadaNDias) && aCadaNDias !== undefined && aCadaNDias >= 2 && aCadaNDias <= 365)
  ) {
    return erro(erroDe('PASSO_INVALIDO', 'Informe de 2 a 365 dias.'))
  }

  const passo =
    freq === 'semanal' ? 7 : freq === 'quinzenal' ? 14 : freq === 'ndias' ? aCadaNDias! : 1

  // A ÂNCORA É A DATA INICIAL, não a anterior.
  //
  // Uma série mensal que começa em 31/01 vai a 28/02 e VOLTA a 31/03. Com a
  // âncora na data anterior ela ficaria presa no dia 28 para sempre, e a
  // clínica perderia a data da consulta mensal do terceiro mês em diante —
  // sem erro nenhum, só com a data errada.
  const diaOriginal = Number(inicio.slice(8, 10))

  const datas: string[] = []
  // `k < 2000` é cinto e suspensório: com 'uteis' a série avança um dia por
  // iteração, e 2000 iterações já produziriam ~1430 datas — muito além do
  // teto, que fecha antes. O limite existe para que um `freq` novo escrito
  // errado não gire para sempre.
  for (let k = 0, d = inicio; d <= ate && k < 2000; k++) {
    if (freq !== 'uteis' || ehDiaUtil(d)) datas.push(d)
    if (datas.length > MAX_SERIE) {
      return erro(
        erroDe(
          'SERIE_LONGA',
          `A série passa de ${MAX_SERIE} tarefas. Reduza o “repetir até”.`,
        ),
      )
    }
    d = freq === 'mensal' ? somarMeses(inicio, k + 1, diaOriginal) : somarDias(d, passo)
  }

  if (datas.length < 2) {
    return erro(
      erroDe('SERIE_CURTA', 'A série precisa de pelo menos 2 datas. Ajuste o “repetir até”.'),
    )
  }
  return ok(datas)
}
