import type { Relogio } from '@fir/domain'
import type { UsuarioDeGestaoPublico } from '@fir/contracts'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BancoService } from '../../banco/banco.service'
import { apagarClinicaDeTeste, declararAtorSistema } from '../../banco/limpeza-de-teste'
import { BeneficiosDeIndicacaoService } from './beneficios.service'
import { executarGeracaoDeCobrancas } from './gerar-cobrancas'
import { CobrancaCarteiraNaoEncontrada, CobrancasCarteiraService } from './cobrancas.service'
import { perfilPadraoDoBanco } from '../perfil-do-usuario-de-gestao'

/**
 * **G3 — O JOB DE `cobrancas_do_cliente_firmare`, contra Postgres real.** ADR
 * 0015.
 *
 * O que este arquivo prova, item a item do veredito do gate de números:
 *
 *  1. Gera exatamente UMA `Cobrança` por `(cliente, competência)`, só para
 *     `Cliente Firmare` ATIVO.
 *  2. **SNAPSHOT (critério 2.2.8):** mudar a mensalidade DEPOIS de gerar não
 *     reescreve a cobrança já gerada.
 *  3. **IDEMPOTÊNCIA POR VALOR, não só por contagem (achado 2, ADR 0015):**
 *     gerar, mudar a mensalidade, gerar mais duas vezes no mesmo dia — a
 *     linha continua tendo o valor da PRIMEIRA geração.
 *  4. **ATOMICIDADE benefício × cobrança (achado 3, ADR 0015):** um
 *     `Benefício de indicação` de uso único é consumido EXATAMENTE uma vez,
 *     mesmo rodando o job três vezes — nunca duas, nunca zero.
 *  5. **O gap do code-review:** um `Benefício de indicação` criado pela ROTA
 *     DE VERDADE (`BeneficiosDeIndicacaoService.criar`, não SQL cru) é
 *     consumido pelo job exatamente como o inserido por SQL cru no describe
 *     acima — mesma garantia, agora exercitando `apps/api` de ponta a ponta.
 *     Este describe vive NESTE arquivo, e não num arquivo próprio, de
 *     propósito: `executarGeracaoDeCobrancas` varre TODO `Cliente Firmare`
 *     ATIVO do banco, GLOBALMENTE, sem filtrar por grupo — um `Cliente
 *     Firmare` ativo num ARQUIVO diferente, rodando em paralelo (Vitest roda
 *     arquivos de `apps/api` em paralelo por padrão — ver o comentário em
 *     `banco.service.test.ts`), seria varrido pelas asserções ESTRITAS
 *     (`toBe(0)`) dos describes acima e as quebraria com um `geradas` que não
 *     é delas. Medido ao vivo nesta máquina. Dentro do MESMO arquivo os
 *     describes rodam em sequência, então isto nunca acontece aqui.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const codigo = `gerar-cobrancas-${Date.now()}`
const COMPETENCIA = '2026-11-01'
const relogio: Relogio = { agora: () => new Date('2026-11-15T12:00:00.000Z') }

let migrate: pg.Client
let banco: BancoService
let grupoA: string
let clinicaA: string
let clienteA: string
let grupoB: string
let clinicaB: string
let clienteOnboarding: string

const novoGrupo = async (nome: string) =>
  (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [nome])).rows[0]!.id

const novaClinica = async (nome: string) =>
  (
    await migrate.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id`, [
      `${codigo}-${nome}`,
      nome,
    ])
  ).rows[0]!.id

const novoCliente = async (
  grupoId: string,
  clinicaId: string | null,
  mensalidadeCentavos: number,
  status: 'onboarding' | 'ativo' | 'pausado' | 'encerrado' = 'ativo',
  diaVencimento: number | null = 10,
  nome = 'Cliente de teste',
) =>
  (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status, mensalidade_centavos, dia_vencimento)
       VALUES ($1, $2, $3, 'Consultoria', $4, $5, $6) RETURNING id`,
      [grupoId, clinicaId, nome, status, mensalidadeCentavos, diaVencimento],
    )
  ).rows[0]!.id

/**
 * A varredura do job restrita aos grupos DESTE arquivo (`soDosGrupos`). Desde
 * o 1F o job também cobra `onboarding`, e quase todo arquivo da carteira cria
 * clientes `onboarding`: uma varredura global, em paralelo, escreveria
 * cobranças nos clientes deles (D16).
 */
