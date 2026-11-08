import { lookup as lookupDoSistema, type LookupAddress } from 'node:dns'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'

/**
 * Baixa o feed iCal da clínica — e só ele.
 *
 * O link é digitado por quem tem `config`, e o servidor vai buscá-lo: é a
 * forma clássica de SSRF. Sem estas travas, um link para
 * `https://169.254.169.254/` ou para o Postgres da rede interna faria o
 * worker ler o que a clínica não pode ler.
 *
 *  - só `https:` e porta 443;
 *  - o endereço é conferido NO `lookup` da conexão, não antes dela: conferir
 *    antes e conectar depois deixa o DNS responder outro IP na segunda
 *    pergunta (rebinding);
 *  - redirecionamento é seguido no máximo 3 vezes, e cada destino passa pelas
 *    mesmas travas;
 *  - prazo total de 20 s e teto de 5 MB: um feed que não acaba não prende o
 *    worker das outras clínicas.
 *
 * As mensagens são para a TELA da clínica. Nenhuma inclui o link, que é
 * segredo (ADR 0019).
 */
export class FalhaAoBaixar extends Error {}

export const TETO_DE_BYTES = 5 * 1024 * 1024
const PRAZO_MS = 20_000
const MAXIMO_DE_REDIRECIONAMENTOS = 3

const PROIBIDOS = new BlockList()
for (const [rede, prefixo] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PROIBIDOS.addSubnet(rede, prefixo, 'ipv4')
}
for (const [rede, prefixo] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['64:ff9b::', 96],
] as const) {
  PROIBIDOS.addSubnet(rede, prefixo, 'ipv6')
}

/** O endereço é da internet pública? IPv4 mapeado em IPv6 é conferido como IPv4. */
export function enderecoPublico(ip: string): boolean {
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (mapeado !== null) return enderecoPublico(mapeado[1]!)
  const v = isIP(ip)
  if (v === 0) return false
  return !PROIBIDOS.check(ip, v === 4 ? 'ipv4' : 'ipv6')
}

type Lookup = typeof lookupDoSistema

/** Envolve o `lookup` para recusar QUALQUER resposta privada. */
export function lookupSoPublico(base: Lookup = lookupDoSistema): Lookup {
  const envolvido = ((
    host: string,
    opcoes: unknown,
    callback: (e: NodeJS.ErrnoException | null, a: string | LookupAddress[], f?: number) => void,
  ) => {
    base(host, { ...(opcoes as object), all: true }, (erro, enderecos) => {
      if (erro) return callback(erro, '', 0)
      const lista = enderecos as unknown as LookupAddress[]
      if (lista.length === 0 || lista.some((a) => !enderecoPublico(a.address))) {
        const e: NodeJS.ErrnoException = new Error('endereço não público')
        e.code = 'ENDERECO_PROIBIDO'
        return callback(e, '', 0)
      }
      const todos = (opcoes as { all?: boolean } | undefined)?.all === true
      if (todos) return callback(null, lista)
      callback(null, lista[0]!.address, lista[0]!.family)
    })
  }) as unknown as Lookup
  // `as unknown as`: a assinatura de `dns.lookup` tem cinco sobrecargas, e o
  // `https.request` chama sempre a de três argumentos. Reescrever as cinco só
  // para o compilador é cerimônia sem ganho de segurança.
  return envolvido
}

function conferirUrl(texto: string): URL {
  let u: URL
  try {
    u = new URL(texto)
  } catch {
    throw new FalhaAoBaixar('O link da agenda não é um endereço válido.')
  }
  if (u.protocol !== 'https:') throw new FalhaAoBaixar('O link da agenda precisa começar com https://.')
  if (u.port !== '' && u.port !== '443') throw new FalhaAoBaixar('O link da agenda usa uma porta não permitida.')
  if (u.username !== '' || u.password !== '') throw new FalhaAoBaixar('O link da agenda não pode ter usuário e senha.')
  // IP literal no link é conferido aqui; nome passa pelo lookup.
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) !== 0 && !enderecoPublico(host)) {
    throw new FalhaAoBaixar('O link da agenda aponta para um endereço interno.')
  }
  return u
}

export type Baixador = (url: string) => Promise<string>

export function criarBaixador(lookup: Lookup = lookupSoPublico()): Baixador {
  return async (url: string) => {
    const prazo = Date.now() + PRAZO_MS
    let atual = conferirUrl(url)
    for (let salto = 0; salto <= MAXIMO_DE_REDIRECIONAMENTOS; salto++) {
      const r = await umaRequisicao(atual, lookup, prazo)
      if (r.tipo === 'corpo') return r.texto
      atual = conferirUrl(new URL(r.para, atual).toString())
    }
    throw new FalhaAoBaixar('O link da agenda redirecionou vezes demais.')
  }
}

type Resposta = { tipo: 'corpo'; texto: string } | { tipo: 'redirecionar'; para: string }

function umaRequisicao(u: URL, lookup: Lookup, prazo: number): Promise<Resposta> {
  return new Promise((resolver, rejeitar) => {
    const restante = prazo - Date.now()
    if (restante <= 0) return rejeitar(new FalhaAoBaixar('O link da agenda demorou demais para responder.'))

    const req = https.request(
      u,
      {
        method: 'GET',
        lookup,
        timeout: restante,
        headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1', 'user-agent': 'FirmareAgenda/1.0' },
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && typeof res.headers.location === 'string') {
          res.resume()
          return resolver({ tipo: 'redirecionar', para: res.headers.location })
        }
        if (status !== 200) {
          res.resume()
          return rejeitar(
            new FalhaAoBaixar(
              status === 401 || status === 403 || status === 404
                ? `O link da agenda respondeu ${status}: confira se ele ainda é válido.`
                : `O link da agenda respondeu ${status}.`,
            ),
          )
        }
        const pedacos: Buffer[] = []
        let total = 0
        res.on('data', (p: Buffer) => {
          total += p.length
          if (total > TETO_DE_BYTES) {
            req.destroy()
            rejeitar(new FalhaAoBaixar('O calendário é grande demais (acima de 5 MB).'))
            return
          }
          pedacos.push(p)
        })
        res.on('end', () => resolver({ tipo: 'corpo', texto: Buffer.concat(pedacos).toString('utf8') }))
        res.on('error', () => rejeitar(new FalhaAoBaixar('A leitura do calendário foi interrompida.')))
      },
    )
    req.on('timeout', () => {
      req.destroy()
      rejeitar(new FalhaAoBaixar('O link da agenda demorou demais para responder.'))
    })
    req.on('error', (e: NodeJS.ErrnoException) => {
      rejeitar(
        new FalhaAoBaixar(
          e.code === 'ENDERECO_PROIBIDO'
            ? 'O link da agenda aponta para um endereço interno.'
            : e.code === 'ENOTFOUND'
              ? 'O endereço do link da agenda não existe.'
              : 'Não foi possível conectar ao link da agenda.',
        ),
      )
    })
    req.end()
  })
}
