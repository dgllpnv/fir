import type { AbaCrua, Celula, LinhaCrua, PlanilhaCrua, TipoDeCelula } from '@fir/domain'
import { Injectable } from '@nestjs/common'
import { lerZip, ZipInvalido } from './zip'

/**
 * **O seam `LeitorDePlanilha`** — do `.xlsx` da v20 para linhas e células.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ELE NÃO CONVERTE NADA, E É POR ISSO QUE ELE É UM SEAM
 *
 * O que sai daqui é `PlanilhaCrua`: abas com nome, cabeçalho e linhas de
 * `Celula = { bruto: string, tipo }`. **`bruto` é o literal do arquivo** — não
 * um `number`, não uma `Date`, não um valor "já limpo". Quem interpreta é
 * `@fir/domain/migracao/celula`, que é puro e testável sem arquivo nenhum; e
 * quem escreve é o `Migrador`, que é o único que toca o banco.
 *
 * Três camadas, e cada fronteira existe por um motivo medido:
 *
 *   `.xlsx` → **LeitorDePlanilha** → `PlanilhaCrua`
 *             → **celula.ts / v20.ts** (puro) → `DadosDaV20`
 *             → **Migrador** → Postgres
 *
 * A primeira fronteira permite testar a leitura de um arquivo de verdade sem
 * banco. A segunda permite testar a conversão de `12.345` em `1235` centavos
 * sem arquivo **e sem banco** — e é essa a conversão que faz a migração
 * perder dinheiro em silêncio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS QUATRO COISAS QUE O FORMATO EXIGE, E QUE UM LEITOR INGÊNUO ERRA
 *
 * **1. O nome da aba não está na aba.** Ele está em `xl/workbook.xml`, ligado
 * ao arquivo por `r:id` → `xl/_rels/workbook.xml.rels`. `sheet1.xml` **não**
 * é a primeira aba: nas três planilhas reais a ordem dos arquivos difere da
 * ordem das abas, e duas das três têm `Config` como segunda aba. Ler por
 * número de arquivo migraria a aba errada — com o cabeçalho certo, porque o
 * cabeçalho é idêntico em `Tarefas` e em `Tarefas (cópia v15)`.
 *
 * **2. A célula vazia não existe.** O XML omite a célula sem valor, e a linha
 * vazia inteira também. A posição vem do atributo `r="P2"` (coluna P, linha
 * 2) — contar `<c>` em ordem desloca todas as colunas depois do primeiro
 * vazio, e aí `valor` passa a ler `obs`.
 *
 * **3. O texto não está na célula.** `t="s"` guarda um ÍNDICE na tabela
 * `xl/sharedStrings.xml`, e um `<si>` pode ter vários `<t>` (texto com
 * formatação parcial: `Maria` + ` Souza`). Ler só o primeiro `<t>` corta o
 * nome no meio.
 *
 * **4. A linha pode vir fora de ordem**, e os números de linha podem ter
 * buracos. O leitor indexa por `r` e preserva o número **da planilha**, que é
 * o que o relatório de problemas precisa citar.
 */

export class PlanilhaInvalida extends Error {}

/** 32 MB de arquivo. A maior das três planilhas reais tem menos de 0,5 MB. */
const LIMITE_DO_ARQUIVO = 32 * 1024 * 1024

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
 * A mesma decisão de `estoque/xml.ts`: expandir uma entidade declarada
 * exigiria ler o `DOCTYPE`, que é a porta do XXE. Um `.xlsx` que depende de
 * entidade declarada não é um `.xlsx` que planilha nenhuma escreve.
 */
function desescapar(bruto: string): string {
  if (!bruto.includes('&')) return bruto
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

/** `"P"` → `15`, base 26 sem zero. `"AB2"` → `27`. */
function indiceDaColuna(referencia: string): number {
  let n = 0
  for (const ch of referencia) {
    const c = ch.charCodeAt(0)
    if (c < 65 || c > 90) break
    n = n * 26 + (c - 64)
  }
  return n - 1
}

/** Todo o texto dos `<t>` de dentro de um trecho, concatenado. */
function textoDosT(trecho: string): string {
  let out = ''
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(trecho)) !== null) out += m[1] ?? ''
  return desescapar(out)
}

function lerSharedStrings(xml: Buffer | undefined): string[] {
  if (xml === undefined) return []
  const s = xml.toString('utf8')
  const out: string[] = []
  const re = /<si>([\s\S]*?)<\/si>|<si\s*\/>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) out.push(textoDosT(m[1] ?? ''))
  return out
}

const TIPOS_CONHECIDOS = new Set<string>(['n', 's', 'str', 'b', 'e', 'd', 'inlineStr'])

