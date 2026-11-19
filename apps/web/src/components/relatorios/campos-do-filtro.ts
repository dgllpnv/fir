import {
  type ChaveDeRelatorio,
  DIAS_MAXIMOS_SEM_ATENDIMENTO,
  JANELA_MAXIMA_EM_MESES,
  MOTIVOS_DE_SAIDA,
  SITUACOES_DO_ORCAMENTO_NO_RELATORIO,
  SITUACOES_DO_PROGRAMA_NO_FILTRO,
} from '@fir/contracts'
import { centavosDoTexto, textoDeCentavos } from '@/lib/dinheiro-digitado'

/**
 * **Os campos do formulário de filtros, como texto e caixa** (T8, T9 e os
 * filtros da 1.8, revisão S2): o que a tela guarda enquanto a pessoa digita.
 * `paraFiltros` monta o objeto que o servidor valida (o mesmo schema
 * `.strict()` do contrato) e `deFiltros` faz o caminho de volta, para mostrar
 * os filtros de um favorito — inclusive o favorito gravado antes destes
 * filtros, que o servidor continua aceitando.
 *
 * Todo valor de filtro é um id escolhido numa lista ou um valor de enum (LGPD
 * L-IN-7): vazio = "qualquer um", e o campo não vai.
 */
export type Campos = {
  readonly meses: string
  readonly procedimentoId: string
  readonly valorMinimo: string
  readonly valorMaximo: string
  readonly de: string
  readonly ate: string
  readonly modo: 'analise' | 'calendario'
  readonly itemId: string
  readonly incluirPaciente: boolean
  readonly responsavelId: string
  /** O top N do relatório 3. */
  readonly quantos: string
  readonly incluirEncerrados: boolean
  readonly campanhaId: string
  /** `1`..`12`: o mês dos aniversariantes. */
  readonly mes: string
  /** O corte dos saldos em aberto; vazio = agora. */
  readonly corte: string
  readonly situacaoDaConta: 'todas' | 'abertas' | 'pagas'
  /* ---- os filtros da 1.8 ---- */
  /** Relatórios 1, 2, 3 (unidade da paciente) e 8 (do recebimento). */
  readonly unidadeId: string
  /** Relatórios 1, 3 e 6: uma das `ORIGENS`, `nao-informada` ou `fora-da-lista`. */
  readonly origem: string
  /** Relatório 2: "há quanto tempo" em meses ou em dias. */
  readonly emDias: boolean
  readonly dias: string
  /** Relatório 2: o tipo de atendimento; relatório 8: o tipo do recebimento; 15: o da tarefa. */
  readonly tipo: string
  /** Relatórios 3 e 5: sem período = desde sempre (3) ou qualquer início (5). */
  readonly comPeriodo: boolean
  readonly minimoDeIndicacoes: string
  /** Relatório 5: um ou vários. */
  readonly procedimentoIds: readonly string[]
  readonly situacaoDoPrograma: SituacaoDoProgramaNaTela
  /** Relatório 7: o mês, ou um intervalo de datas. */
  readonly aniversarioNoIntervalo: boolean
  readonly forma: string
  readonly registradoPorId: string
  readonly categoria: string
  readonly motivoDaSaida: string
  readonly localId: string
  readonly fornecedorId: string
  /** Relatório 13: enviado, fechado ou perdido; vazio = todas. */
  readonly situacaoDoOrcamento: string
  readonly motivoDePerdaId: string
  readonly recontatada: '' | 'sim' | 'nao'
  readonly situacaoDoPrazo: string
}

/** As escolhas do relatório 5, na ordem da tela. A primeira é o padrão de antes (o `ativo` do banco). */
export const SITUACOES_DO_PROGRAMA_NA_TELA = [
  { valor: 'ativos-e-concluidos', rotulo: 'Ativos e concluídos', situacoes: ['ativo', 'concluido'] },
  { valor: 'ativo', rotulo: 'Só ativos', situacoes: ['ativo'] },
  { valor: 'concluido', rotulo: 'Só concluídos', situacoes: ['concluido'] },
  { valor: 'encerrado', rotulo: 'Só encerrados', situacoes: ['encerrado'] },
  { valor: 'todos', rotulo: 'Todos', situacoes: [...SITUACOES_DO_PROGRAMA_NO_FILTRO] },
] as const satisfies readonly { valor: string; rotulo: string; situacoes: readonly string[] }[]
export type SituacaoDoProgramaNaTela = (typeof SITUACOES_DO_PROGRAMA_NA_TELA)[number]['valor']

