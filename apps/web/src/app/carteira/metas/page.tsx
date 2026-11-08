'use client'

import type { MetasDoClienteSaida, PainelDeMetasSaida } from '@fir/contracts'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Carregando, Toast } from '@/components/estados'
import { LancarMetasDaSemana, LinhaDaMeta } from '@/components/carteira/meta-pecas'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../pecas'

/**
 * **PAINEL DE METAS** (M1; `vMetas`, `index.html` L806-825).
 *
 * Todas as clientes ativas: cinco indicadores que filtram, o filtro por
 * responsável, um cartão por cliente (da pior meta para a melhor) com
 * "Lançar metas da semana" — a reunião semanal de lançamento —, e o aviso das
 * clientes sem meta. Toda avaliação vem do servidor; aqui só se formata.
 */
type Estado = { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronto'; dados: PainelDeMetasSaida }

type Filtro = '' | 'abaixo' | 'atencao' | 'noRitmo' | 'atingida' | 'semLancamento'
const KPIS: readonly [Exclude<Filtro, ''>, string, string][] = [
  ['abaixo', 'Abaixo do ritmo', 'mau'],
  ['atencao', 'Atenção', 'alerta'],
  ['noRitmo', 'No ritmo', 'bom'],
  ['atingida', 'Atingida', 'bom'],
  ['semLancamento', 'Sem lançamento', ''],
]
const DO_FILTRO: Readonly<Record<Exclude<Filtro, ''>, readonly string[]>> = {
  abaixo: ['abaixo_do_ritmo', 'prazo_vencido'],
  atencao: ['atencao'],
  noRitmo: ['no_ritmo'],
  atingida: ['atingida', 'na_meta'],
  semLancamento: ['sem_lancamento'],
}

type Lancamento = { clienteId: string; nome: string; dados: MetasDoClienteSaida }

export default function PainelDeMetas() {
  const { sessao } = useCarteira()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [responsavel, setResponsavel] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('')
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)
  const [lancando, setLancando] = useState<Lancamento | null>(null)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    void (async () => {
      try {
        const q = responsavel ? `?responsavel=${responsavel}` : ''
        const dados = await chamar<PainelDeMetasSaida>(`v1/carteira/metas/painel${q}`)
        if (valeu) setEstado({ tag: 'pronto', dados })
      } catch (e) {
        if (valeu) setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar as metas.' })
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag, responsavel, tentativa])

  async function abrirLancamento(clienteId: string, nome: string) {
    try {
      const dados = await chamar<MetasDoClienteSaida>(`v1/carteira/clientes/${clienteId}/metas`)
      setLancando({ clienteId, nome, dados })
    } catch (e) {
      setRecado(e instanceof ErroDaApi ? e.message : 'Não foi possível abrir o lançamento.')
    }
  }

  return (
    <section>
      <NavDaCarteira atual="/carteira/metas" />
      <p className="meta-sobretitulo">Todas as clientes</p>
      <h1 className="titulo">Painel de metas</h1>
      {estado.tag === 'carregando' || sessao.tag !== 'pronta' ? <Carregando linhas={5} /> : null}
      {estado.tag === 'erro' ? <ErroDaCarteira mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} /> : null}
      {estado.tag === 'pronto' ? (
        <Conteudo
          dados={estado.dados}
          filtro={filtro}
          setFiltro={setFiltro}
          responsavel={responsavel}
          setResponsavel={setResponsavel}
          lancar={(id, nome) => void abrirLancamento(id, nome)}
        />
      ) : null}
      {lancando ? (
        <LancarMetasDaSemana
          clienteId={lancando.clienteId}
          nome={lancando.nome}
          dados={lancando.dados}
          aoFechar={() => setLancando(null)}
          aoSalvar={(t) => {
            setLancando(null)
            setRecado(t)
            setTentativa((n) => n + 1)
          }}
        />
      ) : null}
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function Conteudo({
  dados,
  filtro,
  setFiltro,
  responsavel,
  setResponsavel,
  lancar,
}: {
  dados: PainelDeMetasSaida
  filtro: Filtro
  setFiltro: (f: Filtro) => void
  responsavel: string
  setResponsavel: (r: string) => void
  lancar: (clienteId: string, nome: string) => void
}) {
  const total = dados.clientes.reduce((n, c) => n + c.metas.length, 0)
  const grupos = dados.clientes
    .map((c) => ({ ...c, metas: filtro === '' ? c.metas : c.metas.filter((m) => DO_FILTRO[filtro].includes(m.avaliacao.detalhe)) }))
    .filter((c) => filtro === '' || c.metas.length > 0)
  const rotuloDoFiltro = KPIS.find(([k]) => k === filtro)?.[1]

  return (
    <>
      <p className="nota">
        <span className="num">{total}</span> metas em andamento em <span className="num">{dados.clientes.length}</span> clientes. A linha
        fina em cada barra mostra onde a meta deveria estar hoje.
      </p>
      <div className="meta-kpis">
        {KPIS.map(([k, rotulo, classe]) => (
          <button key={k} type="button" className="meta-kpi" aria-pressed={filtro === k} onClick={() => setFiltro(filtro === k ? '' : k)}>
            <span>{rotulo}</span>
            <b className={classe ? `num meta-kpi-${classe}` : 'num'}>{dados.contagens[k]}</b>
          </button>
        ))}
      </div>
      <div className="meta-filtros">
        <label className="campo">
          Responsável
          <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
            <option value="">Todas as responsáveis</option>
            {dados.responsaveis.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        {filtro ? (
          <button type="button" className="link" onClick={() => setFiltro('')}>
            Limpar filtro: {rotuloDoFiltro}
          </button>
        ) : null}
      </div>
      <div className="meta-grade">
        {grupos.map((c) => (
          <article key={c.id} className="meta-cartao">
            <div className="meta-cartao-cabeca">
              <Link className="meta-cartao-nome" href={`/carteira/clientes/${c.id}`}>
                {c.nome}
              </Link>
              {c.saude ? (
                <span className={c.saude === 'bom' ? 'pill bom' : c.saude === 'atencao' ? 'pill alerta' : 'pill mau'}>
                  {c.saude === 'bom' ? 'Bom' : c.saude === 'atencao' ? 'Atenção' : 'Crítico'}
                </span>
              ) : null}
            </div>
            <p className="muted meta-cartao-sub">
              {[c.produto, c.areaFoco, c.responsavelNome].filter(Boolean).join(' · ')}
            </p>
            {c.metas.length === 0 ? (
              <p className="meta-vazio">Nenhuma meta com esse filtro.</p>
            ) : (
              c.metas.map((m) => <LinhaDaMeta key={m.id} meta={m} hoje={dados.hoje} painel />)
            )}
            {c.podeLancar ? (
              <button type="button" className="btn ghost meta-cartao-lancar" onClick={() => lancar(c.id, c.nome)}>
                Lançar metas da semana
              </button>
            ) : null}
          </article>
        ))}
      </div>
      {dados.semMeta.length > 0 && filtro === '' ? (
        <p className="meta-aviso">
          Sem metas definidas:{' '}
          {dados.semMeta.map((c, i) => (
            <span key={c.id}>
              {i > 0 ? ', ' : ''}
              <Link className="link" href={`/carteira/clientes/${c.id}`}>
                {c.nome}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
    </>
  )
}
