import { apagarClinicaDeTeste, declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * A trigger que registra — e que RECUSA escrever sem ator.
 *
 * O registro não é chamada no handler: é trigger no Postgres. Três
 * consequências, e elas são o motivo da escolha:
 *
 *  1. Nenhum caminho escapa — nem um `psql` manual, nem um job, nem a rota
 *     que o programador esqueceu de instrumentar.
 *  2. `de → para` sai de `OLD`/`NEW`, exato, sem o handler montar o diff.
 *  3. Falha fechado: sem ator declarado, a escrita é RECUSADA. O contrário —
 *     gravar sem trilha — seria a falha silenciosa que a regra 20 existe para
 *     impedir.
 *
 * Os testes vão pelo papel `fir_app`, com `BEGIN` + `set_config` exatamente
 * como `BancoService.naClinica` faz: é o caminho de produção, sujeito à RLS.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP = process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'

type Trilha = {
  ator_tipo: string
  ator_id: string | null
  acao: string
  entidade: string
  entidade_id: string
  de: Record<string, unknown> | null
  para: Record<string, unknown> | null
  clinica_id: string
}

let migrate: pg.Client
let app: pg.Client
let clinica: string
let perfil: string
let pessoa: string
let alvo: string

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  app = new pg.Client({ connectionString: URL_APP })
  migrate.on('error', (e) => console.error('[auditoria-registra] migrate:', e.message))
  app.on('error', (e) => console.error('[auditoria-registra] app:', e.message))
  await migrate.connect()
  await app.connect()
  await declararAtorSistema(migrate)

  const c = await migrate.query<{ id: string }>(
    `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica do registro') RETURNING id`,
    [`registra-${Date.now()}`],
  )
  clinica = c.rows[0]!.id

  const pf = await migrate.query<{ id: string }>(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', '{jornada}') RETURNING id`,
    [clinica],
  )
  perfil = pf.rows[0]!.id

  const duas = await migrate.query<{ id: string }>(
    `INSERT INTO pessoas (clinica_id, nome, usuario, funcao, senha_hash, perfil_id)
     VALUES ($1, 'Juliana', 'juliana', 'Recepção', 'hash-da-juliana', $2),
            ($1, 'Camila',  'camila',  'Recepção', 'hash-da-camila',  $2)
     RETURNING id`,
    [clinica, perfil],
  )
  pessoa = duas.rows[0]!.id
  alvo = duas.rows[1]!.id
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await app.end()
})

/** Zera a trilha da clínica para que cada `it` leia só o que ele causou. */
beforeEach(async () => {
  await migrate.query('BEGIN')
  await migrate.query('ALTER TABLE auditoria DISABLE TRIGGER auditoria_sem_update')
  await migrate.query('DELETE FROM auditoria WHERE clinica_id = $1', [clinica])
  await migrate.query('ALTER TABLE auditoria ENABLE TRIGGER auditoria_sem_update')
  await migrate.query('COMMIT')
})

/**
 * O que `BancoService.naClinica` faz, nos mesmos comandos, pelo mesmo papel.
 * `ator` é o uuid da pessoa, a sentinela `'sistema'`, ou `null` para NÃO
 * declarar ator nenhum.
 */
async function comoAtor<T>(ator: string | null, fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN')
  try {
    await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinica])
    if (ator !== null) await app.query('SELECT set_config($1, $2, true)', ['app.pessoa_id', ator])
    const r = await fn()
    await app.query('COMMIT')
    return r
  } catch (e) {
    await app.query('ROLLBACK')
    throw e
  }
}

const trilha = async (): Promise<Trilha[]> =>
  (
    await migrate.query<Trilha>(
      `SELECT ator_tipo, ator_id, acao, entidade, entidade_id, de, para, clinica_id
         FROM auditoria WHERE clinica_id = $1 ORDER BY id`,
      [clinica],
    )
  ).rows

const umaLinha = async (): Promise<Trilha> => {
  const t = await trilha()
  expect(t, 'a trilha não registrou exatamente uma linha').toHaveLength(1)
  return t[0]!
}

