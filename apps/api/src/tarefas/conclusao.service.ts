import type { Cancelar, Concluir, PassoDaJornada, TarefasAfetadas } from '@fir/contracts'
import {
  diaCivil,
  ehOk,
  instanteDaConclusao,
  podeCancelar,
  podeConcluir,
  podeEditar,
  type Relogio,
  type Result,
  type StatusDeTarefa,
  tipoAoConcluir,
} from '@fir/domain'
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type pg from 'pg'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO } from '../comum/relogio'
import { type AutorDaRequisicao, lerTarefas, TIPOS_DE_AGENDA, TIPOS_REALIZADOS } from './leitura'
import { exigirDominio, registrarPagamento } from './tarefas.service'

/**
 * Concluir, cancelar e reabrir são TRÊS ROTAS porque são três coisas.
 *
 * O `atualizarTarefa` da v20 empilha as três num campo `status` — e foi assim
 * que ele ficou sem lista branca: `t.status = b.status`, qualquer string.
 * Separadas, cada uma tem a sua autorização, o seu efeito no dinheiro e o seu
 * código de erro, e nenhuma delas pode ser alcançada por engano.
 */

type TarefaCarregada = {
  readonly id: string
  readonly solicitanteId: string
  readonly responsavelId: string
  readonly status: StatusDeTarefa
  readonly tipo: string
  readonly descricao: string
  readonly pacienteId: string | null
  readonly etapa: string | null
  readonly historico: PassoDaJornada[]
  readonly unidadeId: string | null
}

/**
 * O erro de autorização vira 403; o de ESTADO vira 409.
 *
 * A diferença importa para quem está na tela: 403 significa "peça para outra
 * pessoa", e 409 significa "a tarefa não está no estado que você acha que
 * está — recarregue". Empilhar os dois em 400 faria a recepção pedir ajuda
 * para um problema que ela mesma resolve com um toque.
 */
function exigirAutorizacao(r: Result<void>): void {
  if (ehOk(r)) return
  if (r.erro.codigo === 'TAREFA_CANCELADA' || r.erro.codigo === 'TAREFA_JA_CONCLUIDA') {
    throw new ConflictException(r.erro.mensagem)
  }
  throw new ForbiddenException(r.erro.mensagem)
}

/**
 * Carrega a tarefa com `FOR UPDATE`.
 *
 * O bloqueio não é zelo: duas recepcionistas tocando o círculo da mesma
 * tarefa ao mesmo tempo chegariam as duas em "status = aberta", e a segunda
 * tentaria inserir o segundo recebimento. O índice único recusaria — e a
 * segunda veria um erro de banco em vez da mensagem certa. Com `FOR UPDATE`,
 * a segunda espera, lê "concluída" e recebe o 409 que explica.
 *
 * A RLS já filtra por clínica: a tarefa da vizinha devolve zero linhas, e
 * zero é a mesma resposta de "não existe" — que é o 404 que não confirma a
 * existência de nada.
 */
async function carregar(c: pg.PoolClient, id: string): Promise<TarefaCarregada> {
  const r = await c.query<{
    id: string
    solicitante_id: string
    responsavel_id: string
    status: StatusDeTarefa
    tipo: string
    descricao: string
    paciente_id: string | null
    etapa: string | null
    historico: PassoDaJornada[]
    unidade_id: string | null
  }>(
    `SELECT id, solicitante_id, responsavel_id, status, tipo, descricao, paciente_id,
            etapa::text AS etapa, historico, unidade_id
       FROM tarefas WHERE id = $1 AND excluida_em IS NULL FOR UPDATE`,
    [id],
  )
  const l = r.rows[0]
  if (l === undefined) throw new NotFoundException('Tarefa não encontrada.')
  return {
    id: l.id,
    solicitanteId: l.solicitante_id,
    responsavelId: l.responsavel_id,
    status: l.status,
    tipo: l.tipo,
    descricao: l.descricao,
    pacienteId: l.paciente_id,
    etapa: l.etapa,
    historico: l.historico,
    unidadeId: l.unidade_id,
  }
}

