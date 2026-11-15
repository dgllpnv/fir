import type { EditarTarefa, ExclusaoDeTarefa, PrevisaoDeExclusao, TarefasAfetadas } from '@fir/contracts'
import {
  diaCivil,
  ehOk,
  ehPagamento,
  ehSessao,
  instanteDaConclusao,
  podeEditar,
  podeExcluir,
  type Relogio,
  type Result,
  TIPO_PAGAMENTO_DE_ORCAMENTO,
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
import { declararMotivo, motivoDaAcao } from '../comum/motivo-de-suporte'
import { RELOGIO } from '../comum/relogio'
import { campanhaParaVincular } from '../campanhas/vinculo'
import { unidadeValida } from '../comum/unidade'
import { SESSAO_NAO_SE_EXCLUI } from '../programas/mensagens'
import { comGrupos } from './grupos-do-autor'
import { type AutorDaRequisicao, lerTarefas, type LeitorDaRequisicao } from './leitura'
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
  readonly responsavelId: string | null
  readonly grupoId: string | null
  readonly grupoAtivo: boolean | undefined
  readonly status: StatusDeTarefa
  readonly tipo: string
  readonly pacienteId: string | null
  readonly prazo: string
  readonly serieId: string | null
  readonly campanhaId: string | null
}

async function carregar(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  id: string,
): Promise<TarefaCarregada> {
  const r = await c.query<{
    id: string
    solicitante_id: string
    responsavel_id: string | null
    grupo_id: string | null
    grupo_ativo: boolean | null
    status: StatusDeTarefa
    tipo: string
    paciente_id: string | null
    prazo: string
    serie_id: string | null
    campanha_id: string | null
  }>(
    `SELECT t.id, t.solicitante_id, t.responsavel_id, t.grupo_id,
            (SELECT g.ativo FROM grupos_da_equipe g
              WHERE g.id = t.grupo_id AND g.clinica_id = t.clinica_id) AS grupo_ativo,
            t.status, t.tipo, t.paciente_id,
            t.prazo::text AS prazo, t.serie_id, t.campanha_id::text AS campanha_id
       FROM tarefas t
      -- A clínica TAMBÉM no filtro: a RLS é a primeira camada, não a única
      -- (regra 19). É o mesmo filtro de \`carregarCartao\` (jornada/cartao.ts).
      WHERE t.id = $1 AND t.clinica_id = $2 AND t.excluida_em IS NULL FOR UPDATE OF t`,
    [id, clinicaId],
  )
  const l = r.rows[0]
  if (l === undefined) throw new NotFoundException('Tarefa não encontrada.')
  return {
    id: l.id,
    solicitanteId: l.solicitante_id,
    responsavelId: l.responsavel_id,
    grupoId: l.grupo_id,
    grupoAtivo: l.grupo_ativo ?? undefined,
    status: l.status,
    tipo: l.tipo,
    pacienteId: l.paciente_id,
    prazo: l.prazo,
    serieId: l.serie_id,
    campanhaId: l.campanha_id,
  }
}

