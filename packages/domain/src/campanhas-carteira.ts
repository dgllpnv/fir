import { Dinheiro } from './dinheiro'
import { percentualInteiro } from './financeiro/visao-do-mes'
import { LIMIAR_ORCAMENTOS_PAGOS } from './portal-grupo'
import { erro, erroDe, ok, type Result } from './resultado'

/**
 * **CAMPANHAS DA CARTEIRA** — a tela comparativa (K1), a aba do cliente (V9)
 * e o período (K2). Inventário G8; gates `g8-gate-lgpd.md` A20–A26 e
 * `g8-gate-numeros.md` ajustes 23–29.
 *
 * Uma regra, um ponto (LGPD A20): **toda saída que mostra receita de
 * campanha passa por `suprimirCampanhas`** — a tela K1, a aba V9, o portal, o
 * resumo semanal, qualquer exportação. Os agregados (`resumirCampanhas`)
 * recebem a SAÍDA da supressão, nunca as células cruas: o tipo
 * `CelulaSuprimida` não tem `receita`, então não existe como somar o que foi
 * escondido nem por descuido.
 */

/** `k = 5` (ADR 0013 §4) — o mesmo limiar do portal, um número só. */
export const K_CAMPANHAS = LIMIAR_ORCAMENTOS_PAGOS

export const STATUS_DE_CAMPANHA_CARTEIRA = ['planejada', 'ativa', 'encerrada'] as const
export type StatusDeCampanhaCarteira = (typeof STATUS_DE_CAMPANHA_CARTEIRA)[number]

/**
 * Uma CÉLULA: uma campanha num mês (`campanhas_carteira`, migration 0043). É a
 * granularidade exibida, e por isso é a granularidade do `k` (LGPD A21).
 */
export type CelulaDeCampanha = {
  readonly id: string
  readonly clienteId: string
  /** O que junta as células da MESMA campanha (a de origem na clínica, ou a linha manual). */
  readonly campanhaChave: string
  readonly nome: string
  readonly tipo: string
  /** `aaaa-mm-01`. */
  readonly mes: string
  readonly status: StatusDeCampanhaCarteira
  /** "Valor gerado no mês". `null` = não medido. */
  readonly receita: Dinheiro | null
  readonly investimento: Dinheiro | null
  /** Pagamentos da célula. `null` conta como abaixo de `k`. */
  readonly orcamentosPagos: number | null
  /**
   * LGPD A24: `false` só quando não há paciente por trás (cliente que não é
   * de saúde). Hoje o cadastro do cliente não tem segmento, então todo
   * chamador passa `true` — a leitura segura.
   */
  readonly exigeContagem: boolean
  readonly resultado: bigint | null
  readonly meta: bigint | null
  /** Resultado e meta em centavos (métrica de receita) ou em contagem. */
  readonly resultadoEmDinheiro: boolean
}

type Identidade = Pick<CelulaDeCampanha, 'id' | 'clienteId' | 'campanhaChave' | 'nome' | 'tipo' | 'mes' | 'status'>

export type CelulaExibida = Identidade & {
  readonly suprimida: false
  readonly receita: Dinheiro | null
  readonly investimento: Dinheiro | null
  readonly orcamentosPagos: number | null
  readonly resultado: bigint | null
  readonly meta: bigint | null
  readonly resultadoEmDinheiro: boolean
  readonly percentualDaMeta: number | null
  readonly retornoEmDecimos: bigint | null
}

/**
 * Sem `receita`, sem `resultado`, sem `orcamentosPagos`, sem `% da meta` e sem
 * `retorno` (A23: os derivados seguem a receita — `% × meta` devolve o
 * resultado e `retorno × investimento` devolve a receita). O nome fica: ele é
 * da campanha, não de paciente, e a equipe precisa achar a linha para lançar o
 * investimento. O investimento fica pelo mesmo motivo — é lançado pela
 * própria Firmare, não sai da clínica.
 */
