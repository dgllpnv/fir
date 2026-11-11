/**
 * Carga e conferência no Postgres LOCAL. Só entra em banco de loopback.
 *
 * Nada aqui imprime valor de dado: erros do `pg` carregam `detail` com o valor
 * da linha (`Key (nome)=(...)`), então todo erro é reduzido a código SQLSTATE,
 * nome da restrição e tabela antes de sair daqui.
 */
import {
  valoresDoDump,
  type Resultado,
  COLUNAS_DO_HASH,
  decidirClientes,
  hashDeConteudo,
  idDe,
  linhasDaCarga,
  ORDEM_DAS_TABELAS,
  planejar,
  proporCorrespondencias,
  type Candidato,
  type ClienteExistente,
  type Dump,
  type LinhaDeCarga,
  type Plano,
} from './nucleo'

export type ClienteSql = {
  query(
    texto: string,
    valores?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
}

export class ErroDeCarga extends Error {
  constructor(
    readonly codigo: string,
    readonly restricao?: string,
    readonly tabela?: string,
  ) {
    super(`erro_de_carga:${codigo}${restricao ? `:${restricao}` : ''}${tabela ? `:${tabela}` : ''}`)
    this.name = 'ErroDeCarga'
  }
}

export function reduzir(e: unknown, tabela?: string): ErroDeCarga {
  if (e instanceof ErroDeCarga) return e
  const x = (typeof e === 'object' && e !== null ? e : {}) as Record<string, unknown>
  return new ErroDeCarga(
    typeof x['code'] === 'string' ? x['code'] : 'desconhecido',
    typeof x['constraint'] === 'string' ? x['constraint'] : undefined,
    tabela,
  )
}

/**
 * Recusa qualquer destino que não seja loopback. Parâmetros de URL que trocam
 * o host (`?host=`) e host vazio (que cairia em PGHOST do ambiente) também.
 */
export function validarDestino(url: string): void {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new ErroDeCarga('destino_invalido')
  }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') throw new ErroDeCarga('destino_protocolo_invalido')
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') throw new ErroDeCarga('destino_nao_e_local')
  if (u.searchParams.has('host') || u.searchParams.has('hostaddr') || u.searchParams.has('service')) {
    throw new ErroDeCarga('destino_com_parametro_de_host')
  }
}

export async function carregarExistentes(cli: ClienteSql): Promise<ClienteExistente[]> {
  const r = await cli.query(
    'SELECT id::text AS id, grupo_id::text AS grupo, nome, cnpj FROM clientes_carteira WHERE excluido_em IS NULL',
  )
  return r.rows.map((x) => ({
    id: String(x['id']),
    grupoId: String(x['grupo']),
    nome: String(x['nome']),
    cnpj: x['cnpj'] === null ? null : String(x['cnpj']),
  }))
}

/**
 * Modo `--correspondencia`: SÓ LÊ. Transação `READ ONLY`, nada é gravado, e devolve
 * a tabela de correspondência PROPOSTA (origem -> candidato existente) para a dona
 * aprovar. Nunca funde: sem aprovação o cliente com candidato fica retido na carga.
 */
export async function gerarCorrespondencia(cli: ClienteSql, dump: Dump, grupoId?: string): Promise<{ clientes: number; propostas: (Candidato & { rotulo: string })[] }> {
  await cli.query('BEGIN READ ONLY')
  try {
    if (grupoId) await contexto(cli, 'clientes_carteira', grupoId)
    const existentes = await carregarExistentes(cli)
    const docs = dump.registros.filter((r) => r.colecao === 'clientes')
    const propostas = proporCorrespondencias(dump, existentes).map((c) => ({ ...c, rotulo: `cliente#${docs.findIndex((d) => d.id === c.origemId) + 1}` }))
    return { clientes: docs.length, propostas }
  } catch (e) {
    throw reduzir(e)
  } finally {
    await cli.query('ROLLBACK').catch(() => undefined)
  }
}

export type EstatisticaDaTabela = { inseridas: number; jaExistia: number; jaExistiaPorChave: number; textoDiferePorChave: number; colisao: number }
export type LinhaDeConferencia = { nome: string; origem: string; destino: string; ok: boolean; sensivel?: boolean }
export type ResultadoDaCarga = {
  plano: Plano
  candidatos: Candidato[]
  stats: Record<string, EstatisticaDaTabela>
  conferencia: LinhaDeConferencia[]
  pendencias: string[]
  commitado: boolean
  resultadoPorId: Map<string, string>
}

