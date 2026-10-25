import { ACOES_DO_FUNIL } from '@fir/domain'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ACAO_DO_PASSO, ACOES_DOS_KPIS } from './funil.service'
import {
  AMANHA,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
  receitaDoDia,
} from '../tarefas/__tests__/cenario'

/**
 * O FUNIL CONTA POR `acao` DECLARADA, não por inferência de rótulo.
 *
 * O protótipo infere "isto conta?" da ausência de um rótulo no evento
 * (`!x.rot`), o que funciona por coincidência: `reagendar` tem rótulo **e**
 * muda de etapa, então ele não conta por acidente, não por decisão. Aqui a
 * propriedade é `contaNoFunil`, declarada na tabela de transições de
 * `packages/domain`, e o evento guarda a `acao` que o produziu.
 *
 * O que isso protege: se `reagendar` contasse, quem remarcou três vezes
 * apareceria como três agendamentos, o denominador inflaria, e TODA conversão
 * do funil cairia sem que nada tivesse piorado na clínica.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('funil')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
})

type Corpo = Record<string, unknown>

type Passo = {
  chave: string
  rotulo: string
  n: number
  valor: string | null
  rotuloDoValor: string
  conversao: number | null
  conversaoSobre: string
  proporcao: number
}

type Coluna = {
  chave: string
  rotulo: string
  n: number
  valor: string | null
  itens: { id: string; valorOrcamento: string | null; etapa: string }[]
  restantes: number
}

type Funil = {
  de: string
  ate: string
  rotuloDoPeriodo: string
  hoje: string
  funil: Passo[]
  noShow: { n: number; taxa: number | null }
  desmarcados: { n: number }
  perdidos: { n: number; valor: string | null }
  colunas: Coluna[]
}

const mover = (id: string, corpo: Corpo, quem = 'beatriz') =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, quem)

const abrirFunil = async (
  consulta: Record<string, string> = {},
  quem = 'beatriz',
): Promise<Funil> => {
  const r = await pegar(c, '/v1/jornada', consulta, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return r.body as Funil
}

const passo = (f: Funil, chave: string): Passo => {
  const achado = f.funil.find((p) => p.chave === chave)
  expect(achado, `passo ${chave} ausente`).toBeDefined()
  return achado!
}

const coluna = (f: Funil, chave: string): Coluna => {
  const achada = f.colunas.find((x) => x.chave === chave)
  expect(achada, `coluna ${chave} ausente`).toBeDefined()
  return achada!
}

async function agendar(x: { prazo?: string; paciente?: string; responsavel?: string } = {}) {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes[x.paciente ?? 'ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas[x.responsavel ?? 'beatriz'],
      quando: { modo: 'agendada', prazo: x.prazo ?? HOJE },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.tarefa.id as string
}

/** Uma consulta lançada retroativa: nasce em `realizado`, com evento `concluir`. */
async function realizado(paciente = 'ana') {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes[paciente],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['beatriz'],
      quando: { modo: 'retroativo', em: HOJE },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.tarefa.id as string
}

async function orcado(valor = '360000', paciente = 'ana') {
  const id = await realizado(paciente)
  await mover(id, { acao: 'registrarOrcamento', valor }).expect(200)
  return id
}

const motivoId = async (): Promise<string> => {
  const r = await pegar(c, '/v1/motivos-de-perda', {}, 'beatriz').expect(200)
  return (r.body as { itens: { id: string }[] }).itens[0]!.id
}

/**
 * Carimba o instante de um evento do histórico, no banco.
 *
 * O `RelogioFixo` do cenário grava todo evento em 2026-10-25T02:00:00Z, e a
 * borda da janela só se mede com instantes escolhidos. Nenhuma rota permite
 * escolher o instante de um evento — com razão: a data de negócio é do
 * servidor (regra 24).
 */
async function carimbar(id: string, acao: string, instanteIso: string): Promise<void> {
  await c.migrate.query(
    `UPDATE tarefas SET historico = (
       SELECT jsonb_agg(
         CASE WHEN ev->>'acao' = $2 THEN jsonb_set(ev, '{em}', to_jsonb($3::text)) ELSE ev END
         ORDER BY ord)
         FROM jsonb_array_elements(historico) WITH ORDINALITY AS t(ev, ord)
     ) WHERE id = $1`,
    [id, acao, instanteIso],
  )
}

