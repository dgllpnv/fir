import type { Painel } from '@fir/contracts'
import { TIPO_SESSAO, type Relogio } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'

/**
 * **Gestão › Painel geral** (MANUAL cap. 10).
 *
 * O que este arquivo fixa:
 *
 *  1. **OS TRÊS RECORTES SÃO DIFERENTES** — prazos olha o PRAZO, pacientes
 *     olha a CONCLUSÃO, "quem solicitou" olha a CRIAÇÃO. Confundi-los é o
 *     defeito, e a fixture tem uma tarefa que cai em recortes diferentes em
 *     cada um dos três.
 *  2. **O DENOMINADOR DA TAXA NÃO É O TOTAL** — `a vencer` fica de fora.
 *  3. **O RECEBIDO POR FORMA SÓ ALCANÇA DIAS COM CAIXA FECHADO** (regra 6).
 *     É a defesa que o protótipo não tem.
 *  4. **AS BORDAS DO PERÍODO VÊM DO SERVIDOR**, no fuso da clínica.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'cinco-portas-de-ferro-batido'
const codigo = `pnl-${Date.now()}`

/** 18/11/2026, 12:00 UTC — 09:00 em `America/Bahia`. */
const INICIO = new Date('2026-11-18T12:00:00.000Z')
let agora = new Date(INICIO)
const relogioDeTeste: Relogio = { agora: () => agora }

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let helena: string
let juliana: string
let paciente: string
let outroPaciente: string
let terceiroPaciente: string
let gestao: string[]
let semPainel: string[]

const srv = () => request(app.getHttpServer())
const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

const ver = async (consulta = 'periodo=mes', cookie = gestao): Promise<Painel> => {
  const r = await srv().get(`/v1/painel?${consulta}`).set('Cookie', cookie).expect(200)
  return r.body as Painel
}

/** O instante de um dia de novembro, às 15:00 UTC (12:00 na Bahia). */
const em = (dia: number): string => `2026-11-${String(dia).padStart(2, '0')}T15:00:00.000Z`

type Linha = {
  resp?: string
  sol?: string
  tipo?: string
  status?: 'aberta' | 'concluida' | 'cancelada'
  prazo: string
  concluidaEm?: string
  criadaEm?: string
  comPaciente?: boolean
  segundoPaciente?: boolean
  terceiroPaciente?: boolean
  /** A unidade DA TAREFA. Sem ela, vale a da paciente (`unidadeDaTarefa`). */
  unidadeId?: string
  campanhaId?: string
  /** Faz da tarefa uma SESSÃO de programa — os quatro campos viajam juntos. */
  sessao?: { programaId: string; item?: string; indice?: number; total?: number }
  recebimento?: { valor: bigint; aberto?: bigint; forma?: string; em?: string }
  historico?: { acao: string; porId: string; em: string }[]
}