export type OpcoesDeCarga = {
  grupoId: string
  usuarioCargaId: string
  mapaUsuarios?: Record<string, string>
  aprovacoes?: Record<string, string>
  instanteDaCarga?: string
  /** Padrão: inclui as tabelas globais só se o papel atravessa a RLS (dono do esquema). */
  incluirGlobais?: boolean
}

async function inserir(cli: ClienteSql, l: LinhaDeCarga): Promise<'inserida' | 'ja_existia' | 'ja_existia_por_chave' | 'texto_difere' | 'colisao'> {
  const cols = Object.keys(l.cols)
  const valores = cols.map((c) => {
    const v = l.cols[c]
    return typeof v === 'bigint' ? v.toString() : v
  })
  const sql = `INSERT INTO ${l.tabela} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING`
  const r = await cli.query(sql, valores)
  if (r.rowCount === 1) return 'inserida'
  const mesmoId = await cli.query(`SELECT 1 FROM ${l.tabela} WHERE id = $1`, [l.id])
  if (mesmoId.rows.length > 0) return 'ja_existia'
  if (l.chaveNatural) {
    const hc = COLUNAS_DO_HASH[l.tabela] ?? []
    const q = await cli.query(
      `SELECT ${hc.map((c) => `"${c}"::text AS "${c}"`).join(', ')} FROM ${l.tabela} WHERE "${l.chaveNatural.coluna}" = $1`,
      [l.chaveNatural.valor],
    )
    const x = q.rows[0]
    if (x) return hashDeConteudo(hc.map((c) => x[c])) === l.hash ? 'ja_existia_por_chave' : 'texto_difere'
  }
  return 'colisao'
}

const TABELAS_COM_CLIENTE = new Set(['parceiros_do_cliente', 'planilhas_do_cliente', 'indicadores_carteira', 'metas_comerciais', 'reunioes_comerciais', 'tarefas_internas', 'itens_de_tarefa_interna', 'materiais_carteira'])

const mapaIgual = (a: Map<string, string>, b: Map<string, string>): boolean => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v)

/** Tabelas globais da Firmare: a policy de escrita (e a de leitura) exige escopo `geral`. */
const TABELAS_GLOBAIS = new Set(['mensagens_comerciais', 'roteiros_comerciais', 'materiais_da_biblioteca'])

/** Fixa o contexto de RLS da transação: `grupo` (só o grupo destino) e, só nas globais, `geral`. */
async function contexto(cli: ClienteSql, tabela: string, grupoId: string): Promise<void> {
  await cli.query(`SELECT set_config('app.escopo', $1, true), set_config('app.grupo_id', $2, true)`, [
    TABELAS_GLOBAIS.has(tabela) ? 'geral' : 'grupo',
    grupoId,
  ])
}

export type ExtraDeConferencia = { grupoId: string; resultadoPorId: ReadonlyMap<string, string> }

