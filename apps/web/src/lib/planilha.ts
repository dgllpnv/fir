/**
 * Planilha: ler a que a clínica traz, e gerar a modelo que ela baixa.
 *
 * **Por que o SheetJS entra no pacote em vez de vir de CDN.** O protótipo
 * busca a biblioteca de `cdn.sheetjs.com` em tempo de uso, e a própria
 * mensagem de erro dele admite o preço: *"Não foi possível abrir o leitor de
 * planilhas. Verifique a internet"*. A recepção importa o cadastro no dia da
 * implantação, muitas vezes com a internet da clínica caindo — e uma
 * importação que depende de um terceiro estar de pé na hora é uma
 * implantação que pode travar por fora.
 *
 * **`import()` dinâmico, não estático.** O SheetJS é grande e só serve a três
 * caixas de importação. Carregado aqui, ele não entra no primeiro byte da
 * tela Hoje, que é a que a clínica deixa aberta o dia inteiro.
 */
type SheetJS = typeof import('xlsx')

let promessa: Promise<SheetJS> | null = null

async function carregar(): Promise<SheetJS> {
  // Guardar a PROMESSA, não o módulo: duas caixas abertas em sequência rápida
  // pediriam dois downloads se o guarda fosse sobre o resultado.
  promessa ??= import('xlsx')
  return promessa
}

/** Uma aba da planilha modelo: matriz de linhas, e a largura de cada coluna. */
export type Aba = {
  nome: string
  linhas: readonly (readonly (string | number | Date | null)[])[]
  larguras: readonly number[]
  /** Colunas (1-based) a formatar como data — a coluna só, não a célula. */
  colunasDeData?: readonly number[]
}

/**
 * Gera o arquivo e dispara o download.
 *
 * Duas abas é o padrão das três modelos do protótipo: os dados e as
 * **Instruções**. A aba de instruções não é enfeite — ela é onde mora a regra
 * que a planilha não consegue dizer ("apague a linha 2", "não informe
 * quantidades"), e foi ela que a PO pediu de volta.
 */
export async function baixarPlanilha(arquivo: string, abas: readonly Aba[]): Promise<void> {
  const X = await carregar()
  const livro = X.utils.book_new()
  for (const aba of abas) {
    const folha = X.utils.aoa_to_sheet(aba.linhas as unknown[][], {
      cellDates: true,
      dateNF: 'dd/mm/yyyy',
    })
    folha['!cols'] = aba.larguras.map((wch) => ({ wch }))
    for (const col of aba.colunasDeData ?? []) {
      // Formata a célula de exemplo (linha 2), que é onde a data aparece. Sem
      // o `z`, o Excel mostra o número de série e a usuária copia o formato
      // errado para as linhas que ela mesma digita.
      const ref = X.utils.encode_cell({ c: col - 1, r: 1 })
      const celula = folha[ref] as { z?: string } | undefined
      if (celula) celula.z = 'dd/mm/yyyy'
    }
    X.utils.book_append_sheet(livro, folha, aba.nome)
  }
  X.writeFile(livro, arquivo)
}

/* ===================================================================
 * EXPORTAÇÃO DE RELATÓRIO (T8; appsec C17; LGPD L-IN-15)
 * =================================================================== */

/**
 * Uma célula do arquivo exportado. `numero` é o que NÓS formatamos a partir de
 * um campo tipado do servidor (dinheiro, quantidade, contagem); `texto` é todo
 * o resto — nome, motivo, item, o cabeçalho — e é onde mora o risco: o motivo
 * de uma saída de estoque é texto digitado pela equipe.
 */
export type CelulaDaPlanilha = { readonly tipo: 'texto' | 'numero'; readonly valor: string }

export type TabelaDaPlanilha = {
  readonly nomeDaAba: string
  readonly linhas: readonly (readonly CelulaDaPlanilha[])[]
}

/**
 * A célula de texto que a planilha leria como fórmula (appsec C17): começa —
 * depois de espaço — com `=`, `+`, `-` ou `@`, ou começa com TAB, CR ou LF.
 * `"=cmd()"` numa célula é o ataque clássico de injeção em CSV: o Excel o
 * executa ao abrir, com o nome da clínica no cabeçalho dando credibilidade.
 */
export const textoPerigoso = (v: string): boolean => /^\s*[=+\-@]/.test(v) || /^[\t\r\n]/.test(v)

/** O separador é `;`: o Excel em português usa a vírgula como decimal e abre `;` direto. */
const SEPARADOR = ';'

