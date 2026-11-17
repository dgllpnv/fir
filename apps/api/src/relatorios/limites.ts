import { LIMITE_DE_LINHAS } from '@fir/contracts'
import type { Provider } from '@nestjs/common'

/**
 * Os limites do motor (spec I-36; appsec C13). Provider, e não constante, por
 * UM motivo: o teste do `503` precisa de um `statement_timeout` curto para não
 * esperar dez segundos — e é a única troca que a suíte faz aqui.
 */
export type LimitesDoMotor = {
  /** `SET LOCAL statement_timeout`, em milissegundos. */
  readonly tempoMaximoMs: number
  /** Gerações + exportações por pessoa, na última hora. */
  readonly porHora: number
  readonly linhas: number
}

export const LIMITES_DO_MOTOR = Symbol('fir.relatorios.limites')

export const LIMITES_PADRAO: LimitesDoMotor = { tempoMaximoMs: 10_000, porHora: 60, linhas: LIMITE_DE_LINHAS }

export const provedorDeLimites: Provider = { provide: LIMITES_DO_MOTOR, useValue: LIMITES_PADRAO }
