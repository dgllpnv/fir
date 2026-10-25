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
import { VisaoDoMesController } from './visao-do-mes.controller'
import { VisaoDoMesService } from './visao-do-mes.service'

/**
 * O financeiro, inteiro: recebimentos, saldo em aberto, cobranças, o caixa do
 * dia, as contas a pagar, a meta, a configuração e a Visão do mês.
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
    VisaoDoMesController,
  ],
  providers: [
    RecebimentosService,
    CobrancasService,
    CaixaService,
    ContasService,
    HojeFinanceiroService,
    VisaoDoMesService,
    provedorDeRelogio,
  ],
  exports: [RecebimentosService, HojeFinanceiroService],
})
export class FinanceiroModule {}