const inserir = async (l: Linha): Promise<string> => {
  const pac =
    l.comPaciente === false
      ? null
      : l.terceiroPaciente === true
        ? terceiroPaciente
        : l.segundoPaciente === true
          ? outroPaciente
          : paciente
  const tipo = l.sessao !== undefined ? TIPO_SESSAO : (l.tipo ?? '')
  const id = (
    await migrate.query<{ id: string }>(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em,
          criada_em, paciente_id, tipo, historico, unidade_id, campanha_id,
          programa_id, item_chave, sessao_indice, sessao_total)
       VALUES ($1, $2, $3, 'fixture', $4::date, $5, $6, coalesce($7::timestamptz, now()),
               $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16)
       RETURNING id`,
      [
        clinica,
        l.sol ?? helena,
        l.resp ?? helena,
        l.prazo,
        l.status ?? 'aberta',
        l.concluidaEm ?? null,
        l.criadaEm ?? null,
        pac,
        tipo,
        JSON.stringify(l.historico ?? []),
        l.unidadeId ?? null,
        l.campanhaId ?? null,
        l.sessao?.programaId ?? null,
        l.sessao === undefined ? null : (l.sessao.item ?? 'i1'),
        l.sessao === undefined ? null : (l.sessao.indice ?? 1),
        l.sessao === undefined ? null : (l.sessao.total ?? 4),
      ],
    )
  ).rows[0]!.id
  if (l.recebimento !== undefined) {
    await migrate.query(
      `INSERT INTO recebimentos
         (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto,
          recebido_em, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        clinica,
        pac,
        id,
        tipo,
        l.recebimento.valor.toString(),
        l.recebimento.forma ?? (l.recebimento.valor > 0n ? 'Pix' : ''),
        (l.recebimento.aberto ?? 0n).toString(),
        l.recebimento.em ?? l.concluidaEm ?? em(10),
        helena,
      ],
    )
  }
  return id
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[painel] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinica = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica do Painel') RETURNING id`,
      [codigo],
    )
  ).rows[0]!.id
  const perfil = async (chave: string, perms: string[]) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, $2, $2, $3) RETURNING id`,
        [clinica, chave, perms],
      )
    ).rows[0]!.id
  // `painel` depende de `valores` na matriz — e as duas estão aqui porque é
  // com o principal MAIS FORTE que a regra 6 se prova.
  const pfGestao = await perfil('pf_sup', ['painel', 'valores', 'caixa'])
  const pfRecepcao = await perfil('pf_rec', ['jornada'])

  const hash = await hashDeSenha(SENHA)
  const pessoa = async (nome: string, usuario: string, funcao: string, perfilId: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, funcao, senha_hash, admin, perfil_id)
         VALUES ($1, $2, $3, $4, $5, false, $6) RETURNING id`,
        [clinica, nome, usuario, funcao, hash, perfilId],
      )
    ).rows[0]!.id
  helena = await pessoa('Helena Prado', 'helena', 'Supervisão', pfGestao)
  juliana = await pessoa('Juliana Santos', 'juliana', 'Recepcionista', pfRecepcao)

  const pac = async (nome: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, $2) RETURNING id`,
        [clinica, nome],
      )
    ).rows[0]!.id
  paciente = await pac('Marta Alves')
  outroPaciente = await pac('Rosa Lima')
  // A terceira existe para os blocos novos: ela é a paciente SEM unidade (o
  // balde "Sem unidade") e a segunda linha de "novos por origem".
  terceiroPaciente = await pac('Carla Dias')

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(relogioDeTeste)
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const entrar = (u: string) =>
    srv().post('/v1/entrar').send({ clinica: codigo, usuario: u, senha: SENHA }).expect(200)
  gestao = cookieDe(await entrar('helena'))
  semPainel = cookieDe(await entrar('juliana'))
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await app.close()
})

beforeEach(async () => {
  agora = new Date(INICIO)
  await migrate.query(`DELETE FROM caixa_por_forma WHERE caixa_id IN
    (SELECT id FROM caixas_do_dia WHERE clinica_id = $1)`, [clinica])
  await migrate.query(`DELETE FROM caixas_do_dia WHERE clinica_id = $1`, [clinica])
  await migrate.query(`DELETE FROM recebimentos WHERE clinica_id = $1`, [clinica])
  await migrate.query(`DELETE FROM tarefas WHERE clinica_id = $1`, [clinica])
  /*
    O QUE OS BLOCOS NOVOS ESCREVEM, limpo na ORDEM das referências: a tarefa
    aponta para programa, unidade e campanha, então ela sai primeiro (acima).
    A paciente volta ao estado neutro — sem unidade, sem origem e cadastrada
    FORA de novembro —, para que cada teste declare o que precisa em vez de
    herdar o `now()` do `beforeAll`, que cai dentro do mês do cenário.
  */
  await migrate.query(`DELETE FROM programas WHERE clinica_id = $1`, [clinica])
  await migrate.query(`DELETE FROM campanhas WHERE clinica_id = $1`, [clinica])
  await migrate.query(
    `UPDATE pacientes SET unidade_id = NULL, origem = '', criado_em = '2026-09-01T12:00:00Z'
      WHERE clinica_id = $1`,
    [clinica],
  )
  await migrate.query(`DELETE FROM unidades WHERE clinica_id = $1`, [clinica])
})

// ---------------------------------------------------------------------------
// O PERÍODO
// ---------------------------------------------------------------------------

describe('o período é resolvido no SERVIDOR, no fuso da clínica', () => {
  /**
   * **A MUTAÇÃO:** deixar a tela mandar as datas, ou usar `new Date()` no
   * servidor. O protótipo usa `today()` do NAVEGADOR (regra 24): o computador
   * de balcão com a data errada abre "este mês" no mês que não é, e a gestora
   * compara dois números de períodos diferentes sem nada avisando.
   */
  it('as quatro chaves fixas viram as bordas certas, a partir de 18/11/2026', async () => {
    expect((await ver('periodo=7d')).periodo).toMatchObject({
      // SETE dias INCLUSIVOS: 12 a 18, e não 11 a 18.
      de: '2026-11-12',
      ate: '2026-11-18',
      rotulo: 'Últimos 7 dias',
    })
    expect((await ver('periodo=30d')).periodo).toMatchObject({
      de: '2026-10-20',
      ate: '2026-11-18',
    })
    expect((await ver('periodo=mes')).periodo).toMatchObject({
      de: '2026-11-01',
      ate: '2026-11-30',
      rotulo: 'Novembro',
    })
    expect((await ver('periodo=ant')).periodo).toMatchObject({
      de: '2026-10-01',
      ate: '2026-10-31',
      rotulo: 'Outubro',
    })
    expect((await ver('periodo=per&de=2026-11-05&ate=2026-11-07')).periodo).toMatchObject({
      de: '2026-11-05',
      ate: '2026-11-07',
    })
    // `hoje` vem do servidor, e é ele que separa atrasada de a vencer.
    expect((await ver()).hoje).toBe('2026-11-18')
  })

  it('o período personalizado sem datas, ou invertido, é 400', async () => {
    expect((await srv().get('/v1/painel?periodo=per').set('Cookie', gestao)).status).toBe(400)
    expect(
      (
        await srv()
          .get('/v1/painel?periodo=per&de=2026-11-10&ate=2026-11-01')
          .set('Cookie', gestao)
      ).status,
    ).toBe(400)
  })

  it('é 403 sem `painel`', async () => {
    expect((await srv().get('/v1/painel?periodo=mes').set('Cookie', semPainel)).status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// CUMPRIMENTO DE PRAZOS
// ---------------------------------------------------------------------------

describe('cumprimento de prazos — o denominador NÃO é o total', () => {
  /**
   * A conta à mão, com a fixture abaixo:
   *
   *   no prazo    2   (concluídas até o prazo)
   *   com atraso  1
   *   atrasadas   1   (abertas, prazo já venceu)
   *   a vencer    2   (abertas, prazo é hoje ou depois)
   *   total       6
   *
   * `taxaNoPrazo = round(2 / (2+1+1) × 100) = 50`.
   *
   * **A MUTAÇÃO:** dividir pelo TOTAL → `round(2/6×100) = 33`. A taxa de quem
   * planejou o mês inteiro despencaria sem que nada tivesse piorado.
   *
   * **A SEGUNDA:** largar `status <> 'cancelada'` → a cancelada entra no total
   * e `total` vira 7. Cancelar não é atrasar.
   *
   * **A TERCEIRA:** largar `tipo <> 'Sessão de plano'` → a sessão entra, e
   * doze aplicações de uma paciente viram doze tarefas no denominador da
   * enfermeira.
   */
  it('conta as quatro situações, e a taxa ignora o que ainda não venceu', async () => {
    await inserir({ tipo: 'Follow-up', status: 'concluida', prazo: '2026-11-10', concluidaEm: em(9) })
    await inserir({ tipo: 'Follow-up', status: 'concluida', prazo: '2026-11-11', concluidaEm: em(11) })
    await inserir({ tipo: 'Follow-up', status: 'concluida', prazo: '2026-11-12', concluidaEm: em(13) })
    await inserir({ tipo: 'Follow-up', prazo: '2026-11-14' })
    // A tarefa de HOJE ainda não venceu: `a vencer`, não `atrasada`.
    await inserir({ tipo: 'Follow-up', prazo: '2026-11-18' })
    await inserir({ tipo: 'Follow-up', prazo: '2026-11-25' })
    // RUÍDO — CANCELADA: cancelar não é atrasar.
    await inserir({ tipo: 'Follow-up', status: 'cancelada', prazo: '2026-11-13' })
    /*
      A SESSÃO DE PROGRAMA não entra na fixture, e a razão é o banco: o
      `CHECK sessao_e_do_programa` recusa uma linha de tipo `Sessão de plano`
      sem `programa_id`, `item_chave`, `sessao_indice` e `sessao_total` — não
      existe sessão solta, e montar um programa inteiro aqui seria uma
      fixture de outro módulo. A exclusão dela dos prazos está no
      `tipo <> ALL($6)` do serviço, com a razão escrita lá; o que este teste
      prova é tudo o que ele pode provar sem inventar dado impossível.
    */
    // RUÍDO — OUTRO MÊS.
    await inserir({ tipo: 'Follow-up', prazo: '2026-10-20' })

    const p = await ver()
    expect(p.prazos).toEqual({
      total: 6,
      noPrazo: 2,
      comAtraso: 1,
      atrasadas: 1,
      aVencer: 2,
      taxaNoPrazo: 50,
    })
  })

  /**
   * **A MUTAÇÃO:** `AT TIME ZONE 'UTC'` no lugar do fuso da clínica. Uma
   * conclusão às 21h de Salvador no dia do prazo é meia-noite do dia seguinte
   * em UTC: a tarefa entregue no prazo viraria atraso.
   */
  it('o "no prazo" é medido no fuso da CLÍNICA', async () => {
    // 11/11 às 00:00 UTC = 10/11 às 21:00 na Bahia. No prazo.
    await inserir({
      tipo: 'Follow-up',
      status: 'concluida',
      prazo: '2026-11-10',
      concluidaEm: '2026-11-11T00:00:00.000Z',
    })
    const p = await ver()
    expect(p.prazos.noPrazo).toBe(1)
    expect(p.prazos.comAtraso).toBe(0)
  })

  /**
   * **O TOTAL É A SOMA DAS LINHAS**, por construção: `GROUPING SETS` tira os
   * dois do mesmo `WHERE`. Duas consultas seriam duas chances de os filtros
   * divergirem — e a divergência apareceria como um total que não bate com a
   * soma, o pior defeito possível numa tela de indicadores.
   */
  it('por responsável: as linhas somam o total, e cada uma tem a própria taxa', async () => {
    await inserir({ resp: helena, tipo: 'Follow-up', status: 'concluida', prazo: '2026-11-10', concluidaEm: em(9) })
    await inserir({ resp: helena, tipo: 'Follow-up', prazo: '2026-11-14' })
    await inserir({ resp: juliana, tipo: 'Follow-up', status: 'concluida', prazo: '2026-11-10', concluidaEm: em(9) })
    await inserir({ resp: juliana, tipo: 'Follow-up', status: 'concluida', prazo: '2026-11-11', concluidaEm: em(9) })

    const p = await ver()
    expect(p.prazos.total).toBe(4)
    const somaDasLinhas = p.porResponsavel.reduce((s, l) => s + l.total, 0)
    expect(somaDasLinhas).toBe(p.prazos.total)

    const dela = p.porResponsavel.find((l) => l.pessoaId === juliana)!
    expect(dela.nome).toBe('Juliana Santos')
    expect(dela.funcao).toBe('Recepcionista')
    expect(dela.taxaNoPrazo).toBe(100)
    expect(p.porResponsavel.find((l) => l.pessoaId === helena)!.taxaNoPrazo).toBe(50)
  })

  /**
   * **`null`, NUNCA `0%`.** `0%` acusa quem deixou tudo atrasar; `—` diz que
   * nada venceu ainda. Quem troca os dois cria a primeira conversa 1:1 que
   * começa com uma acusação falsa.
   */
  it('sem nada vencido, a taxa é `null` e não zero', async () => {
    await inserir({ tipo: 'Follow-up', prazo: '2026-11-25' })
    const p = await ver()
    expect(p.prazos.total).toBe(1)
    expect(p.prazos.aVencer).toBe(1)
    expect(p.prazos.taxaNoPrazo).toBeNull()
  })

  /**
   * **"QUEM SOLICITOU" USA A DATA DE CRIAÇÃO**, e é o terceiro recorte.
   *
   * A fixture tem uma tarefa criada em outubro com prazo em novembro: ela
   * conta nos PRAZOS de novembro e **não** conta em "quem solicitou" de
   * novembro. Trocar o recorte por `prazo` faria as duas tabelas dizerem a
   * mesma coisa com nomes diferentes.
   */
  it('quem solicitou conta pela CRIAÇÃO, e `paraAEquipe` é derivado', async () => {
    await inserir({
      sol: helena,
      resp: juliana,
      tipo: 'Follow-up',
      prazo: '2026-11-20',
      criadaEm: em(5),
    })
    await inserir({ sol: helena, resp: helena, tipo: 'Follow-up', prazo: '2026-11-20', criadaEm: em(5) })
    // CRIADA EM OUTUBRO, com prazo em NOVEMBRO: entra nos prazos, não aqui.
    await inserir({
      sol: juliana,
      resp: juliana,
      tipo: 'Follow-up',
      prazo: '2026-11-20',
      criadaEm: '2026-10-20T15:00:00.000Z',
    })

    const p = await ver()
    expect(p.criadasNoPeriodo).toBe(2)
    expect(p.prazos.total).toBe(3)
    const dela = p.porSolicitante.find((l) => l.pessoaId === helena)!
    expect(dela).toMatchObject({ solicitadas: 2, paraSiMesma: 1, paraAEquipe: 1 })
    expect(p.porSolicitante.find((l) => l.pessoaId === juliana)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// PACIENTES NO PERÍODO
// ---------------------------------------------------------------------------

describe('pacientes no período — pela data de CONCLUSÃO', () => {
  /**
   * **A MUTAÇÃO 1:** somar `valor_aberto` junto — a venda a prazo viraria
   * receita, e o painel deixaria de bater com o caixa.
   *
   * **A MUTAÇÃO 2:** `pacientesAtendidos` com `count(*)` em vez de
   * `count(DISTINCT paciente_id)` — a paciente com consulta e procedimento
   * no mesmo mês viraria duas.
   *
   * **A MUTAÇÃO 3:** ticket médio em ponto flutuante. R$ 2.800 em 3
   * pagamentos é 93.333,33… centavos → `93333` (meio para baixo), pelo
   * `Dinheiro.media`.
   */
  it('soma só o que ENTROU, conta paciente distinto, e o ticket é exato', async () => {
    await inserir({
      tipo: 'Pagamento de orçamento',
      status: 'concluida',
      prazo: '2026-11-05',
      concluidaEm: em(5),
      recebimento: { valor: 180000n, forma: 'Pix' },
    })
    await inserir({
      tipo: 'Consulta realizada',
      status: 'concluida',
      prazo: '2026-11-06',
      concluidaEm: em(6),
      recebimento: { valor: 100000n, forma: 'Dinheiro' },
    })
    // VENDA A PRAZO: conta como pagamento registrado? Não — `ehReceita` do
    // atendimento pagável exige dinheiro, e o tipo não é do grupo Pagamentos.
    await inserir({
      tipo: 'Consulta realizada',
      status: 'concluida',
      prazo: '2026-11-07',
      concluidaEm: em(7),
      recebimento: { valor: 0n, aberto: 300000n, forma: '' },
    })
    // Terceiro PAGAMENTO, e ele é uma VENDA A PRAZO: conta como pagamento
    // registrado (o tipo é do grupo Pagamentos) e soma ZERO na receita. É o
    // que faz o ticket médio cair numa divisão inexata — e é o caso real da
    // promissória assinada no balcão.
    await inserir({
      tipo: 'Pagamento de consulta',
      status: 'concluida',
      prazo: '2026-11-08',
      concluidaEm: em(8),
      recebimento: { valor: 0n, aberto: 150000n, forma: '' },
    })
    // A MESMA paciente, segundo atendimento no mês: UM paciente atendido.
    await inserir({ tipo: 'Procedimento realizado', status: 'concluida', prazo: '2026-11-09', concluidaEm: em(9) })
    // Contatos: dois, e nenhum deles é atendimento nem pagamento.
    await inserir({ tipo: 'Follow-up', status: 'concluida', prazo: '2026-11-09', concluidaEm: em(9) })
    await inserir({ tipo: 'Recaptação', status: 'concluida', prazo: '2026-11-09', concluidaEm: em(9) })
    // SEM PACIENTE: não entra em nada deste bloco.
    await inserir({ status: 'concluida', prazo: '2026-11-09', concluidaEm: em(9), comPaciente: false })

    const p = (await ver()).pacientes
    // R$ 1.800 + R$ 1.000 = R$ 2.800. A venda a prazo e o pagamento de R$ 0
    // não somam nada; o segundo CONTA como pagamento (é do grupo Pagamentos).
    expect(p.receita).toBe('280000')
    expect(p.pagamentos).toBe(3)
    // 280000 / 3 = 93.333,33… → 93333.
    expect(p.ticketMedio).toBe('93333')
    expect(p.pacientesAtendidos).toBe(1)
    expect(p.contatos).toBe(2)
    expect(p.orcamentosPagos).toBe(1)
    expect(p.valorDosOrcamentosPagos).toBe('180000')
  })

  it('sem pagamento nenhum, o ticket médio é `null` e não R$ 0,00', async () => {
    await inserir({ tipo: 'Follow-up', status: 'concluida', prazo: '2026-11-09', concluidaEm: em(9) })
    const p = (await ver()).pacientes
    expect(p.pagamentos).toBe(0)
    expect(p.ticketMedio).toBeNull()
    expect(p.receita).toBe('0')
  })

  /**
   * A CONVERSÃO É POR **`acao` DECLARADA** (ADR 0004), nunca por rótulo nem
   * por cruzamento de paciente e data.
   *
   * O protótipo soma dois conjuntos diferentes aqui e conta de novo o que já
   * contou — daí o `Math.min(100, …)` que ele precisa pôr em volta.
   */
  it('conversão de orçamentos: fechados sobre enviados, por `acao`', async () => {
    await inserir({
      tipo: 'Consulta realizada',
      status: 'concluida',
      prazo: '2026-11-05',
      concluidaEm: em(5),
      historico: [
        { acao: 'registrarOrcamento', porId: helena, em: em(5) },
        { acao: 'fechar', porId: helena, em: em(6) },
      ],
    })
    await inserir({
      segundoPaciente: true,
      tipo: 'Consulta realizada',
      status: 'concluida',
      prazo: '2026-11-07',
      concluidaEm: em(7),
      historico: [
        { acao: 'registrarOrcamento', porId: helena, em: em(7) },
        // `perder` não é fechar, e `reagendar` não é orçamento.
        { acao: 'perder', porId: helena, em: em(8) },
        { acao: 'reagendar', porId: helena, em: em(8) },
      ],
    })
    const p = (await ver()).pacientes
    expect(p.orcamentosEnviados).toBe(2)
    expect(p.conversaoDeOrcamentos).toBe(50)
  })

  it('sem orçamento enviado, a conversão é `null` — dividir por zero não diz nada', async () => {
    expect((await ver()).pacientes.conversaoDeOrcamentos).toBeNull()
  })

  /**
   * **POR TIPO: dois recortes na mesma linha**, e o `FULL OUTER JOIN` existe
   * para que nenhum dos dois casos de ponta suma — o tipo com prazo e sem
   * conclusão (a atrasada), e o tipo com conclusão e sem prazo no período (a
   * de setembro entregue em outubro). Com `JOIN`, somem os dois, e são
   * justamente os dois que a gestora procura.
   */
  it('por tipo: com prazo no período E concluídas no período, lado a lado', async () => {
    // Follow-up: prazo no período, NÃO concluída.
    await inserir({ tipo: 'Follow-up', prazo: '2026-11-20' })
    // Recaptação: concluída no período, prazo em OUTUBRO.
    await inserir({ tipo: 'Recaptação', status: 'concluida', prazo: '2026-10-20', concluidaEm: em(9) })

    const porTipo = new Map((await ver()).pacientes.porTipo.map((x) => [x.tipo, x]))
    expect(porTipo.get('Follow-up')).toMatchObject({
      comPrazoNoPeriodo: 1,
      concluidasNoPeriodo: 0,
    })
    expect(porTipo.get('Recaptação')).toMatchObject({
      comPrazoNoPeriodo: 0,
      concluidasNoPeriodo: 1,
    })
  })
})

// ---------------------------------------------------------------------------
// A REGRA 6 DENTRO DO PAINEL
// ---------------------------------------------------------------------------

describe('o recebido POR FORMA só alcança dias com caixa já fechado (regra 6)', () => {
  /**
   * **ESTA É A DEFESA QUE O PROTÓTIPO NÃO TEM.** Ele agrupa `rec` por
   * `formaPagamento` no navegador, sem olhar caixa nenhum — e a recepcionista
   * que vai conferir a gaveta pode abrir o Painel e ler o esperado por forma
   * do próprio dia.
   *
   * A fixture: R$ 900 em cartão no dia 10 (caixa FECHADO) e R$ 570 em Pix e
   * dinheiro no dia 18 (HOJE, caixa ABERTO). A tabela por forma mostra só o
   * dia 10; `receita` continua inteira, e os dois números declarados dizem
   * onde a tabela para.
   *
   * **A MUTAÇÃO:** largar o `EXISTS` em `caixas_do_dia` → `porForma` passa a
   * ter Pix e Dinheiro, com `45000` e `12000`, que é o esperado da gaveta de
   * hoje por forma.
   */
  it('o dia de HOJE não aparece na tabela por forma, e o recorte é declarado', async () => {
    await inserir({
      tipo: 'Pagamento de consulta',
      status: 'concluida',
      prazo: '2026-11-10',
      concluidaEm: em(10),
      recebimento: { valor: 90000n, forma: 'Cartão de crédito', em: em(10) },
    })
    await fecharOCaixa('2026-11-10')
    await inserir({
      tipo: 'Pagamento de consulta',
      status: 'concluida',
      prazo: '2026-11-18',
      concluidaEm: em(18),
      recebimento: { valor: 45000n, forma: 'Pix', em: em(18) },
    })
    await inserir({
      segundoPaciente: true,
      tipo: 'Pagamento de consulta',
      status: 'concluida',
      prazo: '2026-11-18',
      concluidaEm: em(18),
      recebimento: { valor: 12000n, forma: 'Dinheiro', em: em(18) },
    })

    const p = (await ver()).pacientes
    // A receita do período continua inteira: R$ 900 + R$ 450 + R$ 120.
    expect(p.receita).toBe('147000')
    // A tabela por forma, não.
    expect(p.porForma).toHaveLength(1)
    expect(p.porForma[0]).toMatchObject({
      forma: 'Cartão de crédito',
      valor: '90000',
      pagamentos: 1,
      // O denominador é a soma DA TABELA: com a receita inteira embaixo, a
      // diferença até 100% seria o total dos dias não conferidos.
      percentual: 100,
    })
    expect(p.porFormaAteODia).toBe('2026-11-10')
    expect(p.porFormaDiasSemCaixa).toBe(1)

    // E o NÚMERO do dia aberto não aparece em lugar nenhum do corpo — é a
    // asserção que pega o campo renomeado.
    const corpo = JSON.stringify(await ver())
    for (const proibido of ['45000', '12000', '57000']) {
      expect(corpo, `o esperado de hoje (${proibido}) atravessou`).not.toContain(proibido)
    }
  })

  it('sem caixa fechado nenhum, a tabela é vazia e `porFormaAteODia` é `null`', async () => {
    await inserir({
      tipo: 'Pagamento de consulta',
      status: 'concluida',
      prazo: '2026-11-18',
      concluidaEm: em(18),
      recebimento: { valor: 45000n, forma: 'Pix', em: em(18) },
    })
    const p = (await ver()).pacientes
    expect(p.porForma).toEqual([])
    expect(p.porFormaAteODia).toBeNull()
    expect(p.porFormaDiasSemCaixa).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// OS QUATRO BLOCOS QUE FECHAM O MANUAL CAP. 10
// ---------------------------------------------------------------------------

/** Cadastra duas unidades e põe cada paciente na sua. Carla fica sem. */
const montarUnidades = async (): Promise<{ pituba: string; itaigara: string }> => {
  const criar = async (nome: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO unidades (clinica_id, nome) VALUES ($1, $2) RETURNING id`,
        [clinica, nome],
      )
    ).rows[0]!.id
  const pituba = await criar('Pituba')
  const itaigara = await criar('Itaigara')
  await migrate.query(`UPDATE pacientes SET unidade_id = $2 WHERE id = $1`, [paciente, pituba])
  await migrate.query(`UPDATE pacientes SET unidade_id = $2 WHERE id = $1`, [
    outroPaciente,
    itaigara,
  ])
  return { pituba, itaigara }
}

