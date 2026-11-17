import { ehIndicador, tipoDoIndicador } from '@fir/domain'
import type pg from 'pg'

/**
 * **O DINHEIRO DA TRILHA COM NOME DE DINHEIRO** (dívida D-I7, regra 17).
 *
 * A trilha guarda a linha crua da tabela (`de`/`para` em jsonb), e a redação
 * é por NOME de campo (`RedacaoInterceptor`, D5). Em `metas_de_pessoa` uma
 * coluna só, `alvo`, guarda o alvo na escala do indicador: centavos em
 * `orc_valor`, quantidade ou ponto percentual nos outros (migration 0019).
 * Pôr `alvo` em `CAMPOS_MONETARIOS` apagaria a meta de quantidade de quem não
 * tem `valores`. Não pô-lo deixava o alvo em reais em claro na trilha.
 *
 * Aqui não se decide permissão nenhuma. A meta em reais só passa a sair com
 * `alvo` renomeado para `metaEmDinheiro`, o nome que a tela de metas já usa e
 * que está na lista. A decisão de apagar continua no ponto único, o
 * interceptor.
 *
 * `realizado_lancado` não entra: um `CHECK` da 0019 o restringe a `manual`,
 * que é quantidade.
 *
 * `indicadoresDasMetas` acha o indicador das linhas de `UPDATE`, que não o
 * trazem: ele está na linha de `INSERT` (ou de `DELETE`) da mesma meta.
 *
 * O caminho mais limpo é a redação por unidade (D5), ou a trigger gravando a
 * unidade junto. Esta função é o conserto até lá.
 */
export function comDinheiroNomeado(entidade: string, linha: unknown, indicadorDaMeta: string | null = null): unknown {
  if (entidade !== 'metas_de_pessoa' || typeof linha !== 'object' || linha === null || Array.isArray(linha)) {
    return linha
  }
  const l = linha as Record<string, unknown>
  // O `UPDATE` grava só as colunas que mudaram (`registrar_auditoria`): o
  // indicador vem da própria linha ou, se ela não o traz, de quem chama.
  const indicador = l['indicador'] ?? indicadorDaMeta
  // Indicador desconhecido é tratado como dinheiro: na dúvida, apaga.
  const emReais = typeof indicador !== 'string' || !ehIndicador(indicador) || tipoDoIndicador(indicador) === 'valor'
  if (!emReais || !('alvo' in l)) return linha
  const { alvo, ...resto } = l
  return { ...resto, metaEmDinheiro: alvo }
}

/**
 * O indicador de cada meta, lido da própria trilha: a linha de criação (ou de
 * remoção) guarda a linha inteira. Uma consulta por página, não por item.
 */
export async function indicadoresDasMetas(
  c: pg.PoolClient,
  clinicaId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const r = await c.query<{ id: string; indicador: string }>(
    `SELECT DISTINCT ON (entidade_id) entidade_id AS id, coalesce(para ->> 'indicador', de ->> 'indicador') AS indicador
       FROM auditoria
      WHERE clinica_id = $1 AND entidade = 'metas_de_pessoa' AND entidade_id = ANY($2::text[])
        AND coalesce(para ->> 'indicador', de ->> 'indicador') IS NOT NULL
      ORDER BY entidade_id, em DESC, id DESC`,
    [clinicaId, [...ids]],
  )
  return new Map(r.rows.map((x) => [x.id, x.indicador]))
}
