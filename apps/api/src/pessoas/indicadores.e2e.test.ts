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
 * **OS 8 INDICADORES AUTOMÁTICOS — a definição de cada um, fixada.**
 *
 * Eles não são CRUD: são **contagens derivadas**, e é aqui que um número
 * divergente vai aparecer na migração das 4 clínicas. Uma soma errada por um
 * erra por um; uma RAZÃO errada por um no denominador erra o número inteiro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS OITO DEFINIÇÕES, MEDIDAS NO `realizadoMeta` DO PROTÓTIPO
 *
 *  1. `agendamentos`    eventos de `historico` com `acao = 'agendar'` feitos
 *                       por ela, com `em` no mês.
 *  2. `confirmacoes`    idem, com `acao = 'confirmar'`.
 *  3. `contatos`        tarefas concluídas por ela no mês, **com paciente**,
 *                       de tipo que não atende, não é receita e não é
 *                       recebimento.
 *  4. `orc_qtd`         tarefas concluídas por ela no mês de tipo *Pagamento
 *                       de orçamento*.
 *  5. `orc_valor`       a soma em CENTAVOS do que ENTROU nessas mesmas.
 *  6. `recebimentos`    concluídas por ela no mês, com paciente, do grupo
 *                       Pagamentos **ou** atendimento pagável com dinheiro
 *                       que entrou.
 *  7. `tarefas_prazo`   PERCENTUAL: das tarefas dela com prazo no mês e já
 *                       vencido, não canceladas e que não são pagamento,
 *                       quantas concluíram até o prazo.
 *  8. `contagens_prazo` PERCENTUAL: das contagens dela com prazo no mês e já
 *                       vencido, quantas fecharam até o prazo.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **A FIXTURE É UMA SÓ, E CADA NÚMERO ESPERADO É CALCULADO À MÃO ABAIXO.**
 * Uma fixture por indicador deixaria cada teste provar a consulta que ele
 * mesmo desenhou; uma fixture compartilhada obriga cada `FILTER` a conviver
 * com o ruído dos outros sete — que é exatamente a condição de produção.
 *
 * **Cada bloco nomeia a MUTAÇÃO que ele mata.** Mutação que sobrevive é teste
 * ruim, e as linhas de ruído da fixture existem uma a uma para matar uma.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'quatro-pedras-no-caminho-largo'
const codigo = `ind-${Date.now()}`

/**
 * **18/11/2026, 12:00 UTC** — 09:00 em `America/Bahia`, o fuso padrão.
 *
 * O dia 18 é escolhido, não arbitrário: os dois percentuais fecham o
 * denominador em `prazo <= hoje`, e com `hoje` no MEIO do mês a fixture
 * consegue ter tarefa vencida **e** tarefa a vencer no mesmo mês. Com `hoje`
 * no fim, as duas pontas colapsam e a condição `prazo <= hoje` deixa de ser
 * testada — ela passaria com `TRUE` no lugar.
 */
const INICIO = new Date('2026-11-18T12:00:00.000Z')
let agora = new Date(INICIO)
const relogioDeTeste: Relogio = { agora: () => agora }

const MES = '2026-11'

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let gestora: string
let ana: string
let bruna: string
let fichaDaAna: string
let fichaDaBruna: string
let fichaSemUsuario: string
let paciente: string
let rh: string[]

const srv = () => request(app.getHttpServer())
const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

type MetaNaResposta = {
  indicador: string
  metaEmNumero: number | null
  metaEmDinheiro: string | null
  realizadoEmNumero: number | null
  realizadoEmDinheiro: string | null
  percentual: number | null
}

/**
 * Cria a meta pela ROTA, não por `INSERT`: é o caminho que a clínica usa, e
 * um `INSERT` direto pularia o `CHECK` e o contrato que a borda cobra.
 */
const criarMeta = (fichaId: string, indicador: string, alvo: number | string, nome = '') =>
  srv()
    .post(`/v1/metas-de-pessoa/${MES}`)
    .set('Cookie', rh)
    .send(
      typeof alvo === 'string'
        ? { fichaId, indicador, nome, metaEmDinheiro: alvo }
        : { fichaId, indicador, nome, metaEmNumero: alvo },
    )

/** O realizado de um indicador, para uma ficha, lido pela rota do mês. */
const realizado = async (fichaId: string, indicador: string): Promise<MetaNaResposta> => {
  const r = await srv().get(`/v1/metas-de-pessoa/${MES}`).set('Cookie', rh).expect(200)
  const pessoas = r.body.pessoas as { fichaId: string; metas: MetaNaResposta[] }[]
  const dela = pessoas.find((p) => p.fichaId === fichaId)
  expect(dela, `ficha ${fichaId} não veio na resposta`).toBeDefined()
  const meta = dela!.metas.find((m) => m.indicador === indicador)
  expect(meta, `meta ${indicador} não veio na ficha`).toBeDefined()
  return meta!
}

// ---------------------------------------------------------------------------
// A FIXTURE
// ---------------------------------------------------------------------------

/**
 * Uma tarefa, com tudo que os oito indicadores perguntam.
 *
 * O `historico` é jsonb com `{ acao, porId, em }` — a forma que
 * `jornada.service.ts` grava. Escrevê-lo à mão aqui é deliberado: o que se
 * mede é a CONSULTA, e fazer a jornada inteira por HTTP para cada evento
 * esconderia a definição do indicador atrás de dez transições.
 */
type Linha = {
  resp: string
  tipo?: string
  status?: 'aberta' | 'concluida' | 'cancelada'
  prazo: string
  concluidaEm?: string | null
  comPaciente?: boolean
  historico?: { acao: string; porId: string; em: string }[]
  recebimento?: { valor: bigint; aberto?: bigint; forma?: string }
  excluida?: boolean
}

