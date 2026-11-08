'use client'

import type { TarefaNaLista, TarefasAfetadas } from '@fir/contracts'
import { useCallback, useState } from 'react'
import type { AcoesDoCartao, DadosDaConclusao } from '@/components/cartao-de-tarefa'
import type { MoverEtapa } from '@/components/jornada/faixa-da-jornada'
import { chamar } from './api'
import { postarComConfirmacao } from './dialogo-de-confirmacao'

/**
 * Concluir · cancelar · reabrir · editar — escritos UMA vez.
 *
 * Hoje e Tarefas mostram o mesmo cartão e oferecem as mesmas quatro ações. Com
 * uma cópia em cada tela, a primeira divergência é silenciosa: alguém acerta a
 * mensagem do estorno em Hoje e Tarefas continua dizendo que o pagamento
 * ficou. É exatamente como o legado passou a ter a mesma regra escrita três
 * vezes.
 *
 * O que mora aqui é só o TRANSPORTE e o recado. Nada decide se pode: quem
 * decide é `packages/domain/src/tarefa.ts`, no servidor, em toda chamada.
 */
export type UsoDasAcoes = {
  readonly acoes: AcoesDoCartao
  /**
   * A ação da jornada — a MESMA rota para as onze, e o corpo discrimina.
   *
   * Mora aqui, junto das outras quatro, porque Hoje e Tarefas mostram o mesmo
   * cartão: uma cópia por tela é como a primeira divergência passa a ser
   * silenciosa.
   */
  readonly mover: MoverEtapa
  readonly emEdicao: TarefaNaLista | null
  readonly fecharEdicao: () => void
  readonly recado: string | null
  readonly setRecado: (r: string | null) => void
  /** Fecha a edição, avisa e recarrega — o que todo `aoSalvar` precisa fazer. */
  readonly aoSalvarEdicao: (aviso: string) => void
}

/**
 * O que a pergunta de confirmação (D-21) precisa saber sobre a tela.
 * `podeVerValores` decide só se a pergunta de duplicidade mostra o valor que
 * a própria pessoa digitou; `hoje` é o do servidor.
 */
export type ContextoDasAcoes = { readonly podeVerValores: boolean; readonly hoje: string | null }

export function useAcoesDeTarefa(
  recarregar: () => void,
  contexto: ContextoDasAcoes = { podeVerValores: false, hoje: null },
): UsoDasAcoes {
  const [emEdicao, setEmEdicao] = useState<TarefaNaLista | null>(null)
  const [recado, setRecado] = useState<string | null>(null)

  const agir = useCallback(
    async (fn: () => Promise<TarefasAfetadas>, aviso: string) => {
      try {
        await fn()
        setRecado(aviso)
        recarregar()
      } catch (e) {
        setRecado(e instanceof Error ? e.message : 'Não consegui completar a ação.')
        // Relança: o cartão precisa saber que falhou para não fechar o painel
        // de conclusão com o que a pessoa digitou lá dentro.
        throw e
      }
    },
    [recarregar],
  )

  const acoes: AcoesDoCartao = {
    concluir: (id: string, d: DadosDaConclusao) =>
      agir(
        () =>
          postarComConfirmacao<TarefasAfetadas>(
            `v1/tarefas/${id}/concluir`,
            {
              em: d.em,
              resultado: d.resultado,
              // Dinheiro atravessa como STRING DE CENTAVOS. Nada de número
              // aqui: `JSON.stringify` de um `bigint` lança, e de um `number`
              // perderia o centavo que a regra 1 existe para guardar.
              ...(d.pagamento === undefined
                ? {}
                : {
                    pagamento: {
                      valor: d.pagamento.valor.toString(),
                      forma: d.pagamento.forma,
                      valorAberto: (d.pagamento.valorAberto ?? 0n).toString(),
                    },
                  }),
            },
            {
              dia: d.em,
              hoje: contexto.hoje,
              valor: d.pagamento?.valor ?? null,
              podeVerValores: contexto.podeVerValores,
            },
          ),
        'Tarefa concluída.',
      ),
    cancelar: (id: string) =>
      agir(
        () => chamar<TarefasAfetadas>(`v1/tarefas/${id}/cancelar`, { method: 'POST', body: '{}' }),
        'Tarefa cancelada.',
      ),
    reabrir: (id: string) =>
      agir(
        () => chamar<TarefasAfetadas>(`v1/tarefas/${id}/reabrir`, { method: 'POST', body: '{}' }),
        'Tarefa reaberta. Se havia pagamento, ele foi estornado.',
      ),
    editar: (t: TarefaNaLista) => setEmEdicao(t),
  }

  const mover: MoverEtapa = (id, corpo) =>
    agir(
      () =>
        // Só `fechar` grava dinheiro, e só ele recebe 409 de confirmação; as
        // outras ações passam pela mesma porta sem nunca perguntar nada. O
        // dinheiro do fechamento entra AGORA — o dia é o hoje do servidor.
        postarComConfirmacao<TarefasAfetadas>(`v1/tarefas/${id}/jornada`, corpo, {
          dia: contexto.hoje,
          hoje: contexto.hoje,
          valor: valorDoFechamento(corpo),
          podeVerValores: contexto.podeVerValores,
        }),
      AVISO_DA_ACAO[String(corpo['acao'])] ?? 'Registrado.',
    )

  return {
    acoes,
    mover,
    emEdicao,
    fecharEdicao: () => setEmEdicao(null),
    recado,
    setRecado,
    aoSalvarEdicao: (aviso: string) => {
      setEmEdicao(null)
      setRecado(aviso)
      recarregar()
    },
  }
}

/**
 * O que a tela confirma depois de cada ação (`design.md` §4: toda ação
 * confirma o que aconteceu).
 *
 * As frases são as da PO — e as de `noshow` e `desmarcar` dizem para ONDE o
 * cartão foi, porque ele sai da lista do dia na hora e a recepção precisa
 * saber que ele não sumiu.
 */
const AVISO_DA_ACAO: Readonly<Record<string, string>> = {
  enviarConfirmacao: 'Envio da confirmação registrado.',
  confirmar: 'Confirmação registrada.',
  noshow: 'No-show registrado · fica em Recontatar até reagendar.',
  desmarcar: 'Desmarcação registrada · fica em Recontatar até reagendar.',
  reagendar: 'Reagendado.',
  encerrar: 'Agendamento encerrado.',
  registrarOrcamento: 'Orçamento registrado.',
  followUp: 'Follow-up registrado.',
  perder: 'Orçamento marcado como perdido.',
  fechar: 'Fechamento registrado.',
}

/** O valor que a pessoa digitou no "Fechou" — texto de centavos no corpo. */
function valorDoFechamento(corpo: Readonly<Record<string, unknown>>): bigint | null {
  const r = corpo['recebimento']
  if (typeof r !== 'object' || r === null) return null
  const v = (r as Record<string, unknown>)['valor']
  return typeof v === 'string' && /^d+$/.test(v) ? BigInt(v) : null
}
