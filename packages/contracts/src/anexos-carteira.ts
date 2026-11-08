import { z } from 'zod'
import { Uuid } from './comum'

/**
 * ANEXOS DE ARQUIVO da carteira (G8 ticket 4C, gate appsec A-13).
 *
 * Um anexo pertence a uma reunião comercial ou a um documento da carteira —
 * o "dono". O arquivo vive cifrado no volume da VPS (D-22 item 6); o que
 * trafega aqui é o metadado.
 */

/** 20 MB — o teto do protótipo (`index.html` L1687) e do A-13. */
export const LIMITE_DE_ANEXO_BYTES = 20 * 1024 * 1024

export const DonoDeAnexo = z.enum(['reuniao', 'documento'])
export type DonoDeAnexo = z.infer<typeof DonoDeAnexo>

/**
 * Os tipos aceitos, como o servidor os DETECTA pelos bytes (nunca pela
 * extensão nem pelo `Content-Type` do navegador). A extensão listada em
 * `EXTENSOES_DE_ANEXO` só serve ao `accept` do seletor de arquivo — é dica de
 * tela, não verificação.
 */
export const TipoDeAnexo = z.enum([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'video/mp4',
  'video/webm',
])
export type TipoDeAnexo = z.infer<typeof TipoDeAnexo>

/** Para o `accept` do `<input type="file">`. Sem `image/*`: deixaria SVG passar (A-13). */
export const EXTENSOES_DE_ANEXO: readonly string[] = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.docx',
  '.xlsx',
  '.pptx',
  '.txt',
  '.csv',
  '.md',
  '.mp4',
  '.webm',
]

export const SituacaoDaVarredura = z.enum(['pendente', 'limpo', 'infectado'])
export type SituacaoDaVarredura = z.infer<typeof SituacaoDaVarredura>

/**
 * Os campos de texto do `multipart/form-data` de `POST /v1/carteira/anexos`.
 * Vêm ANTES do campo `arquivo` no formulário — o servidor lê o arquivo como
 * stream e não volta atrás para buscar campo que chegue depois.
 */
export const EnviarAnexoCampos = z.object({
  donoTipo: DonoDeAnexo,
  donoId: Uuid,
})
export type EnviarAnexoCampos = z.infer<typeof EnviarAnexoCampos>

export const ListarAnexosConsulta = z.object({
  donoTipo: DonoDeAnexo,
  donoId: Uuid,
})
export type ListarAnexosConsulta = z.infer<typeof ListarAnexosConsulta>

/** Um anexo, como a equipe da Firmare o vê. */
export const AnexoCarteira = z.object({
  id: Uuid,
  donoTipo: DonoDeAnexo,
  donoId: Uuid,
  nome: z.string(),
  tipo: TipoDeAnexo,
  /** Bytes do arquivo original. */
  tamanho: z.number().int().positive(),
  situacao: SituacaoDaVarredura,
  /** Instante UTC, ISO 8601. */
  criadoEm: z.string(),
})
export type AnexoCarteira = z.infer<typeof AnexoCarteira>

export const AnexosCarteiraSaida = z.object({ anexos: z.array(AnexoCarteira) })
export type AnexosCarteiraSaida = z.infer<typeof AnexosCarteiraSaida>

export const AnexoEnviadoSaida = z.object({
  anexo: AnexoCarteira,
  /** `true` quando o mesmo arquivo já estava anexado ao mesmo dono (A-20): nada novo foi criado. */
  jaExistia: z.boolean(),
})
export type AnexoEnviadoSaida = z.infer<typeof AnexoEnviadoSaida>

/**
 * Um anexo no PORTAL. Lista branca: sem situação (o portal só vê `limpo`),
 * sem quem enviou, sem hash.
 */
export const AnexoNoPortal = z.object({
  id: Uuid,
  nome: z.string(),
  tipo: TipoDeAnexo,
  tamanho: z.number().int().positive(),
  criadoEm: z.string(),
})
export type AnexoNoPortal = z.infer<typeof AnexoNoPortal>

export const AnexosDoPortalSaida = z.object({ anexos: z.array(AnexoNoPortal) })
export type AnexosDoPortalSaida = z.infer<typeof AnexosDoPortalSaida>

/** Códigos estáveis de recusa — a tela casa o código, nunca o texto. */
export const CodigoDeRecusaDeAnexo = z.enum([
  'ANEXO_TIPO_NAO_ACEITO',
  'ANEXO_GRANDE_DEMAIS',
  'ANEXO_VAZIO',
  'ANEXO_COTA_CHEIA',
  'ANEXO_EM_VERIFICACAO',
  'ANEXO_RECUSADO_PELO_ANTIVIRUS',
])
export type CodigoDeRecusaDeAnexo = z.infer<typeof CodigoDeRecusaDeAnexo>
