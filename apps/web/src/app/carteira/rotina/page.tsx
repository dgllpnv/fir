'use client'

import type { ListaDeTarefasCarteiraSaida, TarefaCarteira } from '@fir/contracts'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PainelDeAniversarios } from '@/components/carteira/aniversarios-painel'
import { CheckinDoCliente } from '@/components/carteira/rotina-checkin'
import { AbasDaRotina, useEquipeEClientes } from '@/components/carteira/rotina-pecas'
import { CartaoDeTarefa, EscolhaTarefaOuRotina, FormularioDeTarefa } from '@/components/carteira/rotina-tarefa'
import { Carregando, Toast, Vazio } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../pecas'

/**
 * **MINHAS TAREFAS** — a Rotina da equipe Firmare (`vRotina`/`vTarefas`,
 * L1861–1888; G8 2A, R1). Filtro Minhas · Todas · por pessoa; as quatro
 * colunas do protótipo (Vencidas · Hoje · Próximos 7 dias · Mais adiante)
 * viram SEÇÕES EMPILHADAS — em 390 px quatro colunas lado a lado rolariam na
 * horizontal. "Concluídas recentemente" (6) embaixo.
 *
 * A seção de cada tarefa e o "hoje" vêm do servidor, no fuso da carteira
 * (regras 23 e 24). "Minhas" é recorte da lista já autorizada (ADR 0016).
 */

type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; lista: ListaDeTarefasCarteiraSaida }

type Painel = { tag: 'nenhum' } | { tag: 'escolha' } | { tag: 'tarefa'; tarefa: TarefaCarteira | null }

const SECOES: readonly { chave: NonNullable<TarefaCarteira['secao']>; titulo: string }[] = [
  { chave: 'vencidas', titulo: 'Vencidas' },
  { chave: 'hoje', titulo: 'Hoje' },
  { chave: 'proximos7', titulo: 'Próximos 7 dias' },
  { chave: 'adiante', titulo: 'Mais adiante' },
]

