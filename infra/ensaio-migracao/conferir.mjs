// Conferencia da subida das migrations 0067-0070 (grupo Firmare / clinica em varios grupos).
// SOMENTE LEITURA: toda consulta roda em BEGIN READ ONLY e so ha SELECT.
//
//   node conferir.mjs foto <connstr> <arquivo.json>      foto do estado (antes ou depois)
//   node conferir.mjs comparar <connstr> <antes.json>    compara o banco atual com a foto "antes"
//   node conferir.mjs identica <a.json> <b.json>         duas fotos sem diferenca (idempotencia)
//
// Saida != 0 se algo divergir. A foto guarda ids, grupo_id, contagens e somas;
// nenhum dado pessoal. Conecte com o papel dono do banco (atravessa a RLS).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const AQUI = dirname(fileURLToPath(import.meta.url))
const load = (m) => {
  for (const base of [join(AQUI, '../../apps/api/package.json'), join(process.cwd(), 'package.json')]) {
    try { return createRequire(base)(m) } catch { /* tenta o proximo */ }
  }
  throw new Error('modulo ' + m + ' nao encontrado (rode de dentro do repositorio ou do container da api)')
}
const ident = (s) => '"' + s.replace(/"/g, '""') + '"'
const sha = (linhas) => createHash('sha256').update(linhas.join('\n')).digest('hex')

async function tirarFoto(connstr) {
  const pg = load('pg')
  const c = new pg.Client({ connectionString: connstr })
  await c.connect()
  await c.query('BEGIN READ ONLY')
  const q = async (s, p) => (await c.query(s, p)).rows
  try {
    const tabelas = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`)).map((r) => r.table_name)
    const colunas = {}
    for (const r of await q(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`)) (colunas[r.table_name] ??= new Set()).add(r.column_name)
    const foto = { versao: 1, contagens: {}, porGrupo: {}, linhas: {}, hash: {}, grupos: {}, clinicas: [], mrr: {}, firmare: null }
    for (const t of tabelas) {
      foto.contagens[t] = Number((await q(`SELECT count(*) n FROM ${ident(t)}`))[0].n)
      if (colunas[t].has('grupo_id')) {
        const temId = colunas[t].has('id')
        const rows = await q(`SELECT ${temId ? 'id::text' : `'-'`} id, grupo_id::text g FROM ${ident(t)} ORDER BY 1, 2`)
        foto.linhas[t] = Object.fromEntries(rows.map((r, i) => [temId ? r.id : 'n' + i, r.g]))
        const pgp = {}
        for (const r of rows) pgp[r.g ?? 'null'] = (pgp[r.g ?? 'null'] ?? 0) + 1
        foto.porGrupo[t] = pgp
        foto.hash[t] = sha(rows.map((r) => r.id + ':' + r.g))
      }
    }
    // O historico de grupo nao tem coluna grupo_id, mas "para onde a clinica foi" tambem nao pode mudar.
    if (colunas.historico_grupo_da_clinica) {
      const rows = await q(`SELECT id::text, clinica_id::text||'>'||grupo_novo_id::text v FROM historico_grupo_da_clinica ORDER BY 1`)
      foto.linhas.historico_grupo_da_clinica = Object.fromEntries(rows.map((r) => [r.id, r.v]))
      foto.hash.historico_grupo_da_clinica = sha(rows.map((r) => r.id + ':' + r.v))
    }
    foto.grupos = Object.fromEntries((await q(`SELECT id::text, nome FROM grupos ORDER BY 1`)).map((r) => [r.id, r.nome]))
    foto.clinicas = (await q(`SELECT id::text, ativa FROM clinicas ORDER BY 1`)).map((r) => ({ id: r.id, ativa: r.ativa }))
    // MRR: soma de mensalidade onde conta na receita. Antes da 0068 a coluna nao existe e todo cliente conta.
    const tem = colunas.clientes_carteira?.has('conta_na_receita')
    const filtro = tem ? 'AND conta_na_receita' : ''
    const m = await q(`SELECT grupo_id::text g, coalesce(sum(mensalidade_centavos),0)::text s FROM clientes_carteira WHERE excluido_em IS NULL ${filtro} GROUP BY 1 ORDER BY 1`)
    foto.mrr = { porGrupo: Object.fromEntries(m.map((r) => [r.g, r.s])), total: m.reduce((a, r) => a + BigInt(r.s), 0n).toString(), contaNaReceita: !!tem }
    foto.firmareExistiaPorNome = Object.values(foto.grupos).includes('Firmare')
    if (colunas.grupos.has('padrao')) {
      const f = await q(`SELECT id::text FROM grupos WHERE padrao`)
      foto.firmare = f[0]?.id ?? null
      if (foto.firmare) {
        foto.participacaoAtiva = (await q(`SELECT clinica_id::text FROM participacao_clinica_grupo WHERE grupo_id=$1 AND ate IS NULL ORDER BY 1`, [foto.firmare])).map((r) => r.clinica_id)
        foto.clientesFirmare = await q(
          `SELECT id::text, clinica_id::text, mensalidade_centavos::text mens, conta_na_receita cnr, status,
             (responsavel_usuario_gestao_id IS NULL AND link_painel IS NULL AND link_dash_ind IS NULL AND link_dash_fin IS NULL
              AND link_rotina IS NULL AND lead_origem_id IS NULL AND segmento IS NULL AND cidade IS NULL AND decisor IS NULL
              AND aniversario_decisor_dia IS NULL AND telefone IS NULL AND email IS NULL AND cnpj IS NULL AND area_foco IS NULL
              AND projeto IS NULL AND pagador IS NULL AND observacoes IS NULL AND telefone_cobranca IS NULL
              AND cardinality(servicos)=0) vazio
           FROM clientes_carteira WHERE grupo_id=$1 AND excluido_em IS NULL ORDER BY 1`, [foto.firmare])
      }
    }
    return foto
  } finally {
    await c.query('ROLLBACK')
    await c.end()
  }
}

