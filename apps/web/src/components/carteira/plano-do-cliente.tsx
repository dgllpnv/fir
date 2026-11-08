'use client'

import type {
  AcaoDoPlano,
  AcaoDoPlanoSalvaSaida,
  AcoesDoPlanoSaida,
  MetaAvaliada,
  MetasDoClienteSaida,
  StatusDeAcaoDoPlano,
} from '@fir/contracts'
import { useEffect, useState, type FormEvent } from 'react'
import { Carregando, Toast } from '@/components/estados'
import { Modal } from '@/components/modal'
import {
  FormularioDeMeta,
  LancarMetasDaSemana,
  LinhaDaMeta,
  STATUS_DA_META,
  diaCurto,
  textoDoAlvo,
} from '@/components/carteira/meta-pecas'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * **A ABA "METAS E PLANO DE AÇÃO" DA FICHA** (V8; `cPlano`, `index.html`
 * L1432-1443; `tabelaAcoes` L1335-1345; `fAcao` L2767-2768), pronta para a
 * ficha em abas usar: `<PlanoDoCliente clienteId=… nome=… />`.
 *
 * Duas seções, na ordem do protótipo: as metas (com "Lançar resultado da
 * semana" e "Nova meta") e o plano de ação com as ações comerciais (filtro
 * Todas · Plano · Comerciais, check para concluir, chip "Atrasada"). A tabela
 * de seis colunas vira linhas empilhadas (390 px, `design.md` §1).
 *
 * "Atrasada", ritmo e percentual vêm do servidor. A tela só formata.
 */
type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; metas: MetasDoClienteSaida; acoes: AcoesDoPlanoSaida }

const STATUS_DA_ACAO: readonly [StatusDeAcaoDoPlano, string][] = [
  ['pendente', 'Pendente'],
  ['em_andamento', 'Em andamento'],
  ['concluida', 'Concluída'],
  ['cancelada', 'Cancelada'],
]
const rotuloDaAcao = (s: StatusDeAcaoDoPlano) => STATUS_DA_ACAO.find(([k]) => k === s)?.[1] ?? s
const rotuloDaMeta = (s: MetaAvaliada['status']) => STATUS_DA_META.find(([k]) => k === s)?.[1] ?? s

type Filtro = 'todas' | 'plano' | 'comercial'

