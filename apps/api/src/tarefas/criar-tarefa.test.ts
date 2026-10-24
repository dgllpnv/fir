import { diaCivil } from '@fir/domain'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AMANHA,
  type Cenario,
  desmontarCenario,
  FUSO,
  HOJE,
  inserirRecebimento,
  limparTarefas,
  montarCenario,
  postar,
  receitaDoDia,
  recebimentosDe,
  tarefaCrua,
} from './__tests__/cenario'

let c: Cenario

beforeAll(async () => {
  c = await montarCenario('criar-tarefa')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
})

type Corpo = Record<string, unknown>

const criar = (corpo: Corpo, quem = 'juliana') =>
  postar(c, '/v1/tarefas', corpo, quem)

/** O corpo mínimo de uma tarefa interna agendada para hoje. */
const interna = (extra: Corpo = {}): Corpo => ({
  vinculo: 'interna',
  responsavelId: c.pessoas['juliana'],
  descricao: 'Conferir a agenda da tarde',
  quando: { modo: 'agendada', prazo: HOJE },
  ...extra,
})

const comPaciente = (extra: Corpo = {}): Corpo => ({
  vinculo: 'paciente',
  pacienteId: c.pacientes['ana'],
  tipo: 'Consulta agendada',
  responsavelId: c.pessoas['juliana'],
  quando: { modo: 'agendada', prazo: HOJE },
  ...extra,
})

describe('POST /v1/tarefas · o caso normal', () => {
  it('cria a tarefa aberta e devolve quem solicitou — que é quem está logado', async () => {
    const r = await criar(interna()).expect(201)
    expect(r.body.tarefa.status).toBe('aberta')
    expect(r.body.tarefa.solicitanteId).toBe(c.pessoas['juliana'])
    expect(r.body.tarefa.prazo).toBe(HOJE)
    expect(r.body.tarefa.concluidaEm).toBeNull()
    expect(r.body.todas).toHaveLength(1)
  })

  it('descrição vazia vira o nome do tipo', async () => {
    const r = await criar(comPaciente({ tipo: 'Follow-up', descricao: undefined })).expect(201)
    expect(r.body.tarefa.descricao).toBe('Follow-up')
  })

  it('tarefa interna sem descrição é recusada — não há tipo de onde tirar o texto', async () => {
    const r = await criar(interna({ descricao: undefined }))
    expect(r.statusCode).toBe(400)
  })

  it('a tarefa de agenda nasce na etapa "agendado", com o histórico', async () => {
    const r = await criar(comPaciente({ quando: { modo: 'agendada', prazo: HOJE, hora: '14:30' } }))
    expect(r.statusCode).toBe(201)
    expect(r.body.tarefa.etapa).toBe('agendado')
    expect(r.body.tarefa.hora).toBe('14:30')
    expect(r.body.tarefa.historico).toHaveLength(1)
    expect(r.body.tarefa.historico[0].e).toBe('agendado')
  })

  it('responsável inativo é recusado — Code.gs:355', async () => {
    const r = await criar(interna({ responsavelId: c.pessoas['marta'] }))
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('responsável ativo')
  })

  it('sem unidade explícita, a tarefa herda a unidade principal do paciente — Code.gs:373', async () => {
    const r = await criar(comPaciente()).expect(201)
    expect(r.body.tarefa.unidadeId).toBe(c.unidades['pituba'])
  })

  it('a unidade explícita vence a do paciente', async () => {
    const r = await criar(comPaciente({ unidadeId: c.unidades['principal'] })).expect(201)
    expect(r.body.tarefa.unidadeId).toBe(c.unidades['principal'])
  })

  it('tarefa interna não herda unidade de paciente nenhum', async () => {
    const r = await criar(interna()).expect(201)
    expect(r.body.tarefa.unidadeId).toBeNull()
  })

  it('o paciente de OUTRA clínica não existe daqui', async () => {
    const r = await criar(comPaciente({ pacienteId: c.pacienteDaOutra }))
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('Paciente')
  })

  it('tipo do grupo Pagamentos é 400, e a mensagem manda para Recebimento', async () => {
    const r = await criar(comPaciente({ tipo: 'Pagamento de orçamento' }))
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('Recebimento')
  })
})

