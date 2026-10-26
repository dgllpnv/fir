import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  desmontarCenario,
  limparProgramas,
  montarCenario,
  type Cenario,
} from '../tarefas/__tests__/cenario'

/**
 * `POST /v1/programas` — A MONTAGEM.
 *
 * Duas entradas, um montador: esta rota e o `fechar` da jornada. Se a
 * montagem fosse escrita duas vezes, a segunda seria a que esquece de
 * cancelar os contatos de retorno — e a paciente que acabou de refazer o
 * procedimento receberia a ligação de "você já pode repetir".
 */
let c: Cenario
let tirze: string
let drenagem: string
let semeados: string[]

const montar = (corpo: Record<string, unknown>, quem = 'beatriz') =>
  request(c.app.getHttpServer()).post('/v1/programas').set('Cookie', c.cookies[quem]!).send(corpo)

const ITEM = { chave: 'i1', sessoes: 4, intervaloDias: 7 }
const base = () => ({
  pacienteId: c.pacientes['ana'],
  inicio: '2026-11-02',
  itens: [{ ...ITEM, procedimentoId: tirze }],
})

type Sessao = {
  id: string
  prazo: string
  descricao: string
  tipo: string
  item_chave: string
  sessao_indice: number
  sessao_total: number
  responsavel_id: string
  etapa: string | null
  status: string
  procedimento_id: string | null
}

async function sessoesDe(programaId: string): Promise<Sessao[]> {
  const r = await c.migrate.query<Sessao>(
    `SELECT id, prazo::text AS prazo, descricao, tipo, item_chave, sessao_indice, sessao_total,
            responsavel_id, etapa::text AS etapa, status, procedimento_id
       FROM tarefas
      WHERE programa_id = $1 AND tipo = 'Sessão de plano' AND excluida_em IS NULL
      ORDER BY prazo, item_chave, sessao_indice`,
    [programaId],
  )
  return r.rows
}

const contarProgramasDe = async (pacienteId: string): Promise<number> => {
  const r = await c.migrate.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM programas WHERE paciente_id = $1 AND excluido_em IS NULL`,
    [pacienteId],
  )
  return Number(r.rows[0]!.n)
}

const contarSessoesDe = async (pacienteId: string): Promise<number> => {
  const r = await c.migrate.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM tarefas
      WHERE paciente_id = $1 AND tipo = 'Sessão de plano' AND excluida_em IS NULL`,
    [pacienteId],
  )
  return Number(r.rows[0]!.n)
}

const itensDe = async (programaId: string) =>
  (
    await c.migrate.query<{
      chave: string
      procedimento_nome: string
      valor: string | null
      responsavel_id: string
      inicio: string
      depois_de: string | null
      insumo_milesimos: string | null
      insumo_unidade: string | null
    }>(
      `SELECT chave, procedimento_nome, valor::text AS valor, responsavel_id,
              inicio::text AS inicio, depois_de,
              insumo_milesimos::text AS insumo_milesimos, insumo_unidade
         FROM itens_do_programa WHERE programa_id = $1 ORDER BY ordem`,
      [programaId],
    )
  ).rows

const recebimentosDe = async (programaId: string) =>
  (
    await c.migrate.query<{ valor: string; valor_aberto: string; programa_id: string }>(
      `SELECT valor::text AS valor, valor_aberto::text AS valor_aberto, programa_id
         FROM recebimentos WHERE programa_id = $1 AND estornado_em IS NULL`,
      [programaId],
    )
  ).rows

