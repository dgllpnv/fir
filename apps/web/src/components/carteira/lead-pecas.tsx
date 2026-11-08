'use client'

import type { LeadComercialNaLista, SinalDoLeadSaida } from '@fir/contracts'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ROTULO_DO_NIVEL } from './lead-rotulos'

/**
 * O cabeçalho da Prospecção (`vProspeccao`, L2466-2471): sobretítulo, título,
 * a frase do protótipo, "Nova indicação" e as abas. As abas são ROTAS, para
 * o voltar do celular funcionar. "Mensagens e roteiros" chega com o ticket 3A.
 */
export function CabecalhoDaProspeccao({
  aba,
  beneficiosPendentes,
  acao,
}: {
  aba: 'oportunidades' | 'indicacoes'
  beneficiosPendentes?: number
  acao?: ReactNode
}) {
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
      <nav className="lead-abas" aria-label="Seções da prospecção">
        <Link
          href="/carteira/leads"
          className={aba === 'oportunidades' ? 'lead-aba lead-aba-atual' : 'lead-aba'}
          aria-current={aba === 'oportunidades' ? 'page' : undefined}
        >
          Oportunidades
        </Link>
        <Link
          href="/carteira/leads/indicacoes"
          className={aba === 'indicacoes' ? 'lead-aba lead-aba-atual' : 'lead-aba'}
          aria-current={aba === 'indicacoes' ? 'page' : undefined}
        >
          Quem indica
          {beneficiosPendentes !== undefined && beneficiosPendentes > 0 ? (
            <span className="lead-aba-aviso num">
              {beneficiosPendentes} {beneficiosPendentes === 1 ? 'benefício pendente' : 'benefícios pendentes'}
            </span>
          ) : null}
        </Link>
      </nav>
    </header>
  )
}

/**
 * O botão de WhatsApp (`waBtn`, L2448-2453). O link vem PRONTO do servidor —
 * e vem `null` com a oposição registrada (A37) ou sem número. Sem número, o
 * protótipo mostra "WhatsApp sem número"; com oposição, "Não contatar".
 */
export function BotaoWhatsApp({ lead, grande = false }: { lead: LeadComercialNaLista; grande?: boolean }) {
  if (lead.linkDoWhatsApp !== null) {
    return (
      <a
        className={grande ? 'btn lead-whatsapp' : 'btn lead-whatsapp lead-whatsapp-mini'}
        href={lead.linkDoWhatsApp}
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2z" />
        </svg>
        WhatsApp
      </a>
    )
  }
  return (
    <span className="lead-sem-whatsapp">{lead.naoContatar ? 'Não contatar' : 'WhatsApp sem número'}</span>
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
