import { z } from 'zod'
import { DiaCivil, Uuid } from './comum'

/**
 * A clínica aberta, mais o DIA DE NEGÓCIO dela.
 *
 * `hoje` existe aqui por causa da regra 24: a data de negócio vem do servidor,
 * nunca do relógio do cliente. "Nova tarefa" precisa dela antes de qualquer
 * lista — é o valor padrão do campo Data e o teto do lançamento retroativo —, e
 * sem esta rota a tela teria de pedir uma página de tarefas só para ler o
 * `hoje` que vem junto. A recepção que abre a ferramenta às 23h55 e vê o
 * formulário virar o dia antes da clínica é a confusão que isto evita.
 *
 * `fuso` acompanha porque ele é propriedade da CLÍNICA (regra 22) e a tela
 * precisa dele para rotular instante em UTC.
 */
export const ClinicaAtual = z.object({
  id: Uuid,
  codigo: z.string(),
  nome: z.string(),
  fuso: z.string(),
  hoje: DiaCivil,
})
export type ClinicaAtual = z.infer<typeof ClinicaAtual>

/**
 * As duas listas que TODA tela de rotina precisa: quem trabalha aqui e onde.
 *
 * Elas não estavam no plano do épico 2, e sem elas a tela "Nova tarefa" não
 * existe — não há como escolher o responsável, que é um dos cinco campos do
 * caminho principal. O mesmo vale para o filtro por unidade da tela Tarefas.
 *
 * O que sai aqui é deliberadamente MAGRO: nome, função e o estado de ativo.
 * Nada de usuário, nada de perfil, nada de salário. O nome de quem trabalha na
 * clínica já aparece em todo cartão de tarefa; o resto é do épico 7 e da tela
 * de Usuários, que têm permissão própria.
 */
export const PessoaDaEquipe = z.object({
  id: Uuid,
  nome: z.string(),
  funcao: z.string(),
  /** Pessoa que saiu não recebe tarefa nova, mas continua nomeada nas antigas. */
  ativo: z.boolean(),
})
export type PessoaDaEquipe = z.infer<typeof PessoaDaEquipe>

export const ListaDaEquipe = z.object({ equipe: z.array(PessoaDaEquipe) })
export type ListaDaEquipe = z.infer<typeof ListaDaEquipe>

export const UnidadeNaLista = z.object({
  id: Uuid,
  nome: z.string(),
  endereco: z.string(),
  ativa: z.boolean(),
})
export type UnidadeNaLista = z.infer<typeof UnidadeNaLista>

export const ListaDeUnidades = z.object({ unidades: z.array(UnidadeNaLista) })
export type ListaDeUnidades = z.infer<typeof ListaDeUnidades>

/**
 * Salvar unidade — o `salvarUnidade` da PO, que é a última linha ⬜ do épico 2.
 *
 * `ativa` e não `ativo`: é o nome da coluna da `0006` e o do `UnidadeNaLista`
 * acima. Divergir aqui faria a tela mandar um campo que o servidor ignora.
 *
 * O nome é único por clínica **pelo nome NORMALIZADO** (índice
 * `unidades_nome_unico` sobre `normalizar_nome(nome)`), não por este contrato:
 * ler-depois-escrever perde a corrida entre duas abas, e aí a recepção fica
 * com duas "Unidade Pituba" e metade do caixa em cada.
 */
export const SalvarUnidade = z
  .object({
    nome: z.string().trim().min(1, 'Dê um nome à unidade.').max(80),
    endereco: z.string().trim().max(160).default(''),
    ativa: z.boolean().default(true),
  })
  .strict()
export type SalvarUnidade = z.infer<typeof SalvarUnidade>

/**
 * A edição é PARCIAL, pela mesma razão do `EditarProcedimento`: um
 * `PATCH { ativa: false }` com o esquema de criação apagaria o endereço, sem
 * erro nenhum, e a clínica descobriria ao imprimir a lista de contagem.
 */
export const EditarUnidade = SalvarUnidade.partial()
export type EditarUnidade = z.infer<typeof EditarUnidade>
