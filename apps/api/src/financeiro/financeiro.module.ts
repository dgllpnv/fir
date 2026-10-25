import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { CaixaController } from './caixa.controller'
import { CaixaService } from './caixa.service'
import { CobrancasController } from './cobrancas.controller'
import { ContasController } from './contas.controller'
import { ContasService } from './contas.service'
import { HojeFinanceiroService } from './hoje-financeiro.service'
import { CobrancasService } from './cobrancas.service'
import { RecebimentosController } from './recebimentos.controller'
import { RecebimentosService } from './recebimentos.service'
import { SaldoController } from './saldo.controller'

/**
 * O financeiro: recebimentos, saldo em aberto, cobranças, o caixa do dia e as
 * contas a pagar. A Visão do mês entra pela Task 11 do mesmo plano.
 *
 * `HojeFinanceiroService` é EXPORTADO porque quem o consome é `HojeController`,
 * que mora em `TarefasModule`. A dependência é de mão única — o financeiro não
 * importa tarefas —, então não há ciclo.
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
  controllers: [
    RecebimentosController,
    SaldoController,
    CobrancasController,
    CaixaController,
    ContasController,
  ],
  providers: [
    RecebimentosService,
    CobrancasService,
    CaixaService,
    ContasService,
    HojeFinanceiroService,
    provedorDeRelogio,
  ],
  exports: [RecebimentosService, HojeFinanceiroService],
})
export class FinanceiroModule {}