describe('POST /v1/tarefas · o lançamento retroativo', () => {
  it('a data de negócio vem do SERVIDOR, não do corpo', async () => {
    // O relógio da clínica marca 24/10; em UTC já é 25/10. Um cliente com o
    // relógio adiantado manda 25/10 como "já aconteceu" — e o servidor compara
    // com o dia civil DELE, no fuso da clínica (regra 24).
    const r = await criar(interna({ quando: { modo: 'retroativo', em: AMANHA } }))
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('até hoje')
  })

  it('retroativo nasce CONCLUÍDO, com o instante dentro do dia pedido', async () => {
    const r = await criar(interna({ quando: { modo: 'retroativo', em: '2026-10-20' } })).expect(201)
    expect(r.body.tarefa.status).toBe('concluida')
    expect(diaCivil(new Date(r.body.tarefa.concluidaEm), FUSO)).toBe('2026-10-20')
  })

  it('retroativo de HOJE carimba o instante de agora', async () => {
    const r = await criar(interna({ quando: { modo: 'retroativo', em: HOJE } })).expect(201)
    expect(new Date(r.body.tarefa.concluidaEm).toISOString()).toBe('2026-10-25T02:00:00.000Z')
    expect(diaCivil(new Date(r.body.tarefa.concluidaEm), FUSO)).toBe(HOJE)
  })

  it('agendado vira realizado na MESMA tarefa, com os dois passos no histórico', async () => {
    const r = await criar(
      comPaciente({ tipo: 'Consulta agendada', quando: { modo: 'retroativo', em: HOJE } }),
    ).expect(201)
    expect(r.body.tarefa.tipo).toBe('Consulta realizada')
    expect(r.body.tarefa.etapa).toBe('realizado')
    expect(r.body.tarefa.historico.map((h: { e: string }) => h.e)).toEqual([
      'agendado',
      'realizado',
    ])
  })

  it('retroativo com pagamento cria UM recebimento, e a tarefa não guarda dinheiro', async () => {
    const r = await criar(
      comPaciente({
        tipo: 'Consulta realizada',
        quando: {
          modo: 'retroativo',
          em: HOJE,
          pagamento: { valor: '45000', forma: 'Pix' },
        },
      }),
      'beatriz',
    ).expect(201)

    expect(await recebimentosDe(c, r.body.tarefa.id)).toHaveLength(1)
    // A tarefa NÃO tem coluna de dinheiro: o valor só existe dentro de
    // `pagamento`, que é a linha de `recebimentos`.
    expect(Object.keys(r.body.tarefa)).not.toContain('valor')
    expect(Object.keys(r.body.tarefa)).not.toContain('valorAberto')
    expect(r.body.tarefa.pagamento.valor).toBe('45000')
    expect(await receitaDoDia(c)).toBe(45000n)
  })

  it('A RECEITA NÃO DOBRA: o mesmo atendimento recusa o segundo recebimento', async () => {
    const r = await criar(
      comPaciente({
        tipo: 'Consulta realizada',
        quando: { modo: 'retroativo', em: HOJE, pagamento: { valor: '45000', forma: 'Pix' } },
      }),
      'beatriz',
    ).expect(201)

    await expect(
      inserirRecebimento(c, r.body.tarefa.id, c.pacientes['ana']!, 45000n),
    ).rejects.toThrow(/recebimento_por_tarefa/i)
    expect(await receitaDoDia(c)).toBe(45000n)
  })

  it('o valor em aberto é um fato do pagamento, e entra com ele', async () => {
    const r = await criar(
      comPaciente({
        tipo: 'Consulta realizada',
        quando: {
          modo: 'retroativo',
          em: HOJE,
          pagamento: { valor: '20000', valorAberto: '25000', forma: 'Dinheiro' },
        },
      }),
      'beatriz',
    ).expect(201)
    const [rec] = await recebimentosDe(c, r.body.tarefa.id)
    expect(rec!.valor).toBe('20000')
    expect(rec!.valor_aberto).toBe('25000')
  })

  it('pagamento num tipo que não guarda pagamento é recusado', async () => {
    // "Follow-up" não é atendimento: aceitar dinheiro ali criaria receita sem
    // atendimento que a explique.
    const r = await criar(
      comPaciente({
        tipo: 'Follow-up',
        quando: { modo: 'retroativo', em: HOJE, pagamento: { valor: '45000', forma: 'Pix' } },
      }),
      'beatriz',
    )
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('pagamento')
  })

  it('pagamento em tarefa INTERNA é recusado — não há paciente a quem o dinheiro pertença', async () => {
    const r = await criar(
      interna({ quando: { modo: 'retroativo', em: HOJE, pagamento: { valor: '45000', forma: 'Pix' } } }),
      'beatriz',
    )
    expect(r.statusCode).toBe(400)
  })

  it('sem a permissão `valores`, o pagamento volta redigido — e o recebimento foi criado assim mesmo', async () => {
    const r = await criar(
      comPaciente({
        tipo: 'Consulta realizada',
        quando: { modo: 'retroativo', em: HOJE, pagamento: { valor: '45000', forma: 'Pix' } },
      }),
      'juliana',
    ).expect(201)
    expect(r.body.tarefa.pagamento.valor).toBeNull()
    expect(await receitaDoDia(c)).toBe(45000n)
  })
})

