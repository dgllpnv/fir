import type { Relogio } from '@fir/domain'
import { janela } from '@fir/domain'
import type pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashDeSenha } from '../autenticacao/senha'
import { declararAtorSistema } from '../banco/limpeza-de-teste'
import { RELOGIO } from '../comum/relogio'
import { contarConversaoDeOrcamentos } from '../painel-geral/metricas-diarias'
import {
  AGORA,
  type Cenario,
  desmontarCenario,
  FUSO,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
  receitaDoDia,
  tarefaCrua,
} from '../tarefas/__tests__/cenario'

/**
 * CORRIGIR O ORÇAMENTO JÁ ENVIADO — B1 das correções da PO (2026-11-09).
 *
 * Gates: appsec S-24..S-30 (AB-B1-1..8), números N-13..N-18. O que este
 * arquivo prova, contra Postgres real e pela rota HTTP:
 *
 *  - a correção ACRESCENTA `corrigirOrcamento`; o registro original não muda;
 *  - o funil de um mês fechado não muda (`orcamento-corrigido-depois-do-mes`);
 *  - "enviados" não muda, no funil e no Painel;
 *  - sem `valores`, nem o de nem o para atravessam;
 *  - sem `jornada`, 403; cartão alheio sem `tarefas.equipe`, 403; vizinha, 404;
 *  - a corrida com o Fechou serializa pelo `FOR UPDATE`.
 */

/** O relógio que ANDA: o cenário de outubro/novembro precisa de três dias diferentes. */
class RelogioMovel implements Relogio {
  constructor(public instante: Date) {}
  agora(): Date {
    return this.instante
  }
}
const relogio = new RelogioMovel(AGORA)

let c: Cenario

beforeAll(async () => {
  c = await montarCenario('corrigir-orcamento', [{ token: RELOGIO, valor: relogio }])
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  relogio.instante = AGORA
  await limparTarefas(c)
})

type Corpo = Record<string, unknown>
type Retrato = { valor: string | null; retomarEm: string | null; nota: string | null }
type Evento = {
  acao: string
  etapa: string
  em: string
  nota?: string
  valor?: string | null
  de?: Retrato
  para?: Retrato
}
type Tarefa = {
  id: string
  etapa: string | null
  status: string
  proximoPassoEm: string | null
  valorOrcamento: string | null
  historico: Evento[]
}

const mover = (id: string, corpo: Corpo, quem = 'beatriz') =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, quem)
const corpoDe = (r: { body: unknown }): Tarefa => (r.body as { tarefa: Tarefa }).tarefa

let chaves = 0
/** Uma chave de envio nova por formulário aberto — como a tela faz. */
const novaChave = (): string =>
  `00000000-0000-4000-8000-${String(++chaves).padStart(12, '0')}`

const corrigir = (id: string, campos: Corpo, quem = 'beatriz', chave = novaChave()) =>
  mover(id, { acao: 'corrigirOrcamento', chaveIdempotencia: chave, ...campos }, quem)

/** Consulta concluída (retroativa, no dia do relógio) e orçada. */
async function orcado(
  x: { valor?: string; responsavel?: string; programa?: unknown[]; nota?: string; dia?: string } = {},
): Promise<string> {
  const dia = x.dia ?? '2026-10-24'
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas[x.responsavel ?? 'beatriz'],
      quando: { modo: 'retroativo', em: dia },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  const id = r.body.tarefa.id as string
  await mover(id, {
    acao: 'registrarOrcamento',
    valor: x.valor ?? '300000',
    ...(x.programa === undefined ? {} : { programa: x.programa }),
    ...(x.nota === undefined ? {} : { nota: x.nota }),
  }).expect(200)
  return id
}

