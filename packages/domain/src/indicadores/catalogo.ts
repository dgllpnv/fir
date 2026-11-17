import { Dinheiro } from '../dinheiro'
import { percentualInteiro } from '../financeiro/visao-do-mes'
import { mediaDeAtingimento } from '../metas-de-pessoa'
import { type ChaveDePermissao, type Perfil, temPerm, type UsuarioDePermissao } from '../permissoes'
import { erro, erroDe, ok, type Result } from '../resultado'
import { ESCALA_DA_UNIDADE, NumeroDoKpi, type UnidadeDeKpi } from './unidades'

/**
 * O CATÁLOGO dos KPIs automáticos (I-7): 20 chaves, cada uma com a fonte que
 * já existe no servidor. Nenhum número daqui é recalculado em paralelo — a
 * `CalculadoraDeKpi` (T2) chama a função nomeada em `fonte`.
 *
 * **Os schemas de parâmetros** (`.strict()`, appsec C6) moram em
 * `packages/contracts/src/indicadores.ts`: o domínio não importa Zod. Aqui
 * fica só o NOME de cada parâmetro que a chave aceita, e o contrato tem um
 * teste que cobra os dois iguais.
 */
export const PILARES_DE_KPI = ['Financeiro', 'Comercial', 'Processos', 'Pessoas'] as const
export type PilarDeKpi = (typeof PILARES_DE_KPI)[number]

export const DIRECOES = ['maior', 'menor'] as const
export type Direcao = (typeof DIRECOES)[number]

export const AGREGACOES = ['soma', 'taxa', 'posicao', 'analise', 'media_mensal'] as const
export type Agregacao = (typeof AGREGACOES)[number]

export const FREQUENCIAS_DE_KPI = ['semanal', 'mensal'] as const
export type FrequenciaDeKpi = (typeof FREQUENCIAS_DE_KPI)[number]

export type ParametroDoKpi = 'origem' | 'campanhaId'

/**
 * A unidade de `resultado_de_campanha` é a da métrica da campanha: `receita`
 * é reais; contatos, agendamentos e fechamentos são quantidade.
 */
export type UnidadeDoCatalogo = UnidadeDeKpi | 'da_metrica'

/**
 * As 20 chaves, na ordem do catálogo (I-7). A mesma lista está no `CHECK` de
 * `kpis.chave_catalogo` (0098); um teste cobra que o catálogo tem exatamente
 * estas, nesta ordem.
 */
export const CHAVES_DO_CATALOGO = [
  'faturamento_conferido',
  'resultado_do_mes',
  'ticket_medio',
  'despesas_fixas_sobre_recebido',
  'saldo_a_receber',
  'caixas_sem_diferenca',
  'novos_pacientes',
  'conversao_de_orcamentos',
  'valor_fechado_em_orcamentos',
  'comparecimento',
  'faltas_recontatadas',
  'pacientes_recaptados',
  'resultado_de_campanha',
  'tarefas_no_prazo',
  'rotinas_cumpridas',
  'perda_de_estoque',
  'itens_abaixo_do_minimo',
  'atingimento_metas_individuais',
  'saldo_banco_de_horas',
  'conversas_1a1_em_dia',
] as const
export type ChaveDoCatalogo = (typeof CHAVES_DO_CATALOGO)[number]

