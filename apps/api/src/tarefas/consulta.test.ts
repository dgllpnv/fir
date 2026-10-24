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
} from './__tests__/cenario'

let c: Cenario

beforeAll(async () => {
  c = await montarCenario('consulta')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
})

type Semente = {
  prazo?: string | undefined
  status?: 'aberta' | 'concluida' | 'cancelada' | undefined
  /** Instante ISO com fuso explícito. Obrigatório quando `status=concluida`. */
  concluidaEm?: string | undefined
  responsavel?: string | undefined
  solicitante?: string | undefined
  descricao?: string | undefined
  paciente?: string | undefined
  tipo?: string | undefined
  unidade?: string | undefined
  obs?: string | undefined
}

/**
 * Semeia uma tarefa DIRETO no banco.
 *
 * Pela rota seria mais fiel, mas estes testes precisam de tarefas concluídas
 * em instantes precisos — inclusive o último milissegundo de um dia — e a
 * rota (com razão) só carimba o instante que o relógio do servidor permite.
 */
async function semear(s: Semente): Promise<string> {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em,
        paciente_id, tipo, unidade_id, obs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      c.clinica,
      s.solicitante ?? c.pessoas['juliana'],
      s.responsavel ?? c.pessoas['juliana'],
      s.descricao ?? 'Tarefa semeada',
      s.prazo ?? HOJE,
      s.status ?? 'aberta',
      s.concluidaEm ?? null,
      s.paciente ?? null,
      s.paciente === undefined ? '' : (s.tipo ?? 'Follow-up'),
      s.unidade ?? null,
      s.obs ?? '',
    ],
  )
  return r.rows[0]!.id
}

const listar = (consulta: Record<string, string> = {}, quem = 'juliana') =>
  pegar(c, '/v1/tarefas', consulta, quem)

const hoje = (consulta: Record<string, string> = {}, quem = 'juliana') =>
  pegar(c, '/v1/hoje', consulta, quem)

const ids = (corpo: { tarefas: { id: string }[] }): string[] => corpo.tarefas.map((t) => t.id)

describe('GET /v1/tarefas · a janela [início, fim)', () => {
  it('a janela é semiaberta: o último instante do dia entra, o primeiro do seguinte não', async () => {
    const dentro = await semear({
      prazo: HOJE,
      status: 'concluida',
      concluidaEm: '2026-10-24T23:59:59.999-03:00',
    })
    await semear({
      prazo: HOJE,
      status: 'concluida',
      concluidaEm: '2026-10-25T00:00:00.000-03:00',
    })

    const r = await listar({ periodo: 'per', de: HOJE, ate: HOJE }).expect(200)
    expect(ids(r.body)).toEqual([dentro])
  })

  it('o período usa `concluida_em` das concluídas e `prazo` das abertas', async () => {
    // Uma tarefa com prazo 20/10 concluída em 24/10 aparece no período do dia
    // 24, NÃO no do dia 20. É o que o MANUAL manda, e é o que a recepção
    // espera quando confere o que fez hoje.
    const t = await semear({
      prazo: '2026-10-20',
      status: 'concluida',
      concluidaEm: '2026-10-24T12:00:00-03:00',
    })
    const noVinte = await listar({ periodo: 'per', de: '2026-10-20', ate: '2026-10-20' })
    expect(ids(noVinte.body)).not.toContain(t)
    const noVinteQuatro = await listar({ periodo: 'per', de: HOJE, ate: HOJE })
    expect(ids(noVinteQuatro.body)).toContain(t)
  })

  it('as bordas são calculadas no fuso DA CLÍNICA, não em UTC', async () => {
    // 2026-10-25T02:00Z ainda é 23:00 de 24/10 em America/Bahia. Em UTC esta
    // tarefa cairia no dia 25; na clínica, no dia 24 — e é a clínica que manda.
    const t = await semear({
      prazo: HOJE,
      status: 'concluida',
      concluidaEm: '2026-10-25T02:00:00Z',
    })
    expect(ids((await listar({ periodo: 'per', de: HOJE, ate: HOJE })).body)).toContain(t)
    expect(ids((await listar({ periodo: 'per', de: AMANHA, ate: AMANHA })).body)).not.toContain(t)
  })

  it('a tarefa ABERTA é filtrada pelo PRAZO, mesmo num período de dias passados', async () => {
    const t = await semear({ prazo: '2026-10-20' })
    expect(ids((await listar({ periodo: 'per', de: '2026-10-20', ate: '2026-10-20' })).body)).toEqual([t])
  })

  it('`periodo=7dias` conta a partir do hoje DO SERVIDOR', async () => {
    const dentro = await semear({ prazo: '2026-10-18' })
    const fora = await semear({ prazo: '2026-10-17' })
    const r = await listar({ periodo: '7dias' })
    expect(ids(r.body)).toContain(dentro)
    expect(ids(r.body)).not.toContain(fora)
  })

  it('a resposta traz o dia de hoje — a tela nunca o calcula', async () => {
    const r = await listar().expect(200)
    expect(r.body.hoje).toBe(HOJE)
  })
})

