import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparProgramas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * **A LEITURA — tudo calculado no servidor.**
 *
 * `GET /v1/programas` devolve quatro blocos prontos: os indicadores, a agenda
 * de sessões, os contatos de retorno até 30 dias e a lista de pacientes em
 * programa com a situação derivada. `docs/design.md` proíbe cálculo no front, e
 * aqui a razão é concreta: contar "sessões atrasadas" no cliente exigiria
 * baixar todas as sessões abertas da clínica para desenhar quatro números.
 *
 * As definições foram medidas no protótipo rodando (`vAcomp` e `statsAdesao`,
 * 2026-10-26): pacientes em programa = não encerrados **e não concluídos**;
 * risco = atraso de **mais de 7 dias**; a agenda em quatro faixas com as
 * atrasadas primeiro; os retornos até 30 dias.
 *
 * O relógio está fixo em 24/10/2026 (America/Bahia), então as datas das séries
 * são do passado e os prazos futuros caem dentro das janelas de propósito.
 */
let c: Cenario
let tirze: string
let bioestimulador: string

const montar = (corpo: Record<string, unknown>, quem = 'beatriz') =>
  request(c.app.getHttpServer()).post('/v1/programas').set('Cookie', c.cookies[quem]!).send(corpo)

const painel = (consulta: Record<string, string> = {}, quem = 'beatriz') =>
  pegar(c, '/v1/programas', consulta, quem)

const ficha = (id: string, quem = 'beatriz') => pegar(c, `/v1/programas/${id}`, {}, quem)