export function camposIniciais(hoje: string): Campos {
  return {
    meses: '6',
    procedimentoId: '',
    valorMinimo: '',
    valorMaximo: '',
    de: `${hoje.slice(0, 7)}-01`,
    ate: hoje,
    modo: 'calendario',
    itemId: '',
    incluirPaciente: false,
    responsavelId: '',
    quantos: '50',
    incluirEncerrados: false,
    campanhaId: '',
    mes: String(Number(hoje.slice(5, 7))),
    corte: '',
    situacaoDaConta: 'todas',
    unidadeId: '',
    origem: '',
    emDias: false,
    dias: '30',
    tipo: '',
    comPeriodo: false,
    minimoDeIndicacoes: '',
    procedimentoIds: [],
    situacaoDoPrograma: 'ativos-e-concluidos',
    aniversarioNoIntervalo: false,
    forma: '',
    registradoPorId: '',
    categoria: '',
    motivoDaSaida: '',
    localId: '',
    fornecedorId: '',
    situacaoDoOrcamento: '',
    motivoDePerdaId: '',
    recontatada: '',
    situacaoDoPrazo: '',
  }
}

export type FiltrosMontados = { readonly filtros: Record<string, unknown> } | { readonly erro: string }

/** A faixa de valor digitada em reais → centavos inteiros (I-40). Devolve o erro, ou `null`. */
function faixa(c: Campos, f: Record<string, unknown>): string | null {
  for (const k of ['valorMinimo', 'valorMaximo'] as const) {
    if (c[k].trim() === '') continue
    const centavos = centavosDoTexto(c[k])
    if (centavos === null || centavos < 0n) return 'Digite o valor como 1.000,00.'
    f[k] = centavos.toString()
  }
  return null
}

const inteiro = (t: string, min: number, max: number): number | null => {
  if (!/^\d{1,3}$/.test(t.trim())) return null
  const n = Number(t.trim())
  return n >= min && n <= max ? n : null
}

/** Põe `f[chave] = valor` só quando a escolha não é "qualquer um". */
const se = (f: Record<string, unknown>, chave: string, valor: string): void => {
  if (valor !== '') f[chave] = valor
}

