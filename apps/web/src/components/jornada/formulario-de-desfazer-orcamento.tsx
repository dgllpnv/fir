'use client'

import type { PreviaDeDesfazerOrcamento, TarefaNaLista } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import Link from 'next/link'
import { useState } from 'react'
import { useDados } from '@/lib/dados'

/**
 * "REABRIR ORÇAMENTO" e "EXCLUIR ORÇAMENTO" — a consulta fica, o orçamento não.
 *
 * Pedido da cliente: errar o fechamento obrigava a excluir o atendimento inteiro.
 * Aqui a pessoa vê, ANTES de confirmar, o que será desfeito (o pagamento a
 * estornar, o programa a encerrar), escreve o motivo (10 a 200 caracteres, vai
 * para a trilha) e, se o dinheiro entrou num dia de caixa já fechado, confirma
 * esse estorno explicitamente. Quem decide é o servidor; a tela só pergunta.
 *
 * Sem a permissão `valores` o servidor devolve o valor `null`, e a frase fica
 * "há um pagamento a estornar", sem número.
 */
const DIA_BR = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

export function FormularioDeDesfazerOrcamento({
  acao,
  tarefa: t,
  aoFechar,
  aoSalvar,
}: {
  acao: 'reabrirOrcamento' | 'excluirOrcamento'
  tarefa: TarefaNaLista
  aoFechar: () => void
  aoSalvar: (corpo: Record<string, unknown>) => Promise<void>
}) {
  const previa = useDados<PreviaDeDesfazerOrcamento>(`v1/tarefas/${t.id}/orcamento/previa`)
  const [motivo, setMotivo] = useState('')
  const [confirmaCaixa, setConfirmaCaixa] = useState(false)
  const [confirmaCredito, setConfirmaCredito] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const reabrir = acao === 'reabrirOrcamento'
  const p = previa.dados
  const motivoOk = motivo.trim().length >= 10 && motivo.trim().length <= 200

  async function confirmar() {
    setErro(null)
    if (!motivoOk) {
      setErro('Escreva o motivo, de 10 a 200 caracteres.')
      return
    }
    if (p?.caixaFechado === true && !confirmaCaixa) {
      setErro('Confirme o estorno do dinheiro de um dia de caixa fechado.')
      return
    }
    if (p?.geraCredito === true && !confirmaCredito) {
      setErro('Confirme que o que a paciente já pagou em "Saldo em aberto" vira crédito dela.')
      return
    }
    setSalvando(true)
    try {
      await aoSalvar({
        acao,
        motivo: motivo.trim(),
        ...(p?.caixaFechado === true ? { confirmarCaixaFechado: true } : {}),
        ...(p?.geraCredito === true ? { confirmarCredito: true } : {}),
      })
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui desfazer o orçamento.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="painel jornada-form">
      <b>{reabrir ? 'Reabrir o orçamento' : 'Excluir o orçamento'}</b>
      <p className="nota">
        {reabrir
          ? 'O orçamento volta para "Orçamentos em aberto", com o que foi orçado. O fechamento é desfeito.'
          : 'O orçamento sai do atendimento. A consulta continua; o orçamento deixa de existir.'}
      </p>

      {p === null || p === undefined ? (
        <p className="muted">Conferindo o que será desfeito…</p>
      ) : (
        <ul className="nota" aria-label="O que será desfeito">
          {p.temPagamento ? (
            <li>
              {p.valor === null
                ? 'Há um pagamento deste fechamento a estornar'
                : `O pagamento de ${formatarDinheiro(BigInt(p.valor))} deste fechamento será estornado`}
              {p.diaDoDinheiro === null ? '' : ` (entrou em ${DIA_BR(p.diaDoDinheiro)})`}.
            </li>
          ) : null}
          {p.temPrograma ? <li>O programa criado por este orçamento será encerrado e removido.</li> : null}
          {!p.temPagamento && !p.temPrograma ? <li>Não há dinheiro nem programa a desfazer.</li> : null}
        </ul>
      )}

      {p?.bloqueio != null ? (
        <p className="campo" role="alert">
          <span className="erro">{p.bloqueio}</span>
          {p.bloqueio.includes('Financeiro › Recebimentos') ? (
            <>
              {' '}
              <Link href="/recebimentos">Abrir Recebimentos</Link>
            </>
          ) : null}
        </p>
      ) : null}

      {p?.caixaFechado === true ? (
        <label className="caixa">
          <input
            type="checkbox"
            checked={confirmaCaixa}
            onChange={(e) => setConfirmaCaixa(e.target.checked)}
          />
          Esse dinheiro entrou em {p.diaDoDinheiro === null ? 'um dia' : DIA_BR(p.diaDoDinheiro)}, com o caixa
          já fechado. Confirmo o estorno.
        </label>
      ) : null}

      {p?.geraCredito === true ? (
        <div className="aviso-forte">
          <b>A paciente já pagou parte desta dívida</b>
          <p className="nota" style={{ margin: 0 }}>
            Ela pagou em &ldquo;Saldo em aberto&rdquo;. Sem esta dívida, o que ela pagou sobra e vira{' '}
            <b>crédito dela</b>. Se não é isso que você quer, estorne esse pagamento em Financeiro ›
            Recebimentos antes.
          </p>
          <label className="caixa">
            <input
              type="checkbox"
              checked={confirmaCredito}
              onChange={(e) => setConfirmaCredito(e.target.checked)}
            />
            Entendi: o que ela já pagou vira crédito.
          </label>
        </div>
      ) : null}

      <label className="campo">
        Motivo <small>(de 10 a 200 caracteres; fica na trilha)</small>
        <textarea
          rows={2}
          maxLength={200}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </label>

      {erro === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>
        </p>
      )}

      <div className="botoes">
        <button
          type="button"
          className="btn"
          disabled={salvando || p === null || p === undefined || p.bloqueio !== null}
          onClick={() => void confirmar()}
        >
          {salvando ? 'Desfazendo…' : reabrir ? 'Reabrir orçamento' : 'Excluir orçamento'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
