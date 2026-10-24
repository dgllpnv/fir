/**
 * Aplica as migrations em ordem, uma vez cada, dentro de uma transação por
 * arquivo. Forward-only: uma migration aplicada nunca é editada.
 *
 * Roda como `fir_migrate`, nunca como superusuário — rodar migration com
 * superusuário faz tudo passar, e passar assim esconde os erros de permissão
 * que aparecem só no primeiro deploy.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { nomesForaDoPadrao } from './src/migracoes/nome-de-migration'

const AQUI = dirname(fileURLToPath(import.meta.url))
const PASTA = join(AQUI, 'migrations')

const url =
  process.env['DATABASE_URL_MIGRATE'] ??
  'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const cliente = new pg.Client({ connectionString: url })
await cliente.connect()

await cliente.query(`
  CREATE TABLE IF NOT EXISTS migrations_aplicadas (
    nome       text PRIMARY KEY,
    aplicada_em timestamptz NOT NULL DEFAULT now()
  )
`)

// O ALTER DEFAULT PRIVILEGES do bootstrap concede SELECT/INSERT/UPDATE/DELETE
// a `fir_app` em toda tabela que `fir_migrate` criar — inclusive esta, que não
// é de negócio e não tem o que ver com a API. A API não tem o que fazer com o
// livro-razão das migrations: apagar uma linha aqui faz o próximo deploy
// reaplicar uma migration já aplicada. REVOKE de um privilégio que o papel não
// tem é inofensivo, então isto é seguro de rodar em toda subida.
await cliente.query('REVOKE ALL ON migrations_aplicadas FROM fir_app')

const { rows } = await cliente.query<{ nome: string }>('SELECT nome FROM migrations_aplicadas')
const jaAplicadas = new Set(rows.map((r) => r.nome))

// Validação do nome em `src/migracoes/nome-de-migration.ts` — pura e com
// teste próprio, porque este arquivo é um script de topo (conecta no
// Postgres na importação) e não é importável por teste nenhum.
const todos = await readdir(PASTA)
const foraDoPadrao = nomesForaDoPadrao(todos)
if (foraDoPadrao.length > 0) {
  process.stderr.write(
    `ERRO: nome(s) de migration fora do padrão: ${foraDoPadrao.join(', ')}\n` +
      'O padrão é 0000_nome_em_minusculas.sql — quatro dígitos, sublinhado, ' +
      '[a-z0-9_], .sql. A ordem de aplicação é a ordem alfabética do nome, e ' +
      'ela só coincide com a ordem numérica quando todos têm quatro dígitos.\n',
  )
  await cliente.end()
  process.exit(1)
}

const arquivos = todos.sort()
let aplicadas = 0

for (const nome of arquivos) {
  if (jaAplicadas.has(nome)) continue
  const sql = await readFile(join(PASTA, nome), 'utf8')
  process.stdout.write(`==> ${nome}\n`)
  try {
    await cliente.query('BEGIN')
    await cliente.query(sql)
    await cliente.query('INSERT INTO migrations_aplicadas (nome) VALUES ($1)', [nome])
    await cliente.query('COMMIT')
    aplicadas++
  } catch (e) {
    await cliente.query('ROLLBACK')
    process.stderr.write(`ERRO em ${nome}: ${(e as Error).message}\n`)
    await cliente.end()
    process.exit(1)
  }
}

process.stdout.write(
  aplicadas === 0 ? 'banco já está na versão mais recente\n' : `${aplicadas} migration(s) aplicada(s)\n`,
)
await cliente.end()
