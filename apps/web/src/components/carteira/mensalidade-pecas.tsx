'use client'

import type { MensalidadeNoPainel, SituacaoDaMensalidade } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'

/**
 * As peças da tela Mensalidades (G8 1F, `painelMensalidades` L719-729).
 *
 * Nada aqui calcula: situação, dias, totais e o dia do pagamento chegam
 * prontos do servidor. Isto só FORMATA — dinheiro pelo formatador central,
 * datas civis cortadas da string `aaaa-mm-dd` (sem `Date`, sem fuso do
 * navegador, regra 24).
 */

export const dinheiro = (centavos: string | null): string =>
  formatarDinheiro(centavos === null ? null : BigInt(centavos))

/** `aaaa-mm-dd` → `dd/mm`, como o `dm` do protótipo (L501). */
export const diaEMes = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

/** `aaaa-mm` (ou `aaaa-mm-01`) → "fevereiro de 2027". */
export const mesPorExtenso = (mes: string): string =>
  `${MESES[Number(mes.slice(5, 7)) - 1] ?? ''} de ${mes.slice(0, 4)}`

/** Os rótulos dos filtros, na ordem do servidor (`SITUACOES_DA_MENSALIDADE`). */
export const ROTULO_DA_SITUACAO: Readonly<Record<SituacaoDaMensalidade, string>> = {
  vencida: 'Vencidas',
  vence_hoje: 'Vencem hoje',
  a_vencer: 'A vencer',
  paga: 'Pagas',
  sem_valor: 'Sem valor',
}

/**
 * O texto do chip, com as palavras do protótipo (L711-717). Os textos de
 * lembrete ("lembrete enviado em…") esperam a rotina de lembrete de
 * pagamento ($3); até lá, a aberta futura diz quando vence.
 */
export function textoDaSituacao(m: MensalidadeNoPainel): string {
  switch (m.situacao) {
    case 'paga':
      return m.pagoNoDia ? `Pago em ${diaEMes(m.pagoNoDia)}` : 'Pago'
    case 'vence_hoje':
      return 'Vence hoje'
    case 'vencida': {
      const n = -m.dias
      return `Vencida há ${n} ${n === 1 ? 'dia' : 'dias'}`
    }
    case 'a_vencer':
      return `Vence em ${diaEMes(m.vencimento)}`
    case 'sem_valor':
      return 'Sem valor a pagar'
  }
}

/** Uma linha da lista: cliente, vencimento, valor, situação e a ação. */
export function LinhaDeMensalidade({
  m,
  escolhida,
  ocupada,
  aoEscolher,
  aoMarcarPago,
  aoDesfazer,
}: {
  m: MensalidadeNoPainel
  escolhida: boolean
  ocupada: boolean
  aoEscolher: (sim: boolean) => void
  aoMarcarPago: () => void
  aoDesfazer: () => void
}) {
  const paga = m.situacao === 'paga'
  return (
    <li className="mens-linha" data-situacao={m.situacao}>
      <label className="mens-escolha">
        <input
          type="checkbox"
          checked={escolhida}
          disabled={paga || ocupada}
          onChange={(e) => aoEscolher(e.target.checked)}
          aria-label={paga ? `${m.clienteNome}: já paga` : `Escolher ${m.clienteNome} para baixar como paga`}
        />
      </label>
      <div className="mens-info">
        <b className="mens-nome">{m.clienteNome}</b>
        <span className="mens-venc">vence {diaEMes(m.vencimento)}</span>
      </div>
      <span className="mens-valor">{dinheiro(m.valor)}</span>
      <span className="mens-chip" data-situacao={m.situacao}>
        <i aria-hidden="true" />
        {textoDaSituacao(m)}
      </span>
      <span className="mens-acao">
        {paga ? (
          <button type="button" className="link" onClick={aoDesfazer} disabled={ocupada}>
            Desfazer
          </button>
        ) : (
          <button type="button" className="link" onClick={aoMarcarPago} disabled={ocupada}>
            Marcar pago
          </button>
        )}
      </span>
    </li>
  )
}

/**
 * "Recebido de total" como barra: um segmento por mensalidade, pintado pela
 * situação. Não há conta de percentual no front (design.md §5) — e a barra
 * continua dizendo algo para quem não tem `valores`, porque conta linhas,
 * não reais.
 */
export function BarraDoMes({ mensalidades }: { mensalidades: readonly MensalidadeNoPainel[] }) {
  if (mensalidades.length === 0) return null
  return (
    <div className="mens-barra" role="img" aria-label="Situação das mensalidades do mês, uma faixa por cliente">
      {mensalidades.map((m) => (
        <i key={m.id} data-situacao={m.situacao} />
      ))}
    </div>
  )
}
