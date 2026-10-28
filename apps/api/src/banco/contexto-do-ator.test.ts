import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SISTEMA, operadorIdDeFonteConfiavel, pessoaIdDeFonteConfiavel } from './ator'
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
let operador: string

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

  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash)
       VALUES ($1, 'Operador do ator', 'x') RETURNING id`,
      [`op.ator.${Date.now() % 1_000_000}`],
    )
  ).rows[0]!.id

  banco = new BancoService()
})

afterAll(async () => {
  await banco.onModuleDestroy()
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM operadores WHERE id = $1', [operador])
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

/**
 * O SEGUNDO POOL — o do painel.
 *
 * Não é `SET ROLE` sobre o pool do produto, e a diferença é a D-5, restrição
 * 5: `RESET ROLE` desfaz na mesma transação, e aí o privilégio de criar
 * clínica passa a existir na conexão que serve o balcão, com nada além da
 * disciplina impedindo. Duas conexões **autenticadas** não têm esse desfazer.
 */
describe('o pool do painel', () => {
  it('é OUTRA conexão, AUTENTICADA como fir_painel — e `RESET ROLE` não desfaz', async () => {
    /**
     * `session_user`, e não só `current_user`, e é aqui que a D-5 restrição 5
     * ganha um teste em vez de um comentário.
     *
     * `SET ROLE fir_painel` sobre o pool do produto faria `current_user`
     * dizer `fir_painel` — este teste passaria com a implementação errada
     * dentro. O que `SET ROLE` **não** muda é `session_user`, que é o papel
     * com que a conexão se AUTENTICOU; e `RESET ROLE` devolveria a sessão a
     * `fir_app` na mesma transação, isto é: a leitura do painel viraria
     * escrita do produto sem nada além da disciplina impedindo.
     */
    const r = await banco.comoPainel(
      clinicaIdDeFonteConfiavel(clinica),
      operadorIdDeFonteConfiavel(operador),
      async (c) => {
        const antes = await c.query<{ atual: string; sessao: string }>(
          'SELECT current_user AS atual, session_user AS sessao',
        )
        await c.query('RESET ROLE')
        const depois = await c.query<{ atual: string; sessao: string }>(
          'SELECT current_user AS atual, session_user AS sessao',
        )
        return { antes: antes.rows[0]!, depois: depois.rows[0]! }
      },
    )
    expect(r.antes).toEqual({ atual: 'fir_painel', sessao: 'fir_painel' })
    expect(r.depois, 'RESET ROLE devolveu a sessão a outro papel').toEqual({
      atual: 'fir_painel',
      sessao: 'fir_painel',
    })
  })

  it('o pool do PRODUTO continua AUTENTICADO como fir_app — e não vira painel', async () => {
    const quem = await banco.naClinica(
      clinicaIdDeFonteConfiavel(clinica),
      SISTEMA,
      async (c) =>
        (await c.query<{ atual: string; sessao: string }>(
          'SELECT current_user AS atual, session_user AS sessao',
        )).rows[0]!,
    )
    expect(quem).toEqual({ atual: 'fir_app', sessao: 'fir_app' })
  })

  it('o pool do produto NÃO alcança as tabelas do painel', async () => {
    await expect(
      banco.naClinica(clinicaIdDeFonteConfiavel(clinica), SISTEMA, (c) =>
        c.query('SELECT 1 FROM operadores'),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('comoPainel fixa a clínica E o ator operador, dentro da transação', async () => {
    const dentro = await banco.comoPainel(
      clinicaIdDeFonteConfiavel(clinica),
      operadorIdDeFonteConfiavel(operador),
      (c) => atorNoBanco(c),
    )
    expect(dentro.cru).toBe(`operador:${operador}`)
    // `app_pessoa_id()` é NULL para operador: ele não é uma pessoa, e a
    // função não estoura (0013).
    expect(dentro.uuid).toBeNull()
  })

  it('a escrita do painel cai na trilha DA CLÍNICA, com ator_tipo operador', async () => {
    await banco.comoPainel(
      clinicaIdDeFonteConfiavel(clinica),
      operadorIdDeFonteConfiavel(operador),
      (c) => c.query(`UPDATE pessoas SET funcao = 'tocado pelo painel' WHERE id = $1`, [pessoa]),
    )
    const t = await migrate.query<{ ator_tipo: string; ator_id: string; clinica_id: string }>(
      `SELECT ator_tipo, ator_id, clinica_id FROM auditoria
        WHERE clinica_id = $1 ORDER BY em DESC, id DESC LIMIT 1`,
      [clinica],
    )
    expect(t.rows[0]).toEqual({ ator_tipo: 'operador', ator_id: operador, clinica_id: clinica })
  })

  it('o painel NÃO alcança a clínica vizinha — a RLS segura, não o código', async () => {
    /**
     * A prova adversarial: aqui a APLICAÇÃO erra de propósito — ela fixa a
     * clínica A e tenta ler e escrever uma pessoa da clínica B, com o id
     * dela na mão. A segunda camada (filtro na aplicação) está ausente por
     * construção neste teste; quem recusa é o banco.
     */
    const outra = (
      await migrate.query<{ id: string }>(
        `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Vizinha') RETURNING id`,
        [`vizinha-${Date.now()}`],
      )
    ).rows[0]!.id
    const perfilB = await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms)
       VALUES ($1, 'pf_rec', 'Recepção', '{jornada}') RETURNING id`,
      [outra],
    )
    const pessoaB = (
      await migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
         VALUES ($1, 'Da vizinha', 'davizinha', 'x', $2) RETURNING id`,
        [outra, perfilB.rows[0]!.id],
      )
    ).rows[0]!.id

    try {
      const lido = await banco.comoPainel(
        clinicaIdDeFonteConfiavel(clinica),
        operadorIdDeFonteConfiavel(operador),
        async (c) => (await c.query('SELECT id FROM pessoas WHERE id = $1', [pessoaB])).rowCount,
      )
      expect(lido, 'o painel LEU a pessoa da clínica vizinha').toBe(0)

      const escrito = await banco.comoPainel(
        clinicaIdDeFonteConfiavel(clinica),
        operadorIdDeFonteConfiavel(operador),
        async (c) =>
          (await c.query(`UPDATE pessoas SET funcao = 'invadido' WHERE id = $1`, [pessoaB]))
            .rowCount,
      )
      expect(escrito, 'o painel ESCREVEU na pessoa da clínica vizinha').toBe(0)

      const intacta = await migrate.query<{ funcao: string }>(
        'SELECT funcao FROM pessoas WHERE id = $1',
        [pessoaB],
      )
      expect(intacta.rows[0]!.funcao).toBe('')
    } finally {
      await apagarClinicaDeTeste(migrate, outra)
    }
  })

  it('não existe variante "sem clínica" de uso geral', () => {
    /**
     * A ausência deste método é a defesa. Se um dia alguém precisar listar
     * clínicas, isso é `semIsolamentoDeClinica` sobre `clinicas`, que não tem
     * RLS por ser a raiz do tenancy — e não um painel que escapa da RLS.
     *
     * A única entrada sem clínica é `comoPainelCriandoClinica`, e ela existe
     * porque a clínica ainda não tem id no instante do `INSERT`. Ela não é
     * uso geral: é o passo 1 de uma criação, e sem `fixarClinica` ela não
     * enxerga tabela de negócio nenhuma — o teste abaixo mede isso.
     */
    expect('comoPainelSemClinica' in banco).toBe(false)
  })

  it('comoPainelCriandoClinica começa CEGA, e só enxerga depois de fixar', async () => {
    const antes = await banco.comoPainelCriandoClinica(
      operadorIdDeFonteConfiavel(operador),
      async (c) => (await c.query('SELECT id FROM pessoas')).rowCount,
    )
    expect(antes, 'o painel sem clínica fixada enxergou pessoas').toBe(0)

    const depois = await banco.comoPainelCriandoClinica(
      operadorIdDeFonteConfiavel(operador),
      async (c, fixarClinica) => {
        await fixarClinica(clinicaIdDeFonteConfiavel(clinica))
        return (await c.query('SELECT id FROM pessoas')).rowCount
      },
    )
    expect(depois).toBeGreaterThan(0)
  })
})
