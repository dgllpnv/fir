'use client'

import type { PortalEuSaida } from '@fir/contracts'
import { SENHA_MIN, avaliarSenha, ehErro } from '@fir/domain'
import { useEffect, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { ICONE_OLHO_ABERTO, ICONE_OLHO_FECHADO } from '@/lib/icones'

/**
 * A TROCA DE SENHA DO `Usuário do portal` — e ela não existia.
 *
 * O usuário nasce com a provisória que a Firmare gerou (72 h), o login a
 * recusa vencida, e não havia rota nem tela para trocá-la: três dias depois de
 * criado, ficava trancado para sempre (defeito de produção, 2026-11-08).
 *
 * Espelho de `carteira/trocar-senha` e `gestao/trocar-senha`: a mesma
 * caixa centrada, a mesma regra
 * (`avaliarSenha`, de `packages/domain`, a MESMA função do servidor, com o
 * mesmo contexto: usuário e nome), o mesmo aviso que reserva altura.
 *
 * Duas entradas, uma tela:
 *  - **obrigatória** — o `ProvedorDoPortal` desvia para cá quando
 *    `GET /v1/portal/eu` diz `senhaProvisoria`. Sem link de escape: a
 *    provisória foi repassada por outra pessoa, e a única saída lateral é Sair.
 *  - **voluntária** — o link "Trocar senha" da faixa. Aqui há "Voltar".
 */
export default function TrocarSenhaDoPortal() {
  const [eu, setEu] = useState<PortalEuSaida | null>(null)
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [repetida, setRepetida] = useState('')
  const [senhaVisivel, setSenhaVisivel] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    chamar<PortalEuSaida>('v1/portal/eu')
      .then(setEu)
      .catch(() => {
        window.location.assign('/portal/entrar')
      })
  }, [])

  const provisoria = eu?.usuarioDoPortal.senhaProvisoria ?? true
  const contexto = eu === null ? [] : [eu.usuarioDoPortal.usuario, eu.usuarioDoPortal.nome]
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
      await chamar('v1/portal/eu/senha', {
        method: 'POST',
        body: JSON.stringify({ atual, nova }),
      })
      // Recarga completa: a troca revoga as outras sessões e muda o que o
      // servidor devolve em toda rota do portal.
      window.location.assign('/portal/clientes')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
      setEnviando(false)
    }
  }

  async function sair() {
    await chamar('v1/portal/sair', { method: 'POST' }).catch(() => undefined)
    window.location.assign('/portal/entrar')
  }

  return (
    <main className="entrada">
      <form className="caixa" onSubmit={enviar}>
        <div className="portal-porta">
          <span className="portal-selo">Portal do grupo</span>
          <div className="marca">
            Firmare<span>.</span>
          </div>
        </div>

        <div className="cartao">
          <p className="aviso-primeiro-acesso">
            {provisoria
              ? 'A senha atual é provisória — ela vale só para esta troca. Escolha agora uma que só você saiba: as outras sessões do portal serão encerradas.'
              : 'Escolha uma senha nova que só você saiba. As outras sessões do portal serão encerradas; esta continua aberta.'}
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
            <span className="erro portal-erro-reservado" role="status" aria-live="polite">
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
            <span className="erro portal-erro-reservado" role="status" aria-live="polite">
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
          <a className="btn ghost" href="/portal/clientes">
            Voltar
          </a>
        )}
      </form>
    </main>
  )
}
