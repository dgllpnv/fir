import { somarMeses } from '../relogio'

export type TipoDeDespesa = 'fixa' | 'variavel'

export type CategoriaDeDespesa = {
  readonly nome: string
  readonly tipo: TipoDeDespesa
  /** O texto que a tela mostra embaixo do campo, para quem não sabe onde lançar. */
  readonly desc: string
}

/**
 * As dez categorias do MANUAL cap. 14, na ordem em que a tela as agrupa:
 * as quatro fixas, depois as seis variáveis, com `Outras despesas` fechando.
 *
 * Vivem aqui, em tabela, pelo mesmo motivo que `TIPOS` vive: espalhar
 * `if (categoria === 'Pessoal')` é como o legado passou a ter a mesma regra
 * em três lugares, e elas já divergiram.
 *
 * `Outras despesas` é o último de propósito — é o fallback da importação, e a
 * ordem é o que torna "o último" uma definição em vez de uma busca por nome.
 */
export const CATEGORIAS_DESP = [
  { nome: 'Pessoal', tipo: 'fixa', desc: 'Salários, encargos, pró-labore, benefícios' },
  { nome: 'Ocupação', tipo: 'fixa', desc: 'Aluguel, condomínio, energia, água, internet' },
  { nome: 'Sistemas e assinaturas', tipo: 'fixa', desc: 'Sistema da clínica, softwares, telefonia' },
  { nome: 'Serviços contratados', tipo: 'fixa', desc: 'Contabilidade, limpeza, assessoria' },
  { nome: 'Insumos e medicamentos', tipo: 'variavel', desc: 'Compras de estoque, materiais' },
  { nome: 'Marketing', tipo: 'variavel', desc: 'Anúncios, agência, materiais de divulgação' },
  { nome: 'Impostos e taxas', tipo: 'variavel', desc: 'Impostos, conselho, alvarás' },
  { nome: 'Taxas de cartão e bancárias', tipo: 'variavel', desc: 'Maquininha, tarifas, juros' },
  { nome: 'Manutenção e equipamentos', tipo: 'variavel', desc: 'Consertos, compra de equipamentos' },
  { nome: 'Outras despesas', tipo: 'variavel', desc: 'O que não se encaixa nas demais' },
] as const satisfies readonly CategoriaDeDespesa[]

export type NomeDeCategoria = (typeof CATEGORIAS_DESP)[number]['nome']

/**
 * As formas de **saída** — e elas não são as de entrada.
 *
 * Conta a pagar é Boleto, Transferência e Débito automático; recebimento é
 * Pix, os cartões e a promissória. Misturar as duas listas é o começo de uma
 * Visão do mês que soma maçã com laranja.
 */
export const FORMAS_DE_SAIDA = [
  'Pix',
  'Boleto',
  'Transferência',
  'Cartão de crédito',
  'Débito automático',
  'Dinheiro',
] as const

export type FormaDeSaida = (typeof FORMAS_DE_SAIDA)[number]

const porNome = new Map<string, CategoriaDeDespesa>(CATEGORIAS_DESP.map((c) => [c.nome, c]))

export const infoDaCategoria = (nome: string): CategoriaDeDespesa | undefined => porNome.get(nome)

export const ehCategoriaDeDespesa = (nome: string): nome is NomeDeCategoria => porNome.has(nome)

/**
 * O vencimento do mês seguinte de uma conta mensal, **com âncora**.
 *
 * `diaDaSerie` é o dia ORIGINAL em que a conta foi cadastrada (1–31), e é ele
 * que faz 31/12 → 31/01 → **28/02 → 31/03**. Sem a âncora — que é o que o
 * protótipo faz, com `addMeses(c.vencimento, 1)` — a conta cai para o dia 28
 * em fevereiro e **nunca mais volta**: medido. O MANUAL cap. 14 diz "repete
 * todo mês, no mesmo dia", e essa é a regra 25.
 *
 * A aritmética inteira já está em `somarMeses`; esta função existe para dar
 * nome de negócio ao terceiro argumento, e para recusar uma âncora impossível
 * — uma série mensal sem dia de vencimento não existe, e o banco cobra o mesmo
 * no `CONSTRAINT serie_tem_ancora`.
 */
export function proximoVencimento(vencimento: string, diaDaSerie: number): string {
  if (!Number.isInteger(diaDaSerie) || diaDaSerie < 1 || diaDaSerie > 31) {
    throw new Error(`Dia de vencimento da série precisa estar entre 1 e 31, recebeu ${diaDaSerie}.`)
  }
  return somarMeses(vencimento, 1, diaDaSerie)
}