export function paraFiltros(chave: ChaveDeRelatorio, c: Campos): FiltrosMontados {
  const periodo = { de: c.de, ate: c.ate }
  switch (chave) {
    case 'pacientes-sem-compra': {
      const meses = inteiro(c.meses, 1, JANELA_MAXIMA_EM_MESES)
      if (meses === null) return { erro: `Informe há quantos meses, de 1 a ${JANELA_MAXIMA_EM_MESES}.` }
      const f: Record<string, unknown> = { semCompraHaMeses: meses }
      se(f, 'procedimentoId', c.procedimentoId)
      se(f, 'unidadeId', c.unidadeId)
      se(f, 'origem', c.origem)
      const erro = faixa(c, f)
      return erro === null ? { filtros: f } : { erro }
    }
    case 'pacientes-sem-atendimento': {
      const f: Record<string, unknown> = {}
      if (c.emDias) {
        const dias = inteiro(c.dias, 1, DIAS_MAXIMOS_SEM_ATENDIMENTO)
        if (dias === null) return { erro: `Informe há quantos dias, de 1 a ${DIAS_MAXIMOS_SEM_ATENDIMENTO}.` }
        f['semAtendimentoHaDias'] = dias
      } else {
        const meses = inteiro(c.meses, 1, JANELA_MAXIMA_EM_MESES)
        if (meses === null) return { erro: `Informe há quantos meses, de 1 a ${JANELA_MAXIMA_EM_MESES}.` }
        f['semAtendimentoHaMeses'] = meses
      }
      se(f, 'tipo', c.tipo)
      se(f, 'unidadeId', c.unidadeId)
      return { filtros: f }
    }
    case 'pacientes-maior-ltv': {
      const quantos = inteiro(c.quantos, 1, 500)
      if (quantos === null) return { erro: 'Informe quantos pacientes, de 1 a 500.' }
      const f: Record<string, unknown> = { quantos, ...(c.comPeriodo ? periodo : {}) }
      se(f, 'unidadeId', c.unidadeId)
      se(f, 'origem', c.origem)
      return { filtros: f }
    }
    case 'pacientes-que-indicaram': {
      const f: Record<string, unknown> = { ...periodo }
      if (c.minimoDeIndicacoes.trim() !== '') {
        const n = inteiro(c.minimoDeIndicacoes, 1, 100)
        if (n === null) return { erro: 'O mínimo de indicações vai de 1 a 100.' }
        f['minimoDeIndicacoes'] = n
      }
      return { filtros: f }
    }
    case 'pacientes-por-procedimento': {
      const situacao = SITUACOES_DO_PROGRAMA_NA_TELA.find((s) => s.valor === c.situacaoDoPrograma) ?? SITUACOES_DO_PROGRAMA_NA_TELA[0]
      const f: Record<string, unknown> = { situacoes: [...situacao.situacoes], ...(c.comPeriodo ? periodo : {}) }
      if (c.procedimentoIds.length > 0) f['procedimentoIds'] = [...c.procedimentoIds]
      return { filtros: f }
    }
    case 'pacientes-por-origem-e-campanha': {
      const f: Record<string, unknown> = { ...periodo }
      se(f, 'campanhaId', c.campanhaId)
      se(f, 'origem', c.origem)
      return { filtros: f }
    }
    case 'aniversariantes': {
      if (c.aniversarioNoIntervalo) return { filtros: periodo }
      const mes = inteiro(c.mes, 1, 12)
      return mes === null ? { erro: 'Escolha o mês.' } : { filtros: { mes } }
    }
    case 'recebimentos': {
      const f: Record<string, unknown> = { ...periodo }
      se(f, 'forma', c.forma)
      se(f, 'tipo', c.tipo)
      se(f, 'unidadeId', c.unidadeId)
      se(f, 'registradoPorId', c.registradoPorId)
      return { filtros: f }
    }
    case 'saldos-em-aberto': {
      const f: Record<string, unknown> = {}
      se(f, 'ate', c.corte)
      const erro = faixa(c, f)
      return erro === null ? { filtros: f } : { erro }
    }
    case 'contas': {
      const f: Record<string, unknown> = { ...periodo, situacao: c.situacaoDaConta }
      se(f, 'categoria', c.categoria)
      return { filtros: f }
    }
    case 'saidas-de-estoque': {
      const f: Record<string, unknown> = { modo: c.modo, ...periodo, incluirPaciente: c.incluirPaciente }
      se(f, 'itemId', c.itemId)
      se(f, 'motivo', c.motivoDaSaida)
      se(f, 'localId', c.localId)
      return { filtros: f }
    }
    case 'entradas-de-estoque': {
      const f: Record<string, unknown> = { ...periodo }
      se(f, 'itemId', c.itemId)
      se(f, 'fornecedorId', c.fornecedorId)
      return { filtros: f }
    }
    case 'orcamentos': {
      const f: Record<string, unknown> = { ...periodo }
      se(f, 'situacao', c.situacaoDoOrcamento)
      se(f, 'motivoDePerdaId', c.motivoDePerdaId)
      return { filtros: f }
    }
    case 'faltas-e-desmarcacoes': {
      const f: Record<string, unknown> = { ...periodo }
      se(f, 'recontatada', c.recontatada)
      return { filtros: f }
    }
    case 'tarefas-da-equipe': {
      const f: Record<string, unknown> = { ...periodo }
      se(f, 'responsavelId', c.responsavelId)
      se(f, 'situacao', c.situacaoDoPrazo)
      se(f, 'tipo', c.tipo)
      return { filtros: f }
    }
  }
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '')
const numero = (v: unknown, base: string): string => (typeof v === 'number' ? String(v) : base)
const reais = (v: unknown): string => (typeof v === 'string' && /^-?\d+$/.test(v) ? textoDeCentavos(BigInt(v)) : '')
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** As situações gravadas → a escolha da tela. Um conjunto que a tela não oferece cai no padrão. */
function situacaoDoProgramaDe(f: Readonly<Record<string, unknown>>): SituacaoDoProgramaNaTela {
  const gravadas = Array.isArray(f['situacoes'])
    ? ids(f['situacoes'])
    : f['incluirEncerrados'] === true
      ? [...SITUACOES_DO_PROGRAMA_NO_FILTRO]
      : ['ativo', 'concluido']
  const chave = [...gravadas].sort().join('|')
  return SITUACOES_DO_PROGRAMA_NA_TELA.find((s) => [...s.situacoes].sort().join('|') === chave)?.valor ?? 'ativos-e-concluidos'
}