const ids = (col: Coluna): string[] => col.itens.map((x) => x.id)
const MES_INTEIRO = { periodo: 'per', de: '2026-10-01', ate: '2026-10-31' }

/* ------------------------------------------------ o que NÃO conta no funil */

describe('O FUNIL CONTA POR AÇÃO DECLARADA', () => {
  it('REAGENDAR NÃO CONTA COMO AGENDAMENTO NOVO', async () => {
    const id = await agendar()
    expect(passo(await abrirFunil(MES_INTEIRO), 'agendados').n).toBe(1)

    await mover(id, { acao: 'noshow' }).expect(200)
    await mover(id, { acao: 'reagendar', prazo: AMANHA }).expect(200)
    await mover(id, { acao: 'noshow' }).expect(200)
    await mover(id, { acao: 'reagendar', prazo: AMANHA }).expect(200)

    // Se contasse, quem remarcou duas vezes apareceria como três
    // agendamentos, e toda conversão do funil cairia sem nada ter piorado.
    expect(passo(await abrirFunil(MES_INTEIRO), 'agendados').n).toBe(1)
  })

  it('enviar confirmação NÃO conta como confirmação', async () => {
    const id = await agendar()
    await mover(id, { acao: 'enviarConfirmacao' }).expect(200)
    await mover(id, { acao: 'enviarConfirmacao' }).expect(200)
    expect(passo(await abrirFunil(MES_INTEIRO), 'confirmados').n).toBe(0)

    await mover(id, { acao: 'confirmar' }).expect(200)
    expect(passo(await abrirFunil(MES_INTEIRO), 'confirmados').n).toBe(1)
  })

  it('follow-up NÃO conta como orçamento novo', async () => {
    const id = await orcado()
    expect(passo(await abrirFunil(MES_INTEIRO), 'orcamentosEnviados').n).toBe(1)
    await mover(id, { acao: 'followUp', nota: 'vai pensar' }).expect(200)
    await mover(id, { acao: 'followUp', nota: 'vai decidir sexta' }).expect(200)
    expect(passo(await abrirFunil(MES_INTEIRO), 'orcamentosEnviados').n).toBe(1)
  })

  it('encerrar não conta em passo nenhum', async () => {
    const id = await agendar()
    await mover(id, { acao: 'desmarcar' }).expect(200)
    await mover(id, { acao: 'encerrar' }).expect(200)
    const f = await abrirFunil(MES_INTEIRO)
    expect(f.desmarcados.n).toBe(1)
    expect(f.funil.map((p) => p.n)).toEqual([1, 0, 0, 0, 0]) // só o `agendar`
  })
})

/* ---------------------------------------------------------------- a janela */

describe('a janela é semiaberta, com as bordas no fuso DA CLÍNICA', () => {
  it('o último instante do dia entra; o primeiro do seguinte não', async () => {
    const dentro = await agendar()
    const fora = await agendar({ paciente: 'bruna' })
    await mover(dentro, { acao: 'confirmar' }).expect(200)
    await mover(fora, { acao: 'confirmar' }).expect(200)
    await carimbar(dentro, 'confirmar', '2026-10-24T23:59:59.999-03:00')
    await carimbar(fora, 'confirmar', '2026-10-25T00:00:00.000-03:00')

    const f = await abrirFunil({ periodo: 'per', de: '2026-10-24', ate: '2026-10-24' })
    expect(passo(f, 'confirmados').n).toBe(1)
  })

  it('o servidor NOMEIA o período que resolveu, e devolve as bordas', async () => {
    const f = await abrirFunil({ periodo: '30dias' })
    expect(f.ate).toBe(HOJE)
    expect(f.de).toBe('2026-09-25')
    expect(f.rotuloDoPeriodo).toBe('Últimos 30 dias')
    expect(f.hoje).toBe(HOJE)
  })
})

/* ------------------------------------------------------------------- KPIs */

