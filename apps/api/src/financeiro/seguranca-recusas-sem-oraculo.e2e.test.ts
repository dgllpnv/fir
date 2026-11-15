import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparProgramas,
  montarCenario,
  postar,
} from '../tarefas/__tests__/cenario'
import { criarPersona } from '../tarefas/__tests__/persona-extra'

/**
 * **A RECUSA QUE DEPENDE DE VALOR OCULTO É A ÚLTIMA** — achados F1, F2 e F8.
 *
 * Quem não tem `valores` recebe os campos de dinheiro apagados. Mas se uma
 * comparação com um valor oculto (a dívida, a oferta, um recebimento igual)
 * recusasse ANTES de uma recusa neutra (caixa fechado, campanha inexistente),
 * a pessoa provocaria a neutra e leria pelo CÓDIGO da resposta de que lado do
 * valor oculto o número dela caiu — sem gravar nada. Bisseção: o número exato
 * em ~30 pedidos.
 *
 * Cada teste aqui manda o MESMO pedido com um valor ABAIXO e outro ACIMA do
 * valor oculto, com uma recusa neutra armada, e exige respostas IDÊNTICAS.
 *
 * Postgres real. Relógio do cenário: hoje da clínica é 24/10.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('seguranca-recusas')
  // `jornada` + `receber` sem `valores`: o perfil de balcão dos achados.
  await criarPersona(c, 'fechador', ['pacientes', 'jornada', 'receber'])
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparFinanceiro(c)
  await limparProgramas(c)
})

/* ----------------------------------------------------------------- ajudas */

type Resposta = { statusCode: number; body: unknown; text: string }

/** Status e corpo inteiros iguais — nada que distinga um lado do outro. */
const identicas = (a: Resposta, b: Resposta, status: number): void => {
  expect(a.statusCode, a.text).toBe(status)
  expect(b.statusCode, b.text).toBe(a.statusCode)
  expect(b.body).toEqual(a.body)
}

const caixaDeHojeFechado = async (): Promise<void> => {
  await c.migrate.query(
    `INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1,$2,'',$3)`,
    [c.clinica, HOJE, c.pessoas['beatriz']],
  )
}

