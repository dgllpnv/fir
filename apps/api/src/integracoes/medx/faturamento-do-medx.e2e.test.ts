import type { Relogio } from '@fir/domain'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BancoService } from '../../banco/banco.service'
import type { ClinicaId } from '../../banco/clinica-id'
import { AGORA, type Cenario, desmontarCenario, FUSO, montarCenario } from '../../tarefas/__tests__/cenario'
import { AberturaDeIntegracoes, SeloDeIntegracoes } from '../cofre-de-integracoes'
import { ErroDoMedx, MENSAGENS_DO_MEDX } from './erros'
import { FaturamentoDoMedx, MENSAGENS_DO_FATURAMENTO } from './faturamento-do-medx'
import { LeitorDoMedx } from './leitor-do-medx'
import type { Pedido, Transporte } from './transporte'

/**
 * O faturamento lido do MedX (spec integracao-medx C.1–C.7; ticket T5; parecer
 * de números), contra Postgres REAL e um MedX falso em memória.
 *
 * AGORA = 25/10 02:00Z = 24/10 23:00 na clínica (Bahia). A leitura de toda
 * hora cobre 01/09 a 24/10: 54 dias.
 */
type Lanc = { pagamento: string | null; valor: string; faturaId?: number | null }

const CHAVE = 'medx_chave_do_faturamento_0123456789ab'
const DIAS_DA_HORARIA = 54
/** 23:30 na clínica: ainda 24/10. Uma hora depois já seria outro dia, com um dia a mais na leitura. */
const MEIA_HORA_DEPOIS = new Date(AGORA.getTime() + 30 * 60_000)
let c: Cenario
let banco: BancoService
let clinica: ClinicaId
const relogio: { instante: Date } & Relogio = {
  instante: AGORA,
  agora() {
    return this.instante
  },
}

let medx: { lancamentos: Map<number, Lanc>; porPagina: number; falharPagina?: number; escopos: string }
const pedidos: Pedido[] = []

const paginaDe = (p: Pedido): string => {
  const de = p.query?.['PagamentoInicio'] ?? ''
  const ate = p.query?.['PagamentoFim'] ?? ''
  const todos = [...medx.lancamentos.entries()]
    // O MedX filtra pela data do pagamento; quem não pagou não vem com status=pago.
    .filter(([, l]) => l.pagamento !== null && l.pagamento >= de && l.pagamento <= ate)
    .sort(([x], [y]) => x - y)
  const n = Number((p.query?.['Cursor'] ?? 'p0').slice(1))
  if (medx.falharPagina !== undefined && n + 1 === medx.falharPagina) throw new ErroDoMedx('indisponivel')
  const fatia = todos.slice(n * medx.porPagina, (n + 1) * medx.porPagina)
  const hasMore = (n + 1) * medx.porPagina < todos.length
  // JSON montado à mão: o número sai com o TEXTO exato (zeros à direita,
  // 4 casas), como o MedX manda — `JSON.stringify` não reproduz isso.
  const items = fatia.map(
    ([id, l]) =>
      `{"id":${id},"vencimento":"2026-01-01","pagamento":${l.pagamento === null ? 'null' : `"${l.pagamento}"`},` +
      `"valorOriginal":${l.valor},"valorPago":7.77,"saldo":0,"tipo":"receber","status":"pago",` +
      `"paciente":{"id":9,"nome":"Paciente Secreta"},"conta":"Conta X","subgrupo":"Botox",` +
      `"faturaId":${l.faturaId === undefined ? 900 + id : l.faturaId === null ? 'null' : l.faturaId}}`,
  )
  return `{"items":[${items.join(',')}],"page":{"limit":${medx.porPagina},"hasMore":${hasMore},"nextCursor":${hasMore ? `"p${n + 1}"` : 'null'}}}`
}

const transporte: Transporte = async (p) => {
  pedidos.push(p)
  if (p.metodo === 'POST' && p.caminho === '/token') {
    return JSON.stringify({ accessToken: 'jwt', expiresInSeconds: 900, scope: medx.escopos })
  }
  if (p.caminho === '/financas/lancamentos') return paginaDe(p)
  throw new Error(`rota inesperada ${p.caminho}`)
}

const abertura = AberturaDeIntegracoes.doAmbiente()
let leitor: LeitorDoMedx
const ler = () => new FaturamentoDoMedx(banco, abertura, leitor, relogio).lerClinica(clinica, FUSO)

