import {
  CATALOGO_DE_RELATORIOS,
  CHAVES_DE_RELATORIO,
  type ChaveDeRelatorio,
  type ColunaDoCatalogo,
  type ColunaNaSaida,
  LIMITE_DE_LINHAS,
  type ResultadoDaExportacao,
  ROTULO_DA_SITUACAO_DO_ORCAMENTO_NO_RELATORIO,
  type SomaDaColuna,
} from '@fir/contracts'
import { formatarDinheiro, formatarQuantidade } from '@fir/ui'
import { diaEmTexto } from '@/lib/formato'
import type { CelulaDaPlanilha, TabelaDaPlanilha } from '@/lib/planilha'

/**
 * **O que a aba Relatórios escreve, a partir do que o servidor mandou** (T8, T9).
 *
 * Tudo aqui é FORMATAR, ORDENAR e ESCOLHER RÓTULO. As linhas, as colunas (já
 * sem as de dinheiro para quem não tem `valores`), o resumo, o cabeçalho e o
 * aviso chegam prontos. Nenhuma soma: o total do relatório é do servidor.
 */

export type Linha = Readonly<Record<string, unknown>>

/* ------------------------------------------------------------- o catálogo */

/** Os grupos da 1.9 G, nesta ordem. */
export const GRUPOS = ['Pacientes', 'Financeiro', 'Estoque', 'Comercial', 'Equipe'] as const
export type Grupo = (typeof GRUPOS)[number]

/**
 * O grupo sai do NÚMERO do relatório no catálogo (spec "Os 15 relatórios"):
 * 1–7 pacientes, 8–10 financeiro, 11–12 estoque, 13–14 comercial, 15 equipe.
 */
export function grupoDoRelatorio(numero: number): Grupo {
  if (numero <= 7) return 'Pacientes'
  if (numero <= 10) return 'Financeiro'
  if (numero <= 12) return 'Estoque'
  if (numero <= 14) return 'Comercial'
  return 'Equipe'
}

/**
 * Os relatórios que esta tela sabe filtrar e resumir: os 15 do catálogo (T8 e
 * T9). Um relatório que o contrato ganhar depois só aparece quando tiver os
 * filtros aqui — `paraFiltros` é exaustivo, e o `tsc` aponta a falta.
 */
export const RELATORIOS_NA_TELA: ReadonlySet<string> = new Set<string>(CHAVES_DE_RELATORIO)

/** A explicação de uma frase (1.9 G, item 1). */
export const FRASE_DO_RELATORIO: Readonly<Record<ChaveDeRelatorio, string>> = {
  'pacientes-sem-compra': 'Quem não comprou nada nos últimos meses — a lista para retomar o contato.',
  'pacientes-sem-atendimento': 'Quem não é atendido há algum tempo — a lista para chamar de volta.',
  'pacientes-maior-ltv': 'Os pacientes que mais trouxeram receita, desde sempre.',
  'pacientes-que-indicaram': 'Quem indicou pacientes no período, e quantos viraram pacientes.',
  'pacientes-por-procedimento': 'Quem está em programa de um procedimento, com as sessões feitas e restantes.',
  'pacientes-por-origem-e-campanha': 'Os pacientes cadastrados no período, pela origem e pela campanha.',
  aniversariantes: 'Quem faz aniversário no mês escolhido.',
  recebimentos: 'Cada pagamento do período, com os totais por forma e por tipo.',
  'saldos-em-aberto': 'O que cada paciente ainda deve, por adesão, até a data de corte.',
  contas: 'As contas com vencimento no período, pagas e a pagar.',
  'saidas-de-estoque': 'Tudo o que saiu do estoque no período: uso em paciente, descarte e uso interno — e os ajustes, pelo filtro de motivo.',
  'entradas-de-estoque': 'Tudo o que entrou no estoque no período, com lote e custo.',
  orcamentos: 'Os orçamentos registrados no período: enviados, fechados e perdidos, e o que foi fechado.',
  'faltas-e-desmarcacoes': 'Quem faltou ou desmarcou no período, e se houve recontato.',
  'tarefas-da-equipe': 'As tarefas com prazo no período, e se foram feitas no prazo.',
}

