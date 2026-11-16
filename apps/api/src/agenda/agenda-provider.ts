import type { ClinicaId } from '../banco/clinica-id'
import type { Baixador } from './baixar-feed'
import { type CompromissoLido, lerIcal } from './leitor-ical'

/**
 * O `AgendaProvider` (seam 4, ADR 0019; spec integracao-medx B.9, T3).
 *
 * De onde vem a agenda da clínica — o link iCal ou o MedX — é UMA coluna de
 * `agendas_externas.provedor`, e um provedor só lê. Conciliar é da
 * `SincronizacaoDaAgenda`, igual para todos: o provedor entrega a lista de
 * compromissos lidos, e a conciliação decide com as mesmas regras
 * (`decidirPelaAgenda`, `transicao`) — o MedX não ganha atalho que o iCal não tem.
 *
 * O provedor roda FORA de transação (rede), e falha com `FalhaDaLeitura`, cuja
 * mensagem já é texto para a tela: nunca conteúdo de fora.
 */
export type Provedor = 'ical' | 'medx'

export type AgendaDaClinica = {
  readonly id: string
  readonly provedor: Provedor
  readonly urlSecreta: string | null
  readonly responsavelId: string
  readonly palavrasIgnorar: readonly string[]
}

export type JanelaDaRodada = {
  readonly de: Date
  readonly ate: Date
  readonly fuso: string
  /** Dia civil de hoje no fuso da clínica (a autoridade é o servidor, regra 24). */
  readonly hoje: string
  readonly agora: Date
}

/** As contagens de um ciclo, sem id nem nome (B.12). Só o MedX registra. */
export type ContagensDoCiclo = {
  agendamentosLidos: number
  paginas: number
  chamadasDeContato: number
  confirmacoesPorId: number
}

export type LeituraDaAgenda = {
  readonly lidos: readonly CompromissoLido[]
  /**
   * Chaves que esta leitura NÃO decidiu (a confirmação por id falhou, o
   * contato ficou para o próximo ciclo): não contam como sumidas.
   */
  readonly naoDecididos: ReadonlySet<string>
  readonly ciclo?: ContagensDoCiclo
}

export class FalhaDaLeitura extends Error {
  constructor(
    mensagem: string,
    readonly ciclo?: ContagensDoCiclo,
  ) {
    super(mensagem)
    this.name = 'FalhaDaLeitura'
  }
}

export interface AgendaProvider {
  ler(clinicaId: ClinicaId, agenda: AgendaDaClinica, janela: JanelaDaRodada): Promise<LeituraDaAgenda>
}

/** O iCal: baixa o feed e o interpreta. As falhas (`FalhaAoBaixar`, `FeedInvalido`) já são texto de tela. */
export class AgendaPorIcal implements AgendaProvider {
  constructor(private readonly baixar: Baixador) {}

  async ler(_clinicaId: ClinicaId, agenda: AgendaDaClinica, janela: JanelaDaRodada): Promise<LeituraDaAgenda> {
    if (agenda.urlSecreta === null) throw new FalhaDaLeitura('A agenda não tem link iCal.')
    return { lidos: lerIcal(await this.baixar(agenda.urlSecreta), janela), naoDecididos: new Set() }
  }
}
