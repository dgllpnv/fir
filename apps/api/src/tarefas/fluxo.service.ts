import {
  ACOES_DO_FLUXO,
  type EventoDeFluxo,
  type FluxoDaTarefa,
  type NoDoFluxo,
} from '@fir/contracts'
import { ehOk, podeEditar } from '@fir/domain'
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { comGrupos } from './grupos-do-autor'
import type { LeitorDaRequisicao } from './leitura'

/** Profundidade máxima da cadeia, para cima e para baixo (appsec S2). */
export const PROFUNDIDADE_DO_FLUXO = 20
/** Teto de nós devolvidos: uma tarefa com mil "filhas" não vira mil linhas. */
export const NOS_DO_FLUXO_MAXIMO = 200

type Candidato = {
  id: string
  nivel: number
  corte: boolean
}

type Detalhe = {
  id: string
  solicitante_id: string
  responsavel_id: string | null
  responsavel_nome: string | null
  grupo_id: string | null
  grupo_nome: string | null
  status: 'aberta' | 'concluida' | 'cancelada'
  descricao: string
  prazo: string
  criada_em: Date
  concluida_em: Date | null
  paciente_id: string | null
  paciente_desativado: boolean
  historico: ({ acao: string } & Record<string, unknown>)[]
}

/**
 * `GET /v1/tarefas/:id/fluxo` — a cadeia de "concluir e criar nova".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA É UMA ROTA QUE LÊ TAREFAS DE OUTROS PELO ELO, e por isso cada nó é
 * reautorizado:
 *
 *  - **A cadeia é só da clínica**: `clinica_id` FIXO em todo join da CTE (e a FK
 *    composta da 0084 impede o elo de cruzar clínica na escrita).
 *  - **Profundidade < 20 e ids visitados** contra ciclo. O `CHECK` só impede o
 *    elo para si mesma; A→B→A passaria, e uma CTE sem guarda giraria até o
 *    banco desistir.
 *  - **Cada nó passa pelo MESMO filtro de `GET tarefas/:id`** (`podeEditar`, com
 *    os grupos lidos do banco): quem não vê a tarefa recebe um marcador OPACO —
 *    só id e posição, sem descrição, destino ou nome. `tarefas.equipe` passa em
 *    todos, que é o que o filtro já diz.
 *  - **Nó com paciente exige acesso de paciente** (`pacientes`): sem ele o nó é
 *    opaco mesmo para `tarefas.equipe`. E a rota é `@DadoSensivel('pacientes')`.
 *  - **Os eventos saem com ids, nunca com nomes de pessoa**: o nome de quem
 *    assumiu não atravessa para quem só lê a cadeia.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class FluxoService {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async fluxo(
    clinicaId: ClinicaId,
    ator: Ator,
    autor: LeitorDaRequisicao,
    podePaciente: boolean,
    id: string,
  ): Promise<FluxoDaTarefa> {
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const eu = await comGrupos(c, clinicaId, autor)

      // Duas CTEs recursivas — para CIMA (de onde veio) e para BAIXO (o que nasceu
      // dela) — com a mesma guarda. `corte` marca onde a cadeia foi cortada por
      // profundidade ou por ciclo, para a tela dizer "há mais".
      // `ORDER BY` por distância ANTES do `LIMIT`: sem ele o corte dos 200 é
      // arbitrário e pode deixar a tarefa pedida (nível 0) de fora.
      const r = await c.query<{ id: string; nivel: number; corte: boolean }>(
        `WITH RECURSIVE cima AS (
           SELECT t.id, t.tarefa_origem_id, 0 AS nivel, ARRAY[t.id] AS vistos
             FROM tarefas t
            WHERE t.id = $2 AND t.clinica_id = $1 AND t.excluida_em IS NULL
           UNION ALL
           SELECT o.id, o.tarefa_origem_id, x.nivel + 1, x.vistos || o.id
             FROM cima x
             JOIN tarefas o ON o.id = x.tarefa_origem_id AND o.clinica_id = $1
            WHERE x.nivel < $3 - 1 AND o.excluida_em IS NULL AND NOT (o.id = ANY(x.vistos))
         ),
         baixo AS (
           SELECT t.id, 0 AS nivel, ARRAY[t.id] AS vistos
             FROM tarefas t
            WHERE t.id = $2 AND t.clinica_id = $1 AND t.excluida_em IS NULL
           UNION ALL
           SELECT f.id, x.nivel + 1, x.vistos || f.id
             FROM baixo x
             JOIN tarefas f ON f.tarefa_origem_id = x.id AND f.clinica_id = $1
            WHERE x.nivel < $3 - 1 AND f.excluida_em IS NULL AND NOT (f.id = ANY(x.vistos))
         )
         SELECT id, nivel, corte FROM (
           SELECT cima.id, -cima.nivel AS nivel,
                  (cima.nivel >= $3 - 1 AND cima.tarefa_origem_id IS NOT NULL)
                    OR (cima.tarefa_origem_id IS NOT NULL AND cima.tarefa_origem_id = ANY(cima.vistos))
                    -- uma origem EXCLUÍDA interrompe a cadeia: a tela deve dizer "há mais"
                    OR EXISTS (SELECT 1 FROM tarefas e
                                WHERE e.id = cima.tarefa_origem_id AND e.clinica_id = $1
                                  AND e.excluida_em IS NOT NULL) AS corte
             FROM cima
           UNION
           SELECT b.id, b.nivel,
                  (b.nivel >= $3 - 1 AND EXISTS (SELECT 1 FROM tarefas k
                                                  WHERE k.tarefa_origem_id = b.id AND k.clinica_id = $1))
                  OR EXISTS (SELECT 1 FROM tarefas k
                              WHERE k.tarefa_origem_id = b.id AND k.clinica_id = $1
                                AND k.excluida_em IS NOT NULL
                                AND EXISTS (SELECT 1 FROM tarefas g
                                             WHERE g.tarefa_origem_id = k.id AND g.clinica_id = $1))
             FROM baixo b WHERE b.nivel > 0
         ) u
         ORDER BY abs(nivel), id
         LIMIT $4`,
        [clinicaId, id, PROFUNDIDADE_DO_FLUXO, NOS_DO_FLUXO_MAXIMO],
      )
      if (!r.rows.some((x) => x.id === id)) throw new NotFoundException('Tarefa não encontrada.')

      // Um ciclo (A→B→A) faz a mesma tarefa aparecer para cima E para baixo: cada
      // id entra UMA vez, no nível mais próximo da pedida, e o `corte` é a soma.
      const unicos = new Map<string, Candidato>()
      for (const x of r.rows) {
        const nivel = Number(x.nivel)
        const antes = unicos.get(x.id)
        if (antes === undefined) {
          unicos.set(x.id, { id: x.id, nivel, corte: x.corte })
        } else {
          antes.corte = antes.corte || x.corte
          if (Math.abs(nivel) < Math.abs(antes.nivel)) antes.nivel = nivel
        }
      }
      const candidatos: Candidato[] = [...unicos.values()]

      const d = await c.query<Detalhe>(
        `SELECT t.id, t.solicitante_id, t.responsavel_id, pr.nome AS responsavel_nome,
                t.grupo_id, gr.nome AS grupo_nome, t.status, t.descricao, t.prazo::text AS prazo,
                t.criada_em, t.concluida_em, t.paciente_id, t.historico,
                EXISTS (SELECT 1 FROM pacientes pdes
                         WHERE pdes.id = t.paciente_id AND NOT pdes.ativo) AS paciente_desativado
           FROM tarefas t
           LEFT JOIN pessoas pr ON pr.id = t.responsavel_id AND pr.clinica_id = t.clinica_id
           LEFT JOIN grupos_da_equipe gr ON gr.id = t.grupo_id AND gr.clinica_id = t.clinica_id
          WHERE t.clinica_id = $1 AND t.id = ANY($2::uuid[]) AND t.excluida_em IS NULL`,
        [clinicaId, candidatos.map((x) => x.id)],
      )
      const porId = new Map(d.rows.map((x) => [x.id, x]))

      const visivel = (t: Detalhe): boolean =>
        ehOk(
          podeEditar(
            {
              solicitanteId: t.solicitante_id,
              responsavelId: t.responsavel_id,
              grupoId: t.grupo_id,
              status: t.status,
            },
            eu,
          ),
        ) &&
        // Nó com paciente: o acesso de paciente é pré-requisito, inclusive para
        // `tarefas.equipe` (permissão de equipe não é permissão de paciente).
        (t.paciente_id === null || podePaciente)

      // A tarefa PEDIDA tem de ser legível por quem pede, como em `GET tarefas/:id`.
      const raiz = porId.get(id)
      if (raiz === undefined) throw new NotFoundException('Tarefa não encontrada.')
      if (!visivel(raiz)) throw new ForbiddenException('Sem acesso a esta tarefa.')

      // Do mais antigo (nível mais negativo) ao mais novo; empate por criação.
      const ordenados = candidatos
        .filter((x) => porId.has(x.id))
        .sort(
          (a, b) =>
            a.nivel - b.nivel ||
            porId.get(a.id)!.criada_em.getTime() - porId.get(b.id)!.criada_em.getTime(),
        )

      // Defesa na leitura (S2): a escrita já impede a cadeia de cruzar paciente (serviço
      // e trigger 0089), mas um dado que passou por fora não vaza o outro paciente. E
      // a tarefa ABERTA de paciente desativado some, como em toda listagem.
      const pacienteDaRaiz = raiz.paciente_id
      const foraDoEscopo = (t: Detalhe): boolean =>
        t.id !== id &&
        ((pacienteDaRaiz !== null && t.paciente_id !== null && t.paciente_id !== pacienteDaRaiz) ||
          (t.paciente_desativado && t.status === 'aberta'))

      const nos: NoDoFluxo[] = ordenados.map((cand, posicao) => {
        const t = porId.get(cand.id)!
        if (!visivel(t) || foraDoEscopo(t)) return { visivel: false, id: t.id, posicao }
        return {
          visivel: true,
          id: t.id,
          posicao,
          descricao: t.descricao,
          status: t.status,
          prazo: t.prazo,
          criadaEm: t.criada_em.toISOString(),
          concluidaEm: t.concluida_em === null ? null : t.concluida_em.toISOString(),
          destino:
            t.responsavel_id !== null
              ? { tipo: 'pessoa', id: t.responsavel_id, nome: t.responsavel_nome ?? '' }
              : { tipo: 'grupo', id: t.grupo_id ?? '', nome: t.grupo_nome ?? '' },
          pacienteId: t.paciente_id,
          eventos: t.historico.filter((e): e is EventoDeFluxo =>
            (ACOES_DO_FLUXO as readonly string[]).includes(e.acao),
          ),
        }
      })

      return {
        raizId: id,
        nos,
        truncado: candidatos.some((x) => x.corte) || r.rows.length >= NOS_DO_FLUXO_MAXIMO,
      }
    })
  }
}
