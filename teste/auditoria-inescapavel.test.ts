import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ENTIDADES_COM_CLINICA,
  ENTIDADES_COM_CLINICA_POR_GRUPO,
  ENTIDADES_DA_CARTEIRA_SEM_CLINICA,
  ENTIDADES_DO_FINANCEIRO_DA_CARTEIRA_SEM_CLINICA,
} from './registro'

// Tabelas da carteira (ADR 0012) TÊM `clinica_id` e por isso aparecem na
// varredura real — mas não entram em `ENTIDADES_COM_CLINICA` porque a RLS
// delas é por `grupo_id`, não por `clinica_id` (ver registro.ts). A trilha
// de auditoria (`registrar_auditoria`) é universal e alcança as duas listas
// igual — só `isolamento-de-clinica.test.ts` trata o texto da policy
// diferente entre elas.
const TODAS_COM_CLINICA = [...ENTIDADES_COM_CLINICA, ...ENTIDADES_COM_CLINICA_POR_GRUPO]

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
/**
 * `clientes_carteira` usa um trigger PRÓPRIO (`registrar_auditoria_carteira_cliente`,
 * migration 0032), não o genérico — porque `clinica_id` é nullable ali e o
 * genérico assumiria `auditoria.clinica_id NOT NULL` (ADR 0016 §3). As duas
 * funções contam igual para "esta tabela tem trilha": a varredura aceita
 * qualquer uma das duas.
 */
const FUNCOES_DE_AUDITORIA = ['registrar_auditoria', 'registrar_auditoria_carteira_cliente'] as const

async function comClinicaId(): Promise<{ relname: string; tem_trigger: boolean }[]> {
  const r = await migrate.query<{ relname: string; tem_trigger: boolean }>(
    `SELECT c.relname,
            EXISTS (SELECT 1 FROM pg_trigger t
                     WHERE t.tgrelid = c.oid
                       AND NOT t.tgisinternal
                       AND t.tgfoid = ANY($1::regproc[])) AS tem_trigger
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND a.attname = 'clinica_id' AND NOT a.attisdropped
        AND c.relname <> 'auditoria'
      ORDER BY c.relname`,
    [FUNCOES_DE_AUDITORIA],
  )
  return r.rows
}

/** A chave primária de cada tabela auditada, uma linha por tabela. */
async function chavesPrimarias(): Promise<{ relname: string; colunas: string[] | null }[]> {
  const r = await migrate.query<{ relname: string; colunas: string[] | null }>(
    `SELECT c.relname,
            -- ::text e não name: o pg não tem parser para o tipo name[] e
            -- devolveria a string crua {id}, que passaria a comparar texto
            -- com array e reprovar tudo.
            (SELECT array_agg(a.attname::text ORDER BY a.attnum)
               FROM pg_index i
               JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
              WHERE i.indrelid = c.oid AND i.indisprimary) AS colunas
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute ci ON ci.attrelid = c.oid
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND ci.attname = 'clinica_id' AND NOT ci.attisdropped
        AND c.relname <> 'auditoria'
      ORDER BY c.relname`,
  )
  return r.rows
}

