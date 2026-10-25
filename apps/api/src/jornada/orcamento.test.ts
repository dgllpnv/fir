import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
  receitaDoDia,
  recebimentosDe,
  tarefaCrua,
} from '../tarefas/__tests__/cenario'

/**
 * ORÇAMENTO NÃO É RECEITA (regra 4) — e é o produto inteiro deste arquivo.
 *
 * `valor_orcamento` é uma nota promissória: ela mede CONVERSÃO, e nada mais.
 * No dia em que vazar para a receita, o faturamento do mês fica errado para
 * cima, a meta aparece batida, e a clínica descobre no fechamento.
 *
 * A segunda metade do arquivo é a regra 17, provada em PROFUNDIDADE: o
 * protótipo redige só o topo (`saida()` apaga `valorOrcamento`), e o valor do
 * orçamento viaja dentro do `historico`, escondido apenas pela TELA.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('orcamento')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
})

type Corpo = Record<string, unknown>

const mover = (id: string, corpo: Corpo, quem = 'beatriz') =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, quem)

type Tarefa = {
  id: string
  etapa: string | null
  status: string
  proximoPassoEm: string | null
  valorOrcamento: string | null
  programaOrcado: { valor?: string | null; sessoes: number; dose?: string }[] | null
  historico: { acao: string; etapa: string; nota?: string; valor?: string | null }[]
}

const corpoDe = (r: { body: unknown }): Tarefa => (r.body as { tarefa: Tarefa }).tarefa

/** Cria uma consulta e a conclui: o cartão nasce em `realizado`. */
async function realizado(em = HOJE): Promise<string> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['beatriz'],
      quando: { modo: 'retroativo', em },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.tarefa.id as string
}

async function orcado(valor = '360000'): Promise<string> {
  const id = await realizado()
  await mover(id, { acao: 'registrarOrcamento', valor }).expect(200)
  return id
}

const ltvDaAna = async (quem = 'beatriz'): Promise<string | null> => {
  const r = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}`, {}, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return r.body.ltv as string | null
}

const somarDias = (dia: string, n: number): string => {
  const [a, m, d] = dia.split('-').map(Number)
  const t = new Date(Date.UTC(a!, m! - 1, d! + n))
  const dois = (x: number) => String(x).padStart(2, '0')
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`
}

/* -------------------------------------------- orçamento não é receita */

describe('ORÇAMENTO NÃO É RECEITA — a asserção que este épico protege', () => {
  it('registrar orçamento não mexe em receita, em recebimento nem em LTV', async () => {
    const id = await realizado()
    const receitaAntes = await receitaDoDia(c)
    const ltvAntes = await ltvDaAna()

    const t = corpoDe(await mover(id, { acao: 'registrarOrcamento', valor: '360000' }).expect(200))
    expect(t.etapa).toBe('orcamento')
    expect(t.status).toBe('concluida')
    expect(t.valorOrcamento).toBe('360000')

    expect(await receitaDoDia(c)).toBe(receitaAntes) // não mudou
    expect(await recebimentosDe(c, id)).toHaveLength(0) // nenhuma linha criada
    expect(await ltvDaAna()).toBe(ltvAntes) // o LTV não mexeu
  })

  it('a tarefa continua SEM coluna de dinheiro recebido', async () => {
    const id = await orcado()
    const crua = (await tarefaCrua(c, id))!
    // `tarefaCrua` seleciona colunas nomeadas; a varredura do catálogo inteiro
    // é `teste/rotina-rls.test.ts`. Aqui o que se cobra é a RESPOSTA.
    const t = corpoDe(await mover(id, { acao: 'followUp' }).expect(200))
    expect(Object.keys(t)).not.toContain('valor')
    expect(Object.keys(t)).not.toContain('valorRecebido')
    expect(Object.keys(crua)).not.toContain('valor')
  })

  it('o valor orçado NÃO aparece na soma de recebimentos de nenhum dia', async () => {
    // Se entrasse aqui, a conferência às cegas do caixa pediria R$ 3.600 em
    // dinheiro que ninguém recebeu, e a recepção fecharia o caixa com "falta".
    await orcado()
    for (const dia of [HOJE, somarDias(HOJE, -1), somarDias(HOJE, 1)]) {
      expect(await receitaDoDia(c, dia)).toBe(0n)
    }
  })
})

/* ----------------------------------------------------- o próximo passo */