beforeAll(async () => {
  c = await montarCenario('mon')
  const r = await c.migrate.query<{ id: string; nome: string }>(
    'SELECT id, nome FROM procedimentos WHERE clinica_id = $1',
    [c.clinica],
  )
  semeados = r.rows.map((x) => x.id)
  tirze = r.rows.find((x) => x.nome === 'Tirzepatida')!.id
  drenagem = r.rows.find((x) => x.nome === 'Semaglutida')!.id
}, 120_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparProgramas(c)
  await c.migrate.query('DELETE FROM insumos_do_procedimento WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query(
    'DELETE FROM procedimentos WHERE clinica_id = $1 AND id <> ALL($2::uuid[])',
    [c.clinica, semeados],
  )
  await c.migrate.query(
    `UPDATE procedimentos SET excluido_em = NULL, ativo = true, desativado_em = NULL,
            responsavel_id = NULL, valor_por_sessao = NULL
      WHERE clinica_id = $1`,
    [c.clinica],
  )
})

describe('as sessões são TAREFAS, numeradas dentro do item', () => {
  it('monta as sessões como tarefas, com a numeração do item', async () => {
    const p = (await montar(base()).expect(201)).body as { id: string }
    const s = await sessoesDe(p.id)
    expect(s).toHaveLength(4)
    expect(s.map((x) => x.prazo)).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
    ])
    expect(s[0]).toMatchObject({
      tipo: 'Sessão de plano',
      sessao_indice: 1,
      sessao_total: 4,
      item_chave: 'i1',
    })
  })

  it('a descrição é o rótulo do item, com a dose — o que a enfermagem lê', async () => {
    // Formato MEDIDO no protótipo rodando (`criarAdesao`):
    // `${rotulo} ${i}/${n} · ${nome}${dose ? ' ' + dose : ''}`.
    const p = (
      await montar({
        ...base(),
        itens: [{ ...ITEM, procedimentoId: tirze, dose: '2,5 mg' }],
      }).expect(201)
    ).body as { id: string }
    expect((await sessoesDe(p.id))[0]!.descricao).toBe('Aplicação 1/4 · Tirzepatida 2,5 mg')
  })

  it('sem dose, a descrição não fica com espaço sobrando', async () => {
    const p = (await montar(base()).expect(201)).body as { id: string }
    expect((await sessoesDe(p.id))[0]!.descricao).toBe('Aplicação 1/4 · Tirzepatida')
  })

  it('A ESCALADA DE DOSE: a segunda série começa depois que a primeira termina', async () => {
    const p = (
      await montar({
        ...base(),
        itens: [
          { chave: 'i1', procedimentoId: tirze, sessoes: 4, intervaloDias: 7, dose: '2,5 mg' },
          {
            chave: 'i2',
            procedimentoId: tirze,
            sessoes: 4,
            intervaloDias: 7,
            dose: '5 mg',
            depoisDe: 'i1',
          },
        ],
      }).expect(201)
    ).body as { id: string }

    expect((await sessoesDe(p.id)).map((s) => s.prazo)).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
      '2026-12-07',
      '2026-12-14',
      '2026-12-21',
    ])
    // A numeração é DENTRO do item: "Aplicação 1/4 · 5 mg", nunca "5/8".
    expect(
      (await sessoesDe(p.id)).filter((s) => s.item_chave === 'i2').map((s) => s.sessao_indice),
    ).toEqual([1, 2, 3, 4])
  })

  it('o `inicio` RESOLVIDO é gravado no item, e `depois_de` fica como registro', async () => {
    const p = (
      await montar({
        ...base(),
        itens: [
          { chave: 'i1', procedimentoId: tirze, sessoes: 4, intervaloDias: 7 },
          { chave: 'i2', procedimentoId: drenagem, sessoes: 2, intervaloDias: 30, depoisDe: 'i1' },
        ],
      }).expect(201)
    ).body as { id: string }

    const itens = await itensDe(p.id)
    expect(itens.map((i) => [i.chave, i.inicio, i.depois_de])).toEqual([
      ['i1', '2026-11-02', null],
      // O INTERVALO DO ENCADEAMENTO É O DO FILHO (30), medido no protótipo.
      ['i2', '2026-12-23', 'i1'],
    ])
  })

  it('CICLO em `depoisDe` é recusado pelo CONTRATO antes de chegar ao domínio', async () => {
    // O `superRefine` cobre chave repetida e `depoisDe` órfão; o ciclo de
    // DUAS chaves que existem passa por ele e morre em `montarCronograma`.
    const r = await montar({
      ...base(),
      itens: [
        { chave: 'i1', procedimentoId: tirze, sessoes: 2, intervaloDias: 7, depoisDe: 'i2' },
        { chave: 'i2', procedimentoId: tirze, sessoes: 2, intervaloDias: 7, depoisDe: 'i1' },
      ],
    })
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('i1')
    expect(await contarProgramasDe(c.pacientes['ana']!)).toBe(0)
  })
})

