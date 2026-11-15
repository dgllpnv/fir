import { randomBytes, randomUUID } from 'node:crypto'
import { BadRequestException, ConflictException } from '@nestjs/common'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashDeSenha } from '../autenticacao/senha'
import { pessoaIdDeFonteConfiavel } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../banco/clinica-id'
import { apagarOperadorDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import {
  apagar,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparProgramas,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
  receitaDoDia,
} from '../tarefas/__tests__/cenario'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reiniciarLimiteDeEscritaDeEntradas } from './limite-de-escrita-de-entradas.guard'
import { gravarRecebimento } from './partes'

/**
 * FATIA 4, segunda rodada — as lacunas que a primeira deixou:
 *
 *  (a) estorno zera TODAS as partes, nos 5 caminhos reais que gravam `estornado_em`;
 *  (b) a leitura de tarefas não multiplica linhas por parte;
 *  (c) a receita não dobra: 3 partes = o mesmo que 1;
 *  (e) outras entradas, as bordas (fuso, suporte, RLS, painel, fechamento);
 *  (f) reenvio com a mesma `requisicao_id` e partes diferentes, na função comum
 *      aos 4 pontos de escrita;
 *  e a parte única implícita NÃO esconde erro.
 */
let c: Cenario
let banco: BancoService
let suporte: string
let operadorId: string
const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `partes.${sufixo}`
const SENHA_OP = 'doze-pedras-no-caminho'
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const http = () => request(c.app.getHttpServer())
const pares = (r: { headers: Record<string, string> }): string => {
  const v = r.headers['set-cookie'] as unknown
  const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
  return lista.map((x) => x.split(';')[0]!).join('; ')
}

beforeAll(async () => {
  c = await montarCenario('partes2')
  banco = c.app.get(BancoService)
  operadorId = (
    await c.migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono do Painel', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id
  const painel = pares(
    await http().post('/v1/superadmin/entrar').send({ usuario: USUARIO_OP, senha: SENHA_OP }).expect(200),
  )
  suporte = pares(
    await http()
      .post(`/v1/superadmin/clinicas/${c.clinica}/sessao-de-suporte`)
      .set('Cookie', painel)
      .expect(201),
  )
}, 60_000)

afterAll(async () => {
  await declararAtorSistema(c.migrate)
  await c.migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await desmontarCenario(c)
  const m = new pg.Client({ connectionString: URL_MIG })
  await m.connect()
  await declararAtorSistema(m)
  await apagarOperadorDeTeste(m, operadorId)
  await m.end()
})

beforeEach(async () => {
  reiniciarLimiteDeEscritaDeEntradas()
  await limparProgramas(c)
  await limparTarefas(c)
  await limparFinanceiro(c)
})

const TRES = [
  { forma: 'Pix', valor: '4000' },
  { forma: 'Dinheiro', valor: '3500' },
  { forma: 'Cartão de débito', valor: '2500' },
]
const DOIS = [
  { forma: 'Pix', valor: '6000' },
  { forma: 'Dinheiro', valor: '4000' },
]

const avulso = (extra: Record<string, unknown>, quem = 'beatriz') =>
  postar(
    c,
    '/v1/recebimentos',
    {
      requisicaoId: randomUUID(),
      pacienteId: c.pacientes['ana'],
      em: HOJE,
      ref: 'consulta',
      ...extra,
    },
    quem,
  )

/** Consulta realizada, retroativa, com o pagamento embutido (R$ 100,00). */
const tarefaComPagamento = async (pag: Record<string, unknown>, paciente = 'ana'): Promise<string> => {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes[paciente],
      tipo: 'Consulta realizada',
      responsavelId: c.pessoas['beatriz'],
      quando: { modo: 'retroativo', em: HOJE, pagamento: pag },
    },
    'beatriz',
  )
  expect(r.statusCode, r.text).toBe(201)
  return r.body.tarefa.id as string
}

const somaDe = (xs: { valor?: string | null }[]): bigint =>
  xs.reduce((s, x) => s + BigInt(x.valor ?? '0'), 0n)

/** Partes de recebimentos VIVOS, somadas direto no banco. */
const partesVivas = async (): Promise<bigint> => {
  const r = await c.migrate.query<{ s: string }>(
    `SELECT coalesce(sum(pt.valor), 0)::text AS s
       FROM recebimento_partes pt JOIN recebimentos r ON r.id = pt.recebimento_id
      WHERE r.clinica_id = $1 AND r.estornado_em IS NULL`,
    [c.clinica],
  )
  return BigInt(r.rows[0]!.s)
}

/**
 * Depois do estorno, NENHUM leitor "por forma" vê dinheiro: caixa, visão do
 * mês, painel e funil. As partes ficam gravadas (imutáveis) — o estado é do pai.
 */
