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

const { rows } = await cliente.query<{ nome: string }>('SELECT nome FROM migrations_aplicadas')
const jaAplicadas = new Set(rows.map((r) => r.nome))

const arquivos = (await readdir(PASTA)).filter((f) => f.endsWith('.sql')).sort()
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
