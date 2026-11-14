import {
  CODIGO_CONFIRMACAO_NECESSARIA,
  type ConfirmacaoNecessaria,
  type MoverEtapa,
  type PreviaDeDesfazerOrcamento,
  type TarefasAfetadas,
} from '@fir/contracts'
import { diaCivil, ehErro, ehSessao, type EventoDeJornada, type Relogio, transicao } from '@fir/domain'
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type pg from 'pg'
import { creditoGeradoAoEstornar } from '../financeiro/saldo.repositorio'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { declararMotivo, motivoDaAcao } from '../comum/motivo-de-suporte'
import { RELOGIO } from '../comum/relogio'
import { efeitoDaExclusao, type EfeitoDaExclusao } from '../tarefas/edicao.service'
import { type AutorDaRequisicao, lerTarefas } from '../tarefas/leitura'
import { carregarCartao } from './cartao'

type Desfazer = Extract<MoverEtapa, { acao: 'reabrirOrcamento' | 'excluirOrcamento' }>

type Analise = {
  readonly efeito: EfeitoDaExclusao
  readonly dia: string | null
  readonly caixaFechado: boolean
  /** Estornar faria sobrar abatimento de saldo: nasce crédito da paciente. */
  readonly geraCredito: boolean
  readonly bloqueio: string | null
}

/**
 * REABRIR / EXCLUIR SÓ O ORÇAMENTO — a tarefa (a consulta) fica.
 *
 * Pedido da cliente (2026-11-13): errar o fechamento hoje só se corrige
 * excluindo o atendimento inteiro. Aqui o orçamento volta a "Orçamento" ou some,
 * e o que o fechamento fez é desfeito **na mesma transação**:
 *
 *  - o recebimento embutido é ESTORNADO (`estornado_em`, nunca `DELETE` — regras
 *    12 e 20) e a tarefa companheira "Pagamento de orçamento" sai da lista;
 *  - o programa criado é encerrado e **excluído** (o índice `programa_por_origem`
 *    só enxerga os vivos: sem isto o próximo fechamento bateria no índice);
 *  - `valor_fechado` e o vínculo de campanha deixam de contar, porque a receita
 *    da campanha lê o recebimento estornado, não o evento.
 *
 * O MESMO efeito de `EdicaoService.excluir` (uma só leitura do que o fechamento
 * fez: `efeitoDaExclusao`), com três recusas a mais, todas do gate de risco:
 *
 *  1. programa com **sessão já realizada** — o paciente foi tratado e o estoque
 *     baixado; isso não se desfaz por aqui (regra 12);
 *  2. **outros pagamentos** do programa depois do fechamento — o saldo do grupo
 *     ficaria negativo (regra 5);
 *  3. o dinheiro de um **dia de caixa fechado** só sai com `confirmarCaixaFechado`.
 *
 * Repetir a ação é 409 (a etapa já mudou), nunca um segundo estorno.
 */
