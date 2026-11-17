import type { IndicadoresDaClinicaNaCarteiraSaida } from '@fir/contracts'
import type { Relogio } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { BancoService } from '../../banco/banco.service'
import {
  apagarClinicaDeTeste,
  apagarHistoricoGrupoDeTeste,
  declararAtorSistema,
  participarDoGrupoDeTeste,
} from '../../banco/limpeza-de-teste'
import { registrarCookie } from '../../main'
import { executarUsoDiarioCliente } from '../jobs/uso-diario-cliente'

/**
 * **T10 — `kpis_na_carteira`: o job e a leitura, contra Postgres real e pela
 * HTTP inteira** (`AppModule`: `CarteiraGuard`, `RedacaoInterceptor`, RLS).
 *
 *  - `carteira-sem-valores-null` (C28): sem `valores`, `emDinheiro` sai `null`
 *    e a razão "despesas fixas sobre o recebido" some;
 *  - `carteira-grupo-b-zero` (C28): o grupo B lê zero linhas, e a ficha 404;
 *  - `carteira-desvinculada-sem-linha` (C28): no dia seguinte ao desvínculo,
 *    nenhuma linha nova;
 *  - `carteira-pessoas-sem-valor` (L-IN-18): valor e alvo nulos no pilar
 *    Pessoas, e nenhuma coluna de pessoa na tabela;
 *  - `kpi-rh-some-sem-pessoas-gerir` (C5): os KPIs de RH nunca atravessam;
 *  - `job-nao-cruza-clinica` (C26): cada cliente só recebe KPI da própria clínica;
 *  - três rodadas idempotentes (regra 26).
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')

/** Quinta, 12/11/2026, 12h em Salvador. O "hoje" da clínica é 12/11. */
const AGORA = new Date('2026-11-12T15:00:00.000Z')
const AMANHA = new Date('2026-11-13T15:00:00.000Z')
const relogio = (d: Date): Relogio => ({ agora: () => d })

let app: NestFastifyApplication
let migrate: pg.Client
let banco: BancoService

let grupoA: string
let grupoB: string
let clinicaA: string
let clinicaB: string
let clinicaC: string
let clienteA: string
let clienteB: string
let clienteC: string
const kpisDeA: Record<'fin' | 'pes' | 'rh' | 'desp', string> = { fin: '', pes: '', rh: '', desp: '' }
let kpiDeB: string
let kpiDeC: string
const usuarios: string[] = []
const cookie: Record<string, string> = {}

const novaClinica = async (nome: string, fuso: string): Promise<string> =>
  (
    await migrate.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, $2, $3) RETURNING id`, [
      `kpis-carteira-${sufixo}-${nome}`,
      nome,
      fuso,
    ])
  ).rows[0]!.id

const novoCliente = async (grupo: string, clinica: string, nome: string): Promise<string> => {
  await participarDoGrupoDeTeste(migrate, clinica, grupo)
  return (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status)
       VALUES ($1, $2, $3, 'FIR Clinic', 'ativo') RETURNING id`,
      [grupo, clinica, nome],
    )
  ).rows[0]!.id
}

const novaPessoa = async (clinica: string): Promise<string> => {
  const perfil = (
    await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, 'pf_adm', 'Administração', '{}') RETURNING id`,
      [clinica],
    )
  ).rows[0]!.id
  return (
    await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id, ativo)
       VALUES ($1, 'Helena', 'helena', 'x', $2, true) RETURNING id`,
      [clinica, perfil],
    )
  ).rows[0]!.id
}

