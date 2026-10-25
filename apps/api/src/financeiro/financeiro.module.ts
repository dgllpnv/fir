import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { CobrancasController } from './cobrancas.controller'
import { CobrancasService } from './cobrancas.service'
import { RecebimentosController } from './recebimentos.controller'
import { RecebimentosService } from './recebimentos.service'
import { SaldoController } from './saldo.controller'

/**
 * O financeiro: recebimentos, saldo em aberto e cobranças. Caixa, contas e
 * Visão do mês entram pelas Tasks 9 a 11 do mesmo plano.
 *
 * `SaldoController` responde em `v1/pacientes/:id/saldo` e mora aqui, não em
 * `PacientesModule`: a regra é do financeiro, e o caminho é de paciente
 * porque é dele que a tela parte.
 *
 * `provedorDeRelogio` porque a data de negócio vem do SERVIDOR (regra 24), e
 * nenhum `new Date()` mora dentro de serviço — o teste precisa poder fixar o
 * instante para provar que "amanhã" é recusado.
 */
@Module({
  controllers: [RecebimentosController, SaldoController, CobrancasController],
  providers: [RecebimentosService, CobrancasService, provedorDeRelogio],
  exports: [RecebimentosService],
})
export class FinanceiroModule {}
