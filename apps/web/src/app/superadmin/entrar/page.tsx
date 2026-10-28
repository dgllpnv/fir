'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * Entrar no painel. Dois campos e um botão.
 *
 * **Não há campo de clínica**, e a ausência é o modelo: o operador não
 * pertence a clínica nenhuma (D-5 restrição 1). O servidor recusa o campo com
 * 400 se alguém o mandar.
 */
export default function EntrarNoPainel() {
  const router = useRouter()
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await chamar('v1/superadmin/entrar', {
        method: 'POST',
        body: JSON.stringify({ usuario, senha }),
      })
      router.push('/superadmin/clinicas')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={enviar}>
      <h1 style={{ fontSize: '1rem', margin: '0 0 1rem' }}>Entrar</h1>
      <label style={{ display: 'block', marginBottom: '.75rem' }}>
        Usuário
        <br />
        <input
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          autoComplete="username"
          // O teclado do tablet maiusculiza e corrige por padrão. Sem estes
          // três, a pessoa vê na tela algo diferente do que o sistema usa.
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          style={{ width: '100%', padding: '.4rem', font: 'inherit' }}
        />
      </label>
      <label style={{ display: 'block', marginBottom: '.75rem' }}>
        Senha
        <br />
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          autoComplete="current-password"
          required
          style={{ width: '100%', padding: '.4rem', font: 'inherit' }}
        />
      </label>
      {/* Altura reservada: a mensagem não desloca o botão ao aparecer. */}
      <p role="alert" aria-live="polite" style={{ minHeight: '1.4rem', margin: '0 0 .5rem' }}>
        {erro}
      </p>
      <button type="submit" disabled={enviando} style={{ padding: '.5rem 1rem', font: 'inherit' }}>
        {enviando ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}
