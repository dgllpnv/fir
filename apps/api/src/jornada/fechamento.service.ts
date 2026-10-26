import type { MoverEtapa } from '@fir/contracts'
import { Dinheiro, ehErro } from '@fir/domain'
import {
  BadRequestException,
  Inject,
  Injectable,
  NotImplementedException,
} from '@nestjs/common'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'
import type { AutorDaRequisicao } from '../tarefas/leitura'
import { registrarPagamento } from '../tarefas/tarefas.service'
import { type CartaoCarregado, centavosNoJsonb, type Efeitos } from './cartao'
import { MontadorDePrograma } from '../programas/montador-de-programa'

/**
 * FECHAR — uma transação só.
 *
 * No protótipo, "Fechou" são **duas chamadas do cliente**:
 * `criarTarefa`/`criarAdesao` cria o recebimento e **depois** `moverEtapa
 * fechar` move o cartão. Entre uma e outra cabe uma rede que cai, uma aba
 * fechada, um 500. Quando cai, o dinheiro está lançado e o cartão continua em
 * "Orçamentos em aberto" — a clínica vê um orçamento pendente de uma paciente
 * que já pagou, e liga para cobrá-la.
 *
 * Aqui as escritas são da MESMA transação de `naClinica`: este serviço recebe
 * o cliente já aberto e **não abre transação nenhuma**. A atomicidade é de
 * quem chama, e é por isso que o montador do programa também recebe o `tx` em
 * vez de abrir o seu.
 *
 * As três linhas de dinheiro do fechamento, e a diferença entre elas:
 *
 * | Campo | O que é | Entra na receita? |
 * |---|---|---|
 * | `recebimento.valor` | o que a paciente **pagou agora** | **sim** — é a única |
 * | `recebimento.valorAberto` | o que ficou para depois | não, até ser pago |
 * | `valor_orcamento` | entrada + aberto = **o negócio fechado** | **nunca** (regra 4) |
 */
type Fechar = Extract<MoverEtapa, { acao: 'fechar' }>

