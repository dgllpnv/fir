'use client'

import { type RefObject, useState } from 'react'
import { ControleDeTema } from '@/components/controle-de-tema'
import { chamar } from '@/lib/api'
import { ICONE_SAIR } from '@/lib/icones'
import { useCarteira } from './contexto'
import { NavDaCarteira } from './pecas'

/**
 * A LATERAL DA CARTEIRA — a `aside` do protótipo do Firmare Gestão
 * (index.html L481–489): a marca, o menu em grupos e, no pé, quem entrou.
 *
 * Substitui a faixa de topo: ela dizia onde você está e O QUE você enxerga
 * (todos os grupos, ou um só), e isso continua dito — no pé, embaixo do nome,
 * no lugar em que o protótipo põe o papel de quem entrou (`.who small`).
 *
 * **Obedece à sessão.** Enquanto ela se resolve, só a marca: o menu e o pé
 * aparecem juntos com o conteúdo (`CorpoComSessao`, `casco.tsx`). Sem isto,
 * quem abre `/carteira` sem estar logado via o menu por meio segundo antes do
 * desvio para a entrada.
 */
export function LateralDaCarteira({
  aberta,
  gaveta,
}: {
  aberta: boolean
  gaveta: RefObject<HTMLElement | null>
}) {
  const { sessao } = useCarteira()
  const [saindo, setSaindo] = useState(false)
  const resolvida = sessao.tag === 'pronta' || sessao.tag === 'erro'

  async function sair() {
    setSaindo(true)
    await chamar('v1/carteira/sair', { method: 'POST' }).catch(() => undefined)
    window.location.replace('/carteira/entrar')
  }

  return (
    <aside
      className="carteira-lateral"
      id="carteira-menu-lateral"
      aria-label="Menu da carteira"
      ref={gaveta}
      data-aberta={aberta ? 'sim' : 'nao'}
    >
      <div className="carteira-marca">
        <b>Firmare</b>
        <span>Gestão</span>
      </div>

      {resolvida ? <NavDaCarteira /> : null}

      {resolvida ? (
        <div className="carteira-lateral-pe">
          <ControleDeTema />
          {sessao.tag === 'pronta' ? (
            <>
              <div className="carteira-quem-linha">
                <div className="carteira-quem">
                  <b title={sessao.usuarioDeGestao.usuario}>{sessao.usuarioDeGestao.usuario}</b>
                  <small>
                    Visão: {sessao.usuarioDeGestao.escopo === 'geral' ? 'todos os grupos' : 'um grupo'}
                  </small>
                </div>
                <button type="button" className="btn ghost carteira-sair" onClick={() => void sair()} disabled={saindo}>
                  {ICONE_SAIR}
                  {saindo ? 'Saindo…' : 'Sair'}
                </button>
              </div>
              {/* A conta fica em links discretos, não em botões cheios: são
                  raros, e a altura da lateral é do menu (design.md §1). */}
              <div className="carteira-conta">
                {/* Quem veio do painel (a conta de gestão do Operador, ADR 0024)
                    volta por aqui — sem isto, a única saída da carteira era
                    digitar o endereço. Essa conta não tem senha própria (é a
                    do painel), então "Trocar senha" não se aplica a ela. `<a>`
                    e não `<Link>`: painel e troca de senha são outro casco. */}
                {sessao.contaDoOperador ? (
                  <a className="carteira-conta-link" href="/superadmin">
                    Voltar ao painel
                  </a>
                ) : (
                  // A troca VOLUNTÁRIA. A obrigatória (provisória) não passa
                  // por aqui: o provedor desvia antes de a lateral existir.
                  <a className="carteira-conta-link" href="/carteira/trocar-senha">
                    Trocar senha
                  </a>
                )}
                {/* G8 0.6: estado do segundo fator e códigos de recuperação novos —
                    só quando o servidor o exige (ADR 0023: desligado por padrão). */}
                {sessao.segundoFatorExigido ? (
                  <a className="carteira-conta-link" href="/carteira/segundo-fator">
                    Duas etapas
                  </a>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}
