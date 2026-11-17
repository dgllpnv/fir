/**
 * O token dos links de acesso (convite, redefinição, confirmação de e-mail).
 *
 * **Ele viaja no FRAGMENTO** (`/criar-senha#t=…`, spec 3.2): o fragmento não
 * chega ao servidor web, não entra em log de proxy nem no `Referer`. E a tela
 * o apaga da barra **antes de qualquer outra coisa** (appsec 15): um token que
 * fica na barra vai para o histórico do navegador, para o print de tela que a
 * recepcionista manda no WhatsApp e para quem olhar por cima do ombro.
 *
 * Nunca vai para a query string — nem para "passar adiante" ao `/entrar`.
 */

/** `#t=abc` → `abc`; qualquer outra coisa → `null`. Aceita com e sem `#`. */
export function tokenDoFragmento(fragmento: string): string | null {
  const bruto = fragmento.startsWith('#') ? fragmento.slice(1) : fragmento
  if (bruto === '') return null
  try {
    const t = new URLSearchParams(bruto).get('t')
    return t === null || t.trim() === '' ? null : t.trim()
  } catch {
    return null
  }
}

/**
 * Lê o token do fragmento e o APAGA da barra, na mesma chamada.
 *
 * `replaceState`, e não `location.hash = ''`: atribuir o hash cria uma entrada
 * nova no histórico — e o Voltar devolveria o token à barra. O caminho e a
 * query ficam; só o fragmento sai.
 *
 * Chamada uma vez, na montagem. Chamar de novo devolve `null`, porque o
 * fragmento já não existe — por isso a tela guarda o valor em estado.
 */
export function lerEApagarToken(): string | null {
  if (typeof window === 'undefined') return null
  const token = tokenDoFragmento(window.location.hash)
  if (window.location.hash !== '') {
    try {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    } catch {
      // Sem `history` (navegador muito restrito): o token ainda não vai a
      // servidor nenhum — o fragmento nunca vai.
    }
  }
  return token
}

/** As rotas que recebem o token. `next.config` manda `Referrer-Policy: no-referrer` nelas. */
export const ROTAS_DE_LINK = ['/criar-senha', '/confirmar-email', '/esqueci-senha'] as const

/** O destino do botão "Entrar" depois de usar o link: a clínica vem do link, nunca o token. */
export const entrarNaClinica = (codigo: string): string =>
  codigo === '' ? '/entrar' : `/entrar?clinica=${encodeURIComponent(codigo)}`
