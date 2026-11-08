import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { IndicadoresDoClienteService } from './indicadores-do-cliente.service'
import { MetasDoClienteController } from './metas-do-cliente.controller'
import { MetasDoClienteService } from './metas-do-cliente.service'

/**
 * G8 2B — metas completas e indicadores manuais (M1–M4, M6, V10). Módulo
 * próprio, ao lado de `CarteiraFinanceiroModule` (que segue com as rotas de
 * G3 e a cobrança): precisa do relógio injetado, porque a semana da reunião,
 * o mês da meta e "atrasada" são datas de negócio do SERVIDOR (regra 24).
 */
@Module({
  controllers: [MetasDoClienteController],
  providers: [MetasDoClienteService, IndicadoresDoClienteService, provedorDeRelogio],
})
export class CarteiraMetasModule {}
