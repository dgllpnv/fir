import { randomUUID } from 'node:crypto'
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
  receitaDoDia,
  recebimentosDe,
  vivosDe,
} from '../tarefas/__tests__/cenario'

/**
 * **CONCLUIR E REABRIR UMA SESSÃO** — e as quatro coisas que a rota genérica
 * não faz.
 *
 * `POST /v1/programas/sessoes/:id/concluir` reprograma as próximas, cria o
 * contato de retorno na última do item, carimba `programa_id` no recebimento e
 * chama a baixa de insumos. `POST /v1/tarefas/:id/concluir` **recusa** uma
 * sessão (P-5), e `DELETE /v1/tarefas/:id` também (P-6).
 *
 * **As datas são todas PASSADAS, e isso não é estética.** O relógio da suíte
 * está fixo em 2026-10-25T02:00Z — 23:00 de 24/10 em America/Bahia —, e a
 * borda recusa data de realização no futuro. O protótipo, medido, cai
 * silenciosamente em `nowIso()` nesse caso (`b.concluidaEm <= today() ? … :
 * nowIso()`) e reprograma a série a partir de HOJE em vez da data informada:
 * a série anda **para trás** sem erro nenhum. Aqui é 400, explícito.
 *
 * A aritmética é a que o protótipo produziu (`atualizarTarefa`, medido
 * 2026-10-26): série semanal, a 2ª realizada 11 dias depois do prazo, e as
 * próximas ancoradas na **realizada** — nunca na anterior.
 */
let c: Cenario
let tirze: string
let bioestimulador: string

type Sessao = { id: string; prazo: string; indice: number; status: string }

const montar = (corpo: Record<string, unknown>, quem = 'beatriz') =>
  request(c.app.getHttpServer()).post('/v1/programas').set('Cookie', c.cookies[quem]!).send(corpo)

const concluirSessao = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/programas/sessoes/${id}/concluir`, corpo, quem)

const reabrirSessao = (id: string, quem = 'beatriz') =>
  postar(c, `/v1/programas/sessoes/${id}/reabrir`, {}, quem)

const sessoesDe = async (programaId: string): Promise<Sessao[]> => {
  const r = await c.migrate.query<{
    id: string
    prazo: string
    sessao_indice: number
    status: string
  }>(
    `SELECT id, prazo::text AS prazo, sessao_indice, status FROM tarefas
      WHERE programa_id = $1 AND tipo = 'Sessão de plano' AND excluida_em IS NULL
      ORDER BY item_chave, sessao_indice`,
    [programaId],
  )
  return r.rows.map((l) => ({
    id: l.id,
    prazo: l.prazo,
    indice: l.sessao_indice,
    status: l.status,
  }))
}

const prazosDe = async (programaId: string) => (await sessoesDe(programaId)).map((s) => s.prazo)

const retornoDe = async (programaId: string, itemChave = 'i1') => {
  const r = await c.migrate.query<{
    id: string
    prazo: string
    descricao: string
    status: string
    responsavel_id: string
    obs: string
  }>(
    `SELECT id, prazo::text AS prazo, descricao, status, responsavel_id, obs FROM tarefas
      WHERE programa_id = $1 AND item_chave = $2 AND tipo = 'Retorno de procedimento'
        AND excluida_em IS NULL
      ORDER BY criada_em DESC`,
    [programaId, itemChave],
  )
  return r.rows[0]
}

const contarTrilhaDeTarefas = async (programaId: string): Promise<number> => {
  const r = await c.migrate.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM auditoria
      WHERE entidade = 'tarefas'
        AND entidade_id IN (SELECT id::text FROM tarefas WHERE programa_id = $1)`,
    [programaId],
  )
  return Number(r.rows[0]!.n)
}

/** Tirzepatida semanal, 4 sessões: **07/09, 14/09, 21/09, 28/09**. */
const SEMANAL = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']

const programaSemanal = async (): Promise<{ id: string; sessoes: Sessao[] }> => {
  const r = await montar({
    pacienteId: c.pacientes['ana'],
    inicio: SEMANAL[0],
    itens: [{ chave: 'i1', procedimentoId: tirze, sessoes: 4, intervaloDias: 7 }],
  })
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  const id = r.body.id as string
  expect(await prazosDe(id)).toEqual(SEMANAL)
  return { id, sessoes: await sessoesDe(id) }
}

