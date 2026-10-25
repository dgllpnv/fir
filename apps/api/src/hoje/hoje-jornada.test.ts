import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AMANHA,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  ONTEM,
  pegar,
  postar,
  SEGUNDA_DA_SEMANA,
} from '../tarefas/__tests__/cenario'

/**
 * É AQUI QUE A FERRAMENTA DEIXA DE SER UMA LISTA DE TAREFAS.
 *
 * Três blocos novos na resposta da tela Hoje, e os três **calculados no
 * servidor** (`docs/design.md` proíbe conta no front):
 *
 *   `recontatar`    `etapa IN ('faltou','desmarcou')` — ficam TODO DIA, até
 *                   alguém reagendar ou encerrar
 *   `paraConfirmar` `etapa = 'agendado'` e `prazo = hoje + 1`
 *   `retomar`       `etapa = 'orcamento'` e `proximo_passo_em <= hoje`
 *
 * E a regra que não pode faltar, que o épico 2 não tinha como escrever: o
 * cartão em recontato **sai** da seção do dia, das pendentes de dias
 * anteriores e da contagem das bolinhas da semana. Um cartão que faltou há
 * três semanas não é uma tarefa atrasada que alguém esqueceu — é um recontato
 * pendente, e ele já tem seção própria. Misturar os dois faz a recepção ver
 * "15 pendentes" todo dia e parar de olhar.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('hoje-jornada')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
})

type Corpo = Record<string, unknown>

type TarefaDoBloco = {
  id: string
  etapa: string | null
  prazo: string
  proximoPassoEm: string | null
  valorOrcamento: string | null
}

type Hoje = {
  dia: string
  hoje: string
  semana: { dia: string; abertas: number; atrasadas: number }[]
  pendentes: { total: number; itens: TarefaDoBloco[] }
  tarefas: TarefaDoBloco[]
  concluidas: TarefaDoBloco[]
  ocultasPeloFiltro: number
  escopoComAsOcultas: string | null
  recontatar: TarefaDoBloco[]
  paraConfirmar: TarefaDoBloco[]
  retomar: TarefaDoBloco[]
}

const abrirHoje = async (
  consulta: Record<string, string> = {},
  quem = 'juliana',
): Promise<Hoje> => {
  const r = await pegar(c, '/v1/hoje', consulta, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return r.body as Hoje
}

const mover = (id: string, corpo: Corpo, quem = 'juliana') =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, quem)

/** Um agendamento de verdade, pela rota. `paciente` tem padrão `ana`. */
async function agendar(x: {
  prazo?: string
  responsavel?: string
  solicitante?: string
  paciente?: string
} = {}): Promise<string> {
  const quem = x.solicitante ?? 'juliana'
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes[x.paciente ?? 'ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas[x.responsavel ?? quem],
      quando: { modo: 'agendada', prazo: x.prazo ?? HOJE },
    },
    quem,
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.tarefa.id as string
}

/** Um cartão em `orcamento`, com o dia de retomar escolhido. */
async function orcado(retomarEm: string, valor = '360000'): Promise<string> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['juliana'],
      quando: { modo: 'retroativo', em: HOJE },
    },
    'juliana',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  const id = r.body.tarefa.id as string
  await mover(id, { acao: 'registrarOrcamento', valor, retomarEm }).expect(200)
  return id
}

const idsDe = (itens: TarefaDoBloco[]): string[] => itens.map((t) => t.id)
const somaDasBolinhas = (h: Hoje): number =>
  h.semana.reduce((s, d) => s + d.abertas, 0)

