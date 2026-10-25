import { Dinheiro } from '../dinheiro'
import { somarDias } from '../relogio'
import { CATEGORIAS_DESP, infoDaCategoria, type TipoDeDespesa } from './contas'

/** O que foi pago no mês. `valor` já é o **valor pago**, não o da conta. */
export type DespesaPaga = { readonly categoria: string; readonly valor: Dinheiro }
export type RecebimentoDoMes = { readonly forma: string; readonly valor: Dinheiro }
export type ContaEmAberto = { readonly valor: Dinheiro; readonly vencida: boolean }
export type CaixaDoMes = { readonly diferenca: Dinheiro }

export type EntradaDaVisao = {
  readonly recebido: readonly RecebimentoDoMes[]
  /**
   * Só o total — é a única coisa que o mês anterior entrega aqui (a seta do
   * "vs. setembro"). `pagasMesAnterior` vem como LISTA porque a tela compara
   * **por categoria**, e um total não se parte de volta em categorias.
   */
  readonly recebidoMesAnterior: Dinheiro
  readonly pagas: readonly DespesaPaga[]
  readonly pagasMesAnterior: readonly DespesaPaga[]
  readonly aPagar: readonly ContaEmAberto[]
  /** Saldo a receber dos pacientes — soma dos `total` de `saldoEmAberto`. */
  readonly aReceber: Dinheiro
  readonly meta: Dinheiro | null
  readonly caixas: readonly CaixaDoMes[]
  readonly diasUteis: number
}

/**
 * A comparação com o mês anterior mora num objeto ANINHADO, e não em campos
 * `…MesAnterior` ao lado.
 *
 * `CAMPOS_MONETARIOS` é uma lista de nomes, e `valorMesAnterior`,
 * `recebidoMesAnterior` e `despesasPagasMesAnterior` seriam três nomes novos
 * que dizem a mesma coisa que três já registrados. Lista que cresce por
 * quase-duplicata é lista que apodrece — e o interceptor desce no objeto
 * aninhado sozinho, onde as chaves voltam a ser `valor`, `recebido` e
 * `despesasPagas`.
 */
export type LinhaDeCategoria = {
  readonly categoria: string
  readonly tipo: TipoDeDespesa
  readonly valor: Dinheiro
  readonly mesAnterior: { readonly valor: Dinheiro }
  /** Fatia desta categoria no total de despesas pagas. `null` se nada foi pago. */
  readonly percentual: number | null
}

export type LinhaDeForma = { readonly forma: string; readonly valor: Dinheiro }

export type ResumoDeCaixa = {
  readonly fechados: number
  readonly diasUteis: number
  readonly comDiferenca: number
  readonly diferenca: Dinheiro
}

export type VisaoDoMes = {
  readonly recebido: Dinheiro
  readonly quantidadeDeRecebimentos: number
  readonly porForma: readonly LinhaDeForma[]

  /** Ver a nota em `LinhaDeCategoria`: aninhado, e não `…MesAnterior` ao lado. */
  readonly mesAnterior: { readonly recebido: Dinheiro; readonly despesasPagas: Dinheiro }

  readonly despesasPagas: Dinheiro
  readonly quantidadeDePagas: number
  readonly porCategoria: readonly LinhaDeCategoria[]
  readonly fixas: Dinheiro
  readonly variaveis: Dinheiro
  readonly percentualFixas: number | null
  readonly percentualVariaveis: number | null

  /**
   * `recebido − despesasPagas`. Pode ser negativo.
   *
   * **Não se chama `resultado`**, e isso não é estilo. `CAMPOS_MONETARIOS` é
   * uma lista de NOMES, e o interceptor apaga toda chave com esses nomes em
   * qualquer profundidade de qualquer resposta. `TarefaNaFicha.resultado` já
   * existe e é o desfecho do atendimento — um texto ("Compareceu"). Registrar
   * `resultado` como monetário apagaria o desfecho de toda tarefa para quem
   * não tem `valores`, sem erro nenhum. Medido: foi o que a varredura
   * `teste/redacao-de-valores.test.ts` acusou.
   */
  readonly resultadoDoMes: Dinheiro
  readonly percentualDoResultado: number | null

  readonly aPagar: Dinheiro
  readonly quantidadeAPagar: number
  readonly quantidadeVencidas: number
  readonly aReceber: Dinheiro

  readonly meta: Dinheiro | null
  /** `meta − recebido`, limitado a zero: é o "faltam R$ X" da barra. */
  readonly metaRestante: Dinheiro | null
  readonly percentualDaMeta: number | null

  readonly caixa: ResumoDeCaixa
}

