export type ErroDeDominio = { readonly codigo: string; readonly mensagem: string }

export const erroDe = (codigo: string, mensagem: string): ErroDeDominio => ({ codigo, mensagem })

export type Result<T, E = ErroDeDominio> =
  | { readonly tipo: 'ok'; readonly valor: T }
  | { readonly tipo: 'erro'; readonly erro: E }

export const ok = <T>(valor: T): Result<T, never> => ({ tipo: 'ok', valor })
export const erro = <E>(e: E): Result<never, E> => ({ tipo: 'erro', erro: e })

export const ehOk = <T, E>(r: Result<T, E>): r is Extract<Result<T, E>, { tipo: 'ok' }> =>
  r.tipo === 'ok'
export const ehErro = <T, E>(r: Result<T, E>): r is Extract<Result<T, E>, { tipo: 'erro' }> =>
  r.tipo === 'erro'

/** Desembrulha ou lança. Só em teste e na borda HTTP, nunca dentro do domínio. */
export function exigir<T, E extends ErroDeDominio>(r: Result<T, E>): T {
  if (ehErro(r)) throw new Error(`${r.erro.codigo}: ${r.erro.mensagem}`)
  return r.valor
}
