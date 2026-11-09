import { TIPOS_DE_RECEITA, TIPOS_PAGAVEIS } from '@fir/domain'
import { DINHEIRO_QUE_ENTROU } from '../financeiro/dinheiro-que-entrou'

/**
 * **O QUE CONTA COMO RECEITA DA CAMPANHA — escrito uma vez** (correções da PO,
 * A3 · N-2).
 *
 * Até a A3 havia três definições: `CampanhasService.montar` e a sincronização
 * da carteira filtravam tarefa concluída, com paciente e de tipo de receita; a
 * conferência da migração (regra 28) somava todo recebimento de toda tarefa
 * concluída da campanha. Enquanto nenhuma tela vinculava campanha à mão, as
 * três davam o mesmo número; com a A3 a diferença passa a poder aparecer — e
 * a conferência reprovaria uma clínica por uma regra que não é a da tela.
 *
 * É o `ehReceita` do domínio (`tipos-de-tarefa.ts`) e o `contaComoReceita` da
 * origem v20 (`migracao/conferencia.ts`), em SQL:
 *
 *   tarefa CONCLUÍDA · COM paciente · recebimento VIVO · dinheiro que ENTROU
 *   (D-9) · tipo de RECEITA, ou tipo PAGÁVEL com valor.
 *
 * **Um caminho só** (N-1): `campanhas → tarefas.campanha_id →
 * recebimentos.tarefa_id`. Nunca `pacientes.campanha_id` — a paciente "da
 * campanha" com a tarefa "da campanha" seria somada duas vezes. O orçamento
 * (`valor_orcamento`) não está aqui e não pode estar (regra 4): ele é coluna de
 * `tarefas`, e este predicado só soma `r.valor`.
 *
 * Pressupõe `tarefas` como `t` e `recebimentos` como `r`. Os dois nomes de
 * tipo viram literais SQL a partir das listas DO DOMÍNIO — nada aqui vem de
 * requisição, e o escape de aspa é a garantia de que um tipo novo com
 * apóstrofo não quebre (nem abra) a consulta.
 */
const literal = (nomes: readonly string[]): string =>
  `ARRAY[${nomes.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ')}]::text[]`

export const RECEITA_DA_CAMPANHA = `(
  t.status = 'concluida'
  AND t.paciente_id IS NOT NULL
  AND r.estornado_em IS NULL
  AND ${DINHEIRO_QUE_ENTROU}
  AND (t.tipo = ANY(${literal(TIPOS_DE_RECEITA)})
       OR (t.tipo = ANY(${literal(TIPOS_PAGAVEIS)}) AND r.valor > 0))
)`
