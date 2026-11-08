import { type AbaLida, type CelulaDaPlanilha, FORMATO_DO_ID_DA_PLANILHA, type Relogio, type Result, erro, ok } from '@fir/domain'
import { type KeyObject, createPrivateKey, sign } from 'node:crypto'
import {
  type ErroDeLeituraDaPlanilha,
  type EstruturaDaPlanilha,
  type LeitorDePlanilha,
  erroDeLeitura,
} from './leitor-de-planilha'

/**
 * **O ADAPTADOR DO GOOGLE SHEETS** — API v4, conta de serviço (D-22 item 7).
 *
 * Sem SDK: o fluxo de conta de serviço é um JWT RS256 assinado com
 * `node:crypto` e trocado por um token em `oauth2.googleapis.com`; a leitura é
 * `fetch` em `sheets.googleapis.com`. Duas URLs FIXAS, e é só para elas que
 * este processo fala (gate A-16) — nenhuma parte de nenhuma URL vem de
 * usuário, exceto o id da planilha, que é conferido contra o formato e
 * codificado. `redirect: 'error'`: um 3xx não leva a lugar nenhum.
 *
 * **A chave privada.** Vem de `GOOGLE_SA_JSON` (segredo do deploy, nunca
 * banco, nunca imagem, nunca log). É convertida em `KeyObject` na hora e o
 * texto PEM não é guardado: um `KeyObject` serializado vira `{}`, então nem
 * um `console.log(this)` acidental a vaza. Nenhuma mensagem de erro deste
 * arquivo inclui o corpo de uma resposta ou a credencial — os erros saem do
 * conjunto fechado de `MENSAGENS_DE_LEITURA`.
 *
 * Escopo `spreadsheets.readonly`: a conta não escreve em planilha nenhuma.
 */
export const URL_DO_TOKEN = 'https://oauth2.googleapis.com/token'
export const URL_DO_SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets'
export const ESCOPO_SOMENTE_LEITURA = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const HOSTS_PERMITIDOS = new Set(['oauth2.googleapis.com', 'sheets.googleapis.com'])

/** Teto de resposta: 4 abas de respostas semanais cabem com folga; uma planilha de 50 MB não é de indicadores. */
const MAXIMO_DE_BYTES = 8 * 1024 * 1024
const PRAZO_MS = 20_000
/** Linhas e colunas lidas por aba. As respostas de um ano e meio são ~80 linhas; 5000 é teto, não expectativa. */
const INTERVALO = 'A1:AZ5000'

export type ContaDeServico = { readonly email: string; readonly chave: KeyObject }

/**
 * Lê `GOOGLE_SA_JSON`. Devolve `null` quando ausente ou inválida — sem dizer
 * por quê no texto (a mensagem poderia citar um pedaço da chave). O worker
 * sobe mesmo assim e grava "não configurado" em cada leitura, que é o que a
 * tela mostra.
 */
export function contaDeServicoDoAmbiente(json: string | undefined): ContaDeServico | null {
  if (json === undefined || json.trim() === '') return null
  try {
    const dados: unknown = JSON.parse(json)
    if (typeof dados !== 'object' || dados === null) return null
    const email = (dados as Record<string, unknown>)['client_email']
    const pem = (dados as Record<string, unknown>)['private_key']
    if (typeof email !== 'string' || typeof pem !== 'string') return null
    if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(email)) return null
    return { email, chave: createPrivateKey(pem) }
  } catch {
    return null
  }
}

/** O e-mail da conta, para a tela dizer com quem compartilhar — o único pedaço do JSON que não é segredo. */
export function emailDaContaDeServico(json: string | undefined): string | null {
  return contaDeServicoDoAmbiente(json)?.email ?? null
}

type Busca = (url: string, init: RequestInit) => Promise<Response>

type Resposta = { readonly status: number; readonly corpo: unknown }

const base64url = (texto: string): string => Buffer.from(texto, 'utf8').toString('base64url')

