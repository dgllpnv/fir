import { type ErroDeDominio, type Result, erro, erroDe, ok } from './resultado'

/**
 * **G8 4B: importar reuniões do Asana** (inventário C7; protótipo
 * `lerCSV`, `dataBR`, `previaAsana`, `desenharAsana`, `asanaImportar`,
 * `index.html` L1773–1812 e L2916–2918; gates LGPD A40–A44, appsec A-15).
 *
 * O CSV é lido NO NAVEGADOR (A40): esta função pura roda na tela, e o
 * servidor recebe só as linhas marcadas, com `asanaId`, `nome`, `notas` e
 * `data`. O responsável (`Assignee`) e o e-mail dele nunca são lidos, nem
 * aqui: o que não se lê não vaza. A seção é lida só para a pré-seleção e a
 * prévia, e não sai do navegador.
 *
 * As regras de linha (`problemaDaTarefa`) são as MESMAS que o contrato do
 * servidor aplica: a prévia desmarca o que o servidor recusaria, e o servidor
 * recusa de novo, porque não confia na tela.
 */

/* ── Limites (appsec A-15) ─────────────────────────────────────────────── */

export const LIMITES_DO_ASANA = {
  /** Arquivo maior que isto nem é lido (no cliente). */
  bytesDoArquivo: 5 * 1024 * 1024,
  /** Tarefas por importação. */
  tarefas: 2000,
  /** O nome da tarefa vira a primeira linha do resumo. */
  nome: 1000,
  /**
   * O resumo da ata é `nome + "\n\n" + notas` (L2917), e a coluna tem
   * `CHECK (length(btrim(resumo)) BETWEEN 1 AND 4000)` desde a 0034, o mesmo
   * limite do formulário. Tarefa cujo resumo passa disto não entra: cortar
   * em silêncio perderia o fim da anotação.
   */
  resumo: 4000,
  /** `CHECK (length(asana_id) BETWEEN 1 AND 64)` da 0048. */
  asanaId: 64,
} as const

/* ── CSV ───────────────────────────────────────────────────────────────── */

/**
 * O separador da primeira LINHA LÓGICA: `;` se houver mais `;` que `,` fora
 * de aspas, senão `,` (`lerCSV`, L1775). O protótipo contava também o que
 * está dentro de aspas, e um cabeçalho com `"a;b"` trocava o separador; aqui
 * as aspas são respeitadas.
 */
function separadorDe(texto: string): ',' | ';' {
  let virgulas = 0
  let pontosEVirgula = 0
  let aspas = false
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') i++
        else aspas = false
      }
      continue
    }
    if (ch === '"') aspas = true
    else if (ch === '\n') break
    else if (ch === ',') virgulas++
    else if (ch === ';') pontosEVirgula++
  }
  return pontosEVirgula > virgulas ? ';' : ','
}

/**
 * CSV para matriz de texto (`lerCSV`, L1774–1782). Aspas duplas delimitam o
 * campo, `""` é uma aspa, e dentro de aspas a vírgula, o ponto e vírgula e a
 * quebra de linha são texto. BOM sai; `\r\n` e `\r` viram `\n` (inclusive
 * dentro do campo, para o texto guardado não carregar `\r`). Linhas
 * inteiramente em branco somem, como no protótipo.
 */
export function lerCsv(bruto: string): string[][] {
  const texto = bruto.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const sep = separadorDe(texto)
  const linhas: string[][] = []
  let linha: string[] = []
  let campo = ''
  let aspas = false
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i++
        } else aspas = false
      } else campo += ch
    } else if (ch === '"') aspas = true
    else if (ch === sep) {
      linha.push(campo)
      campo = ''
    } else if (ch === '\n') {
      linha.push(campo)
      linhas.push(linha)
      linha = []
      campo = ''
    } else campo += ch
  }
  if (campo !== '' || linha.length > 0) {
    linha.push(campo)
    linhas.push(linha)
  }
  return linhas.filter((l) => l.some((x) => x.trim() !== ''))
}

/* ── Datas ─────────────────────────────────────────────────────────────── */