async function tudoZerado(): Promise<void> {
  expect(await receitaDoDia(c)).toBe(0n)
  expect(await partesVivas()).toBe(0n)
  const fecho = await postar(
    c,
    '/v1/caixa',
    { dia: HOJE, obs: '', contado: [{ forma: 'Pix', valor: '0' }] },
    'beatriz',
  )
  expect(fecho.statusCode, fecho.text).toBe(201)
  for (const l of fecho.body.porForma as { esperado: string }[]) expect(l.esperado).toBe('0')
  expect(fecho.body.conferido).toBe(true)

  const visao = await pegar(c, '/v1/visao-do-mes', { mes: HOJE.slice(0, 7) }, 'beatriz')
  expect(visao.body.recebido).toBe('0')
  expect(visao.body.quantidadeDeRecebimentos).toBe(0)
  expect(somaDe(visao.body.porForma)).toBe(0n)

  const painel = await pegar(c, '/v1/painel', { periodo: 'mes' }, 'beatriz')
  expect(painel.body.pacientes.receita).toBe('0')
  expect(somaDe(painel.body.pacientes.porForma)).toBe(0n)

  const funil = await pegar(c, '/v1/jornada/recebimentos-diretos', { periodo: '30dias' }, 'beatriz')
  expect(funil.body.itens).toHaveLength(0)
}

describe('(a) estorno-zera-todas-as-partes — os 5 caminhos que gravam estornado_em', () => {
  it('1. recebimentos.service: estornar o avulso', async () => {
    const r = await avulso({ valor: '10000', partes: TRES })
    expect(r.statusCode, r.text).toBe(201)
    expect(await partesVivas()).toBe(10000n)
    expect((await apagar(c, `/v1/recebimentos/${r.body.id}`, {}, 'beatriz')).statusCode).toBe(204)
    await tudoZerado()
  })

  it('2. conclusao.service: reabrir a tarefa estorna o pagamento embutido', async () => {
    const id = await tarefaComPagamento({ valor: '10000', partes: TRES })
    expect(await partesVivas()).toBe(10000n)
    const r = await postar(c, `/v1/tarefas/${id}/reabrir`, {}, 'beatriz')
    expect(r.statusCode, r.text).toBe(200)
    await tudoZerado()
  })

  it('3. edicao.service: excluir a tarefa com pagamento estorna o dinheiro', async () => {
    const id = await tarefaComPagamento({ valor: '10000', partes: TRES })
    expect(await partesVivas()).toBe(10000n)
    const r = await request(c.app.getHttpServer())
      .delete(`/v1/tarefas/${id}`)
      .set('Cookie', c.cookies['beatriz']!)
      .send({ motivo: 'Lancamento duplicado na conferencia' })
    expect(r.statusCode, r.text).toBe(200)
    await tudoZerado()
  })

  it('4. desfazer-orcamento.service: reabrir o orçamento estorna a entrada', async () => {
    const proc = (
      await c.migrate.query<{ id: string }>(
        'SELECT id FROM procedimentos WHERE clinica_id = $1 ORDER BY nome LIMIT 1',
        [c.clinica],
      )
    ).rows[0]!.id
    const nova = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'paciente',
        pacienteId: c.pacientes['ana'],
        tipo: 'Consulta agendada',
        responsavelId: c.pessoas['beatriz'],
        quando: { modo: 'retroativo', em: HOJE },
      },
      'beatriz',
    )
    const tarefaId = nova.body.tarefa.id as string
    const mover = (corpo: Record<string, unknown>) =>
      postar(c, `/v1/tarefas/${tarefaId}/jornada`, corpo, 'beatriz')
    const o = await mover({
      acao: 'registrarOrcamento',
      valor: '1000000',
      programa: [{ chave: 'p1', procedimentoId: proc, sessoes: 4, intervaloDias: 7 }],
    })
    expect(o.statusCode, o.text).toBe(200)
    const f = await mover({
      acao: 'fechar',
      fechamento: 'tudo',
      recebimento: { valor: '10000', partes: TRES, valorAberto: '990000' },
    })
    expect(f.statusCode, f.text).toBe(200)
    expect(await partesVivas()).toBe(10000n)
    const reabrir = await mover({
      acao: 'reabrirOrcamento',
      motivo: 'Fechei o orcamento errado, preciso refazer',
    })
    expect(reabrir.statusCode, reabrir.text).toBe(200)
    await tudoZerado()
  })

  it('5. sessoes.service: reabrir a sessão estorna o pagamento dela', async () => {
    const proc = (
      await c.migrate.query<{ id: string }>(
        `SELECT id FROM procedimentos WHERE clinica_id = $1 AND nome_chave = 'tirzepatida'`,
        [c.clinica],
      )
    ).rows[0]!.id
    const p = await postar(
      c,
      '/v1/programas',
      {
        pacienteId: c.pacientes['ana'],
        inicio: '2026-09-07',
        itens: [{ chave: 'i1', procedimentoId: proc, sessoes: 4, intervaloDias: 7 }],
      },
      'beatriz',
    )
    expect(p.statusCode, p.text).toBe(201)
    const sessao = (
      await c.migrate.query<{ id: string }>(
        `SELECT id FROM tarefas WHERE programa_id = $1 AND tipo = 'Sessão de plano'
          ORDER BY sessao_indice LIMIT 1`,
        [p.body.id],
      )
    ).rows[0]!.id
    const conc = await postar(
      c,
      `/v1/programas/sessoes/${sessao}/concluir`,
      { em: HOJE, reprogramar: false, pagamento: { valor: '10000', partes: TRES } },
      'beatriz',
    )
    expect(conc.statusCode, conc.text).toBe(200)
    expect(await partesVivas()).toBe(10000n)
    const re = await postar(c, `/v1/programas/sessoes/${sessao}/reabrir`, {}, 'beatriz')
    expect(re.statusCode, re.text).toBe(200)
    await tudoZerado()
  })
})