/** Célula do Sheets (`UNFORMATTED_VALUE`) → célula do domínio. Número vira TEXTO decimal aqui, antes de qualquer conta. */
function celula(v: unknown): CelulaDaPlanilha {
  if (typeof v === 'number') {
    const t = String(v)
    // `String(1e21)` é "1e+21": notação científica não é decimal simples, e o domínio a recusa como texto.
    return /^-?\d+(\.\d+)?$/.test(t) ? { numeroDecimal: t } : t
  }
  if (typeof v === 'string') return v.length > 2000 ? v.slice(0, 2000) : v
  if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO'
  return ''
}

const intervaloDaAba = (titulo: string): string => `'${titulo.replace(/'/g, "''")}'!${INTERVALO}`

export class LeitorGoogleSheets implements LeitorDePlanilha {
  private token: { valor: string; expiraEm: number } | null = null

  constructor(
    private readonly conta: ContaDeServico | null,
    private readonly relogio: Relogio,
    private readonly busca: Busca = (url, init) => fetch(url, init),
  ) {}

  async lerEstrutura(spreadsheetId: string): Promise<Result<EstruturaDaPlanilha, ErroDeLeituraDaPlanilha>> {
    if (!FORMATO_DO_ID_DA_PLANILHA.test(spreadsheetId)) return erro(erroDeLeitura('nao_encontrada'))
    const url = `${URL_DO_SHEETS}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(
      'properties.timeZone,sheets.properties.title',
    )}`
    const r = await this.lerDoSheets(url)
    if (r.tipo === 'erro') return r
    const corpo = r.valor as { properties?: { timeZone?: unknown }; sheets?: { properties?: { title?: unknown } }[] }
    const fuso = typeof corpo.properties?.timeZone === 'string' ? corpo.properties.timeZone : null
    const abas = (Array.isArray(corpo.sheets) ? corpo.sheets : []).flatMap((s) =>
      typeof s?.properties?.title === 'string' ? [s.properties.title] : [],
    )
    return ok({ fuso: fuso !== null && fusoValido(fuso) ? fuso : null, abas })
  }

  async lerAbas(spreadsheetId: string, titulos: readonly string[]): Promise<Result<readonly AbaLida[], ErroDeLeituraDaPlanilha>> {
    if (!FORMATO_DO_ID_DA_PLANILHA.test(spreadsheetId)) return erro(erroDeLeitura('nao_encontrada'))
    if (titulos.length === 0) return ok([])
    const params = new URLSearchParams()
    for (const t of titulos) params.append('ranges', intervaloDaAba(t))
    params.set('majorDimension', 'ROWS')
    params.set('valueRenderOption', 'UNFORMATTED_VALUE')
    params.set('dateTimeRenderOption', 'SERIAL_NUMBER')
    const r = await this.lerDoSheets(`${URL_DO_SHEETS}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}`)
    if (r.tipo === 'erro') return r
    const intervalos = (r.valor as { valueRanges?: { values?: unknown }[] }).valueRanges
    if (!Array.isArray(intervalos)) return erro(erroDeLeitura('indisponivel'))
    // A API devolve os intervalos NA ORDEM pedida.
    return ok(
      titulos.map((titulo, i) => {
        const valores = intervalos[i]?.values
        const linhas = Array.isArray(valores)
          ? valores.map((linha: unknown) => (Array.isArray(linha) ? linha.map(celula) : []))
          : []
        return { titulo, linhas }
      }),
    )
  }

  private async lerDoSheets(url: string): Promise<Result<unknown, ErroDeLeituraDaPlanilha>> {
    const token = await this.obterToken()
    if (token.tipo === 'erro') return token
    const r = await this.pedir(url, { method: 'GET', headers: { authorization: `Bearer ${token.valor}` } })
    if (r.tipo === 'erro') return r
    const { status, corpo } = r.valor
    if (status === 200) return ok(corpo)
    if (status === 401) this.token = null
    if (status === 401) return erro(erroDeLeitura('autenticacao'))
    if (status === 403) return erro(erroDeLeitura('sem_acesso'))
    if (status === 404 || status === 400) return erro(erroDeLeitura('nao_encontrada'))
    if (status === 429) return erro(erroDeLeitura('limite'))
    return erro(erroDeLeitura('indisponivel'))
  }

