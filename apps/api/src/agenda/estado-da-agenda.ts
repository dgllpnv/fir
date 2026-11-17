import type { CicloDaAgenda } from '@fir/contracts'
import type pg from 'pg'

/**
 * O que a clínica (`/v1/agenda-externa`) e o painel (Integrações) leem do
 * estado da agenda, escrito uma vez só.
 *
 * "Ativa": o MedX só está ativo com a integração ligada no painel E o último
 * teste verde. É o mesmo critério da leitura (`sincronizacao.ts`), então a
 * tela nunca diz "ligada" para uma agenda que o worker não lê.
 */
export const ATIVA = `(a.ativa AND (a.provedor = 'ical' OR coalesce(i.agenda_ligada AND i.verificacao = 'ok', false)))`
export const DA_AGENDA = `FROM agendas_externas a LEFT JOIN integracoes_da_clinica i ON i.clinica_id = a.clinica_id`

/** Quantos ciclos a tela mostra: o bastante para ver um dia de leituras de hora em hora. */
export const CICLOS_NA_TELA = 10

/** Os últimos ciclos do MedX da clínica da transação (RLS), o mais recente primeiro. */
export async function ultimosCiclos(c: pg.PoolClient, limite = CICLOS_NA_TELA): Promise<CicloDaAgenda[]> {
  const r = await c.query<{
    em: Date
    janela_de: Date
    janela_ate: Date
    agendamentos_lidos: number
    paginas: number
    chamadas_de_contato: number
    confirmacoes_por_id: number
    resultado: 'ok' | 'falhou'
  }>(
    `SELECT em, janela_de, janela_ate, agendamentos_lidos, paginas, chamadas_de_contato,
            confirmacoes_por_id, resultado
       FROM ciclos_da_agenda_externa ORDER BY em DESC, id LIMIT $1`,
    [limite],
  )
  return r.rows.map((l) => ({
    em: l.em.toISOString(),
    janelaDe: l.janela_de.toISOString(),
    janelaAte: l.janela_ate.toISOString(),
    agendamentosLidos: l.agendamentos_lidos,
    paginas: l.paginas,
    chamadasDeContato: l.chamadas_de_contato,
    confirmacoesPorId: l.confirmacoes_por_id,
    resultado: l.resultado,
  }))
}