describe('(b) tarefas-leitura-nao-multiplica-linhas', () => {
  it('a tarefa com 3 partes aparece UMA vez em Hoje, Tarefas e na ficha', async () => {
    const id = await tarefaComPagamento({ valor: '10000', partes: TRES })
    const conta = (xs: { id: string }[]) => xs.filter((x) => x.id === id).length

    const hoje = await pegar(c, '/v1/hoje', {}, 'beatriz')
    expect(hoje.statusCode, hoje.text).toBe(200)
    expect(conta(hoje.body.tarefas)).toBeLessThanOrEqual(1)

    const lista = await pegar(c, '/v1/tarefas', { periodo: 'per', de: HOJE, ate: HOJE }, 'beatriz')
    expect(lista.statusCode, lista.text).toBe(200)
    expect(conta(lista.body.tarefas)).toBe(1)
    const naLista = (lista.body.tarefas as { id: string; pagamento?: { partes: unknown[] } }[]).find(
      (x) => x.id === id,
    )!
    expect(naLista.pagamento?.partes).toHaveLength(3)

    const ficha = await pegar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
    expect(ficha.body.tarefa.pagamento.partes).toHaveLength(3)
    expect(ficha.body.tarefa.pagamento.valor).toBe('10000')
  })
})

describe('(c) receita-nao-dobra-com-partes', () => {
  async function foto() {
    const painel = await pegar(c, '/v1/painel', { periodo: 'mes' }, 'beatriz')
    const visao = await pegar(c, '/v1/visao-do-mes', { mes: HOJE.slice(0, 7) }, 'beatriz')
    const { porForma: _naoComparavel, ...pacientes } = painel.body.pacientes
    const dentro = await c.migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM recebimentos r
         LEFT JOIN (SELECT recebimento_id, sum(valor) AS s FROM recebimento_partes GROUP BY recebimento_id) p
                ON p.recebimento_id = r.id
        WHERE r.clinica_id = $1 AND coalesce(p.s, 0) <> r.valor`,
      [c.clinica],
    )
    return {
      receitaDoDia: await receitaDoDia(c),
      pacientes,
      topPagantes: painel.body.topPagantes,
      campanhas: painel.body.campanhas,
      recebido: visao.body.recebido,
      quantidade: visao.body.quantidadeDeRecebimentos,
      resultado: visao.body.resultadoDoMes,
      divergentes: dentro.rows[0]!.n,
    }
  }

  it('R$ 100,00 em 3 partes (40+35+25) = o mesmo que 1 parte, em tudo menos no "por forma"', async () => {
    await tarefaComPagamento({ valor: '10000', forma: 'Pix' })
    const umaParte = await foto()
    await limparTarefas(c)
    await limparFinanceiro(c)
    await tarefaComPagamento({ valor: '10000', partes: TRES })
    const tresPartes = await foto()
    expect(tresPartes).toEqual(umaParte)
    expect(tresPartes.receitaDoDia).toBe(10000n)
    expect(tresPartes.quantidade).toBe(1)
    expect(tresPartes.divergentes).toBe('0')
  })
})

describe('(e) outras entradas — as bordas', () => {
  const categoria = async (nome = 'Aluguel de sala') => {
    const r = await postar(c, '/v1/categorias-de-entrada', { nome }, 'beatriz')
    expect(r.statusCode, r.text).toBe(201)
    return r.body.id as string
  }
  const lancar = (categoriaId: string, extra: Record<string, unknown> = {}, quem = 'beatriz') =>
    postar(
      c,
      '/v1/outras-entradas',
      {
        requisicaoId: randomUUID(),
        categoriaId,
        em: HOJE,
        valor: '7000',
        forma: 'Pix',
        descricao: 'Aluguel',
        ...extra,
      },
      quem,
    )
  const direto = (cat: string, instante: string) =>
    c.migrate.query(
      `INSERT INTO outras_entradas (clinica_id, categoria_id, recebida_em, valor, forma, requisicao_id, criado_por)
       VALUES ($1,$2,$3,100,'Pix',$4,$5)`,
      [c.clinica, cat, instante, randomUUID(), c.pessoas['beatriz']],
    )

  it('fora de LTV, ticket, campanhas e receita: o painel as mostra em linha própria', async () => {
    await tarefaComPagamento({ valor: '10000', forma: 'Pix' })
    const antes = (await pegar(c, '/v1/painel', { periodo: 'mes' }, 'beatriz')).body
    await lancar(await categoria(), { valor: '7000' })
    const depois = (await pegar(c, '/v1/painel', { periodo: 'mes' }, 'beatriz')).body
    expect(depois.pacientes.outrasEntradas).toBe('7000')
    expect(depois.pacientes.quantidadeDeOutrasEntradas).toBe(1)
    for (const k of ['receita', 'pagamentos', 'ticketMedio', 'pacientesAtendidos']) {
      expect(depois.pacientes[k], k).toEqual(antes.pacientes[k])
    }
    expect(depois.topPagantes).toEqual(antes.topPagantes)
    expect(depois.campanhas).toEqual(antes.campanhas)
    expect(await receitaDoDia(c)).toBe(10000n)
  })

  it('a fronteira do mês é no fuso da clínica: 23h30 local de 31/10 é outubro; 00h00 de 1/11 é novembro', async () => {
    const cat = await categoria()
    await direto(cat, '2026-11-01T02:30:00Z') // 31/10 23:30 em America/Bahia
    await direto(cat, '2026-11-01T03:00:00Z') // 01/11 00:00
    await direto(cat, '2026-10-01T02:59:59Z') // 30/09 23:59:59
    await direto(cat, '2026-10-01T03:00:00Z') // 01/10 00:00
    const mes = async (m: string) =>
      (await pegar(c, '/v1/outras-entradas', { mes: m }, 'beatriz')).body.itens.length as number
    expect(await mes('2026-10')).toBe(2) // 31/10 23:30 e 01/10 00:00
    expect(await mes('2026-11')).toBe(1)
    expect(await mes('2026-09')).toBe(1)
  })

  it('a sessão de suporte não assina nenhuma das escritas', async () => {
    const cat = await categoria()
    const e = await lancar(cat)
    const recusado = async (r: request.Test, rotulo: string) => {
      const res = await r
      expect(res.statusCode, `${rotulo}: ${res.text}`).toBe(403)
      expect(res.body.codigo, rotulo).toBe('SESSAO_DE_SUPORTE_NAO_ASSINA')
    }
    await recusado(
      http().post('/v1/outras-entradas').set('Cookie', suporte).send({
        requisicaoId: randomUUID(),
        categoriaId: cat,
        em: HOJE,
        valor: '100',
        forma: 'Pix',
      }),
      'lancar',
    )
    await recusado(http().delete(`/v1/outras-entradas/${e.body.id}`).set('Cookie', suporte), 'estornar')
    await recusado(
      http().post('/v1/categorias-de-entrada').set('Cookie', suporte).send({ nome: 'Suporte' }),
      'categoria',
    )
  })

  it('RLS: categoria de OUTRA clínica é recusada pela API e pela constraint do banco', async () => {
    const dela = (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO categorias_de_entrada (clinica_id, nome) VALUES ($1, 'Da vizinha') RETURNING id`,
        [c.outraClinica],
      )
    ).rows[0]!.id
    expect((await lancar(dela)).statusCode).toBe(404)
    await expect(direto(dela, '2026-10-24T15:00:00Z')).rejects.toThrow(/outra_entrada_e_de_categoria/)
    // E a lista só traz o que é da clínica logada.
    const lista = await pegar(c, '/v1/outras-entradas', { dia: HOJE }, 'beatriz')
    expect(lista.body.itens).toHaveLength(0)
  })

  it('criada depois do fechamento exige confirmação e marca mudouDepoisDoFechamento; estornada depois também marca', async () => {
    const cat = await categoria()
    const antes = await lancar(cat, { valor: '7000' })
    await postar(
      c,
      '/v1/caixa',
      { dia: HOJE, obs: '', contado: [{ forma: 'Pix', valor: '7000' }] },
      'beatriz',
    )
    expect((await pegar(c, '/v1/caixa', { dia: HOJE }, 'beatriz')).body.mudouDepoisDoFechamento).toBe(false)
    // Estorno depois do fechamento.
    expect((await apagar(c, `/v1/outras-entradas/${antes.body.id}`, {}, 'beatriz')).statusCode).toBe(204)
    expect((await pegar(c, '/v1/caixa', { dia: HOJE }, 'beatriz')).body.mudouDepoisDoFechamento).toBe(true)
    // Lançamento depois do fechamento: 409 sem confirmar, 201 confirmando.
    expect((await lancar(cat)).statusCode).toBe(409)
    expect((await lancar(cat, { confirmarCaixaFechado: true })).statusCode).toBe(201)
  })
})