type Linha = { dia: string; faturamento_lido: string; faturamento_exato: string; quantidade: number; lido_em: Date }
const leituras = async (): Promise<Linha[]> =>
  (
    await c.migrate.query<Linha>(
      `SELECT dia::text AS dia, faturamento_lido::text AS faturamento_lido, faturamento_exato::text AS faturamento_exato,
              quantidade_de_pagamentos AS quantidade, lido_em
         FROM leituras_de_faturamento_externo WHERE clinica_id = $1 ORDER BY dia`,
      [c.clinica],
    )
  ).rows
const doDia = async (dia: string) => (await leituras()).find((l) => l.dia === dia)
const historico = async () =>
  (
    await c.migrate.query(
      `SELECT dia::text AS dia, faturamento_anterior::text AS anterior, faturamento_lido::text AS lido,
              quantidade_de_pagamentos_anterior AS quantidade_anterior, quantidade_de_pagamentos AS quantidade, mes_fechado
         FROM historico_de_faturamento_externo WHERE clinica_id = $1 ORDER BY em, dia`,
      [c.clinica],
    )
  ).rows
const estado = async () =>
  (
    await c.migrate.query(
      `SELECT faturamento_ultima_leitura_em, faturamento_ultimo_sucesso_em, faturamento_ultimo_erro,
              faturamento_releitura_em, faturamento_fuso_lido
         FROM integracoes_da_clinica WHERE clinica_id = $1`,
      [c.clinica],
    )
  ).rows[0]
const trilha = async (entidade: string) =>
  Number(
    (await c.migrate.query('SELECT count(*) FROM auditoria WHERE clinica_id = $1 AND entidade = $2', [c.clinica, entidade]))
      .rows[0].count,
  )
const pedidosDeLancamentos = () => pedidos.filter((p) => p.caminho === '/financas/lancamentos')

/** Marca a releitura completa como já feita hoje: o ciclo de teste é o de toda hora. */
const releituraFeitaHoje = () =>
  c.migrate.query(
    `UPDATE integracoes_da_clinica SET faturamento_releitura_em = $2, faturamento_fuso_lido = $3 WHERE clinica_id = $1`,
    [c.clinica, AGORA, FUSO],
  )

beforeAll(async () => {
  c = await montarCenario('medx-faturamento')
  banco = new BancoService()
  clinica = c.clinica as ClinicaId
})
afterAll(async () => {
  for (const t of ['historico_de_faturamento_externo', 'leituras_de_faturamento_externo', 'integracoes_da_clinica']) {
    await c.migrate.query(`DELETE FROM ${t} WHERE clinica_id = ANY($1)`, [[c.clinica, c.outraClinica]])
  }
  await banco.onModuleDestroy()
  await desmontarCenario(c)
})
beforeEach(async () => {
  relogio.instante = AGORA
  leitor = new LeitorDoMedx(transporte)
  pedidos.length = 0
  medx = { lancamentos: new Map(), porPagina: 100, escopos: 'agenda:read lancamentos:read' }
  for (const t of ['historico_de_faturamento_externo', 'leituras_de_faturamento_externo', 'integracoes_da_clinica']) {
    await c.migrate.query(`DELETE FROM ${t} WHERE clinica_id = $1`, [c.clinica])
  }
  const selo = SeloDeIntegracoes.doAmbiente()
  const s = selo.selar(c.clinica, 'medx', CHAVE)
  await c.migrate.query(
    `INSERT INTO integracoes_da_clinica
       (clinica_id, provedor, segredo_cifrado, segredo_versao, final_da_chave, impressao_da_chave,
        termo_assinado_em, termo_assinado_por, termo_versao, verificacao, verificada_em, conta_externa_id,
        escopos, unidades_externas, faturamento_ligado)
     VALUES ($1, 'medx', $2, $3, '89ab', $4, '2026-10-01', 'Dra. X', 'v1', 'ok', now(), $5,
             '{agenda:read,lancamentos:read}', 1, true)`,
    [c.clinica, s.cifrado, s.versao, selo.impressao('medx', CHAVE), `conta-fat-${c.clinica}`],
  )
  await releituraFeitaHoje()
})

