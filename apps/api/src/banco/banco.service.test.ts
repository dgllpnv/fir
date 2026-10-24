import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { BancoService } from './banco.service'

/**
 * Prova a Rodada de correção 2: sem o listener de `'error'` no `Pool`, a API
 * inteira morria quando o Postgres encerrava uma conexão ociosa do pool —
 * visto de verdade ao parar o container e capturar:
 *
 *   node:events:497
 *         throw er; // Unhandled 'error' event
 *   error: terminating connection due to administrator command
 *
 * Reproduzido aqui sem tocar no Docker: uma conexão administrativa encerra o
 * backend do papel `fir_app` por dentro do Postgres, exatamente o mesmo
 * evento que um `docker stop`/reinício produz.
 *
 * A conexão administrativa usa o papel `fir` (o superusuário do container,
 * `POSTGRES_USER` em `infra/docker-compose.yml`), não `fir_migrate`: medido
 * primeiro com `fir_migrate` e o Postgres recusou com
 * "permission denied to terminate process" — `fir_migrate` tem `BYPASSRLS`
 * e é dono do esquema, mas não é superusuário nem membro de
 * `pg_signal_backend`, os únicos com permissão para encerrar o backend de
 * *outro* papel. `fir` já é superusuário por ser o usuário de inicialização
 * da imagem oficial do Postgres — nenhuma credencial nova, nenhum segredo
 * que não estivesse já em `infra/docker-compose.yml`.
 */
const URL_ADMIN = process.env['DATABASE_URL_ADMIN'] ?? 'postgresql://fir:fir_local_dev@127.0.0.1:4832/fir'

describe('BancoService — resiliência do pool', () => {
  /**
   * `usename = 'fir_app'` encerraria TODO backend logado como `fir_app` no
   * servidor naquele instante — inclusive o `pg.Client` cru que
   * `banco.test.ts` mantém aberto o arquivo inteiro. O Vitest roda arquivos
   * em paralelo por padrão (sem `fileParallelism: false`), então um filtro
   * por papel é uma corrida: na maioria das vezes o outro teste não tem
   * nenhuma conexão ociosa no momento exato do terminate, mas não é
   * garantido. Por isso a marca: só a conexão que este teste mesmo abriu.
   */
  const MARCA = 'fir-teste-resiliencia'

  it('sobrevive quando o Postgres encerra uma conexão ociosa do pool, e reconecta', async () => {
    const urlBase =
      process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'
    const anterior = process.env['DATABASE_URL']

    let banco: BancoService
    try {
      process.env['DATABASE_URL'] = `${urlBase}${urlBase.includes('?') ? '&' : '?'}application_name=${MARCA}`
      banco = new BancoService()
    } finally {
      // Restaurado logo depois de construir o serviço — o `Pool` já leu a
      // variável no construtor; nenhum outro teste deste processo pode vir
      // a ler o valor marcado.
      if (anterior === undefined) delete process.env['DATABASE_URL']
      else process.env['DATABASE_URL'] = anterior
    }

    // Força o pool a abrir uma conexão com `fir_app` (marcada) e devolve-a
    // ociosa.
    await banco.semIsolamentoDeClinica('SELECT 1')

    const admin = new pg.Client({ connectionString: URL_ADMIN })
    await admin.connect()
    let encerrados: number
    try {
      const r = await admin.query<{ pg_terminate_backend: boolean }>(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE application_name = $1 AND pid <> pg_backend_pid()`,
        [MARCA],
      )
      encerrados = r.rowCount ?? r.rows.length
    } finally {
      await admin.end()
    }
    // Uma linha por backend encerrado — tem que ser exatamente a conexão
    // que este teste abriu, nunca mais que isso.
    expect(encerrados).toBe(1)

    // Dá tempo para o Postgres fechar a conexão e o `pg` emitir o 'error'
    // ocioso no pool.
    await new Promise((resolver) => setTimeout(resolver, 300))

    // Se o processo tivesse morrido (o defeito da Rodada 2), este teste nunca
    // chegaria até aqui — o worker do vitest teria caído com ele. Chegar
    // aqui já é parte da prova; a consulta seguinte prova que o pool
    // reconecta sozinho, sem reinício.
    const r2 = await banco.semIsolamentoDeClinica<{ n: number }>('SELECT 1 AS n')
    expect(r2.rows[0]!.n).toBe(1)

    await banco.onModuleDestroy()
  })

  it('registra um listener de erro no pool — guarda contra a remoção acidental do listener', async () => {
    const banco = new BancoService()
    const comPoolExposto = banco as unknown as { pool: pg.Pool }
    expect(comPoolExposto.pool.listenerCount('error')).toBeGreaterThan(0)
    await banco.onModuleDestroy()
  })
})