/**
 * A situação do orçamento de um favorito. O de antes guarda a ETAPA da jornada
 * (o servidor ainda a aceita); na tela ela vira a situação equivalente, e o
 * favorito sai no formato novo. Etapa sem equivalente cai em "todas".
 */
function situacaoDoOrcamentoDe(f: Readonly<Record<string, unknown>>): string {
  const s = f['situacao']
  if (typeof s === 'string' && (SITUACOES_DO_ORCAMENTO_NO_RELATORIO as readonly string[]).includes(s)) return s
  const etapa = f['etapa']
  return etapa === 'fechado' ? 'fechado' : etapa === 'perdido' ? 'perdido' : etapa === 'orcamento' ? 'enviado' : ''
}

const ehMotivoDeSaida = (v: unknown): v is string => typeof v === 'string' && (MOTIVOS_DE_SAIDA as readonly string[]).includes(v)

/** O caminho de volta: os filtros de um favorito nos campos. O que não veio fica como estava. */
export function deFiltros(chave: ChaveDeRelatorio, f: Readonly<Record<string, unknown>>, base: Campos): Campos {
  const comPeriodo: Campos = { ...base, de: texto(f['de']) || base.de, ate: texto(f['ate']) || base.ate }
  switch (chave) {
    case 'pacientes-sem-compra':
      return {
        ...base,
        meses: numero(f['semCompraHaMeses'], base.meses),
        procedimentoId: texto(f['procedimentoId']),
        valorMinimo: reais(f['valorMinimo']),
        valorMaximo: reais(f['valorMaximo']),
        unidadeId: texto(f['unidadeId']),
        origem: texto(f['origem']),
      }
    case 'pacientes-sem-atendimento':
      return {
        ...base,
        emDias: typeof f['semAtendimentoHaDias'] === 'number',
        meses: numero(f['semAtendimentoHaMeses'], base.meses),
        dias: numero(f['semAtendimentoHaDias'], base.dias),
        tipo: texto(f['tipo']),
        unidadeId: texto(f['unidadeId']),
      }
    case 'pacientes-maior-ltv':
      return {
        ...comPeriodo,
        quantos: numero(f['quantos'], base.quantos),
        comPeriodo: typeof f['de'] === 'string',
        unidadeId: texto(f['unidadeId']),
        origem: texto(f['origem']),
      }
    case 'pacientes-que-indicaram':
      return { ...comPeriodo, minimoDeIndicacoes: numero(f['minimoDeIndicacoes'], '') }
    case 'pacientes-por-procedimento': {
      // O favorito de antes guarda UM procedimento; o de agora, a lista.
      const antigo = texto(f['procedimentoId'])
      return {
        ...comPeriodo,
        procedimentoIds: Array.isArray(f['procedimentoIds']) ? ids(f['procedimentoIds']) : antigo === '' ? [] : [antigo],
        situacaoDoPrograma: situacaoDoProgramaDe(f),
        comPeriodo: typeof f['de'] === 'string',
      }
    }
    case 'pacientes-por-origem-e-campanha':
      return { ...comPeriodo, campanhaId: texto(f['campanhaId']), origem: texto(f['origem']) }
    case 'aniversariantes':
      return typeof f['de'] === 'string'
        ? { ...comPeriodo, aniversarioNoIntervalo: true }
        : { ...base, aniversarioNoIntervalo: false, mes: numero(f['mes'], base.mes) }
    case 'recebimentos':
      return {
        ...comPeriodo,
        forma: texto(f['forma']),
        tipo: texto(f['tipo']),
        unidadeId: texto(f['unidadeId']),
        registradoPorId: texto(f['registradoPorId']),
      }
    case 'saldos-em-aberto':
      return { ...base, corte: texto(f['ate']), valorMinimo: reais(f['valorMinimo']), valorMaximo: reais(f['valorMaximo']) }
    case 'contas': {
      const s = f['situacao']
      return { ...comPeriodo, situacaoDaConta: s === 'abertas' || s === 'pagas' ? s : 'todas', categoria: texto(f['categoria']) }
    }
    case 'saidas-de-estoque':
      return {
        ...comPeriodo,
        modo: f['modo'] === 'analise' ? 'analise' : 'calendario',
        itemId: texto(f['itemId']),
        incluirPaciente: f['incluirPaciente'] === true,
        motivoDaSaida: ehMotivoDeSaida(f['motivo']) ? f['motivo'] : '',
        localId: texto(f['localId']),
      }
    case 'entradas-de-estoque':
      return { ...comPeriodo, itemId: texto(f['itemId']), fornecedorId: texto(f['fornecedorId']) }
    case 'orcamentos':
      return { ...comPeriodo, situacaoDoOrcamento: situacaoDoOrcamentoDe(f), motivoDePerdaId: texto(f['motivoDePerdaId']) }
    case 'faltas-e-desmarcacoes': {
      const r = f['recontatada']
      return { ...comPeriodo, recontatada: r === 'sim' || r === 'nao' ? r : '' }
    }
    case 'tarefas-da-equipe':
      return {
        ...comPeriodo,
        responsavelId: texto(f['responsavelId']),
        situacaoDoPrazo: texto(f['situacao']),
        tipo: texto(f['tipo']),
      }
  }
}

