import type { Painel } from '@fir/contracts'
import type { Relogio } from '@fir/domain'
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
  recebimento?: { valor: bigint; aberto?: bigint; forma?: string; em?: string }
  historico?: { acao: string; porId: string; em: string }[]
}

const inserir = async (l: Linha): Promise<string> => {
  const pac =
    l.comPaciente === false ? null : l.segundoPaciente === true ? outroPaciente : paciente
  const id = (
    await migrate.query<{ id: string }>(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em,
          criada_em, paciente_id, tipo, historico)
       VALUES ($1, $2, $3, 'fixture', $4::date, $5, $6, coalesce($7::timestamptz, now()),
               $8, $9, $10::jsonb)
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
        l.tipo ?? '',
        JSON.stringify(l.historico ?? []),
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
        l.tipo ?? '',
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

/** Fecha o caixa de um dia, direto no banco — a fixture não testa o ritual. */
async function fecharOCaixa(dia: string): Promise<void> {
  await migrate.query(
    `INSERT INTO caixas_do_dia (clinica_id, dia, fechado_por) VALUES ($1, $2::date, $3)`,
    [clinica, dia, helena],
  )
}
