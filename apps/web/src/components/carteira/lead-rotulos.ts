import type { EtapaDoLead, SinalDoLeadSaida } from '@fir/contracts'
import { roteiroDaEtapa } from '@fir/domain'
import { formatarPercentual } from '@fir/ui'

/**
 * Os textos da prospecção, iguais ao protótipo (`ETAPAS` e `TEMP`, L519-521;
 * `nivelTxt`, L2456). Só rótulo — nenhuma regra mora aqui.
 */
export const ROTULO_DA_ETAPA: Record<EtapaDoLead, string> = {
  novo: 'Indicação recebida',
  contato: 'Em conversa',
  reuniao: 'Reunião agendada',
  proposta: 'Proposta enviada',
  espera: 'Em espera',
  ganho: 'Virou cliente',
  perdido: 'Perdido',
}

export const ROTULO_DA_TEMPERATURA: Record<string, string> = {
  quente: 'Quente',
  morno: 'Morno',
  frio: 'Frio',
}

export const ROTULO_DO_NIVEL: Record<SinalDoLeadSaida['nivel'], string> = {
  agora: 'Contatar agora',
  hoje: 'Contatar hoje',
  semana: 'Vale um toque esta semana',
}

/**
 * A pílula da etapa (`chipEtapa`, L2454): CHEIA, como a `.chip` do protótipo
 * (Perdido é neutro lá também). As cores são pares de token: o dourado de
 * texto sobre o creme é `--on-gold-soft`, nunca `--gold-ink` (4,32:1).
 */
export function classeDaEtapa(e: EtapaDoLead): string {
  if (e === 'ganho') return 'prosp-chip prosp-chip-bom'
  if (e === 'proposta' || e === 'reuniao') return 'prosp-chip prosp-chip-ouro'
  return 'prosp-chip'
}

/** `chipTemp` (L2455): Quente vermelho cheio, Morno dourado cheio, Frio neutro. */
export function classeDaTemperatura(t: string): string {
  if (t === 'quente') return 'prosp-chip prosp-chip-quente'
  if (t === 'morno') return 'prosp-chip prosp-chip-ouro'
  return 'prosp-chip'
}

/**
 * O roteiro que a ficha abre marcado. Com sinal, quem decide é o servidor
 * (`sinal.roteiro`); sem sinal, a tabela `ROT_ETAPA` do domínio, a mesma que o
 * sinal usa. Isto escolhe só a ficha marcada; o texto é montado no servidor.
 */
export const roteiroInicial = (etapa: EtapaDoLead, sinal: SinalDoLeadSaida | null): string =>
  sinal?.roteiro ?? roteiroDaEtapa(etapa)

/**
 * "10%" em vez de "10,00%" quando o percentual é inteiro, como o protótipo
 * escreve a regra (L2542). Formatação do número que o servidor mandou.
 */
export function percentualCurto(centesimos: string): string {
  const c = BigInt(centesimos)
  if (c % 100n === 0n) return `${c / 100n}%`
  return formatarPercentual(c)
}

/** "06/11" — formatação de um dia civil que o SERVIDOR já mandou. Nenhum relógio do aparelho. */
export const diaCurto = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

/** "06/11/2026". */
export const diaCompleto = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`

/** A pílula "Não contatar" (LGPD A37): vermelha cheia, como "Quente". */
export const CLASSE_DO_NAO_CONTATAR = 'prosp-chip prosp-chip-quente'
