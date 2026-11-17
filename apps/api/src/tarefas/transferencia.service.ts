import type {
  AssumirTarefa,
  EventoDeFluxo,
  TarefasAfetadas,
  TransferirTarefa,
} from '@fir/contracts'
import {
  diaCivil,
  ehErro,
  ehSessao,
  podeAssumir,
  podeTransferir,
  type Relogio,
  type Result,
  type StatusDeTarefa,
} from '@fir/domain'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type pg from 'pg'
import { type Ator, pessoaDoAtor, SessaoDeSuporteNaoAssina } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO } from '../comum/relogio'
import { comGrupos } from './grupos-do-autor'
import { type AutorDaRequisicao, lerTarefas } from './leitura'
import { exigirDestinoDeLancamento } from './tarefa-de-lancamento'

/**
 * Teto do `historico` de uma tarefa (E2). Cada transferência acrescenta um
 * evento; sem teto, duas pessoas devolvendo a tarefa uma à outra por um ano
 * inflariam o `jsonb` que TODA leitura da tarefa carrega. 500 eventos é muito
 * além de qualquer uso real; passou disso, 409 — e a tela pede ajuda.
 */
export const TETO_DO_HISTORICO = 500

type Linha = {
  id: string
  solicitante_id: string
  responsavel_id: string | null
  grupo_id: string | null
  grupo_ativo: boolean | null
  status: StatusDeTarefa
  tipo: string
  programa_id: string | null
  n_eventos: number
}