describe('a leitura de toda hora', () => {
  it('um total por dia, inclusive os de zero; o valor é o TEXTO de valorOriginal', async () => {
    medx.lancamentos.set(1, { pagamento: '2026-10-20T10:00:00', valor: '100.50' })
    medx.lancamentos.set(2, { pagamento: '2026-10-20T15:30:00', valor: '33.3350' })
    medx.lancamentos.set(3, { pagamento: '2026-09-01T00:00:00', valor: '1.250' })
    expect(await ler()).toEqual({ tipo: 'ok', dias: DIAS_DA_HORARIA, pagamentos: 3, completa: false })

    const ls = await leituras()
    expect(ls).toHaveLength(DIAS_DA_HORARIA)
    expect(ls[0]!.dia).toBe('2026-09-01')
    expect(ls.at(-1)!.dia).toBe('2026-10-24')
    // 100,50 + 33,3350 → 100,50 + 33,34 (arredondado por pagamento, A9).
    expect(await doDia('2026-10-20')).toMatchObject({ faturamento_lido: '13384', faturamento_exato: '1338350', quantidade: 2 })
    // "1.250" num JSON é R$ 1,25 — nunca R$ 1.250,00 (N-B4).
    expect(await doDia('2026-09-01')).toMatchObject({ faturamento_lido: '125', faturamento_exato: '12500', quantidade: 1 })
    expect(await doDia('2026-10-21')).toMatchObject({ faturamento_lido: '0', quantidade: 0 })
    expect(ls.every((l) => l.lido_em.getTime() === AGORA.getTime())).toBe(true)

    // Lista branca (B.0): nem o paciente nem a conta chegam ao banco ou à trilha.
    const tudo = JSON.stringify((await c.migrate.query('SELECT de, para FROM auditoria WHERE clinica_id = $1', [c.clinica])).rows)
    for (const proibido of ['Paciente Secreta', 'Conta X', 'Botox']) expect(tudo).not.toContain(proibido)

    expect(await estado()).toMatchObject({
      faturamento_ultima_leitura_em: AGORA,
      faturamento_ultimo_sucesso_em: AGORA,
      faturamento_ultimo_erro: '',
    })
  })

  it('pede só contas a receber pagas, pela data do pagamento, com a janela alargada um dia de cada lado', async () => {
    await ler()
    const [p, ...resto] = pedidosDeLancamentos()
    expect(resto).toHaveLength(0)
    expect(p!.query).toEqual({
      Tipo: 'receber',
      Status: 'pago',
      // 31/08 00:00 a 25/10 23:59:59, no relógio do MedX (−03:00).
      PagamentoInicio: '2026-08-31T00:00:00',
      PagamentoFim: '2026-10-25T23:59:59',
      Limit: '100',
    })
  })

  it('o que não é de fatura não conta (orçamento, lançamento manual), e nem o valor zero', async () => {
    medx.lancamentos.set(1, { pagamento: '2026-10-20T10:00:00', valor: '500.00', faturaId: null })
    medx.lancamentos.set(2, { pagamento: '2026-10-20T10:00:00', valor: '0.00' })
    medx.lancamentos.set(3, { pagamento: '2026-10-20T10:00:00', valor: '80' })
    expect(await ler()).toMatchObject({ tipo: 'ok', pagamentos: 1 })
    expect(await doDia('2026-10-20')).toMatchObject({ faturamento_lido: '8000', quantidade: 1 })
  })

  it('o pagamento das 23:30 cai no dia da clínica, não no dia UTC', async () => {
    // 23:30 em −03:00 = 02:30Z do dia seguinte; na Bahia, ainda o mesmo dia.
    medx.lancamentos.set(1, { pagamento: '2026-10-19T23:30:00', valor: '10' })
    await ler()
    expect(await doDia('2026-10-19')).toMatchObject({ faturamento_lido: '1000', quantidade: 1 })
  })

  it('páginas e janelas que se sobrepõem não contam o mesmo lançamento duas vezes', async () => {
    medx.porPagina = 2
    for (let i = 1; i <= 5; i++) medx.lancamentos.set(i, { pagamento: `2026-10-0${i}T09:00:00`, valor: '10' })
    expect(await ler()).toMatchObject({ tipo: 'ok', pagamentos: 5 })
    expect(pedidosDeLancamentos()).toHaveLength(3)
    const total = (await leituras()).reduce((s, l) => s + BigInt(l.faturamento_lido), 0n)
    expect(total).toBe(5000n)
  })

  it('três leituras iguais: nenhuma linha nova, nenhum histórico, nenhuma trilha nova (propriedade 11)', async () => {
    medx.lancamentos.set(1, { pagamento: '2026-10-20T10:00:00', valor: '100' })
    // A trilha é append-only e atravessa os testes: mede-se o que ESTE acrescenta.
    const trilhaDoInicio = await trilha('leituras_de_faturamento_externo')
    await ler()
    const trilhaAntes = await trilha('leituras_de_faturamento_externo')
    expect(trilhaAntes - trilhaDoInicio).toBe(DIAS_DA_HORARIA)
    for (const minutos of [20, 40]) {
      relogio.instante = new Date(AGORA.getTime() + minutos * 60_000)
      expect(await ler()).toMatchObject({ tipo: 'ok' })
    }
    expect(await leituras()).toHaveLength(DIAS_DA_HORARIA)
    expect(await historico()).toEqual([])
    expect(await trilha('leituras_de_faturamento_externo')).toBe(trilhaAntes)
    // O dia que não mudou não é regravado: o `lido_em` é o da leitura que pôs
    // o valor; a última leitura da clínica está no estado da integração.
    expect((await doDia('2026-10-20'))!.lido_em).toEqual(AGORA)
    expect(await estado()).toMatchObject({ faturamento_ultimo_sucesso_em: relogio.instante })
  })
})

