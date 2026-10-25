import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  FUSO,
  HOJE,
  limparFinanceiro,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * **COBRANÇAS — a fila de ligação, ordenada pelo servidor.**
 *
 * Duas coisas são provadas aqui e em nenhum outro lugar: a ordem é do
 * servidor (porque sem `valores` o front não tem o saldo com que ordenar), e
 * `registrarCobranca` exige permissão — o protótipo não exige, e a Enfermagem
 * registrou cobrança quando isso foi medido.
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

/** Deixa `valorAberto` em aberto para a paciente, sem abater nada. */
const abrirSaldo = (pacienteId: string, valorAberto: string) =>
  registrar({ pacienteId, ref: 'novo', valor: '1000', valorAberto })

const listar = (quem = 'beatriz') => pegar(c, '/v1/cobrancas', {}, quem)

const registrarCobranca = (pacienteId: string, quem = 'beatriz', canal = 'WhatsApp') =>
  postar(c, '/v1/cobrancas', { pacienteId, canal }, quem)

/**
 * Um contato ANTIGO, escrito direto no banco.
 *
 * Ancorado em `HOJE` — o dia do relógio FIXO do app —, nunca em `now()`: o
 * relógio do banco é o da máquina, e contar dias entre as duas réguas daria
 * um dia de diferença exatamente quando a máquina virasse a meia-noite.
 */
const contatoHa = async (pacienteId: string, dias: number): Promise<void> => {
  await c.migrate.query(
    `INSERT INTO cobrancas (clinica_id, paciente_id, canal, em, por)
     VALUES ($1, $2, 'Telefone',
             (($3::date - $4::int) + time '12:00') AT TIME ZONE $5, $6)`,
    [c.clinica, pacienteId, HOJE, dias, FUSO, c.pessoas['beatriz']],
  )
}

beforeAll(async () => {
  c = await montarCenario('cobrancas')
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparFinanceiro(c)
  await limparTarefas(c)
})

describe('GET /v1/cobrancas', () => {
  it('traz quem tem saldo, com o total a receber e a contagem', async () => {
    await abrirSaldo(c.pacientes['ana']!, '200000')
    await abrirSaldo(c.pacientes['bruna']!, '50000')

    const r = await listar()
    expect(r.statusCode).toBe(200)
    expect(r.body.itens).toHaveLength(2)
    expect(r.body.quantidade).toBe(2)
    expect(r.body.aReceber).toBe('250000')
  })

  it('paciente SEM saldo não aparece — nem quem abriu e quitou', async () => {
    await abrirSaldo(c.pacientes['ana']!, '200000')
    await registrar({ ref: 'saldo', valor: '200000' })

    const r = await listar()
    expect(r.body.itens).toHaveLength(0)
    expect(r.body.aReceber).toBe('0')
  })

  it('ordena por quem está há mais tempo sem contato — nunca contatado primeiro', async () => {
    await abrirSaldo(c.pacientes['ana']!, '100000')
    await abrirSaldo(c.pacientes['bruna']!, '100000')
    // Ana foi contatada ontem; Bruna nunca. Bruna vem primeiro.
    await contatoHa(c.pacientes['ana']!, 1)

    const r = await listar()
    expect((r.body.itens as { pacienteId: string }[]).map((x) => x.pacienteId)).toEqual([
      c.pacientes['bruna'],
      c.pacientes['ana'],
    ])
  })

  it('entre dois contatados, o MAIS ANTIGO vem primeiro', async () => {
    await abrirSaldo(c.pacientes['ana']!, '100000')
    await abrirSaldo(c.pacientes['bruna']!, '100000')
    await contatoHa(c.pacientes['ana']!, 2)
    await contatoHa(c.pacientes['bruna']!, 30)

    const r = await listar()
    expect((r.body.itens as { pacienteId: string }[]).map((x) => x.pacienteId)).toEqual([
      c.pacientes['bruna'],
      c.pacientes['ana'],
    ])
  })

  it('"sem contato há 15 dias ou mais" conta no SERVIDOR, contra o hoje do servidor', async () => {
    await abrirSaldo(c.pacientes['ana']!, '100000')
    await abrirSaldo(c.pacientes['bruna']!, '100000')
    await contatoHa(c.pacientes['ana']!, 20) // conta
    await contatoHa(c.pacientes['bruna']!, 3) // não conta

    const r = await listar()
    expect(r.body.semContato).toBe(1)
    const ana = (r.body.itens as { pacienteId: string; diasSemContato: number }[]).find(
      (x) => x.pacienteId === c.pacientes['ana'],
    )!
    expect(ana.diasSemContato).toBe(20)
  })

  it('nunca contatado conta como sem contato, e `diasSemContato` é `null`', async () => {
    await abrirSaldo(c.pacientes['ana']!, '100000')
    const r = await listar()
    expect(r.body.semContato).toBe(1)
    expect(r.body.itens[0].diasSemContato).toBeNull()
    expect(r.body.itens[0].ultimoContatoEm).toBeNull()
  })

  it('sem `valores`, a fila CONTINUA ordenada e `temSaldo` atravessa', async () => {
    // É o ponto inteiro de ordenar no servidor: para `sonia` o `saldo` vem
    // `null`, e um front que ordenasse por ele entregaria a fila embaralhada
    // justamente a quem liga.
    await abrirSaldo(c.pacientes['ana']!, '100000')
    await abrirSaldo(c.pacientes['bruna']!, '300000')
    await contatoHa(c.pacientes['ana']!, 1)

    const r = await listar('sonia')
    expect(r.statusCode).toBe(200)
    expect((r.body.itens as { pacienteId: string }[]).map((x) => x.pacienteId)).toEqual([
      c.pacientes['bruna'],
      c.pacientes['ana'],
    ])
    expect(r.body.itens[0].saldo).toBeNull()
    expect(r.body.itens[0].temSaldo).toBe(true)
    expect(r.body.aReceber).toBeNull()
    expect(r.body.quantidade).toBe(2)
    expect(r.text).not.toContain('300000')
    expect(r.text).not.toContain('400000')
  })

  it('sem a permissão `cobrancas`, 403', async () => {
    // `camila` tem `valores` e NÃO tem `cobrancas`: o 403 não pode ser
    // confundido com falta de permissão de dinheiro.
    expect((await listar('camila')).statusCode).toBe(403)
  })
})

