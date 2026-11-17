'use client'

import { useEffect, useRef, useState } from 'react'
import { FRASE_DO_ESQUECI_SENHA } from '@fir/contracts'
import { canonizarEmail, ehErro, validarEmail } from '@fir/domain'
import { MolduraDeAcesso } from '@/components/moldura-de-acesso'
import { chamar, ErroDaApi } from '@/lib/api'
import { clinicaGuardada, resolverClinica } from '@/lib/clinica-do-link'
import { entrarNaClinica } from '@/lib/link-de-acesso'

/**
 * **`/esqueci-senha`** — o pedido do link de redefinição (1 hora, uso único).
 *
 * A resposta é **sempre a mesma frase** (spec 3.5): e-mail com conta, sem
 * conta, clínica que não existe. A tela não tenta adivinhar nada além disso —
 * dizer "não achamos esse e-mail" contaria a quem quiser quem tem conta.
 *
 * A clínica vem do link, como em `/entrar` (`?clinica=…`, ADR 0010), e o
 * campo só aparece quando ela não veio.
 */
export default function EsqueciSenha() {
  const [clinica, setClinica] = useState('')
  const [doLink, setDoLink] = useState(false)
  const [email, setEmail] = useState('')
  const [erroDoEmail, setErroDoEmail] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [feito, setFeito] = useState<string | null>(null)
  const campoEmail = useRef<HTMLInputElement>(null)
  const campoClinica = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const r = resolverClinica(window.location.search, clinicaGuardada())
    setClinica(r.codigo)
    const recolher = r.origem !== 'padrao'
    setDoLink(recolher)
    if (recolher) campoEmail.current?.focus()
  }, [])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setErroDoEmail('')
    const canonico = canonizarEmail(email)
    const forma = validarEmail(canonico)
    if (ehErro(forma)) {
      setErroDoEmail(forma.erro.mensagem)
      campoEmail.current?.focus()
      return
    }
    if (clinica.trim() === '') {
      setErro('Informe a clínica.')
      return
    }
    setEnviando(true)
    try {
      const r = await chamar<{ mensagem: string }>('v1/esqueci-senha', {
        method: 'POST',
        body: JSON.stringify({ clinica, email: canonico }),
      })
      setFeito(r.mensagem)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  if (feito !== null) {
    return (
      <MolduraDeAcesso>
        <div className="cartao">
          <h1 className="titulo-de-acesso">Esqueci minha senha</h1>
          <p className="frase-de-acesso" role="status">
            {feito || FRASE_DO_ESQUECI_SENHA}
          </p>
          <a className="btn ghost" href={entrarNaClinica(clinica)}>
            Voltar para a entrada
          </a>
        </div>
      </MolduraDeAcesso>
    )
  }

  return (
    <MolduraDeAcesso>
      <form className="cartao" onSubmit={enviar} noValidate>
        <div className="cabeca-de-acesso">
          <h1 className="titulo-de-acesso">Esqueci minha senha</h1>
          <p className="nota">Enviamos um link para o e-mail cadastrado. Ele vale por 1 hora.</p>
        </div>

        {doLink ? (
          <div className="clinica-do-link">
            <div>
              <div className="eyebrow">Clínica</div>
              <b>{clinica}</b>
            </div>
            <button
              type="button"
              className="link"
              onClick={() => {
                setDoLink(false)
                requestAnimationFrame(() => campoClinica.current?.select())
              }}
            >
              Trocar
            </button>
          </div>
        ) : (
          <label className="campo">
            Clínica
            <input
              ref={campoClinica}
              value={clinica}
              onChange={(e) => setClinica(e.target.value)}
              autoComplete="organization"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </label>
        )}

        <label className="campo">
          E-mail
          <input
            ref={campoEmail}
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setErroDoEmail('')
            }}
            autoComplete="email"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={erroDoEmail !== ''}
            aria-describedby="erro-do-email"
            required
          />
          <span id="erro-do-email" className="erro" role="status" aria-live="polite" style={{ minHeight: 16 }}>
            {erroDoEmail}
          </span>
        </label>

        <p role="alert" aria-live="polite" className="erro-entrada">
          {erro}
        </p>

        <button type="submit" className="btn" disabled={enviando}>
          {enviando ? 'Enviando…' : 'Enviar link'}
        </button>
        <a className="link link-de-acesso" href={entrarNaClinica(doLink ? clinica : '')}>
          Voltar para a entrada
        </a>
      </form>
    </MolduraDeAcesso>
  )
}
