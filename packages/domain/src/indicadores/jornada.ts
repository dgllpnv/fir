import { ETAPAS_EM_RECONTATO, type EventoDeJornada } from '../jornada'
import { diaCivil, diasEntre, somarDias } from '../relogio'

/**
 * As regras de jornada dos KPIs comerciais (I-10, I-11, I-12). Puras, sobre
 * o histórico de UM cartão; a consulta do T2 só traz os históricos.
 */

/**
 * Dias sem atendimento a partir dos quais a paciente é "sem retorno" — e a
 * volta dela é uma recaptação (I-12). Era uma constante de
 * `pacientes.service.ts`; mora aqui para o KPI e a lista de pacientes não
 * divergirem.
 */
export const DIAS_SEM_RETORNO = 182

type Evento = Pick<EventoDeJornada, 'acao' | 'etapa' | 'em'>

export type Desfecho = { readonly tipo: 'realizado' | 'falta'; readonly em: string }

/**
 * Os desfechos de um cartão (I-10): `realizado` quando o cartão chega a
 * `realizado` vindo de uma etapa ANTERIOR ao atendimento; `falta` no `noshow`.
 * A desmarcação não é falta.
 *
 * Duas transições levam o cartão de volta a `realizado` sem atendimento novo,
 * e por isso não contam (validação de números do T1, V1):
 * - `excluirOrcamento` (de `orcamento`/`fechado`/`perdido` para `realizado`);
 * - qualquer entrada vinda de uma etapa POSTERIOR ao atendimento.
 *
 * `reabrir` saindo de `realizado` ou de `orcamento` DESFAZ o atendimento vivo
 * do cartão — mesmo com o `registrarOrcamento` entre os dois —, e o próximo
 * `concluir` é o atendimento que vale. Reabrir de `encerrado` não desfaz
 * nada: ali não houve atendimento.
 */
const DEPOIS_DO_ATENDIMENTO: readonly string[] = ['realizado', 'orcamento', 'fechado', 'perdido']

export function classificarDesfecho(historico: readonly Evento[]): Desfecho[] {
  const r: (Desfecho | null)[] = []
  let atendimentoVivo: number | null = null
  for (let i = 0; i < historico.length; i++) {
    const ev = historico[i]!
    const anterior = historico[i - 1]?.etapa
    if (ev.acao === 'reabrir') {
      if (atendimentoVivo !== null && (anterior === 'realizado' || anterior === 'orcamento')) {
        r[atendimentoVivo] = null
        atendimentoVivo = null
      }
      continue
    }
    if (ev.acao === 'noshow') {
      r.push({ tipo: 'falta', em: ev.em })
      continue
    }
    if (
      ev.etapa === 'realizado' &&
      ev.acao !== 'excluirOrcamento' &&
      (anterior === undefined || !DEPOIS_DO_ATENDIMENTO.includes(anterior))
    ) {
      atendimentoVivo = r.length
      r.push({ tipo: 'realizado', em: ev.em })
    }
  }
  return r.filter((d): d is Desfecho => d !== null)
}

/** Realizados e faltas com `em` em `[de, ate)` — os dois termos do comparecimento. */
export function contarDesfechos(
  desfechos: readonly Desfecho[],
  janela: { readonly de: Date; readonly ate: Date },
): { realizados: number; faltas: number } {
  let realizados = 0
  let faltas = 0
  for (const d of desfechos) {
    const t = new Date(d.em).getTime()
    if (t < janela.de.getTime() || t >= janela.ate.getTime()) continue
    if (d.tipo === 'realizado') realizados++
    else faltas++
  }
  return { realizados, faltas }
}

export type FaltaComRecontato = {
  /** O dia civil da falta, no fuso da clínica. */
  readonly dia: string
  readonly em: string
  /** O dia civil do recontato, ou `null` se ainda não houve. */
  readonly recontatadaNoDia: string | null
  /** Recontatada até `dia + 2`, no fuso da clínica. */
  readonly emAteDoisDias: boolean
  /** `noshow` é falta; `desmarcar`, desmarcação (relatório 14). */
  readonly motivo: 'falta' | 'desmarcacao'
}

/**
 * Faltas e recontato (I-11). Falta: `noshow` ou `desmarcar`. Recontato: o
 * primeiro `reagendar` cujo evento ANTERIOR estava em `faltou`/`desmarcou` —
 * a mesma definição de `contarFaltasRecontatadas` (o dono, plano §9). Cada
 * falta pareia com o primeiro recontato depois dela e antes da falta
 * seguinte.
 */
export function recontatoEmAteDoisDias(historico: readonly Evento[], fuso: string): FaltaComRecontato[] {
  const r: FaltaComRecontato[] = []
  for (let i = 0; i < historico.length; i++) {
    const ev = historico[i]!
    if (ev.acao !== 'noshow' && ev.acao !== 'desmarcar') continue
    const dia = diaCivil(new Date(ev.em), fuso)
    let recontato: string | null = null
    for (let j = i + 1; j < historico.length; j++) {
      const p = historico[j]!
      if (p.acao === 'noshow' || p.acao === 'desmarcar') break
      if (p.acao === 'reagendar' && ETAPAS_EM_RECONTATO.includes(historico[j - 1]!.etapa)) {
        recontato = diaCivil(new Date(p.em), fuso)
        break
      }
    }
    r.push({
      dia,
      em: ev.em,
      recontatadaNoDia: recontato,
      emAteDoisDias: recontato !== null && recontato <= somarDias(dia, 2),
      motivo: ev.acao === 'noshow' ? 'falta' : 'desmarcacao',
    })
  }
  return r
}

/** A falta entra no denominador só quando o prazo de 2 dias já passou: `dia + 2 < hoje`. */
export const faltaMadura = (diaDaFalta: string, hoje: string): boolean => somarDias(diaDaFalta, 2) < hoje

/** Atendimento depois de `DIAS_SEM_RETORNO` ou mais sem atendimento. Sem anterior não é recaptação. */
export function ehRecaptacao(diaDoAtendimento: string, diaDoAtendimentoAnterior: string | null): boolean {
  return diaDoAtendimentoAnterior !== null && diasEntre(diaDoAtendimentoAnterior, diaDoAtendimento) >= DIAS_SEM_RETORNO
}
