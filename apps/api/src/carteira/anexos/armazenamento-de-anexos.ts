import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * O ARMAZENAMENTO DOS ANEXOS — o volume dedicado da VPS (D-22 item 6, A-13).
 *
 * Cada arquivo é cifrado POR ARQUIVO com AES-256-GCM antes de tocar o disco:
 *
 *   `FIRA` · versão (1 byte) · IV (12 bytes) · cifrado · tag (16 bytes)
 *
 * - O nome no disco é a `chave_armazenamento` (UUID aleatório), nunca o nome
 *   do usuário — e a chave é validada como UUID antes de virar caminho, então
 *   nenhum `../` chega ao `join`.
 * - O AAD é a própria chave: um arquivo copiado (ou renomeado) para a chave
 *   de outro anexo não decifra. Trocar o arquivo de dois anexos no disco não
 *   troca o que cada um entrega.
 * - A chave mestra vem de `CHAVE_ANEXOS` (segredo do deploy, gerado por
 *   `implantar.sh`), nunca do banco: quem tem o dump do Postgres e o volume,
 *   mas não o `.env`, não lê nada.
 * - A leitura decifra o arquivo INTEIRO e confere a tag antes de devolver um
 *   byte sequer. GCM em stream entregaria texto não autenticado antes de
 *   descobrir que ele foi adulterado; com o teto de 20 MB, decifrar em memória
 *   custa pouco e fecha essa porta.
 */
export interface ArmazenamentoDeAnexos {
  gravar(chave: string, conteudo: Buffer): Promise<void>
  /** Lança `ArquivoDeAnexoAusente` se não houver arquivo, `ArquivoDeAnexoAdulterado` se a tag não conferir. */
  ler(chave: string): Promise<Buffer>
  /** Idempotente: apagar o que já não existe não é erro (o worker é reentrante). */
  apagar(chave: string): Promise<void>
}

export const ARMAZENAMENTO_DE_ANEXOS = Symbol('ArmazenamentoDeAnexos')

export class ArquivoDeAnexoAusente extends Error {}
export class ArquivoDeAnexoAdulterado extends Error {}

const MAGICO = Buffer.from('FIRA', 'latin1')
const VERSAO = 1
const TAM_IV = 12
const TAM_TAG = 16
const CABECALHO = MAGICO.length + 1 + TAM_IV

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * A chave AES de 256 bits, derivada (HKDF-SHA256) do segredo do ambiente.
 * Derivar, e não usar o segredo direto: `implantar.sh` gera 40 caracteres
 * alfanuméricos (≈ 238 bits), não 32 bytes crus — e o rótulo fixo separa
 * esta chave de qualquer outro uso que o mesmo segredo venha a ter.
 */
export function chaveDeCifra(segredo: string): Buffer {
  return Buffer.from(hkdfSync('sha256', segredo, 'fir:anexos-carteira', 'aes-256-gcm:v1', 32))
}

/**
 * Lê `CHAVE_ANEXOS`. Em produção, ausente ou curta é ERRO NA SUBIDA — falhar
 * no segundo zero é melhor que gravar o primeiro anexo de uma clínica com uma
 * chave conhecida. Fora de produção, uma chave fixa de desenvolvimento (como
 * as senhas `fir_local_dev` do compose local), que nunca vale para dado real.
 */
export function segredoDeAnexosDoAmbiente(ambiente: NodeJS.ProcessEnv = process.env): string {
  const bruto = ambiente['CHAVE_ANEXOS']
  if (bruto !== undefined && bruto.length >= 32) return bruto
  if (ambiente['NODE_ENV'] === 'production') {
    throw new Error(
      'CHAVE_ANEXOS ausente ou com menos de 32 caracteres. Rode infra/producao/implantar.sh, ' +
        'que a acrescenta ao .env uma vez e nunca a sobrescreve.',
    )
  }
  return 'fir-anexos-chave-de-desenvolvimento-nunca-em-producao'
}

