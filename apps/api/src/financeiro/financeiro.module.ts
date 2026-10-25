import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { RecebimentosController } from './recebimentos.controller'
import { RecebimentosService } from './recebimentos.service'

/**
 * O financeiro. Hoje só Recebimentos; caixa, contas, cobranças e Visão do mês
 * entram pelas Tasks 8 a 11 do mesmo plano.
 *
 * `provedorDeRelogio` porque a data de negócio vem do SERVIDOR (regra 24), e
 * nenhum `new Date()` mora dentro de serviço — o teste precisa poder fixar o
 * instante para provar que "amanhã" é recusado.
 */
@Module({
  controllers: [RecebimentosController],
  providers: [RecebimentosService, provedorDeRelogio],
  exports: [RecebimentosService],
})
export class FinanceiroModule {}
