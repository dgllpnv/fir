import { z } from 'zod'
import { Uuid } from './comum'

/**
 * As duas listas que TODA tela de rotina precisa: quem trabalha aqui e onde.
 *
 * Elas não estavam no plano do épico 2, e sem elas a tela "Nova tarefa" não
 * existe — não há como escolher o responsável, que é um dos cinco campos do
 * caminho principal. O mesmo vale para o filtro por unidade da tela Tarefas.
 *
 * O que sai aqui é deliberadamente MAGRO: nome, função e o estado de ativo.
 * Nada de e-mail, nada de perfil, nada de salário. O nome de quem trabalha na
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