const AUDITORIA = /^auditoria|_auditoria$/
function comparar(antes, depois) {
  const falhas = []
  const infos = []
  const f = (m) => falhas.push(m)
  const N = depois.clinicas.length
  if (!depois.firmare) f('nao ha grupo padrao (Firmare) depois')

  // 1. Nenhuma linha antiga mudou de grupo_id (nem sumiu)
  for (const t of Object.keys(antes.linhas)) {
    if (!depois.linhas[t]) { f(`tabela ${t} sumiu`); continue }
    let movidas = 0
    let sumidas = 0
    for (const [id, g] of Object.entries(antes.linhas[t])) {
      if (!(id in depois.linhas[t])) sumidas++
      else if (depois.linhas[t][id] !== g) movidas++
    }
    if (movidas || sumidas) f(`${t}: ${movidas} linha(s) mudaram de grupo_id e ${sumidas} sumiram`)
    const ids = Object.keys(antes.linhas[t])
    if (sha(ids.map((id) => id + ':' + antes.linhas[t][id])) !== sha(ids.map((id) => id + ':' + depois.linhas[t][id]))) {
      f(`${t}: hash de (id, grupo_id) das linhas antigas difere`)
    }
  }

  // 2. Contagens: so muda o que o backfill e as migrations acrescentam de proposito
  const esperado = {
    clientes_carteira: N, // 1 Cliente Firmare por clinica
    historico_grupo_da_clinica: N, // 1 linha de historico por participacao nova
    // 0067 cria o Firmare; 0068 cria o grupo de arquivo inativo 'Encerrados'. Nenhum outro grupo nasce.
    grupos: (antes.firmareExistiaPorNome ? 0 : 1) + (Object.values(antes.grupos).includes('Encerrados') ? 0 : 1),
  }
  const nomesNovos = Object.entries(depois.grupos).filter(([id]) => !(id in antes.grupos)).map(([, n]) => n).sort().join(',')
  const nomesEsperados = [antes.firmareExistiaPorNome ? null : 'Firmare', Object.values(antes.grupos).includes('Encerrados') ? null : 'Encerrados'].filter(Boolean).sort().join(',')
  if (nomesNovos !== nomesEsperados) f(`grupos novos: [${nomesNovos}], esperado [${nomesEsperados}]`)
  for (const [t, n0] of Object.entries(antes.contagens)) {
    if (t === 'migrations_aplicadas') continue
    const d = (depois.contagens[t] ?? 0) - n0
    const e = esperado[t] ?? 0
    if (d === e) continue
    if (AUDITORIA.test(t) && d > 0) { infos.push(`${t}: +${d} (trilha de auditoria dos acrescimos)`); continue }
    f(`${t}: contagem ${n0} -> ${depois.contagens[t]} (delta ${d}, esperado ${e})`)
  }
  for (const t of Object.keys(depois.contagens)) {
    if (!(t in antes.contagens) && t !== 'participacao_clinica_grupo' && depois.contagens[t] > 0 && !AUDITORIA.test(t)) {
      f(`tabela nova ${t} com ${depois.contagens[t]} linha(s) nao esperada(s)`)
    }
  }
  for (const t of Object.keys(antes.porGrupo)) {
    if (AUDITORIA.test(t)) continue
    const todosGrupos = new Set([...Object.keys(antes.porGrupo[t]), ...Object.keys(depois.porGrupo[t] ?? {})])
    for (const g of todosGrupos) {
      const a = antes.porGrupo[t][g] ?? 0
      const d = depois.porGrupo[t]?.[g] ?? 0
      if (g === depois.firmare) {
        if (t !== 'clientes_carteira' && d !== 0) f(`${t}: ${d} linha(s) no grupo Firmare (so clientes_carteira deveria ter)`)
      } else if (a !== d) f(`${t}: grupo ${g} contagem ${a} -> ${d}`)
    }
  }

  // 3. Firmare: toda clinica participa; cliente novo vazio, mensalidade 0, fora da receita
  if (depois.firmare) {
    const part = new Set(depois.participacaoAtiva)
    for (const cl of depois.clinicas) if (!part.has(cl.id)) f(`clinica ${cl.id} (ativa=${cl.ativa}) nao participa do Firmare`)
    if (depois.participacaoAtiva.length !== N) f(`participacoes ativas no Firmare: ${depois.participacaoAtiva.length}, esperado ${N}`)
    const porClinica = {}
    for (const cli of depois.clientesFirmare) (porClinica[cli.clinica_id] ??= []).push(cli)
    for (const cl of depois.clinicas) {
      const l = porClinica[cl.id] ?? []
      if (l.length !== 1) f(`clinica ${cl.id}: ${l.length} Cliente(s) no Firmare (esperado 1)`)
    }
    const novos = depois.clientesFirmare.filter((x) => !(antes.linhas.clientes_carteira ?? {})[x.id])
    if (novos.length !== N) f(`clientes Firmare novos: ${novos.length}, esperado ${N}`)
    for (const x of novos) {
      if (x.mens !== '0') f(`cliente Firmare ${x.id}: mensalidade ${x.mens} (esperado 0)`)
      if (x.cnr !== false) f(`cliente Firmare ${x.id}: conta_na_receita=${x.cnr} (esperado false)`)
      if (!x.vazio) f(`cliente Firmare ${x.id}: tem dado copiado (contato, responsavel ou observacao)`)
    }
    infos.push(`participacao_clinica_grupo total: ${depois.contagens.participacao_clinica_grupo ?? 0} (as semeadas pela 0068 a partir dos clientes existentes + ${N} do Firmare)`)
  }

  // 4. MRR identico, no geral e por grupo
  if (antes.mrr.total !== depois.mrr.total) f(`MRR do geral: ${antes.mrr.total} -> ${depois.mrr.total}`)
  for (const g of new Set([...Object.keys(antes.mrr.porGrupo), ...Object.keys(depois.mrr.porGrupo)])) {
    if (g === depois.firmare) {
      if ((depois.mrr.porGrupo[g] ?? '0') !== '0') f('MRR do grupo Firmare != 0')
      continue
    }
    if ((antes.mrr.porGrupo[g] ?? '0') !== (depois.mrr.porGrupo[g] ?? '0')) f(`MRR do grupo ${g}: ${antes.mrr.porGrupo[g]} -> ${depois.mrr.porGrupo[g]}`)
  }
  return { falhas, infos }
}

