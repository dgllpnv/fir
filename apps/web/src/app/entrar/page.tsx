'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'

export default function Entrar() {
  const router = useRouter()
  const [clinica, setClinica] = useState('demo')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await chamar('v1/entrar', { method: 'POST', body: JSON.stringify({ clinica, email, senha }) })
      router.push('/hoje')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    // `.entrada` centra nos DOIS eixos. Antes o formulário nascia colado no
    // topo de uma tela de 820 px, com setecentos pixels de vazio embaixo.
    <main className="entrada">
      <form className="caixa" onSubmit={enviar}>
        <div className="marcabloco">
          <div className="marca">
            Firmare<span>.</span>
          </div>
          <div className="eyebrow">Gestão de Rotina</div>
        </div>

        <div className="cartao">
          <label className="campo">
            Clínica
            <input
              value={clinica}
              onChange={(e) => setClinica(e.target.value)}
              autoComplete="organization"
              required
            />
          </label>
          <label className="campo">
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="campo">
            Senha
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {/* Uma mensagem por vez, e o espaço dela não desloca o botão quando
              aparece: a altura mínima já está reservada. */}
          <p role="alert" aria-live="polite" className="erro-entrada">
            {erro}
          </p>

          <button type="submit" disabled={enviando} className="btn">
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
      </form>
    </main>
  )
}
