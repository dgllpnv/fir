'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
/* O olho mora em `lib/icones` desde que a entrada do PAINEL passou a usar o
   mesmo: duas cópias do mesmo traço divergem na primeira correção. */
import { ICONE_OLHO_ABERTO, ICONE_OLHO_FECHADO } from '@/lib/icones'
import { clinicaGuardada, lembrarClinica, resolverClinica } from '@/lib/clinica-do-link'

/**
 * A tela de entrada — e **a clínica vem do LINK**.
 *
 * `/entrar?clinica=raphaella` pré-seleciona a clínica: a recepcionista abre o
 * favorito dela e só digita usuário e senha. É como as quatro clínicas em uso
 * já entram hoje (`GUIA-INSTALACAO.md` da v20: cada clínica tem o próprio
 * endereço), e é o que o protótipo faz.
 *
 * **Não há lista de clínicas aqui, e não vai haver** (D-12). Um menu com as
 * clínicas cadastradas exigiria uma rota que responde antes de qualquer
 * autenticação — ela publicaria a lista de clientes do produto e tiraria um
 * dos dois desconhecidos da credencial, que hoje é clínica + usuário + senha.
 * Quem não tem o link digita o código, como antes. O seletor com a lista mora
 * no painel do superadmin, que é autenticado e atrás da allowlist de IP.
 */
export default function Entrar() {
  const [clinica, setClinica] = useState('')
  /**
   * `true` quando a clínica veio do link ou da memória do aparelho — e aí o
   * campo fica **recolhido** (`docs/design.md` §1: campo raro fica
   * recolhido). Com o link, a clínica está resolvida; o caso raro é o link
   * errado, e ele fica atrás de "Trocar".
   */
  const [doLink, setDoLink] = useState(false)
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  /**
   * Mostrar a senha digitada.
   *
   * **Por que isto existe num produto que guarda dado de saúde:** a senha aqui
   * é gerada pelo servidor — quatro palavras ditáveis por telefone, como
   * `candeia-arrecife-pilao-37`. Digitar isso às cegas e errar uma letra
   * consome uma das cinco tentativas por 15 minutos, e a pessoa é barrada sem
   * ter esquecido nada. Ver o que se digitou é o que torna a senha longa
   * usável no balcão.
   *
   * **Nasce escondida, e volta a esconder a cada tentativa** (ver `entrar`):
   * no computador compartilhado da recepção, deixar a senha revelada depois
   * de uma tentativa falha é expô-la para quem chegar em seguida.
   */
  const [senhaVisivel, setSenhaVisivel] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const campoUsuario = useRef<HTMLInputElement>(null)
  const campoClinica = useRef<HTMLInputElement>(null)

  /**
   * A clínica é resolvida DEPOIS da montagem, e não num inicializador.
   *
   * `location.search` e `localStorage` não existem no servidor, e esta página
   * é pré-renderizada: um inicializador que lesse os dois produziria HTML
   * diferente do primeiro render do cliente — erro de hidratação. O custo é
   * um quadro com o campo vazio, e ele não desloca nada: as duas formas do
   * campo (aberto e recolhido) têm a mesma altura, cobrada em `shell.css`.
   *
   * Sem `useSearchParams`: ele força a página inteira a uma fronteira
   * `Suspense` no build estático, e aí o formulário sai do HTML pré-renderizado
   * — preço alto para ler um parâmetro uma vez, na montagem.
   */
  useEffect(() => {
    const r = resolverClinica(window.location.search, clinicaGuardada())
    setClinica(r.codigo)
    const recolher = r.origem !== 'padrao'
    setDoLink(recolher)
    // Zero digitação para quem tem o link: o foco já nasce no usuário.
    if (recolher) campoUsuario.current?.focus()
  }, [])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    // Volta a esconder a cada tentativa: no computador compartilhado do

    // balcão, senha revelada depois de uma falha fica exposta para quem

    // chegar em seguida.

    setSenhaVisivel(false)
    setEnviando(true)
    try {
      await chamar('v1/entrar', {
        method: 'POST',
        body: JSON.stringify({ clinica, usuario, senha }),
      })
      /**
       * Lembra a clínica **só depois de entrar**, nunca ao ler o parâmetro.
       *
       * É o que o MANUAL promete ("depois do primeiro acesso, o aparelho
       * lembra a clínica") com uma falha a menos: gravar o parâmetro na
       * chegada guardaria para sempre o código de um link digitado errado, e
       * a tela passaria a abrir sozinha numa clínica que não existe.
       */
      lembrarClinica(clinica)
      window.location.assign('/hoje')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    // `.entrada` centra nos DOIS eixos. Antes o formulário nascia colado no
    // topo de uma tela de 820 px, com setecentos pixels de vazio embaixo.
    <main className="entrada">
      <form className="caixa" onSubmit={enviar}>
        <div className="marcabloco">
          <div className="marca">
            FIR Clinic<span>.</span>
          </div>
          <div className="eyebrow">Rotinas de gestão</div>
        </div>

        <div className="cartao">
          <Suspense fallback={null}>
            <AvisoDeSessaoEncerrada />
          </Suspense>
          {doLink ? (
            /* A clínica já está resolvida. Ela continua visível — quem entra
               precisa saber em qual clínica vai entrar —, mas não ocupa um
               campo a preencher. */
            <div className="clinica-do-link">
              <div>
                <div className="eyebrow">Clínica</div>
                <b>{clinica}</b>
              </div>
              <button
                type="button"
                className="link"
                onClick={() => {
                  setDoLink(false)
                  // O valor fica, e o campo nasce selecionado: quem clicou por
                  // engano não perde o código, e quem vai trocar digita por
                  // cima sem apagar nada.
                  requestAnimationFrame(() => campoClinica.current?.select())
                }}
              >
                Trocar
              </button>
            </div>
          ) : (
            <label className="campo">
              Clínica
              <input
                ref={campoClinica}
                value={clinica}
                onChange={(e) => setClinica(e.target.value)}
                autoComplete="organization"
                // O mesmo trio do campo de usuário, e pela mesma razão: o
                // código é minúsculo e ditado por telefone, e o teclado do
                // tablet maiusculiza por padrão.
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </label>
          )}
          <label className="campo">
            Usuário
            <input
              ref={campoUsuario}
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoComplete="username"
              // O teclado do tablet maiusculiza e corrige por padrão. Os três
              // atributos abaixo desligam isso. Sem eles "Ana" chega ao
              // servidor e só não falha porque o contrato canoniza — e a
              // pessoa fica vendo na tela uma coisa diferente da que o
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
                  revelar a senha TENTA ENTRAR, gastando uma das cinco
                  tentativas. `tabIndex={-1}` mantém a ordem de tabulação
                  senha → Entrar, que é o caminho de quem digita rápido; quem
                  usa teclado só alcança o olho de propósito. */}
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

          {/* Uma mensagem por vez, e o espaço dela não desloca o botão quando
              aparece: a altura mínima já está reservada. */}
          <p role="alert" aria-live="polite" className="erro-entrada">
            {erro}
          </p>

          <button type="submit" disabled={enviando} className="btn">
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
      </form>
    </main>
  )
}

