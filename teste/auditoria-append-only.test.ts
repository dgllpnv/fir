import { apagarClinicaDeTeste, declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * A trilha de auditoria é append-only **no banco**, não por convenção.
 *
 * Duas camadas, e as duas são necessárias:
 *
 *  1. **Privilégio.** `fir_app` recebe SELECT e INSERT; UPDATE e DELETE são
 *     revogados. É o que contém uma falha de lógica ou uma injeção na API.
 *  2. **Trigger.** O `REVOKE` da camada 1 **não alcança o dono da tabela**:
 *     `fir_migrate` é dono e tem BYPASSRLS, e um `UPDATE auditoria` dele
 *     passaria sem nenhum aviso. Sozinha, a camada 1 seria teatro.
 *
 * Este arquivo exercita as duas pelo papel que escapa da primeira — o dono.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client
let clinica: string
const codigo = `trilha-ao-${Date.now()}`

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[auditoria-append-only] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  const c = await migrate.query<{ id: string }>(
    `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica da trilha') RETURNING id`,
    [codigo],
  )
  clinica = c.rows[0]!.id
})

afterAll(async () => {
  // Desfazer o que este arquivo criou exige DESLIGAR a trigger de
  // append-only — e precisar disso é a prova de que ela funciona. Ver
  // `apagarTrilhaDeTeste`: produção nunca faz isto, porque lá a clínica se
  // desativa e a trilha dela continua sendo a resposta a "o que aconteceu".
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
})

describe('a trilha de auditoria é append-only', () => {
  it('ninguém atualiza nem apaga uma linha de auditoria — nem o dono da tabela', async () => {
    await migrate.query(
      `INSERT INTO auditoria
         (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id, de, para)
       VALUES ($1, 'sistema', NULL, 'criou', '_teste_append_only', 'x', NULL, '{"a":1}')`,
      [clinica],
    )

    await expect(
      migrate.query(`UPDATE auditoria SET acao = 'alterou' WHERE clinica_id = $1`, [clinica]),
    ).rejects.toThrow(/append-only/i)

    await expect(
      migrate.query('DELETE FROM auditoria WHERE clinica_id = $1', [clinica]),
    ).rejects.toThrow(/append-only/i)

    // A linha SOBREVIVEU, e com o valor original. Sem esta asserção, os dois
    // `rejects` acima passariam igual se a trigger levantasse DEPOIS de a
    // escrita ter efeito.
    const r = await migrate.query<{ acao: string; n: number }>(
      `SELECT acao, count(*) OVER ()::int AS n FROM auditoria WHERE clinica_id = $1`,
      [clinica],
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]!.acao).toBe('criou')
  })

  it('a trigger alcança até o UPDATE que não casaria com nenhuma linha', async () => {
    // `FOR EACH STATEMENT`, não `FOR EACH ROW`: a recusa não depende de haver
    // linha afetada. Um `UPDATE auditoria SET … WHERE false` que passasse em
    // silêncio ensinaria que "às vezes dá", e a próxima tentativa seria com
    // um WHERE que casa.
    await expect(
      migrate.query(`UPDATE auditoria SET acao = 'alterou' WHERE false`),
    ).rejects.toThrow(/append-only/i)
  })

  it('a API lê e insere na trilha, e não tem privilégio de alterar nem apagar', async () => {
    // Camada 1, medida direto no catálogo de privilégios. Separada da trigger
    // de propósito: quem implementar só a trigger terá este teste vermelho, e
    // quem implementar só o REVOKE terá o primeiro `it` vermelho.
    const r = await migrate.query<{
      le: boolean
      insere: boolean
      altera: boolean
      apaga: boolean
    }>(
      `SELECT has_table_privilege('fir_app', 'auditoria', 'SELECT') AS le,
              has_table_privilege('fir_app', 'auditoria', 'INSERT') AS insere,
              has_table_privilege('fir_app', 'auditoria', 'UPDATE') AS altera,
              has_table_privilege('fir_app', 'auditoria', 'DELETE') AS apaga`,
    )
    const p = r.rows[0]!
    expect(p.le, 'a API precisa LER a trilha: é o admin da clínica que a consulta').toBe(true)
    expect(p.insere, 'a API precisa INSERIR: o registro de acesso da regra 18 é um INSERT').toBe(
      true,
    )
    expect(p.altera, 'fir_app tem UPDATE em auditoria — o REVOKE da 0004 não pegou').toBe(false)
    expect(p.apaga, 'fir_app tem DELETE em auditoria — o REVOKE da 0004 não pegou').toBe(false)
  })

  it('ator declarado como pessoa exige o id da pessoa', async () => {
    // D-5, restrição 1: `ator_tipo` nasce com 'operador' previsto para que o
    // épico 12 acrescente o superadmin sem migration que reescreva o passado.
    // O CHECK existe para que 'pessoa' e 'operador' nunca fiquem sem id —
    // uma trilha que diz "alguém alterou" não responde à pergunta da LGPD.
    await expect(
      migrate.query(
        `INSERT INTO auditoria (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id)
         VALUES ($1, 'pessoa', NULL, 'alterou', '_teste_append_only', 'x')`,
        [clinica],
      ),
    ).rejects.toThrow(/ator_tem_id|check constraint/i)
  })
})
