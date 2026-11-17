'use client'

import type { DetalheDoKpi, MetaDeKpiNaSaida, SerieDoKpi } from '@fir/contracts'
import { type KeyboardEvent, type PointerEvent, useId, useMemo, useState } from 'react'
import { Dica } from '@/components/dica'
import { Carregando, Erro } from '@/components/estados'
import { consultaEmTexto, useDados } from '@/lib/dados'
import {
  alvoComparavel,
  atalhosDoPersonalizado,
  type Botao,
  conferirPersonalizado,
  type DesenhoDaMeta,
  desenharBarras,
  desenharMeta,
  inteiroDe,
  type Janela,
  janelaDaMeta,
  janelaDosMeses,
  leituraDoRitmoDiario,
  ORDEM_DOS_BOTOES,
  pontosDaLinha,
  ROTULO_DO_AGRUPAMENTO,
  ROTULO_DO_BOTAO,
  TEXTO_DO_ERRO_DO_PERSONALIZADO,
} from './detalhe-na-tela'
import { diaCompleto } from './na-tela'

const W = 600
const H = 200

/**
 * **O gráfico grande do detalhe (1.9 E)**, com o seletor de período.
 *
 * Abre em "Período da meta" (as quatro linhas). "3 meses" e "12 meses"
 * mostram o histórico: KPI mensal em barras (o mês corrente em dourado,
 * "parcial"), KPI semanal em linha. "Personalizado" abre De e Até, com os
 * atalhos; o agrupamento é o que o servidor escolheu (I-29), e a etiqueta
 * acima do gráfico diz qual.
 *
 * Dia aguardando fechamento, em QUALQUER KPI em reais (números c.10): barra
 * clara de altura fixa, sem valor e sem escala — o servidor não mandou
 * nenhum dos dois, e a tela não inventa.
 */
