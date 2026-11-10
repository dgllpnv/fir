// Aplica migrations de apps/api/migrations em ordem, de A ate B (inclusive).
// Mesma logica do runner (migrar.ts): uma transacao por arquivo, livro-razao
// migrations_aplicadas. Uso: node aplicar-ate.mjs <connstr> <ultimo-prefixo> [<primeiro-prefixo>]
// So para banco descartavel de ensaio.
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const AQUI = dirname(fileURLToPath(import.meta.url))
const req = createRequire(join(AQUI, '../../apps/api/package.json'))
const pg = req('pg')
const [url, ate, de = '0000'] = process.argv.slice(2)
if (!url || !ate) { console.error('uso: aplicar-ate.mjs <connstr> <ultimo> [<primeiro>]'); process.exit(2) }
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query(`CREATE TABLE IF NOT EXISTS migrations_aplicadas (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`)
await c.query('REVOKE ALL ON migrations_aplicadas FROM fir_app')
const ja = new Set((await c.query('SELECT nome FROM migrations_aplicadas')).rows.map(r => r.nome))
const pasta = join(AQUI, '../../apps/api/migrations')
for (const nome of (await readdir(pasta)).sort()) {
  const p = nome.slice(0, 4)
  if (p < de || p > ate || ja.has(nome)) continue
  try {
    await c.query('BEGIN'); await c.query(await readFile(join(pasta, nome), 'utf8'))
    await c.query('INSERT INTO migrations_aplicadas (nome) VALUES ($1)', [nome]); await c.query('COMMIT')
    console.log('==> ' + nome)
  } catch (e) { await c.query('ROLLBACK'); console.error('ERRO em ' + nome + ': ' + e.message); await c.end(); process.exit(1) }
}
await c.end()
