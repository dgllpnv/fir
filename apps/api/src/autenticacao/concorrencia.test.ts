import { describe, expect, it } from 'vitest'
import { Semaforo } from './concorrencia'
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