describe('os três KPIs', () => {
  it('a taxa de no-show é faltou ÷ (realizado + faltou), em pontos percentuais', async () => {
    // 2 faltas e 7 realizados → 2/9 = 22,2% → 22.
    for (let i = 0; i < 2; i++) {
      const id = await agendar({ paciente: i === 0 ? 'ana' : 'bruna' })
      await mover(id, { acao: 'noshow' }).expect(200)
    }
    for (let i = 0; i < 7; i++) await realizado()

    const f = await abrirFunil(MES_INTEIRO)
    expect(f.noShow).toMatchObject({ n: 2, taxa: 22 })
    // NÃO sobre agendados: um agendamento que ainda vai acontecer não deveria
    // piorar a taxa de hoje.
    expect(passo(f, 'agendados').n).toBe(9)
  })

  it('sem denominador, a taxa é null — nunca zero', async () => {
    // Zero diria "nenhuma falta", e a verdade é "não houve atendimento".
    const f = await abrirFunil(MES_INTEIRO)
    expect(f.noShow).toEqual({ n: 0, taxa: null })
  })

  it('o valor dos perdidos é o ORÇADO, e nunca entra em receita', async () => {
    const a = await orcado('450000')
    await mover(a, { acao: 'perder', motivoId: await motivoId() }).expect(200)

    const f = await abrirFunil(MES_INTEIRO)
    expect(f.perdidos).toEqual({ n: 1, valor: '450000' })
    expect(await receitaDoDia(c)).toBe(0n)
  })

  it('desmarcados conta `desmarcar`, e no-show conta `noshow` — não se misturam', async () => {
    const a = await agendar()
    const b = await agendar({ paciente: 'bruna' })
    await mover(a, { acao: 'noshow' }).expect(200)
    await mover(b, { acao: 'desmarcar' }).expect(200)
    const f = await abrirFunil(MES_INTEIRO)
    expect(f.noShow.n).toBe(1)
    expect(f.desmarcados.n).toBe(1)
  })
})

/* ------------------------------------------------------- valor por passo */

describe('cada passo mede o SEU valor', () => {
  it('"fechados" conta o valor FECHADO, não o recebido', async () => {
    const id = await orcado('360000')
    await mover(id, {
      acao: 'fechar',
      recebimento: { valor: '100000', forma: 'Pix', valorAberto: '260000' },
    }).expect(200)

    const f = await abrirFunil(MES_INTEIRO)
    // Entrada de R$ 1.000 num orçamento de R$ 3.600: fechados = 360000. O
    // recebido é da tela Recebimentos, e as duas medem coisas diferentes.
    expect(passo(f, 'fechados')).toMatchObject({ n: 1, valor: '360000', rotuloDoValor: 'fechado' })
    expect(await receitaDoDia(c)).toBe(100000n)
  })

  it('"realizados" conta o RECEBIDO no atendimento', async () => {
    const r = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'paciente',
        pacienteId: c.pacientes['ana'],
        tipo: 'Consulta agendada',
        responsavelId: c.pessoas['beatriz'],
        quando: {
          modo: 'retroativo',
          em: HOJE,
          pagamento: { valor: '45000', forma: 'Pix' },
        },
      },
      'beatriz',
    )
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    const f = await abrirFunil(MES_INTEIRO)
    expect(passo(f, 'realizados')).toMatchObject({ n: 1, valor: '45000', rotuloDoValor: 'recebido' })
  })

  it('"orçamentos enviados" soma o valor do evento — e não vira receita', async () => {
    await orcado('360000')
    await orcado('140000', 'bruna')
    const f = await abrirFunil(MES_INTEIRO)
    expect(passo(f, 'orcamentosEnviados')).toMatchObject({ n: 2, valor: '500000' })
    expect(await receitaDoDia(c)).toBe(0n)
  })

  it('agendados e confirmados não têm valor — contar não é faturar', async () => {
    const id = await agendar()
    await mover(id, { acao: 'confirmar' }).expect(200)
    const f = await abrirFunil(MES_INTEIRO)
    for (const chave of ['agendados', 'confirmados']) {
      expect(passo(f, chave).valor, chave).toBeNull()
      expect(passo(f, chave).rotuloDoValor, chave).toBe('')
    }
  })
})

/* ----------------------------------------------------------- a conversão */