describe('o catálogo, conferido na montagem', () => {
  it('O NOME DO PROCEDIMENTO É CONGELADO no item — D-2 do épico 3', async () => {
    const p = (await montar(base()).expect(201)).body as { id: string }
    await c.migrate.query(`UPDATE procedimentos SET nome = 'Tirzepatida 5 mg' WHERE id = $1`, [
      tirze,
    ])
    expect((await itensDe(p.id))[0]!.procedimento_nome).toBe('Tirzepatida')
  })

  it('procedimento EXCLUÍDO é 409, com o item nomeado, e NADA foi escrito', async () => {
    await c.migrate.query(
      `UPDATE procedimentos SET excluido_em = now(), ativo = false, desativado_em = now()
        WHERE id = $1`,
      [tirze],
    )
    const r = await montar(base())
    expect(r.statusCode).toBe(409)
    expect(r.body.message).toContain('item 1')
    expect(r.body.message).toContain('catálogo')
    expect(await contarProgramasDe(c.pacientes['ana']!)).toBe(0)
    expect(await contarSessoesDe(c.pacientes['ana']!)).toBe(0)
  })

  it('procedimento DESATIVADO MONTA — desativar é "não oferecer", não "anular"', async () => {
    // Decisão P-7. O orçamento foi feito quando o procedimento estava ativo;
    // a clínica só parou de oferecê-lo. Recusar aqui faria a paciente que já
    // aceitou ficar sem programa.
    await c.migrate.query(
      `UPDATE procedimentos SET ativo = false, desativado_em = now() WHERE id = $1`,
      [tirze],
    )
    expect((await montar(base())).statusCode).toBe(201)
  })

  it('procedimento de OUTRA clínica é 409 — nem com o id na mão', async () => {
    const r = await c.migrate.query<{ id: string }>(
      'SELECT id FROM procedimentos WHERE clinica_id = $1 LIMIT 1',
      [c.outraClinica],
    )
    const resp = await montar({
      ...base(),
      itens: [{ ...ITEM, procedimentoId: r.rows[0]!.id }],
    })
    expect(resp.statusCode).toBe(409)
    expect(await contarProgramasDe(c.pacientes['ana']!)).toBe(0)
  })

  it('paciente de OUTRA clínica é 404', async () => {
    expect((await montar({ ...base(), pacienteId: c.pacienteDaOutra })).statusCode).toBe(404)
  })
})

describe('o responsável', () => {
  it('responsável INATIVO é recusado — tarefa de quem saiu não aparece para ninguém', async () => {
    // `Code.gs:355` exige `u.ativo`.
    const r = await montar({
      ...base(),
      itens: [{ ...ITEM, procedimentoId: tirze, responsavelId: c.pessoas['marta'] }],
    })
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('item 1')
    expect(await contarProgramasDe(c.pacientes['ana']!)).toBe(0)
  })

  it('sem responsável, cai no PADRÃO DO PROCEDIMENTO', async () => {
    await c.migrate.query('UPDATE procedimentos SET responsavel_id = $1 WHERE id = $2', [
      c.pessoas['nara'],
      tirze,
    ])
    const p = (await montar(base()).expect(201)).body as { id: string }
    expect((await itensDe(p.id))[0]!.responsavel_id).toBe(c.pessoas['nara'])
    expect((await sessoesDe(p.id))[0]!.responsavel_id).toBe(c.pessoas['nara'])
  })

  it('sem responsável E sem padrão, cai em quem montou', async () => {
    const p = (await montar(base()).expect(201)).body as { id: string }
    expect((await itensDe(p.id))[0]!.responsavel_id).toBe(c.pessoas['beatriz'])
  })

  it('responsável de OUTRA clínica é recusado — a RLS o torna invisível', async () => {
    const r = await c.migrate.query<{ id: string }>(
      'SELECT id FROM pessoas WHERE clinica_id = $1 LIMIT 1',
      [c.outraClinica],
    )
    expect(
      (
        await montar({
          ...base(),
          itens: [{ ...ITEM, procedimentoId: tirze, responsavelId: r.rows[0]!.id }],
        })
      ).statusCode,
    ).toBe(400)
  })
})