describe('o dia de retomar vem do SERVIDOR', () => {
  it('padrão: hoje + 2, no fuso da clínica', async () => {
    // `RelogioFixo` em 2026-10-25T02:00:00Z; em America/Bahia ainda é 24/10.
    // Com UTC, o padrão cairia em 27/10 e a recepção retomaria um dia tarde.
    const id = await realizado()
    const t = corpoDe(await mover(id, { acao: 'registrarOrcamento', valor: '360000' }).expect(200))
    expect(t.proximoPassoEm).toBe(somarDias(HOJE, 2))
  })

  it('a data pedida pelo cliente é respeitada quando vem', async () => {
    const id = await realizado()
    const t = corpoDe(
      await mover(id, {
        acao: 'registrarOrcamento',
        valor: '360000',
        retomarEm: '2026-11-10',
      }).expect(200),
    )
    expect(t.proximoPassoEm).toBe('2026-11-10')
  })

  it('follow-up não troca a etapa, não zera o valor e só adia o passo (hoje + 3)', async () => {
    const id = await orcado()
    const t = corpoDe(await mover(id, { acao: 'followUp', nota: 'vai decidir até sexta' }).expect(200))
    expect(t.etapa).toBe('orcamento')
    expect(t.status).toBe('concluida')
    expect(t.valorOrcamento).toBe('360000')
    expect(t.proximoPassoEm).toBe(somarDias(HOJE, 3))
    expect(t.historico.at(-1)).toMatchObject({
      acao: 'followUp',
      etapa: 'orcamento',
      nota: 'vai decidir até sexta',
    })
  })

  it('follow-up repetido adia de novo, e cada um deixa o seu evento', async () => {
    const id = await orcado()
    const antes = ((await tarefaCrua(c, id))!['historico'] as unknown[]).length
    await mover(id, { acao: 'followUp', nota: 'ligou, não atendeu' }).expect(200)
    const t = corpoDe(await mover(id, { acao: 'followUp', retomarEm: '2026-11-20' }).expect(200))
    expect(t.proximoPassoEm).toBe('2026-11-20')
    expect(t.historico).toHaveLength(antes + 2)
  })
})

/* ---------------------------------------------------- o que é proibido */

describe('o orçamento não repete, e não alcança o que não aconteceu', () => {
  it('registrar orçamento duas vezes é 409', async () => {
    const id = await orcado()
    const r = await mover(id, { acao: 'registrarOrcamento', valor: '100000' })
    expect(r.statusCode).toBe(409)
    // E o valor do primeiro NÃO foi tocado: duas propostas partiriam a
    // conversão do funil, e sobrescrever apagaria o tamanho do negócio.
    expect((await tarefaCrua(c, id))!['valor_orcamento']).toBe('360000')
  })

  it('orçar um atendimento que ainda não aconteceu é 409', async () => {
    const r0 = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'paciente',
        pacienteId: c.pacientes['ana'],
        tipo: 'Consulta agendada',
        responsavelId: c.pessoas['beatriz'],
        quando: { modo: 'agendada', prazo: HOJE },
      },
      'beatriz',
    )
    const r = await mover(r0.body.tarefa.id as string, {
      acao: 'registrarOrcamento',
      valor: '360000',
    })
    expect(r.statusCode).toBe(409)
    expect(r.body.message).toContain('ainda não aconteceu')
  })

  it('orçar um atendimento ANTIGO É PERMITIDO pelo servidor', async () => {
    // O protótipo esconde o botão depois de 30 dias — e está certo, NA TELA.
    // No servidor, bloquear faria a migração do épico 9 escrever direto na
    // tabela, que é como a regra 4 morre sem ninguém ver (decisão D-6).
    const id = await realizado('2024-10-24')
    const r = await mover(id, { acao: 'registrarOrcamento', valor: '500000' })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  })

  it('follow-up num cartão sem orçamento é 409', async () => {
    const id = await realizado()
    expect((await mover(id, { acao: 'followUp' })).statusCode).toBe(409)
  })

  it('sem a permissão `jornada`, 403 — e nada foi escrito', async () => {
    const id = await realizado()
    const r = await mover(id, { acao: 'registrarOrcamento', valor: '360000' }, 'camila')
    expect(r.statusCode).toBe(403)
    expect((await tarefaCrua(c, id))!['etapa']).toBe('realizado')
    expect((await tarefaCrua(c, id))!['valor_orcamento']).toBeNull()
  })
})

/* ---------------------------------------------------- o programa orçado */

const item = (extra: Corpo = {}) => ({
  procedimentoId: '33333333-3333-4333-8333-333333333333',
  sessoes: 12,
  intervaloDias: 7,
  chave: 'i1',
  dose: '2,5 mg',
  ...extra,
})