const inserirTarefa = async (l: Linha): Promise<string> => {
  const id = (
    await migrate.query<{ id: string }>(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status,
          concluida_em, paciente_id, tipo, historico, excluida_em)
       VALUES ($1, $2, $3, 'fixture', $4::date, $5, $6, $7, $8, $9::jsonb, $10)
       RETURNING id`,
      [
        clinica,
        gestora,
        l.resp,
        l.prazo,
        l.status ?? 'aberta',
        l.concluidaEm ?? null,
        l.comPaciente === false ? null : paciente,
        l.tipo ?? '',
        JSON.stringify(l.historico ?? []),
        l.excluida === true ? new Date().toISOString() : null,
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
        paciente,
        id,
        l.tipo ?? '',
        l.recebimento.valor.toString(),
        l.recebimento.forma ?? (l.recebimento.valor > 0n ? 'Pix' : ''),
        (l.recebimento.aberto ?? 0n).toString(),
        l.concluidaEm ?? new Date().toISOString(),
        l.resp,
      ],
    )
  }
  return id
}

const inserirContagem = async (
  resp: string,
  prazo: string,
  situacao: 'aberta' | 'concluida',
  concluidaEm: string | null,
): Promise<void> => {
  await migrate.query(
    `INSERT INTO contagens_de_estoque
       (clinica_id, nome, responsavel_id, prazo, situacao, concluida_em)
     VALUES ($1, 'fixture', $2, $3::date, $4, $5::date)`,
    [clinica, resp, prazo, situacao, concluidaEm],
  )
}

/** O instante de um dia do mês, às 15:00 UTC (12:00 em `America/Bahia`). */
const em = (dia: number): string => `2026-11-${String(dia).padStart(2, '0')}T15:00:00.000Z`

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[indicadores] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinica = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica dos Indicadores') RETURNING id`,
      [codigo],
    )
  ).rows[0]!.id

  const perfilRh = (
    await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms)
       VALUES ($1, 'pf_rh', 'RH', $2) RETURNING id`,
      [clinica, ['pessoas.gerir', 'valores']],
    )
  ).rows[0]!.id

  const hash = await hashDeSenha(SENHA)
  const novaPessoa = async (nome: string, usuario: string, perfil: string | null) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [clinica, nome, usuario, hash, perfil === null, perfil],
      )
    ).rows[0]!.id

  gestora = await novaPessoa('Helena Prado', 'helena', perfilRh)
  ana = await novaPessoa('Ana Silva', 'ana.silva', perfilRh)
  bruna = await novaPessoa('Bruna Rocha', 'bruna.rocha', perfilRh)

  const novaFicha = async (nome: string, pessoaId: string | null) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO fichas_de_pessoa (clinica_id, nome, cargo, pessoa_id)
         VALUES ($1, $2, 'Recepcionista', $3) RETURNING id`,
        [clinica, nome, pessoaId],
      )
    ).rows[0]!.id

  fichaDaAna = await novaFicha('Ana Silva', ana)
  fichaDaBruna = await novaFicha('Bruna Rocha', bruna)
  // A FAXINEIRA SEM LOGIN: ficha sem `pessoa_id`. Toda meta automática dela é
  // `null` — não há registros de quem contar.
  fichaSemUsuario = await novaFicha('Zilda Nunes', null)

  paciente = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, 'Paciente da Fixture') RETURNING id`,
      [clinica],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(relogioDeTeste)
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  rh = cookieDe(await srv().post('/v1/entrar').send({
    clinica: codigo,
    usuario: 'helena',
    senha: SENHA,
  }).expect(200))
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await app.close()
})

beforeEach(async () => {
  agora = new Date(INICIO)
  await migrate.query(`DELETE FROM metas_de_pessoa WHERE clinica_id = $1`, [clinica])
  await migrate.query(`DELETE FROM contagens_de_estoque WHERE clinica_id = $1`, [clinica])
  await migrate.query(`DELETE FROM recebimentos WHERE clinica_id = $1`, [clinica])
  await migrate.query(`DELETE FROM tarefas WHERE clinica_id = $1`, [clinica])
})

// ---------------------------------------------------------------------------
// 1 e 2 — OS EVENTOS DA JORNADA
// ---------------------------------------------------------------------------

describe('1 e 2 · agendamentos e confirmacoes — eventos por `acao` DECLARADA', () => {
  /**
   * **A MUTAÇÃO QUE ESTE TESTE MATA:** contar por ETAPA no lugar de `acao`.
   *
   * O protótipo filtra `x.e === 'agendado' && !x.rot` — a etapa de destino
   * mais a ausência de um rótulo de apresentação. `reagendar` leva a
   * `agendado` e NÃO é um agendamento novo: quem remarcou a mesma paciente
   * três vezes viraria três agendamentos, e a conversão do funil cairia sem
   * nada ter piorado na clínica.
   *
   * A fixture põe `reagendar` no meio do histórico de propósito. Trocar
   * `ev->>'acao'` por `ev->>'etapa'` na consulta faz `agendamentos` ir de 2
   * para 4 e este teste reprova.
   */
  it('conta `agendar` e `confirmar`, e NÃO conta `reagendar` nem `encerrar`', async () => {
    await inserirTarefa({
      resp: ana,
      tipo: 'Consulta agendada',
      prazo: '2026-11-05',
      historico: [
        { acao: 'agendar', porId: ana, em: em(3) },
        { acao: 'confirmar', porId: ana, em: em(4) },
        // Os dois RUÍDOS que matam a mutação de etapa: `reagendar` chega em
        // `agendado`, `encerrar` não é nenhum dos dois.
        { acao: 'reagendar', porId: ana, em: em(5) },
        { acao: 'encerrar', porId: ana, em: em(6) },
      ],
    })
    await inserirTarefa({
      resp: bruna,
      tipo: 'Consulta agendada',
      prazo: '2026-11-10',
      // **`porId` é QUEM FEZ, não quem é responsável.** Ana agendou uma
      // consulta cujo cartão é da Bruna: o agendamento é da Ana.
      historico: [{ acao: 'agendar', porId: ana, em: em(9) }],
    })

    await criarMeta(fichaDaAna, 'agendamentos', 10).expect(201)
    await criarMeta(fichaDaAna, 'confirmacoes', 10).expect(201)

    expect((await realizado(fichaDaAna, 'agendamentos')).realizadoEmNumero).toBe(2)
    expect((await realizado(fichaDaAna, 'confirmacoes')).realizadoEmNumero).toBe(1)
  })

  /**
   * **A MUTAÇÃO:** largar a janela do mês (`em >= de AND em < ate`).
   *
   * Sem ela, o agendamento de outubro e o de dezembro entram em novembro, e o
   * indicador deixa de ser do mês. A janela é SEMIABERTA e no fuso da clínica
   * (regra 23): o evento de 30/11 às 22h de Salvador é 01/12 em UTC, e com
   * `AT TIME ZONE 'UTC'` ele cairia em dezembro.
   */
  it('a janela é do MÊS, semiaberta, no fuso da clínica', async () => {
    await inserirTarefa({
      resp: ana,
      tipo: 'Consulta agendada',
      prazo: '2026-11-05',
      historico: [
        // Dentro: 01/11 às 03:00 UTC = 31/10 às 00:00 na Bahia? Não — 03:00
        // UTC de 01/11 é 00:00 de 01/11 na Bahia (UTC−3). A primeira hora do
        // mês, e ela ENTRA.
        { acao: 'agendar', porId: ana, em: '2026-11-01T03:00:00.000Z' },
        // Dentro: 30/11 às 23:59 na Bahia = 01/12 às 02:59 UTC. O último
        // instante do mês, e com `AT TIME ZONE 'UTC'` ele viraria dezembro.
        { acao: 'agendar', porId: ana, em: '2026-12-01T02:59:00.000Z' },
        // FORA, por um minuto: 01/12 às 00:00 na Bahia = 03:00 UTC.
        { acao: 'agendar', porId: ana, em: '2026-12-01T03:00:00.000Z' },
        // FORA: 31/10 às 23:59 na Bahia.
        { acao: 'agendar', porId: ana, em: '2026-11-01T02:59:00.000Z' },
      ],
    })
    await criarMeta(fichaDaAna, 'agendamentos', 10).expect(201)
    expect((await realizado(fichaDaAna, 'agendamentos')).realizadoEmNumero).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 3 a 6 — AS TAREFAS CONCLUÍDAS
// ---------------------------------------------------------------------------

describe('3 · contatos — concluídas que são contato COM PACIENTE', () => {
  /**
   * **A MUTAÇÃO:** largar `paciente_id IS NOT NULL`.
   *
   * **Aqui divergimos do `realizadoMeta` do protótipo, e concordamos com o
   * painel dele.** O `ehContato` dele é `!atende && !receita && !recebimento`
   * — um predicado que a tarefa INTERNA satisfaz, porque ela tem `tipo = ''` e
   * nenhuma flag. Medido: *"Fechar o caixa do dia"* concluída no mês devolve
   * `contatos: 1`. O painel dele faz `feitas.filter(t => t.pacienteId &&
   * ehContato(t))`, então a divergência é com um dos dois lugares dele e a
   * concordância é com o outro.
   *
   * Sem a exigência, uma meta de "20 contatos com pacientes" é batida
   * fechando o caixa vinte vezes. A fixture tem a tarefa interna de propósito:
   * largar o `paciente_id` faz `contatos` ir de 2 para 3.
   */
  it('conta Follow-up e Recaptação; NÃO conta tarefa interna, atendimento nem pagamento', async () => {
    await inserirTarefa({
      resp: ana,
      tipo: 'Follow-up',
      status: 'concluida',
      prazo: '2026-11-10',
      concluidaEm: em(10),
    })
    await inserirTarefa({
      resp: ana,
      tipo: 'Recaptação',
      status: 'concluida',
      prazo: '2026-11-11',
      concluidaEm: em(11),
    })
    // RUÍDO 1 — A TAREFA INTERNA: `tipo = ''`, sem paciente. `ehContato('')` é
    // `true` em TypeScript; `'' = ANY(TIPOS_DE_CONTATO)` é `false` no SQL, e a
    // exigência de paciente é a segunda trava.
    await inserirTarefa({
      resp: ana,
      status: 'concluida',
      prazo: '2026-11-12',
      concluidaEm: em(12),
      comPaciente: false,
    })
    // RUÍDO 2 — ATENDIMENTO: tem paciente, mas `atende`.
    await inserirTarefa({
      resp: ana,
      tipo: 'Consulta realizada',
      status: 'concluida',
      prazo: '2026-11-13',
      concluidaEm: em(13),
    })
    // RUÍDO 3 — PAGAMENTO: tem paciente, mas `receita`.
    await inserirTarefa({
      resp: ana,
      tipo: 'Pagamento de consulta',
      status: 'concluida',
      prazo: '2026-11-14',
      concluidaEm: em(14),
      recebimento: { valor: 20000n },
    })
    // RUÍDO 4 — ABERTA: contato que ainda não aconteceu não é contato feito.
    await inserirTarefa({ resp: ana, tipo: 'Follow-up', prazo: '2026-11-15' })
    // RUÍDO 5 — DA BRUNA: o indicador é por responsável.
    await inserirTarefa({
      resp: bruna,
      tipo: 'Follow-up',
      status: 'concluida',
      prazo: '2026-11-16',
      concluidaEm: em(16),
    })
    // RUÍDO 6 — EXCLUÍDA: soft delete tira da contagem.
    await inserirTarefa({
      resp: ana,
      tipo: 'Follow-up',
      status: 'concluida',
      prazo: '2026-11-17',
      concluidaEm: em(17),
      excluida: true,
    })

    await criarMeta(fichaDaAna, 'contatos', 10).expect(201)
    expect((await realizado(fichaDaAna, 'contatos')).realizadoEmNumero).toBe(2)
  })
})

describe('4 e 5 · orc_qtd e orc_valor — os orçamentos fechados', () => {
  /**
   * **A MUTAÇÃO 1:** somar `valor_orcamento` no lugar do recebimento.
   *
   * **Orçamento não é receita (regra 4).** O que `orc_valor` soma é o que
   * ENTROU no fechamento — o `t.valor` do protótipo num tipo cujo rótulo é
   * *"Valor pago (R$)"* —, nunca o `valorOrcamento` da proposta. A fixture põe
   * um `Orçamento enviado` de R$ 5.000 que não pode aparecer em lugar nenhum.
   *
   * **A MUTAÇÃO 2:** largar `DINHEIRO_QUE_ENTROU` do `LEFT JOIN`.
   *
   * A terceira linha é uma **venda a prazo** (D-9): `valor = 0`,
   * `valor_aberto = 300000`, forma vazia. Ela CONTA em `orc_qtd` — o orçamento
   * fechou — e soma ZERO em `orc_valor`, porque nada entrou. Somar
   * `valor_aberto` ali daria R$ 5.800 de receita que ninguém recebeu.
   */
  it('conta o tipo e soma SÓ o que entrou — nem orçamento, nem venda a prazo', async () => {
    await inserirTarefa({
      resp: ana,
      tipo: 'Pagamento de orçamento',
      status: 'concluida',
      prazo: '2026-11-05',
      concluidaEm: em(5),
      recebimento: { valor: 180000n },
    })
    await inserirTarefa({
      resp: ana,
      tipo: 'Pagamento de orçamento',
      status: 'concluida',
      prazo: '2026-11-06',
      concluidaEm: em(6),
      // Entrada de R$ 1.000 com R$ 2.000 em aberto: entrou R$ 1.000.
      recebimento: { valor: 100000n, aberto: 200000n },
    })
    await inserirTarefa({
      resp: ana,
      tipo: 'Pagamento de orçamento',
      status: 'concluida',
      prazo: '2026-11-07',
      concluidaEm: em(7),
      // VENDA A PRAZO: fechou, não pagou nada. Conta na quantidade, zero no valor.
      recebimento: { valor: 0n, aberto: 300000n, forma: '' },
    })
    // RUÍDO — O ORÇAMENTO ENVIADO: proposta, nunca receita.
    const orcamento = await inserirTarefa({
      resp: ana,
      tipo: 'Orçamento enviado',
      status: 'concluida',
      prazo: '2026-11-08',
      concluidaEm: em(8),
    })
    await migrate.query(`UPDATE tarefas SET valor_orcamento = 500000 WHERE id = $1`, [orcamento])

    await criarMeta(fichaDaAna, 'orc_qtd', 5).expect(201)
    await criarMeta(fichaDaAna, 'orc_valor', '400000').expect(201)

    expect((await realizado(fichaDaAna, 'orc_qtd')).realizadoEmNumero).toBe(3)

    const valor = await realizado(fichaDaAna, 'orc_valor')
    // R$ 1.800 + R$ 1.000 + R$ 0 = R$ 2.800, em centavos e como TEXTO.
    expect(valor.realizadoEmDinheiro).toBe('280000')
    expect(valor.realizadoEmNumero).toBeNull()
    // 280000 / 400000 = 70%.
    expect(valor.percentual).toBe(70)
  })

  /**
   * **A MUTAÇÃO:** entregar o valor sem passar pela redação.
   *
   * Sem `valores`, a meta de `orc_valor` entrega **só o percentual** (regra
   * 17), e é o servidor que apaga — num ponto único, nunca num `if` do
   * controlador. `metaEmDinheiro` e `realizadoEmDinheiro` vêm `null`;
   * `percentual` atravessa, porque "70% da meta" não revela a meta.
   */
  it('sem `valores`, o dinheiro é apagado e SÓ o percentual atravessa', async () => {
    await inserirTarefa({
      resp: ana,
      tipo: 'Pagamento de orçamento',
      status: 'concluida',
      prazo: '2026-11-05',
      concluidaEm: em(5),
      recebimento: { valor: 280000n },
    })
    await criarMeta(fichaDaAna, 'orc_valor', '400000').expect(201)
    await criarMeta(fichaDaAna, 'orc_qtd', 5).expect(201)

    // Um perfil com `pessoas.gerir` e SEM `valores`: a gestora de RH que não
    // fecha o caixa.
    const perfilSemValor = (
      await migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms)
         VALUES ($1, $2, 'RH sem valores', $3) RETURNING id`,
        [clinica, `pf_sv_${Date.now()}`, ['pessoas.gerir']],
      )
    ).rows[0]!.id
    await migrate.query(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
       VALUES ($1, 'Marta Lima', $2, $3, false, $4)`,
      [clinica, `marta${Date.now()}`.slice(0, 20), await hashDeSenha(SENHA), perfilSemValor],
    )
    const usuario = (
      await migrate.query<{ usuario: string }>(
        `SELECT usuario FROM pessoas WHERE perfil_id = $1`,
        [perfilSemValor],
      )
    ).rows[0]!.usuario
    const semValor = cookieDe(
      await srv().post('/v1/entrar').send({ clinica: codigo, usuario, senha: SENHA }).expect(200),
    )

    const r = await srv().get(`/v1/metas-de-pessoa/${MES}`).set('Cookie', semValor).expect(200)
    const pessoas = r.body.pessoas as { fichaId: string; metas: MetaNaResposta[] }[]
    const dela = pessoas.find((p) => p.fichaId === fichaDaAna)!
    const emReais = dela.metas.find((m) => m.indicador === 'orc_valor')!
    expect(emReais.metaEmDinheiro).toBeNull()
    expect(emReais.realizadoEmDinheiro).toBeNull()
    expect(emReais.percentual).toBe(70)

    // E o que NÃO é dinheiro atravessa inteiro: esconder "3 de 5 orçamentos"
    // seria esconder o trabalho dela, não o preço de nada.
    const emQuantidade = dela.metas.find((m) => m.indicador === 'orc_qtd')!
    expect(emQuantidade.metaEmNumero).toBe(5)
    expect(emQuantidade.realizadoEmNumero).toBe(1)
  })
})

describe('6 · recebimentos — pagamento do grupo, ou pagável COM dinheiro', () => {
  /**
   * **A MUTAÇÃO:** largar o `AND r.id IS NOT NULL` do braço dos pagáveis.
   *
   * O `ehReceb` dela é `ehPagamento(tipo) || (aceitaPagamento(tipo) &&
   * (valor > 0 || formaPagamento))`. A segunda metade é o atendimento com
   * pagamento EMBUTIDO, e ela só conta **quando houve pagamento**: uma
   * `Consulta realizada` sem recebimento não é um recebimento registrado.
   *
   * A fixture tem as duas consultas — uma com pagamento, uma sem. Sem a
   * condição, `recebimentos` vai de 2 para 3.
   */
  it('conta o pagamento e o atendimento PAGO; não conta o atendimento sem pagamento', async () => {
    await inserirTarefa({
      resp: ana,
      tipo: 'Pagamento de saldo em aberto',
      status: 'concluida',
      prazo: '2026-11-05',
      concluidaEm: em(5),
      recebimento: { valor: 50000n },
    })
    await inserirTarefa({
      resp: ana,
      tipo: 'Consulta realizada',
      status: 'concluida',
      prazo: '2026-11-06',
      concluidaEm: em(6),
      recebimento: { valor: 30000n },
    })
    // RUÍDO — CONSULTA SEM PAGAMENTO: pagável, mas nada entrou.
    await inserirTarefa({
      resp: ana,
      tipo: 'Consulta realizada',
      status: 'concluida',
      prazo: '2026-11-07',
      concluidaEm: em(7),
    })

    await criarMeta(fichaDaAna, 'recebimentos', 5).expect(201)
    expect((await realizado(fichaDaAna, 'recebimentos')).realizadoEmNumero).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 7 e 8 — OS DOIS PERCENTUAIS, E É AQUI QUE DÓI
// ---------------------------------------------------------------------------

describe('7 · tarefas_prazo — PERCENTUAL, e o denominador é quem decide', () => {
  /**
   * O denominador tem QUATRO condições, e **cada uma é uma mutação própria**:
   *
   *  a. `prazo` no MÊS — o indicador é do mês do PRAZO, não da conclusão.
   *  b. `prazo <= hoje` — o que não venceu não pode estar atrasado.
   *  c. `status <> 'cancelada'` — cancelar não é atrasar.
   *  d. `tipo` não é pagamento — o lançamento de um pagamento tem prazo igual
   *     ao dia do caixa e distorceria a disciplina de quem recebe dinheiro.
   *
   * A conta à mão, com a fixture abaixo: entram 4 tarefas (duas no prazo, uma
   * com atraso, uma atrasada em aberto) → `round(2/4 × 100) = 50`.
   *
   * Largar (a) traz a de outubro → 2/5 = 40. Largar (b) traz a de 25/11 →
   * 2/5 = 40. Largar (c) traz a cancelada → 2/5 = 40. Largar (d) traz o
   * pagamento → 3/5 = 60. **Cada mutação muda o número**, e nenhuma delas
   * sobrevive.
   */
  it('o denominador recusa: outro mês, a vencer, cancelada e pagamento', async () => {
    // NO PRAZO (2): concluída antes e exatamente no dia do prazo.
    await inserirTarefa({
      resp: ana,
      tipo: 'Follow-up',
      status: 'concluida',
      prazo: '2026-11-10',
      concluidaEm: em(9),
    })
    await inserirTarefa({
      resp: ana,
      tipo: 'Follow-up',
      status: 'concluida',
      prazo: '2026-11-11',
      concluidaEm: em(11),
    })
    // COM ATRASO (1): concluída no dia seguinte ao prazo.
    await inserirTarefa({
      resp: ana,
      tipo: 'Follow-up',
      status: 'concluida',
      prazo: '2026-11-12',
      concluidaEm: em(13),
    })
    // ATRASADA EM ABERTO (1): prazo já venceu e ninguém concluiu.
    await inserirTarefa({ resp: ana, tipo: 'Follow-up', prazo: '2026-11-14' })

    // (a) OUTRO MÊS — prazo em outubro.
    await inserirTarefa({
      resp: ana,
      tipo: 'Follow-up',
      status: 'concluida',
      prazo: '2026-10-20',
      concluidaEm: '2026-10-20T15:00:00.000Z',
    })
    // (b) A VENCER — prazo 25/11, e hoje é 18/11.
    await inserirTarefa({ resp: ana, tipo: 'Follow-up', prazo: '2026-11-25' })
    // (c) CANCELADA.
    await inserirTarefa({
      resp: ana,
      tipo: 'Follow-up',
      status: 'cancelada',
      prazo: '2026-11-13',
    })
    // (d) PAGAMENTO — grupo Pagamentos sai do denominador.
    await inserirTarefa({
      resp: ana,
      tipo: 'Pagamento de consulta',
      status: 'concluida',
      prazo: '2026-11-15',
      concluidaEm: em(15),
      recebimento: { valor: 10000n },
    })

    await criarMeta(fichaDaAna, 'tarefas_prazo', 90).expect(201)
    const m = await realizado(fichaDaAna, 'tarefas_prazo')
    expect(m.realizadoEmNumero).toBe(50)
    // 50 de uma meta de 90: `round(50/90 × 100) = 56`.
    expect(m.percentual).toBe(56)
  })

  /**
   * **A MUTAÇÃO:** trocar `prazo <= hoje` por `prazo < hoje`.
   *
   * Medido no protótipo: `t.prazo <= today()`. A tarefa de HOJE já entra no
   * denominador — ela venceu hoje, e quem não a concluiu está atrasado hoje.
   * Com `<`, ela sai, e o percentual de quem tem só a de hoje passa de 0% para
   * `—` (sem denominador).
   */
  it('a tarefa de HOJE já entra no denominador — `<=`, nunca `<`', async () => {
    await inserirTarefa({ resp: ana, tipo: 'Follow-up', prazo: '2026-11-18' })
    await criarMeta(fichaDaAna, 'tarefas_prazo', 90).expect(201)
    expect((await realizado(fichaDaAna, 'tarefas_prazo')).realizadoEmNumero).toBe(0)
  })

  /**
   * **A MUTAÇÃO:** `(concluida_em AT TIME ZONE 'UTC')::date <= prazo`.
   *
   * O fuso é da CLÍNICA (regra 22). Uma conclusão às 21h de Salvador no dia do
   * prazo é meia-noite do dia seguinte em UTC: com `'UTC'` fixo, a tarefa
   * entregue no prazo viraria atraso, e o percentual de quem trabalha à noite
   * cairia de 100% para 0%.
   */
  it('o "no prazo" é medido no fuso da CLÍNICA, não em UTC', async () => {
    await inserirTarefa({
      resp: ana,
      tipo: 'Follow-up',
      status: 'concluida',
      prazo: '2026-11-10',
      // 11/11 às 00:00 UTC = 10/11 às 21:00 na Bahia. No prazo.
      concluidaEm: '2026-11-11T00:00:00.000Z',
    })
    await criarMeta(fichaDaAna, 'tarefas_prazo', 90).expect(201)
    expect((await realizado(fichaDaAna, 'tarefas_prazo')).realizadoEmNumero).toBe(100)
  })

  /**
   * **LISTA VAZIA É `null`, NUNCA `0`** — e é o `pct` dela
   * (`lista.length ? … : null`).
   *
   * A diferença não é cosmética: `0%` acusa alguém que deixou tudo atrasar, e
   * `—` diz que não havia nada no mês. Quem troca os dois cria a primeira
   * conversa 1:1 que começa com uma acusação falsa.
   *
   * **A MUTAÇÃO É `?? 0n` NO LUGAR DE `?? null` EM `montarMeta`**, e não o
   * `return 0` de `percentualNoPrazo` — a diferença custou uma rodada de
   * medição e vale escrever.
   *
   * `percentualNoPrazo(0, 0)` é **inalcançável** por este caminho: a consulta
   * tem `GROUP BY`, e sem nenhuma tarefa no recorte ela não devolve LINHA
   * nenhuma — nunca uma linha com `total = 0`. Então trocar aquele `return
   * null` por `return 0` passa por aqui sem ser notado: medido, a mutação
   * SOBREVIVEU a este teste. Quem a mata é o teste do domínio
   * (`metas-de-pessoa.test.ts`, "TOTAL ZERO É `null`"), e é lá que ela
   * pertence.
   *
   * O que ESTE teste mata é o `??` da montagem: `undefined` no mapa (nenhuma
   * linha para a pessoa) virando zero. Medido: `?? 0n` reprova aqui com
   * `expected 0 to be null`.
   */
  it('sem NENHUMA tarefa vencida no mês, o realizado é `—`, não 0%', async () => {
    // Só uma tarefa a vencer: o denominador fica vazio.
    await inserirTarefa({ resp: ana, tipo: 'Follow-up', prazo: '2026-11-25' })
    await criarMeta(fichaDaAna, 'tarefas_prazo', 90).expect(201)
    const m = await realizado(fichaDaAna, 'tarefas_prazo')
    expect(m.realizadoEmNumero).toBeNull()
    expect(m.percentual).toBeNull()
  })

  /**
   * A FRONTEIRA DA DIVISÃO INEXATA: 1 de 3 é 33%, 2 de 3 é 67%.
   *
   * Arredondamento meio para cima, por `percentualInteiro` em aritmética
   * exata de `bigint` — a mesma função da meta de faturamento.
   * `Math.round(a/b*100)` é a assinatura do protótipo, e manter duas é como
   * uma delas passa a arredondar diferente.
   */
  it('a divisão inexata arredonda meio para cima: 2 de 3 é 67%', async () => {
    for (const [prazo, concluida] of [
      ['2026-11-05', em(5)],
      ['2026-11-06', em(6)],
      ['2026-11-07', em(9)],
    ] as const) {
      await inserirTarefa({
        resp: ana,
        tipo: 'Follow-up',
        status: 'concluida',
        prazo,
        concluidaEm: concluida,
      })
    }
    await criarMeta(fichaDaAna, 'tarefas_prazo', 100).expect(201)
    expect((await realizado(fichaDaAna, 'tarefas_prazo')).realizadoEmNumero).toBe(67)
  })
})

describe('8 · contagens_prazo — PERCENTUAL das contagens de estoque', () => {
  /**
   * **A MUTAÇÃO 1:** `concluida_em < prazo` em vez de `<=`.
   *
   * Medido no protótipo: `(c.concluidaEm||"") <= c.prazo`. Fechar no próprio
   * dia do prazo é no prazo.
   *
   * **A MUTAÇÃO 2:** largar `prazo <= hoje`. A contagem de 25/11 não venceu, e
   * incluí-la afundaria o percentual de quem programou o mês.
   *
   * A conta: 3 contagens vencidas (duas fechadas no prazo, uma atrasada) →
   * `round(2/3 × 100) = 67`.
   */
  it('fechar no dia do prazo é no prazo; a contagem a vencer não entra', async () => {
    await inserirContagem(ana, '2026-11-05', 'concluida', '2026-11-04')
    // NO PRAZO, no limite: fechada no PRÓPRIO dia do prazo.
    await inserirContagem(ana, '2026-11-06', 'concluida', '2026-11-06')
    // ATRASADA: fechada um dia depois.
    await inserirContagem(ana, '2026-11-07', 'concluida', '2026-11-08')
    // RUÍDO — A VENCER: prazo 25/11, hoje é 18/11.
    await inserirContagem(ana, '2026-11-25', 'aberta', null)
    // RUÍDO — DA BRUNA.
    await inserirContagem(bruna, '2026-11-05', 'concluida', '2026-11-04')
    // RUÍDO — OUTRO MÊS.
    await inserirContagem(ana, '2026-10-05', 'concluida', '2026-10-04')

    await criarMeta(fichaDaAna, 'contagens_prazo', 90).expect(201)
    expect((await realizado(fichaDaAna, 'contagens_prazo')).realizadoEmNumero).toBe(67)
  })

  it('contagem vencida e ABERTA conta como fora do prazo, nunca sai do denominador', async () => {
    await inserirContagem(ana, '2026-11-05', 'concluida', '2026-11-04')
    await inserirContagem(ana, '2026-11-06', 'aberta', null)
    await criarMeta(fichaDaAna, 'contagens_prazo', 90).expect(201)
    expect((await realizado(fichaDaAna, 'contagens_prazo')).realizadoEmNumero).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// A FICHA SEM USUÁRIO, E A MÉDIA
// ---------------------------------------------------------------------------

describe('a ficha sem usuário ligado, e a média do mês', () => {
  /**
   * **A MUTAÇÃO:** devolver `0` no lugar de `null` para a ficha sem
   * `pessoa_id`.
   *
   * Medido no protótipo: `const uid = f && f.userId; if (!uid) return null`. A
   * faxineira com ficha e sem login não tem registros de quem contar — `0%`
   * acusaria de não trabalhar quem a ferramenta não consegue medir.
   */
  it('toda meta automática de ficha sem login é `—`, nunca zero', async () => {
    await criarMeta(fichaSemUsuario, 'agendamentos', 10).expect(201)
    await criarMeta(fichaSemUsuario, 'tarefas_prazo', 90).expect(201)
    for (const chave of ['agendamentos', 'tarefas_prazo']) {
      const m = await realizado(fichaSemUsuario, chave)
      expect(m.realizadoEmNumero, chave).toBeNull()
      expect(m.percentual, chave).toBeNull()
    }
  })

  /**
   * **A MÉDIA CLAMPA CADA META EM 100 ANTES DE SOMAR**, e esse `Math.min` é a
   * regra inteira: sem ele, 200% numa meta compensa 0% em outra, e a 1:1 abre
   * com "meta cumprida" para quem falhou metade do mês.
   *
   * A fixture: `agendamentos` 2 de 1 = 200% → clampa em 100; `contatos` 0 de
   * 10 = 0%. Média com clamp = 50. Sem clamp = 100.
   *
   * **A `Consulta realizada` concluída é indispensável, e a primeira versão
   * deste teste passava sem ela por motivo errado.** `contatos` só é `0`
   * quando a pessoa TEM tarefa concluída no mês e nenhuma delas é contato;
   * sem nenhuma conclusão, o indicador é `null` (sem dado), fica fora da média
   * e o teste passaria com 100 **com e sem** o clamp. Medido: a mutação
   * sobrevivia.
   */
  it('a média clampa cada meta em 100 — 200% não compensa 0%', async () => {
    await inserirTarefa({
      // Prazo A VENCER de propósito: com prazo vencido esta tarefa entraria no
      // denominador de `tarefas_prazo`, que não é o indicador em medição.
      resp: ana,
      tipo: 'Consulta agendada',
      prazo: '2026-11-25',
      historico: [
        { acao: 'agendar', porId: ana, em: em(3) },
        { acao: 'agendar', porId: ana, em: em(4) },
      ],
    })
    // A conclusão que faz `contatos` ser ZERO em vez de `—`: ela é atendimento,
    // não contato.
    await inserirTarefa({
      resp: ana,
      tipo: 'Consulta realizada',
      status: 'concluida',
      prazo: '2026-11-10',
      concluidaEm: em(10),
    })
    await criarMeta(fichaDaAna, 'agendamentos', 1).expect(201)
    await criarMeta(fichaDaAna, 'contatos', 10).expect(201)

    const r = await srv().get(`/v1/metas-de-pessoa/${MES}`).set('Cookie', rh).expect(200)
    const pessoas = r.body.pessoas as {
      fichaId: string
      mediaDeAtingimento: number | null
      metas: MetaNaResposta[]
    }[]
    const dela = pessoas.find((p) => p.fichaId === fichaDaAna)!
    expect(dela.metas.find((m) => m.indicador === 'agendamentos')!.percentual).toBe(200)
    expect(dela.mediaDeAtingimento).toBe(50)
  })

  /**
   * **A MUTAÇÃO:** contar as metas sem dado no denominador da média.
   *
   * Uma meta em `—` não é um zero. Incluí-la faria quem bateu a única meta
   * medível do mês ter média 33% por causa de duas que a ferramenta não
   * conseguiu contar.
   */
  it('meta sem dado fica fora do numerador E do denominador da média', async () => {
    await inserirTarefa({
      resp: ana,
      tipo: 'Consulta agendada',
      // A VENCER (25/11, e hoje é 18/11): com prazo vencido esta tarefa cairia
      // no denominador de `tarefas_prazo` como 0%, e a média seria 50 — que é
      // justamente o que este teste quer distinguir de "sem dado".
      prazo: '2026-11-25',
      historico: [{ acao: 'agendar', porId: ana, em: em(3) }],
    })
    await criarMeta(fichaDaAna, 'agendamentos', 1).expect(201)
    // Nenhuma tarefa vencida no mês → `tarefas_prazo` é `—`.
    await criarMeta(fichaDaAna, 'tarefas_prazo', 90).expect(201)
    await criarMeta(fichaDaAna, 'contagens_prazo', 90).expect(201)

    const r = await srv().get(`/v1/metas-de-pessoa/${MES}`).set('Cookie', rh).expect(200)
    const pessoas = r.body.pessoas as { fichaId: string; mediaDeAtingimento: number | null }[]
    expect(pessoas.find((p) => p.fichaId === fichaDaAna)!.mediaDeAtingimento).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// A META MANUAL
// ---------------------------------------------------------------------------

describe('a meta MANUAL — a única com resultado lançado à mão', () => {
  it('lança, corrige e LIMPA o resultado; `null` volta a `—` e zero é zero', async () => {
    const criada = await criarMeta(fichaDaAna, 'manual', 20, 'Avaliações no Google').expect(201)
    const pessoas = criada.body.pessoas as { fichaId: string; metas: (MetaNaResposta & { id: string })[] }[]
    const meta = pessoas.find((p) => p.fichaId === fichaDaAna)!.metas[0]!
    expect(meta.realizadoEmNumero).toBeNull()

    const url = `/v1/metas-de-pessoa/${MES}/${meta.id}/realizado`
    await srv().put(url).set('Cookie', rh).send({ realizadoEmNumero: 15 }).expect(200)
    expect((await realizado(fichaDaAna, 'manual')).realizadoEmNumero).toBe(15)
    expect((await realizado(fichaDaAna, 'manual')).percentual).toBe(75)

    // ZERO É UM RESULTADO DECLARADO COMO ZERO, e `null` é "ainda não lancei".
    // Medido no protótipo: `realizado: 0` devolve `0`, `realizado: ''` devolve
    // `null`. Colapsar os dois esconde quem lançou um mês sem nenhuma.
    await srv().put(url).set('Cookie', rh).send({ realizadoEmNumero: 0 }).expect(200)
    expect((await realizado(fichaDaAna, 'manual')).realizadoEmNumero).toBe(0)
    expect((await realizado(fichaDaAna, 'manual')).percentual).toBe(0)

    await srv().put(url).set('Cookie', rh).send({ realizadoEmNumero: null }).expect(200)
    expect((await realizado(fichaDaAna, 'manual')).realizadoEmNumero).toBeNull()
  })

  /**
   * **O protótipo aceita `realizado` em QUALQUER meta** (`P.metas.find(x =>
   * x.id === d.id)`), e a leitura dele ignora o campo nas automáticas: a
   * gestora digita um número em "Agendamentos feitos", vê *"Resultado salvo"*,
   * e a tela continua mostrando a contagem. Aqui é **422 com a razão**, e o
   * `CHECK realizado_lancado_so_na_manual` fecha a porta no banco também.
   */
  it('lançar resultado numa meta AUTOMÁTICA é 422, nunca um salvamento silencioso', async () => {
    const criada = await criarMeta(fichaDaAna, 'agendamentos', 10).expect(201)
    const pessoas = criada.body.pessoas as { fichaId: string; metas: (MetaNaResposta & { id: string })[] }[]
    const meta = pessoas.find((p) => p.fichaId === fichaDaAna)!.metas[0]!
    const r = await srv()
      .put(`/v1/metas-de-pessoa/${MES}/${meta.id}/realizado`)
      .set('Cookie', rh)
      .send({ realizadoEmNumero: 99 })
    expect(r.status).toBe(422)
    expect(String(r.body.mensagem ?? r.body.message)).toContain('calculada pela ferramenta')
  })
})

// ---------------------------------------------------------------------------
// MINHAS METAS
// ---------------------------------------------------------------------------

describe('GET /v1/minhas-metas/:mes — a tela que todo perfil tem', () => {
  /**
   * **A DEFESA É NÃO HAVER PARÂMETRO DE PESSOA.** A ficha é achada por
   * `pessoa_id = ator`, e esta rota não exige permissão nenhuma — um
   * `?fichaId=` aqui seria a porta pela qual a recepção lê a meta e o
   * atingimento da colega.
   *
   * O teste prova as duas direções: Ana vê as DELA, e as da Bruna não
   * atravessam nem como efeito colateral.
   */
  it('devolve as metas de QUEM PEDIU, e nunca as de outra pessoa', async () => {
    await criarMeta(fichaDaAna, 'agendamentos', 10).expect(201)
    await criarMeta(fichaDaBruna, 'contatos', 30).expect(201)
    await inserirTarefa({
      resp: ana,
      tipo: 'Consulta agendada',
      prazo: '2026-11-05',
      historico: [{ acao: 'agendar', porId: ana, em: em(3) }],
    })

    const comoAna = cookieDe(
      await srv()
        .post('/v1/entrar')
        .send({ clinica: codigo, usuario: 'ana.silva', senha: SENHA })
        .expect(200),
    )
    const r = await srv().get(`/v1/minhas-metas/${MES}`).set('Cookie', comoAna).expect(200)
    expect(r.body.temFicha).toBe(true)
    const metas = r.body.metas as MetaNaResposta[]
    expect(metas).toHaveLength(1)
    expect(metas[0]!.indicador).toBe('agendamentos')
    expect(metas[0]!.realizadoEmNumero).toBe(1)
    expect(r.body.mediaDeAtingimento).toBe(10)
  })

  it('quem ainda não tem ficha recebe `temFicha: false`, e a tela explica', async () => {
    // `pessoa_tem_acesso_definido` cobra perfil OU admin: não existe pessoa
    // sem acesso nenhum. Um perfil VAZIO é o certo aqui — a rota não exige
    // permissão, e é isso que o teste mede.
    const perfilVazio = (
      await migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms)
         VALUES ($1, $2, 'Sem nada', '{}') RETURNING id`,
        [clinica, `pf_zero_${Date.now()}`],
      )
    ).rows[0]!.id
    const semFicha = (
      await migrate.query<{ usuario: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
         VALUES ($1, 'Carla Dias', $2, $3, false, $4) RETURNING usuario`,
        [clinica, `carla${Date.now()}`.slice(0, 20), await hashDeSenha(SENHA), perfilVazio],
      )
    ).rows[0]!.usuario
    const dela = cookieDe(
      await srv()
        .post('/v1/entrar')
        .send({ clinica: codigo, usuario: semFicha, senha: SENHA })
        .expect(200),
    )
    const r = await srv().get(`/v1/minhas-metas/${MES}`).set('Cookie', dela).expect(200)
    expect(r.body).toMatchObject({ temFicha: false, mediaDeAtingimento: null, metas: [] })
  })
})

// ---------------------------------------------------------------------------
// COPIAR METAS — IDEMPOTENTE POR ESQUEMA
// ---------------------------------------------------------------------------

describe('copiarMetas — idempotente por esquema, três vezes', () => {
  /**
   * **A MUTAÇÃO:** trocar o `ON CONFLICT DO NOTHING` por um `if (!existe)`.
   *
   * O protótipo faz `if (!P.metas.some(...)) push`, que duas abas atravessam
   * juntas: a pessoa fica com duas vezes "Agendamentos feitos" no mês, e a
   * média de atingimento dela passa a contar a mesma meta duas vezes.
   *
   * Copiar TRÊS vezes é como se testa idempotência (regra 26): a segunda e a
   * terceira devolvem `copiadas: 0`.
   */
  it('a segunda e a terceira cópia não criam nada, e `jaExistiam` as nomeia', async () => {
    await criarMeta(fichaDaAna, 'agendamentos', 10).expect(201)
    await criarMeta(fichaDaAna, 'manual', 20, 'Avaliações no Google').expect(201)
    await criarMeta(fichaDaBruna, 'contatos', 30).expect(201)

    const copiar = () =>
      srv()
        .post(`/v1/metas-de-pessoa/2026-12/copiar`)
        .set('Cookie', rh)
        .send({ de: MES })
        .expect(200)

    const um = await copiar()
    expect(um.body.copiadas).toBe(3)
    expect(um.body.jaExistiam).toBe(0)

    for (const vez of [2, 3]) {
      const r = await copiar()
      expect(r.body.copiadas, `cópia ${vez}`).toBe(0)
      expect(r.body.jaExistiam, `cópia ${vez}`).toBe(3)
    }

    const dezembro = await srv().get('/v1/metas-de-pessoa/2026-12').set('Cookie', rh).expect(200)
    const pessoas = dezembro.body.pessoas as { fichaId: string; metas: MetaNaResposta[] }[]
    expect(pessoas.find((p) => p.fichaId === fichaDaAna)!.metas).toHaveLength(2)
    await migrate.query(`DELETE FROM metas_de_pessoa WHERE clinica_id = $1`, [clinica])
  })

  /**
   * **O realizado lançado NÃO é copiado** — ele é o resultado do mês de
   * ORIGEM. Copiá-lo daria à gestora um dezembro que já abre com o número de
   * novembro dentro.
   */
  it('o resultado lançado à mão fica no mês de origem', async () => {
    const criada = await criarMeta(fichaDaAna, 'manual', 20, 'Indicações').expect(201)
    const pessoas = criada.body.pessoas as { fichaId: string; metas: (MetaNaResposta & { id: string })[] }[]
    const meta = pessoas.find((p) => p.fichaId === fichaDaAna)!.metas[0]!
    await srv()
      .put(`/v1/metas-de-pessoa/${MES}/${meta.id}/realizado`)
      .set('Cookie', rh)
      .send({ realizadoEmNumero: 18 })
      .expect(200)

    await srv()
      .post('/v1/metas-de-pessoa/2026-12/copiar')
      .set('Cookie', rh)
      .send({ de: MES })
      .expect(200)
    const dezembro = await srv().get('/v1/metas-de-pessoa/2026-12').set('Cookie', rh).expect(200)
    const dela = (dezembro.body.pessoas as { fichaId: string; metas: MetaNaResposta[] }[]).find(
      (p) => p.fichaId === fichaDaAna,
    )!
    expect(dela.metas[0]!.realizadoEmNumero).toBeNull()
    await migrate.query(`DELETE FROM metas_de_pessoa WHERE clinica_id = $1`, [clinica])
  })

  it('a meta duplicada no mesmo mês é 409, nomeando o indicador', async () => {
    await criarMeta(fichaDaAna, 'agendamentos', 10).expect(201)
    const r = await criarMeta(fichaDaAna, 'agendamentos', 20)
    expect(r.status).toBe(409)
    expect(String(r.body.mensagem ?? r.body.message)).toContain('Agendamentos feitos')
  })

  it('excluir é SOFT DELETE, e a chave volta a ser usável', async () => {
    const criada = await criarMeta(fichaDaAna, 'agendamentos', 10).expect(201)
    const pessoas = criada.body.pessoas as { fichaId: string; metas: (MetaNaResposta & { id: string })[] }[]
    const meta = pessoas.find((p) => p.fichaId === fichaDaAna)!.metas[0]!

    await srv().delete(`/v1/metas-de-pessoa/${MES}/${meta.id}`).set('Cookie', rh).expect(200)
    // A LINHA CONTINUA LÁ (regra 20): soft delete, nunca `DELETE`.
    const viva = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM metas_de_pessoa
        WHERE id = $1 AND excluida_em IS NOT NULL`,
      [meta.id],
    )
    expect(viva.rows[0]!.n).toBe('1')
    // E o índice parcial liberou a chave.
    await criarMeta(fichaDaAna, 'agendamentos', 20).expect(201)
    // Excluir duas vezes é 404, não um segundo soft delete.
    expect(
      (await srv().delete(`/v1/metas-de-pessoa/${MES}/${meta.id}`).set('Cookie', rh)).status,
    ).toBe(404)
  })
})