const criarPrograma = async (
  pacienteId: string,
  criadoEm: string,
  situacao: 'ativo' | 'encerrado' = 'ativo',
): Promise<string> =>
  (
    await migrate.query<{ id: string }>(
      `INSERT INTO programas (clinica_id, paciente_id, inicio, situacao, encerrado_em, criado_em)
       VALUES ($1, $2, '2026-11-01'::date, $3, $4, $5) RETURNING id`,
      [clinica, pacienteId, situacao, situacao === 'encerrado' ? criadoEm : null, criadoEm],
    )
  ).rows[0]!.id

const criarCampanha = async (
  nome: string,
  inicio: string,
  fim: string,
): Promise<string> =>
  (
    await migrate.query<{ id: string }>(
      `INSERT INTO campanhas (clinica_id, categoria, nome, inicio, fim, metrica, meta, criada_por)
       VALUES ($1, 'Sazonal', $2, $3::date, $4::date, 'contatos', 10, $5) RETURNING id`,
      [clinica, nome, inicio, fim, helena],
    )
  ).rows[0]!.id

const pagamento = (valor: bigint, dia: number, forma = 'Pix') => ({
  tipo: 'Pagamento de consulta',
  status: 'concluida' as const,
  prazo: `2026-11-${String(dia).padStart(2, '0')}`,
  concluidaEm: em(dia),
  recebimento: { valor, forma, em: em(dia) },
})

