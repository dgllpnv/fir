import {
  type KeyObject,
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto'

/**
 * O COFRE DAS CHAVES DE INTEGRAÇÃO (spec `integracao-medx.md` A.2, gate S-2/S-3/S-6).
 *
 * **Assimétrico, e é o ponto.** A API recebe a chave do MedX do superadmin e
 * a SELA com a chave pública; só o `worker-agenda` tem a privada e a abre.
 * Uma SQL injection no balcão mais o ambiente inteiro da API não abrem o
 * token de clínica nenhuma — com AES simétrico, a mesma variável que cifra
 * decifra, e ela estaria no processo que atende a internet.
 *
 * Forma: X25519 efêmero (uma chave nova por selagem) → HKDF-SHA256 com rótulo
 * `fir:integracoes` → AES-256-GCM. Bytes: `spki efêmera (44) | iv (12) | tag (16) | corpo`.
 *
 * AAD = `integracao:<clinica_id>:<provedor>:v<versão>`. O `clinica_id` vem do
 * CONTEXTO da leitura (`naClinica`), nunca da coluna da própria linha: o
 * selado da clínica A copiado para a linha da B não abre.
 *
 * A IMPRESSÃO (HMAC com pepper fora do banco) existe para a unicidade global
 * (S-6): a mesma chave colada em duas clínicas é recusada sem que o banco
 * guarde nada que a revele.
 */

export const VERSAO_ATUAL_DO_SELO = 1
const TAM_SPKI = 44
const TAM_IV = 12
const TAM_TAG = 16
const ROTULO = 'fir:integracoes'

// Fora de produção, um par FIXO de desenvolvimento, que nunca vale para dado real.
const PUBLICA_DE_DESENVOLVIMENTO = 'MCowBQYDK2VuAyEA0YE9LhTCKrCYsMf7kI8P+YHF22PDXbQK+V8NKbI3sSs='
const PRIVADA_DE_DESENVOLVIMENTO = 'MC4CAQAwBQYDK2VuBCIEIPjdg/GHsp9gsbS7aB5/QRwRDnmJPpBRhc9B3gIB7TR8'
const PEPPER_DE_DESENVOLVIMENTO = 'fir-integracoes-pepper-de-desenvolvimento-nunca-em-producao'

export type ParDeChaves = { readonly publica: string; readonly privada: string }

/** Base64 de DER (spki/pkcs8). É o formato das variáveis de ambiente. */
export function gerarParDeChavesDeIntegracoes(): ParDeChaves {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  return {
    publica: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privada: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  }
}

const publicaDe = (b64: string): KeyObject =>
  createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' })
const privadaDe = (b64: string): KeyObject =>
  createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' })

const aad = (clinicaId: string, provedor: string, versao: number): Buffer =>
  Buffer.from(`integracao:${clinicaId}:${provedor}:v${versao}`, 'utf8')

function chaveSimetrica(compartilhado: Buffer, efemera: Buffer, destinatario: Buffer, versao: number): Buffer {
  return Buffer.from(
    hkdfSync('sha256', compartilhado, Buffer.concat([efemera, destinatario]), `${ROTULO}:aes-256-gcm:v${versao}`, 32),
  )
}

function exigido(ambiente: NodeJS.ProcessEnv, nome: string, dev: string): string {
  const v = ambiente[nome]
  if (v !== undefined && v.length >= 32) return v
  if (ambiente['NODE_ENV'] === 'production') {
    throw new Error(
      `${nome} ausente ou curta. Rode infra/producao/implantar.sh, que gera o par de chaves das ` +
        'integrações uma vez e nunca o sobrescreve.',
    )
  }
  return dev
}

/** O lado da API: sela e calcula a impressão. Não tem a privada. */
export class SeloDeIntegracoes {
  private readonly publica: KeyObject
  private readonly publicaDer: Buffer
  private readonly pepper: Buffer

  constructor(opcoes: { chavePublica: string; pepper: string }) {
    this.publica = publicaDe(opcoes.chavePublica)
    this.publicaDer = this.publica.export({ type: 'spki', format: 'der' })
    this.pepper = Buffer.from(hkdfSync('sha256', opcoes.pepper, ROTULO, 'hmac-impressao:v1', 32))
  }

  static doAmbiente(ambiente: NodeJS.ProcessEnv = process.env): SeloDeIntegracoes {
    return new SeloDeIntegracoes({
      chavePublica: exigido(ambiente, 'FIR_INTEGRACOES_CHAVE_PUBLICA', PUBLICA_DE_DESENVOLVIMENTO),
      pepper: exigido(ambiente, 'FIR_INTEGRACOES_PEPPER', PEPPER_DE_DESENVOLVIMENTO),
    })
  }

  static finalDaChave(chave: string): string {
    return chave.slice(-4)
  }

  selar(clinicaId: string, provedor: string, segredo: string): { cifrado: Buffer; versao: number } {
    const versao = VERSAO_ATUAL_DO_SELO
    const efemera = generateKeyPairSync('x25519')
    const efemeraDer = efemera.publicKey.export({ type: 'spki', format: 'der' })
    const compartilhado = diffieHellman({ privateKey: efemera.privateKey, publicKey: this.publica })
    const chave = chaveSimetrica(compartilhado, efemeraDer, this.publicaDer, versao)
    const iv = randomBytes(TAM_IV)
    const c = createCipheriv('aes-256-gcm', chave, iv)
    c.setAAD(aad(clinicaId, provedor, versao))
    const corpo = Buffer.concat([c.update(segredo, 'utf8'), c.final()])
    return { cifrado: Buffer.concat([efemeraDer, iv, c.getAuthTag(), corpo]), versao }
  }

  /** HMAC-SHA-256 hex, com o provedor na mensagem. Nunca reversível sem o pepper. */
  impressao(provedor: string, segredo: string): string {
    return createHmac('sha256', this.pepper).update(`${provedor}:${segredo}`).digest('hex')
  }
}

/** O lado do worker: só abre. */
export class AberturaDeIntegracoes {
  private readonly privada: KeyObject
  private readonly publicaDer: Buffer

  constructor(opcoes: { chavePrivada: string }) {
    this.privada = privadaDe(opcoes.chavePrivada)
    this.publicaDer = createPublicKey(this.privada).export({ type: 'spki', format: 'der' })
  }

  static doAmbiente(ambiente: NodeJS.ProcessEnv = process.env): AberturaDeIntegracoes {
    return new AberturaDeIntegracoes({
      chavePrivada: exigido(ambiente, 'FIR_INTEGRACOES_CHAVE_PRIVADA', PRIVADA_DE_DESENVOLVIMENTO),
    })
  }

  /** `null` quando não abre: outra clínica (AAD), outra chave, versão errada ou bytes adulterados. */
  abrir(clinicaId: string, provedor: string, cifrado: Buffer, versao: number): string | null {
    if (versao !== VERSAO_ATUAL_DO_SELO || cifrado.length <= TAM_SPKI + TAM_IV + TAM_TAG) return null
    try {
      const efemeraDer = cifrado.subarray(0, TAM_SPKI)
      const compartilhado = diffieHellman({
        privateKey: this.privada,
        publicKey: createPublicKey({ key: efemeraDer, format: 'der', type: 'spki' }),
      })
      const chave = chaveSimetrica(compartilhado, efemeraDer, this.publicaDer, versao)
      const d = createDecipheriv('aes-256-gcm', chave, cifrado.subarray(TAM_SPKI, TAM_SPKI + TAM_IV))
      d.setAAD(aad(clinicaId, provedor, versao))
      d.setAuthTag(cifrado.subarray(TAM_SPKI + TAM_IV, TAM_SPKI + TAM_IV + TAM_TAG))
      return Buffer.concat([d.update(cifrado.subarray(TAM_SPKI + TAM_IV + TAM_TAG)), d.final()]).toString('utf8')
    } catch {
      return null
    }
  }
}