describe('a conversão é calculada no SERVIDOR', () => {
  it('cada passo diz sobre o que ele converte, e a barra vem pronta', async () => {
    // 4 agendados; 2 confirmados; 2 realizados; 1 orçamento; 1 fechado.
    const a = await agendar()
    const b = await agendar({ paciente: 'bruna' })
    await agendar()
    await agendar()
    await mover(a, { acao: 'confirmar' }).expect(200)
    await mover(b, { acao: 'confirmar' }).expect(200)
    // `concluir` NÃO é ação desta rota — é o `POST /v1/tarefas/:id/concluir`
    // do épico 2, e o contrato o recusa no parse (400), não no serviço. Um
    // segundo caminho para a mesma transição é sempre o que diverge.
    await mover(a, { acao: 'concluir', em: HOJE } as Corpo).expect(400)
    await postar(c, `/v1/tarefas/${a}/concluir`, { em: HOJE }, 'beatriz').expect(200)
    await postar(c, `/v1/tarefas/${b}/concluir`, { em: HOJE }, 'beatriz').expect(200)
    await mover(a, { acao: 'registrarOrcamento', valor: '100000' }).expect(200)
    await mover(a, {
      acao: 'fechar',
      recebimento: { valor: '100000', forma: 'Pix' },
    }).expect(200)

    const f = await abrirFunil(MES_INTEIRO)
    expect(passo(f, 'agendados')).toMatchObject({ n: 4, conversao: null, proporcao: 100 })
    expect(passo(f, 'confirmados')).toMatchObject({ n: 2, conversao: 50, conversaoSobre: 'dos agendados' })
    expect(passo(f, 'realizados')).toMatchObject({ n: 2, conversao: 50, conversaoSobre: 'dos agendados' })
    expect(passo(f, 'orcamentosEnviados')).toMatchObject({
      n: 1,
      conversao: 50,
      conversaoSobre: 'dos realizados',
    })
    expect(passo(f, 'fechados')).toMatchObject({ n: 1, conversao: 100, conversaoSobre: 'dos orçamentos' })
  })

  it('sem orçamento no período, "fechados" converte sobre os REALIZADOS', async () => {
    const id = await realizado()
    await realizado('bruna')
    await mover(id, { acao: 'fechar', recebimento: { valor: '20000', forma: 'Pix' } }).expect(200)
    const f = await abrirFunil(MES_INTEIRO)
    expect(passo(f, 'fechados')).toMatchObject({ conversao: 50, conversaoSobre: 'dos realizados' })
  })
})

/* -------------------------------------------------------------- as colunas */

describe('as colunas mostram HOJE; o funil, o período', () => {
  it('nada no período, mas os cartões continuam nas colunas', async () => {
    await agendar()
    const f = await abrirFunil({ periodo: 'per', de: '2026-09-01', ate: '2026-09-02' })
    expect(passo(f, 'agendados').n).toBe(0)
    expect(coluna(f, 'agendadas').n).toBe(1)
  })

  it('a coluna Recontatar junta faltou e desmarcou, e exclui o encerrado', async () => {
    const a = await agendar()
    const b = await agendar({ paciente: 'bruna' })
    const d = await agendar()
    await mover(a, { acao: 'noshow' }).expect(200)
    await mover(b, { acao: 'desmarcar' }).expect(200)
    await mover(d, { acao: 'desmarcar' }).expect(200)
    await mover(d, { acao: 'encerrar' }).expect(200)

    expect(ids(coluna(await abrirFunil(MES_INTEIRO), 'recontatar')).sort()).toEqual([a, b].sort())
  })

  it('as colunas de período (realizadas, fechados, perdidos) respeitam a janela', async () => {
    const id = await orcado('450000')
    await mover(id, { acao: 'perder', motivoId: await motivoId() }).expect(200)

    expect(coluna(await abrirFunil(MES_INTEIRO), 'perdidos').n).toBe(1)
    const outro = await abrirFunil({ periodo: 'per', de: '2026-09-01', ate: '2026-09-02' })
    expect(coluna(outro, 'perdidos').n).toBe(0)
  })

  it('as três colunas de orçamento somam o valor; as outras vêm null', async () => {
    await orcado('360000')
    await agendar({ paciente: 'bruna' })
    const f = await abrirFunil(MES_INTEIRO)
    expect(coluna(f, 'orcamentos')).toMatchObject({ n: 1, valor: '360000' })
    expect(coluna(f, 'agendadas').valor).toBeNull()
    expect(coluna(f, 'confirmadas').valor).toBeNull()
  })

  it('as sete colunas vêm sempre, na ordem, inclusive vazias', async () => {
    const f = await abrirFunil(MES_INTEIRO)
    expect(f.colunas.map((x) => x.chave)).toEqual([
      'agendadas',
      'confirmadas',
      'recontatar',
      'realizadas',
      'orcamentos',
      'fechados',
      'perdidos',
    ])
    expect(f.colunas.every((x) => x.n === 0 && x.itens.length === 0)).toBe(true)
  })

  it('a coluna corta em 30 e diz quantos sobraram', async () => {
    for (let i = 0; i < 32; i++) await agendar()
    const col = coluna(await abrirFunil(MES_INTEIRO), 'agendadas')
    expect(col.n).toBe(32)
    expect(col.itens).toHaveLength(30)
    expect(col.restantes).toBe(2)
  })
})