describe('Top 10 pagantes', () => {
  /**
   * **ELE PASSA PELO MESMO CORTE DO "RECEBIDO POR FORMA"** (regra 6).
   *
   * Um ranking por paciente numa janela de um dia é a soma daquele dia por
   * outro agrupamento — e a janela é escolhida por quem olha. O protótipo soma
   * sem olhar caixa nenhum (`top10Html`).
   *
   * A fixture: no dia 10 (caixa FECHADO) Marta paga R$ 300 + R$ 200 e Rosa
   * paga R$ 700; no dia 18 (HOJE, caixa ABERTO) Marta paga R$ 900.
   *
   * **A MUTAÇÃO:** largar o `EXISTS` em `caixas_do_dia` → Marta sobe para
   * R$ 1.400 e passa a ser a primeira do ranking. O número `140000` é a soma
   * que o servidor teria feito para quem vai contar a gaveta.
   */
  it('soma só os dias com caixa fechado, e declara até onde alcança', async () => {
    await fecharOCaixa('2026-11-10')
    await inserir(pagamento(30000n, 10))
    await inserir(pagamento(20000n, 10))
    await inserir({ ...pagamento(70000n, 10), segundoPaciente: true })
    await inserir(pagamento(90000n, 18))

    const top = (await ver()).topPagantes
    expect(top.modo).toBe('periodo')
    expect(top.itens).toEqual([
      {
        pacienteId: outroPaciente,
        nome: 'Rosa Lima',
        unidade: '',
        pagamentos: 1,
        valor: '70000',
      },
      {
        pacienteId: paciente,
        nome: 'Marta Alves',
        unidade: '',
        pagamentos: 2,
        valor: '50000',
      },
    ])
    expect(top.recorte).toEqual({ ateODia: '2026-11-10', diasSemCaixa: 1 })

    // E o número do dia aberto não entra no bloco sob nome nenhum — é esta
    // asserção que pega o campo renomeado, não a de chave.
    const corpo = JSON.stringify(top)
    for (const proibido of ['90000', '140000']) {
      expect(corpo, `o dinheiro do dia aberto (${proibido}) entrou no ranking`).not.toContain(
        proibido,
      )
    }
  })

  /**
   * *"No período do Painel ou desde o início"* (MANUAL cap. 10).
   *
   * **A MUTAÇÃO:** aplicar a janela do período também no modo `tudo` → o
   * pagamento de outubro desaparece e os dois modos devolvem o mesmo número,
   * o que torna o botão "Desde o início" um enfeite.
   */
  it('o modo `tudo` alcança o que está FORA do período', async () => {
    await fecharOCaixa('2026-10-05')
    await fecharOCaixa('2026-11-10')
    await inserir({
      tipo: 'Pagamento de consulta',
      status: 'concluida',
      prazo: '2026-10-05',
      concluidaEm: '2026-10-05T15:00:00.000Z',
      recebimento: { valor: 500000n, forma: 'Pix', em: '2026-10-05T15:00:00.000Z' },
    })
    await inserir(pagamento(50000n, 10))

    expect((await ver('periodo=mes')).topPagantes.itens[0]).toMatchObject({ valor: '50000' })
    const tudo = (await ver('periodo=mes&top=tudo')).topPagantes
    expect(tudo.modo).toBe('tudo')
    expect(tudo.itens[0]).toMatchObject({ nome: 'Marta Alves', valor: '550000', pagamentos: 2 })
  })

  it('a unidade da linha é a PRINCIPAL da paciente, e o vazio é lista vazia', async () => {
    const p = await ver()
    expect(p.topPagantes.itens).toEqual([])
    expect(p.topPagantes.recorte).toEqual({ ateODia: null, diasSemCaixa: 0 })

    await montarUnidades()
    await fecharOCaixa('2026-11-10')
    await inserir(pagamento(10000n, 10))
    expect((await ver()).topPagantes.itens[0]).toMatchObject({ unidade: 'Pituba' })
  })
})