/** Divisão inteira com piso — `/` de `bigint` TRUNCA para zero, e isso quebra o negativo. */
function comPiso(a: bigint, b: bigint): bigint {
  const q = a / b
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q
}

/**
 * Percentual arredondado para o inteiro mais próximo, **sem passar por
 * `float`**.
 *
 * `Math.round(a / b * 100)` é a assinatura do protótipo. Ela está errada por
 * dois motivos: `a` e `b` são `bigint` de centavos e `Number(a)` perde
 * precisão acima de 2^53; e meio por cento a mais ou a menos muda o número que
 * a clínica lê na barra da meta.
 *
 * `(2·a·100 + b) / (2·b)`, com piso, é arredondamento para o mais próximo,
 * meio **para cima** — a mesma regra do `Math.round`, inclusive para
 * negativos (`Math.round(-66.5) === -66`), que é o caso do resultado do mês
 * quando a clínica fecha no vermelho.
 *
 * Denominador zero devolve `null`, não zero: meta zero não tem percentual, e
 * um `0` na barra diria "nada atingido" para quem não definiu meta nenhuma.
 *
 * O que esta função **não** garante: o retorno é `number`, então uma razão
 * que ultrapasse 2^53 por cento (recebido um quatrilhão de vezes a meta)
 * perde precisão na conversão final. É a única perda que sobra, e ela está
 * fora de qualquer faixa que dinheiro de clínica alcance.
 */
export function percentualInteiro(numerador: bigint, denominador: bigint): number | null {
  if (denominador <= 0n) return null
  return Number(comPiso(2n * numerador * 100n + denominador, 2n * denominador))
}

const soma = (xs: readonly { readonly valor: Dinheiro }[]): Dinheiro =>
  xs.reduce((s, x) => s.mais(x.valor), Dinheiro.zero())

/**
 * A categoria que o lançamento conta, com `Outras despesas` como rede.
 *
 * A coluna do banco é `text` — acrescentar uma categoria para uma clínica não
 * pode exigir migration —, então um nome fora da lista é possível. Descartá-lo
 * quebraria `fixas + variáveis === despesasPagas` em silêncio, que é o buraco
 * do `porCat` do protótipo: ele mapeia **sobre** `CATEGORIAS_DESP` e o que não
 * está lá some da tela sem sair do total. `Outras despesas` é o mesmo destino
 * que a importação do protótipo já dá (linha 1341).
 */
const ULTIMA = CATEGORIAS_DESP[CATEGORIAS_DESP.length - 1]!
const categoriaContada = (nome: string): string => (infoDaCategoria(nome) ? nome : ULTIMA.nome)

function totalPorCategoria(pagas: readonly DespesaPaga[]): Map<string, Dinheiro> {
  const m = new Map<string, Dinheiro>()
  for (const p of pagas) {
    const k = categoriaContada(p.categoria)
    m.set(k, (m.get(k) ?? Dinheiro.zero()).mais(p.valor))
  }
  return m
}

/**
 * Dias úteis (segunda a sexta) do dia 1 do mês até `hoje`, inclusive.
 *
 * Mora no domínio, e não numa consulta, porque é a referência que a clínica usa
 * para ler a meta ("18 dias úteis passados") — e um laço de data escrito dentro
 * de um serviço é um laço de data que a segunda tela reescreve diferente.
 * Feriado não entra: o protótipo também não os conhece, e inventá-los aqui
 * exigiria um calendário por município que o produto não tem.
 */
export function diasUteisAte(mes: string, hoje: string): number {
  let n = 0
  let d = `${mes}-01`
  while (d.slice(0, 7) === mes && d <= hoje) {
    const dia = new Date(`${d}T00:00:00Z`).getUTCDay()
    if (dia >= 1 && dia <= 5) n++
    d = somarDias(d, 1)
  }
  return n
}

