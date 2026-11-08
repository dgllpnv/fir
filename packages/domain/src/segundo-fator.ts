/**
 * SEGUNDO FATOR DO `Usuário de Gestão` — a parte PURA (gate appsec A-12).
 *
 * Aqui mora a política: qual passo vale, o que é replay, quanto esperar
 * depois de errar, a forma dos códigos e da URI. O HMAC (RFC 4226/6238) e o
 * sorteio de segredo e de código de recuperação precisam de `node:crypto`, e
 * moram na API (`apps/api/src/carteira/segundo-fator/totp.ts`) — este pacote
 * não faz I/O e roda também no navegador.
 *
 * O relógio é sempre parâmetro: o passo vem do instante que o SERVIDOR leu,
 * nunca de um relógio do cliente (A-12: "Relógio do servidor (NTP)").
 */

/** RFC 6238 §4: X = 30 s, T0 = 0. */
export const PASSO_TOTP_SEGUNDOS = 30
export const DIGITOS_TOTP = 6
/** ±1 passo — tolera ~30 s de relógio do celular adiantado ou atrasado. */
export const JANELA_TOTP_PASSOS = 1
/** 160 bits (RFC 4226 §4, R6: "RECOMMENDED 160 bits"). */
export const BYTES_SEGREDO_TOTP = 20
/** Cinco erros num desafio matam o desafio (A-12). */
export const ERROS_POR_DESAFIO = 5
export const QUANTIDADE_CODIGOS_DE_RECUPERACAO = 10
/** 12 caracteres base32 = 60 bits (A-12 pede ≥ 50). */
export const CARACTERES_CODIGO_DE_RECUPERACAO = 12
/** O desafio entre a senha e o código: 5 min (A-12). */
export const DURACAO_DESAFIO_MS = 5 * 60 * 1000
/** O segredo "pendente" do cadastro vence se o primeiro código não chegar. */
export const DURACAO_CADASTRO_PENDENTE_MS = 15 * 60 * 1000

export const passoDoInstante = (instante: Date): number =>
  Math.floor(instante.getTime() / 1000 / PASSO_TOTP_SEGUNDOS)

/**
 * Os passos que ainda podem autenticar agora: a janela de ±1 em volta do
 * atual, MENOS todo passo ≤ ao último aceito — é isto que faz o mesmo código
 * (ou um código mais velho que o último usado) ser recusado na segunda vez,
 * mesmo dentro da janela. O atual vem primeiro só por legibilidade; quem
 * verifica compara contra todos, em tempo constante.
 */
export function passosAceitaveis(passoAtual: number, ultimoAceito: number | null): number[] {
  const janela = [passoAtual]
  for (let d = 1; d <= JANELA_TOTP_PASSOS; d++) janela.push(passoAtual - d, passoAtual + d)
  return janela.filter((p) => p >= 0 && (ultimoAceito === null || p > ultimoAceito))
}

const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 §6, sem padding — a forma que todo app autenticador aceita. */
export function codificarBase32(bytes: Uint8Array): string {
  let saida = ''
  let acumulado = 0
  let bits = 0
  for (const b of bytes) {
    acumulado = (acumulado << 8) | b
    bits += 8
    while (bits >= 5) {
      saida += ALFABETO_BASE32[(acumulado >>> (bits - 5)) & 31]
      bits -= 5
    }
    acumulado &= (1 << bits) - 1
  }
  if (bits > 0) saida += ALFABETO_BASE32[(acumulado << (5 - bits)) & 31]
  return saida
}

/** `null` para caractere fora do alfabeto. Espaço e caixa são tolerados. */
export function decodificarBase32(texto: string): Uint8Array | null {
  const limpo = texto.replace(/[\s=]/g, '').toUpperCase()
  const saida: number[] = []
  let acumulado = 0
  let bits = 0
  for (const ch of limpo) {
    const v = ALFABETO_BASE32.indexOf(ch)
    if (v < 0) return null
    acumulado = (acumulado << 5) | v
    bits += 5
    if (bits >= 8) {
      saida.push((acumulado >>> (bits - 8)) & 255)
      bits -= 8
    }
    acumulado &= (1 << bits) - 1
  }
  return Uint8Array.from(saida)
}

