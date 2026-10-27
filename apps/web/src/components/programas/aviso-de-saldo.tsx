'use client'

import { formatarDinheiro } from '@fir/ui'

/**
 * **O AVISO DE SALDO, antes da sessão.**
 *
 * MANUAL cap. 8: *"a próxima sessão mostra um alerta com o valor"*. Ele existe
 * para a cobrança acontecer **no atendimento** — o único momento em que a
 * paciente está na frente de alguém. Depois ela vai embora, e a cobrança passa
 * a ser uma ligação.
 *
 * **O `if` é sobre `temSaldo`, não sobre permissão.**
 *
 * `temSaldo` é booleano derivado e atravessa a redação; `saldo` é monetário e
 * chega `null` para quem não tem `valores`. Então a enfermagem sem `valores`
 * vê **o mesmo aviso, sem o número** — e é exatamente o que ela precisa: a
 * informação acionável é "confirme o pagamento", não o valor.
 *
 * Se esta função precisasse de `temPerm` para decidir, ou a API estaria errada
 * ou o controle estaria no lugar errado (`docs/design.md` §4).
 */
export function AvisoDeSaldo({
  temSaldo,
  saldo,
}: {
  readonly temSaldo: boolean
  readonly saldo: string | null
}) {
  if (!temSaldo) return null
  return (
    <div className="aviso-de-saldo" role="note">
      <b>Paciente com saldo em aberto</b>
      {saldo === null ? null : (
        <span className="num">{formatarDinheiro(BigInt(saldo))}</span>
      )}
      <span>Confirmar o pagamento antes da sessão.</span>
    </div>
  )
}
