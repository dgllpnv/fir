/**
 * Núcleo PURO da migração da carteira do Supabase (sem I/O de banco).
 *
 * O repositório é público: este arquivo só conhece FORMA (nomes de campo,
 * regras, códigos de rejeição). Valor de dado real nunca entra aqui, e nada
 * que ele devolve para log carrega texto, nome, telefone, e-mail, CNPJ ou
 * valor — só contagens e códigos.
 *
 * Regras de docs/migracao/supabase-carteira.md; decisões do dono P-16 a P-19.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// uuid v5 determinístico (§2.1)
// ---------------------------------------------------------------------------

/** Namespace FIXA desta migração. Precisa de ADR (pendente) — mudá-la muda todos os ids. */
export const NAMESPACE_UUID = '8d9e1f3a-4b5c-4d6e-8f70-91a2b3c4d5e6'

export function uuidV5(nome: string, namespace: string = NAMESPACE_UUID): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const h = createHash('sha1').update(ns).update(nome, 'utf8').digest()
  h[6] = (h[6]! & 0x0f) | 0x50
  h[8] = (h[8]! & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

/** O prefixo `<colecao>` impede que o mesmo id em coleções diferentes colida. */
export function idDe(colecao: string, id: string): string {
  return uuidV5(`supabase-carteira|v1|${colecao}|${id}`)
}

// ---------------------------------------------------------------------------
// Leitura do dump: números ficam como TEXTO (regra 1)
// ---------------------------------------------------------------------------

/** Um número JSON como veio escrito. `JSON.parse` normal o destruiria em `double`. */
export class LiteralNumerico {
  constructor(readonly texto: string) {}
}

/** Erro cuja mensagem é só um código: nunca carrega valor do dado. */
export class ErroDeDump extends Error {
  constructor(readonly codigo: string) {
    super(codigo)
    this.name = 'ErroDeDump'
  }
}

export type Dado = Record<string, unknown>
export type Registro = { id: string; colecao: string; clienteId: string | null; data: Dado }
export type Dump = {
  registros: Registro[]
  contagens: { historico: number; acessos_cliente: number; auth_users: number; storage_objects: number }
}

function celulasDoCsv(texto: string): string[][] {
  const linhas: string[][] = []
  let linha: string[] = []
  let campo = ''
  let aspas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i++
        } else aspas = false
      } else campo += c
    } else if (c === '"') aspas = true
    else if (c === ',') {
      linha.push(campo)
      campo = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++
      linha.push(campo)
      linhas.push(linha)
      linha = []
      campo = ''
    } else campo += c
  }
  if (campo !== '' || linha.length > 0) {
    linha.push(campo)
    linhas.push(linha)
  }
  return linhas
}

const revisor = (_k: string, v: unknown, ctx?: { source?: string }): unknown => {
  if (typeof v !== 'number') return v
  if (ctx?.source === undefined) throw new ErroDeDump('runtime_sem_texto_do_numero')
  return new LiteralNumerico(ctx.source)
}

export function lerDumpDeTexto(csv: string): Dump {
  const linhas = celulasDoCsv(csv.replace(/^﻿/, ''))
  const celula = linhas[1]?.[0]
  if (celula === undefined) throw new ErroDeDump('csv_sem_celula')
  let bruto: unknown
  try {
    bruto = JSON.parse(celula, revisor)
  } catch (e) {
    if (e instanceof ErroDeDump) throw e
    throw new ErroDeDump('json_invalido')
  }
  if (typeof bruto !== 'object' || bruto === null) throw new ErroDeDump('json_sem_objeto')
  const o = bruto as Dado
  const regs = o['registros']
  if (!Array.isArray(regs)) throw new ErroDeDump('sem_registros')
  const registros: Registro[] = regs.map((r: unknown) => {
    const x = r as Dado
    const id = x['id']
    const colecao = x['colecao']
    const data = x['data']
    if (typeof id !== 'string' || typeof colecao !== 'string' || typeof data !== 'object' || data === null) {
      throw new ErroDeDump('registro_malformado')
    }
    const cid = x['cliente_id']
    return { id, colecao, clienteId: typeof cid === 'string' && cid !== '' ? cid : null, data: data as Dado }
  })
  const n = (k: string): number => (Array.isArray(o[k]) ? (o[k] as unknown[]).length : 0)
  return {
    registros,
    contagens: {
      historico: n('historico'),
      acessos_cliente: n('acessos_cliente'),
      auth_users: n('auth_users'),
      storage_objects: n('storage_objects'),
    },
  }
}

export function lerDump(caminho: string): Dump {
  return lerDumpDeTexto(readFileSync(caminho, 'utf8'))
}

/**
 * Lista de registros que a dona precisa ler antes de irem para o sistema (decisão 4.5 da ADR).
 * Formato `colecao;id[;qualquer coisa]`, uma por linha; cabeçalho e linhas de comentário são ignorados.
 * O arquivo mora FORA do repositório: ids de origem identificam registros reais.
 */
export function lerListaDeExclusao(texto: string): string[] {
  const chaves = new Set<string>()
  for (const linha of texto.replace(/^﻿/, '').split(/\r?\n/)) {
    const [colecao, id] = linha.split(';').map((s) => s.trim())
    if (!colecao || !id || colecao === 'colecao') continue
    if (!/^[a-z_]+$/.test(colecao) || !/^[A-Za-z0-9_-]+$/.test(id)) continue
    if (colecao === 'clientes') throw new ErroDeDump('exclusao_de_cliente_proibida')
    chaves.add(`${colecao};${id}`)
  }
  return [...chaves]
}

/**
 * Tira do dump, ANTES de planejar, os registros retidos. Como a origem da conferência é recalculada
 * deste dump, a equação segue fechando; a contagem retirada vai no relatório e nunca some em silêncio.
 * Chave que não existe no dump é erro: um typo carregaria justamente o registro que devia ficar de fora.
 */
export function retirarDoDump(dump: Dump, chaves: readonly string[]): { dump: Dump; retirados: number } {
  const alvo = new Set(chaves)
  const achados = new Set<string>()
  const registros = dump.registros.filter((r) => {
    const k = `${r.colecao};${r.id}`
    if (!alvo.has(k)) return true
    achados.add(k)
    return false
  })
  if (achados.size !== alvo.size) throw new ErroDeDump('exclusao_nao_encontrada')
  return { dump: { ...dump, registros }, retirados: achados.size }
}

// ---------------------------------------------------------------------------
// Conversões (valor, data) — pelos dígitos, nunca por Number
// ---------------------------------------------------------------------------

export type Escalado = { valor: bigint; arredondou: boolean }
export type ErroDeValor = { erro: 'numero_invalido' | 'negativo' | 'fracionario' }

/**
 * `casas = 2`: reais para centavos, ou % para centésimos de ponto percentual.
 * Mais de 2 casas: meio para cima em módulo, DECLARADO por `arredondou`.
 * `casas = 0`: inteiro; fração diferente de zero é erro (não existe escala).
 * Negativo é erro (ADR 0009). Tudo em BigInt sobre os dígitos.
 */
export function escalar(texto: string, casas: 0 | 2): Escalado | ErroDeValor {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(texto.trim())
  if (!m) return { erro: 'numero_invalido' }
  const inteiro = m[2]!
  const frac = m[3] ?? ''
  if (m[1] === '-' && /[1-9]/.test(inteiro + frac)) return { erro: 'negativo' }
  if (casas === 0) {
    if (/[1-9]/.test(frac)) return { erro: 'fracionario' }
    return { valor: BigInt(inteiro), arredondou: false }
  }
  let valor = BigInt(inteiro + (frac + '00').slice(0, 2))
  const resto = frac.slice(2)
  const arredondou = /[1-9]/.test(resto)
  if (arredondou && resto.charAt(0) >= '5') valor += 1n
  return { valor, arredondou }
}

export const ehErroDeValor = (x: Escalado | ErroDeValor): x is ErroDeValor => 'erro' in x

function calendarioValido(a: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(a, m - 1, d))
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

const p2 = (n: number): string => String(n).padStart(2, '0')

const FORMATO_BAHIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bahia',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Data civil. Aceita AAAA-MM-DD e DD/MM/AAAA (estritos); instante ISO vira o dia
 * civil no fuso da carteira (America/Bahia), nunca o dia em UTC (§2.4).
 */
export function dataCivil(s: string | null): string | null {
  if (s === null) return null
  const t = s.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (m) return calendarioValido(+m[1]!, +m[2]!, +m[3]!) ? t : null
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t)
  if (m) return calendarioValido(+m[3]!, +m[2]!, +m[1]!) ? `${m[3]}-${m[2]}-${m[1]}` : null
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    const d = new Date(t)
    return Number.isNaN(d.getTime()) ? null : FORMATO_BAHIA.format(d)
  }
  return null
}

/** Semana ISO `AAAA-Www` para a segunda-feira dela (ano ISO, não o civil). */
export function segundaDaSemanaIso(s: string): string | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(s.trim())
  if (!m) return null
  const ano = +m[1]!
  const sem = +m[2]!
  if (sem < 1 || sem > 53) return null
  const quatroDeJan = new Date(Date.UTC(ano, 0, 4))
  const dow = quatroDeJan.getUTCDay() === 0 ? 7 : quatroDeJan.getUTCDay()
  const segunda = new Date(quatroDeJan.getTime() + ((1 - dow) + (sem - 1) * 7) * 86_400_000)
  const iso = `${segunda.getUTCFullYear()}-${p2(segunda.getUTCMonth() + 1)}-${p2(segunda.getUTCDate())}`
  // semana 53 que não existe naquele ano vira outro ano: recusa em vez de adivinhar
  const volta = (d: Date): number => {
    const dia = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
    const quinta = new Date(d.getTime() + (4 - dia) * 86_400_000)
    return quinta.getUTCFullYear()
  }
  return volta(segunda) === ano ? iso : null
}

