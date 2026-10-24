import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ENTIDADES_COM_CLINICA } from './registro'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
})

afterAll(async () => {
  await migrate.end()
})

describe('toda tabela de negócio está protegida', () => {
  it('o registro cobre TODAS as tabelas com clinica_id — nenhuma escapa', async () => {
    const r = await migrate.query<{ tablename: string }>(
      // `relkind IN ('r','p')`: `'p'` é TABELA PARTICIONADA, e ela escapava da
      // varredura antiga que filtrava só `'r'`. `movimentos` de estoque é
      // candidata a particionamento no Plano 3 — append-only e sem fim — e
      // uma partição-mãe sem RLS não aparecia aqui.
      //
      // As PARTIÇÕES (filhas) ficam de fora pelo `NOT EXISTS (pg_inherits)`:
      // elas herdam a coluna `clinica_id` da mãe e seriam dezenas de nomes a
      // registrar à mão, um por mês de dado. Quem cobre as filhas é o teste
      // seguinte, que exige RLS em cada uma.
      //
      // VIEW não entra aqui de propósito: view não aceita RLS, então exigir
      // `relrowsecurity` dela falharia sempre. O controle da view é
      // `security_invoker = true`, em `escrita-sem-rls.test.ts`.
      `SELECT c.relname AS tablename
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND a.attname = 'clinica_id' AND NOT a.attisdropped
          AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)`,
    )
    const noBanco = r.rows.map((x) => x.tablename).sort()
    // Se esta asserção falhar, alguém criou uma tabela com clinica_id e não a
    // registrou. Acrescente ao registro — e confira que ela tem RLS.
    expect(noBanco).toEqual([...ENTIDADES_COM_CLINICA].sort())
  })

  it('cada tabela registrada tem RLS habilitada E forçada', async () => {
    for (const t of ENTIDADES_COM_CLINICA) {
      const r = await migrate.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = $1`,
        [t],
      )
      expect(r.rows[0], `tabela ${t} não existe`).toBeDefined()
      expect(r.rows[0]!.relrowsecurity, `${t} sem RLS habilitada`).toBe(true)
      // FORCE para que nem o dono da tabela escape. Sem isto, um job rodando
      // como fir_migrate leria todas as clínicas sem perceber.
      expect(r.rows[0]!.relforcerowsecurity, `${t} sem RLS forçada`).toBe(true)
    }
  })

  it('cada PARTIÇÃO de tabela registrada também tem RLS habilitada e forçada', async () => {
    // A RLS da mãe vale para quem consulta PELA MÃE. Consulta direta a uma
    // partição aplica as policies DA PARTIÇÃO — e uma partição criada sem
    // `ENABLE ROW LEVEL SECURITY` é um `SELECT * FROM movimentos_2026_03` que
    // devolve todas as clínicas. Hoje não há partição nenhuma e este laço não
    // roda; ele existe para o Plano 3, que é quem vai criar a primeira.
    const r = await migrate.query<{ filha: string; mae: string; rls: boolean; forcada: boolean }>(
      `SELECT filha.relname AS filha,
              mae.relname   AS mae,
              filha.relrowsecurity      AS rls,
              filha.relforcerowsecurity AS forcada
         FROM pg_inherits i
         JOIN pg_class filha ON filha.oid = i.inhrelid
         JOIN pg_class mae   ON mae.oid   = i.inhparent
         JOIN pg_namespace n ON n.oid = mae.relnamespace
        WHERE n.nspname = 'public' AND mae.relname = ANY($1)`,
      [[...ENTIDADES_COM_CLINICA]],
    )
    for (const p of r.rows) {
      expect(p.rls, `partição ${p.filha} (de ${p.mae}) sem RLS habilitada`).toBe(true)
      expect(p.forcada, `partição ${p.filha} (de ${p.mae}) sem RLS forçada`).toBe(true)
    }
  })

  it('TODAS as policies de cada tabela registrada filtram por clínica', async () => {
    for (const t of ENTIDADES_COM_CLINICA) {
      const r = await migrate.query<{
        policyname: string
        qual: string | null
        with_check: string | null
      }>(
        'SELECT policyname, qual, with_check FROM pg_policies WHERE schemaname = $1 AND tablename = $2',
        ['public', t],
      )
      expect(r.rows.length, `${t} sem policy`).toBeGreaterThan(0)

      /**
       * TODAS as linhas, não `rows[0]`.
       *
       * Achado 4 da revisão final: a varredura antiga lia só a primeira
       * policy. Policies no Postgres compõem por **OR** — basta UMA com
       * `USING (true)` para a tabela ficar aberta, e com a leitura só da
       * primeira o teste continuaria verde enquanto a segunda policy
       * entregava as outras clínicas. A ordem de `pg_policies` é a do
       * catálogo, então qual delas caía em `rows[0]` era sorte.
       */
      for (const p of r.rows) {
        /**
         * Re-revisão, achado 8: `toContain('app_clinica_id')` passa para
         * `USING (clinica_id = app_clinica_id() OR true)` — a chamada está
         * lá, só que compondo por OR com algo sempre verdadeiro, o que torna
         * a cláusula inteira sempre verdadeira e abre a tabela para todas as
         * clínicas. Confirmado ao vivo: alterei `perfis_por_clinica` em
         * `public.perfis` para essa forma no Postgres local e o `toContain`
         * continuou passando.
         *
         * A defesa não é tentar reconhecer toda forma seguro de usar OR — é
         * proibir OR inteiramente nesta cláusula. Qualquer condição
         * adicional que o Plano 2 em diante precisar compor com o filtro de
         * clínica tem de ser por AND: só AND preserva "o filtro de clínica
         * vale sempre", e é essa a propriedade que a policy existe para
         * garantir.
         */
        expect(p.qual, `${t}: policy "${p.policyname}" sem USING por clínica`).toContain(
          'app_clinica_id',
        )
        expect(
          p.qual?.toUpperCase(),
          `${t}: policy "${p.policyname}" tem OR no USING — pode compor com algo sempre ` +
            `verdadeiro e abrir a tabela para todas as clínicas (qual = ${p.qual})`,
        ).not.toMatch(/\bOR\b/)

        // Sem WITH CHECK, a leitura é isolada mas a ESCRITA para outra clínica
        // passa — e é assim que se grava um paciente no tenant errado.
        expect(p.with_check, `${t}: policy "${p.policyname}" sem WITH CHECK por clínica`).toContain(
          'app_clinica_id',
        )
        expect(
          p.with_check?.toUpperCase(),
          `${t}: policy "${p.policyname}" tem OR no WITH CHECK — pode compor com algo sempre ` +
            `verdadeiro e permitir escrita em qualquer clínica (with_check = ${p.with_check})`,
        ).not.toMatch(/\bOR\b/)
      }
    }
  })
})
