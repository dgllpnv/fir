import { percentualInteiro } from './financeiro/visao-do-mes'

/**
 * **AS METAS DO MÊS DE UMA PESSOA — a tabela dos indicadores e a aritmética.**
 *
 * Puro: nada aqui lê banco, relógio nem HTTP. As CONTAGENS que alimentam os
 * oito indicadores automáticos são consultas, e moram em
 * `apps/api/src/pessoas/indicadores.service.ts`; o que mora aqui é **o que
 * cada indicador é** e **como o percentual se calcula** — as duas coisas que
 * precisam existir uma vez só.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOIS DOS OITO SÃO PERCENTUAIS, E NÃO SOMAS
 *
 * `tarefas_prazo` e `contagens_prazo` são razões, e é neles que um número
 * divergente aparece na migração: uma soma errada por um erra por um, uma
 * RAZÃO errada por um no denominador erra o número inteiro. Os dois passam por
 * `percentualNoPrazo`, que recusa denominador maior que o numerador em vez de
 * devolver 150% — porque 150% de tarefas no prazo não é um dado, é um `FILTER`
 * mais largo que o `WHERE`, e dentro de uma barra ele passa despercebido.
 *
 * **Lista vazia é `null`, nunca `0`.** É o `pct` dela
 * (`lista.length ? … : null`), e a diferença importa: `0%` acusa alguém que
 * deixou tudo atrasar, e `—` diz que não havia nada no mês. Quem troca os dois
 * cria a primeira conversa 1:1 que começa com uma acusação falsa.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type TipoDeIndicador = 'qtd' | 'valor' | 'pct'

export type InfoDoIndicador = {
  readonly chave: string
  /** O nome que a equipe lê. É o dela, palavra por palavra. */
  readonly nome: string
  readonly tipo: TipoDeIndicador
}

/**
 * `IND_PES`, portado na ORDEM em que ela o escreveu — é a ordem da lista de
 * escolha na tela, e ela não é alfabética: é a ordem do funil (agendou,
 * confirmou, contatou, fechou) e depois os dois percentuais de disciplina.
 *
 * `manual` fica por último porque é o "nenhum dos acima".
 */
const TABELA = [
  { chave: 'agendamentos', nome: 'Agendamentos feitos', tipo: 'qtd' },
  { chave: 'confirmacoes', nome: 'Confirmações feitas', tipo: 'qtd' },
  { chave: 'contatos', nome: 'Contatos com pacientes', tipo: 'qtd' },
  { chave: 'orc_qtd', nome: 'Orçamentos fechados (quantidade)', tipo: 'qtd' },
  { chave: 'orc_valor', nome: 'Orçamentos fechados (valor)', tipo: 'valor' },
  { chave: 'recebimentos', nome: 'Recebimentos registrados', tipo: 'qtd' },
  { chave: 'tarefas_prazo', nome: 'Tarefas concluídas no prazo', tipo: 'pct' },
  { chave: 'contagens_prazo', nome: 'Contagens de estoque no prazo', tipo: 'pct' },
  { chave: 'manual', nome: 'Outra meta (lançamento manual)', tipo: 'qtd' },
] as const satisfies readonly InfoDoIndicador[]

/** A união dos nove nomes — nunca `string`. */
export type IndicadorDeMeta = (typeof TABELA)[number]['chave']

/**
 * Exportado com o tipo largo, pela mesma razão de `TIPOS` em
 * `tipos-de-tarefa.ts`: com o tipo literal, `INDICADORES.filter(i => i.tipo
 * === 'pct')` estreita cada elemento nos literais que ele de fato escreveu, e
 * percorrer a tabela deixa de compilar.
 */
/**
 * **Sem anotação de tipo, de propósito.** Anotar como `readonly
 * InfoDoIndicador[]` alarga `chave` de volta para `string`, e aí percorrer a
 * lista para chamar `tipoDoIndicador(i.chave)` deixa de compilar — que é o
 * teste "cobre a tabela inteira, sem padrão silencioso". Anotar com o tipo
 * estreito seria circular: ele é derivado desta mesma tabela.
 */
export const INDICADORES = TABELA

/** A meta cujo resultado o GESTOR lança — as outras oito a ferramenta conta. */
export const INDICADOR_MANUAL: IndicadorDeMeta = 'manual'

/**
 * Os OITO automáticos. Derivado da tabela, nunca escrito à mão: uma segunda
 * lista é como um indicador novo nasce sem contagem e aparece como `—` para
 * sempre, sem erro nenhum.
 */
export const INDICADORES_AUTOMATICOS: readonly IndicadorDeMeta[] = TABELA.filter(
  (i) => i.chave !== INDICADOR_MANUAL,
).map((i) => i.chave)

const POR_CHAVE = new Map<string, InfoDoIndicador>(TABELA.map((i) => [i.chave, i]))

