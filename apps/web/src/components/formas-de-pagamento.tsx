'use client'

import { formatarDinheiro } from '@fir/ui'
import {
  abrirMultiplas,
  adicionarLinha,
  type EstadoDasFormas,
  FORMAS_DE_PAGAMENTO,
  type FormaDePagamento,
  formasDaLinha,
  mensagemDaSituacao,
  mudarForma,
  mudarValor,
  NOTA_PROMISSORIA,
  podeAdicionarLinha,
  removerLinha,
  situacaoDasPartes,
  voltarParaUma,
} from '@/lib/partes-do-pagamento'

/**
 * **A forma de pagamento — uma só, ou várias ("Incluir mais de uma forma").**
 *
 * Um componente para os quatro lugares onde se registra dinheiro (Recebimentos, o
 * "Houve pagamento?" da tarefa, fechar orçamento, nova adesão), porque a regra é
 * a mesma e escrita quatro vezes ela diverge — a história desta casa.
 *
 * Em modo simples é o `<select>` de sempre, mais um botão discreto: o caminho de
 * dois toques não muda para quem recebe numa forma só. O estado é controlado e
 * mora em `lib/partes-do-pagamento.ts`; aqui só se desenha.
 *
 * O "Falta R$ X" só GUIA. A soma que decide é a do servidor.
 */
export function FormasDePagamento({
  estado,
  aoMudar,
  total,
  desabilitado = false,
}: {
  estado: EstadoDasFormas
  aoMudar: (novo: EstadoDasFormas) => void
  /** O valor do recebimento, em centavos, já lido do campo (`null` = ainda não digitado). */
  total: bigint | null
  desabilitado?: boolean
}) {
  const acharForma = (texto: string): FormaDePagamento | undefined =>
    FORMAS_DE_PAGAMENTO.find((f) => f === texto)

  if (!estado.multiplas) {
    return (
      <div className="formas-de-pagamento" data-multiplas="nao">
        <label className="campo">
          Forma de pagamento
          <select
            value={estado.forma}
            disabled={desabilitado}
            onChange={(e) => {
              const f = acharForma(e.target.value)
              if (f !== undefined) aoMudar({ ...estado, forma: f })
            }}
          >
            {FORMAS_DE_PAGAMENTO.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="partes-abrir"
          disabled={desabilitado}
          onClick={() => aoMudar(abrirMultiplas(estado))}
        >
          Incluir mais de uma forma de pagamento
        </button>
      </div>
    )
  }

  const situacao = situacaoDasPartes(total, estado)
  const texto =
    situacao.tipo === 'fecha' && total !== null
      ? `Fecha com o valor recebido: ${formatarDinheiro(total)}.`
      : mensagemDaSituacao(situacao, formatarDinheiro)

  return (
    <fieldset className="formas-de-pagamento" data-multiplas="sim" disabled={desabilitado}>
      <legend>Formas de pagamento</legend>
      <div className="partes-linhas">
        {estado.linhas.map((l, i) => (
          <div className="partes-linha" key={l.id}>
            <label className="campo">
              <span className="sr-apenas">Forma da parte {i + 1}</span>
              <select
                value={l.forma}
                onChange={(e) => {
                  const f = acharForma(e.target.value)
                  if (f !== undefined) aoMudar(mudarForma(estado, l.id, f, total))
                }}
              >
                {formasDaLinha(estado, l.id).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span className="sr-apenas">Valor da parte {i + 1} (R$)</span>
              <input
                inputMode="decimal"
                placeholder="0,00"
                className="partes-valor"
                value={l.valor}
                onChange={(e) => aoMudar(mudarValor(estado, l.id, e.target.value))}
              />
            </label>
            {estado.linhas.length > 1 ? (
              <button
                type="button"
                className="partes-tirar"
                aria-label={`Tirar a forma ${l.forma}`}
                onClick={() => aoMudar(removerLinha(estado, l.id))}
              >
                Tirar
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>

      <p className="partes-resumo" data-situacao={situacao.tipo} role="status" aria-live="polite">
        {texto}
      </p>

      <div className="partes-acoes">
        {podeAdicionarLinha(estado) ? (
          <button
            type="button"
            className="partes-abrir"
            onClick={() => aoMudar(adicionarLinha(estado))}
          >
            + Outra forma
          </button>
        ) : estado.linhas.some((l) => l.forma === NOTA_PROMISSORIA) ? (
          <small className="muted">Nota promissória não se mistura com outra forma.</small>
        ) : null}
        <button
          type="button"
          className="partes-abrir"
          onClick={() => aoMudar(voltarParaUma(estado))}
        >
          Usar uma forma só
        </button>
      </div>
    </fieldset>
  )
}

/**
 * Libera ou não o botão de registrar: com várias formas, só quando a soma fecha.
 * Em forma única nunca bloqueia (o comportamento de sempre).
 */
export function partesFecham(estado: EstadoDasFormas, total: bigint | null): boolean {
  return !estado.multiplas || situacaoDasPartes(total, estado).tipo === 'fecha'
}
