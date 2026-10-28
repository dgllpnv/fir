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
    /** O código estável do corpo, quando há um. A tela casa isto, nunca texto. */
    readonly codigo?: string,
  ) {
    super(mensagem)
  }
}

/** Onde a pessoa com senha provisória é obrigada a terminar o primeiro acesso. */
export const CAMINHO_TROCAR_SENHA = '/trocar-senha'

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
    const corpo = (await r.json().catch(() => ({}))) as { message?: string; codigo?: string }
    /**
     * O DESVIO PARA A TROCA DE SENHA mora aqui, e não em cada tela.
     *
     * O servidor é quem impõe: com senha provisória, toda rota de negócio
     * responde 409 `SENHA_PROVISORIA` (guard global, ver
     * `senha-provisoria.guard.ts`). Tratar isso tela a tela significa que a
     * tela escrita amanhã mostra "Conflito" num aviso vermelho e deixa a
     * pessoa parada. Aqui o desvio é a regra, e vale para a ação que ninguém
     * previu.
     *
     * `window.location.assign` e não o router do Next: a troca de senha
     * revoga sessões e muda o que o servidor devolve em toda rota — uma
     * navegação do cliente levaria junto o cache de dados da página velha.
     */
    if (corpo.codigo === 'SENHA_PROVISORIA' && typeof window !== 'undefined') {
      window.location.assign(CAMINHO_TROCAR_SENHA)
    }
    throw new ErroDaApi(
      r.status,
      corpo.message ?? 'Não foi possível completar a ação.',
      corpo.codigo,
    )
  }
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T)
}