export function GraficoDoDetalhe({ kpi, meta, hoje }: { kpi: DetalheDoKpi; meta: MetaDeKpiNaSaida | null; hoje: string }) {
  const [botao, setBotao] = useState<Botao>('meta')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [aplicado, setAplicado] = useState<{ de: string; ate: string } | null>(null)
  const [erroDoPersonalizado, setErroDoPersonalizado] = useState<string | null>(null)
  const idDoErro = useId()

  const semMeta = botao === 'meta' && meta === null
  const janela: Janela | null = useMemo(() => {
    if (botao === 'tres' || semMeta) return janelaDosMeses(3, hoje, kpi.frequencia)
    if (botao === 'doze') return janelaDosMeses(12, hoje, kpi.frequencia)
    if (botao === 'meta') return meta === null ? null : janelaDaMeta(meta, hoje)
    return aplicado
  }, [botao, semMeta, hoje, kpi.frequencia, meta, aplicado])

  const serie = useDados<SerieDoKpi>(
    janela === null
      ? null
      : `v1/indicadores/kpis/${kpi.id}/serie${consultaEmTexto({ de: janela.de, ate: janela.ate, agrupamento: janela.agrupamento })}`,
  )

  const aplicar = (d: string, a: string) => {
    const e = conferirPersonalizado(d, a, hoje)
    setErroDoPersonalizado(e === null ? null : TEXTO_DO_ERRO_DO_PERSONALIZADO[e])
    if (e === null) setAplicado({ de: d, ate: a })
  }

  const modoMeta = botao === 'meta' && meta !== null
  const dados = serie.dados

  return (
    <section className="kd-grafico" aria-labelledby="kd-grafico-titulo">
      <div className="kd-grafico-cabeca">
        <h3 id="kd-grafico-titulo" className="sr-apenas">
          Gráfico
        </h3>
        <span className="kd-etiqueta" aria-live="polite">
          {dados === null ? ' ' : ROTULO_DO_AGRUPAMENTO[dados.agrupamento]}
        </span>
        <div className="kd-seletor" role="group" aria-label="Período do gráfico">
          {ORDEM_DOS_BOTOES.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={botao === b}
              onClick={() => {
                setBotao(b)
                if (b === 'personalizado' && aplicado === null) {
                  setDe(`${hoje.slice(0, 7)}-01`)
                  setAte(hoje)
                }
              }}
            >
              {ROTULO_DO_BOTAO[b]}
            </button>
          ))}
        </div>
      </div>

      {botao === 'personalizado' ? (
        <form
          className="kd-personalizado"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            aplicar(de, ate)
          }}
        >
          <div className="kd-personalizado-campos">
            <label className="campo">
              De
              <input
                type="date"
                value={de}
                max={hoje}
                aria-invalid={erroDoPersonalizado !== null}
                aria-describedby={erroDoPersonalizado === null ? undefined : idDoErro}
                onChange={(e) => setDe(e.target.value)}
              />
            </label>
            <label className="campo">
              Até
              <input
                type="date"
                value={ate}
                max={hoje}
                aria-invalid={erroDoPersonalizado !== null}
                aria-describedby={erroDoPersonalizado === null ? undefined : idDoErro}
                onChange={(e) => setAte(e.target.value)}
              />
            </label>
            <button type="submit" className="btn">
              Aplicar
            </button>
          </div>
          {erroDoPersonalizado === null ? null : (
            <p className="erro kd-erro" id={idDoErro} role="alert">
              {erroDoPersonalizado}
            </p>
          )}
          <div className="kd-atalhos" role="group" aria-label="Atalhos de período">
            {atalhosDoPersonalizado(hoje).map((a) => (
              <button
                key={a.rotulo}
                type="button"
                className="link"
                onClick={() => {
                  setDe(a.de)
                  setAte(a.ate)
                  aplicar(a.de, a.ate)
                }}
              >
                {a.rotulo}
              </button>
            ))}
          </div>
        </form>
      ) : null}

      {semMeta ? <p className="kd-aviso">Este indicador ainda não tem meta. Mostrando os últimos 3 meses.</p> : null}
      {dados !== null && !dados.barrasSomamOTotal && !modoMeta ? (
        <div className="kd-aviso kd-aviso-dica">
          <Dica rotulo="Por que as barras não somam o total" titulo={<span>As barras não somam o total do período.</span>}>
            <p>
              Cada barra é medida sozinha, na sua própria janela. O total do período é medido de uma vez, na janela
              inteira — por isso não é a soma das barras.
            </p>
          </Dica>
        </div>
      ) : null}

      {botao === 'personalizado' && aplicado === null ? (
        <div className="kd-area kd-area-vazia">
          <p>Escolha as datas e toque em Aplicar.</p>
        </div>
      ) : modoMeta && meta !== null && janela === null ? (
        <GraficoDaMeta desenho={desenharMeta(meta, null, kpi.agregacao, hoje)} meta={meta} hoje={hoje} />
      ) : serie.erro !== null ? (
        <div className="kd-area">
          <Erro mensagem={serie.erro} recarregar={serie.recarregar} />
        </div>
      ) : dados === null ? (
        <div className="kd-area" aria-busy="true">
          <Carregando linhas={4} />
        </div>
      ) : modoMeta && meta !== null ? (
        <GraficoDaMeta desenho={desenharMeta(meta, dados, kpi.agregacao, hoje)} meta={meta} hoje={hoje} />
      ) : (
        <GraficoDaSerie
          serie={dados}
          alvo={alvoComparavel(kpi.agregacao, dados.agrupamento, meta) && meta !== null ? inteiroDe(meta.alvo) : null}
          emLinha={dados.agrupamento === 'semana'}
        />
      )}
    </section>
  )
}

/** A leitura do ponto tocado: linha de altura fixa (o gráfico não pula), lida pelo leitor de tela. */
function Leitura({ texto }: { texto: string | null }) {
  return (
    <p className="kd-leitura" aria-live="polite">
      {texto ?? 'Toque ou passe o mouse num ponto para ver a data e o valor.'}
    </p>
  )
}

function indiceDoToque(e: PointerEvent<HTMLDivElement>, n: number): number {
  const r = e.currentTarget.getBoundingClientRect()
  const f = r.width === 0 ? 0 : (e.clientX - r.left) / r.width
  return Math.min(n - 1, Math.max(0, Math.floor(f * n)))
}

function setas(e: KeyboardEvent<HTMLDivElement>, atual: number | null, n: number): number | null {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return null
  e.preventDefault()
  if (e.key === 'Home') return 0
  if (e.key === 'End') return n - 1
  const i = atual ?? (e.key === 'ArrowRight' ? -1 : n)
  return Math.min(n - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)))
}

