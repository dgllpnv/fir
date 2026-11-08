'use client'

import type { ListaDeClientesDaCarteiraSaida, MetasDoClienteSaida, PainelDeMetasSaida } from '@fir/contracts'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Carregando, Toast } from '@/components/estados'
import { LancarMetasDaSemana, LinhaDaMeta } from '@/components/carteira/meta-pecas'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../pecas'

/**
 * **PAINEL DE METAS** (M1; `vMetas`, `index.html` L806-825) — D-25: igual ao
 * protótipo, só front.
 *
 * Todas as clientes ativas: cinco indicadores que filtram, o filtro por
 * responsável, um cartão por cliente (da pior meta para a melhor) com
 * "Lançar metas da semana" — a reunião semanal de lançamento —, e o aviso das
 * clientes sem meta. Toda avaliação vem do servidor; aqui só se formata.
 *
 * Como no protótipo (L813-814), a cliente sem meta também ganha cartão, no
 * fim da grade e só sem filtro de situação. O painel devolve dela só id e
 * nome; o produto vem da lista de clientes, que já existe. Área de foco,
 * responsável e saúde dessa cliente não têm rota hoje e ficam de fora.
 */
type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; dados: PainelDeMetasSaida; produtos: ReadonlyMap<string, string> }

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
const SAUDE = { bom: ['pill bom', 'Bom'], atencao: ['pill alerta', 'Atenção'], critico: ['pill mau', 'Crítico'] } as const

type Lancamento = { clienteId: string; nome: string; dados: MetasDoClienteSaida }