describe('a trigger registra a escrita', () => {
  it('INSERT registra "criou", com a linha inteira em para e nada em de', async () => {
    const nova = await comoAtor(pessoa, async () =>
      (
        await app.query<{ id: string }>(
          `INSERT INTO pessoas (clinica_id, nome, usuario, funcao, senha_hash, perfil_id)
           VALUES ($1, 'Nova', 'nova.pessoa', 'Recepção', 'h', $2) RETURNING id`,
          [clinica, perfil],
        )
      ).rows[0]!.id,
    )

    const t = await umaLinha()
    expect(t.acao).toBe('criou')
    expect(t.entidade).toBe('pessoas')
    expect(t.entidade_id).toBe(nova)
    expect(t.clinica_id).toBe(clinica)
    expect(t.ator_tipo).toBe('pessoa')
    expect(t.ator_id).toBe(pessoa)
    expect(t.de).toBeNull()
    expect(t.para).toMatchObject({ nome: 'Nova', usuario: 'nova.pessoa' })
  })

  it('UPDATE registra só as colunas que mudaram, de → para', async () => {
    await comoAtor(pessoa, () =>
      app.query(`UPDATE pessoas SET funcao = 'Coordenadora' WHERE id = $1`, [alvo]),
    )

    const t = await umaLinha()
    expect(t.acao).toBe('alterou')
    expect(t.entidade_id).toBe(alvo)
    expect(t.ator_id).toBe(pessoa)
    // IGUALDADE, não `toMatchObject`: a trilha precisa ficar legível. Ninguém
    // lê um diff de vinte colunas para descobrir que a função mudou, e uma
    // trilha que ninguém lê não é uma trilha.
    expect(t.de).toEqual({ funcao: 'Recepção' })
    expect(t.para).toEqual({ funcao: 'Coordenadora' })

    await comoAtor(pessoa, () =>
      app.query(`UPDATE pessoas SET funcao = 'Recepção' WHERE id = $1`, [alvo]),
    )
  })

  it('UPDATE que não muda nada não deixa linha nenhuma', async () => {
    // Um `UPDATE … SET funcao = funcao` que gerasse linha enche a trilha de
    // nada: cada salvamento de formulário sem alteração viraria um "alterou"
    // sem de → para, e o ruído esconde o que importa.
    await comoAtor(pessoa, () =>
      app.query(`UPDATE pessoas SET funcao = funcao WHERE id = $1`, [alvo]),
    )
    expect(await trilha()).toHaveLength(0)
  })

  it('DELETE registra "removeu", com a linha inteira em de e nada em para', async () => {
    const descartavel = await comoAtor(pessoa, async () =>
      (
        await app.query<{ id: string }>(
          `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
           VALUES ($1, 'Passageira', 'passageira', 'h', $2) RETURNING id`,
          [clinica, perfil],
        )
      ).rows[0]!.id,
    )
    await comoAtor(pessoa, () => app.query('DELETE FROM pessoas WHERE id = $1', [descartavel]))

    const t = await trilha()
    expect(t.map((x) => x.acao)).toEqual(['criou', 'removeu'])
    expect(t[1]!.de).toMatchObject({ nome: 'Passageira' })
    expect(t[1]!.para).toBeNull()
  })

  it('SISTEMA é registrado como sistema, sem ator_id', async () => {
    await comoAtor('sistema', () =>
      app.query(`UPDATE pessoas SET funcao = 'Pela semente' WHERE id = $1`, [alvo]),
    )
    const t = await umaLinha()
    expect(t.ator_tipo).toBe('sistema')
    expect(t.ator_id).toBeNull()

    await comoAtor('sistema', () =>
      app.query(`UPDATE pessoas SET funcao = 'Recepção' WHERE id = $1`, [alvo]),
    )
  })
})

