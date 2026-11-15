import { FORMAS_DE_CONFERENCIA } from '@fir/domain'
import { z } from 'zod'
import { centavosNaSaida, DiaCivil, dinheiroEmTexto, Mes, Uuid } from './comum'
import { BooleanoDeConsulta } from './tarefas'

/**
 * **OUTRAS ENTRADAS** (fatia 4.2): dinheiro que entrou e NÃO é de paciente —
 * aluguel de sala, reembolso, venda avulsa. `CONTEXT.md`: `Outra entrada` e
 * `Categoria de entrada`.
 *
 * Fora de recebido, LTV, ticket, campanhas, saldo, funil, indicadores,
 * conferência de migração e meta. Dentro do esperado do caixa por forma, da
 * Visão do mês e do painel, numa linha própria.
 *
 * Permissões (decididas no gate, sem chave nova): lançar e estornar =
 * `receber`; ver valor = `valores`; categorias = `contas.gerir`.
 */

/** Centavos positivos. Zero e `null` não são entrada. */
const valorDaEntrada = dinheiroEmTexto.refine((v): v is bigint => v !== null && v > 0n, {
  message: 'informe um valor maior que zero',
})

/**
 * O aviso fixo que a tela exibe junto do campo (LGPD L3). O texto é livre e
 * pode conter dado pessoal digitado pela equipe: nunca em log.
 */
export const AVISO_DA_DESCRICAO_DE_ENTRADA = 'Não escreva nome de paciente nem dado de saúde.'

/** Os limites do contrato — a tela os lê daqui, não os repete. */
export const LIMITES_DE_OUTRA_ENTRADA = {
  nomeDeCategoria: { min: 2, max: 60 },
  descricao: { max: 120 },
} as const

export const NomeDeCategoriaDeEntrada = z
  .string()
  .trim()
  .min(LIMITES_DE_OUTRA_ENTRADA.nomeDeCategoria.min, 'o nome precisa de ao menos 2 caracteres')
  .max(LIMITES_DE_OUTRA_ENTRADA.nomeDeCategoria.max)

export const CriarCategoriaDeEntrada = z.object({ nome: NomeDeCategoriaDeEntrada }).strict()
export type CriarCategoriaDeEntrada = z.infer<typeof CriarCategoriaDeEntrada>

/** Renomear e/ou (des)ativar. Desativar é estado, nunca exclusão (regra 20). */
export const EditarCategoriaDeEntrada = z
  .object({ nome: NomeDeCategoriaDeEntrada.optional(), ativa: z.boolean().optional() })
  .strict()
  .refine((d) => d.nome !== undefined || d.ativa !== undefined, {
    message: 'informe o nome ou o estado da categoria',
  })
export type EditarCategoriaDeEntrada = z.infer<typeof EditarCategoriaDeEntrada>

export const CategoriaDeEntradaNaLista = z.object({
  id: Uuid,
  nome: z.string(),
  ativa: z.boolean(),
})
export type CategoriaDeEntradaNaLista = z.infer<typeof CategoriaDeEntradaNaLista>

export const ListaDeCategoriasDeEntrada = z
  .object({ itens: z.array(CategoriaDeEntradaNaLista) })
  .strict()
export type ListaDeCategoriasDeEntrada = z.infer<typeof ListaDeCategoriasDeEntrada>

/**
 * Lançar uma outra entrada.
 *
 *  - `requisicaoId` é gerado ao ABRIR o formulário (como o recebimento): o
 *    reenvio devolve a mesma linha e o duplo toque não dobra o caixa.
 *  - `em` é o dia civil NO FUSO DA CLÍNICA; o servidor recusa o futuro e
 *    escolhe o instante (regra 24). Nunca o relógio do cliente.
 *  - `forma` só entre as quatro da gaveta: promissória é recusada.
 *  - `confirmarCaixaFechado`: quando o dia já tem caixa fechado, a rota
 *    responde 409 de confirmação (a mesma `ConfirmacaoNecessaria` do
 *    recebimento) e só grava com `true`.
 */
export const LancarOutraEntrada = z
  .object({
    requisicaoId: Uuid,
    categoriaId: Uuid,
    em: DiaCivil,
    valor: valorDaEntrada,
    forma: z.enum(FORMAS_DE_CONFERENCIA),
    descricao: z.string().trim().max(LIMITES_DE_OUTRA_ENTRADA.descricao.max).default(''),
    confirmarCaixaFechado: z.literal(true).optional(),
  })
  .strict()
export type LancarOutraEntrada = z.infer<typeof LancarOutraEntrada>

export const OutraEntradaNaLista = z.object({
  id: Uuid,
  categoriaId: Uuid,
  categoria: z.string(),
  /** Dia civil no fuso da clínica. */
  em: DiaCivil,
  valor: centavosNaSaida,
  forma: z.enum(FORMAS_DE_CONFERENCIA),
  descricao: z.string(),
  registradoPor: z.string(),
  estornada: z.boolean(),
})
export type OutraEntradaNaLista = z.infer<typeof OutraEntradaNaLista>

/** Um dia (`dia`) ou um mês (`mes`); sem filtro, é HOJE no fuso da clínica. */
export const ConsultaDeOutrasEntradas = z
  .object({
    dia: DiaCivil.optional(),
    mes: Mes.optional(),
    // `z.coerce.boolean()` faria "false" virar true (string não vazia).
    incluirEstornadas: BooleanoDeConsulta.optional(),
  })
  .strict()
  .refine((q) => q.dia === undefined || q.mes === undefined, {
    message: 'escolha `dia` ou `mes`, não os dois',
  })
export type ConsultaDeOutrasEntradas = z.infer<typeof ConsultaDeOutrasEntradas>

export const ListaDeOutrasEntradas = z.object({ itens: z.array(OutraEntradaNaLista) }).strict()
export type ListaDeOutrasEntradas = z.infer<typeof ListaDeOutrasEntradas>
