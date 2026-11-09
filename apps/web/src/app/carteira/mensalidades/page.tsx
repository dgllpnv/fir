'use client'

import type {
  BaixarMensalidadesPagasSaida,
  PainelDeMensalidadesSaida,
  SituacaoDaMensalidade,
} from '@fir/contracts'
import { useEffect, useMemo, useState } from 'react'
import { Carregando, Vazio } from '@/components/estados'
import {
  BarraDoMes,
  LinhaDeMensalidade,
  ROTULO_DA_SITUACAO,
  dinheiro,
  mesPorExtenso,
} from '@/components/carteira/mensalidade-pecas'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../contexto'
import { ErroDaCarteira } from '../pecas'

/**
 * **MENSALIDADES** — o painel do mês (`painelMensalidades`, `index.html`
 * L719-729; situação `statusMensalidade` L708-718).
 *
 * Mesma ordem do protótipo: "Mensalidades de [mês]", recebido de total, a
 * barra e a lista cliente · vencimento · valor · situação · ação ("Marcar
 * pago" ou "Desfazer"). O que esta tela acrescenta, pedido no ticket 1F: a
 * escolha do mês, o filtro por situação, a receita recorrente com o ticket
 * médio e o "baixar pagos" (marcar várias de uma vez).
 *
 * Divergências do protótipo, todas de gate: o valor é o COBRADO (com
 * desconto), não a mensalidade atual (gate de números, ajuste 7); a moeda sai
 * com centavos (formatador central); o ticket médio divide só por quem tem
 * mensalidade (D-22 item 12). A tabela vira linhas empilhadas: 390 px é o
 * caso principal e nada rola na horizontal.
 *
 * Nenhum total é calculado aqui: o servidor devolve linhas e somas do mesmo
 * array. Sem a permissão `valores`, os valores chegam `null` e saem "—".
 */
type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; dados: PainelDeMensalidadesSaida }

type Filtro = 'todas' | SituacaoDaMensalidade

