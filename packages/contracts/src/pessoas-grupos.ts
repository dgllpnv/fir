import { z } from 'zod'
import { Uuid } from './comum'

/**
 * **Grupos de colaboradores** (ADR 2026-11-14) — lista nomeada de pessoas da
 * clínica, para onde uma tarefa pode ir. NÃO é grupo de acesso.
 *
 * Os limites moram aqui e a tela os lê: o contrato manda (a divergência
 * tela × contrato já custou caro no formulário de orçamento).
 *
 * `grupos` já é tabela da carteira (conjunto de clínicas); por isso todo nome
 * daqui tem `DaEquipe`.
 */
export const NOME_DO_GRUPO_MINIMO = 2
export const NOME_DO_GRUPO_MAXIMO = 60
/** Grupos por clínica (ativos e desativados). Teto contra lixo, não regra de negócio. */
export const MAXIMO_DE_GRUPOS_POR_CLINICA = 40
/** Grupos em que UMA pessoa pode estar. */
export const MAXIMO_DE_GRUPOS_POR_PESSOA = 20
/** Membros de UM grupo: a equipe inteira de uma clínica grande. */
export const MAXIMO_DE_MEMBROS_POR_GRUPO = 200

const NomeDoGrupo = z
  .string()
  .trim()
  .min(NOME_DO_GRUPO_MINIMO, 'O nome do grupo precisa de pelo menos 2 letras.')
  .max(NOME_DO_GRUPO_MAXIMO)

export const CriarGrupoDaEquipe = z.object({ nome: NomeDoGrupo }).strict()
export type CriarGrupoDaEquipe = z.infer<typeof CriarGrupoDaEquipe>

/**
 * Renomear e/ou desativar/reativar. Nunca excluir (regra 20).
 *
 * Desativar um grupo com tarefas abertas responde 409 com
 * `CODIGO_GRUPO_COM_TAREFAS_ABERTAS` e a contagem; a tela pergunta e reenvia o
 * mesmo corpo com `confirmar: true`. `z.literal(true)`: `false` não é confirmação.
 */
export const EditarGrupoDaEquipe = z
  .object({
    nome: NomeDoGrupo.optional(),
    ativo: z.boolean().optional(),
    confirmar: z.literal(true).optional(),
  })
  .strict()
  .refine((d) => d.nome !== undefined || d.ativo !== undefined, {
    message: 'Nada para alterar.',
  })
export type EditarGrupoDaEquipe = z.infer<typeof EditarGrupoDaEquipe>

export const CODIGO_GRUPO_COM_TAREFAS_ABERTAS = 'GRUPO_COM_TAREFAS_ABERTAS'

/** O 409 de desativar. Só a contagem: nenhum nome, nenhuma descrição de tarefa. */
export const GrupoComTarefasAbertas = z
  .object({
    statusCode: z.literal(409),
    codigo: z.literal(CODIGO_GRUPO_COM_TAREFAS_ABERTAS),
    tarefasAbertas: z.number().int().positive(),
    message: z.string(),
  })
  .strict()
export type GrupoComTarefasAbertas = z.infer<typeof GrupoComTarefasAbertas>

/** `PUT v1/pessoas/:id/grupos` — o CONJUNTO de grupos da pessoa (substitui). */
export const DefinirGruposDaPessoa = z
  .object({
    grupoIds: z
      .array(Uuid)
      .max(MAXIMO_DE_GRUPOS_POR_PESSOA)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'Grupo repetido.' }),
  })
  .strict()
export type DefinirGruposDaPessoa = z.infer<typeof DefinirGruposDaPessoa>

/**
 * O grupo como TODOS o leem: id, nome, ativo. É o que o seletor de destino de
 * tarefa precisa, e o nome de um grupo não é dado pessoal.
 */
export const GrupoDaEquipeNaLista = z.object({ id: Uuid, nome: z.string(), ativo: z.boolean() })
export type GrupoDaEquipeNaLista = z.infer<typeof GrupoDaEquipeNaLista>

/**
 * O grupo como a ADMINISTRAÇÃO (`config`) o lê: com a **composição** e a carga.
 * Composição é dado de RH (L5) — nunca sai desta forma para quem não tem `config`.
 */
export const GrupoDaEquipeParaAdministrar = GrupoDaEquipeNaLista.extend({
  membroIds: z.array(Uuid),
  tarefasAbertas: z.number().int(),
})
export type GrupoDaEquipeParaAdministrar = z.infer<typeof GrupoDaEquipeParaAdministrar>

export const GruposDaEquipe = z.object({ grupos: z.array(GrupoDaEquipeNaLista) })
export type GruposDaEquipe = z.infer<typeof GruposDaEquipe>

export const GruposDaEquipeParaAdministrar = z.object({
  grupos: z.array(GrupoDaEquipeParaAdministrar),
})
export type GruposDaEquipeParaAdministrar = z.infer<typeof GruposDaEquipeParaAdministrar>

/** `GET v1/grupos/meus` — só os ids dos MEUS grupos ativos (para o botão "Assumir"). */
export const MeusGrupos = z.object({ grupoIds: z.array(Uuid) })
export type MeusGrupos = z.infer<typeof MeusGrupos>
