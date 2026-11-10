'use client'

import type { PortalEuSaida } from '@fir/contracts'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { ICONE_OLHO_ABERTO, ICONE_OLHO_FECHADO } from '@/lib/icones'

/**
 * Entrar no portal do grupo. Mesma forma da entrada da carteira — dois
 * campos, a caixa centrada do produto, e a porta diz claramente que é a
 * porta do portal, não a da clínica, a do superadmin nem a da carteira.
 *
 * Sem campo de clínica: o `Usuário do portal` não escolhe uma clínica para
 * entrar — o que ele enxerga (um `Cliente Firmare` ou o grupo inteiro) já
 * está decidido no cadastro dele (ADR 0017).
 */
export default function EntrarNoPortal() {
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
      const eu = await chamar<PortalEuSaida>('v1/portal/entrar', {
        method: 'POST',
        body: JSON.stringify({ usuario, senha }),
      })
      // Com provisória, a única coisa que a sessão pode fazer é trocá-la.
      window.location.assign(eu.usuarioDoPortal.senhaProvisoria ? '/portal/trocar-senha' : '/portal/clientes')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="entrada">
      <form className="caixa" onSubmit={enviar}>
        <div className="portal-porta">
          <span className="portal-selo">Portal do grupo</span>
          <div className="marca">
            Firmare<span>.</span>
          </div>
          <p className="nota">
            Acompanhamento comercial da sua rede de clínicas com a Firmare.{' '}
            <b>Não é a entrada da clínica</b> — para entrar numa, use{' '}
            <a className="link" href="/entrar">
              o endereço dela
            </a>
            .
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
            {enviando ? 'Entrando…' : 'Entrar no portal'}
          </button>
        </div>
      </form>
    </main>
  )
}