describe('o dinheiro da adesão', () => {
  const comPagamento = (total: string, entrada: string) => ({
    ...base(),
    pagamento: { valorTotal: total, valorEntrada: entrada, forma: 'Pix' },
  })

  it('o pagamento cria UM recebimento, com o `programa_id` preenchido', async () => {
    const p = (await montar(comPagamento('360000', '120000')).expect(201)).body as { id: string }
    const r = await recebimentosDe(p.id)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ valor: '120000', valor_aberto: '240000', programa_id: p.id })
  })

  it('A RECEITA CONTA A ENTRADA, não o total do programa', async () => {
    // Regra 3 e regra 4: o total negociado não é receita; o que entrou, é.
    const p = (await montar(comPagamento('360000', '120000')).expect(201)).body as { id: string }
    const r = await c.migrate.query<{ soma: string }>(
      `SELECT coalesce(sum(valor), 0)::text AS soma FROM recebimentos
        WHERE programa_id = $1 AND estornado_em IS NULL`,
      [p.id],
    )
    expect(r.rows[0]!.soma).toBe('120000')
  })

  it('o `valorAberto` sai de `total − entrada` em CENTAVOS INTEIROS', async () => {
    // O `Code.gs` faz `Math.round((total - ent) * 100) / 100`. Com um total
    // ímpar em centavos, essa linha erra; esta não tem como.
    const p = (await montar(comPagamento('360001', '120000')).expect(201)).body as { id: string }
    expect((await recebimentosDe(p.id))[0]!.valor_aberto).toBe('240001')
  })

  it('`modoDeCobranca` é `saldo` quando sobrou aberto, `avulso` quando não', async () => {
    expect(
      ((await montar(comPagamento('360000', '120000')).expect(201)).body as { modoDeCobranca: string })
        .modoDeCobranca,
    ).toBe('saldo')
    expect(
      ((await montar(comPagamento('360000', '360000')).expect(201)).body as { modoDeCobranca: string })
        .modoDeCobranca,
    ).toBe('avulso')
    expect(
      ((await montar(base()).expect(201)).body as { modoDeCobranca: string }).modoDeCobranca,
    ).toBe('avulso')
  })

  it('O SALDO DO ÉPICO 4 PASSA A AGRUPAR POR PROGRAMA — era um grupo só', async () => {
    const p = (await montar(comPagamento('360000', '120000')).expect(201)).body as { id: string }
    const r = await request(c.app.getHttpServer())
      .get(`/v1/pacientes/${c.pacientes['ana']}/saldo`)
      .set('Cookie', c.cookies['beatriz']!)
      .expect(200)
    const grupos = (r.body as { grupos: { programaId: string | null; saldo: string }[] }).grupos
    expect(grupos.map((g) => g.programaId)).toContain(p.id)
    expect(grupos.find((g) => g.programaId === p.id)!.saldo).toBe('240000')
  })

  it('O TOTAL É RATEADO ENTRE OS ITENS, e a soma bate EXATAMENTE', async () => {
    const p = (
      await montar({
        ...base(),
        itens: [
          { chave: 'i1', procedimentoId: tirze, sessoes: 12, intervaloDias: 7 },
          { chave: 'i2', procedimentoId: drenagem, sessoes: 3, intervaloDias: 7, depoisDe: 'i1' },
        ],
        pagamento: { valorTotal: '360001', valorEntrada: '1', forma: 'Pix' },
      }).expect(201)
    ).body as { id: string }

    const valores = (await itensDe(p.id)).map((i) => BigInt(i.valor!))
    expect(valores.reduce((s, v) => s + v, 0n)).toBe(360001n)
    // 12 e 3 sessões: 288001 e 72000. O centavo que sobra vai para o maior
    // resto — e a soma fecha, que é o que a recepção precisa para cobrar.
    expect(valores).toEqual([288001n, 72000n])
  })

  it('O CENTAVO QUE SOBRA NÃO SOME: três itens iguais, total que não divide por três', async () => {
    // O caso que o rateio por arredondamento ERRA e que o exemplo de 12 e 3
    // sessões NÃO pega — lá a divisão fecha por sorte. R$ 1.000 em três
    // partes iguais: `Math.round(100000/3)` dá 33333 três vezes, e um centavo
    // desaparece da decomposição que a recepção usa para cobrar.
    const p = (
      await montar({
        ...base(),
        itens: [
          { chave: 'i1', procedimentoId: tirze, sessoes: 4, intervaloDias: 7 },
          { chave: 'i2', procedimentoId: drenagem, sessoes: 4, intervaloDias: 7, depoisDe: 'i1' },
          { chave: 'i3', procedimentoId: tirze, sessoes: 4, intervaloDias: 7, depoisDe: 'i2' },
        ],
        pagamento: { valorTotal: '100000', valorEntrada: '1', forma: 'Pix' },
      }).expect(201)
    ).body as { id: string }

    const valores = (await itensDe(p.id)).map((i) => BigInt(i.valor!))
    expect(valores.reduce((s, v) => s + v, 0n)).toBe(100000n)
    // Maior resto, desempate pela ORDEM: o centavo vai para o primeiro.
    expect(valores).toEqual([33334n, 33333n, 33333n])
  })

  it('item com valor PRÓPRIO não é rateado; o resto do total é', async () => {
    const p = (
      await montar({
        ...base(),
        itens: [
          { chave: 'i1', procedimentoId: tirze, sessoes: 4, intervaloDias: 7, valor: '100000' },
          { chave: 'i2', procedimentoId: drenagem, sessoes: 4, intervaloDias: 7, depoisDe: 'i1' },
        ],
        pagamento: { valorTotal: '360000', valorEntrada: '1', forma: 'Pix' },
      }).expect(201)
    ).body as { id: string }
    expect((await itensDe(p.id)).map((i) => i.valor)).toEqual(['100000', '260000'])
  })

  it('SEM pagamento, nenhum item ganha valor — é o programa em modo avulso', async () => {
    const p = (await montar(base()).expect(201)).body as { id: string }
    expect((await itensDe(p.id))[0]!.valor).toBeNull()
  })
})

