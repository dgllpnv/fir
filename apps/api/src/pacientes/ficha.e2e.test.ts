import { FichaDoPaciente } from '@fir/contracts'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarOperadorDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  inserirRecebimento,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * A FICHA desenha o cartão da jornada (correções da PO, A2).
 *
 * Em produção, a paciente com um orçamento de R$ 20.000 em aberto aparecia
 * na ficha sem nenhuma etapa: a ficha tinha uma forma de tarefa própria, sem
 * `historico`, `valorOrcamento`, `proximoPassoEm` nem `programaOrcado`. Agora
 * ela devolve `TarefaNaLista` — e com isso passa a carregar DINHEIRO, que é
 * o que este arquivo existe para vigiar: a redação de ponto único (regra 17)
 * precisa apagar os três caminhos (`valorOrcamento`, `programaOrcado[].valor`,
 * `historico[].valor`) e o pagamento embutido, para quem não tem `valores`.
 *
 * Postgres real, caminho HTTP inteiro, o `RedacaoInterceptor` de verdade.
 * Duas personas do cenário:
 *  - `beatriz` (Supervisão): tem `valores`;
 *  - `juliana` (Recepção): tem `pacientes` e `jornada`, **não** tem `valores`;
 *  - `camila` (Comercial): tem `pacientes` e `valores`, **não** tem `jornada`.
 */

let c: Cenario

beforeAll(async () => {
  c = await montarCenario('ficha')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
})

type Corpo = Record<string, unknown>

const ficha = (quem: string) => pegar(c, `/v1/pacientes/${c.pacientes['ana']}`, {}, quem)

const mover = (id: string, corpo: Corpo) =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, 'beatriz')

/** Uma consulta concluída: o cartão nasce em `realizado`. */
async function realizado(): Promise<string> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['beatriz'],
      quando: { modo: 'retroativo', em: HOJE },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.tarefa.id as string
}

/** Uma consulta futura, aberta: `agendado`. */
async function agendado(): Promise<string> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['beatriz'],
      quando: { modo: 'agendada', prazo: '2026-10-30' },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.tarefa.id as string
}

const ITEM = {
  procedimentoId: '33333333-3333-4333-8333-333333333333',
  sessoes: 12,
  intervaloDias: 7,
  chave: 'i1',
  dose: '2,5 mg',
  valor: '30000',
}

/** O caso de produção: realizado → orçamento de R$ 20.000,00 com programa. */
async function orcado(): Promise<string> {
  const id = await realizado()
  const r = await mover(id, { acao: 'registrarOrcamento', valor: '2000000', programa: [ITEM] })
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return id
}

type TarefaDaFicha = FichaDoPaciente['tarefas'][number]

const tarefaDe = (corpo: unknown, id: string): TarefaDaFicha => {
  const t = (corpo as FichaDoPaciente).tarefas.find((x) => x.id === id)
  expect(t, `tarefa ${id} não veio na ficha`).toBeDefined()
  return t!
}

describe('GET /v1/pacientes/:id — o Histórico na forma de Hoje e de Tarefas', () => {
  it('a resposta casa com o contrato — `TarefaNaLista` e o `hoje` da clínica', async () => {
    await orcado()
    const r = await ficha('beatriz').expect(200)
    // `parse`, não `safeParse` + expect: o erro do Zod nomeia o campo.
    const f = FichaDoPaciente.parse(r.body)
    expect(f.hoje).toBe(HOJE)
  })

  it('o orçamento em aberto chega COM a etapa, o dia de retomar e a evolução', async () => {
    const id = await orcado()
    const t = tarefaDe((await ficha('juliana').expect(200)).body, id)
    expect(t.etapa).toBe('orcamento')
    // `registrarOrcamento` põe o retomar em hoje + 2, no fuso da clínica.
    expect(t.proximoPassoEm).toBe('2026-10-26')
    expect(t.historico.map((e) => e.acao)).toContain('registrarOrcamento')
    expect(t.programaOrcado).toHaveLength(1)
    expect(t.programaOrcado![0]).toMatchObject({ sessoes: 12, dose: '2,5 mg' })
    expect(t.pacienteId).toBe(c.pacientes['ana'])
  })

  it('abertas primeiro, depois da mais recente para a mais antiga (ordem do protótipo)', async () => {
    const feita = await orcado()
    const aberta = await agendado()
    const f = (await ficha('beatriz').expect(200)).body as FichaDoPaciente
    expect(f.tarefas.map((t) => t.id)).toEqual([aberta, feita])
  })
})