function lerAba(nome: string, xml: Buffer, compartilhadas: readonly string[]): AbaCrua {
  const s = xml.toString('utf8')
  const porNumero = new Map<number, Celula[]>()

  const reLinha = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g
  let ml: RegExpExecArray | null
  while ((ml = reLinha.exec(s)) !== null) {
    const atributos = ml[1] ?? ''
    const corpo = ml[2] ?? ''
    const mr = /\br="(\d+)"/.exec(atributos)
    if (mr === null) continue
    const numero = Number(mr[1])

    const celulas: Celula[] = []
    const reCelula = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let mc: RegExpExecArray | null
    let proxima = 0
    while ((mc = reCelula.exec(corpo)) !== null) {
      const attrs = mc[1] ?? ''
      const dentro = mc[2] ?? ''
      const mref = /\br="([A-Z]+\d+)"/.exec(attrs)
      const i = mref === null ? proxima : indiceDaColuna(mref[1] ?? '')
      proxima = i + 1

      const mt = /\bt="([^"]+)"/.exec(attrs)
      const declarado = mt?.[1] ?? 'n'
      if (!TIPOS_CONHECIDOS.has(declarado)) {
        throw new PlanilhaInvalida(`a aba "${nome}" tem célula de tipo "${declarado}"`)
      }

      let bruto: string
      let tipo: TipoDeCelula
      if (declarado === 'inlineStr') {
        bruto = textoDosT(dentro)
        tipo = 'str'
      } else {
        const mv = /<v>([\s\S]*?)<\/v>|<v\s*\/>/.exec(dentro)
        bruto = desescapar(mv?.[1] ?? '')
        if (declarado === 's') {
          // O índice aponta para a tabela compartilhada. Fora da tabela é
          // arquivo corrompido, nunca string vazia: string vazia aqui some
          // o nome de uma paciente sem erro nenhum.
          const k = Number(bruto)
          const achado = Number.isInteger(k) ? compartilhadas[k] : undefined
          if (achado === undefined) {
            throw new PlanilhaInvalida(
              `a aba "${nome}", linha ${numero}, aponta para a string ${bruto}, que não existe`,
            )
          }
          bruto = achado
          tipo = 's'
        } else tipo = declarado as TipoDeCelula
      }
      celulas[i] = { bruto, tipo }
    }
    // `celulas` é esparso quando o XML omitiu colunas do meio; `?? vazia` no
    // leitor de domínio cobre o buraco. Normalizar aqui com `Array.from`
    // garante que `celulas[i]` nunca seja um furo de `Array`.
    porNumero.set(
      numero,
      Array.from({ length: celulas.length }, (_, i) => celulas[i] ?? { bruto: '', tipo: 's' }),
    )
  }

  const numeros = [...porNumero.keys()].sort((a, b) => a - b)
  const primeira = numeros[0]
  const cabecalho =
    primeira === undefined ? [] : (porNumero.get(primeira) ?? []).map((c) => c.bruto.trim())

  const linhas: LinhaCrua[] = []
  for (const n of numeros) {
    if (n === primeira) continue
    linhas.push({ numero: n, celulas: porNumero.get(n) ?? [] })
  }
  return { nome, cabecalho, linhas }
}

@Injectable()
export class LeitorDePlanilha {
  /**
   * Lê o `.xlsx` inteiro. **Toda aba**, inclusive as ocultas e a de backup —
   * decidir o que migrar é de `lerDadosDaV20`, que recusa a de backup pelo
   * nome. Esconder a aba aqui faria o leitor mentir sobre o que o arquivo tem,
   * e a conferência precisa poder dizer "esta planilha tem a cópia da v15".
   */
  ler(arquivo: Buffer): PlanilhaCrua {
    if (arquivo.length > LIMITE_DO_ARQUIVO) {
      throw new PlanilhaInvalida(`o arquivo tem ${arquivo.length} bytes`)
    }

    let partes: Map<string, Buffer>
    try {
      partes = lerZip(arquivo)
    } catch (e) {
      if (e instanceof ZipInvalido) throw new PlanilhaInvalida(e.message)
      throw e
    }

    const workbook = partes.get('xl/workbook.xml')
    if (workbook === undefined) {
      throw new PlanilhaInvalida('o arquivo não tem xl/workbook.xml — não é uma planilha .xlsx')
    }
    const rels = partes.get('xl/_rels/workbook.xml.rels')
    if (rels === undefined) {
      throw new PlanilhaInvalida('o arquivo não tem xl/_rels/workbook.xml.rels')
    }

    const alvoPorId = new Map<string, string>()
    for (const m of rels.toString('utf8').matchAll(/<Relationship\b([^>]*)>/g)) {
      const attrs = m[1] ?? ''
      const id = /\bId="([^"]+)"/.exec(attrs)?.[1]
      const alvo = /\bTarget="([^"]+)"/.exec(attrs)?.[1]
      if (id !== undefined && alvo !== undefined) alvoPorId.set(id, desescapar(alvo))
    }

    const compartilhadas = lerSharedStrings(partes.get('xl/sharedStrings.xml'))
    const abas: AbaCrua[] = []

    for (const m of workbook.toString('utf8').matchAll(/<sheet\b([^>]*?)\/?>/g)) {
      const attrs = m[1] ?? ''
      const nome = desescapar(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? '')
      const rid = /\br:id="([^"]+)"/.exec(attrs)?.[1]
      if (nome === '' || rid === undefined) continue

      const alvo = alvoPorId.get(rid)
      if (alvo === undefined) {
        throw new PlanilhaInvalida(`a aba "${nome}" aponta para ${rid}, que não está nos rels`)
      }
      // O `Target` vem relativo a `xl/` (`worksheets/sheet1.xml`) ou absoluto
      // dentro do pacote (`/xl/worksheets/sheet1.xml`).
      const caminho = alvo.startsWith('/')
        ? alvo.slice(1)
        : alvo.startsWith('xl/')
          ? alvo
          : `xl/${alvo}`
      const xml = partes.get(caminho)
      if (xml === undefined) {
        throw new PlanilhaInvalida(`a aba "${nome}" aponta para ${caminho}, que não está no .xlsx`)
      }
      abas.push(lerAba(nome, xml, compartilhadas))
    }

    if (abas.length === 0) throw new PlanilhaInvalida('a planilha não declara nenhuma aba')
    return { abas }
  }
}