export type CelulaSuprimida = Identidade & {
  readonly suprimida: true
  readonly investimento: Dinheiro | null
  readonly meta: bigint | null
  readonly resultadoEmDinheiro: boolean
}

export type SupressaoDeCampanhas = {
  readonly celulas: readonly (CelulaExibida | CelulaSuprimida)[]
  readonly suprimidas: number
}

const abaixoDoK = (c: CelulaDeCampanha, k: number): boolean =>
  c.exigeContagem && (c.orcamentosPagos === null || c.orcamentosPagos < k)

/**
 * **A FUNÇÃO ÚNICA DE SUPRESSÃO** (LGPD A20–A23, gate de números ajuste 26,
 * CE-3).
 *
 * Célula com menos de `k` pagamentos sai sem valor e sem derivados. E a
 * decisão que importa: **"Outras campanhas" nunca leva valor** — só a
 * quantidade. O gate permite o balde com valor quando a soma das contagens
 * chega a `k`; recusamos de propósito, porque o balde é a ÚNICA porta por
 * onde uma célula suprimida influencia a saída, e ela abre por diferença
 * ENTRE requisições: o balde de 6 meses menos o de 3 meses, ou o de hoje
 * menos o de ontem, isola a célula pequena que entrou. Fechada essa porta, a
 * saída depende só de células visíveis — e cada uma decide sozinha, pela
 * própria contagem, se é visível. Nenhuma combinação de requisições recupera
 * o que nenhuma delas contém. É o invariante (c) do property test.
 *
 * Consequência na tela: todo total é "das campanhas exibidas" quando há
 * célula suprimida (`soDasExibidas`), e é sempre igual à soma das linhas
 * visíveis (ajuste 26).
 */
export function suprimirCampanhas(
  celulas: readonly CelulaDeCampanha[],
  k: number = K_CAMPANHAS,
): SupressaoDeCampanhas {
  let suprimidas = 0
  const saida = celulas.map((c): CelulaExibida | CelulaSuprimida => {
    const identidade: Identidade = {
      id: c.id,
      clienteId: c.clienteId,
      campanhaChave: c.campanhaChave,
      nome: c.nome,
      tipo: c.tipo,
      mes: c.mes,
      status: c.status,
    }
    if (abaixoDoK(c, k)) {
      suprimidas += 1
      return {
        ...identidade,
        suprimida: true,
        investimento: c.investimento,
        meta: c.meta,
        resultadoEmDinheiro: c.resultadoEmDinheiro,
      }
    }
    return {
      ...identidade,
      suprimida: false,
      receita: c.receita,
      investimento: c.investimento,
      orcamentosPagos: c.orcamentosPagos,
      resultado: c.resultado,
      meta: c.meta,
      resultadoEmDinheiro: c.resultadoEmDinheiro,
      percentualDaMeta: c.resultado !== null && c.meta !== null ? percentualInteiro(c.resultado, c.meta) : null,
      retornoEmDecimos: retornoEmDecimos(c.receita, c.investimento),
    }
  })
  return { celulas: saida, suprimidas }
}

// ---------------------------------------------------------------------------
// Retorno (ajuste 28, D-22 item 9)
// ---------------------------------------------------------------------------

/**
 * Retorno = total ÷ investimento, como o protótipo (`roi`, L1477) — um
 * MÚLTIPLO, não `(r − i)/i`. Em décimos, meio para cima, em aritmética exata:
 * `(20·r + i) div (2·i)`. "Total" é só a receita do mês: "continuado" não
 * existe na fonte (ADR 0013 §5, LGPD A26).
 *
 * `null` sem investimento lançado ou com investimento zero ("—"), e sem
 * receita medida (`r!=null` do protótipo).
 */
export function retornoEmDecimos(receita: Dinheiro | null, investimento: Dinheiro | null): bigint | null {
  if (receita === null || investimento === null || investimento.centavos <= 0n) return null
  const r = receita.centavos
  const i = investimento.centavos
  return (20n * r + i) / (2n * i)
}

