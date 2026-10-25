import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  apagar,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * **O SALDO EM ABERTO — e a segunda implementação que foi apagada.**
 *
 * Até o épico 4 a regra 5 existia DUAS vezes nesta árvore: `saldoEmAberto`,
 * pura, agrupada por programa e com o excedente preservado como `credito`; e
 * um `greatest(0, Σ aberto − Σ abatido)` em `pacientes.service.ts`, colapsado
 * num total só, que fazia dinheiro **sumir sem deixar rastro**. As duas já
 * discordavam — é exatamente a dívida que o `CLAUDE.md` descreve no legado.
 *
 * O SQL foi apagado. Estes testes cobram o resultado: a lista e a ficha
 * consomem a função do domínio, o crédito aparece, e `temSaldo` atravessa a
 * redação para quem não vê valores.
 */
let c: Cenario

type Corpo = Record<string, unknown>

const registrar = (x: Corpo, quem = 'beatriz') =>
  postar(
    c,
    '/v1/recebimentos',
    {
      requisicaoId: randomUUID(),
      pacienteId: c.pacientes['ana'],
      valor: '45000',
      forma: 'Pix',
      em: HOJE,
      ref: 'consulta',
      ...x,
    },
    quem,
  )

const saldoDe = (pacienteId: string, quem = 'beatriz') =>
  pegar(c, `/v1/pacientes/${pacienteId}/saldo`, {}, quem)

const fichaDe = (pacienteId: string, quem = 'beatriz') =>
  pegar(c, `/v1/pacientes/${pacienteId}`, {}, quem)

beforeAll(async () => {
  c = await montarCenario('saldo')
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparTarefas(c)
})