@Injectable()
export class ConclusaoService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async concluir(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    autor: AutorDaRequisicao,
    id: string,
    dados: Concluir,
  ): Promise<TarefasAfetadas> {
    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, fuso)

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const t = await carregar(c, id)
      exigirAutorizacao(podeConcluir(t, autor))
      const concluidaEm = exigirDominio(instanteDaConclusao(dados.em, hoje, fuso, agora))

      let tipo = t.tipo
      let descricao = t.descricao
      let etapa = t.etapa
      let historico = t.historico

      if (t.pacienteId !== null && TIPOS_DE_AGENDA.includes(t.tipo)) {
        // Agendado vira realizado NA MESMA TAREFA, com histórico — nunca uma
        // tarefa nova por etapa.
        tipo = tipoAoConcluir(t.tipo)
        // A descrição acompanha SÓ quando ela era o nome do tipo. Quem
        // escreveu "Consulta de retorno, trazer exames" não perde o texto.
        if (descricao === t.tipo || descricao === '') descricao = tipo
        etapa = 'realizado'
        historico = [...historico, passo(concluidaEm, autor.id)]
      } else if (t.pacienteId !== null && TIPOS_REALIZADOS.includes(t.tipo)) {
        etapa = 'realizado'
        historico = [...historico, passo(concluidaEm, autor.id)]
      }

      await c.query(
        `UPDATE tarefas
            SET status = 'concluida', concluida_em = $2, tipo = $3, descricao = $4,
                etapa = $5::etapa_de_jornada, historico = $6::jsonb, resultado = $7,
                obs = coalesce($8, obs)
          WHERE id = $1`,
        [
          id,
          concluidaEm,
          tipo,
          descricao,
          etapa,
          JSON.stringify(historico),
          dados.resultado,
          dados.obs ?? null,
        ],
      )

      if (dados.pagamento !== undefined) {
        await registrarPagamento(c, {
          clinicaId,
          pacienteId: t.pacienteId,
          tarefaId: id,
          // O tipo JÁ REALIZADO, nunca o agendado: um recebimento classificado
          // como "Consulta agendada" cai no fallback de `infoDoTipo`, não conta
          // como receita, e o faturamento do mês sai menor sem um único erro.
          tipo,
          pagamento: dados.pagamento,
          quando: concluidaEm,
          unidade: t.unidadeId,
          autor: autor.id,
        })
      }

      return umaSo(await lerTarefas(c, clinicaId, hoje, [id]))
    })
  }

  async cancelar(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    autor: AutorDaRequisicao,
    id: string,
    dados: Cancelar,
  ): Promise<TarefasAfetadas> {
    const hoje = diaCivil(this.relogio.agora(), fuso)
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const t = await carregar(c, id)
      exigirAutorizacao(podeCancelar(t, autor))
      await c.query(
        `UPDATE tarefas SET status = 'cancelada', concluida_em = NULL, obs = coalesce($2, obs)
          WHERE id = $1`,
        [id, dados.obs ?? null],
      )
      return umaSo(await lerTarefas(c, clinicaId, hoje, [id]))
    })
  }

  /**
   * Reabrir ESTORNA o recebimento embutido.
   *
   * Sem isso, reabrir uma consulta deixa o pagamento órfão contando receita de
   * um atendimento que não aconteceu — e o índice único, que só olha os
   * recebimentos vivos, impediria para sempre um pagamento novo na mesma
   * tarefa. O estorno abre UMA vaga; a regra continua valendo.
   *
   * A autorização é a de EDITAR (quem solicitou, o responsável, ou
   * `tarefas.equipe`), e não a de cancelar: reabrir é correção, e é o
   * responsável — quem atendeu — que percebe que marcou a tarefa errada. É
   * também o que o círculo do cartão do protótipo permite. `podeEditar` é a
   * única das quatro que NÃO olha o estado, que é o que esta rota precisa: a
   * tarefa aqui está concluída ou cancelada por definição.
   *
   * `etapa`, `historico` e `tipo` ficam como estão. Desfazer uma transição da
   * Jornada é `moverEtapa`, do épico 3, e apagar uma entrada do histórico
   * seria apagar o que de fato aconteceu.
   */
  async reabrir(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    autor: AutorDaRequisicao,
    id: string,
  ): Promise<TarefasAfetadas> {
    const hoje = diaCivil(this.relogio.agora(), fuso)
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const t = await carregar(c, id)
      // A autorização ANTES do estado: quem não pode mexer na tarefa não
      // merece saber em que estado ela está.
      exigirAutorizacao(podeEditar(t, autor))
      if (t.status === 'aberta') {
        throw new ConflictException('Esta tarefa já está aberta.')
      }

      // Estornar é um UPDATE, nunca um DELETE (regra 20). A linha fica, e o
      // trigger registra a mudança na trilha.
      await c.query(
        'UPDATE recebimentos SET estornado_em = now() WHERE tarefa_id = $1 AND estornado_em IS NULL',
        [id],
      )
      await c.query(
        `UPDATE tarefas SET status = 'aberta', concluida_em = NULL WHERE id = $1`,
        [id],
      )
      return umaSo(await lerTarefas(c, clinicaId, hoje, [id]))
    })
  }
}

const passo = (em: Date, por: string): PassoDaJornada => ({
  e: 'realizado',
  em: em.toISOString(),
  por,
})

/** A forma de resposta é sempre a mesma; aqui `todas` tem um elemento. */
function umaSo(todas: TarefasAfetadas['todas']): TarefasAfetadas {
  const tarefa = todas[0]
  if (tarefa === undefined) throw new NotFoundException('Tarefa não encontrada.')
  return { tarefa, todas }
}