type Passo = { chave: string; n: number; valor: string | null }
type Funil = {
  funil: Passo[]
  colunas: { chave: string; n: number; valor: string | null }[]
}
const funilDe = async (de: string, ate: string, quem = 'beatriz'): Promise<Funil> => {
  const r = await pegar(c, '/v1/jornada', { periodo: 'per', de, ate }, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return r.body as Funil
}
const enviados = (f: Funil) => f.funil.find((p) => p.chave === 'orcamentosEnviados')!
const emAberto = (f: Funil) => f.colunas.find((x) => x.chave === 'orcamentos')!

const em = (iso: string) => {
  relogio.instante = new Date(iso)
}

/* ------------------------------------------------------- append-only */

describe('a correção é um evento novo — o registro original fica byte a byte igual (N-13)', () => {
  it('historico[0..n-1] idêntico, comprimento n+1, e o último é corrigirOrcamento com de/para', async () => {
    const id = await orcado({ nota: 'programa Tirzepatida' })
    const antes = (await tarefaCrua(c, id))!['historico'] as Evento[]

    const t = corpoDe(
      await corrigir(id, { valor: '30000', retomarEm: '2026-10-30', nota: 'era 300' }).expect(200),
    )

    const depois = (await tarefaCrua(c, id))!['historico'] as Evento[]
    expect(depois).toHaveLength(antes.length + 1)
    expect(depois.slice(0, antes.length)).toEqual(antes)
    expect(depois.at(-1)).toMatchObject({
      acao: 'corrigirOrcamento',
      etapa: 'orcamento',
      de: { valor: '300000', nota: 'programa Tirzepatida' },
      para: { valor: '30000', retomarEm: '2026-10-30', nota: 'era 300' },
    })
    // Dinheiro no jsonb é STRING de centavos (D-4), e não há `valor` no topo.
    expect(typeof depois.at(-1)!.para!.valor).toBe('string')
    expect(depois.at(-1)).not.toHaveProperty('valor')

    // O cartão já diz o valor certo, e a etapa não mexeu.
    expect(t.etapa).toBe('orcamento')
    expect(t.status).toBe('concluida')
    expect(t.valorOrcamento).toBe('30000')
    expect(t.proximoPassoEm).toBe('2026-10-30')
    const crua = (await tarefaCrua(c, id))!
    expect(crua['valor_orcamento']).toBe('30000')
    expect(crua['etapa']).toBe('orcamento')
  })

  it('a correção não é receita: nem recebimento, nem caixa do dia (regra 4)', async () => {
    const id = await orcado()
    const antes = await receitaDoDia(c)
    await corrigir(id, { valor: '30000' }).expect(200)
    expect(await receitaDoDia(c)).toBe(antes)
    const r = await c.migrate.query('SELECT 1 FROM recebimentos WHERE tarefa_id = $1', [id])
    expect(r.rowCount).toBe(0)
  })

  it('o mesmo envio duas vezes (duplo clique/retry): um evento só, mesma resposta (AB-B1-5)', async () => {
    const id = await orcado()
    const chave = novaChave()
    const r1 = await corrigir(id, { valor: '30000' }, 'beatriz', chave).expect(200)
    const r2 = await corrigir(id, { valor: '30000' }, 'beatriz', chave).expect(200)
    expect(corpoDe(r2)).toEqual(corpoDe(r1))
    const h = (await tarefaCrua(c, id))!['historico'] as Evento[]
    expect(h.filter((e) => e.acao === 'corrigirOrcamento')).toHaveLength(1)
  })

  it('o retry de quem NÃO vê valores também é um evento só — ali só a chave protege', async () => {
    // Sem `valores`, mandar valor grava mesmo quando "nada mudou" (senão o
    // histórico viraria oráculo). O que impede o retry de duplicar é a chave.
    const id = await orcado({ responsavel: 'juliana' })
    const chave = novaChave()
    const r1 = await corrigir(id, { valor: '30000' }, 'juliana', chave).expect(200)
    const r2 = await corrigir(id, { valor: '30000' }, 'juliana', chave).expect(200)
    expect(corpoDe(r2)).toEqual(corpoDe(r1))
    const h = (await tarefaCrua(c, id))!['historico'] as Evento[]
    expect(h.filter((e) => e.acao === 'corrigirOrcamento')).toHaveLength(1)
  })
})

/* -------------------------------------------- o funil e os indicadores */

describe('orcamento-corrigido-depois-do-mes (N-14, leitura b)', () => {
  it('R$ 3.000 de 15/10 corrigido para R$ 300 em 05/11 → outubro segue R$ 3.000', async () => {
    em('2026-10-15T15:00:00.000Z')
    const id = await orcado({ valor: '300000', dia: '2026-10-15' })

    em('2026-11-04T15:00:00.000Z')
    const outubroEm0411 = await funilDe('2026-10-01', '2026-10-31')
    expect(enviados(outubroEm0411)).toMatchObject({ n: 1, valor: '300000' })

    em('2026-11-05T15:00:00.000Z')
    await corrigir(id, { valor: '30000' }).expect(200)

    em('2026-11-06T15:00:00.000Z')
    const outubroEm0611 = await funilDe('2026-10-01', '2026-10-31')
    expect(enviados(outubroEm0611)).toMatchObject({ n: 1, valor: '300000' })
    // O mês fechado devolve o MESMO funil inteiro, não só o passo.
    expect(outubroEm0611.funil).toEqual(outubroEm0411.funil)

    // Novembro não conta o orçamento: ele foi ENVIADO em outubro.
    const novembro = await funilDe('2026-11-01', '2026-11-30')
    expect(enviados(novembro)).toMatchObject({ n: 0, valor: '0' })
    // A situação de HOJE é a corrigida.
    expect(emAberto(novembro)).toMatchObject({ n: 1, valor: '30000' })
  })

  it('variante: corrigido em 20/10, outubro mostra o corrigido em 06/11 e em 06/12', async () => {
    em('2026-10-15T15:00:00.000Z')
    const id = await orcado({ valor: '300000', dia: '2026-10-15' })
    em('2026-10-20T15:00:00.000Z')
    await corrigir(id, { valor: '30000' }).expect(200)

    em('2026-11-06T15:00:00.000Z')
    expect(enviados(await funilDe('2026-10-01', '2026-10-31'))).toMatchObject({ n: 1, valor: '30000' })
    em('2026-12-06T15:00:00.000Z')
    expect(enviados(await funilDe('2026-10-01', '2026-10-31'))).toMatchObject({ n: 1, valor: '30000' })
  })

  it('"enviados" não muda com a correção — nem no funil, nem no Painel/carteira', async () => {
    em('2026-10-15T15:00:00.000Z')
    const id = await orcado({ dia: '2026-10-15' })
    const j = janela('2026-10-01', '2026-11-01', FUSO)
    const conversao = () =>
      contarConversaoDeOrcamentos(c.migrate as unknown as pg.PoolClient, c.clinica, j)
    const antes = await conversao()
    expect(antes.enviados).toBe(1)

    em('2026-10-20T15:00:00.000Z')
    await corrigir(id, { valor: '30000' }).expect(200)
    await corrigir(id, { nota: 'segunda correção' }).expect(200)

    expect(await conversao()).toEqual(antes)
    expect(enviados(await funilDe('2026-10-01', '2026-10-31')).n).toBe(1)
  })

  it('corrigir → fechar: o fechamento traz o valor corrigido; receita = só a entrada (N-15)', async () => {
    const id = await orcado({ valor: '300000' })
    await corrigir(id, { valor: '300000' }).expect(200)
    await corrigir(id, { valor: '250000' }).expect(200)
    const antes = await receitaDoDia(c)
    const t = corpoDe(
      await mover(id, {
        acao: 'fechar',
        recebimento: { valor: '100000', forma: 'Pix', valorAberto: '150000' },
      }).expect(200),
    )
    expect(t.etapa).toBe('fechado')
    expect(t.historico.at(-1)).toMatchObject({ acao: 'fechar', valor: '250000' })
    expect((await receitaDoDia(c)) - antes).toBe(100000n)
  })
})

/* ---------------------------------------------------------- recusas */

describe('o que a rota recusa', () => {
  it('perfil sem `jornada` recebe 403 — e nada foi escrito', async () => {
    const id = await orcado()
    // `camila` tem `valores` e NÃO tem `jornada`.
    const r = await corrigir(id, { valor: '30000' }, 'camila')
    expect(r.statusCode).toBe(403)
    expect((await tarefaCrua(c, id))!['valor_orcamento']).toBe('300000')
  })

  it('com `jornada`, sem `tarefas.equipe`, cartão alheio: 403 (AB-B1-2, S-24)', async () => {
    // `juliana` tem `jornada`; o cartão é da `beatriz` (solicitante e responsável).
    const id = await orcado()
    const r = await corrigir(id, { retomarEm: '2026-10-30' }, 'juliana')
    expect(r.statusCode).toBe(403)
    const h = (await tarefaCrua(c, id))!['historico'] as Evento[]
    expect(h.some((e) => e.acao === 'corrigirOrcamento')).toBe(false)
  })

  it('cartão de OUTRA clínica: 404 (AB-B1-7)', async () => {
    const r = await corrigir(c.tarefaDaOutra, { valor: '30000' })
    expect(r.statusCode).toBe(404)
  })

  it('fechado, perdido e realizado: 409, e o histórico não muda (AB-B1-3)', async () => {
    const fechado = await orcado()
    await mover(fechado, {
      acao: 'fechar',
      recebimento: { valor: '100000', forma: 'Pix', valorAberto: '200000' },
    }).expect(200)
    const perdido = await orcado()
    const motivo = await c.migrate.query<{ id: string }>(
      `INSERT INTO motivos_de_perda (clinica_id, nome) VALUES ($1, $2) RETURNING id`,
      [c.clinica, `Preço ${Date.now()}`],
    )
    await mover(perdido, { acao: 'perder', motivoId: motivo.rows[0]!.id }).expect(200)

    for (const id of [fechado, perdido]) {
      const antes = (await tarefaCrua(c, id))!['historico']
      const r = await corrigir(id, { valor: '30000' })
      expect(r.statusCode, id).toBe(409)
      expect((await tarefaCrua(c, id))!['historico']).toEqual(antes)
    }

    const realizado = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'paciente',
        pacienteId: c.pacientes['ana'],
        tipo: 'Consulta agendada',
        responsavelId: c.pessoas['beatriz'],
        quando: { modo: 'retroativo', em: '2026-10-24' },
      },
      'beatriz',
    )
    expect((await corrigir(realizado.body.tarefa.id as string, { valor: '30000' })).statusCode).toBe(409)
  })

  it('retomar antes do hoje DO SERVIDOR é 400 (N-18)', async () => {
    const id = await orcado()
    // AGORA = 2026-10-25T02:00Z → em America/Bahia ainda é 24/10.
    expect((await corrigir(id, { retomarEm: '2026-10-23' })).statusCode).toBe(400)
    expect((await corrigir(id, { retomarEm: '2026-10-24' })).statusCode).toBe(200)
  })

  it('pedido sem nada a corrigir é 400', async () => {
    const id = await orcado()
    expect((await corrigir(id, {})).statusCode).toBe(400)
  })

  it('programa com itens de valor que passam do corrigido: 409 (N-17)', async () => {
    const id = await orcado({
      valor: '360000',
      programa: [
        {
          procedimentoId: '33333333-3333-4333-8333-333333333333',
          sessoes: 4,
          intervaloDias: 7,
          chave: 'a',
          valor: '200000',
        },
      ],
    })
    expect((await corrigir(id, { valor: '199999' })).statusCode).toBe(409)
    expect((await tarefaCrua(c, id))!['valor_orcamento']).toBe('360000')
    expect((await corrigir(id, { valor: '200000' })).statusCode).toBe(200)
  })
})

