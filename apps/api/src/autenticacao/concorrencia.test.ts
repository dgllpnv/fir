import { describe, expect, it } from 'vitest'
import {
  FilaCheia,
  MAX_ARGON2_CONCORRENTE,
  Semaforo,
  TETO_DA_FILA_ARGON2,
} from './concorrencia'
import { conferirSenha, hashDeSenha } from './senha'

describe('Semaforo', () => {
  it('nunca deixa mais que K tarefas em execução ao mesmo tempo', async () => {
    const K = 4
    const N = 20
    const sem = new Semaforo(K)
    let emExecucao = 0
    let maximoObservado = 0
    let concluidas = 0

    const tarefa = () =>
      sem.executar(async () => {
        emExecucao++
        maximoObservado = Math.max(maximoObservado, emExecucao)
        await new Promise((r) => setTimeout(r, 15))
        emExecucao--
        concluidas++
      })

    await Promise.all(Array.from({ length: N }, tarefa))

    expect(concluidas).toBe(N)
    expect(maximoObservado).toBeLessThanOrEqual(K)
    // Com N bem maior que K e todas as tarefas disparadas juntas, o teto
    // precisa ser de fato alcançado — senão a medição não provaria nada.
    expect(maximoObservado).toBe(K)
  })

  it('tamanho 1 serializa completamente: nunca duas tarefas ao mesmo tempo', async () => {
    const sem = new Semaforo(1)
    let emExecucao = 0
    let maximoObservado = 0
    const ordem: number[] = []

    await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        sem.executar(async () => {
          emExecucao++
          maximoObservado = Math.max(maximoObservado, emExecucao)
          ordem.push(i)
          await new Promise((r) => setTimeout(r, 5))
          emExecucao--
        }),
      ),
    )

    expect(maximoObservado).toBe(1)
    expect(ordem).toEqual([1, 2, 3, 4, 5])
  })
})

describe('semaforoArgon2 com Argon2 real', () => {
  it('K=3 limita verificações reais de senha ao mesmo tempo, medido por contador', async () => {
    const K = 3
    const N = 9
    const sem = new Semaforo(K)
    const hash = await hashDeSenha('senha-de-medicao')

    let emExecucao = 0
    let maximoObservado = 0

    const verificar = () =>
      sem.executar(async () => {
        emExecucao++
        maximoObservado = Math.max(maximoObservado, emExecucao)
        const ok = await conferirSenha('senha-de-medicao', hash)
        emExecucao--
        return ok
      })

    const resultados = await Promise.all(Array.from({ length: N }, verificar))

    expect(resultados.every((r) => r === true)).toBe(true)
    expect(maximoObservado).toBeLessThanOrEqual(K)
    expect(maximoObservado).toBe(K)
  })
})

describe('teto da fila — recusa rápida em vez de espera sem fim', () => {
  /**
   * Uma porta só para todas as tarefas: `liberar()` destrava o lote inteiro.
   * O padrão "empilhar os `resolve` numa lista" não serve aqui — a função da
   * tarefa só é CHAMADA depois de a vaga ser concedida, então no instante em
   * que o teste verifica a fila a lista ainda está vazia e nada seria
   * destravado.
   */
  const porta = () => {
    let liberar = (): void => {}
    const esperar = new Promise<void>((r) => {
      liberar = r
    })
    return { liberar, tarefa: () => esperar }
  }

  it('acima do teto rejeita com FilaCheia, sem esperar', async () => {
    // Tamanho 1, teto 2: a 1ª roda, a 2ª e a 3ª esperam, a 4ª é recusada.
    const sem = new Semaforo(1, 2)
    const { liberar, tarefa } = porta()

    const voos = [sem.executar(tarefa), sem.executar(tarefa), sem.executar(tarefa)]
    // As três foram aceitas: uma em execução, duas na fila.
    expect(sem.esperando).toBe(2)

    const inicio = performance.now()
    await expect(sem.executar(tarefa)).rejects.toThrow(FilaCheia)
    // "Rápida" é o ponto inteiro: a recusa não espera o semáforo nem o
    // `connectionTimeoutMillis` de 5 s do pool.
    expect(performance.now() - inicio).toBeLessThan(50)

    liberar()
    await Promise.all(voos)
  })

  it('a recusa NÃO consome vaga — o semáforo continua limitando depois dela', async () => {
    // Se `executar` passasse pelo `finally` quando `adquirir` rejeita, cada
    // recusa somaria uma vaga fantasma e o semáforo deixaria de limitar.
    const sem = new Semaforo(1, 0)
    const { liberar, tarefa } = porta()

    const voo = sem.executar(tarefa)
    await expect(sem.executar(tarefa)).rejects.toThrow(FilaCheia)
    await expect(sem.executar(tarefa)).rejects.toThrow(FilaCheia)
    await expect(sem.executar(tarefa)).rejects.toThrow(FilaCheia)

    expect(sem.esperando).toBe(0)
    liberar()
    await voo

    // Depois de drenar, a vaga única voltou — e é UMA, não quatro. Com teto
    // de fila 0, a segunda simultânea tem de ser RECUSADA: se as três
    // recusas acima tivessem somado vagas fantasma, ela rodaria.
    const segunda = porta()
    const ocupa = sem.executar(segunda.tarefa)
    await expect(sem.executar(segunda.tarefa)).rejects.toThrow(FilaCheia)
    segunda.liberar()
    await ocupa
  })

  it('sem teto declarado, a fila é ilimitada — o comportamento de antes', async () => {
    const sem = new Semaforo(1)
    const { liberar, tarefa } = porta()
    const voos = Array.from({ length: 50 }, () => sem.executar(tarefa))
    expect(sem.esperando).toBe(49)
    liberar()
    await Promise.all(voos)
  })

  it('o teto padrão acompanha a concorrência: 16 vezes', () => {
    expect(TETO_DA_FILA_ARGON2).toBe(MAX_ARGON2_CONCORRENTE * 16)
  })
})
