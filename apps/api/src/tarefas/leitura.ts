import type { PassoDaJornada, TarefaNaLista } from '@fir/contracts'
import { TIPOS } from '@fir/domain'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * A ÚNICA leitura de tarefa do sistema.
 *
 * Criar, concluir, cancelar, reabrir, editar, listar e a tela Hoje devolvem
 * todas a mesma forma, e todas por aqui. O legado tem a montagem da tarefa
 * escrita três vezes — front, `demoApiBase` e `Code.gs` — e as três já
 * divergiram; a mais cara das divergências é justamente esta, porque é a
 * forma que carrega o pagamento.
 *
 * `$1` clínica · `$2` o dia civil de HOJE na clínica (para `atrasada`).
 */
export const SELECT_TAREFA = `
  SELECT t.id,
         t.solicitante_id, ps.nome AS solicitante_nome,
         t.responsavel_id, pr.nome AS responsavel_nome,
         t.descricao, t.prazo::text AS prazo, t.hora::text AS hora, t.prioridade, t.status,
         t.concluida_em, t.criada_em,
         t.paciente_id, pa.nome AS paciente_nome, pa.telefone AS paciente_telefone,
         t.tipo, t.etapa::text AS etapa, t.historico, t.resultado, t.obs,
         t.serie_id, t.recorrencia, t.unidade_id,
         -- ATRASADA é contra o HOJE DO SERVIDOR ($2), nunca contra o dia que
         -- a tela está navegando: ir para a semana passada não atrasa nada,
         -- e ir para a próxima não desatrasa nada.
         (t.status = 'aberta' AND t.prazo < $2::date) AS atrasada,
         -- O pagamento embutido é uma LINHA DE \`recebimentos\`, nunca uma
         -- coluna de \`tarefas\`. O LEFT JOIN só traz o recebimento VIVO: um
         -- estornado não conta receita, e o índice único parcial garante que
         -- no máximo um esteja vivo — então este JOIN não multiplica linhas.
         r.id AS rec_id, r.valor::text AS rec_valor, r.valor_aberto::text AS rec_valor_aberto,
         r.forma AS rec_forma, r.tipo AS rec_tipo, r.recebido_em AS rec_recebido_em
    FROM tarefas t
    JOIN pessoas ps ON ps.id = t.solicitante_id
    JOIN pessoas pr ON pr.id = t.responsavel_id
    LEFT JOIN pacientes pa ON pa.id = t.paciente_id
    LEFT JOIN recebimentos r ON r.tarefa_id = t.id AND r.estornado_em IS NULL
   WHERE t.clinica_id = $1 AND t.excluida_em IS NULL`

export type LinhaDeTarefa = {
  id: string
  solicitante_id: string
  solicitante_nome: string
  responsavel_id: string
  responsavel_nome: string
  descricao: string
  prazo: string
  hora: string | null
  prioridade: 'normal' | 'urgente'
  status: 'aberta' | 'concluida' | 'cancelada'
  concluida_em: Date | null
  criada_em: Date
  paciente_id: string | null
  paciente_nome: string | null
  paciente_telefone: string | null
  tipo: string
  etapa: string | null
  historico: PassoDaJornada[]
  resultado: string
  obs: string
  serie_id: string | null
  recorrencia: string
  unidade_id: string | null
  atrasada: boolean
  rec_id: string | null
  rec_valor: string | null
  rec_valor_aberto: string | null
  rec_forma: string | null
  rec_tipo: string | null
  rec_recebido_em: Date | null
  total?: string
}

export const paraSaida = (l: LinhaDeTarefa): TarefaNaLista => ({
  id: l.id,
  solicitanteId: l.solicitante_id,
  solicitanteNome: l.solicitante_nome,
  responsavelId: l.responsavel_id,
  responsavelNome: l.responsavel_nome,
  descricao: l.descricao,
  prazo: l.prazo,
  // `time` do Postgres volta `HH:MM:SS`; a tela e o contrato falam `HH:MM`.
  hora: l.hora === null ? null : l.hora.slice(0, 5),
  prioridade: l.prioridade,
  status: l.status,
  concluidaEm: l.concluida_em === null ? null : l.concluida_em.toISOString(),
  criadaEm: l.criada_em.toISOString(),
  pacienteId: l.paciente_id,
  pacienteNome: l.paciente_nome,
  pacienteTelefone: l.paciente_telefone,
  tipo: l.tipo,
  etapa: l.etapa,
  historico: l.historico,
  resultado: l.resultado,
  obs: l.obs,
  serieId: l.serie_id,
  recorrencia: l.recorrencia,
  unidadeId: l.unidade_id,
  atrasada: l.atrasada,
  pagamento:
    l.rec_id === null
      ? null
      : {
          id: l.rec_id,
          valor: l.rec_valor,
          valorAberto: l.rec_valor_aberto,
          forma: l.rec_forma ?? '',
          tipo: l.rec_tipo ?? '',
          recebidoEm: (l.rec_recebido_em ?? new Date(0)).toISOString(),
        },
})

/** Lê as tarefas pedidas, na ordem em que o banco as devolver. */
export async function lerTarefas(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  hoje: string,
  ids: readonly string[],
): Promise<TarefaNaLista[]> {
  if (ids.length === 0) return []
  const r = await c.query<LinhaDeTarefa>(
    `${SELECT_TAREFA} AND t.id = ANY($3) ORDER BY t.prazo, t.hora NULLS LAST, t.criada_em`,
    [clinicaId, hoje, ids],
  )
  return r.rows.map(paraSaida)
}

/**
 * Os tipos de AGENDA — os que viram outro tipo ao concluir.
 *
 * Derivados de `TIPOS`, nunca escritos à mão: o `TIPOS_AGENDA` do protótipo é
 * a lista literal `["Consulta agendada","Procedimento agendado"]`, e uma
 * segunda cópia dela aqui é como um tipo novo entra na tabela e não vira
 * "realizado" ao concluir, sem erro nenhum.
 */
export const TIPOS_DE_AGENDA: readonly string[] = TIPOS.filter((t) => t.vira !== undefined).map(
  (t) => t.nome,
)

/** Atendimento já realizado — nasce "realizado" quando lançado retroativo. */
export const TIPOS_REALIZADOS: readonly string[] = TIPOS.filter(
  (t) => t.grupo === 'Atendimento' && t.sessao !== true,
).map((t) => t.nome)
