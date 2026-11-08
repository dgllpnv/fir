'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { ICONE_OLHO_ABERTO, ICONE_OLHO_FECHADO } from '@/lib/icones'

/**
 * Entrar no painel. Dois campos e um botão — e **a porta diz que é a porta do
 * painel**.
 *
 * ## O que mudou, e por quê
 *
 * Esta tela era a primeira coisa que se vê do painel, e era um `<h1>` de 16 px
 * escrito "Entrar" em fonte monoespaçada. Quem caísse nela pelo endereço
 * errado não tinha como saber onde estava; e quem chegasse de propósito via o
 * produto parecer inacabado. Agora ela é a caixa centrada do produto
 * (`.entrada`, de `shell.css` — mesma marca, mesmo cartão, mesmo olho na
 * senha) com **o selo `PAINEL INTERNO` acima da marca** e a frase que diz, em
 * uma linha, que esta não é a entrada da clínica — com o caminho de volta.
 *
 * ## Não há campo de clínica, e a ausência é o modelo
 *
 * O operador não pertence a clínica nenhuma (D-5 restrição 1). O servidor
 * recusa o campo com 400 se alguém o mandar. A frase "nenhuma clínica aqui"
 * fica visível de propósito: é o contraste mais rápido com a entrada do
 * produto, que pede clínica + usuário + senha.
 */
export default function EntrarNoPainel() {
  const router = useRouter()
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  /**
   * Mostrar a senha digitada — e ela **nasce escondida e volta a esconder a
   * cada tentativa**, pela mesma razão da tela do produto: a senha do painel
   * também pode ser uma provisória de quatro palavras ditada por telefone, e
   * errar uma letra às cegas gasta uma das tentativas antes do bloqueio de
   * quinze minutos.
   */
  const [senhaVisivel, setSenhaVisivel] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setSenhaVisivel(false)
    setEnviando(true)
    try {
      await chamar('v1/superadmin/entrar', {
        method: 'POST',
        body: JSON.stringify({ usuario, senha }),
      })
      // D-23 item 6: a porta do painel abre a Visão geral (ADR 0024).
      router.push('/superadmin')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="entrada">
      <form className="caixa" onSubmit={enviar}>
        <div className="superadmin-porta">
          <span className="selo">Painel interno</span>
          <div className="marca">
            Firmare<span>.</span>
          </div>
          <p className="nota">
            Este é o painel que cria clínica e administradora. <b>Não é a entrada da clínica</b> —
            para entrar numa, use <a className="link" href="/entrar">o endereço dela</a>.
          </p>
        </div>

        <div className="cartao">
          <label className="campo">
            Usuário do painel
            <input
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoComplete="username"
              // O teclado do tablet maiusculiza e corrige por padrão. Sem
              // estes três, a pessoa vê na tela algo diferente do que o
              // sistema usa.
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
              {/* `type="button"`: sem isso o navegador o trata como submit e
                  revelar a senha TENTA ENTRAR. `tabIndex={-1}` mantém a ordem
                  senha → Entrar, que é o caminho de quem digita rápido. */}
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

          {/* Uma mensagem por vez, e a altura já está reservada: a mensagem
              que aparece não empurra o botão para baixo do dedo. */}
          <p role="alert" aria-live="polite" className="erro-entrada">
            {erro}
          </p>

          <button type="submit" disabled={enviando} className="btn">
            {enviando ? 'Entrando…' : 'Entrar no painel'}
          </button>
        </div>
      </form>
    </main>
  )
}