@Injectable()
export class FechamentoService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(MontadorDePrograma) private readonly montador: MontadorDePrograma,
  ) {}

  /**
   * As escritas de dinheiro do fechamento, **dentro da transação de quem
   * chama**, e os efeitos de coluna que sobram para o `UPDATE` da etapa.
   */
  async fechar(
    c: pg.PoolClient,
    x: {
      readonly clinicaId: ClinicaId
      readonly tarefaId: string
      readonly cartao: CartaoCarregado
      readonly dados: Fechar
      readonly autor: AutorDaRequisicao
      readonly agora: Date
      /** Dia civil do SERVIDOR, no fuso da clínica (regra 24). */
      readonly hojeDaClinica: string
    },
  ): Promise<Efeitos> {
    const { cartao, dados } = x

    if (cartao.pacienteId === null) {
      // O `CHECK etapa_exige_paciente` da 0007 torna isto inalcançável; a
      // guarda fica porque o dinheiro precisa de a quem pertencer, e falhar
      // aqui é melhor que inserir um recebimento sem paciente.
      throw new BadRequestException(
        'Só um agendamento de paciente guarda pagamento — o dinheiro precisa de a quem pertencer.',
      )
    }

    /**
     * O VALOR DO NEGÓCIO: entrada + o que ficou em aberto.
     *
     * E **não sobrescreve** um orçamento já registrado — é o
     * `if (!(Number(t.valorOrcamento) > 0) && Number(b.valor) > 0)` do
     * protótipo, e a razão é de medição: se sobrescrevesse, o funil mediria
     * "fechado pelo que entrou", e um fechamento com entrada pequena apagaria
     * o tamanho do negócio que a clínica acabou de ganhar.
     *
     * Soma de `bigint` com `bigint`: nenhum `Number` no caminho.
     */
    const doFechamento = dados.recebimento.valor + (dados.recebimento.valorAberto ?? 0n)
    const negocio = cartao.valorOrcamento !== null && cartao.valorOrcamento > 0n
      ? cartao.valorOrcamento
      : doFechamento

    // O recebimento é o MESMO serviço do épico 2 — uma linha em
    // `recebimentos` com `tarefa_id`. Nenhuma segunda implementação, e
    // nenhuma coluna de dinheiro recebido em `tarefas`: quem garante que o
    // pagamento conta uma vez (regra 3) é o índice único parcial
    // `recebimento_por_tarefa`, não este código.
    const recebimentoId = await registrarPagamento(c, {
      clinicaId: x.clinicaId,
      pacienteId: cartao.pacienteId,
      tarefaId: x.tarefaId,
      // O tipo JÁ REALIZADO da tarefa ("Consulta realizada"), que é o que
      // `aceitaPagamento` libera e o que o faturamento classifica.
      tipo: cartao.tipo,
      pagamento: dados.recebimento,
      // O dinheiro entrou AGORA, não no dia do atendimento: é hoje que ele
      // conta no caixa e na conferência às cegas.
      quando: x.agora,
      unidade: cartao.unidadeId,
      autor: x.autor.id,
    })

    /**
     * O PROGRAMA, quando houver — e a porta do épico 5.
     *
     * A recusa derruba a transação inteira, inclusive o recebimento inserido
     * acima. É a diferença entre "o fechamento não aconteceu" e "o dinheiro
     * entrou e o programa não existe", e só a primeira a recepção resolve
     * sozinha.
     */
    const proposta = cartao.programaOrcado
    if (proposta !== null && proposta.length > 0) {
      const r = await this.montador.montar(c, {
        clinicaId: x.clinicaId,
        pacienteId: cartao.pacienteId,
        // O início do programa vem do corpo, e o padrão é HOJE DA CLÍNICA,
        // calculado no SERVIDOR (regra 24). `ItemOrcado` não tem data — só
        // `depoisDe` —, então quem não depende de ninguém começa aqui.
        inicio: x.dados.inicioDoPrograma ?? x.hojeDaClinica,
        itens: proposta.map((i) => ({
          chave: i.chave,
          procedimentoId: i.procedimentoId,
          sessoes: i.sessoes,
          intervaloDias: i.intervaloDias,
          inicio: null,
          depoisDe: i.depoisDe ?? null,
          responsavelId: i.responsavelId ?? null,
          dose: i.dose ?? null,
          // `ItemOrcadoNaSaida.valor` é string de centavos ou `null`/ausente
          // (D-4 do épico 3: dinheiro dentro de `jsonb` é string).
          valor:
            i.valor === null || i.valor === undefined ? null : Dinheiro.deCentavos(BigInt(i.valor)),
          insumo: null,
        })),
        hora: null,
        unidadeId: cartao.unidadeId,
        tarefaDeOrigemId: x.tarefaId,
        // O recebimento acabou de ser inserido acima, na MESMA transação, e
        // recebe `programa_id` para que o saldo do épico 4 agrupe (regra 5).
        recebimentoDaAdesaoId: recebimentoId,
        valorTotal: Dinheiro.deCentavos(negocio),
        modoDeCobranca: (dados.recebimento.valorAberto ?? 0n) > 0n ? 'saldo' : 'avulso',
        atorId: x.autor.id,
        hojeDaClinica: x.hojeDaClinica,
      })
      // 501, não 409: o cartão está impecável — o servidor é que está
      // incompleto. Dizer "conflito" mandaria a recepção procurar o erro no
      // que ela fez.
      if (ehErro(r)) throw new NotImplementedException(r.erro.mensagem)
    }

    return {
      ...(cartao.valorOrcamento === negocio ? {} : { valorOrcamento: negocio }),
      // O cartão para de pedir ação: a paciente decidiu.
      proximoPassoEm: null,
      // O evento guarda o valor do NEGÓCIO, não o da entrada: é ele que o
      // funil soma em "Fechados", e o recebido é da tela Recebimentos. As
      // duas medem coisas diferentes, e colapsá-las numa é como o número do
      // funil deixa de bater e ninguém sabe qual está certo.
      valor: centavosNoJsonb(negocio),
      ...(dados.nota === undefined ? {} : { nota: dados.nota }),
    }
  }
}
