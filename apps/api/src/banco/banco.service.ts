import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import pg from 'pg'

/**
 * Pool único, com o papel `fir_app` — **sujeito à RLS**.
 *
 * Rodar a aplicação com um papel que atravessa a RLS faria todo teste de
 * isolamento passar sem provar coisa alguma.
 */
@Injectable()
export class BancoService implements OnModuleDestroy {
  private readonly pool = new pg.Pool({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir',
    max: 10,
  })

  /** Consulta sem clínica fixada. Só para `clinicas` e para o healthcheck. */
  async semClinica<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) {
    return this.pool.query<T>(sql, params)
  }

  /**
   * Abre uma transação, fixa `app.clinica_id` nela e executa.
   *
   * `SET LOCAL` e não `SET`: o escopo é a transação, então uma conexão
   * devolvida ao pool nunca carrega a clínica da requisição anterior. Essa é a
   * diferença entre isolamento e um vazamento intermitente que só aparece sob
   * carga.
   */
  async naClinica<T>(clinicaId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinicaId])
      const r = await fn(c)
      await c.query('COMMIT')
      return r
    } catch (e) {
      await c.query('ROLLBACK')
      throw e
    } finally {
      c.release()
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end()
  }
}
