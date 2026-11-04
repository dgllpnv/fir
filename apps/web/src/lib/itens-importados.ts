import { celula, mapear, normalizar, simOuNao, type Apelidos } from './colunas'
import { centavosDoTexto } from './dinheiro-digitado'
import { milesimosDoTexto } from './quantidade'

/**
 * Planilha de itens → linhas do contrato, com a CONFERÊNCIA antes do envio.
 *
 * **Por que a conferência existe, e por que ela não decide nada.** O protótipo
 * mostra duas etapas: ler e conferir. A segunda tela diz quantos itens são
 * novos, quantos já existem e quantas linhas ficaram fora — e é ela que torna
 * *"importei e não aconteceu nada"* uma resposta em vez de um silêncio.
 *
 * Mas o que ela mostra é uma **previsão**, não a decisão: a deduplicação de
 * verdade é do servidor, pelos dois índices únicos da `0015` (código
 * normalizado e nome normalizado). A previsão de cá usa a lista de itens que a
 * tela já tem; se ela discordar do banco, o banco vence e o resultado volta
 * diferente do previsto. Decidir aqui seria uma segunda regra de identidade de
 * item — e a primeira divergência seria um item de estoque duplicado.
 *
 * O repetido DENTRO do arquivo, sim, é de cá: duas linhas com o mesmo código
 * no mesmo arquivo nunca chegam ao servidor como duas, porque a segunda só
 * sobrescreveria a primeira sem ninguém ver.
 */

/** A ordem é a do `COLS_IMPORT_EST` do protótipo. Trocá-la quebra a modelo. */
const APELIDOS: Apelidos = [
  ['local', ['local', 'localizacao', 'armazenamento', 'sala', 'onde fica']],
  ['codigo', ['codigo', 'cod', 'sku', 'referencia', 'ref']],
  ['minimo', ['minimo', 'min']],
  ['custo', ['custo', 'preco', 'valor']],
  ['medida', ['unidade de medida', 'medida', 'unid', 'un']],
  ['categoria', ['categoria', 'grupo', 'classe', 'familia', 'tipo']],
  ['rotatividade', ['rotatividade', 'giro']],
  ['validade', ['validade', 'vencimento']],
  ['nome', ['nome', 'produto', 'descricao', 'item', 'material', 'insumo']],
]

const POSICIONAL = {
  nome: 0, categoria: 1, medida: 2, custo: 3, minimo: 4, rotatividade: 5, validade: 6,
  codigo: -1, local: -1,
}

const DO_CABECALHO = ['nome', 'produto', 'descricao', 'item', 'material', 'insumo']

export const LIMITE_DE_ITENS = 2000

export type Situacao = 'novo' | 'existe' | 'fora'

export type LinhaConferida = {
  /** Número da linha na planilha, para a usuária achar o que corrigir. */
  numero: number
  nome: string
  codigo: string
  categoria: string
  medida: string
  local: string
  /** Centavos em texto, como o contrato quer; `null` quando não veio. */
  custo: string | null
  /** Milésimos em texto; `null` quando não veio. */
  minimo: string | null
  altaRotatividade: boolean
  controlaValidade: boolean
  situacao: Situacao
  /** Por que a linha ficou fora, ou o que merece atenção antes de importar. */
  avisos: readonly string[]
  /** O nome do item já cadastrado com que esta linha casou. */
  existente?: string
}

export type Conferencia = {
  linhas: readonly LinhaConferida[]
  novos: number
  existentes: number
  fora: number
}

export type ItemCadastrado = { nome: string; codigo: string }

