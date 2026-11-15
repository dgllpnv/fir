'use client'

import type {
  DestinoDaTarefa,
  GruposDaEquipe,
  ListaDaEquipe,
  MeusGrupos,
  TarefaNaLista,
  TarefasAfetadas,
} from '@fir/contracts'
import { type Autor, podeCorrigirOrcamento } from '@fir/domain'
import { useCallback, useMemo, useState } from 'react'
import type { AcoesDoCartao, DadosDaConclusao } from '@/components/cartao-de-tarefa'
import type { MoverEtapa } from '@/components/jornada/faixa-da-jornada'
import { chamar } from './api'
import { useDados } from './dados'
import { postarComConfirmacao } from './dialogo-de-confirmacao'
import { mensagemDoFluxo, type Nomes } from './fluxo-da-tarefa'
import { corpoComMotivo } from './motivo-de-suporte'
import { pagamentoEmbutidoEmTexto } from './partes-do-pagamento'

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
export type ContextoDasAcoes = {
  readonly podeVerValores: boolean
  readonly hoje: string | null
  /**
   * Quem está na tela: `{ id: sessao.minhaPessoaId, podeEquipe: temPerm(…,
   * 'tarefas.equipe') }`. Com ele, "Corrigir orçamento" some do cartão que a
   * pessoa não pode editar (B1) — pela MESMA `podeCorrigirOrcamento` do
   * servidor. Ausente, o botão aparece e o servidor responde 403 a quem não
   * pode: falhar mostrando é melhor que esconder de quem pode.
   */
  readonly autor?: Autor
}

export function useAcoesDeTarefa(
  recarregar: () => void,
  contexto: ContextoDasAcoes = { podeVerValores: false, hoje: null },
): UsoDasAcoes {
  const [emEdicao, setEmEdicao] = useState<TarefaNaLista | null>(null)
  const [recado, setRecado] = useState<string | null>(null)

  // Os MEUS grupos e os nomes, lidos UMA vez por tela e repassados ao cartão:
  // um pedido por cartão seriam dezenas de idas ao servidor. O que o cartão faz
  // com eles é só mostrar o botão certo — o servidor decide (`podeAssumir`).
  const meus = useDados<MeusGrupos>('v1/grupos/meus')
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const grupos = useDados<GruposDaEquipe>('v1/grupos')
  const meusGrupoIds = meus.dados?.grupoIds
  const nomes = useMemo<Nomes>(() => {
    const p = new Map((equipe.dados?.equipe ?? []).map((x) => [x.id, x.nome] as const))
    const g = new Map((grupos.dados?.grupos ?? []).map((x) => [x.id, x.nome] as const))
    return { pessoa: (id) => p.get(id) ?? null, grupo: (id) => g.get(id) ?? null }
  }, [equipe.dados, grupos.dados])

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
                    pagamento: pagamentoEmbutidoEmTexto(d.pagamento),
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
    meusGrupoIds: meusGrupoIds ?? [],
    nomes,
    assumir: async (id: string, nota?: string) => {
      try {
        await chamar<TarefasAfetadas>(`v1/tarefas/${id}/assumir`, {
          method: 'POST',
          body: JSON.stringify(nota === undefined || nota.trim() === '' ? {} : { nota: nota.trim() }),
        })
        setRecado('Tarefa assumida. Agora ela é sua.')
        recarregar()
      } catch (e) {
        setRecado(mensagemDoFluxo(e, 'assumir'))
        // 409: perdeu a corrida — a lista está velha, e é o que a pessoa precisa ver.
        recarregar()
        throw e
      }
    },
    transferir: async (id: string, para: DestinoDaTarefa, nota?: string) => {
      try {
        await chamar<TarefasAfetadas>(`v1/tarefas/${id}/transferir`, {
          method: 'POST',
          body: JSON.stringify({
            para,
            ...(nota === undefined || nota.trim() === '' ? {} : { nota: nota.trim() }),
          }),
        })
        setRecado('Tarefa transferida.')
        recarregar()
      } catch (e) {
        // Sem toast: o modal de transferência mostra o erro ao lado do botão, e
        // duas mensagens para a mesma falha é o que a casa evita.
        throw new Error(mensagemDoFluxo(e, 'transferir'))
      }
    },
    // O motivo vai no CORPO (a URL vai para log); só o Suporte Firmare o envia.
    excluir: (id: string, motivo?: string) =>
      agir(
        () =>
          chamar<TarefasAfetadas>(`v1/tarefas/${id}?serie=false`, {
            method: 'DELETE',
            ...corpoComMotivo(motivo),
          }),
        'Tarefa excluída. Se havia pagamento, ele foi estornado.',
      ),
  }

  const enviar = (id: string, corpo: Record<string, unknown>) =>
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
  const autor = contexto.autor
  const mover: MoverEtapa =
    autor === undefined
      ? enviar
      : Object.assign(enviar, {
          podeCorrigirOrcamento: (t: TarefaNaLista) =>
            podeCorrigirOrcamento(t, { ...autor, grupoIds: meusGrupoIds ?? [] }),
        })

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
  retomarRestante: 'Restante do orçamento atualizado.',
  corrigirOrcamento: 'Orçamento corrigido.',
}

/**
 * O valor que a pessoa digitou no "Fechou" — texto de centavos no corpo.
 *
 * Exportada para o teste: a expressão era `/^d+$/` (sem a barra invertida),
 * que só casa com "d", "dd"… — o valor nunca chegava à pergunta de possível
 * duplicidade (D-21), e nenhum erro aparecia.
 */
export function valorDoFechamento(corpo: Readonly<Record<string, unknown>>): bigint | null {
  const r = corpo['recebimento']
  if (typeof r !== 'object' || r === null) return null
  const v = (r as Record<string, unknown>)['valor']
  return typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : null
}