describe('GET /v1/tarefas · escopo, situação e filtros', () => {
  it('`escopo=equipe` sem `tarefas.equipe` é 403', async () => {
    expect((await listar({ escopo: 'equipe' }, 'juliana')).statusCode).toBe(403)
    expect((await listar({ escopo: 'equipe' }, 'beatriz')).statusCode).toBe(200)
  })

  it('`meu` é por responsável; `solicitei` é por quem pediu', async () => {
    const minha = await semear({
      responsavel: c.pessoas['juliana'],
      solicitante: c.pessoas['beatriz'],
    })
    const pedida = await semear({
      responsavel: c.pessoas['camila'],
      solicitante: c.pessoas['juliana'],
    })

    expect(ids((await listar({ escopo: 'meu' })).body)).toEqual([minha])
    expect(ids((await listar({ escopo: 'solicitei' })).body)).toEqual([pedida])
    expect(ids((await listar({ escopo: 'equipe' }, 'beatriz')).body).sort()).toEqual(
      [minha, pedida].sort(),
    )
  })

  it('filtrar por OUTRA pessoa exige `tarefas.equipe`, mesmo no escopo `meu`', async () => {
    // Sem isso, o filtro de responsável seria a porta dos fundos do escopo:
    // quem não pode ver "Equipe toda" veria a agenda de qualquer colega
    // escolhendo o nome dela na lista suspensa — sem passar por `escopo`.
    //
    // O `escopo` fica no padrão de propósito: com `escopo=equipe` este teste
    // passaria pelo 403 do PRÓPRIO escopo e não provaria nada sobre o filtro
    // de pessoa. Medido: com a checagem de pessoa desligada, a versão com
    // `escopo=equipe` continuava verde.
    expect((await listar({ responsavelId: c.pessoas['camila']! }, 'juliana')).statusCode).toBe(403)
    expect((await listar({ solicitanteId: c.pessoas['camila']! }, 'juliana')).statusCode).toBe(403)
    // Filtrar por si mesma é inofensivo e continua passando.
    expect((await listar({ responsavelId: c.pessoas['juliana']! }, 'juliana')).statusCode).toBe(200)
    // E quem acompanha a equipe filtra por quem quiser.
    expect(
      (await listar({ escopo: 'equipe', responsavelId: c.pessoas['camila']! }, 'beatriz')).statusCode,
    ).toBe(200)
  })

  it('`situacao=atrasada` é contra o hoje do SERVIDOR', async () => {
    const atrasada = await semear({ prazo: ONTEM })
    await semear({ prazo: HOJE })
    await semear({ prazo: AMANHA })
    const r = await listar({ situacao: 'atrasada' }).expect(200)
    expect(ids(r.body)).toEqual([atrasada])
    expect(r.body.tarefas[0].atrasada).toBe(true)
  })

  it('`situacao=concluida` e `cancelada` separam o que aconteceu do que não vai acontecer', async () => {
    const feita = await semear({
      prazo: HOJE,
      status: 'concluida',
      concluidaEm: '2026-10-24T12:00:00-03:00',
    })
    const morta = await semear({ prazo: HOJE, status: 'cancelada' })
    expect(ids((await listar({ situacao: 'concluida' })).body)).toEqual([feita])
    expect(ids((await listar({ situacao: 'cancelada' })).body)).toEqual([morta])
  })

  it('buscar casa paciente, descrição e observação — e ignora acento', async () => {
    const porPaciente = await semear({ paciente: c.pacientes['ana'], descricao: 'Ligar' })
    const porDescricao = await semear({ descricao: 'Conferir a sala de cirurgia' })
    const porObs = await semear({ descricao: 'Outra', obs: 'Trazer a guia do convênio' })
    await semear({ descricao: 'Nada a ver' })

    expect(ids((await listar({ q: 'ana lucia' })).body)).toEqual([porPaciente])
    expect(ids((await listar({ q: 'CIRURGIA' })).body)).toEqual([porDescricao])
    expect(ids((await listar({ q: 'convenio' })).body)).toEqual([porObs])
  })

  it('`tipo=__interna` traz as tarefas sem paciente', async () => {
    const interna = await semear({ descricao: 'Fechar o caixa' })
    await semear({ paciente: c.pacientes['ana'], tipo: 'Follow-up' })
    expect(ids((await listar({ tipo: '__interna' })).body)).toEqual([interna])
  })

  it('`tipo` filtra pelo nome do tipo de contato', async () => {
    const followUp = await semear({ paciente: c.pacientes['ana'], tipo: 'Follow-up' })
    await semear({ paciente: c.pacientes['bruna'], tipo: 'Recaptação' })
    expect(ids((await listar({ tipo: 'Follow-up' })).body)).toEqual([followUp])
  })

  it('`unidadeId` filtra por unidade', async () => {
    const naPituba = await semear({ unidade: c.unidades['pituba'] })
    await semear({ unidade: c.unidades['principal'] })
    expect(ids((await listar({ unidadeId: c.unidades['pituba']! })).body)).toEqual([naPituba])
  })

  it('a lista devolve o total e pagina sem perdê-lo', async () => {
    for (let i = 0; i < 5; i++) await semear({ prazo: HOJE, descricao: `Tarefa ${i}` })
    const r = await listar({ limite: '2' }).expect(200)
    expect(r.body.tarefas).toHaveLength(2)
    expect(r.body.total).toBe(5)
  })
})

