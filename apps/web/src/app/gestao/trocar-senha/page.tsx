'use client'

import type { PainelEuSaida } from '@fir/contracts'
import { SENHA_MIN, avaliarSenha, ehErro } from '@fir/domain'
import { useEffect, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { ICONE_OLHO_ABERTO, ICONE_OLHO_FECHADO } from '@/lib/icones'

/**
 * **A saída da provisória do operador — e ela não existia.**
 *
 * `POST /v1/superadmin/eu/senha` está na API desde o épico 12, com o comentário
 * que explica por quê: *"sem ela, o primeiro operador nasceria com uma
 * credencial que vence em 72 h e sem caminho para trocá-la — o painel ficaria
 * trancado três dias depois de ser aberto"*. **A rota existia; a tela, não.**
 *
 * O efeito medido: `redefinir-superadmin.sh` (a saída de emergência da VPS, e
 * o único jeito de criar o primeiro operador) cria a senha **provisória**. O
 * `PainelGuard` então recusa todas as rotas do painel com 409
 * `SENHA_PROVISORIA_OPERADOR`, menos três. Quem entrava caía na lista de
 * clínicas com um aviso vermelho dizendo "troque a senha provisória antes de
 * continuar" e **nenhum lugar onde trocá-la** — erro sem saída, que
 * `docs/design.md` §4 proíbe.
 *
 * Quem desvia para cá é o `ProvedorDoPainel`, que lê `senhaProvisoria` de
 * `GET /v1/superadmin/eu` — uma das três rotas que a provisória atravessa.
 *
 * **Nenhum link de escape**, como no primeiro acesso do produto: a provisória
 * foi ditada por telefone, é credencial compartilhada por construção, e a
 * única coisa que ela pode fazer é deixar de ser. A única saída lateral é
 * "Sair".
 */
export default function TrocarSenhaDoOperador() {
  const [eu, setEu] = useState<PainelEuSaida | null>(null)
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [repetida, setRepetida] = useState('')
  const [senhaVisivel, setSenhaVisivel] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    chamar<PainelEuSaida>('v1/superadmin/eu')
      .then(setEu)
      .catch(() => {
        window.location.assign('/gestao/entrar')
      })
  }, [])

  /**
   * O contexto que a tela usa para AVISAR, com a MESMA função do servidor
   * (`avaliarSenha`, de `packages/domain`). A tela não reimplementa regra
   * nenhuma — ela adianta a recusa para a pessoa não descobrir depois de
   * apertar o botão.
   */
  const contexto = eu === null ? [] : [eu.operador.usuario, eu.operador.nome, 'firmare', 'painel']
  const juizo = nova === '' ? null : avaliarSenha(nova, { contexto })
  const avisoDaRegra = juizo !== null && ehErro(juizo) ? juizo.erro.mensagem : ''
  const naoConfere = repetida !== '' && repetida !== nova
  const podeEnviar =
    atual !== '' && nova !== '' && avisoDaRegra === '' && repetida === nova && !enviando

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setSenhaVisivel(false)
    setEnviando(true)
    try {
      await chamar('v1/superadmin/eu/senha', {
        method: 'POST',
        body: JSON.stringify({ atual, nova }),
      })
      // Recarga completa, e não navegação do cliente: a troca revoga as outras
      // sessões de operador e muda o que o servidor devolve em toda rota.
      // A Visão geral pede a sessão da conta de gestão, que o login não abriu
      // enquanto a senha era provisória (ADR 0024).
      window.location.assign('/gestao')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
      setEnviando(false)
    }
  }

  async function sair() {
    await chamar('v1/superadmin/sair', { method: 'POST' }).catch(() => undefined)
    window.location.assign('/gestao/entrar')
  }

  return (
    <main className="entrada">
      <form className="caixa" onSubmit={enviar}>
        <div className="superadmin-porta">
          <span className="selo">Painel interno</span>
          <div className="marca">
            Firmare<span>.</span>
          </div>
        </div>

        <div className="cartao">
          <p className="aviso-primeiro-acesso">
            A senha atual foi gerada na VPS e ditada — ela vale só para esta troca. Escolha agora
            uma que só você saiba: as outras sessões do painel serão encerradas.
          </p>

          <label className="campo">
            Senha atual (a da VPS)
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
              número. Não use o seu usuário nem o nome do produto.
            </small>
            {/* A altura fica reservada: o aviso que aparece a cada tecla não
                empurra o campo seguinte para baixo do dedo. */}
            <span className="erro erro-reservado" role="status" aria-live="polite">
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
            <span className="erro erro-reservado" role="status" aria-live="polite">
              {naoConfere ? 'As duas senhas não são iguais.' : ''}
            </span>
          </label>

          <p role="alert" aria-live="polite" className="erro-entrada">
            {erro}
          </p>

          <button type="submit" disabled={!podeEnviar} className="btn">
            {enviando ? 'Trocando…' : 'Trocar a senha do painel'}
          </button>
        </div>

        {/* A ÚNICA saída lateral. Não há "pular" nem "depois". */}
        <button type="button" onClick={() => void sair()} className="btn ghost">
          Sair
        </button>
      </form>
    </main>
  )
}