describe('(f) reenvio com a mesma requisicao_id e partes diferentes — a função dos 4 pontos', () => {
  const emTransacao = async <T>(fn: () => Promise<T>): Promise<T> => {
    await c.migrate.query('BEGIN')
    try {
      const r = await fn()
      await c.migrate.query('COMMIT')
      return r
    } catch (e) {
      await c.migrate.query('ROLLBACK')
      throw e
    }
  }
  const gravar = (
    requisicaoId: string,
    partes: { forma: string; valor: bigint }[],
    valor = partes.reduce((s, p) => s + p.valor, 0n),
  ) =>
    emTransacao(() =>
      gravarRecebimento(c.migrate as unknown as pg.PoolClient, {
        clinicaId: c.clinica,
        pacienteId: c.pacientes['ana']!,
        tarefaId: null,
        tipo: 'Pagamento de consulta',
        valor,
        valorAberto: 0n,
        recebidoEm: new Date('2026-10-24T15:00:00Z'),
        unidadeId: null,
        registradoPor: c.pessoas['beatriz']!,
        requisicaoId,
        partes,
      }),
    )

  it('3 envios iguais gravam uma vez; outras partes = 409; soma errada = 400 sem tocar o banco', async () => {
    const chave = randomUUID()
    const partes = [
      { forma: 'Pix', valor: 6000n },
      { forma: 'Dinheiro', valor: 4000n },
    ]
    const a = await gravar(chave, partes)
    const b = await gravar(chave, partes)
    const d = await gravar(chave, partes)
    expect([a.criado, b.criado, d.criado]).toEqual([true, false, false])
    expect(new Set([a.id, b.id, d.id]).size).toBe(1)
    await expect(
      gravar(chave, [
        { forma: 'Pix', valor: 1000n },
        { forma: 'Dinheiro', valor: 9000n },
      ]),
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(
      gravar(randomUUID(), [{ forma: 'Pix', valor: 100n }], 500n),
    ).rejects.toBeInstanceOf(BadRequestException)
    const n = await c.migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM recebimentos WHERE clinica_id = $1',
      [c.clinica],
    )
    expect(n.rows[0]!.n).toBe('1')
  })
})

