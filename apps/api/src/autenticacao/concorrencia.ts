/**
 * Teto de verificações de Argon2 simultâneas no caminho de `entrar`.
 *
 * `limiteExcedido` (sessao.ts) bloqueia tentativas POR IDENTIFICADOR: cinco
 * falhas na mesma conta travam a sexta. Mas um atacante com mil e-mails
 * distintos nunca esgota o limite de conta nenhuma — e cada verificação
 * custa até 19 MiB de memória (constante `OPCOES` em senha.ts), numa VPS
 * compartilhada com outro produto em produção. Sem teto de concorrência, mil
 * requisições simultâneas somam ~19 GiB de pico — o container vizinho cai
 * antes do limite por tentativas entrar em ação para qualquer conta.
 *
 * Este semáforo de contagem limita quantas verificações rodam ao mesmo
 * tempo, qualquer que seja a conta-alvo: o teto é sobre a CPU/memória da
 * máquina, não sobre uma conta. Acima do teto, a requisição espera numa
 * fila FIFO em vez de rodar — espera é mais barato que memória.
 */
export class Semaforo {
  private disponiveis: number
  private readonly fila: Array<() => void> = []

  constructor(private readonly tamanho: number) {
    if (tamanho < 1) throw new RangeError('Semaforo precisa de tamanho >= 1')
    this.disponiveis = tamanho
  }

  async executar<T>(tarefa: () => Promise<T>): Promise<T> {
    await this.adquirir()
    try {
      return await tarefa()
    } finally {
      this.liberar()
    }
  }

  private adquirir(): Promise<void> {
    if (this.disponiveis > 0) {
      this.disponiveis--
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.fila.push(resolve)
    })
  }

  /**
   * Libera uma vaga. Se alguém está na fila, a vaga passa direto para ele —
   * sem incrementar `disponiveis` e decrementar de novo — porque as duas
   * operações juntas são exatamente "não fazer nada", e a diferença só
   * importa para quem lê o código, não para o resultado.
   */
  private liberar(): void {
    const proximo = this.fila.shift()
    if (proximo) {
      proximo()
      return
    }
    this.disponiveis++
  }
}

/**
 * Quatro verificações simultâneas: 4 × 19 MiB ≈ 76 MiB de pico no caminho de
 * login. É o teto que convive com o resto da VPS compartilhada sem com isso
 * serializar o balcão numa clínica com poucos logins ao mesmo tempo.
 * Ajustável por variável de ambiente para quem tiver mais (ou menos) memória
 * de sobra.
 */
export const MAX_ARGON2_CONCORRENTE = Number(process.env['MAX_ARGON2_CONCORRENTE'] ?? 4)

/** Singleton: o teto é por processo da API, não por requisição. */
export const semaforoArgon2 = new Semaforo(MAX_ARGON2_CONCORRENTE)
