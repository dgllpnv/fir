'use client'

import { useEffect, useState } from 'react'
import { adiarFaixa, faixaAdiada } from '@/lib/faixa-do-email'
import { CamposDoMeuEmail, useMeuEmail } from './meu-email'

/**
 * **"Cadastre seu e-mail"** — a faixa do topo do sistema para quem ainda não
 * tem e-mail confirmado (spec 2, fluxo 6).
 *
 * Quem decide se ela existe é o LAYOUT, no servidor (`mostraFaixaDoEmail`):
 * pessoa, sem e-mail confirmado, envio ligado. Aqui só se desenha e se adia.
 *
 * **Até confirmar, nada muda**: a pessoa continua entrando pelo usuário. A
 * faixa não bloqueia nada e sai com "Agora não" até a próxima entrada.
 *
 * Nasce ESCONDIDA e aparece depois da montagem: o adiamento mora no
 * `sessionStorage`, que o servidor não lê. Mostrar e depois esconder piscaria
 * a faixa inteira a cada navegação de quem já disse "Agora não".
 */
export function FaixaDoEmail({ emailPendente }: { emailPendente: string | null }) {
  const [visivel, setVisivel] = useState(false)
  /** O endereço mascarado para onde o link foi — do servidor, ou da resposta do envio. */
  const [pendente, setPendente] = useState<string | null>(emailPendente)
  const [pedindo, setPedindo] = useState(emailPendente === null)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const { erros, enviando, enviar, limpar } = useMeuEmail()

  useEffect(() => {
    setVisivel(!faixaAdiada())
  }, [])

  if (!visivel) return null

  function agoraNao() {
    adiarFaixa()
    setVisivel(false)
  }

  async function aoEnviar(e: React.FormEvent) {
    e.preventDefault()
    const r = await enviar(email, senha)
    if (r === 'erro') return
    setSenha('')
    setEmail('')
    setPendente(r.enviadoPara ?? email)
    setPedindo(false)
  }

  return (
    <section className="faixa-do-email" aria-labelledby="faixa-do-email-titulo">
      {pedindo ? (
        <form className="faixa-do-email-form" onSubmit={aoEnviar} noValidate>
          <div className="faixa-do-email-texto">
            <b id="faixa-do-email-titulo">Cadastre seu e-mail</b>
            <span>Com ele você entra e cria uma senha nova sozinha, sem depender da administradora.</span>
          </div>
          <div className="faixa-do-email-campos">
            <CamposDoMeuEmail
              id="faixa-do-email"
              email={email}
              senha={senha}
              aoMudarEmail={setEmail}
              aoMudarSenha={setSenha}
              erros={erros}
            />
          </div>
          {erros.geral === '' ? null : (
            <p className="erro faixa-do-email-erro" role="alert">
              {erros.geral}
            </p>
          )}
          <div className="botoes">
            <button type="submit" className="btn" disabled={enviando}>
              {enviando ? 'Enviando…' : 'Enviar confirmação'}
            </button>
            {pendente === null ? null : (
              <button
                type="button"
                className="link"
                onClick={() => {
                  limpar()
                  setPedindo(false)
                }}
              >
                Cancelar
              </button>
            )}
            <button type="button" className="link" onClick={agoraNao}>
              Agora não
            </button>
          </div>
        </form>
      ) : (
        <div className="faixa-do-email-form">
          <p className="faixa-do-email-texto" role="status" id="faixa-do-email-titulo">
            <span>
              Enviamos o link para <b className="num">{pendente}</b>. Confira sua caixa de entrada.
            </span>
          </p>
          <div className="botoes">
            {/* Reenviar pede o e-mail inteiro de novo: o servidor só devolve o
                pendente MASCARADO, e a senha atual é exigida a cada envio. */}
            <button type="button" className="btn ghost" onClick={() => setPedindo(true)}>
              Reenviar
            </button>
            <button type="button" className="link" onClick={agoraNao}>
              Agora não
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
