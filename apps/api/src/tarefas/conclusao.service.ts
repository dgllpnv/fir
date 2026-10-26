import type { Cancelar, Concluir, TarefasAfetadas } from '@fir/contracts'
import {
  type AcaoDeJornada,
  anexar,
  diaCivil,
  ehErro,
  ehOk,
  ehSessao,
  type Etapa,
  ETAPA_AO_CANCELAR,
  type EventoDeJornada,
  instanteDaConclusao,
  podeCancelar,
  podeConcluir,
  podeEditar,
  type Relogio,
  type Result,
  type StatusDeTarefa,
  statusDaEtapa,
  tipoAoConcluir,
  transicao,
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
import { SESSAO_PELA_ROTA_PROPRIA } from '../programas/mensagens'
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
  readonly historico: EventoDeJornada[]
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
    historico: EventoDeJornada[]
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

      /**
       * **A ROTA GENÉRICA RECUSA UMA SESSÃO** (decisão P-5 do épico 5).
       *
       * Concluir uma sessão faz quatro coisas que concluir uma tarefa não faz:
       * reprograma as próximas, dá baixa nos insumos, cria o contato de retorno
       * na última do item, e carimba `programa_id` no recebimento. Passar por
       * aqui faria três delas simplesmente não acontecer — sem erro nenhum.
       *
       * A mensagem diz o MOTIVO, não a rota: a recepção não lê URL.
       */
      if (ehSessao(t)) throw new ConflictException(SESSAO_PELA_ROTA_PROPRIA)

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
        historico = [...anexar(historico, evento('concluir', 'realizado', concluidaEm, autor.id))]
      } else if (t.pacienteId !== null && TIPOS_REALIZADOS.includes(t.tipo)) {
        etapa = 'realizado'
        historico = [...anexar(historico, evento('concluir', 'realizado', concluidaEm, autor.id))]
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

      /**
       * CANCELAR UM CARTÃO DA JORNADA O ENCERRA — a outra porta do `encerrar`.
       *
       * Antes da migration 0007, esta rota gravava `status = 'cancelada'` sem
       * tocar em `etapa`, e o cartão ficava `agendado`/`cancelada`: para saber
       * onde ele está, a tela tinha de consultar DUAS colunas. É o que o
       * protótipo faz, e é por isso que lá o cartão só sai do Recontatar
       * porque uma segunda coluna é lida.
       *
       * Não é a ação `encerrar` da rota da jornada: a autorização é outra
       * (`podeCancelar`, de quem solicitou) e esta porta alcança `agendado` e
       * `confirmado`, que `encerrar` não alcança. O resultado, porém, não é
       * escolha: existe EXATAMENTE UMA etapa com `status = 'cancelada'`, e o
       * `CHECK etapa_combina_com_status` recusaria qualquer outra.
       */
      const daJornada = t.etapa !== null
      const etapa = daJornada ? ETAPA_AO_CANCELAR : null
      const historico = daJornada
        ? anexar(
            t.historico,
            evento('encerrar', ETAPA_AO_CANCELAR, this.relogio.agora(), autor.id, dados.obs),
          )
        : t.historico

      await c.query(
        `UPDATE tarefas
            SET status = 'cancelada', concluida_em = NULL, obs = coalesce($2, obs),
                etapa = $3::etapa_de_jornada, historico = $4::jsonb
          WHERE id = $1`,
        [id, dados.obs ?? null, etapa, JSON.stringify(historico)],
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
   * `tipo` fica como está — "Consulta realizada" não volta a ser "Consulta
   * agendada", porque o atendimento aconteceu e a descrição da recepção ficou
   * escrita em cima dele.
   *
   * A `etapa`, a partir da 0007, TEM de voltar: o `CHECK` não aceita um
   * cartão `realizado` com `status = 'aberta'`. Para onde ela volta é decisão
   * da máquina de estados (`transicao(…, 'reabrir')`) e vem do HISTÓRICO —
   * quem faltou e foi concluído por engano volta para `faltou`, e o cartão
   * reaparece no Recontatar, que é onde ele estava. O histórico CRESCE com o
   * evento de reabertura: apagar a entrada da conclusão seria apagar o que de
   * fato aconteceu.
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

      const voltaPara = etapaAoReabrir(t)
      await c.query(
        `UPDATE tarefas
            SET status = 'aberta', concluida_em = NULL,
                etapa = $2::etapa_de_jornada, historico = $3::jsonb
          WHERE id = $1`,
        [
          id,
          voltaPara,
          JSON.stringify(
            voltaPara === null
              ? t.historico
              : anexar(t.historico, evento('reabrir', voltaPara, this.relogio.agora(), autor.id)),
          ),
        ],
      )
      return umaSo(await lerTarefas(c, clinicaId, hoje, [id]))
    })
  }
}

/**
 * Para onde `reabrir` devolve a etapa — ou `null`, se a tarefa não é da
 * jornada e nunca teve etapa.
 *
 * A decisão é da máquina de estados, nunca daqui: `transicao(…, 'reabrir')`
 * olha o histórico e devolve a última etapa que estava EM ABERTO. Um
 * `etapa = 'agendado'` escrito à mão neste serviço mandaria para o Recontatar
 * quem nunca faltou, e tiraria dele quem faltou.
 *
 * Falha FECHADO: se a máquina recusar — um dado migrado com o par
 * `etapa ↔ status` impossível, que o `CHECK` da 0007 não deixa mais nascer —
 * a reabertura é 409, não um palpite.
 */
function etapaAoReabrir(t: TarefaCarregada): Etapa | null {
  if (t.etapa === null) return null
  const etapa = t.etapa as Etapa
  const r = transicao({ etapa, status: t.status, historico: t.historico }, 'reabrir')
  if (ehErro(r)) throw new ConflictException(r.erro.mensagem)
  // Cinto e suspensório: a tabela diz `aberta`, e o `CHECK` do banco cobra o
  // mesmo. Se as duas declarações divergirem, é melhor estourar aqui.
  if (statusDaEtapa(r.valor.etapa) !== 'aberta') {
    throw new ConflictException('Não consegui reabrir este agendamento. Avise o suporte.')
  }
  return r.valor.etapa
}

const evento = (
  acao: AcaoDeJornada,
  etapa: Etapa,
  em: Date,
  porId: string,
  nota?: string,
): EventoDeJornada => ({
  acao,
  etapa,
  em: em.toISOString(),
  porId,
  ...(nota === undefined || nota === '' ? {} : { nota }),
})

/** A forma de resposta é sempre a mesma; aqui `todas` tem um elemento. */
function umaSo(todas: TarefasAfetadas['todas']): TarefasAfetadas {
  const tarefa = todas[0]
  if (tarefa === undefined) throw new NotFoundException('Tarefa não encontrada.')
  return { tarefa, todas }
}
