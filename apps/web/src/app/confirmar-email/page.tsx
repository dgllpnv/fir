'use client'

import { useEffect, useState } from 'react'
import type { LinkConsultado } from '@fir/contracts'
import { MolduraDeAcesso } from '@/components/moldura-de-acesso'
import { chamar, ErroDaApi } from '@/lib/api'
import { entrarNaClinica, lerEApagarToken } from '@/lib/link-de-acesso'

/**
 * **`/confirmar-email#t=…`** — o link de 24 horas que prova que a caixa de
 * entrada é da pessoa.
 *
 * As mesmas três regras de `/criar-senha`: o token sai da barra antes de tudo,
 * abrir só CONSULTA (o leitor de link do provedor de e-mail abre a página antes
 * da pessoa e não pode queimar a confirmação), e quem consome é o botão
 * **Confirmar e-mail**. Confirmar não abre sessão.
 */
type Estado =
  | { tipo: 'lendo' }
  | { tipo: 'invalido' }
  | { tipo: 'falhou'; mensagem: string }
  | { tipo: 'pronto'; link: LinkConsultado }
  | { tipo: 'feito'; clinicaCodigo: string }

export default function ConfirmarEmail() {
  const [token, setToken] = useState<string | null>(null)
  const [estado, setEstado] = useState<Estado>({ tipo: 'lendo' })
  const [tentativa, setTentativa] = useState(0)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    const t = lerEApagarToken()
    setToken(t)
    if (t === null) setEstado({ tipo: 'invalido' })
  }, [])

  useEffect(() => {
    if (token === null) return
    let valeu = true
    setEstado({ tipo: 'lendo' })
    chamar<LinkConsultado>('v1/link-de-acesso/consultar', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((link) => {
        if (!valeu) return
        // Convite ou redefinição abertos aqui por engano vão para a tela deles.
        if (link.finalidade !== 'confirmacao_de_email') {
          window.location.replace(`/criar-senha#t=${token}`)
          return
        }
        setEstado({ tipo: 'pronto', link })
      })
      .catch((x: unknown) => {
        if (!valeu) return
        if (x instanceof ErroDaApi && x.status === 410) setEstado({ tipo: 'invalido' })
        else
          setEstado({
            tipo: 'falhou',
            mensagem: x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.',
          })
      })
    return () => {
      valeu = false
    }
  }, [token, tentativa])

  async function confirmar(e: React.FormEvent) {
    e.preventDefault()
    if (token === null || estado.tipo !== 'pronto') return
    const { clinicaCodigo } = estado.link
    setErro('')
    setEnviando(true)
    try {
      await chamar('v1/link-de-acesso/usar', { method: 'POST', body: JSON.stringify({ token }) })
      setEstado({ tipo: 'feito', clinicaCodigo })
    } catch (x) {
      if (x instanceof ErroDaApi && x.status === 410) setEstado({ tipo: 'invalido' })
      else setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <MolduraDeAcesso>
      {estado.tipo === 'lendo' ? (
        <div className="cartao" aria-busy="true">
          <p className="nota">Abrindo o link…</p>
        </div>
      ) : estado.tipo === 'invalido' ? (
        <div className="cartao">
          <p className="aviso-de-sessao" role="alert">
            Este link não vale mais. Peça um novo na tela de entrada ou à administradora.
          </p>
          <a className="btn ghost" href="/entrar">
            Ir para a entrada
          </a>
        </div>
      ) : estado.tipo === 'falhou' ? (
        <div className="cartao">
          <p className="erro-entrada" role="alert">
            {estado.mensagem}
          </p>
          <button type="button" className="btn" onClick={() => setTentativa((n) => n + 1)}>
            Tentar de novo
          </button>
        </div>
      ) : estado.tipo === 'feito' ? (
        <div className="cartao">
          <h1 className="titulo-de-acesso">E-mail confirmado.</h1>
          <p className="nota" role="status">
            Daqui em diante você pode entrar por ele e redefinir a senha sozinha.
          </p>
          <a className="btn" href={entrarNaClinica(estado.clinicaCodigo)}>
            Entrar
          </a>
        </div>
      ) : (
        <form className="cartao" onSubmit={confirmar}>
          <div className="cabeca-de-acesso">
            <h1 className="titulo-de-acesso">Confirme seu e-mail</h1>
            <p className="nota">
              Clínica <b>{estado.link.clinicaNome}</b> · usuário{' '}
              <b className="num">{estado.link.usuario}</b>
            </p>
          </div>
          <div className="email-a-confirmar">
            <div className="eyebrow">E-mail</div>
            <b>{estado.link.email}</b>
          </div>
          <p role="alert" aria-live="polite" className="erro-entrada">
            {erro}
          </p>
          <button type="submit" className="btn" disabled={enviando}>
            {enviando ? 'Confirmando…' : 'Confirmar e-mail'}
          </button>
        </form>
      )}
    </MolduraDeAcesso>
  )
}