/**
 * `?sessao=encerrada` — **a frase que P-1 tornou obrigatória.**
 *
 * Com a sessão de 30 dias ninguém via esta tela duas vezes, e um desvio mudo
 * para `/entrar` era defensável. Agora a sessão termina no fim do dia da
 * clínica e a recepcionista encontra esta tela TODA MANHÃ: sem a frase, ela
 * conclui que a ferramenta a deslogou sozinha — e um sistema que parece
 * instável é um sistema que ninguém deixa aberto.
 *
 * Quem chega sem cookie nenhum — primeira visita, ou clicou em Sair — não vê
 * nada. Não houve surpresa, e explicar o óbvio é ruído na tela de quem está
 * com o telefone tocando.
 *
 * **Por que é um componente separado, e não um `useSearchParams` na página.**
 * `useSearchParams` tira o componente inteiro da pré-renderização, e o
 * `next build` recusa: *"useSearchParams() should be wrapped in a suspense
 * boundary at page /entrar"*. Medido — o build de produção quebrou.
 *
 * Envolver a página toda num `Suspense` resolveria o build e pioraria a tela:
 * a entrada é a primeira coisa que a recepcionista vê, e ela passaria a
 * aparecer depois da hidratação. Isolando só o aviso, o formulário continua
 * pré-renderizado e o `fallback={null}` não pisca nada — a frase simplesmente
 * aparece, e só para quem precisa dela.
 */
function AvisoDeSessaoEncerrada() {
  if (useSearchParams().get('sessao') !== 'encerrada') return null
  return (
    <p className="aviso-de-sessao" role="status">
      <b>O dia de trabalho foi encerrado.</b> A sessão termina ao fim de cada dia, de propósito: é
      o que faz o registro de quem fez cada coisa apontar para a pessoa certa. Entre de novo para
      continuar.
    </p>
  )
}
