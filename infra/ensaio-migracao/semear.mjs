// Semeia dados 100% sinteticos com a FORMA da producao pre-0067:
// 4 clinicas ativas, 3 grupos, 1 Cliente Firmare por clinica em algum grupo,
// 4 usuarios_gestao de escopo grupo, 1 operador, historico de grupo, filhas.
// Uso: node semear.mjs <connstr>   (banco DESCARTAVEL; escreve)
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const req = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../apps/api/package.json'))
const pg = req('pg')
const c = new pg.Client({ connectionString: process.argv[2] })
await c.connect()
const q = async (s, p) => (await c.query(s, p)).rows
await c.query('BEGIN')
const [op] = await q(`INSERT INTO operadores (usuario, nome, senha_hash) VALUES ('operador.teste','Operador Sintetico','x') RETURNING id`)
await c.query(`SELECT set_config('app.pessoa_id', $1, true)`, ['operador:' + op.id])
const grupos = []
for (const n of ['Grupo Alfa', 'Grupo Beta', 'Grupo Gama']) grupos.push((await q(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [n]))[0].id)
const mens = [150000, 99050, 250001, 33333]
const destino = [0, 0, 1, 2] // clinica i -> grupo
const clinicas = [], clientes = [], ug = []
for (let i = 0; i < 4; i++) {
  const cl = (await q(`INSERT INTO clinicas (codigo, nome) VALUES ($1,$2) RETURNING id`, ['sint-' + (i + 1), 'Clinica Sintetica ' + (i + 1)]))[0].id
  clinicas.push(cl)
  await q(`INSERT INTO historico_grupo_da_clinica (clinica_id, grupo_anterior_id, grupo_novo_id, mudado_por, motivo) VALUES ($1,NULL,$2,$3,'seed')`, [cl, grupos[destino[i]], op.id])
  clientes.push((await q(`INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status, mensalidade_centavos, dia_vencimento) VALUES ($1,$2,$3,'FIR Clinic','ativo',$4,10) RETURNING id`, [grupos[destino[i]], cl, 'Clinica Sintetica ' + (i + 1), mens[i]]))[0])
}
// cliente sem clinica, em outro grupo
const solto = (await q(`INSERT INTO clientes_carteira (grupo_id, nome, produto, status, mensalidade_centavos) VALUES ($1,'Cliente Sintetico Sem Clinica','Consultoria','ativo',70000) RETURNING id`, [grupos[1]]))[0]
for (let i = 0; i < 4; i++) {
  const g = destino[(i + 0)]
  ug.push((await q(`INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id, administrar) VALUES ($1,$2,'x','grupo',$3,false) RETURNING id`, ['usuario.sint' + (i + 1), 'Usuario Sintetico ' + (i + 1), grupos[[0, 1, 2, 0][i]]]))[0].id)
}
const todos = [...clientes, solto]
const gOf = (cli) => cli === solto ? grupos[1] : grupos[destino[clientes.indexOf(cli)]]
for (const [k, cli] of todos.entries()) {
  const g = gOf(cli)
  const u = ug.find((_, j) => [0, 1, 2, 0][j] === grupos.indexOf(g)) ?? ug[0]
  for (let r = 0; r < 2 + k; r++)
    await q(`INSERT INTO reunioes_comerciais (cliente_carteira_id, grupo_id, data, resumo, por_usuario_gestao_id) VALUES ($1,$2,$3,$4,$5)`, [cli.id, g, `2026-0${1 + r}-1${k}`, `Reuniao sintetica ${k}-${r}`, u])
  await q(`INSERT INTO parceiros_do_cliente (grupo_id, cliente_carteira_id, frente, nome) VALUES ($1,$2,'financeiro',$3)`, [g, cli.id, 'Parceiro Sintetico ' + k])
  const t = (await q(`INSERT INTO tarefas_internas (titulo, grupo_id, cliente_carteira_id, responsavel_usuario_gestao_id, prazo) VALUES ($1,$2,$3,$4,'2026-12-01') RETURNING id`, ['Tarefa sintetica ' + k, g, cli.id, u]))[0].id
  for (let o = 1; o <= 3; o++) await q(`INSERT INTO itens_de_tarefa_interna (tarefa_interna_id, grupo_id, ordem, rotulo, cliente_carteira_id) VALUES ($1,$2,$3,$4,$5)`, [t, g, o, 'Item ' + o, cli.id])
  await q(`INSERT INTO campanhas_carteira (cliente_carteira_id, grupo_id, origem, nome, periodo_inicio, periodo_fim, metrica, meta, mes_referencia, receita_centavos) VALUES ($1,$2,'manual',$3,'2026-10-01','2026-10-31','convertidos',10,'2026-10-01',$4)`, [cli.id, g, 'Campanha sintetica ' + k, 12345 + k])
  for (const m of ['2026-09-01', '2026-10-01'])
    await q(`INSERT INTO cobrancas_do_cliente_firmare (cliente_carteira_id, grupo_id, competencia, mensalidade_centavos, valor_centavos, vencimento) VALUES ($1,$2,$3,$4,$4,$3)`, [cli.id, g, m, mens[k] ?? 70000])
}
await c.query('COMMIT')
console.log(JSON.stringify({ operador: op.id }))
await c.end()
