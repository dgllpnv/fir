import type { ItemOrcadoNaSaida, MoverEtapa } from '@fir/contracts'
import type { Etapa, EventoDeJornada, StatusDeTarefa } from '@fir/domain'
import { NotFoundException } from '@nestjs/common'
import type pg from 'pg'

/**
 * O cartão carregado, e as colunas que uma transição pode tocar.
 *
 * Mora fora de `jornada.service.ts` porque o fechamento (Task 7) precisa das
 * mesmas três coisas — a leitura com `FOR UPDATE`, a tabela de colunas e a
 * conversão de centavos para dentro do `jsonb` — e uma segunda cópia de
 * qualquer uma delas é como `valor_orcamento` passa a ser gravado em reais num
 * caminho e em centavos no outro.
 */

/** O que a transição precisa saber da tarefa. */
export type CartaoCarregado = {
  readonly etapa: Etapa
  readonly status: StatusDeTarefa
  readonly prazo: string
  readonly hora: string | null
  readonly historico: EventoDeJornada[]
  readonly pacienteId: string | null
  readonly tipo: string
  readonly unidadeId: string | null
  /** Centavos, ou `null`. Nunca redigido aqui: isto é leitura interna. */
  readonly valorOrcamento: bigint | null
  readonly programaOrcado: ItemOrcadoNaSaida[] | null
}

/**
 * Carrega o cartão com `FOR UPDATE`.
 *
 * `etapa IS NULL` é **404, não 409**. 409 diria "a tarefa existe e a ação está
 * errada"; a verdade é que ela não é um agendamento — é uma tarefa interna, ou
 * um Follow-up. A RLS já filtra por clínica, então o cartão da vizinha devolve
 * zero linhas, e zero é a mesma resposta de "não existe".
 *
 * O `FOR UPDATE` não é zelo: duas recepcionistas tocando "Confirmou" e
 * "No-show" no mesmo cartão ao mesmo tempo, sem ele, produzem duas leituras do
 * mesmo estado e dois `UPDATE` que se sobrescrevem — e o histórico perde um
 * evento. A trilha (regra 20) é prova, e prova com buraco não é prova.
 */
export async function carregarCartao(c: pg.PoolClient, id: string): Promise<CartaoCarregado> {
  const r = await c.query<{
    etapa: Etapa | null
    status: StatusDeTarefa
    prazo: string
    hora: string | null
    historico: EventoDeJornada[]
    paciente_id: string | null
    tipo: string
    unidade_id: string | null
    valor_orcamento: string | null
    programa_orcado: ItemOrcadoNaSaida[] | null
  }>(
    `SELECT etapa::text AS etapa, status, prazo::text AS prazo, hora::text AS hora, historico,
            paciente_id, tipo, unidade_id,
            -- Texto, e BigInt do lado de cá: o driver devolveria string de
            -- qualquer jeito, mas explicitar impede que uma mudança de
            -- configuração o traga como number — e number perto de dinheiro é
            -- a regra 1 quebrada.
            valor_orcamento::text AS valor_orcamento, programa_orcado
       FROM tarefas WHERE id = $1 AND excluida_em IS NULL FOR UPDATE`,
    [id],
  )
  const l = r.rows[0]
  if (l === undefined || l.etapa === null) {
    throw new NotFoundException('Agendamento não encontrado.')
  }
  return {
    etapa: l.etapa,
    status: l.status,
    prazo: l.prazo,
    hora: l.hora,
    historico: l.historico,
    pacienteId: l.paciente_id,
    tipo: l.tipo,
    unidadeId: l.unidade_id,
    valorOrcamento: l.valor_orcamento === null ? null : BigInt(l.valor_orcamento),
    programaOrcado: l.programa_orcado,
  }
}