/** KPI manual mensal, com o lançamento de novembro e, se pedido, a meta do mês. */
const kpiManual = async (
  clinica: string,
  pessoa: string,
  nome: string,
  pilar: string,
  unidade: 'reais' | 'quantidade',
  valor: bigint,
  alvo: bigint | null,
): Promise<string> => {
  const id = (
    await migrate.query<{ id: string }>(
      `INSERT INTO kpis (clinica_id, origem, nome, pilar, unidade, direcao, frequencia, dia_de_lancamento, como_medir)
       VALUES ($1, 'manual', $2, $3, $4, 'maior', 'mensal', 1, 'contar na planilha da Helena') RETURNING id`,
      [clinica, nome, pilar, unidade],
    )
  ).rows[0]!.id
  const coluna = unidade === 'reais' ? 'valor_centavos' : 'valor_numero'
  await migrate.query(
    `INSERT INTO lancamentos_de_kpi (clinica_id, kpi_id, referencia, ${coluna}, comentario, lancado_por)
     VALUES ($1, $2, '2026-11-01', $3, 'comentário que nunca atravessa', $4)`,
    [clinica, id, valor.toString(), pessoa],
  )
  if (alvo !== null) {
    const alvoCol = unidade === 'reais' ? 'alvo_centavos' : 'alvo_numero'
    const partidaCol = unidade === 'reais' ? 'partida_centavos' : 'partida_numero'
    await migrate.query(
      `INSERT INTO metas_de_kpi (clinica_id, kpi_id, tipo, inicio, prazo, ${alvoCol}, ${partidaCol})
       VALUES ($1, $2, 'mes', '2026-11-01', '2026-11-30', $3, 0)`,
      [clinica, id, alvo.toString()],
    )
  }
  return id
}

const kpiDoCatalogo = async (clinica: string, chave: string): Promise<string> =>
  (
    await migrate.query<{ id: string }>(
      `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia) VALUES ($1, 'catalogo', $2, $2, 'mensal') RETURNING id`,
      [clinica, chave],
    )
  ).rows[0]!.id