export default function MinhasTarefas() {
  const router = useRouter()
  const { sessao } = useCarteira()
  const pronta = sessao.tag === 'pronta'
  const { equipe, clientes } = useEquipeEClientes(pronta)
  const [filtro, setFiltro] = useState<string>('minhas')
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [painel, setPainel] = useState<Painel>({ tag: 'nenhum' })
  const [recado, setRecado] = useState<string | null>(null)

  useEffect(() => {
    if (!pronta) return
    let valeu = true
    // Recarregar depois de uma ação mantém a lista na tela até a nova chegar:
    // nada pula embaixo do dedo (design.md §5).
    setEstado((e) => (e.tag === 'pronto' ? e : { tag: 'carregando' }))
    chamar<ListaDeTarefasCarteiraSaida>(`v1/carteira/tarefas-internas?responsavel=${encodeURIComponent(filtro)}`)
      .then((lista) => {
        if (valeu) setEstado({ tag: 'pronto', lista })
      })
      .catch((e: unknown) => {
        if (valeu) setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar as tarefas.' })
      })
    return () => {
      valeu = false
    }
  }, [pronta, filtro, tentativa])

  const recarregar = () => setTentativa((n) => n + 1)
  const pessoas = equipe?.pessoas ?? []
  const eu = equipe?.eu ?? (sessao.tag === 'pronta' ? sessao.usuarioDeGestao.id : '')

  const cabecalho = (
    <>
      <NavDaCarteira atual="/carteira/rotina" />
      <p className="rot-int-sobretitulo">Equipe Firmare</p>
      <div className="rot-int-cabeca">
        <h1 className="titulo">Rotina da equipe</h1>
        <div className="carteira-acoes">
          <button type="button" className="btn ghost" onClick={() => router.push('/carteira/rotina/rotinas#nova')}>
            Nova rotina
          </button>
          <button type="button" className="btn" onClick={() => setPainel({ tag: 'escolha' })}>
            Nova tarefa
          </button>
        </div>
      </div>
      <p className="nota">Tarefas do dia a dia e rotinas fixas de cada pessoa.</p>
      <AbasDaRotina atual="tarefas" podeVerCarga={equipe?.podeVerCarga ?? false} />
    </>
  )

  if (estado.tag === 'carregando' || !pronta) {
    return (
      <section>
        {cabecalho}
        <Carregando linhas={5} />
      </section>
    )
  }
  if (estado.tag === 'erro') {
    return (
      <section>
        {cabecalho}
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={recarregar} />
      </section>
    )
  }

  const { lista } = estado
  // Concluir/editar atualiza a lista; o que muda de seção ou de dono vem na
  // próxima leitura — a seção é do servidor, a tela não a recalcula.
  const aoMudar = () => recarregar()

  return (
    <section>
      {cabecalho}

      {painel.tag === 'escolha' ? (
        <EscolhaTarefaOuRotina
          aoEscolher={(o) => (o === 'rotina' ? router.push('/carteira/rotina/rotinas#nova') : setPainel({ tag: 'tarefa', tarefa: null }))}
          aoFechar={() => setPainel({ tag: 'nenhum' })}
        />
      ) : null}
      {painel.tag === 'tarefa' ? (
        <FormularioDeTarefa
          key={painel.tarefa?.id ?? 'nova'}
          tarefa={painel.tarefa}
          hoje={lista.hoje}
          eu={eu}
          pessoas={pessoas}
          clientes={clientes}
          aoSalvar={(t, criada) => {
            setPainel({ tag: 'nenhum' })
            setRecado(criada ? `Tarefa "${t.titulo}" criada` : 'Tarefa atualizada')
            recarregar()
          }}
          aoFechar={() => setPainel({ tag: 'nenhum' })}
        />
      ) : null}

      <div className="rot-int-filtros" role="group" aria-label="De quem">
        {[
          { chave: 'minhas', rotulo: 'Minhas' },
          { chave: 'todas', rotulo: 'Todas' },
          ...pessoas.filter((p) => p.id !== eu).map((p) => ({ chave: p.id, rotulo: p.nome })),
        ].map((f) => (
          <button
            key={f.chave}
            type="button"
            className={filtro === f.chave ? 'rot-int-filtro rot-int-filtro-atual' : 'rot-int-filtro'}
            aria-pressed={filtro === f.chave}
            onClick={() => setFiltro(f.chave)}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      <PainelDeAniversarios />

      {lista.tarefas.length === 0 && lista.concluidasRecentes.length === 0 ? (
        <Vazio>
          <b>Nenhuma tarefa por aqui.</b>
          <p className="nota">Crie uma tarefa ou uma rotina — as rotinas geram as tarefas sozinhas até 7 dias antes.</p>
          <button type="button" className="btn" onClick={() => setPainel({ tag: 'escolha' })}>
            Nova tarefa
          </button>
        </Vazio>
      ) : (
        <>
          {SECOES.map((s) => {
            const daSecao = lista.tarefas.filter((t) => t.secao === s.chave)
            return (
              <section key={s.chave} className={s.chave === 'vencidas' ? 'rot-int-secao rot-int-secao-atrasada' : 'rot-int-secao'}>
                <h2 className="rot-int-secao-titulo">
                  {s.titulo} <span className="num">{daSecao.length}</span>
                </h2>
                {daSecao.length === 0 ? (
                  <p className="nota">Nada aqui.</p>
                ) : (
                  daSecao.map((t) => (
                    <CartaoDeTarefa
                      key={t.id}
                      tarefa={t}
                      pessoas={pessoas}
                      aoMudar={aoMudar}
                      aoAvisar={setRecado}
                      aoEditar={(tarefa) => setPainel({ tag: 'tarefa', tarefa })}
                    />
                  ))
                )}
              </section>
            )
          })}
          <section className="rot-int-secao">
            <h2 className="rot-int-secao-titulo">Concluídas recentemente</h2>
            {lista.concluidasRecentes.length === 0 ? (
              <p className="nota">Nenhuma ainda.</p>
            ) : (
              lista.concluidasRecentes.map((t) => (
                <CartaoDeTarefa
                  key={t.id}
                  tarefa={t}
                  pessoas={pessoas}
                  aoMudar={aoMudar}
                  aoAvisar={setRecado}
                  aoEditar={(tarefa) => setPainel({ tag: 'tarefa', tarefa })}
                />
              ))
            )}
          </section>
        </>
      )}

      <details className="carteira-dobra">
        <summary>Checkin da semana</summary>
        <CheckinDoCliente clientes={clientes} aoAvisar={setRecado} />
      </details>

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}
