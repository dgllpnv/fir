import { inflateRawSync } from 'node:zlib'

/**
 * **Um leitor de ZIP mínimo, para o `.xlsx`.**
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ESCREVER ISTO EM VEZ DE INSTALAR UM PACOTE
 *
 * É a mesma decisão de `estoque/xml.ts`, e os três motivos são mais fortes
 * aqui:
 *
 * **1. O que precisamos é o LITERAL, e nenhuma biblioteca de planilha o
 * entrega.** `xlsx` (SheetJS), `exceljs` e `node-xlsx` devolvem um `number`
 * por célula numérica — o `double` já formado. Dinheiro é inteiro de centavos
 * (regra 1), e a única forma de obtê-lo sem erro é ler os dígitos de
 * `<v>1250.5</v>`. Com um `number` no caminho, o cuidado todo de
 * `Dinheiro.deTexto` é perdido **antes** de a nossa primeira linha rodar — e
 * depois ninguém consegue provar que não perdeu centavo, porque não há mais
 * literal com que comparar.
 *
 * **2. É entrada externa não confiável, e a superfície é a parte caríssima.**
 * O arquivo é um `.zip` que chega por exportação do Google Drive. `inflate`
 * vem do `zlib` do Node — código C auditado, já no processo. O que sobra é
 * ler um diretório central: três estruturas de campos fixos.
 *
 * **3. Dependência nova em código que toca dado de saúde de paciente real
 * tem custo permanente.** SheetJS saiu do npm (o pacote `xlsx` publicado está
 * congelado em 0.18.5, com CVE de prototype pollution e de ReDoS), `exceljs`
 * carrega um parser de XML genérico — e parser de XML genérico é exatamente a
 * porta de XXE que `xml.ts` já decidiu não abrir.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE LEITOR NÃO FAZ, DE PROPÓSITO
 *
 * Não grava em disco, não segue caminho (`../` num nome de entrada não leva a
 * lugar nenhum porque não há escrita), não suporta criptografia, não suporta
 * ZIP64 — um `.xlsx` de planilha de clínica tem megabytes, e o limite de
 * ZIP64 é 4 GB. Cada limite é um `ZipInvalido`, nunca um silêncio.
 */

export class ZipInvalido extends Error {}

/** 64 MB descomprimido por entrada. Uma aba de 100 mil linhas dá ~20 MB. */
const LIMITE_POR_ENTRADA = 64 * 1024 * 1024
/** 4 mil entradas. Um `.xlsx` real tem dezenas. */
const LIMITE_DE_ENTRADAS = 4_000

const ASSINATURA_FIM = 0x06054b50
const ASSINATURA_CENTRAL = 0x02014b50
const ASSINATURA_LOCAL = 0x04034b50

/**
 * Acha o fim do diretório central, varrendo **de trás para frente**.
 *
 * O registro tem tamanho variável (o comentário do arquivo vem no fim), então
 * não há posição fixa. O limite de 64 KB + 22 é o do formato: o comentário
 * tem no máximo 65.535 bytes.
 */
function acharFimDoCentral(b: Buffer): number {
  const minimo = Math.max(0, b.length - 22 - 0xffff)
  for (let i = b.length - 22; i >= minimo; i--) {
    if (b.readUInt32LE(i) === ASSINATURA_FIM) return i
  }
  throw new ZipInvalido('o arquivo não é um .zip (fim do diretório central não encontrado)')
}

/**
 * Descomprime o ZIP inteiro em memória, como `Map<nome, conteúdo>`.
 *
 * Em memória e não por demanda porque **todas** as abas são lidas: uma
 * planilha de clínica tem oito, e abrir o arquivo oito vezes para ler oito
 * abas custa mais do que o arquivo todo.
 */
export function lerZip(bruto: Buffer): Map<string, Buffer> {
  if (bruto.length < 22) throw new ZipInvalido('arquivo vazio ou truncado')

  const fim = acharFimDoCentral(bruto)
  const quantas = bruto.readUInt16LE(fim + 10)
  if (quantas > LIMITE_DE_ENTRADAS) {
    throw new ZipInvalido(`o .zip declara ${quantas} entradas (limite ${LIMITE_DE_ENTRADAS})`)
  }

  let cursor = bruto.readUInt32LE(fim + 16)
  const saida = new Map<string, Buffer>()

  for (let k = 0; k < quantas; k++) {
    if (cursor + 46 > bruto.length || bruto.readUInt32LE(cursor) !== ASSINATURA_CENTRAL) {
      throw new ZipInvalido(`entrada ${k} do diretório central está corrompida`)
    }
    const metodo = bruto.readUInt16LE(cursor + 10)
    const tamanhoComprimido = bruto.readUInt32LE(cursor + 20)
    const tamanhoCru = bruto.readUInt32LE(cursor + 24)
    const tamanhoDoNome = bruto.readUInt16LE(cursor + 28)
    const tamanhoDoExtra = bruto.readUInt16LE(cursor + 30)
    const tamanhoDoComentario = bruto.readUInt16LE(cursor + 32)
    const inicioLocal = bruto.readUInt32LE(cursor + 42)
    const nome = bruto.toString('utf8', cursor + 46, cursor + 46 + tamanhoDoNome)

    if (tamanhoCru > LIMITE_POR_ENTRADA) {
      throw new ZipInvalido(`"${nome}" declara ${tamanhoCru} bytes descomprimidos`)
    }
    if (inicioLocal + 30 > bruto.length || bruto.readUInt32LE(inicioLocal) !== ASSINATURA_LOCAL) {
      throw new ZipInvalido(`"${nome}" aponta para um cabeçalho local inválido`)
    }

    // O cabeçalho LOCAL tem o próprio par nome/extra, e os tamanhos podem
    // diferir dos do central (o campo extra costuma diferir). Os dados
    // começam depois dos DOIS, lidos do local — ler do central aqui é o erro
    // clássico, e ele desloca o início do conteúdo em alguns bytes.
    const nomeLocal = bruto.readUInt16LE(inicioLocal + 26)
    const extraLocal = bruto.readUInt16LE(inicioLocal + 28)
    const inicioDados = inicioLocal + 30 + nomeLocal + extraLocal
    if (inicioDados + tamanhoComprimido > bruto.length) {
      throw new ZipInvalido(`"${nome}" está truncado`)
    }

    const comprimido = bruto.subarray(inicioDados, inicioDados + tamanhoComprimido)
    let conteudo: Buffer
    if (metodo === 0) conteudo = Buffer.from(comprimido)
    else if (metodo === 8) {
      // `maxOutputLength` é a defesa contra bomba de descompressão: um
      // `tamanhoCru` mentiroso no cabeçalho não autoriza alocar 2 GB.
      conteudo = inflateRawSync(comprimido, { maxOutputLength: LIMITE_POR_ENTRADA })
    } else throw new ZipInvalido(`"${nome}" usa o método de compressão ${metodo}`)

    saida.set(nome, conteudo)
    cursor += 46 + tamanhoDoNome + tamanhoDoExtra + tamanhoDoComentario
  }

  return saida
}