const MILHAR = new Intl.NumberFormat('pt-BR')

/** "3,2x", "3x" — uma casa, sem ",0", com separador de milhar (`toLocaleString`, L1477). */
export function formatarRetorno(decimos: bigint): string {
  const inteiro = MILHAR.format(decimos / 10n)
  const fracao = decimos % 10n
  return `${inteiro}${fracao === 0n ? '' : `,${fracao}`}x`
}

// ---------------------------------------------------------------------------
// Agregados — sempre sobre a SAÍDA da supressão
// ---------------------------------------------------------------------------

export type ValorDoMes = { readonly mes: string; readonly valorGerado: Dinheiro }

export type ResumoDeCampanhas = {
  readonly meses: readonly string[]
  /** "Valor gerado em <mês corrente>" — independe do período, como no protótipo (L1966). */
  readonly mesAtual: { readonly valorGerado: Dinheiro }
  /** `null` quando não há nenhuma campanha exibida no mês anterior ("sem mês anterior"). */
  readonly mesAnterior: { readonly valorGerado: Dinheiro } | null
  readonly periodo: {
    readonly valorGerado: Dinheiro
    readonly investimento: Dinheiro
    readonly retornoEmDecimos: bigint | null
  }
  /** Campanhas (não células) com status `ativa`. */
  readonly ativas: number
  readonly porCliente: readonly {
    readonly clienteId: string
    readonly meses: readonly ValorDoMes[]
    readonly valorGerado: Dinheiro
    readonly investimento: Dinheiro
    readonly retornoEmDecimos: bigint | null
    readonly melhor: { readonly nome: string; readonly mes: string; readonly valorGerado: Dinheiro } | null
  }[]
  readonly maisGeraram: readonly {
    readonly id: string
    readonly clienteId: string
    readonly nome: string
    readonly mes: string
    readonly valorGerado: Dinheiro
    readonly resultado: bigint | null
    readonly resultadoEmDinheiro: boolean
    readonly retornoEmDecimos: bigint | null
  }[]
  readonly porTipo: readonly { readonly tipo: string; readonly clientes: number; readonly meses: readonly ValorDoMes[] }[]
  /** As células suprimidas do período: só a quantidade, nunca valor. */
  readonly outras: { readonly quantidade: number }
  /** Há célula suprimida no período — os totais são "das campanhas exibidas". */
  readonly soDasExibidas: boolean
}

const somar = (xs: readonly CelulaExibida[]): Dinheiro =>
  xs.reduce((s, c) => (c.receita === null ? s : s.mais(c.receita)), Dinheiro.zero())
const somarInvestimento = (xs: readonly CelulaExibida[]): Dinheiro =>
  xs.reduce((s, c) => (c.investimento === null ? s : s.mais(c.investimento)), Dinheiro.zero())
const porValorDesc = (a: Dinheiro, b: Dinheiro): number =>
  a.centavos === b.centavos ? 0 : a.centavos > b.centavos ? -1 : 1

/**
 * Os números da tela comparativa (K1, `vCampanhas` L1963-2001) e dos KPIs da
 * aba do cliente (V9, `cCampanhas` L1444-1456) — todos de células EXIBIDAS.
 *
 * Retorno do período é a razão das somas, nunca a média das razões
 * (gate de números §3.5), e o investimento somado é só o das exibidas: com o
 * da suprimida, `retorno × investimento − linhas visíveis` daria a receita
 * escondida.
 */