const gruposDoArquivo: string[] = []
const gerar = (rel: Relogio, competencia?: string) =>
  executarGeracaoDeCobrancas(banco, rel, competencia, gruposDoArquivo)

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[gerar-cobrancas] migrate:', e.message))
  await migrate.connect()
  // TRAVA COMPARTILHADA com o outro arquivo de job da carteira (D16). Os dois
  // jobs varrem TODO `Cliente Firmare` ativo do banco, e em paralelo cada um
  // escrevia para os clientes do outro: contagem errada e limpeza abortada por
  // FK. A trava é de SESSÃO nesta conexão — o outro arquivo espera aqui até
  // `migrate.end()` soltá-la. Serializa só estes dois, não a suíte inteira.
  await migrate.query("SELECT pg_advisory_lock(hashtext('teste:jobs-da-carteira'))")
  await declararAtorSistema(migrate)
  banco = new BancoService()

  grupoA = await novoGrupo(`Grupo A ${codigo}`)
  clinicaA = await novaClinica('A')
  clienteA = await novoCliente(grupoA, clinicaA, 185033) // R$ 1.850,33 — o exemplo do ADR 0015

  grupoB = await novoGrupo(`Grupo B ${codigo}`)
  clinicaB = await novaClinica('B — Onboarding')
  clienteOnboarding = await novoCliente(grupoB, clinicaB, 99900, 'onboarding')
  gruposDoArquivo.push(grupoA, grupoB)
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM beneficios_de_indicacao WHERE cliente_carteira_id = ANY($1)', [
    [clienteA, clienteOnboarding],
  ])
  await migrate.query('DELETE FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = ANY($1)', [
    [clienteA, clienteOnboarding],
  ])
  // O job do OUTRO arquivo (rodando em paralelo, D16) também escreve para
  // estes clientes; sem limpar as duas tabelas, a FK aborta a limpeza e o
  // resíduo contamina a próxima execução.
  for (const t of ['uso_diario_cliente', 'cobrancas_do_cliente_firmare']) {
    await migrate.query(`DELETE FROM ${t} WHERE cliente_carteira_id = ANY($1)`, [[clienteA, clienteOnboarding]])
  }
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [[clienteA, clienteOnboarding]])
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  await apagarClinicaDeTeste(migrate, clinicaA)
  await apagarClinicaDeTeste(migrate, clinicaB)
  await migrate.end()
  await banco.onModuleDestroy()
})

/** O vencimento como dia civil — `::text`, nunca o `Date` que o driver monta no fuso da máquina. */
const vencimentoDe = async (clienteId: string, competencia = COMPETENCIA) =>
  (
    await migrate.query<{ v: string }>(
      `SELECT vencimento::text AS v FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = $1 AND competencia = $2`,
      [clienteId, competencia],
    )
  ).rows[0]?.v

const cobrancaDe = async (clienteId: string, competencia = COMPETENCIA) =>
  (
    await migrate.query(
      `SELECT * FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = $1 AND competencia = $2`,
      [clienteId, competencia],
    )
  ).rows[0]