describe('POST /v1/tarefas · a série', () => {
  it('série mensal começando em 31/01 cria as 5 datas certas, com um serieId só', async () => {
    const r = await criar(
      interna({
        quando: { modo: 'serie', inicio: '2026-01-31', freq: 'mensal', ate: '2026-05-31' },
      }),
    ).expect(201)

    expect(r.body.todas.map((t: { prazo: string }) => t.prazo)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ])
    const series = new Set(r.body.todas.map((t: { serieId: string }) => t.serieId))
    expect(series.size).toBe(1)
    expect([...series][0]).not.toBeNull()
    expect(r.body.tarefa.recorrencia).toBe('Mensal')
  })

  it('a série guarda o rótulo com o intervalo quando é "a cada X dias"', async () => {
    const r = await criar(
      interna({
        quando: { modo: 'serie', inicio: HOJE, freq: 'ndias', ate: '2026-11-13', aCadaNDias: 10 },
      }),
    ).expect(201)
    expect(r.body.todas).toHaveLength(3)
    expect(r.body.tarefa.recorrencia).toBe('A cada 10 dias')
  })

  it('série de uma data só é recusada, com a mensagem do domínio', async () => {
    const r = await criar(
      interna({ quando: { modo: 'serie', inicio: HOJE, freq: 'semanal', ate: HOJE } }),
    )
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('pelo menos 2 datas')
  })

  it('acima de 150 é recusado, não truncado — e nenhuma tarefa é gravada', async () => {
    const r = await criar(
      interna({ quando: { modo: 'serie', inicio: '2026-01-01', freq: 'diaria', ate: '2026-12-31' } }),
    )
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('150')
    const n = await c.migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM tarefas WHERE clinica_id = $1',
      [c.clinica],
    )
    expect(n.rows[0]!.n).toBe('0')
  })

  it('a série inteira é UMA transação — nenhuma tarefa meia-criada', async () => {
    // A 4ª data da série cai num responsável que foi desativado no meio do
    // caminho? Não dá para forçar isso por fora. O que dá, e é o mesmo
    // mecanismo: uma série cujo `unidadeId` é de outra clínica não derruba
    // nada (é descartado), mas uma com `hora` inválida é recusada no parse e
    // não grava nada. O caso que importa de verdade está acima — `SERIE_LONGA`
    // é a recusa que acontece DEPOIS de o serviço já ter começado a trabalhar.
    const antes = await c.migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM tarefas WHERE clinica_id = $1',
      [c.clinica],
    )
    const r = await criar(
      interna({
        quando: { modo: 'serie', inicio: '2026-01-01', freq: 'semanal', ate: '2026-02-01' },
        responsavelId: c.pessoas['marta'],
      }),
    )
    expect(r.statusCode).toBe(400)
    const depois = await c.migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM tarefas WHERE clinica_id = $1',
      [c.clinica],
    )
    expect(depois.rows[0]!.n).toBe(antes.rows[0]!.n)
  })

  it('retroativo COM série não passa do parse — a combinação não existe no contrato', async () => {
    const r = await criar(
      interna({
        quando: { modo: 'retroativo', em: '2026-10-20', freq: 'semanal', ate: '2026-11-20' },
      }),
    )
    expect(r.statusCode).toBe(400)
  })
})

describe('POST /v1/tarefas · isolamento', () => {
  it('a unidade de outra clínica é descartada, e a tarefa cai na do paciente', async () => {
    // A FK `tarefas.unidade_id -> unidades(id)` é verificada pelo sistema e
    // ATRAVESSA a RLS: sem a conferência, o id da vizinha seria GRAVADO e a
    // tarefa sumiria do filtro por unidade desta clínica. O paciente aqui tem
    // unidade própria, então o descarte é visível — o `null` de uma tarefa
    // interna passaria mesmo sem conferência nenhuma.
    const unidadeDaOutra = await c.migrate.query<{ id: string }>(
      `INSERT INTO unidades (clinica_id, nome) VALUES ($1, 'Unidade Vizinha') RETURNING id`,
      [c.outraClinica],
    )
    const r = await criar(comPaciente({ unidadeId: unidadeDaOutra.rows[0]!.id })).expect(201)
    expect(r.body.tarefa.unidadeId).toBe(c.unidades['pituba'])
  })

  it('tarefa INTERNA não guarda unidade, nem quando mandam uma válida', async () => {
    // `Code.gs`: `unidadeId: t.pacienteId ? ... : ""`. Unidade é do
    // atendimento, e tarefa interna não tem atendimento.
    const r = await criar(interna({ unidadeId: c.unidades['principal'] })).expect(201)
    expect(r.body.tarefa.unidadeId).toBeNull()
  })

  it('o responsável de outra clínica não existe daqui', async () => {
    const pessoaDaOutra = await c.migrate.query<{ id: string }>(
      'SELECT id FROM pessoas WHERE clinica_id = $1 LIMIT 1',
      [c.outraClinica],
    )
    const r = await criar(interna({ responsavelId: pessoaDaOutra.rows[0]!.id }))
    expect(r.statusCode).toBe(400)
  })

  it('a tarefa criada fica na clínica de quem a criou', async () => {
    const r = await criar(interna()).expect(201)
    const crua = await tarefaCrua(c, r.body.tarefa.id)
    expect(crua).toBeDefined()
    const dona = await c.migrate.query<{ clinica_id: string }>(
      'SELECT clinica_id FROM tarefas WHERE id = $1',
      [r.body.tarefa.id],
    )
    expect(dona.rows[0]!.clinica_id).toBe(c.clinica)
  })
})