describe('REGRA 17 — a ficha não fura a redação de valores', () => {
  it('COM `valores`: o orçado, o item orçado, o evento e o pagamento chegam inteiros', async () => {
    const id = await orcado()
    const pago = await realizado()
    await inserirRecebimento(c, pago, c.pacientes['ana']!, 45000n)

    const corpo = (await ficha('beatriz').expect(200)).body
    const t = tarefaDe(corpo, id)
    expect(t.valorOrcamento).toBe('2000000')
    expect(t.programaOrcado![0]!.valor).toBe('30000')
    const ev = t.historico.find((e) => e.acao === 'registrarOrcamento') as { valor?: unknown }
    expect(ev.valor).toBe('2000000')
    expect(tarefaDe(corpo, pago).pagamento?.valor).toBe('45000')
  })

  it('SEM `valores` (recepção): os quatro caminhos saem `null` — e a jornada continua inteira', async () => {
    const id = await orcado()
    const pago = await realizado()
    await inserirRecebimento(c, pago, c.pacientes['ana']!, 45000n)

    const corpo = (await ficha('juliana').expect(200)).body
    const t = tarefaDe(corpo, id)
    expect(t.valorOrcamento).toBeNull()
    expect(t.programaOrcado![0]!.valor).toBeNull()
    const ev = t.historico.find((e) => e.acao === 'registrarOrcamento') as { valor?: unknown }
    expect(ev.valor).toBeNull()
    const p = tarefaDe(corpo, pago).pagamento
    expect(p).not.toBeNull()
    expect(p!.valor).toBeNull()
    expect(p!.valorAberto).toBeNull()

    // O que NÃO é dinheiro sobrevive: a recepção move o cartão sem ver valor.
    expect(t.etapa).toBe('orcamento')
    expect(t.proximoPassoEm).toBe('2026-10-26')
    expect(t.programaOrcado![0]).toMatchObject({ sessoes: 12, dose: '2,5 mg' })

    // E nenhum número de centavos escapa por um caminho que este teste não
    // nomeou: o corpo inteiro não contém os valores gravados.
    const texto = JSON.stringify(corpo)
    for (const v of ['2000000', '30000', '45000']) expect(texto).not.toContain(`"${v}"`)
  })

  it('a forma da resposta não muda com a permissão — só os valores viram `null`', async () => {
    const id = await orcado()
    const com = tarefaDe((await ficha('beatriz').expect(200)).body, id)
    const sem = tarefaDe((await ficha('juliana').expect(200)).body, id)
    expect(Object.keys(sem).sort()).toEqual(Object.keys(com).sort())
  })
})

/**
 * S-5 / AB-A2-2 — a ficha não é porta lateral para o funil.
 *
 * A ficha exige `pacientes`, não `jornada`, e o perfil é editável. `camila`
 * (Comercial) tem `pacientes` e `valores`, **sem** `jornada`: ela vê a ficha
 * e as tarefas, mas não o histórico da jornada (com a nota em texto livre),
 * nem o dia de retomar, nem o programa orçado (com a dose). A forma da
 * resposta é a mesma de quem tem `jornada` — os blocos vêm vazios, como os
 * três blocos da jornada em Hoje.
 */
describe('S-5 — sem `jornada`, a ficha não traz a jornada', () => {
  it('historico vazio, proximoPassoEm e programaOrcado nulos; a forma não muda', async () => {
    const id = await orcado()
    const sem = tarefaDe((await ficha('camila').expect(200)).body, id)
    expect(sem.historico).toEqual([])
    expect(sem.proximoPassoEm).toBeNull()
    expect(sem.programaOrcado).toBeNull()

    const com = tarefaDe((await ficha('beatriz').expect(200)).body, id)
    expect(com.historico.length).toBeGreaterThan(0)
    expect(Object.keys(sem).sort()).toEqual(Object.keys(com).sort())
    // E o contrato continua valendo para a resposta sem jornada.
    FichaDoPaciente.parse((await ficha('camila').expect(200)).body)
  })

  it('nem a dose nem a nota escapam por outro caminho do corpo', async () => {
    await orcado()
    const texto = JSON.stringify((await ficha('camila').expect(200)).body)
    expect(texto).not.toContain('2,5 mg')
    expect(texto).not.toContain('registrarOrcamento')
  })

  it('a ação da jornada numa tarefa da ficha devolve 403 (AB-A2-2)', async () => {
    const id = await orcado()
    const r = await postar(c, `/v1/tarefas/${id}/jornada`, { acao: 'followUp', nota: 'x' }, 'camila')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(403)
  })
})