/**
 * Chave desconhecida é `false`, e quem pergunta decide o que fazer.
 *
 * Diferente de `infoDoTipo`, que tem fallback ruidoso: tipo de tarefa chega do
 * dado migrado das 4 clínicas e precisa continuar legível. Indicador é
 * **escolha de uma lista** — um valor fora dela é corpo malformado, e o lugar
 * de recusá-lo é a borda (Zod), com 400.
 */
export const ehIndicador = (chave: string): chave is IndicadorDeMeta => POR_CHAVE.has(chave)

export const tipoDoIndicador = (chave: IndicadorDeMeta): TipoDeIndicador =>
  POR_CHAVE.get(chave)!.tipo

export const nomeDoIndicador = (chave: IndicadorDeMeta): string => POR_CHAVE.get(chave)!.nome

/** `valor` é o único de DINHEIRO, e é o que a regra 17 redige. */
export const indicadorEhDeDinheiro = (chave: IndicadorDeMeta): boolean =>
  tipoDoIndicador(chave) === 'valor'

/** Quantas metas uma pessoa pode ter num mês. Mais que isso não é meta. */
export const MAX_METAS_POR_PESSOA_NO_MES = 12

// ---------------------------------------------------------------------------
// OS PERCENTUAIS
// ---------------------------------------------------------------------------

/**
 * O `pct` dela: **percentual inteiro de "no prazo", ou `null` sem denominador.**
 *
 * `tarefas_prazo` e `contagens_prazo` são os dois únicos indicadores que não
 * somam nada — eles dividem. As três decisões, cada uma com teste:
 *
 *  1. **`total === 0` é `null`.** Ver o cabeçalho: `0%` é uma acusação.
 *  2. **Arredonda para o inteiro mais próximo, meio para cima**, por
 *     `percentualInteiro` — a mesma função da meta de faturamento, em
 *     aritmética exata de `bigint`. `Math.round(a/b*100)` é a assinatura do
 *     protótipo, e manter duas é como uma delas passa a arredondar diferente.
 *  3. **`noPrazo > total` LANÇA.** Não é dado possível: é consulta errada (um
 *     `FILTER` mais largo que o `WHERE`). Devolver 150% esconderia o defeito
 *     dentro de uma barra de progresso, que é o lugar onde ninguém olha duas
 *     vezes.
 */
export function percentualNoPrazo(total: number, noPrazo: number): number | null {
  if (!Number.isInteger(total) || !Number.isInteger(noPrazo)) {
    throw new Error(`percentualNoPrazo: contagem precisa ser inteira (${total}, ${noPrazo})`)
  }
  if (total < 0 || noPrazo < 0) {
    throw new Error(`percentualNoPrazo: contagem negativa (${total}, ${noPrazo})`)
  }
  if (noPrazo > total) {
    throw new Error(`percentualNoPrazo: ${noPrazo} no prazo de ${total} — consulta errada`)
  }
  if (total === 0) return null
  return percentualInteiro(BigInt(noPrazo), BigInt(total))
}

/**
 * Quanto da meta foi atingido, em percentual inteiro. **Pode passar de 100.**
 *
 * `realizado === null` é "sem dado" e devolve `null`; meta zero ou negativa
 * também — uma meta de zero não tem percentual, e um `0%` na barra diria
 * "nada atingido" para quem não definiu meta nenhuma.
 *
 * `bigint` nas duas pontas porque a MESMA função serve `orc_valor` (centavos,
 * regra 1) e `agendamentos` (unidades). Uma versão em `number` para a
 * quantidade e outra em `bigint` para o dinheiro seriam duas implementações da
 * mesma regra, e a de `number` é a que erra em centavos grandes.
 */
export function atingimentoDaMeta(realizado: bigint | null, meta: bigint): number | null {
  if (realizado === null) return null
  return percentualInteiro(realizado, meta)
}

/**
 * A média de atingimento da pessoa no mês — o "média de atingimento N%" dela.
 *
 * **Cada meta é clampada em 100 ANTES de entrar na média**, e esse `Math.min`
 * é a regra inteira: sem ele, 200% numa meta compensa 0% em outra, e a 1:1
 * abre com "meta cumprida" para quem falhou metade do mês. Metas sem dado
 * ficam de fora do numerador E do denominador; nenhuma com dado devolve
 * `null`.
 *
 * A soma é de inteiros e a divisão é meio para cima, sem ponto flutuante.
 */
export function mediaDeAtingimento(percentuais: readonly (number | null)[]): number | null {
  const comDado = percentuais.filter((p): p is number => p !== null).map((p) => Math.min(100, p))
  if (comDado.length === 0) return null
  const soma = comDado.reduce((s, p) => s + p, 0)
  return Math.floor((2 * soma + comDado.length) / (2 * comDado.length))
}