describe('desempenho por unidade', () => {
  /**
   * **A UNIDADE DE UM ATENDIMENTO É A DA TAREFA E, SEM ELA, A DA PACIENTE.**
   *
   * É o `unidadeDaTarefa` dela. **A MUTAÇÃO:** usar só `t.unidade_id` → os
   * R$ 500 da tarefa sem unidade caem em "Sem unidade", e a clínica que nunca
   * troca o campo no atendimento (o caso normal, porque ele já vem preenchido
   * pela paciente) vê todo o faturamento fora das duas unidades.
   *
   * **A SEGUNDA:** largar o `EXISTS` em `caixas_do_dia` do faturamento → os
   * R$ 700 de hoje entram em Itaigara.
   *
   * **A TERCEIRA:** aplicar o corte de caixa também no `ltvMedio` → o LTV
   * médio de Itaigara vira `null`, e o número que a tela existe para comparar
   * desaparece por causa de uma regra que não fala dele.
   */
  it('faturamento com o corte; LTV médio sem ele; e a tarefa manda na unidade', async () => {
    const { pituba, itaigara } = await montarUnidades()
    await fecharOCaixa('2026-11-10')
    // Marta é da Pituba, e a tarefa não diz unidade: cai na dela.
    await inserir(pagamento(50000n, 10))
    // Marta de novo, mas o atendimento foi em Itaigara: a TAREFA manda.
    await inserir({ ...pagamento(40000n, 10), unidadeId: itaigara })
    // Rosa paga hoje, com o caixa ABERTO: não entra em faturamento nenhum.
    await inserir({ ...pagamento(70000n, 18), segundoPaciente: true })

    const linhas = new Map((await ver()).porUnidade.map((l) => [l.nome, l]))
    expect([...linhas.keys()]).toEqual(['Itaigara', 'Pituba', 'Sem unidade'])

    expect(linhas.get('Pituba')).toMatchObject({
      unidadeId: pituba,
      pacientes: 1,
      pagamentos: 1,
      faturamento: '50000',
      // O LTV de Marta é o que ela pagou na VIDA: R$ 500 + R$ 400.
      ltvMedio: '90000',
    })
    expect(linhas.get('Itaigara')).toMatchObject({
      unidadeId: itaigara,
      pacientes: 1,
      pagamentos: 1,
      faturamento: '40000',
      // Rosa pagou hoje, com o caixa aberto: fora do faturamento, DENTRO do
      // LTV. São duas perguntas diferentes, e só uma é o esperado da gaveta.
      ltvMedio: '70000',
    })
    expect(linhas.get('Sem unidade')).toMatchObject({
      unidadeId: null,
      pacientes: 1,
      faturamento: '0',
      // Ninguém da "Sem unidade" pagou nada: média não existe, e `R$ 0,00`
      // diria que o LTV médio é zero.
      ltvMedio: null,
    })
  })

  /**
   * **"ATIVO" É PROGRAMA NÃO ENCERRADO QUE AINDA TEM SESSÃO ABERTA** — a mesma
   * definição de `catalogo.service.ts` e o `statsAdesao` dela.
   *
   * **A MUTAÇÃO:** contar `situacao = 'ativo'` sem o `EXISTS` da sessão aberta
   * → o programa de Rosa, com todas as sessões realizadas, continua "ativo"
   * para sempre e o número nunca desce.
   *
   * **A SEGUNDA:** contar `programasNovos` sem a janela → o programa de
   * outubro entra em novembro.
   */
  it('programas: novos na janela, ativos com sessão aberta', async () => {
    await montarUnidades()
    const daMarta = await criarPrograma(paciente, '2026-11-03T12:00:00Z')
    const daRosa = await criarPrograma(outroPaciente, '2026-10-02T12:00:00Z')
    await inserir({ prazo: '2026-11-25', sessao: { programaId: daMarta } })
    await inserir({
      segundoPaciente: true,
      prazo: '2026-11-12',
      status: 'concluida',
      concluidaEm: em(12),
      sessao: { programaId: daRosa },
    })

    const linhas = new Map((await ver()).porUnidade.map((l) => [l.nome, l]))
    expect(linhas.get('Pituba')).toMatchObject({ programasNovos: 1, programasAtivos: 1 })
    expect(linhas.get('Itaigara')).toMatchObject({ programasNovos: 0, programasAtivos: 0 })
  })

  /**
   * **FALTA É "NÃO ACONTECEU NA DATA"**, e só conta o que JÁ venceu.
   *
   * **A MUTAÇÃO:** largar `t.prazo < hoje` → a sessão de 25/11, que ainda não
   * chegou, entra como prevista e a taxa de falta da Pituba cai de 100% para
   * 50% — a unidade com problema parece melhor por ter agenda cheia.
   *
   * **A SEGUNDA:** contar só `status = 'aberta'` como falta → a sessão
   * realizada DEPOIS da data sai da conta, e o atraso crônico desaparece.
   *
   * **A TERCEIRA:** largar `t.tipo <> ALL(sessões)` nas tarefas atrasadas → a
   * sessão aberta de 05/11 passa a contar duas vezes, como falta e como tarefa
   * atrasada.
   */
  it('sessões vencidas, faltas e tarefas atrasadas', async () => {
    await montarUnidades()
    const daMarta = await criarPrograma(paciente, '2026-11-03T12:00:00Z')
    const daRosa = await criarPrograma(outroPaciente, '2026-11-03T12:00:00Z')
    // Pituba: uma sessão vencida e aberta (falta), uma que ainda não chegou.
    await inserir({ prazo: '2026-11-05', sessao: { programaId: daMarta, indice: 1 } })
    await inserir({ prazo: '2026-11-25', sessao: { programaId: daMarta, indice: 2 } })
    // Itaigara: uma vencida e realizada DEPOIS da data — falta também.
    await inserir({
      segundoPaciente: true,
      prazo: '2026-11-06',
      status: 'concluida',
      concluidaEm: em(9),
      sessao: { programaId: daRosa, indice: 1 },
    })
    // Itaigara: uma vencida e realizada no prazo.
    await inserir({
      segundoPaciente: true,
      prazo: '2026-11-12',
      status: 'concluida',
      concluidaEm: em(12),
      sessao: { programaId: daRosa, indice: 2 },
    })
    // E uma tarefa de paciente atrasada, que NÃO é sessão.
    await inserir({ segundoPaciente: true, tipo: 'Follow-up', prazo: '2026-11-14' })

    const linhas = new Map((await ver()).porUnidade.map((l) => [l.nome, l]))
    expect(linhas.get('Pituba')).toMatchObject({
      sessoesPrevistas: 1,
      sessoesComFalta: 1,
      taxaDeFalta: 100,
      tarefasAtrasadas: 0,
    })
    expect(linhas.get('Itaigara')).toMatchObject({
      sessoesPrevistas: 2,
      sessoesComFalta: 1,
      taxaDeFalta: 50,
      tarefasAtrasadas: 1,
    })
  })

  /**
   * **A CLÍNICA DE UM ENDEREÇO SÓ NÃO VÊ A TABELA** — é o `temUnidades()` dela.
   *
   * **A MUTAÇÃO:** devolver a tabela sempre → a clínica que nunca cadastrou
   * unidade abre o painel e encontra um bloco "Desempenho por unidade" com uma
   * linha chamada "Sem unidade", que não compara nada com nada.
   */
  it('sem unidade cadastrada, o bloco não existe', async () => {
    await fecharOCaixa('2026-11-10')
    await inserir(pagamento(50000n, 10))
    expect((await ver()).porUnidade).toEqual([])
  })
})

