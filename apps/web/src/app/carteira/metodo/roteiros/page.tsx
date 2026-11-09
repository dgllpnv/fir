'use client'

import { useMemo, useState } from 'react'
import type { AoMudarEnsaio } from '@/components/carteira/roteiro-campo'
import { alternarSituacao, comRespostasDeExemplo, ensaioVazio, type EstadoDoEnsaio } from '@/components/carteira/roteiro-ensaio'
import { TelaDoEnsaio } from '@/components/carteira/roteiro-ensaio-tela'
import { RoteiroLeitura } from '@/components/carteira/roteiro-leitura'
import { MapaEmBreve } from '@/components/carteira/roteiro-mapa'
import { SeletorDePrograma } from '@/components/carteira/roteiro-seletor'
import { Carregando } from '@/components/estados'
import { blocosDoPrograma, type Programa } from '@/conteudo/roteiro-briefing'
import { useCarteira } from '../../contexto'
import { ErroDaCarteira } from '../../pecas'

/**
 * **MÉTODO FIRMARE · ROTEIROS DE BRIEFING** (ticket 3E, inventário X1/B1/B9).
 *
 * Duas coisas, nenhuma grava nada:
 *
 *  1. **Ler** o roteiro de cada programa (`vMetodo`, L2682–2686).
 *  2. **Ensaiar**: responder sem cliente, marcar "Perguntar depois" e "Não se
 *     aplica", ver o progresso e o resumo, e recomeçar (`ensaiar`, L2900;
 *     `vDiag` com `d.ensaio`).
 *
 * O Mapa de Maturidade (B8) fica para a Etapa 1 do gate LGPD: o botão está no
 * lugar do protótipo e abre uma tela que explica isso, sem calcular nada.
 *
 * O ensaio é um `useState` desta página e mais nada (gate LGPD A1): sem
 * chamada à API, sem `localStorage`/`sessionStorage`, sem rota que receba
 * resposta. Sair da tela, recarregar ou "Encerrar ensaio" apaga tudo — o
 * mesmo `ENSAIO = null` do protótipo. `roteiro-sem-gravar.test.ts` varre o
 * código-fonte desta tela e dos componentes dela para provar.
 *
 * Nenhuma permissão além da sessão: no protótipo o Método Firmare abre para
 * toda pessoa ativa (`can("metodo")`, L1116), e o conteúdo não tem titular.
 */

type Modo = { tag: 'leitura' } | { tag: 'ensaio'; ensaio: EstadoDoEnsaio; mapa: boolean }

export default function RoteirosDeBriefing() {
  const { sessao, recarregar } = useCarteira()
  const [programa, setPrograma] = useState<Programa>('Gestão')
  const [modo, setModo] = useState<Modo>({ tag: 'leitura' })

  const atualizar = (f: (e: EstadoDoEnsaio) => EstadoDoEnsaio) =>
    setModo((m) => (m.tag === 'ensaio' ? { ...m, ensaio: f(m.ensaio) } : m))

  const acoes = useMemo<AoMudarEnsaio>(
    () => ({
      responder: (id, valor) => atualizar((e) => ({ ...e, resp: { ...e.resp, [id]: valor } })),
      marcar: (id, situacao) => atualizar((e) => alternarSituacao(e, id, situacao)),
      quemResponde: (id, quem) => atualizar((e) => ({ ...e, quem: { ...e.quem, [id]: quem } })),
    }),
    [],
  )

  const irParaOTopo = () => window.scrollTo(0, 0)

  if (sessao.tag === 'erro') {
    return (
      <section>
        <h1 className="titulo">Roteiros de briefing</h1>
        <ErroDaCarteira mensagem={sessao.mensagem} recarregar={recarregar} />
      </section>
    )
  }

  if (sessao.tag !== 'pronta') {
    return (
      <section>
        <h1 className="titulo">Roteiros de briefing</h1>
        <Carregando linhas={4} />
      </section>
    )
  }

  if (modo.tag === 'ensaio') {
    return (
      <section>
        {modo.mapa ? (
          <MapaEmBreve
            voltar={() => {
              setModo({ ...modo, mapa: false })
              irParaOTopo()
            }}
          />
        ) : (
          <TelaDoEnsaio
            ensaio={modo.ensaio}
            acoes={acoes}
            trocarPrograma={(p) => atualizar((e) => ({ ...e, programa: p }))}
            preencherExemplo={() => atualizar(comRespostasDeExemplo)}
            abrirMapa={() => {
              setModo({ ...modo, mapa: true })
              irParaOTopo()
            }}
            encerrar={() => {
              setModo({ tag: 'leitura' })
              irParaOTopo()
            }}
          />
        )}
      </section>
    )
  }

  const blocos = blocosDoPrograma(programa)
  const perguntas = blocos.reduce((n, b) => n + b.perguntas.length, 0)

  return (
    <section>
      <div className="eyebrow">Método Firmare</div>
      <h1 className="titulo">Roteiros de briefing</h1>
      <p className="nota">
        O roteiro de cada programa, para ler, treinar a conversa ou mostrar, sem precisar de uma cliente.
      </p>

      <div className="brief-filtros">
        <SeletorDePrograma programa={programa} escolher={setPrograma} />
        <span className="brief-contagem num">
          {blocos.length} blocos · {perguntas} perguntas
        </span>
        <button
          type="button"
          className="btn brief-ensaiar"
          onClick={() => {
            setModo({ tag: 'ensaio', ensaio: ensaioVazio(programa), mapa: false })
            irParaOTopo()
          }}
        >
          Ensaiar este roteiro
        </button>
      </div>

      <RoteiroLeitura blocos={blocos} />
    </section>
  )
}