const dois = (n: number): string => String(n).padStart(2, '0')

function diaDoCalendario(a: number, m: number, d: number): string | null {
  if (a < 1900 || a > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const t = new Date(Date.UTC(a, m - 1, d))
  if (t.getUTCFullYear() !== a || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return `${a}-${dois(m)}-${dois(d)}`
}

/**
 * `dataBR` (L1786): `aaaa-mm-dd` (com o que vier depois, como a hora) ou
 * `dd/mm/aaaa`. O protótipo aceitava 31/02; aqui a data precisa existir,
 * porque o banco recusaria e a tarefa sumiria na importação.
 */
export function diaDoAsana(valor: string): string | null {
  const v = valor.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (m) return diaDoCalendario(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v)
  if (m) return diaDoCalendario(Number(m[3]), Number(m[2]), Number(m[1]))
  return null
}

/** O dia `aaaa-mm-dd` existe no calendário. Usado pelo contrato do servidor. */
export const ehDiaDoCalendario = (dia: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia)
  return m !== null && diaDoCalendario(Number(m[1]), Number(m[2]), Number(m[3])) === dia
}

/* ── Regras de linha (as mesmas na tela e no servidor) ─────────────────── */

/**
 * Começo de fórmula de planilha (injeção CSV/fórmula, A-15): `=`, `+`, `@`,
 * tabulação, retorno de carro, ou `-` seguido de algo que não é espaço nem
 * outro `-` (`- item` e `--` são texto comum; `-2+3` é fórmula). Aplicado ao
 * NOME, que abre o resumo e seria a primeira coisa de uma célula se um dia
 * houver exportação. As notas podem começar com `@fulana` ou `+55`: são
 * texto livre, renderizado como texto, e a neutralização delas é da
 * exportação (A-15), não daqui.
 */
export const pareceFormula = (texto: string): boolean => /^[=+@\t\r]/.test(texto) || /^-[^\s-]/.test(texto)

/**
 * Caracteres de controle e de direção bidirecional (U+202A–202E,
 * U+2066–2069, que fazem o texto exibido diferir do guardado). O Postgres
 * recusa `\0` com erro de banco; os outros não têm uso num resumo. Nas notas
 * a tabulação e a quebra de linha são texto; no nome, nada de controle.
 */
const CONTROLE_NO_NOME = /[\u0000-\u001F\u007F‪-‮⁦-⁩]/
const CONTROLE_NAS_NOTAS = /[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/
export const temControleNoNome = (texto: string): boolean => CONTROLE_NO_NOME.test(texto)
export const temControleNasNotas = (texto: string): boolean => CONTROLE_NAS_NOTAS.test(texto)

/**
 * O id da tarefa do Asana (`Task ID`) é número; o formato aceito é um pouco
 * mais largo (letras, `_`, `-`), sempre começando por letra ou dígito, para
 * não abrir a porta de fórmula pela chave de idempotência.
 */
export const ehIdDoAsana = (id: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)

/** O resumo da ata importada (L2917): o nome, uma linha em branco, as notas. */
export const resumoDaTarefa = (nome: string, notas: string): string => (notas === '' ? nome : `${nome}\n\n${notas}`)

/** O que impede uma tarefa de ser importada. A ordem é a da prioridade da explicação. */
export type ProblemaDaTarefa =
  | 'sem_data'
  | 'sem_id'
  | 'id_invalido'
  | 'formula'
  | 'caractere_invalido'
  | 'longa_demais'

export const TEXTO_DO_PROBLEMA: Record<ProblemaDaTarefa, string> = {
  sem_data: 'sem data',
  sem_id: 'sem o id da tarefa no arquivo',
  id_invalido: 'id da tarefa em formato que não é do Asana',
  formula: 'o nome começa como fórmula de planilha (=, +, - ou @)',
  caractere_invalido: 'tem caracteres de controle',
  longa_demais: `nome e anotações passam de ${LIMITES_DO_ASANA.resumo.toLocaleString('pt-BR')} caracteres: registre à mão`,
}

/**
 * A regra de UMA tarefa, aplicada à prévia e ao contrato do servidor.
 * `null` = pode entrar.
 */
export function problemaDaTarefa(t: {
  readonly nome: string
  readonly notas: string
  readonly data: string | null
  readonly asanaId: string | null
}): ProblemaDaTarefa | null {
  if (t.data === null || !ehDiaDoCalendario(t.data)) return 'sem_data'
  if (t.asanaId === null || t.asanaId === '') return 'sem_id'
  if (!ehIdDoAsana(t.asanaId)) return 'id_invalido'
  if (pareceFormula(t.nome)) return 'formula'
  if (temControleNoNome(t.nome) || temControleNasNotas(t.notas)) return 'caractere_invalido'
  if (t.nome.length > LIMITES_DO_ASANA.nome || resumoDaTarefa(t.nome, t.notas).length > LIMITES_DO_ASANA.resumo) {
    return 'longa_demais'
  }
  return null
}

/* ── A exportação do Asana ─────────────────────────────────────────────── */

const semAcento = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()

/**
 * As colunas reconhecidas (L1797–1798), em inglês e português. Casa o
 * cabeçalho IGUAL ou COMEÇANDO pelo nome, como o protótipo, sem acento dos
 * dois lados (o protótipo não reconhecia "Concluído em", que é o que o Asana
 * em português exporta).
 *
 * `Assignee`/`Responsável` e o e-mail NÃO estão aqui (LGPD A40): o protótipo
 * levava o responsável para `participantes`; nós não o lemos.
 */
const COLUNAS = {
  nome: ['name', 'nome', 'task name', 'tarefa'],
  notas: ['notes', 'notas', 'descricao', 'description'],
  prazo: ['due date', 'data de conclusao', 'data de entrega', 'prazo', 'vencimento'],
  concluida: ['completed at', 'concluida em', 'concluido em', 'concluida'],
  criada: ['created at', 'criada em', 'criado em'],
  id: ['task id', 'id da tarefa', 'id'],
  secao: ['section/column', 'secao/coluna', 'secao', 'section'],
} as const

function indiceDaColuna(cabecalho: readonly string[], nomes: readonly string[]): number {
  return cabecalho.findIndex((h) => nomes.some((n) => h === n || h.startsWith(n)))
}

export type TarefaDoAsana = {
  /** Número da linha lógica no arquivo (o cabeçalho é a 1). Só para a tela apontar a tarefa. */
  readonly linha: number
  readonly nome: string
  readonly notas: string
  readonly data: string | null
  readonly asanaId: string | null
  /** Só para a prévia e a pré-seleção; nunca vai ao servidor (A40). */
  readonly secao: string
  readonly problema: ProblemaDaTarefa | null
  /** Já existe uma ata deste cliente com o mesmo id (inclusive arquivada: nunca se recria o que alguém apagou). */
  readonly jaImportada: boolean
  /** O mesmo id apareceu numa linha anterior deste arquivo. */
  readonly repetida: boolean
  /** A marcação inicial da prévia. */
  readonly marcada: boolean
}

export type ExportacaoDoAsana = {
  readonly tarefas: readonly TarefaDoAsana[]
  /** Alguma tarefa fala em reunião: só essas ficaram marcadas (L1803–1804). */
  readonly sugeridas: boolean
}

export type ErroDoArquivoDoAsana = ErroDeDominio & {
  readonly codigo: 'ARQUIVO_ILEGIVEL' | 'SEM_COLUNA_NOME' | 'TAREFAS_DEMAIS'
}

const falaEmReuniao = (nome: string, secao: string): boolean => /reuni/i.test(`${nome} ${secao}`)

/**
 * `previaAsana` (L1795–1806): do texto do arquivo para a lista da prévia.
 *
 * Igual ao protótipo: tarefa sem nome some; a data é o prazo, senão a
 * conclusão, senão a criação; se alguma tarefa fala em "reuni" (no nome ou
 * na seção), só essas ficam marcadas; a já importada aparece desabilitada.
 *
 * Diferente do protótipo: tarefa SEM id do Asana não entra (regra 26: sem
 * chave, reimportar duplicaria), e as regras de A-15 desmarcam e explicam.
 */
export function lerExportacaoDoAsana(
  texto: string,
  jaImportados: ReadonlySet<string>,
): Result<ExportacaoDoAsana, ErroDoArquivoDoAsana> {
  const linhas = lerCsv(texto)
  if (linhas.length < 2) {
    return erro({
      ...erroDe('ARQUIVO_ILEGIVEL', 'Não foi possível ler o arquivo. Confira se é o CSV exportado do Asana.'),
      codigo: 'ARQUIVO_ILEGIVEL',
    })
  }
  const cabecalho = linhas[0]!.map(semAcento)
  const col = (nomes: readonly string[]) => indiceDaColuna(cabecalho, nomes)
  const iNome = col(COLUNAS.nome)
  if (iNome < 0) {
    return erro({
      ...erroDe('SEM_COLUNA_NOME', 'O arquivo não tem a coluna Name (nome da tarefa).'),
      codigo: 'SEM_COLUNA_NOME',
    })
  }
  const iNotas = col(COLUNAS.notas)
  const iPrazo = col(COLUNAS.prazo)
  const iConcluida = col(COLUNAS.concluida)
  const iCriada = col(COLUNAS.criada)
  const iId = col(COLUNAS.id)
  const iSecao = col(COLUNAS.secao)
  const celula = (l: readonly string[], i: number): string => (i < 0 ? '' : (l[i] ?? '').trim())

  type Crua = Omit<TarefaDoAsana, 'marcada' | 'repetida' | 'jaImportada'>
  const cruas: Crua[] = []
  linhas.slice(1).forEach((l, i) => {
    const nome = celula(l, iNome)
    if (nome === '') return
    const notas = celula(l, iNotas)
    const data = diaDoAsana(celula(l, iPrazo)) ?? diaDoAsana(celula(l, iConcluida)) ?? diaDoAsana(celula(l, iCriada))
    const id = celula(l, iId)
    const asanaId = id === '' ? null : id
    cruas.push({
      linha: i + 2,
      nome,
      notas,
      data,
      asanaId,
      secao: celula(l, iSecao),
      problema: problemaDaTarefa({ nome, notas, data, asanaId }),
    })
  })
  if (cruas.length > LIMITES_DO_ASANA.tarefas) {
    return erro({
      ...erroDe(
        'TAREFAS_DEMAIS',
        `O arquivo tem mais de ${LIMITES_DO_ASANA.tarefas.toLocaleString('pt-BR')} tarefas. Exporte só a parte das reuniões.`,
      ),
      codigo: 'TAREFAS_DEMAIS',
    })
  }

  const sugeridas = cruas.some((t) => falaEmReuniao(t.nome, t.secao))
  const vistos = new Set<string>()
  const tarefas = cruas.map((t): TarefaDoAsana => {
    const jaImportada = t.asanaId !== null && jaImportados.has(t.asanaId)
    const repetida = t.asanaId !== null && vistos.has(t.asanaId)
    if (t.asanaId !== null) vistos.add(t.asanaId)
    const marcada =
      t.problema === null && !jaImportada && !repetida && (!sugeridas || falaEmReuniao(t.nome, t.secao))
    return { ...t, jaImportada, repetida, marcada }
  })
  return ok({ tarefas, sugeridas })
}

/** A tarefa pode ser marcada na prévia. */
export const podeMarcar = (t: TarefaDoAsana): boolean => t.problema === null && !t.jaImportada && !t.repetida

/**
 * As linhas que vão ao servidor: só as marcadas e importáveis, só os quatro
 * campos de A40 — seção e linha do arquivo ficam aqui.
 */
export function linhasParaImportar(
  tarefas: readonly TarefaDoAsana[],
  marcadas: ReadonlySet<number>,
): { asanaId: string; nome: string; notas: string; data: string }[] {
  return tarefas.flatMap((t, i) =>
    marcadas.has(i) && podeMarcar(t) && t.asanaId !== null && t.data !== null
      ? [{ asanaId: t.asanaId, nome: t.nome, notas: t.notas, data: t.data }]
      : [],
  )
}