const concluirSessao = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/programas/sessoes/${id}/concluir`, corpo, quem)

const sessoesDe = async (programaId: string): Promise<{ id: string; prazo: string }[]> => {
  const r = await c.migrate.query<{ id: string; prazo: string }>(
    `SELECT id, prazo::text AS prazo FROM tarefas
      WHERE programa_id = $1 AND tipo = 'Sessão de plano' AND excluida_em IS NULL
      ORDER BY sessao_indice`,
    [programaId],
  )
  return r.rows
}

/**
 * Um programa cujas sessões caem **em volta de hoje**: duas atrasadas, uma
 * hoje, uma dentro de 7 dias.
 *
 * Início 10/10 com intervalo 7: 10/10, 17/10, 24/10 (hoje), 31/10. A quarta
 * está a 7 dias de hoje, dentro da janela.
 */
const EM_VOLTA = ['2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31']

const programaEmVolta = async (
  extra: Record<string, unknown> = {},
): Promise<{ id: string; sessoes: { id: string; prazo: string }[] }> => {
  const r = await montar({
    pacienteId: c.pacientes['ana'],
    inicio: EM_VOLTA[0],
    itens: [{ chave: 'i1', procedimentoId: tirze, sessoes: 4, intervaloDias: 7 }],
    ...extra,
  })
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  const id = r.body.id as string
  expect((await sessoesDe(id)).map((s) => s.prazo)).toEqual(EM_VOLTA)
  return { id, sessoes: await sessoesDe(id) }
}

beforeAll(async () => {
  c = await montarCenario('leitura-prog')
  const p = await c.migrate.query<{ id: string; nome_chave: string }>(
    `SELECT id, nome_chave FROM procedimentos WHERE clinica_id = $1`,
    [c.clinica],
  )
  tirze = p.rows.find((x) => x.nome_chave === 'tirzepatida')!.id
  bioestimulador = p.rows.find((x) => x.nome_chave.includes('bioestimulador'))!.id
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparProgramas(c)
})

/* ========================================================= INDICADORES */

describe('os indicadores vêm prontos', () => {
  it('as seis contagens, medidas contra uma série que cruza o hoje', async () => {
    const p = await programaEmVolta()
    const r = await painel()
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.indicadores).toMatchObject({
      pacientesEmPrograma: 1,
      programasConcluidos: 0,
      // 24/10 é hoje.
      sessoesHoje: 1,
      // 31/10 está a exatamente 7 dias.
      sessoesProximos7: 1,
      // 10/10 e 17/10.
      sessoesAtrasadas: 2,
      // A mais antiga está 14 dias atrasada: mais de 7.
      pacientesEmRisco: 1,
    })
    void p
  })

  it('"mais de 7 dias" é ESTRITO — 7 dias exatos não é risco', async () => {
    // A fronteira. O protótipo escreve `s.atraso > 7`, e um `>=` poria em
    // risco de abandono toda paciente que faltou na semana.
    const r = await montar({
      pacienteId: c.pacientes['ana'],
      inicio: '2026-10-17', // exatamente 7 dias antes de HOJE
      itens: [{ chave: 'i1', procedimentoId: tirze, sessoes: 1, intervaloDias: 7 }],
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    const b = (await painel()).body
    expect(b.indicadores.sessoesAtrasadas).toBe(1)
    expect(b.indicadores.pacientesEmRisco).toBe(0)
  })

  it('programa CONCLUÍDO sai de "pacientes em programa" e entra em "concluídos"', async () => {
    // `statsAdesao` do protótipo: `ativas` exclui `sit.key === 'concluido'`.
    const r = await montar({
      pacienteId: c.pacientes['ana'],
      inicio: '2026-10-20',
      itens: [{ chave: 'i1', procedimentoId: bioestimulador, sessoes: 1, intervaloDias: 30 }],
    })
    const s = await sessoesDe(r.body.id as string)
    await concluirSessao(s[0]!.id, { em: '2026-10-20', reprogramar: false }).expect(200)

    const b = (await painel({ situacao: 'todos' })).body
    expect(b.indicadores.pacientesEmPrograma).toBe(0)
    expect(b.indicadores.programasConcluidos).toBe(1)
  })

  it('a situação é a do DOMÍNIO, e `encerrado` vence tudo', async () => {
    const p = await programaEmVolta()
    const antes = (await painel({ situacao: 'todos' })).body.lista[0]
    expect(antes.situacao).toBe('atrasado')
    expect(antes.diasDeAtraso).toBe(14)

    await postar(c, `/v1/programas/${p.id}/encerrar`, { motivo: 'Desistiu' }, 'beatriz').expect(200)
    const depois = (await painel({ situacao: 'todos' })).body.lista[0]
    // Encerrado vence atrasado, mesmo com sessões atrasadas na memória do
    // banco — e é por isso que a precedência vive no domínio, provada lá.
    expect(depois.situacao).toBe('encerrado')
    expect(depois.motivoEncerramento).toBe('Desistiu')
  })

  it('sessão CANCELADA não entra em nenhuma contagem, e não conclui o programa', async () => {
    const p = await programaEmVolta()
    for (const s of p.sessoes) {
      await postar(c, `/v1/tarefas/${s.id}/cancelar`, {}, 'beatriz').expect(200)
    }
    const b = (await painel({ situacao: 'todos' })).body
    expect(b.indicadores.sessoesAtrasadas).toBe(0)
    expect(b.indicadores.sessoesHoje).toBe(0)
    // Sem nenhuma realizada, o programa NÃO está concluído — é o `validas` do
    // protótipo. Senão todo programa cancelado pareceria concluído.
    expect(b.lista[0]!.situacao).not.toBe('concluido')
  })
})

/* ============================================================== A AGENDA */

describe('a agenda de sessões', () => {
  it('as quatro faixas, com as ATRASADAS primeiro e da mais antiga', async () => {
    const p = await programaEmVolta()
    const a = (await painel()).body.agenda
    expect(a.atrasadas.map((x: { tarefa: { prazo: string } }) => x.tarefa.prazo)).toEqual([
      '2026-10-10',
      '2026-10-17',
    ])
    expect(a.hoje).toHaveLength(1)
    expect(a.proximos7.map((x: { tarefa: { prazo: string } }) => x.tarefa.prazo)).toEqual([
      '2026-10-31',
    ])
    expect(a.realizadasHoje).toHaveLength(0)

    // Concluir a de hoje a move para "realizadas hoje".
    await concluirSessao(p.sessoes[2]!.id, { em: HOJE, reprogramar: false }).expect(200)
    const b = (await painel()).body.agenda
    expect(b.hoje).toHaveLength(0)
    expect(b.realizadasHoje).toHaveLength(1)
  })

  it('a sessão carrega a IDENTIDADE do programa — é ela que leva o toque à rota certa', async () => {
    await programaEmVolta()
    const s = (await painel()).body.agenda.hoje[0].tarefa
    expect(s.sessao).toMatchObject({ itemChave: 'i1', indice: 3, total: 4 })
    expect(s.sessao.programaId).toBeTruthy()
    // O rótulo que a usuária lê sai da DESCRIÇÃO gravada na montagem, nunca da
    // composição de indice/total no front.
    expect(s.descricao).toBe('Aplicação 3/4 · Tirzepatida')
  })

  it('o AVISO DE SALDO vem na sessão, para a cobrança no atendimento', async () => {
    // MANUAL cap. 8: "a próxima sessão mostra um alerta com o valor".
    await programaEmVolta({
      pagamento: { valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' },
    })
    const s = (await painel()).body.agenda.atrasadas[0]
    expect(s).toMatchObject({ temSaldo: true, saldo: '240000' })
  })

  it('o filtro "Minhas sessões" traz só as de quem pediu — resolvido no servidor', async () => {
    // `nara` é enfermagem. O programa é montado com `beatriz` como responsável
    // (padrão do procedimento semeado é nulo → cai no ator), então a agenda
    // dela vem vazia, e a de `beatriz` vem cheia.
    await programaEmVolta()
    const daNara = await painel({ responsavelId: 'eu' }, 'nara')
    expect(daNara.statusCode, JSON.stringify(daNara.body)).toBe(200)
    expect(daNara.body.agenda.atrasadas).toHaveLength(0)
    expect(daNara.body.agenda.hoje).toHaveLength(0)

    const daBeatriz = await painel({ responsavelId: 'eu' }, 'beatriz')
    expect(daBeatriz.body.agenda.atrasadas).toHaveLength(2)
  })

  it('os CONTATOS DE RETORNO vêm até 30 dias, do mais próximo', async () => {
    const r = await c.migrate.query<{ id: string }>(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, paciente_id, tipo,
          historico, procedimento_id)
       VALUES ($1,$2,$2,'Contato para repetir A',$3,$4,'Retorno de procedimento','[]',$5),
              ($1,$2,$2,'Contato para repetir B',$6,$4,'Retorno de procedimento','[]',$5)
       RETURNING id`,
      [
        c.clinica,
        c.pessoas['beatriz'],
        '2026-11-10', // dentro de 30 dias
        c.pacientes['ana'],
        tirze,
        '2026-12-20', // FORA
      ],
    )
    expect(r.rowCount).toBe(2)
    const b = (await painel()).body
    expect(b.retornos).toHaveLength(1)
    expect(b.retornos[0]!.prazo).toBe('2026-11-10')
  })
})

