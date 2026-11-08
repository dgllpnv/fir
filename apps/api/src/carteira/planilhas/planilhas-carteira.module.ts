import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { PlanilhasCarteiraController } from './planilhas-carteira.controller'
import {
  PEDIDO_DE_LEITURA_DA_PLANILHA,
  PedidoPelaFilaDePlanilhas,
  PlanilhasCarteiraService,
} from './planilhas-carteira.service'

/**
 * A planilha de indicadores do `Cliente Firmare` (ticket 4A). Só a parte da
 * API: gravar o link, pedir a leitura, devolver a situação. A leitura é do
 * `worker-planilhas`, processo à parte com saída para o Google — este módulo
 * não fala com a internet e não conhece a credencial.
 */
@Module({
  controllers: [PlanilhasCarteiraController],
  providers: [
    PlanilhasCarteiraService,
    provedorDeRelogio,
    { provide: PEDIDO_DE_LEITURA_DA_PLANILHA, useClass: PedidoPelaFilaDePlanilhas },
  ],
})
export class CarteiraPlanilhasModule {}
