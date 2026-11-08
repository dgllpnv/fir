import type { EtapaDoLead, SinalDoLeadSaida } from '@fir/contracts'

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

/** A cor da pílula da etapa (`chipEtapa`, L2454), com as variantes que já existem em `.pill`. */
export function classeDaEtapa(e: EtapaDoLead): string {
  if (e === 'ganho') return 'pill bom'
  if (e === 'perdido') return 'pill mau'
  if (e === 'proposta' || e === 'reuniao') return 'pill paciente'
  return 'pill'
}

/** `chipTemp` (L2455). */
export function classeDaTemperatura(t: string): string {
  if (t === 'quente') return 'pill mau'
  if (t === 'morno') return 'pill alerta'
  return 'pill'
}

/** "06/11" — formatação de um dia civil que o SERVIDOR já mandou. Nenhum relógio do aparelho. */
export const diaCurto = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

/** "06/11/2026". */
export const diaCompleto = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`