/** Barras (KPI mensal, dia a dia) ou linha (KPI semanal), com a régua dourada do alvo quando ela se compara. */
function GraficoDaSerie({ serie, alvo, emLinha }: { serie: SerieDoKpi; alvo: bigint | null; emLinha: boolean }) {
  const desenho = useMemo(() => desenharBarras(serie, alvo), [serie, alvo])
  const [foco, setFoco] = useState<number | null>(null)
  if (desenho === null || desenho.barras.length === 0) {
    return (
      <div className="kd-area kd-area-vazia">
        <p>Sem dado neste período.</p>
      </div>
    )
  }
  const n = desenho.barras.length
  const passo = n <= 12 ? 1 : Math.ceil(n / 8)
  const coluna = W / n
  const y = (f: number) => H - f * H
  const b = foco === null ? null : (desenho.barras[foco] ?? null)
  const ritmoDiario = desenho.ritmo === null ? null : leituraDoRitmoDiario(serie.ritmoDiario)

  return (
    <>
      <Leitura texto={b?.leitura ?? null} />
      <div
        className="kd-area"
        role="group"
        tabIndex={0}
        aria-label={`Gráfico, ${ROTULO_DO_AGRUPAMENTO[serie.agrupamento].toLowerCase()}, ${n} ${n === 1 ? 'ponto' : 'pontos'}. Use as setas para ler cada um.`}
        onPointerMove={(e) => setFoco(indiceDoToque(e, n))}
        onPointerDown={(e) => setFoco(indiceDoToque(e, n))}
        onKeyDown={(e) => {
          const i = setas(e, foco, n)
          if (i !== null) setFoco(i)
        }}
      >
        <svg className="kd-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" data-pontos={n}>
          <line className="kd-eixo" x1={0} x2={W} y1={y(desenho.zero)} y2={y(desenho.zero)} vectorEffect="non-scaling-stroke" />
          {foco === null ? null : (
            <rect className="kd-foco" x={foco * coluna} y={0} width={coluna} height={H} />
          )}
          {emLinha ? (
            <polyline
              className="kd-linha-real"
              points={pontosDaLinha(desenho)
                .filter((p) => p !== null)
                .map((p) => `${(p.i + 0.5) * coluna},${y(p.y)}`)
                .join(' ')}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {desenho.barras.map((barra, i) => {
            if (emLinha && barra.tipo !== 'aguardando') return null
            if (barra.tipo === 'sem_dado') return null
            const largura = coluna * 0.68
            return (
              <rect
                key={barra.chave}
                className={`kd-barra kd-barra-${barra.tipo}`}
                data-tipo={barra.tipo}
                x={i * coluna + (coluna - largura) / 2}
                y={y(barra.ate)}
                width={largura}
                height={Math.max(1, (barra.ate - barra.de) * H)}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
          {desenho.alvo === null ? null : (
            <line className="kd-linha-alvo" x1={0} x2={W} y1={y(desenho.alvo)} y2={y(desenho.alvo)} vectorEffect="non-scaling-stroke" />
          )}
          {desenho.ritmo === null ? null : (
            <line
              className="kd-linha-ritmo kd-linha-ritmo-diario"
              x1={0}
              x2={W}
              y1={y(desenho.ritmo)}
              y2={y(desenho.ritmo)}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      <div className="kd-rotulos" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden="true">
        {desenho.barras.map((barra, i) => (
          <span key={barra.chave}>
            {i % passo === 0 || i === n - 1 ? barra.rotulo : ''}
            {barra.tipo === 'parcial' ? <em>parcial</em> : null}
          </span>
        ))}
      </div>
      <Legenda
        itens={[
          emLinha ? { classe: 'real', texto: 'Valor' } : null,
          desenho.barras.some((x) => x.tipo === 'parcial') ? { classe: 'parcial', texto: 'Período em andamento' } : null,
          desenho.barras.some((x) => x.tipo === 'aguardando') ? { classe: 'aguardando', texto: 'Aguardando fechamento do caixa' } : null,
          desenho.alvo === null ? null : { classe: 'alvo', texto: 'Meta' },
          desenho.ritmo === null ? null : { classe: 'ritmo-diario', texto: 'Ritmo diário da meta' },
        ]}
      />
      {ritmoDiario === null ? null : <p className="kd-nota">{ritmoDiario}</p>}
      <ul className="sr-apenas">
        {desenho.barras.map((barra) => (
          <li key={barra.chave}>{barra.leitura}</li>
        ))}
      </ul>
    </>
  )
}

const linha = (pts: readonly { x: number; y: number }[]) => pts.map((p) => `${p.x * W},${H - p.y * H}`).join(' ')

/** As quatro linhas do período da meta. */
function GraficoDaMeta({ desenho, meta, hoje }: { desenho: DesenhoDaMeta; meta: MetaDeKpiNaSaida; hoje: string }) {
  const [foco, setFoco] = useState<number | null>(null)
  const n = desenho.leituras.length
  const escolher = (x: number) => {
    let melhor = 0
    desenho.leituras.forEach((l, i) => {
      if (Math.abs(l.x - x) < Math.abs((desenho.leituras[melhor]?.x ?? 0) - x)) melhor = i
    })
    setFoco(n === 0 ? null : melhor)
  }
  const lido = foco === null ? null : (desenho.leituras[foco] ?? null)
  const ponto = foco === null ? null : (desenho.real[foco] ?? null)
  const larguraDoDia = Math.max(2, (W / desenho.dias) * 0.68)

  return (
    <>
      <Leitura texto={lido?.texto ?? null} />
      <div
        className="kd-area"
        role="group"
        tabIndex={0}
        aria-label={`Gráfico do período da meta, de ${diaCompleto(meta.inicio)} a ${diaCompleto(meta.prazo)}. Use as setas para ler cada ponto.`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          escolher(r.width === 0 ? 0 : (e.clientX - r.left) / r.width)
        }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          escolher(r.width === 0 ? 0 : (e.clientX - r.left) / r.width)
        }}
        onKeyDown={(e) => {
          if (n === 0) return
          const i = setas(e, foco, n)
          if (i !== null) setFoco(i)
        }}
      >
        <svg className="kd-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" data-modo={desenho.modo}>
          <line className="kd-eixo" x1={0} x2={W} y1={H} y2={H} vectorEffect="non-scaling-stroke" />
          {desenho.aguardando.map((x) => (
            <rect
              key={x}
              className="kd-barra kd-barra-aguardando"
              data-tipo="aguardando"
              x={x * W}
              y={H - H * 0.35}
              width={larguraDoDia}
              height={H * 0.35}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {desenho.hoje === null || desenho.hoje >= 1 ? null : (
            <line className="kd-hoje" x1={desenho.hoje * W} x2={desenho.hoje * W} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
          )}
          <line className="kd-linha-alvo" x1={0} x2={W} y1={H - desenho.alvo * H} y2={H - desenho.alvo * H} vectorEffect="non-scaling-stroke" />
          <polyline className="kd-linha-ritmo" points={linha(desenho.ritmo)} vectorEffect="non-scaling-stroke" />
          {desenho.projecao.length < 2 ? null : (
            <polyline className="kd-linha-projecao" points={linha(desenho.projecao)} vectorEffect="non-scaling-stroke" />
          )}
          {desenho.real.length < 2 ? null : (
            <polyline className="kd-linha-real" points={linha(desenho.real)} vectorEffect="non-scaling-stroke" />
          )}
          {ponto === null ? null : (
            <line className="kd-guia" x1={ponto.x * W} x2={ponto.x * W} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      </div>
      <div className="kd-rotulos-meta" aria-hidden="true">
        <span style={{ left: 0 }}>{diaCompleto(meta.inicio).slice(0, 5)}</span>
        {desenho.hoje !== null && desenho.hoje > 0.15 && desenho.hoje < 0.85 ? (
          <span className="kd-rotulo-hoje" style={{ left: `${desenho.hoje * 100}%` }}>
            hoje
          </span>
        ) : null}
        <span style={{ right: 0 }}>{diaCompleto(meta.prazo).slice(0, 5)}</span>
      </div>
      <Legenda
        itens={[
          { classe: 'real', texto: 'Real' },
          { classe: 'ritmo', texto: 'Ritmo esperado' },
          desenho.projecao.length < 2 ? null : { classe: 'projecao', texto: 'Projeção' },
          { classe: 'alvo', texto: 'Meta' },
          desenho.aguardando.length > 0 ? { classe: 'aguardando', texto: 'Aguardando fechamento do caixa' } : null,
        ]}
      />
      {desenho.modo === 'percentual' ? <p className="kd-nota">Em percentual da meta.</p> : null}
      <ul className="sr-apenas">
        {desenho.leituras.map((l) => (
          <li key={`${l.x}-${l.texto}`}>{l.texto}</li>
        ))}
        {hoje > meta.prazo ? <li>A meta terminou em {diaCompleto(meta.prazo)}.</li> : null}
      </ul>
    </>
  )
}

function Legenda({ itens }: { itens: readonly ({ classe: string; texto: string } | null)[] }) {
  const visiveis = itens.filter((i) => i !== null)
  if (visiveis.length === 0) return null
  return (
    <ul className="kd-legenda">
      {visiveis.map((i) => (
        <li key={i.classe}>
          <i className={`kd-legenda-${i.classe}`} aria-hidden="true" />
          {i.texto}
        </li>
      ))}
    </ul>
  )
}
