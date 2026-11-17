import type { ReactNode } from 'react'

/**
 * A moldura das telas de fora do sistema — entrar, esqueci a senha, criar a
 * senha, confirmar o e-mail. A mesma `.entrada` de `/entrar`, para quem chega
 * por um link de e-mail reconhecer a ferramenta antes de digitar uma senha
 * nela.
 */
export function MolduraDeAcesso({ children }: { children: ReactNode }) {
  return (
    <main className="entrada">
      <div className="caixa">
        <div className="marcabloco">
          <div className="marca">
            FIR Clinic<span>.</span>
          </div>
          <div className="eyebrow">Rotinas de gestão</div>
        </div>
        {children}
      </div>
    </main>
  )
}