/**
 * Dois itens encadeados: i1 semanal 4× a partir de 03/08, i2 **mensal** 2×
 * depois dele.
 *
 * i1 termina em 24/08; i2 começa **30 dias** depois (o intervalo DO FILHO, não
 * do pai) → 23/09 e 23/10. Se o encadeamento usasse o intervalo do pai, i2
 * começaria em 31/08 — e é por isso que os dois intervalos são diferentes aqui.
 */
const ENCADEADO_I1 = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24']
const ENCADEADO_I2 = ['2026-09-23', '2026-10-23']

const programaEncadeado = async (): Promise<{ id: string; sessoes: Sessao[] }> => {
  const r = await montar({
    pacienteId: c.pacientes['ana'],
    inicio: ENCADEADO_I1[0],
    itens: [
      { chave: 'i1', procedimentoId: tirze, sessoes: 4, intervaloDias: 7 },
      {
        chave: 'i2',
        procedimentoId: bioestimulador,
        sessoes: 2,
        intervaloDias: 30,
        depoisDe: 'i1',
      },
    ],
  })
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  const id = r.body.id as string
  expect(await prazosDe(id)).toEqual([...ENCADEADO_I1, ...ENCADEADO_I2])
  return { id, sessoes: await sessoesDe(id) }
}