/* ---------------------------------------------------- a redação */

describe('sem `valores`, nem o de nem o para atravessam (AB-B1-1, AB-B1-6, S-27)', () => {
  it('a resposta e o GET da tarefa não contêm nenhum dos dois valores', async () => {
    // `juliana`: `jornada` SEM `valores`, e RESPONSÁVEL pelo cartão.
    const id = await orcado({ valor: '987654', responsavel: 'juliana' })
    const r = await corrigir(id, { valor: '123456' }, 'juliana').expect(200)
    const t = corpoDe(r)
    const ev = t.historico.at(-1)!
    expect(ev.acao).toBe('corrigirOrcamento')
    expect(ev.de?.valor).toBeNull()
    expect(ev.para?.valor).toBeNull()
    expect(t.valorOrcamento).toBeNull()
    for (const corpo of [JSON.stringify(r.body), JSON.stringify((await pegar(c, `/v1/tarefas/${id}`, {}, 'juliana')).body)]) {
      expect(corpo).not.toContain('987654')
      expect(corpo).not.toContain('123456')
    }
    // E o banco guardou de verdade: a redação é na SAÍDA, não na escrita.
    const h = (await tarefaCrua(c, id))!['historico'] as Evento[]
    expect(h.at(-1)!.para!.valor).toBe('123456')
  })

  /**
   * AB-B1-1 por inteiro: a ficha da paciente e a trilha também.
   *
   * A trilha exige `config`, e nenhuma persona do cenário tem `config` sem
   * `valores` — sem uma, "a auditoria não vaza" seria provado com quem não
   * consegue abri-la (403), que não prova nada. `olga` é criada aqui:
   * `jornada`, `pacientes` e `config`, **sem** `valores`, responsável pelo
   * cartão. O controle positivo (`beatriz`, com `valores`) mostra que os
   * dígitos ESTÃO na trilha e na ficha — sem ele, uma trilha vazia passaria.
   */
  it('a ficha e GET /v1/auditoria também não contêm nenhum dos dois valores', async () => {
    if (c.cookies['olga'] === undefined) {
      const perfil = await c.migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms)
         VALUES ($1, 'pf_cfg', 'Administração sem valores', ARRAY['jornada','pacientes','config'])
         RETURNING id`,
        [c.clinica],
      )
      const senha = 'senha-da-olga-sem-valores'
      const pessoa = await c.migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
         VALUES ($1, 'Olga', 'olga', $2, $3) RETURNING id`,
        [c.clinica, await hashDeSenha(senha), perfil.rows[0]!.id],
      )
      c.pessoas['olga'] = pessoa.rows[0]!.id
      const codigo = (
        await c.migrate.query<{ codigo: string }>('SELECT codigo FROM clinicas WHERE id = $1', [c.clinica])
      ).rows[0]!.codigo
      const r = await request(c.app.getHttpServer())
        .post('/v1/entrar')
        .send({ clinica: codigo, usuario: 'olga', senha })
        .expect(200)
      const v = r.headers['set-cookie'] as unknown
      c.cookies['olga'] = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
    }

    const id = await orcado({ valor: '987654', responsavel: 'olga' })
    await corrigir(id, { valor: '123456' }, 'olga').expect(200)

    const ficha = (quem: string) => pegar(c, `/v1/pacientes/${c.pacientes['ana']}`, {}, quem)
    const trilha = (quem: string) =>
      pegar(c, '/v1/auditoria', { entidade: 'tarefas', entidadeId: id, limite: '200' }, quem)

    // Controle positivo: com `valores`, os dois valores estão lá.
    for (const r of [await ficha('beatriz'), await trilha('beatriz')]) {
      expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
      expect(JSON.stringify(r.body)).toContain('987654')
      expect(JSON.stringify(r.body)).toContain('123456')
    }
    // Sem `valores`: 200 (ela abre as duas), e nenhum dos dígitos atravessa.
    for (const r of [await ficha('olga'), await trilha('olga')]) {
      expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
      const corpo = JSON.stringify(r.body)
      expect(corpo).not.toContain('987654')
      expect(corpo).not.toContain('123456')
    }
  })

  it('mandar o valor certo e o errado dá a MESMA forma e o MESMO status (AB-B1-6)', async () => {
    const a = await orcado({ valor: '500000', responsavel: 'juliana' })
    const b = await orcado({ valor: '500000', responsavel: 'juliana' })
    const certo = await corrigir(a, { valor: '500000' }, 'juliana')
    const errado = await corrigir(b, { valor: '400000' }, 'juliana')
    expect(certo.statusCode).toBe(errado.statusCode)
    const forma = (t: Tarefa) => ({
      chaves: Object.keys(t).sort(),
      eventos: t.historico.map((e) => `${e.acao}:${Object.keys(e).sort().join(',')}`),
    })
    expect(forma(corpoDe(certo))).toEqual(forma(corpoDe(errado)))
  })

  it('com `valores`, o mesmo evento traz de e para', async () => {
    const id = await orcado({ valor: '987654' })
    const t = corpoDe(await corrigir(id, { valor: '123456' }).expect(200))
    expect(t.historico.at(-1)).toMatchObject({ de: { valor: '987654' }, para: { valor: '123456' } })
  })
})

