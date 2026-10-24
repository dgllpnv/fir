import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ENTIDADES_COM_CLINICA } from './registro'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client

/**
 * Re-revisão, achado 5: o `it` de partição abaixo executava ZERO `expect` —
 * não há partição nenhuma em `public` hoje (o Plano 3 é quem cria a
 * primeira), então o laço sobre `r.rows` nunca rodava. O mesmo risco das
 * duas checagens de `escrita-sem-rls.test.ts`: a consulta ao catálogo
 * (`pg_inherits` + `relrowsecurity`/`relforcerowsecurity`) pode quebrar sem
 * que ninguém note, porque vazio passa de qualquer jeito.
 *
 * Zero é o estado correto para as tabelas de NEGÓCIO — não force um piso
 * positivo sobre `ENTIDADES_COM_CLINICA`, que hoje não tem partição
 * nenhuma. Em vez disso, este arquivo cria seu PRÓPRIO par mãe/filha
 * particionado, correto por construção, e o acrescenta ao filtro da
 * consulta ao lado de `ENTIDADES_COM_CLINICA` — nunca DENTRO do registro
 * compartilhado, que o outro `it` acima (`relname = ANY(ENTIDADES_COM_CLINICA)`
 * vs. `noBanco`) exige bater exatamente com as tabelas reais do schema.
 */
const CANARIO_PARTICAO_MAE = '_canario_particao_mae'
const CANARIO_PARTICAO_FILHA = '_canario_particao_filha'

async function criarCanarioDeParticao(cliente: pg.Client): Promise<void> {
  await cliente.query(`DROP TABLE IF EXISTS public.${CANARIO_PARTICAO_MAE} CASCADE`)
  // SEM `clinica_id` de propósito: o outro `it` deste describe
  // ("o registro cobre TODAS as tabelas com clinica_id") varre toda tabela
  // com essa coluna e exige igualdade EXATA com `ENTIDADES_COM_CLINICA` — um
  // canário com `clinica_id` apareceria ali e quebraria aquele teste, que
  // não tem nada a ver com este. O canário não precisa da coluna: só RLS
  // habilitada/forçada na filha é o que este `it` examina.
  await cliente.query(`
    CREATE TABLE public.${CANARIO_PARTICAO_MAE} (
      id bigint NOT NULL
    ) PARTITION BY RANGE (id)
  `)
  await cliente.query(`
    CREATE TABLE public.${CANARIO_PARTICAO_FILHA}
      PARTITION OF public.${CANARIO_PARTICAO_MAE}
      FOR VALUES FROM (0) TO (1000000)
  `)
  // Correto por construção: RLS habilitada E forçada na FILHA, que é
  // exatamente o que o `it` abaixo exige de toda partição registrada.
  await cliente.query(`ALTER TABLE public.${CANARIO_PARTICAO_FILHA} ENABLE ROW LEVEL SECURITY`)
  await cliente.query(`ALTER TABLE public.${CANARIO_PARTICAO_FILHA} FORCE ROW LEVEL SECURITY`)
  // A MÃE fica sem RLS de propósito (é só o esqueleto do particionamento), e o
  // `ALTER DEFAULT PRIVILEGES` do bootstrap já concedeu CRUD nela a `fir_app`.
  // Sem este REVOKE o canário vira uma relação sem RLS e gravável — que é
  // exatamente o que `escrita-sem-rls.test.ts` reprova, e aquele arquivo roda em
  // PARALELO com este contra o mesmo banco. O sintoma era vermelho alternado,
  // uma rodada sim e uma não, acusando um defeito que não existe.
  // A regra que aquele teste escreve é a que vale aqui: ou a relação ganha RLS,
  // ou ganha o REVOKE — nunca fica sem os dois.
  await cliente.query(
    `REVOKE INSERT, UPDATE, DELETE ON public.${CANARIO_PARTICAO_MAE} FROM fir_app`,
  )
}

async function removerCanarioDeParticao(cliente: pg.Client): Promise<void> {
  await cliente.query(`DROP TABLE IF EXISTS public.${CANARIO_PARTICAO_MAE} CASCADE`)
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await criarCanarioDeParticao(migrate)
})

afterAll(async () => {
  await removerCanarioDeParticao(migrate)
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
    // devolve todas as clínicas. Hoje não há partição de NEGÓCIO nenhuma —
    // o Plano 3 é quem vai criar a primeira — mas o canário deste arquivo
    // (`CANARIO_PARTICAO_MAE`/`_FILHA`, criado no `beforeAll`) garante que o
    // laço abaixo sempre roda ao menos uma vez.
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
      [[...ENTIDADES_COM_CLINICA, CANARIO_PARTICAO_MAE]],
    )

    // O piso não pode ser 0 (hoje não há partição de negócio nenhuma) — é 1,
    // porque o canário garante ao menos uma. Abaixo de 1 aqui significa que
    // `pg_inherits` parou de devolver a partição que este arquivo acabou de
    // criar — exatamente o jeito pelo qual o laço voltaria a rodar zero
    // vezes em silêncio.
    expect(
      r.rows.length,
      'nenhuma partição encontrada — nem o canário deste arquivo apareceu; ' +
        'a varredura de pg_inherits não está funcionando',
    ).toBeGreaterThanOrEqual(1)

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
