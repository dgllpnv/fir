import type { EditarTarefa } from '@fir/contracts'
import { podeLancar } from '@fir/domain'
import { UnprocessableEntityException } from '@nestjs/common'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'
import { lerPerfisDoDominio } from '../pessoas/acesso-do-ator'

/**
 * **A TAREFA "LANÇAR [KPI]" PERTENCE AO KPI** (spec I-30, I-31; appsec C1, C27).
 *
 * Ela nasce do job (marcador `lancamento-kpi:`, só o servidor escreve) e se
 * conclui pelo `PUT /v1/indicadores/kpis/:id/lancamentos/:referencia`. As
 * rotas genéricas de tarefa não podem desfazer esse vínculo:
 *
 * - **concluir** sem o lançamento da referência é 422 — a tarefa sairia de
 *   Hoje com o valor da semana ainda por lançar;
 * - **cancelar e excluir** são 422 — o caminho é arquivar o KPI, que cancela
 *   as abertas (`cancelarTarefasDeLancamento`);
 * - **editar** prazo, descrição, paciente, tipo, campanha, unidade ou data de
 *   realização é 422; e **reatribuir** (editar ou transferir) só vale para
 *   uma pessoa que `podeLancar` aceita — senão a tarefa ficaria com quem leva
 *   403 ao lançar. Grupo nunca: `podeLancar` decide por pessoa.
 *
 * Tudo é lido na transação de quem chama, depois do `FOR UPDATE` da tarefa.
 * As mensagens não citam nome de KPI nem valor (appsec C29).
 */

type Vinculo = {
  kpi_id: string
  kpi_referencia: string | null
  origem: 'catalogo' | 'manual'
  arquivado: boolean
  kpi_responsavel_id: string | null
}

async function vinculoDaTarefa(c: pg.PoolClient, clinicaId: ClinicaId, tarefaId: string): Promise<Vinculo | null> {
  const r = await c.query<Vinculo>(
    `SELECT t.kpi_id, t.kpi_referencia::text AS kpi_referencia, k.origem,
            k.arquivado_em IS NOT NULL AS arquivado, k.responsavel_id AS kpi_responsavel_id
       FROM tarefas t
       JOIN kpis k ON k.clinica_id = t.clinica_id AND k.id = t.kpi_id
      WHERE t.clinica_id = $1 AND t.id = $2 AND t.marcador LIKE 'lancamento-kpi:%'`,
    [clinicaId, tarefaId],
  )
  return r.rows[0] ?? null
}

const recusa = (mensagem: string): never => {
  throw new UnprocessableEntityException(mensagem)
}

/** Concluir pela rota genérica: só se o lançamento da referência já existe. */
export async function exigirConclusaoDeLancamento(c: pg.PoolClient, clinicaId: ClinicaId, tarefaId: string): Promise<void> {
  const v = await vinculoDaTarefa(c, clinicaId, tarefaId)
  if (v === null) return
  const l = await c.query(
    'SELECT 1 FROM lancamentos_de_kpi WHERE clinica_id = $1 AND kpi_id = $2 AND referencia = $3::date',
    [clinicaId, v.kpi_id, v.kpi_referencia],
  )
  if (l.rowCount === 0) {
    recusa('Esta tarefa se conclui lançando o valor do indicador: use "Lançar" na própria tarefa.')
  }
}

/** Cancelar e excluir: só arquivando o KPI. */
export async function recusarSeForDeLancamento(c: pg.PoolClient, clinicaId: ClinicaId, tarefaId: string): Promise<void> {
  if ((await vinculoDaTarefa(c, clinicaId, tarefaId)) !== null) {
    recusa('Esta tarefa pertence a um indicador. Para parar de pedi-la, arquive o indicador em Indicadores.')
  }
}

/** A pessoa que vai receber a tarefa consegue lançar? (`podeLancar`, relido do banco.) */
async function exigirQuemPodeLancar(c: pg.PoolClient, v: Vinculo, pessoaId: string): Promise<void> {
  const p = await c.query<{ admin: boolean; perfil_id: string | null }>(
    'SELECT admin, perfil_id FROM pessoas WHERE id = $1 AND ativo AND excluida_em IS NULL',
    [pessoaId],
  )
  const l = p.rows[0]
  const decisao = podeLancar(
    l === undefined ? null : { admin: l.admin, perfilId: l.perfil_id ?? '', pessoaId },
    await lerPerfisDoDominio(c),
    { origem: v.origem, arquivado: v.arquivado, responsavelId: v.kpi_responsavel_id },
  )
  if (decisao !== 'pode') {
    recusa('Esta tarefa só vai para quem pode lançar o indicador: a responsável por ele ou quem gerencia Indicadores.')
  }
}

/** Transferir: só para pessoa que `podeLancar` aceita; nunca para grupo. */
export async function exigirDestinoDeLancamento(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  tarefaId: string,
  para: { readonly tipo: 'pessoa' | 'grupo'; readonly id: string },
): Promise<void> {
  const v = await vinculoDaTarefa(c, clinicaId, tarefaId)
  if (v === null) return
  if (para.tipo === 'grupo') recusa('Esta tarefa pertence a um indicador e não vai para um grupo.')
  await exigirQuemPodeLancar(c, v, para.id)
}

/** Os campos que a tarefa do KPI aceita mudar pela edição genérica. */
const CAMPOS_LIVRES = new Set<keyof EditarTarefa>(['responsavelId', 'prioridade', 'obs', 'resultado', 'hora', 'serie'])

/** Editar: prazo, descrição e o resto do vínculo são do KPI; o responsável passa por `podeLancar`. */
export async function exigirEdicaoDeLancamento(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  tarefaId: string,
  dados: EditarTarefa,
): Promise<void> {
  const v = await vinculoDaTarefa(c, clinicaId, tarefaId)
  if (v === null) return
  const presos = (Object.keys(dados) as (keyof EditarTarefa)[]).filter((k) => dados[k] !== undefined && !CAMPOS_LIVRES.has(k))
  if (presos.length > 0) {
    recusa('O prazo e a descrição desta tarefa são do indicador; mude o dia de lançamento em Indicadores.')
  }
  if (dados.responsavelId !== undefined) await exigirQuemPodeLancar(c, v, dados.responsavelId)
}
