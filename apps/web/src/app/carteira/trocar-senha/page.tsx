'use client'

import type { CarteiraEuSaida } from '@fir/contracts'
import { SENHA_MIN, avaliarSenha, ehErro } from '@fir/domain'
import { useEffect, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { ICONE_OLHO_ABERTO, ICONE_OLHO_FECHADO } from '@/lib/icones'

/**
 * A TROCA DE SENHA DO `Usuário de Gestão` — e ela não existia.
 *
 * O usuário nasce com a provisória que o superadmin gerou (72 h), o login a
 * recusa vencida, e não havia rota nem tela para trocá-la: três dias depois de
 * criado, ficava trancado para sempre (defeito de produção, 2026-11-08).
 *
 * Espelho de `gestao/trocar-senha`: a mesma caixa centrada, a mesma regra
 * (`avaliarSenha`, de `packages/domain`, a MESMA função do servidor, com o
 * mesmo contexto: usuário e nome), o mesmo aviso que reserva altura.
 *
 * Duas entradas, uma tela:
 *  - **obrigatória** — o `ProvedorDaCarteira` desvia para cá quando
 *    `GET /v1/carteira/eu` diz `senhaProvisoria`. Sem link de escape: a
 *    provisória foi repassada por outra pessoa, e a única saída lateral é Sair.
 *  - **voluntária** — o link "Trocar senha" da faixa. Aqui há "Voltar".
 */
export default function TrocarSenhaDaCarteira() {
  const [eu, setEu] = useState<CarteiraEuSaida | null>(null)
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [repetida, setRepetida] = useState('')
  const [senhaVisivel, setSenhaVisivel] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    chamar<CarteiraEuSaida>('v1/carteira/eu')
      .then(setEu)
      .catch(() => {
        window.location.assign('/carteira/entrar')
      })
  }, [])

  const provisoria = eu?.usuarioDeGestao.senhaProvisoria ?? true
  const contexto = eu === null ? [] : [eu.usuarioDeGestao.usuario, eu.usuarioDeGestao.nome]
  const juizo = nova === '' ? null : avaliarSenha(nova, { contexto })
  const avisoDaRegra = juizo !== null && ehErro(juizo) ? juizo.erro.mensagem : ''
  const naoConfere = repetida !== '' && repetida !== nova
  const podeEnviar =
    eu !== null && atual !== '' && nova !== '' && avisoDaRegra === '' && repetida === nova && !enviando

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setSenhaVisivel(false)
    setEnviando(true)
    try {
      await chamar('v1/carteira/eu/senha', {
        method: 'POST',
        body: JSON.stringify({ atual, nova }),
      })
      // Recarga completa: a troca revoga as outras sessões e muda o que o
      // servidor devolve em toda rota da carteira.
      window.location.assign('/carteira/clientes')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
      setEnviando(false)
    }
  }

  async function sair() {
    await chamar('v1/carteira/sair', { method: 'POST' }).catch(() => undefined)
    window.location.assign('/carteira/entrar')
  }

  return (
    <main className="entrada">
      <form className="caixa" onSubmit={enviar}>
        <div className="carteira-porta">
          <span className="carteira-selo">Carteira comercial</span>
          <div className="marca">
            Firmare<span>.</span>
          </div>
        </div>

        <div className="cartao">
          <p className="aviso-primeiro-acesso">
            {provisoria
              ? 'A senha atual é provisória — ela vale só para esta troca. Escolha agora uma que só você saiba: as outras sessões da carteira serão encerradas.'
              : 'Escolha uma senha nova que só você saiba. As outras sessões da carteira serão encerradas; esta continua aberta.'}
          </p>

          <label className="campo">
            {provisoria ? 'Senha atual (a provisória)' : 'Senha atual'}
            <input
              type="password"
              value={atual}
              onChange={(e) => setAtual(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <label className="campo">
            Nova senha
            <span className="campo-com-botao">
              <input
                type={senhaVisivel ? 'text' : 'password'}
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                autoComplete="new-password"
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
            <small>
              Pelo menos {SENHA_MIN} caracteres. Pode ser uma frase — não precisa de símbolo nem de
              número. Não use o seu usuário nem o seu nome.
            </small>
            {/* A altura fica reservada: o aviso que aparece a cada tecla não
                empurra o campo seguinte para baixo do dedo. */}
            <span className="erro carteira-erro-reservado" role="status" aria-live="polite">
              {avisoDaRegra}
            </span>
          </label>

          <label className="campo">
            Repita a nova senha
            <input
              type="password"
              value={repetida}
              onChange={(e) => setRepetida(e.target.value)}
              autoComplete="new-password"
              required
            />
            <span className="erro carteira-erro-reservado" role="status" aria-live="polite">
              {naoConfere ? 'As duas senhas não são iguais.' : ''}
            </span>
          </label>

          <p role="alert" aria-live="polite" className="erro-entrada">
            {erro}
          </p>

          <button type="submit" disabled={!podeEnviar} className="btn">
            {enviando ? 'Trocando…' : 'Trocar a senha'}
          </button>
        </div>

        {provisoria ? (
          // A ÚNICA saída lateral da provisória. Não há "pular" nem "depois".
          <button type="button" onClick={() => void sair()} className="btn ghost">
            Sair
          </button>
        ) : (
          <a className="btn ghost" href="/carteira/clientes">
            Voltar
          </a>
        )}
      </form>
    </main>
  )
}