export type KpiDoCatalogo = {
  readonly chave: ChaveDoCatalogo
  readonly nome: string
  readonly pilar: PilarDeKpi
  readonly unidade: UnidadeDoCatalogo
  readonly direcao: Direcao
  readonly agregacao: Agregacao
  readonly frequencias: readonly FrequenciaDeKpi[]
  /** Pode ser filtrado por unidade da clínica. */
  readonly porUnidade: boolean
  readonly parametros: readonly ParametroDoKpi[]
  /** Parâmetros sem os quais a chave não mede nada. */
  readonly parametrosObrigatorios: readonly ParametroDoKpi[]
  /** De onde o número sai, para a dica "como é calculado". */
  readonly fonte: string
  /** A permissão que abre a composição (I-32). `null` = sem composição. */
  readonly permissaoDaComposicao: ChaveDePermissao | null
  /** A composição tem linha de paciente: rota `@DadoSensivel` (LGPD L-IN-3). */
  readonly composicaoComPaciente: boolean
  /**
   * Sem ESTA chave, o KPI não existe na resposta — nem na lista, nem no
   * catálogo, nem na carteira (appsec C5; números c.11b). É o filtro de um
   * ponto só: a `CalculadoraDeKpi` e a listagem leem daqui.
   */
  readonly permissaoDoValor: ChaveDePermissao | null
  /** `resultado_do_mes`: só meta de mês civil inteiro (números c.4). */
  readonly somenteMesCivil: boolean
  /** Só o resultado do mês pode ser negativo (fechar no vermelho). */
  readonly admiteNegativo: boolean
  /** Teto do domínio, na menor unidade: taxas "x de y" não passam de 100%. */
  readonly teto: bigint | null
}

const SEM_MES = ['semanal', 'mensal'] as const
const MES = ['mensal'] as const
const CEM_POR_CENTO = 100n * ESCALA_DA_UNIDADE.percentual.porUnidade

type Linha = Omit<KpiDoCatalogo, 'parametros' | 'parametrosObrigatorios' | 'somenteMesCivil' | 'admiteNegativo' | 'teto' | 'composicaoComPaciente' | 'porUnidade'> &
  Partial<Pick<KpiDoCatalogo, 'parametros' | 'parametrosObrigatorios' | 'somenteMesCivil' | 'admiteNegativo' | 'teto' | 'composicaoComPaciente' | 'porUnidade'>>

const linha = (l: Linha): KpiDoCatalogo => ({
  parametros: [],
  parametrosObrigatorios: [],
  somenteMesCivil: false,
  admiteNegativo: false,
  teto: null,
  composicaoComPaciente: false,
  porUnidade: false,
  ...l,
})