/** Seis dígitos. Espaço tolerado (o app mostra "123 456"); nada mais. */
export function normalizarCodigoTotp(bruto: string): string | null {
  const limpo = bruto.replace(/\s/g, '')
  return new RegExp(`^\\d{${DIGITOS_TOTP}}$`).test(limpo) ? limpo : null
}

/** Doze caracteres do alfabeto base32; hífen, espaço e caixa tolerados. */
export function normalizarCodigoDeRecuperacao(bruto: string): string | null {
  const limpo = bruto.replace(/[\s-]/g, '').toUpperCase()
  if (limpo.length !== CARACTERES_CODIGO_DE_RECUPERACAO) return null
  for (const ch of limpo) if (!ALFABETO_BASE32.includes(ch)) return null
  return limpo
}

/** `ABCDEFGH2345` → `ABCD-EFGH-2345`: lido em voz alta, copiado à mão. */
export const formatarCodigoDeRecuperacao = (normalizado: string): string =>
  normalizado.match(/.{1,4}/g)?.join('-') ?? normalizado

/**
 * Key Uri Format (`otpauth://totp/Emissor:conta?...`). Os parâmetros são os
 * padrões, mas vão explícitos: há app que lê `period` ausente como 60.
 * A tela gera o QR desta string NO NAVEGADOR (A-12) — nunca um serviço de QR.
 */
export function uriOtpauth(p: { emissor: string; conta: string; segredo: Uint8Array }): string {
  const emissor = encodeURIComponent(p.emissor)
  const conta = encodeURIComponent(p.conta)
  return (
    `otpauth://totp/${emissor}:${conta}?secret=${codificarBase32(p.segredo)}` +
    `&issuer=${emissor}&algorithm=SHA1&digits=${DIGITOS_TOTP}&period=${PASSO_TOTP_SEGUNDOS}`
  )
}

const JANELA_DE_FALHAS_MS = 24 * 60 * 60 * 1000
const FALHAS_LIVRES = 4
const ESPERA_BASE_MS = 60_000

export type TentativaDeSegundoFator = { readonly em: Date; readonly sucesso: boolean }

/**
 * Quanto a CONTA ainda espera antes de poder tentar outro código (0 = pode).
 *
 * Por conta, e não por desafio (A-12): um código de 6 dígitos com três
 * válidos por janela cai em ~333 mil tentativas, e desafios novos custam só a
 * senha — que o atacante, neste cenário, já tem. Contadas as falhas depois do
 * último sucesso, nas últimas 24 h: as quatro primeiras são livres; a partir
 * da quinta a espera dobra (1, 2, 4… min), contada da ÚLTIMA falha, com teto
 * de 24 h. Isso deixa ~16 palpites por dia: anos, não minutos.
 */
export function esperaDoSegundoFator(tentativas: readonly TentativaDeSegundoFator[], agora: Date): number {
  const corte = agora.getTime() - JANELA_DE_FALHAS_MS
  const naJanela = tentativas
    .filter((t) => t.em.getTime() > corte)
    .sort((a, b) => a.em.getTime() - b.em.getTime())
  const ultimoSucesso = naJanela.map((t) => t.sucesso).lastIndexOf(true)
  const falhas = naJanela.slice(ultimoSucesso + 1).filter((t) => !t.sucesso)
  if (falhas.length <= FALHAS_LIVRES) return 0
  const expoente = Math.min(falhas.length - FALHAS_LIVRES - 1, 30)
  const espera = Math.min(ESPERA_BASE_MS * 2 ** expoente, JANELA_DE_FALHAS_MS)
  const ultima = falhas[falhas.length - 1]!.em.getTime()
  return Math.max(0, ultima + espera - agora.getTime())
}
