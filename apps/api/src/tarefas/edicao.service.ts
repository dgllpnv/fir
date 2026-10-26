import type { EditarTarefa, ExclusaoDeTarefa, TarefasAfetadas } from '@fir/contracts'
import {
  diaCivil,
  ehOk,
  ehSessao,
  instanteDaConclusao,
  podeEditar,
  podeExcluir,
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
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO } from '../comum/relogio'
import { unidadeValida } from '../comum/unidade'
import { SESSAO_NAO_SE_EXCLUI } from '../programas/mensagens'
import { type AutorDaRequisicao, lerTarefas } from './leitura'
import { exigirDominio } from './tarefas.service'

/**
 * Editar e excluir moram no mesmo arquivo porque são o mesmo lugar na tela —
 * *"Excluir (dentro de Editar)"*, MANUAL cap. 4 — e, sobretudo, porque o
 * ALCANCE DA SÉRIE é idêntico nas duas: as ocorrências **abertas** com
 * `prazo >= o desta`. Implementá-lo duas vezes é como ele diverge, e o
 * sintoma seria uma exclusão que leva junto a consulta de ontem.
 */
const ALCANCE_DA_SERIE = `
  serie_id = $1 AND id <> $2 AND status = 'aberta' AND prazo >= $3::date AND excluida_em IS NULL`

type TarefaCarregada = {
  readonly id: string
  readonly solicitanteId: string
  readonly responsavelId: string
  readonly status: StatusDeTarefa
  readonly tipo: string
  readonly pacienteId: string | null
  readonly prazo: string
  readonly serieId: string | null
}