export default function PlanoDoCliente({ clienteId, nome }: { clienteId: string; nome: string }) {
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [lancando, setLancando] = useState(false)
  const [editandoMeta, setEditandoMeta] = useState<MetaAvaliada | 'nova' | null>(null)
  const [editandoAcao, setEditandoAcao] = useState<AcaoDoPlano | 'nova' | null>(null)

  useEffect(() => {
    let valeu = true
    void (async () => {
      try {
        const [metas, acoes] = await Promise.all([
          chamar<MetasDoClienteSaida>(`v1/carteira/clientes/${clienteId}/metas`),
          chamar<AcoesDoPlanoSaida>(`v1/carteira/clientes/${clienteId}/acoes-do-plano`),
        ])
        if (valeu) setEstado({ tag: 'pronto', metas, acoes })
      } catch (e) {
        if (valeu) setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar o plano.' })
      }
    })()
    return () => {
      valeu = false
    }
  }, [clienteId, tentativa])

  if (estado.tag === 'carregando') return <Carregando linhas={4} />
  if (estado.tag === 'erro') {
    return (
      <div className="erro-de-tela" role="alert">
        <p>{estado.mensagem}</p>
        <button type="button" className="btn ghost" onClick={() => setTentativa((n) => n + 1)}>
          Recarregar
        </button>
      </div>
    )
  }

  const { metas, acoes } = estado
  const salvo = (texto: string) => {
    setLancando(false)
    setEditandoMeta(null)
    setEditandoAcao(null)
    setRecado(texto)
    setTentativa((n) => n + 1)
  }
  const podeLancar = metas.metas.some((m) => m.status !== 'cancelada' && m.fonte === 'lancamento')
  const lista = acoes.acoes.filter((a) => filtro === 'todas' || a.tipo === filtro)

  async function alternar(a: AcaoDoPlano) {
    try {
      const r = await chamar<AcaoDoPlanoSalvaSaida>(`v1/carteira/clientes/${clienteId}/acoes-do-plano/${a.id}/alternar`, { method: 'POST' })
      salvo(r.acao.status === 'concluida' ? 'Ação concluída' : 'Ação reaberta')
    } catch (e) {
      setRecado(e instanceof ErroDaApi ? e.message : 'Não foi possível mudar a ação.')
    }
  }

  return (
    <div className="meta-plano">
      <section className="meta-painel">
        <div className="meta-painel-cabeca">
          <h2>Metas</h2>
          <div className="meta-acoes">
            {podeLancar ? (
              <button type="button" className="btn" onClick={() => setLancando(true)}>
                Lançar resultado da semana
              </button>
            ) : null}
            <button type="button" className="btn ghost" onClick={() => setEditandoMeta('nova')}>
              Nova meta
            </button>
          </div>
        </div>
        {metas.metas.length === 0 ? (
          <p className="meta-vazio">Nenhuma meta.</p>
        ) : (
          <div className="meta-lista">
            {metas.metas.map((m) => (
              <div key={m.id} className="meta-item">
                <LinhaDaMeta meta={m} hoje={metas.hoje} aoAbrir={setEditandoMeta} />
                <div className="meta-item-fatos">
                  <span>{m.indicadorNome}</span>
                  <span className="num">Alvo {textoDoAlvo(m)}</span>
                  <span className="num">Prazo {diaCurto(m.prazo)}</span>
                  <span className={m.status === 'atingida' ? 'pill bom' : m.status === 'nao_atingida' ? 'pill mau' : 'pill'}>
                    {rotuloDaMeta(m.status)}
                  </span>
                  <span className="num">
                    {m.acoes.concluidas}/{m.acoes.total} ações
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="meta-painel">
        <div className="meta-painel-cabeca">
          <h2>Plano de ação e ações comerciais</h2>
          <div className="meta-acoes">
            <div className="meta-segmentos" role="group" aria-label="Tipo de ação">
              {(
                [
                  ['todas', 'Todas'],
                  ['plano', 'Plano'],
                  ['comercial', 'Comerciais'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={filtro === k} onClick={() => setFiltro(k)}>
                  {l}
                </button>
              ))}
            </div>
            <button type="button" className="btn ghost" onClick={() => setEditandoAcao('nova')}>
              Nova ação
            </button>
          </div>
        </div>
        {lista.length === 0 ? (
          <p className="meta-vazio">Nenhuma ação aqui.</p>
        ) : (
          <ul className="meta-acoes-lista">
            {lista.map((a) => (
              <li key={a.id} className="meta-acao">
                <button
                  type="button"
                  className={a.status === 'concluida' ? 'meta-check meta-check-feito' : 'meta-check'}
                  aria-label={a.status === 'concluida' ? `Reabrir: ${a.titulo}` : `Concluir: ${a.titulo}`}
                  aria-pressed={a.status === 'concluida'}
                  onClick={() => void alternar(a)}
                />
                <div className="meta-acao-corpo">
                  <button type="button" className="meta-acao-titulo" onClick={() => setEditandoAcao(a)}>
                    {a.titulo}
                  </button>
                  <span className="muted">
                    {a.tipo === 'comercial' ? 'Ação comercial' : 'Plano de ação'}
                    {a.metaTitulo ? ` · ${a.metaTitulo}` : ''}
                    {' · '}
                    {a.quemExecuta === 'firmare' ? `Firmare · ${a.acompanhamentoNome ?? '—'}` : 'Cliente'}
                  </span>
                </div>
                <div className="meta-acao-direita">
                  {a.atrasada ? (
                    <span className="pill mau">Atrasada</span>
                  ) : (
                    <span className={a.status === 'concluida' ? 'pill bom' : 'pill'}>{rotuloDaAcao(a.status)}</span>
                  )}
                  <span className={a.atrasada ? 'num meta-atrasada' : 'num'}>
                    {diaCurto(a.prazo)}
                    {a.atrasada && a.diasDeAtraso !== null ? ` · ${a.diasDeAtraso} dias` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {lancando ? (
        <LancarMetasDaSemana clienteId={clienteId} nome={nome} dados={metas} aoFechar={() => setLancando(false)} aoSalvar={salvo} />
      ) : null}
      {editandoMeta !== null ? (
        <FormularioDeMeta
          clienteId={clienteId}
          meta={editandoMeta === 'nova' ? null : editandoMeta}
          indicadores={metas.indicadores}
          fontes={metas.fontes}
          hoje={metas.hoje}
          aoFechar={() => setEditandoMeta(null)}
          aoSalvar={salvo}
        />
      ) : null}
      {editandoAcao !== null ? (
        <FormularioDeAcao
          clienteId={clienteId}
          acao={editandoAcao === 'nova' ? null : editandoAcao}
          dados={acoes}
          aoFechar={() => setEditandoAcao(null)}
          aoSalvar={salvo}
        />
      ) : null}
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </div>
  )
}

/** "Nova ação" / "Editar ação" (`fAcao`, L2767-2768). Padrão: plano, cliente executa, prazo em 7 dias. */
function FormularioDeAcao({
  clienteId,
  acao,
  dados,
  aoFechar,
  aoSalvar,
}: {
  clienteId: string
  acao: AcaoDoPlano | null
  dados: AcoesDoPlanoSaida
  aoFechar: () => void
  aoSalvar: (recado: string) => void
}) {
  const daquiASete = (() => {
    const [a = 1970, m = 1, d = 1] = dados.hoje.split('-').map(Number)
    const t = new Date(Date.UTC(a, m - 1, d + 7))
    return t.toISOString().slice(0, 10)
  })()
  const [titulo, setTitulo] = useState(acao?.titulo ?? '')
  const [tipo, setTipo] = useState(acao?.tipo ?? 'plano')
  const [metaId, setMetaId] = useState(acao?.metaId ?? '')
  const [quemExecuta, setQuemExecuta] = useState(acao?.quemExecuta ?? 'cliente')
  const [acompanhamento, setAcompanhamento] = useState(acao?.acompanhamentoUsuarioGestaoId ?? '')
  const [prazo, setPrazo] = useState(acao ? (acao.prazo ?? '') : daquiASete)
  const [status, setStatus] = useState<StatusDeAcaoDoPlano>(acao?.status ?? 'pendente')
  const [descricao, setDescricao] = useState(acao?.descricao ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [confirmar, setConfirmar] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    const corpo = {
      titulo,
      tipo,
      metaId: metaId || null,
      quemExecuta,
      acompanhamentoUsuarioGestaoId: acompanhamento || null,
      prazo: prazo || null,
      status,
      descricao: descricao.trim() || null,
    }
    try {
      if (acao === null) {
        await chamar(`v1/carteira/clientes/${clienteId}/acoes-do-plano`, { method: 'POST', body: JSON.stringify(corpo) })
        aoSalvar('Ação criada')
      } else {
        await chamar(`v1/carteira/clientes/${clienteId}/acoes-do-plano/${acao.id}`, { method: 'PATCH', body: JSON.stringify(corpo) })
        aoSalvar('Ação salva')
      }
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível salvar a ação.')
      setEnviando(false)
    }
  }

  async function arquivar() {
    if (acao === null) return
    setEnviando(true)
    try {
      await chamar(`v1/carteira/clientes/${clienteId}/acoes-do-plano/${acao.id}/arquivar`, { method: 'POST' })
      aoSalvar('Ação excluída')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível excluir a ação.')
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={acao === null ? 'Nova ação' : 'Editar ação'} aoFechar={aoFechar}>
      <form className="meta-form" onSubmit={enviar}>
        <label className="campo">
          Ação
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} required maxLength={200} />
        </label>
        <div className="meta-duas">
          <label className="campo">
            Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
              <option value="plano">Plano de ação</option>
              <option value="comercial">Ação comercial</option>
            </select>
          </label>
          <label className="campo">
            Meta vinculada
            <select value={metaId} onChange={(e) => setMetaId(e.target.value)}>
              <option value="">Sem meta</option>
              {dados.metas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.titulo}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="meta-duas">
          <label className="campo">
            Quem executa
            <select value={quemExecuta} onChange={(e) => setQuemExecuta(e.target.value as typeof quemExecuta)}>
              <option value="cliente">Cliente</option>
              <option value="firmare">Firmare</option>
            </select>
          </label>
          <label className="campo">
            Acompanhamento Firmare
            <select value={acompanhamento} onChange={(e) => setAcompanhamento(e.target.value)}>
              <option value="">—</option>
              {dados.responsaveis.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="meta-duas">
          <label className="campo">
            Prazo
            <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </label>
          <label className="campo">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusDeAcaoDoPlano)}>
              {STATUS_DA_ACAO.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="campo">
          Descrição
          <textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={2000} />
        </label>
        {erro ? (
          <p className="erro" role="alert">
            {erro}
          </p>
        ) : null}
        <div className="botoes">
          <button type="submit" className="btn" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" className="btn ghost" onClick={aoFechar}>
            Cancelar
          </button>
          {acao !== null ? (
            confirmar ? (
              <button type="button" className="btn ghost meta-perigo" onClick={() => void arquivar()} disabled={enviando}>
                Confirmar exclusão
              </button>
            ) : (
              <button type="button" className="link perigo" onClick={() => setConfirmar(true)}>
                Excluir ação
              </button>
            )
          ) : null}
        </div>
      </form>
    </Modal>
  )
}