describe('o dia muda no MedX', () => {
  it('o único pagamento do dia estornado: o dia volta a zero, com histórico', async () => {
    medx.lancamentos.set(1, { pagamento: '2026-10-20T10:00:00', valor: '100' })
    medx.lancamentos.set(2, { pagamento: '2026-10-22T10:00:00', valor: '50' })
    await ler()
    const [leiturasAntes, historicoAntes] = [
      await trilha('leituras_de_faturamento_externo'),
      await trilha('historico_de_faturamento_externo'),
    ]
    medx.lancamentos.delete(1)
    relogio.instante = MEIA_HORA_DEPOIS
    expect(await ler()).toMatchObject({ tipo: 'ok', pagamentos: 1 })
    expect(await doDia('2026-10-20')).toMatchObject({ faturamento_lido: '0', quantidade: 0 })
    expect(await historico()).toEqual([
      { dia: '2026-10-20', anterior: '10000', lido: '0', quantidade_anterior: 1, quantidade: 0, mes_fechado: false },
    ])
    // A regravação que MUDOU entra na trilha; as 53 que não mudaram, não.
    expect((await trilha('leituras_de_faturamento_externo')) - leiturasAntes).toBe(1)
    expect((await trilha('historico_de_faturamento_externo')) - historicoAntes).toBe(1)
  })

  it('mudança num mês que já acabou fica marcada (mes_fechado)', async () => {
    medx.lancamentos.set(1, { pagamento: '2026-09-15T10:00:00', valor: '100' })
    await ler()
    medx.lancamentos.set(2, { pagamento: '2026-09-15T11:00:00', valor: '20.10' })
    relogio.instante = MEIA_HORA_DEPOIS
    await ler()
    expect(await historico()).toEqual([
      { dia: '2026-09-15', anterior: '10000', lido: '12010', quantidade_anterior: 1, quantidade: 2, mes_fechado: true },
    ])
  })

  it('a última leitura vale; uma que começou ANTES não grava por cima (A5)', async () => {
    medx.lancamentos.set(1, { pagamento: '2026-10-20T10:00:00', valor: '100' })
    relogio.instante = MEIA_HORA_DEPOIS
    await ler()
    // Uma leitura mais velha (começou às 02:00Z) termina depois, com o dado velho.
    medx.lancamentos.set(1, { pagamento: '2026-10-20T10:00:00', valor: '999' })
    relogio.instante = AGORA
    expect(await ler()).toEqual({ tipo: 'superada' })
    expect(await doDia('2026-10-20')).toMatchObject({ faturamento_lido: '10000' })
    expect(await estado()).toMatchObject({ faturamento_ultimo_sucesso_em: MEIA_HORA_DEPOIS })
    expect(await historico()).toEqual([])
  })
})

