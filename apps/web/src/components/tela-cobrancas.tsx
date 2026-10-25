'use client'

import type { CobrancaNaLista, ListaDeCobrancas, MensagemDeCobranca } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import Link from 'next/link'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { centavos } from '@/lib/financeiro'
import { diaEmTexto, linkDeWhatsApp, plural } from '@/lib/formato'
import { Carregando, Erro, Toast, Vazio } from './estados'

/**
 * **Cobranças — a fila de ligação.**
 *
 * A lista chega **já ordenada pelo servidor**: quem está há mais tempo sem
 * contato primeiro, empate pelo maior saldo. Ordenar aqui exigiria o saldo
 * aqui, e sem `valores` ele vem `null` — a fila ficaria embaralhada
 * justamente para quem liga.
 *
 * A mensagem do WhatsApp também é montada no servidor, e **não leva valor
 * nenhum**: cobrança com o número escrito vira print, e o print circula.
 */
export function TelaCobrancas() {
  const cobrancas = useDados<ListaDeCobrancas>('v1/cobrancas')
  const [recado, setRecado] = useState<string | null>(null)

  const d = cobrancas.dados

  return (
    <section>
      <div className="eyebrow">Financeiro</div>
      <div className="titulo">
        <h2>Cobranças</h2>
      </div>

      <p className="nota" style={{ marginBottom: 14 }}>
        Pacientes com saldo em aberto. O ideal é lembrar com gentileza, de preferência na próxima
        visita ou por mensagem. Cada contato fica registrado, e quem está há mais tempo sem contato
        aparece primeiro.
      </p>

      {cobrancas.carregando ? (
        <Carregando linhas={4} fino />
      ) : cobrancas.erro !== null ? (
        <Erro mensagem={cobrancas.erro} recarregar={cobrancas.recarregar} />
      ) : d === null ? null : (
        <>
          <div className="indicadores">
            {/*
              Sem `valores`, `aReceber` chega `null` e `formatarDinheiro` o
              desenha como "—". `quantidade` e `semContato` são contagens, não
              dinheiro, e atravessam: é com elas que a recepção trabalha.
            */}
            <div className="indicador">
              <span className="rotulo">Saldo a receber</span>
              <span className="numero">{formatarDinheiro(centavos(d.aReceber))}</span>
              <small style={{ color: 'var(--muted)' }}>
                {plural(d.quantidade, 'paciente', 'pacientes')}
              </small>
            </div>
            <div className="indicador">
              <span className="rotulo">Sem contato há 15 dias ou mais</span>
              <span
                className="numero"
                style={{ color: d.semContato > 0 ? 'var(--bad)' : 'inherit' }}
              >
                {d.semContato}
              </span>
              <small style={{ color: 'var(--muted)' }}>
                {plural(d.semContato, 'paciente', 'pacientes')}
              </small>
            </div>
          </div>

          {d.itens.length === 0 ? (
            <Vazio>
              <p style={{ margin: 0, color: 'var(--ink)' }}>
                Nenhuma paciente com saldo em aberto.
              </p>
              <p className="nota" style={{ margin: 0 }}>
                Quando um atendimento ficar com valor em aberto, a paciente aparece aqui — e a fila
                começa por quem está há mais tempo sem contato.
              </p>
            </Vazio>
          ) : (
            <div className="linhas">
              {d.itens.map((x) => (
                <LinhaDeCobranca
                  key={x.pacienteId}
                  item={x}
                  aoRegistrar={(aviso) => {
                    setRecado(aviso)
                    cobrancas.recarregar()
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function LinhaDeCobranca({
  item,
  aoRegistrar,
}: {
  item: CobrancaNaLista
  aoRegistrar: (aviso: string) => void
}) {
  const [enviando, setEnviando] = useState(false)
  const whats = linkDeWhatsApp(item.telefone)

  /**
   * Abre a conversa com a mensagem pronta e **registra o contato**.
   *
   * A janela é aberta ANTES do `await`: o navegador só permite abrir aba nova
   * dentro do gesto do usuário, e esperar a resposta do servidor primeiro faz
   * o bloqueador de pop-up engolir o link. Por isso a aba nasce em branco e
   * recebe a URL depois.
   */
  async function lembrar(): Promise<void> {
    if (whats === null) return
    const aba = window.open('', '_blank', 'noopener')
    setEnviando(true)
    try {
      const m = await chamar<MensagemDeCobranca>(`v1/cobrancas/${item.pacienteId}/mensagem`)
      if (aba !== null) aba.location.href = `${whats}?text=${encodeURIComponent(m.texto)}`
      await chamar('v1/cobrancas', {
        method: 'POST',
        body: JSON.stringify({ pacienteId: item.pacienteId, canal: 'WhatsApp' }),
      })
      aoRegistrar('Contato de cobrança registrado.')
    } catch {
      aba?.close()
      aoRegistrar('Não consegui registrar o contato. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="linha">
      <div className="info">
        <b>{item.paciente}</b>
        <small>
          {item.saldo === null ? null : (
            <>
              <span className="num">{formatarDinheiro(centavos(item.saldo))}</span> em aberto ·{' '}
            </>
          )}
          {item.ultimoContatoEm === null ? (
            'nenhum contato registrado'
          ) : (
            <>
              último contato <span className="num">{diaEmTexto(item.ultimoContatoEm)}</span>
              {item.ultimoContatoPor === null ? '' : ` por ${item.ultimoContatoPor}`}
              {item.diasSemContato !== null && item.diasSemContato >= 15 ? (
                <span style={{ color: 'var(--bad)' }}> · há {item.diasSemContato} dias</span>
              ) : null}
            </>
          )}
        </small>
      </div>
      <div className="botoes">
        {whats === null ? null : (
          <button type="button" className="btn ghost" disabled={enviando} onClick={lembrar}>
            {enviando ? 'Abrindo…' : 'Lembrar pelo WhatsApp'}
          </button>
        )}
        <Link className="link" href="/recebimentos">
          Recebeu
        </Link>
        <Link className="link" href={`/pacientes/${item.pacienteId}`}>
          Ficha
        </Link>
      </div>
    </div>
  )
}
