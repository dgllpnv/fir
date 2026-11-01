'use client'

import type { AlertaNaEquipe } from '@fir/contracts'
import { useState } from 'react'
import { chamar } from '@/lib/api'

/**
 * **Os alertas da equipe**, com "Gerar tarefa" em cada um.
 *
 * Férias · Experiência · Documento · Banco de horas. O texto, a severidade, o
 * **prazo** e a **descrição da tarefa** vêm prontos do servidor, no fuso da
 * clínica (regras 22 e 24): a tela não calcula "faltam quantos dias" nem
 * decide que a tarefa nasce sete dias antes. O protótipo faz as duas contas no
 * navegador, com `today()`.
 *
 * É este componente que torna a ficha uma ferramenta em vez de um arquivo: um
 * documento vencido que não avisa não serve para nada.
 */
export function Alertas({
  alertas,
  avisar,
  mostrarNome = false,
}: {
  alertas: readonly AlertaNaEquipe[]
  avisar: (a: string) => void
  /** A lista geral mistura as pessoas; a ficha já sabe de quem é. */
  mostrarNome?: boolean
}) {
  /** Os alertas que já viraram tarefa nesta sessão, por índice. */
  const [criados, setCriados] = useState<ReadonlySet<number>>(new Set())
  const [ocupado, setOcupado] = useState<number | null>(null)

  async function gerarTarefa(a: AlertaNaEquipe, i: number) {
    setOcupado(i)
    try {
      await chamar('v1/tarefas', {
        method: 'POST',
        body: JSON.stringify({
          // O PRAZO E A DESCRIÇÃO SÃO DO SERVIDOR. A tela os devolve como
          // chegaram — ela não é autoridade sobre data de negócio.
          descricao: a.descricaoDaTarefa,
          prazo: a.prazoDaTarefa,
          prioridade: a.severidade === 'critico' ? 'urgente' : 'normal',
        }),
      })
      setCriados((atual) => new Set(atual).add(i))
      avisar('Tarefa criada.')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não consegui criar a tarefa.')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <div className="alertas">
      {alertas.map((a, i) => (
        <div
          key={`${a.fichaId}-${a.tipo}-${a.em}-${a.texto}`}
          className={a.severidade === 'critico' ? 'alerta critico' : 'alerta'}
        >
          <div className="info">
            <b>{mostrarNome ? `${a.nome} · ${a.tipo}` : a.tipo}</b>
            <span>{a.texto}</span>
          </div>
          <div className="acao">
            {criados.has(i) ? (
              <span className="pill bom">Tarefa criada</span>
            ) : (
              <button
                type="button"
                className="link"
                disabled={ocupado === i}
                onClick={() => void gerarTarefa(a, i)}
              >
                {ocupado === i ? 'Criando…' : 'Gerar tarefa'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
