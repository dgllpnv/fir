'use client'

import type { BeneficioDeIndicacaoNaTela, BeneficioVinculadoSaida } from '@fir/contracts'
import Link from 'next/link'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { AlterarRegraDoBeneficio } from './regra-do-beneficio'
import { diaCurto, percentualCurto } from './lead-rotulos'

/**
 * Benefícios de indicação (`vIndicadores`, L2539-2543, e "Benefícios
 * concedidos", L2547).
 *
 * Três situações, todas derivadas no servidor:
 *  - **guardado** — quem indicou ainda não é cliente (D-22 item 11). A tela
 *    oferece "Ligar ao cliente" quando a pessoa vira cliente, com os clientes
 *    de mesmo nome como SUGESTÃO (regra 27: ninguém é ligado sozinho);
 *  - **pendente** — espera a próxima cobrança, que o aplica sozinha;
 *  - **concedido** — a cobrança aplicou. Não há "Marcar como concedido" (o
 *    protótipo marca à mão, L2859): aqui o desconto aplicado É o registro.
 *
 * O "Agradecer" pelo WhatsApp (roteiro de agradecimento) chega com o 3A.
 */
export function PainelDeBeneficios({
  beneficios,
  regraPercentualCentesimos,
  clientes,
  aoMudar,
}: {
  beneficios: readonly BeneficioDeIndicacaoNaTela[]
  regraPercentualCentesimos: string
  clientes: readonly { id: string; nome: string }[]
  aoMudar: (recado: string) => void
}) {
  const aConceder = beneficios.filter((b) => b.situacao !== 'concedido')
  const concedidos = beneficios.filter((b) => b.situacao === 'concedido')
  return (
    <>
      <section className="lead-painel" aria-labelledby="lead-beneficios">
        <div className="lead-painel-cabeca">
          <h2 id="lead-beneficios">Benefícios a conceder</h2>
          <p className="nota">Gerados quando uma indicação vira contrato.</p>
        </div>
        {aConceder.length === 0 ? (
          <p className="nota">Nenhum benefício pendente.</p>
        ) : (
          <ul className="lead-sinais">
            {aConceder.map((b) => (
              <LinhaDeBeneficio key={b.id} beneficio={b} clientes={clientes} aoMudar={aoMudar} />
            ))}
          </ul>
        )}
        {/* L2542: a regra e "Alterar regra" na mesma linha. Fora do <p>: o link abre um formulário. */}
        <div className="prosp-regra num">
          <span className="muted">Regra atual:</span>
          <b>{percentualCurto(regraPercentualCentesimos)} de desconto na mensalidade seguinte</b>
          <AlterarRegraDoBeneficio aoMudar={aoMudar} />
        </div>
      </section>

      {concedidos.length > 0 ? (
        <section className="lead-painel" aria-labelledby="lead-concedidos">
          <div className="lead-painel-cabeca">
            <h2 id="lead-concedidos">Benefícios concedidos</h2>
          </div>
          <ul className="lead-concedidos">
            {concedidos.map((b) => (
              <li key={b.id}>
                <span>
                  <b>{b.beneficiario}</b> <span className="muted">por indicar {b.nomeDoLead ?? '—'}</span>
                </span>
                <span className="muted num">
                  {percentualCurto(b.percentualCentesimos)} · cobrança de {b.competenciaDaCobranca ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

function LinhaDeBeneficio({
  beneficio: b,
  clientes,
  aoMudar,
}: {
  beneficio: BeneficioDeIndicacaoNaTela
  clientes: readonly { id: string; nome: string }[]
  aoMudar: (recado: string) => void
}) {
  const [escolhido, setEscolhido] = useState(b.sugestoesDeCliente[0]?.id ?? '')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const outros = clientes.filter((c) => !b.sugestoesDeCliente.some((s) => s.id === c.id))

  async function ligar() {
    setErro('')
    setEnviando(true)
    try {
      await chamar<BeneficioVinculadoSaida>(`v1/carteira/beneficios/${b.id}/vincular`, {
        method: 'POST',
        body: JSON.stringify({ clienteCarteiraId: escolhido }),
      })
      aoMudar(`Benefício de ${b.beneficiario} ligado ao cliente.`)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <li className={`lead-sinal ${b.situacao === 'guardado' ? 'lead-sinal-semana' : 'lead-sinal-hoje'}`}>
      <span className="lead-sinal-corpo">
        <span className="lead-sinal-topo">
          <b>{b.beneficiario}</b>
          <span className="muted num">
            indicou{' '}
            {b.leadComercialId !== null ? (
              <Link className="link" href={`/carteira/leads/${b.leadComercialId}`}>
                {b.nomeDoLead ?? '—'}
              </Link>
            ) : (
              (b.nomeDoLead ?? '—')
            )}{' '}
            · contrato em {diaCurto(b.dataDoContrato.slice(0, 10))}
          </span>
          <span className="lead-sinal-nivel">{b.situacao === 'guardado' ? 'Guardado' : 'Pendente'}</span>
        </span>
        <span className="muted lead-sinal-motivo num">
          {percentualCurto(b.percentualCentesimos)} de desconto na mensalidade seguinte ·{' '}
          {b.situacao === 'guardado'
            ? 'quem indicou ainda não é cliente: fica guardado até virar.'
            : 'aplicado automaticamente na próxima cobrança.'}
        </span>
      </span>
      {b.situacao === 'guardado' ? (
        <span className="lead-ligar">
          <label className="campo">
            Virou cliente? Ligar a
            <select value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
              <option value="">Escolha o cliente</option>
              {b.sugestoesDeCliente.length > 0 ? (
                <optgroup label="Mesmo nome">
                  {b.sugestoesDeCliente.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Todos os clientes">
                {outros.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <button type="button" className="btn ghost lead-mini" disabled={enviando || escolhido === ''} onClick={() => void ligar()}>
            {enviando ? 'Ligando…' : 'Ligar'}
          </button>
          <span role="alert" aria-live="polite" className="erro">
            {erro}
          </span>
        </span>
      ) : null}
    </li>
  )
}
