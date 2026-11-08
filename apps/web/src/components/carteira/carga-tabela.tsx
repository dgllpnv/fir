'use client'

import type { CargaDaEquipeSaida, ClienteCarteiraNaLista, RedistribuirTarefasSaida } from '@fir/contracts'
import { Fragment, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { diaMes, type Pessoa } from './rotina-pecas'

type Celula = CargaDaEquipeSaida['pessoas'][number]['atrasadas']

const ABREVIADO: Record<keyof Celula['porTipo'], string> = { checklist: 'onb.', rotina: 'rot.', reuniao: 'reun.', avulsa: 'av.' }
const POR_EXTENSO: Record<keyof Celula['porTipo'], string> = {
  checklist: 'onboarding e checklist',
  rotina: 'rotinas',
  reuniao: 'encaminhamentos de reunião',
  avulsa: 'avulsas',
}

const composicao = (porTipo: Celula['porTipo'], nomes: Record<keyof Celula['porTipo'], string>): string =>
  (Object.keys(porTipo) as (keyof Celula['porTipo'])[])
    // `Object.keys` devolve `string[]`; as chaves são exatamente as quatro do tipo, do contrato.
    .filter((k) => porTipo[k] > 0)
    .map((k) => `${porTipo[k]} ${nomes[k]}`)
    .join(' · ')

/**
 * A carga da equipe (`vCarga`, L1832): pessoa × atrasadas e quatro semanas
 * de segunda a domingo. A tabela tem rolagem interna só nela — a página nunca
 * rola na horizontal (390 px). A barra é proporcional ao maior número da
 * tabela; a razão é feita aqui só para desenhar, o número exibido vem do
 * servidor.
 */
export function TabelaDaCarga({
  carga,
  selecionada,
  aoSelecionar,
}: {
  carga: CargaDaEquipeSaida
  selecionada: string | null
  aoSelecionar: (id: string) => void
}) {
  const maior = Math.max(1, ...carga.pessoas.flatMap((p) => [p.atrasadas.total, ...p.semanas.map((s) => s.total)]))
  const celula = (c: Celula, atrasada: boolean) => (
    <td className="rot-int-num">
      <svg className={atrasada ? 'rot-int-barra rot-int-barra-atrasada' : 'rot-int-barra'} viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
        <rect className="rot-int-barra-fundo" width="100" height="6" rx="3" />
        <rect className="rot-int-barra-cheia" width={(c.total / maior) * 100} height="6" rx="3" />
      </svg>
      <b className="num">{c.total}</b>
      {c.total > 0 ? <span className="rot-int-comp">{composicao(c.porTipo, ABREVIADO)}</span> : null}
    </td>
  )
  return (
    <>
      <p className="nota">Tarefas em aberto por pessoa e por semana, de segunda a domingo. Escolha uma pessoa para ver por cliente e redistribuir.</p>
      <div className="rot-int-carga" tabIndex={0} role="region" aria-label="Carga da equipe por semana">
        <table className="rot-int-tabela">
          <thead>
            <tr>
              <th scope="col">Pessoa</th>
              <th scope="col" className="rot-int-num">Atrasadas</th>
              {carga.semanas.map((s, i) => (
                <th key={s.inicio} scope="col" className="rot-int-num">
                  {i === 0 ? 'Esta semana' : i === 1 ? 'Próxima' : `Semana de ${diaMes(s.inicio)}`}
                  <span className="rot-int-th-sub num">
                    {diaMes(s.inicio)} a {diaMes(s.ultimoDia)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {carga.pessoas.map((p) => (
              <tr key={p.usuarioGestaoId} className={selecionada === p.usuarioGestaoId ? 'rot-int-linha-atual' : undefined}>
                <th scope="row">
                  <button type="button" className="link rot-int-pessoa" aria-pressed={selecionada === p.usuarioGestaoId} onClick={() => aoSelecionar(p.usuarioGestaoId)}>
                    {p.nome}
                  </button>
                </th>
                {celula(p.atrasadas, true)}
                {p.semanas.map((s, i) => (
                  <Fragment key={i}>{celula(s, false)}</Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="nota">onb. = onboarding e checklist · rot. = rotinas · reun. = encaminhamentos de reunião · av. = avulsas. Rotinas aparecem só até 7 dias à frente.</p>
    </>
  )
}

/** O detalhe de uma pessoa por cliente (L1836), com o botão de redistribuir. */
export function DetalheDaCarga({
  detalhe,
  nome,
  aoRedistribuir,
}: {
  detalhe: NonNullable<CargaDaEquipeSaida['detalhe']>
  nome: string
  aoRedistribuir: () => void
}) {
  return (
    <section className="rot-int-secao" aria-label={`${nome} por cliente`}>
      <div className="rot-int-painel-cabeca">
        <h2 className="carteira-secao-titulo">{nome} · por cliente</h2>
        <span className="nota">Atrasadas e próximas 4 semanas</span>
        <button type="button" className="btn ghost" onClick={aoRedistribuir}>
          Redistribuir tarefas
        </button>
      </div>
      {detalhe.clientes.length === 0 ? (
        <p className="nota">Nenhuma tarefa aberta nas próximas 4 semanas.</p>
      ) : (
        <ul className="rot-int-rotinas">
          {detalhe.clientes.map((c) => (
            <li key={c.clienteCarteiraId ?? 'interno'} className="rot-int-rotina">
              <div className="rot-int-rotina-texto">
                <span className="rot-int-rotina-titulo">{c.clienteNome ?? 'Interno'}</span>
                <span className="nota">{composicao(c.porTipo, POR_EXTENSO)}</span>
              </div>
              <dl className="rot-int-numeros">
                <div>
                  <dt>Tarefas</dt>
                  <dd className="num">{c.total}</dd>
                </div>
                <div>
                  <dt>Atrasadas</dt>
                  <dd className={c.atrasadas > 0 ? 'num rot-int-atrasada' : 'num'}>{c.atrasadas}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Redistribuir (`redistribuir`, L1848): de, para, cliente opcional, quais
 * tarefas e prazo a partir de. Rotinas não se movem aqui — mudam de dona em
 * Rotinas, senão voltariam na semana seguinte.
 */
export function FormularioDeRedistribuir({
  de,
  pessoas,
  clientes,
  aoTerminar,
  aoFechar,
}: {
  de: string
  pessoas: readonly Pessoa[]
  clientes: readonly ClienteCarteiraNaLista[]
  aoTerminar: (recado: string, para: string) => void
  aoFechar: () => void
}) {
  const [form, setForm] = useState({
    de,
    para: pessoas.find((p) => p.id !== de)?.id ?? '',
    clienteCarteiraId: '',
    tipo: 'checklist' as 'checklist' | 'avulsa' | 'todas',
    desde: '',
  })
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const nome = (id: string) => pessoas.find((p) => p.id === id)?.nome ?? ''

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    if (form.de === form.para) {
      setErro('Escolha pessoas diferentes.')
      return
    }
    setEnviando(true)
    try {
      const r = await chamar<RedistribuirTarefasSaida>('v1/carteira/tarefas-internas/redistribuir', {
        method: 'POST',
        body: JSON.stringify({
          deUsuarioGestaoId: form.de,
          paraUsuarioGestaoId: form.para,
          clienteCarteiraId: form.clienteCarteiraId || null,
          tipo: form.tipo,
          desde: form.desde || null,
        }),
      })
      aoTerminar(
        r.movidas === 0
          ? 'Nenhuma tarefa com esses filtros'
          : `${r.movidas} ${r.movidas === 1 ? 'tarefa passada' : 'tarefas passadas'} de ${nome(form.de)} para ${nome(form.para)}`,
        form.para,
      )
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="rot-int-formulario" aria-label="Redistribuir tarefas">
      <h2 className="carteira-secao-titulo">Redistribuir tarefas</h2>
      <form className="carteira-form" onSubmit={enviar}>
        <div className="rot-int-duas">
          <label className="campo">
            De
            <select value={form.de} onChange={(e) => setForm({ ...form, de: e.target.value })}>
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            Para
            <select value={form.para} onChange={(e) => setForm({ ...form, para: e.target.value })}>
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="campo">
          Cliente
          <select value={form.clienteCarteiraId} onChange={(e) => setForm({ ...form, clienteCarteiraId: e.target.value })}>
            <option value="">Todas as clientes</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          Quais tarefas
          <select
            value={form.tipo}
            // As três opções estão escritas logo abaixo.
            onChange={(e) => setForm({ ...form, tipo: e.target.value as typeof form.tipo })}
          >
            <option value="checklist">Só onboarding e checklist</option>
            <option value="avulsa">Só avulsas e de reunião</option>
            <option value="todas">Todas, menos rotinas</option>
          </select>
          <span className="nota">As rotinas fixas mudam de dona em Rotinas, para não voltarem na próxima semana.</span>
        </label>
        <label className="campo">
          Com prazo a partir de
          <input type="date" value={form.desde} onChange={(e) => setForm({ ...form, desde: e.target.value })} />
        </label>
        <p role="alert" aria-live="polite" className="erro">
          {erro}
        </p>
        <div className="carteira-acoes">
          <button type="submit" className="btn" disabled={enviando}>
            {enviando ? 'Passando…' : 'Redistribuir'}
          </button>
          <button type="button" className="link" onClick={aoFechar}>
            Cancelar
          </button>
        </div>
      </form>
    </section>
  )
}
