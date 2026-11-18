'use client'

import type { KpiNaReuniao, ListaDaEquipe, MetaDeKpiNaSaida, ReuniaoDeIndicadores } from '@fir/contracts'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Carregando, Erro, Toast } from '@/components/estados'
import { useDados } from '@/lib/dados'
import { larguraDaBarra } from '@/lib/financeiro'
import { ICONE_ANTERIOR, ICONE_PROXIMO } from '@/lib/icones'
import { Selo } from './cartao-do-kpi'
import { PainelDoPlanoDeAcao } from './detalhe-paineis'
import {
  diaCompleto,
  diaEMes,
  emAtencao,
  numeroDoCartao,
  ROTULO_DA_SITUACAO,
  situacaoDoCartao,
  textoDaMeta,
  textoDaVariacao,
  TOM_DA_SITUACAO,
} from './na-tela'
import {
  indiceVizinho,
  resumoDaCapa,
  ROTULO_DO_STATUS_DO_PLANO,
  saiuDaTelaCheiaPeloEsc,
  type Slide,
  slidesDaReuniao,
  textoDaSemana,
  tituloDoSlide,
} from './reuniao-na-tela'
import './reuniao.css'

type PlanoAberto = { readonly id: string; readonly nome: string } | null

/**
 * **O Modo reunião** (backlog 1.9 F; spec I-43, I-46): tela cheia, fundo
 * creme, um slide por vez, para a TV da sala na reunião semanal.
 *
 * Setas do teclado (e PageUp/PageDown, que é o que o passador de slides
 * manda), os botões ‹ › nos cantos de baixo, "4 de 9" à direita, Esc ou ✕
 * para sair. "+ Plano de ação" abre o formulário por cima, sem sair do modo;
 * ao salvar, o slide final ganha o plano.
 *
 * `GET /v1/indicadores/reuniao` não traz composição, paciente nem nome de
 * paciente (L-IN-4), e sem `valores` o `emDinheiro` já veio apagado: o
 * número grande vira o percentual da meta, sem nenhum `if` aqui. O objetivo
 * do OKR e a descrição do plano são texto livre da equipe, e aparecem como
 * foram digitados.
 */
