'use client'

import type {
  ClinicaAtual,
  FluxoDaTarefa,
  GruposDaEquipe,
  ListaDaEquipe,
  NoDoFluxo,
} from '@fir/contracts'
import { useMemo } from 'react'
import { useDados } from '@/lib/dados'
import { ehEventoDeConclusao, eventoEmFrase, quemConcluiu, type Nomes } from '@/lib/fluxo-da-tarefa'
import { instanteEmTexto } from '@/lib/instante'
import { Carregando } from './estados'

/**
 * A linha do tempo do FLUXO da tarefa: criada por, enviada a, transferências
 * (de → para, quem, quando, nota), assumida, concluída — e a cadeia de tarefas
 * ligadas ("concluir e criar nova").
 *
 * Tudo vem de `GET v1/tarefas/:id/fluxo`, já filtrado pelo servidor: o nó que a
 * pessoa não enxerga chega só com `id` e `posicao`, e aqui vira "Etapa sem
 * acesso" — a cadeia existe, o conteúdo não. A tela nunca tenta preencher o que
 * o servidor calou.
 *
 * É o mesmo componente no cartão de Hoje/Tarefas e na ficha da paciente (a ficha
 * usa o `CartaoDeTarefa`). Datas: `instanteEmTexto`, no FUSO DA CLÍNICA — nunca
 * `slice` do ISO UTC, que põe a tarefa das 22h no dia seguinte.
 */
export function LinhaDoTempoDoFluxo({
  tarefaId,
  solicitanteNome,
  criadaEm,
}: {
  tarefaId: string
  solicitanteNome: string
  criadaEm: string
}) {
  const fluxo = useDados<FluxoDaTarefa>(`v1/tarefas/${tarefaId}/fluxo`)
  const clinica = useDados<ClinicaAtual>('v1/clinica')
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const grupos = useDados<GruposDaEquipe>('v1/grupos')

  const nomes = useMemo<Nomes>(() => {
    const p = new Map((equipe.dados?.equipe ?? []).map((x) => [x.id, x.nome] as const))
    const g = new Map((grupos.dados?.grupos ?? []).map((x) => [x.id, x.nome] as const))
    // O nome que o próprio fluxo traz (destino dos nós) cobre grupo desativado.
    for (const n of fluxo.dados?.nos ?? []) {
      if (n.visivel && n.destino.tipo === 'grupo') g.set(n.destino.id, n.destino.nome)
      if (n.visivel && n.destino.tipo === 'pessoa') p.set(n.destino.id, n.destino.nome)
    }
    return { pessoa: (id) => p.get(id) ?? null, grupo: (id) => g.get(id) ?? null }
  }, [equipe.dados, grupos.dados, fluxo.dados])

  if (fluxo.erro !== null) {
    return (
      <p className="nota" role="alert">
        Não consegui carregar o fluxo desta tarefa.{' '}
        <button type="button" className="link" onClick={fluxo.recarregar}>
          Tentar de novo
        </button>
      </p>
    )
  }
  if (fluxo.dados === null || clinica.dados === null) return <Carregando linhas={2} fino />

  const { fuso, hoje } = clinica.dados
  const quando = (iso: string): string => instanteEmTexto(iso, fuso, hoje) ?? '—'
  const nos = [...fluxo.dados.nos].sort((a, b) => a.posicao - b.posicao)

  if (nos.length === 0) return <p className="nota">Nada registrado no fluxo desta tarefa ainda.</p>

  return (
    <div aria-label="Fluxo da tarefa" role="group">
      <ol
        style={{
          listStyle: 'none',
          margin: 0,
          padding: '0 0 0 14px',
          display: 'grid',
          gap: 12,
          borderLeft: '2px solid var(--line)',
        }}
      >
        {nos.map((no) => (
          <li key={no.id} style={{ position: 'relative', minWidth: 0 }}>
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: -21,
                top: 5,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: no.visivel ? 'var(--gold)' : 'var(--line)',
              }}
            />
            {no.visivel ? (
              <NoVisivel
                no={no}
                ehEsta={no.id === fluxo.dados?.raizId}
                solicitanteNome={solicitanteNome}
                criadaEm={criadaEm}
                nomes={nomes}
                quando={quando}
              />
            ) : (
              <span className="nota" style={{ fontStyle: 'italic' }}>
                Etapa sem acesso
              </span>
            )}
          </li>
        ))}
      </ol>
      {fluxo.dados.truncado ? (
        <p className="nota" style={{ marginTop: 8 }}>
          Cadeia longa, parcial: só parte das tarefas ligadas está aqui.
        </p>
      ) : null}
    </div>
  )
}

const ROTULO_DO_ESTADO = {
  aberta: 'Em aberto',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
} as const

function NoVisivel({
  no,
  ehEsta,
  solicitanteNome,
  criadaEm,
  nomes,
  quando,
}: {
  no: Extract<NoDoFluxo, { visivel: true }>
  ehEsta: boolean
  solicitanteNome: string
  criadaEm: string
  nomes: Nomes
  quando: (iso: string) => string
}) {
  return (
    <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
      <div style={{ overflowWrap: 'anywhere' }}>
        <b>{no.descricao}</b>{' '}
        <span className={no.status === 'concluida' ? 'pill bom' : 'pill'}>
          {ROTULO_DO_ESTADO[no.status]}
        </span>
        {ehEsta ? <span className="pill"> Esta tarefa</span> : null}
      </div>
      <div className="nota" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {ehEsta ? `Criada por ${solicitanteNome} · ${quando(criadaEm)}` : `Criada ${quando(no.criadaEm)}`}
        {/* `destino` é onde a tarefa ESTÁ, não para onde foi criada: as transferências
            aparecem nos eventos abaixo. "com" solto lia como "criada com". */}
        {` · ${no.status === 'aberta' ? 'agora com' : 'estava com'} ${no.destino.tipo === 'grupo' ? `o grupo ${no.destino.nome}` : no.destino.nome}`}
      </div>
      {no.eventos.filter((e) => !ehEventoDeConclusao(e)).map((e, i) => {
        const f = eventoEmFrase(e, nomes)
        return (
          <div key={`${e.em}-${i}`} style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
            {f.texto}
            <span className="nota" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {' '}
              · {quando(e.em)}
            </span>
            {f.nota === null ? null : (
              <div className="nota" style={{ fontStyle: 'italic' }}>
                “{f.nota}”
              </div>
            )}
          </div>
        )
      })}
      {no.concluidaEm === null ? null : (
        <div className="nota" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {(() => {
            const por = quemConcluiu({ status: no.status, fluxo: no.eventos }, nomes)
            return por === null ? 'Concluída' : `Concluída por ${por}`
          })()}{' '}
          · {quando(no.concluidaEm)}
        </div>
      )}
    </div>
  )
}