describe('executarGeracaoDeCobrancas — G3', () => {
  it('gera uma Cobrança para ATIVO e ONBOARDING com vencimento (PP-4), com snapshot e vencimento no dia do cliente', async () => {
    const resumo = await gerar(relogio, COMPETENCIA)
    expect(resumo.falhas).toEqual([])
    // `>= 1`, não `=== 1`: o banco de desenvolvimento pode ter outros
    // `Cliente Firmare` ATIVO sem cobrança desta competência ainda — o que
    // importa é a linha do `clienteA`, conferida abaixo.
    expect(resumo.geradas).toBeGreaterThanOrEqual(1)

    const linha = await cobrancaDe(clienteA)
    expect(linha).toBeDefined()
    expect(linha.mensalidade_centavos).toBe('185033')
    expect(linha.desconto_centavos).toBe('0')
    expect(linha.valor_centavos).toBe('185033')
    expect(linha.status).toBe('aberto')
    expect(await vencimentoDe(clienteA)).toBe('2026-11-10') // dia 10 do cliente

    const onboarding = await cobrancaDe(clienteOnboarding)
    expect(onboarding.valor_centavos).toBe('99900')
  })

  it('SNAPSHOT (critério 2.2.8): mudar a mensalidade depois não reescreve a cobrança já gerada', async () => {
    await migrate.query('UPDATE clientes_carteira SET mensalidade_centavos = 310000 WHERE id = $1', [clienteA])
    try {
      const antes = await cobrancaDe(clienteA)
      expect(antes.mensalidade_centavos).toBe('185033')

      // Rodar de novo para a MESMA competência não toca a linha existente.
      // Sem `expect(resumo.geradas).toBe(0)`: o total é GLOBAL (D16), e o
      // arquivo de uso diário, em paralelo, cria clientes ativos que este job
      // varre. A prova que importa é a deste cliente, logo abaixo.
      await gerar(relogio, COMPETENCIA)

      const depois = await cobrancaDe(clienteA)
      expect(depois.mensalidade_centavos).toBe('185033')
      expect(depois.valor_centavos).toBe('185033')
    } finally {
      await migrate.query('UPDATE clientes_carteira SET mensalidade_centavos = 185033 WHERE id = $1', [clienteA])
    }
  })

  it('IDEMPOTÊNCIA POR VALOR (achado 2, ADR 0015): rodar 3x no mesmo dia não duplica NEM MUDA o valor', async () => {
    const umaVez = await cobrancaDe(clienteA)

    for (let i = 0; i < 2; i++) {
      await migrate.query('UPDATE clientes_carteira SET mensalidade_centavos = 999999 WHERE id = $1', [clienteA])
      // A contagem e o valor DESTE cliente, abaixo, são a prova — não o
      // `geradas` global, que inclui clientes de outro arquivo em paralelo (D16).
      await gerar(relogio, COMPETENCIA)
    }
    await migrate.query('UPDATE clientes_carteira SET mensalidade_centavos = 185033 WHERE id = $1', [clienteA])

    const contagem = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = $1 AND competencia = $2`,
      [clienteA, COMPETENCIA],
    )
    expect(contagem.rows[0]!.n).toBe('1') // nunca duplica

    const depois = await cobrancaDe(clienteA)
    expect(depois).toEqual(umaVez) // e o VALOR não mudou — não só a contagem
  })
})

describe('executarGeracaoDeCobrancas — ATOMICIDADE benefício × cobrança (achado 3, ADR 0015)', () => {
  let clinicaC: string
  let clienteC: string
  const COMPETENCIA_C = '2026-12-01'

  beforeAll(async () => {
    clinicaC = await novaClinica('C — Benefício')
    clienteC = await novoCliente(grupoA, clinicaC, 185033)
    await migrate.query(
      `INSERT INTO beneficios_de_indicacao (cliente_carteira_id, grupo_id, percentual_centesimos, motivo)
       VALUES ($1, $2, 1000, 'indicação de teste')`,
      [clienteC, grupoA],
    )
  })

  afterAll(async () => {
    // As duas tabelas se referenciam (`cobrancas.beneficio_id` →
    // `beneficios.id`, e `beneficios.cobranca_id` → `cobrancas.id`) — é um
    // ciclo, e nenhuma ordem de DELETE o resolve sozinha. Desfaz os DOIS
    // lados primeiro, depois apaga em qualquer ordem.
    await migrate.query('UPDATE cobrancas_do_cliente_firmare SET beneficio_id = NULL WHERE cliente_carteira_id = $1', [
      clienteC,
    ])
    await migrate.query(
      'UPDATE beneficios_de_indicacao SET cobranca_id = NULL, consumido_em = NULL WHERE cliente_carteira_id = $1',
      [clienteC],
    )
    await migrate.query('DELETE FROM beneficios_de_indicacao WHERE cliente_carteira_id = $1', [clienteC])
    await migrate.query(
      `DELETE FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = ANY($1)`,
      [[clienteA, clienteC]],
    )
    // O job do OUTRO arquivo (rodando em paralelo, D16) também escreve para
    // estes clientes; sem limpar as duas tabelas, a FK aborta a limpeza e o
    // resíduo contamina a próxima execução.
    for (const t of ['uso_diario_cliente', 'cobrancas_do_cliente_firmare']) {
      await migrate.query(`DELETE FROM ${t} WHERE cliente_carteira_id = $1`, [clienteC])
    }
    await migrate.query('DELETE FROM clientes_carteira WHERE id = $1', [clienteC])
    await apagarClinicaDeTeste(migrate, clinicaC)
  })

  it('aplica o desconto na PRIMEIRA cobrança gerada, com o par exato do ADR 0015', async () => {
    const resumo = await gerar(relogio, COMPETENCIA_C)
    expect(resumo.falhas).toEqual([])
    // `>= 1`, não `=== 1`: `clienteA` (ativo, do describe anterior) também
    // ainda não tem cobrança de dezembro, então ele gera junto — o que
    // importa aqui é a linha do `clienteC`, conferida abaixo.
    expect(resumo.geradas).toBeGreaterThanOrEqual(1)

    const linha = await cobrancaDe(clienteC, COMPETENCIA_C)
    expect(linha.mensalidade_centavos).toBe('185033')
    expect(linha.desconto_centavos).toBe('18504')
    expect(linha.valor_centavos).toBe('166529')
    expect(linha.beneficio_id).not.toBeNull()
  })

  it('o benefício foi consumido EXATAMENTE uma vez, mesmo rodando o job mais duas vezes', async () => {
    const beneficio = await migrate.query(
      `SELECT consumido_em, cobranca_id FROM beneficios_de_indicacao WHERE cliente_carteira_id = $1`,
      [clienteC],
    )
    expect(beneficio.rows[0].consumido_em).not.toBeNull()
    const cobrancaIdDoConsumo = beneficio.rows[0].cobranca_id

    // Rodar mais duas vezes: a cobrança de dezembro já existe (ON CONFLICT DO
    // NOTHING), então nenhuma nova tentativa de consumir o benefício acontece.
    await gerar(relogio, COMPETENCIA_C)
    await gerar(relogio, COMPETENCIA_C)

    const depois = await migrate.query(
      `SELECT consumido_em, cobranca_id FROM beneficios_de_indicacao WHERE cliente_carteira_id = $1`,
      [clienteC],
    )
    expect(depois.rows.length).toBe(1) // nunca duplica o benefício em si
    expect(depois.rows[0].cobranca_id).toBe(cobrancaIdDoConsumo) // sempre a MESMA cobrança

    // E uma eventual competência NOVA não reaproveita um benefício já consumido.
    const resumoJaneiro = await gerar(relogio, '2027-01-01')
    expect(resumoJaneiro.falhas).toEqual([])
    const linhaJaneiro = await cobrancaDe(clienteC, '2027-01-01')
    expect(linhaJaneiro.desconto_centavos).toBe('0')
    expect(linhaJaneiro.valor_centavos).toBe('185033')
    await migrate.query(
      `DELETE FROM cobrancas_do_cliente_firmare WHERE competencia = '2027-01-01' AND cliente_carteira_id = ANY($1)`,
      [[clienteA, clienteC]],
    )
  })
})

describe('BeneficiosDeIndicacaoService.criar — consumo pelo job (gap do code-review)', () => {
  let servico: BeneficiosDeIndicacaoService
  let clinicaD: string
  let clienteD: string
  let usuario: UsuarioDeGestaoPublico
  const COMPETENCIA_D = '2027-02-01'

  // Janela de `ativo` a mais estreita possível — `executarUsoDiarioCliente`
  // (G4) tem a MESMA varredura global `WHERE status = 'ativo'`, sem filtro
  // por grupo, que `executarGeracaoDeCobrancas` já tem — um cliente ativo
  // pela vida INTEIRA deste `describe` seria varrido por aquele job também,
  // rodando em paralelo noutro arquivo, incrementando o `processados` dele.
  // Medido ao vivo nesta máquina.
  // Desde o 1F, `onboarding` também é cobrado: o que tira o cliente da
  // varredura dos describes acima é a FALTA de dia de vencimento.
  const comClienteAtivo = async <T>(fn: () => Promise<T>): Promise<T> => {
    await migrate.query(`UPDATE clientes_carteira SET status = 'ativo', dia_vencimento = 10 WHERE id = $1`, [clienteD])
    try {
      return await fn()
    } finally {
      await migrate.query(
        `UPDATE clientes_carteira SET status = 'onboarding', dia_vencimento = NULL WHERE id = $1`,
        [clienteD],
      )
    }
  }

  beforeAll(async () => {
    servico = new BeneficiosDeIndicacaoService(banco)
    clinicaD = await novaClinica('D — Rota de verdade')
    clienteD = await novoCliente(grupoA, clinicaD, 185033, 'onboarding', null)
    // `usuario` tem CHECK de até 32 caracteres (`usuarios_gestao_usuario_canonico`,
    // migration 0025) — `codigo` (prefixo deste arquivo) sozinho já passa
    // disso, daí um nome CURTO e próprio aqui.
    const nomeDeUsuario = `ben-${Date.now()}`
    const usuarioGestaoId = (
      await migrate.query<{ id: string }>(
        `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, 'Teste', 'x', 'grupo', $2) RETURNING id`,
        [nomeDeUsuario, grupoA],
      )
    ).rows[0]!.id
    usuario = {
      id: usuarioGestaoId,
      usuario: nomeDeUsuario,
      nome: 'Teste',
      escopo: 'grupo',
      grupoId: grupoA,
      senhaProvisoria: false,
      ...perfilPadraoDoBanco('grupo'),
    }
  })

  afterAll(async () => {
    await migrate.query('UPDATE cobrancas_do_cliente_firmare SET beneficio_id = NULL WHERE cliente_carteira_id = $1', [
      clienteD,
    ])
    await migrate.query(
      'DELETE FROM auditoria_da_carteira WHERE registro_id IN (SELECT id FROM beneficios_de_indicacao WHERE cliente_carteira_id = $1)',
      [clienteD],
    )
    await migrate.query('DELETE FROM beneficios_de_indicacao WHERE cliente_carteira_id = $1', [clienteD])
    await migrate.query('DELETE FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = $1', [clienteD])
    await migrate.query('DELETE FROM usuarios_gestao WHERE id = $1', [usuario.id])
    // O job do OUTRO arquivo (rodando em paralelo, D16) também escreve para
    // estes clientes; sem limpar as duas tabelas, a FK aborta a limpeza e o
    // resíduo contamina a próxima execução.
    for (const t of ['uso_diario_cliente', 'cobrancas_do_cliente_firmare']) {
      await migrate.query(`DELETE FROM ${t} WHERE cliente_carteira_id = $1`, [clienteD])
    }
    await migrate.query('DELETE FROM clientes_carteira WHERE id = $1', [clienteD])
    await apagarClinicaDeTeste(migrate, clinicaD)
  })

  it('um Benefício criado pela rota de verdade é consumido EXATAMENTE uma vez pelo job', async () => {
    const beneficio = await servico.criar(usuario, {
      clienteCarteiraId: clienteD,
      percentualCentesimos: 1000n,
      motivo: 'indicação — fluxo de consumo',
    })
    expect(beneficio.consumidoEm).toBeNull()
    expect(beneficio.cobrancaId).toBeNull()

    const auditoria = await migrate.query<{ acao: string }>(
      `SELECT acao FROM auditoria_da_carteira WHERE tabela = 'beneficios_de_indicacao' AND registro_id = $1`,
      [beneficio.id],
    )
    expect(auditoria.rows).toEqual([{ acao: 'criar' }])

    const resumo = await comClienteAtivo(() => gerar(relogio, COMPETENCIA_D))
    expect(resumo.falhas).toEqual([])
    // `>= 1`, mesma razão dos describes acima: outros `Cliente Firmare`
    // ativos do arquivo também não têm cobrança desta competência nova ainda.
    expect(resumo.geradas).toBeGreaterThanOrEqual(1)

    const linha = await cobrancaDe(clienteD, COMPETENCIA_D)
    expect(linha.mensalidade_centavos).toBe('185033')
    expect(linha.desconto_centavos).toBe('18504') // mesmo par exato do ADR 0015
    expect(linha.valor_centavos).toBe('166529')
    expect(linha.beneficio_id).toBe(beneficio.id)

    const depois = await migrate.query<{ consumido_em: Date | null; cobranca_id: string | null }>(
      `SELECT consumido_em, cobranca_id FROM beneficios_de_indicacao WHERE id = $1`,
      [beneficio.id],
    )
    expect(depois.rows[0]!.consumido_em).not.toBeNull()
    expect(depois.rows[0]!.cobranca_id).toBe(linha.id)

    // Rodar de novo não duplica a cobrança nem consome um segundo benefício.
    await comClienteAtivo(() => gerar(relogio, COMPETENCIA_D))
    const contagem = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM cobrancas_do_cliente_firmare
        WHERE cliente_carteira_id = $1 AND competencia = $2`,
      [clienteD, COMPETENCIA_D],
    )
    expect(contagem.rows[0]!.n).toBe('1')
  })
})

