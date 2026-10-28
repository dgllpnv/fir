import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SISTEMA, pessoaIdDeFonteConfiavel } from './ator'
import { BancoService } from './banco.service'
import { clinicaIdDeFonteConfiavel } from './clinica-id'
import { apagarClinicaDeTeste, declararAtorSistema } from './limpeza-de-teste'

/**
 * O ator da transação, visto pelo banco.
 *
 * A trigger `registrar_auditoria` lê `app.pessoa_id` e recusa a escrita sem
 * ator declarado. Isto mede o outro lado do contrato: que `naClinica` de fato
 * declara o ator, e que ele **não sobrevive à transação** — uma conexão
 * devolvida ao pool que carregasse o ator anterior atribuiria à pessoa errada
 * tudo o que a requisição seguinte escrevesse.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client
let banco: BancoService
let clinica: string
let pessoa: string
let outraPessoa: string

/** O que o banco relata quando NINGUÉM declarou ator. */
const SEM_ATOR = ['', '<nulo>']

const atorNoBanco = async (c: pg.PoolClient | pg.Client) =>
  (
    await c.query<{ cru: string; uuid: string | null }>(
      `SELECT coalesce(current_setting('app.pessoa_id', true), '<nulo>') AS cru,
              app_pessoa_id()::text AS uuid`,
    )
  ).rows[0]!

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[contexto-do-ator] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  const c = await migrate.query<{ id: string }>(
    `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica do ator') RETURNING id`,
    [`ator-${Date.now()}`],
  )
  clinica = c.rows[0]!.id

  const perfil = await migrate.query<{ id: string }>(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', '{jornada}') RETURNING id`,
    [clinica],
  )
  const duas = await migrate.query<{ id: string }>(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
     VALUES ($1, 'Juliana', 'juliana', 'x', $2),
            ($1, 'Camila',  'camila',  'x', $2)
     RETURNING id`,
    [clinica, perfil.rows[0]!.id],
  )
  pessoa = duas.rows[0]!.id
  outraPessoa = duas.rows[1]!.id

  banco = new BancoService()
})

afterAll(async () => {
  await banco.onModuleDestroy()
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
})

describe('o ator da transação', () => {
  it('fica visível ao banco dentro da transação', async () => {
    const dentro = await banco.naClinica(
      clinicaIdDeFonteConfiavel(clinica),
      pessoaIdDeFonteConfiavel(pessoa),
      (c) => atorNoBanco(c),
    )
    expect(dentro.cru).toBe(pessoa)
    expect(dentro.uuid).toBe(pessoa)
  })

  it('não atravessa para a transação seguinte da mesma conexão', async () => {
    await banco.naClinica(clinicaIdDeFonteConfiavel(clinica), pessoaIdDeFonteConfiavel(pessoa), () =>
      Promise.resolve(),
    )
    const depois = await banco.naClinica(
      clinicaIdDeFonteConfiavel(clinica),
      pessoaIdDeFonteConfiavel(outraPessoa),
      (c) => atorNoBanco(c),
    )
    expect(depois.uuid).toBe(outraPessoa)
  })

  it('não atravessa para uma consulta SEM transação na mesma conexão do pool', async () => {
    /**
     * A asserção que importa, e a que o teste "duas chamadas seguidas"
     * NÃO faz: `set_config(…, true)` é SET LOCAL, de transação. Com
     * `set_config(…, false)` por engano, as duas chamadas acima continuariam
     * passando (cada uma sobrescreve a anterior) e o vazamento só apareceria
     * aqui — numa consulta que não abre transação e herda o ator de quem usou
     * a conexão antes.
     *
     * O pool do `pg` devolve o cliente ocioso mais recente, então esta é, com
     * altíssima probabilidade, a MESMA conexão de `naClinica` acima.
     */
    await banco.naClinica(clinicaIdDeFonteConfiavel(clinica), pessoaIdDeFonteConfiavel(pessoa), () =>
      Promise.resolve(),
    )
    const fora = await banco.semIsolamentoDeClinica<{ cru: string; uuid: string | null }>(
      `SELECT coalesce(current_setting('app.pessoa_id', true), '<nulo>') AS cru,
              app_pessoa_id()::text AS uuid`,
    )
    expect(fora.rows[0]!.uuid, 'o ator da transação anterior vazou para fora dela').toBeNull()
    expect(SEM_ATOR).toContain(fora.rows[0]!.cru)
  })

  it('SISTEMA é um ator DECLARADO, e não a ausência de um', async () => {
    // A distinção que faz a trigger recusar escrita: `app_pessoa_id()` é NULL
    // nos dois casos, mas o valor cru diz qual dos dois. Sem isto, um job
    // legítimo e um esquecimento seriam indistinguíveis — e a escolha seria
    // deixar os dois passarem (trilha mentirosa) ou os dois falharem (nenhum
    // job roda).
    const dentro = await banco.naClinica(clinicaIdDeFonteConfiavel(clinica), SISTEMA, (c) =>
      atorNoBanco(c),
    )
    expect(dentro.cru).toBe('sistema')
    expect(dentro.uuid).toBeNull()
    expect(SEM_ATOR).not.toContain(dentro.cru)
  })

  it('a clínica continua fixada — o ator não a substituiu', async () => {
    const r = await banco.naClinica(
      clinicaIdDeFonteConfiavel(clinica),
      pessoaIdDeFonteConfiavel(pessoa),
      async (c) =>
        (await c.query<{ c: string | null }>('SELECT app_clinica_id()::text AS c')).rows[0]!.c,
    )
    expect(r).toBe(clinica)
  })
})
