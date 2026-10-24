import { Injectable } from '@nestjs/common'
import { inteiroDoAmbiente } from '../comum/ambiente'

/**
 * Limite de tentativas de entrada **por origem**, em janela deslizante e em
 * memória.
 *
 * Por que existe, em cima do limite que já havia: `limiteExcedido`
 * (sessao.ts) conta por `identificador`, e cinco falhas travam **aquela
 * conta**. Um atacante com mil e-mails distintos atravessa esse limite
 * inteiro sem nunca disparar bloqueio nenhum — foi exatamente o cenário
 * medido na revisão da branch (900 logins com e-mails diferentes). Contar por
 * origem é o controle que cobre esse caso, e é também o único que cobre o
 * caminho "clínica não existe", onde não há `clinica_id` para gravar tentativa
 * nenhuma.
 *
 * Em memória, e não no Redis: o Redis sobe no compose mas não tem uma linha
 * de código neste produto, e um estado novo em infraestrutura nova é um ponto
 * de falha novo. A API roda em UM processo por clínica-instalação; se um dia
 * houver duas réplicas, o limite efetivo dobra — o que é aceitável para um
 * controle de atrito, e está escrito aqui para quem for escalar.
 */
@Injectable()
export class LimitePorOrigem {
  private readonly porOrigem = new Map<string, number[]>()

  /**
   * @param max tentativas permitidas na janela
   * @param janelaMs tamanho da janela deslizante
   * @param maxOrigens teto de chaves guardadas, contra crescimento sem fim
   */
  constructor(
    private readonly max: number,
    private readonly janelaMs: number,
    private readonly maxOrigens = 10_000,
  ) {}

  /**
   * Registra uma tentativa e diz se ela está **dentro** do limite.
   *
   * Registra sempre, inclusive a que estoura: é assim que uma rajada mantém a
   * origem bloqueada enquanto insiste, em vez de liberar uma a cada janela.
   */
  registrar(origem: string, agora: number = Date.now()): boolean {
    const corte = agora - this.janelaMs
    const anteriores = (this.porOrigem.get(origem) ?? []).filter((t) => t > corte)
    anteriores.push(agora)
    this.porOrigem.set(origem, anteriores)

    // Poda só quando o mapa cresce além do teto: varrer a cada requisição
    // custaria O(origens) num caminho que é chamado por requisição, e o
    // crescimento real é de dezenas de chaves por mês.
    if (this.porOrigem.size > this.maxOrigens) this.podar(corte)

    return anteriores.length <= this.max
  }

  /** Quantas origens estão guardadas. Existe para o teste da poda. */
  get tamanho(): number {
    return this.porOrigem.size
  }

  /** Segundos até a origem voltar a caber no limite. Para o `Retry-After`. */
  esperaEmSegundos(origem: string, agora: number = Date.now()): number {
    const marcas = this.porOrigem.get(origem) ?? []
    const maisAntiga = marcas[0]
    if (maisAntiga === undefined) return 0
    return Math.max(1, Math.ceil((maisAntiga + this.janelaMs - agora) / 1000))
  }

  private podar(corte: number): void {
    for (const [origem, marcas] of this.porOrigem) {
      const vivas = marcas.filter((t) => t > corte)
      if (vivas.length === 0) this.porOrigem.delete(origem)
      else this.porOrigem.set(origem, vivas)
    }
  }
}

/**
 * Sessenta tentativas por origem em cinco minutos.
 *
 * O tráfego real é de ~24 logins por MÊS (quatro clínicas, seis pessoas,
 * sessão de 30 dias). Uma clínica inteira atrás de um NAT só chegaria a 60 em
 * cinco minutos se as seis pessoas errassem a senha dez vezes cada, ao mesmo
 * tempo. Para o enumerador, 12 por minuto em vez de 900 de uma vez é uma
 * redução de duas ordens de grandeza na vazão — é atrito, não muralha, e o
 * que faz as vezes de muralha é o Argon2 somado ao limite por conta.
 */
export const MAX_LOGIN_POR_ORIGEM = inteiroDoAmbiente('MAX_LOGIN_POR_ORIGEM', 60, { min: 1 })
export const JANELA_LOGIN_POR_ORIGEM_MS = inteiroDoAmbiente(
  'JANELA_LOGIN_POR_ORIGEM_MS',
  5 * 60 * 1000,
  { min: 1 },
)