const FRASES: Readonly<Record<string, string>> = FRASE_DO_RELATORIO
export const fraseDo = (chave: string): string => FRASES[chave] ?? ''

/** O catálogo filtrado pela busca: título e frase, sem acento nem caixa. */
export function casaComBusca(chave: string, titulo: string, grupo: Grupo, busca: string): boolean {
  const b = semAcento(busca.trim())
  if (b === '') return true
  return semAcento(`${titulo} ${fraseDo(chave)} ${grupo}`).includes(b)
}

const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** O relatório oferece "Incluir telefone"? Vem do catálogo, não de um `if` por relatório. */
export function temOptInDeTelefone(chave: ChaveDeRelatorio): boolean {
  const colunas: readonly ColunaDoCatalogo[] = CATALOGO_DE_RELATORIOS[chave].colunas
  return colunas.some((c) => c.optIn === 'telefone')
}

/* --------------------------------------------------------------- células */

/**
 * Os rótulos das colunas `situacao` de todos os relatórios. Os valores não se
 * repetem entre eles: prazo (15), sim/não (convertido no 6, tarefa aberta no
 * 2), motivo e recontato (14) e a situação do orçamento (13).
 */
export const ROTULO_DA_SITUACAO: Readonly<Record<string, string>> = {
  ok: 'No prazo',
  tarde: 'Com atraso',
  atrasada: 'Atrasada',
  a_vencer: 'A vencer',
  sim: 'Sim',
  nao: 'Não',
  falta: 'Falta',
  desmarcacao: 'Desmarcação',
  recontatada: 'Recontatada em até 2 dias',
  'recontatada-depois': 'Recontatada depois',
  'aguardando-prazo': 'No prazo de recontato',
  'sem-recontato': 'Sem recontato',
  ...ROTULO_DA_SITUACAO_DO_ORCAMENTO_NO_RELATORIO,
}

/** A ordem do mais urgente para o resolvido; o que não está aqui ordena pelo rótulo. */
const ORDEM_DA_SITUACAO: Readonly<Record<string, number>> = {
  atrasada: 0,
  tarde: 1,
  a_vencer: 2,
  ok: 3,
  'sem-recontato': 0,
  'aguardando-prazo': 1,
  'recontatada-depois': 2,
  recontatada: 3,
}

const ehCentavos = (v: unknown): v is string => typeof v === 'string' && /^-?\d+$/.test(v)
const ehQuantidade = (v: unknown): v is { milesimos: string } =>
  typeof v === 'object' && v !== null && 'milesimos' in v && ehCentavos((v as { milesimos: unknown }).milesimos)

export type Celula = {
  /** O que a tela mostra. `—` quando não há valor. */
  readonly texto: string
  /** O mesmo para o arquivo: vazio quando não há valor, e o tipo da célula. */
  readonly arquivo: CelulaDaPlanilha
  /** A chave de ordenação. `null` vai sempre para o fim. */
  readonly ordem: bigint | string | number | null
  /** Coluna de número: alinhada à direita, algarismos tabulares. */
  readonly numerica: boolean
}

const VAZIA: Celula = { texto: '—', arquivo: { tipo: 'texto', valor: '' }, ordem: null, numerica: false }