export async function conferir(
  cli: ClienteSql,
  dump: Dump,
  plano: Plano,
  stats: Record<string, EstatisticaDaTabela>,
  extra: ExtraDeConferencia,
): Promise<LinhaDeConferencia[]> {
  const L: LinhaDeConferencia[] = []
  const add = (nome: string, origem: string, destino: string, sensivel = false): void => {
    L.push({ nome, origem, destino, ok: origem === destino, ...(sensivel ? { sensivel } : {}) })
  }
  const linhas = linhasDaCarga(plano)
  const porTabela = new Map<string, LinhaDeCarga[]>()
  for (const l of linhas) porTabela.set(l.tabela, [...(porTabela.get(l.tabela) ?? []), l])

  // 0. reconciliação: todo documento lido tem um destino (§0.2)
  const colecoes = [...new Set(dump.registros.map((r) => r.colecao))].sort()
  add('reconciliacao:documentos_lidos', String(dump.registros.length), String(plano.resultados.length))
  for (const c of colecoes) {
    add(`reconciliacao:${c}`, String(dump.registros.filter((r) => r.colecao === c).length), String(plano.resultados.filter((r) => r.colecao === c).length))
  }

  for (const t of ORDEM_DAS_TABELAS) {
    const ls = porTabela.get(t) ?? []
    if (ls.length === 0) continue
    await contexto(cli, t, extra.grupoId)
    const ids = ls.map((l) => l.id)
    const s = stats[t]
    // 1. contagem: linhas reais no destino, e hash de conteúdo por registro
    const hc = COLUNAS_DO_HASH[t] ?? []
    const q = await cli.query(`SELECT id::text AS id, ${hc.map((c) => `"${c}"::text AS "${c}"`).join(', ')} FROM ${t} WHERE id = ANY($1::uuid[])`, [ids])
    const destino = new Map(q.rows.map((x) => [String(x['id']), hashDeConteudo(hc.map((c) => x[c]))]))
    add(`contagem:${t}`, String(ls.length), String(destino.size + (s?.jaExistiaPorChave ?? 0) + (s?.textoDiferePorChave ?? 0)))
    const origemHash = new Map(ls.filter((l) => destino.has(l.id)).map((l) => [l.id, l.hash]))
    add(`hash_de_conteudo:${t}`, `${origemHash.size} registros`, `${[...origemHash].filter(([k, v]) => destino.get(k) === v).length} registros`)
    add(`colisao_de_chave_de_negocio:${t}`, '0', String(s?.colisao ?? 0))

    // 2. por cliente
    if (TABELAS_COM_CLIENTE.has(t) && !s?.jaExistiaPorChave) {
      const o = new Map<string, string>()
      for (const l of ls) if (destino.has(l.id)) o.set(String(l.cols['cliente_carteira_id']), String((Number(o.get(String(l.cols['cliente_carteira_id']))) || 0) + 1))
      const d = await cli.query(`SELECT cliente_carteira_id::text AS c, count(*)::text AS n FROM ${t} WHERE id = ANY($1::uuid[]) GROUP BY 1`, [ids])
      const dm = new Map(d.rows.map((x) => [String(x['c']), String(x['n'])]))
      add(`por_cliente:${t}`, `${o.size} clientes, ${[...o.values()].reduce((a, b) => a + Number(b), 0)} linhas`, mapaIgual(o, dm) ? `${o.size} clientes, ${[...o.values()].reduce((a, b) => a + Number(b), 0)} linhas` : `divergente (${dm.size} clientes)`)
    }
  }

  await contexto(cli, 'tarefas_internas', extra.grupoId)
  // 3. tarefas por status; reuniões por tipo e compartilhada
  const tarefas = porTabela.get('tarefas_internas') ?? []
  if (tarefas.length > 0) {
    const o = new Map<string, string>()
    for (const l of tarefas) o.set(String(l.cols['status']), String(Number(o.get(String(l.cols['status'])) ?? 0) + 1))
    const d = await cli.query('SELECT status, count(*)::text AS n FROM tarefas_internas WHERE id = ANY($1::uuid[]) GROUP BY 1', [tarefas.map((l) => l.id)])
    const dm = new Map(d.rows.map((x) => [String(x['status']), String(x['n'])]))
    add('tarefas_por_status', [...o].sort().map(([k, v]) => `${k}=${v}`).join(' '), [...dm].sort().map(([k, v]) => `${k}=${v}`).join(' '))
    const r2 = await cli.query('SELECT count(*) FILTER (WHERE concluida_em IS NOT NULL)::text AS n FROM tarefas_internas WHERE id = ANY($1::uuid[])', [tarefas.map((l) => l.id)])
    add('tarefas_com_concluida_em', String(tarefas.filter((l) => l.cols['concluida_em'] !== null).length), String(r2.rows[0]?.['n']))
  }
  const reunioes = porTabela.get('reunioes_comerciais') ?? []
  if (reunioes.length > 0) {
    const o = new Map<string, number>()
    for (const l of reunioes) o.set(`${String(l.cols['tipo'])}/${String(l.cols['compartilhada'])}`, (o.get(`${String(l.cols['tipo'])}/${String(l.cols['compartilhada'])}`) ?? 0) + 1)
    const d = await cli.query('SELECT tipo || \'/\' || compartilhada::text AS k, count(*)::int AS n FROM reunioes_comerciais WHERE id = ANY($1::uuid[]) GROUP BY 1', [reunioes.map((l) => l.id)])
    add('reunioes_por_tipo_e_compartilhada', [...o].sort().map(([k, v]) => `${k}=${v}`).join(' '), d.rows.map((x) => `${String(x['k'])}=${String(x['n'])}`).sort().join(' '))
  }

  // 4. mensalidade (MRR) por cliente e total, em centavos, exata
  const clientes = porTabela.get('clientes_carteira') ?? []
  if (clientes.length > 0) {
    const esperado = new Map(Object.entries(plano.alvos.mrrCentavosPorCliente).map(([k, v]) => [idDe('clientes', k), v]))
    const d = await cli.query('SELECT id::text AS id, mensalidade_centavos::text AS m FROM clientes_carteira WHERE id = ANY($1::uuid[])', [clientes.map((l) => l.id)])
    const dm = new Map(d.rows.map((x) => [String(x['id']), x['m'] === null ? null : BigInt(String(x['m']))]))
    const divergentes = [...esperado].filter(([k, v]) => dm.get(k) !== v).length
    add('mensalidade_por_cliente_divergentes', '0', String(divergentes))
    const somaO = [...esperado.values()].reduce((a, b) => a + b, 0n)
    const somaD = [...esperado.keys()].reduce((a, k) => a + (dm.get(k) ?? 0n), 0n)
    add('mensalidade_total_em_centavos', somaO.toString(), somaD.toString(), true)
    // receita: P-18 — a carga não gera cobrança paga
    const c = await cli.query('SELECT count(*)::text AS n, coalesce(sum(valor_centavos), 0)::text AS s FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = ANY($1::uuid[])', [clientes.map((l) => l.id)])
    add('cobrancas_geradas_pela_carga (P-18: zero receita)', '0 linhas, 0 centavos', `${String(c.rows[0]?.['n'])} linhas, ${String(c.rows[0]?.['s'])} centavos`)
    const pg = await cli.query("SELECT count(*)::text AS n FROM cobrancas_do_cliente_firmare WHERE status = 'pago' AND cliente_carteira_id = ANY($1::uuid[])", [clientes.map((l) => l.id)])
    add('cobrancas_pagas_geradas_pela_carga (receita = 0)', '0', String(pg.rows[0]?.['n']))
  }

  // 5. check-ins somados por indicador e total
  const lanc = porTabela.get('lancamentos_de_indicador') ?? []
  if (lanc.length > 0) {
    const o = new Map<string, bigint>()
    for (const l of lanc) {
      const v = (l.cols['valor_centavos'] ?? l.cols['valor_inteiro']) as bigint
      o.set(String(l.cols['indicador_id']), (o.get(String(l.cols['indicador_id'])) ?? 0n) + v)
    }
    const d = await cli.query('SELECT indicador_id::text AS i, coalesce(sum(coalesce(valor_centavos, valor_inteiro)), 0)::text AS s FROM lancamentos_de_indicador WHERE id = ANY($1::uuid[]) GROUP BY 1', [lanc.map((l) => l.id)])
    const dm = new Map(d.rows.map((x) => [String(x['i']), BigInt(String(x['s']))]))
    const diverg = [...o].filter(([k, v]) => dm.get(k) !== v).length + [...dm].filter(([k]) => !o.has(k)).length
    add('checkins_por_indicador_divergentes', '0', String(diverg))
    const alvo = Object.values(plano.alvos.checkinsPorMeta).reduce((a, b) => a + b, 0n)
    add('checkins_soma_total_origem_x_destino', alvo.toString(), [...dm.values()].reduce((a, b) => a + b, 0n).toString(), true)
  }

  // 5b. por meta, INCLUSIVE as sem check-in (esperado 0; nenhum lançamento de abertura é criado)
  const metasCarregadas = plano.resultados.filter((r) => r.colecao === 'metas' && r.estado === 'carregavel' && r.principal)
  if (metasCarregadas.length > 0) {
    const indIds = metasCarregadas.map((r) => String(r.principal!.cols['indicador_id']))
    const d = await cli.query('SELECT indicador_id::text AS i, coalesce(sum(coalesce(valor_centavos, valor_inteiro)), 0)::text AS s FROM lancamentos_de_indicador WHERE indicador_id = ANY($1::uuid[]) GROUP BY 1', [indIds])
    const dm = new Map(d.rows.map((x) => [String(x['i']), BigInt(String(x['s']))]))
    const diverg = metasCarregadas.filter((r) => (dm.get(String(r.principal!.cols['indicador_id'])) ?? 0n) !== (plano.alvos.checkinsPorMeta[r.idOrigem] ?? 0n)).length
    add(`checkins_por_meta_divergentes (${metasCarregadas.length} metas; sem check-in = 0)`, '0', String(diverg))
  }

  // 6. rotinas entram desligadas
  const rot = porTabela.get('rotinas_internas') ?? []
  if (rot.length > 0) {
    const d = await cli.query('SELECT count(*) FILTER (WHERE ativa)::text AS n FROM rotinas_internas WHERE id = ANY($1::uuid[])', [rot.map((l) => l.id)])
    add('rotinas_ativas_apos_a_carga', '0', String(d.rows[0]?.['n']))
  }
  L.push(...equacaoDeContas(dump, plano, extra.resultadoPorId))
  return L
}

