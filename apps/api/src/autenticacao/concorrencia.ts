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
 * máquina, não sobre uma conta.
 */

/**
 * A fila de espera estourou o teto. Quem recebe isto deve ser **recusado
 * agora**, com 503 e `Retry-After`, em vez de esperar.
 */
export class FilaCheia extends Error {
  constructor() {
    super('Fila de verificação de senha cheia.')
    this.name = 'FilaCheia'
  }
}

export class Semaforo {
  private disponiveis: number
  private readonly fila: Array<() => void> = []

  /**
   * @param tamanho quantas tarefas rodam ao mesmo tempo
   * @param tetoDaFila quantas podem ESPERAR antes de a próxima ser recusada
   */
  constructor(
    private readonly tamanho: number,
    private readonly tetoDaFila: number = Number.POSITIVE_INFINITY,
  ) {
    if (tamanho < 1) throw new RangeError('Semaforo precisa de tamanho >= 1')
    if (tetoDaFila < 0) throw new RangeError('Teto da fila não pode ser negativo')
    this.disponiveis = tamanho
  }

  /** Quantas tarefas estão esperando agora. Existe para o teste e para log. */
  get esperando(): number {
    return this.fila.length
  }

  async executar<T>(tarefa: () => Promise<T>): Promise<T> {
    // `adquirir` FORA do try de propósito: quando ela rejeita por fila cheia,
    // nenhuma vaga foi tomada, e passar pelo `finally` liberaria uma vaga que
    // não existe — o semáforo iria somando vagas fantasma a cada recusa até
    // deixar de limitar coisa alguma.
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
    /**
     * Recusa rápida em vez de fila sem fim.
     *
     * A fila indefinida era o pior dos dois mundos: a pessoa esperava até o
     * `connectionTimeoutMillis` de 5 s do pool e **depois** recebia erro —
     * tempo de espera de uma falha, e nesse meio tempo a requisição continuava
     * ocupando socket, memória e um lugar na fila de eventos, em cima de todas
     * as outras. Falha rápida protege o resto da API: devolver 503 em
     * milissegundos libera a máquina para `/v1/saude`, que é o que o
     * orquestrador consulta antes de reiniciar o container.
     */
    if (this.fila.length >= this.tetoDaFila) return Promise.reject(new FilaCheia())
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

/**
 * Sessenta e quatro esperando, e a sexagésima quinta leva 503.
 *
 * De onde vem o 64, e por que não 4 nem 4096:
 *
 * - O tráfego real de login é minúsculo: quatro clínicas, seis pessoas cada,
 *   sessão de 30 dias — ~24 logins POR MÊS. A concorrência legítima é 1.
 *   Qualquer fila é já anormal, então o teto não precisa ser generoso para
 *   não atrapalhar ninguém; 64 é 16× o teto de concorrência e nenhuma pessoa
 *   de verdade chega perto dele.
 * - Medido nesta máquina: uma verificação Argon2id com estes parâmetros custa
 *   ~25 ms. Uma fila cheia de 64 drena em 64 / 4 × 25 ms ≈ 400 ms. Então
 *   quem entra na fila no pior caso espera menos de meio segundo — abaixo do
 *   segundo em que a recepcionista acha que travou, e MUITO abaixo dos 5 s
 *   do `connectionTimeoutMillis` do pool.
 * - Teto pequeno (4, 8) recusaria o segundo login simultâneo de uma clínica
 *   com duas recepcionistas entrando ao mesmo tempo depois de um reinício —
 *   503 em tráfego legítimo é pior que 400 ms de espera.
 *
 * Com `MAX_ARGON2_CONCORRENTE` alterado por ambiente, o teto acompanha: é
 * sempre 16× a concorrência.
 */
export const TETO_DA_FILA_ARGON2 = Number(
  process.env['TETO_FILA_ARGON2'] ?? MAX_ARGON2_CONCORRENTE * 16,
)

/** Segundos sugeridos ao cliente no `Retry-After` do 503 de fila cheia. */
export const RETRY_AFTER_FILA_CHEIA = 2

/** Singleton: o teto é por processo da API, não por requisição. */
export const semaforoArgon2 = new Semaforo(MAX_ARGON2_CONCORRENTE, TETO_DA_FILA_ARGON2)