describe('novos pacientes por origem', () => {
  /**
   * **O QUARTO RECORTE DO PAINEL: a data de CADASTRO.**
   *
   * Não é o prazo (prazos), não é a conclusão (pacientes), não é a criação da
   * tarefa (quem solicitou). *"Pela data de cadastro na ferramenta"*.
   *
   * **A MUTAÇÃO:** largar a janela de `criado_em` → Rosa, cadastrada em
   * outubro, entra como nova de novembro e o total vira 3. É o número que a
   * gestora usa para saber se a campanha trouxe gente.
   *
   * **A SEGUNDA:** contar `jaAtendidos` por qualquer tarefa concluída, e não
   * só pelas de ATENDIMENTO → o contato de follow-up de Carla a faz parecer
   * atendida, e a conversão da origem sobe sem ninguém ter entrado na clínica.
   */
  it('conta pela data de cadastro, e a origem vazia vira “Não informada”', async () => {
    await migrate.query(
      `UPDATE pacientes SET origem = 'Instagram', criado_em = '2026-11-05T12:00:00Z'
        WHERE id = $1`,
      [paciente],
    )
    await migrate.query(
      `UPDATE pacientes SET origem = '', criado_em = '2026-11-07T12:00:00Z' WHERE id = $1`,
      [terceiroPaciente],
    )
    await migrate.query(
      `UPDATE pacientes SET origem = 'Indicação', criado_em = '2026-10-20T12:00:00Z'
        WHERE id = $1`,
      [outroPaciente],
    )

    // Marta foi atendida e pagou; Carla só tem um contato concluído.
    await fecharOCaixa('2026-11-10')
    await inserir({
      tipo: 'Consulta realizada',
      status: 'concluida',
      prazo: '2026-11-10',
      concluidaEm: em(10),
    })
    await inserir(pagamento(50000n, 10))
    await inserir({
      terceiroPaciente: true,
      tipo: 'Follow-up',
      status: 'concluida',
      prazo: '2026-11-09',
      concluidaEm: em(9),
    })

    const n = (await ver()).novosPacientes
    expect(n.total).toBe(2)
    expect(n.porOrigem).toEqual([
      // O LTV é a vida da paciente, não a janela — e por isso NÃO passa pelo
      // corte de caixa: ele não é o esperado de dia nenhum.
      { origem: 'Instagram', novos: 1, jaAtendidos: 1, ltvTotal: '50000' },
      { origem: 'Não informada', novos: 1, jaAtendidos: 0, ltvTotal: '0' },
    ])
  })

  it('o total é a soma das linhas, e o vazio é um vazio de verdade', async () => {
    const n = (await ver()).novosPacientes
    expect(n.porOrigem).toEqual([])
    expect(n.total).toBe(0)
  })
})