/* =============================================================== A LISTA */

describe('a lista de pacientes em programa', () => {
  it('traz progresso e próxima sessão, tudo derivado', async () => {
    const p = await programaEmVolta()
    await concluirSessao(p.sessoes[0]!.id, { em: '2026-10-10', reprogramar: false }).expect(200)
    const l = (await painel()).body.lista[0]
    expect(l).toMatchObject({
      realizadas: 1,
      total: 4,
      percentual: 25,
      procedimentos: 'Tirzepatida',
      rotuloSessao: 'Aplicação',
      proximaEm: '2026-10-17',
    })
  })

  it('os CINCO filtros de situação, cada um com o seu recorte', async () => {
    const atrasado = await programaEmVolta()
    const concluido = await montar({
      pacienteId: c.pacientes['bruna'] ?? c.pacientes['ana'],
      inicio: '2026-10-20',
      itens: [{ chave: 'i1', procedimentoId: bioestimulador, sessoes: 1, intervaloDias: 30 }],
    })
    const s = await sessoesDe(concluido.body.id as string)
    await concluirSessao(s[0]!.id, { em: '2026-10-20', reprogramar: false }).expect(200)

    const ids = async (situacao: string) =>
      ((await painel({ situacao })).body.lista as { id: string }[]).map((x) => x.id)

    expect(await ids('atrasados')).toEqual([atrasado.id])
    expect(await ids('concluidos')).toEqual([concluido.body.id])
    expect(await ids('encerrados')).toEqual([])
    expect((await ids('todos')).length).toBe(2)
    // `ativos` (o padrão) exclui concluídos e encerrados.
    expect(await ids('ativos')).toEqual([atrasado.id])
  })

  it('"com saldo a receber" traz o MAIOR primeiro — é a fila de cobrança', async () => {
    await programaEmVolta({
      pagamento: { valorTotal: '100000', valorEntrada: '50000', forma: 'Pix' },
    })
    await programaEmVolta({
      pagamento: { valorTotal: '400000', valorEntrada: '50000', forma: 'Pix' },
    })
    const lista = (await painel({ situacao: 'saldo' })).body.lista as { saldo: string }[]
    expect(lista.map((x) => x.saldo)).toEqual(['350000', '50000'])
    // Ordem alfabética aqui faria a recepção ligar para quem deve R$ 500 antes
    // de quem deve R$ 3.500.
  })

  it('o filtro por PROCEDIMENTO casa pelo item, não pelo nome', async () => {
    await programaEmVolta()
    expect((await painel({ procedimentoId: tirze })).body.lista).toHaveLength(1)
    expect((await painel({ procedimentoId: bioestimulador })).body.lista).toHaveLength(0)
  })

  it('a busca por nome ignora acento e maiúscula', async () => {
    await programaEmVolta()
    expect((await painel({ q: 'ana' })).body.lista).toHaveLength(1)
    expect((await painel({ q: 'LUCIA' })).body.lista).toHaveLength(1)
    expect((await painel({ q: 'zzz' })).body.lista).toHaveLength(0)
  })

  it('programa EXCLUÍDO não aparece em lista nenhuma, nem por id', async () => {
    const p = await programaEmVolta()
    await request(c.app.getHttpServer())
      .delete(`/v1/programas/${p.id}`)
      .set('Cookie', c.cookies['beatriz']!)
      .expect(200)
    expect((await painel({ situacao: 'todos' })).body.lista).toHaveLength(0)
    expect((await painel()).body.agenda.atrasadas).toHaveLength(0)
    expect((await ficha(p.id)).statusCode).toBe(404)
  })
})