  private async obterToken(): Promise<Result<string, ErroDeLeituraDaPlanilha>> {
    if (this.conta === null) return erro(erroDeLeitura('nao_configurado'))
    const agora = Math.floor(this.relogio.agora().getTime() / 1000)
    if (this.token !== null && this.token.expiraEm - 60 > agora) return ok(this.token.valor)
    const cabecalho = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const declaracoes = base64url(
      JSON.stringify({
        iss: this.conta.email,
        scope: ESCOPO_SOMENTE_LEITURA,
        aud: URL_DO_TOKEN,
        iat: agora,
        exp: agora + 3600,
      }),
    )
    const assinatura = sign('RSA-SHA256', Buffer.from(`${cabecalho}.${declaracoes}`), this.conta.chave).toString(
      'base64url',
    )
    const r = await this.pedir(URL_DO_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${cabecalho}.${declaracoes}.${assinatura}`,
      }).toString(),
    })
    if (r.tipo === 'erro') return r
    const corpo = r.valor.corpo as { access_token?: unknown; expires_in?: unknown }
    if (r.valor.status !== 200 || typeof corpo.access_token !== 'string') {
      return erro(erroDeLeitura(r.valor.status === 429 ? 'limite' : r.valor.status >= 500 ? 'indisponivel' : 'autenticacao'))
    }
    const validade = typeof corpo.expires_in === 'number' && corpo.expires_in > 0 ? corpo.expires_in : 3600
    this.token = { valor: corpo.access_token, expiraEm: agora + validade }
    return ok(corpo.access_token)
  }

  /** Um pedido HTTP com prazo, sem redirecionamento, com teto de bytes e só para os dois hosts do Google. */
  private async pedir(url: string, init: RequestInit): Promise<Result<Resposta, ErroDeLeituraDaPlanilha>> {
    let alvo: URL
    try {
      alvo = new URL(url)
    } catch {
      return erro(erroDeLeitura('indisponivel'))
    }
    if (alvo.protocol !== 'https:' || !HOSTS_PERMITIDOS.has(alvo.hostname)) return erro(erroDeLeitura('indisponivel'))
    let resposta: Response
    try {
      resposta = await this.busca(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(PRAZO_MS) })
    } catch {
      return erro(erroDeLeitura('indisponivel'))
    }
    const texto = await lerComTeto(resposta)
    if (texto === null) return erro(erroDeLeitura('grande_demais'))
    let corpo: unknown = null
    try {
      corpo = texto === '' ? null : JSON.parse(texto)
    } catch {
      corpo = null
    }
    return ok({ status: resposta.status, corpo: corpo ?? {} })
  }
}

/** O corpo como texto, ou `null` se passar do teto (a leitura para no meio, sem bufferizar o resto). */
async function lerComTeto(resposta: Response): Promise<string | null> {
  const declarado = Number(resposta.headers.get('content-length') ?? '0')
  if (declarado > MAXIMO_DE_BYTES) return null
  if (resposta.body === null) return ''
  const leitor = resposta.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    let pedaco: Awaited<ReturnType<typeof leitor.read>>
    try {
      pedaco = await leitor.read()
    } catch {
      return ''
    }
    if (pedaco.done) break
    total += pedaco.value.byteLength
    if (total > MAXIMO_DE_BYTES) {
      await leitor.cancel().catch(() => undefined)
      return null
    }
    partes.push(pedaco.value)
  }
  return Buffer.concat(partes).toString('utf8')
}

function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuso })
    return true
  } catch {
    return false
  }
}
