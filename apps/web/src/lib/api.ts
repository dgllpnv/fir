/**
 * Toda chamada vai para `/api/...` na mesma origem, com `credentials: 'include'`
 * para o cookie `__Host-fir-sessao` viajar.
 *
 * Dinheiro chega como string de centavos e **não é convertido aqui**: o front
 * não calcula dinheiro. Quem exibe chama `formatarDinheiro(BigInt(s))`.
 */
export class ErroDaApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

export async function chamar<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  /**
   * `content-type: application/json` só quando HÁ corpo.
   *
   * Medido no navegador: `DELETE /v1/tarefas/:id?serie=false` com o cabeçalho
   * e sem corpo é recusado pelo Fastify com *"Body cannot be empty when
   * content-type is set to 'application/json'"* — 400, antes de o controlador
   * existir. Declarar o tipo do corpo que não se manda é descrever uma
   * requisição que não é esta, e o excluir da tela de edição nunca funcionou
   * por causa disso.
   */
  const temCorpo = opcoes.body !== undefined && opcoes.body !== null
  const r = await fetch(`/api/${caminho.replace(/^\//, '')}`, {
    ...opcoes,
    credentials: 'include',
    headers: {
      ...(temCorpo ? { 'content-type': 'application/json' } : {}),
      ...(opcoes.headers ?? {}),
    },
  })
  if (!r.ok) {
    const corpo = (await r.json().catch(() => ({}))) as { message?: string }
    throw new ErroDaApi(r.status, corpo.message ?? 'Não foi possível completar a ação.')
  }
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T)
}