export function resumirCampanhas(
  supressao: SupressaoDeCampanhas,
  periodo: { readonly de: string; readonly ate: string; readonly mesAtual: string; readonly mesAnterior: string },
): ResumoDeCampanhas {
  const meses = mesesEntre(periodo.de, periodo.ate)
  const noPeriodo = (c: { mes: string }) => c.mes >= periodo.de && c.mes <= periodo.ate
  const exibidas = supressao.celulas.filter((c): c is CelulaExibida => !c.suprimida)
  const doPeriodo = exibidas.filter(noPeriodo)
  const suprimidasNoPeriodo = supressao.celulas.filter((c) => c.suprimida && noPeriodo(c)).length

  const valoresPorMes = (xs: readonly CelulaExibida[]): ValorDoMes[] =>
    meses.map((mes) => ({ mes, valorGerado: somar(xs.filter((c) => c.mes === mes)) }))

  const doMesAnterior = exibidas.filter((c) => c.mes === periodo.mesAnterior)
  const valorDoPeriodo = somar(doPeriodo)
  const investimentoDoPeriodo = somarInvestimento(doPeriodo)

  const clientes = [...new Set(doPeriodo.map((c) => c.clienteId))]
  const porCliente = clientes
    .map((clienteId) => {
      const delas = doPeriodo.filter((c) => c.clienteId === clienteId)
      const valorGerado = somar(delas)
      const investimento = somarInvestimento(delas)
      const melhor = [...delas]
        .filter((c) => c.receita !== null && c.receita.centavos > 0n)
        .sort((a, b) => porValorDesc(a.receita!, b.receita!) || a.id.localeCompare(b.id))[0]
      return {
        clienteId,
        meses: valoresPorMes(delas),
        valorGerado,
        investimento,
        retornoEmDecimos: retornoEmDecimos(valorGerado, investimento),
        melhor: melhor === undefined ? null : { nome: melhor.nome, mes: melhor.mes, valorGerado: melhor.receita! },
      }
    })
    .sort((a, b) => porValorDesc(a.valorGerado, b.valorGerado) || a.clienteId.localeCompare(b.clienteId))

  const maisGeraram = doPeriodo
    .filter((c) => c.receita !== null && c.receita.centavos > 0n)
    .sort((a, b) => porValorDesc(a.receita!, b.receita!) || a.id.localeCompare(b.id))
    .slice(0, 6)
    .map((c) => ({
      id: c.id,
      clienteId: c.clienteId,
      nome: c.nome,
      mes: c.mes,
      valorGerado: c.receita!,
      resultado: c.resultado,
      resultadoEmDinheiro: c.resultadoEmDinheiro,
      retornoEmDecimos: c.retornoEmDecimos,
    }))

  const tipos = [...new Set(doPeriodo.map((c) => c.tipo))]
  const porTipo = tipos
    .map((tipo) => {
      const delas = doPeriodo.filter((c) => c.tipo === tipo)
      return { tipo, clientes: new Set(delas.map((c) => c.clienteId)).size, meses: valoresPorMes(delas), total: somar(delas) }
    })
    .sort((a, b) => porValorDesc(a.total, b.total) || a.tipo.localeCompare(b.tipo, 'pt-BR'))
    .map(({ tipo, clientes: n, meses: m }) => ({ tipo, clientes: n, meses: m }))

  // Campanhas ativas: contagem de CAMPANHAS, inclusive as suprimidas — é
  // número de campanhas, não de pacientes nem de dinheiro.
  const ativas = new Set(supressao.celulas.filter((c) => c.status === 'ativa').map((c) => `${c.clienteId}|${c.campanhaChave}`)).size

  return {
    meses,
    mesAtual: { valorGerado: somar(exibidas.filter((c) => c.mes === periodo.mesAtual)) },
    mesAnterior: doMesAnterior.length === 0 ? null : { valorGerado: somar(doMesAnterior) },
    periodo: {
      valorGerado: valorDoPeriodo,
      investimento: investimentoDoPeriodo,
      retornoEmDecimos: retornoEmDecimos(valorDoPeriodo, investimentoDoPeriodo),
    },
    ativas,
    porCliente,
    maisGeraram,
    porTipo,
    outras: { quantidade: suprimidasNoPeriodo },
    soDasExibidas: suprimidasNoPeriodo > 0,
  }
}

// ---------------------------------------------------------------------------
// Período (K2, ajuste 29)
// ---------------------------------------------------------------------------