async function carregar(c: pg.PoolClient, id: string): Promise<TarefaCarregada> {
  const r = await c.query<{
    id: string
    solicitante_id: string
    responsavel_id: string
    status: StatusDeTarefa
    tipo: string
    paciente_id: string | null
    prazo: string
    serie_id: string | null
  }>(
    `SELECT id, solicitante_id, responsavel_id, status, tipo, paciente_id,
            prazo::text AS prazo, serie_id
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
    pacienteId: l.paciente_id,
    prazo: l.prazo,
    serieId: l.serie_id,
  }
}

function exigirAutorizacao(r: Result<void>): void {
  if (ehOk(r)) return
  throw new ForbiddenException(r.erro.mensagem)
}

@Injectable()
export class EdicaoDeTarefasService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async editar(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    autor: AutorDaRequisicao,
    id: string,
    dados: EditarTarefa,
  ): Promise<TarefasAfetadas> {
    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, fuso)

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const t = await carregar(c, id)
      exigirAutorizacao(podeEditar(t, autor))

      const campos: string[] = []
      const params: unknown[] = [id]
      const por = (coluna: string, valor: unknown): void => {
        params.push(valor)
        campos.push(`${coluna} = $${params.length}`)
      }

      if (dados.responsavelId !== undefined) {
        const r = await c.query<{ ativo: boolean }>('SELECT ativo FROM pessoas WHERE id = $1', [
          dados.responsavelId,
        ])
        if (r.rowCount === 0 || r.rows[0]!.ativo !== true) {
          throw new BadRequestException('Escolha um responsável ativo.')
        }
        por('responsavel_id', dados.responsavelId)
      }

      // O paciente e o tipo andam JUNTOS. A `CHECK tipo_exige_paciente` do
      // banco diz `(paciente_id IS NULL) = (tipo = '')`, e ela é a razão: uma
      // tarefa com tipo de contato e sem paciente é um atendimento sem
      // ninguém, e um paciente sem tipo some de todo filtro por tipo.
      const pacienteDepois =
        dados.pacienteId === undefined ? t.pacienteId : (dados.pacienteId ?? null)
      if (dados.pacienteId !== undefined) {
        if (dados.pacienteId !== null) {
          const p = await c.query('SELECT 1 FROM pacientes WHERE id = $1 AND ativo', [
            dados.pacienteId,
          ])
          if (p.rowCount === 0) throw new BadRequestException('Paciente não encontrado.')
        }
        por('paciente_id', pacienteDepois)
        // Trocar o paciente limpa o vínculo com o programa — `Code.gs:519`,
        // "sessão pendurada no paciente errado é dose no frasco errado".
        // `adesao_id` e `sessao` ainda NÃO EXISTEM nesta migration (épico 5);
        // quem as acrescentar precisa limpá-las AQUI.
      }

      if (dados.tipo !== undefined) {
        if (pacienteDepois === null) {
          throw new BadRequestException('Tipo de contato só existe em tarefa de paciente.')
        }
        por('tipo', dados.tipo)
      } else if (pacienteDepois === null && t.pacienteId !== null) {
        // Tirou o paciente: o tipo sai junto, senão o `CHECK` recusa com um
        // erro de banco em vez de uma mensagem de tela.
        por('tipo', '')
      } else if (pacienteDepois !== null && t.pacienteId === null) {
        throw new BadRequestException('Escolha o tipo de contato do paciente.')
      }

      if (dados.descricao !== undefined) por('descricao', dados.descricao)
      if (dados.prazo !== undefined) por('prazo', dados.prazo)
      if (dados.hora !== undefined) por('hora', dados.hora ?? null)
      if (dados.prioridade !== undefined) por('prioridade', dados.prioridade)
      if (dados.obs !== undefined) por('obs', dados.obs)
      if (dados.resultado !== undefined) por('resultado', dados.resultado)
      if (dados.unidadeId !== undefined) {
        por('unidade_id', await unidadeValida(c, dados.unidadeId))
      }

      if (dados.realizadaEm !== undefined) {
        // EDITAR NÃO CONCLUI. Acertar a data de realização de uma tarefa que
        // nunca foi concluída seria concluí-la pela porta dos fundos — e é
        // por essa porta que o `atualizarTarefa` da v20 perdeu a lista branca.
        if (t.status !== 'concluida') {
          throw new BadRequestException(
            'A data de realização só vale para tarefa já concluída. Conclua a tarefa primeiro.',
          )
        }
        por('concluida_em', exigirDominio(instanteDaConclusao(dados.realizadaEm, hoje, fuso, agora)))
      }

      if (campos.length > 0) {
        await c.query(`UPDATE tarefas SET ${campos.join(', ')} WHERE id = $1`, params)
      }

      const ids = [id]
      if (dados.serie && t.serieId !== null) {
        ids.push(...(await this.propagarNaSerie(c, t, dados)))
      }
      const todas = await lerTarefas(c, clinicaId, hoje, ids)
      const tarefa = todas.find((x) => x.id === id)
      if (tarefa === undefined) throw new NotFoundException('Tarefa não encontrada.')
      return { tarefa, todas }
    })
  }

  /**
   * As próximas da série andam junto — num `UPDATE` só.
   *
   * O deslocamento é `prazo + (novo − original)`, **não** uma recorrência
   * recalculada: quem adiou a consulta de sexta para segunda adiou as
   * próximas em 3 dias, não mudou a frequência da série. É a regra do
   * protótipo (`addDays(x.prazo, delta)`), e ela preserva um intervalo
   * irregular que alguém tenha ajustado à mão.
   *
   * Em UM comando porque 150 ocorrências em 150 idas ao banco é o que trava a
   * tela no celular da recepção. `obs`, `resultado`, `unidade_id` e a data de
   * realização NÃO propagam — são fatos desta ocorrência, e a tela diz isso
   * em letra miúda.
   */
  private async propagarNaSerie(
    c: pg.PoolClient,
    t: TarefaCarregada,
    dados: EditarTarefa,
  ): Promise<string[]> {
    const campos = [
      // O prazo se desloca pelo MESMO número de dias, sempre: quando o prazo
      // não mudou, a diferença é zero e a coluna fica onde estava.
      `prazo = prazo + ($4::date - $3::date)`,
    ]
    const params: unknown[] = [t.serieId, t.id, t.prazo, dados.prazo ?? t.prazo]
    const por = (coluna: string, valor: unknown): void => {
      params.push(valor)
      campos.push(`${coluna} = $${params.length}`)
    }

    if (dados.responsavelId !== undefined) por('responsavel_id', dados.responsavelId)
    if (dados.descricao !== undefined) por('descricao', dados.descricao)
    if (dados.hora !== undefined) por('hora', dados.hora ?? null)
    if (dados.prioridade !== undefined) por('prioridade', dados.prioridade)
    if (dados.pacienteId !== undefined) {
      por('paciente_id', dados.pacienteId ?? null)
      por('tipo', dados.pacienteId === null ? '' : (dados.tipo ?? t.tipo))
    } else if (dados.tipo !== undefined) {
      por('tipo', dados.tipo)
    }

    const r = await c.query<{ id: string }>(
      `UPDATE tarefas SET ${campos.join(', ')} WHERE ${ALCANCE_DA_SERIE} RETURNING id`,
      params,
    )
    return r.rows.map((x) => x.id)
  }

  /**
   * Excluir é SOFT DELETE, contra a v20 que faz `sh.deleteRow`.
   *
   * A razão é a da regra 20, e é a mesma da ADR 0003: a tarefa que alguém
   * excluiu "por engano" às vezes é a que tinha o pagamento. O que sai da
   * tela é o registro; o que fica no banco é a prova.
   */
  async excluir(
    clinicaId: ClinicaId,
    ator: Ator,
    autor: AutorDaRequisicao,
    id: string,
    serie: boolean,
  ): Promise<ExclusaoDeTarefa> {
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const t = await carregar(c, id)
      // O responsável NÃO exclui: ele conserta o que vai executar, e não apaga
      // o que outra pessoa pediu.
      exigirAutorizacao(podeExcluir(t, autor))

      /**
       * **EXCLUIR UMA SESSÃO É RECUSADO** (decisão P-6 do épico 5).
       *
       * Apagar a sessão 5/12 abre buraco na numeração, e a numeração é o que a
       * reprogramação usa para saber o que vem depois: com 5 ausente, a 6 em
       * diante seriam recalculadas a partir de uma distância errada, e a série
       * inteira escorregaria sem nenhum erro na tela.
       *
       * A mensagem dá as DUAS saídas que existem, em português de balcão.
       */
      if (ehSessao(t)) throw new ConflictException(SESSAO_NAO_SE_EXCLUI)

      const pago = await c.query(
        'SELECT 1 FROM recebimentos WHERE tarefa_id = $1 AND estornado_em IS NULL',
        [id],
      )
      if (pago.rowCount !== 0) {
        // Sumir com a tarefa deixaria o dinheiro contando receita sem origem
        // visível na ficha. A saída existe e é curta: reabrir estorna.
        throw new ConflictException(
          'Esta tarefa tem um pagamento registrado. Reabra a tarefa para estornar o pagamento e exclua depois.',
        )
      }

      const ids = [id]
      if (serie && t.serieId !== null) {
        // As ocorrências alcançadas estão ABERTAS, logo nenhuma delas tem
        // recebimento vivo — recebimento só nasce ao concluir.
        const r = await c.query<{ id: string }>(
          `UPDATE tarefas SET excluida_em = now() WHERE ${ALCANCE_DA_SERIE} RETURNING id`,
          [t.serieId, t.id, t.prazo],
        )
        ids.push(...r.rows.map((x) => x.id))
      }
      await c.query('UPDATE tarefas SET excluida_em = now() WHERE id = $1', [id])
      return { id, ids }
    })
  }
}