/**
 * Data sem hora vinda de campo que o destino guarda como instante: meio-dia no
 * fuso da carteira (America/Bahia, -03:00 sem horário de verão desde 2019),
 * gravado em UTC. Declarado, e relatado nas contagens de aviso.
 */
export function instanteDeData(dataIso: string): string {
  return new Date(`${dataIso}T12:00:00-03:00`).toISOString()
}

// ---------------------------------------------------------------------------
// Acesso ao `data` (jsonb) sem nunca tocar em `number` nativo
// ---------------------------------------------------------------------------

function txt(d: Dado, k: string): string | null {
  const v = d[k]
  if (v === undefined || v === null) return null
  if (typeof v === 'string') return v
  if (v instanceof LiteralNumerico) return v.texto
  if (typeof v === 'number') throw new ErroDeDump('numero_sem_literal')
  return null
}
const cheio = (d: Dado, k: string): string | null => {
  const v = txt(d, k)
  return v === null || v.trim() === '' ? null : v
}
const lista = (d: Dado, k: string): string[] => {
  const v = d[k]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
const tamanho = (d: Dado, k: string): number => {
  const v = d[k]
  return Array.isArray(v) ? v.length : 0
}
const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

export const normalizarNome = norm
export const soDigitos = (s: string): string => s.replace(/\D/g, '')

// ---------------------------------------------------------------------------
// O plano
// ---------------------------------------------------------------------------

export type Col = string | number | bigint | boolean | null | string[]
export type LinhaDeCarga = {
  tabela: string
  id: string
  cols: Record<string, Col>
  /** Tabelas com chave natural única (roteiros/mensagens): não sobrescreve, compara. */
  chaveNatural?: { coluna: string; valor: string }
  hash: string
}

export type Estado = 'carregavel' | 'rejeitado' | 'fora' | 'retido' | 'mesclado' | 'correspondido'
export type Resultado = {
  colecao: string
  idOrigem: string
  rotuloCliente: string
  estado: Estado
  /** Código da rejeição, da retenção ou da decisão do dono. */
  motivo?: string
  principal?: LinhaDeCarga
  filhas: LinhaDeCarga[]
}

export type DecisaoCliente =
  | { tipo: 'novo' }
  | { tipo: 'existente'; id: string; grupoId: string }
  | { tipo: 'retido'; motivo: string }

export type Opcoes = {
  grupoId: string
  usuarioCargaId: string
  mapaUsuarios: Record<string, string>
  instanteDaCarga: string
  decisoesCliente: Record<string, DecisaoCliente>
  /**
   * As três tabelas globais da Firmare (mensagens, roteiros, biblioteca) só se
   * escrevem com `app_carteira_pode_administrar()`. O papel da carga não é (nem
   * finge ser) administrador: com `true`, esses documentos ficam RETIDOS para o
   * fluxo existente do Operador. Padrão `false` (só o dono do esquema inclui).
   */
  reterGlobais?: boolean
}

export type Alvos = {
  mrrCentavosPorCliente: Record<string, bigint>
  mrrCentavosTotalLido: bigint
  checkinsPorMeta: Record<string, bigint>
  tarefasPorStatus: Record<string, number>
  reunioesPorTipo: Record<string, number>
  arredondamentos: number
}

export type Plano = {
  resultados: Resultado[]
  derivados: LinhaDeCarga[]
  avisos: Record<string, number>
  alvos: Alvos
  contagens: Dump['contagens']
  /** Referências a usuário da origem: quantas o mapa resolve e quantas ficam nulas, por usuário de origem (ordinal). */
  usuarios: { origem: string; mapeadas: number; nulas: number }[]
}

/** Ordem de carga respeitando as chaves estrangeiras (§7.1). */
export const ORDEM_DAS_TABELAS = [
  'clientes_carteira',
  'parceiros_do_cliente',
  'planilhas_do_cliente',
  'rotinas_internas',
  'indicadores_carteira',
  'metas_comerciais',
  'lancamentos_de_indicador',
  'reunioes_comerciais',
  'tarefas_internas',
  'itens_de_tarefa_interna',
  'materiais_carteira',
  'materiais_da_biblioteca',
  'mensagens_comerciais',
  'roteiros_comerciais',
] as const

/** Colunas (todas textualizáveis) cujo conteúdo entra no hash de integridade (§6.1 item 12). */
export const COLUNAS_DO_HASH: Record<string, readonly string[]> = {
  clientes_carteira: ['nome', 'produto', 'status', 'cnpj', 'email', 'telefone', 'cidade', 'segmento', 'projeto', 'pagador', 'decisor', 'observacoes', 'mensalidade_centavos', 'dia_vencimento', 'telefone_cobranca', 'cliente_desde', 'data_inicio', 'data_fim'],
  parceiros_do_cliente: ['frente', 'nome', 'whatsapp', 'link_formulario'],
  planilhas_do_cliente: ['spreadsheet_id', 'link'],
  rotinas_internas: ['titulo', 'frequencia', 'escopo_aplicacao', 'dia_semana', 'dia_util', 'antecedencia', 'inicio', 'prioridade', 'servico', 'mensagem', 'frentes', 'envio', 'ativa'],
  indicadores_carteira: ['nome', 'unidade', 'sentido', 'meta_centavos', 'meta_inteiro'],
  metas_comerciais: ['titulo', 'sentido', 'tipo', 'agregacao', 'fonte', 'status', 'inicio', 'prazo', 'valor_meta_centavos', 'valor_meta_inteiro', 'valor_inicial_centavos', 'valor_inicial_inteiro'],
  lancamentos_de_indicador: ['referencia', 'valor_centavos', 'valor_inteiro'],
  reunioes_comerciais: ['data', 'tipo', 'resumo', 'encaminhamentos', 'participantes', 'saude_registrada', 'compartilhada', 'asana_id'],
  tarefas_internas: ['titulo', 'descricao', 'prazo', 'prioridade', 'status', 'recorrencia', 'vencimento', 'competencia', 'mensagem', 'contrato'],
  itens_de_tarefa_interna: ['ordem', 'rotulo', 'frente', 'feito'],
  materiais_carteira: ['titulo', 'tipo', 'descricao', 'link', 'texto'],
  materiais_da_biblioteca: ['titulo', 'tipo', 'descricao', 'link', 'texto', 'uso_interno'],
  mensagens_comerciais: ['chave', 'titulo', 'texto'],
  roteiros_comerciais: ['chave', 'titulo', 'quando', 'mensagem'],
}

export function textoDaColuna(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

/** `NUL` separa os campos: o Postgres não aceita `NUL` em texto, então nunca está no dado. */
export function hashDeConteudo(valores: readonly unknown[]): string {
  return createHash('sha256').update(valores.map(textoDaColuna).join('\u0000'), 'utf8').digest('hex')
}

export const hashDaLinha = (tabela: string, cols: Record<string, Col>): string =>
  hashDeConteudo((COLUNAS_DO_HASH[tabela] ?? []).map((c) => cols[c] ?? null))

const linha = (tabela: string, id: string, cols: Record<string, Col>, chave?: LinhaDeCarga['chaveNatural']): LinhaDeCarga => ({
  tabela,
  id,
  cols: { id, ...cols },
  hash: hashDaLinha(tabela, { id, ...cols }),
  ...(chave ? { chaveNatural: chave } : {}),
})

const PRODUTOS_FIRMARE = ['Acelerador FIR', 'Programa de Gestão FIR', 'Gestão por Assinatura', 'Consultoria', 'Projeto']
const STATUS_CLIENTE = ['onboarding', 'ativo', 'pausado', 'encerrado']
const AREAS = ['Comercial', 'Financeiro', 'Pessoas', 'Processos', 'Estratégia', 'Gestão']
const SERVICOS_CLIENTE = ['semanal', 'fluxo', 'dre']
const MENSAGENS = ['pagamento', 'fluxo', 'dre', 'formulario', 'cobranca', 'acessos', 'semanal']
const FRENTES = ['comercial', 'financeiro', 'marketing', 'trafego']
const PROGRAMAS = ['Comercial', 'Financeiro', 'Operações', 'Gestão', 'Todos']
const TIPOS_BIBLIOTECA = ['Planilha', 'Documento', 'Script', 'Modelo de mensagem', 'Apresentação']

const entre = (s: string, a: number, b: number): boolean => {
  const n = s.trim().length
  return n >= a && n <= b
}
const emSet = (s: string | null, set: readonly string[]): s is string => s !== null && set.includes(s)
const soHttps = (s: string, max: number): boolean => /^https:\/\/\S+$/i.test(s.trim()) && s.trim().length <= max

type RefCliente =
  | { ok: true; id: string; grupoId: string; novo: boolean }
  | { ok: false; estado: 'rejeitado' | 'retido'; motivo: string }

export function planejar(dump: Dump, o: Opcoes): Plano {
  const GLOBAL_RETIDO = 'tabela_global_exige_administrar_fora_do_papel_da_carga'
  const resultados: Resultado[] = []
  const derivados: LinhaDeCarga[] = []
  const avisos: Record<string, number> = {}
  const av = (c: string, n = 1): void => {
    avisos[c] = (avisos[c] ?? 0) + n
  }
  const alvos: Alvos = {
    mrrCentavosPorCliente: {},
    mrrCentavosTotalLido: 0n,
    checkinsPorMeta: {},
    tarefasPorStatus: {},
    reunioesPorTipo: {},
    arredondamentos: 0,
  }
  const por = (c: string): Registro[] => dump.registros.filter((r) => r.colecao === c)
  const usuario = (id: string | null): string | null => (id !== null && o.mapaUsuarios[id] !== undefined ? o.mapaUsuarios[id]! : null)
  const refUsuarios = new Map<string, { mapeadas: number; nulas: number }>()
  const contaUsuario = (id: string | null, u: string | null): void => {
    if (id === null || id === '') return
    const x = refUsuarios.get(id) ?? { mapeadas: 0, nulas: 0 }
    if (u === null) x.nulas += 1
    else x.mapeadas += 1
    refUsuarios.set(id, x)
  }
  const usuarioOuCarga = (id: string | null): string => {
    const u = usuario(id)
    contaUsuario(id, u)
    if (u === null) av('autor_sem_mapa_vai_para_usuario_de_carga')
    return u ?? o.usuarioCargaId
  }
  const usuarioOuNulo = (id: string | null): string | null => {
    const u = usuario(id)
    contaUsuario(id, u)
    if (id !== null && id !== '' && u === null) av('usuario_sem_mapa_gravado_nulo')
    return u
  }

  const rotulos = new Map<string, string>()
  let ausentes = 0
  const rotuloDe = (clienteId: string | null): string => {
    if (clienteId === null || clienteId === '') return 'sem-cliente'
    const r = rotulos.get(clienteId)
    if (r) return r
    ausentes += 1
    const n = `cliente-ausente#${ausentes}`
    rotulos.set(clienteId, n)
    return n
  }

  const registrar = (r: Registro, estado: Estado, motivo: string | undefined, principal?: LinhaDeCarga, filhas: LinhaDeCarga[] = [], cliente: string | null = r.clienteId): void => {
    resultados.push({ colecao: r.colecao, idOrigem: r.id, rotuloCliente: rotuloDe(cliente), estado, ...(motivo ? { motivo } : {}), ...(principal ? { principal } : {}), filhas })
  }
  const rejeitar = (r: Registro, motivo: string, cliente?: string | null): void => registrar(r, 'rejeitado', motivo, undefined, [], cliente ?? r.clienteId)
  const fora = (r: Registro, motivo: string): void => registrar(r, 'fora', motivo)

  const temNul = (r: Registro): boolean => JSON.stringify(r.data).includes('\\u0000')

  // ------------------------------------------------------------------ fora
  const FORA: Record<string, string> = {
    diagnosticos: 'ADR_0013_secao_1',
    transcricoes: 'ADR_0013_secao_1',
    config: 'decisao_do_dono_P-18_configuracao_de_cobranca_nao_entra_em_massa',
    perfis: 'usuarios_sao_criados_pelo_operador_nao_pelo_carregador',
    documentos: 'etapa_posterior_flag_interno_ambigua',
  }
  for (const r of dump.registros) {
    const m = FORA[r.colecao]
    if (m) fora(r, m)
  }
  av('diagnostico_do_cliente_ausente_em_clientes', (() => {
    const ids = new Set(por('clientes').map((c) => c.id))
    return por('diagnosticos').filter((d) => d.clienteId !== null && !ids.has(d.clienteId)).length
  })())

  // -------------------------------------------------------------- clientes
  const refs = new Map<string, RefCliente>()
  const clienteDocs = por('clientes')
  clienteDocs.forEach((r, i) => rotulos.set(r.id, `cliente#${i + 1}`))
  const finPorCliente = new Map(por('clientes_fin').map((f) => [f.id, f]))

  for (const r of clienteDocs) {
    const d = r.data
    if (temNul(r)) {
      refs.set(r.id, { ok: false, estado: 'rejeitado', motivo: 'caractere_nulo' })
      rejeitar(r, 'caractere_nulo', r.id)
      continue
    }
    const decisao = o.decisoesCliente[r.id] ?? { tipo: 'novo' }
    if (decisao.tipo === 'retido') {
      refs.set(r.id, { ok: false, estado: 'retido', motivo: decisao.motivo })
      registrar(r, 'retido', decisao.motivo, undefined, [], r.id)
      continue
    }
    if (decisao.tipo === 'existente') {
      refs.set(r.id, { ok: true, id: decisao.id, grupoId: decisao.grupoId, novo: false })
      // NUNCA UPDATE em cliente existente: só relata quanto haveria a completar à mão
      av('campo_do_cliente_existente_a_completar_manualmente', ['cnpj', 'email', 'telefone', 'cidade', 'segmento', 'projeto', 'pagador'].filter((k) => cheio(d, k) !== null).length)
      registrar(r, 'correspondido', 'correspondencia_aprovada', undefined, [], r.id)
      continue
    }
    const nome = cheio(d, 'nome')
    const produto = txt(d, 'produto')
    const status = txt(d, 'status')
    const dataInicio = cheio(d, 'data_inicio') === null ? null : dataCivil(txt(d, 'data_inicio'))
    const dataFim = cheio(d, 'data_fim') === null ? null : dataCivil(txt(d, 'data_fim'))
    const desde = cheio(d, 'cliente_desde') === null ? null : dataCivil(txt(d, 'cliente_desde'))
    const falha =
      nome === null ? 'nome_vazio'
      : !emSet(produto, PRODUTOS_FIRMARE) ? 'produto_fora_da_lista'
      : !emSet(status, STATUS_CLIENTE) ? 'status_invalido'
      : cheio(d, 'data_inicio') !== null && dataInicio === null ? 'data_inicio_invalida'
      : cheio(d, 'data_fim') !== null && dataFim === null ? 'data_fim_invalida'
      : cheio(d, 'cliente_desde') !== null && desde === null ? 'cliente_desde_invalida'
      : dataInicio !== null && dataFim !== null && dataFim < dataInicio ? 'ciclo_fora_de_ordem'
      : (cheio(d, 'observacoes') ?? '').trim().length > 2000 ? 'observacoes_acima_de_2000'
      : null
    if (falha) {
      refs.set(r.id, { ok: false, estado: 'rejeitado', motivo: falha })
      rejeitar(r, falha, r.id)
      continue
    }
    const cols: Record<string, Col> = { grupo_id: o.grupoId, nome: nome!, produto: produto!, status: status! }
    const criado = dataCivil(cheio(d, 'criado_em') ? txt(d, 'criado_em') : null)
    if (criado) cols['criado_em'] = instanteDeData(criado)
    else av('cliente_sem_criado_em_usa_a_carga')
    cols['cliente_desde'] = desde
    cols['data_inicio'] = dataInicio
    cols['data_fim'] = dataFim
    // CNPJ: só dígitos e exatamente 14; fora disso NULL e relata, nunca inventa
    const cnpjBruto = cheio(d, 'cnpj')
    if (cnpjBruto !== null) {
      const dig = soDigitos(cnpjBruto)
      if (dig.length === 14) cols['cnpj'] = dig
      else av('cnpj_invalido_gravado_nulo')
    }
    const texto = (col: string, campo: string, max: number, min = 1): void => {
      const v = cheio(d, campo)
      if (v === null) return
      if (entre(v, min, max)) cols[col] = v
      else av(`${col}_fora_do_limite_gravado_nulo`)
    }
    texto('email', 'email', 160, 3)
    texto('telefone', 'telefone', 30)
    texto('cidade', 'cidade', 80)
    texto('segmento', 'segmento', 80)
    texto('projeto', 'projeto', 80)
    texto('pagador', 'pagador', 120)
    texto('decisor', 'responsavel', 120) // hipótese do doc §1.1: o decisor do lado da cliente
    const obs = cheio(d, 'observacoes')
    if (obs !== null) cols['observacoes'] = obs
    const area = cheio(d, 'area_foco')
    if (area !== null) {
      if (AREAS.includes(area)) cols['area_foco'] = area
      else av('area_foco_fora_do_conjunto_gravado_nulo')
    }
    const servs = lista(d, 'servicos')
    cols['servicos'] = servs.filter((s) => SERVICOS_CLIENTE.includes(s))
    if (servs.length !== (cols['servicos'] as string[]).length) av('servico_fora_do_conjunto_descartado')
    // nascimento: o ANO é descartado por desenho (LGPD A28)
    const nasc = cheio(d, 'nascimento_responsavel')
    if (nasc !== null) {
      const dc = dataCivil(nasc)
      if (dc) {
        const [, mes, dia] = dc.split('-')
        av('nascimento_com_ano_descartado')
        cols['aniversario_decisor_mes'] = Number(mes)
        cols['aniversario_decisor_dia'] = Number(dia)
      } else av('nascimento_invalido_gravado_nulo')
    }
    if (cheio(d, 'dia_reuniao') !== null) av('dia_reuniao_texto_nao_interpretado')
    for (const [col, campo] of [['link_painel', 'link_painel'], ['link_dash_ind', 'link_dash_ind'], ['link_dash_fin', 'link_dash_fin'], ['link_rotina', 'link_rotina']] as const) {
      const v = cheio(d, campo)
      if (v === null) continue
      if (soHttps(v, 2000)) cols[col] = v.trim()
      else av('link_nao_https_descartado')
    }
    const resp = usuarioOuNulo(cheio(d, 'colaboradora_id'))
    if (resp) cols['responsavel_usuario_gestao_id'] = resp
    if (d['saude'] !== undefined && cheio(d, 'saude') !== null) av('saude_sem_coluna_derivada_no_destino')
    if (d['migrado'] === true) av('cliente_marcado_migrado_proveniencia')
    if (cheio(d, 'codigo_rotina') !== null) av('codigo_rotina_nao_atravessa')

    // ---- financeiro (clientes_fin.id == cliente.id)
    const fin = finPorCliente.get(r.id)
    if (fin) {
      const v = cheio(fin.data, 'valor_mensal')
      const esc = v === null ? { erro: 'numero_invalido' as const } : escalar(v, 2)
      const dia = cheio(fin.data, 'dia_vencimento')
      const diaN = dia !== null && /^\d+$/.test(dia) ? Number(dia) : -1
      if (ehErroDeValor(esc)) {
        rejeitar(fin, `valor_mensal_${esc.erro}`, r.id)
        finPorCliente.delete(r.id)
      } else if (diaN < 1 || diaN > 31) {
        rejeitar(fin, 'dia_vencimento_invalido', r.id)
        finPorCliente.delete(r.id)
      } else {
        if (esc.arredondou) {
          av('arredondamento_declarado')
          alvos.arredondamentos += 1
        }
        cols['mensalidade_centavos'] = esc.valor
        cols['dia_vencimento'] = diaN
        const tf = cheio(fin.data, 'telefone_financeiro')
        if (tf !== null) {
          if (entre(tf, 1, 30)) cols['telefone_cobranca'] = tf
          else av('telefone_cobranca_fora_do_limite_gravado_nulo')
        }
        alvos.mrrCentavosPorCliente[r.id] = esc.valor
        // P-18: o texto de `pagamentos` não vira cobrança paga nem receita
        const pg = fin.data['pagamentos']
        if (typeof pg === 'object' && pg !== null) av('pagamento_do_mes_nao_gera_cobranca_P-18', Object.keys(pg as Dado).length)
        registrar(fin, 'mesclado', 'financeiro_mesclado_no_cliente', undefined, [], r.id)
      }
    }
    // sem financeiro lido, a coluna fica no default do banco (0); explícito para o hash comparar igual
    if (cols['mensalidade_centavos'] === undefined) cols['mensalidade_centavos'] = 0n
    const filhas: LinhaDeCarga[] = []
    const id = idDe('clientes', r.id)
    for (const f of FRENTES) {
      const nomeP = cheio(d, `resp_${f}`)
      const tel = cheio(d, `resp_${f}_tel`)
      const form = cheio(d, `form_${f}`)
      const c: Record<string, Col> = { grupo_id: o.grupoId, cliente_carteira_id: id, frente: f }
      if (nomeP !== null) {
        if (entre(nomeP, 1, 120)) c['nome'] = nomeP
        else av('parceiro_nome_fora_do_limite_descartado')
      }
      if (tel !== null) {
        if (entre(tel, 1, 30)) c['whatsapp'] = tel
        else av('parceiro_whatsapp_fora_do_limite_descartado')
      }
      if (form !== null) {
        if (soHttps(form, 500)) c['link_formulario'] = form.trim()
        else av('parceiro_formulario_nao_https_descartado')
      }
      if (c['nome'] !== undefined || c['whatsapp'] !== undefined || c['link_formulario'] !== undefined) {
        filhas.push(linha('parceiros_do_cliente', idDe('parceiros', `${r.id}|${f}`), c))
      }
    }
    const pl = cheio(d, 'link_planilha')
    if (pl !== null) {
      const sid = /^https:\/\/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,100})(?:[/?#]|$)/.exec(pl.trim())
      if (sid && pl.trim().length <= 2000) {
        filhas.push(linha('planilhas_do_cliente', idDe('planilhas', r.id), { grupo_id: o.grupoId, cliente_carteira_id: id, spreadsheet_id: sid[1]!, link: pl.trim() }))
      } else av('link_planilha_invalido_descartado')
    }
    refs.set(r.id, { ok: true, id, grupoId: o.grupoId, novo: true })
    registrar(r, 'carregavel', undefined, linha('clientes_carteira', id, cols), filhas, r.id)
  }
  for (const [id, f] of finPorCliente) {
    if (!refs.has(id)) rejeitar(f, 'financeiro_sem_cliente', id)
    else if (!resultados.some((x) => x.colecao === 'clientes_fin' && x.idOrigem === id)) {
      const ref = refs.get(id)!
      if (!ref.ok) registrar(f, ref.estado, ref.estado === 'retido' ? ref.motivo : 'cliente_rejeitado', undefined, [], id)
      else rejeitar(f, 'financeiro_de_cliente_correspondido_nao_carrega', id)
    }
  }

  // pelo cliente: devolve a decisão ou o motivo para quem depende dele
  type Dep = { ok: true; id: string | null; grupoId: string } | { ok: false; estado: 'rejeitado' | 'retido'; motivo: string }
  const dependeDe = (clienteId: string | null, exige: boolean): Dep => {
    if (clienteId === null || clienteId === '') {
      return exige ? { ok: false, estado: 'rejeitado', motivo: 'sem_cliente' } : { ok: true, id: null, grupoId: o.grupoId }
    }
    const ref = refs.get(clienteId)
    if (!ref) return { ok: false, estado: 'rejeitado', motivo: 'cliente_ausente_em_clientes' }
    if (!ref.ok) return ref.estado === 'retido' ? ref : { ok: false, estado: 'rejeitado', motivo: 'cliente_rejeitado' }
    return { ok: true, id: ref.id, grupoId: ref.grupoId }
  }
  const barrar = (r: Registro, dep: Extract<Dep, { ok: false }>, cliente: string | null): void => registrar(r, dep.estado, dep.motivo, undefined, [], cliente)

  // --------------------------------------------------------------- rotinas
  const rotinasOk = new Set<string>()
  for (const r of por('rotinas')) {
    const d = r.data
    if (temNul(r)) { rejeitar(r, 'caractere_nulo'); continue }
    const titulo = cheio(d, 'titulo')
    const freq = txt(d, 'frequencia')
    const inicio = dataCivil(txt(d, 'inicio'))
    const prio = txt(d, 'prioridade') ?? 'normal'
    const pc = txt(d, 'por_cliente')
    const frentes = txt(d, 'frentes') === 'sim'
    const envio = txt(d, 'envio') === 'sim'
    const escopo = pc === 'cada' ? 'por_cliente' : pc === 'nao' ? 'global' : null
    let diaSemana: number | null = null
    const ds = cheio(d, 'dia_semana')
    if (freq === 'semanal') {
      const n = ds !== null && /^\d$/.test(ds) ? Number(ds) : -1
      if (n === 0) { diaSemana = 7; av('dia_semana_0_domingo_virou_7') } else if (n >= 1 && n <= 7) diaSemana = n
    }
    const du = cheio(d, 'dia_util')
    const duN = du !== null && /^\d+$/.test(du) ? Number(du) : -1
    const ant = cheio(d, 'antecedencia')
    const antN = ant !== null && /^\d+$/.test(ant) ? Number(ant) : -1
    const falha =
      titulo === null ? 'titulo_vazio'
      : !emSet(freq, ['diaria', 'semanal', 'mensal', 'vencimento', 'reuniao']) ? 'frequencia_fora_do_conjunto'
      : inicio === null ? 'inicio_invalido'
      : !['baixa', 'normal', 'alta'].includes(prio) ? 'prioridade_invalida'
      : escopo === null ? 'por_cliente_invalido'
      : freq === 'semanal' && diaSemana === null ? 'dia_semana_invalido'
      : freq === 'mensal' && (duN < 1 || duN > 23) ? 'dia_util_invalido'
      : freq === 'vencimento' && (antN < 0 || antN > 31) ? 'antecedencia_invalida'
      : (freq === 'vencimento' || freq === 'reuniao' || frentes || envio) && escopo !== 'por_cliente' ? 'rotina_exige_por_cliente'
      : null
    if (falha) { rejeitar(r, falha); continue }
    const id = idDe('rotinas', r.id)
    const servico = cheio(d, 'servico')
    const msg = cheio(d, 'mensagem')
    if (servico !== null && !['semanal', 'fluxo', 'dre', 'pagamento', 'metas'].includes(servico)) av('servico_fora_do_enum_gravado_nulo')
    if (msg !== null && !MENSAGENS.includes(msg)) av('mensagem_fora_do_enum_gravado_nulo')
    if (freq !== 'mensal' && duN >= 0) av('dia_util_ignorado_fora_de_mensal')
    if (freq !== 'vencimento' && antN >= 0) av('antecedencia_ignorada_fora_de_vencimento')
    const cols: Record<string, Col> = {
      titulo: titulo!, grupo_id: o.grupoId, frequencia: freq!, escopo_aplicacao: escopo!,
      passos: lista(d, 'passos'), ativa: false, inicio: inicio!, prioridade: prio,
      dia_semana: diaSemana === null ? null : (diaSemana),
      dia_util: freq === 'mensal' ? (duN) : null,
      antecedencia: freq === 'vencimento' ? (antN) : null,
      servico: servico !== null && ['semanal', 'fluxo', 'dre', 'pagamento', 'metas'].includes(servico) ? servico : null,
      mensagem: msg !== null && MENSAGENS.includes(msg) ? msg : null,
      frentes, envio,
    }
    const resp = usuarioOuNulo(cheio(d, 'responsavel_id'))
    if (resp) cols['responsavel_usuario_gestao_id'] = resp
    rotinasOk.add(r.id)
    registrar(r, 'carregavel', undefined, linha('rotinas_internas', id, cols))
  }

  // ----------------------------------------- indicadores, metas, check-ins
  const unidadeDe = (u: string | null): 'R$' | 'un' | '%' | 'dias' | null => (u === 'R$' || u === 'un' || u === '%' || u === 'dias' ? u : null)
  const valorPorUnidade = (u: string, v: string): Escalado | ErroDeValor => escalar(v, u === 'un' || u === 'dias' ? 0 : 2)
  const colValor = (u: string, prefixo: string, v: bigint): Record<string, Col> =>
    u === 'R$' ? { [`${prefixo}_centavos`]: v } : { [`${prefixo}_inteiro`]: v }
  const indicadorPorChave = new Map<string, string>()
  const chaveDeIndicador = (cliente: string, nome: string, u: string, s: string): string => `${cliente}|${norm(nome)}|${u}|${s}`

  for (const r of por('indicadores')) {
    const d = r.data
    const dep = dependeDe(r.clienteId, true)
    if (!dep.ok) { barrar(r, dep, r.clienteId); continue }
    const nome = cheio(d, 'nome')
    const u = unidadeDe(txt(d, 'unidade'))
    const sentido = txt(d, 'sentido')
    const mt = cheio(d, 'meta')
    const esc = u && mt !== null ? valorPorUnidade(u, mt) : null
    const falha = nome === null || !entre(nome, 1, 120) ? 'nome_invalido' : u === null ? 'unidade_invalida' : !emSet(sentido, ['maior_melhor', 'menor_melhor']) ? 'sentido_invalido' : esc !== null && ehErroDeValor(esc) ? `meta_${esc.erro}` : null
    if (falha) { rejeitar(r, falha); continue }
    const id = idDe('indicadores', r.id)
    const cols: Record<string, Col> = { cliente_carteira_id: dep.id, grupo_id: dep.grupoId, nome: nome!, unidade: u!, sentido: sentido!, ativo: d['ativo'] !== false }
    if (esc && !ehErroDeValor(esc)) {
      Object.assign(cols, colValor(u!, 'meta', esc.valor))
      if (esc.arredondou) { av('arredondamento_declarado'); alvos.arredondamentos += 1 }
    }
    indicadorPorChave.set(chaveDeIndicador(r.clienteId!, nome!, u!, sentido!), id)
    registrar(r, 'carregavel', undefined, linha('indicadores_carteira', id, cols))
  }

  const usosDoIndicador = new Map<string, number>()
  for (const m of por('metas')) {
    const i = cheio(m.data, 'indicador')
    if (m.clienteId && i) {
      const k = chaveDeIndicador(m.clienteId, i, txt(m.data, 'unidade') ?? '', txt(m.data, 'sentido') ?? '')
      usosDoIndicador.set(k, (usosDoIndicador.get(k) ?? 0) + 1)
    }
  }
  type MetaOk = { indicadorId: string; unidade: string }
  const metasOk = new Map<string, MetaOk>()
  for (const r of por('metas')) {
    const d = r.data
    if (temNul(r)) { rejeitar(r, 'caractere_nulo'); continue }
    const dep = dependeDe(r.clienteId, true)
    if (!dep.ok) { barrar(r, dep, r.clienteId); continue }
    const titulo = cheio(d, 'titulo')
    const ind = cheio(d, 'indicador')
    const u = unidadeDe(txt(d, 'unidade'))
    const sentido = txt(d, 'sentido')
    const tipo = txt(d, 'tipo')
    const agreg = txt(d, 'agregacao')
    const fonte = cheio(d, 'fonte')
    const status = txt(d, 'status')
    const inicio = dataCivil(txt(d, 'inicio'))
    const prazoT = cheio(d, 'prazo')
    const prazo = prazoT === null ? null : dataCivil(prazoT)
    const vm = cheio(d, 'valor_meta')
    const vi = cheio(d, 'valor_inicial')
    const em = u && vm !== null ? valorPorUnidade(u, vm) : null
    const ei = u && vi !== null ? valorPorUnidade(u, vi) : null
    const falha =
      titulo === null || !entre(titulo, 1, 160) ? 'titulo_invalido'
      : ind === null || !entre(ind, 1, 120) ? 'indicador_invalido'
      : u === null ? 'unidade_invalida'
      : !emSet(sentido, ['maior_melhor', 'menor_melhor']) ? 'sentido_invalido'
      : !emSet(tipo, ['mensal', 'prazo']) ? 'tipo_invalido'
      : !emSet(agreg, ['soma', 'media', 'ultimo']) ? 'agregacao_invalida'
      : u === '%' && agreg === 'soma' ? 'percentual_com_soma'
      : fonte !== null && fonte !== 'lancamento' ? 'fonte_nao_suportada'
      : !emSet(status, ['em_andamento', 'atingida', 'nao_atingida', 'cancelada', 'concluida']) ? 'status_invalido'
      : inicio === null ? 'inicio_invalido'
      : prazoT !== null && prazo === null ? 'prazo_invalido'
      : prazo !== null && prazo < inicio ? 'prazo_antes_do_inicio'
      : em === null ? 'valor_meta_ausente'
      : ehErroDeValor(em) ? `valor_meta_${em.erro}`
      : ei !== null && ehErroDeValor(ei) ? `valor_inicial_${ei.erro}`
      : null
    if (falha) { rejeitar(r, falha); continue }
    if (cheio(d, 'valor_atual') !== null) av('valor_atual_presente_nao_gravado')
    // Um indicador POR META. Metas diferentes com o mesmo texto de indicador têm
    // check-ins próprios; compartilhar o indicador somaria o realizado de uma na
    // outra (progresso errado) e colidiria em (indicador, referência). Só reusa o
    // indicador do cadastro `indicadores` quando uma única meta o reivindica.
    const chave = chaveDeIndicador(r.clienteId!, ind!, u!, sentido!)
    const doDoc = indicadorPorChave.get(chave)
    let indId: string
    if (doDoc && (usosDoIndicador.get(chave) ?? 0) === 1) indId = doDoc
    else {
      indId = idDe('indicadores_das_metas', `meta|${r.id}`)
      derivados.push(linha('indicadores_carteira', indId, { cliente_carteira_id: dep.id, grupo_id: dep.grupoId, nome: ind!, unidade: u!, sentido: sentido!, ativo: true }))
    }
    const cols: Record<string, Col> = {
      cliente_carteira_id: dep.id, grupo_id: dep.grupoId, indicador_id: indId, titulo: titulo!, sentido: sentido!,
      tipo: tipo!, agregacao: agreg!, fonte: 'lancamento', status: status!, inicio: inicio!, prazo,
      ...colValor(u!, 'valor_meta', (em as Escalado).valor),
      ...(ei !== null ? colValor(u!, 'valor_inicial', (ei as Escalado).valor) : {}),
    }
    for (const e of [em, ei]) if (e && !ehErroDeValor(e) && e.arredondou) { av('arredondamento_declarado'); alvos.arredondamentos += 1 }
    if (d['migrada'] === true) av('meta_marcada_migrada_proveniencia')
    metasOk.set(r.id, { indicadorId: indId, unidade: u! })
    registrar(r, 'carregavel', undefined, linha('metas_comerciais', idDe('metas', r.id), cols))
  }

  // check-ins -> lançamentos (nunca `checkins_internos`, que é qualitativo)
  const checkins = por('checkins')
  const chaveRef = (r: Registro): string | null => {
    const mid = cheio(r.data, 'meta_id')
    const sem = cheio(r.data, 'semana')
    if (!mid || !sem) return null
    const ref = dataCivil(sem) ?? segundaDaSemanaIso(sem)
    const m = metasOk.get(mid)
    return ref && m ? `${m.indicadorId}|${ref}` : null
  }
  const contagemChave = new Map<string, number>()
  for (const r of checkins) {
    const k = chaveRef(r)
    if (k) contagemChave.set(k, (contagemChave.get(k) ?? 0) + 1)
  }
  for (const r of checkins) {
    const d = r.data
    const mid = cheio(d, 'meta_id')
    const cm = dump.registros.find((x) => x.colecao === 'metas' && x.id === mid)?.clienteId ?? null
    const meta = mid ? metasOk.get(mid) : undefined
    if (temNul(r)) { rejeitar(r, 'caractere_nulo', cm); continue }
    if (!mid || !meta) { rejeitar(r, mid ? 'meta_nao_carregavel' : 'sem_meta', cm); continue }
    const sem = cheio(d, 'semana')
    const ref = sem ? (dataCivil(sem) ?? segundaDaSemanaIso(sem)) : null
    const v = cheio(d, 'valor')
    const esc = v === null ? ({ erro: 'numero_invalido' } as ErroDeValor) : valorPorUnidade(meta.unidade, v)
    if (ref === null) { rejeitar(r, 'semana_invalida', cm); continue }
    if (ehErroDeValor(esc)) { rejeitar(r, `valor_${esc.erro}`, cm); continue }
    if ((contagemChave.get(`${meta.indicadorId}|${ref}`) ?? 0) > 1) { rejeitar(r, 'colisao_indicador_referencia', cm); continue }
    if (esc.arredondou) { av('arredondamento_declarado'); alvos.arredondamentos += 1 }
    const metaDoc = dump.registros.find((x) => x.colecao === 'metas' && x.id === mid)
    const cols: Record<string, Col> = {
      indicador_id: meta.indicadorId, grupo_id: o.grupoId, referencia: ref,
      lancado_por: usuarioOuCarga(cheio(d, 'por')), ...colValor(meta.unidade, 'valor', esc.valor),
    }
    // o grupo do lançamento é o do cliente da meta
    const dep = dependeDe(metaDoc?.clienteId ?? null, true)
    if (dep.ok) cols['grupo_id'] = dep.grupoId
    alvos.checkinsPorMeta[mid] = (alvos.checkinsPorMeta[mid] ?? 0n) + esc.valor
    registrar(r, 'carregavel', undefined, linha('lancamentos_de_indicador', idDe('checkins', r.id), cols), [], metaDoc?.clienteId ?? null)
  }

  // -------------------------------------------------------------- reuniões
  for (const r of por('reunioes')) {
    const d = r.data
    if (temNul(r)) { rejeitar(r, 'caractere_nulo'); continue }
    const dep = dependeDe(r.clienteId, true)
    if (!dep.ok) { barrar(r, dep, r.clienteId); continue }
    const dt = dataCivil(txt(d, 'data'))
    const tipo = txt(d, 'tipo')
    const resumo = cheio(d, 'resumo')
    const part = cheio(d, 'participantes')
    const asana = cheio(d, 'asana_id')
    const falha =
      dt === null ? 'data_invalida'
      : !emSet(tipo, ['semanal', 'mensal', 'diagnostico', 'extra', 'importada']) ? 'tipo_invalido'
      : resumo === null || !entre(resumo, 1, 4000) ? 'resumo_fora_de_1_a_4000'
      : part !== null && part.length > 500 ? 'participantes_acima_de_500'
      : asana !== null && asana.length > 64 ? 'asana_id_acima_de_64'
      : null
    if (falha) { rejeitar(r, falha); continue }
    const saude = cheio(d, 'saude_registrada')
    if (saude !== null && !['bom', 'atencao', 'critico'].includes(saude)) av('saude_registrada_fora_do_enum_gravada_nula')
    if (d['compartilhar'] === true) av('reuniao_compartilhada_na_origem_carregada_nao_compartilhada_P-2')
    if (tamanho(d, 'anexos') > 0) av('reuniao_com_anexo_nao_carregada')
    const enc = cheio(d, 'encaminhamentos')
    const id = idDe('reunioes', r.id)
    const cols: Record<string, Col> = {
      cliente_carteira_id: dep.id, grupo_id: dep.grupoId, data: dt, resumo: resumo!, encaminhamentos: enc,
      por_usuario_gestao_id: usuarioOuCarga(cheio(d, 'registrada_por')), compartilhada: false, tipo: tipo!,
      participantes: part, saude_registrada: saude !== null && ['bom', 'atencao', 'critico'].includes(saude) ? saude : null,
      asana_id: asana, chave_idempotencia: id,
    }
    alvos.reunioesPorTipo[tipo!] = (alvos.reunioesPorTipo[tipo!] ?? 0) + 1
    registrar(r, 'carregavel', undefined, linha('reunioes_comerciais', id, cols))
  }

  // --------------------------------------------------------------- tarefas
  // O banco admite UMA tarefa por (rotina, cliente, competência) fora das canceladas. A origem repete
  // algumas; a concluída vence (é trabalho feito) e a repetida é rejeitada e relatada, nunca fundida.
  const lembretesVistos = new Set<string>()
  const tarefasDaOrigem = [...por('tarefas')].sort((x, y) => Number(cheio(y.data, 'status') === 'concluida') - Number(cheio(x.data, 'status') === 'concluida'))
  for (const r of tarefasDaOrigem) {
    const d = r.data
    if (temNul(r)) { rejeitar(r, 'caractere_nulo'); continue }
    const cid = cheio(d, 'cliente_id')
    const dep = dependeDe(cid, false)
    if (!dep.ok) { barrar(r, dep, cid); continue }
    const titulo = cheio(d, 'titulo')
    const prazo = dataCivil(txt(d, 'prazo'))
    const status = txt(d, 'status')
    const prio = txt(d, 'prioridade') ?? 'normal'
    const rec = txt(d, 'recorrencia') ?? 'nenhuma'
    const itens = Array.isArray(d['itens']) ? (d['itens'] as unknown[]) : []
    const concluidaT = cheio(d, 'concluida_em')
    const concluidaDia = concluidaT === null ? null : dataCivil(concluidaT)
    const falha =
      titulo === null ? 'titulo_vazio'
      : prazo === null ? 'sem_prazo_valido'
      : !emSet(status, ['pendente', 'concluida', 'cancelada']) ? 'status_invalido'
      : !['baixa', 'normal', 'alta'].includes(prio) ? 'prioridade_invalida'
      : !['nenhuma', 'diaria', 'semanal', 'mensal'].includes(rec) ? 'recorrencia_invalida'
      : concluidaT !== null && concluidaDia === null ? 'concluida_em_invalida'
      : itens.length > 500 ? 'itens_acima_de_500'
      : null
    if (falha) { rejeitar(r, falha, cid); continue }
    const id = idDe('tarefas', r.id)
    const filhas: LinhaDeCarga[] = []
    let itemInvalido = false
    itens.forEach((it, i) => {
      const x = (typeof it === 'object' && it !== null ? it : {}) as Dado
      const rotulo = cheio(x, 'texto')
      if (rotulo === null || !entre(rotulo, 1, 200)) { itemInvalido = true; return }
      const frente = cheio(x, 'frente')
      const feito = x['feito'] === true
      if (frente !== null && !FRENTES.includes(frente)) av('item_frente_fora_do_enum_gravada_nula')
      let feitoEm: string | null = null
      if (feito) {
        feitoEm = concluidaDia ? instanteDeData(concluidaDia) : o.instanteDaCarga
        if (!concluidaDia) av('item_feito_sem_data_usa_a_carga')
      }
      filhas.push(linha('itens_de_tarefa_interna', idDe('tarefas_itens', `${r.id}|${i + 1}`), {
        tarefa_interna_id: id, grupo_id: dep.grupoId, ordem: i + 1, rotulo,
        cliente_carteira_id: dep.id, frente: frente !== null && FRENTES.includes(frente) ? frente : null,
        feito, feito_em: feitoEm,
      }))
    })
    if (itemInvalido) { rejeitar(r, 'item_com_rotulo_fora_de_1_a_200', cid); continue }
    const msg = cheio(d, 'msg')
    if (msg !== null && !MENSAGENS.includes(msg)) av('msg_fora_do_enum_gravada_nula')
    // competência só quando inequívoca: tarefa de pagamento, dia 1 do mês do vencimento
    const venc = cheio(d, 'vencimento') === null ? null : dataCivil(txt(d, 'vencimento'))
    let vencimento: string | null = null
    let competencia: string | null = null
    if (cheio(d, 'vencimento') !== null) {
      if (venc !== null && msg === 'pagamento') { vencimento = venc; competencia = `${venc.slice(0, 7)}-01` }
      else av('vencimento_sem_competencia_inequivoca_descartado')
    }
    if (status === 'concluida' && concluidaT === null) av('concluida_sem_data_gravada_sem_data')
    if (status === 'pendente' && concluidaT !== null) av('pendente_com_data_de_conclusao_preservada')
    const rotId = cheio(d, 'rotina_id')
    let rotina: string | null = null
    if (rotId !== null) {
      if (rotinasOk.has(rotId)) rotina = idDe('rotinas', rotId)
      else av('rotina_nao_carregada_vinculo_nulo')
    }
    const contratoBruto = d['checklist'] === true ? cheio(d, 'contrato') : null
    let contrato: string | null = null
    if (contratoBruto !== null) {
      if (entre(contratoBruto, 1, 80)) { contrato = contratoBruto; av('contrato_gravado_na_etiqueta_P-16') } else av('contrato_acima_de_80_nao_gravado')
    }
    if (cheio(d, 'msg_enviada') !== null) av('msg_enviada_nao_carregada_P-10')
    if (cheio(d, 'reuniao_id') !== null) av('vinculo_ata_tarefa_nao_carregado')
    if (d['migrado'] === true) av('tarefa_marcada_migrado_proveniencia')
    const cols: Record<string, Col> = {
      titulo: titulo!, descricao: cheio(d, 'descricao'), grupo_id: dep.grupoId, cliente_carteira_id: dep.id,
      responsavel_usuario_gestao_id: usuarioOuNulo(cheio(d, 'responsavel_id')),
      solicitante_usuario_gestao_id: usuarioOuNulo(cheio(d, 'solicitante_id')),
      prazo, prioridade: prio, status: status!, concluida_em: concluidaDia ? instanteDeData(concluidaDia) : null,
      rotina_interna_id: rotina, recorrencia: rec, vencimento, competencia,
      mensagem: msg !== null && MENSAGENS.includes(msg) ? msg : null, contrato,
    }
    if (rotina !== null && competencia !== null) {
      const chaveDoLembrete = `${rotina}|${dep.id}|${competencia}`
      if (lembretesVistos.has(chaveDoLembrete)) { rejeitar(r, 'tarefa_repetida_na_origem_mesma_rotina_cliente_competencia', cid); continue }
      lembretesVistos.add(chaveDoLembrete)
    }
    alvos.tarefasPorStatus[status!] = (alvos.tarefasPorStatus[status!] ?? 0) + 1
    registrar(r, 'carregavel', undefined, linha('tarefas_internas', id, cols), filhas, cid)
  }

  // ------------------------------------------- materiais, mensagens, roteiros
  for (const r of por('materiais')) {
    const d = r.data
    if (temNul(r)) { rejeitar(r, 'caractere_nulo'); continue }
    const cid = r.clienteId
    const dep = cid === null ? null : dependeDe(cid, true)
    if (dep && !dep.ok) { barrar(r, dep, cid); continue }
    const titulo = cheio(d, 'titulo')
    const tipo = cheio(d, 'tipo')
    const link = cheio(d, 'link')
    const texto = txt(d, 'texto')
    const desc = cheio(d, 'descricao')
    const progs = lista(d, 'programas')
    const progsOk = progs.filter((p) => PROGRAMAS.includes(p))
    if (progs.length !== progsOk.length) av('programa_fora_do_conjunto_descartado')
    const falha =
      titulo === null || !entre(titulo, 1, 160) ? 'titulo_invalido'
      : tipo === null ? 'tipo_vazio'
      : link !== null && !entre(link, 1, 2000) ? 'link_acima_de_2000'
      : texto !== null && texto.length > 8000 ? 'texto_acima_de_8000'
      : desc !== null && desc.length > 500 ? 'descricao_acima_de_500'
      : !dep && !TIPOS_BIBLIOTECA.includes(tipo) ? 'tipo_fora_da_biblioteca'
      : null
    if (falha) { rejeitar(r, falha); continue }
    const criado = dataCivil(cheio(d, 'criado_em') ? txt(d, 'criado_em') : null)
    const base: Record<string, Col> = {
      titulo: titulo!, tipo: tipo!, descricao: desc, link, texto: texto === null || texto === '' ? null : texto,
      programas: progsOk, criado_por: o.usuarioCargaId, ...(criado ? { criado_em: instanteDeData(criado) } : {}),
    }
    if (dep && dep.ok) {
      registrar(r, 'carregavel', undefined, linha('materiais_carteira', idDe('materiais', r.id), { ...base, cliente_carteira_id: dep.id, grupo_id: dep.grupoId }))
    } else {
      if (o.reterGlobais) { registrar(r, 'retido', GLOBAL_RETIDO); continue }
      // P-11: sem origem para `uso_interno`; a recomendação é true (não vai à cliente)
      registrar(r, 'carregavel', undefined, linha('materiais_da_biblioteca', idDe('materiais', r.id), { ...base, uso_interno: true }))
    }
  }
  for (const r of por('mensagens')) {
    const d = r.data
    if (o.reterGlobais) { registrar(r, 'retido', GLOBAL_RETIDO); continue }
    if (temNul(r)) { rejeitar(r, 'caractere_nulo'); continue }
    const chave = cheio(d, 'chave')
    const titulo = cheio(d, 'titulo')
    const texto = cheio(d, 'texto')
    const falha = chave === null || !/^[a-z0-9_]{1,40}$/.test(chave) ? 'chave_invalida' : titulo === null || !entre(titulo, 1, 120) ? 'titulo_invalido' : texto === null || !entre(texto, 1, 4000) ? 'texto_fora_de_1_a_4000' : null
    if (falha) { rejeitar(r, falha); continue }
    registrar(r, 'carregavel', undefined, linha('mensagens_comerciais', idDe('mensagens', r.id), { chave: chave!, titulo: titulo!, texto: texto!, criado_por: o.usuarioCargaId }, { coluna: 'chave', valor: chave! }))
  }
  for (const r of por('roteiros')) {
    const d = r.data
    if (o.reterGlobais) { registrar(r, 'retido', GLOBAL_RETIDO); continue }
    if (temNul(r)) { rejeitar(r, 'caractere_nulo'); continue }
    const chave = cheio(d, 'chave')
    const titulo = cheio(d, 'titulo')
    const quando = txt(d, 'quando') ?? ''
    const msg = txt(d, 'mensagem') ?? ''
    const passos = lista(d, 'passos')
    const falha =
      chave === null || !/^[a-z0-9_]{1,40}$/.test(chave) ? 'chave_invalida'
      : titulo === null || !entre(titulo, 1, 120) ? 'titulo_invalido'
      : quando.length > 200 ? 'quando_acima_de_200'
      : msg.length > 4000 ? 'mensagem_acima_de_4000'
      : passos.length > 30 ? 'passos_acima_de_30'
      : chave === 'primeiro' && !msg.includes('{origem_do_contato}') ? 'primeiro_sem_origem_do_contato'
      : null
    if (falha) { rejeitar(r, falha); continue }
    registrar(r, 'carregavel', undefined, linha('roteiros_comerciais', idDe('roteiros', r.id), { chave: chave!, titulo: titulo!, quando, mensagem: msg, passos, criado_por: o.usuarioCargaId }, { coluna: 'chave', valor: chave! }))
  }

  // Todo documento tem um destino contabilizado (§0.2): o que não foi
  // classificado acima é falha do carregador, nunca silêncio.
  const vistos = new Set(resultados.map((x) => `${x.colecao}|${x.idOrigem}`))
  for (const r of dump.registros) {
    if (!vistos.has(`${r.colecao}|${r.id}`)) {
      resultados.push({ colecao: r.colecao, idOrigem: r.id, rotuloCliente: rotuloDe(r.clienteId), estado: 'rejeitado', motivo: 'colecao_desconhecida', filhas: [] })
    }
  }

  // alvo bruto do total lido de mensalidade (todas as linhas de clientes_fin lidas)
  for (const f of por('clientes_fin')) {
    const v = cheio(f.data, 'valor_mensal')
    const e = v === null ? null : escalar(v, 2)
    if (e && !ehErroDeValor(e)) alvos.mrrCentavosTotalLido += e.valor
  }

  const usuarios = [...refUsuarios].sort(([a], [b]) => a.localeCompare(b)).map(([, v], i) => ({ origem: `usuario#${i + 1}`, ...v }))
  return { resultados, derivados, avisos, alvos, contagens: dump.contagens, usuarios }
}

/** Todas as linhas a gravar, na ordem das chaves estrangeiras. */
export function linhasDaCarga(p: Plano): LinhaDeCarga[] {
  const todas: LinhaDeCarga[] = [...p.derivados]
  for (const r of p.resultados) {
    if (r.estado !== 'carregavel') continue
    if (r.principal) todas.push(r.principal)
    todas.push(...r.filhas)
  }
  const pos = (t: string): number => ORDEM_DAS_TABELAS.indexOf(t as (typeof ORDEM_DAS_TABELAS)[number])
  return todas.map((l, i) => ({ l, i })).sort((a, b) => pos(a.l.tabela) - pos(b.l.tabela) || a.i - b.i).map((x) => x.l)
}

// ---------------------------------------------------------------------------
// Correspondência de clientes (P-19): relatório, nunca fusão
// ---------------------------------------------------------------------------

export type ClienteExistente = { id: string; grupoId: string; nome: string; cnpj: string | null }
export type Candidato = { origemId: string; existenteId: string; por: 'cnpj' | 'nome'; /** mais de um existente casa: homônimo/duplicata, a dona escolhe */ ambiguo?: true }

export function proporCorrespondencias(dump: Dump, existentes: readonly ClienteExistente[]): Candidato[] {
  const saida: Candidato[] = []
  for (const r of dump.registros.filter((x) => x.colecao === 'clientes')) {
    const proprio = idDe('clientes', r.id)
    const cnpjBruto = cheio(r.data, 'cnpj')
    const cnpj = cnpjBruto === null ? null : soDigitos(cnpjBruto)
    const nome = cheio(r.data, 'nome')
    const outros = existentes.filter((e) => e.id !== proprio)
    const porCnpj = cnpj && cnpj.length === 14 ? outros.find((e) => e.cnpj === cnpj) : undefined
    if (porCnpj) {
      const varios = outros.filter((e) => e.cnpj === cnpj).length > 1
      saida.push({ origemId: r.id, existenteId: porCnpj.id, por: 'cnpj', ...(varios ? { ambiguo: true as const } : {}) })
      continue
    }
    const porNome = nome ? outros.find((e) => norm(e.nome) === norm(nome)) : undefined
    if (porNome) {
      const varios = nome ? outros.filter((e) => norm(e.nome) === norm(nome)).length > 1 : false
      saida.push({ origemId: r.id, existenteId: porNome.id, por: 'nome', ...(varios ? { ambiguo: true as const } : {}) })
    }
  }
  return saida
}

/**
 * Sem aprovação, cliente com candidato é RETIDO (nem criado nem fundido); sem
 * candidato, entra como NOVO. Aprovação: `NOVO` ou `EXISTENTE:<uuid>`.
 */
export function decidirClientes(
  candidatos: readonly Candidato[],
  aprovacoes: Record<string, string>,
  existentes: readonly ClienteExistente[],
  dump: Dump,
): Record<string, DecisaoCliente> {
  const out: Record<string, DecisaoCliente> = {}
  for (const r of dump.registros.filter((x) => x.colecao === 'clientes')) {
    const ap = aprovacoes[r.id]
    const cand = candidatos.find((c) => c.origemId === r.id)
    if (ap === 'NOVO') out[r.id] = { tipo: 'novo' }
    else if (ap?.startsWith('EXISTENTE:')) {
      const alvo = existentes.find((e) => e.id === ap.slice('EXISTENTE:'.length))
      out[r.id] = alvo ? { tipo: 'existente', id: alvo.id, grupoId: alvo.grupoId } : { tipo: 'retido', motivo: 'aprovacao_aponta_para_cliente_inexistente' }
    } else if (cand) out[r.id] = { tipo: 'retido', motivo: `candidato_a_correspondencia_por_${cand.por}_aguardando_aprovacao` }
    else out[r.id] = { tipo: 'novo' }
  }
  return out
}

// ---------------------------------------------------------------------------
// Relatório: só contagens e códigos
// ---------------------------------------------------------------------------

const ESTADOS: Estado[] = ['carregavel', 'mesclado', 'correspondido', 'retido', 'rejeitado', 'fora']

export function relatorioDoPlano(p: Plano, valores = false): string[] {
  const V = (x: unknown): string => (valores ? String(x) : "[oculto: so em --saida]")
  const L: string[] = []
  const colecoes = [...new Set(p.resultados.map((r) => r.colecao))].sort()
  const lidas = p.resultados.length
  L.push(`Documentos lidos: ${lidas}  (historico ${p.contagens.historico}, acessos_cliente ${p.contagens.acessos_cliente}, auth_users ${p.contagens.auth_users}, storage ${p.contagens.storage_objects}: nao carregados)`)
  L.push('')
  L.push('Por colecao  (lidas = carregaveis + mesclados + correspondidos + retidos + rejeitadas + fora)')
  for (const c of colecoes) {
    const rs = p.resultados.filter((r) => r.colecao === c)
    const n = (e: Estado): number => rs.filter((r) => r.estado === e).length
    const soma = ESTADOS.reduce((a, e) => a + n(e), 0)
    L.push(`  ${c.padEnd(16)} lidas ${String(rs.length).padStart(3)} = carreg ${n('carregavel')} + mescl ${n('mesclado')} + corresp ${n('correspondido')} + retidas ${n('retido')} + rejeit ${n('rejeitado')} + fora ${n('fora')}  ${soma === rs.length ? 'OK' : 'REPROVA'}`)
  }
  L.push('')
  L.push('Rejeitadas / retidas / fora, por motivo (codigos)')
  const mot = new Map<string, number>()
  for (const r of p.resultados) if (r.estado === 'rejeitado' || r.estado === 'retido' || r.estado === 'fora') mot.set(`${r.estado}  ${r.colecao}  ${r.motivo ?? ''}`, (mot.get(`${r.estado}  ${r.colecao}  ${r.motivo ?? ''}`) ?? 0) + 1)
  for (const [k, v] of [...mot].sort()) L.push(`  ${k}: ${v}`)
  L.push('')
  L.push('Por cliente  (rotulos ordinais, sem ids nem nomes)')
  const rot = [...new Set(p.resultados.map((r) => r.rotuloCliente))].sort()
  for (const t of rot) {
    const rs = p.resultados.filter((r) => r.rotuloCliente === t && r.colecao !== 'diagnosticos')
    const cols = [...new Set(rs.map((r) => r.colecao))].sort()
    L.push(`  ${t}: ` + cols.map((c) => {
      const x = rs.filter((r) => r.colecao === c)
      const ok = x.filter((r) => r.estado === 'carregavel' || r.estado === 'mesclado' || r.estado === 'correspondido').length
      return `${c} ${ok}/${x.length}`
    }).join(', '))
  }
  L.push('')
  const GLOB = ['mensagens', 'roteiros']
  const globais = p.resultados.filter((r) => (GLOB.includes(r.colecao)) || r.principal?.tabela === 'materiais_da_biblioteca' || (r.colecao === 'materiais' && r.motivo === 'tabela_global_exige_administrar_fora_do_papel_da_carga'))
  const gc = (e: Estado): number => globais.filter((r) => r.estado === e).length
  L.push(`Tabelas globais (mensagens, roteiros, biblioteca): ${globais.length} documentos; carregaveis ${gc('carregavel')}, retidos para o Operador ${gc('retido')}, rejeitados ${gc('rejeitado')}. So o dono do esquema ou o Operador as escreve (README).`)
  L.push('')
  L.push('Referencias a usuario da origem (mapa de usuarios; sem mapa a referencia nula fica NULL ou vai ao usuario de carga)')
  const tot = p.usuarios.reduce((a, u) => ({ m: a.m + u.mapeadas, n: a.n + u.nulas }), { m: 0, n: 0 })
  L.push(`  total ${tot.m + tot.n}: resolvidas pelo mapa ${tot.m}, ficam nulas/usuario de carga ${tot.n}`)
  for (const u of p.usuarios) L.push(`  ${u.origem}: mapeadas ${u.mapeadas}, nulas ${u.nulas}`)
  L.push('')
  L.push('Avisos (conversoes e perdas declaradas)')
  for (const [k, v] of Object.entries(p.avisos).sort()) if (v > 0) L.push(`  ${k}: ${v}`)
  L.push('')
  L.push('Alvos de conferencia (calculados da origem)')
  L.push(`  mensalidade, soma lida (centavos): ${V(p.alvos.mrrCentavosTotalLido)}`)
  L.push(`  mensalidade, soma dos clientes carregaveis (centavos): ${V(Object.values(p.alvos.mrrCentavosPorCliente).reduce((a, b) => a + b, 0n))}`)
  L.push(`  arredondamentos declarados: ${p.alvos.arredondamentos}`)
  const metaLabel = (id: string): string => `meta#${[...new Set(p.resultados.filter((r) => r.colecao === 'metas').map((r) => r.idOrigem))].indexOf(id) + 1}`
  L.push(`  check-ins carregaveis somados por meta (unidade da meta): ` + (Object.entries(p.alvos.checkinsPorMeta).map(([m, v]) => `${metaLabel(m)}=${V(v)}`).join(' ') || 'nenhum'))
  L.push(`  tarefas carregaveis por status: ` + (Object.entries(p.alvos.tarefasPorStatus).map(([k, v]) => `${k}=${v}`).join(' ') || 'nenhuma'))
  L.push(`  reunioes carregaveis por tipo: ` + (Object.entries(p.alvos.reunioesPorTipo).map(([k, v]) => `${k}=${v}`).join(' ') || 'nenhuma'))
  return L
}

// ---------------------------------------------------------------------------
// Valores lidos direto do dump (independentes do plano) e lista de decisão
// ---------------------------------------------------------------------------

/**
 * Valor de cada documento que carrega dinheiro ou medição (mensalidade e
 * check-in), recalculado do dump cru. É o "Σ origem" da equação de contas.
 */
export function valoresDoDump(dump: Dump): Record<string, { valor: bigint; unidade: string }> {
  const out: Record<string, { valor: bigint; unidade: string }> = {}
  for (const f of dump.registros.filter((r) => r.colecao === 'clientes_fin')) {
    const v = cheio(f.data, 'valor_mensal')
    const e = v === null ? null : escalar(v, 2)
    if (e && !ehErroDeValor(e)) out[`clientes_fin|${f.id}`] = { valor: e.valor, unidade: 'R$' }
  }
  const metas = new Map(dump.registros.filter((r) => r.colecao === 'metas').map((m) => [m.id, m]))
  for (const c of dump.registros.filter((r) => r.colecao === 'checkins')) {
    const m = metas.get(cheio(c.data, 'meta_id') ?? '')
    const u = m ? txt(m.data, 'unidade') : null
    const v = cheio(c.data, 'valor')
    if (!u || v === null || !['R$', 'un', '%', 'dias'].includes(u)) continue
    const e = escalar(v, u === 'un' || u === 'dias' ? 0 : 2)
    if (!ehErroDeValor(e)) out[`checkins|${c.id}`] = { valor: e.valor, unidade: u }
  }
  return out
}

/**
 * Lista das metas rejeitadas por regra do domínio (% com soma, sem indicador),
 * para a dona decidir. CONTÉM DADO (títulos, valores): só pode ser escrita FORA
 * do repositório — o CLI recusa caminho dentro dele.
 */
export function metasParaDecisaoCsv(dump: Dump, plano: Plano): string {
  const esc = (s: string): string => `"${s.replace(/"/g, '""')}"`
  const docs = new Map(dump.registros.filter((r) => r.colecao === 'metas').map((m) => [m.id, m]))
  const linhas = ['cliente,titulo,unidade,agregacao,valor_meta,valor_inicial,motivo']
  for (const r of plano.resultados) {
    if (r.colecao !== 'metas' || r.estado !== 'rejeitado') continue
    if (r.motivo !== 'percentual_com_soma' && r.motivo !== 'indicador_invalido') continue
    const d = docs.get(r.idOrigem)?.data ?? {}
    linhas.push([r.rotuloCliente, txt(d, 'titulo') ?? '', txt(d, 'unidade') ?? '', txt(d, 'agregacao') ?? '', txt(d, 'valor_meta') ?? '', txt(d, 'valor_inicial') ?? '', r.motivo].map(esc).join(','))
  }
  return linhas.join('\r\n') + '\r\n'
}
