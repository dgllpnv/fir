import type {
  EncerrarPrograma,
  ItemNoPrograma,
  MontarPrograma,
  ProgramaEncerradoNaSaida,
  ProgramaMontadoNaSaida,
} from '@fir/contracts'
import {
  diaCivil,
  Dinheiro,
  ehErro,
  Quantidade,
  TIPO_RETORNO,
  TIPO_SESSAO,
  type ErroDeDominio,
  type Result,
} from '@fir/domain'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type pg from 'pg'
import type { PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import type { Transacao } from '../banco/transacao'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { BaixaDeInsumos } from './baixa-de-insumos'
import {
  MontadorDePrograma,
  traduzirErroDeMontagem,
  type ItemParaMontar,
  type ProgramaMontado,
} from './montador-de-programa'

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: PessoaId
  readonly fuso: string
}

/** O tipo da tarefa companheira do pagamento da adesão. */
const TIPO_DA_ADESAO = 'Pagamento de orçamento'

@Injectable()
export class ProgramasService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(MontadorDePrograma) private readonly montador: MontadorDePrograma,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    // O seam do épico 6: `excluir` desfaz as baixas das sessões que apaga,
    // por COMPENSAÇÃO (regra 12). Inerte até lá.
    @Inject(BaixaDeInsumos) private readonly baixa: BaixaDeInsumos,
  ) {}

  /**
   * `POST /v1/programas` — Nova adesão.
   *
   * O recebimento da adesão e o programa nascem na MESMA `naClinica`: o
   * montador precisa do id do recebimento para carimbar `programa_id`, e
   * nenhuma das duas escritas sobrevive sozinha. Se o montador recusar, o
   * recebimento inserido volta atrás — a diferença entre "a adesão não
   * aconteceu" e "o dinheiro entrou e as doze aplicações não existem".
   */
  async montar(ctx: Contexto, dados: MontarPrograma): Promise<ProgramaMontadoNaSaida> {
    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, ctx.fuso)

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      // A RLS já filtra: a paciente da clínica vizinha devolve zero linhas.
      const pac = await c.query('SELECT 1 FROM pacientes WHERE id = $1 AND ativo', [
        dados.pacienteId,
      ])
      if (pac.rowCount === 0) throw new NotFoundException('Paciente não encontrado.')

      const unidade = await this.unidadeValida(c, dados.unidadeId ?? null)

      let recebimentoId: string | null = null
      let modo: 'avulso' | 'saldo' = 'avulso'
      if (dados.pagamento !== undefined) {
        const aberto = dados.pagamento.valorTotal - dados.pagamento.valorEntrada
        // `saldo` quando a adesão abriu valor em aberto; `avulso` quando não.
        // Os nomes são os do `Code.gs` e do protótipo, e o migrador os copia
        // sem traduzir (regra 28).
        modo = aberto > 0n ? 'saldo' : 'avulso'
        recebimentoId = await this.lancarPagamentoDaAdesao(c, ctx, dados, aberto, agora, unidade)
      }

      const montado = await this.montador.montar(c, {
        clinicaId: ctx.clinicaId,
        pacienteId: dados.pacienteId,
        inicio: dados.inicio,
        itens: dados.itens.map(paraItemDeMontagem),
        hora: dados.hora ?? null,
        unidadeId: unidade,
        tarefaDeOrigemId: null,
        recebimentoDaAdesaoId: recebimentoId,
        valorTotal:
          dados.pagamento === undefined
            ? null
            : Dinheiro.deCentavos(dados.pagamento.valorTotal),
        modoDeCobranca: modo,
        atorId: ctx.ator,
        hojeDaClinica: hoje,
      })
      if (ehErro(montado)) throw traduzirErroDeMontagem(montado.erro)

      return this.lerMontado(c, montado.valor, modo, dados)
    })
  }

  /**
   * **ENCERRAR — a paciente parou antes do fim.**
   *
   * MANUAL cap. 8, *"Encerrar ou excluir um programa"*: encerrar é sobre a
   * paciente ter parado; excluir é sobre o registro ter sido feito por engano.
   * A diferença é de INTENÇÃO, e por isso são duas rotas:
   *
   * | | Encerrar | Excluir |
   * |---|---|---|
   * | O programa | `situacao = 'encerrado'`, com motivo | `excluido_em` |
   * | Sessões abertas | `cancelada` | `excluida_em` |
   * | Sessões realizadas | **ficam no histórico** | `excluida_em` |
   * | Estoque | **intocado** — o consumo aconteceu | compensado |
   * | Recebimentos | ficam, com `programa_id` | ficam, **sem** `programa_id` |
   *
   * O estoque intocado é o ponto: a paciente aplicou oito das doze doses, e as
   * oito saíram do frasco. Devolvê-las ao estoque porque ela desistiu faria a
   * contagem da prateleira acusar falta que ninguém explica.
   */
  async encerrar(
    ctx: Contexto,
    id: string,
    dados: EncerrarPrograma,
  ): Promise<ProgramaEncerradoNaSaida> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const p = await carregarPrograma(c, id)
      if (p.situacao === 'encerrado') {
        throw new ConflictException('Este programa já está encerrado.')
      }

      // O motivo e a observação num campo só, como o protótipo grava:
      // `motivo + (obs ? " — " + obs : "")`. O motivo É o relatório — é por
      // ele que a clínica descobre que metade das desistências é preço.
      const motivo =
        dados.obs === undefined || dados.obs === ''
          ? dados.motivo
          : `${dados.motivo} — ${dados.obs}`

      await c.query(
        `UPDATE programas
            SET situacao = 'encerrado', encerrado_em = now(), motivo_encerramento = $2
          WHERE id = $1`,
        [id, motivo.slice(0, 260)],
      )

      /**
       * AS SESSÕES ABERTAS VIRAM `cancelada`; AS REALIZADAS FICAM.
       *
       * `status = 'aberta'` no `WHERE` é a regra inteira. Uma sessão concluída
       * é um atendimento que aconteceu, e cancelá-la apagaria da ficha da
       * paciente uma aplicação que ela recebeu — além de tirar da receita um
       * pagamento que entrou.
       *
       * O mesmo `UPDATE` alcança os CONTATOS DE RETORNO abertos do programa:
       * os dois carregam `programa_id`, e quem encerrou o tratamento não deve
       * receber a ligação de "você já pode repetir".
       */
      const canceladas = await c.query<{ id: string }>(
        `UPDATE tarefas
            SET status = 'cancelada', obs = $2
          WHERE programa_id = $1 AND status = 'aberta' AND excluida_em IS NULL
          RETURNING id`,
        [id, 'Programa encerrado'],
      )

      return {
        id,
        situacao: 'encerrado' as const,
        motivoEncerramento: motivo.slice(0, 260),
        sessoesCanceladas: canceladas.rows.map((x) => x.id),
      }
    })
  }

  /**
   * **EXCLUIR — o registro foi feito por engano.**
   *
   * Soft delete, e isso é divergência dos DOIS legados: o protótipo dá
   * `splice`, o `Code.gs` dá `deleteRow`. A regra 20 vence os dois pela mesma
   * razão da ADR 0003 — a trilha de um atendimento realizado é prova, não
   * conveniência.
   *
   * **D-8, decidida pelo dono: programa com sessão PAGA não se exclui.** O
   * MANUAL manda apagar tudo "inclusive as realizadas" e desfazer as baixas; o
   * épico 2 já recusa excluir tarefa com recebimento (*"Reabra a tarefa"*), e
   * duas respostas para a mesma pergunta é como uma delas vira a errada. A
   * alternativa — estorno em cascata — deixaria alguém mudar a receita de um
   * mês fechado com um toque, e foi recusada.
   */
  async excluir(ctx: Contexto, id: string): Promise<{ id: string; ids: readonly string[] }> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      await carregarPrograma(c, id)

      /**
       * A RECUSA SAI DE UMA CONSULTA, e ela conta recebimento VIVO.
       *
       * Estornado não conta: quem já estornou fez exatamente o que a mensagem
       * pede, e recusar de novo seria um beco sem saída.
       */
      const pagas = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM recebimentos r
           JOIN tarefas t ON t.id = r.tarefa_id
          WHERE t.programa_id = $1 AND t.tipo = $2
            AND r.estornado_em IS NULL AND t.excluida_em IS NULL`,
        [id, TIPO_SESSAO],
      )
      if (Number(pagas.rows[0]!.n) > 0) {
        // A mensagem dá AS DUAS SAÍDAS. "Não é possível excluir" sozinho manda
        // a recepção pedir ajuda para um problema que ela resolve num toque.
        throw new ConflictException(
          'Há pagamentos lançados nas sessões deste programa. Estorne-os antes de ' +
            'excluir, ou use Encerrar programa.',
        )
      }

      /**
       * **A EXCLUSÃO ALCANÇA O QUE O PROGRAMA CRIOU, e nada além.**
       *
       * As SESSÕES e os CONTATOS DE RETORNO são do programa: ele os escreveu,
       * e sem ele eles não têm sentido. Vão com soft delete.
       *
       * As OUTRAS tarefas do programa — o pagamento da adesão, o cartão de
       * orçamento que o fechou, um reagendamento que alguém anotou — **não
       * são dele**: elas existiam antes, ou valem por si. O protótipo faz a
       * mesma distinção (`ids = tasks.filter(ehSessao)` para apagar,
       * `t.adesaoId = ''` para o resto), e a razão é o dinheiro: apagar a
       * tarefa do pagamento da adesão esconderia da ficha da paciente um
       * recebimento que continua contando receita.
       */
      const tarefas = await c.query<{ id: string }>(
        `UPDATE tarefas SET excluida_em = now()
          WHERE programa_id = $1 AND excluida_em IS NULL AND tipo = ANY($2)
          RETURNING id`,
        [id, [TIPO_SESSAO, TIPO_RETORNO]],
      )
      // O resto perde o vínculo e FICA, com a linha do tempo intacta.
      await c.query(
        `UPDATE tarefas SET programa_id = NULL, item_chave = NULL
          WHERE programa_id = $1 AND excluida_em IS NULL`,
        [id],
      )

      /**
       * OS RECEBIMENTOS SOBREVIVEM, PERDENDO O VÍNCULO.
       *
       * Legado: `t.adesaoId = ''`. Aqui: `programa_id = NULL`. O dinheiro não
       * some — ele volta para o grupo geral do saldo. Um recebimento apontando
       * para um programa excluído apareceria num grupo que a tela não desenha,
       * e a dívida ficaria invisível.
       */
      await c.query('UPDATE recebimentos SET programa_id = NULL WHERE programa_id = $1', [id])

      // Compensação, NUNCA `DELETE` (regra 12). O protótipo apaga os
      // movimentos (`movs.filter(…)`); essa linha não atravessa.
      for (const t of tarefas.rows) {
        const r = await this.baixa.desfazer(c, ctx.clinicaId, t.id, 'programa-excluido')
        if (ehErro(r)) throw new ConflictException(r.erro.mensagem)
      }

      // O programa por último: as consultas acima dependem dele estar lá.
      await c.query('UPDATE programas SET excluido_em = now() WHERE id = $1', [id])

      // A TAREFA DE ORIGEM não é tocada: o orçamento fechou de verdade, e
      // `fechado` é terminal (épico 3). Reabri-lo seria mudar a receita de um
      // mês que já fechou.
      return { id, ids: tarefas.rows.map((x) => x.id) }
    })
  }

  /**
   * O PAGAMENTO DA ADESÃO: uma linha de `recebimentos`, presa à tarefa
   * companheira pelo índice único do épico 2 (regra 3).
   *
   * O `Code.gs` faz `Math.round((total - ent) * 100) / 100` ao montar a
   * adesão — **essa linha não atravessa**: aqui é subtração de `bigint` de
   * centavos, e o valor em aberto é um fato imutável do evento, não um saldo
   * corrente (o saldo continua derivado, regra 5).
   *
   * A tarefa companheira dá LINHA DO TEMPO ao dinheiro: a ficha da paciente
   * é uma lista só, e um recebimento sem tarefa some dela.
   */
  private async lancarPagamentoDaAdesao(
    c: pg.PoolClient,
    ctx: Contexto,
    dados: MontarPrograma,
    aberto: bigint,
    agora: Date,
    unidade: string | null,
  ): Promise<string> {
    const pagamento = dados.pagamento!
    const tarefa = await c.query<{ id: string }>(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, prioridade,
          status, concluida_em, paciente_id, tipo, historico, unidade_id)
       VALUES ($1,$2,$2,$3,$4,'normal','concluida',$5,$6,$7,'[]',$8)
       RETURNING id`,
      [
        ctx.clinicaId,
        ctx.ator,
        'Adesão ao programa',
        diaCivil(agora, ctx.fuso),
        agora,
        dados.pacienteId,
        TIPO_DA_ADESAO,
        unidade,
      ],
    )
    const r = await c.query<{ id: string }>(
      `INSERT INTO recebimentos
         (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em,
          unidade_id, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        ctx.clinicaId,
        dados.pacienteId,
        tarefa.rows[0]!.id,
        TIPO_DA_ADESAO,
        // `bigint` vira texto no parâmetro: o driver não serializa bigint, e
        // `Number()` perderia precisão acima de 2^53 (regra 1).
        pagamento.valorEntrada.toString(),
        // D-9: sem entrada não há forma de pagamento — dinheiro que não se
        // moveu não tem como ter se movido por Pix. A string vazia é o que o
        // protótipo grava (`formaPagamento: ""`) e o que a constraint
        // `recebimento_forma_so_com_dinheiro` exige.
        pagamento.forma ?? '',
        aberto.toString(),
        agora,
        unidade,
        ctx.ator,
      ],
    )
    return r.rows[0]!.id
  }

  /**
   * A unidade que não é desta clínica é DESCARTADA, não recusada.
   *
   * É a mesma decisão do épico 2 (`unidadeValida`): a unidade é organização
   * interna, e perder o vínculo não põe ninguém em risco. O responsável é
   * diferente — lá a recusa é a resposta certa, porque sem ele as sessões
   * ficam na agenda de ninguém.
   */
  private async unidadeValida(c: pg.PoolClient, id: string | null): Promise<string | null> {
    if (id === null) return null
    const r = await c.query('SELECT 1 FROM unidades WHERE id = $1', [id])
    return r.rowCount === 0 ? null : id
  }

  private async lerMontado(
    c: Transacao,
    montado: ProgramaMontado,
    modo: 'avulso' | 'saldo',
    dados: MontarPrograma,
  ): Promise<ProgramaMontadoNaSaida> {
    const itens = await c.query<{
      chave: string
      procedimento_id: string
      procedimento_nome: string
      rotulo_sessao: string
      sessoes: number
      intervalo_dias: number
      inicio: string
      depois_de: string | null
      responsavel_id: string
      dose: string
      insumo_id: string | null
      insumo_milesimos: string | null
      insumo_unidade: string | null
      valor: string | null
    }>(
      `SELECT chave, procedimento_id, procedimento_nome, rotulo_sessao, sessoes, intervalo_dias,
              inicio::text AS inicio, depois_de, responsavel_id, dose,
              insumo_id, insumo_milesimos::text AS insumo_milesimos, insumo_unidade,
              valor::text AS valor
         FROM itens_do_programa WHERE programa_id = $1 ORDER BY ordem`,
      [montado.programaId],
    )

    const paraItem = (l: (typeof itens.rows)[number]): ItemNoPrograma => ({
      chave: l.chave,
      procedimentoId: l.procedimento_id,
      procedimentoNome: l.procedimento_nome,
      rotuloSessao: l.rotulo_sessao,
      sessoes: l.sessoes,
      intervaloDias: l.intervalo_dias,
      inicio: l.inicio,
      depoisDe: l.depois_de,
      responsavelId: l.responsavel_id,
      dose: l.dose,
      insumo:
        l.insumo_id === null
          ? null
          : { itemId: l.insumo_id, quantidade: l.insumo_milesimos!, unidade: l.insumo_unidade! },
      valor: l.valor,
    })

    const totalPorItem = new Map(itens.rows.map((l) => [l.chave, l.sessoes]))
    return {
      id: montado.programaId,
      pacienteId: dados.pacienteId,
      inicio: dados.inicio,
      modoDeCobranca: modo,
      situacao: 'ativo',
      itens: itens.rows.map(paraItem),
      sessoes: montado.sessoes.map((s) => ({
        tarefaId: s.tarefaId,
        itemChave: s.itemChave,
        indice: s.indice,
        total: totalPorItem.get(s.itemChave)!,
        prazo: s.prazo,
        status: 'aberta' as const,
      })),
      retornosCancelados: [...montado.retornosCancelados],
    }
  }
}

const paraItemDeMontagem = (i: MontarPrograma['itens'][number]): ItemParaMontar => ({
  chave: i.chave,
  procedimentoId: i.procedimentoId,
  sessoes: i.sessoes,
  intervaloDias: i.intervaloDias,
  inicio: i.inicio ?? null,
  depoisDe: i.depoisDe ?? null,
  responsavelId: i.responsavelId ?? null,
  dose: i.dose ?? null,
  valor: i.valor === undefined ? null : Dinheiro.deCentavos(i.valor),
  insumo:
    i.insumo === undefined
      ? null
      : {
          itemId: i.insumo.itemId,
          // A dose anda COM a unidade, sempre. `Quantidade` a carrega no tipo.
          quantidade: Quantidade.deMilesimos(i.insumo.quantidade, i.insumo.unidade),
        },
})

/**
 * `FOR UPDATE` no programa, e **404 para o excluído**.
 *
 * A RLS já filtra por clínica: o programa da vizinha devolve zero linhas, e
 * zero é a mesma resposta de "não existe" — o status que não confirma a
 * existência de nada.
 *
 * O bloqueio não é zelo: encerrar e excluir leem a situação e decidem a partir
 * dela, e duas abas tocando as duas ações ao mesmo tempo chegariam as duas em
 * `ativo`.
 */
async function carregarPrograma(
  c: pg.PoolClient,
  id: string,
): Promise<{ id: string; situacao: string; pacienteId: string }> {
  const r = await c.query<{ id: string; situacao: string; paciente_id: string }>(
    `SELECT id, situacao, paciente_id FROM programas
      WHERE id = $1 AND excluido_em IS NULL FOR UPDATE`,
    [id],
  )
  const l = r.rows[0]
  if (l === undefined) throw new NotFoundException('Programa não encontrado.')
  return { id: l.id, situacao: l.situacao, pacienteId: l.paciente_id }
}

/** Reexportado para o controlador reconhecer o tipo do `Result`. */
export type { Result }
