'use client'

import type { ComposicaoDoKpi, DetalheDoKpi, ListaDeLancamentos } from '@fir/contracts'
import { useCallback, useEffect, useState } from 'react'
import { Carregando, Erro } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { consultaEmTexto } from '@/lib/dados'
import {
  type CorrecaoDoLancamento,
  correcaoDoLancamento,
  enderecoDoRelatorio,
  larguraDoGrupo,
  MOTIVO_SEM_COMPOSICAO,
  numeroDoGrupo,
  rotuloDoRelatorio,
  TITULO_DO_BLOCO,
  valorDoLancamento,
} from './detalhe-na-tela'
import { diaCompleto, diaEMes, numeroDoCartao } from './na-tela'

type EstadoDaComposicao =
  | { readonly tipo: 'carregando' }
  | { readonly tipo: 'pronto'; readonly dados: ComposicaoDoKpi }
  | { readonly tipo: 'sem_acesso' }
  | { readonly tipo: 'escondido' }
  | { readonly tipo: 'erro'; readonly mensagem: string }

/**
 * **"De onde vem o número" de um KPI automático** (1.9 E; LGPD L-IN-3).
 *
 * `GET …/kpis/:id/composicao` devolve os grupos (por forma, tipo, origem) com
 * a quantidade e o número de cada um — nunca paciente. A barrinha de cada
 * grupo é a `escala` do servidor, relativa ao bloco; o número sai do
 * formatador central e, sem `valores`, o servidor já apagou os reais.
 *
 * 403 é "Sem acesso ao detalhe" (a permissão da composição falta); 422 é o
 * KPI que não tem composição como rota, e o bloco some.
 */
