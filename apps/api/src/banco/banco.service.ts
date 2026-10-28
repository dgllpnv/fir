import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import pg from 'pg'
import { type Ator, type OperadorId, atorParaOBanco } from './ator'
import type { ClinicaId } from './clinica-id'

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
   * O pool do PAINEL — segunda conexão, **autenticada** como `fir_painel`.
   *
   * Não é `SET ROLE` sobre o pool do produto, e a diferença é a D-5,
   * restrição 5: `RESET ROLE` desfaz na mesma transação. Com dois pools
   * autenticados, o privilégio de criar clínica **não existe** na conexão que
   * serve o balcão — nem por engano, nem por injeção.
   *
   * E `fir_painel` **não tem `BYPASSRLS`** (D-10): ele fixa `app.clinica_id`
   * da clínica em que opera, como qualquer um. A migration 0013 recusa migrar
   * se alguém lhe der o privilégio.
   *
   * `max: 3`: o painel é usado por duas pessoas, algumas vezes por semana.
   * Dar a ele dez conexões seria tirar dez do Postgres que serve quatro
   * clínicas.
   */
  private readonly poolDoPainel = new pg.Pool({
    connectionString:
      process.env['DATABASE_URL_PAINEL'] ??
      'postgresql://fir_painel:fir_local_dev@127.0.0.1:4832/fir',
    max: 3,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 20_000,
  })

  constructor() {
    this.poolDoPainel.on('error', (erro) => {
      console.error('[banco:painel] conexão ociosa do pool encerrada pelo servidor:', erro.message)
    })
    // Sem este listener, a API inteira morria quando o Postgres encerrava
    // uma conexão ociosa do pool — medido ao parar o container de verdade:
    //
    //   node:events:497
    //         throw er; // Unhandled 'error' event
    //   error: terminating connection due to administrator command
    //   Emitted 'error' event on BoundPool instance at:
    //       at Client.idleListener (pg-pool/index.js:62:10)
    //
    // O `pg` emite `'error'` no cliente OCIOSO sempre que o servidor encerra
    // a conexão por fora (reinício do Postgres, `pg_terminate_backend`,
    // queda de rede) — não é exclusivo de `docker stop`. Um `EventEmitter`
    // que emite `'error'` sem listener lança e derruba o processo Node
    // inteiro, inclusive o healthcheck que existe exatamente para avisar
    // desse cenário. O próprio pool já descarta o cliente quebrado; só falta
    // registrar o evento para o operador ver. Nunca logar a connection
    // string nem a senha — só a mensagem do erro.
    this.pool.on('error', (erro) => {
      console.error('[banco] conexão ociosa do pool encerrada pelo servidor:', erro.message)
    })
  }

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
   * Abre uma transação, fixa `app.clinica_id` e `app.pessoa_id` nela, e executa.
   *
   * `SET LOCAL` e não `SET`: o escopo é a transação, então uma conexão
   * devolvida ao pool nunca carrega a clínica — nem o ATOR — da requisição
   * anterior. Essa é a diferença entre isolamento e um vazamento intermitente
   * que só aparece sob carga.
   *
   * `ClinicaId`, não `string`: ver `clinica-id.ts`. Com `string`, um
   * `naClinica(corpo.clinicaId, ...)` compilava, a RLS obedecia ao valor
   * fixado e a requisição lia a clínica que o navegador escolheu.
   *
   * O ATOR É OBRIGATÓRIO, e não opcional com padrão `SISTEMA`. Um parâmetro
   * opcional é esquecido em silêncio, e o padrão viraria "sistema" para
   * escrita humana: a trilha ficaria tecnicamente completa e factualmente
   * mentirosa — o pior dos dois mundos, porque uma trilha vazia a clínica
   * percebe e uma trilha errada ela acredita. Obrigatório, o compilador cobra
   * em cada chamada, e quem chama decide pensando.
   */
  async naClinica<T>(
    clinicaId: ClinicaId,
    ator: Ator,
    fn: (c: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.emTransacao(this.pool, ator, async (c) => {
      await fixarClinicaNa(c, clinicaId)
      return fn(c)
    })
  }

  /**
   * Como `naClinica`, e com a MESMA assinatura de três argumentos — porque é
   * a mesma coisa: fixa `app.clinica_id` e `app.pessoa_id` e roda dentro de
   * uma transação. O que muda é **quem** está conectado.
   *
   * Não existe variante sem clínica de uso geral. O superadmin fixa a clínica
   * em que opera, como qualquer um (D-10), e a RLS daquela clínica vale para
   * ele exatamente como vale para a recepção — provado em
   * `contexto-do-ator.test.ts`, onde a aplicação erra de propósito e é o
   * banco que recusa.
   */
  async comoPainel<T>(
    clinicaId: ClinicaId,
    ator: OperadorId,
    fn: (c: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.emTransacao(this.poolDoPainel, ator, async (c) => {
      await fixarClinicaNa(c, clinicaId)
      return fn(c)
    })
  }

  /**
   * A ÚNICA entrada do painel que começa sem clínica — e ela existe por um
   * motivo mecânico: no instante do `INSERT INTO clinicas` a clínica ainda
   * não tem id, e `SET LOCAL app.clinica_id` precisa de um.
   *
   * Ela **não** é um atalho para escapar da RLS. Sem `fixarClinica`, a
   * transação enxerga um banco vazio — toda tabela de negócio tem RLS, e
   * `app_clinica_id()` NULL nega tudo. O que ela alcança é `clinicas`, que
   * não tem RLS por ser a raiz do tenancy e cujo `INSERT` só `fir_painel`
   * tem.
   *
   * O nome é longo de propósito: quem for usá-la para outra coisa tem de
   * escrever "criando clínica" numa chamada que não cria clínica nenhuma, e
   * isso aparece na revisão.
   */
  async comoPainelCriandoClinica<T>(
    ator: OperadorId,
    fn: (c: pg.PoolClient, fixarClinica: (id: ClinicaId) => Promise<void>) => Promise<T>,
  ): Promise<T> {
    return this.emTransacao(this.poolDoPainel, ator, (c) =>
      fn(c, (id) => fixarClinicaNa(c, id)),
    )
  }

  /**
   * O corpo compartilhado: abre a transação, declara o ATOR, roda, e devolve
   * a conexão ao pool com o cuidado que `release(erro)` exige.
   *
   * O ator entra aqui e a clínica não, porque a clínica é a única coisa que
   * difere entre as três portas acima — e repetir este bloco três vezes é
   * como uma das cópias deixa de fazer `ROLLBACK`.
   */
  private async emTransacao<T>(
    pool: pg.Pool,
    ator: Ator,
    fn: (c: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const c = await pool.connect()
    let erro: unknown
    try {
      await c.query('BEGIN')
      await c.query('SELECT set_config($1, $2, true)', ['app.pessoa_id', atorParaOBanco(ator)])
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
    await Promise.all([this.pool.end(), this.poolDoPainel.end()])
  }
}

/**
 * `SET LOCAL app.clinica_id`, num lugar só.
 *
 * `set_config(…, true)` — escopo de TRANSAÇÃO. Uma conexão devolvida ao pool
 * nunca carrega a clínica da requisição anterior; essa é a diferença entre
 * isolamento e um vazamento intermitente que só aparece sob carga.
 */
const fixarClinicaNa = async (c: pg.PoolClient, clinicaId: ClinicaId): Promise<void> => {
  await c.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinicaId])
}
