'use client'

import { useId } from 'react'

/**
 * "Copiar", DESLIGADO no ensaio (gate LGPD A3).
 *
 * O botão fica à vista, e não some, porque quem conhece o protótipo vai
 * procurá-lo; sumido, a pergunta "cadê?" chega ao suporte. Desligado e com o
 * porquê ao lado, a resposta já está na tela.
 */
export function CopiarDesligado({ rotulo }: { rotulo: string }) {
  const id = useId()
  return (
    <div className="brief-copiar">
      <button type="button" className="btn ghost" disabled aria-describedby={id}>
        {rotulo}
      </button>
      <p className="brief-copiar-porque" id={id}>
        Desligado no ensaio. Um texto copiado sai da ferramenta sem registro, e o ensaio não é para cliente real.
      </p>
    </div>
  )
}