describe('GET /v1/pacientes/:id/saldo', () => {
  it('o saldo vem AGRUPADO, nunca num total só', async () => {
    await registrar({ valor: '100000', valorAberto: '200000', ref: 'novo' })
    const r = await saldoDe(c.pacientes['ana']!)
    expect(r.statusCode).toBe(200)
    expect(Array.isArray(r.body.grupos)).toBe(true)
    expect(r.body.grupos).toHaveLength(1)
    expect(r.body.grupos[0]).toHaveProperty('aberto', '200000')
    expect(r.body.grupos[0]).toHaveProperty('abatido', '0')
    expect(r.body.grupos[0]).toHaveProperty('programaId', null)
  })

  it('pagar parcialmente um orçamento deixa o resto em aberto — o exemplo do MANUAL cap. 6', async () => {
    // Orçamento de R$ 3.000, entrada de R$ 1.000.
    await registrar({ ref: 'novo', valor: '100000', valorAberto: '200000' })
    expect((await saldoDe(c.pacientes['ana']!)).body.saldo).toBe('200000')
    // Parcela de R$ 800.
    await registrar({ ref: 'saldo', valor: '80000' })
    expect((await saldoDe(c.pacientes['ana']!)).body.saldo).toBe('120000')
  })

  it('O CRÉDITO NÃO SE PERDE: pagar a mais zera o saldo e aparece em `credito`', async () => {
    // É a mutação que o `greatest(0, …)` em SQL cometia. Ele devolvia `0` e o
    // excedente sumia — e paciente que pagou a mais é erro de lançamento ou
    // crédito real, e os dois precisam aparecer.
    await registrar({ ref: 'consulta', valor: '100000', valorAberto: '50000' })
    await registrar({ ref: 'saldo', valor: '80000' })

    const r = await saldoDe(c.pacientes['ana']!)
    expect(r.body.saldo).toBe('0')
    expect(r.body.credito).toBe('30000')
    expect(r.body.temSaldo).toBe(false)
    expect(r.body.grupos[0].credito).toBe('30000')
    // E `saldo − credito === aberto − abatido`: o clamp MOVE, não perde.
    const g = r.body.grupos[0]
    expect(BigInt(g.saldo) - BigInt(g.credito)).toBe(BigInt(g.aberto) - BigInt(g.abatido))
  })

  it('sem `valores`, a equipe recebe `temSaldo` e NÃO o número', async () => {
    await registrar({ ref: 'novo', valor: '100000', valorAberto: '200000' })
    const r = await saldoDe(c.pacientes['ana']!, 'rita')
    expect(r.statusCode).toBe(200)
    expect(r.body.temSaldo).toBe(true)
    expect(r.body.saldo).toBeNull()
    expect(r.body.grupos[0].saldo).toBeNull()
    expect(r.body.grupos[0].aberto).toBeNull()
    // E o número não aparece sob nenhum outro nome, em lugar nenhum do corpo.
    expect(r.text).not.toContain('200000')
  })

  it('paciente sem recebimento nenhum devolve saldo zero, não 500 nem lista vazia de chaves', async () => {
    const r = await saldoDe(c.pacientes['bruna']!)
    expect(r.statusCode).toBe(200)
    expect(r.body).toEqual({ grupos: [], saldo: '0', credito: '0', temSaldo: false })
  })

  it('o estorno tira o recebimento do saldo', async () => {
    const a = await registrar({ ref: 'novo', valor: '100000', valorAberto: '200000' })
    expect((await saldoDe(c.pacientes['ana']!)).body.saldo).toBe('200000')
    expect((await apagar(c, `/v1/recebimentos/${a.body.id}`, {}, 'beatriz')).statusCode).toBe(204)
    expect((await saldoDe(c.pacientes['ana']!)).body.saldo).toBe('0')
  })

  it('o saldo de paciente de OUTRA clínica não é alcançável nem por id', async () => {
    const r = await saldoDe(c.pacienteDaOutra)
    expect(r.statusCode).toBe(404)
  })

  it('sem sessão, 401 — e nenhum saldo atravessa', async () => {
    const r = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}/saldo`, {}, 'ninguem')
    expect(r.statusCode).toBe(401)
  })
})

describe('a lista e a ficha consomem a MESMA função do domínio', () => {
  it('a ficha traz saldo, credito e temSaldo — e o credito não é engolido', async () => {
    await registrar({ ref: 'consulta', valor: '100000', valorAberto: '50000' })
    await registrar({ ref: 'saldo', valor: '80000' })

    const r = await fichaDe(c.pacientes['ana']!)
    expect(r.statusCode).toBe(200)
    expect(r.body.saldo).toBe('0')
    expect(r.body.credito).toBe('30000')
    expect(r.body.temSaldo).toBe(false)
  })

  it('a LISTA traz os três campos, e eles batem com a rota de saldo', async () => {
    await registrar({ ref: 'novo', valor: '100000', valorAberto: '200000' })

    const lista = await pegar(c, '/v1/pacientes', { q: 'Ana' }, 'beatriz')
    const ana = (lista.body.pacientes as { id: string }[]).find(
      (p) => p.id === c.pacientes['ana'],
    ) as Record<string, unknown>
    expect(ana['saldo']).toBe('200000')
    expect(ana['credito']).toBe('0')
    expect(ana['temSaldo']).toBe(true)

    const porRota = await saldoDe(c.pacientes['ana']!)
    expect(ana['saldo']).toBe(porRota.body.saldo)
    expect(ana['credito']).toBe(porRota.body.credito)
  })

  it('sem `valores`, a lista entrega `temSaldo` verdadeiro e `saldo` nulo', async () => {
    // O defeito que isto conserta: a ficha decidia "nada pendente" com
    // `saldo === null || saldo === '0'`. Para quem não tem `valores` o campo
    // SEMPRE vem `null` — então toda paciente aparecia sem pendência, com a
    // dívida existindo. Agora quem decide é um booleano derivado no servidor.
    await registrar({ ref: 'novo', valor: '100000', valorAberto: '200000' })
    const r = await fichaDe(c.pacientes['ana']!, 'rita')
    expect(r.body.saldo).toBeNull()
    expect(r.body.temSaldo).toBe(true)
    expect(r.text).not.toContain('200000')
  })

  it('paciente sem movimento aparece na lista com saldo zero, não ausente', async () => {
    const lista = await pegar(c, '/v1/pacientes', { q: 'Bruna' }, 'beatriz')
    const bruna = (lista.body.pacientes as Record<string, unknown>[])[0]!
    expect(bruna['saldo']).toBe('0')
    expect(bruna['temSaldo']).toBe(false)
  })
})
