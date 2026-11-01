/**
 * Um leitor de XML **mínimo e deliberadamente burro**, para a NF-e.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ESCREVER ISTO EM VEZ DE INSTALAR UM PACOTE
 *
 * O que a NF-e exige é uma árvore de elementos com atributos e texto. Não há
 * namespace a resolver (os nomes vêm sem prefixo), não há DTD, não há entidade
 * externa — e **é justamente a entidade externa que faz um parser de XML
 * genérico ser um risco de segurança** (XXE: `<!ENTITY x SYSTEM "file:///etc/
 * passwd">`). Este leitor **não tem** processamento de DOCTYPE nem de entidade
 * declarada: ele os ignora, e com isso a classe inteira de ataque não existe.
 *
 * O arquivo chega de um fornecedor, por e-mail, e é carregado por quem está no
 * balcão. É entrada externa não confiável, e o leitor trata assim: limite de
 * profundidade, limite de tamanho e nenhuma expansão de nada.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type NoXml = {
  readonly nome: string
  readonly atributos: Readonly<Record<string, string>>
  readonly filhos: readonly NoXml[]
  /** O texto DIRETO deste elemento, já com as entidades básicas resolvidas. */
  readonly texto: string
}

export class XmlInvalido extends Error {}

/** Profundidade máxima. A NF-e usa 6; 64 é folga com teto. */
const PROFUNDIDADE_MAXIMA = 64

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/**
 * Resolve **somente** as cinco entidades predefinidas e as numéricas.
 *
 * Qualquer outra (`&minhaEntidade;`) fica literal. Expandi-la exigiria ler o
 * DOCTYPE, que é a porta do XXE — e uma nota fiscal que depende de entidade
 * declarada não é uma nota fiscal que algum fornecedor emite.
 */
function texto(bruto: string): string {
  return bruto.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (todo, corpo: string) => {
    if (corpo.startsWith('#x') || corpo.startsWith('#X')) {
      const n = Number.parseInt(corpo.slice(2), 16)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : todo
    }
    if (corpo.startsWith('#')) {
      const n = Number.parseInt(corpo.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : todo
    }
    return ENTIDADES[corpo] ?? todo
  })
}

type EmConstrucao = {
  nome: string
  atributos: Record<string, string>
  filhos: NoXml[]
  pedacos: string[]
}

const fechar = (n: EmConstrucao): NoXml => ({
  nome: n.nome,
  atributos: n.atributos,
  filhos: n.filhos,
  texto: n.pedacos.join('').trim(),
})

function lerAtributos(bruto: string): Record<string, string> {
  const fora: Record<string, string> = {}
  for (const m of bruto.matchAll(/([A-Za-z_:][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    fora[m[1]!] = texto(m[3] ?? m[4] ?? '')
  }
  return fora
}

export function lerXml(fonte: string): NoXml {
  const pilha: EmConstrucao[] = []
  let raiz: NoXml | null = null
  let i = 0

  while (i < fonte.length) {
    const abre = fonte.indexOf('<', i)
    if (abre === -1) break

    if (abre > i) {
      const bruto = fonte.slice(i, abre)
      // Texto fora de qualquer elemento é espaço em branco entre tags; dentro,
      // é o conteúdo.
      pilha[pilha.length - 1]?.pedacos.push(texto(bruto))
    }

    // Declaração, comentário, DOCTYPE e CDATA — nenhum deles abre elemento.
    if (fonte.startsWith('<?', abre)) {
      const fim = fonte.indexOf('?>', abre)
      if (fim === -1) throw new XmlInvalido('O arquivo termina no meio de uma declaração.')
      i = fim + 2
      continue
    }
    if (fonte.startsWith('<!--', abre)) {
      const fim = fonte.indexOf('-->', abre)
      if (fim === -1) throw new XmlInvalido('O arquivo termina no meio de um comentário.')
      i = fim + 3
      continue
    }
    if (fonte.startsWith('<![CDATA[', abre)) {
      const fim = fonte.indexOf(']]>', abre)
      if (fim === -1) throw new XmlInvalido('O arquivo termina no meio de um CDATA.')
      pilha[pilha.length - 1]?.pedacos.push(fonte.slice(abre + 9, fim))
      i = fim + 3
      continue
    }
    if (fonte.startsWith('<!', abre)) {
      // DOCTYPE e companhia: **ignorados por inteiro**, nunca processados.
      const fim = fonte.indexOf('>', abre)
      if (fim === -1) throw new XmlInvalido('O arquivo termina no meio de uma declaração.')
      i = fim + 1
      continue
    }

    const fecha = fonte.indexOf('>', abre)
    if (fecha === -1) throw new XmlInvalido('O arquivo termina no meio de uma tag.')
    const dentro = fonte.slice(abre + 1, fecha)
    i = fecha + 1

    if (dentro.startsWith('/')) {
      const nome = dentro.slice(1).trim()
      const atual = pilha.pop()
      if (atual === undefined || atual.nome !== nome) {
        throw new XmlInvalido(`A tag </${nome}> fecha algo que não estava aberto.`)
      }
      const no = fechar(atual)
      const pai = pilha[pilha.length - 1]
      if (pai === undefined) raiz = no
      else pai.filhos.push(no)
      continue
    }

    const vazia = dentro.endsWith('/')
    const corpo = vazia ? dentro.slice(0, -1) : dentro
    const espaco = corpo.search(/\s/)
    const nome = (espaco === -1 ? corpo : corpo.slice(0, espaco)).trim()
    if (nome === '') throw new XmlInvalido('Há uma tag sem nome no arquivo.')
    const atributos = espaco === -1 ? {} : lerAtributos(corpo.slice(espaco))

    if (vazia) {
      const no: NoXml = { nome, atributos, filhos: [], texto: '' }
      const pai = pilha[pilha.length - 1]
      if (pai === undefined) raiz = no
      else pai.filhos.push(no)
      continue
    }

    if (pilha.length >= PROFUNDIDADE_MAXIMA) {
      throw new XmlInvalido('O arquivo tem elementos aninhados demais.')
    }
    pilha.push({ nome, atributos, filhos: [], pedacos: [] })
  }

  if (pilha.length > 0) {
    throw new XmlInvalido(`A tag <${pilha[pilha.length - 1]!.nome}> não foi fechada.`)
  }
  if (raiz === null) throw new XmlInvalido('O arquivo não é um XML válido.')
  return raiz
}

/** O primeiro descendente com este nome, em profundidade. */
export function primeiro(no: NoXml, nome: string): NoXml | null {
  if (no.nome === nome) return no
  for (const f of no.filhos) {
    const achado = primeiro(f, nome)
    if (achado !== null) return achado
  }
  return null
}

/** Todos os descendentes com este nome, **sem descer dentro dos achados**. */
export function todos(no: NoXml, nome: string): NoXml[] {
  if (no.nome === nome) return [no]
  return no.filhos.flatMap((f) => todos(f, nome))
}

/** O texto do primeiro descendente com este nome, ou `''`. */
export const textoDe = (no: NoXml | null, nome: string): string =>
  no === null ? '' : (primeiro(no, nome)?.texto ?? '')

/** Os filhos DIRETOS com este nome — para `det` dentro de `infNFe`. */
export const filhosDiretos = (no: NoXml, nome: string): NoXml[] =>
  no.filhos.filter((f) => f.nome === nome)