export default function MensalidadesDaCarteira() {
  const { sessao } = useCarteira()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [mes, setMes] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [escolhidas, setEscolhidas] = useState<ReadonlySet<string>>(new Set())
  const [ocupada, setOcupada] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    void (async () => {
      try {
        const dados = await chamar<PainelDeMensalidadesSaida>(
          `v1/carteira/cobrancas/painel${mes ? `?mes=${mes}` : ''}`,
        )
        if (valeu) setEstado({ tag: 'pronto', dados })
      } catch (e) {
        if (valeu) {
          setEstado({
            tag: 'erro',
            mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar as mensalidades.',
          })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag, mes, tentativa])

  const visiveis = useMemo(() => {
    if (estado.tag !== 'pronto') return []
    const todas = estado.dados.mensalidades
    return filtro === 'todas' ? todas : todas.filter((m) => m.situacao === filtro)
  }, [estado, filtro])

  async function agir(fazer: () => Promise<string>) {
    setOcupada(true)
    setAviso(null)
    try {
      setAviso(await fazer())
      setEscolhidas(new Set())
      setTentativa((n) => n + 1)
    } catch (e) {
      setAviso(e instanceof ErroDaApi ? e.message : 'Não foi possível salvar. Tente de novo.')
    } finally {
      setOcupada(false)
    }
  }

  const baixar = (ids: readonly string[]) =>
    agir(async () => {
      const r = await chamar<BaixarMensalidadesPagasSaida>('v1/carteira/cobrancas/baixar-pagos', {
        method: 'POST',
        body: JSON.stringify({ cobrancaIds: ids }),
      })
      if (r.marcadasAgora === 0) return 'Nada mudou: já estavam pagas.'
      return r.marcadasAgora === 1 ? '1 mensalidade marcada como paga.' : `${r.marcadasAgora} mensalidades marcadas como pagas.`
    })

  const desfazer = (id: string, nome: string) =>
    agir(async () => {
      await chamar(`v1/carteira/cobrancas/${id}/desfazer-pago`, { method: 'POST' })
      return `Pagamento de ${nome} desfeito.`
    })

  const cabeca = (
    <>
      <p className="mens-sobretitulo">Todas as clientes</p>
      <h1 className="titulo">Mensalidades</h1>
    </>
  )

  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') {
    return (
      <section className="mens">
        {cabeca}
        <Carregando linhas={6} />
      </section>
    )
  }
  if (estado.tag === 'erro') {
    return (
      <section className="mens">
        {cabeca}
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
      </section>
    )
  }

  const d = estado.dados
  const abertasVisiveis = visiveis.filter((m) => m.situacao !== 'paga')
  const semValores = d.totais.somaValor === null

  return (
    <section className="mens">
      {cabeca}

      <div className="mens-filtros">
        <label className="campo mens-mes">
          Mês
          <select
            value={d.competencia.slice(0, 7)}
            onChange={(e) => {
              setMes(e.target.value)
              setEscolhidas(new Set())
              setFiltro('todas')
            }}
          >
            {d.mesesComCobranca.map((m) => (
              <option key={m} value={m}>
                {mesPorExtenso(m)}
              </option>
            ))}
          </select>
        </label>
        <div className="mens-chips" role="group" aria-label="Filtrar por situação">
          <button type="button" aria-pressed={filtro === 'todas'} onClick={() => setFiltro('todas')}>
            Todas <span className="mens-n">{d.mensalidades.length}</span>
          </button>
          {d.porSituacao
            .filter((s) => s.quantidade > 0 || filtro === s.situacao)
            .map((s) => (
              <button
                key={s.situacao}
                type="button"
                aria-pressed={filtro === s.situacao}
                onClick={() => setFiltro(s.situacao)}
              >
                {ROTULO_DA_SITUACAO[s.situacao]} <span className="mens-n">{s.quantidade}</span>
              </button>
            ))}
        </div>
      </div>

      <div className="mens-painel">
        <div className="mens-painel-cabeca">
          <h2>Mensalidades de {mesPorExtenso(d.competencia)}</h2>
          <span className="mens-legenda">
            {semValores
              ? `${d.porSituacao.find((s) => s.situacao === 'paga')?.quantidade ?? 0} de ${d.mensalidades.length} pagas`
              : `${dinheiro(d.totais.recebido)} recebidos de ${dinheiro(d.totais.somaValor)}`}
          </span>
        </div>
        <BarraDoMes mensalidades={d.mensalidades} />

        <div className="mens-kpis">
          <div className="mens-kpi">
            <span>Pagas da competência</span>
            <b>{dinheiro(d.totais.recebido)}</b>
          </div>
          <div className="mens-kpi">
            <span>Em aberto</span>
            <b>{dinheiro(d.totais.aReceber)}</b>
          </div>
          <div className="mens-kpi">
            <span>Receita recorrente (contratos atuais)</span>
            <b>{dinheiro(d.recorrente.receita)}</b>
          </div>
          <div className="mens-kpi">
            <span>Ticket médio</span>
            <b>{dinheiro(d.recorrente.ticketMedio)}</b>
            <small className="mens-legenda">
              {d.recorrente.clientesComMensalidade === 1
                ? '1 cliente com mensalidade'
                : `${d.recorrente.clientesComMensalidade} clientes com mensalidade`}
            </small>
          </div>
        </div>
        {semValores ? (
          <p className="mens-legenda">Os valores aparecem para quem tem a permissão de ver valores.</p>
        ) : null}

        <p className="mens-aviso" role="status" aria-live="polite">
          {aviso}
        </p>

        {d.mensalidades.length === 0 ? (
          <Vazio>
            <b>Nenhuma mensalidade neste mês.</b> A cobrança é gerada todo dia para cada cliente ativo ou em
            onboarding que tenha mensalidade e dia de vencimento no cadastro — preencha esses dois campos na
            ficha do cliente.
          </Vazio>
        ) : visiveis.length === 0 ? (
          <p className="mens-legenda">Nenhuma mensalidade nesta situação.</p>
        ) : (
          <>
            <div className="mens-lote">
              <button
                type="button"
                className="link"
                disabled={ocupada || abertasVisiveis.length === 0}
                onClick={() => setEscolhidas(new Set(abertasVisiveis.map((m) => m.id)))}
              >
                Escolher todas em aberto
              </button>
              <button
                type="button"
                className="btn"
                disabled={ocupada || escolhidas.size === 0}
                onClick={() => void baixar([...escolhidas])}
              >
                {escolhidas.size === 0 ? 'Baixar pagos' : `Baixar pagos (${escolhidas.size})`}
              </button>
            </div>
            <ul className="mens-lista">
              {visiveis.map((m) => (
                <LinhaDeMensalidade
                  key={m.id}
                  m={m}
                  escolhida={escolhidas.has(m.id)}
                  ocupada={ocupada}
                  aoEscolher={(sim) =>
                    setEscolhidas((atual) => {
                      const nova = new Set(atual)
                      if (sim) nova.add(m.id)
                      else nova.delete(m.id)
                      return nova
                    })
                  }
                  aoMarcarPago={() => void baixar([m.id])}
                  aoDesfazer={() => void desfazer(m.id, m.clienteNome)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
