import type { FastifyReply } from 'fastify'

/**
 * Apaga um cookie `__Host-` com os MESMOS atributos de quando foi criado.
 *
 * `clearCookie(nome, { path: '/' })` emite o Set-Cookie SEM `Secure`, e o
 * navegador IGNORA um Set-Cookie de cookie `__Host-` sem `Secure`: o "Sair"
 * revogava a sessão no banco mas o cookie ficava no aparelho.
 */
export function limparCookieDeSessao(
  res: FastifyReply,
  nome: string,
  sameSite: 'lax' | 'strict' = 'lax',
): void {
  res.clearCookie(nome, { httpOnly: true, secure: true, sameSite, path: '/' })
}