beforeAll(async () => {
  c = await montarCenario('sessoes')
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

/* ===================================================== A REPROGRAMAÇÃO */

describe('concluir a sessão — a reprogramação', () => {
  it('REPROGRAMA as próximas quando se pede, com âncora na REALIZADA', async () => {
    // A 2ª tinha prazo 14/09 e foi realizada em 25/09 (11 dias atrasada).
    // Âncora na realizada: 3ª = 25/09 + 7 = 02/10, 4ª = 25/09 + 14 = 09/10.
    //
    // Ancorar na sessão ANTERIOR daria o mesmo resultado NESTA chamada e
    // deslizaria a cada toque seguinte — é a mutação que não produz erro, só
    // uma agenda que escorrega, e quem a descobre é a enfermagem em janeiro.
    const p = await programaSemanal()
    const r = await concluirSessao(p.sessoes[1]!.id, { em: '2026-09-25', reprogramar: true })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(await prazosDe(p.id)).toEqual([
      '2026-09-07',
      '2026-09-14',
      '2026-10-02',
      '2026-10-09',
    ])
  })

  it('e MANTÉM as datas quando se pede — é escolha, não padrão', async () => {
    const p = await programaSemanal()
    await concluirSessao(p.sessoes[1]!.id, { em: '2026-09-25', reprogramar: false }).expect(200)
    expect(await prazosDe(p.id)).toEqual(SEMANAL)
  })

  it('o corpo SEM `reprogramar` é 400 — nenhum padrão silencioso', async () => {
    // Um padrão aqui move a agenda de doze aplicações sem ninguém ter pedido.
    const p = await programaSemanal()
    const r = await concluirSessao(p.sessoes[1]!.id, { em: '2026-09-25' })
    expect(r.statusCode).toBe(400)
    expect((await sessoesDe(p.id))[1]!.status).toBe('aberta')
  })

  it('a data de realização no FUTURO é 400 — o protótipo cai em `nowIso()` calado', async () => {
    const p = await programaSemanal()
    const r = await concluirSessao(p.sessoes[1]!.id, { em: '2026-12-01', reprogramar: true })
    expect(r.statusCode).toBe(400)
    expect(await prazosDe(p.id)).toEqual(SEMANAL)
  })

  it('reprogramar NÃO move o passado: a 1ª e a própria ficam onde estão', async () => {
    const p = await programaSemanal()
    await concluirSessao(p.sessoes[1]!.id, { em: '2026-09-25', reprogramar: true }).expect(200)
    const s = await sessoesDe(p.id)
    expect(s[0]!.prazo).toBe('2026-09-07')
    // A própria sessão concluída mantém o prazo: ela já aconteceu, e a data de
    // realização mora em `concluida_em`.
    expect(s[1]!.prazo).toBe('2026-09-14')
  })

  it('A CASCATA usa o intervalo DO FILHO, não o do pai', async () => {
    const p = await programaEncadeado()
    // i1 2ª (prazo 10/08) realizada em 20/08 → i1 vira …27/08, 03/09.
    // fim do pai = 03/09; i2 = 03/09 + 30 = 03/10, e a 2ª em 02/11.
    //
    // Com o intervalo do PAI (7 dias), i2 começaria em 10/09. É a divergência
    // que o plano não distinguia, porque o exemplo dele usava 7 e 7.
    await concluirSessao(p.sessoes[1]!.id, { em: '2026-08-20', reprogramar: true }).expect(200)
    expect(await prazosDe(p.id)).toEqual([
      '2026-08-03',
      '2026-08-10',
      '2026-08-27',
      '2026-09-03',
      '2026-10-03',
      '2026-11-02',
    ])
  })

  it('CASCATA PARA: o item dependente que JÁ COMEÇOU não é empurrado', async () => {
    const p = await programaEncadeado()
    const deI2 = p.sessoes.slice(4)
    // Uma sessão do item 2 já foi aplicada. Mover a agenda dela por causa do
    // item 1 seria reescrever o passado da paciente.
    await concluirSessao(deI2[0]!.id, { em: '2026-09-23', reprogramar: false }).expect(200)

    await concluirSessao(p.sessoes[1]!.id, { em: '2026-08-20', reprogramar: true }).expect(200)
    expect((await prazosDe(p.id)).slice(4)).toEqual(ENCADEADO_I2)
  })

  it('reprogramar na data DO PRAZO não move nada, e a trilha não ganha ruído', async () => {
    /**
     * Concluir na data do próprio prazo: o domínio devolve lista vazia, e
     * nenhuma data muda.
     *
     * **O alcance desta asserção, dito sem exagero.** Reescrever as três
     * abertas com os MESMOS valores também deixaria a trilha com uma entrada
     * só — o trigger `registrar_auditoria` da 0004 descarta `UPDATE` que não
     * mudou nada (`IF v_para IS NULL THEN RETURN NULL`), e eu medi isso
     * tentando a mutação. O banco é a primeira linha de defesa do ruído.
     *
     * O que esta asserção pega, então, é o que o banco não pega: um serviço
     * que reescreve as abertas com valores DIFERENTES — recalculando a série
     * do zero a partir da realizada em vez de aplicar o delta do domínio.
     * Essa é a mutação que mordeu (T9d), e ela move a 3ª e a 4ª num dia em que
     * nada devia andar.
     */
    const p = await programaSemanal()
    const antes = await contarTrilhaDeTarefas(p.id)
    await concluirSessao(p.sessoes[1]!.id, { em: '2026-09-14', reprogramar: true }).expect(200)
    expect(await contarTrilhaDeTarefas(p.id)).toBe(antes + 1)
    expect(await prazosDe(p.id)).toEqual(SEMANAL)
  })
})

/* ================================================= O CONTATO DE RETORNO */

describe('a última sessão do item cria o contato de retorno', () => {
  /** Bioestimulador: 12 meses de retorno, 30 dias de antecedência (0010). */
  const programaDeUmaSo = async (): Promise<{ id: string; sessaoId: string }> => {
    const r = await montar({
      pacienteId: c.pacientes['ana'],
      inicio: '2026-10-20',
      itens: [{ chave: 'i1', procedimentoId: bioestimulador, sessoes: 1, intervaloDias: 30 }],
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    const s = await sessoesDe(r.body.id as string)
    return { id: r.body.id as string, sessaoId: s[0]!.id }
  }

  it('cria o CONTATO com a antecedência, e o texto do protótipo', async () => {
    const p = await programaDeUmaSo()
    await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)
    const t = (await retornoDe(p.id))!
    expect(t, 'o contato de retorno não foi criado').toBeDefined()
    expect(t.status).toBe('aberta')
    // 12 meses de 20/10/26 → 20/10/27; 30 dias antes → 20/09/27.
    expect(t.prazo).toBe('2027-09-20')
    // O formato é o do protótipo, copiado literalmente — é o texto que a
    // recepção lê na fila de ligações.
    expect(t.descricao).toBe(
      'Contato para repetir Bioestimulador de colágeno · pode repetir a partir de 20/10/27',
    )
  })

  it('restando sessão aberta do item, o retorno NÃO é criado', async () => {
    const p = await programaSemanal()
    await concluirSessao(p.sessoes[0]!.id, { em: '2026-09-07', reprogramar: false }).expect(200)
    expect(await retornoDe(p.id)).toBeUndefined()
  })

  it('sem regra de retorno no procedimento, nenhuma tarefa é criada', async () => {
    await c.migrate.query('UPDATE procedimentos SET retorno_quantidade = NULL WHERE id = $1', [
      bioestimulador,
    ])
    try {
      const p = await programaDeUmaSo()
      await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)
      expect(await retornoDe(p.id)).toBeUndefined()
    } finally {
      await c.migrate.query('UPDATE procedimentos SET retorno_quantidade = 12 WHERE id = $1', [
        bioestimulador,
      ])
    }
  })

  it('o retorno VIVO não é duplicado — é o `jaTem` do protótipo', async () => {
    const p = await programaDeUmaSo()
    await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)
    const primeiro = (await retornoDe(p.id))!.id
    await reabrirSessao(p.sessaoId).expect(200)
    await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)

    const vivos = await c.migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tarefas
        WHERE programa_id = $1 AND tipo = 'Retorno de procedimento' AND status = 'aberta'`,
      [p.id],
    )
    // Um só VIVO: o primeiro foi cancelado pela reabertura, o segundo nasceu.
    expect(Number(vivos.rows[0]!.n)).toBe(1)
    expect((await retornoDe(p.id))!.id).not.toBe(primeiro)
  })

  it('criar o retorno CANCELA os retornos antigos do mesmo PROCEDIMENTO', async () => {
    // "Paciente refez o procedimento" — a frase é do protótipo. Sem isso, a
    // paciente que acabou de repetir continua recebendo a ligação do ciclo
    // anterior. O casamento é por procedimento, não por programa.
    const antigo = await programaDeUmaSo()
    await concluirSessao(antigo.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)
    const idAntigo = (await retornoDe(antigo.id))!.id

    const novo = await programaDeUmaSo()
    await concluirSessao(novo.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)

    const r = await c.migrate.query<{ status: string; obs: string }>(
      'SELECT status, obs FROM tarefas WHERE id = $1',
      [idAntigo],
    )
    expect(r.rows[0]!.status).toBe('cancelada')
    expect(r.rows[0]!.obs).toBe('Paciente refez o procedimento')
  })

  it('programa ENCERRADO não gera contato de retorno', async () => {
    const p = await programaDeUmaSo()
    await c.migrate.query(
      `UPDATE programas SET situacao = 'encerrado', motivo_encerramento = 'Desistiu',
                            encerrado_em = now() WHERE id = $1`,
      [p.id],
    )
    await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)
    expect(await retornoDe(p.id)).toBeUndefined()
  })

  it('reabrir CANCELA o contato de retorno que a conclusão criou', async () => {
    const p = await programaDeUmaSo()
    await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)
    expect((await retornoDe(p.id))!.status).toBe('aberta')
    await reabrirSessao(p.sessaoId).expect(200)
    expect((await retornoDe(p.id))!.status).toBe('cancelada')
  })

  it('reabrir NÃO desfaz a reprogramação — as datas novas ficam', async () => {
    // Reprogramar é uma decisão sobre a agenda, não um efeito da conclusão. A
    // enfermagem já reorganizou o dia dela; desfazer seria a surpresa.
    const p = await programaSemanal()
    await concluirSessao(p.sessoes[1]!.id, { em: '2026-09-25', reprogramar: true }).expect(200)
    await reabrirSessao(p.sessoes[1]!.id).expect(200)
    expect(await prazosDe(p.id)).toEqual([
      '2026-09-07',
      '2026-09-14',
      '2026-10-02',
      '2026-10-09',
    ])
  })
})

/* =========================================================== O DINHEIRO */

describe('o dinheiro da sessão', () => {
  const comSaldo = async (): Promise<{ id: string; sessoes: Sessao[] }> => {
    const r = await montar({
      pacienteId: c.pacientes['ana'],
      inicio: SEMANAL[0],
      itens: [{ chave: 'i1', procedimentoId: tirze, sessoes: 4, intervaloDias: 7 }],
      pagamento: { valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' },
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    return { id: r.body.id as string, sessoes: await sessoesDe(r.body.id as string) }
  }

  const saldoDoPrograma = async (programaId: string, quem = 'beatriz') => {
    const r = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}/saldo`, {}, quem)
    const g = (r.body.grupos as { programaId: string | null; saldo: string | null }[]).find(
      (x) => x.programaId === programaId,
    )
    return g?.saldo ?? null
  }

  it('o pagamento da sessão cria UM recebimento, com o `programa_id`', async () => {
    const p = await comSaldo()
    await concluirSessao(p.sessoes[0]!.id, {
      em: '2026-09-07',
      reprogramar: false,
      pagamento: { valor: '30000', forma: 'Pix' },
    }).expect(200)
    expect(await vivosDe(c, p.sessoes[0]!.id)).toHaveLength(1)
    const r = await c.migrate.query<{ programa_id: string | null }>(
      'SELECT programa_id FROM recebimentos WHERE tarefa_id = $1',
      [p.sessoes[0]!.id],
    )
    expect(r.rows[0]!.programa_id).toBe(p.id)
  })

  it('EM MODO SALDO, o pagamento da sessão ABATE o saldo DO PROGRAMA', async () => {
    const p = await comSaldo()
    expect(await saldoDoPrograma(p.id)).toBe('240000')
    await concluirSessao(p.sessoes[0]!.id, {
      em: '2026-09-07',
      reprogramar: false,
      pagamento: { valor: '30000', forma: 'Pix' },
    }).expect(200)
    expect(await saldoDoPrograma(p.id)).toBe('210000')
  })

  it('EM MODO AVULSO, o pagamento da sessão é receita e NÃO abate nem abre saldo', async () => {
    /**
     * A outra metade da regra, e sem ela a primeira não prova nada.
     *
     * `saldoInfo` do protótipo (medido): a sessão abate **só** quando
     * `a.modo === 'saldo'`. Em `avulso` não há dívida para quitar — cada sessão
     * registra o que foi pago no dia —, e abater criaria crédito do nada: a
     * paciente que pagou R$ 300 por sessão apareceria com R$ 300 a receber.
     */
    const p = await programaSemanal() // sem `pagamento` → modo `avulso`
    const modo = await c.migrate.query<{ m: string }>(
      'SELECT modo_de_cobranca AS m FROM programas WHERE id = $1',
      [p.id],
    )
    expect(modo.rows[0]!.m).toBe('avulso')

    await concluirSessao(p.sessoes[0]!.id, {
      em: '2026-09-07',
      reprogramar: false,
      pagamento: { valor: '30000', forma: 'Pix' },
    }).expect(200)

    // Receita: sim. Saldo: nenhum — nem positivo, nem crédito.
    expect(await receitaDoDia(c, '2026-09-07')).toBe(30000n)
    const r = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}/saldo`, {}, 'beatriz')
    expect(r.body.saldo).toBe('0')
    expect(r.body.credito).toBe('0')
    expect(r.body.temSaldo).toBe(false)
  })

  it('A RECEITA NÃO DOBRA: a mesma sessão recusa o segundo recebimento', async () => {
    const p = await comSaldo()
    const corpo = {
      em: '2026-09-07',
      reprogramar: false,
      pagamento: { valor: '30000', forma: 'Pix' },
    }
    await concluirSessao(p.sessoes[0]!.id, corpo).expect(200)
    // Pelo índice `recebimento_por_tarefa`, não por um `if` no serviço: a
    // segunda chamada já é 409 por "sessão concluída".
    const r = await concluirSessao(p.sessoes[0]!.id, corpo)
    expect(r.statusCode).toBe(409)
    expect(await vivosDe(c, p.sessoes[0]!.id)).toHaveLength(1)
  })

  it('reabrir ESTORNA o recebimento e a receita do dia volta', async () => {
    const p = await comSaldo()
    // O pagamento entra em HOJE: `quando` é o instante da conclusão, e uma
    // conclusão retroativa de 07/09 lança o dinheiro naquele dia.
    const antes = await receitaDoDia(c, '2026-09-07')
    await concluirSessao(p.sessoes[0]!.id, {
      em: '2026-09-07',
      reprogramar: false,
      pagamento: { valor: '30000', forma: 'Pix' },
    }).expect(200)
    expect(await receitaDoDia(c, '2026-09-07')).toBe(antes + 30000n)
    await reabrirSessao(p.sessoes[0]!.id).expect(200)
    expect(await receitaDoDia(c, '2026-09-07')).toBe(antes)
    // Estornado, não apagado (regra 20): a linha fica.
    expect(await recebimentosDe(c, p.sessoes[0]!.id)).toHaveLength(1)
    expect(await vivosDe(c, p.sessoes[0]!.id)).toHaveLength(0)
  })

  it('SEM `receber`, o corpo COM dinheiro é 403 — e a sessão continua aberta', async () => {
    // `nara` é enfermagem: tem `programas`, não tem `receber` nem `valores`.
    const p = await comSaldo()
    const r = await concluirSessao(
      p.sessoes[0]!.id,
      { em: '2026-09-07', reprogramar: false, pagamento: { valor: '30000', forma: 'Pix' } },
      'nara',
    )
    expect(r.statusCode, JSON.stringify(r.body)).toBe(403)
    expect((await sessoesDe(p.id))[0]!.status).toBe('aberta')
    expect(await recebimentosDe(c, p.sessoes[0]!.id)).toHaveLength(0)
  })

  it('SEM `receber`, concluir SEM dinheiro é 200 — a enfermagem registra a aplicação', async () => {
    const p = await programaSemanal()
    const r = await concluirSessao(
      p.sessoes[0]!.id,
      { em: '2026-09-07', reprogramar: false },
      'nara',
    )
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  })

  it('sem `programas`, 403 — e `camila` tem `valores`', async () => {
    const p = await programaSemanal()
    expect(
      (await concluirSessao(p.sessoes[0]!.id, { em: '2026-09-07', reprogramar: false }, 'camila'))
        .statusCode,
    ).toBe(403)
  })
})

/* ========================================= OS LIMITES DA ROTA GENÉRICA */

describe('os limites da rota genérica', () => {
  it('`POST /v1/tarefas/:id/concluir` RECUSA uma sessão, e diz por quê em português', async () => {
    const p = await programaSemanal()
    const r = await postar(
      c,
      `/v1/tarefas/${p.sessoes[0]!.id}/concluir`,
      { em: '2026-09-07' },
      'beatriz',
    )
    expect(r.statusCode, JSON.stringify(r.body)).toBe(409)
    expect(String(r.body.message)).toContain('precisa saber se as próximas sessões')
    expect((await sessoesDe(p.id))[0]!.status).toBe('aberta')
  })

  it('`DELETE /v1/tarefas/:id` RECUSA uma sessão — a numeração não abre buraco', async () => {
    const p = await programaSemanal()
    const r = await request(c.app.getHttpServer())
      .delete(`/v1/tarefas/${p.sessoes[0]!.id}`)
      .set('Cookie', c.cookies['beatriz']!)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(409)
    expect(String(r.body.message)).toContain('Cancele a sessão')
    expect(await sessoesDe(p.id)).toHaveLength(4)
  })

  it('CANCELAR uma sessão continua pela rota genérica, e a numeração fica inteira', async () => {
    const p = await programaSemanal()
    const r = await postar(c, `/v1/tarefas/${p.sessoes[2]!.id}/cancelar`, {}, 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect((await sessoesDe(p.id))[2]!.status).toBe('cancelada')
    // A sessão cancelada CONTINUA EXISTINDO: `5/12` sem `6/12` tornaria a
    // reprogramação ambígua.
    expect(await sessoesDe(p.id)).toHaveLength(4)
  })

  it('uma tarefa que NÃO é sessão é 404 na rota de sessão', async () => {
    const t = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'interna',
        descricao: 'Comprar café',
        responsavelId: c.pessoas['beatriz'],
        quando: { modo: 'agendada', prazo: HOJE },
      },
      'beatriz',
    )
    expect(t.statusCode, JSON.stringify(t.body)).toBe(201)
    const r = await concluirSessao(t.body.tarefa.id as string, { em: HOJE, reprogramar: false })
    // 404 e não 409: dizer "não é sessão" confirmaria que a tarefa existe.
    expect(r.statusCode).toBe(404)
  })

  it('id que não existe é 404, e id da clínica vizinha também', async () => {
    expect((await concluirSessao(randomUUID(), { em: HOJE, reprogramar: false })).statusCode).toBe(
      404,
    )
    // A RLS: a tarefa da vizinha devolve zero linhas, e zero é a mesma
    // resposta de "não existe".
    expect(
      (await concluirSessao(c.tarefaDaOutra, { em: HOJE, reprogramar: false })).statusCode,
    ).toBe(404)
  })
})