/**
 * A agregação inteira do mês, pura, sobre listas **já filtradas pela janela**
 * pelo repositório. O front não soma nada (`docs/design.md` §5).
 *
 * Não há divisão de valor aqui: nenhum número é repartido em parcelas, então
 * `Dinheiro.ratear` não é usado, e a propriedade `max − min <= 1` não tem
 * onde se aplicar. As propriedades que valem são as de **fechamento de
 * totais** — e são elas que pegam o erro real deste módulo, que é uma
 * categoria sumir da soma.
 */
export function visaoDoMes(entrada: EntradaDaVisao): VisaoDoMes {
  const recebido = soma(entrada.recebido)
  const despesasPagas = soma(entrada.pagas)

  const porFormaMapa = new Map<string, Dinheiro>()
  for (const r of entrada.recebido) {
    porFormaMapa.set(r.forma, (porFormaMapa.get(r.forma) ?? Dinheiro.zero()).mais(r.valor))
  }
  const porForma: LinhaDeForma[] = [...porFormaMapa]
    .map(([forma, valor]) => ({ forma, valor }))
    .sort((a, b) => (b.valor.centavos > a.valor.centavos ? 1 : b.valor.centavos < a.valor.centavos ? -1 : a.forma.localeCompare(b.forma)))

  const doMes = totalPorCategoria(entrada.pagas)
  const doAnterior = totalPorCategoria(entrada.pagasMesAnterior)

  // Na ordem da tabela — fixas antes das variáveis —, e só as que tiveram
  // movimento num dos dois meses: a tela compara, e uma linha de dois zeros
  // não compara nada.
  const porCategoria: LinhaDeCategoria[] = CATEGORIAS_DESP.map((cat) => ({
    categoria: cat.nome,
    tipo: cat.tipo,
    valor: doMes.get(cat.nome) ?? Dinheiro.zero(),
    mesAnterior: { valor: doAnterior.get(cat.nome) ?? Dinheiro.zero() },
    percentual: percentualInteiro(
      (doMes.get(cat.nome) ?? Dinheiro.zero()).centavos,
      despesasPagas.centavos,
    ),
  })).filter((x) => !x.valor.ehZero() || !x.mesAnterior.valor.ehZero())

  // Somadas sobre a MESMA lista de categorias que a tela mostra, nunca sobre
  // `entrada.pagas` de novo: duas somas da mesma coisa são duas somas que um
  // dia discordam.
  const fixas = soma(porCategoria.filter((x) => x.tipo === 'fixa'))
  const variaveis = soma(porCategoria.filter((x) => x.tipo === 'variavel'))

  const resultado = recebido.menos(despesasPagas)
  const restante = entrada.meta?.menos(recebido) ?? null

  const comDiferenca = entrada.caixas.filter((c) => !c.diferenca.ehZero()).length

  return {
    recebido,
    quantidadeDeRecebimentos: entrada.recebido.length,
    porForma,

    mesAnterior: {
      recebido: entrada.recebidoMesAnterior,
      despesasPagas: soma(entrada.pagasMesAnterior),
    },

    despesasPagas,
    quantidadeDePagas: entrada.pagas.length,
    porCategoria,
    fixas,
    variaveis,
    percentualFixas: percentualInteiro(fixas.centavos, despesasPagas.centavos),
    percentualVariaveis: percentualInteiro(variaveis.centavos, despesasPagas.centavos),

    resultadoDoMes: resultado,
    percentualDoResultado: percentualInteiro(resultado.centavos, recebido.centavos),

    aPagar: soma(entrada.aPagar),
    quantidadeAPagar: entrada.aPagar.length,
    quantidadeVencidas: entrada.aPagar.filter((x) => x.vencida).length,
    aReceber: entrada.aReceber,

    meta: entrada.meta,
    metaRestante: restante === null ? null : restante.ehNegativo() ? Dinheiro.zero() : restante,
    percentualDaMeta: entrada.meta === null ? null : percentualInteiro(recebido.centavos, entrada.meta.centavos),

    caixa: {
      fechados: entrada.caixas.length,
      diasUteis: entrada.diasUteis,
      comDiferenca,
      diferenca: entrada.caixas.reduce((s, c) => s.mais(c.diferenca), Dinheiro.zero()),
    },
  }
}
