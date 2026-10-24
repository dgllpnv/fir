import { type Relogio, RelogioDoSistema } from '@fir/domain'
import type { Provider } from '@nestjs/common'

/**
 * O token de injeção do relógio.
 *
 * `Relogio` é uma INTERFACE do domínio, e interface some na compilação — não
 * existe em tempo de execução para servir de token. O símbolo serve, e não
 * colide com nada.
 *
 * O relógio é injetado, e não `new Date()` dentro dos serviços, por uma razão
 * que o épico 2 inteiro depende: a data de negócio vem do SERVIDOR (regra 24)
 * e o teste precisa poder fixá-la. Sem isso, "o atalho de aniversariantes usa
 * o mês do fuso da clínica" só seria testável esperando a virada do mês, e
 * "hoje na clínica é ontem no UTC" seria impossível de escrever.
 */
export const RELOGIO = Symbol('fir.relogio')

export const provedorDeRelogio: Provider = { provide: RELOGIO, useClass: RelogioDoSistema }

export type { Relogio }