const DISPOSICAO: Record<string, string> = { inserida: 'carregado', ja_existia: 'ja_existia', ja_existia_por_chave: 'ja_existia', texto_difere: 'ja_existia', colisao: 'colisao' }

/**
 * Σ origem = Σ carregado + Σ já existia + Σ rejeitado + Σ fora, em CONTAGEM
 * (por coleção) e em VALOR (por unidade). Colisão de chave de negócio fica FORA
 * da soma de propósito: é um destino não contabilizado e reprova.
 */
export function equacaoDeContas(dump: Dump, plano: Plano, res: ReadonlyMap<string, string>): LinhaDeConferencia[] {
  const L: LinhaDeConferencia[] = []
  const disposicao = (r: Resultado): string => {
    if (r.estado === 'fora') return 'fora'
    if (r.estado === 'rejeitado' || r.estado === 'retido') return 'rejeitado'
    if (r.estado === 'correspondido') return 'ja_existia'
    const id = r.estado === 'mesclado' ? idDe('clientes', r.idOrigem) : r.principal?.id
    return (id !== undefined ? DISPOSICAO[res.get(id) ?? ''] : undefined) ?? 'nao_carregado'
  }
  const colecoes = [...new Set(dump.registros.map((r) => r.colecao))].sort()
  for (const c of colecoes) {
    const b: Record<string, number> = {}
    for (const r of plano.resultados.filter((x) => x.colecao === c)) b[disposicao(r)] = (b[disposicao(r)] ?? 0) + 1
    const soma = (b['carregado'] ?? 0) + (b['ja_existia'] ?? 0) + (b['rejeitado'] ?? 0) + (b['fora'] ?? 0)
    const lidas = dump.registros.filter((r) => r.colecao === c).length
    L.push({ nome: `equacao_contagem:${c}`, origem: String(lidas), destino: String(soma), ok: lidas === soma })
  }
  const valores = valoresDoDump(dump)
  const porResultado = new Map(plano.resultados.map((r) => [`${r.colecao}|${r.idOrigem}`, r]))
  for (const u of [...new Set(Object.values(valores).map((v) => v.unidade))].sort()) {
    let lido = 0n
    let soma = 0n
    for (const [k, v] of Object.entries(valores)) {
      if (v.unidade !== u) continue
      lido += v.valor
      const r = porResultado.get(k)
      const d = r ? disposicao(r) : 'nao_contabilizado'
      if (d === 'carregado' || d === 'ja_existia' || d === 'rejeitado' || d === 'fora') soma += v.valor
    }
    L.push({ nome: `equacao_valor:${u}`, origem: lido.toString(), destino: soma.toString(), ok: lido === soma, sensivel: true })
  }
  return L
}

