import { type ChaveDoCatalogo, podeVerKpi, temPerm } from '@fir/domain'
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common'
import type pg from 'pg'
import type { PessoaId } from '../banco/ator'
import type { ClinicaId } from '../banco/clinica-id'
import { lerAtorDeAcesso, lerPerfisDoDominio } from '../pessoas/acesso-do-ator'

/**
 * **O PLANO DE AÇÃO** (spec I-46; appsec C6, C27): a tarefa que nasce ligada a
 * um KPI pelo `kpiId` do `POST /v1/tarefas`.
 *
 * - **`indicadores`** é exigida (403): quem não vê a aba não amarra tarefa a
 *   um indicador dela.
 * - **A `permissaoDoValor` do KPI** é exigida pelo MESMO predicado da
 *   calculadora (`podeVerKpi`, appsec C5): sem `pessoas.gerir`, o KPI de RH
 *   não existe — 422 com a mesma mensagem do KPI de outra clínica, do
 *   arquivado e do inexistente. Uma mensagem só: a resposta não confirma que
 *   o KPI existe em algum lugar.
 * - **A clínica** é conferida pela RLS e pelo filtro (C6); a FK composta
 *   `(clinica_id, kpi_id)` da 0098 é a terceira camada (C24).
 *
 * A permissão é RELIDA na transação (pessoa e perfis), como em
 * `exigirPermissaoDeReceber`: decide o estado de agora, não o que o guard viu.
 * Na sessão de suporte, `autor` é a administradora que assina por ela (D-13).
 *
 * O plano NÃO leva o marcador `lancamento-kpi:` — esse continua só do servidor
 * (`tarefa-de-lancamento.ts`), e as travas de lá não alcançam o plano.
 */
export async function kpiDoPlanoDeAcao(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  autor: PessoaId,
  kpiId: string | undefined,
): Promise<string | null> {
  if (kpiId === undefined) return null
  const ator = await lerAtorDeAcesso(c, autor)
  const usuario = { admin: ator.admin, perfilId: ator.tipo === 'pessoa' ? (ator.perfilId ?? '') : '' }
  const perfis = await lerPerfisDoDominio(c)
  if (!temPerm(usuario, perfis, 'indicadores')) {
    throw new ForbiddenException('Para ligar a tarefa a um indicador você precisa da permissão de Indicadores.')
  }
  const r = await c.query<{ chave_catalogo: ChaveDoCatalogo | null }>(
    'SELECT chave_catalogo FROM kpis WHERE clinica_id = $1 AND id = $2 AND arquivado_em IS NULL',
    [clinicaId, kpiId],
  )
  const k = r.rows[0]
  if (k === undefined || !podeVerKpi(usuario, perfis, k.chave_catalogo)) {
    throw new UnprocessableEntityException('Indicador não encontrado.')
  }
  return kpiId
}