describe('a parte única implícita NÃO esconde erro', () => {
  const inserirSemPartes = (valor: string, forma: string) =>
    c.migrate.query<{ id: string }>(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por)
       VALUES ($1,$2,'Consulta realizada',$3,$4,'2026-10-24T15:00:00Z',$5) RETURNING id`,
      [c.clinica, c.pacientes['ana'], valor, forma, c.pessoas['juliana']],
    )

  it('para o papel da APLICAÇÃO o recebimento sem parte é recusado no COMMIT', async () => {
    await expect(
      banco.naClinica(
        clinicaIdDeFonteConfiavel(c.clinica),
        pessoaIdDeFonteConfiavel(c.pessoas['beatriz']!),
        (cx) =>
          cx.query(
            `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por)
             VALUES ($1,$2,'Consulta realizada',500,'Pix',now(),$3)`,
            [c.clinica, c.pacientes['ana'], c.pessoas['beatriz']],
          ),
      ),
    ).rejects.toThrow(/ao menos uma parte/)
  })

  it('para o dono só preenche quando NÃO há parte alguma e a forma é válida', async () => {
    const r = await inserirSemPartes('500', 'Pix')
    const partes = await c.migrate.query('SELECT forma, valor::text FROM recebimento_partes WHERE recebimento_id = $1', [
      r.rows[0]!.id,
    ])
    expect(partes.rows).toEqual([{ forma: 'Pix', valor: '500' }])
    // Venda a prazo (valor 0): nenhuma parte.
    const prazo = await c.migrate.query<{ id: string }>(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
       VALUES ($1,$2,'Pagamento de orçamento',0,'',900,'2026-10-24T15:00:00Z',$3) RETURNING id`,
      [c.clinica, c.pacientes['ana'], c.pessoas['juliana']],
    )
    const semParte = await c.migrate.query('SELECT 1 FROM recebimento_partes WHERE recebimento_id = $1', [
      prazo.rows[0]!.id,
    ])
    expect(semParte.rowCount).toBe(0)
  })

  it('parte que existe mas não fecha a conta nunca é "consertada"', async () => {
    await c.migrate.query('BEGIN')
    try {
      const r = await inserirSemPartes('500', 'Pix') // o gatilho implícito ainda não rodou (deferido)
      await c.migrate.query(
        'INSERT INTO recebimento_partes (clinica_id, recebimento_id, forma, valor) VALUES ($1,$2,$3,$4)',
        [c.clinica, r.rows[0]!.id, 'Pix', '300'],
      )
      await expect(c.migrate.query('COMMIT')).rejects.toThrow(/soma das partes/)
    } finally {
      await c.migrate.query('ROLLBACK').catch(() => undefined)
    }
  })
})

