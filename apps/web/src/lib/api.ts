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
    /**
     * Os avisos de `CONFIRMACAO_NECESSARIA` (D-21) — códigos, nunca números.
     * Quem os transforma em pergunta é `lib/confirmacao.tsx`.
     */
    readonly avisos?: readonly string[],
  ) {
    super(mensagem)
  }
}

/** Onde a pessoa com senha provisória é obrigada a terminar o primeiro acesso. */
export const CAMINHO_TROCAR_SENHA = '/trocar-senha'

/**
 * O mesmo desvio, para o OPERADOR do painel.
 *
 * São dois espaços de identidade disjuntos (D-5): o operador não é uma pessoa
 * de clínica nenhuma, a provisória dele é gerada pelo break-glass da VPS, e o
 * `PainelGuard` responde 409 `SENHA_PROVISORIA_OPERADOR` em toda rota de
 * painel menos três. Mandá-lo para `/trocar-senha` — a tela do produto — o
 * largaria numa tela que pede a sessão de clínica que ele não tem.
 */
export const CAMINHO_TROCAR_SENHA_DO_PAINEL = '/gestao/trocar-senha'

/**
 * E o mesmo desvio para os outros dois espaços de identidade — a carteira
 * comercial (`Usuário de Gestão`) e o Portal do Grupo (`Usuário do portal`).
 * Cada guard responde com o SEU código, e cada código tem o SEU destino: a
 * tela de troca de senha de um espaço pede a sessão daquele espaço.
 */
export const CAMINHO_TROCAR_SENHA_DA_CARTEIRA = '/carteira/trocar-senha'
export const CAMINHO_TROCAR_SENHA_DO_PORTAL = '/portal/trocar-senha'

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
    const corpo = (await r.json().catch(() => ({}))) as {
      message?: string
      codigo?: string
      avisos?: unknown
    }
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
    // O código do painel é OUTRO (`SENHA_PROVISORIA_OPERADOR`), e o destino
    // também. Dois códigos e não um: um só faria o produto desviar o operador
    // para a tela da clínica, e o painel desviar a recepcionista para a porta
    // que ela não enxerga.
    if (corpo.codigo === 'SENHA_PROVISORIA_OPERADOR' && typeof window !== 'undefined') {
      window.location.assign(CAMINHO_TROCAR_SENHA_DO_PAINEL)
    }
    if (corpo.codigo === 'SENHA_PROVISORIA_CARTEIRA' && typeof window !== 'undefined') {
      window.location.assign(CAMINHO_TROCAR_SENHA_DA_CARTEIRA)
    }
    // G8 0.6 (A-12): sessão da carteira sem segundo fator — a etapa seguinte
    // à provisória, com o seu próprio código e o seu próprio destino. Com o
    // segundo fator desligado no servidor (ADR 0023, o padrão) este 409 nunca
    // sai, e o desvio nunca acontece; fica para religar sem build.
    if (corpo.codigo === 'SEGUNDO_FATOR_CARTEIRA' && typeof window !== 'undefined') {
      window.location.assign('/carteira/segundo-fator')
    }
    if (corpo.codigo === 'SENHA_PROVISORIA_PORTAL' && typeof window !== 'undefined') {
      window.location.assign(CAMINHO_TROCAR_SENHA_DO_PORTAL)
    }
    throw new ErroDaApi(
      r.status,
      corpo.message ?? 'Não foi possível completar a ação.',
      corpo.codigo,
      Array.isArray(corpo.avisos)
        ? corpo.avisos.filter((a): a is string => typeof a === 'string')
        : undefined,
    )
  }
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T)
}
