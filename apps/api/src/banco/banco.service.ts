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
    // Esperar por um slot livre tem prazo: sem isso, com os 10 ocupados, as
    // próximas chamadas ficam na fila sem fim visível.
    connectionTimeoutMillis: 5_000,
    // Conexão ociosa não fica para sempre presa no pool.
    idleTimeoutMillis: 30_000,
    // Consulta cara é cortada em vez de prender um dos 10 slots indefinidamente.
    statement_timeout: 15_000,
    // Transação esquecida aberta (deadlock, chamada externa que nunca volta)
    // é cortada — o mesmo espírito do `SET LOCAL`: nada da requisição deve
    // sobreviver além do que foi pedido.
    idle_in_transaction_session_timeout: 20_000,
  })

  /**
   * Consulta sem clínica fixada.
   *
   * Nome deliberadamente desconfortável: os únicos usos legítimos são
   * verificar o banco (healthcheck), ler `clinicas` (que não tem RLS por ser
   * a raiz do tenancy) e resolver a sessão pela função `resolver_sessao` da
   * Task 15. Qualquer outro uso é um convite a vazamento entre clínicas — hoje
   * a RLS devolve silêncio (zero linhas); numa tabela futura sem RLS seria
   * vazamento de verdade.
   */
  async semIsolamentoDeClinica<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) {
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
    let erro: unknown
    try {
      await c.query('BEGIN')
      await c.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinicaId])
      const r = await fn(c)
      await c.query('COMMIT')
      return r
    } catch (e) {
      erro = e
      // Melhor-esforço: se o ROLLBACK falhar (ex.: conexão já morta), a
      // conexão vai ser descartada do pool mesmo — mas o erro original é o
      // que importa para quem depura, não o do ROLLBACK que só confirma que
      // ela já estava morta.
      try {
        await c.query('ROLLBACK')
      } catch {
        // engolido de propósito — ver comentário acima
      }
      throw e
    } finally {
      // `release(erro)` avisa o node-postgres para descartar a conexão em vez
      // de devolvê-la ao pool como boa. Sem o argumento, uma conexão morta
      // (por exemplo, por falha no COMMIT/ROLLBACK) voltaria ao pool e a
      // próxima requisição que a pegasse falharia sem motivo aparente.
      // `release` só aceita `Error | boolean`; `erro` é `unknown` porque
      // `catch` não garante o tipo — por isso o `instanceof`.
      if (erro === undefined) c.release()
      else c.release(erro instanceof Error ? erro : true)
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end()
  }
}
