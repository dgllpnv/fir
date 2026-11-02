'use client'

import { useMemo, useRef, useState } from 'react'
import {
  type AchadoNoManual,
  ajudaVisivel,
  buscarNaAjuda,
  buscarNoManual,
  manualVisivel,
  rotuloDoCapitulo,
  termosDeBusca,
} from '@/conteudo/busca'
import { AJUDA } from '@/conteudo/ajuda'
import { MANUAL } from '@/conteudo/manual'
import { type Bloco, interpretar } from '@/conteudo/marcacao'
import type { CapituloDoManual, PerguntaDaAjuda, SecaoDoManual } from '@/conteudo/tipos'
import { Vazio } from './estados'

/**
 * **Ajuda e manual** — as 51 perguntas e os 14 capítulos escritos pela PO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UMA TELA, DUAS ABAS, **UM** CAMPO DE BUSCA
 *
 * No protótipo são duas telas (`vAjuda` e `vManual`), cada uma com a sua
 * busca, ligadas por dois atalhos que copiam o texto digitado de uma para a
 * outra (`S.manQ = q.value`). Os atalhos existem porque **a pessoa não sabe
 * onde a resposta mora** — e o que ela faz com o telefone na mão é digitar a
 * dúvida uma vez.
 *
 * Aqui a consulta é um estado só, as abas a compartilham, e cada aba diz
 * quantos achados tem na outra. Digitar "pagamento parcial" e trocar de aba
 * não apaga o que ela escreveu.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **NÃO HÁ `Carregando` NEM `Erro`, e isso é a natureza do conteúdo.** Ele é
 * dado versionado no repositório (`src/conteudo/`), importado no bundle: não
 * há requisição que demore, falhe ou dependa da clínica. O estado que importa
 * — o **vazio** — existe, e diz o que fazer em seguida (`docs/design.md` §4).
 *
 * **390 px:** uma coluna. As abas e os temas são `chips` que quebram em mais
 * de uma linha; cada pergunta é um `<details>` de alvo largo; o manual é texto
 * corrido com sumário no topo. Nada rola na horizontal.
 */
export function TelaAjuda({ gestao }: { gestao: boolean }) {
  const [aba, setAba] = useState<'perguntas' | 'manual'>('perguntas')
  const [consulta, setConsulta] = useState('')
  const [tema, setTema] = useState('')

  const termos = useMemo(() => termosDeBusca(consulta), [consulta])
  const perguntas = useMemo(() => ajudaVisivel(AJUDA, gestao), [gestao])
  const capitulos = useMemo(() => manualVisivel(MANUAL, gestao), [gestao])

  const achadosNaAjuda = useMemo(
    () => buscarNaAjuda(perguntas, termos),
    [perguntas, termos],
  )
  const achadosNoManual = useMemo(
    () => buscarNoManual(capitulos, termos),
    [capitulos, termos],
  )

  return (
    <section className="ajuda">
      <div className="eyebrow">Ajuda</div>
      <div className="titulo">
        <h2>Como podemos ajudar?</h2>
      </div>
      <p className="nota">
        Digite sua dúvida com suas palavras — por exemplo: “pagamento parcial”, “trocar senha”,
        “quem está devendo”.
      </p>

      <Busca
        valor={consulta}
        aoMudar={(v) => {
          setConsulta(v)
          // Buscar e filtrar por tema ao mesmo tempo esconde o achado que
          // está em outro tema, e é o que ela faz no `desenhar`.
          if (v !== '') setTema('')
        }}
        rotulo={aba === 'perguntas' ? 'Buscar nas perguntas' : 'Buscar no manual'}
      />

      <div className="chips" role="tablist" aria-label="Ajuda e manual">
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'perguntas'}
          aria-pressed={aba === 'perguntas'}
          onClick={() => setAba('perguntas')}
        >
          Perguntas
          {termos.length > 0 ? <span className="n">{achadosNaAjuda.length}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'manual'}
          aria-pressed={aba === 'manual'}
          onClick={() => setAba('manual')}
        >
          Manual
          {termos.length > 0 ? <span className="n">{achadosNoManual.length}</span> : null}
        </button>
      </div>

      {aba === 'perguntas' ? (
        <AbaPerguntas
          perguntas={perguntas}
          achados={achadosNaAjuda}
          termos={termos}
          consulta={consulta}
          tema={tema}
          aoEscolherTema={setTema}
          achadosNoManual={achadosNoManual.length}
          aoIrAoManual={() => setAba('manual')}
        />
      ) : (
        <AbaManual
          capitulos={capitulos}
          achados={achadosNoManual}
          termos={termos}
          consulta={consulta}
          achadosNaAjuda={achadosNaAjuda.length}
          aoIrAsPerguntas={() => setAba('perguntas')}
        />
      )}
    </section>
  )
}

