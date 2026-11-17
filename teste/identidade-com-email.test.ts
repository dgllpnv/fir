import { apagarClinicaDeTeste, declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'
import { canonizarUsuario, ehOk, validarUsuario } from '@fir/domain'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * A identidade do produto depois da **D-10**: clínica + usuário + senha.
 *
 * O que estes testes protegem não é a coluna — é a decisão. O banco é a
 * autoridade sobre a forma canônica (`CHECK` com `normalizar_nome` **mais** o
 * regex de identificador), a unicidade é POR CLÍNICA, e a consulta de entrada
 * tem de continuar usando o índice.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client
let clinicaA: string
let clinicaB: string
let perfilA: string
let perfilB: string

const inserirPessoa = (clinica: string, perfil: string, usuario: string) =>
  migrate.query<{ id: string }>(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
     VALUES ($1, 'Fulana', $2, 'hash-de-teste', $3) RETURNING id`,
    [clinica, usuario, perfil],
  )

const apagarPessoa = (clinica: string, usuario: string) =>
  migrate.query('DELETE FROM pessoas WHERE clinica_id = $1 AND usuario = $2', [clinica, usuario])

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[identidade] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  const marca = Date.now()
  const criar = async (codigo: string) => {
    const c = await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica da identidade') RETURNING id`,
      [codigo],
    )
    const id = c.rows[0]!.id
    const pf = await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms)
       VALUES ($1, 'pf_rec', 'Recepção', '{jornada}') RETURNING id`,
      [id],
    )
    return [id, pf.rows[0]!.id] as const
  }
  ;[clinicaA, perfilA] = await criar(`ident-a-${marca}`)
  ;[clinicaB, perfilB] = await criar(`ident-b-${marca}`)
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinicaA)
  await apagarClinicaDeTeste(migrate, clinicaB)
  await migrate.end()
})

describe('pessoas.usuario substitui pessoas.email', () => {
  it('a coluna email não existe mais em pessoas', async () => {
    const r = await migrate.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'pessoas' AND column_name = 'email'`,
    )
    expect(r.rowCount).toBe(0)
  })

  it('usuario é único POR CLÍNICA, nunca global', async () => {
    // A mesma pessoa pode atender duas clínicas com o mesmo usuário.
    await inserirPessoa(clinicaA, perfilA, 'ana')
    await expect(inserirPessoa(clinicaA, perfilA, 'ana')).rejects.toThrow(/clinica_id_usuario/)
    await expect(inserirPessoa(clinicaB, perfilB, 'ana')).resolves.toBeDefined()
    await apagarPessoa(clinicaA, 'ana')
    await apagarPessoa(clinicaB, 'ana')
  })

  it.each(['Ana', 'ana silva', 'ana..silva', 'ana.', '1ana', 'ab', 'a'.repeat(33), 'aná'])(
    'o banco RECUSA o usuário %s',
    async (u) => {
      await expect(inserirPessoa(clinicaA, perfilA, u)).rejects.toThrow(/usuario_canonico/)
    },
  )

  it('o CHECK do banco e `validarUsuario` concordam — a forma canônica é UMA', async () => {
    // A prova de que a função do domínio não é uma segunda verdade. Se alguém
    // afrouxar um dos dois lados, este teste reprova.
    const amostras = [
      'ana',
      'Ana',
      'ana.silva',
      'ana silva',
      'ana..silva',
      'a-b_c',
      '1a',
      'aná',
      'ab',
      '  Helena  ',
      'JOAO_2',
      'ana-',
      'a'.repeat(40),
    ]
    for (const bruto of amostras) {
      const canonico = canonizarUsuario(bruto)
      const dominioAceita = ehOk(validarUsuario(canonico))
      const bancoAceita = await inserirPessoa(clinicaA, perfilA, canonico).then(
        () => true,
        () => false,
      )
      expect(bancoAceita, `divergência em "${bruto}" → "${canonico}"`).toBe(dominioAceita)
      if (bancoAceita) await apagarPessoa(clinicaA, canonico)
    }
  })

  /**
   * `normalizar_nome($1)` cai sobre o PARÂMETRO. Escrito sobre a COLUNA, o
   * índice único vira enfeite e a entrada vira varredura.
   *
   * **`enable_seqscan = off`, e isto não é trapaça.** Com poucas linhas na
   * tabela o planejador escolhe `Seq Scan` qualquer que seja a consulta, e o
   * teste passaria a medir o tamanho da fixture em vez do formato do
   * predicado. Desligado o seqscan, o planejador usa o índice **se o
   * predicado permitir** — e `normalizar_nome(usuario) = $1` não permite.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * **O PREDICADO NÃO LEVA `clinica_id`, e isto é o conserto de uma fragilidade
   * que o épico 7 expôs.**
   *
   * A versão anterior explicava `WHERE clinica_id = $1 AND usuario = …` e
   * exigia `Index Cond` mencionando `usuario`. Ela passou a REPROVAR quando a
   * migration 0018 acrescentou `pessoas_clinica_id_id_key UNIQUE (clinica_id,
   * id)` — a chave que as FKs compostas de `fichas_de_pessoa` exigem. Com dois
   * índices liderados por `clinica_id` e uma estimativa de uma linha, os dois
   * planos custam o mesmo e o planejador escolhe pelo desempate: ele passou a
   * ler a clínica pelo índice NOVO e filtrar `usuario` fora dele.
   *
   * Nada disso é defeito de produção — vinte pessoas por clínica tornam os dois
   * planos indistinguíveis no relógio. O defeito era do TESTE: ele afirmava
   * "o planejador escolhe este índice" quando o que importa é
   * **"o predicado é indexável"**. Tirando `clinica_id` do `WHERE`, o índice
   * novo deixa de ser candidato e a afirmação volta a ser sobre a única coisa
   * que o teste existe para medir.
   *
   * E a asserção não é vazia: o MESMO `EXPLAIN` sobre a forma defeituosa é
   * exigido abaixo e tem de NÃO produzir `Index Cond`. Sem esse par, uma
   * expressão regular frouxa passaria nas duas formas.
   * ──────────────────────────────────────────────────────────────────────────
   */
  it('a consulta de entrada USA o índice — e a forma torta NÃO usa', async () => {
    await migrate.query('BEGIN')
    try {
      await migrate.query('SET LOCAL enable_seqscan = off')
      const explicar = async (onde: string, params: unknown[]): Promise<string> => {
        const p = await migrate.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT id FROM pessoas WHERE ${onde}`,
          params,
        )
        return p.rows.map((r) => r['QUERY PLAN']).join('\n')
      }

      // A FORMA CERTA — a que `autenticacao.service.ts` usa.
      const certa = await explicar('usuario = normalizar_nome($1)', ['Helena'])
      expect(certa, certa).toMatch(/Index Cond:[^\n]*usuario/)
      expect(certa, certa).toContain('pessoas_clinica_id_usuario_key')

      // A FORMA TORTA — `normalizar_nome` sobre a COLUNA. É ela que torna a
      // asserção acima não-vazia: se os dois planos fossem iguais, o teste
      // não distinguiria nada.
      const torta = await explicar('normalizar_nome(usuario) = $1', ['helena'])
      expect(torta, torta).not.toMatch(/Index Cond:[^\n]*usuario/)
      expect(torta, torta).toMatch(/Filter:[^\n]*normalizar_nome\(usuario\)/)

      // E a consulta REAL, com a clínica: o que não pode acontecer nela é a
      // função cair sobre a coluna. Qual dos dois índices o planejador
      // escolhe é escolha dele, e muda com o tamanho da tabela.
      const real = await explicar('clinica_id = $1 AND usuario = normalizar_nome($2)', [
        clinicaA,
        'Helena',
      ])
      expect(real, real).not.toContain('normalizar_nome(usuario)')
    } finally {
      await migrate.query('ROLLBACK')
    }
  })

  it('senha_provisoria true exige prazo', async () => {
    const { rows } = await inserirPessoa(clinicaA, perfilA, 'prazo.teste')
    try {
      await expect(
        migrate.query(
          `UPDATE pessoas SET senha_provisoria = true, senha_provisoria_expira_em = NULL
            WHERE id = $1`,
          [rows[0]!.id],
        ),
      ).rejects.toThrow(/provisoria_tem_prazo/)
    } finally {
      await apagarPessoa(clinicaA, 'prazo.teste')
    }
  })

  it('senha_provisoria nasce falsa, e o prazo nasce nulo', async () => {
    const { rows } = await inserirPessoa(clinicaA, perfilA, 'padrao.teste')
    try {
      const r = await migrate.query<{ senha_provisoria: boolean; senha_provisoria_expira_em: null }>(
        'SELECT senha_provisoria, senha_provisoria_expira_em FROM pessoas WHERE id = $1',
        [rows[0]!.id],
      )
      expect(r.rows[0]).toEqual({ senha_provisoria: false, senha_provisoria_expira_em: null })
    } finally {
      await apagarPessoa(clinicaA, 'padrao.teste')
    }
  })
})