/* ---------------------------------------------- a corrida com o Fechou */

describe('a corrida com Fechou/Perdeu serializa pelo FOR UPDATE (S-29, N-18, AB-B1-4)', () => {
  it('o Fechou que pega a linha primeiro vence: a correção espera e cai em 409', async () => {
    const id = await orcado()
    // Um segundo cliente segura a linha e fecha o cartão, como faria o Fechou
    // de outra recepcionista no mesmo instante.
    const outro = await (async () => {
      const { Client } = (await import('pg')).default
      const cl = new Client({
        connectionString:
          process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir',
      })
      await cl.connect()
      await declararAtorSistema(cl)
      return cl
    })()
    try {
      await outro.query('BEGIN')
      await outro.query('SELECT 1 FROM tarefas WHERE id = $1 FOR UPDATE', [id])

      const pendente = corrigir(id, { valor: '30000' }).then((r) => r)
      // A correção chega e fica esperando a linha.
      await new Promise((ok) => setTimeout(ok, 400))

      await outro.query(
        `UPDATE tarefas
            SET etapa = 'fechado',
                historico = historico || $2::jsonb
          WHERE id = $1`,
        [
          id,
          JSON.stringify([
            {
              acao: 'fechar',
              etapa: 'fechado',
              em: AGORA.toISOString(),
              porId: c.pessoas['beatriz'],
              valor: '300000',
            },
          ]),
        ],
      )
      await outro.query('COMMIT')

      const r = await pendente
      expect(r.statusCode, JSON.stringify(r.body)).toBe(409)
      const crua = (await tarefaCrua(c, id))!
      expect(crua['etapa']).toBe('fechado')
      expect(crua['valor_orcamento']).toBe('300000')
      const h = crua['historico'] as Evento[]
      expect(h.some((e) => e.acao === 'corrigirOrcamento')).toBe(false)
    } finally {
      await outro.query('ROLLBACK').catch(() => undefined)
      await outro.end()
    }
  })

  it('em paralelo de verdade, o estado final é coerente nas duas ordens', async () => {
    for (let i = 0; i < 4; i++) {
      const id = await orcado()
      const [corr, fecha] = await Promise.all([
        corrigir(id, { valor: '250000' }),
        mover(id, {
          acao: 'fechar',
          recebimento: { valor: '100000', forma: 'Pix', valorAberto: '0' },
          // Quatro fechamentos da mesma paciente no mesmo dia: o aviso de
          // duplicidade (D-21) é verdadeiro e não é o que este teste mede.
          confirmarDuplicidade: true,
        }),
      ])
      expect(fecha.statusCode, JSON.stringify(fecha.body)).toBe(200)
      const crua = (await tarefaCrua(c, id))!
      const h = crua['historico'] as Evento[]
      const iFechar = h.findIndex((e) => e.acao === 'fechar')
      const iCorr = h.findIndex((e) => e.acao === 'corrigirOrcamento')
      expect(crua['etapa']).toBe('fechado')
      if (corr.statusCode === 200) {
        // A correção veio antes, e o Fechou congelou o corrigido.
        expect(iCorr).toBeLessThan(iFechar)
        expect(h[iFechar]!.valor).toBe('250000')
      } else {
        expect(corr.statusCode).toBe(409)
        expect(iCorr).toBe(-1)
        expect(h[iFechar]!.valor).toBe('300000')
      }
      expect(crua['valor_orcamento']).toBe(h[iFechar]!.valor)
    }
  })
})
