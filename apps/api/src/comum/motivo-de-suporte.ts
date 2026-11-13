import { MotivoDeSuporte } from '@fir/contracts'
import { BadRequestException } from '@nestjs/common'
import type pg from 'pg'
import type { Ator } from '../banco/ator'

/**
 * A JUSTIFICATIVA da ação do Suporte Firmare dentro de uma clínica (I1).
 *
 * `decisoes.md` exige "justificativa por acesso e prazo", e a sessão de suporte
 * excluía tarefa, estornava recebimento e reativava paciente sem dizer por quê.
 * O operador é obrigado a informar o motivo; a PESSOA da clínica continua como
 * sempre foi — o motivo é opcional e, se vier, é gravado do mesmo jeito.
 *
 * Mora no servidor e roda ANTES de a transação abrir: a recusa é 400, e nada
 * foi lido nem tocado. A tela pede o campo, mas tela não é controle (regra 16).
 */
export function motivoDaAcao(ator: Ator, motivo: string | undefined): string | null {
  const doOperador = typeof ator === 'object' && ator.tipo === 'operador'
  if (motivo === undefined || motivo.trim() === '') {
    if (!doOperador) return null
    throw new BadRequestException(
      'Informe o motivo desta ação de suporte (de 10 a 200 caracteres). Ele fica na trilha da clínica.',
    )
  }
  const lido = MotivoDeSuporte.safeParse(motivo)
  if (!lido.success) {
    throw new BadRequestException('O motivo deve ter de 10 a 200 caracteres.')
  }
  return lido.data
}

/**
 * Entrega o motivo à trigger `registrar_auditoria` (migration 0079) por uma
 * variável de sessão LOCAL À TRANSAÇÃO — a mesma técnica de `app.pessoa_id`.
 * Toda linha de trilha escrita nesta transação leva o motivo.
 */
export async function declararMotivo(c: pg.PoolClient, motivo: string | null): Promise<void> {
  if (motivo === null) return
  await c.query(`SELECT set_config('app.motivo', $1, true)`, [motivo])
}