describe('editar — o alvo muda, o indicador não', () => {
  it('troca nome e alvo, e a resposta reflete o novo valor', async () => {
    const criada = await criarMeta(fichaDaAna, 'agendamentos', 10).expect(201)
    const pessoas = criada.body.pessoas as { fichaId: string; metas: (MetaNaResposta & { id: string })[] }[]
    const meta = pessoas.find((p) => p.fichaId === fichaDaAna)!.metas[0]!

    await srv()
      .put(`/v1/metas-de-pessoa/${MES}/${meta.id}`)
      .set('Cookie', rh)
      .send({ indicador: 'agendamentos', nome: '', metaEmNumero: 25, metaEmDinheiro: null })
      .expect(200)

    expect((await realizado(fichaDaAna, 'agendamentos')).metaEmNumero).toBe(25)
  })

  it('404 em meta inexistente — já excluída não é editável', async () => {
    const criada = await criarMeta(fichaDaAna, 'agendamentos', 10).expect(201)
    const pessoas = criada.body.pessoas as { fichaId: string; metas: (MetaNaResposta & { id: string })[] }[]
    const meta = pessoas.find((p) => p.fichaId === fichaDaAna)!.metas[0]!
    await srv().delete(`/v1/metas-de-pessoa/${MES}/${meta.id}`).set('Cookie', rh).expect(200)

    await srv()
      .put(`/v1/metas-de-pessoa/${MES}/${meta.id}`)
      .set('Cookie', rh)
      .send({ indicador: 'agendamentos', nome: '', metaEmNumero: 25, metaEmDinheiro: null })
      .expect(404)
  })

  /**
   * **A IDENTIDADE DA META NÃO MUDA NA EDIÇÃO.** Trocar o indicador seria
   * fazer uma meta virar outra sem excluir e recriar — o histórico de
   * `realizado` ficaria ligado a um indicador que não é mais o que a linha
   * diz. O serviço recusa (422) em vez de aceitar em silêncio.
   */
  it('422 quando o corpo tenta trocar o indicador', async () => {
    const criada = await criarMeta(fichaDaAna, 'agendamentos', 10).expect(201)
    const pessoas = criada.body.pessoas as { fichaId: string; metas: (MetaNaResposta & { id: string })[] }[]
    const meta = pessoas.find((p) => p.fichaId === fichaDaAna)!.metas[0]!

    const r = await srv()
      .put(`/v1/metas-de-pessoa/${MES}/${meta.id}`)
      .set('Cookie', rh)
      .send({ indicador: 'contatos', nome: '', metaEmNumero: 25, metaEmDinheiro: null })
    expect(r.status).toBe(422)

    // E a meta original continua intacta.
    expect((await realizado(fichaDaAna, 'agendamentos')).metaEmNumero).toBe(10)
  })

  /** Mesma regra 17 do `criar` e do `GET` — a edição não é uma segunda porta. */
  it('sem `valores`, a resposta da edição também apaga o dinheiro', async () => {
    const criada = await criarMeta(fichaDaAna, 'orc_valor', '400000').expect(201)
    const pessoas = criada.body.pessoas as { fichaId: string; metas: (MetaNaResposta & { id: string })[] }[]
    const meta = pessoas.find((p) => p.fichaId === fichaDaAna)!.metas[0]!

    const perfilSemValor = (
      await migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms)
         VALUES ($1, $2, 'RH sem valores (editar)', $3) RETURNING id`,
        [clinica, `pf_sve_${Date.now()}`, ['pessoas.gerir']],
      )
    ).rows[0]!.id
    await migrate.query(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
       VALUES ($1, 'Marta Edita', $2, $3, false, $4)`,
      [clinica, `martae${Date.now()}`.slice(0, 20), await hashDeSenha(SENHA), perfilSemValor],
    )
    const usuario = (
      await migrate.query<{ usuario: string }>(`SELECT usuario FROM pessoas WHERE perfil_id = $1`, [
        perfilSemValor,
      ])
    ).rows[0]!.usuario
    const semValor = cookieDe(
      await srv().post('/v1/entrar').send({ clinica: codigo, usuario, senha: SENHA }).expect(200),
    )

    const r = await srv()
      .put(`/v1/metas-de-pessoa/${MES}/${meta.id}`)
      .set('Cookie', semValor)
      .send({ indicador: 'orc_valor', nome: '', metaEmNumero: null, metaEmDinheiro: '500000' })
      .expect(200)

    const pessoasResp = r.body.pessoas as { fichaId: string; metas: MetaNaResposta[] }[]
    const emReais = pessoasResp
      .find((p) => p.fichaId === fichaDaAna)!
      .metas.find((m) => m.indicador === 'orc_valor')!
    expect(emReais.metaEmDinheiro).toBeNull()
  })
})