export const CATALOGO_DE_KPIS = [
  // --- Financeiro ---------------------------------------------------------
  linha({ chave: 'faturamento_conferido', nome: 'Faturamento conferido', pilar: 'Financeiro', unidade: 'reais', direcao: 'maior', agregacao: 'soma', frequencias: SEM_MES, fonte: 'Recebimentos dos dias com caixa fechado (I-9)', permissaoDaComposicao: 'finmes', permissaoDoValor: null }),
  linha({ chave: 'resultado_do_mes', nome: 'Resultado do mês', pilar: 'Financeiro', unidade: 'reais', direcao: 'maior', agregacao: 'soma', frequencias: MES, somenteMesCivil: true, admiteNegativo: true, fonte: 'Visão do mês: resultado do mês', permissaoDaComposicao: 'finmes', permissaoDoValor: null }),
  linha({ chave: 'ticket_medio', nome: 'Ticket médio', pilar: 'Financeiro', unidade: 'reais', direcao: 'maior', agregacao: 'taxa', frequencias: SEM_MES, fonte: 'Painel: receita ÷ pagamentos', permissaoDaComposicao: 'finmes', permissaoDoValor: null }),
  // Razão de dois valores em dinheiro: com o alvo visível, devolve o absoluto
  // das fixas, que incluem salário. Só existe com `valores` (números c.11b).
  linha({ chave: 'despesas_fixas_sobre_recebido', nome: 'Despesas fixas sobre o recebido', pilar: 'Financeiro', unidade: 'percentual', direcao: 'menor', agregacao: 'taxa', frequencias: MES, somenteMesCivil: true, fonte: 'Despesas fixas ÷ recebido, sem outras entradas (não é a razão da Visão do mês)', permissaoDaComposicao: 'finmes', permissaoDoValor: 'valores' }),
  linha({ chave: 'saldo_a_receber', nome: 'Saldo a receber', pilar: 'Financeiro', unidade: 'reais', direcao: 'menor', agregacao: 'posicao', frequencias: SEM_MES, fonte: 'Saldos em aberto na data', permissaoDaComposicao: 'cobrancas', permissaoDoValor: null }),
  linha({ chave: 'caixas_sem_diferenca', nome: 'Caixas sem diferença', pilar: 'Financeiro', unidade: 'percentual', direcao: 'maior', agregacao: 'taxa', frequencias: SEM_MES, teto: CEM_POR_CENTO, fonte: 'Caixas do mês com toda forma conferida igual (I-15)', permissaoDaComposicao: 'finmes', permissaoDoValor: null }),
  // --- Comercial ----------------------------------------------------------
  linha({ chave: 'novos_pacientes', nome: 'Novos pacientes', pilar: 'Comercial', unidade: 'quantidade', direcao: 'maior', agregacao: 'soma', frequencias: SEM_MES, porUnidade: true, parametros: ['origem'], fonte: 'Painel: pacientes novos (origem opcional)', permissaoDaComposicao: 'pacientes', composicaoComPaciente: true, permissaoDoValor: null }),
  linha({ chave: 'conversao_de_orcamentos', nome: 'Conversão de orçamentos', pilar: 'Comercial', unidade: 'percentual', direcao: 'maior', agregacao: 'taxa', frequencias: SEM_MES, teto: CEM_POR_CENTO, fonte: 'Painel: orçamentos fechados ÷ enviados', permissaoDaComposicao: 'jornada', composicaoComPaciente: true, permissaoDoValor: null }),
  linha({ chave: 'valor_fechado_em_orcamentos', nome: 'Valor fechado em orçamentos', pilar: 'Comercial', unidade: 'reais', direcao: 'maior', agregacao: 'soma', frequencias: SEM_MES, fonte: 'Painel: o que entrou em pagamento de orçamento (parte da receita, nunca somada a ela)', permissaoDaComposicao: 'jornada', composicaoComPaciente: true, permissaoDoValor: null }),
  linha({ chave: 'comparecimento', nome: 'Comparecimento', pilar: 'Comercial', unidade: 'percentual', direcao: 'maior', agregacao: 'taxa', frequencias: SEM_MES, teto: CEM_POR_CENTO, fonte: 'Realizados ÷ (realizados + faltas) (I-10)', permissaoDaComposicao: 'jornada', composicaoComPaciente: true, permissaoDoValor: null }),
  linha({ chave: 'faltas_recontatadas', nome: 'Faltas recontatadas em até 2 dias', pilar: 'Comercial', unidade: 'percentual', direcao: 'maior', agregacao: 'taxa', frequencias: SEM_MES, teto: CEM_POR_CENTO, fonte: 'Recontatadas ÷ faltas maduras (I-11)', permissaoDaComposicao: 'jornada', composicaoComPaciente: true, permissaoDoValor: null }),
  linha({ chave: 'pacientes_recaptados', nome: 'Pacientes recaptados', pilar: 'Comercial', unidade: 'quantidade', direcao: 'maior', agregacao: 'soma', frequencias: SEM_MES, fonte: 'Atendidos depois de 182 dias ou mais sem atendimento (I-12)', permissaoDaComposicao: 'jornada', composicaoComPaciente: true, permissaoDoValor: null }),
  linha({ chave: 'resultado_de_campanha', nome: 'Resultado de campanha', pilar: 'Comercial', unidade: 'da_metrica', direcao: 'maior', agregacao: 'soma', frequencias: MES, parametros: ['campanhaId'], parametrosObrigatorios: ['campanhaId'], fonte: 'Resultado da campanha', permissaoDaComposicao: 'campanhas', permissaoDoValor: null }),
  // --- Processos ----------------------------------------------------------
  linha({ chave: 'tarefas_no_prazo', nome: 'Tarefas no prazo', pilar: 'Processos', unidade: 'percentual', direcao: 'maior', agregacao: 'taxa', frequencias: SEM_MES, teto: CEM_POR_CENTO, fonte: 'Painel: prazos da equipe', permissaoDaComposicao: 'tarefas.equipe', permissaoDoValor: null }),
  linha({ chave: 'rotinas_cumpridas', nome: 'Rotinas cumpridas', pilar: 'Processos', unidade: 'percentual', direcao: 'maior', agregacao: 'taxa', frequencias: SEM_MES, teto: CEM_POR_CENTO, fonte: 'Rotinas previstas concluídas (I-13)', permissaoDaComposicao: 'tarefas.equipe', permissaoDoValor: null }),
  linha({ chave: 'perda_de_estoque', nome: 'Perda de estoque', pilar: 'Processos', unidade: 'reais', direcao: 'menor', agregacao: 'analise', frequencias: MES, fonte: 'Análise do estoque na janela inteira, ao custo atual (as barras não somam o total)', permissaoDaComposicao: 'estoque.gerir', permissaoDoValor: null }),
  linha({ chave: 'itens_abaixo_do_minimo', nome: 'Itens abaixo do mínimo', pilar: 'Processos', unidade: 'quantidade', direcao: 'menor', agregacao: 'posicao', frequencias: SEM_MES, fonte: 'Itens com saldo abaixo do mínimo na data', permissaoDaComposicao: 'estoque.gerir', permissaoDoValor: null }),
  // --- Pessoas: os três só existem com `pessoas.gerir` (appsec C5) --------
  linha({ chave: 'atingimento_metas_individuais', nome: 'Atingimento das metas individuais', pilar: 'Pessoas', unidade: 'percentual', direcao: 'maior', agregacao: 'media_mensal', frequencias: MES, somenteMesCivil: true, teto: CEM_POR_CENTO, fonte: 'Média de atingimento da equipe no mês', permissaoDaComposicao: 'pessoas.gerir', permissaoDoValor: 'pessoas.gerir' }),
  linha({ chave: 'saldo_banco_de_horas', nome: 'Saldo do banco de horas', pilar: 'Pessoas', unidade: 'horas', direcao: 'menor', agregacao: 'posicao', frequencias: MES, somenteMesCivil: true, fonte: 'Soma dos saldos POSITIVOS das fichas ativas; os negativos aparecem à parte', permissaoDaComposicao: 'pessoas.gerir', permissaoDoValor: 'pessoas.gerir' }),
  linha({ chave: 'conversas_1a1_em_dia', nome: 'Conversas 1:1 em dia', pilar: 'Pessoas', unidade: 'percentual', direcao: 'maior', agregacao: 'taxa', frequencias: MES, somenteMesCivil: true, teto: CEM_POR_CENTO, fonte: 'Fichas ativas com 1:1 no mês ÷ fichas ativas (I-14)', permissaoDaComposicao: 'pessoas.gerir', permissaoDoValor: 'pessoas.gerir' }),
] as const satisfies readonly KpiDoCatalogo[]