function celulaDoCsv(c: CelulaDaPlanilha): string {
  const v = c.tipo === 'texto' && textoPerigoso(c.valor) ? `'${c.valor}` : c.valor
  // RFC 4180: aspas em volta quando há separador, aspas, quebra de linha ou
  // espaço nas pontas; aspas internas dobradas. Sem isto, `" ;=1` partiria a
  // célula em duas, e a segunda começaria com `=`.
  return /[;"\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replaceAll('"', '""')}"` : v
}

/** CSV RFC 4180, com BOM (o Excel precisa dele para ler UTF-8) e CRLF. */
export function montarCsv(tabela: TabelaDaPlanilha): string {
  return `﻿${tabela.linhas.map((l) => l.map(celulaDoCsv).join(SEPARADOR)).join('\r\n')}\r\n`
}

/** O nome de aba que o Excel aceita: até 31 caracteres, sem `[]:*?/\`. */
const nomeDeAba = (n: string): string => n.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Relatório'

/**
 * XLSX com TODA célula `t: 's'` (appsec C17): nenhuma `f`, nenhum hyperlink
 * (`l`). A folha é montada célula a célula, e não por `aoa_to_sheet`, para que
 * nenhuma heurística da biblioteca decida o tipo de um texto que começa com `=`.
 */
export async function montarXlsx(tabela: TabelaDaPlanilha): Promise<Uint8Array<ArrayBuffer>> {
  const X = await carregar()
  const folha: import('xlsx').WorkSheet = {}
  let colunas = 1
  const larguras: number[] = []
  tabela.linhas.forEach((linha, r) => {
    colunas = Math.max(colunas, linha.length)
    linha.forEach((c, col) => {
      folha[X.utils.encode_cell({ r, c: col })] = { t: 's', v: c.valor }
      larguras[col] = Math.min(60, Math.max(larguras[col] ?? 8, c.valor.length + 2))
    })
  })
  folha['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, tabela.linhas.length - 1), c: colunas - 1 } })
  folha['!cols'] = larguras.map((wch) => ({ wch }))
  const livro = X.utils.book_new()
  X.utils.book_append_sheet(livro, folha, nomeDeAba(tabela.nomeDaAba))
  // `as`: com `type: 'array'` o SheetJS devolve um ArrayBuffer; a tipagem dele é `any`.
  return new Uint8Array(X.write(livro, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer)
}

/**
 * Entrega o arquivo ao navegador, da MEMÓRIA (LGPD L-IN-15): um `Blob` e um
 * link temporário, revogado logo depois. Nada vai para `localStorage`,
 * `sessionStorage` nem IndexedDB.
 */
export function baixarArquivo(nome: string, conteudo: BlobPart, tipo: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Lê a tabela de um arquivo `.xlsx`/`.xls`/`.csv` **ou** do texto colado.
 *
 * Devolve `null` quando não há nem um nem outro — a tela distingue "escolha o
 * arquivo ou cole as linhas" de "o arquivo não deu para ler", e as duas
 * frases levam a ações diferentes.
 *
 * O separador do texto colado é detectado, na ordem tabulação → ponto e
 * vírgula → vírgula: colar de uma planilha dá tabulação, e exportação
 * brasileira dá ponto e vírgula porque a vírgula é o decimal.
 */
/**
 * Texto de um CSV, qualquer que seja a codificação que a planilha usou ao salvar.
 *
 * O SheetJS recebe bytes sem BOM e lê como Latin-1: um CSV em UTF-8 vira
 * "ResponsÃ¡vel" — a coluna deixa de casar e o nome "José" seria gravado como
 * "JosÃ©" no cadastro de paciente. Aqui UTF-8 é tentado primeiro, em modo
 * estrito (byte inválido não passa em silêncio); o Excel brasileiro salva
 * "CSV" em Windows-1252, que é o que sobra quando não é UTF-8.
 */
export function textoDoCsv(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

export async function lerTabela(
  arquivo: File | null | undefined,
  texto: string,
): Promise<string[][] | null> {
  if (arquivo) {
    const X = await carregar()
    const bytes = await arquivo.arrayBuffer()
    const ehCsv = /\.(csv|txt)$/i.test(arquivo.name) || arquivo.type === 'text/csv'
    const livro = ehCsv
      ? // raw: o CSV é texto. Sem isso o SheetJS converte "2001-05-14" em Date e
        // devolve "5/13/01" (mês e dia trocados, e um dia a menos pelo fuso).
        X.read(textoDoCsv(bytes), { type: 'string', raw: true })
      : X.read(bytes, { type: 'array', cellDates: true })
    const primeira = livro.SheetNames[0]
    if (primeira === undefined) return null
    const folha = livro.Sheets[primeira]
    if (folha === undefined) return null
    const linhas = X.utils.sheet_to_json<unknown[]>(folha, { header: 1, raw: false, defval: '' })
    return linhas.map((l) => l.map((v) => (v == null ? '' : String(v)).trim()))
  }
  if (texto.trim() !== '') {
    const sep = texto.includes('\t') ? '\t' : texto.includes(';') ? ';' : ','
    return texto
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((l) => l.split(sep).map((v) => v.trim()))
  }
  return null
}
