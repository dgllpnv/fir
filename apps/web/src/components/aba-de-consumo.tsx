'use client'

import type { LinhaDeConsumo, RespostaDoConsumo } from '@fir/contracts'
import { useState } from 'react'
import { useDados } from '@/lib/dados'
import { diaEmTexto } from '@/lib/formato'
import { Carregando, Erro } from './estados'

/**
 * A aba "Consumo" da ficha: o que foi aplicado nesta paciente, com o lote.
 *
 * Dado sensível de saúde (regra 18): o servidor grava o acesso a cada abertura
 * e só entrega com `estoque` e `jornada`; a aba só é montada com as duas. Tudo
 * já chega formatado — a quantidade pela conversão do item ("0,5 ampola · 2,5
 * mg"), nunca milésimos —, e não há custo na resposta, logo não há o que
 * esconder aqui. Paginada de 20 em 20, pelo servidor.
 */
export function AbaDeConsumo({ pacienteId }: { readonly pacienteId: string }) {
  const [pagina, setPagina] = useState(1)
  const { dados, erro, recarregar } = useDados<RespostaDoConsumo>(
    `v1/pacientes/${pacienteId}/consumo?pagina=${pagina}`,
  )
  if (erro !== null) return <Erro mensagem={erro} recarregar={recarregar} />
  if (dados === null) return <Carregando linhas={3} />
  if (dados.itens.length === 0 && pagina === 1) {
    return (
      <div className="vazio">
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          Nenhum consumo de estoque registrado para esta paciente.
        </p>
      </div>
    )
  }
  return (
    <div>
      {dados.itens.map((l) => (
        <Linha key={l.id} l={l} />
      ))}
      {pagina > 1 || dados.temMais ? (
        <div className="orc-topo" style={{ paddingTop: 12 }}>
          <button type="button" className="link" disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}>
            ← Mais recentes
          </button>
          <span className="muted num">página {pagina}</span>
          <button type="button" className="link" disabled={!dados.temMais} onClick={() => setPagina(pagina + 1)}>
            Mais antigos →
          </button>
        </div>
      ) : null}
    </div>
  )
}

function Linha({ l }: { l: LinhaDeConsumo }) {
  return (
    <article className="orc">
      <header className="orc-topo">
        <span className="num">{diaEmTexto(l.dia)}</span>
        <b>{l.item}</b>
        {l.estorno ? <span className="pill alerta">estorno</span> : null}
        {l.estornado ? <span className="pill">estornado</span> : null}
      </header>
      <div className="num">
        {l.estorno ? 'devolvido ' : ''}
        {l.quantidade.texto}
        {l.quantidadeEmUso === null ? '' : ` · ${l.quantidadeEmUso.texto}`}
      </div>
      <small className="muted">
        {/* No nosso modelo o lote É a validade (FIFO de validade); "lote 30/06/2028"
            lia como código do fabricante. */}
        {l.lote === null ? 'sem validade' : `validade ${diaEmTexto(l.lote)}`}
        {l.quem === null ? '' : ` · ${l.quem}`}
        {l.origem === 'sessao' ? ' · sessão' : ' · atendimento'}
        {l.estorno ? ' · desfaz o consumo de origem' : ''}
      </small>
    </article>
  )
}