/**
 * As colunas que uma ação pode tocar, e o TIPO com que o parâmetro entra.
 *
 * Uma tabela, e não vinte parâmetros posicionais com flags booleanas: a
 * terceira coluna acrescentada ao `UPDATE` à mão é onde o `CASE WHEN $8` passa
 * a apontar para o `$9` errado. Os nomes de coluna vêm desta constante
 * LITERAL — nada aqui vem de corpo de requisição, então não existe superfície
 * de injeção.
 *
 * `undefined` (chave ausente) = não mexe na coluna. `null` = grava NULL.
 */
export const COLUNA_DE_EFEITO = {
  prazo: ['prazo', 'date'],
  hora: ['hora', 'time'],
  proximoPassoEm: ['proximo_passo_em', 'date'],
  confirmacaoEnviadaEm: ['confirmacao_enviada_em', 'timestamptz'],
  valorOrcamento: ['valor_orcamento', 'bigint'],
  programaOrcado: ['programa_orcado', 'jsonb'],
  motivoPerdaId: ['motivo_perda_id', 'uuid'],
} as const satisfies Record<string, readonly [string, string]>

export type ChaveDeColuna = keyof typeof COLUNA_DE_EFEITO

/**
 * Um item da proposta, DERIVADO do contrato — nunca redeclarado.
 *
 * `packages/contracts` é a fonte única da forma. Uma segunda declaração aqui
 * seria a terceira cópia da mesma regra que este projeto existe para não ter.
 */
export type ItemOrcado = NonNullable<
  Extract<MoverEtapa, { acao: 'registrarOrcamento' }>['programa']
>[number]

/**
 * Um item da proposta como ele vai para o `jsonb`.
 *
 * `valor` é STRING DE CENTAVOS, não número JSON (decisão D-4). O `jsonb` do
 * Postgres guarda `numeric` exato, então o banco não perderia precisão — mas
 * `JSON.parse`, do lado do Node, devolve `number`, e um `number` perto de
 * dinheiro é a assinatura que a regra 1 proíbe atravessar.
 */
export type ItemOrcadoNoBanco = Omit<ItemOrcado, 'valor'> & { readonly valor?: string }

/** Centavos em texto, para dentro do `jsonb`. Um lugar só. */
export const centavosNoJsonb = (v: bigint): string => v.toString()

export const programaParaJsonb = (
  programa: readonly ItemOrcado[],
): readonly ItemOrcadoNoBanco[] =>
  programa.map(({ valor, ...resto }) => ({
    ...resto,
    ...(valor === undefined ? {} : { valor: centavosNoJsonb(valor) }),
  }))

/**
 * Os efeitos de uma ação: as colunas que ela toca, e o que vai para o evento.
 *
 * Separado da PERMISSÃO de propósito. Quem decide se a ação é possível é
 * `transicao()`; aqui só se descreve o que acontece depois do sim.
 */
export type Efeitos = {
  readonly prazo?: string
  readonly hora?: string | null
  readonly proximoPassoEm?: string | null
  readonly confirmacaoEnviadaEm?: Date | null
  /** Centavos. Vira texto no parâmetro: o driver não serializa `bigint`. */
  readonly valorOrcamento?: bigint
  readonly programaOrcado?: readonly ItemOrcadoNoBanco[]
  readonly motivoPerdaId?: string | null
  /** O que entra no EVENTO, não em coluna. */
  readonly nota?: string
  readonly valor?: string
  readonly motivoId?: string
  readonly motivo?: string
}

/**
 * O valor de um efeito, pronto para o driver.
 *
 * `bigint` vira TEXTO: o `pg` não serializa `bigint`, e `Number()` perderia
 * precisão acima de 2^53 (regra 1). Objeto vira JSON.
 */
export function paraParametro(valor: unknown): unknown {
  if (typeof valor === 'bigint') return valor.toString()
  if (valor !== null && typeof valor === 'object' && !(valor instanceof Date)) {
    return JSON.stringify(valor)
  }
  return valor ?? null
}
