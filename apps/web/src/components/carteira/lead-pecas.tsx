'use client'

import type { LeadComercialNaLista, ListaDeBeneficiosSaida, SinalDoLeadSaida } from '@fir/contracts'
import Link from 'next/link'
import { type ReactNode, useEffect, useState } from 'react'
import { chamar } from '@/lib/api'
import { ROTULO_DO_NIVEL } from './lead-rotulos'

/**
 * A moldura das telas da Prospecção (D-25): a largura toda (até 1180 px,
 * `carteira-pagina-larga`, da frente da Visão geral) e a grade da tela.
 */
export function TelaDaProspeccao({ children }: { children: ReactNode }) {
  return (
    <div className="carteira-pagina-larga">
      <section className="lead-tela">{children}</section>
    </div>
  )
}

export type AbaDaProspeccao = 'oportunidades' | 'indicacoes' | 'mensagens'

const ABAS: readonly (readonly [AbaDaProspeccao, string, string])[] = [
  ['oportunidades', 'Oportunidades', '/carteira/leads'],
  ['indicacoes', 'Quem indica', '/carteira/leads/indicacoes'],
  ['mensagens', 'Mensagens e roteiros', '/carteira/leads/mensagens'],
]

/**
 * O cabeçalho da Prospecção (`vProspeccao`, L2466-2471): sobretítulo, título,
 * a frase do protótipo, "Nova indicação" e as TRÊS abas. As abas são ROTAS,
 * para o voltar do celular funcionar.
 *
 * O aviso vermelho de "Quem indica" aparece nas três abas, como no protótipo.
 * Quem já tem a lista de benefícios passa a contagem; nas outras abas o
 * cabeçalho pede a lista ao servidor (a mesma rota) — e, se falhar, só fica
 * sem o aviso.
 */
export function CabecalhoDaProspeccao({
  aba,
  beneficiosPendentes,
  acao,
}: {
  aba: AbaDaProspeccao
  beneficiosPendentes?: number
  acao?: ReactNode
}) {
  const [buscado, setBuscado] = useState<number | null>(null)
  const precisa = beneficiosPendentes === undefined && aba !== 'indicacoes'

  useEffect(() => {
    if (!precisa) return
    let valeu = true
    chamar<ListaDeBeneficiosSaida>('v1/carteira/beneficios')
      .then((r) => {
        if (valeu) setBuscado(r.beneficios.filter((b) => b.situacao !== 'concedido').length)
      })
      .catch(() => {})
    return () => {
      valeu = false
    }
  }, [precisa])

  const pendentes = beneficiosPendentes ?? buscado ?? 0

  return (
    <header className="lead-cabeca">
      <div className="lead-cabeca-linha">
        <div>
          <p className="lead-sobretitulo">Novos clientes</p>
          <h1 className="titulo">Prospecção</h1>
          <p className="nota">Indicações, roteiros de abordagem e quem mais indica a Firmare.</p>
        </div>
        {acao}
      </div>
      <nav className="prosp-abas" aria-label="Seções da prospecção">
        {ABAS.map(([chave, rotulo, href]) => (
          <Link
            key={chave}
            href={href}
            className={aba === chave ? 'prosp-aba prosp-aba-atual' : 'prosp-aba'}
            aria-current={aba === chave ? 'page' : undefined}
          >
            {rotulo}
            {chave === 'indicacoes' && pendentes > 0 ? (
              <span className="prosp-aba-aviso num">
                {pendentes} {pendentes === 1 ? 'benefício pendente' : 'benefícios pendentes'}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
    </header>
  )
}

const ICONE_DO_WHATSAPP = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2 5.2 5.2 0 001.1 2.7 11.8 11.8 0 004.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 001.8-1.3 2.2 2.2 0 00.2-1.3c-.1-.1-.3-.2-.5-.3z" />
  </svg>
)

export const IconeDoWhatsApp = () => ICONE_DO_WHATSAPP

/**
 * O botão de WhatsApp (`waBtn`, L2448-2453), verde como no protótipo. O link
 * vem PRONTO do servidor — e vem `null` com a oposição registrada (A37) ou
 * sem número. Sem número, "WhatsApp sem número"; com oposição, "Não contatar".
 *
 * `aoAbrir`, quando presente, troca o link pelo modal da mensagem pronta
 * (ficha do lead): o texto é montado no servidor. Mesmo assim o botão só
 * existe quando o servidor mandou o link — é ele quem diz se pode contatar.
 */
export function BotaoWhatsApp({
  lead,
  grande = false,
  aoAbrir,
}: {
  lead: LeadComercialNaLista
  grande?: boolean
  aoAbrir?: () => void
}) {
  const classe = grande ? 'btn prosp-wa' : 'btn prosp-wa prosp-wa-mini'
  if (lead.linkDoWhatsApp !== null) {
    if (aoAbrir) {
      return (
        <button type="button" className={classe} onClick={aoAbrir}>
          {ICONE_DO_WHATSAPP}
          WhatsApp
        </button>
      )
    }
    return (
      <a className={classe} href={lead.linkDoWhatsApp} target="_blank" rel="noopener noreferrer">
        {ICONE_DO_WHATSAPP}
        WhatsApp
      </a>
    )
  }
  return (
    <span className="prosp-sem-wa" title="Cadastre o WhatsApp para liberar">
      {lead.naoContatar ? 'Não contatar' : 'WhatsApp sem número'}
    </span>
  )
}

/** Uma linha de "Contatos recomendados" (`sinalRow`, L2457-2460). */
export function LinhaDeSinal({ lead, sinal }: { lead: LeadComercialNaLista; sinal: SinalDoLeadSaida }) {
  return (
    <li className={`lead-sinal lead-sinal-${sinal.nivel}`}>
      <Link href={`/carteira/leads/${lead.id}`} className="lead-sinal-corpo">
        <span className="lead-sinal-topo">
          <b>{lead.nome}</b>
          {lead.especialidade ? <span className="muted">{lead.especialidade}</span> : null}
          <span className="lead-sinal-nivel">{ROTULO_DO_NIVEL[sinal.nivel]}</span>
        </span>
        <span className="muted lead-sinal-motivo">{sinal.motivo}</span>
      </Link>
      <BotaoWhatsApp lead={lead} />
    </li>
  )
}

/** Histórico e Dados lado a lado (`.grid2`, L89): colunas presas ao topo, como no protótipo. */
export function DuasColunasDoLead({ children }: { children: ReactNode }) {
  return <div className="prosp-duas">{children}</div>
}
