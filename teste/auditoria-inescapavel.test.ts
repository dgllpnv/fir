import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ENTIDADES_COM_CLINICA } from './registro'

/**
 * Nenhuma tabela de negócio sem trigger de auditoria — e a varredura que cobra.
 *
 * VARREDURA, E NÃO LISTA MANTIDA À MÃO: lista envelhece em silêncio. Quem
 * escrever a décima tabela do Plano 2 não vai lembrar de acrescentar o
 * trigger, e o esquecimento não produz erro nenhum — produz dado gravado sem
 * passado. A varredura do catálogo já provou o valor dela na RLS, onde foi o
 * que pegou a view escapando. Mesmo padrão aqui.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[auditoria-inescapavel] migrate:', e.message))
  await migrate.connect()
})

afterAll(async () => {
  await migrate.end()
})

/**
 * Toda relação de `public` com `clinica_id`, e se ela tem o trigger.
 *
 * `auditoria` fica fora: um `AFTER INSERT` nela que insere nela é recursão
 * infinita, e é a própria tabela que a trigger protege — auditar a auditoria
 * é o começo de uma regressão sem fim.
 *
 * As PARTIÇÕES ficam DENTRO, ao contrário das outras varreduras deste
 * pacote. O Postgres clona trigger de linha da mãe para a partição, então a
 * verificação deveria passar de graça — e é exatamente por isso que ela vale:
 * se um dia não clonar, ou se alguém anexar uma partição por um caminho que
 * não clona, a varredura diz qual.
 */
async function comClinicaId(): Promise<{ relname: string; tem_trigger: boolean }[]> {
  const r = await migrate.query<{ relname: string; tem_trigger: boolean }>(
    `SELECT c.relname,
            EXISTS (SELECT 1 FROM pg_trigger t
                     WHERE t.tgrelid = c.oid
                       AND NOT t.tgisinternal
                       AND t.tgfoid = 'registrar_auditoria'::regproc) AS tem_trigger
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND a.attname = 'clinica_id' AND NOT a.attisdropped
        AND c.relname <> 'auditoria'
      ORDER BY c.relname`,
  )
  return r.rows
}

describe('nenhuma escrita de negócio escapa da trilha', () => {
  it('toda tabela com clinica_id tem o trigger de auditoria', async () => {
    const todas = await comClinicaId()

    /**
     * O PISO, e ele não é `> 0`: é a igualdade com o registro.
     *
     * `toEqual([])` sobre a lista de faltantes passa igual se a varredura
     * quebrou e devolveu nada — foi assim que três `it` deste pacote
     * executaram zero asserção útil por meses. Aqui o piso é forte porque o
     * registro é amarrado ao catálogo por `isolamento-de-clinica.test.ts`:
     * uma tabela nova com `clinica_id` reprova LÁ se não entrar no registro,
     * e reprova AQUI se entrar sem trigger. As duas pontas fechadas.
     */
    const esperadas = [...ENTIDADES_COM_CLINICA].filter((t) => t !== 'auditoria').sort()
    expect(
      todas.map((t) => t.relname),
      'a varredura não enxergou as tabelas de negócio registradas',
    ).toEqual(esperadas)

    expect(
      todas.filter((t) => !t.tem_trigger).map((t) => t.relname),
      'tabela com clinica_id SEM o trigger de auditoria: toda escrita nela fica sem passado',
    ).toEqual([])
  })

  it('a varredura NOMEIA a tabela que esqueceu o trigger', async () => {
    /**
     * O canário que prova que a consulta acima funciona. Dentro de uma
     * transação que SEMPRE faz ROLLBACK: DDL no Postgres é transacional, e uma
     * tabela criada numa transação aberta não existe para nenhuma outra
     * sessão. Nada vaza para os outros arquivos deste pacote — nem se este
     * processo morrer no meio.
     */
    await migrate.query('BEGIN')
    try {
      await migrate.query(`
        CREATE TABLE public._canario_sem_auditoria (
          id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          clinica_id uuid NOT NULL REFERENCES clinicas(id)
        )
      `)
      const faltando = (await comClinicaId()).filter((t) => !t.tem_trigger).map((t) => t.relname)
      expect(faltando).toEqual(['_canario_sem_auditoria'])
    } finally {
      await migrate.query('ROLLBACK')
    }
  })

  it('a própria auditoria NÃO tem o trigger — auditar a trilha é recursão infinita', async () => {
    const r = await migrate.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_trigger t
        WHERE t.tgrelid = 'public.auditoria'::regclass
          AND t.tgfoid = 'registrar_auditoria'::regproc`,
    )
    expect(r.rows[0]!.n).toBe(0)
  })

  it('o trigger cobre INSERT, UPDATE e DELETE — não só um deles', async () => {
    /**
     * `tgtype` é um bitmask. Um trigger criado só para `AFTER UPDATE` passaria
     * no primeiro `it` deste arquivo sem registrar criação nem remoção — e
     * "quem apagou esta pessoa" é das primeiras perguntas que uma clínica faz.
     *
     *   bit 0 (1)  = ROW (contra STATEMENT)
     *   bit 1 (2)  = BEFORE
     *   bit 2 (4)  = INSERT
     *   bit 3 (8)  = DELETE
     *   bit 4 (16) = UPDATE
     */
    const r = await migrate.query<{ relname: string; tgtype: number }>(
      `SELECT c.relname, t.tgtype::int
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgfoid = 'registrar_auditoria'::regproc AND NOT t.tgisinternal`,
    )
    expect(r.rows.length, 'nenhum trigger de auditoria no banco').toBeGreaterThan(0)
    for (const t of r.rows) {
      expect(t.tgtype & 1, `${t.relname}: o trigger não é FOR EACH ROW`).toBe(1)
      expect(t.tgtype & 2, `${t.relname}: o trigger é BEFORE — precisa ser AFTER`).toBe(0)
      expect(t.tgtype & 4, `${t.relname}: o trigger não cobre INSERT`).toBe(4)
      expect(t.tgtype & 8, `${t.relname}: o trigger não cobre DELETE`).toBe(8)
      expect(t.tgtype & 16, `${t.relname}: o trigger não cobre UPDATE`).toBe(16)
    }
  })
})