describe('campanhas no período', () => {
  /**
   * **CRUZAR O PERÍODO É TOCÁ-LO**, não estar inteira dentro dele.
   *
   * **A MUTAÇÃO:** `inicio >= de` → "Outubro Rosa", que começou em 25/10 e
   * ainda corria em novembro, desaparece do painel de novembro. É justamente a
   * campanha que estava dando resultado.
   *
   * **A SEGUNDA:** recontar o resultado da campanha aqui, em vez de pedir ao
   * `CampanhasService` → o painel e a tela de Campanhas passam a ter duas
   * respostas para a mesma pergunta, e divergem no primeiro ajuste. O teste
   * cobra o `resultadoEmNumero` e o `percentualDaMeta` **prontos**, que é o
   * que só existe se a regra tiver vindo de lá.
   */
  it('traz as que cruzam o período, com o resultado já contado', async () => {
    const outubroRosa = await criarCampanha('Outubro Rosa', '2026-10-25', '2026-11-05')
    await criarCampanha('Natal', '2026-12-01', '2026-12-20')
    await inserir({
      tipo: 'Follow-up',
      status: 'concluida',
      prazo: '2026-11-03',
      concluidaEm: em(3),
      campanhaId: outubroRosa,
    })

    const campanhas = (await ver()).campanhas
    expect(campanhas.map((x) => x.nome)).toEqual(['Outubro Rosa'])
    expect(campanhas[0]).toMatchObject({
      id: outubroRosa,
      metrica: 'contatos',
      metaEmNumero: 10,
      metaEmDinheiro: null,
      resultadoEmNumero: 1,
      percentualDaMeta: 10,
      tarefas: 1,
      tarefasConcluidas: 1,
      contatos: 1,
    })
  })

  it('sem campanha nenhuma, o bloco é uma lista vazia', async () => {
    expect((await ver()).campanhas).toEqual([])
  })
})

/** Fecha o caixa de um dia, direto no banco — a fixture não testa o ritual. */
async function fecharOCaixa(dia: string): Promise<void> {
  await migrate.query(
    `INSERT INTO caixas_do_dia (clinica_id, dia, fechado_por) VALUES ($1, $2::date, $3)`,
    [clinica, dia, helena],
  )
}
