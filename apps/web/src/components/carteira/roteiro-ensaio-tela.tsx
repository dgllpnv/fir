'use client'

import { useCallback, useId, useState } from 'react'
import { Modal } from '@/components/modal'
import { blocosDoPrograma, PROGRAMAS, VERSAO_DO_ROTEIRO, type Programa } from '@/conteudo/roteiro-briefing'
import { diaEmTexto } from '@/lib/formato'
import { PerguntaDoEnsaio, type AoMudarEnsaio } from './roteiro-campo'
import {
  divisaoArredondada,
  pendentes,
  perguntasDoEnsaio,
  progresso,
  respVazia,
  textoDaResposta,
  tratada,
  type EstadoDoEnsaio,
} from './roteiro-ensaio'
import { BarraDeProgresso } from './roteiro-barra'
import { CopiarDesligado } from './roteiro-copiar'

/**
 * O ENSAIO EM CURSO (`vDiag` com `d.ensaio`, L2231–2256), sem nada que grave:
 * sem transcrição (o protótipo também a esconde no ensaio, L2250), sem IA,
 * sem "Gerar tarefas", sem "Concluir".
 *
 * A faixa de aviso é fixa e diz o que o gate pede, com essas palavras (A4).
 */
export function TelaDoEnsaio({
  ensaio,
  acoes,
  trocarPrograma,
  preencherExemplo,
  abrirMapa,
  encerrar,
}: {
  ensaio: EstadoDoEnsaio
  acoes: AoMudarEnsaio
  trocarPrograma: (p: Programa) => void
  preencherExemplo: () => void
  abrirMapa: () => void
  encerrar: () => void
}) {
  const prefixo = useId().replace(/:/g, '')
  const [resumoAberto, setResumoAberto] = useState(false)
  const fecharResumo = useCallback(() => setResumoAberto(false), [])
  const blocos = blocosDoPrograma(ensaio.programa)
  const [n, t] = progresso(ensaio)
  const pend = pendentes(ensaio)
  const ancora = (id: string) => `${prefixo}-bl-${id}`

  return (
    <div className="brief-ensaio">
      <header className="brief-ensaio-cabeca">
        <div className="eyebrow">Briefing Firmare · versão {VERSAO_DO_ROTEIRO}</div>
        <h1 className="titulo">Ensaio · programa {ensaio.programa}</h1>
        <div className="brief-ensaio-linha">
          <label className="brief-programa-rotulo" htmlFor={`${prefixo}-programa`}>
            Programa
          </label>
          <select
            id={`${prefixo}-programa`}
            className="brief-entrada brief-programa-escolha"
            value={ensaio.programa}
            onChange={(e) => {
              const p = PROGRAMAS.find((x) => x === e.target.value)
              if (p) trocarPrograma(p)
            }}
          >
            {PROGRAMAS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <span className="brief-contagem" aria-live="polite">
            <span className="num">
              {n} de {t}
            </span>{' '}
            perguntas tratadas
            {pend.length ? (
              <>
                {' · '}
                <b className="brief-aviso-pendente num">{pend.length} para perguntar depois</b>
              </>
            ) : null}
          </span>
        </div>
        <div className="brief-acoes">
          {ensaio.programa === 'Gestão' ? (
            <button type="button" className="btn ghost" onClick={abrirMapa}>
              Mapa de Maturidade
            </button>
          ) : null}
          {/* "Ver resumo" antes do exemplo (o protótipo inverte): em 390 px ele cabe ao lado do
              "Mapa de Maturidade", e o cabeçalho perde uma fileira. */}
          <button type="button" className="btn ghost" onClick={() => setResumoAberto(true)}>
            Ver resumo
          </button>
          <button type="button" className="btn ghost" onClick={preencherExemplo}>
            Preencher com respostas de exemplo
          </button>
          <button type="button" className="btn" onClick={encerrar}>
            Encerrar ensaio
          </button>
        </div>
      </header>

      <p className="brief-faixa-ensaio" role="note">
        <b>Ensaio: nada é salvo.</b> Não use com uma cliente real.
      </p>

      <BarraDeProgresso valor={t ? divisaoArredondada(n * 100, t) : 0} rotulo={`${n} de ${t} perguntas tratadas`} />

      <div className="brief-ensaio-grade">
        <nav className="brief-indice-nav" aria-label="Blocos do roteiro">
          <details className="brief-indice-dobra">
            <summary>
              Ir para um bloco <span className="num">· {blocos.length} blocos</span>
            </summary>
            <ol>
              {blocos.map((b, i) => {
                const [a, z] = progresso(ensaio, b)
                return (
                  <li key={b.id}>
                    <a href={`#${ancora(b.id)}`}>
                      <span>
                        {i + 1}. {b.titulo}
                      </span>
                      <b className={a === z ? 'num brief-completo' : 'num'}>
                        {a}/{z}
                      </b>
                    </a>
                  </li>
                )
              })}
              <li>
                <a href={`#${ancora('pendencias')}`}>
                  <span>Pendências</span>
                  <b className={pend.length ? 'num brief-aviso-pendente' : 'num brief-completo'}>{pend.length}</b>
                </a>
              </li>
            </ol>
          </details>
        </nav>

        <div className="brief-blocos">
          {blocos.map((b, i) => (
            <section key={b.id} id={ancora(b.id)} className="brief-bloco" aria-labelledby={`${ancora(b.id)}-t`}>
              <div className="brief-bloco-cabeca">
                <h2 id={`${ancora(b.id)}-t`}>
                  <span className="num">{i + 1}.</span> {b.titulo}
                </h2>
              </div>
              <p className="brief-objetivo">{b.objetivo}</p>
              <p className="brief-transicao">“{b.transicao}”</p>
              {b.perguntas.map((p) => (
                <PerguntaDoEnsaio
                  key={p.id}
                  bloco={b}
                  pergunta={p}
                  ensaio={ensaio}
                  acoes={acoes}
                  prefixo={prefixo}
                />
              ))}
              {b.id === 'encerramento' ? (
                <p className="brief-faixa-info">
                  Ao concluir o briefing, a ferramenta cria a tarefa de receber o acesso ao sistema, a tarefa da
                  reunião com o time e passa a gerar as reuniões semanais a partir da data informada.
                </p>
              ) : null}
            </section>
          ))}

          <section id={ancora('pendencias')} className="brief-bloco" aria-labelledby={`${ancora('pendencias')}-t`}>
            <h2 id={`${ancora('pendencias')}-t`}>Pendências do briefing</h2>
            {pend.length ? (
              <ul className="brief-pendencias">
                {pend.map((p) => (
                  <li key={p.id}>
                    {p.t} ({ensaio.quem[p.id] === 'firmare' ? 'Firmare' : 'cliente'})
                  </li>
                ))}
              </ul>
            ) : (
              <p className="nota">Nenhuma pergunta marcada para depois.</p>
            )}
            <p className="brief-secao-nota">
              No briefing real, estas pendências viram mensagem para a cliente e tarefas para a equipe.
            </p>
          </section>
        </div>
      </div>

      {resumoAberto ? <ResumoDoEnsaio ensaio={ensaio} aoFechar={fecharResumo} /> : null}
    </div>
  )
}

/**
 * "Ver resumo" (`textoResumoDiag`, L2329–2338) em leitura, não numa caixa de
 * texto pronta para copiar, e com o "Copiar" desligado — mesma razão do A3:
 * o resumo do ensaio é o relatório de uma conversa, e não sai daqui.
 */
function ResumoDoEnsaio({ ensaio, aoFechar }: { ensaio: EstadoDoEnsaio; aoFechar: () => void }) {
  const blocos = blocosDoPrograma(ensaio.programa)
  const pend = pendentes(ensaio)
  const falta = perguntasDoEnsaio(ensaio).filter((p) => !tratada(ensaio, p) && ensaio.st[p.id] !== 'depois')

  const secoes = blocos
    .map((b, i) => ({
      b,
      i,
      ps: b.perguntas.filter((p) => !respVazia(ensaio.resp[p.id]) && p.id !== 'impressoes'),
    }))
    .filter((s) => s.ps.length > 0)

  return (
    <Modal titulo="Resumo do ensaio" aoFechar={aoFechar}>
      <div className="brief-resumo">
        <p className="brief-secao-nota">
          Programa: {ensaio.programa} · Roteiro Firmare versão {VERSAO_DO_ROTEIRO}
        </p>
        {secoes.length === 0 ? <p className="nota">Nenhuma pergunta respondida ainda.</p> : null}
        {secoes.map(({ b, i, ps }) => (
          <div key={b.id}>
            <h3>
              <span className="num">{i + 1}.</span> {b.titulo}
            </h3>
            <ul>
              {ps.map((p) => {
                const v = ensaio.resp[p.id]
                const texto = p.tipo === 'data' && typeof v === 'string' ? diaEmTexto(v) : textoDaResposta(p, v)
                return (
                  <li key={p.id}>
                    {p.t}: <b>{texto}</b>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        {pend.length ? (
          <div>
            <h3>Perguntar depois</h3>
            <ul>
              {pend.map((p) => (
                <li key={p.id}>
                  {p.t} ({ensaio.quem[p.id] === 'firmare' ? 'Firmare' : 'cliente'})
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {falta.length ? (
          <p className="brief-secao-nota">
            Não tratadas (<span className="num">{falta.length}</span>): {falta.map((p) => p.t).join('; ')}
          </p>
        ) : null}
        <CopiarDesligado rotulo="Copiar" />
        <div className="brief-acoes">
          <button type="button" className="btn" onClick={aoFechar}>
            Fechar
          </button>
        </div>
      </div>
    </Modal>
  )
}