describe('o programa orçado sobrevive inteiro para o épico 5', () => {
  it('a proposta é gravada com os campos que a médica prescreveu', async () => {
    const id = await realizado()
    const t = corpoDe(
      await mover(id, {
        acao: 'registrarOrcamento',
        valor: '360000',
        programa: [item()],
      }).expect(200),
    )
    expect(t.programaOrcado).toHaveLength(1)
    expect(t.programaOrcado![0]).toMatchObject({ sessoes: 12, dose: '2,5 mg' })
  })

  it('DINHEIRO DENTRO DO JSONB É STRING DE CENTAVOS, nunca número JSON', async () => {
    // Decisão D-4. O `jsonb` do Postgres guarda `numeric` exato, mas
    // `JSON.parse` do lado do Node devolve `number` — e `number` perto de
    // dinheiro é a assinatura que a regra 1 proíbe atravessar.
    const id = await realizado()
    await mover(id, {
      acao: 'registrarOrcamento',
      valor: '360000',
      programa: [item({ valor: '30000' })],
    }).expect(200)

    const crua = (await tarefaCrua(c, id))!
    const proposta = crua['programa_orcado'] as { valor: unknown }[]
    expect(typeof proposta[0]!.valor).toBe('string')
    expect(proposta[0]!.valor).toBe('30000')

    const h = crua['historico'] as { acao: string; valor?: unknown }[]
    const ev = h.find((x) => x.acao === 'registrarOrcamento')!
    expect(typeof ev.valor).toBe('string')
    expect(ev.valor).toBe('360000')
  })

  it('responsável de OUTRA CLÍNICA na proposta é 400 — o jsonb não tem FK', async () => {
    // `programa_orcado` é `jsonb`: nenhuma chave estrangeira o protege, então
    // sem esta conferência o épico 5 montaria doze sessões atribuídas a
    // alguém que não existe nesta clínica.
    const id = await realizado()
    const outra = await c.migrate.query<{ id: string }>(
      'SELECT id FROM pessoas WHERE clinica_id = $1 LIMIT 1',
      [c.outraClinica],
    )
    const r = await mover(id, {
      acao: 'registrarOrcamento',
      valor: '360000',
      programa: [item({ responsavelId: outra.rows[0]!.id })],
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(400)
    expect((await tarefaCrua(c, id))!['programa_orcado']).toBeNull()
  })

  it('responsável INATIVO na proposta é 400', async () => {
    const id = await realizado()
    const r = await mover(id, {
      acao: 'registrarOrcamento',
      valor: '360000',
      programa: [item({ responsavelId: c.pessoas['marta'] })],
    })
    expect(r.statusCode).toBe(400)
  })

  it('a proposta continua lá depois de um follow-up', async () => {
    const id = await realizado()
    await mover(id, { acao: 'registrarOrcamento', valor: '360000', programa: [item()] }).expect(200)
    const t = corpoDe(await mover(id, { acao: 'followUp' }).expect(200))
    expect(t.programaOrcado).toHaveLength(1)
  })
})

/* ------------------------------------------------- A PROVA DA REDAÇÃO */

describe('a redação de valores alcança O FUNDO do histórico (regra 17)', () => {
  it('sem `valores`, o dinheiro some do topo E DE DENTRO DO HISTÓRICO', async () => {
    // O protótipo redige só o topo (`saida()`): o valor do orçamento viaja
    // dentro de `historico` e só a TELA o esconde. É exatamente o que a regra
    // 17 proíbe. O `RedacaoInterceptor` já percorre em profundidade — este
    // teste existe para que ninguém "otimize" a recursão fora.
    const id = await realizado()
    await mover(id, {
      acao: 'registrarOrcamento',
      valor: '360000',
      programa: [item({ valor: '30000' })],
    }).expect(200)

    // `juliana` tem `jornada` e NÃO tem `valores`.
    const t = corpoDe(await mover(id, { acao: 'followUp' }, 'juliana').expect(200))
    expect(t.valorOrcamento).toBeNull()
    expect(t.historico.find((e) => e.acao === 'registrarOrcamento')!.valor).toBeNull()
    expect(t.programaOrcado![0]!.valor).toBeNull()
    // A asserção que fecha a porta: NENHUM dígito do valor atravessa, em
    // nenhum campo que alguém venha a acrescentar depois.
    expect(JSON.stringify(t)).not.toContain('360000')
    expect(JSON.stringify(t)).not.toContain('30000')
  })

  it('com `valores`, o mesmo cartão traz tudo — a FORMA não muda', async () => {
    const id = await realizado()
    await mover(id, {
      acao: 'registrarOrcamento',
      valor: '360000',
      programa: [item({ valor: '30000' })],
    }).expect(200)

    const comValores = corpoDe(await mover(id, { acao: 'followUp' }, 'beatriz').expect(200))
    const semValores = corpoDe(await mover(id, { acao: 'followUp' }, 'juliana').expect(200))

    expect(comValores.valorOrcamento).toBe('360000')
    expect(comValores.programaOrcado![0]!.valor).toBe('30000')
    // Mesmas chaves, nos dois: o cliente distingue "sem acesso" de "sem
    // valor" sem um `if` extra.
    expect(Object.keys(semValores).sort()).toEqual(Object.keys(comValores).sort())
    expect(Object.keys(semValores.programaOrcado![0]!).sort()).toEqual(
      Object.keys(comValores.programaOrcado![0]!).sort(),
    )
  })

  it('a nota e o motivo NÃO são redigidos — eles não são valor', async () => {
    const id = await realizado()
    await mover(id, {
      acao: 'registrarOrcamento',
      valor: '360000',
      nota: 'programa Tirzepatida 12 aplicações',
    }).expect(200)
    const t = corpoDe(await mover(id, { acao: 'followUp' }, 'juliana').expect(200))
    expect(t.historico.find((e) => e.acao === 'registrarOrcamento')!.nota).toBe(
      'programa Tirzepatida 12 aplicações',
    )
  })
})