/* =============================================================== A FICHA */

describe('a ficha do programa', () => {
  it('traz progresso, itens, sessões, recebido e saldo — tudo derivado', async () => {
    const p = await programaEmVolta({
      pagamento: { valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' },
    })
    await concluirSessao(p.sessoes[0]!.id, { em: '2026-10-10', reprogramar: false }).expect(200)

    const r = await ficha(p.id)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({
      realizadas: 1,
      total: 4,
      percentual: 25,
      // 10/10 concluída em 10/10: no prazo.
      percentualNoPrazo: 100,
      sessoesAtrasadas: 1,
      recebido: '120000',
      saldo: '240000',
      temSaldo: true,
      modoDeCobranca: 'saldo',
      situacao: 'atrasado',
    })
    expect(r.body.itens).toHaveLength(1)
    expect(r.body.itens[0]!.agenda).toHaveLength(4)
    // E NÃO EXISTE coluna `saldo` nem `recebido` em `programas` (regra 5, P-2).
    const colunas = await c.migrate.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'programas'`,
    )
    const nomes = colunas.rows.map((x) => x.column_name)
    expect(nomes).not.toContain('saldo')
    expect(nomes).not.toContain('recebido')
    expect(nomes).not.toContain('sessoes')
  })

  it('`percentualNoPrazo` é realizadas no prazo ÷ realizadas', async () => {
    const p = await programaEmVolta()
    // A 1ª no prazo (10/10 em 10/10), a 2ª atrasada (17/10 em 20/10).
    await concluirSessao(p.sessoes[0]!.id, { em: '2026-10-10', reprogramar: false }).expect(200)
    await concluirSessao(p.sessoes[1]!.id, { em: '2026-10-20', reprogramar: false }).expect(200)
    expect((await ficha(p.id)).body.percentualNoPrazo).toBe(50)
  })

  it('a ficha traz o PAGAMENTO DA ADESÃO em `outras`, não entre as sessões', async () => {
    const p = await programaEmVolta({
      pagamento: { valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' },
    })
    const b = (await ficha(p.id)).body
    expect(b.outras).toHaveLength(1)
    expect(b.outras[0]!.tipo).toBe('Pagamento de orçamento')
    expect(b.itens[0]!.agenda.every((x: { tipo: string }) => x.tipo === 'Sessão de plano')).toBe(
      true,
    )
  })

  it('abrir a ficha grava "acessou" na trilha — a pergunta que a LGPD faz', async () => {
    const p = await programaEmVolta()
    const antes = await c.migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM auditoria WHERE acao = 'acessou' AND clinica_id = $1`,
      [c.clinica],
    )
    await ficha(p.id, 'nara').expect(200)
    const depois = await c.migrate.query<{ n: string; entidade: string }>(
      `SELECT count(*)::text AS n, max(entidade) AS entidade FROM auditoria
        WHERE acao = 'acessou' AND clinica_id = $1`,
      [c.clinica],
    )
    expect(Number(depois.rows[0]!.n)).toBe(Number(antes.rows[0]!.n) + 1)
  })

  it('a LISTA não grava acesso — senão a trilha que importa fica enterrada', async () => {
    await programaEmVolta()
    const antes = await c.migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM auditoria WHERE acao = 'acessou' AND clinica_id = $1`,
      [c.clinica],
    )
    await painel().expect(200)
    const depois = await c.migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM auditoria WHERE acao = 'acessou' AND clinica_id = $1`,
      [c.clinica],
    )
    expect(depois.rows[0]!.n).toBe(antes.rows[0]!.n)
  })
})

