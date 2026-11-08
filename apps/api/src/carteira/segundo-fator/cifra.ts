import {
  BYTES_SEGREDO_TOTP,
  CARACTERES_CODIGO_DE_RECUPERACAO,
  QUANTIDADE_CODIGOS_DE_RECUPERACAO,
  codificarBase32,
} from '@fir/domain'
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'

/**
 * O SEGREDO TOTP EM REPOUSO (gate appsec A-12).
 *
 * - AES-256-GCM, IV de 96 bits sorteado a cada cifra.
 * - A chave vem de `FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA` — segredo do deploy
 *   (`infra/producao/implantar.sh`), nunca no banco nem no repositório.
 *   `fir_carteira` lê o ciphertext; a chave ele nunca vê.
 * - AAD = `usuario_gestao:<id>:v<versão>`: o ciphertext de A copiado para a
 *   linha de B não decifra (caso de abuso 31). A versão entra no AAD e numa
 *   coluna própria (`totp_chave_versao`) para a rotação: a chave nova nasce
 *   com outra versão, e a velha continua decifrando até cada segredo ser
 *   recifrado.
 *
 * Mesma forma de `CHAVE_ANEXOS` (`anexos/armazenamento-de-anexos.ts`):
 * derivada por HKDF com rótulo próprio, e AUSENTE EM PRODUÇÃO É ERRO NA
 * SUBIDA. Fora de produção, uma chave fixa de desenvolvimento que nunca vale
 * para dado real.
 *
 * O PEPPER dos códigos de recuperação sai do mesmo segredo por outro rótulo
 * do HKDF: uma variável de ambiente a menos para perder, e nenhuma relação
 * utilizável entre as duas chaves derivadas.
 */

export const VERSAO_ATUAL_DA_CHAVE = 1
const TAM_IV = 12
const TAM_TAG = 16
const CHAVE_DE_DESENVOLVIMENTO = 'fir-segundo-fator-carteira-chave-de-desenvolvimento-nunca-em-producao'

export function segredoDoSegundoFatorDoAmbiente(ambiente: NodeJS.ProcessEnv = process.env): string {
  const bruto = ambiente['FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA']
  if (bruto !== undefined && bruto.length >= 32) return bruto
  if (ambiente['NODE_ENV'] === 'production') {
    throw new Error(
      'FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA ausente ou com menos de 32 caracteres. Rode ' +
        'infra/producao/implantar.sh, que a acrescenta ao .env uma vez e nunca a sobrescreve.',
    )
  }
  return CHAVE_DE_DESENVOLVIMENTO
}

const derivar = (segredo: string, rotulo: string): Buffer =>
  Buffer.from(hkdfSync('sha256', segredo, 'fir:segundo-fator-carteira', rotulo, 32))

/**
 * As chaves, derivadas uma vez. Lidas na construção do serviço — então uma
 * produção sem a variável cai NA SUBIDA, não no primeiro cadastro.
 */
export class CofreDoSegundoFator {
  private readonly chaves: ReadonlyMap<number, Buffer>
  private readonly pepper: Buffer

  constructor(segredo: string = segredoDoSegundoFatorDoAmbiente()) {
    this.chaves = new Map([[VERSAO_ATUAL_DA_CHAVE, derivar(segredo, 'aes-256-gcm:v1')]])
    this.pepper = derivar(segredo, 'hmac-recuperacao:v1')
  }

  novoSegredo(): Buffer {
    return randomBytes(BYTES_SEGREDO_TOTP)
  }

  cifrar(usuarioGestaoId: string, segredo: Buffer): { cifrado: Buffer; versao: number } {
    const versao = VERSAO_ATUAL_DA_CHAVE
    const iv = randomBytes(TAM_IV)
    const c = createCipheriv('aes-256-gcm', this.chaves.get(versao)!, iv)
    c.setAAD(aad(usuarioGestaoId, versao))
    const corpo = Buffer.concat([c.update(segredo), c.final()])
    return { cifrado: Buffer.concat([iv, c.getAuthTag(), corpo]), versao }
  }

  /** `null` quando não decifra: chave errada, linha errada (AAD) ou bytes adulterados. */
  decifrar(usuarioGestaoId: string, cifrado: Buffer, versao: number): Buffer | null {
    const chave = this.chaves.get(versao)
    if (!chave || cifrado.length <= TAM_IV + TAM_TAG) return null
    try {
      const d = createDecipheriv('aes-256-gcm', chave, cifrado.subarray(0, TAM_IV))
      d.setAAD(aad(usuarioGestaoId, versao))
      d.setAuthTag(cifrado.subarray(TAM_IV, TAM_IV + TAM_TAG))
      return Buffer.concat([d.update(cifrado.subarray(TAM_IV + TAM_TAG)), d.final()])
    } catch {
      return null
    }
  }

  /**
   * HMAC-SHA-256 com pepper fora do banco (A-12). O id do usuário entra na
   * mensagem: o mesmo código em duas contas tem hashes diferentes, e um hash
   * copiado de uma linha para outra não autentica.
   */
  hashDoCodigoDeRecuperacao(usuarioGestaoId: string, normalizado: string): string {
    return createHmac('sha256', this.pepper).update(`${usuarioGestaoId}:${normalizado}`).digest('hex')
  }
}

const aad = (usuarioGestaoId: string, versao: number): Buffer =>
  Buffer.from(`usuario_gestao:${usuarioGestaoId}:v${versao}`, 'utf8')

/**
 * Dez códigos de 12 caracteres base32 (60 bits cada), já normalizados.
 * 8 bytes sorteados → 13 caracteres base32 → os 12 primeiros: cada caractere
 * carrega 5 bits uniformes do CSPRNG.
 */
export function sortearCodigosDeRecuperacao(): string[] {
  return Array.from({ length: QUANTIDADE_CODIGOS_DE_RECUPERACAO }, () =>
    codificarBase32(randomBytes(8)).slice(0, CARACTERES_CODIGO_DE_RECUPERACAO),
  )
}
