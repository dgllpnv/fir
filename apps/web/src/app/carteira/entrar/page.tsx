'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { ICONE_OLHO_ABERTO, ICONE_OLHO_FECHADO } from '@/lib/icones'

/**
 * Entrar na carteira comercial. Mesma forma da entrada do painel — dois
 * campos, a caixa centrada do produto, e a porta diz claramente que é a
 * porta da carteira, não a da clínica nem a do superadmin.
 *
 * Sem campo de clínica: o Usuário de Gestão não pertence a clínica nenhuma
 * (mesma razão do Operador) — o servidor recusa o campo com 400 se vier.
 *
 * Sem segundo fator (MFA): decisão do dono, registrada na ADR 0012 (emenda
 * 2026-11-05) — mesmo padrão de segurança do resto do produto.
 */
export default function EntrarNaCarteira() {
  const router = useRouter()
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [senhaVisivel, setSenhaVisivel] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setSenhaVisivel(false)
    setEnviando(true)
    try {
      await chamar('v1/carteira/entrar', {
        method: 'POST',
        body: JSON.stringify({ usuario, senha }),
      })
      router.push('/carteira/clientes')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="entrada">
      <form className="caixa" onSubmit={enviar}>
        <div className="carteira-porta">
          <span className="carteira-selo">Carteira comercial</span>
          <div className="marca">
            Firmare<span>.</span>
          </div>
          <p className="nota">
            Acompanhamento das clínicas da sua carteira. <b>Não é a entrada da clínica</b> — para
            entrar numa, use <a className="link" href="/entrar">o endereço dela</a>.
          </p>
        </div>

        <div className="cartao">
          <label className="campo">
            Usuário
            <input
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </label>
          <label className="campo">
            Senha
            <span className="campo-com-botao">
              <input
                type={senhaVisivel ? 'text' : 'password'}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                tabIndex={-1}
                className="olho"
                aria-label={senhaVisivel ? 'Esconder a senha' : 'Mostrar a senha'}
                aria-pressed={senhaVisivel}
                onClick={() => setSenhaVisivel((v) => !v)}
              >
                {senhaVisivel ? ICONE_OLHO_FECHADO : ICONE_OLHO_ABERTO}
              </button>
            </span>
          </label>

          <p role="alert" aria-live="polite" className="erro-entrada">
            {erro}
          </p>

          <button type="submit" disabled={enviando} className="btn">
            {enviando ? 'Entrando…' : 'Entrar na carteira'}
          </button>
        </div>
      </form>
    </main>
  )
}
