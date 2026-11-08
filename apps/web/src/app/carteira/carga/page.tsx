'use client'

import type { CargaDaEquipeSaida } from '@fir/contracts'
import { useEffect, useState } from 'react'
import { DetalheDaCarga, FormularioDeRedistribuir, TabelaDaCarga } from '@/components/carteira/carga-tabela'
import { AbasDaRotina, useEquipeEClientes } from '@/components/carteira/rotina-pecas'
import { Carregando, Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../pecas'

/**
 * **CARGA DA EQUIPE** (`vCarga`, L1832; G8 2A, R7/R8). Pessoa × atrasadas e
 * quatro semanas de segunda a domingo, no fuso da carteira — contado no
 * servidor. Escolher uma pessoa mostra o detalhe por cliente e o
 * "Redistribuir tarefas".
 *
 * Módulo interno da Firmare: por ora só `escopo = 'geral'` (gate appsec A-5;
 * `carteira.administrar`, A-9, quando o ticket 0.5 a criar). Quem não pode vê
 * "Sem acesso a esta tela" — o servidor já responde 403.
 */

type Estado =
  | { tag: 'carregando' }
  | { tag: 'sem-acesso' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; carga: CargaDaEquipeSaida }

export default function CargaDaEquipe() {
  const { sessao } = useCarteira()
  const pronta = sessao.tag === 'pronta'
  const { equipe, clientes } = useEquipeEClientes(pronta)
  const [pessoa, setPessoa] = useState<string | null>(null)
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [redistribuindo, setRedistribuindo] = useState(false)
  const [recado, setRecado] = useState<string | null>(null)

  useEffect(() => {
    if (!pronta) return
    let valeu = true
    const q = pessoa === null ? '' : `?pessoa=${encodeURIComponent(pessoa)}`
    chamar<CargaDaEquipeSaida>(`v1/carteira/carga${q}`)
      .then((carga) => {
        if (valeu) setEstado({ tag: 'pronto', carga })
      })
      .catch((e: unknown) => {
        if (!valeu) return
        if (e instanceof ErroDaApi && e.status === 403) setEstado({ tag: 'sem-acesso' })
        else setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar a carga.' })
      })
    return () => {
      valeu = false
    }
  }, [pronta, pessoa, tentativa])

  const pessoas = equipe?.pessoas ?? []

  const cabecalho = (
    <>
      <NavDaCarteira atual="/carteira/rotina" />
      <p className="rot-int-sobretitulo">Equipe Firmare</p>
      <h1 className="titulo">Rotina da equipe</h1>
      <AbasDaRotina atual="carga" podeVerCarga={estado.tag !== 'sem-acesso'} />
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
  if (estado.tag === 'sem-acesso') {
    return (
      <section>
        {cabecalho}
        <p className="carteira-erro" role="alert">
          Sem acesso a esta tela. A carga da equipe e a redistribuição são da gestão da Firmare.
        </p>
      </section>
    )
  }
  if (estado.tag === 'erro') {
    return (
      <section>
        {cabecalho}
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
      </section>
    )
  }

  const { carga } = estado
  const nomeDe = (id: string) => carga.pessoas.find((p) => p.usuarioGestaoId === id)?.nome ?? ''

  return (
    <section>
      {cabecalho}
      {carga.pessoas.length === 0 ? (
        <p className="nota">Nenhuma pessoa ativa na equipe.</p>
      ) : (
        <TabelaDaCarga carga={carga} selecionada={pessoa} aoSelecionar={(id) => setPessoa(id === pessoa ? null : id)} />
      )}

      {redistribuindo && pessoa !== null ? (
        <FormularioDeRedistribuir
          de={pessoa}
          pessoas={pessoas}
          clientes={clientes}
          aoTerminar={(r, para) => {
            setRedistribuindo(false)
            setRecado(r)
            setPessoa(para)
            setTentativa((n) => n + 1)
          }}
          aoFechar={() => setRedistribuindo(false)}
        />
      ) : null}

      {carga.detalhe !== null ? (
        <DetalheDaCarga detalhe={carga.detalhe} nome={nomeDe(carga.detalhe.usuarioGestaoId)} aoRedistribuir={() => setRedistribuindo(true)} />
      ) : null}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}