const maisDias = (dia: string, n: number): string => {
  const [a, m, d] = dia.split('-').map(Number)
  const t = new Date(Date.UTC(a!, m! - 1, d! + n))
  const dois = (x: number) => String(x).padStart(2, '0')
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`
}

/* ------------------------------------------------------------- recontatar */

describe('RECONTATAR — ficam aqui até reagendar ou encerrar', () => {
  it('faltou e desmarcou ficam em Recontatar, em QUALQUER dia navegado', async () => {
    const id = await agendar({ prazo: HOJE })
    await mover(id, { acao: 'noshow' }).expect(200)

    for (const dia of [HOJE, maisDias(HOJE, 1), maisDias(HOJE, 7), maisDias(HOJE, 30)]) {
      const h = await abrirHoje({ dia })
      expect(idsDe(h.recontatar), `dia ${dia}`).toContain(id)
    }
  })

  it('o cartão desmarcado entra no MESMO bloco do que faltou', async () => {
    const a = await agendar({ prazo: HOJE })
    const b = await agendar({ prazo: HOJE, paciente: 'bruna' })
    await mover(a, { acao: 'noshow' }).expect(200)
    await mover(b, { acao: 'desmarcar', nota: 'viagem' }).expect(200)
    expect(idsDe((await abrirHoje()).recontatar).sort()).toEqual([a, b].sort())
  })

  it('reagendar tira do Recontatar; encerrar também', async () => {
    const a = await agendar({ prazo: HOJE })
    const b = await agendar({ prazo: HOJE, paciente: 'bruna' })
    await mover(a, { acao: 'noshow' }).expect(200)
    await mover(b, { acao: 'desmarcar' }).expect(200)
    expect((await abrirHoje()).recontatar).toHaveLength(2)

    await mover(a, { acao: 'reagendar', prazo: AMANHA }).expect(200)
    await mover(b, { acao: 'encerrar' }).expect(200)
    expect((await abrirHoje()).recontatar).toHaveLength(0)
  })

  it('ordenado pelo passo mais antigo — quem espera há mais tempo vem primeiro', async () => {
    const velho = await agendar({ prazo: HOJE })
    const novo = await agendar({ prazo: HOJE, paciente: 'bruna' })
    await mover(velho, { acao: 'noshow' }).expect(200)
    await mover(novo, { acao: 'noshow' }).expect(200)
    // `noshow` grava `proximo_passo_em = hoje` nos dois; o desempate é o prazo.
    await c.migrate.query('UPDATE tarefas SET proximo_passo_em = $2 WHERE id = $1', [
      velho,
      maisDias(HOJE, -10),
    ])
    expect(idsDe((await abrirHoje()).recontatar)).toEqual([velho, novo])
  })
})

/* -------------------------- o invariante: sai das outras listas, não do banco */

describe('O CARTÃO EM RECONTATO SAI DAS OUTRAS LISTAS', () => {
  it('não conta como pendente, nem nas bolinhas da semana — e não sumiu', async () => {
    // Atrasado: prazo na semana corrente, antes de hoje.
    const atrasado = await agendar({ prazo: SEGUNDA_DA_SEMANA })
    const antes = await abrirHoje()
    expect(idsDe(antes.pendentes.itens)).toContain(atrasado)

    await mover(atrasado, { acao: 'noshow' }).expect(200)
    const depois = await abrirHoje()

    expect(depois.pendentes.total).toBe(antes.pendentes.total - 1)
    expect(somaDasBolinhas(depois)).toBe(somaDasBolinhas(antes) - 1)
    // Não sumiu: MUDOU DE LUGAR. É o invariante do épico — o cartão continua
    // `aberta` no banco, e é a consulta que o manda para a seção certa.
    expect(idsDe(depois.recontatar)).toEqual([atrasado])
  })

  it('não aparece na lista do dia navegado', async () => {
    const id = await agendar({ prazo: HOJE })
    expect(idsDe((await abrirHoje()).tarefas)).toContain(id)
    await mover(id, { acao: 'noshow' }).expect(200)
    const h = await abrirHoje()
    expect(idsDe(h.tarefas)).not.toContain(id)
    expect(idsDe(h.recontatar)).toContain(id)
  })

  it('não conta no aviso "N tarefas não aparecem em Para mim"', async () => {
    // Divergência consciente do protótipo, que NÃO exclui o recontato desta
    // conta: lá o aviso promete cartões que a tela do dia não mostra, e quem
    // toca nele vê uma lista menor do que o número dizia.
    // Juliana pediu, Beatriz executa: o cartão NÃO está em "Para mim" de
    // Juliana (ela não é a responsável), mas está em "Que solicitei" — que é
    // justamente para onde o aviso manda olhar.
    const daOutra = await agendar({ prazo: HOJE, responsavel: 'beatriz', solicitante: 'juliana' })
    const antes = await abrirHoje()
    expect(antes.ocultasPeloFiltro).toBe(1)
    expect(antes.escopoComAsOcultas).toBe('solicitei')

    await mover(daOutra, { acao: 'noshow' }).expect(200)
    expect((await abrirHoje()).ocultasPeloFiltro).toBe(0)
  })
})

/* ---------------------------------------------------------- para confirmar */

describe('PARA CONFIRMAR — os agendamentos de amanhã', () => {
  it('é só AMANHÃ, pelo hoje do SERVIDOR', async () => {
    // `RelogioFixo` em 2026-10-25T02:00:00Z → em America/Bahia ainda é 24/10,
    // então "amanhã" é 25/10 e não 26/10. Com o relógio em UTC, a recepção
    // confirmaria o dia errado (regra 24).
    await agendar({ prazo: HOJE })
    const deAmanha = await agendar({ prazo: AMANHA, paciente: 'bruna' })
    await agendar({ prazo: maisDias(HOJE, 2) })

    const h = await abrirHoje()
    expect(idsDe(h.paraConfirmar)).toEqual([deAmanha])
    expect(h.paraConfirmar[0]!.prazo).toBe(AMANHA)
  })

  it('um agendamento já confirmado sai de paraConfirmar', async () => {
    const id = await agendar({ prazo: AMANHA })
    expect(idsDe((await abrirHoje()).paraConfirmar)).toEqual([id])
    await mover(id, { acao: 'confirmar' }).expect(200)
    expect((await abrirHoje()).paraConfirmar).toHaveLength(0)
  })

  it('enviar a confirmação NÃO tira da lista — a paciente ainda não respondeu', async () => {
    const id = await agendar({ prazo: AMANHA })
    await mover(id, { acao: 'enviarConfirmacao' }).expect(200)
    expect(idsDe((await abrirHoje()).paraConfirmar)).toEqual([id])
  })
})

/* ----------------------------------------------------------------- retomar */

describe('RETOMAR — os orçamentos cujo passo venceu', () => {
  it('só traz o passo VENCIDO, e do mais antigo', async () => {
    const velho = await orcado(maisDias(HOJE, -5))
    const deHoje = await orcado(HOJE)
    const futuro = await orcado(maisDias(HOJE, 3))

    const h = await abrirHoje()
    expect(idsDe(h.retomar)).toEqual([velho, deHoje])
    expect(idsDe(h.retomar)).not.toContain(futuro)
    const dias = h.retomar.map((t) => t.proximoPassoEm)
    expect(dias).toEqual([...dias].sort())
  })

  it('follow-up adia, e o cartão sai de retomar hoje', async () => {
    const id = await orcado(ONTEM)
    expect(idsDe((await abrirHoje()).retomar)).toContain(id)
    await mover(id, { acao: 'followUp', nota: 'vai decidir' }).expect(200)
    expect(idsDe((await abrirHoje()).retomar)).not.toContain(id)
  })

  it('perder tira de retomar — a paciente decidiu', async () => {
    const id = await orcado(ONTEM)
    const motivos = await pegar(c, '/v1/motivos-de-perda', {}, 'juliana').expect(200)
    const motivoId = (motivos.body as { itens: { id: string }[] }).itens[0]!.id
    await mover(id, { acao: 'perder', motivoId }).expect(200)
    expect((await abrirHoje()).retomar).toHaveLength(0)
  })
})

/* ------------------------------------------- escopo, dia navegado e permissão */

describe('os três blocos são do HOJE do servidor, e do filtro de pessoa', () => {
  it('navegar para outra semana não muda Recontatar nem Próximos passos', async () => {
    const faltou = await agendar({ prazo: HOJE })
    await mover(faltou, { acao: 'noshow' }).expect(200)
    await agendar({ prazo: AMANHA, paciente: 'bruna' })
    await orcado(ONTEM)

    const agora = await abrirHoje()
    const passada = await abrirHoje({ dia: maisDias(HOJE, -14) })
    expect(idsDe(passada.recontatar)).toEqual(idsDe(agora.recontatar))
    expect(idsDe(passada.paraConfirmar)).toEqual(idsDe(agora.paraConfirmar))
    expect(idsDe(passada.retomar)).toEqual(idsDe(agora.retomar))
  })

  it('em "Para mim" entra quem é responsável OU solicitante', async () => {
    // A regra frouxa do protótipo (`vePasso`), e ela é de produto: o passo
    // seguinte de um agendamento que EU marquei é meu, mesmo que outra pessoa
    // vá executá-lo.
    const euMarquei = await agendar({ prazo: AMANHA, solicitante: 'juliana', responsavel: 'beatriz' })
    const souResponsavel = await agendar({
      prazo: AMANHA,
      solicitante: 'beatriz',
      responsavel: 'juliana',
      paciente: 'bruna',
    })

    const h = await abrirHoje({ escopo: 'meu' })
    expect(idsDe(h.paraConfirmar).sort()).toEqual([euMarquei, souResponsavel].sort())

    // "Que solicitei" é estrito: só o que eu pedi.
    const s = await abrirHoje({ escopo: 'solicitei' })
    expect(idsDe(s.paraConfirmar)).toEqual([euMarquei])
  })

  it('sem a permissão `jornada`, os três blocos vêm VAZIOS — e o resto não', async () => {
    // Os três cartões são DELA — responsável e solicitante — para que o vazio
    // não possa ser confundido com filtro de pessoa.
    const faltou = await agendar({ prazo: HOJE, responsavel: 'camila', solicitante: 'camila' })
    // Camila não move cartão nenhum: a rota da jornada exige `jornada`.
    await mover(faltou, { acao: 'noshow' }, 'camila').expect(403)
    // Então quem move é Beatriz, que tem a permissão.
    await mover(faltou, { acao: 'noshow' }, 'beatriz').expect(200)
    await agendar({ prazo: AMANHA, responsavel: 'camila', solicitante: 'camila', paciente: 'bruna' })
    // Um cartão comum de hoje, para provar que a tela dela não esvaziou junto.
    await agendar({ prazo: HOJE, responsavel: 'camila', solicitante: 'camila', paciente: 'bruna' })

    // Camila é comercial no cenário: tem `valores`, NÃO tem `jornada`.
    const h = await abrirHoje({}, 'camila')
    expect(h.recontatar).toHaveLength(0)
    expect(h.paraConfirmar).toHaveLength(0)
    expect(h.retomar).toHaveLength(0)
    // E a tela dela continua funcionando: Hoje é de todos (`perm: null`).
    expect(h.tarefas.length).toBeGreaterThan(0)
  })

  it('sem `valores`, o orçamento em retomar vem null — e a lista CONTINUA', async () => {
    const id = await orcado(ONTEM, '360000')
    const h = await abrirHoje({}, 'juliana')
    expect(idsDe(h.retomar)).toEqual([id])
    expect(h.retomar[0]!.valorOrcamento).toBeNull()
    expect(JSON.stringify(h.retomar)).not.toContain('360000')

    // Beatriz tem `valores` e `tarefas.equipe`: para ela o número aparece.
    const b = await abrirHoje({ escopo: 'equipe' }, 'beatriz')
    expect(idsDe(b.retomar)).toEqual([id])
    expect(b.retomar[0]!.valorOrcamento).toBe('360000')
  })
})
