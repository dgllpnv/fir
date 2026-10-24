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
    <main className="wrap" style={{ maxWidth: 420, paddingTop: 64 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ color: 'var(--gold-ink)', fontSize: 13, letterSpacing: '.08em', textTransform: 'uppercase' }}>
          Firmare
        </div>
        <h1 style={{ fontSize: 30 }}>Gestão de Rotina</h1>
      </div>

      <form onSubmit={enviar} style={{ display: 'grid', gap: 14 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          Clínica
          <input value={clinica} onChange={(e) => setClinica(e.target.value)} autoComplete="organization" required style={campo} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required style={campo} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          Senha
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required style={campo} />
        </label>

        {erro && (
          <p role="alert" style={{ color: 'var(--bad)', background: 'var(--bad-soft)', padding: '10px 12px', borderRadius: 'var(--r)', margin: 0 }}>
            {erro}
          </p>
        )}

        <button type="submit" disabled={enviando} style={botao}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}

const campo: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r)',
  background: 'var(--surface)',
}

const botao: React.CSSProperties = {
  padding: '12px 16px',
  border: 0,
  borderRadius: 'var(--r)',
  background: 'var(--btn-bg)',
  color: 'var(--btn-ink)',
  fontWeight: 600,
}
