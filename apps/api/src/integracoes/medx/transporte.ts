import type { lookup as lookupDoSistema } from 'node:dns'
import type http from 'node:http'
import https from 'node:https'
import { lookupSoPublico } from '../../agenda/baixar-feed'
import { type CodigoDoMedx, ErroDoMedx } from './erros'

/**
 * O FIO até o MedX (gate appsec S-8, S-10, S-11). Só isto fala com a rede, e
 * só nestes termos:
 *
 *  - a base é uma CONSTANTE por ambiente (`MEDX_API_BASE`), validada na
 *    subida: `https:`, porta 443. Nunca campo por clínica;
 *  - **redirect não é seguido**: um 3xx reenviaria o `Authorization` ao destino;
 *  - a conexão passa por `lookupSoPublico`: o worker enxerga Postgres e Redis;
 *  - só `application/json`, com teto de bytes e prazo;
 *  - toda falha vira um código do catálogo (`erros.ts`), sem texto de fora.
 *
 * Devolve o TEXTO do JSON: quem lê decide como interpretar (o faturamento
 * precisa do texto exato dos números, gate N-B4).
 */

export const PREFIXO_DA_API = '/api/integration/v1'
const PRAZO_MS = 20_000
const TETO_PADRAO = 2 * 1024 * 1024

export type Pedido = {
  readonly metodo: 'GET' | 'POST'
  /** Relativo à API: `/agenda/usuario-atual`. */
  readonly caminho: string
  readonly query?: Readonly<Record<string, string>>
  readonly bearer?: string
  readonly corpo?: unknown
}
export type Transporte = (p: Pedido) => Promise<string>

type Requisitar = typeof https.request | typeof http.request
type Lookup = typeof lookupDoSistema

export function baseDoMedxDoAmbiente(ambiente: NodeJS.ProcessEnv = process.env): string {
  return ambiente['MEDX_API_BASE'] ?? 'https://integracao-app.medx.med.br'
}

export function criarTransporte(opcoes: {
  base: string
  requisitar?: Requisitar
  lookup?: Lookup
  tetoDeBytes?: number
}): Transporte {
  const base = new URL(opcoes.base)
  const requisitar = opcoes.requisitar ?? https.request
  // Só o teste injeta `requisitar` (http contra servidor local); em produção é https:443.
  if (opcoes.requisitar === undefined) {
    if (base.protocol !== 'https:') throw new Error('MEDX_API_BASE precisa ser https.')
    if (base.port !== '' && base.port !== '443') throw new Error('MEDX_API_BASE precisa usar a porta 443.')
  }
  if (base.pathname !== '/' || base.search !== '' || base.username !== '') {
    throw new Error('MEDX_API_BASE é só esquema e host, sem caminho.')
  }
  const lookup = opcoes.lookup ?? lookupSoPublico()
  const teto = opcoes.tetoDeBytes ?? TETO_PADRAO

  return (p) =>
    new Promise<string>((resolver, rejeitar) => {
      const falha = (codigo: CodigoDoMedx) => rejeitar(new ErroDoMedx(codigo))
      // O caminho é montado por nós, mas pode carregar um id lido do MedX
      // (S-10): nada de `..`, `?`, `#` nem caractere fora do seguro.
      if (!/^(\/[A-Za-z0-9_\-:.]+)+$/.test(p.caminho) || p.caminho.split('/').some((s) => s === '..' || s === '.')) {
        return falha('contrato')
      }
      const url = new URL(PREFIXO_DA_API + p.caminho, base)
      for (const [k, v] of Object.entries(p.query ?? {})) url.searchParams.set(k, v)
      const corpo = p.corpo === undefined ? undefined : Buffer.from(JSON.stringify(p.corpo), 'utf8')

      const req = requisitar(
        url,
        {
          method: p.metodo,
          lookup,
          timeout: PRAZO_MS,
          headers: {
            accept: 'application/json',
            'user-agent': 'FirmareIntegracao/1.0',
            ...(p.bearer === undefined ? {} : { authorization: `Bearer ${p.bearer}` }),
            ...(corpo === undefined
              ? {}
              : { 'content-type': 'application/json', 'content-length': String(corpo.length) }),
          },
        },
        (res) => {
          const status = res.statusCode ?? 0
          if (status >= 300 && status < 400) {
            res.resume()
            return falha('redirecionou')
          }
          if (status !== 200) {
            res.resume()
            return falha(
              status === 401
                ? 'recusada'
                : status === 403
                  ? 'sem_permissao'
                  : status === 404
                    ? 'nao_encontrado'
                    : status === 429
                      ? 'limite'
                      : 'indisponivel',
            )
          }
          const tipo = String(res.headers['content-type'] ?? '')
          if (!/^application\/json\b/i.test(tipo)) {
            res.resume()
            return falha('nao_json')
          }
          const pedacos: Buffer[] = []
          let total = 0
          res.on('data', (b: Buffer) => {
            total += b.length
            if (total > teto) {
              req.destroy()
              falha('grande_demais')
              return
            }
            pedacos.push(b)
          })
          res.on('end', () => resolver(Buffer.concat(pedacos).toString('utf8')))
          res.on('error', () => falha('rede'))
        },
      )
      req.on('timeout', () => {
        req.destroy()
        falha('tempo')
      })
      // O objeto de erro do cliente HTTP nunca é repassado: ele carrega os cabeçalhos.
      req.on('error', () => falha('rede'))
      if (corpo !== undefined) req.write(corpo)
      req.end()
    })
}
