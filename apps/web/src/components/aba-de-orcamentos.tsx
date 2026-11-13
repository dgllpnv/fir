'use client'

import type { OrcamentoDoPaciente, RespostaDeOrcamentosDoPaciente } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useDados } from '@/lib/dados'
import { diaCurto, diaEmTexto, plural } from '@/lib/formato'
import {
  fechouXdeY,
  MARCA_DO_ITEM,
  ROTULO_DA_SITUACAO,
  TOM_DA_SITUACAO,
} from '@/lib/orcamentos-do-paciente'
import { Carregando, Erro } from './estados'

/**
 * A aba "Orçamentos" da ficha: cada orçamento do paciente com o detalhamento
 * dos procedimentos. Tudo derivado no servidor; aqui só se formata. Sem a
 * permissão `valores` os campos monetários chegam `null` e a linha some —
 * sobra a situação e a contagem. A aba só é montada com `jornada`.
 */
export function AbaDeOrcamentos({
  pacienteId,
  aoRetomar,
}: {
  readonly pacienteId: string
  /** Leva ao cartão da tarefa de origem, onde mora a ação "Retomar o restante". */
  readonly aoRetomar: (tarefaId: string) => void
}) {
  const { dados, erro, recarregar } = useDados<RespostaDeOrcamentosDoPaciente>(
    `v1/pacientes/${pacienteId}/orcamentos`,
  )
  if (erro !== null) return <Erro mensagem={erro} recarregar={recarregar} />
  if (dados === null) return <Carregando linhas={3} />
  if (dados.itens.length === 0) {
    return (
      <div className="vazio">
        <p style={{ margin: 0, color: 'var(--muted)' }}>Nenhum orçamento ainda.</p>
      </div>
    )
  }
  const t = dados.totais
  return (
    <div>
      <p className="nota num orc-totais">
        {plural(t.orcamentos, 'orçamento', 'orçamentos')} · {t.abertos} em aberto · {t.fechados}{' '}
        {t.fechados === 1 ? 'fechado' : 'fechados'} · {t.parciais}{' '}
        {t.parciais === 1 ? 'parcial' : 'parciais'} · {t.perdidos}{' '}
        {t.perdidos === 1 ? 'perdido' : 'perdidos'}
      </p>
      {dados.itens.map((o) => (
        <Orcamento key={o.tarefaId} o={o} aoRetomar={aoRetomar} />
      ))}
    </div>
  )
}

const din = (v: string | null | undefined): string | null =>
  v === null || v === undefined ? null : formatarDinheiro(BigInt(v))

function Orcamento({
  o,
  aoRetomar,
}: {
  o: OrcamentoDoPaciente
  aoRetomar: (tarefaId: string) => void
}) {
  const orcado = din(o.valorOrcamento)
  const fechado = din(o.valorFechado)
  const restante = din(o.valorRestante)
  return (
    <article className="orc">
      <header className="orc-topo">
        <span className="num">{diaEmTexto(o.atendimentoEm)}</span>
        <span className={`pill ${TOM_DA_SITUACAO[o.situacao]}`}>{ROTULO_DA_SITUACAO[o.situacao]}</span>
        <span className="muted orc-tipo">{o.tipoDoAtendimento}</span>
      </header>

      {orcado === null ? null : (
        <dl className="orc-valores num">
          <div>
            <dt>Orçado</dt>
            <dd>{orcado}</dd>
          </div>
          {o.situacao === 'fechado' || o.situacao === 'parcial' ? (
            <div>
              <dt>Fechado</dt>
              <dd>{fechado ?? '—'}</dd>
            </div>
          ) : null}
          {o.situacao === 'parcial' ? (
            <div>
              <dt>Restante</dt>
              <dd>{restante ?? '—'}</dd>
            </div>
          ) : null}
        </dl>
      )}

      {o.situacao === 'fechado' || o.situacao === 'parcial' ? (
        <p className="nota num" style={{ margin: '4px 0' }}>
          {fechouXdeY(o.itensFechados, o.itensTotal)}
        </p>
      ) : null}

      {o.itens.length === 0 ? (
        <p className="nota" style={{ margin: '4px 0' }}>
          Sem procedimentos detalhados.
        </p>
      ) : (
        <ul className="orc-itens" aria-label="Procedimentos do orçamento">
          {o.itens.map((i) => {
            const marca = MARCA_DO_ITEM[i.situacao]
            const preco = din(i.valor)
            return (
              <li key={i.chave} className={`orc-item ${i.situacao}`}>
                <span className="orc-marca" aria-hidden="true">
                  {marca.sinal}
                </span>
                <span className="orc-nome">{i.procedimento}</span>
                {preco === null ? null : <span className="num orc-preco">{preco}</span>}
                <span className="orc-estado">{marca.texto}</span>
              </li>
            )
          })}
        </ul>
      )}

      {o.situacao === 'parcial' ? (
        <div className="orc-rodape">
          <span className="num">
            {o.retomarRestanteEm === null
              ? 'Sem data para retomar o restante'
              : `Retomar o restante em ${diaCurto(o.retomarRestanteEm)}`}
          </span>
          <button type="button" className="btn ghost" onClick={() => aoRetomar(o.tarefaId)}>
            Retomar o restante
          </button>
        </div>
      ) : null}
    </article>
  )
}
