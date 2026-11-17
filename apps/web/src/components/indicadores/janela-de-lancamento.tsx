'use client'

import {
  AVISO_DE_TEXTO_LIVRE_DO_KPI,
  COMENTARIO_DO_LANCAMENTO_MAXIMO,
  type DetalheDoKpi,
  type LancamentoDeKpiNaSaida,
} from '@fir/contracts'
import { type FormEvent, useCallback, useId, useState } from 'react'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { ErroDoCampo } from './painel-lateral'
import { type AlvoDoLancamento, EXEMPLO_DA_UNIDADE, menorUnidadeDoTexto, recadoDoLancamento, ROTULO_DA_UNIDADE } from './na-tela'

/**
 * **D.4 — Lançar valor** (KPI manual): janela pequena, centralizada.
 *
 * Nome no título, "Como medir" em letra pequena, Valor, Referência (a semana
 * ou o mês, já preenchidos com o período pendente), Comentário opcional. O
 * `PUT` é idempotente por referência: relançar corrige (I-31), e a tarefa de
 * lançamento daquela referência conclui sozinha.
 *
 * **Duas portas, uma janela.** Do cartão do KPI, quem abre tem `indicadores`,
 * e o "como medir" vem do detalhe. Da tarefa "Lançar [KPI]" em Hoje, quem abre
 * pode ser a responsável SEM `indicadores` (exceção `podeLancar`, T3): tudo
 * chega pela tarefa, e nenhuma rota de leitura de indicadores é chamada —
 * ela responderia 403 (appsec C2).
 */
export function JanelaDeLancamento({
  alvo,
  aoFechar,
  aoSalvo,
}: {
  alvo: AlvoDoLancamento
  aoFechar: () => void
  aoSalvo: (recado: string) => void
}) {
  const id = useId()
  const detalhe = useDados<DetalheDoKpi>(alvo.comoMedir === null ? `v1/indicadores/kpis/${alvo.kpiId}` : null)
  const semanal = alvo.semanal
  const [referencia, setReferencia] = useState(semanal === false ? alvo.referencia.slice(0, 7) : alvo.referencia)
  const [valor, setValor] = useState('')
  const [comentario, setComentario] = useState('')
  const [erroDoValor, setErroDoValor] = useState<string | null>(null)
  const [erroDaReferencia, setErroDaReferencia] = useState<string | null>(null)
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const salvar = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      const v = menorUnidadeDoTexto(alvo.unidade, valor)
      const ref = semanal === false ? `${referencia}-01` : referencia
      const refOk = /^\d{4}-\d{2}-\d{2}$/.test(ref)
      setErroDoValor(v === null || v < 0n ? 'Escreva o valor, só com números.' : null)
      setErroDaReferencia(
        refOk ? null : semanal === true ? 'Escolha a segunda-feira da semana.' : semanal === false ? 'Escolha o mês.' : 'Escolha o dia.',
      )
      if (v === null || v < 0n || !refOk) return
      setSalvando(true)
      setErroGeral(null)
      try {
        const r = await chamar<LancamentoDeKpiNaSaida>(`v1/indicadores/kpis/${alvo.kpiId}/lancamentos/${ref}`, {
          method: 'PUT',
          body: JSON.stringify({ valor: v.toString(), comentario }),
        })
        aoSalvo(recadoDoLancamento(r))
      } catch (x) {
        setErroGeral(x instanceof ErroDaApi ? x.message : 'Não consegui lançar. Confira a conexão.')
      } finally {
        setSalvando(false)
      }
    },
    [alvo, valor, referencia, semanal, comentario, aoSalvo],
  )

  const comoMedir = alvo.comoMedir ?? detalhe.dados?.comoMedir ?? ''

  return (
    <Modal titulo={`Lançar: ${alvo.nome}`} aoFechar={aoFechar}>
      <form onSubmit={(e) => void salvar(e)} noValidate style={{ display: 'grid', gap: 12 }}>
        {comoMedir === '' ? null : <p className="nota">{comoMedir}</p>}

        <label className="campo">
          Valor <small>({ROTULO_DA_UNIDADE[alvo.unidade]})</small>
          <input
            inputMode="decimal"
            value={valor}
            placeholder={EXEMPLO_DA_UNIDADE[alvo.unidade]}
            aria-invalid={erroDoValor !== null}
            aria-describedby={erroDoValor === null ? undefined : `${id}-valor`}
            onChange={(e) => setValor(e.target.value)}
          />
          <ErroDoCampo id={`${id}-valor`} mensagem={erroDoValor} />
        </label>

        <label className="campo">
          Referência{' '}
          <small>({semanal === true ? 'segunda-feira da semana' : semanal === false ? 'mês' : 'primeiro dia do período'})</small>
          <input
            type={semanal === false ? 'month' : 'date'}
            value={referencia}
            aria-invalid={erroDaReferencia !== null}
            onChange={(e) => setReferencia(e.target.value)}
          />
          <ErroDoCampo id={`${id}-ref`} mensagem={erroDaReferencia} />
        </label>

        <label className="campo">
          Comentário <small>(opcional)</small>
          <textarea
            rows={2}
            value={comentario}
            maxLength={COMENTARIO_DO_LANCAMENTO_MAXIMO}
            onChange={(e) => setComentario(e.target.value)}
          />
          <small className="ii-aviso-texto">{AVISO_DE_TEXTO_LIVRE_DO_KPI}</small>
        </label>

        {erroGeral === null ? null : (
          <p role="alert" style={{ color: 'var(--bad)', margin: 0 }}>
            {erroGeral}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 18 }}>
          <button type="button" className="link" onClick={aoFechar} style={{ minHeight: 44 }}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
