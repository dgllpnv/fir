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
export async function lerTabela(
  arquivo: File | null | undefined,
  texto: string,
): Promise<string[][] | null> {
  if (arquivo) {
    const X = await carregar()
    const livro = X.read(await arquivo.arrayBuffer(), { type: 'array', cellDates: true })
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
