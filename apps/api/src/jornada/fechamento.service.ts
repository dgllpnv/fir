import type { MoverEtapa } from '@fir/contracts'
import { Dinheiro, ehErro, TIPO_PAGAMENTO_DE_ORCAMENTO } from '@fir/domain'
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'
import type { AutorDaRequisicao } from '../tarefas/leitura'
import { confirmacoesDe } from '../financeiro/recebimentos.avisos'
import { registrarPagamento } from '../tarefas/tarefas.service'
import { type CartaoCarregado, centavosNoJsonb, type Efeitos } from './cartao'
import {
  MontadorDePrograma,
  traduzirErroDeMontagem,
} from '../programas/montador-de-programa'

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
      /** O fuso da clínica — a janela do dia dos avisos de recebimento (D-21). */
      readonly fuso: string
      /**
       * `temPerm(…, 'valores')`. Sem ela, NENHUMA mensagem de erro carrega o
       * valor do orçamento: a recusa (400/409) é uma resposta como qualquer
       * outra, e a Recepção não tem `valores` (regra 17).
       */
      readonly podeVerValores: boolean
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

    /**
     * O QUE FOI FECHADO É DECLARADO, E O SERVIDOR CONFERE.
     *
     * Com um orçamento oferecido, a recepção escolhe "fechou tudo" ou "fechou
     * só uma parte". As duas escolhas são conferidas contra a soma (entrada +
     * em aberto): sem a conferência, um "em aberto" deixado em branco virava
     * "parcial" por engano — e o saldo que a clínica ia cobrar nunca existia.
     */
    const oferta =
      cartao.valorOrcamento !== null && cartao.valorOrcamento > 0n ? cartao.valorOrcamento : null
    // O valor só entra na frase de quem o pode ver. Sem `valores`, a mesma
    // recusa, sem número: o servidor confere, a frase não conta.
    const reais = (c: bigint): string => Dinheiro.deCentavos(c).formatar()
    const comValor = (frase: string): string => (x.podeVerValores ? frase : '')
    /**
     * As duas recusas que comparam o que foi digitado com a OFERTA.
     *
     * Quem não tem `valores` não pode usá-las como oráculo do valor do
     * orçamento (regra 17, S-28): se esta comparação falhasse ANTES das demais
     * validações, "X acima da oferta" e "X abaixo da oferta" voltariam
     * respostas diferentes e a Recepção descobriria o número por tentativa. Por
     * isso, sem `valores`, ela roda por último (logo antes de qualquer escrita):
     * quem erra outra coisa recebe o MESMO erro, qualquer que seja o valor.
     */
    const conferirOferta = (): void => {
      if (dados.fechamento === 'tudo' && oferta !== null && doFechamento !== oferta) {
        throw new BadRequestException(
          'Fechou o orçamento todo: o valor recebido agora mais o pagamento em aberto precisam completar o orçamento' +
            (x.podeVerValores
              ? ` (${reais(oferta)}; hoje somam ${reais(doFechamento)}).`
              : '.') +
            ' Se fechou só uma parte, escolha "Só uma parte".',
        )
      }
      if (dados.fechamento === 'parte' && oferta !== null && doFechamento >= oferta) {
        throw new BadRequestException(
          'Fechou só uma parte: o valor recebido agora mais o pagamento em aberto precisam ficar abaixo do orçamento' +
            comValor(` de ${reais(oferta)}`) +
            '. Se fechou o orçamento todo, escolha "O orçamento todo".',
        )
      }
    }
    if (x.podeVerValores) conferirOferta()
    if (dados.fechamento === 'parte' && oferta === null) {
      throw new BadRequestException('Este atendimento não tem orçamento: não há parte a fechar.')
    }
    if (
      dados.fechamento !== 'parte' &&
      (dados.itensFechados !== undefined || dados.retomarRestanteEm !== undefined)
    ) {
      throw new BadRequestException(
        'Os procedimentos fechados e a data de retomar o restante só valem no fechamento parcial.',
      )
    }
    // OS PROCEDIMENTOS DO ORÇAMENTO, quando listados: no parcial a recepção
    // diz QUAIS foram fechados — nem nenhum, nem todos (todos é "fechou tudo").
    const itens = cartao.itens
    if (dados.fechamento === 'parte') {
      if (itens === null) {
        if (dados.itensFechados !== undefined) {
          throw new BadRequestException('Este orçamento não tem procedimentos listados.')
        }
      } else {
        const marcados = new Set(dados.itensFechados ?? [])
        if (marcados.size === 0) {
          throw new BadRequestException('Marque os procedimentos do orçamento que a paciente fechou.')
        }
        const existentes = new Set(itens.map((i) => i.chave))
        if ([...marcados].some((k) => !existentes.has(k))) {
          throw new BadRequestException('Algum procedimento marcado não faz parte deste orçamento.')
        }
        if (marcados.size >= itens.length) {
          throw new BadRequestException(
            'Todos os procedimentos foram marcados: use "O orçamento todo" em vez de "Só uma parte".',
          )
        }
      }
    }
    if (dados.retomarRestanteEm !== undefined && dados.retomarRestanteEm < x.hojeDaClinica) {
      throw new BadRequestException('Escolha uma data a partir de hoje.')
    }

    // UM ORÇAMENTO MONTA UM PROGRAMA (índice `programa_por_origem`). Se este
    // atendimento já tem programa vivo — o cartão voltou a "orçamento" depois de
    // um fechamento anterior —, recusa AQUI, antes de qualquer escrita, com a
    // frase que diz o que fazer. Sem isto, o índice estourava no meio da
    // transação e a recepção via "Internal server error" (relato de uma clínica, 12/11).
    if (cartao.programaOrcado !== null && cartao.programaOrcado.length > 0) {
      const ja = await c.query(
        'SELECT 1 FROM programas WHERE tarefa_de_origem_id = $1 AND excluido_em IS NULL',
        [x.tarefaId],
      )
      if (ja.rowCount !== 0) {
        throw new ConflictException(
          'Este orçamento já virou um programa de tratamento. Confira em Programas antes de fechar de novo; se o programa foi lançado por engano, exclua-o primeiro.',
        )
      }
    }

    if (!x.podeVerValores) conferirOferta()

    // O recebimento é o MESMO serviço do épico 2 — uma linha em
    // `recebimentos` com `tarefa_id`. Nenhuma segunda implementação, e
    // nenhuma coluna de dinheiro recebido em `tarefas`: quem garante que o
    // pagamento conta uma vez (regra 3) é o índice único parcial
    // `recebimento_por_tarefa`, não este código.
    //
    // **Atendimento que JÁ TEM o pagamento dele** (a consulta paga na hora, e
    // o orçamento sai depois): o índice recusa um segundo recebimento vivo na
    // mesma tarefa, e era isso que a recepção via como "Internal server
    // error". O dinheiro do orçamento vai então para uma tarefa companheira
    // "Pagamento de orçamento" — a MESMA que Recebimento › Orçamento fechado
    // cria —, e a consulta fica com o pagamento dela, intocado (regra 3: cada
    // pagamento conta uma vez).
    const jaPaga = await c.query(
      'SELECT 1 FROM recebimentos WHERE tarefa_id = $1 AND estornado_em IS NULL',
      [x.tarefaId],
    )
    let tarefaDoPagamento = x.tarefaId
    let tipoDoPagamento = cartao.tipo
    if (jaPaga.rowCount !== 0) {
      const companheira = await c.query<{ id: string }>(
        `INSERT INTO tarefas
           (clinica_id, solicitante_id, responsavel_id, descricao, prazo, prioridade,
            status, concluida_em, paciente_id, tipo, historico, resultado, obs, unidade_id)
         VALUES ($1,$2,$2,$3,$4,'normal','concluida',$5,$6,$7,'[]','','',$8)
         RETURNING id`,
        [
          x.clinicaId,
          x.autor.id,
          TIPO_PAGAMENTO_DE_ORCAMENTO,
          x.hojeDaClinica,
          x.agora,
          cartao.pacienteId,
          TIPO_PAGAMENTO_DE_ORCAMENTO,
          cartao.unidadeId,
        ],
      )
      tarefaDoPagamento = companheira.rows[0]!.id
      tipoDoPagamento = TIPO_PAGAMENTO_DE_ORCAMENTO
    }
    const recebimentoId = await registrarPagamento(c, {
      clinicaId: x.clinicaId,
      pacienteId: cartao.pacienteId,
      tarefaId: tarefaDoPagamento,
      // O tipo JÁ REALIZADO da tarefa ("Consulta realizada"), que é o que
      // `aceitaPagamento` libera e o que o faturamento classifica.
      tipo: tipoDoPagamento,
      pagamento: dados.recebimento,
      // O dinheiro entrou AGORA, não no dia do atendimento: é hoje que ele
      // conta no caixa e na conferência às cegas.
      quando: x.agora,
      unidade: cartao.unidadeId,
      autor: x.autor.id,
      fuso: x.fuso,
      confirmacoes: confirmacoesDe(dados),
    })

    /**
     * O PROGRAMA, quando houver — e a porta do épico 5.
     *
     * A recusa derruba a transação inteira, inclusive o recebimento inserido
     * acima. É a diferença entre "o fechamento não aconteceu" e "o dinheiro
     * entrou e o programa não existe", e só a primeira a recepção resolve
     * sozinha.
     */
    let proposta = cartao.programaOrcado
    if (dados.fechamento === 'parte' && dados.itensFechados !== undefined) {
      // Só os itens que a paciente contratou viram programa. O rateio e a
      // agenda de sessões partem dos itens marcados, não de tudo o que foi
      // oferecido (a paciente que fechou 15 de 25 não ganha as sessões dos 10).
      // A conferência dos marcados já foi feita acima, contra `cartao.itens`.
      const mantidos = new Set(dados.itensFechados)
      proposta = (proposta ?? [])
        .filter((i) => mantidos.has(i.chave))
        .map((i) => {
          if (i.depoisDe === undefined || i.depoisDe === null || mantidos.has(i.depoisDe)) return i
          // Depende de um item que não foi fechado: passa a começar no início.
          const { depoisDe: _fora, ...resto } = i
          return resto
        })
    }
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
        // No parcial o programa vale o que foi FECHADO, não o oferecido.
        valorTotal: Dinheiro.deCentavos(dados.fechamento === 'parte' ? doFechamento : negocio),
        modoDeCobranca: (dados.recebimento.valorAberto ?? 0n) > 0n ? 'saldo' : 'avulso',
        atorId: x.autor.id,
        hojeDaClinica: x.hojeDaClinica,
      })
      /**
       * **O 501 ACABOU** — e a tradução é a mesma de `POST /v1/programas`.
       *
       * Enquanto o montador não existia, qualquer recusa era 501: o cartão
       * estava impecável e o servidor é que estava incompleto. Agora a recusa
       * é do mundo, não do servidor, e o status diz o que fazer: **409** para
       * o procedimento que saiu do catálogo (o estado mudou entre o orçamento
       * e o fechamento), **400** para ciclo, item órfão ou responsável
       * inativo.
       *
       * A exceção derruba a transação inteira, inclusive o recebimento
       * inserido acima — e é por isso que `traduzirErroDeMontagem` mora junto
       * dos códigos, em `programas/`: duas traduções é como uma delas devolve
       * 500 para o procedimento excluído, mandando a recepção procurar o erro
       * no que ela fez.
       */
      if (ehErro(r)) throw traduzirErroDeMontagem(r.erro)
    }

    return {
      ...(cartao.valorOrcamento === negocio ? {} : { valorOrcamento: negocio }),
      // O que a paciente fechou de fato. `> 0` porque a coluna recusa zero.
      ...(doFechamento > 0n ? { valorFechado: doFechamento } : {}),
      // QUAIS procedimentos foram fechados, para o evento (append-only): todos no
      // fechamento total, os marcados no parcial. Sem declaração, ou sem
      // procedimentos listados, o evento não diz nada — "sem detalhamento".
      ...(itens !== null && dados.fechamento === 'tudo'
        ? { itensFechados: itens.map((i) => i.chave) }
        : itens !== null && dados.fechamento === 'parte'
          ? { itensFechados: [...(dados.itensFechados ?? [])] }
          : {}),
      // O cartão para de pedir ação: a paciente decidiu. No fechamento parcial
      // pode ficar o lembrete de retomar o RESTANTE (Hoje › Retomar).
      proximoPassoEm: dados.retomarRestanteEm ?? null,
      // O evento guarda o valor do NEGÓCIO, não o da entrada: é ele que o
      // funil soma em "Fechados", e o recebido é da tela Recebimentos. As
      // duas medem coisas diferentes, e colapsá-las numa é como o número do
      // funil deixa de bater e ninguém sabe qual está certo.
      valor: centavosNoJsonb(negocio),
      ...(dados.nota === undefined ? {} : { nota: dados.nota }),
    }
  }
}