/**
 * Há filtro raro preenchido? Abre "+ Mais opções" de saída, para o favorito
 * que o usa não esconder o próprio recorte (docs/design.md: campo raro fica
 * recolhido — e à vista quando está em uso).
 */
export function temMaisOpcoesEmUso(chave: ChaveDeRelatorio, c: Campos): boolean {
  switch (chave) {
    case 'pacientes-sem-compra':
      return c.valorMinimo !== '' || c.valorMaximo !== '' || c.unidadeId !== '' || c.origem !== ''
    case 'pacientes-sem-atendimento':
      return c.tipo !== '' || c.unidadeId !== ''
    case 'pacientes-maior-ltv':
      return c.unidadeId !== '' || c.origem !== ''
    case 'pacientes-que-indicaram':
      return c.minimoDeIndicacoes !== ''
    case 'pacientes-por-procedimento':
      return c.comPeriodo
    case 'recebimentos':
      return c.tipo !== '' || c.unidadeId !== '' || c.registradoPorId !== ''
    case 'saldos-em-aberto':
      return c.valorMinimo !== '' || c.valorMaximo !== ''
    case 'saidas-de-estoque':
      return c.incluirPaciente || c.localId !== ''
    case 'entradas-de-estoque':
      return c.fornecedorId !== ''
    case 'orcamentos':
      return c.motivoDePerdaId !== ''
    case 'tarefas-da-equipe':
      return c.situacaoDoPrazo !== '' || c.tipo !== ''
    case 'pacientes-por-origem-e-campanha':
    case 'aniversariantes':
    case 'contas':
    case 'faltas-e-desmarcacoes':
      return false
  }
}