const foraDaConvencao = (linhas: { relname: string; colunas: string[] | null }[]): string[] =>
  linhas
    .filter((t) => t.colunas === null || t.colunas.length !== 1 || t.colunas[0] !== 'id')
    .map((t) => t.relname)

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
    const esperadas = [...TODAS_COM_CLINICA].filter((t) => t !== 'auditoria').sort()
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

  it('toda tabela auditada tem chave primária de uma coluna chamada "id"', async () => {
    /**
     * A CONVENÇÃO QUE O TRIGGER PRESSUPÕE, cobrada aqui.
     *
     * `registrar_auditoria` lê `v_new ->> 'id'` e grava em `entidade_id`, que
     * é `NOT NULL`. Numa tabela cuja chave primária se chame `codigo`, a
     * primeira escrita estoura — fail-closed, e isso é bom — mas estoura em
     * TEMPO DE EXECUÇÃO, e quem descobre é a recepcionista salvando um
     * formulário, não quem escreveu a migration. Pior é a tabela de chave
     * COMPOSTA: `->> 'id'` devolve NULL e o sintoma é o mesmo erro genérico
     * de coluna nula, apontando para o lugar errado.
     *
     * Duas saídas foram pesadas. Fazer o trigger descobrir a chave em
     * `pg_index` a cada linha custa catálogo por escrita e troca um erro alto
     * por um `entidade_id` que varia de forma entre tabelas — e a trilha
     * perde a propriedade de ser consultável por `(entidade, entidade_id)`.
     * A varredura custa nada, roda antes de o código existir e, de quebra,
     * passa a cobrar uma convenção que já vale em todas as tabelas de hoje.
     *
     * Quem precisar MESMO de outra chave primária muda o trigger e este
     * teste junto, de propósito — que é exatamente o ponto.
     */
    const todas = await chavesPrimarias()
    expect(todas.length, 'a varredura não enxergou tabela alguma').toBeGreaterThan(0)

    expect(
      foraDaConvencao(todas),
      'tabela auditada cuja chave primária não é a coluna `id`. O trigger grava `NEW.id` em ' +
        '`entidade_id` (NOT NULL): toda escrita nela falharia em produção, e numa chave ' +
        'COMPOSTA a trilha apontaria para registro que ninguém encontra.',
    ).toEqual([])
  })

  it('a varredura de chave primária NOMEIA a tabela fora da convenção', async () => {
    // Mesmo canário transacional do `it` acima: DDL no Postgres faz ROLLBACK,
    // e nada vaza para os outros arquivos deste pacote.
    await migrate.query('BEGIN')
    try {
      await migrate.query(`
        CREATE TABLE public._canario_chave_errada (
          codigo     text PRIMARY KEY,
          clinica_id uuid NOT NULL REFERENCES clinicas(id)
        )
      `)
      expect(foraDaConvencao(await chavesPrimarias())).toEqual(['_canario_chave_errada'])
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
        WHERE t.tgfoid = ANY($1::regproc[]) AND NOT t.tgisinternal`,
      [[...FUNCOES_DE_AUDITORIA, 'registrar_auditoria_do_painel']],
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

  /**
   * ADR 0016, item 4 — o achado explícito: `leads_comerciais` e as demais
   * tabelas de G5 NÃO têm `clinica_id`, então a varredura de `comClinicaId()`
   * acima nunca as alcança sozinha. Sem este `it`, "arquivar um lead" (ou
   * qualquer escrita nestas cinco tabelas) poderia perder o trigger de
   * auditoria sem que NENHUM teste deste arquivo notasse.
   */
  it('toda tabela da carteira SEM clinica_id (G5) tem o trigger registrar_auditoria_do_painel', async () => {
    const r = await migrate.query<{ relname: string; tem_trigger: boolean }>(
      `SELECT c.relname,
              EXISTS (SELECT 1 FROM pg_trigger t
                       WHERE t.tgrelid = c.oid
                         AND NOT t.tgisinternal
                         AND t.tgfoid = 'registrar_auditoria_do_painel'::regproc) AS tem_trigger
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1)`,
      [ENTIDADES_DA_CARTEIRA_SEM_CLINICA],
    )
    expect(r.rows.map((x) => x.relname).sort()).toEqual([...ENTIDADES_DA_CARTEIRA_SEM_CLINICA].sort())
    expect(
      r.rows.filter((x) => !x.tem_trigger).map((x) => x.relname),
      'tabela da carteira sem clinica_id SEM o trigger de auditoria: toda escrita nela fica sem passado',
    ).toEqual([])
  })

  /**
   * G3 (migration 0031) — achado 1 da revisão de código: as seis tabelas do
   * financeiro da carteira nunca entraram em NENHUMA varredura de auditoria.
   * Diferente de G5 (`it` acima, que EXIGE `registrar_auditoria_do_painel`),
   * aqui o exame é o OPOSTO: confirma que NENHUMA das seis usa um trigger
   * genérico de auditoria — `registrar_auditoria`, `registrar_auditoria_do_painel`
   * ou `registrar_auditoria_carteira_cliente` —, porque a trilha delas é
   * gravada EXPLICITAMENTE pelo código da aplicação (`gravarAuditoriaDaCarteira`,
   * `apps/api/src/carteira/financeiro/auditoria-da-carteira.ts`): as conexões
   * da carteira sempre rodam com `app.pessoa_id = 'sistema'`
   * (`nasTabelasDaCarteiraComEscopo`), e um trigger genérico gravaria "sistema"
   * como quem escreveu — o que mentiria sobre o `Usuário de Gestão` real.
   *
   * A cobertura de verdade (que a escrita É auditada) mora nos `*.e2e.test.ts`
   * de cada serviço (`cobrancas.e2e.test.ts`, `indicadores.e2e.test.ts`,
   * `metas.e2e.test.ts`, `beneficios.e2e.test.ts`), que conferem a linha em
   * `auditoria_da_carteira` depois de cada escrita — uma varredura de catálogo
   * não pode provar "o código chamou a função certa", só "existe/não existe
   * trigger". O que este `it` fecha é a lacuna oposta: ninguém volta a achar
   * que basta um trigger genérico aqui, porque ele FALHARIA (FK de
   * `auditoria_da_carteira.usuario_gestao_id` não aceita o ator `sistema`
   * nem um `Operador`).
   */
  it('as seis tabelas do financeiro da carteira (G3) NÃO usam trigger genérico — auditadas por código da aplicação', async () => {
    const FUNCOES_GENERICAS = [...FUNCOES_DE_AUDITORIA, 'registrar_auditoria_do_painel'] as const
    const r = await migrate.query<{ relname: string; tem_trigger_generico: boolean }>(
      `SELECT c.relname,
              EXISTS (SELECT 1 FROM pg_trigger t
                       WHERE t.tgrelid = c.oid
                         AND NOT t.tgisinternal
                         AND t.tgfoid = ANY($1::regproc[])) AS tem_trigger_generico
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($2)`,
      [FUNCOES_GENERICAS, ENTIDADES_DO_FINANCEIRO_DA_CARTEIRA_SEM_CLINICA],
    )
    expect(r.rows.map((x) => x.relname).sort()).toEqual(
      [...ENTIDADES_DO_FINANCEIRO_DA_CARTEIRA_SEM_CLINICA].sort(),
    )
    expect(
      r.rows.filter((x) => x.tem_trigger_generico).map((x) => x.relname),
      'tabela do financeiro da carteira com trigger GENÉRICO: isto gravaria "sistema" como autor, ' +
        'mentindo sobre o Usuário de Gestão real — a trilha certa é gravarAuditoriaDaCarteira, no código.',
    ).toEqual([])
  })
})
