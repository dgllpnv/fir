'use client'

import { SIM_NAO, type BlocoDoRoteiro, type Pergunta } from '@/conteudo/roteiro-briefing'
import {
  blocoSemControles,
  respVazia,
  type EstadoDoEnsaio,
  type QuemResponde,
  type Resposta,
  type Situacao,
} from './roteiro-ensaio'

/**
 * UMA PERGUNTA DO ENSAIO: o campo do tipo dela (`campoQ`, L2213–2223) e os
 * controles "Perguntar depois" / "Não se aplica" (`ctlQ`, L2224–2230).
 *
 * Campo controlado, valor só no estado da página. Nenhum `name` de
 * formulário que o navegador possa guardar no autopreenchimento:
 * `autoComplete="off"` em tudo que é texto, porque o autopreenchimento é
 * armazenamento local também (gate LGPD A1).
 */

export type AoMudarEnsaio = {
  readonly responder: (id: string, valor: Resposta) => void
  readonly marcar: (id: string, situacao: Situacao) => void
  readonly quemResponde: (id: string, quem: QuemResponde) => void
}

const PLACEHOLDER: Partial<Record<Pergunta['tipo'], string>> = { moeda: 'R$', pct: '%', num: 'número' }

export function PerguntaDoEnsaio({
  bloco,
  pergunta: p,
  ensaio,
  acoes,
  prefixo,
}: {
  bloco: BlocoDoRoteiro
  pergunta: Pergunta
  ensaio: EstadoDoEnsaio
  acoes: AoMudarEnsaio
  /** Prefixo de `id` único da tela (`useId`), para `htmlFor` não colidir. */
  prefixo: string
}) {
  const situacao = ensaio.st[p.id]
  const v = ensaio.resp[p.id]
  const depois = situacao === 'depois' && respVazia(v)
  const id = `${prefixo}-${p.id}`
  const emGrupo = p.tipo === 'sn' || p.tipo === 'multi' || p.tipo === 'nivel' || p.tipo === 'porFuncao'

  const rotulo = (
    <>
      {p.t}
      {p.campo ? (
        <span className="brief-selo" title="Num briefing real, vai para o cadastro ao concluir">
          cadastro
        </span>
      ) : null}
    </>
  )

  const classe = ['brief-q', depois ? 'brief-q-depois' : '', situacao === 'na' ? 'brief-q-na' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classe}>
      {emGrupo ? (
        <fieldset className="brief-grupo" disabled={situacao === 'na'}>
          <legend className="brief-q-titulo">{rotulo}</legend>
          {p.dica ? <p className="brief-dica">{p.dica}</p> : null}
          {situacao === 'na' ? null : <Campo pergunta={p} valor={v} id={id} ensaio={ensaio} acoes={acoes} />}
        </fieldset>
      ) : (
        <>
          <label className="brief-q-titulo" htmlFor={id}>
            {rotulo}
          </label>
          {p.dica ? <p className="brief-dica">{p.dica}</p> : null}
          {situacao === 'na' ? null : <Campo pergunta={p} valor={v} id={id} ensaio={ensaio} acoes={acoes} />}
        </>
      )}
      {blocoSemControles(bloco) ? null : <Controles pergunta={p} ensaio={ensaio} acoes={acoes} />}
    </div>
  )
}

