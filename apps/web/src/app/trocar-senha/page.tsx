'use client'

import { useEffect, useState } from 'react'
import type { EuSaida } from '@fir/contracts'
import { SENHA_MIN, avaliarSenha, ehErro } from '@fir/domain'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * **O primeiro acesso.**
 *
 * Fora do grupo `(app)` de propósito: a pessoa que chega aqui não tem acesso
 * a nenhuma rota de negócio (409 em todas), então a Shell não teria o que
 * mostrar — e `lib/sessao` desviaria para cá em laço.
 *
 * **Nenhum link de escape.** Não há "pular", não há "depois", não há menu. A
 * senha provisória foi gerada pelo servidor, ditada no balcão e anotada num
 * papel: ela é uma credencial compartilhada por construção, e a única coisa
 * que ela pode fazer é deixar de ser. A única saída lateral é "Sair".
 *
 * A REGRA APARECE ANTES DO ERRO. `avaliarSenha` é a MESMA função do servidor
 * (`packages/domain`), chamada no `onChange` — a tela não reimplementa regra
 * nenhuma, e o servidor continua sendo a autoridade. Mostrar só depois do
 * envio faz a pessoa tentar três vezes no balcão com o telefone tocando.
 */
export default function TrocarSenha() {
  const [eu, setEu] = useState<EuSaida | null>(null)
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [repetida, setRepetida] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    // `GET /v1/eu` é uma das três rotas que a senha provisória atravessa.
    chamar<EuSaida>('v1/eu')
      .then(setEu)
      .catch(() => {
        window.location.assign('/entrar')
      })
  }, [])

  /**
   * O contexto que a tela usa para AVISAR. O servidor monta o dele a partir
   * da sessão e é quem decide — este aqui existe para a pessoa não descobrir
   * o problema depois de apertar o botão.
   */
  const contexto = eu
    ? [eu.clinica.codigo, eu.clinica.nome, eu.usuario.usuario, eu.usuario.nome]
    : []
  const juizo = nova === '' ? null : avaliarSenha(nova, { contexto })
  const avisoDaRegra = juizo !== null && ehErro(juizo) ? juizo.erro.mensagem : ''
  const naoConfere = repetida !== '' && repetida !== nova
  const podeEnviar =
    atual !== '' && nova !== '' && avisoDaRegra === '' && repetida === nova && !enviando

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await chamar('v1/eu/senha', { method: 'POST', body: JSON.stringify({ atual, nova }) })
      // Recarga completa, e não `router.push`: a troca revoga as outras
      // sessões e muda o que o servidor devolve em toda rota.
      window.location.assign('/hoje')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
      setEnviando(false)
    }
  }

  async function sair() {
    await chamar('v1/sair', { method: 'POST' }).catch(() => undefined)
    window.location.assign('/entrar')
  }

  return (
    <main className="entrada">
      <form className="caixa" onSubmit={enviar}>
        <div className="marcabloco">
          <div className="marca">
            Firmare<span>.</span>
          </div>
          <div className="eyebrow">Gestão de Rotina</div>
        </div>

        <div className="cartao">
          <p className="aviso-primeiro-acesso">
            Esta senha foi criada por outra pessoa e vale só para o primeiro acesso. Escolha agora
            uma senha que só você saiba — as outras sessões desta conta serão encerradas.
          </p>

          <label className="campo">
            Senha atual
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
            <input
              type="password"
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              autoComplete="new-password"
              required
            />
            <small>
              Pelo menos {SENHA_MIN} caracteres. Pode ser uma frase — não precisa de símbolo nem de
              número. Não use o nome da clínica nem o seu.
            </small>
            {/* A altura fica reservada: o aviso que aparece a cada tecla não
                pode empurrar o campo seguinte para baixo do dedo. */}
            <span className="erro" role="status" aria-live="polite" style={{ minHeight: 16 }}>
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
            <span className="erro" role="status" aria-live="polite" style={{ minHeight: 16 }}>
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

        {/* A ÚNICA saída lateral. Não há "pular" nem "depois". */}
        <button type="button" onClick={sair} className="btn ghost">
          Sair
        </button>
      </form>
    </main>
  )
}