export const PERIODOS_DE_CAMPANHAS = ['mes', '3m', '6m', '12m', 'ano', 'ciclo', 'custom'] as const
export type PeriodoDeCampanhas = (typeof PERIODOS_DE_CAMPANHAS)[number]

/** Janelas acima disto são recusadas: 60 colunas de mês não são uma tela, são um ataque de custo. */
const MAXIMO_DE_MESES = 60

const indiceDoMes = (mes: string): number => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1
const mesDoIndice = (i: number): string => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`
const primeiroDoMes = (dia: string): string => `${dia.slice(0, 7)}-01`

/** `mesesEntre` do protótipo (L1471): do primeiro ao último, inclusive, sempre dia 1. */
export function mesesEntre(de: string, ate: string): string[] {
  const out: string[] = []
  for (let i = indiceDoMes(de); i <= indiceDoMes(ate); i++) out.push(mesDoIndice(i))
  return out
}

/**
 * Os meses do filtro (`periodo`, L1459-1469). O "hoje" é o DO SERVIDOR, no
 * fuso da carteira (regra 24) — quem chama passa. As bordas em instante não
 * aparecem aqui de propósito: cada célula já foi atribuída ao mês NO FUSO DA
 * CLÍNICA pelo job (ajuste 24), então filtrar por mês é comparar rótulos
 * `aaaa-mm-01`, e a janela semiaberta `[1º do mês inicial, 1º do mês seguinte
 * ao final)` é exatamente `de ≤ mes ≤ ate` sobre esses rótulos.
 *
 * "Ciclo do contrato" sem início cadastrado cai em 3 meses, como o protótipo
 * (L1445).
 */
export function periodoDeCampanhas(
  chave: PeriodoDeCampanhas,
  hoje: string,
  opcoes: {
    readonly de?: string | undefined
    readonly ate?: string | undefined
    readonly inicioDoContrato?: string | null | undefined
    readonly fimDoContrato?: string | null | undefined
  } = {},
): Result<{ readonly de: string; readonly ate: string; readonly meses: readonly string[] }> {
  const atual = indiceDoMes(hoje)
  const faixa = (de: number, ate: number) => {
    if (ate - de + 1 > MAXIMO_DE_MESES) {
      return erro(erroDe('PeriodoLongoDemais', `Escolha no máximo ${MAXIMO_DE_MESES} meses.`))
    }
    const d = mesDoIndice(de)
    const a = mesDoIndice(ate)
    return ok({ de: d, ate: a, meses: mesesEntre(d, a) })
  }
  switch (chave) {
    case 'mes':
      return faixa(atual, atual)
    case '6m':
      return faixa(atual - 5, atual)
    case '12m':
      return faixa(atual - 11, atual)
    case 'ano':
      return faixa(Number(hoje.slice(0, 4)) * 12, atual)
    case 'ciclo': {
      const inicio = opcoes.inicioDoContrato
      if (inicio === null || inicio === undefined) return faixa(atual - 2, atual)
      const fim = opcoes.fimDoContrato
      const ultimo = fim !== null && fim !== undefined && primeiroDoMes(fim) < mesDoIndice(atual) ? indiceDoMes(fim) : atual
      return faixa(indiceDoMes(inicio), ultimo)
    }
    case 'custom': {
      if (opcoes.de === undefined || opcoes.ate === undefined) {
        return erro(erroDe('PeriodoIncompleto', 'Escolha o mês inicial e o final.'))
      }
      const a = indiceDoMes(`${opcoes.de}-01`)
      const b = indiceDoMes(`${opcoes.ate}-01`)
      return a <= b ? faixa(a, b) : faixa(b, a)
    }
    case '3m':
    default:
      return faixa(atual - 2, atual)
  }
}

/** O mês civil (`aaaa-mm-01`) anterior. */
export const mesAnterior = (mes: string): string => mesDoIndice(indiceDoMes(mes) - 1)