describe('AB-A2-3 — ficha de outra clínica', () => {
  it('404, sem nenhum campo da paciente vizinha', async () => {
    const r = await pegar(c, `/v1/pacientes/${c.pacienteDaOutra}`, {}, 'beatriz')
    expect(r.statusCode).toBe(404)
    expect(JSON.stringify(r.body)).not.toContain('Vizinha')
    expect(r.body).not.toHaveProperty('tarefas')
  })
})

describe('L-A2-5 (gate LGPD, teste 3) — tarefa excluída não aparece na ficha', () => {
  it('`excluida_em` preenchida: a tarefa some do Histórico', async () => {
    const viva = await orcado()
    const excluida = await agendado()
    await c.migrate.query('UPDATE tarefas SET excluida_em = now() WHERE id = $1', [excluida])
    const f = (await ficha('beatriz').expect(200)).body as FichaDoPaciente
    expect(f.tarefas.map((t) => t.id)).toEqual([viva])
  })
})

/**
 * AB-A2-4 — a sessão de suporte (operador, D-13) clica "Fechou" pela ficha.
 *
 * O operador VÊ a ficha (`leitorDe`), mas não ASSINA: fechar um orçamento é
 * ritual da clínica, e `autorDe` → `exigePessoa` recusa quem não é pessoa.
 */
describe('AB-A2-4 — sessão de suporte não fecha orçamento pela ficha', () => {
  const SENHA_OP = 'senha-do-operador-da-ficha'
  let operador = ''
  let suporte = ''

  beforeAll(async () => {
    const usuario = `op.ficha.${Date.now()}`
    operador = (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Operador', $2) RETURNING id`,
        [usuario, await hashDeSenha(SENHA_OP)],
      )
    ).rows[0]!.id
    const http = () => request(c.app.getHttpServer())
    const pares = (r: { headers: Record<string, unknown> }): string => {
      const v = r.headers['set-cookie']
      const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
      return lista.map((x) => x.split(';')[0]!).join('; ')
    }
    const painel = pares(
      await http().post('/v1/superadmin/entrar').send({ usuario, senha: SENHA_OP }).expect(200),
    )
    suporte = pares(
      await http()
        .post(`/v1/superadmin/clinicas/${c.clinica}/sessao-de-suporte`)
        .set('Cookie', painel)
        .expect(201),
    )
  })
  afterAll(async () => {
    await declararAtorSistema(c.migrate)
    await c.migrate.query('DELETE FROM tentativas_de_operador WHERE identificador LIKE $1', [
      'op.ficha.%',
    ])
    // A sessão de suporte aponta para o operador; sem apagá-la antes, a FK
    // recusa a limpeza (o arquivo do painel não sente isso porque apaga a
    // clínica primeiro).
    await c.migrate.query('DELETE FROM sessoes WHERE operador_id = $1', [operador])
    if (operador !== '') await apagarOperadorDeTeste(c.migrate, operador)
  })

  it('a ficha abre; o "Fechou" é recusado e o cartão não sai do orçamento', async () => {
    const id = await orcado()
    const http = () => request(c.app.getHttpServer())
    const f = await http().get(`/v1/pacientes/${c.pacientes['ana']}`).set('Cookie', suporte)
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    expect((f.body as FichaDoPaciente).tarefas.map((t) => t.id)).toContain(id)

    const r = await http()
      .post(`/v1/tarefas/${id}/jornada`)
      .set('Cookie', suporte)
      .send({ acao: 'fechar', recebimento: { valor: '100000', forma: 'Pix', valorAberto: '1900000' } })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(403)
    const t = await c.migrate.query<{ etapa: string }>(
      'SELECT etapa::text AS etapa FROM tarefas WHERE id = $1',
      [id],
    )
    expect(t.rows[0]!.etapa).toBe('orcamento')
    const rec = await c.migrate.query('SELECT 1 FROM recebimentos WHERE tarefa_id = $1', [id])
    expect(rec.rowCount).toBe(0)
  })
})
