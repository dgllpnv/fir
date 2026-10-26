import {
  Dinheiro,
  ehErro,
  erro,
  erroDe,
  montarCronograma,
  ok,
  ratearPrograma,
  TIPO_RETORNO,
  TIPO_SESSAO,
  type ItemParaCronograma,
  type Result,
} from '@fir/domain'
import { Injectable } from '@nestjs/common'
import type { Transacao } from '../banco/transacao'
import {
  MontadorDePrograma,
  PROCEDIMENTO_FORA_DO_CATALOGO,
  RESPONSAVEL_INVALIDO,
  type ItemParaMontar,
  type PedidoDeMontagem,
  type ProgramaMontado,
} from './montador-de-programa'

/**
 * A MONTAGEM, EM UMA TRANSAÇÃO — a de quem chama.
 *
 * Duas entradas, um montador: `POST /v1/programas` (Nova adesão) e o `fechar`
 * da jornada. Se a montagem fosse escrita duas vezes, a segunda seria a que
 * esquece de cancelar os contatos de retorno — e a paciente que acabou de
 * refazer o procedimento receberia a ligação de "você já pode repetir".
 */

type LinhaDeProcedimento = {
  id: string
  nome: string
  rotulo_sessao: string
  responsavel_id: string | null
  ativo: boolean
}

