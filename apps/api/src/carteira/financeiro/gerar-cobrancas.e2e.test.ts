import type { Relogio } from '@fir/domain'
import type { UsuarioDeGestaoPublico } from '@fir/contracts'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BancoService } from '../../banco/banco.service'
import { apagarClinicaDeTeste, declararAtorSistema } from '../../banco/limpeza-de-teste'
import { BeneficiosDeIndicacaoService } from './beneficios.service'
import { executarGeracaoDeCobrancas } from './gerar-cobrancas'

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
  clinicaId: string,
  mensalidadeCentavos: number,
  status: 'onboarding' | 'ativo' = 'ativo',
) =>
  (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status, mensalidade_centavos)
       VALUES ($1, $2, 'Cliente de teste', 'Consultoria', $3, $4) RETURNING id`,
      [grupoId, clinicaId, status, mensalidadeCentavos],
    )
  ).rows[0]!.id

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[gerar-cobrancas] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)
  banco = new BancoService()

  grupoA = await novoGrupo(`Grupo A ${codigo}`)
  clinicaA = await novaClinica('A')
  clienteA = await novoCliente(grupoA, clinicaA, 185033) // R$ 1.850,33 — o exemplo do ADR 0015

  grupoB = await novoGrupo(`Grupo B ${codigo}`)
  clinicaB = await novaClinica('B — Onboarding')
  clienteOnboarding = await novoCliente(grupoB, clinicaB, 99900, 'onboarding')
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM beneficios_de_indicacao WHERE cliente_carteira_id = ANY($1)', [
    [clienteA, clienteOnboarding],
  ])
  await migrate.query('DELETE FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = ANY($1)', [
    [clienteA, clienteOnboarding],
  ])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [[clienteA, clienteOnboarding]])
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  await apagarClinicaDeTeste(migrate, clinicaA)
  await apagarClinicaDeTeste(migrate, clinicaB)
  await migrate.end()
  await banco.onModuleDestroy()
})

const cobrancaDe = async (clienteId: string, competencia = COMPETENCIA) =>
  (
    await migrate.query(
      `SELECT * FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = $1 AND competencia = $2`,
      [clienteId, competencia],
    )
  ).rows[0]

describe('executarGeracaoDeCobrancas — G3', () => {
  it('gera uma Cobrança só para o Cliente Firmare ATIVO, com snapshot da mensalidade', async () => {
    const resumo = await executarGeracaoDeCobrancas(banco, relogio, COMPETENCIA)
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

    expect(await cobrancaDe(clienteOnboarding)).toBeUndefined()
  })

  it('SNAPSHOT (critério 2.2.8): mudar a mensalidade depois não reescreve a cobrança já gerada', async () => {
    await migrate.query('UPDATE clientes_carteira SET mensalidade_centavos = 310000 WHERE id = $1', [clienteA])
    try {
      const antes = await cobrancaDe(clienteA)
      expect(antes.mensalidade_centavos).toBe('185033')

      // Rodar de novo para a MESMA competência não toca a linha existente.
      const resumo = await executarGeracaoDeCobrancas(banco, relogio, COMPETENCIA)
      expect(resumo.geradas).toBe(0) // nada NOVO foi gerado — já existia.

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
      const resumo = await executarGeracaoDeCobrancas(banco, relogio, COMPETENCIA)
      expect(resumo.geradas).toBe(0)
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
    await migrate.query('DELETE FROM clientes_carteira WHERE id = $1', [clienteC])
    await apagarClinicaDeTeste(migrate, clinicaC)
  })

  it('aplica o desconto na PRIMEIRA cobrança gerada, com o par exato do ADR 0015', async () => {
    const resumo = await executarGeracaoDeCobrancas(banco, relogio, COMPETENCIA_C)
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
    await executarGeracaoDeCobrancas(banco, relogio, COMPETENCIA_C)
    await executarGeracaoDeCobrancas(banco, relogio, COMPETENCIA_C)

    const depois = await migrate.query(
      `SELECT consumido_em, cobranca_id FROM beneficios_de_indicacao WHERE cliente_carteira_id = $1`,
      [clienteC],
    )
    expect(depois.rows.length).toBe(1) // nunca duplica o benefício em si
    expect(depois.rows[0].cobranca_id).toBe(cobrancaIdDoConsumo) // sempre a MESMA cobrança

    // E uma eventual competência NOVA não reaproveita um benefício já consumido.
    const resumoJaneiro = await executarGeracaoDeCobrancas(banco, relogio, '2027-01-01')
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
  const comClienteAtivo = async <T>(fn: () => Promise<T>): Promise<T> => {
    await migrate.query(`UPDATE clientes_carteira SET status = 'ativo' WHERE id = $1`, [clienteD])
    try {
      return await fn()
    } finally {
      await migrate.query(`UPDATE clientes_carteira SET status = 'onboarding' WHERE id = $1`, [clienteD])
    }
  }

  beforeAll(async () => {
    servico = new BeneficiosDeIndicacaoService(banco)
    clinicaD = await novaClinica('D — Rota de verdade')
    clienteD = await novoCliente(grupoA, clinicaD, 185033, 'onboarding')
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

    const resumo = await comClienteAtivo(() => executarGeracaoDeCobrancas(banco, relogio, COMPETENCIA_D))
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
    await comClienteAtivo(() => executarGeracaoDeCobrancas(banco, relogio, COMPETENCIA_D))
    const contagem = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM cobrancas_do_cliente_firmare
        WHERE cliente_carteira_id = $1 AND competencia = $2`,
      [clienteD, COMPETENCIA_D],
    )
    expect(contagem.rows[0]!.n).toBe('1')
  })
})