export function celula(coluna: Pick<ColunaNaSaida, 'chave' | 'tipo'>, linha: Linha): Celula {
  const v = linha[coluna.chave]
  switch (coluna.tipo) {
    case 'dinheiro': {
      if (!ehCentavos(v)) return { ...VAZIA, numerica: true }
      const t = formatarDinheiro(BigInt(v))
      return { texto: t, arquivo: { tipo: 'numero', valor: t }, ordem: BigInt(v), numerica: true }
    }
    case 'quantidade': {
      if (!ehQuantidade(v)) return { ...VAZIA, numerica: true }
      const m = BigInt(v.milesimos)
      // A unidade tem coluna própria: aqui sai só o número, pelo formatador central.
      const t = formatarQuantidade(m, '').trim()
      return { texto: t, arquivo: { tipo: 'numero', valor: t }, ordem: m, numerica: true }
    }
    case 'numero': {
      if (typeof v !== 'number') return { ...VAZIA, numerica: true }
      return { texto: String(v), arquivo: { tipo: 'numero', valor: String(v) }, ordem: v, numerica: true }
    }
    case 'data': {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ...VAZIA, numerica: true }
      const t = diaEmTexto(v)
      return { texto: t, arquivo: { tipo: 'texto', valor: t }, ordem: v, numerica: true }
    }
    case 'situacao': {
      if (typeof v !== 'string') return VAZIA
      const t = ROTULO_DA_SITUACAO[v] ?? v
      return { texto: t, arquivo: { tipo: 'texto', valor: t }, ordem: ORDEM_DA_SITUACAO[v] ?? t, numerica: false }
    }
    case 'texto': {
      if (typeof v !== 'string' || v === '') return VAZIA
      return { texto: v, arquivo: { tipo: 'texto', valor: v }, ordem: v, numerica: false }
    }
  }
}

/** As colunas cujo texto abre a ficha do paciente (1.9 G: "em nova aba"). */
const COLUNAS_DE_PACIENTE: ReadonlySet<string> = new Set(['nome', 'paciente', 'indicadora'])

export function pacienteDaCelula(coluna: Pick<ColunaNaSaida, 'chave'>, linha: Linha): string | null {
  if (!COLUNAS_DE_PACIENTE.has(coluna.chave)) return null
  const id = linha['pacienteId']
  return typeof id === 'string' && id !== '' ? id : null
}

/** Ordena as linhas por uma coluna; o vazio fica no fim nos dois sentidos. */
export function ordenar(
  linhas: readonly Linha[],
  coluna: Pick<ColunaNaSaida, 'chave' | 'tipo'>,
  sentido: 'asc' | 'desc',
): Linha[] {
  const sinal = sentido === 'asc' ? 1 : -1
  return linhas
    .map((l, i) => ({ l, i, o: celula(coluna, l).ordem }))
    .sort((a, b) => {
      if (a.o === null || b.o === null) return a.o === b.o ? a.i - b.i : a.o === null ? 1 : -1
      const r =
        typeof a.o === 'string' && typeof b.o === 'string'
          ? a.o.localeCompare(b.o, 'pt-BR', { sensitivity: 'base' })
          : a.o < b.o
            ? -1
            : a.o > b.o
              ? 1
              : 0
      return r === 0 ? a.i - b.i : r * sinal
    })
    .map((x) => x.l)
}

export const POR_PAGINA = 50

/* ------------------------------------------------------------ o arquivo */

/** "10.000" — o limite do motor, no texto. */
export const LIMITE_EM_TEXTO = LIMITE_DE_LINHAS.toLocaleString('pt-BR')

/**
 * **A linha "Total"** do fim da tabela e do arquivo (backlog 1.8): as somas que
 * o SERVIDOR mandou, cada uma debaixo da sua coluna, pelo formatador central;
 * "Total" na primeira coluna. Nenhuma conta aqui. Sem soma com valor (sem
 * `valores`, o servidor não manda nenhuma), não há linha — `null`.
 */
export function linhaDeTotais(colunas: readonly ColunaNaSaida[], somas: readonly SomaDaColuna[]): Celula[] | null {
  const porColuna = new Map(somas.filter((s) => s.valor !== null).map((s) => [s.coluna, s]))
  if (porColuna.size === 0) return null
  return colunas.map((col, i) => {
    const s = porColuna.get(col.chave)
    if (s !== undefined) return celula({ chave: 'valor', tipo: 'dinheiro' }, { valor: s.valor })
    if (i === 0) return { texto: 'Total', arquivo: { tipo: 'texto', valor: 'Total' }, ordem: null, numerica: false }
    return { texto: '', arquivo: { tipo: 'texto', valor: '' }, ordem: null, numerica: false }
  })
}