describe('a trilha não vira histórico de segredo', () => {
  it('senha_hash nunca aparece na trilha — mas a troca de senha É registrada', async () => {
    await comoAtor(pessoa, () =>
      app.query(`UPDATE pessoas SET senha_hash = '$argon2id$segredo-novo' WHERE id = $1`, [alvo]),
    )

    const t = await umaLinha()
    // As duas asserções juntas, e elas tensionam de propósito: OMITIR a
    // coluna esconderia o segredo e também o FATO. "A senha de alguém foi
    // trocada, por quem e quando" é exatamente o que uma trilha de auditoria
    // existe para responder — então a chave fica, o valor nunca.
    expect(JSON.stringify(t), 'o hash de senha atravessou para a trilha').not.toContain('argon2')
    expect(t.para).toEqual({ senha_hash: '[oculto]' })
    expect(t.de).toEqual({ senha_hash: '[oculto]' })

    await comoAtor(pessoa, () =>
      app.query(`UPDATE pessoas SET senha_hash = 'hash-da-camila' WHERE id = $1`, [alvo]),
    )
  })

  it('o INSERT de uma pessoa não leva o hash dela para a trilha', async () => {
    await comoAtor(pessoa, () =>
      app.query(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
         VALUES ($1, 'Com segredo', 'com.segredo', '$argon2id$do-insert', $2)`,
        [clinica, perfil],
      ),
    )
    const t = await umaLinha()
    expect(JSON.stringify(t)).not.toContain('argon2')
    expect(t.para).toMatchObject({ senha_hash: '[oculto]', nome: 'Com segredo' })
  })
})

describe('sem ator declarado, a escrita é recusada', () => {
  it('nem um psql manual escapa — fir_migrate sem ator não altera pessoas', async () => {
    // O papel DONO, com BYPASSRLS, numa conexão que nunca declarou ator: é o
    // script de correção às duas da manhã. Produção não deve permiti-lo mais
    // do que permite a rota esquecida.
    const cru = new pg.Client({ connectionString: URL_MIG })
    await cru.connect()
    try {
      await expect(
        cru.query(`UPDATE pessoas SET funcao = 'por fora' WHERE id = $1`, [alvo]),
      ).rejects.toThrow(/ator não declarado/i)
    } finally {
      await cru.end()
    }
    expect(await trilha()).toHaveLength(0)
  })

  it('nem a API: clínica fixada sem ator fixado é recusada', async () => {
    await expect(
      comoAtor(null, () =>
        app.query(`UPDATE pessoas SET funcao = 'sem ator' WHERE id = $1`, [alvo]),
      ),
    ).rejects.toThrow(/ator não declarado/i)
    expect(await trilha()).toHaveLength(0)
  })

  it('e nem na conexão que JÁ serviu uma transação com ator', async () => {
    /**
     * A armadilha que este teste fecha, medida neste Postgres: um parâmetro
     * personalizado NÃO volta a NULL depois de um `SET LOCAL` — volta a `''`.
     *
     *   antes  do SET LOCAL:  current_setting('app.x', true) IS NULL → t
     *   depois do COMMIT:     current_setting('app.x', true)         → ''
     *
     * Um desenho que lesse NULL como "esqueceram" e `''` como "sistema"
     * passaria a classificar TODO esquecimento como sistema em qualquer
     * conexão de pool que já tivesse servido uma requisição — e a trilha
     * ficaria cheia de "sistema" para ação humana, sem nenhum erro.
     */
    await comoAtor(pessoa, () =>
      app.query(`UPDATE pessoas SET funcao = 'Recepção' WHERE id = $1`, [alvo]),
    )
    await expect(
      comoAtor(null, () =>
        app.query(`UPDATE pessoas SET funcao = 'herdou o ator' WHERE id = $1`, [alvo]),
      ),
    ).rejects.toThrow(/ator não declarado/i)
  })

  it('a escrita recusada não acontece — a linha fica como estava', async () => {
    // O `rejects` sozinho não prova isto: a trigger é AFTER, e se o
    // `RAISE EXCEPTION` não abortasse a transação inteira o erro viria DEPOIS
    // de a coluna ter mudado.
    await expect(
      comoAtor(null, () => app.query(`UPDATE pessoas SET funcao = 'x' WHERE id = $1`, [alvo])),
    ).rejects.toThrow()
    const r = await migrate.query<{ funcao: string }>('SELECT funcao FROM pessoas WHERE id = $1', [
      alvo,
    ])
    expect(r.rows[0]!.funcao).toBe('Recepção')
  })
})