const POR_CHAVE = new Map<string, KpiDoCatalogo>(CATALOGO_DE_KPIS.map((k) => [k.chave, k]))

export const ehChaveDoCatalogo = (c: string): c is ChaveDoCatalogo => POR_CHAVE.has(c)

export function kpiDoCatalogo(chave: ChaveDoCatalogo): KpiDoCatalogo {
  const k = POR_CHAVE.get(chave)
  if (!k) throw new Error(`chave de catálogo desconhecida: ${chave}`)
  return k
}

/** A permissão sem a qual o KPI não existe na resposta. Manual: nenhuma. */
export function permissaoDoValor(chave: ChaveDoCatalogo | null): ChaveDePermissao | null {
  return chave === null ? null : kpiDoCatalogo(chave).permissaoDoValor
}

/**
 * O filtro do ponto único (appsec C5): a pessoa vê este KPI? `null` = KPI
 * manual, que não tem permissão própria além de `indicadores`.
 */
export function podeVerKpi(
  usuario: UsuarioDePermissao | null | undefined,
  perfis: readonly Perfil[],
  chave: ChaveDoCatalogo | null,
): boolean {
  const p = permissaoDoValor(chave)
  return p === null || temPerm(usuario, perfis, p)
}

/** A unidade de um KPI de catálogo, resolvendo `da_metrica` pela métrica da campanha. */
export function unidadeDoKpiDoCatalogo(chave: ChaveDoCatalogo, metricaDaCampanha?: string): UnidadeDeKpi {
  const k = kpiDoCatalogo(chave)
  if (k.unidade !== 'da_metrica') return k.unidade
  if (metricaDaCampanha === undefined) throw new Error('resultado_de_campanha precisa da métrica da campanha')
  return metricaDaCampanha === 'receita' ? 'reais' : 'quantidade'
}