export function conferirPlanilhaDeItens(
  tabela: readonly (readonly string[])[],
  cadastrados: readonly ItemCadastrado[],
): Conferencia | { erro: string } {
  const m = mapear(tabela, APELIDOS, POSICIONAL, DO_CABECALHO)
  if ('erro' in m) return m
  if ((m.indices['nome'] ?? -1) < 0) {
    return {
      erro:
        'Não encontrei a coluna com o nome do item. Use a planilha modelo ou deixe o nome na primeira coluna.',
    }
  }
  if (m.corpo.length > LIMITE_DE_ITENS) {
    return { erro: `A lista passa de ${LIMITE_DE_ITENS} itens. Divida a planilha em partes.` }
  }

  const porNome = new Map(cadastrados.map((i) => [normalizar(i.nome), i.nome]))
  const porCodigo = new Map(
    cadastrados.filter((i) => i.codigo !== '').map((i) => [normalizar(i.codigo), i.nome]),
  )

  const vistos = new Set<string>()
  const linhas: LinhaConferida[] = []

  for (const [i, bruta] of m.corpo.entries()) {
    const avisos: string[] = []
    const nome = celula(bruta, m.indices, 'nome').replace(/\s+/g, ' ').slice(0, 80)
    const codigo = celula(bruta, m.indices, 'codigo').slice(0, 40)

    const custoBruto = celula(bruta, m.indices, 'custo')
    let custo: string | null = null
    if (custoBruto !== '') {
      const c = centavosDoTexto(custoBruto.replace(/R\$|\s/g, ''))
      if (c === null) avisos.push('custo não reconhecido, vai em branco')
      else custo = c.toString()
    }

    const minimoBruto = celula(bruta, m.indices, 'minimo')
    let minimo: string | null = null
    if (minimoBruto !== '') {
      const q = milesimosDoTexto(minimoBruto)
      if (q === null) avisos.push('mínimo não reconhecido, vai em branco')
      else minimo = q.toString()
    }

    // Coluna ausente ≠ coluna com "não". Ausente deixa o padrão do contrato
    // valer (validade controlada = sim), e é a regra medida no protótipo.
    const temRot = (m.indices['rotatividade'] ?? -1) >= 0
    const temVal = (m.indices['validade'] ?? -1) >= 0

    const linha: LinhaConferida = {
      numero: m.primeira + i,
      nome,
      codigo,
      categoria: celula(bruta, m.indices, 'categoria').slice(0, 40),
      medida: celula(bruta, m.indices, 'medida').slice(0, 20),
      local: celula(bruta, m.indices, 'local').slice(0, 40),
      custo,
      minimo,
      altaRotatividade: temRot && simOuNao(celula(bruta, m.indices, 'rotatividade')),
      controlaValidade: temVal ? simOuNao(celula(bruta, m.indices, 'validade')) : true,
      situacao: 'novo',
      avisos,
    }

    if (nome === '') {
      linhas.push({ ...linha, situacao: 'fora', avisos: [...avisos, 'sem nome do item'] })
      continue
    }

    const chave = codigo === '' ? `n:${normalizar(nome)}` : `c:${normalizar(codigo)}`
    if (vistos.has(chave)) {
      linhas.push({ ...linha, situacao: 'fora', avisos: [...avisos, 'repetido na lista'] })
      continue
    }
    vistos.add(chave)

    const existente =
      (codigo === '' ? undefined : porCodigo.get(normalizar(codigo))) ?? porNome.get(normalizar(nome))

    linhas.push(
      existente === undefined
        ? linha
        : { ...linha, situacao: 'existe', existente, avisos },
    )
  }

  return {
    linhas,
    novos: linhas.filter((l) => l.situacao === 'novo').length,
    existentes: linhas.filter((l) => l.situacao === 'existe').length,
    fora: linhas.filter((l) => l.situacao === 'fora').length,
  }
}

/** O corpo de `POST /v1/estoque/importar`: tudo o que não ficou fora. */
export const corpoDaImportacao = (c: Conferencia) =>
  c.linhas
    .filter((l) => l.situacao !== 'fora')
    .map((l) => ({
      nome: l.nome,
      codigo: l.codigo,
      categoria: l.categoria,
      medida: l.medida,
      local: l.local,
      custo: l.custo,
      minimo: l.minimo,
      altaRotatividade: l.altaRotatividade,
      controlaValidade: l.controlaValidade,
    }))
