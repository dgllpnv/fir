import type { Autor } from '@fir/domain'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * OS GRUPOS DE QUEM ESTÁ AGINDO — lidos do banco, na transação da requisição.
 *
 * Nunca do cliente, nunca da sessão, nunca copiados na tarefa (ADR
 * 2026-11-14, decisão 4): quem sai do grupo, ou é desativado, deixa de valer na
 * requisição seguinte. Só grupo ATIVO de pessoa ATIVA conta — é o que faz
 * "pessoa desativada perde o grupo na hora" e "grupo desativado não dá acesso
 * a ninguém" serem a mesma consulta.
 */
export async function gruposDoAutor(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  pessoaId: string,
): Promise<string[]> {
  // Sessão de suporte (`''`): não é pessoa, não tem grupo. Sem esta guarda o
  // literal vazio estouraria o cast para uuid (500) em vez de lista vazia.
  if (pessoaId === '') return []
  const r = await c.query<{ grupo_id: string }>(
    `SELECT mg.grupo_id
       FROM membros_de_grupo mg
       JOIN grupos_da_equipe g ON g.id = mg.grupo_id AND g.clinica_id = mg.clinica_id
       JOIN pessoas p ON p.id = mg.pessoa_id AND p.clinica_id = mg.clinica_id
      WHERE mg.clinica_id = $1 AND mg.pessoa_id = $2
        AND mg.removido_em IS NULL AND g.ativo AND p.ativo`,
    [clinicaId, pessoaId],
  )
  return r.rows.map((x) => x.grupo_id)
}

/** O autor com `grupoIds` carregado do banco. Falha fechado se ninguém chamar. */
export async function comGrupos<A extends Autor>(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  autor: A,
): Promise<A & { readonly grupoIds: readonly string[] }> {
  return { ...autor, grupoIds: await gruposDoAutor(c, clinicaId, autor.id) }
}

/**
 * A subconsulta dos grupos de uma pessoa, para as cláusulas de escopo das
 * listas (`Para mim`). `quem` é um placeholder `$n` já registrado; `t` é o alias
 * de `tarefas` do chamador.
 */
export const gruposDaPessoaSql = (quem: string): string =>
  `SELECT mg.grupo_id
     FROM membros_de_grupo mg
     JOIN grupos_da_equipe gm ON gm.id = mg.grupo_id AND gm.clinica_id = mg.clinica_id
     JOIN pessoas pm ON pm.id = mg.pessoa_id AND pm.clinica_id = mg.clinica_id
    WHERE mg.clinica_id = t.clinica_id AND mg.pessoa_id = ${quem}
      AND mg.removido_em IS NULL AND gm.ativo AND pm.ativo`