/**
 * Gate de números do G8 — CE-1, T-12 e T-14 (`docs/specs/g8-gate-numeros.md`).
 *
 * CE-1: `mensalidade_centavos = 0` é o padrão da coluna (0031) e não há rota
 * para editá-la; o job gerava uma cobrança de R$ 0 e QUEIMAVA o benefício
 * nela. Na prática, todo benefício criado era consumido na primeira rodada.
 */
describe('gate de números G8 — CE-1, T-12, T-14', () => {
  let clinicaE: string
  let clienteE: string
  let beneficioE: string
  const COMPETENCIA_ZERO = '2027-03-01'
  const COMPETENCIA_POSITIVA = '2027-04-01'

  // Mesma razão do describe anterior: `ativo` só durante a rodada do job.
  const comClienteAtivo = async <T>(fn: () => Promise<T>): Promise<T> => {
    await migrate.query(`UPDATE clientes_carteira SET status = 'ativo' WHERE id = $1`, [clienteE])
    try {
      return await fn()
    } finally {
      await migrate.query(`UPDATE clientes_carteira SET status = 'onboarding' WHERE id = $1`, [clienteE])
    }
  }

  beforeAll(async () => {
    clinicaE = await novaClinica('E — Mensalidade zero')
    clienteE = await novoCliente(grupoA, clinicaE, 0, 'onboarding')
    beneficioE = (
      await migrate.query<{ id: string }>(
        `INSERT INTO beneficios_de_indicacao (cliente_carteira_id, grupo_id, percentual_centesimos, motivo)
         VALUES ($1, $2, 1000, 'CE-1') RETURNING id`,
        [clienteE, grupoA],
      )
    ).rows[0]!.id
  })

  afterAll(async () => {
    await migrate.query('UPDATE cobrancas_do_cliente_firmare SET beneficio_id = NULL WHERE cliente_carteira_id = $1', [
      clienteE,
    ])
    await migrate.query(
      'UPDATE beneficios_de_indicacao SET cobranca_id = NULL, consumido_em = NULL WHERE cliente_carteira_id = $1',
      [clienteE],
    )
    await migrate.query('DELETE FROM beneficios_de_indicacao WHERE cliente_carteira_id = $1', [clienteE])
    for (const t of ['uso_diario_cliente', 'cobrancas_do_cliente_firmare']) {
      await migrate.query(`DELETE FROM ${t} WHERE cliente_carteira_id = $1`, [clienteE])
    }
    await migrate.query('DELETE FROM clientes_carteira WHERE id = $1', [clienteE])
    await apagarClinicaDeTeste(migrate, clinicaE)
  })

  const estadoDoBeneficio = async () =>
    (
      await migrate.query<{ consumido_em: Date | null; cobranca_id: string | null }>(
        'SELECT consumido_em, cobranca_id FROM beneficios_de_indicacao WHERE id = $1',
        [beneficioE],
      )
    ).rows[0]!

  it('CE-1: cliente ativo com mensalidade 0 e benefício pendente não gera cobrança e não consome o benefício', async () => {
    const resumo = await comClienteAtivo(() => gerar(relogio, COMPETENCIA_ZERO))
    expect(resumo.falhas).toEqual([])
    expect(await cobrancaDe(clienteE, COMPETENCIA_ZERO)).toBeUndefined()
    expect(await estadoDoBeneficio()).toEqual({ consumido_em: null, cobranca_id: null })
  })

  it('T-12: três rodadas com mensalidade 0, depois uma positiva — o benefício é consumido uma vez, na positiva', async () => {
    for (let i = 0; i < 3; i++) {
      await comClienteAtivo(() => gerar(relogio, COMPETENCIA_ZERO))
    }
    expect(await cobrancaDe(clienteE, COMPETENCIA_ZERO)).toBeUndefined()
    expect((await estadoDoBeneficio()).consumido_em).toBeNull()

    await migrate.query('UPDATE clientes_carteira SET mensalidade_centavos = 185033 WHERE id = $1', [clienteE])
    await comClienteAtivo(() => gerar(relogio, COMPETENCIA_POSITIVA))
    const linha = await cobrancaDe(clienteE, COMPETENCIA_POSITIVA)
    expect(linha.mensalidade_centavos).toBe('185033')
    expect(linha.desconto_centavos).toBe('18504') // ceilDiv(185033 · 1000, 10000)
    expect(linha.valor_centavos).toBe('166529')
    expect(linha.beneficio_id).toBe(beneficioE)
    const depois = await estadoDoBeneficio()
    expect(depois.consumido_em).not.toBeNull()
    expect(depois.cobranca_id).toBe(linha.id)

    const usos = await migrate.query(
      'SELECT 1 FROM cobrancas_do_cliente_firmare WHERE beneficio_id = $1',
      [beneficioE],
    )
    expect(usos.rows.length).toBe(1)
  })

  it('T-14: relógio em 2026-11-30T23:30-03:00 gera a competência de NOVEMBRO, nunca a de dezembro', async () => {
    // A mensalidade já é positiva (teste anterior). Sem `competenciaAlvo`: a
    // competência sai do relógio, no fuso da carteira. Em UTC já é 1º/12.
    const relogioDaVirada: Relogio = { agora: () => new Date('2026-11-30T23:30:00-03:00') }
    const resumo = await comClienteAtivo(() => gerar(relogioDaVirada))
    expect(resumo.falhas).toEqual([])
    expect(await cobrancaDe(clienteE, '2026-11-01')).toBeDefined()
    expect(await cobrancaDe(clienteE, '2026-12-01')).toBeUndefined()
  })
})

