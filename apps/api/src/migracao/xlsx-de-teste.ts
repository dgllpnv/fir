import { deflateRawSync } from 'node:zlib'

/**
 * **Um ESCRITOR de `.xlsx` mínimo — só para teste.**
 *
 * Nenhum código de produção o importa, e não existe caso de uso para ele em
 * produção: o produto LÊ planilha, nunca escreve. Ele mora em `src` por um
 * motivo só — `leitor-de-planilha.e2e.test.ts` precisa de um arquivo `.xlsx`
 * **de verdade** para provar que o leitor funciona, e a alternativa seria
 * versionar um binário no repositório.
 *
 * E versionar o binário era a opção errada por duas razões: um `.xlsx` de
 * fixture não se lê num diff, então ninguém revisa o que ele contém; e o
 * arquivo que importa é o da clínica, que **nunca** entra no repositório
 * (`docs/Planilhas/` está no `.gitignore`, e é dado de saúde de paciente
 * real). Com o escritor, a fixture é **código legível, com dado inventado**.
 *
 * Ele escreve o SUBCONJUNTO que a v20 produz, e de propósito escreve as
 * formas ESTRANHAS que as planilhas reais têm:
 *
 *  - `t="s"` com tabela de strings compartilhada, inclusive `<si>` com vários
 *    `<t>` (texto parcialmente formatado);
 *  - célula numérica com o LITERAL decimal, do jeito que a exportação o
 *    escreve (`450` sai como `450.0`);
 *  - célula OMITIDA no meio da linha, e LINHA omitida;
 *  - abas fora da ordem dos arquivos (`sheet1.xml` não é a primeira aba);
 *  - `Target` do rel às vezes relativo, às vezes absoluto.
 *
 * Se ele não escrevesse essas formas, o teste do leitor provaria que o leitor
 * lê o arquivo que o teste escreve — e nada mais.
 */

export type CelulaDeTeste = { readonly texto: string } | { readonly numero: string } | null

export type AbaDeTeste = {
  readonly nome: string
  /** Linha a linha; `null` numa célula a OMITE do XML. */
  readonly linhas: readonly (readonly CelulaDeTeste[])[]
  /** Pula o número de linha, para provar que o leitor usa `r=` e não a ordem. */
  readonly pularLinha?: number
}

const escapar = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** `0` → `"A"`, `26` → `"AA"`. */
function letraDaColuna(i: number): string {
  let n = i + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function crc32(buf: Buffer): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

type Entrada = { nome: string; cru: Buffer }

function zipar(entradas: readonly Entrada[]): Buffer {
  const locais: Buffer[] = []
  const centrais: Buffer[] = []
  let desloc = 0

  for (const e of entradas) {
    const nome = Buffer.from(e.nome, 'utf8')
    const comprimido = deflateRawSync(e.cru)
    const crc = crc32(e.cru)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comprimido.length, 18)
    local.writeUInt32LE(e.cru.length, 22)
    local.writeUInt16LE(nome.length, 26)
    locais.push(local, nome, comprimido)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(comprimido.length, 20)
    central.writeUInt32LE(e.cru.length, 24)
    central.writeUInt16LE(nome.length, 28)
    central.writeUInt32LE(desloc, 42)
    centrais.push(central, nome)

    desloc += 30 + nome.length + comprimido.length
  }

  const corpo = Buffer.concat(locais)
  const diretorio = Buffer.concat(centrais)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(entradas.length, 8)
  fim.writeUInt16LE(entradas.length, 10)
  fim.writeUInt32LE(diretorio.length, 12)
  fim.writeUInt32LE(corpo.length, 16)
  return Buffer.concat([corpo, diretorio, fim])
}

/**
 * Empacota partes CRUAS num `.zip`, para os casos de arquivo ESTRAGADO.
 *
 * Existe porque não dá para "editar a string" de um `.xlsx`: as partes são
 * deflatadas, então um `replace` sobre os bytes não acha o XML. O teste do
 * caminho de recusa precisa montar o pacote errado de propósito.
 */
export function empacotar(partes: Readonly<Record<string, string>>): Buffer {
  return zipar(Object.entries(partes).map(([nome, cru]) => ({ nome, cru: Buffer.from(cru) })))
}

export function escreverXlsx(abas: readonly AbaDeTeste[]): Buffer {
  // A tabela de strings compartilhada, com um `<si>` partido em dois `<t>`
  // para a primeira — é como uma planilha real guarda texto com formatação
  // parcial, e ler só o primeiro `<t>` corta o nome no meio.
  const indiceDaString = new Map<string, number>()
  const ordem: string[] = []
  const indexar = (s: string): number => {
    const achado = indiceDaString.get(s)
    if (achado !== undefined) return achado
    const i = ordem.length
    ordem.push(s)
    indiceDaString.set(s, i)
    return i
  }

  const xmlDasAbas = abas.map((aba, k) => {
    const linhas: string[] = []
    let numero = 1
    for (const linha of aba.linhas) {
      if (aba.pularLinha !== undefined && numero === aba.pularLinha) numero += 1
      const celulas = linha
        .map((c, i) => {
          if (c === null) return ''
          const ref = `${letraDaColuna(i)}${numero}`
          if ('numero' in c) return `<c r="${ref}"><v>${c.numero}</v></c>`
          return `<c r="${ref}" t="s"><v>${indexar(c.texto)}</v></c>`
        })
        .join('')
      linhas.push(`<row r="${numero}">${celulas}</row>`)
      numero += 1
    }
    // O ARQUIVO não corresponde à ordem da aba: a aba `k` vira
    // `sheet{n-k}.xml`. É o caso real, e ele pega quem lê por número.
    return { arquivo: `xl/worksheets/sheet${abas.length - k}.xml`, xml: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${linhas.join('')}</sheetData></worksheet>` }
  })

  const si = ordem
    .map((s, i) =>
      i === 0 && s.length > 2
        ? `<si><t>${escapar(s.slice(0, 2))}</t><t>${escapar(s.slice(2))}</t></si>`
        : `<si><t xml:space="preserve">${escapar(s)}</t></si>`,
    )
    .join('')

  const sheets = abas
    .map((a, i) => `<sheet name="${escapar(a.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')
  const rels = xmlDasAbas
    .map(
      (x, i) =>
        // Metade dos `Target` relativos, metade absolutos — as duas formas
        // existem, e o leitor tem de resolver as duas.
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${i % 2 === 0 ? x.arquivo.replace('xl/', '') : `/${x.arquivo}`}"/>`,
    )
    .join('')

  return zipar([
    {
      nome: '[Content_Types].xml',
      cru: Buffer.from(
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
      ),
    },
    {
      nome: '_rels/.rels',
      cru: Buffer.from(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdWb" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      nome: 'xl/workbook.xml',
      cru: Buffer.from(
        `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`,
      ),
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      cru: Buffer.from(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
      ),
    },
    {
      nome: 'xl/sharedStrings.xml',
      cru: Buffer.from(
        `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${ordem.length}" uniqueCount="${ordem.length}">${si}</sst>`,
      ),
    },
    ...xmlDasAbas.map((x) => ({ nome: x.arquivo, cru: Buffer.from(x.xml) })),
  ])
}
