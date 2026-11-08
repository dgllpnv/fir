import { Dinheiro } from '../dinheiro'

/**
 * As formas que estão na gaveta ao fim do dia — e **só** elas.
 *
 * `Nota promissória` não está aqui, e essa é a decisão deste módulo. O
 * protótipo a deixa entrar no `esperado` gravado e depois a exclui do cálculo
 * da diferença (linha 1368): um campo que a conferência ignora é um campo que
 * alguém soma um dia. Ela continua sendo receita — está em `FORMAS_PAGAMENTO`
 * e entra no LTV —, ela só não está na gaveta.
 */
export const FORMAS_DE_CONFERENCIA = [
  'Pix',
  'Dinheiro',
  'Cartão de crédito',
  'Cartão de débito',
] as const

export const FORA_DA_CONFERENCIA = 'Nota promissória'

export type Forma = (typeof FORMAS_DE_CONFERENCIA)[number]

export type LinhaDeCaixa = {
  readonly forma: Forma
  readonly esperado: Dinheiro
  readonly contado: Dinheiro
  /** `contado − esperado`. Negativo é falta, positivo é sobra. */
  readonly diferenca: Dinheiro
}

export type Conferencia = {
  /** As QUATRO formas, sempre, na ordem de `FORMAS_DE_CONFERENCIA`. */
  readonly linhas: readonly LinhaDeCaixa[]
  readonly diferenca: Dinheiro
  /**
   * Verdadeiro se e somente se TODA linha fechou.
   *
   * Não é `diferenca.ehZero()`: sobra em Pix e falta igual em dinheiro zeram o
   * total, e a clínica teria dois erros achando que não tem nenhum.
   */
  readonly conferido: boolean
}

const EH_FORMA = new Set<string>(FORMAS_DE_CONFERENCIA)

/**
 * Lança em vez de ignorar: somar o que não se declarou é como o dinheiro
 * some. Exceção e não `Result` porque a borda Zod já recusou qualquer forma
 * fora da lista — chegar aqui com uma é defeito de programação, da mesma
 * classe que `Dinheiro.ratear(0)`.
 */
function exigirForma(forma: string): Forma {
  if (forma === FORA_DA_CONFERENCIA) {
    throw new Error(`${FORA_DA_CONFERENCIA} não entra na conferência do caixa — ela não está na gaveta.`)
  }
  if (!EH_FORMA.has(forma)) {
    throw new Error(`A forma "${forma}" não existe na conferência do caixa.`)
  }
  return forma as Forma
}

/**
 * O esperado na gaveta, por forma, a partir dos recebimentos do dia.
 *
 * Devolve só as formas que tiveram movimento — quem completa as quatro é
 * `conferirCaixa`, que é quem sabe o que é uma conferência. A nota promissória
 * é descartada aqui, antes de qualquer soma.
 */
export function esperadoDoCaixa(
  recebimentos: readonly { readonly forma: string; readonly valor: Dinheiro }[],
): ReadonlyMap<Forma, Dinheiro> {
  const porForma = new Map<Forma, Dinheiro>()
  for (const r of recebimentos) {
    if (r.forma === FORA_DA_CONFERENCIA) continue
    const forma = exigirForma(r.forma)
    porForma.set(forma, (porForma.get(forma) ?? Dinheiro.zero()).mais(r.valor))
  }
  return porForma
}

/**
 * Compara o que o servidor esperava com o que a pessoa contou.
 *
 * As quatro linhas saem sempre: a gaveta com zero em dinheiro é uma
 * informação; uma linha ausente não é — é um buraco que a tela preenche
 * sozinha e ninguém confere.
 */
export function conferirCaixa(
  esperado: ReadonlyMap<Forma, Dinheiro>,
  contado: ReadonlyMap<Forma, Dinheiro>,
): Conferencia {
  for (const forma of contado.keys()) exigirForma(forma)

  const linhas: LinhaDeCaixa[] = FORMAS_DE_CONFERENCIA.map((forma) => {
    const e = esperado.get(forma) ?? Dinheiro.zero()
    const ct = contado.get(forma) ?? Dinheiro.zero()
    return { forma, esperado: e, contado: ct, diferenca: ct.menos(e) }
  })

  return {
    linhas,
    diferenca: linhas.reduce((s, l) => s.mais(l.diferenca), Dinheiro.zero()),
    conferido: linhas.every((l) => l.diferenca.ehZero()),
  }
}

