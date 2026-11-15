import type { EventoDeFluxo, TarefaNaLista } from '@fir/contracts'
import { ErroDaApi } from './api'

/**
 * O fluxo da tarefa em frases (Grupo, Assumir, Transferência — `CONTEXT.md`).
 *
 * Só FORMATA o que o servidor já registrou: ninguém aqui decide quem pode o
 * quê (isso é `packages/domain/src/tarefa.ts`) nem reconstrói o histórico.
 * Nomes chegam de duas listas curtas (`v1/equipe` e `v1/grupos`); id que não
 * resolve vira texto genérico, nunca o uuid na tela.
 */
export type Nomes = {
  readonly pessoa: (id: string) => string | null
  readonly grupo: (id: string) => string | null
}

type Destino = { readonly tipo: 'pessoa' | 'grupo'; readonly id: string }

/** "de Carla" · "do grupo Recepção" — a preposição já contraída. */
export function deDestino(d: Destino, n: Nomes): string {
  if (d.tipo === 'pessoa') return `de ${n.pessoa(d.id) ?? 'uma pessoa'}`
  const g = n.grupo(d.id)
  return g === null ? 'de um grupo desativado' : `do grupo ${g}`
}

/** "para Carla" · "para o grupo Recepção". */
export function paraDestino(d: Destino, n: Nomes): string {
  if (d.tipo === 'pessoa') return `para ${n.pessoa(d.id) ?? 'uma pessoa'}`
  const g = n.grupo(d.id)
  return g === null ? 'para um grupo desativado' : `para o grupo ${g}`
}

export type EventoEmFrase = {
  readonly texto: string
  /** A nota livre da transferência/assunção, ou `null`. */
  readonly nota: string | null
}

export function eventoEmFrase(e: EventoDeFluxo, n: Nomes): EventoEmFrase {
  const por = n.pessoa(e.porId) ?? 'Alguém'
  const nota = e.nota === undefined || e.nota === '' ? null : e.nota
  switch (e.acao) {
    case 'atribuir':
      return {
        texto:
          e.para === null
            ? `${por} atribuiu a tarefa`
            : `${por} enviou a tarefa ${paraDestino(e.para, n)}`,
        nota,
      }
    case 'transferir':
      return {
        texto:
          e.de === null || e.para === null
            ? `${por} transferiu a tarefa`
            : `${por} transferiu ${deDestino(e.de, n)} ${paraDestino(e.para, n)}`,
        nota,
      }
    case 'assumir':
      return {
        texto:
          e.de === null ? `${por} assumiu a tarefa` : `${por} assumiu a tarefa ${deDestino(e.de, n)}`,
        nota,
      }
    case 'concluirPeloGrupo':
      return {
        texto:
          e.de === null || e.de.tipo !== 'grupo'
            ? `${por} concluiu a tarefa`
            : `${por} concluiu a tarefa do grupo ${n.grupo(e.de.id) ?? 'desativado'}`,
        nota,
      }
    case 'executar':
      return { texto: `${por} concluiu a tarefa`, nota }
  }
}

/** Os eventos que dizem quem concluiu — de grupo ou de pessoa. */
export const ehEventoDeConclusao = (e: EventoDeFluxo): boolean =>
  e.acao === 'concluirPeloGrupo' || e.acao === 'executar'

/**
 * Quem concluiu, quando o servidor registrou: `concluirPeloGrupo` (tarefa de
 * grupo) ou `executar` (tarefa de pessoa). Tarefa concluída antes desse registro
 * não tem o dado, e inventá-lo aqui seria afirmar o que o servidor não gravou.
 */
export function quemConcluiu(
  t: Pick<TarefaNaLista, 'status' | 'fluxo'>,
  n: Nomes,
): string | null {
  if (t.status !== 'concluida') return null
  for (let i = t.fluxo.length - 1; i >= 0; i--) {
    const e = t.fluxo[i]
    if (e !== undefined && ehEventoDeConclusao(e)) return n.pessoa(e.porId) ?? 'alguém da equipe'
  }
  return null
}

/**
 * A mensagem em português claro para as recusas de assumir/transferir. A do
 * servidor vem primeiro (ela já diz o motivo exato); estas são o que sobra
 * quando o corpo não trouxe texto.
 */
export function mensagemDoFluxo(e: unknown, acao: 'assumir' | 'transferir'): string {
  if (e instanceof ErroDaApi) {
    if (e.message !== '' && e.message !== 'Não foi possível completar a ação.') return e.message
    if (e.status === 403) {
      return acao === 'assumir'
        ? 'Só quem é do grupo pode assumir esta tarefa.'
        : 'Só quem está com a tarefa pode transferi-la.'
    }
    if (e.status === 409) return 'Outra pessoa acabou de mexer nesta tarefa. Atualizei a lista.'
  }
  return acao === 'assumir' ? 'Não consegui assumir a tarefa.' : 'Não consegui transferir a tarefa.'
}