describe('POST /v1/cobrancas', () => {
  it('registra o contato e ele passa a ser o último', async () => {
    await abrirSaldo(c.pacientes['ana']!, '100000')
    expect((await registrarCobranca(c.pacientes['ana']!)).statusCode).toBe(201)

    const r = await listar()
    expect(r.body.itens[0].ultimoContatoEm).toBe(HOJE)
    expect(r.body.itens[0].ultimoContatoPor).toBe('Beatriz')
    expect(r.body.itens[0].canal).toBe('WhatsApp')
    expect(r.body.itens[0].diasSemContato).toBe(0)
    expect(r.body.semContato).toBe(0)
  })

  it('registrar cobrança EXIGE a permissão — o protótipo não exige, e a Enfermagem passou', async () => {
    // Medido no protótipo: `registrarCobranca` como perfil sem `cobrancas`
    // devolveu `ok`. Aqui é 403, e nada é escrito.
    await abrirSaldo(c.pacientes['ana']!, '100000')
    expect((await registrarCobranca(c.pacientes['ana']!, 'camila')).statusCode).toBe(403)

    const n = await c.migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM cobrancas WHERE clinica_id = $1',
      [c.clinica],
    )
    expect(Number(n.rows[0]!.n)).toBe(0)
  })

  it('é APPEND-ONLY: dois contatos no mesmo dia são duas linhas', async () => {
    await abrirSaldo(c.pacientes['ana']!, '100000')
    await registrarCobranca(c.pacientes['ana']!)
    await registrarCobranca(c.pacientes['ana']!, 'beatriz', 'Telefone')

    const n = await c.migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM cobrancas WHERE clinica_id = $1',
      [c.clinica],
    )
    expect(Number(n.rows[0]!.n)).toBe(2)
  })

  it('canal fora da lista é 400', async () => {
    const r = await postar(
      c,
      '/v1/cobrancas',
      { pacienteId: c.pacientes['ana'], canal: 'Pombo-correio' },
      'beatriz',
    )
    expect(r.statusCode).toBe(400)
  })

  it('cobrança de paciente de OUTRA clínica é 404', async () => {
    expect((await registrarCobranca(c.pacienteDaOutra)).statusCode).toBe(404)
  })
})

describe('GET /v1/cobrancas/:pacienteId/mensagem', () => {
  it('a mensagem monta no SERVIDOR e NÃO leva o valor', async () => {
    await abrirSaldo(c.pacientes['ana']!, '200000')
    const r = await pegar(c, `/v1/cobrancas/${c.pacientes['ana']}/mensagem`, {}, 'sonia')
    expect(r.statusCode).toBe(200)
    expect(r.body.texto).toContain('valor em aberto')
    expect(r.body.texto).toContain('Ana')
    expect(r.body.texto).toContain('Sonia')
    // O saldo da paciente, em qualquer forma que ele poderia aparecer escrito.
    for (const n of ['200000', '2.000,00', '2000,00', 'R$ 2.000']) {
      expect(r.body.texto, `a mensagem contém ${n}`).not.toContain(n)
    }
  })

  it('a mensagem de paciente de outra clínica é 404', async () => {
    const r = await pegar(c, `/v1/cobrancas/${c.pacienteDaOutra}/mensagem`, {}, 'beatriz')
    expect(r.statusCode).toBe(404)
  })
})