const novoUsuario = async (apelido: string, grupo: string, valores: boolean): Promise<void> => {
  const usuario = `kpis.${apelido}.${sufixo}`
  const id = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id, valores, carteira, modulos)
       VALUES ($1, 'Comercial', $2, 'grupo', $3, $4, 'todos', $5::text[]) RETURNING id`,
      [usuario, await hashDeSenha(SENHA), grupo, valores, ['clientes', 'firclinic']],
    )
  ).rows[0]!.id
  usuarios.push(id)
  const r = await http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA }).expect(200)
  const v = r.headers['set-cookie'] as unknown
  const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
  cookie[apelido] = lista.map((c) => c.split(';')[0]!).join('; ')
}

const http = () => request(app.getHttpServer())

type Linha = {
  kpi_ref: string
  dia: string
  chave_catalogo: string | null
  nome: string
  pilar: string
  valor_centavos: string | null
  valor_numero: string | null
  alvo_centavos: string | null
  alvo_numero: string | null
  prazo: string | null
  situacao: string | null
  percentual_da_meta: number | null
}

const linhasDe = async (cliente: string, dia?: string): Promise<Linha[]> =>
  (
    await migrate.query<Linha>(
      `SELECT kpi_ref, dia::text AS dia, chave_catalogo, nome, pilar,
              valor_centavos::text AS valor_centavos, valor_numero::text AS valor_numero,
              alvo_centavos::text AS alvo_centavos, alvo_numero::text AS alvo_numero,
              prazo::text AS prazo, situacao, percentual_da_meta
         FROM kpis_na_carteira WHERE cliente_carteira_id = $1 AND ($2::date IS NULL OR dia = $2::date)
        ORDER BY dia, kpi_ref`,
      [cliente, dia ?? null],
    )
  ).rows

const rodar = (d: Date) =>
  executarUsoDiarioCliente(banco, relogio(d), '2026-11-11', { clienteIds: [clienteA, clienteB, clienteC] })

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[kpis-na-carteira] migrate:', e.message))
  await migrate.connect()
  // A MESMA trava dos outros arquivos de job da carteira (D16).
  await migrate.query("SELECT pg_advisory_lock(hashtext('teste:jobs-da-carteira'))")
  await declararAtorSistema(migrate)
  banco = new BancoService()

  grupoA = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`KPIs A ${sufixo}`])).rows[0]!.id
  grupoB = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`KPIs B ${sufixo}`])).rows[0]!.id
  clinicaA = await novaClinica('a', 'America/Bahia')
  clinicaB = await novaClinica('b', 'America/Manaus')
  clinicaC = await novaClinica('c', 'America/Bahia')
  clienteA = await novoCliente(grupoA, clinicaA, 'Clínica Sol')
  clienteB = await novoCliente(grupoB, clinicaB, 'Clínica do Outro Grupo')
  clienteC = await novoCliente(grupoA, clinicaC, 'Clínica que sai do grupo')

  const pessoaA = await novaPessoa(clinicaA)
  kpisDeA.fin = await kpiManual(clinicaA, pessoaA, 'Faturamento da estética', 'Financeiro', 'reais', 1_234_567n, 2_000_000n)
  kpisDeA.pes = await kpiManual(clinicaA, pessoaA, 'Treinamentos da equipe', 'Pessoas', 'quantidade', 500n, 1000n)
  kpisDeA.rh = await kpiDoCatalogo(clinicaA, 'saldo_banco_de_horas')
  kpisDeA.desp = await kpiDoCatalogo(clinicaA, 'despesas_fixas_sobre_recebido')
  kpiDeB = await kpiManual(clinicaB, await novaPessoa(clinicaB), 'Faturamento B', 'Financeiro', 'reais', 999n, null)
  kpiDeC = await kpiManual(clinicaC, await novaPessoa(clinicaC), 'Faturamento C', 'Financeiro', 'reais', 777n, null)

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  await novoUsuario('comvalores', grupoA, true)
  await novoUsuario('semvalores', grupoA, false)
  await novoUsuario('grupob', grupoB, true)
}, 60_000)

afterAll(async () => {
  await declararAtorSistema(migrate)
  const clientes = [clienteA, clienteB, clienteC]
  await migrate.query('DELETE FROM kpis_na_carteira WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM uso_diario_cliente WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM tarefas_internas WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [usuarios])
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador LIKE $1', [`kpis.%.${sufixo}`])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [usuarios])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [clientes])
  for (const c of [clinicaA, clinicaB, clinicaC]) await apagarHistoricoGrupoDeTeste(migrate, c)
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  for (const c of [clinicaA, clinicaB, clinicaC]) await apagarClinicaDeTeste(migrate, c)
  await migrate.end()
  await app.close()
  await banco.onModuleDestroy()
})

describe('o job grava kpis_na_carteira', () => {
  it('três rodadas idempotentes: uma linha por KPI por dia, sempre a mesma', async () => {
    const fotos: Linha[][] = []
    for (let i = 0; i < 3; i++) {
      const r = await rodar(AGORA)
      expect(r.falhas).toEqual([])
      expect(r.falhasDosKpis).toEqual([])
      fotos.push(await linhasDe(clienteA))
    }
    expect(fotos[0]).toHaveLength(3)
    expect(fotos[1]).toEqual(fotos[0])
    expect(fotos[2]).toEqual(fotos[0])
    expect(fotos[0]!.every((l) => l.dia === '2026-11-12')).toBe(true)
    expect(await linhasDe(clienteB)).toHaveLength(1)
    expect(await linhasDe(clienteC)).toHaveLength(1)
  })

  it('o valor e a meta vêm da calculadora: reais em centavos, percentual da meta', async () => {
    const fin = (await linhasDe(clienteA)).find((l) => l.kpi_ref === kpisDeA.fin)!
    expect(fin).toMatchObject({
      nome: 'Faturamento da estética',
      pilar: 'Financeiro',
      valor_centavos: '1234567',
      valor_numero: null,
      alvo_centavos: '2000000',
      prazo: '2026-11-30',
    })
    expect(fin.situacao).not.toBeNull()
    expect(fin.percentual_da_meta).toBeGreaterThan(0)
  })

  it('kpi-rh-some-sem-pessoas-gerir: o KPI de RH do catálogo não atravessa, e o banco o recusa', async () => {
    expect((await linhasDe(clienteA)).map((l) => l.kpi_ref)).not.toContain(kpisDeA.rh)
    await expect(
      migrate.query(
        `INSERT INTO kpis_na_carteira (cliente_carteira_id, grupo_id, kpi_ref, dia, chave_catalogo, nome, pilar, unidade)
         VALUES ($1, $2, gen_random_uuid(), '2026-11-01', 'saldo_banco_de_horas', 'x', 'Pessoas', 'horas')`,
        [clienteA, grupoA],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('carteira-pessoas-sem-valor: no pilar Pessoas só situação e percentual; nenhuma coluna de pessoa', async () => {
    const pes = (await linhasDe(clienteA)).find((l) => l.kpi_ref === kpisDeA.pes)!
    expect(pes).toMatchObject({ pilar: 'Pessoas', valor_numero: null, valor_centavos: null, alvo_numero: null, alvo_centavos: null })
    expect(pes.situacao).not.toBeNull()
    expect(pes.percentual_da_meta).toBe(50)
    await expect(
      migrate.query(
        `INSERT INTO kpis_na_carteira (cliente_carteira_id, grupo_id, kpi_ref, dia, nome, pilar, unidade, valor_numero)
         VALUES ($1, $2, gen_random_uuid(), '2026-11-01', 'x', 'Pessoas', 'quantidade', 100)`,
        [clienteA, grupoA],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'kpis_na_carteira_sem_valor_onde_nao_atravessa' })

    const colunas = (
      await migrate.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'kpis_na_carteira'`,
      )
    ).rows.map((c) => c.column_name)
    for (const proibida of ['responsavel', 'como_medir', 'comentario', 'paciente', 'lancado_por', 'pessoa', 'composicao']) {
      expect(colunas.filter((c) => c.includes(proibida))).toEqual([])
    }
    // E o texto livre que não atravessa não está em linha nenhuma.
    const texto = await migrate.query(
      `SELECT 1 FROM kpis_na_carteira WHERE cliente_carteira_id = $1 AND row_to_json(kpis_na_carteira)::text ~ '(Helena|comentário)'`,
      [clienteA],
    )
    expect(texto.rowCount).toBe(0)
  })

  it('job-nao-cruza-clinica: cada cliente recebe só os KPIs da própria clínica', async () => {
    expect(new Set((await linhasDe(clienteA)).map((l) => l.kpi_ref))).toEqual(new Set([kpisDeA.fin, kpisDeA.pes, kpisDeA.desp]))
    expect((await linhasDe(clienteB)).map((l) => l.kpi_ref)).toEqual([kpiDeB])
    expect((await linhasDe(clienteC)).map((l) => l.kpi_ref)).toEqual([kpiDeC])
  })

  it('fir_app nunca enxerga a tabela', async () => {
    const p = await migrate.query<Record<string, boolean>>(
      `SELECT has_table_privilege('fir_app', 'kpis_na_carteira', 'SELECT') AS sel,
              has_table_privilege('fir_app', 'kpis_na_carteira', 'INSERT') AS ins,
              has_table_privilege('fir_app', 'kpis_na_carteira', 'UPDATE') AS upd,
              has_table_privilege('fir_app', 'kpis_na_carteira', 'DELETE') AS del,
              has_table_privilege('fir_carteira', 'kpis_na_carteira', 'DELETE') AS del_carteira`,
    )
    expect(Object.values(p.rows[0]!)).toEqual([false, false, false, false, false])
  })
})