@Injectable()
export class MontadorRelacional extends MontadorDePrograma {
  async montar(tx: Transacao, p: PedidoDeMontagem): Promise<Result<ProgramaMontado>> {
    // 1. O CATÁLOGO, resolvido DENTRO da transação, com a RLS ativa.
    //
    // `excluido_em IS NULL` e NÃO `ativo`: procedimento DESATIVADO ainda monta
    // (decisão P-7). "Desmarque Ativo" significa *deixa de ser oferecido em
    // novas adesões* (MANUAL cap. 11) — não *a proposta de ontem perdeu a
    // validade*. Já o excluído não tem sessões, intervalo nem insumo para
    // montar com.
    const catalogo = await tx.query<LinhaDeProcedimento>(
      `SELECT id, nome, rotulo_sessao, responsavel_id, ativo
         FROM procedimentos WHERE id = ANY($1::uuid[]) AND excluido_em IS NULL`,
      [p.itens.map((i) => i.procedimentoId)],
    )
    const porId = new Map(catalogo.rows.map((l) => [l.id, l]))

    for (const [k, item] of p.itens.entries()) {
      if (!porId.has(item.procedimentoId)) {
        return erro(
          erroDe(
            PROCEDIMENTO_FORA_DO_CATALOGO,
            `O procedimento do item ${k + 1} não está mais no catálogo da clínica. ` +
              'Edite o programa e escolha outro.',
          ),
        )
      }
    }

    // 2. OS RESPONSÁVEIS, ativos, caindo no padrão do procedimento.
    //
    // `Code.gs:355` exige `u.ativo`: tarefa atribuída a quem saiu da clínica
    // não aparece no "Para mim" de ninguém, e doze aplicações numa agenda que
    // ninguém abre são doze aplicações que não acontecem.
    const responsaveis = await this.responsaveis(tx, p, porId)
    if (ehErro(responsaveis)) return responsaveis

    // 3. O CRONOGRAMA — domínio puro. Ciclo e `depoisDe` órfão sobem daqui.
    const paraCronograma: ItemParaCronograma[] = p.itens.map((i) => ({
      chave: i.chave,
      sessoes: i.sessoes,
      intervaloDias: i.intervaloDias,
      inicio: i.inicio,
      depoisDe: i.depoisDe,
    }))
    const cronograma = montarCronograma(p.inicio, paraCronograma)
    if (ehErro(cronograma)) return cronograma

    // 4. O RATEIO do total negociado entre os itens que não trazem valor.
    const valores = this.ratear(p)

    // 5. O PROGRAMA, os ITENS e as SESSÕES.
    const programa = await tx.query<{ id: string }>(
      `INSERT INTO programas
         (clinica_id, paciente_id, inicio, modo_de_cobranca, tarefa_de_origem_id, unidade_id, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        p.clinicaId,
        p.pacienteId,
        p.inicio,
        p.modoDeCobranca,
        p.tarefaDeOrigemId,
        p.unidadeId,
        p.atorId,
      ],
    )
    const programaId = programa.rows[0]!.id

    // O início RESOLVIDO de cada item: o que o cronograma decidiu, não o que
    // o cliente mandou. `depois_de` fica gravado como registro de COMO foi
    // montado — a reprogramação em cascata o usa.
    const inicioResolvido = new Map<string, string>()
    for (const s of cronograma.valor) {
      if (s.indice === 1) inicioResolvido.set(s.itemChave, s.prazo)
    }

    for (const [k, item] of p.itens.entries()) {
      const proc = porId.get(item.procedimentoId)!
      await tx.query(
        `INSERT INTO itens_do_programa
           (clinica_id, programa_id, chave, procedimento_id, procedimento_nome, rotulo_sessao,
            sessoes, intervalo_dias, inicio, depois_de, responsavel_id, dose,
            insumo_id, insumo_milesimos, insumo_unidade, valor, ordem)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          p.clinicaId,
          programaId,
          item.chave,
          item.procedimentoId,
          // O NOME NO INSTANTE DA MONTAGEM (D-2 do épico 3). Nunca um `JOIN`
          // em tempo de leitura: renomear "Tirzepatida" para "Tirzepatida
          // 5 mg" não reescreve a história de quem já está em tratamento.
          proc.nome,
          proc.rotulo_sessao,
          item.sessoes,
          item.intervaloDias,
          inicioResolvido.get(item.chave)!,
          item.depoisDe,
          responsaveis.valor.get(item.chave)!,
          item.dose ?? '',
          item.insumo?.itemId ?? null,
          item.insumo === null ? null : item.insumo.quantidade.milesimos.toString(),
          item.insumo?.quantidade.unidade ?? null,
          valores.get(item.chave)?.centavos.toString() ?? null,
          k,
        ],
      )
    }

    /**
     * AS SESSÕES, EM UM `INSERT` SÓ.
     *
     * `unnest` em vez de um `INSERT` por sessão: 48 viagens ao banco para
     * montar um programa de 48 sessões é o que faz a tela travar no celular
     * da recepção — e, pior, 48 pontos onde a transação pode morrer no meio.
     */
    const porChave = new Map(p.itens.map((i) => [i.chave, i]))
    const sessoes = cronograma.valor
    const inseridas = await tx.query<{ id: string; item_chave: string; sessao_indice: number }>(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, hora, paciente_id, tipo,
          programa_id, item_chave, sessao_indice, sessao_total, procedimento_id, unidade_id)
       SELECT $1, $2, x.responsavel, x.descricao, x.prazo::date, $3::time, $4, $5,
              $6, x.item_chave, x.indice, x.total, x.procedimento_id, $7
         FROM unnest($8::uuid[], $9::text[], $10::text[], $11::text[], $12::smallint[],
                     $13::smallint[], $14::uuid[])
           AS x(responsavel, descricao, prazo, item_chave, indice, total, procedimento_id)
       RETURNING id, item_chave, sessao_indice`,
      [
        p.clinicaId,
        p.atorId,
        p.hora,
        p.pacienteId,
        TIPO_SESSAO,
        programaId,
        p.unidadeId,
        sessoes.map((s) => responsaveis.valor.get(s.itemChave)!),
        sessoes.map((s) => descricaoDaSessao(s, porChave.get(s.itemChave)!, porId)),
        sessoes.map((s) => s.prazo),
        sessoes.map((s) => s.itemChave),
        sessoes.map((s) => s.indice),
        sessoes.map((s) => s.total),
        sessoes.map((s) => porChave.get(s.itemChave)!.procedimentoId),
      ],
    )

    // 6. O RECEBIMENTO DA ADESÃO SABE DE QUE PROGRAMA É.
    //
    // É só isto que falta para o agrupamento do épico 4 deixar de ser um
    // grupo só. Acontece DEPOIS do `INSERT` do programa, na mesma transação:
    // nenhuma das duas escritas sobrevive sozinha.
    if (p.recebimentoDaAdesaoId !== null) {
      await tx.query(`UPDATE recebimentos SET programa_id = $1 WHERE id = $2`, [
        programaId,
        p.recebimentoDaAdesaoId,
      ])
    }

    // 7. OS CONTATOS DE RETORNO DESTE PACIENTE, POR PROCEDIMENTO.
    //
    // "Paciente refez o procedimento" — a frase é do protótipo
    // (`cancelarRetornos`), e sem isso a paciente que acabou de aderir recebe
    // a ligação de "você já pode repetir".
    const retornosCancelados = await this.cancelarRetornos(tx, p, [
      ...new Set(p.itens.map((i) => i.procedimentoId)),
    ])

    const porTarefa = new Map(
      inseridas.rows.map((l) => [`${l.item_chave}#${l.sessao_indice}`, l.id]),
    )
    return ok({
      programaId,
      sessoes: sessoes.map((s) => ({
        tarefaId: porTarefa.get(`${s.itemChave}#${s.indice}`)!,
        itemChave: s.itemChave,
        indice: s.indice,
        prazo: s.prazo,
      })),
      retornosCancelados,
    })
  }

  /**
   * O responsável de cada item: o pedido, ou o padrão do procedimento, ou o
   * ator. Todos conferidos contra `pessoas` ATIVAS **desta** clínica.
   *
   * A RLS já limita a consulta à clínica da transação, e é por isso que ela
   * basta: um `responsavelId` da clínica vizinha simplesmente não aparece no
   * resultado, e a recusa vem daí, não de um `WHERE clinica_id` escrito à mão
   * que alguém esquece no próximo serviço.
   */
  private async responsaveis(
    tx: Transacao,
    p: PedidoDeMontagem,
    porId: ReadonlyMap<string, LinhaDeProcedimento>,
  ): Promise<Result<Map<string, string>>> {
    const pedidos = p.itens.map(
      (i) => i.responsavelId ?? porId.get(i.procedimentoId)!.responsavel_id ?? p.atorId,
    )
    const r = await tx.query<{ id: string }>(
      `SELECT id FROM pessoas WHERE id = ANY($1::uuid[]) AND ativo`,
      [[...new Set(pedidos)]],
    )
    const ativos = new Set(r.rows.map((x) => x.id))

    const fora = new Map<string, string>()
    for (const [k, item] of p.itens.entries()) {
      const escolhido = pedidos[k]!
      if (!ativos.has(escolhido)) {
        return erro(
          erroDe(
            RESPONSAVEL_INVALIDO,
            `O responsável do item ${k + 1} não está ativo na clínica. Escolha outra pessoa.`,
          ),
        )
      }
      fora.set(item.chave, escolhido)
    }
    return ok(fora)
  }

  /**
   * O VALOR DE CADA ITEM.
   *
   * O que o item TROUXE é respeitado; o resto do total negociado é rateado
   * entre os que não trouxeram, proporcionalmente a `sessões` — e a soma é
   * exatamente o total (`ratearPrograma`, property-based em `packages/domain`).
   *
   * Sem `valorTotal`, só os itens que trouxeram valor têm valor. É o programa
   * em modo avulso: cada sessão registra o que foi pago no dia.
   */
  private ratear(p: PedidoDeMontagem): Map<string, Dinheiro> {
    const fora = new Map<string, Dinheiro>()
    for (const i of p.itens) if (i.valor !== null) fora.set(i.chave, i.valor)
    if (p.valorTotal === null) return fora

    const semValor = p.itens.filter((i) => i.valor === null)
    if (semValor.length === 0) return fora

    const jaDados = p.itens.reduce(
      (s, i) => (i.valor === null ? s : s.mais(i.valor)),
      Dinheiro.zero(),
    )
    // Clamp em zero: itens que já somam mais que o total negociado não geram
    // parte negativa para os demais. O contrato recusa `entrada > total`, mas
    // não "soma dos itens > total" — e um item com valor negativo na tela é
    // pior que um item zerado.
    const sobra = p.valorTotal.ehMaiorQue(jaDados) ? p.valorTotal.menos(jaDados) : Dinheiro.zero()

    const partes = ratearPrograma(
      sobra,
      semValor.map((i) => BigInt(i.sessoes)),
    )
    semValor.forEach((i, k) => fora.set(i.chave, partes[k]!))
    return fora
  }

  private async cancelarRetornos(
    tx: Transacao,
    p: PedidoDeMontagem,
    procedimentos: readonly string[],
  ): Promise<readonly string[]> {
    const r = await tx.query<{ id: string }>(
      `UPDATE tarefas
          SET status = 'cancelada', obs = $1
        WHERE clinica_id = $2 AND paciente_id = $3 AND tipo = $4
          AND status = 'aberta' AND excluida_em IS NULL
          AND procedimento_id = ANY($5::uuid[])
        RETURNING id`,
      [
        'Paciente refez o procedimento',
        p.clinicaId,
        p.pacienteId,
        TIPO_RETORNO,
        [...procedimentos],
      ],
    )
    return r.rows.map((x) => x.id)
  }
}

/**
 * "Aplicação 1/4 · Tirzepatida 2,5 mg" — o que a enfermagem lê no frasco.
 *
 * O rótulo vem de `itens_do_programa.rotulo_sessao`, nunca do NOME DO TIPO: o
 * tipo continua sendo a string `'Sessão de plano'`, gravada em milhares de
 * linhas nas 4 clínicas. Formato medido no protótipo rodando
 * (`criarAdesao`): `${rotulo} ${i}/${n} · ${nome}${dose ? ' ' + dose : ''}`.
 */
function descricaoDaSessao(
  s: { readonly itemChave: string; readonly indice: number; readonly total: number },
  item: ItemParaMontar,
  porId: ReadonlyMap<string, LinhaDeProcedimento>,
): string {
  const proc = porId.get(item.procedimentoId)!
  const dose = item.dose === null || item.dose === '' ? '' : ` ${item.dose}`
  return `${proc.rotulo_sessao} ${s.indice}/${s.total} · ${proc.nome}${dose}`.slice(0, 400)
}
