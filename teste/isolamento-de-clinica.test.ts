import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ENTIDADES_COM_CLINICA,
  ENTIDADES_COM_CLINICA_POR_GRUPO,
  ENTIDADES_DA_CARTEIRA_SEM_CLINICA,
  ENTIDADES_DO_FINANCEIRO_DA_CARTEIRA_SEM_CLINICA,
} from './registro'

const TODAS_COM_CLINICA = [...ENTIDADES_COM_CLINICA, ...ENTIDADES_COM_CLINICA_POR_GRUPO]

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
    // registrou. Acrescente a ENTIDADES_COM_CLINICA (RLS por clinica_id) ou a
    // ENTIDADES_COM_CLINICA_POR_GRUPO (RLS por grupo_id, ADR 0012) — e
    // confira que ela tem RLS.
    expect(noBanco).toEqual([...TODAS_COM_CLINICA].sort())
  })

  it('cada tabela registrada tem RLS habilitada E forçada', async () => {
    for (const t of TODAS_COM_CLINICA) {
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
      [[...TODAS_COM_CLINICA, CANARIO_PARTICAO_MAE]],
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

  it('TODAS as policies de cada tabela por GRUPO chamam app_pode_ver_grupo — nunca OR inline', async () => {
    // Mesmo exame do `it` acima, para o padrão novo da carteira (ADR 0012):
    // `app_pode_ver_grupo()` carrega o `OR` DENTRO da função (geral vê tudo;
    // grupo vê só o próprio) para que a CLÁUSULA DA POLICY nunca precise de
    // `OR` — é a mesma defesa, um nível abaixo.
    for (const t of ENTIDADES_COM_CLINICA_POR_GRUPO) {
      const r = await migrate.query<{
        policyname: string
        qual: string | null
        with_check: string | null
        roles: string[]
      }>(
        'SELECT policyname, qual, with_check, roles::text[] AS roles FROM pg_policies WHERE schemaname = $1 AND tablename = $2',
        ['public', t],
      )
      expect(r.rows.length, `${t} sem policy`).toBeGreaterThan(0)

      // G6 (ADR 0018) acrescenta, a algumas destas tabelas, uma SEGUNDA
      // policy restrita `TO fir_portal` — um quarto ator, com a MESMA forma
      // um nível abaixo (`app_portal_pode_ver`, nunca `app_pode_ver_grupo`:
      // o portal não tem `escopo='geral'`). O filtro abaixo isola a OUTRA
      // policy (a de `fir_carteira`) para cobrar dela o texto certo —
      // `app_pode_ver_grupo`, sem `OR`.
      //
      // CORREÇÃO (bloqueador de merge, achado do `revisor-codigo`, migration
      // 0035): este filtro só examina o TEXTO da cláusula. Até a 0035, a
      // policy de `fir_carteira` nascia SEM `TO` nenhum — que no Postgres
      // significa `TO PUBLIC` — e por isso `fir_portal` TAMBÉM era sujeito a
      // ela, compondo por OR com a `_portal`: exatamente o oposto do que um
      // comentário antigo (em `0034_carteira_portal.sql`) e a leitura
      // ingênua deste filtro sugeriam ("cada uma só se aplica ao papel que a
      // declara" só é verdade DEPOIS que as duas policies têm `TO`
      // explícito). Medido ao vivo: como `fir_portal`, fixando só
      // `app.escopo = 'geral'` (sem `app.portal_*`), `SELECT * FROM
      // clientes_carteira` devolvia as 26 linhas de todas as clínicas.
      //
      // Por isso o `roles` de CADA policy aqui é examinado por igualdade
      // exata — nunca só "não contém fir_portal" — para que a tabela nunca
      // mais volte a valer `PUBLIC` em silêncio. A prova COMPORTAMENTAL
      // (conectar como `fir_portal` de verdade e medir o que o Postgres
      // devolve, não o texto da policy) mora em
      // `teste/portal-no-banco.test.ts`, describe "REGRESSÃO: fir_portal com
      // app.escopo=geral" — é o teste que teria pego este bug antes do merge.
      const doFirCarteira = r.rows.filter((p) => !p.roles.includes('fir_portal'))
      expect(doFirCarteira.length, `${t} sem policy de fir_carteira`).toBeGreaterThan(0)

      for (const p of doFirCarteira) {
        expect(
          p.roles,
          `${t}: policy "${p.policyname}" não está restrita a fir_carteira (roles = ${JSON.stringify(
            p.roles,
          )}) — sem TO explícito ela vale PUBLIC, e fir_portal volta a ser sujeito a ela, compondo por OR com a "_portal"`,
        ).toEqual(['fir_carteira'])
        expect(p.qual, `${t}: policy "${p.policyname}" sem USING por grupo`).toContain(
          'app_pode_ver_grupo',
        )
        expect(p.qual?.toUpperCase(), `${t}: policy "${p.policyname}" tem OR no USING`).not.toMatch(
          /\bOR\b/,
        )
        expect(
          p.with_check,
          `${t}: policy "${p.policyname}" sem WITH CHECK por grupo`,
        ).toContain('app_pode_ver_grupo')
        expect(
          p.with_check?.toUpperCase(),
          `${t}: policy "${p.policyname}" tem OR no WITH CHECK`,
        ).not.toMatch(/\bOR\b/)
      }
    }
  })

  it('as tabelas da carteira SEM clinica_id (G5) têm RLS forçada e policy por grupo, sem OR', async () => {
    // Mesmo exame dos dois `it` acima, para `ENTIDADES_DA_CARTEIRA_SEM_CLINICA`
    // (registro.ts) — a varredura por `clinica_id` do `it` do topo NUNCA
    // alcançaria estas tabelas, então elas precisam do exame explícito aqui.
    for (const t of ENTIDADES_DA_CARTEIRA_SEM_CLINICA) {
      const rls = await migrate.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = $1`,
        [t],
      )
      expect(rls.rows[0], `tabela ${t} não existe`).toBeDefined()
      expect(rls.rows[0]!.relrowsecurity, `${t} sem RLS habilitada`).toBe(true)
      expect(rls.rows[0]!.relforcerowsecurity, `${t} sem RLS forçada`).toBe(true)

      const r = await migrate.query<{ policyname: string; qual: string | null; with_check: string | null }>(
        'SELECT policyname, qual, with_check FROM pg_policies WHERE schemaname = $1 AND tablename = $2',
        ['public', t],
      )
      expect(r.rows.length, `${t} sem policy`).toBeGreaterThan(0)
      for (const p of r.rows) {
        expect(p.qual, `${t}: policy "${p.policyname}" sem USING por grupo`).toContain('app_pode_ver_grupo')
        expect(p.qual?.toUpperCase(), `${t}: policy "${p.policyname}" tem OR no USING`).not.toMatch(/\bOR\b/)
        expect(
          p.with_check,
          `${t}: policy "${p.policyname}" sem WITH CHECK por grupo`,
        ).toContain('app_pode_ver_grupo')
        expect(
          p.with_check?.toUpperCase(),
          `${t}: policy "${p.policyname}" tem OR no WITH CHECK`,
        ).not.toMatch(/\bOR\b/)
      }
    }
  })

  it('nenhuma tabela da carteira SEM clinica_id tem BYPASSRLS acessível por fir_app', async () => {
    // Defesa em profundidade (regra 19): mesmo com RLS, fir_app não deveria
    // ter privilégio nenhum nestas tabelas — REVOKE ALL FROM fir_app (0032).
    for (const t of ENTIDADES_DA_CARTEIRA_SEM_CLINICA) {
      const r = await migrate.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.table_privileges
          WHERE table_schema = 'public' AND table_name = $1 AND grantee = 'fir_app'`,
        [t],
      )
      expect(r.rows, `fir_app tem privilégio em ${t}: ${JSON.stringify(r.rows)}`).toEqual([])
    }
  })

  /**
   * G3 (migration 0031) — achado 1 da revisão de código: as seis tabelas do
   * financeiro da carteira (`indicadores_carteira`, `lancamentos_de_indicador`,
   * `metas_comerciais`, `beneficios_de_indicacao`, `cobrancas_do_cliente_firmare`
   * e `auditoria_da_carteira`) nunca entraram nesta varredura. Mesmo exame de
   * `ENTIDADES_DA_CARTEIRA_SEM_CLINICA` (RLS forçada, policy por grupo sem OR) —
   * ver `registro.ts` para por que é uma lista PRÓPRIA, não a mesma.
   */
  it('as seis tabelas do financeiro da carteira (G3) têm RLS forçada e policy por grupo, sem OR', async () => {
    for (const t of ENTIDADES_DO_FINANCEIRO_DA_CARTEIRA_SEM_CLINICA) {
      const rls = await migrate.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = $1`,
        [t],
      )
      expect(rls.rows[0], `tabela ${t} não existe`).toBeDefined()
      expect(rls.rows[0]!.relrowsecurity, `${t} sem RLS habilitada`).toBe(true)
      expect(rls.rows[0]!.relforcerowsecurity, `${t} sem RLS forçada`).toBe(true)

      const r = await migrate.query<{
        policyname: string
        qual: string | null
        with_check: string | null
        roles: string[]
      }>(
        'SELECT policyname, qual, with_check, roles::text[] AS roles FROM pg_policies WHERE schemaname = $1 AND tablename = $2',
        ['public', t],
      )
      expect(r.rows.length, `${t} sem policy`).toBeGreaterThan(0)

      // G6 (0034) acrescentou, a QUATRO destas seis (`indicadores_carteira`,
      // `lancamentos_de_indicador`, `metas_comerciais`,
      // `cobrancas_do_cliente_firmare` — nunca `beneficios_de_indicacao` nem
      // `auditoria_da_carteira`, que `fir_portal` não lê: sem GRANT SELECT
      // nelas, confirmado contra `information_schema`), uma SEGUNDA policy
      // `TO fir_portal` (`app_portal_pode_ver`, nunca `app_pode_ver_grupo`).
      //
      // CORREÇÃO (mesmo achado da migration 0035, comentário acima explica
      // por inteiro): nas quatro que `fir_portal` de fato lê, a policy de
      // `fir_carteira` só passou a ter `TO` explícito na 0035 — antes dela
      // valia `PUBLIC`, e `fir_portal` compunha por OR com a `_portal`. Por
      // isso a igualdade exata de `roles` abaixo só é cobrada para as quatro
      // em que isso importa — `beneficios_de_indicacao`/`auditoria_da_carteira`
      // continuam sem `TO` (sem GRANT para `fir_portal`, o OR nunca se forma)
      // e cobrar o mesmo delas reprovaria duas tabelas que não têm o problema.
      const TABELAS_QUE_FIR_PORTAL_LE = new Set([
        'indicadores_carteira',
        'lancamentos_de_indicador',
        'metas_comerciais',
        'cobrancas_do_cliente_firmare',
      ])
      const doFirCarteira = r.rows.filter((p) => !p.roles.includes('fir_portal'))
      expect(doFirCarteira.length, `${t} sem policy de fir_carteira`).toBeGreaterThan(0)

      for (const p of doFirCarteira) {
        if (TABELAS_QUE_FIR_PORTAL_LE.has(t)) {
          expect(
            p.roles,
            `${t}: policy "${p.policyname}" não está restrita a fir_carteira (roles = ${JSON.stringify(
              p.roles,
            )}) — sem TO explícito ela vale PUBLIC, e fir_portal (que TEM SELECT nesta tabela) volta a ser sujeito a ela, compondo por OR com a "_portal"`,
          ).toEqual(['fir_carteira'])
        }
        expect(p.qual, `${t}: policy "${p.policyname}" sem USING por grupo`).toContain('app_pode_ver_grupo')
        expect(p.qual?.toUpperCase(), `${t}: policy "${p.policyname}" tem OR no USING`).not.toMatch(/\bOR\b/)
        expect(
          p.with_check,
          `${t}: policy "${p.policyname}" sem WITH CHECK por grupo`,
        ).toContain('app_pode_ver_grupo')
        expect(
          p.with_check?.toUpperCase(),
          `${t}: policy "${p.policyname}" tem OR no WITH CHECK`,
        ).not.toMatch(/\bOR\b/)
      }
    }
  })

  it('nenhuma das seis tabelas do financeiro da carteira (G3) tem BYPASSRLS acessível por fir_app', async () => {
    for (const t of ENTIDADES_DO_FINANCEIRO_DA_CARTEIRA_SEM_CLINICA) {
      const r = await migrate.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.table_privileges
          WHERE table_schema = 'public' AND table_name = $1 AND grantee = 'fir_app'`,
        [t],
      )
      expect(r.rows, `fir_app tem privilégio em ${t}: ${JSON.stringify(r.rows)}`).toEqual([])
    }
  })

  /**
   * `auditoria_da_carteira` é a trilha de G3 (regra 20: append-only de fato) —
   * gravada EXPLICITAMENTE pelo código da aplicação (migration 0031: nenhum
   * trigger, de propósito). Sem este exame, um `UPDATE`/`DELETE` nela passaria
   * silenciosamente, e a trilha deixaria de ser confiável. Mesmo padrão de
   * `auditoria_do_painel` (0030): `REVOKE UPDATE, DELETE, TRUNCATE FROM fir_carteira`.
   */
  it('auditoria_da_carteira é APPEND-ONLY: fir_carteira não tem UPDATE/DELETE/TRUNCATE', async () => {
    const r = await migrate.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'auditoria_da_carteira'
          AND grantee = 'fir_carteira'`,
    )
    const privilegios = r.rows.map((x) => x.privilege_type)
    expect(privilegios, 'fir_carteira sem nenhum privilégio em auditoria_da_carteira').not.toEqual([])
    for (const proibido of ['UPDATE', 'DELETE', 'TRUNCATE']) {
      expect(
        privilegios,
        `fir_carteira tem ${proibido} em auditoria_da_carteira — a trilha deixaria de ser append-only`,
      ).not.toContain(proibido)
    }
  })
})