/**
 * Uma forma da gaveta e o quanto ela mudou DEPOIS do fechamento.
 *
 * `valor = vivo − guardado`, com sinal: positivo é recebimento que entrou no
 * dia depois de fechado; negativo é estorno ou exclusão. O nome é `valor` de
 * propósito — é monetário, e a redação central o apaga para quem não tem
 * `valores`. Nunca `diferenca`: aquela é `contado − esperado`, outra pergunta.
 */
export type AlteracaoDepoisDoFechamento = {
  readonly forma: Forma
  readonly valor: Dinheiro
}

/**
 * O que mudou num dia FECHADO, por forma — as quatro, sempre.
 *
 * `guardado` é o esperado gravado no fechamento (nunca recalculado: é o
 * registro do que foi conferido). `vivo` é `esperadoDoCaixa` dos recebimentos
 * vivos de hoje — a MESMA função do fechamento, para que "mudou" nunca seja
 * uma diferença entre duas maneiras de somar.
 */
export function alteracoesDepoisDoFechamento(
  guardado: ReadonlyMap<Forma, Dinheiro>,
  vivo: ReadonlyMap<Forma, Dinheiro>,
): readonly AlteracaoDepoisDoFechamento[] {
  for (const forma of guardado.keys()) exigirForma(forma)
  for (const forma of vivo.keys()) exigirForma(forma)
  return FORMAS_DE_CONFERENCIA.map((forma) => ({
    forma,
    valor: (vivo.get(forma) ?? Dinheiro.zero()).menos(guardado.get(forma) ?? Dinheiro.zero()),
  }))
}

/**
 * A marca "alterado depois do fechamento".
 *
 * Acende pela diferença **ou** pelo evento: um estorno de 100 seguido de um
 * novo recebimento de 100 zera a diferença, e o dia mudou do mesmo jeito — a
 * conferência daquele dia já não descreve o que está registrado.
 */
export function mudouDepoisDoFechamento(
  alteracoes: readonly AlteracaoDepoisDoFechamento[],
  houveEventoPosterior: boolean,
): boolean {
  return houveEventoPosterior || alteracoes.some((a) => !a.valor.ehZero())
}

/**
 * Os avisos que um recebimento novo precisa confirmar antes de ser gravado
 * (D-21). Os códigos são estáveis: a tela casa o código e escreve o texto.
 */
export const AVISOS_DE_RECEBIMENTO = ['CAIXA_FECHADO', 'POSSIVEL_DUPLICIDADE'] as const
export type AvisoDeRecebimento = (typeof AVISOS_DE_RECEBIMENTO)[number]

/**
 * Decide o que avisar — os FATOS vêm do banco, a regra mora aqui.
 *
 *  - `CAIXA_FECHADO` só para o que vai à gaveta: nota promissória e valor zero
 *    (a venda a prazo) não mudam conferência nenhuma, e avisar sobre eles
 *    ensinaria a recepção a confirmar sem ler.
 *  - `POSSIVEL_DUPLICIDADE` ignora a forma (o mesmo dinheiro lançado em Pix e
 *    em Dinheiro continua sendo o mesmo dinheiro) e nunca vale para zero.
 *
 * É só aviso: quem garante a regra 3 é o índice único por tarefa.
 */
export function avisosDoRecebimento(x: {
  readonly forma: string
  readonly valor: Dinheiro
  readonly caixaFechado: boolean
  readonly haRecebimentoIgual: boolean
  readonly confirmarCaixaFechado: boolean
  readonly confirmarDuplicidade: boolean
}): readonly AvisoDeRecebimento[] {
  const temDinheiro = x.valor.centavos > 0n
  const avisos: AvisoDeRecebimento[] = []
  if (temDinheiro && x.forma !== FORA_DA_CONFERENCIA && x.caixaFechado && !x.confirmarCaixaFechado) {
    avisos.push('CAIXA_FECHADO')
  }
  if (temDinheiro && x.haRecebimentoIgual && !x.confirmarDuplicidade) {
    avisos.push('POSSIVEL_DUPLICIDADE')
  }
  return avisos
}