/**
 * **G8 1F — Mensalidades: o job diário e o painel do mês, ponta a ponta.**
 *
 * Cenário T-22 do gate de números, conferido à mão: A com R$ 1.000,00 no dia
 * 31 (ativo), B com R$ 1.850,33 no dia 10 e benefício de 10% (onboarding), C
 * com R$ 0,00. Em fevereiro de 2027: A vence 28/02, B é cobrado R$ 1.665,29
 * (desconto R$ 185,04), C não aparece. Total R$ 2.665,29; ao marcar A como
 * paga, recebido R$ 1.000,00 de R$ 2.665,29.
 *
 * Grupos PRÓPRIOS e varredura restrita a eles (`soDosGrupos`): nada daqui
 * depende do resto do banco, e nada do resto do banco depende daqui.
 */
describe('G8 1F — mensalidades: job diário, regra 25, painel, baixar pagos, isolamento', () => {
  const FEV = '2027-02-01'
  const relogioDoPainel: Relogio = { agora: () => new Date('2027-02-05T15:00:00.000Z') }
  let grupo1F: string
  let grupoX: string
  let A: string
  let B: string
  let C: string
  let pausado: string
  let encerrado: string
  let semDia: string
  let X: string
  let N: string | null = null
  let usuario1F: UsuarioDeGestaoPublico
  let usuarioX: UsuarioDeGestaoPublico
  let servico: CobrancasCarteiraService
  const gerar1F = (rel: Relogio, competencia?: string) =>
    executarGeracaoDeCobrancas(banco, rel, competencia, [grupo1F, grupoX])

  const novoUsuario = async (grupoId: string): Promise<UsuarioDeGestaoPublico> => {
    const nome = `m1f-${Math.random().toString(36).slice(2, 10)}`
    const id = (
      await migrate.query<{ id: string }>(
        `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, 'Teste', 'x', 'grupo', $2) RETURNING id`,
        [nome, grupoId],
      )
    ).rows[0]!.id
    return { id, usuario: nome, nome: 'Teste', escopo: 'grupo', grupoId, senhaProvisoria: false, ...perfilPadraoDoBanco('grupo') }
  }

  const todos = () => [A, B, C, pausado, encerrado, semDia, X, ...(N ? [N] : [])]

  beforeAll(async () => {
    grupo1F = await novoGrupo(`Grupo 1F ${codigo}`)
    grupoX = await novoGrupo(`Grupo X ${codigo}`)
    A = await novoCliente(grupo1F, null, 100000, 'ativo', 31, 'A — dia 31')
    B = await novoCliente(grupo1F, null, 185033, 'onboarding', 10, 'B — com benefício')
    C = await novoCliente(grupo1F, null, 0, 'ativo', 10, 'C — sem mensalidade')
    pausado = await novoCliente(grupo1F, null, 50000, 'pausado', 10, 'Pausado')
    encerrado = await novoCliente(grupo1F, null, 50000, 'encerrado', 10, 'Encerrado')
    semDia = await novoCliente(grupo1F, null, 50000, 'onboarding', null, 'Onboarding sem dia')
    X = await novoCliente(grupoX, null, 50000, 'ativo', 5, 'X — outro grupo')
    await migrate.query(
      `INSERT INTO beneficios_de_indicacao (cliente_carteira_id, grupo_id, percentual_centesimos, motivo)
       VALUES ($1, $2, 1000, 'T-22')`,
      [B, grupo1F],
    )
    usuario1F = await novoUsuario(grupo1F)
    usuarioX = await novoUsuario(grupoX)
    servico = new CobrancasCarteiraService(banco, relogioDoPainel)
  })

  afterAll(async () => {
    await declararAtorSistema(migrate)
    const ids = todos()
    await migrate.query('UPDATE cobrancas_do_cliente_firmare SET beneficio_id = NULL WHERE cliente_carteira_id = ANY($1)', [ids])
    await migrate.query('UPDATE beneficios_de_indicacao SET cobranca_id = NULL, consumido_em = NULL WHERE cliente_carteira_id = ANY($1)', [ids])
    await migrate.query('DELETE FROM beneficios_de_indicacao WHERE cliente_carteira_id = ANY($1)', [ids])
    await migrate.query('DELETE FROM auditoria_da_carteira WHERE grupo_id = ANY($1)', [[grupo1F, grupoX]])
    for (const t of ['uso_diario_cliente', 'cobrancas_do_cliente_firmare']) {
      await migrate.query(`DELETE FROM ${t} WHERE cliente_carteira_id = ANY($1)`, [ids])
    }
    await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [[usuario1F.id, usuarioX.id]])
    await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [ids])
    await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupo1F, grupoX]])
  })

  it('IDEMPOTÊNCIA ×3: três rodadas de fevereiro deixam uma cobrança por cliente e o benefício consumido uma vez', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await gerar1F(relogioDoPainel, FEV)
      expect(r.falhas).toEqual([])
      expect(r.geradas).toBe(i === 0 ? 3 : 0) // A, B e X; depois nada
    }
    const n = await migrate.query<{ cliente: string; n: string }>(
      `SELECT cliente_carteira_id AS cliente, count(*)::text AS n FROM cobrancas_do_cliente_firmare
        WHERE cliente_carteira_id = ANY($1) AND competencia = $2 GROUP BY 1`,
      [todos(), FEV],
    )
    expect(Object.fromEntries(n.rows.map((r) => [r.cliente, r.n]))).toEqual({ [A]: '1', [B]: '1', [X]: '1' })
    const usos = await migrate.query('SELECT 1 FROM beneficios_de_indicacao WHERE cliente_carteira_id = $1 AND consumido_em IS NOT NULL', [B])
    expect(usos.rows.length).toBe(1)
  })

  it('T-13 / PP-4: onboarding com vencimento gera; pausado, encerrado, onboarding sem dia e mensalidade 0 não', async () => {
    expect(await cobrancaDe(B, FEV)).toBeDefined()
    for (const id of [C, pausado, encerrado, semDia]) expect(await cobrancaDe(id, FEV)).toBeUndefined()
  })

  it('regra 25 no job: dia 31 vence 28/02/2027 e 29/02/2028 (bissexto); dia 10 vence 10/02', async () => {
    expect(await vencimentoDe(A, FEV)).toBe('2027-02-28')
    expect(await vencimentoDe(B, FEV)).toBe('2027-02-10')
    await gerar1F(relogioDoPainel, '2028-02-01')
    expect(await vencimentoDe(A, '2028-02-01')).toBe('2028-02-29')
    await migrate.query(`DELETE FROM cobrancas_do_cliente_firmare WHERE competencia = '2028-02-01' AND cliente_carteira_id = ANY($1)`, [todos()])
  })

  it('T-22: o painel de fevereiro, conferido à mão — total R$ 2.665,29, ticket só de quem tem mensalidade', async () => {
    const p = await servico.painel(usuario1F, '2027-02')
    expect(p.competencia).toBe(FEV)
    expect(p.hoje).toBe('2027-02-05')
    expect(p.mensalidades.map((m) => [m.clienteNome, m.vencimento, m.mensalidade, m.desconto, m.valor, m.situacao])).toEqual([
      ['B — com benefício', '2027-02-10', '185033', '18504', '166529', 'a_vencer'],
      ['A — dia 31', '2027-02-28', '100000', '0', '100000', 'a_vencer'],
    ])
    expect(p.totais).toEqual({ somaValor: '266529', recebido: '0', aReceber: '266529' })
    // MRR dos contratos atuais do grupo (ativo + onboarding, §3.2 — o dia de
    // vencimento não entra): A 100000 + B 185033 + "onboarding sem dia" 50000
    // + C 0 = 335033. Pausado e encerrado fora. Ticket = 335033 / 3 (C, sem
    // mensalidade, fora do denominador — D-22 item 12) = 111677,67 → 111678.
    expect(p.recorrente).toEqual({ receita: '335033', ticketMedio: '111678', clientesComMensalidade: 3 })
    expect(p.mesesComCobranca).toContain('2027-02')
  })

  it('BAIXAR PAGOS ×2: marca A uma vez só — recebido R$ 1.000,00 de R$ 2.665,29, pago_em e trilha não duplicam', async () => {
    const antes = await servico.painel(usuario1F, '2027-02')
    const idA = antes.mensalidades.find((m) => m.clienteCarteiraId === A)!.id

    const um = await servico.baixarPagos(usuario1F, [idA])
    expect(um.marcadasAgora).toBe(1)
    const pagoEm = um.cobrancas[0]!.pagoEm
    expect(pagoEm).not.toBeNull()

    const dois = await servico.baixarPagos(usuario1F, [idA, idA])
    expect(dois.marcadasAgora).toBe(0)
    expect(dois.cobrancas).toHaveLength(1)
    expect(dois.cobrancas[0]!.pagoEm).toBe(pagoEm) // nunca reescreve o pagamento

    const trilha = await migrate.query(
      `SELECT 1 FROM auditoria_da_carteira WHERE registro_id = $1 AND acao = 'marcar_pago'`,
      [idA],
    )
    expect(trilha.rows.length).toBe(1)

    const p = await servico.painel(usuario1F, '2027-02')
    expect(p.totais).toEqual({ somaValor: '266529', recebido: '100000', aReceber: '166529' })
    const a = p.mensalidades.find((m) => m.clienteCarteiraId === A)!
    expect(a.situacao).toBe('paga')
    expect(a.pagoNoDia).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const somaPorSituacao = p.porSituacao.reduce((s, x) => s + BigInt(x.valor!), 0n)
    expect(somaPorSituacao).toBe(266529n)
  })

  it('ISOLAMENTO: o grupo X não vê nem baixa as mensalidades do grupo 1F — e um lote misto não grava nada', async () => {
    const px = await servico.painel(usuarioX, '2027-02')
    expect(px.mensalidades.map((m) => m.clienteCarteiraId)).toEqual([X])
    expect(px.recorrente).toEqual({ receita: '50000', ticketMedio: '50000', clientesComMensalidade: 1 })

    const p1 = await servico.painel(usuario1F, '2027-02')
    expect(p1.mensalidades.some((m) => m.clienteCarteiraId === X)).toBe(false)
    const idB = p1.mensalidades.find((m) => m.clienteCarteiraId === B)!.id
    const idX = px.mensalidades[0]!.id

    await expect(servico.baixarPagos(usuarioX, [idB])).rejects.toBeInstanceOf(CobrancaCarteiraNaoEncontrada)
    await expect(servico.baixarPagos(usuarioX, [idX, idB])).rejects.toBeInstanceOf(CobrancaCarteiraNaoEncontrada)
    const estados = await migrate.query<{ id: string; status: string }>(
      'SELECT id, status FROM cobrancas_do_cliente_firmare WHERE id = ANY($1) ORDER BY id',
      [[idB, idX]],
    )
    expect(estados.rows.every((r) => r.status === 'aberto')).toBe(true)
  })

  it('MÊS DE ENTRADA, job diário: quem entra no dia 12 com vencimento no dia 5 é cobrado no mesmo mês, e já aparece vencida', async () => {
    N = await novoCliente(grupo1F, null, 70000, 'ativo', 5, 'N — entrou no dia 12')
    const dia12: Relogio = { agora: () => new Date('2027-02-12T15:00:00.000Z') }
    const r = await gerar1F(dia12) // sem competência: sai do relógio, no fuso da carteira
    expect(r.falhas).toEqual([])
    expect(r.geradas).toBe(1) // só N; A, B e X já tinham fevereiro
    expect(await vencimentoDe(N, FEV)).toBe('2027-02-05')

    const p = await new CobrancasCarteiraService(banco, dia12).painel(usuario1F, undefined)
    expect(p.competencia).toBe(FEV) // sem mês: o corrente, no fuso da carteira
    const n = p.mensalidades.find((m) => m.clienteCarteiraId === N)!
    expect(n).toMatchObject({ situacao: 'vencida', dias: -7, valor: '70000' })
    expect(p.totais.somaValor).toBe('336529')
  })
})