export function diretorioDeAnexosDoAmbiente(ambiente: NodeJS.ProcessEnv = process.env): string {
  const bruto = ambiente['DIRETORIO_ANEXOS']
  if (bruto !== undefined && bruto !== '') return bruto
  return ambiente['NODE_ENV'] === 'production' ? '/dados/anexos' : join(tmpdir(), 'fir-anexos')
}

function caminhoSeguro(diretorio: string, chave: string): string {
  if (!UUID.test(chave)) throw new Error('chave de armazenamento inválida')
  return join(diretorio, chave)
}

export function cifrar(chave: Buffer, aad: string, conteudo: Buffer): Buffer {
  const iv = randomBytes(TAM_IV)
  const c = createCipheriv('aes-256-gcm', chave, iv)
  c.setAAD(Buffer.from(aad, 'utf8'))
  const cifrado = Buffer.concat([c.update(conteudo), c.final()])
  return Buffer.concat([MAGICO, Buffer.from([VERSAO]), iv, cifrado, c.getAuthTag()])
}

export function decifrar(chave: Buffer, aad: string, bruto: Buffer): Buffer {
  if (bruto.length < CABECALHO + TAM_TAG || !bruto.subarray(0, MAGICO.length).equals(MAGICO)) {
    throw new ArquivoDeAnexoAdulterado()
  }
  if (bruto[MAGICO.length] !== VERSAO) throw new ArquivoDeAnexoAdulterado()
  const iv = bruto.subarray(MAGICO.length + 1, CABECALHO)
  const tag = bruto.subarray(bruto.length - TAM_TAG)
  const d = createDecipheriv('aes-256-gcm', chave, iv)
  d.setAAD(Buffer.from(aad, 'utf8'))
  d.setAuthTag(tag)
  try {
    return Buffer.concat([d.update(bruto.subarray(CABECALHO, bruto.length - TAM_TAG)), d.final()])
  } catch {
    throw new ArquivoDeAnexoAdulterado()
  }
}

const ehCodigo = (e: unknown, codigo: string): boolean =>
  typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === codigo

export class ArmazenamentoCifradoEmDisco implements ArmazenamentoDeAnexos {
  private readonly chave: Buffer
  private pronto: Promise<void> | null = null

  constructor(
    private readonly diretorio: string,
    segredo: string,
  ) {
    this.chave = chaveDeCifra(segredo)
  }

  private garantirDiretorio(): Promise<void> {
    // 0o700: o volume é do usuário `node` do container e de mais ninguém.
    this.pronto ??= mkdir(this.diretorio, { recursive: true, mode: 0o700 }).then(() => undefined)
    return this.pronto
  }

  async gravar(chave: string, conteudo: Buffer): Promise<void> {
    const destino = caminhoSeguro(this.diretorio, chave)
    await this.garantirDiretorio()
    // Grava num temporário e renomeia: um processo derrubado no meio deixa
    // lixo `.parcial`, nunca um arquivo truncado com o nome definitivo.
    const parcial = `${destino}.parcial-${randomBytes(6).toString('hex')}`
    const f = await open(parcial, 'wx', 0o600)
    try {
      await f.writeFile(cifrar(this.chave, chave, conteudo))
      await f.sync()
    } finally {
      await f.close()
    }
    await rename(parcial, destino)
  }

  async ler(chave: string): Promise<Buffer> {
    let bruto: Buffer
    try {
      bruto = await readFile(caminhoSeguro(this.diretorio, chave))
    } catch (e) {
      if (ehCodigo(e, 'ENOENT')) throw new ArquivoDeAnexoAusente()
      throw e
    }
    return decifrar(this.chave, chave, bruto)
  }

  async apagar(chave: string): Promise<void> {
    try {
      await unlink(caminhoSeguro(this.diretorio, chave))
    } catch (e) {
      if (!ehCodigo(e, 'ENOENT')) throw e
    }
  }
}