describe('a leitura na ficha do Cliente Firmare', () => {
  const ler = (quem: string, cliente: string) =>
    http().get(`/v1/carteira/clientes/${cliente}/indicadores-da-clinica`).set('Cookie', cookie[quem]!)

  it('com `valores`: os reais atravessam, e a razão de despesas aparece', async () => {
    const r = await ler('comvalores', clienteA).expect(200)
    const v = r.body as IndicadoresDaClinicaNaCarteiraSaida
    expect(v.dia).toBe('2026-11-12')
    const fin = v.kpis.find((k) => k.kpiRef === kpisDeA.fin)!
    expect(fin.atual).toEqual({ emDinheiro: '1234567', emNumero: null })
    expect(fin.alvo).toEqual({ emDinheiro: '2000000', emNumero: null })
    expect(v.kpis.map((k) => k.kpiRef)).toContain(kpisDeA.desp)
    expect(v.kpis.map((k) => k.chave)).not.toContain('saldo_banco_de_horas')
    expect(JSON.stringify(v)).not.toMatch(/Helena|comentário|planilha da Helena/)
  })

  it('carteira-sem-valores-null: sem `valores`, emDinheiro sai null e a razão de despesas some', async () => {
    const r = await ler('semvalores', clienteA).expect(200)
    const v = r.body as IndicadoresDaClinicaNaCarteiraSaida
    const fin = v.kpis.find((k) => k.kpiRef === kpisDeA.fin)!
    expect(fin.atual.emDinheiro).toBeNull()
    expect(fin.alvo?.emDinheiro ?? null).toBeNull()
    // O percentual é o que sobra para quem não vê valor.
    expect(fin.percentualDaMeta).not.toBeNull()
    expect(v.kpis.map((k) => k.kpiRef)).not.toContain(kpisDeA.desp)
  })

  it('carteira-pessoas-sem-valor na resposta: atual vazio, alvo nulo, percentual presente', async () => {
    const r = await ler('comvalores', clienteA).expect(200)
    const pes = (r.body as IndicadoresDaClinicaNaCarteiraSaida).kpis.find((k) => k.kpiRef === kpisDeA.pes)!
    expect(pes.atual).toEqual({ emDinheiro: null, emNumero: null })
    expect(pes.alvo).toBeNull()
    expect(pes.percentualDaMeta).toBe(50)
  })

  it('carteira-grupo-b-zero: o grupo B lê zero linhas do A, e a ficha responde 404', async () => {
    await ler('grupob', clienteA).expect(404)
    const contar = (escopo: string) =>
      banco.nasTabelasDaCarteiraComEscopo('grupo', escopo, async (c) =>
        Number(
          (await c.query<{ n: string }>('SELECT count(*) AS n FROM kpis_na_carteira WHERE cliente_carteira_id = ANY($1)', [[clienteA, clienteC]]))
            .rows[0]!.n,
        ),
      )
    expect(await contar(grupoB)).toBe(0)
    expect(await contar(grupoA)).toBeGreaterThan(0)
  })

  it('o acesso fica registrado na trilha da clínica, como usuario_gestao', async () => {
    const r = await migrate.query(
      `SELECT 1 FROM auditoria WHERE clinica_id = $1 AND acao = 'acessou' AND entidade = 'kpis_na_carteira'
          AND ator_tipo = 'usuario_gestao' AND entidade_id = $2`,
      [clinicaA, clienteA],
    )
    expect(r.rowCount).toBeGreaterThan(0)
  })

  it('id malformado e sem sessão: o mesmo 404', async () => {
    await http().get(`/v1/carteira/clientes/nao-e-uuid/indicadores-da-clinica`).set('Cookie', cookie['comvalores']!).expect(404)
    await http().get(`/v1/carteira/clientes/${clienteA}/indicadores-da-clinica`).expect(404)
  })
})

describe('carteira-desvinculada-sem-linha', () => {
  it('a clínica removida do grupo não ganha linha no dia seguinte; a vinculada ganha', async () => {
    const op = (await migrate.query<{ id: string }>(`SELECT id FROM operadores WHERE usuario = 'participacao-de-teste'`)).rows[0]!.id
    await migrate.query('BEGIN')
    try {
      await migrate.query(`SELECT set_config('app.pessoa_id', $1, true)`, [`operador:${op}`])
      await migrate.query('SELECT encerrar_participacao_da_clinica($1, $2, $3)', [clinicaC, grupoA, 'fim do contrato'])
      await migrate.query('COMMIT')
    } catch (e) {
      await migrate.query('ROLLBACK')
      throw e
    }
    for (let i = 0; i < 3; i++) {
      const r = await rodar(AMANHA)
      expect(r.falhasDosKpis).toEqual([])
    }
    expect(await linhasDe(clienteC, '2026-11-13')).toEqual([])
    // O que já tinha atravessado fica (retenção de 2 anos), sem linha nova.
    expect(await linhasDe(clienteC)).toHaveLength(1)
    expect(await linhasDe(clienteA, '2026-11-13')).toHaveLength(3)
  })
})
