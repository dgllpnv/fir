'use client'

import { useEffect, useState } from 'react'
import type { LinkConsultado } from '@fir/contracts'
import { SENHA_MIN, avaliarSenha, ehErro } from '@fir/domain'
import { MolduraDeAcesso } from '@/components/moldura-de-acesso'
import { chamar, ErroDaApi } from '@/lib/api'
import { ICONE_OLHO_ABERTO, ICONE_OLHO_FECHADO } from '@/lib/icones'
import { entrarNaClinica, lerEApagarToken } from '@/lib/link-de-acesso'

/**
 * **`/criar-senha#t=…`** — o convite (7 dias) e a redefinição (1 hora).
 *
 * Três regras de segurança moram nesta tela, e nenhuma é decoração:
 *
 *  - o token sai da barra **antes de qualquer outra coisa** (`lerEApagarToken`,
 *    appsec 15) e nunca vai para a query string;
 *  - abrir a tela só CONSULTA o link (appsec 16): os leitores de link dos
 *    provedores de e-mail abrem a página antes da pessoa, e não podem queimar o
 *    convite. Quem consome é o botão;
 *  - usar o link **não abre sessão** (appsec 8). Depois de criar a senha a
 *    pessoa entra pela tela de entrada, como qualquer outra vez.
 */
type Estado =
  | { tipo: 'lendo' }
  | { tipo: 'invalido' }
  | { tipo: 'falhou'; mensagem: string }
  | { tipo: 'pronto'; link: LinkConsultado }
  | { tipo: 'feito'; clinicaCodigo: string }

const FRASE_INVALIDO =
  'Este link não vale mais. Peça um novo na tela de entrada ou à administradora.'

export default function CriarSenha() {
  const [token, setToken] = useState<string | null>(null)
  const [estado, setEstado] = useState<Estado>({ tipo: 'lendo' })
  const [tentativa, setTentativa] = useState(0)

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
        // O link de CONFIRMAÇÃO aberto aqui por engano vai para a tela dele. O
        // fragmento não chega a servidor nenhum, e a outra tela o apaga de novo.
        if (link.finalidade === 'confirmacao_de_email') {
          window.location.replace(`/confirmar-email#t=${token}`)
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

  return (
    <MolduraDeAcesso>
      {estado.tipo === 'lendo' ? (
        <div className="cartao" aria-busy="true">
          <p className="nota">Abrindo o link…</p>
        </div>
      ) : estado.tipo === 'invalido' ? (
        <LinkQueNaoVale />
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
          <h1 className="titulo-de-acesso">Senha criada.</h1>
          <p className="nota" role="status">
            Agora entre com seu e-mail ou usuário.
          </p>
          <a className="btn" href={entrarNaClinica(estado.clinicaCodigo)}>
            Entrar
          </a>
        </div>
      ) : token === null ? null : (
        <FormularioDaSenha
          link={estado.link}
          token={token}
          aoInvalidar={() => setEstado({ tipo: 'invalido' })}
          aoCriar={() => setEstado({ tipo: 'feito', clinicaCodigo: estado.link.clinicaCodigo })}
        />
      )}
    </MolduraDeAcesso>
  )
}

function LinkQueNaoVale() {
  return (
    <div className="cartao">
      <p className="aviso-de-sessao" role="alert">
        {FRASE_INVALIDO}
      </p>
      <a className="btn ghost" href="/entrar">
        Ir para a entrada
      </a>
    </div>
  )
}

function FormularioDaSenha({
  link,
  token,
  aoInvalidar,
  aoCriar,
}: {
  link: LinkConsultado
  token: string
  aoInvalidar: () => void
  aoCriar: () => void
}) {
  const [senha, setSenha] = useState('')
  const [repetida, setRepetida] = useState('')
  const [visivel, setVisivel] = useState(false)
  const [erroDaSenha, setErroDaSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  /**
   * A MESMA regra do servidor (`avaliarSenha`), para AVISAR antes do botão —
   * o servidor monta o contexto dele e é quem decide. É o que `/trocar-senha`
   * faz.
   */
  const contexto = [link.clinicaCodigo, link.clinicaNome, link.usuario, link.primeiroNome, link.email]
  const juizo = senha === '' ? null : avaliarSenha(senha, { contexto })
  const avisoDaRegra = juizo !== null && ehErro(juizo) ? juizo.erro.mensagem : ''
  const naoConfere = repetida !== '' && repetida !== senha
  const podeEnviar = senha !== '' && avisoDaRegra === '' && repetida === senha && !enviando

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setErroDaSenha('')
    setVisivel(false)
    setEnviando(true)
    try {
      await chamar('v1/link-de-acesso/usar', { method: 'POST', body: JSON.stringify({ token, senha }) })
      aoCriar()
    } catch (x) {
      if (x instanceof ErroDaApi && x.status === 410) {
        aoInvalidar()
        return
      }
      const mensagem = x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.'
      // 422 é a regra da senha: a frase vai para debaixo do campo, que é onde
      // está o que precisa mudar.
      if (x instanceof ErroDaApi && x.status === 422) setErroDaSenha(mensagem)
      else setErro(mensagem)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="cartao" onSubmit={enviar} noValidate>
      <div className="cabeca-de-acesso">
        <h1 className="titulo-de-acesso">
          {link.finalidade === 'convite' ? 'Crie sua senha' : 'Crie uma senha nova'}
        </h1>
        <p className="nota">
          Clínica <b>{link.clinicaNome}</b> · usuário <b className="num">{link.usuario}</b>
        </p>
      </div>

      {/* O campo de usuário escondido é para o gerenciador de senhas do
          aparelho guardar o par certo, e não só a senha solta. */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={link.usuario}
        readOnly
        hidden
      />

      <label className="campo">
        Senha
        <span className="campo-com-botao">
          <input
            type={visivel ? 'text' : 'password'}
            value={senha}
            onChange={(e) => {
              setSenha(e.target.value)
              setErroDaSenha('')
            }}
            autoComplete="new-password"
            aria-describedby="regra-da-senha aviso-da-senha"
            aria-invalid={avisoDaRegra !== '' || erroDaSenha !== ''}
            required
            autoFocus
          />
          <button
            type="button"
            tabIndex={-1}
            className="olho"
            aria-label={visivel ? 'Esconder a senha' : 'Mostrar a senha'}
            aria-pressed={visivel}
            onClick={() => setVisivel((v) => !v)}
          >
            {visivel ? ICONE_OLHO_FECHADO : ICONE_OLHO_ABERTO}
          </button>
        </span>
        <small id="regra-da-senha">
          Pelo menos {SENHA_MIN} caracteres. Pode ser uma frase — não precisa de símbolo nem de
          número. Não use o nome da clínica nem o seu.
        </small>
        <span id="aviso-da-senha" className="erro" role="status" aria-live="polite" style={{ minHeight: 16 }}>
          {erroDaSenha || avisoDaRegra}
        </span>
      </label>

      <label className="campo">
        Repetir a senha
        <input
          type={visivel ? 'text' : 'password'}
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
          autoComplete="new-password"
          aria-invalid={naoConfere}
          required
        />
        <span className="erro" role="status" aria-live="polite" style={{ minHeight: 16 }}>
          {naoConfere ? 'As duas senhas não são iguais.' : ''}
        </span>
      </label>

      <p role="alert" aria-live="polite" className="erro-entrada">
        {erro}
      </p>

      <button type="submit" className="btn" disabled={!podeEnviar}>
        {enviando ? 'Salvando…' : 'Salvar a senha'}
      </button>
    </form>
  )
}