/* ======================================================= REVISÃO DA FATIA 4 */

describe('V-1 · saldo-em-aberto-com-varias-formas-acima-da-divida-nao-reescreve-forma', () => {
  // Dívida de R$ 400,00 no grupo geral.
  const divida400 = async () => {
    const r = await avulso({ valor: '10000', forma: 'Pix', valorAberto: '40000' })
    expect(r.statusCode, r.text).toBe(201)
  }
  const pagarSaldo = (extra: Record<string, unknown>, quem = 'beatriz') =>
    avulso({ ref: 'saldo', ...extra }, quem)
  const PIX300_DIN200 = [
    { forma: 'Pix', valor: '30000' },
    { forma: 'Dinheiro', valor: '20000' },
  ]

  it('Pix 300 + Dinheiro 200 numa dívida de 400 → 409 PARTES_ACIMA_DA_DIVIDA, com o devido para quem vê valores', async () => {
    await divida400()
    const r = await pagarSaldo({ valor: '50000', partes: PIX300_DIN200 })
    expect(r.statusCode, r.text).toBe(409)
    expect(r.body).toEqual({
      statusCode: 409,
      codigo: 'PARTES_ACIMA_DA_DIVIDA',
      message: expect.any(String),
      devido: '40000',
    })
    expect(await receitaDoDia(c)).toBe(10000n) // nada gravado
  })

  it('sem `valores` o 409 leva só o código — a chave `devido` não existe', async () => {
    await divida400()
    const r = await pagarSaldo({ valor: '50000', partes: PIX300_DIN200 }, 'rita')
    expect(r.statusCode, r.text).toBe(409)
    expect(r.body.codigo).toBe('PARTES_ACIMA_DA_DIVIDA')
    expect(Object.keys(r.body)).not.toContain('devido')
    expect(r.text).not.toContain('40000')
  })

  it('Dinheiro 400 → 201, Dinheiro 400', async () => {
    await divida400()
    const r = await pagarSaldo({ valor: '40000', forma: 'Dinheiro' })
    expect(r.statusCode, r.text).toBe(201)
    expect(r.body.partes).toEqual([{ forma: 'Dinheiro', valor: '40000' }])
  })

  it('Pix 300 + Dinheiro 100 → 201 exato, sem tocar forma nenhuma', async () => {
    await divida400()
    const r = await pagarSaldo({
      valor: '40000',
      partes: [
        { forma: 'Pix', valor: '30000' },
        { forma: 'Dinheiro', valor: '10000' },
      ],
    })
    expect(r.statusCode, r.text).toBe(201)
    expect(r.body.partes).toEqual([
      { forma: 'Pix', valor: '30000' },
      { forma: 'Dinheiro', valor: '10000' },
    ])
  })

  it('UMA forma de 999 → corta para 400 (pedido 6 continua)', async () => {
    await divida400()
    const r = await pagarSaldo({ valor: '99900', forma: 'Pix' })
    expect(r.statusCode, r.text).toBe(201)
    expect(r.body.valor).toBe('40000')
    expect(r.body.partes).toEqual([{ forma: 'Pix', valor: '40000' }])
  })
})

describe('desempate da forma principal: o mesmo no domínio e no SQL', () => {
  it('Dinheiro 50 + Pix 50: a primeira DIGITADA é a principal, e a primeira da lista', async () => {
    const r = await avulso({
      valor: '10000',
      partes: [
        { forma: 'Dinheiro', valor: '5000' },
        { forma: 'Pix', valor: '5000' },
      ],
    })
    expect(r.statusCode, r.text).toBe(201)
    const legado = await c.migrate.query<{ forma: string }>(
      'SELECT forma FROM recebimentos WHERE id = $1',
      [r.body.id],
    )
    expect(legado.rows[0]!.forma).toBe('Dinheiro')
    expect(r.body.forma).toBe('Dinheiro')
    expect(r.body.partes.map((p: { forma: string }) => p.forma)).toEqual(['Dinheiro', 'Pix'])
  })
})

