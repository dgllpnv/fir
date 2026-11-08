'use client'

import type { AvisoDeRecuperacao, EntrarNaCarteiraSaida } from '@fir/contracts'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { ICONE_OLHO_ABERTO, ICONE_OLHO_FECHADO } from '@/lib/icones'
import { destinoDepoisDeEntrar, formatarQuando } from '../segundo-fator/destino'

/**
 * Entrar na carteira comercial. Mesma forma da entrada do painel — dois
 * campos, a caixa centrada do produto, e a porta diz claramente que é a
 * porta da carteira, não a da clínica nem a do superadmin.
 *
 * Sem campo de clínica: o Usuário de Gestão não pertence a clínica nenhuma
 * (mesma razão do Operador) — o servidor recusa o campo com 400 se vier.
 *
 * DUAS ETAPAS (G8 0.6, appsec A-12, ADR 0022): com o app autenticador já
 * cadastrado, a senha certa não abre a carteira — abre a pergunta do código.
 * O desafio vive num cookie do servidor por 5 min; esta tela só guarda em
 * que etapa está. Sem "lembrar este aparelho" (A-12, primeira versão).
 */
type Etapa = 'senha' | 'codigo' | 'aviso'

export default function EntrarNaCarteira() {
  const router = useRouter()
  const [etapa, setEtapa] = useState<Etapa>('senha')
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [senhaVisivel, setSenhaVisivel] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [porRecuperacao, setPorRecuperacao] = useState(false)
  const [aviso, setAviso] = useState<AvisoDeRecuperacao | null>(null)
  const [destino, setDestino] = useState('/carteira')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  function seguir(r: Exclude<EntrarNaCarteiraSaida, { segundoFatorExigido: true }>) {
    const para = destinoDepoisDeEntrar(r)
    if (r.avisoDeRecuperacao) {
      // Um código de recuperação foi usado: a pessoa VÊ isso antes de entrar.
      setAviso(r.avisoDeRecuperacao)
      setDestino(para)
      setEtapa('aviso')
      return
    }
    router.push(para)
  }

  async function enviarSenha(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setSenhaVisivel(false)
    setEnviando(true)
    try {
      const r = await chamar<EntrarNaCarteiraSaida>('v1/carteira/entrar', {
        method: 'POST',
        body: JSON.stringify({ usuario, senha }),
      })
      if ('segundoFatorExigido' in r) {
        setSenha('')
        setCodigo('')
        setEtapa('codigo')
        return
      }
      seguir(r)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  async function enviarCodigo(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<EntrarNaCarteiraSaida>('v1/carteira/entrar', {
        method: 'POST',
        body: JSON.stringify(porRecuperacao ? { codigoDeRecuperacao: codigo } : { codigo }),
      })
      if ('segundoFatorExigido' in r) return
      seguir(r)
    } catch (x) {
      if (x instanceof ErroDaApi && x.codigo === 'DESAFIO_DA_CARTEIRA_INVALIDO') {
        // Venceu, ou cinco erros: de volta à senha, com a frase do servidor.
        setEtapa('senha')
        setCodigo('')
      }
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="entrada">
      <div className="caixa">
        <div className="carteira-porta">
          <span className="carteira-selo">Carteira comercial</span>
          <div className="marca">
            Firmare<span>.</span>
          </div>
          {etapa === 'senha' ? (
            <p className="nota">
              Acompanhamento das clínicas da sua carteira. <b>Não é a entrada da clínica</b> — para
              entrar numa, use <a className="link" href="/entrar">o endereço dela</a>.
            </p>
          ) : null}
        </div>

        {etapa === 'senha' ? (
          <form className="cartao" onSubmit={enviarSenha}>
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
          </form>
        ) : null}

        {etapa === 'codigo' ? (
          <form className="cartao" onSubmit={enviarCodigo}>
            <p className="carteira-2fa-passo">Verificação em duas etapas</p>
            <p className="aviso-primeiro-acesso">
              {porRecuperacao
                ? 'Digite um dos códigos de recuperação que você guardou. Cada um vale uma vez.'
                : 'Abra o app autenticador no celular e digite o código de seis dígitos da Firmare Carteira.'}
            </p>
            <label className="campo">
              {porRecuperacao ? 'Código de recuperação' : 'Código'}
              <input
                className={porRecuperacao ? undefined : 'carteira-2fa-entrada-codigo'}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                inputMode={porRecuperacao ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                autoCapitalize={porRecuperacao ? 'characters' : 'off'}
                autoCorrect="off"
                spellCheck={false}
                maxLength={porRecuperacao ? 16 : 7}
                autoFocus
                required
              />
            </label>

            <p role="alert" aria-live="polite" className="erro-entrada">
              {erro}
            </p>

            <button type="submit" disabled={enviando} className="btn">
              {enviando ? 'Conferindo…' : 'Entrar'}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setPorRecuperacao((v) => !v)
                setCodigo('')
                setErro('')
              }}
            >
              {porRecuperacao ? 'Usar o código do app' : 'Perdi o celular — usar um código de recuperação'}
            </button>
          </form>
        ) : null}

        {etapa === 'aviso' && aviso ? (
          <div className="cartao">
            <p className="carteira-2fa-aviso" role="alert">
              Um código de recuperação foi usado para entrar nesta conta em {formatarQuando(aviso.usadoEm)}.
              Restam {aviso.codigosRestantes}. Se não foi você, avise o superadmin agora e troque a senha.
            </p>
            <div className="carteira-2fa-acoes">
              <a className="btn ghost" href="/carteira/segundo-fator">
                Gerar códigos novos
              </a>
              <button type="button" className="btn" onClick={() => router.push(destino)}>
                Continuar
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}
