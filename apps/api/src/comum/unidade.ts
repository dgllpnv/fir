import type pg from 'pg'

/**
 * A unidade existe NESTA clínica? Senão, vira `null` — em silêncio.
 *
 * Isto não é zelo: a chave estrangeira `unidade_id -> unidades(id)` é
 * verificada pelo sistema e **atravessa a RLS**. Sem esta consulta, um POST
 * com o id de uma unidade da clínica vizinha GRAVA o vínculo e devolve 201 —
 * medido no épico 2, em `pacientes`. A RLS esconde a unidade na leitura,
 * então o sintoma seria um registro preso a uma unidade que ninguém naquela
 * clínica consegue ver.
 *
 * O `SELECT` roda dentro de `naClinica`, então a própria RLS faz o filtro: se
 * a unidade é de outra clínica, a consulta devolve zero linhas.
 *
 * Descarta em silêncio em vez de recusar — é o `unidadeValida()` do
 * `Code.gs`, e perder o cadastro (ou a tarefa) inteiro por causa de um campo
 * opcional seria pior para quem está com o telefone na mão.
 *
 * Mora em `comum/` porque TRÊS serviços precisam dele — pacientes,
 * importação e tarefas. Escrito uma vez por serviço, é na terceira cópia que
 * alguém esquece o `WHERE` e a unidade da vizinha volta a colar.
 */
export async function unidadeValida(
  c: pg.PoolClient,
  unidadeId: string | null | undefined,
): Promise<string | null> {
  if (unidadeId === null || unidadeId === undefined) return null
  const r = await c.query('SELECT 1 FROM unidades WHERE id = $1', [unidadeId])
  return r.rowCount === 0 ? null : unidadeId
}