@Injectable()
export class DesfazerOrcamentoService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async previa(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    id: string,
  ): Promise<PreviaDeDesfazerOrcamento> {
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      await carregarCartao(c, clinicaId, id)
      const a = await this.analisar(c, clinicaId, fuso, id)
      return {
        temPagamento: a.efeito.temPagamento,
        temPrograma: a.efeito.programas.length > 0,
        valor: a.efeito.temPagamento ? a.efeito.valor.toString() : null,
        diaDoDinheiro: a.dia,
        caixaFechado: a.caixaFechado,
        geraCredito: a.geraCredito,
        bloqueio: a.bloqueio,
      }
    })
  }

  async executar(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    autor: AutorDaRequisicao,
    id: string,
    dados: Desfazer,
  ): Promise<TarefasAfetadas> {
    // 400 antes de abrir a transação (I1): nada foi lido nem tocado.
    const motivo = motivoDaAcao(ator, dados.motivo)
    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, fuso)

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      await declararMotivo(c, motivo)
      // Trava a tarefa: duas abas desfazendo ao mesmo tempo se enfileiram, e a
      // segunda lê a etapa já mudada e recebe 409.
      const t = await carregarCartao(c, clinicaId, id)
      // O programa de origem também, ANTES de ler o efeito (mesma razão de
      // `EdicaoService.excluir`): uma cobrança gravada entre a leitura e o
      // UPDATE passaria despercebida.
      await c.query(
        'SELECT id FROM programas WHERE tarefa_de_origem_id = $1 AND excluido_em IS NULL FOR UPDATE',
        [id],
      )

      const destino = transicao({ etapa: t.etapa, status: t.status, historico: t.historico }, dados.acao)
      if (ehErro(destino)) throw new ConflictException(destino.erro.mensagem)
      if (!t.historico.some((e) => e.acao === 'registrarOrcamento')) {
        throw new ConflictException('Este atendimento não tem orçamento para desfazer.')
      }

      const a = await this.analisar(c, clinicaId, fuso, id)
      if (a.bloqueio !== null) throw new ConflictException(a.bloqueio)

      if (a.efeito.temPagamento) {
        if (a.caixaFechado && dados.confirmarCaixaFechado !== true) {
          // SEM número nenhum: o 409 não passa pela redação central.
          const corpo: ConfirmacaoNecessaria = {
            statusCode: 409,
            codigo: CODIGO_CONFIRMACAO_NECESSARIA,
            avisos: ['CAIXA_FECHADO'],
            message: 'O dinheiro deste orçamento entrou num dia de caixa já fechado. Confirme para estornar.',
          }
          throw new ConflictException(corpo)
        }
        if (a.geraCredito && dados.confirmarCredito !== true) {
          // Também sem número (o 409 não passa pela redação central).
          const corpo: ConfirmacaoNecessaria = {
            statusCode: 409,
            codigo: CODIGO_CONFIRMACAO_NECESSARIA,
            avisos: ['CREDITO_NA_PACIENTE'],
            message:
              'A paciente já pagou parte desta dívida em "Saldo em aberto". Ao desfazer, o que ela pagou vira crédito dela. Confirme para continuar.',
          }
          throw new ConflictException(corpo)
        }
        // Soft delete, nunca DELETE (regra 20): a trilha registra quem estornou.
        await c.query(
          'UPDATE recebimentos SET estornado_em = now() WHERE id = ANY($1::uuid[]) AND estornado_em IS NULL',
          [a.efeito.recebimentos],
        )
        if (a.efeito.companheiras.length > 0) {
          await c.query('UPDATE tarefas SET excluida_em = now() WHERE id = ANY($1::uuid[])', [
            a.efeito.companheiras,
          ])
        }
      }

      if (a.efeito.programas.length > 0) {
        // Encerra E exclui: o programa deste orçamento deixa de existir, e o
        // próximo fechamento monta o seu. As sessões ABERTAS (nenhuma foi feita:
        // `analisar` recusou antes) saem junto; nenhum movimento de estoque é
        // tocado.
        await c.query(
          `UPDATE programas
              SET situacao = 'encerrado', encerrado_em = now(), excluido_em = now(),
                  motivo_encerramento = $2
            WHERE id = ANY($1::uuid[]) AND excluido_em IS NULL`,
          [a.efeito.programas, 'Orçamento desfeito'],
        )
        await c.query(
          `UPDATE tarefas SET status = 'cancelada', excluida_em = now(), obs = $2
            WHERE programa_id = ANY($1::uuid[]) AND status = 'aberta' AND excluida_em IS NULL
              AND id <> $3`,
          [a.efeito.programas, 'Orçamento desfeito', id],
        )
      }

      const evento: EventoDeJornada = {
        acao: dados.acao,
        etapa: destino.valor.etapa,
        em: agora.toISOString(),
        porId: autor.id,
        motivo: dados.motivo,
      }
      if (dados.acao === 'reabrirOrcamento') {
        // Volta a "Orçamento", com o oferecido, a lista e o programa orçado
        // intactos; só o que o FECHAMENTO gravou sai. Aparece em Hoje › Retomar.
        await c.query(
          `UPDATE tarefas
              SET etapa = $2::etapa_de_jornada, status = $3, valor_fechado = NULL,
                  proximo_passo_em = $4::date, historico = historico || $5::jsonb
            WHERE id = $1 AND excluida_em IS NULL`,
          [id, destino.valor.etapa, destino.valor.status, hoje, JSON.stringify([evento])],
        )
      } else {
        // A consulta fica; o orçamento — valor, lista e programa orçado — some.
        await c.query(
          `UPDATE tarefas
              SET etapa = $2::etapa_de_jornada, status = $3, valor_orcamento = NULL,
                  valor_fechado = NULL, itens_orcamento = NULL, programa_orcado = NULL,
                  proximo_passo_em = NULL, historico = historico || $4::jsonb
            WHERE id = $1 AND excluida_em IS NULL`,
          [id, destino.valor.etapa, destino.valor.status, JSON.stringify([evento])],
        )
      }

      const todas = await lerTarefas(c, clinicaId, hoje, [id], autor.podeJornada)
      const tarefa = todas[0]
      if (tarefa === undefined) throw new NotFoundException('Agendamento não encontrado.')
      return { tarefa, todas }
    })
  }

  /** O que o fechamento fez, e se alguma coisa impede de desfazê-lo. */
  private async analisar(
    c: pg.PoolClient,
    clinicaId: ClinicaId,
    fuso: string,
    id: string,
  ): Promise<Analise> {
    const efeito = await efeitoDaExclusao(c, id)

    let dia: string | null = null
    let caixaFechado = false
    if (efeito.temPagamento) {
      const r = await c.query<{ dia: string | null; fechado: boolean }>(
        `SELECT min((r.recebido_em AT TIME ZONE $3)::date)::text AS dia,
                coalesce(bool_or(EXISTS (
                  SELECT 1 FROM caixas_do_dia cx
                   WHERE cx.clinica_id = $2 AND cx.dia = (r.recebido_em AT TIME ZONE $3)::date)), false) AS fechado
           FROM recebimentos r WHERE r.id = ANY($1::uuid[])`,
        [efeito.recebimentos, clinicaId, fuso],
      )
      dia = r.rows[0]?.dia ?? null
      caixaFechado = r.rows[0]?.fechado ?? false
    }

    let bloqueio: string | null = null
    if (efeito.programas.length > 0) {
      const feitas = await c.query<{ tipo: string }>(
        `SELECT tipo FROM tarefas
          WHERE programa_id = ANY($1::uuid[]) AND status = 'concluida' AND excluida_em IS NULL
            AND id <> $2`,
        [efeito.programas, id],
      )
      const sessoes = feitas.rows.filter((x) => ehSessao(x)).length
      if (sessoes > 0) {
        bloqueio =
          'O programa deste orçamento já tem sessões realizadas, e isso não se desfaz por aqui. ' +
          'Se o programa foi lançado por engano, encerre-o em Programas.'
      }
    }
    if (bloqueio === null && efeito.outrosPagamentosDoPrograma) {
      bloqueio = efeito.outrosEmbutidos
        ? 'O programa deste orçamento já tem outros pagamentos, dentro de atendimentos ou sessões. Reabra esses atendimentos para desfazê-los antes.'
        : 'O programa deste orçamento já tem outros pagamentos. Estorne-os em Financeiro › Recebimentos antes.'
    }
    let geraCredito = false
    if (efeito.temPagamento) {
      const p = await c.query<{ paciente_id: string | null }>(
        'SELECT paciente_id FROM tarefas WHERE id = $1',
        [id],
      )
      const pacienteId = p.rows[0]?.paciente_id ?? null
      if (pacienteId !== null) {
        geraCredito = (await creditoGeradoAoEstornar(c, clinicaId, pacienteId, efeito.recebimentos)) > 0n
      }
    }
    return { efeito, dia, caixaFechado, geraCredito, bloqueio }
  }
}