/** O campo de busca, com a lupa. `type="search"` dá o X de limpar de graça. */
function Busca({
  valor,
  aoMudar,
  rotulo,
}: {
  valor: string
  aoMudar: (v: string) => void
  rotulo: string
}) {
  return (
    <div className="aj-busca">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        placeholder={rotulo}
        aria-label={rotulo}
        autoComplete="off"
      />
    </div>
  )
}

function AbaPerguntas({
  perguntas,
  achados,
  termos,
  consulta,
  tema,
  aoEscolherTema,
  achadosNoManual,
  aoIrAoManual,
}: {
  perguntas: readonly PerguntaDaAjuda[]
  achados: readonly PerguntaDaAjuda[]
  termos: readonly string[]
  consulta: string
  tema: string
  aoEscolherTema: (t: string) => void
  achadosNoManual: number
  aoIrAoManual: () => void
}) {
  const temas = [...new Set(perguntas.map((p) => p.tema))]
  const buscando = termos.length > 0
  const lista = buscando ? achados : achados.filter((p) => tema === '' || p.tema === tema)

  /**
   * Agrupado por tema quando ninguém buscou; num bloco só quando buscou — a
   * ordem da busca é por relevância, e espalhá-la em sete grupos desfaz
   * exatamente o que a pontuação fez.
   */
  const grupos: readonly (readonly [string, readonly PerguntaDaAjuda[]])[] = buscando
    ? [['Resultados', lista]]
    : temas
        .filter((t) => tema === '' || t === tema)
        .map((t) => [t, lista.filter((p) => p.tema === t)] as const)

  return (
    <>
      {buscando ? null : (
        <div className="chips temas" role="group" aria-label="Temas">
          <button type="button" aria-pressed={tema === ''} onClick={() => aoEscolherTema('')}>
            Todos
          </button>
          {temas.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tema === t}
              onClick={() => aoEscolherTema(t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <p className="nota" aria-live="polite">
        {buscando
          ? `${lista.length} ${lista.length === 1 ? 'resposta encontrada' : 'respostas encontradas'}`
          : `${lista.length} ${lista.length === 1 ? 'pergunta' : 'perguntas'}`}
      </p>

      {lista.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>
            Nada encontrado para “{consulta}”.
          </p>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Tente outra palavra, como “pagamento”, “programa” ou “paciente”.
            {achadosNoManual > 0 ? (
              <>
                {' '}
                O manual tem{' '}
                <button type="button" className="link" onClick={aoIrAoManual}>
                  {achadosNoManual} {achadosNoManual === 1 ? 'trecho' : 'trechos'} com esse termo
                </button>
                .
              </>
            ) : null}
          </p>
        </Vazio>
      ) : (
        grupos.map(([t, itens]) => (
          <div className="aj-grupo" key={t}>
            <h3>
              {t} <span className="n">{itens.length}</span>
            </h3>
            {itens.map((p) => (
              <details
                className="aj-item"
                key={p.pergunta}
                /*
                  Aberta quando a busca já reduziu a três — é a regra dela.
                  Com dez resultados abertos, a resposta certa fica a uma
                  rolagem de distância do campo de busca.
                */
                open={buscando && itens.length <= 3}
              >
                <summary>
                  <Realce texto={p.pergunta} termos={termos} />
                </summary>
                <p>
                  <Realce texto={p.resposta} termos={termos} />
                </p>
              </details>
            ))}
          </div>
        ))
      )}

      {lista.length > 0 ? (
        <p className="nota aj-fim">
          Não achou? Veja o{' '}
          <button type="button" className="link" onClick={aoIrAoManual}>
            manual completo
          </button>
          , que explica cada tela passo a passo, ou fale com quem administra a clínica.
        </p>
      ) : null}
    </>
  )
}

function AbaManual({
  capitulos,
  achados,
  termos,
  consulta,
  achadosNaAjuda,
  aoIrAsPerguntas,
}: {
  capitulos: readonly CapituloDoManual[]
  achados: readonly AchadoNoManual[]
  termos: readonly string[]
  consulta: string
  achadosNaAjuda: number
  aoIrAsPerguntas: () => void
}) {
  const corpo = useRef<HTMLDivElement>(null)
  const buscando = termos.length > 0

  const irAoCapitulo = (id: string): void => {
    const alvo = corpo.current?.querySelector(`#${id}`)
    alvo?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (buscando) {
    return (
      <div ref={corpo}>
        <p className="nota" aria-live="polite">
          {achados.length} {achados.length === 1 ? 'trecho encontrado' : 'trechos encontrados'}
        </p>
        {achados.length === 0 ? (
          <Vazio>
            <p style={{ margin: 0, color: 'var(--ink)' }}>
              Nada encontrado no manual para “{consulta}”.
            </p>
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              Tente outra palavra, como “pagamento”, “sessão” ou “campanha”.
              {achadosNaAjuda > 0 ? (
                <>
                  {' '}
                  As perguntas frequentes têm{' '}
                  <button type="button" className="link" onClick={aoIrAsPerguntas}>
                    {achadosNaAjuda} {achadosNaAjuda === 1 ? 'resposta' : 'respostas'}
                  </button>
                  .
                </>
              ) : null}
            </p>
          </Vazio>
        ) : (
          achados.map(({ capitulo, secao }) => (
            <article className="man-sec achado" key={`${capitulo.id}-${secao.titulo}`}>
              <div className="man-cap-ref">{rotuloDoCapitulo(capitulo)}</div>
              <h3>
                <Realce texto={secao.titulo} termos={termos} />
              </h3>
              <Corpo secao={secao} termos={termos} />
            </article>
          ))
        )}
      </div>
    )
  }

  return (
    <div ref={corpo}>
      <nav className="man-sumario" aria-label="Sumário">
        <b>Sumário</b>
        <ol>
          {capitulos.map((c) => (
            <li key={c.id}>
              <span className="num" aria-hidden="true">
                {c.numero}
              </span>
              <button type="button" className="link" onClick={() => irAoCapitulo(c.id)}>
                {c.titulo}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {capitulos.map((c) => (
        <section className="man-cap" id={c.id} key={c.id}>
          <h3>{rotuloDoCapitulo(c)}</h3>
          {c.secoes.map((s) => (
            <article className="man-sec" key={s.titulo}>
              <h4>{s.titulo}</h4>
              <Corpo secao={s} termos={termos} />
            </article>
          ))}
        </section>
      ))}
    </div>
  )
}

/** O texto de uma seção, já interpretado em blocos. */
function Corpo({ secao, termos }: { secao: SecaoDoManual; termos: readonly string[] }) {
  const blocos = interpretar(secao.texto, termos)
  return (
    <>
      {blocos.map((b, i) => (
        <BlocoDoManual bloco={b} key={i} />
      ))}
    </>
  )
}

function BlocoDoManual({ bloco }: { bloco: Bloco }) {
  if (bloco.tipo === 'paragrafo') {
    return (
      <p>
        {bloco.trechos.map((t, i) => (
          <Pedaco trecho={t} key={i} />
        ))}
      </p>
    )
  }
  return (
    <ul>
      {bloco.itens.map((trechos, i) => (
        <li key={i}>
          {trechos.map((t, j) => (
            <Pedaco trecho={t} key={j} />
          ))}
        </li>
      ))}
    </ul>
  )
}

/**
 * Um pedaço de texto — negrito, destaque, os dois ou nenhum.
 *
 * `<mark>` e `<b>` em vez de string de HTML: o texto dela nunca é interpretado
 * como marcação, então não há `esc()` para esquecer num dos três lugares.
 */
function Pedaco({ trecho }: { trecho: { texto: string; negrito: boolean; destaque: boolean } }) {
  const conteudo = trecho.destaque ? <mark>{trecho.texto}</mark> : trecho.texto
  return trecho.negrito ? <b>{conteudo}</b> : <>{conteudo}</>
}

/** Realce dos termos num texto sem marcação (pergunta, resposta, título). */
function Realce({ texto, termos }: { texto: string; termos: readonly string[] }) {
  const blocos = interpretar(texto, termos)
  return (
    <>
      {blocos.map((b, i) =>
        b.tipo === 'paragrafo' ? b.trechos.map((t, j) => <Pedaco trecho={t} key={`${i}-${j}`} />) : null,
      )}
    </>
  )
}