/**
 * Assumir e transferir — os dois movimentos do FLUXO da tarefa (ADR 2026-11-14).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO GARANTE, E ONDE
 *
 *  1. **Autorização em duas camadas.** A função pura (`podeAssumir`,
 *     `podeTransferir`, de `packages/domain`) dá a mensagem certa; o `UPDATE` é
 *     condicionado ao estado do banco (`WHERE grupo_id = … AND responsavel_id IS
 *     NULL AND status = 'aberta'`, com o `EXISTS` de membro). A segunda é a que
 *     vale na corrida: duas pessoas assumindo no mesmo instante leem o mesmo
 *     estado, e só um `UPDATE` encontra a linha como estava.
 *  2. **O evento só existe se a linha mudou** (`rowCount = 1`). O perdedor da
 *     corrida recebe 409 e nenhum evento — nada na trilha diz que ele assumiu.
 *  3. **Sessão de suporte é recusada** (E3): assumir e transferir são rituais da
 *     clínica, e o `porId` do evento é uma pessoa.
 *  4. **Nada do corpo vai a log nem a mensagem de erro**: a `nota` é texto livre
 *     (L3) e as mensagens abaixo são fixas.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class TransferenciaService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async assumir(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    autor: AutorDaRequisicao,
    id: string,
    dados: AssumirTarefa,
  ): Promise<TarefasAfetadas> {
    const pessoa = exigirPessoa(ator)
    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, fuso)

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      // SEM `FOR UPDATE`, de propósito: o perdedor da corrida deve chegar ao
      // `UPDATE` condicional e perder ali (rowCount 0), não esperar na leitura.
      const t = await carregar(c, clinicaId, id, false)
      exigirAutorizacao(
        podeAssumir(
          {
            solicitanteId: t.solicitante_id,
            responsavelId: t.responsavel_id,
            grupoId: t.grupo_id,
            status: t.status,
          },
          await comGrupos(c, clinicaId, autor),
        ),
      )
      exigirHistoricoComEspaco(t)

      const evento: EventoDeFluxo = {
        acao: 'assumir',
        em: agora.toISOString(),
        porId: pessoa,
        de: { tipo: 'grupo', id: t.grupo_id! },
        para: { tipo: 'pessoa', id: pessoa },
        ...(dados.nota === undefined || dados.nota === '' ? {} : { nota: dados.nota }),
      }
      const r = await c.query(
        `UPDATE tarefas
            SET responsavel_id = $3, grupo_id = NULL,
                historico = historico || $4::jsonb
          WHERE id = $1 AND clinica_id = $2
            AND grupo_id = $5 AND responsavel_id IS NULL
            AND status = 'aberta' AND excluida_em IS NULL
            AND jsonb_array_length(historico) < $6
            AND ($7::boolean OR EXISTS (
                  SELECT 1 FROM membros_de_grupo mg
                    JOIN grupos_da_equipe g ON g.id = mg.grupo_id AND g.clinica_id = mg.clinica_id
                   WHERE mg.clinica_id = $2 AND mg.grupo_id = $5 AND mg.pessoa_id = $3
                     AND mg.removido_em IS NULL AND g.ativo))`,
        [id, clinicaId, pessoa, JSON.stringify([evento]), t.grupo_id, TETO_DO_HISTORICO, autor.podeEquipe],
      )
      // A perdedora da corrida (E1): outra pessoa assumiu, transferiu ou
      // concluiu entre a leitura e o UPDATE. Sem evento, sem efeito.
      if (r.rowCount !== 1) {
        throw new ConflictException('Esta tarefa acabou de mudar — outra pessoa já cuidou dela. Recarregue.')
      }
      return umaSo(await lerTarefas(c, clinicaId, hoje, [id], autor.podeJornada))
    })
  }

  async transferir(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    autor: AutorDaRequisicao,
    id: string,
    dados: TransferirTarefa,
  ): Promise<TarefasAfetadas> {
    const pessoa = exigirPessoa(ator)
    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, fuso)

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      // Aqui `FOR UPDATE`: transferências da MESMA tarefa se enfileiram, e a
      // segunda decide contra o estado que a primeira deixou (nada de lost update).
      const t = await carregar(c, clinicaId, id, true)
      exigirAutorizacao(
        podeTransferir(
          {
            solicitanteId: t.solicitante_id,
            responsavelId: t.responsavel_id,
            grupoId: t.grupo_id,
            grupoAtivo: t.grupo_ativo ?? undefined,
            status: t.status,
          },
          await comGrupos(c, clinicaId, autor),
        ),
      )

      const de =
        t.responsavel_id !== null
          ? ({ tipo: 'pessoa', id: t.responsavel_id } as const)
          : ({ tipo: 'grupo', id: t.grupo_id! } as const)

      // E2: transferir para onde já está não faz nada — nem evento, nem trilha.
      if (de.tipo === dados.para.tipo && de.id === dados.para.id) {
        return umaSo(await lerTarefas(c, clinicaId, hoje, [id], autor.podeJornada))
      }

      // A tarefa "Lançar [KPI]" só vai para quem `podeLancar` aceita, nunca para grupo (T3).
      await exigirDestinoDeLancamento(c, clinicaId, id, dados.para)

      if (dados.para.tipo === 'grupo' && ehSessao({ tipo: t.tipo })) {
        // A baixa de estoque assina a dose na pessoa que a aplica (`aplicado_por`);
        // sessão de grupo não teria pessoa.
        throw new ConflictException('Uma sessão de programa não vai para um grupo — só para uma pessoa.')
      }
      exigirHistoricoComEspaco(t)

      // O destino: da clínica e ATIVO. `clinica_id` na aplicação também (a RLS e a
      // FK composta da 0084 são as outras duas camadas).
      if (dados.para.tipo === 'pessoa') {
        const p = await c.query<{ ativo: boolean }>(
          'SELECT ativo FROM pessoas WHERE id = $1 AND clinica_id = $2',
          [dados.para.id, clinicaId],
        )
        if (p.rowCount === 0 || p.rows[0]!.ativo !== true) {
          throw new BadRequestException('Escolha uma pessoa ativa.')
        }
      } else {
        const g = await c.query<{ ativo: boolean }>(
          'SELECT ativo FROM grupos_da_equipe WHERE id = $1 AND clinica_id = $2',
          [dados.para.id, clinicaId],
        )
        if (g.rowCount === 0 || g.rows[0]!.ativo !== true) {
          throw new BadRequestException('Escolha um grupo ativo.')
        }
      }

      const evento: EventoDeFluxo = {
        acao: 'transferir',
        em: agora.toISOString(),
        porId: pessoa,
        de,
        para: dados.para,
        ...(dados.nota === undefined || dados.nota === '' ? {} : { nota: dados.nota }),
      }
      // O `WHERE` repete o estado que acabamos de ler: cinto e suspensório contra
      // qualquer escrita que passe por fora do `FOR UPDATE`. O append é UM comando
      // (`historico || $evento`) — ler, empurrar em JS e regravar perderia o
      // evento de quem escrevesse no meio.
      const r = await c.query(
        `UPDATE tarefas
            SET responsavel_id = $3, grupo_id = $4,
                historico = historico || $5::jsonb
          WHERE id = $1 AND clinica_id = $2
            AND status = 'aberta' AND excluida_em IS NULL
            AND responsavel_id IS NOT DISTINCT FROM $6::uuid
            AND grupo_id IS NOT DISTINCT FROM $7::uuid
            AND jsonb_array_length(historico) < $8
            -- A autorização REPETIDA no UPDATE (TOCTOU): quem foi tirado do grupo entre
            -- a leitura e aqui perde, como no assumir. Espelha \`podeTransferir\`.
            AND ($9::boolean
                 OR responsavel_id = $10::uuid
                 OR EXISTS (SELECT 1 FROM membros_de_grupo mg
                              JOIN grupos_da_equipe g ON g.id = mg.grupo_id AND g.clinica_id = mg.clinica_id
                             WHERE mg.clinica_id = $2 AND mg.grupo_id = tarefas.grupo_id
                               AND mg.pessoa_id = $10::uuid AND mg.removido_em IS NULL AND g.ativo)
                 OR (grupo_id IS NOT NULL AND solicitante_id = $10::uuid
                     AND NOT EXISTS (SELECT 1 FROM grupos_da_equipe g2
                                      WHERE g2.id = tarefas.grupo_id AND g2.clinica_id = $2 AND g2.ativo)))`,
        [
          id,
          clinicaId,
          dados.para.tipo === 'pessoa' ? dados.para.id : null,
          dados.para.tipo === 'grupo' ? dados.para.id : null,
          JSON.stringify([evento]),
          t.responsavel_id,
          t.grupo_id,
          TETO_DO_HISTORICO,
          autor.podeEquipe,
          pessoa,
        ],
      )
      if (r.rowCount !== 1) {
        throw new ConflictException('Esta tarefa acabou de mudar. Recarregue e tente de novo.')
      }
      return umaSo(await lerTarefas(c, clinicaId, hoje, [id], autor.podeJornada))
    })
  }
}

/** Sessão de suporte e qualquer ator que não seja uma PESSOA da clínica: recusados (E3). */
function exigirPessoa(ator: Ator): string {
  const p = pessoaDoAtor(ator)
  if (p === null) throw new SessaoDeSuporteNaoAssina()
  return p
}