/** Um recebimento vivo de HOJE para a Ana, escrito direto no banco. */
const recebimentoDeHoje = async (valor: string): Promise<void> => {
  await c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
     VALUES ($1,$2,'Pagamento de consulta',$3,'Pix',0,'2026-10-24T12:00:00-03:00',$4)`,
    [c.clinica, c.pacientes['ana'], valor, c.pessoas['beatriz']],
  )
}

const contarRecebimentos = async (): Promise<number> => {
  const r = await c.migrate.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM recebimentos WHERE clinica_id = $1',
    [c.clinica],
  )
  return Number(r.rows[0]!.n)
}

const avulso = (x: Record<string, unknown>, quem: string) =>
  postar(
    c,
    '/v1/recebimentos',
    { requisicaoId: randomUUID(), pacienteId: c.pacientes['ana'], em: HOJE, ...x },
    quem,
  )

/* ================================================================== F2 */

describe('F2 — "Saldo em aberto" em várias formas não revela a dívida', () => {
  // Dívida de R$ 400,00 no grupo geral (consulta de R$ 100 com R$ 400 em aberto).
  const divida400 = async () => {
    const r = await avulso({ ref: 'consulta', valor: '10000', forma: 'Pix', valorAberto: '40000' }, 'beatriz')
    expect(r.statusCode, r.text).toBe(201)
  }
  // Valores que não colidem com o R$ 100 da dívida (senão o aviso de
  // duplicidade entraria no meio e o teste mediria outra coisa).
  const ABAIXO = [
    { forma: 'Pix', valor: '20000' },
    { forma: 'Dinheiro', valor: '10000' },
  ] // 300 < 400
  const ACIMA = [
    { forma: 'Pix', valor: '30000' },
    { forma: 'Dinheiro', valor: '20000' },
  ] // 500 > 400
  const saldo = (partes: typeof ABAIXO, extra: Record<string, unknown> = {}) =>
    avulso(
      {
        ref: 'saldo',
        valor: partes.reduce((s, p) => s + BigInt(p.valor), 0n).toString(),
        partes,
        ...extra,
      },
      'rita',
    )

  it('com o caixa do dia fechado: abaixo e acima da dívida dão o MESMO 409 de caixa, e nada é gravado', async () => {
    await divida400()
    await caixaDeHojeFechado()
    const antes = await contarRecebimentos()
    const abaixo = await saldo(ABAIXO)
    const acima = await saldo(ACIMA)
    identicas(abaixo, acima, 409)
    expect((abaixo.body as { avisos: string[] }).avisos).toEqual(['CAIXA_FECHADO'])
    expect(await contarRecebimentos()).toBe(antes)
  })

  it('com uma campanha que não existe: abaixo e acima da dívida dão o MESMO 400', async () => {
    await divida400()
    const campanhaId = randomUUID()
    const abaixo = await saldo(ABAIXO, { campanhaId })
    const acima = await saldo(ACIMA, { campanhaId })
    identicas(abaixo, acima, 400)
    expect(await contarRecebimentos()).toBe(1)
  })

  it('com tudo o mais válido, a recusa que sobra é a da dívida — e ela não leva o devido', async () => {
    await divida400()
    const r = await saldo(ACIMA)
    expect(r.statusCode, r.text).toBe(409)
    expect((r.body as { codigo: string }).codigo).toBe('PARTES_ACIMA_DA_DIVIDA')
    expect(r.text).not.toContain('40000')
    expect(await contarRecebimentos()).toBe(1)
  })
})

/* ================================================================== F8 */

// Onde NÃO há comparação com valor oculto depois dela, a duplicidade é a última
// recusa. No `fechar` e no `saldo` ela vem antes da comparação, de propósito
// (resíduo F8 aceito, `docs/dividas.md`).
describe('F8 — no avulso, o aviso de duplicidade não responde "existe um pagamento de X?" sem gravar', () => {
  it('campanha inexistente: valor IGUAL e valor diferente de um recebimento de hoje dão o MESMO 400', async () => {
    await recebimentoDeHoje('15000')
    const campanhaId = randomUUID()
    const igual = await avulso({ ref: 'consulta', valor: '15000', forma: 'Pix', campanhaId }, 'rita')
    const outro = await avulso({ ref: 'consulta', valor: '15001', forma: 'Pix', campanhaId }, 'rita')
    identicas(igual, outro, 400)
    expect(await contarRecebimentos()).toBe(1)
  })

  it('caixa fechado: a lista de avisos é SÓ o caixa, haja ou não um pagamento igual', async () => {
    await recebimentoDeHoje('15000')
    await caixaDeHojeFechado()
    const igual = await avulso({ ref: 'consulta', valor: '15000', forma: 'Pix' }, 'rita')
    const outro = await avulso({ ref: 'consulta', valor: '15001', forma: 'Pix' }, 'rita')
    identicas(igual, outro, 409)
    expect((igual.body as { avisos: string[] }).avisos).toEqual(['CAIXA_FECHADO'])
  })

  it('a duplicidade continua avisada — depois do caixa confirmado, logo antes de gravar', async () => {
    await recebimentoDeHoje('15000')
    await caixaDeHojeFechado()
    const r = await avulso(
      { ref: 'consulta', valor: '15000', forma: 'Pix', confirmarCaixaFechado: true },
      'rita',
    )
    expect(r.statusCode, r.text).toBe(409)
    expect((r.body as { avisos: string[] }).avisos).toEqual(['POSSIVEL_DUPLICIDADE'])
  })
})

/* ================================================================== F1 */

describe('F1 — fechar sem `valores` não revela a oferta por recusas que vinham depois dela', () => {
  const OFERTA = '2500000'

  /** Um orçamento de R$ 25.000,00 num atendimento realizado hoje, da Ana. */
  const orcamento = async (): Promise<string> => {
    const r = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'paciente',
        pacienteId: c.pacientes['ana'],
        tipo: 'Consulta agendada',
        responsavelId: c.pessoas['fechador'],
        quando: { modo: 'retroativo', em: HOJE },
      },
      'beatriz',
    )
    expect(r.statusCode, r.text).toBe(201)
    const id = r.body.tarefa.id as string
    const o = await postar(c, `/v1/tarefas/${id}/jornada`, { acao: 'registrarOrcamento', valor: OFERTA }, 'beatriz')
    expect(o.statusCode, o.text).toBe(200)
    return id
  }

  const fechar = (id: string, corpo: Record<string, unknown>) =>
    postar(c, `/v1/tarefas/${id}/jornada`, { acao: 'fechar', fechamento: 'parte', ...corpo }, 'fechador')

  const etapa = async (id: string): Promise<string> =>
    (
      await c.migrate.query<{ etapa: string }>('SELECT etapa::text AS etapa FROM tarefas WHERE id = $1', [id])
    ).rows[0]!.etapa

  it('caixa de hoje fechado: parcial abaixo e acima da oferta dão o MESMO 409 de caixa', async () => {
    const id = await orcamento()
    await caixaDeHojeFechado()
    const abaixo = await fechar(id, { recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '0' } })
    const acima = await fechar(id, { recebimento: { valor: '3000000', forma: 'Pix', valorAberto: '0' } })
    identicas(abaixo, acima, 409)
    expect((abaixo.body as { avisos: string[] }).avisos).toEqual(['CAIXA_FECHADO'])
    expect(await contarRecebimentos()).toBe(0)
    expect(await etapa(id)).toBe('orcamento')
  })

  it('pagamento igual já lançado hoje: variando só o "em aberto", abaixo e acima dão o MESMO 409', async () => {
    // O ataque do relatório: fixa a entrada no valor de um recebimento que já
    // existe (o aviso de duplicidade fica armado) e bisecta pelo em aberto.
    const id = await orcamento()
    await recebimentoDeHoje('500000')
    const abaixo = await fechar(id, { recebimento: { valor: '500000', forma: 'Pix', valorAberto: '0' } })
    const acima = await fechar(id, { recebimento: { valor: '500000', forma: 'Pix', valorAberto: '2500000' } })
    identicas(abaixo, acima, 409)
    expect((abaixo.body as { avisos: string[] }).avisos).toEqual(['POSSIVEL_DUPLICIDADE'])
    expect(await contarRecebimentos()).toBe(1)
    expect(await etapa(id)).toBe('orcamento')
  })

  it('confirmados os avisos, só GRAVAR distingue: acima recusa sem número e desfaz tudo; abaixo fecha', async () => {
    const id = await orcamento()
    await caixaDeHojeFechado()
    const confirmado = { confirmarCaixaFechado: true }
    const acima = await fechar(id, {
      recebimento: { valor: '3000000', forma: 'Pix', valorAberto: '0' },
      ...confirmado,
    })
    expect(acima.statusCode, acima.text).toBe(400)
    expect(acima.text).not.toMatch(/25\.000|2500000|30\.000|3000000/)
    // A recusa veio DEPOIS das escritas, e a transação inteira voltou.
    expect(await contarRecebimentos()).toBe(0)
    expect(await etapa(id)).toBe('orcamento')

    const abaixo = await fechar(id, {
      recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '0' },
      ...confirmado,
    })
    expect(abaixo.statusCode, abaixo.text).toBe(200)
    expect(await contarRecebimentos()).toBe(1)
    expect(await etapa(id)).toBe('fechado')
  })
})