describe('a permissão, que o protótipo não exige', () => {
  it('SEM `receber`, o corpo COM dinheiro é 403 — e nada foi escrito', async () => {
    const r = await montar(
      { ...base(), pagamento: { valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' } },
      'nara',
    )
    expect(r.statusCode).toBe(403)
    expect(r.body.message).toContain('Recebimentos')
    expect(await contarProgramasDe(c.pacientes['ana']!)).toBe(0)
    expect(await contarSessoesDe(c.pacientes['ana']!)).toBe(0)
  })

  it('SEM `receber`, o corpo SEM dinheiro é 201 — a enfermagem monta', async () => {
    expect((await montar(base(), 'nara')).statusCode).toBe(201)
  })

  it('sem `programas`, 403', async () => {
    // `camila` é Comercial: `pacientes` e `valores`.
    expect((await montar(base(), 'camila')).statusCode).toBe(403)
  })
})

describe('os contatos de retorno', () => {
  const criarRetornoAberto = async (procedimentoId: string, pacienteId: string) => {
    const r = await c.migrate.query<{ id: string }>(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, paciente_id, tipo,
          procedimento_id)
       VALUES ($1,$2,$2,'Contato para repetir','2026-11-01',$3,'Retorno de procedimento',$4)
       RETURNING id`,
      [c.clinica, c.pessoas['juliana'], pacienteId, procedimentoId],
    )
    return r.rows[0]!.id
  }

  const buscar = async (id: string) => {
    const r = await c.migrate.query<{ status: string; obs: string }>(
      'SELECT status, obs FROM tarefas WHERE id = $1',
      [id],
    )
    return r.rows[0]!
  }

  it('montar CANCELA os contatos de retorno abertos do MESMO procedimento', async () => {
    // Sem isso, a paciente que acabou de aderir recebe a ligação de "você já
    // pode repetir". A frase é a do protótipo (`cancelarRetornos`).
    const retorno = await criarRetornoAberto(tirze, c.pacientes['ana']!)
    const p = (await montar(base()).expect(201)).body as { retornosCancelados: string[] }

    expect(await buscar(retorno)).toEqual({
      status: 'cancelada',
      obs: 'Paciente refez o procedimento',
    })
    expect(p.retornosCancelados).toContain(retorno)
  })

  it('o retorno de OUTRO procedimento continua aberto', async () => {
    const outro = await criarRetornoAberto(drenagem, c.pacientes['ana']!)
    await montar(base()).expect(201)
    expect((await buscar(outro)).status).toBe('aberta')
  })

  it('o retorno de OUTRA paciente continua aberto', async () => {
    const dela = await criarRetornoAberto(tirze, c.pacientes['bruna']!)
    await montar(base()).expect(201)
    expect((await buscar(dela)).status).toBe('aberta')
  })
})

describe('o que a sessão NÃO é', () => {
  it('A SESSÃO NÃO ENTRA NA JORNADA: `etapa` é NULL', async () => {
    // `TIPOS_REALIZADOS` do épico 2 já exclui `Sessão de plano`. Contá-la
    // faria doze aplicações de uma paciente virarem doze atendimentos no
    // denominador da conversão do funil.
    const p = (await montar(base()).expect(201)).body as { id: string }
    expect((await sessoesDe(p.id)).every((s) => s.etapa === null)).toBe(true)
  })

  it('a sessão guarda o `procedimento_id` — o épico 6 dá baixa por ele', async () => {
    const p = (await montar(base()).expect(201)).body as { id: string }
    expect((await sessoesDe(p.id)).every((s) => s.procedimento_id === tirze)).toBe(true)
  })

  it('a DOSE do insumo é gravada COM a unidade, em milésimos inteiros', async () => {
    const p = (
      await montar({
        ...base(),
        itens: [
          {
            ...ITEM,
            procedimentoId: tirze,
            insumo: { itemId: c.pacientes['bruna'], quantidade: '2500', unidade: 'mg' },
          },
        ],
      }).expect(201)
    ).body as { id: string }
    const i = (await itensDe(p.id))[0]!
    expect(i.insumo_milesimos).toBe('2500')
    expect(i.insumo_unidade).toBe('mg')
  })

  it('nenhum log contém a dose, o procedimento nem o nome da paciente', async () => {
    const linhas: string[] = []
    const metodos = ['log', 'info', 'warn', 'error', 'debug'] as const
    const originais = metodos.map((m) => console[m])
    for (const m of metodos) {
      console[m] = (...a: unknown[]) => linhas.push(a.map(String).join(' '))
    }
    try {
      await montar({
        ...base(),
        itens: [{ ...ITEM, procedimentoId: tirze, dose: '2,5 mg' }],
      }).expect(201)
    } finally {
      metodos.forEach((m, i) => {
        console[m] = originais[i]!
      })
    }
    expect(linhas.join('\n')).not.toMatch(/2,5 mg|Tirzepatida|Ana Lúcia/)
  })
})
