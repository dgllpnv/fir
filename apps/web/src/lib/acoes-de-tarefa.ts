'use client'

import type { TarefaNaLista, TarefasAfetadas } from '@fir/contracts'
import { useCallback, useState } from 'react'
import type { AcoesDoCartao, DadosDaConclusao } from '@/components/cartao-de-tarefa'
import { chamar } from './api'

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
  readonly emEdicao: TarefaNaLista | null
  readonly fecharEdicao: () => void
  readonly recado: string | null
  readonly setRecado: (r: string | null) => void
  /** Fecha a edição, avisa e recarrega — o que todo `aoSalvar` precisa fazer. */
  readonly aoSalvarEdicao: (aviso: string) => void
}

export function useAcoesDeTarefa(recarregar: () => void): UsoDasAcoes {
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
          chamar<TarefasAfetadas>(`v1/tarefas/${id}/concluir`, {
            method: 'POST',
            body: JSON.stringify({
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
            }),
          }),
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

  return {
    acoes,
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