describe('outras entradas — revisão', () => {
  const categoria = async (nome = 'Aluguel de sala') => {
    const r = await postar(c, '/v1/categorias-de-entrada', { nome }, 'beatriz')
    expect(r.statusCode, r.text).toBe(201)
    return r.body.id as string
  }
  const corpo = (categoriaId: string, extra: Record<string, unknown> = {}) => ({
    requisicaoId: randomUUID(),
    categoriaId,
    em: HOJE,
    valor: '7000',
    forma: 'Pix',
    ...extra,
  })

  it('R1: a mesma requisicaoId com valor, forma, categoria ou dia diferentes → 409', async () => {
    const cat = await categoria()
    const outra = await categoria('Reembolso')
    const primeiro = corpo(cat)
    expect((await postar(c, '/v1/outras-entradas', primeiro, 'beatriz')).statusCode).toBe(201)
    const mudancas: Record<string, unknown>[] = [
      { valor: '7001' },
      { forma: 'Dinheiro' },
      { categoriaId: outra },
      { em: '2026-10-23' },
    ]
    for (const mudanca of mudancas) {
      const r = await postar(c, '/v1/outras-entradas', { ...primeiro, ...mudanca }, 'beatriz')
      expect(r.statusCode, JSON.stringify(mudanca)).toBe(409)
    }
    // E o reenvio idêntico continua devolvendo o original.
    expect((await postar(c, '/v1/outras-entradas', primeiro, 'beatriz')).statusCode).toBe(201)
  })

  it('incluirEstornadas=false NÃO traz a estornada; =true traz', async () => {
    const cat = await categoria()
    const e = await postar(c, '/v1/outras-entradas', corpo(cat), 'beatriz')
    await apagar(c, `/v1/outras-entradas/${e.body.id}`, {}, 'beatriz')
    const nao = await pegar(
      c,
      '/v1/outras-entradas',
      { dia: HOJE, incluirEstornadas: 'false' },
      'beatriz',
    )
    const sim = await pegar(
      c,
      '/v1/outras-entradas',
      { dia: HOJE, incluirEstornadas: 'true' },
      'beatriz',
    )
    expect(nao.body.itens).toHaveLength(0)
    expect(sim.body.itens).toHaveLength(1)
  })

  it('E5: as escritas têm freio — a 61ª no minuto é 429', async () => {
    reiniciarLimiteDeEscritaDeEntradas()
    for (let i = 0; i < 60; i++) {
      const r = await apagar(c, `/v1/outras-entradas/${randomUUID()}`, {}, 'beatriz')
      expect(r.statusCode).toBe(404)
    }
    const barrada = await postar(c, '/v1/categorias-de-entrada', { nome: 'Depois do freio' }, 'beatriz')
    expect(barrada.statusCode).toBe(429)
    expect(barrada.body.retryAfter).toBeGreaterThan(0)
    // A leitura não consome a cota.
    expect((await pegar(c, '/v1/outras-entradas', { dia: HOJE }, 'beatriz')).statusCode).toBe(200)
    reiniciarLimiteDeEscritaDeEntradas()
  })
})