const [modo, a, b] = process.argv.slice(2)
try {
  if (modo === 'foto' && a && b) {
    const foto = await tirarFoto(a)
    writeFileSync(b, JSON.stringify(foto, null, 1))
    console.log(`foto gravada em ${b}: ${Object.keys(foto.contagens).length} tabelas, MRR ${foto.mrr.total}`)
  } else if (modo === 'comparar' && a && b) {
    const antes = JSON.parse(readFileSync(b, 'utf8'))
    const depois = await tirarFoto(a)
    const { falhas, infos } = comparar(antes, depois)
    console.log(`MRR antes ${antes.mrr.total} | depois ${depois.mrr.total}`)
    console.log(`clientes_carteira ${antes.contagens.clientes_carteira} -> ${depois.contagens.clientes_carteira}; grupos ${antes.contagens.grupos} -> ${depois.contagens.grupos}`)
    infos.forEach((i) => console.log('info: ' + i))
    if (falhas.length) {
      falhas.forEach((x) => console.error('DIVERGE: ' + x))
      console.error(`REPROVADO: ${falhas.length} divergencia(s)`)
      process.exit(1)
    }
    console.log('APROVADO: nada mudou de lugar; so o que o backfill acrescenta de proposito')
  } else if (modo === 'identica' && a && b) {
    const x = JSON.parse(readFileSync(a, 'utf8'))
    const y = JSON.parse(readFileSync(b, 'utf8'))
    const dif = []
    for (const t of new Set([...Object.keys(x.contagens), ...Object.keys(y.contagens)])) {
      if (t !== 'migrations_aplicadas' && x.contagens[t] !== y.contagens[t]) dif.push(`${t}: ${x.contagens[t]} -> ${y.contagens[t]}`)
    }
    for (const t of Object.keys(x.hash)) if (x.hash[t] !== y.hash[t]) dif.push(`hash ${t} difere`)
    if (x.mrr.total !== y.mrr.total) dif.push('MRR difere')
    if (dif.length) { dif.forEach((d) => console.error('DIVERGE: ' + d)); process.exit(1) }
    console.log('IDENTICAS: a execucao seguinte nao acrescentou nada')
  } else {
    console.error('uso: conferir.mjs foto <conn> <arq> | comparar <conn> <antes.json> | identica <a.json> <b.json>')
    process.exit(2)
  }
} catch (e) {
  console.error('ERRO: ' + e.message)
  process.exit(3)
}