// ---------------------------------------------------------------------------
// Agregação (I-4): o valor de um período a partir dos baldes
// ---------------------------------------------------------------------------

/** Só `soma` e `taxa` recombinam baldes. As outras três, nunca (B4, c.6). */
export const recombinaBaldes = (a: Agregacao): boolean => a === 'soma' || a === 'taxa'

export type BaldeDeSoma = { readonly valor: NumeroDoKpi }
/** Os dois termos da taxa, na escala dos termos (centavos, contagens). */
export type BaldeDeTaxa = { readonly numerador: bigint; readonly denominador: bigint }

/**
 * O valor de uma taxa: em reais, `Dinheiro.media` (o ticket médio); em
 * percentual, `percentualInteiro × 100` (I-3, a precisão do Painel). `null`
 * com denominador zero: a taxa de nada não existe.
 */
export function valorDaTaxa(unidade: UnidadeDeKpi, numerador: bigint, denominador: bigint): NumeroDoKpi | null {
  if (denominador <= 0n) return null
  if (unidade === 'reais') {
    return NumeroDoKpi.deDinheiro(Dinheiro.deCentavos(numerador).media(Number(denominador)))
  }
  if (unidade === 'percentual') {
    const p = percentualInteiro(numerador, denominador)
    return p === null ? null : NumeroDoKpi.de('percentual', BigInt(p) * ESCALA_DA_UNIDADE.percentual.porUnidade)
  }
  throw new Error(`taxa em ${unidade} não está no catálogo`)
}

/**
 * Recombina baldes de `soma` (Σ) ou de `taxa` (Σ num ÷ Σ den, nunca média de
 * percentuais). `posicao`, `analise` e `media_mensal` devolvem erro: o valor
 * do período vem da fonte, para a janela inteira — somar meses de perda ou
 * fazer média de médias dá outro número (números B4, c.6).
 */
export function combinarBaldes(
  agregacao: Agregacao,
  unidade: UnidadeDeKpi,
  baldes: readonly (BaldeDeSoma | BaldeDeTaxa)[],
): Result<NumeroDoKpi | null> {
  if (agregacao === 'soma') {
    let s = NumeroDoKpi.zero(unidade)
    for (const b of baldes) {
      if (!('valor' in b)) throw new Error('balde de taxa numa soma')
      s = s.mais(b.valor)
    }
    return ok(s)
  }
  if (agregacao === 'taxa') {
    let n = 0n
    let d = 0n
    for (const b of baldes) {
      if (!('numerador' in b)) throw new Error('balde de soma numa taxa')
      n += b.numerador
      d += b.denominador
    }
    return ok(valorDaTaxa(unidade, n, d))
  }
  return erro(
    erroDe(
      'AgregacaoNaoRecombina',
      `A agregação ${agregacao} não se recombina: o valor do período vem da fonte, para a janela inteira.`,
    ),
  )
}

/**
 * `media_mensal` (c.6): a média de atingimento das fichas NUM mês, pela
 * `mediaDeAtingimento` das metas de pessoa. Mais de um mês é erro — a média
 * de dois meses não é a média das duas médias, e não há número certo a dar.
 */
export function valorDaMediaMensal(
  meses: readonly { readonly mes: string; readonly percentuais: readonly (number | null)[] }[],
): Result<NumeroDoKpi | null> {
  if (meses.length !== 1) {
    return erro(erroDe('MediaMensalSoUmMes', 'O atingimento das metas individuais é só mensal: um mês por vez.'))
  }
  const m = mediaDeAtingimento(meses[0]!.percentuais)
  return ok(m === null ? null : NumeroDoKpi.de('percentual', BigInt(m) * ESCALA_DA_UNIDADE.percentual.porUnidade))
}