async function exigirCadeiaDoMesmoPaciente(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  id: string,
  pacienteDepois: string | null,
): Promise<void> {
  const origem = await c.query<{ paciente_id: string | null }>(
    `SELECT o.paciente_id FROM tarefas x
       JOIN tarefas o ON o.id = x.tarefa_origem_id AND o.clinica_id = x.clinica_id
      WHERE x.id = $1 AND x.clinica_id = $2`,
    [id, clinicaId],
  )
  const doPaciente = origem.rows[0]?.paciente_id ?? null
  if (doPaciente !== null && doPaciente !== pacienteDepois) {
    throw new BadRequestException(
      'Esta tarefa nasceu de outra, de outro paciente. Ela não pode mudar de paciente.',
    )
  }
  if (pacienteDepois !== null) {
    const filhas = await c.query(
      `SELECT 1 FROM tarefas f
        WHERE f.tarefa_origem_id = $1 AND f.clinica_id = $2
          AND f.paciente_id IS DISTINCT FROM $3::uuid LIMIT 1`,
      [id, clinicaId, pacienteDepois],
    )
    if (filhas.rowCount !== 0) {
      throw new BadRequestException(
        'Há tarefas derivadas desta, de outro paciente. Ela não pode mudar de paciente.',
      )
    }
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
      const t = await carregar(c, clinicaId, id)
      exigirAutorizacao(podeEditar(t, await comGrupos(c, clinicaId, autor)))

      const campos: string[] = []
      const params: unknown[] = [id]
      const por = (coluna: string, valor: unknown): void => {
        params.push(valor)
        campos.push(`${coluna} = $${params.length}`)
      }

      if (dados.responsavelId !== undefined) {
        // Tarefa de GRUPO muda de dono por Assumir ou Transferir, que conferem
        // quem pode e deixam o evento: trocar `responsavel_id` aqui violaria
        // `tarefa_tem_destino` (e burlaria a trilha do fluxo).
        if (t.grupoId !== null) {
          throw new BadRequestException(
            'Esta tarefa é de um grupo. Para mudar quem faz, use Transferir ou Assumir.',
          )
        }
        // `clinica_id` também na aplicação: a RLS é a primeira camada, não a única.
        const r = await c.query<{ ativo: boolean }>(
          'SELECT ativo FROM pessoas WHERE id = $1 AND clinica_id = $2',
          [dados.responsavelId, clinicaId],
        )
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
        // A cadeia de tarefas (fluxo) nunca cruza de um paciente para outro (S2). O
        // trigger da 0089 é a última camada; aqui a mensagem é de tela.
        await exigirCadeiaDoMesmoPaciente(c, clinicaId, id, pacienteDepois)
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

      /**
       * A CAMPANHA, em três estados (N-4): ausente MANTÉM, `null` remove, um
       * id troca. Reenviar a atual passa mesmo que ela esteja encerrada há 90
       * dias ou excluída — é "não mexi", e recusá-lo tiraria a receita dela.
       *
       * Trocar a campanha de uma tarefa JÁ PAGA é permitido (N-5, decisão do
       * coordenador seguindo o protótipo, L1654): o recebimento passa inteiro
       * para a nova campanha, e a soma das campanhas não muda — a coluna é uma
       * só. A troca fica na trilha pelo trigger de `tarefas` (de → para, ids).
       */
      if (dados.campanhaId !== undefined) {
        por(
          'campanha_id',
          await campanhaParaVincular(c, {
            clinicaId,
            campanhaId: dados.campanhaId,
            contexto: 'tarefa',
            agora,
            fuso,
            atual: t.campanhaId,
          }),
        )
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
      const todas = await lerTarefas(c, clinicaId, hoje, ids, autor.podeJornada)
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
    // A campanha propaga para as próximas da série, como no protótipo (L1668).
    // Já validada acima, contra a campanha atual DESTA ocorrência.
    if (dados.campanhaId !== undefined) por('campanha_id', dados.campanhaId)
    if (dados.pacienteId !== undefined) {
      por('paciente_id', dados.pacienteId ?? null)
      por('tipo', dados.pacienteId === null ? '' : (dados.tipo ?? t.tipo))
    } else if (dados.tipo !== undefined) {
      por('tipo', dados.tipo)
    }

    const r = await c.query<{ id: string }>(
      // `grupo_id IS NULL` quando troca o responsável: a série pode ter ocorrência
      // de grupo (`tarefa_tem_destino`), e essa só muda por Transferir.
      `UPDATE tarefas SET ${campos.join(', ')} WHERE ${ALCANCE_DA_SERIE}${
        dados.responsavelId === undefined ? '' : ' AND grupo_id IS NULL'
      } RETURNING id`,
      params,
    )
    return r.rows.map((x) => x.id)
  }

  /**
   * O que a exclusão vai desfazer, para a confirmação em dois passos da tela.
   * `valor` é redigido pelo interceptor sem `valores`: a equipe lê o aviso
   * sem o número.
   */
  async previaDaExclusao(
    clinicaId: ClinicaId,
    ator: Ator,
    autor: LeitorDaRequisicao,
    id: string,
  ): Promise<PrevisaoDeExclusao> {
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const t = await carregar(c, clinicaId, id)
      exigirAutorizacao(podeExcluir(t, autor))
      const e = await efeitoDaExclusao(c, id)
      return {
        temPagamento: e.temPagamento,
        temPrograma: e.programas.length > 0,
        valor: e.temPagamento ? e.valor.toString() : null,
        // O servidor diz à tela se a exclusão pede justificativa: só o operador.
        exigeMotivo: typeof ator === 'object' && ator.tipo === 'operador',
      }
    })
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
    autor: LeitorDaRequisicao,
    id: string,
    serie: boolean,
    quem: { readonly podeReceber: boolean; readonly motivo?: string },
  ): Promise<ExclusaoDeTarefa> {
    // Sessão de suporte: sem motivo, 400 antes de abrir a transação (I1).
    const motivo = motivoDaAcao(ator, quem.motivo)
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      await declararMotivo(c, motivo)
      // `carregar` já trava a tarefa (FOR UPDATE): duas exclusões simultâneas
      // se enfileiram, e a segunda vê `excluida_em` e dá 404 (I2').
      const t = await carregar(c, clinicaId, id)
      // O programa de origem também, ANTES de ler o efeito: `efeitoDaExclusao`
      // decide "há outros pagamentos?" por leitura, e uma cobrança do programa
      // gravada entre a leitura e o `UPDATE programas` passaria despercebida e
      // o programa seria encerrado com dinheiro vivo nele. O `FOR UPDATE` conflita
      // com o `FOR KEY SHARE` que o INSERT em `recebimentos` (FK `programa_id`)
      // toma: a cobrança espera esta transação, ou é vista por ela.
      await c.query(
        'SELECT id FROM programas WHERE tarefa_de_origem_id = $1 AND excluido_em IS NULL FOR UPDATE',
        [id],
      )
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

      const efeito = await efeitoDaExclusao(c, id)
      if (efeito.temPagamento || efeito.programas.length > 0) {
        // Excluir tarefa com dinheiro ESTORNA o dinheiro: é a mesma permissão de
        // quem registra o recebimento. `podeExcluir` (acima) só diz se a pessoa
        // pode mexer na tarefa; não diz se pode mexer no caixa.
        if (!quem.podeReceber) {
          throw new ForbiddenException(
            efeito.temPagamento
              ? 'Esta tarefa tem um pagamento registrado. Quem exclui precisa da permissão de receber, porque o pagamento será estornado. Peça a quem tem essa permissão.'
              : 'Esta tarefa gerou um programa. Quem exclui precisa da permissão de receber, porque o programa será encerrado junto com o orçamento. Peça a quem tem essa permissão.',
          )
        }
        if (efeito.outrosPagamentosDoPrograma) {
          throw new ConflictException(
            mensagemDeOutrosPagamentos(efeito.outrosAvulsos, efeito.outrosEmbutidos),
          )
        }
        // Soft delete, nunca DELETE (regra 20): a trilha registra quem estornou.
        await c.query(
          'UPDATE recebimentos SET estornado_em = now() WHERE id = ANY($1::uuid[]) AND estornado_em IS NULL',
          [efeito.recebimentos],
        )
        // A tarefa "Pagamento de orçamento" só existe para dar linha do tempo
        // ao dinheiro estornado, como em RecebimentosService.estornar.
        if (efeito.companheiras.length > 0) {
          await c.query('UPDATE tarefas SET excluida_em = now() WHERE id = ANY($1::uuid[])', [
            efeito.companheiras,
          ])
        }
        if (efeito.programas.length > 0) {
          // ARQUIVA, nunca apaga: mesma semântica de ProgramasService.encerrar
          // (sessões feitas e baixas de estoque ficam; as abertas são
          // canceladas). Nenhum movimento de estoque é tocado: o consumo
          // aconteceu, e a regra 12 só pede compensação em reabertura de sessão.
          await c.query(
            `UPDATE programas
                SET situacao = 'encerrado', encerrado_em = now(), motivo_encerramento = $2
              WHERE id = ANY($1::uuid[]) AND situacao = 'ativo'`,
            [efeito.programas, 'Tarefa de origem excluída'],
          )
          await c.query(
            `UPDATE tarefas SET status = 'cancelada', obs = $2
              WHERE programa_id = ANY($1::uuid[]) AND status = 'aberta' AND excluida_em IS NULL
                AND id <> $3`,
            [efeito.programas, 'Programa encerrado', id],
          )
        }
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

export type EfeitoDaExclusao = {
  readonly temPagamento: boolean
  readonly recebimentos: readonly string[]
  readonly companheiras: readonly string[]
  readonly programas: readonly string[]
  /** Soma do que entrou (não o valor em aberto). */
  readonly valor: bigint
  /** Pagamento vivo do programa que NÃO é o da adesão (cobrança, sessão avulsa). */
  readonly outrosPagamentosDoPrograma: boolean
  /** Desses, os AVULSOS (cobrança): se estornam em Financeiro › Recebimentos. */
  readonly outrosAvulsos: boolean
  /** E os EMBUTIDOS em atendimento ou sessão: Recebimentos recusa estornar esses. */
  readonly outrosEmbutidos: boolean
}

/**
 * O caminho REAL de cada tipo de pagamento que bloqueia a exclusão (I6).
 *
 * O texto antigo mandava estornar tudo em Financeiro › Recebimentos, mas lá o
 * estorno recusa o pagamento que está DENTRO de um atendimento ou sessão ("para
 * desfazê-lo, reabra o atendimento"). A pessoa seguia a instrução e batia numa
 * segunda recusa. Aqui cada tipo diz a sua saída.
 */
function mensagemDeOutrosPagamentos(avulsos: boolean, embutidos: boolean): string {
  const base = 'O programa criado por este orçamento já tem outros pagamentos.'
  const avulso = 'Estorne os pagamentos avulsos em Financeiro › Recebimentos'
  const embutido =
    'desfaça os que estão dentro de um atendimento ou sessão reabrindo esse atendimento'
  if (avulsos && embutidos) return `${base} ${avulso} e ${embutido}. Depois, exclua a tarefa.`
  if (embutidos) {
    return `${base} Eles estão dentro de um atendimento ou sessão do programa: reabra esse atendimento para desfazer o pagamento. Depois, exclua a tarefa.`
  }
  return `${base} Estorne-os em Financeiro › Recebimentos antes de excluir a tarefa.`
}

/**
 * O que excluir esta tarefa desfaz: os recebimentos vivos dela, o da tarefa
 * companheira "Pagamento de orçamento" e os programas que ela criou.
 *
 * A companheira não aponta para o orçamento; ela é reconhecida pelo EVENTO
 * `fechar` do histórico do cartão: o fechamento carimba o mesmo instante no
 * evento e na `concluida_em` da companheira, e o paciente é o mesmo. Isso
 * vale com ou sem programa. Pagamento posterior do mesmo programa NÃO é
 * estornado em silêncio — bloqueia a exclusão.
 */
export async function efeitoDaExclusao(c: pg.PoolClient, id: string): Promise<EfeitoDaExclusao> {
  return lerEfeito(c, id, false)
}

/**
 * O que desfazer SÓ O ORÇAMENTO desfaz (Reabrir / Excluir orçamento) — a
 * consulta fica, e o pagamento DELA também (achado F5; regra 3).
 *
 * Difere de `efeitoDaExclusao` num ponto só: o recebimento embutido na própria
 * tarefa conta como do fechamento apenas se o FECHAMENTO o gravou — e o
 * fechamento o reconhece por dois carimbos dele:
 *
 *  - `recebido_em` igual ao `em` de um evento `fechar` (o fechamento grava os
 *    dois com o mesmo instante, `agora`), ou
 *  - `programa_id` de um programa que esta tarefa criou (a adesão).
 *
 * E nunca quando o fechamento usou a companheira "Pagamento de orçamento"
 * (reconhecida pelo `concluida_em` do mesmo evento): ele só a cria quando a
 * tarefa JÁ tinha o pagamento dela, então o recebimento da tarefa é da
 * consulta. Esta segunda guarda não depende de relógio — os carimbos de
 * instante sozinhos confundiriam a consulta concluída "hoje" no mesmo instante
 * do fechamento.
 */
export async function efeitoDoDesfazerOrcamento(
  c: pg.PoolClient,
  id: string,
): Promise<EfeitoDaExclusao> {
  return lerEfeito(c, id, true)
}

async function lerEfeito(
  c: pg.PoolClient,
  id: string,
  soDoFechamento: boolean,
): Promise<EfeitoDaExclusao> {
  const progs = await c.query<{ id: string }>(
    'SELECT id FROM programas WHERE tarefa_de_origem_id = $1 AND excluido_em IS NULL',
    [id],
  )
  const programas = progs.rows.map((p) => p.id)
  const r = await c.query<{
    id: string
    valor: string
    tarefa_id: string | null
    tipo: string
    da_adesao: boolean
    do_programa: boolean
  }>(
    `SELECT r.id, r.valor::text AS valor, r.tarefa_id, r.tipo,
            ((r.tarefa_id = o.id
              AND (NOT $4::boolean
                   OR ((coalesce(r.programa_id = ANY($2::uuid[]), false)
                        OR EXISTS (SELECT 1 FROM jsonb_array_elements(o.historico) f
                                    WHERE f->>'acao' = 'fechar'
                                      AND (f->>'em')::timestamptz = r.recebido_em))
                       -- O fechamento pôs o dinheiro numa companheira VIVA: então a
                       -- tarefa já estava paga, e o recebimento dela é da CONSULTA.
                       AND NOT EXISTS (
                         SELECT 1 FROM tarefas tc
                           JOIN recebimentos rc ON rc.tarefa_id = tc.id AND rc.estornado_em IS NULL
                          WHERE tc.tipo = $3 AND tc.paciente_id = o.paciente_id
                            AND tc.excluida_em IS NULL
                            AND EXISTS (SELECT 1 FROM jsonb_array_elements(o.historico) f2
                                         WHERE f2->>'acao' = 'fechar'
                                           AND (f2->>'em')::timestamptz = tc.concluida_em)))))
             OR (tt.tipo = $3 AND tt.paciente_id = o.paciente_id AND EXISTS (
                   SELECT 1 FROM jsonb_array_elements(o.historico) e
                    WHERE e->>'acao' = 'fechar'
                      AND (e->>'em')::timestamptz = tt.concluida_em))) AS da_adesao,
            coalesce(r.programa_id = ANY($2::uuid[]), false) AS do_programa
       FROM recebimentos r
       JOIN tarefas o ON o.id = $1
       LEFT JOIN tarefas tt ON tt.id = r.tarefa_id
      WHERE r.estornado_em IS NULL
        AND (r.tarefa_id = o.id
             OR r.programa_id = ANY($2::uuid[])
             OR (tt.tipo = $3 AND tt.paciente_id = o.paciente_id AND tt.excluida_em IS NULL))`,
    [id, programas, TIPO_PAGAMENTO_DE_ORCAMENTO, soDoFechamento],
  )
  const dela = r.rows.filter((x) => x.da_adesao)
  return {
    temPagamento: dela.length > 0,
    recebimentos: dela.map((x) => x.id),
    companheiras: [
      ...new Set(dela.map((x) => x.tarefa_id).filter((x): x is string => x !== null && x !== id)),
    ],
    programas,
    valor: dela.reduce((s, x) => s + BigInt(x.valor), 0n),
    outrosPagamentosDoPrograma: r.rows.some((x) => !x.da_adesao && x.do_programa),
    outrosAvulsos: r.rows.some((x) => !x.da_adesao && x.do_programa && ehPagamento(x.tipo)),
    outrosEmbutidos: r.rows.some((x) => !x.da_adesao && x.do_programa && !ehPagamento(x.tipo)),
  }
}