describe('o banco — conferência, endurecimento R3 e a 0088', () => {
  const comoApp = <T>(fn: (cx: pg.PoolClient) => Promise<T>) =>
    banco.naClinica(
      clinicaIdDeFonteConfiavel(c.clinica),
      pessoaIdDeFonteConfiavel(c.pessoas['beatriz']!),
      fn,
    )
  const legadoVazio = (valor: string) =>
    c.migrate.query(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por)
       VALUES ($1,$2,'Consulta realizada',$3,'','2026-10-24T15:00:00Z',$4)`,
      [c.clinica, c.pacientes['ana'], valor, c.pessoas['beatriz']],
    )

  it('a conferência é SECURITY DEFINER e roda para o papel da aplicação (RLS ligada): soma errada é recusada', async () => {
    const f = await c.migrate.query<{ prosecdef: boolean }>(
      `SELECT prosecdef FROM pg_proc WHERE proname = 'conferir_partes_do_recebimento'`,
    )
    expect(f.rows[0]!.prosecdef).toBe(true)
    await expect(
      comoApp(async (cx) => {
        const r = await cx.query<{ id: string }>(
          `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por)
           VALUES ($1,$2,'Consulta realizada',500,'Pix',now(),$3) RETURNING id`,
          [c.clinica, c.pacientes['ana'], c.pessoas['beatriz']],
        )
        await cx.query(
          'INSERT INTO recebimento_partes (clinica_id, recebimento_id, forma, valor) VALUES ($1,$2,$3,$4)',
          [c.clinica, r.rows[0]!.id, 'Pix', '300'],
        )
      }),
    ).rejects.toThrow(/soma das partes/)
  })

  it('R3: a aplicação não apaga recebimento, e não desfaz estorno', async () => {
    const r = await avulso({ valor: '10000', forma: 'Pix' })
    await expect(
      comoApp((cx) => cx.query('DELETE FROM recebimentos WHERE id = $1', [r.body.id])),
    ).rejects.toThrow(/permission denied|permissão negada/)
    expect((await apagar(c, `/v1/recebimentos/${r.body.id}`, {}, 'beatriz')).statusCode).toBe(204)
    await expect(
      comoApp((cx) =>
        cx.query('UPDATE recebimentos SET estornado_em = NULL WHERE id = $1', [r.body.id]),
      ),
    ).rejects.toThrow(/estornado não volta/)
  })

  it('caixa fechado + promissória ou legado vazio DEPOIS → mudouDepoisDoFechamento continua false', async () => {
    await avulso({ valor: '10000', forma: 'Pix' })
    const f = await postar(
      c,
      '/v1/caixa',
      { dia: HOJE, obs: '', contado: [{ forma: 'Pix', valor: '10000' }] },
      'beatriz',
    )
    expect(f.statusCode, f.text).toBe(201)
    const prom = await avulso({
      valor: '20000',
      forma: 'Nota promissória',
      confirmarCaixaFechado: true,
    })
    expect(prom.statusCode, prom.text).toBe(201)
    await legadoVazio('30000')
    const dia = await pegar(c, '/v1/caixa', { dia: HOJE }, 'beatriz')
    expect(dia.body.mudouDepoisDoFechamento).toBe(false)
  })

  it('visão do mês com todos os dias de dinheiro conferidos: Σ porForma = recebido EXATO', async () => {
    await avulso({ valor: '10000', partes: TRES })
    await avulso({ valor: '4321', forma: 'Pix' })
    await legadoVazio('777')
    const f = await postar(
      c,
      '/v1/caixa',
      {
        dia: HOJE,
        obs: '',
        contado: [
          { forma: 'Pix', valor: '8321' },
          { forma: 'Dinheiro', valor: '3500' },
          { forma: 'Cartão de débito', valor: '2500' },
        ],
      },
      'beatriz',
    )
    expect(f.statusCode, f.text).toBe(201)
    expect(f.body.conferido).toBe(true)
    const v = await pegar(c, '/v1/visao-do-mes', { mes: HOJE.slice(0, 7) }, 'beatriz')
    expect(v.body.recebido).toBe('15098')
    expect(somaDe(v.body.porForma)).toBe(15098n)
    const formas = (v.body.porForma as { forma: string }[]).map((x) => x.forma)
    expect(formas).toContain('Não informada')
    expect(formas).not.toContain('')
  })

  describe('a 0088 como migration', () => {
    const SQL = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../migrations/0088_backfill_das_partes.sql'),
      'utf8',
    )
    /**
     * Recebimentos SEM parte, como eram antes da 0086. A cura implícita e a
     * conferência ficam desligadas SÓ dentro desta transação (DDL é
     * transacional no Postgres), e o ROLLBACK as religa.
     */
    const legado = async () => {
      await c.migrate.query('BEGIN')
      await c.migrate.query(
        'ALTER TABLE recebimentos DISABLE TRIGGER recebimento_0_parte_unica_implicita, DISABLE TRIGGER recebimento_1_soma_das_partes',
      )
      const ins = (valor: string, forma: string, aberto = '0') =>
        c.migrate.query<{ id: string }>(
          `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
           VALUES ($1,$2,'Consulta realizada',$3,$4,$5,'2026-10-24T15:00:00Z',$6) RETURNING id`,
          [c.clinica, c.pacientes['ana'], valor, forma, aberto, c.pessoas['beatriz']],
        )
      return {
        pix: (await ins('500', 'Pix')).rows[0]!.id,
        vazia: (await ins('700', '')).rows[0]!.id,
        prazo: (await ins('0', '', '900')).rows[0]!.id,
      }
    }

    it('3x: uma parte por recebimento com valor, inclusive a vazia; a venda a prazo fica sem; nada duplica', async () => {
      try {
        const ids = await legado()
        for (let i = 0; i < 3; i++) await c.migrate.query(SQL)
        const partes = await c.migrate.query<{ recebimento_id: string; forma: string; valor: string }>(
          `SELECT recebimento_id, forma, valor::text AS valor FROM recebimento_partes
            WHERE recebimento_id = ANY($1::uuid[]) ORDER BY valor`,
          [[ids.pix, ids.vazia, ids.prazo]],
        )
        expect(partes.rows).toEqual([
          { recebimento_id: ids.pix, forma: 'Pix', valor: '500' },
          { recebimento_id: ids.vazia, forma: '', valor: '700' },
        ])
      } finally {
        await c.migrate.query('ROLLBACK')
      }
    })

    it('ABORTA quando a soma das partes diverge do valor', async () => {
      try {
        const ids = await legado()
        await c.migrate.query(
          'ALTER TABLE recebimento_partes DISABLE TRIGGER parte_soma_fecha_com_o_recebimento',
        )
        await c.migrate.query(
          'INSERT INTO recebimento_partes (clinica_id, recebimento_id, forma, valor) VALUES ($1,$2,$3,$4)',
          [c.clinica, ids.pix, 'Pix', '499'],
        )
        await expect(c.migrate.query(SQL)).rejects.toThrow(/soma das partes diferente do valor/)
      } finally {
        await c.migrate.query('ROLLBACK')
      }
    })
  })
})