/**
 * A tabela do arquivo (L-IN-12): o cabeçalho que o servidor montou — clínica,
 * relatório, filtros, data, quem exportou, código, finalidade e aviso —, uma
 * linha em branco, as colunas, as linhas e, no fim, a linha "Total" com as
 * somas do servidor (só as que a pessoa pode ver). O cabeçalho é texto do
 * servidor e passa pela mesma proteção de fórmula que o resto (o nome da
 * clínica também é texto digitado).
 */
export function tabelaDaExportacao(e: ResultadoDaExportacao): TabelaDaPlanilha {
  const c = e.exportacao.cabecalho
  const par = (rotulo: string, valor: string): CelulaDaPlanilha[] => [
    { tipo: 'texto', valor: rotulo },
    { tipo: 'texto', valor },
  ]
  const cabeca: CelulaDaPlanilha[][] = [
    par('Clínica', c.clinica),
    par('Relatório', c.relatorio),
    par('Filtros', c.filtrosEmTexto.join(' · ')),
    par('Gerado em', c.geradoEm),
    par('Exportado por', c.exportadoPor),
    par('Código da exportação', c.codigo),
    ...(c.finalidade === null ? [] : [par('Finalidade', c.finalidade)]),
    ...(c.aviso === null ? [] : [par('Aviso', c.aviso)]),
    ...(e.resultado.truncado ? [par('Atenção', `Só as primeiras ${LIMITE_EM_TEXTO} linhas. Estreite os filtros para ver o resto.`)] : []),
  ]
  const r = e.resultado
  const linhas: readonly Linha[] = r.linhas
  const totais = linhaDeTotais(r.colunas, r.somas)
  return {
    nomeDaAba: c.relatorio,
    linhas: [
      ...cabeca,
      [],
      r.colunas.map((col) => ({ tipo: 'texto' as const, valor: col.rotulo })),
      ...linhas.map((l) => r.colunas.map((col) => celula(col, l).arquivo)),
      ...(totais === null ? [] : [totais.map((x) => x.arquivo)]),
    ],
  }
}

/* --------------------------------------------------------------- filtros */

// Os campos do formulário, `paraFiltros` e `deFiltros` moram em
// `campos-do-filtro.ts` desde os filtros da 1.8 (S2); daqui, o mesmo nome.
export {
  type Campos,
  camposIniciais,
  deFiltros,
  type FiltrosMontados,
  paraFiltros,
  SITUACOES_DO_PROGRAMA_NA_TELA,
  temMaisOpcoesEmUso,
} from './campos-do-filtro'

/* -------------------------------------------------------- aberto por link */

/**
 * O relatório aberto por link (o "Ver recebimentos" do detalhe do KPI, 1.9 E):
 * `?relatorio=<chave>&de=<dia>&ate=<dia>` (`chave=` também vale). Só a chave e
 * o período — nenhum é dado pessoal —, e o que não for uma chave do catálogo
 * ou um dia `aaaa-mm-dd` é ignorado. A tela tira a consulta da URL depois de
 * ler (appsec C15: filtro não fica no histórico).
 */
export type PedidoPorLink = { readonly chave: ChaveDeRelatorio; readonly de?: string; readonly ate?: string }

const CHAVES: ReadonlySet<string> = new Set(CHAVES_DE_RELATORIO)
const ehChave = (v: string): v is ChaveDeRelatorio => CHAVES.has(v)

export function pedidoDoLink(q: Readonly<Record<string, string | string[] | undefined>>): PedidoPorLink | null {
  const um = (k: string): string | undefined => {
    const v = q[k]
    return typeof v === 'string' ? v : undefined
  }
  const chave = um('relatorio') ?? um('chave')
  if (chave === undefined || !ehChave(chave)) return null
  const dia = (v: string | undefined): string | undefined => (v !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const de = dia(um('de'))
  const ate = dia(um('ate'))
  return { chave, ...(de === undefined ? {} : { de }), ...(ate === undefined ? {} : { ate }) }
}