/* ========================================================== A REDAÇÃO */

describe('sem `valores`, as contagens ficam e o dinheiro some', () => {
  it('o saldo some do topo, da agenda e da lista — e `temSaldo` fica', async () => {
    /**
     * Regra 17, nas TRÊS profundidades em que o painel devolve dinheiro.
     *
     * A equipe precisa do AVISO antes da sessão ("confirmar o pagamento"), e
     * não precisa do valor para dá-lo. Nenhum `if` de permissão no front: o
     * servidor já apagou o campo.
     */
    await programaEmVolta({
      pagamento: { valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' },
    })
    const r = await painel({}, 'nara') // enfermagem: `programas`, sem `valores`
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)

    expect(r.body.indicadores.pacientesEmPrograma).toBeGreaterThan(0)
    expect(r.body.indicadores.saldoAReceber).toBeNull()
    // A CONTAGEM de quem deve sobrevive: não é dinheiro.
    expect(r.body.indicadores.pacientesQueDevem).toBe(1)

    expect(r.body.agenda.atrasadas[0]!.temSaldo).toBe(true)
    expect(r.body.agenda.atrasadas[0]!.saldo).toBeNull()
    expect(r.body.lista[0]!.temSaldo).toBe(true)
    expect(r.body.lista[0]!.saldo).toBeNull()

    // A varredura que não depende de eu lembrar de cada campo.
    expect(JSON.stringify(r.body)).not.toContain('240000')
    expect(JSON.stringify(r.body)).not.toContain('120000')
  })

  it('a FICHA redige `recebido`, `saldo`, `valorTotal` e `itens[].valor`', async () => {
    const p = await programaEmVolta({
      pagamento: { valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' },
    })
    const r = await ficha(p.id, 'nara')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.recebido).toBeNull()
    expect(r.body.saldo).toBeNull()
    expect(r.body.valorTotal).toBeNull()
    expect(r.body.itens[0]!.valor).toBeNull()
    expect(r.body.temSaldo).toBe(true)
    expect(JSON.stringify(r.body)).not.toContain('360000')
  })

  it('sem `programas`, 403 nas duas — e `camila` tem `valores`', async () => {
    const p = await programaEmVolta()
    expect((await painel({}, 'camila')).statusCode).toBe(403)
    expect((await ficha(p.id, 'camila')).statusCode).toBe(403)
  })

  it('programa de outra clínica é 404 — a RLS, não um `WHERE` esquecido', async () => {
    const outro = await c.migrate.query<{ id: string }>(
      `INSERT INTO programas (clinica_id, paciente_id, inicio, criado_por)
       VALUES ($1,$2,'2026-10-10',$3) RETURNING id`,
      [c.outraClinica, c.pacienteDaOutra, c.pessoas['beatriz']],
    )
    expect((await ficha(outro.rows[0]!.id)).statusCode).toBe(404)
    expect((await painel({ situacao: 'todos' })).body.lista).toHaveLength(0)
  })
})

