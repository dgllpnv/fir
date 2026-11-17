'use client'

import { useEffect, useState } from 'react'
import type { ConfigDoAcesso, EuSaida } from '@fir/contracts'
import { SENHA_MIN, avaliarSenha, ehErro } from '@fir/domain'
import { CamposDoMeuEmail, useMeuEmail } from '@/components/meu-email'
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
  // `eu.usuario` é `null` na sessão de suporte do painel (D-13) — e lá esta
  // tela nem abre: `POST /v1/eu/senha` responde 403, porque não há pessoa de
  // quem a senha seja. O `?.` existe para o tipo, não para um caso de uso.
  const contexto = eu
    ? [eu.clinica.codigo, eu.clinica.nome, eu.usuario?.usuario ?? '', eu.usuario?.nome ?? '']
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
      <div className="caixa">
        <div className="marcabloco">
          <div className="marca">
            FIR Clinic<span>.</span>
          </div>
          <div className="eyebrow">Rotinas de gestão</div>
        </div>

        <form className="cartao" onSubmit={enviar}>
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
        </form>

        {/* O PRÓPRIO E-MAIL — só fora da provisória: com ela, o servidor recusa
            `/v1/eu/email` (a pessoa troca a senha primeiro), e oferecer o campo
            seria oferecer um erro. A sessão de suporte não tem pessoa. */}
        {eu?.usuario && !eu.usuario.senhaProvisoria ? <MeuEmail pessoa={eu.usuario} /> : null}

        {/* A ÚNICA saída lateral. Não há "pular" nem "depois". */}
        <button type="button" onClick={sair} className="btn ghost">
          Sair
        </button>
      </div>
    </main>
  )
}

/**
 * **E-mail** — cadastrar, trocar ou retirar o próprio (LGPD L8), sempre com a
 * senha atual (appsec 1). O confirmado continua valendo até o novo ser
 * confirmado: trocar não tira ninguém do caminho de entrada que já funciona.
 */
function MeuEmail({ pessoa }: { pessoa: NonNullable<EuSaida['usuario']> }) {
  const [envioDeEmail, setEnvioDeEmail] = useState<boolean | null>(null)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmado, setConfirmado] = useState(pessoa.email)
  const [pendente, setPendente] = useState(pessoa.emailPendente)
  const [retirando, setRetirando] = useState(false)
  const [recado, setRecado] = useState('')
  const { erros, enviando, enviar, limpar } = useMeuEmail()

  useEffect(() => {
    chamar<ConfigDoAcesso>('v1/acesso/config')
      .then((c) => setEnvioDeEmail(c.envioDeEmail))
      .catch(() => setEnvioDeEmail(false))
  }, [])

  const temAlgum = confirmado !== null || pendente !== null

  async function aoEnviar(e: React.FormEvent) {
    e.preventDefault()
    setRecado('')
    const r = await enviar(retirando ? null : email, senha)
    if (r === 'erro') return
    setSenha('')
    if (retirando) {
      setConfirmado(null)
      setPendente(null)
      setRetirando(false)
      setRecado('E-mail retirado. Você continua entrando pelo usuário.')
      return
    }
    setPendente(r.enviadoPara)
    setEmail('')
    setRecado(
      `Enviamos o link para ${r.enviadoPara ?? 'o e-mail informado'}. Confira sua caixa de entrada.`,
    )
  }

  return (
    <form className="cartao" onSubmit={aoEnviar} noValidate aria-labelledby="meu-email-titulo">
      <h2 className="titulo-de-acesso" id="meu-email-titulo">
        E-mail
      </h2>
      <dl className="meu-email-situacao">
        <div>
          <dt>Confirmado</dt>
          <dd>{confirmado ?? 'Nenhum'}</dd>
        </div>
        {pendente === null ? null : (
          <div>
            <dt>Esperando confirmação</dt>
            <dd>{pendente}</dd>
          </div>
        )}
      </dl>

      {retirando ? (
        <>
          <p className="nota">
            Sem e-mail, você entra só pelo usuário e, se esquecer a senha, pede à administradora.
          </p>
          <label className="campo">
            Senha atual
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              aria-invalid={erros.senha !== ''}
              aria-describedby="meu-email-erro-retirar"
            />
            <span id="meu-email-erro-retirar" className="erro" role="status" aria-live="polite">
              {erros.senha}
            </span>
          </label>
        </>
      ) : envioDeEmail === false ? (
        <p className="nota">O envio de e-mail ainda não está ligado nesta instalação.</p>
      ) : (
        <CamposDoMeuEmail
          id="meu-email"
          email={email}
          senha={senha}
          aoMudarEmail={setEmail}
          aoMudarSenha={setSenha}
          erros={erros}
          rotuloDoEmail={confirmado === null ? 'E-mail' : 'E-mail novo'}
        />
      )}

      {erros.geral === '' ? null : (
        <p className="erro" role="alert">
          {erros.geral}
        </p>
      )}
      {recado === '' ? null : (
        <p className="nota" role="status">
          {recado}
        </p>
      )}

      <div className="botoes">
        {retirando ? (
          <>
            <button type="submit" className="btn" disabled={enviando}>
              {enviando ? 'Retirando…' : 'Confirmar: retirar meu e-mail'}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                limpar()
                setRetirando(false)
              }}
            >
              Deixar como está
            </button>
          </>
        ) : (
          <>
            {envioDeEmail === false ? null : (
              <button type="submit" className="btn" disabled={enviando || envioDeEmail === null}>
                {enviando ? 'Enviando…' : 'Enviar confirmação'}
              </button>
            )}
            {temAlgum ? (
              <button
                type="button"
                className="link perigo"
                onClick={() => {
                  limpar()
                  setRecado('')
                  setRetirando(true)
                }}
              >
                Retirar meu e-mail
              </button>
            ) : null}
          </>
        )}
      </div>
    </form>
  )
}