/**
 * UMA transação por grupo. A conferência roda DENTRO dela, antes do COMMIT:
 * reprovou, ROLLBACK — nada fica pela metade (regra 28).
 */
export async function executarCarga(cli: ClienteSql, dump: Dump, o: OpcoesDeCarga): Promise<ResultadoDaCarga> {
  const g = await cli.query('SELECT 1 FROM grupos WHERE id = $1 AND ativo', [o.grupoId])
  if (g.rows.length === 0) throw new ErroDeCarga('grupo_inexistente_ou_inativo')
  const u = await cli.query('SELECT 1 FROM usuarios_gestao WHERE id = $1', [o.usuarioCargaId])
  if (u.rows.length === 0) throw new ErroDeCarga('usuario_de_carga_inexistente')
  // O mapa de usuários vem de fora do repo; cada destino tem de existir (a carga nunca cria conta).
  const destinos = [...new Set(Object.values(o.mapaUsuarios ?? {}))]
  if (destinos.some((d) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d))) throw new ErroDeCarga('mapa_usuarios_com_destino_que_nao_e_uuid')
  if (destinos.length > 0) {
    const ex = await cli.query('SELECT id::text AS id FROM usuarios_gestao WHERE id = ANY($1::uuid[])', [destinos])
    if (ex.rows.length !== destinos.length) throw new ErroDeCarga('mapa_usuarios_aponta_para_usuario_inexistente')
  }

  const existentes = await carregarExistentes(cli)
  const candidatos = proporCorrespondencias(dump, existentes)
  const decisoes = decidirClientes(candidatos, o.aprovacoes ?? {}, existentes, dump)
  const bypass = (await cli.query('SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows[0]?.['rolbypassrls'] === true
  const plano = planejar(dump, {
    reterGlobais: !(o.incluirGlobais ?? bypass),
    grupoId: o.grupoId,
    usuarioCargaId: o.usuarioCargaId,
    mapaUsuarios: o.mapaUsuarios ?? {},
    instanteDaCarga: o.instanteDaCarga ?? new Date().toISOString(),
    decisoesCliente: decisoes,
  })

  const stats: Record<string, EstatisticaDaTabela> = {}
  const resultadoPorId = new Map<string, string>()
  let tabelaAtual: string | undefined
  await cli.query('BEGIN')
  try {
    // O gatilho de auditoria recusa escrita sem ator; a carga é o SISTEMA, declarado.
    await cli.query(`SELECT set_config('app.pessoa_id', 'sistema', true)`)
    // Uma carga por grupo por vez: a segunda execução concorrente é recusada, não enfileirada.
    const trava = await cli.query('SELECT pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) AS ok', ['migracao-supabase-carteira', o.grupoId])
    if (trava.rows[0]?.['ok'] !== true) throw new ErroDeCarga('carga_concorrente')
    for (const l of linhasDaCarga(plano)) {
      tabelaAtual = l.tabela
      await contexto(cli, l.tabela, o.grupoId)
      const s = (stats[l.tabela] ??= { inseridas: 0, jaExistia: 0, jaExistiaPorChave: 0, textoDiferePorChave: 0, colisao: 0 })
      const r = await inserir(cli, l)
      resultadoPorId.set(l.id, r)
      if (r === 'inserida') s.inseridas += 1
      else if (r === 'ja_existia') s.jaExistia += 1
      else if (r === 'ja_existia_por_chave') s.jaExistiaPorChave += 1
      else if (r === 'texto_difere') s.textoDiferePorChave += 1
      else s.colisao += 1
    }
    tabelaAtual = undefined
    const conferencia = await conferir(cli, dump, plano, stats, { grupoId: o.grupoId, resultadoPorId })
    const pendencias = plano.resultados
      .filter((r) => r.estado === 'rejeitado' || r.estado === 'retido')
      .map((r) => `${r.estado}:${r.colecao}:${r.motivo ?? ''}`)
    const ok = conferencia.every((x) => x.ok)
    await cli.query(ok ? 'COMMIT' : 'ROLLBACK')
    return { plano, candidatos, stats, conferencia, pendencias, commitado: ok, resultadoPorId }
  } catch (e) {
    await cli.query('ROLLBACK').catch(() => undefined)
    throw reduzir(e, tabelaAtual)
  }
}

export function relatorioDaCarga(r: ResultadoDaCarga, valores = false): string[] {
  const L: string[] = []
  L.push('Carga (uma transacao; conferencia dentro dela, antes do COMMIT)')
  for (const [t, s] of Object.entries(r.stats)) {
    L.push(`  ${t.padEnd(26)} inseridas ${s.inseridas}  ja_existia ${s.jaExistia}  ja_existia_por_chave ${s.jaExistiaPorChave}  texto_difere_do_existente ${s.textoDiferePorChave}  colisao ${s.colisao}`)
  }
  L.push(`  candidatos a correspondencia (relatorio, nunca fusao): ${r.candidatos.length}`)
  L.push('')
  L.push('Conferencia exata (origem x destino)')
  for (const c of r.conferencia) L.push(`  ${c.ok ? 'OK     ' : 'REPROVA'} ${c.nome}: ` + (c.sensivel && !valores ? 'origem [oculto] | destino [oculto]' : `origem ${c.origem} | destino ${c.destino}`))
  const pend = new Map<string, number>()
  for (const p of r.pendencias) pend.set(p, (pend.get(p) ?? 0) + 1)
  L.push('')
  L.push(`Pendencias para assinatura do dono (rejeitadas e retidas): ${r.pendencias.length}`)
  for (const [k, v] of [...pend].sort()) L.push(`  ${k}: ${v}`)
  L.push('')
  L.push(r.commitado ? 'RESULTADO: APROVADA e gravada (COMMIT)' : 'RESULTADO: REPROVADA (ROLLBACK, nada gravado)')
  return L
}
