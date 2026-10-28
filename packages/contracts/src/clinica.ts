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