export function ModoReuniao({ minhaPessoaId }: { minhaPessoaId: string }) {
  const router = useRouter()
  const r = useDados<ReuniaoDeIndicadores>('v1/indicadores/reuniao')
  const [indice, setIndice] = useState(0)
  const [plano, setPlano] = useState<PlanoAberto>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const [telaCheia, setTelaCheia] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  // A equipe só é pedida quando alguém abre "+ Plano de ação".
  const equipe = useDados<ListaDaEquipe>(plano === null ? null : 'v1/equipe')

  const slides: Slide[] = r.dados === null ? [] : slidesDaReuniao(r.dados)
  const total = slides.length
  const atual = Math.min(indice, Math.max(total - 1, 0))
  const slide = slides[atual] ?? null

  // `peloBotao`: a próxima saída da tela cheia é nossa (✕ ou "Sair da tela
  // cheia"), não o Esc do navegador. Ver o efeito do `fullscreenchange`.
  const peloBotao = useRef(false)
  const sair = useCallback(() => {
    if (document.fullscreenElement !== null) {
      peloBotao.current = true
      void document.exitFullscreen().catch(() => undefined)
    }
    router.push('/indicadores')
  }, [router])

  const ir = useCallback((passo: -1 | 1) => setIndice((i) => indiceVizinho(i, total, passo)), [total])

  // A reunião vai para o `body`, por cima do casco, e o casco fica `inert`:
  // sem isto o Tab caminharia pela lateral escondida atrás da TV, e o leitor
  // de tela leria o menu como se estivesse na tela.
  const [montado, setMontado] = useState(false)
  useEffect(() => {
    setMontado(true)
    const casco = document.querySelector('.shell')
    casco?.setAttribute('inert', '')
    return () => casco?.removeAttribute('inert')
  }, [])
  useEffect(() => {
    if (montado) raiz.current?.focus()
  }, [montado])

  // O botão "Modo reunião" já pediu a tela cheia no clique (`pedirTelaCheia`).
  // Em tela cheia o Esc é do navegador: a tela cheia que cai sem o nosso botão
  // é o Esc, e ele continua saindo da reunião — menos com o formulário aberto,
  // em que o Esc é dele.
  const estavaEmTelaCheia = useRef(false)
  useEffect(() => {
    estavaEmTelaCheia.current = document.fullscreenElement !== null
    setTelaCheia(estavaEmTelaCheia.current)
    const aoMudar = () => {
      const agora = document.fullscreenElement !== null
      const sairDaReuniao = saiuDaTelaCheiaPeloEsc(estavaEmTelaCheia.current, agora, peloBotao.current)
      estavaEmTelaCheia.current = agora
      peloBotao.current = false
      setTelaCheia(agora)
      if (sairDaReuniao && plano === null) sair()
    }
    document.addEventListener('fullscreenchange', aoMudar)
    return () => document.removeEventListener('fullscreenchange', aoMudar)
  }, [plano, sair])

  // Com o formulário aberto, o teclado é dele: a seta move o cursor no campo
  // e o Esc fecha o formulário, não a reunião.
  useEffect(() => {
    if (plano !== null) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
      const alvo = e.target
      if (alvo instanceof HTMLElement && alvo.closest('input, select, textarea, [contenteditable="true"]') !== null) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        ir(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        ir(-1)
      } else if (e.key === 'Home') {
        e.preventDefault()
        setIndice(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setIndice(Math.max(total - 1, 0))
      } else if (e.key === 'Escape') {
        e.preventDefault()
        sair()
      }
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [plano, ir, sair, total])

  const alternarTelaCheia = () => {
    if (document.fullscreenElement !== null) {
      peloBotao.current = true
      void document.exitFullscreen().catch(() => {
        peloBotao.current = false
      })
    } else void document.documentElement.requestFullscreen?.().catch(() => undefined)
  }

  const recarregar = r.recarregar
  const planoSalvo = useCallback(
    (texto: string) => {
      setPlano(null)
      setRecado(`${texto} Ele aparece no slide final.`)
      recarregar()
    },
    [recarregar],
  )
  const fecharPlano = useCallback(() => setPlano(null), [])

  if (!montado) return null
  return createPortal(
    <div className="rn" ref={raiz} tabIndex={-1} role="region" aria-label="Modo reunião">
      <header className="rn-topo">
        <div className="rn-marca">
          <span className="eyebrow">Modo reunião</span>
          {r.dados === null ? null : <span className="rn-clinica">{r.dados.capa.clinica}</span>}
        </div>
        <div className="rn-topo-acoes">
          <button type="button" className="btn ghost rn-tela-cheia" onClick={alternarTelaCheia} aria-pressed={telaCheia}>
            {telaCheia ? 'Sair da tela cheia' : 'Tela cheia'}
          </button>
          <button type="button" className="rn-icone" aria-label="Sair do Modo reunião" title="Sair (Esc)" onClick={sair}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </header>

      <div className="rn-palco">
        {r.carregando && r.dados === null ? (
          <div className="rn-slide">
            <Carregando linhas={4} />
          </div>
        ) : null}
        {r.erro === null ? null : (
          <div className="rn-slide">
            <Erro mensagem={r.erro} recarregar={r.recarregar} />
          </div>
        )}
        {r.dados === null || slide === null ? null : (
          <article
            key={atual}
            className="rn-slide"
            data-tipo={slide.tipo}
            aria-roledescription="slide"
            aria-label={`${atual + 1} de ${total}: ${tituloDoSlide(slide)}`}
          >
            <ConteudoDoSlide slide={slide} r={r.dados} aoPlano={(k) => setPlano(k)} />
          </article>
        )}
      </div>

      <footer className="rn-rodape">
        <button type="button" className="rn-seta" aria-label="Slide anterior" disabled={atual === 0 || total === 0} onClick={() => ir(-1)}>
          {ICONE_ANTERIOR}
        </button>
        <div className="rn-rodape-meio">
          {slide?.tipo === 'kpi' ? (
            <button type="button" className="btn ghost" onClick={() => setPlano({ id: slide.kpi.id, nome: slide.kpi.nome })}>
              + Plano de ação
            </button>
          ) : null}
        </div>
        <span className="rn-contador" aria-live="polite">
          {total === 0 ? '' : `${atual + 1} de ${total}`}
        </span>
        <button
          type="button"
          className="rn-seta"
          aria-label="Próximo slide"
          disabled={total === 0 || atual >= total - 1}
          onClick={() => ir(1)}
        >
          {ICONE_PROXIMO}
        </button>
      </footer>

      {plano === null || r.dados === null ? null : (
        <PainelDoPlanoDeAcao
          kpi={{ id: plano.id, nome: plano.nome, responsavelId: null }}
          hoje={r.dados.hoje}
          equipe={equipe.dados?.equipe ?? []}
          minhaPessoaId={minhaPessoaId}
          aoFechar={fecharPlano}
          aoSalvo={planoSalvo}
        />
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </div>,
    document.body,
  )
}

export function ConteudoDoSlide({
  slide,
  r,
  aoPlano,
}: {
  slide: Slide
  r: ReuniaoDeIndicadores
  aoPlano: (k: { id: string; nome: string }) => void
}) {
  switch (slide.tipo) {
    case 'capa':
      return <Capa r={r} />
    case 'okr':
      return <SlideDoOkr okr={slide.okr} aoPlano={aoPlano} />
    case 'kpi':
      return <SlideDoKpi kpi={slide.kpi} />
    case 'planos':
      return <SlideDosPlanos planos={r.planosDeAcao} />
  }
}

function Capa({ r }: { r: ReuniaoDeIndicadores }) {
  const c = r.capa
  return (
    <div className="rn-capa">
      <span className="eyebrow">{textoDaSemana(r.semana)}</span>
      <h1>{c.clinica}</h1>
      <p className="rn-resumo">{resumoDaCapa(r)}</p>
      {c.metas === 0 ? (
        <p className="nota">Nenhuma meta vigente hoje. Defina as metas em Indicadores &amp; Insights para a reunião acompanhar.</p>
      ) : (
        <dl className="rn-contagens">
          <div className="ii-tom-mau">
            <dt>Abaixo do ritmo</dt>
            <dd>{c.abaixo}</dd>
          </div>
          <div className="ii-tom-atencao">
            <dt>Atenção</dt>
            <dd>{c.atencao}</dd>
          </div>
          <div className="ii-tom-ok">
            <dt>No ritmo</dt>
            <dd>{c.noRitmo}</dd>
          </div>
          <div className="ii-tom-ok">
            <dt>Atingidas</dt>
            <dd>{c.atingidas}</dd>
          </div>
        </dl>
      )}
    </div>
  )
}

function SlideDoOkr({
  okr,
  aoPlano,
}: {
  okr: ReuniaoDeIndicadores['okrs'][number]
  aoPlano: (k: { id: string; nome: string }) => void
}) {
  return (
    <>
      <div className="rn-cabeca">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">OKR · até {diaCompleto(okr.periodo.fim)}</span>
          <h1>{okr.objetivo}</h1>
        </div>
        <div className="rn-numero-grande">
          <strong>{okr.progresso === null ? '—' : `${okr.progresso}%`}</strong>
          <Selo tom={TOM_DA_SITUACAO[okr.situacao]} texto={ROTULO_DA_SITUACAO[okr.situacao]} />
        </div>
      </div>
      <div
        className="ii-barra rn-barra"
        role="img"
        aria-label={okr.progresso === null ? 'Progresso ainda sem medição' : `Progresso de ${okr.progresso}%`}
      >
        <span style={{ width: larguraDaBarra(okr.progresso) }} />
      </div>
      {okr.resultadosChave.length === 0 ? (
        <p className="nota">Nenhum resultado-chave que o seu perfil possa ver.</p>
      ) : (
        <ul className="rn-krs">
          {okr.resultadosChave.map((kr) => {
            const n = numeroDoCartao(kr.metaDoKr.atual)
            const de = textoDaMeta(kr.metaDoKr)
            return (
              <li key={kr.id} className="rn-kr">
                <div className="rn-kr-cabeca">
                  <span className="rn-kr-nome">{kr.kpi.nome}</span>
                  <Selo tom={TOM_DA_SITUACAO[kr.metaDoKr.situacao]} texto={ROTULO_DA_SITUACAO[kr.metaDoKr.situacao]} />
                </div>
                <div className="rn-valor">
                  <strong className={n.soPercentual ? 'ii-so-percentual' : undefined}>{n.texto}</strong>
                  {de === null ? null : <span>{de}</span>}
                </div>
                <BarraDaMeta meta={kr.metaDoKr} />
                {emAtencao(kr.metaDoKr.situacao) ? (
                  <button type="button" className="link rn-kr-plano" onClick={() => aoPlano({ id: kr.kpi.id, nome: kr.kpi.nome })}>
                    + Plano de ação
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function SlideDoKpi({ kpi }: { kpi: KpiNaReuniao }) {
  const situacao = situacaoDoCartao(kpi.metaVigente)
  const n = numeroDoCartao(kpi.atual)
  const de = textoDaMeta(kpi.metaVigente)
  const variacao = textoDaVariacao(kpi.variacao, kpi.direcao)
  return (
    <>
      <div className="rn-cabeca">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">Saúde da clínica · {kpi.pilar}</span>
          <h1>{kpi.nome}</h1>
        </div>
        <Selo tom={TOM_DA_SITUACAO[situacao]} texto={ROTULO_DA_SITUACAO[situacao]} />
      </div>
      <div className="rn-valor rn-valor-grande">
        <strong className={n.soPercentual ? 'ii-so-percentual' : undefined}>{n.texto}</strong>
        {de === null ? null : <span>{de}</span>}
      </div>
      {kpi.metaVigente === null ? null : <BarraDaMeta meta={kpi.metaVigente} />}
      <dl className="rn-fatos">
        <div>
          <dt>Período</dt>
          <dd>
            {diaEMes(kpi.periodo.de)} a {diaEMes(kpi.periodo.ate)}
          </dd>
        </div>
        {kpi.metaVigente === null ? null : (
          <>
            <div>
              <dt>Da meta</dt>
              <dd>{kpi.metaVigente.atual.percentualDaMeta === null ? '—' : `${kpi.metaVigente.atual.percentualDaMeta}%`}</dd>
            </div>
            <div>
              <dt>Esperado para hoje</dt>
              <dd>{kpi.metaVigente.ritmo.percentualDaMeta === null ? '—' : `${kpi.metaVigente.ritmo.percentualDaMeta}%`}</dd>
            </div>
            <div>
              <dt>Prazo</dt>
              <dd>{diaCompleto(kpi.metaVigente.prazo)}</dd>
            </div>
          </>
        )}
        <div>
          <dt>Comparação</dt>
          <dd className={variacao === null ? 'ii-tom-neutro' : `ii-tom-${variacao.tom}`}>
            {variacao === null ? 'sem comparação' : `${variacao.texto} vs. período anterior`}
          </dd>
        </div>
      </dl>
      {kpi.diasAguardando > 0 ? (
        <p className="nota">
          {kpi.diasAguardando} {kpi.diasAguardando === 1 ? 'dia aguardando' : 'dias aguardando'} fechamento do caixa, fora da conta.
        </p>
      ) : null}
    </>
  )
}

function SlideDosPlanos({ planos }: { planos: ReuniaoDeIndicadores['planosDeAcao'] }) {
  return (
    <>
      <div className="rn-cabeca">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">Fechamento</span>
          <h1>Planos de ação da semana</h1>
        </div>
      </div>
      {planos.length === 0 ? (
        <p className="nota rn-vazio">
          Nenhum plano de ação criado nesta semana. Use “+ Plano de ação” nos slides dos indicadores.
        </p>
      ) : (
        <ul className="rn-planos">
          {planos.map((p) => (
            <li key={p.id} className="rn-plano" data-status={p.status}>
              <div className="rn-plano-texto">
                <b>{p.descricao}</b>
                <small>
                  {p.kpi.nome} · {p.responsavel ?? 'Sem responsável'}
                </small>
              </div>
              <div className="rn-plano-lado">
                <span>até {diaEMes(p.prazo)}</span>
                <span className="rn-status">{ROTULO_DO_STATUS_DO_PLANO[p.status]}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function BarraDaMeta({ meta }: { meta: MetaDeKpiNaSaida }) {
  return (
    <div
      className="ii-barra rn-barra"
      role="img"
      aria-label={
        meta.atual.percentualDaMeta === null
          ? 'Meta sem medição ainda'
          : `${meta.atual.percentualDaMeta}% da meta${meta.ritmo.percentualDaMeta === null ? '' : `; o ritmo esperado para hoje é ${meta.ritmo.percentualDaMeta}%`}`
      }
    >
      <span style={{ width: larguraDaBarra(meta.atual.percentualDaMeta) }} />
      {meta.ritmo.percentualDaMeta === null ? null : <i style={{ left: larguraDaBarra(meta.ritmo.percentualDaMeta) }} />}
    </div>
  )
}
