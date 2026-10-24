/**
 * Concluir × Editar — a dúvida que o MANUAL cap. 4 abre dizendo *"essa é a
 * dúvida mais comum"*.
 *
 * As quatro ações têm autorizações DIFERENTES, e o legado as espalhou em
 * quatro `if` distintos, em arquivos distintos. Aqui elas ficam lado a lado,
 * no domínio puro, porque é assim que se percebe a diferença entre elas:
 *
 *   Concluir  — qualquer um que enxerga a tarefa
 *   Cancelar  — quem solicitou, ou `tarefas.equipe`
 *   Editar    — quem solicitou, O RESPONSÁVEL, ou `tarefas.equipe`
 *   Excluir   — quem solicitou, ou `tarefas.equipe` — o responsável NÃO
 *
 * O responsável edita mas não exclui: ele conserta o que vai executar, e não
 * apaga o que outra pessoa pediu. Se ele pudesse excluir, um pedido sumiria
 * sem que quem o fez ficasse sabendo.
 *
 * Nenhuma destas funções tem `if (usuario.admin)`. `admin` já é absorvido por
 * `temPerm`, e quem o reintroduzir aqui traz de volta o booleano que o
 * `CONTEXT.md` proíbe — o chamador passa `podeEquipe`, que já é a resposta de
 * `temPerm(usuario, perfis, 'tarefas.equipe')`.
 */
import { diaCivil, inicioDoDia } from './relogio'
import { erro, erroDe, ok, type Result } from './resultado'

export type StatusDeTarefa = 'aberta' | 'concluida' | 'cancelada'

/** O mínimo que uma tarefa precisa expor para ser autorizada. */
export type TarefaParaAutorizar = {
  readonly solicitanteId: string
  readonly responsavelId: string
  readonly status: StatusDeTarefa
}

/** Quem está agindo. `podeEquipe` é `temPerm(…, 'tarefas.equipe')`, já resolvido. */
export type Autor = { readonly id: string; readonly podeEquipe: boolean }

const SO_QUEM_SOLICITOU = erroDe(
  'SO_QUEM_SOLICITOU',
  'Só quem pediu a tarefa — ou quem acompanha a equipe — pode fazer isso.',
)

const SEM_ACESSO_A_TAREFA = erroDe(
  'SEM_ACESSO_A_TAREFA',
  'Só quem pediu a tarefa, quem vai executá-la, ou quem acompanha a equipe pode editá-la.',
)

const CANCELADA = erroDe(
  'TAREFA_CANCELADA',
  'Esta tarefa está cancelada. Reabra antes de concluir ou cancelar.',
)

const JA_CONCLUIDA = erroDe(
  'TAREFA_JA_CONCLUIDA',
  'Esta tarefa já foi concluída. Reabra antes de concluir ou cancelar de novo.',
)

/** `cancelada`/`concluida` já são estados finais: reabrir é o caminho. */
function estadoPermiteMudar(t: TarefaParaAutorizar): Result<void> {
  if (t.status === 'cancelada') return erro(CANCELADA)
  if (t.status === 'concluida') return erro(JA_CONCLUIDA)
  return ok(undefined)
}

const ehSolicitante = (t: TarefaParaAutorizar, a: Autor): boolean => t.solicitanteId === a.id
const ehResponsavel = (t: TarefaParaAutorizar, a: Autor): boolean => t.responsavelId === a.id

/**
 * Concluir não pergunta quem é.
 *
 * Registrar que algo foi feito é informação da clínica, não privilégio: quem
 * atendeu a paciente pode não ser quem criou a tarefa, e exigir autoria aqui
 * faria a recepção pedir para outra pessoa marcar o que ela mesma fez.
 */
export function podeConcluir(t: TarefaParaAutorizar, _a: Autor): Result<void> {
  return estadoPermiteMudar(t)
}

export function podeCancelar(t: TarefaParaAutorizar, a: Autor): Result<void> {
  const estado = estadoPermiteMudar(t)
  if (estado.tipo === 'erro') return estado
  if (ehSolicitante(t, a) || a.podeEquipe) return ok(undefined)
  return erro(SO_QUEM_SOLICITOU)
}

/**
 * Editar NÃO olha o estado.
 *
 * A v20 edita tarefa concluída para acertar a data de realização e o
 * resultado, e é por ali que a recepção conserta um lançamento retroativo com
 * a data errada. Bloquear aqui tiraria o único caminho de conserto e
 * empurraria a correção para o `psql`.
 */
export function podeEditar(t: TarefaParaAutorizar, a: Autor): Result<void> {
  if (ehSolicitante(t, a) || ehResponsavel(t, a) || a.podeEquipe) return ok(undefined)
  return erro(SEM_ACESSO_A_TAREFA)
}

export function podeExcluir(t: TarefaParaAutorizar, a: Autor): Result<void> {
  if (ehSolicitante(t, a) || a.podeEquipe) return ok(undefined)
  return erro(SO_QUEM_SOLICITOU)
}

const MEIO_DIA_MS = 12 * 60 * 60_000

/**
 * O instante em que uma conclusão é carimbada.
 *
 * Meio-dia no fuso da clínica para o retroativo, e não meia-noite: é a regra
 * da v20 (`dataConc`) e as 4 clínicas têm anos de histórico assim. A razão é a
 * borda — com meia-noite, qualquer janela `[início, fim)` e qualquer virada de
 * horário de verão colocam o registro no dia vizinho, e "a consulta do dia 20"
 * aparece no relatório do dia 19.
 *
 * Em dia de mudança de horário de verão isto é 11:00 ou 13:00 locais, não
 * 12:00 — e está certo assim: o que se quer é um instante CONFORTAVELMENTE
 * DENTRO do dia civil, não o meio-dia do relógio.
 *
 * `hojeDaClinica` é parâmetro, e vem do SERVIDOR (regra 24): o relógio do
 * cliente não decide que dia é hoje.
 */
export function instanteDaConclusao(
  dia: string,
  hojeDaClinica: string,
  fuso: string,
  agora: Date,
): Result<Date> {
  // Comparação lexicográfica: para `aaaa-mm-dd` é a mesma ordem da cronológica.
  if (dia > hojeDaClinica) {
    return erro(erroDe('DATA_NO_FUTURO', 'A data de realização precisa ser até hoje.'))
  }
  if (dia === hojeDaClinica) return ok(agora)

  const carimbo = new Date(inicioDoDia(dia, fuso).getTime() + MEIO_DIA_MS)
  // Cinto e suspensório: `inicioDoDia` já lida com a meia-noite inexistente da
  // virada do horário de verão, e meio-dia depois dela cai sempre no mesmo dia
  // civil. Se algum fuso novo quebrar essa suposição, é melhor descobrir aqui
  // do que num relatório de faturamento com um dia a menos.
  if (diaCivil(carimbo, fuso) !== dia) {
    return erro(
      erroDe('DIA_IMPOSSIVEL', 'Não consegui registrar essa data nesta clínica. Avise o suporte.'),
    )
  }
  return ok(carimbo)
}