/* ========================================================== A TELA HOJE */

describe('a tela Hoje ganha o bloco `sessoes`', () => {
  const hoje = (quem = 'beatriz', consulta: Record<string, string> = {}) =>
    pegar(c, '/v1/hoje', consulta, quem)

  it('as sessões vêm no bloco próprio, e FORA de `tarefas` e `pendentes`', async () => {
    /**
     * Uma paciente de doze aplicações semanais põe doze cartões nas listas do
     * dia de alguém. Com dez pacientes em programa, a recepção vê cento e
     * vinte "pendentes" e para de olhar — o bloco próprio é o que o protótipo
     * faz, e o `FORA_DO_RECONTATO` da consulta é quem garante.
     */
    const p = await programaEmVolta()
    const r = await hoje()
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)

    const nosSessoes = (r.body.sessoes as { tarefa: { id: string } }[]).map((x) => x.tarefa.id)
    // As duas atrasadas e a de hoje: o bloco traz `prazo <= hoje`.
    expect(nosSessoes).toHaveLength(3)
    expect(nosSessoes).toContain(p.sessoes[0]!.id)

    const idsDe = (xs: { id: string }[]) => xs.map((x) => x.id)
    for (const s of p.sessoes) {
      expect(idsDe(r.body.tarefas)).not.toContain(s.id)
      expect(idsDe(r.body.pendentes.itens)).not.toContain(s.id)
    }
    expect(r.body.pendentes.total).toBe(0)
  })

  it('as sessões não contam nas BOLINHAS da semana', async () => {
    // A quarta contagem da tela. Numa delas só, as bolinhas contariam doze
    // tarefas que a lista não mostra.
    await programaEmVolta()
    const semana = (await hoje()).body.semana as { dia: string; abertas: number }[]
    expect(semana.find((d) => d.dia === HOJE)!.abertas).toBe(0)
  })

  it('as atrasadas vêm PRIMEIRO, da mais antiga', async () => {
    await programaEmVolta()
    const prazos = ((await hoje()).body.sessoes as { tarefa: { prazo: string } }[]).map(
      (x) => x.tarefa.prazo,
    )
    expect(prazos).toEqual(['2026-10-10', '2026-10-17', '2026-10-24'])
  })

  it('sem a permissão `programas`, o bloco vem VAZIO e o resto da Hoje continua', async () => {
    // `rita` é balcão: tem `receber` e NÃO tem `programas`.
    await programaEmVolta()
    const r = await hoje('rita')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.sessoes).toEqual([])
    // A tela Hoje em si é de todos (`menu.ts`, `perm: null`): o resto veio.
    expect(r.body.dia).toBe(HOJE)
    expect(Array.isArray(r.body.semana)).toBe(true)
  })

  it('no escopo `equipe`, o bloco traz as sessões de todos', async () => {
    await programaEmVolta()
    // `nara` não é responsável de nenhuma; em `meu` o bloco é vazio, em
    // `equipe` ela vê as três.
    expect((await hoje('nara')).body.sessoes).toEqual([])
    const daEquipe = await hoje('beatriz', { escopo: 'equipe' })
    expect(daEquipe.body.sessoes).toHaveLength(3)
  })

  it('o aviso de saldo também vem no bloco da Hoje', async () => {
    await programaEmVolta({
      pagamento: { valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' },
    })
    const s = (await hoje()).body.sessoes[0]
    expect(s).toMatchObject({ temSaldo: true, saldo: '240000' })
  })
})