describe('tudo ou nada', () => {
  it('a página 2 de 3 falha: nada muda, e o erro é do catálogo', async () => {
    medx.porPagina = 1
    medx.lancamentos.set(1, { pagamento: '2026-10-01T09:00:00', valor: '10' })
    await ler()
    const antes = await leituras()
    for (let i = 1; i <= 3; i++) medx.lancamentos.set(i, { pagamento: `2026-10-0${i}T09:00:00`, valor: '77' })
    medx.falharPagina = 2
    relogio.instante = MEIA_HORA_DEPOIS
    expect(await ler()).toEqual({ tipo: 'falhou', erro: MENSAGENS_DO_MEDX.indisponivel })
    expect(await leituras()).toEqual(antes)
    expect(await historico()).toEqual([])
    expect(await estado()).toMatchObject({
      faturamento_ultima_leitura_em: relogio.instante,
      faturamento_ultimo_sucesso_em: AGORA,
      faturamento_ultimo_erro: MENSAGENS_DO_MEDX.indisponivel,
    })
  })

  it('leitura vazia onde antes havia pagamentos: aborta e não zera nada (N-B3.4)', async () => {
    medx.lancamentos.set(1, { pagamento: '2026-10-20T10:00:00', valor: '100' })
    await ler()
    const antes = await leituras()
    medx.lancamentos.clear()
    relogio.instante = MEIA_HORA_DEPOIS
    expect(await ler()).toEqual({ tipo: 'falhou', erro: MENSAGENS_DO_FATURAMENTO.vazia })
    expect(await leituras()).toEqual(antes)
    expect((await estado()).faturamento_ultimo_erro).toBe(MENSAGENS_DO_FATURAMENTO.vazia)
  })

  it('leitura vazia numa clínica sem pagamento nenhum é só zero, não erro', async () => {
    expect(await ler()).toMatchObject({ tipo: 'ok', pagamentos: 0 })
    expect(await leituras()).toHaveLength(DIAS_DA_HORARIA)
  })

  it('valor fora da gramática (expoente): aborta o ciclo, nada gravado', async () => {
    medx.lancamentos.set(1, { pagamento: '2026-10-20T10:00:00', valor: '1e3' })
    expect(await ler()).toEqual({ tipo: 'falhou', erro: MENSAGENS_DO_MEDX.contrato })
    expect(await leituras()).toEqual([])
  })

  it('sem a permissão de lançamentos: falha com a mensagem própria, sem pedir lançamento', async () => {
    medx.escopos = 'agenda:read'
    expect(await ler()).toEqual({ tipo: 'falhou', erro: MENSAGENS_DO_FATURAMENTO.sem_escopo })
    expect(pedidosDeLancamentos()).toHaveLength(0)
    expect(await leituras()).toEqual([])
  })

  it('faturamento desligado: nenhuma chamada ao MedX', async () => {
    await c.migrate.query('UPDATE integracoes_da_clinica SET faturamento_ligado = false WHERE clinica_id = $1', [c.clinica])
    expect(await ler()).toEqual({ tipo: 'desligado' })
    expect(pedidos).toHaveLength(0)
  })
})

describe('a releitura completa (13 meses)', () => {
  it('na primeira leitura: de 01/10 do ano passado até hoje, em janelas de até 85 dias', async () => {
    await c.migrate.query(
      'UPDATE integracoes_da_clinica SET faturamento_releitura_em = NULL, faturamento_fuso_lido = NULL WHERE clinica_id = $1',
      [c.clinica],
    )
    medx.lancamentos.set(1, { pagamento: '2025-10-01T08:00:00', valor: '10' })
    const r = await ler()
    expect(r).toMatchObject({ tipo: 'ok', completa: true, dias: 389, pagamentos: 1 })
    const ps = pedidosDeLancamentos()
    expect(ps).toHaveLength(5)
    expect(ps[0]!.query?.['PagamentoInicio']).toBe('2025-09-30T00:00:00')
    // Janelas contíguas: o fim de uma (alargado) cobre o início da próxima.
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i]!.query!['PagamentoInicio']! <= ps[i - 1]!.query!['PagamentoFim']!).toBe(true)
    }
    expect(await doDia('2025-10-01')).toMatchObject({ faturamento_lido: '1000' })
    expect(await estado()).toMatchObject({ faturamento_releitura_em: AGORA, faturamento_fuso_lido: FUSO })

    // Meia hora depois, no mesmo dia: só a leitura de toda hora.
    pedidos.length = 0
    relogio.instante = MEIA_HORA_DEPOIS
    expect(await ler()).toMatchObject({ completa: false })
    expect(pedidosDeLancamentos()).toHaveLength(1)
  })

  it('o fuso da clínica mudou: relê tudo (o dia de cada pagamento mudou)', async () => {
    await c.migrate.query('UPDATE integracoes_da_clinica SET faturamento_fuso_lido = $2 WHERE clinica_id = $1', [
      c.clinica,
      'America/Manaus',
    ])
    expect(await ler()).toMatchObject({ completa: true })
  })

  it('no dia seguinte, só depois das 02:00 da clínica', async () => {
    // 25/10 04:30Z = 01:30 na Bahia: ainda não.
    relogio.instante = new Date('2026-10-25T04:30:00Z')
    expect(await ler()).toMatchObject({ completa: false })
    // 25/10 05:10Z = 02:10 na Bahia: agora sim.
    relogio.instante = new Date('2026-10-25T05:10:00Z')
    expect(await ler()).toMatchObject({ completa: true })
  })
})