async function carregar(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  id: string,
  travar: boolean,
): Promise<Linha> {
  const r = await c.query<Linha>(
    `SELECT t.id, t.solicitante_id, t.responsavel_id, t.grupo_id,
            (SELECT g.ativo FROM grupos_da_equipe g
              WHERE g.id = t.grupo_id AND g.clinica_id = t.clinica_id) AS grupo_ativo,
            t.status, t.tipo, t.programa_id, jsonb_array_length(t.historico) AS n_eventos
       FROM tarefas t
      WHERE t.id = $1 AND t.clinica_id = $2 AND t.excluida_em IS NULL
      ${travar ? 'FOR UPDATE OF t' : ''}`,
    [id, clinicaId],
  )
  const l = r.rows[0]
  // A RLS e o filtro de clínica devolvem zero linhas para a tarefa da vizinha: o
  // mesmo 404 de "não existe", que não confirma a existência de nada.
  if (l === undefined) throw new NotFoundException('Tarefa não encontrada.')
  return l
}

function exigirHistoricoComEspaco(t: Linha): void {
  if (t.n_eventos >= TETO_DO_HISTORICO) {
    throw new ConflictException('O histórico desta tarefa está cheio. Peça ajuda ao suporte.')
  }
}

/** 403 para quem não pode; 409 para o estado (a tarefa não está como a pessoa acha). */
function exigirAutorizacao(r: Result<void>): void {
  if (!ehErro(r)) return
  const estado = new Set(['TAREFA_NAO_ESTA_ABERTA', 'TAREFA_NAO_E_DE_GRUPO'])
  if (estado.has(r.erro.codigo)) throw new ConflictException(r.erro.mensagem)
  throw new ForbiddenException(r.erro.mensagem)
}

function umaSo(todas: TarefasAfetadas['todas']): TarefasAfetadas {
  const tarefa = todas[0]
  if (tarefa === undefined) throw new NotFoundException('Tarefa não encontrada.')
  return { tarefa, todas }
}