describe('GET /v1/tarefas · isolamento', () => {
  it('a consulta não devolve tarefa de outra clínica', async () => {
    await semear({ prazo: HOJE })
    const r = await listar({ escopo: 'equipe', periodo: 'qualquer' }, 'beatriz').expect(200)
    expect(ids(r.body)).not.toContain(c.tarefaDaOutra)
  })

  it('a tarefa EXCLUÍDA some das duas consultas', async () => {
    const t = await semear({ prazo: HOJE })
    await c.migrate.query('UPDATE tarefas SET excluida_em = now() WHERE id = $1', [t])
    expect(ids((await listar()).body)).not.toContain(t)
    const h = await hoje().expect(200)
    expect(h.body.tarefas.map((x: { id: string }) => x.id)).not.toContain(t)
    expect(h.body.pendentes.itens.map((x: { id: string }) => x.id)).not.toContain(t)
  })
})

describe('GET /v1/hoje', () => {
  it('sem `?dia=`, o dia vem do relógio do SERVIDOR no fuso da clínica', async () => {
    // `RelogioFixo` em 2026-10-25T02:00:00Z. Em America/Bahia ainda é 24/10.
    const r = await hoje().expect(200)
    expect(r.body.dia).toBe(HOJE)
    expect(r.body.hoje).toBe(HOJE)
  })

  it('a semana começa na SEGUNDA', async () => {
    const r = await hoje({ dia: AMANHA }).expect(200)
    // 25/10/2026 é um domingo: a semana dele começa em 19/10.
    expect(r.body.semana).toHaveLength(7)
    expect(r.body.semana[0].dia).toBe(SEGUNDA_DA_SEMANA)
    expect(r.body.semana[6].dia).toBe(AMANHA)
  })

  it('a faixa da semana conta no SERVIDOR — abertas e atrasadas por dia', async () => {
    await semear({ prazo: ONTEM })
    await semear({ prazo: ONTEM })
    await semear({ prazo: HOJE })
    await semear({ prazo: HOJE, status: 'cancelada' })

    const r = await hoje().expect(200)
    const dia = (d: string) => r.body.semana.find((x: { dia: string }) => x.dia === d)
    expect(dia(ONTEM).abertas).toBe(2)
    expect(dia(ONTEM).atrasadas).toBe(2)
    expect(dia(HOJE).abertas).toBe(1)
    // Hoje não está atrasado, e a cancelada não conta para nada.
    expect(dia(HOJE).atrasadas).toBe(0)
  })

  it('`atrasada` é contra o hoje do servidor, NÃO contra o dia navegado', async () => {
    await semear({ prazo: ONTEM })
    await semear({ prazo: AMANHA })

    const navegandoOntem = await hoje({ dia: ONTEM }).expect(200)
    const navegandoAmanha = await hoje({ dia: AMANHA }).expect(200)
    // A faixa da semana é a MESMA nos dois: navegar não atrasa nem desatrasa.
    expect(navegandoOntem.body.semana).toEqual(navegandoAmanha.body.semana)
    const deOntem = (r: { body: { semana: { dia: string; atrasadas: number }[] } }) =>
      r.body.semana.find((x) => x.dia === ONTEM)!.atrasadas
    expect(deOntem(navegandoOntem)).toBe(1)
    expect(deOntem(navegandoAmanha)).toBe(1)
  })

  it('pendentes de dias anteriores vêm recolhidas: contagem + lista', async () => {
    await semear({ prazo: ONTEM })
    await semear({ prazo: '2026-10-20' })
    await semear({ prazo: '2026-10-19' })
    await semear({ prazo: HOJE })

    const r = await hoje().expect(200)
    expect(r.body.pendentes.total).toBe(3)
    expect(r.body.pendentes.itens).toHaveLength(3)
    // Da mais antiga para a mais nova: é a fila de ligação da recepção.
    expect(r.body.pendentes.itens.map((x: { prazo: string }) => x.prazo)).toEqual([
      '2026-10-19',
      '2026-10-20',
      ONTEM,
    ])
  })

  it('as pendentes NÃO dependem do dia navegado', async () => {
    await semear({ prazo: ONTEM })
    const a = await hoje().expect(200)
    const b = await hoje({ dia: AMANHA }).expect(200)
    expect(b.body.pendentes.total).toBe(a.body.pendentes.total)
  })

  it('o dia traz as abertas e as concluídas separadas', async () => {
    const aberta = await semear({ prazo: HOJE })
    const feita = await semear({
      prazo: HOJE,
      status: 'concluida',
      concluidaEm: '2026-10-24T12:00:00-03:00',
    })
    await semear({ prazo: HOJE, status: 'cancelada' })

    const r = await hoje().expect(200)
    expect(r.body.tarefas.map((x: { id: string }) => x.id)).toEqual([aberta])
    expect(r.body.concluidas.map((x: { id: string }) => x.id)).toEqual([feita])
  })

  it('"Para mim" conta quantas ficaram de fora — a recepção precisa saber', async () => {
    for (let i = 0; i < 6; i++) await semear({ prazo: HOJE, responsavel: c.pessoas['camila'] })
    await semear({ prazo: HOJE, responsavel: c.pessoas['juliana'] })

    const r = await hoje({ escopo: 'meu' }).expect(200)
    expect(r.body.tarefas).toHaveLength(1)
    expect(r.body.ocultasPeloFiltro).toBe(6)
    // Juliana não tem `tarefas.equipe`: o aviso manda para "Que solicitei".
    expect(r.body.escopoComAsOcultas).toBe('solicitei')
  })

  it('quem tem `tarefas.equipe` é mandado para "Equipe toda"', async () => {
    await semear({ prazo: HOJE, responsavel: c.pessoas['camila'], solicitante: c.pessoas['camila'] })
    const r = await hoje({ escopo: 'meu' }, 'beatriz').expect(200)
    expect(r.body.ocultasPeloFiltro).toBe(1)
    expect(r.body.escopoComAsOcultas).toBe('equipe')
  })

  it('em "Equipe toda" não há o que esconder, e o aviso some', async () => {
    await semear({ prazo: HOJE, responsavel: c.pessoas['camila'] })
    const r = await hoje({ escopo: 'equipe' }, 'beatriz').expect(200)
    expect(r.body.ocultasPeloFiltro).toBe(0)
    expect(r.body.escopoComAsOcultas).toBeNull()
  })

  it('no dia de HOJE, as pendentes de dias anteriores também contam como ocultas', async () => {
    // Elas aparecem na tela de hoje, então uma pendente de outra pessoa
    // também está escondida pelo filtro — e o aviso precisa dizê-lo.
    await semear({ prazo: ONTEM, responsavel: c.pessoas['camila'] })
    const r = await hoje({ escopo: 'meu' }).expect(200)
    expect(r.body.ocultasPeloFiltro).toBe(1)
  })

  it('os aniversariantes do dia vêm do fuso DA CLÍNICA, e dizem se já há tarefa', async () => {
    const r = await hoje().expect(200)
    // Ana faz aniversário em 24/10.
    expect(r.body.aniversariantes).toHaveLength(1)
    expect(r.body.aniversariantes[0].id).toBe(c.pacientes['ana'])
    expect(r.body.aniversariantes[0].jaTemTarefa).toBe(false)

    await semear({ prazo: HOJE, paciente: c.pacientes['ana'], tipo: 'Aniversário' })
    const depois = await hoje().expect(200)
    expect(depois.body.aniversariantes[0].jaTemTarefa).toBe(true)
  })

  it('navegando para outro dia, o aviso de aniversário não aparece', async () => {
    const r = await hoje({ dia: AMANHA }).expect(200)
    expect(r.body.aniversariantes).toHaveLength(0)
  })

  it('`escopo=equipe` sem `tarefas.equipe` é 403 também aqui', async () => {
    expect((await hoje({ escopo: 'equipe' }, 'juliana')).statusCode).toBe(403)
  })

  it('a tela Hoje não enxerga tarefa de outra clínica', async () => {
    const r = await hoje({ escopo: 'equipe' }, 'beatriz').expect(200)
    const todos = [...r.body.tarefas, ...r.body.pendentes.itens, ...r.body.concluidas]
    expect(todos.map((x: { id: string }) => x.id)).not.toContain(c.tarefaDaOutra)
  })

  it('sem a permissão `valores`, o pagamento da tarefa do dia volta redigido', async () => {
    const t = await postar(c, '/v1/tarefas', {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta realizada',
      responsavelId: c.pessoas['juliana'],
      quando: { modo: 'retroativo', em: HOJE, pagamento: { valor: '45000', forma: 'Pix' } },
    }).expect(201)

    const semValores = await hoje({}, 'juliana').expect(200)
    const naTela = semValores.body.concluidas.find(
      (x: { id: string }) => x.id === t.body.tarefa.id,
    )
    expect(naTela.pagamento.valor).toBeNull()

    const comValores = await hoje({ escopo: 'equipe' }, 'beatriz').expect(200)
    const paraQuemVe = comValores.body.concluidas.find(
      (x: { id: string }) => x.id === t.body.tarefa.id,
    )
    expect(paraQuemVe.pagamento.valor).toBe('45000')
  })
})