export default function PainelDeMetas() {
  const { sessao } = useCarteira()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [responsavel, setResponsavel] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('')
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)
  const [lancando, setLancando] = useState<Lancamento | null>(null)
  const abrindo = useRef(false)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    void (async () => {
      try {
        const q = responsavel ? `?responsavel=${responsavel}` : ''
        const [dados, lista] = await Promise.all([
          chamar<PainelDeMetasSaida>(`v1/carteira/metas/painel${q}`),
          // Só para o subtítulo do cartão da cliente sem meta: falhar aqui não derruba o painel.
          chamar<ListaDeClientesDaCarteiraSaida>('v1/carteira/clientes').catch(() => ({ clientes: [] })),
        ])
        if (valeu) setEstado({ tag: 'pronto', dados, produtos: new Map(lista.clientes.map((c) => [c.id, c.produto])) })
      } catch (e) {
        if (valeu) setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar as metas.' })
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag, responsavel, tentativa])

  async function abrirLancamento(clienteId: string, nome: string, podeLancar: boolean) {
    // L795: sem meta de lançamento semanal, o protótipo avisa em vez de abrir um
    // formulário vazio. Quem sabe se há o que lançar é o servidor (`podeLancar`).
    if (!podeLancar) {
      setRecado('Esta cliente não tem metas para lançar')
      return
    }
    // Dois toques no botão não abrem dois lançamentos.
    if (abrindo.current) return
    abrindo.current = true
    try {
      const dados = await chamar<MetasDoClienteSaida>(`v1/carteira/clientes/${clienteId}/metas`)
      setLancando({ clienteId, nome, dados })
    } catch (e) {
      setRecado(e instanceof ErroDaApi ? e.message : 'Não foi possível abrir o lançamento.')
    } finally {
      abrindo.current = false
    }
  }

  return (
    <section>
      <NavDaCarteira atual="/carteira/metas" />
      <div className="carteira-pagina-larga">
        <div className="carteira-metas">
          <header className="carteira-metas-cabeca">
            <p className="carteira-metas-sobretitulo">Todas as clientes</p>
            <h1 className="carteira-metas-titulo">Painel de metas</h1>
            {estado.tag === 'pronto' ? (
              <p className="carteira-metas-sub">
                <span className="num">{estado.dados.clientes.reduce((n, c) => n + c.metas.length, 0)}</span> metas em andamento em{' '}
                <span className="num">{estado.dados.clientes.length}</span> clientes. A linha fina em cada barra mostra onde a meta deveria
                estar hoje.
              </p>
            ) : null}
          </header>
          {estado.tag === 'carregando' || sessao.tag !== 'pronta' ? <Carregando linhas={5} /> : null}
          {estado.tag === 'erro' ? <ErroDaCarteira mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} /> : null}
          {estado.tag === 'pronto' ? (
            <Conteudo
              dados={estado.dados}
              produtos={estado.produtos}
              filtro={filtro}
              setFiltro={setFiltro}
              responsavel={responsavel}
              setResponsavel={setResponsavel}
              lancar={(id, nome, podeLancar) => void abrirLancamento(id, nome, podeLancar)}
            />
          ) : null}
        </div>
      </div>
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
  produtos,
  filtro,
  setFiltro,
  responsavel,
  setResponsavel,
  lancar,
}: {
  dados: PainelDeMetasSaida
  produtos: ReadonlyMap<string, string>
  filtro: Filtro
  setFiltro: (f: Filtro) => void
  responsavel: string
  setResponsavel: (r: string) => void
  lancar: (clienteId: string, nome: string, podeLancar: boolean) => void
}) {
  const comMeta = dados.clientes
    .map((c) => ({ ...c, metas: filtro === '' ? c.metas : c.metas.filter((m) => DO_FILTRO[filtro].includes(m.avaliacao.detalhe)) }))
    .filter((c) => filtro === '' || c.metas.length > 0)
  // L814: sem meta, o peso é 9 — fim da grade. Com filtro de situação, some (L813).
  const semMeta = filtro === '' ? dados.semMeta : []
  const rotuloDoFiltro = KPIS.find(([k]) => k === filtro)?.[1]

  return (
    <>
      <div className="carteira-metas-kpis">
        {KPIS.map(([k, rotulo, classe]) => (
          <button
            key={k}
            type="button"
            className="carteira-metas-kpi"
            aria-pressed={filtro === k}
            onClick={() => setFiltro(filtro === k ? '' : k)}
          >
            <span>{rotulo}</span>
            <b className={classe ? `num carteira-metas-kpi-${classe}` : 'num'}>{dados.contagens[k]}</b>
          </button>
        ))}
      </div>
      <div className="carteira-metas-filtros">
        <select aria-label="Responsável" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
          <option value="">Todas as responsáveis</option>
          {dados.responsaveis.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
        {filtro ? (
          <button type="button" className="carteira-metas-link" onClick={() => setFiltro('')}>
            Limpar filtro: {rotuloDoFiltro}
          </button>
        ) : null}
      </div>
      {comMeta.length + semMeta.length > 0 ? (
        <div className="carteira-metas-grade">
          {comMeta.map((c) => (
            <article key={c.id} className="carteira-metas-cartao">
              <div className="carteira-metas-cartao-cabeca">
                <Link className="carteira-metas-cartao-nome" href={`/carteira/clientes/${c.id}?aba=plano`}>
                  {c.nome}
                </Link>
                {c.saude ? <span className={SAUDE[c.saude][0]}>{SAUDE[c.saude][1]}</span> : null}
              </div>
              <p className="carteira-metas-cartao-sub">{[c.produto, c.areaFoco, c.responsavelNome].filter(Boolean).join(' · ')}</p>
              {c.metas.length === 0 ? (
                <p className="carteira-metas-vazio">Nenhuma meta com esse filtro.</p>
              ) : (
                c.metas.map((m) => <LinhaDaMeta key={m.id} meta={m} hoje={dados.hoje} painel />)
              )}
              <button type="button" className="carteira-metas-lancar" onClick={() => lancar(c.id, c.nome, c.podeLancar)}>
                Lançar metas da semana
              </button>
            </article>
          ))}
          {semMeta.map((c) => (
            <article key={c.id} className="carteira-metas-cartao">
              <div className="carteira-metas-cartao-cabeca">
                <Link className="carteira-metas-cartao-nome" href={`/carteira/clientes/${c.id}?aba=plano`}>
                  {c.nome}
                </Link>
              </div>
              {produtos.get(c.id) ? <p className="carteira-metas-cartao-sub">{produtos.get(c.id)}</p> : null}
              <p className="carteira-metas-vazio">Nenhuma meta com esse filtro.</p>
              {/* Sem meta nenhuma, não há o que lançar: sempre o aviso, sem ir ao servidor. */}
              <button type="button" className="carteira-metas-lancar" onClick={() => lancar(c.id, c.nome, false)}>
                Lançar metas da semana
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="carteira-metas-vazio">
          {filtro ? 'Nenhuma meta com esse filtro.' : 'Nenhuma cliente ativa ainda. As metas aparecem aqui quando a primeira for lançada na ficha da cliente.'}
        </p>
      )}
      {semMeta.length > 0 ? (
        <p className="carteira-metas-aviso">
          Sem metas definidas:{' '}
          {semMeta.map((c, i) => (
            <span key={c.id}>
              {i > 0 ? ', ' : ''}
              <Link className="carteira-metas-link" href={`/carteira/clientes/${c.id}?aba=plano`}>
                {c.nome}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
    </>
  )
}