/* ------------------------------------------------- filtros, permissão e RLS */

describe('filtros, permissão e isolamento', () => {
  it('o filtro de pessoa é responsável OU solicitante', async () => {
    // Beatriz cria; Juliana é a responsável de um deles.
    await agendar()
    const dela = await agendar({ paciente: 'bruna', responsavel: 'juliana' })
    const f = await abrirFunil({ ...MES_INTEIRO, responsavelId: c.pessoas['juliana']! })
    expect(passo(f, 'agendados').n).toBe(1)
    expect(ids(coluna(f, 'agendadas'))).toEqual([dela])
  })

  it('sem `valores`: as CONTAGENS ficam, os valores vêm null', async () => {
    await orcado('360000')
    // Juliana é recepção: tem `jornada`, não tem `valores`.
    const f = await abrirFunil(MES_INTEIRO, 'juliana')
    expect(passo(f, 'orcamentosEnviados').n).toBe(1)
    expect(passo(f, 'orcamentosEnviados').valor).toBeNull()
    expect(coluna(f, 'orcamentos').itens[0]!.valorOrcamento).toBeNull()
    expect(JSON.stringify(f)).not.toContain('360000')
  })

  it('sem a permissão `jornada`, 403', async () => {
    // Camila tem `valores` e NÃO tem `jornada`.
    const r = await pegar(c, '/v1/jornada', MES_INTEIRO, 'camila')
    expect(r.statusCode).toBe(403)
  })

  it('sem sessão, 401', async () => {
    const r = await pegar(c, '/v1/jornada', MES_INTEIRO, 'ninguem')
    expect(r.statusCode).toBe(401)
  })

  it('o funil não enxerga cartão de outra clínica', async () => {
    await agendar()
    const f = await abrirFunil(MES_INTEIRO)
    expect(passo(f, 'agendados').n).toBe(1)
    expect(ids(coluna(f, 'agendadas'))).not.toContain(c.tarefaDaOutra)
  })

  it('período inválido é 400, e não um funil silenciosamente errado', async () => {
    const r = await pegar(c, '/v1/jornada', { periodo: 'qualquer' }, 'beatriz')
    expect(r.statusCode).toBe(400)
  })
})

/* ------------------------------------------------- a tabela não tem buraco */

describe('as oito ações que contam estão todas declaradas', () => {
  it('os cinco passos mais os três KPIs são exatamente ACOES_DO_FUNIL', () => {
    /**
     * `ACOES_DO_FUNIL` é DERIVADO da tabela de transições do domínio: marcar
     * uma transição nova com `contaNoFunil: true` a acrescenta sozinha. Sem
     * este teste, ela entraria na lista, não teria passo nem KPI, e sumiria do
     * relatório — contada no SQL, descartada no TypeScript, sem erro nenhum.
     */
    const declaradas = [...Object.values(ACAO_DO_PASSO), ...ACOES_DOS_KPIS]
    expect([...declaradas].sort()).toEqual([...ACOES_DO_FUNIL].sort())
  })
})