function Campo({
  pergunta: p,
  valor: v,
  id,
  ensaio,
  acoes,
}: {
  pergunta: Pergunta
  valor: Resposta | undefined
  id: string
  ensaio: EstadoDoEnsaio
  acoes: AoMudarEnsaio
}) {
  const texto = typeof v === 'string' ? v : ''
  const lista = Array.isArray(v) ? v : []

  switch (p.tipo) {
    case 'texto':
      return (
        <textarea
          id={id}
          className="brief-entrada"
          rows={3}
          autoComplete="off"
          value={texto}
          onChange={(e) => acoes.responder(p.id, e.target.value)}
        />
      )
    case 'escolha':
      return (
        <select
          id={id}
          className="brief-entrada"
          value={texto}
          onChange={(e) => acoes.responder(p.id, e.target.value)}
        >
          <option value="">Selecione</option>
          {p.op.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
    case 'sn':
      return (
        <div className="brief-opcoes">
          {SIM_NAO.map((o) => (
            <label key={o} className="brief-opcao">
              <input
                type="radio"
                name={id}
                value={o}
                checked={texto === o}
                onChange={() => acoes.responder(p.id, o)}
              />
              {o}
            </label>
          ))}
        </div>
      )
    case 'multi':
      return (
        <div className="brief-opcoes">
          {p.op.map((o) => (
            <label key={o} className="brief-opcao">
              <input
                type="checkbox"
                value={o}
                checked={lista.includes(o)}
                onChange={(e) =>
                  acoes.responder(p.id, e.target.checked ? [...lista, o] : lista.filter((x) => x !== o))
                }
              />
              {o}
            </label>
          ))}
        </div>
      )
    case 'porFuncao':
      return (
        <div className="brief-funcoes">
          {p.op.map((f, i) => (
            <label key={f} className="brief-funcao">
              <span>{f}</span>
              <input
                className="brief-entrada num"
                inputMode="numeric"
                autoComplete="off"
                value={lista[i] ?? ''}
                onChange={(e) => {
                  const nova = p.op.map((_, j) => (j === i ? e.target.value : (lista[j] ?? '')))
                  acoes.responder(p.id, nova)
                }}
              />
            </label>
          ))}
        </div>
      )
    case 'nivel': {
      const nota = ensaio.resp[`${p.id}__nota`]
      return (
        <>
          <div className="brief-niveis">
            {p.op.map((o, i) => (
              <label key={o} className="brief-nivel">
                <input
                  type="radio"
                  name={id}
                  value={o}
                  checked={texto === o}
                  onChange={() => acoes.responder(p.id, o)}
                />
                <span className="brief-nivel-n num" aria-hidden="true">
                  {i}
                </span>
                <span>
                  <span className="brief-so-leitor">Nível {i}: </span>
                  {o}
                </span>
              </label>
            ))}
          </div>
          <input
            className="brief-entrada brief-nota"
            aria-label={`O que foi dito (opcional): ${p.t}`}
            placeholder="O que foi dito (opcional)"
            autoComplete="off"
            value={typeof nota === 'string' ? nota : ''}
            onChange={(e) => acoes.responder(`${p.id}__nota`, e.target.value)}
          />
        </>
      )
    }
    case 'data':
      return (
        <input
          id={id}
          type="date"
          className="brief-entrada brief-entrada-data num"
          value={texto}
          onChange={(e) => acoes.responder(p.id, e.target.value)}
        />
      )
    default: {
      const numerico = p.tipo === 'num' || p.tipo === 'moeda' || p.tipo === 'pct'
      return (
        <input
          id={id}
          className={numerico ? 'brief-entrada num' : 'brief-entrada'}
          inputMode={numerico ? 'decimal' : undefined}
          placeholder={PLACEHOLDER[p.tipo] ?? ''}
          autoComplete="off"
          value={texto}
          onChange={(e) => acoes.responder(p.id, e.target.value)}
        />
      )
    }
  }
}

function Controles({
  pergunta: p,
  ensaio,
  acoes,
}: {
  pergunta: Pergunta
  ensaio: EstadoDoEnsaio
  acoes: AoMudarEnsaio
}) {
  const s = ensaio.st[p.id]
  const q = ensaio.quem[p.id] ?? 'cliente'
  return (
    <div className="brief-controles">
      <button
        type="button"
        className="brief-chave"
        aria-pressed={s === 'depois'}
        onClick={() => acoes.marcar(p.id, 'depois')}
      >
        Perguntar depois
      </button>
      {s === 'depois' ? (
        <span className="brief-quem" role="group" aria-label="Quem responde">
          <span className="brief-quem-rotulo">quem responde:</span>
          <button
            type="button"
            className="brief-chave"
            aria-pressed={q === 'cliente'}
            onClick={() => acoes.quemResponde(p.id, 'cliente')}
          >
            Cliente
          </button>
          <button
            type="button"
            className="brief-chave"
            aria-pressed={q === 'firmare'}
            onClick={() => acoes.quemResponde(p.id, 'firmare')}
          >
            Firmare
          </button>
        </span>
      ) : null}
      <button
        type="button"
        className="brief-chave"
        aria-pressed={s === 'na'}
        onClick={() => acoes.marcar(p.id, 'na')}
      >
        Não se aplica
      </button>
    </div>
  )
}
