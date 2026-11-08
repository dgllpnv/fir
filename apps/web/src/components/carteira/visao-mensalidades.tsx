'use client'

import type {
  DesfazerCobrancaPagaSaida,
  MarcarCobrancaPagaSaida,
  MensalidadeNoPainel,
  PainelDeMensalidadesSaida,
  SituacaoDaMensalidade,
} from '@fir/contracts'
import { useEffect, useState } from 'react'
import { dinheiro, diaEMes, textoDaSituacao } from '@/components/carteira/mensalidade-pecas'
import { MensagemWhatsApp } from '@/components/carteira/mensagem-whatsapp'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * **MENSALIDADES DO MÊS** na Visão geral (`painelMensalidades`, protótipo
 * L719–729): a barra do mês e a tabela Cliente · Vencimento · Valor ·
 * Situação, com Desfazer / Lembrete · Marcar pago.
 *
 * É a MESMA rota da tela Mensalidades (`GET /v1/carteira/cobrancas/painel`,
 * ticket 1F) e as mesmas peças de formatação (`mensalidade-pecas`). Nada é
 * somado aqui: recebido e total chegam prontos do servidor.
 *
 * Só monta para quem tem a tela `mensalidades` — a mesma `temPermCarteira`
 * que tira o item do menu (quem chama decide; este componente não tem `if`
 * sobre dinheiro). O servidor recusa do mesmo jeito.
 *
 * A barra conta LINHAS (uma faixa por mensalidade, pintada pela situação),
 * como `BarraDoMes`: uma proporção de reais exigiria dividir dinheiro na tela.
 */

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const CHIP: Record<SituacaoDaMensalidade, string> = {
  paga: 'visao-chip visao-chip-bom',
  vence_hoje: 'visao-chip visao-chip-atencao',
  vencida: 'visao-chip visao-chip-critico',
  a_vencer: 'visao-chip',
  sem_valor: 'visao-chip',
}

type Estado = { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronto'; dados: PainelDeMensalidadesSaida }

export function MensalidadesDoMes({ aoMudar }: { aoMudar: (recado: string) => void }) {
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [ocupada, setOcupada] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [lembrete, setLembrete] = useState<MensalidadeNoPainel | null>(null)

  useEffect(() => {
    let valeu = true
    chamar<PainelDeMensalidadesSaida>('v1/carteira/cobrancas/painel')
      .then((dados) => {
        if (valeu) setEstado({ tag: 'pronto', dados })
      })
      .catch((e: unknown) => {
        if (valeu) setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar as mensalidades.' })
      })
    return () => {
      valeu = false
    }
  }, [tentativa])

  async function agir(m: MensalidadeNoPainel, desfazer: boolean) {
    setErro('')
    setOcupada(m.id)
    try {
      if (desfazer) {
        await chamar<DesfazerCobrancaPagaSaida>(`v1/carteira/cobrancas/${m.id}/desfazer-pago`, { method: 'POST' })
        aoMudar(`Pagamento de ${m.clienteNome} desfeito`)
      } else {
        await chamar<MarcarCobrancaPagaSaida>(`v1/carteira/cobrancas/${m.id}/marcar-pago`, { method: 'POST' })
        aoMudar(`Mensalidade de ${m.clienteNome} marcada como paga`)
      }
      setTentativa((n) => n + 1)
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível salvar. Tente de novo.')
    } finally {
      setOcupada(null)
    }
  }

  // Carregando: nada (o bloco vem abaixo da dobra). Erro: diz e oferece de novo.
  if (estado.tag === 'carregando') return null
  if (estado.tag === 'erro') {
    return (
      <div className="visao-painel">
        <div className="visao-painel-cabeca">
          <h2>Mensalidades do mês</h2>
        </div>
        <p className="visao-vazio">
          {estado.mensagem}{' '}
          <button type="button" className="link" onClick={() => setTentativa((n) => n + 1)}>
            Tentar de novo
          </button>
        </p>
      </div>
    )
  }

  const d = estado.dados
  // Como no protótipo: sem mensalidade no mês, o bloco não aparece (a tela
  // Mensalidades diz o que preencher).
  if (d.mensalidades.length === 0) return null
  const mes = MESES[Number(d.competencia.slice(5, 7)) - 1] ?? ''

  return (
    <div className="visao-painel">
      <div className="visao-painel-cabeca">
        <h2>Mensalidades de {mes}</h2>
        <span className="visao-mudo num">
          {dinheiro(d.totais.recebido)} recebidos de {dinheiro(d.totais.somaValor)}
        </span>
      </div>
      <div className="visao-mens-barra" role="img" aria-label="Situação das mensalidades do mês, uma faixa por cliente">
        {d.mensalidades.map((m) => (
          <i key={m.id} data-situacao={m.situacao} />
        ))}
      </div>
      <div className="visao-tabela-caixa">
        <table className="visao-tabela visao-tabela-mens">
          <thead>
            <tr>
              <th>Cliente</th>
              <th className="visao-th-num">Vencimento</th>
              <th className="visao-th-num">Valor</th>
              <th>Situação</th>
              <th>
                <span className="sr-apenas">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.mensalidades.map((m) => (
              <tr key={m.id}>
                <td className="visao-td-nome">{m.clienteNome}</td>
                <td className="visao-td-num visao-td-venc">
                  <span className="visao-rotulo-celular">vence </span>
                  {diaEMes(m.vencimento)}
                </td>
                <td className="visao-td-num visao-td-valor">{dinheiro(m.valor)}</td>
                <td className="visao-td-situacao">
                  <span className={CHIP[m.situacao]}>
                    <i aria-hidden="true" />
                    {textoDaSituacao(m)}
                  </span>
                </td>
                <td className="visao-td-acao">
                  {m.situacao === 'paga' ? (
                    <button type="button" className="link visao-link-menor" disabled={ocupada === m.id} onClick={() => void agir(m, true)}>
                      Desfazer
                    </button>
                  ) : m.situacao === 'sem_valor' ? null : (
                    <>
                      <button type="button" className="link visao-link-menor" onClick={() => setLembrete(m)}>
                        Lembrete
                      </button>
                      {' · '}
                      <button type="button" className="link" disabled={ocupada === m.id} onClick={() => void agir(m, false)}>
                        Marcar pago
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>
      {lembrete !== null ? (
        <MensagemWhatsApp
          destino={{ para: 'cliente', clienteId: lembrete.clienteCarteiraId, chave: 'pagamento' }}
          aoFechar={() => setLembrete(null)}
        />
      ) : null}
    </div>
  )
}