export function ComposicaoNaTela({ kpi, temAcesso }: { kpi: DetalheDoKpi; temAcesso: boolean }) {
  const [estado, setEstado] = useState<EstadoDaComposicao>(temAcesso ? { tipo: 'carregando' } : { tipo: 'sem_acesso' })
  const [tentativa, setTentativa] = useState(0)
  const { de, ate } = kpi.periodo

  useEffect(() => {
    if (!temAcesso) return
    let valeu = true
    setEstado({ tipo: 'carregando' })
    chamar<ComposicaoDoKpi>(`v1/indicadores/kpis/${kpi.id}/composicao${consultaEmTexto({ de, ate })}`)
      .then((dados) => valeu && setEstado({ tipo: 'pronto', dados }))
      .catch((x: unknown) => {
        if (!valeu) return
        if (x instanceof ErroDaApi && x.status === 403) setEstado({ tipo: 'sem_acesso' })
        else if (x instanceof ErroDaApi && x.status === 422) setEstado({ tipo: 'escondido' })
        else setEstado({ tipo: 'erro', mensagem: x instanceof ErroDaApi ? x.message : 'Não consegui carregar a composição.' })
      })
    return () => {
      valeu = false
    }
  }, [kpi.id, de, ate, temAcesso, tentativa])

  if (estado.tipo === 'escondido') return null
  if (estado.tipo === 'sem_acesso') return <p className="kd-sem-acesso">Sem acesso ao detalhe.</p>
  if (estado.tipo === 'carregando') return <Carregando linhas={3} fino />
  if (estado.tipo === 'erro') return <Erro mensagem={estado.mensagem} recarregar={() => setTentativa((t) => t + 1)} />

  const c = estado.dados
  const total = c.total === null ? null : numeroDoCartao(c.total)
  return (
    <div className="kd-fonte">
      <p>{kpi.explicacao ?? '—'}</p>
      <p className="kd-numero-nota">
        {diaEMes(c.periodo.de)} a {diaEMes(c.periodo.ate)}
        {total === null ? '' : ` · total ${total.texto}`}
        {c.diasAguardando > 0
          ? ` · ${c.diasAguardando} ${c.diasAguardando === 1 ? 'dia aguardando' : 'dias aguardando'} fechamento, fora dos grupos`
          : ''}
      </p>
      {!c.disponivel ? (
        <p className="nota">{MOTIVO_SEM_COMPOSICAO[c.motivoIndisponivel ?? 'sem_composicao']}</p>
      ) : (
        c.blocos.map((b) => (
          <section key={b.por} className="kd-bloco" aria-label={TITULO_DO_BLOCO[b.por]}>
            <h4>{TITULO_DO_BLOCO[b.por]}</h4>
            {b.grupos.length === 0 ? (
              <p className="nota">Nada no período.</p>
            ) : (
              <ul className="kd-grupos">
                {b.grupos.map((g) => (
                  <li key={g.rotulo}>
                    <span className="kd-grupo-rotulo">{g.rotulo}</span>
                    <span className="kd-grupo-qtd">{g.quantidade}</span>
                    <span className="kd-grupo-numero">{numeroDoGrupo(g.numero)}</span>
                    <span className="kd-grupo-barra" aria-hidden="true">
                      <i style={{ width: larguraDoGrupo(g.numero) }} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {b.truncado ? <p className="nota">Mostrando os {b.grupos.length} maiores grupos; o restante está no relatório.</p> : null}
          </section>
        ))
      )}
      {c.relatorio === null ? null : (
        <a className="link" href={enderecoDoRelatorio(c.relatorio)}>
          {rotuloDoRelatorio(c.relatorio.chave)}
        </a>
      )}
    </div>
  )
}

const POR_PAGINA = 12

/**
 * **KPI manual: os lançamentos**, do mais recente para o mais antigo, com
 * "Ver mais" enquanto o servidor disser `temMais`. Sem `valores`, o valor em
 * reais veio apagado e a coluna mostra "—". O lápis relança a referência —
 * relançar corrige (I-31).
 */
export function LancamentosNaTela({
  kpi,
  podeLancar,
  aoLancar,
  versao,
}: {
  kpi: DetalheDoKpi
  podeLancar: boolean
  /** O lápis de uma linha: abre a D.4 com a referência e o valor DELA. */
  aoLancar: (correcao: CorrecaoDoLancamento) => void
  /** Muda quando um lançamento foi salvo: a lista volta à primeira página. */
  versao: number
}) {
  const [itens, setItens] = useState<ListaDeLancamentos['itens'] | null>(null)
  const [unidade, setUnidade] = useState(kpi.unidade)
  const [temMais, setTemMais] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const buscar = useCallback(
    async (deslocamento: number) => {
      setCarregando(true)
      setErro(null)
      try {
        const r = await chamar<ListaDeLancamentos>(
          `v1/indicadores/kpis/${kpi.id}/lancamentos${consultaEmTexto({ limite: POR_PAGINA, deslocamento })}`,
        )
        setUnidade(r.unidade)
        setItens((antes) => (deslocamento === 0 || antes === null ? r.itens : [...antes, ...r.itens]))
        setTemMais(r.temMais)
      } catch (x) {
        setErro(x instanceof ErroDaApi ? x.message : 'Não consegui carregar os lançamentos.')
      } finally {
        setCarregando(false)
      }
    },
    [kpi.id],
  )

  useEffect(() => {
    void buscar(0)
  }, [buscar, versao])

  return (
    <div className="kd-fonte">
      {kpi.comoMedir === '' ? null : <p>{kpi.comoMedir}</p>}
      {kpi.lancamentoPendente === true ? <p className="kd-aviso">O lançamento deste período ainda não foi feito.</p> : null}
      {erro !== null ? <Erro mensagem={erro} recarregar={() => void buscar(0)} /> : null}
      {itens === null && erro === null ? <Carregando linhas={3} fino /> : null}
      {itens !== null && itens.length === 0 ? <p className="nota">Nenhum lançamento ainda.</p> : null}
      {itens === null || itens.length === 0 ? null : (
        <table className="kd-tabela">
          <thead>
            <tr>
              <th scope="col">Referência</th>
              <th scope="col" className="kd-num">
                Valor
              </th>
              <th scope="col">Quem lançou</th>
              <th scope="col" className="kd-col-comentario">
                Comentário
              </th>
              {podeLancar ? (
                <th scope="col">
                  <span className="sr-apenas">Corrigir</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {itens.map((l) => (
              <tr key={l.referencia}>
                <td>{diaCompleto(l.referencia)}</td>
                <td className="kd-num">{valorDoLancamento(unidade, l.lancado)}</td>
                <td>{l.autor ?? '—'}</td>
                <td className="kd-col-comentario">{l.comentario === '' ? '—' : l.comentario}</td>
                {podeLancar ? (
                  <td>
                    <button
                      type="button"
                      className="kd-lapis"
                      aria-label={`Corrigir o lançamento de ${diaCompleto(l.referencia)}`}
                      onClick={() => aoLancar(correcaoDoLancamento(unidade, l))}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
                      </svg>
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {temMais ? (
        <button type="button" className="link" disabled={carregando} onClick={() => void buscar(itens?.length ?? 0)}>
          {carregando ? 'Carregando…' : 'Ver mais'}
        </button>
      ) : null}
    </div>
  )
}
