import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { TarefasModule } from '../tarefas/tarefas.module'
import { FechamentoService } from './fechamento.service'
import { FunilController } from './funil.controller'
import { FunilService } from './funil.service'
import { JornadaController } from './jornada.controller'
import { JornadaService } from './jornada.service'
import { MontadorDePrograma } from '../programas/montador-de-programa'
import { MontadorIndisponivel } from './montador-de-programa'
import { MotivosController, MotivosService } from './motivos.controller'

/**
 * `TarefasModule` é importado porque `reabrir` DELEGA para
 * `ConclusaoService.reabrir` — uma implementação, duas portas. Reescrever o
 * estorno do recebimento aqui seria a segunda cópia da regra que mexe em
 * dinheiro, e a segunda cópia é a que esquece o estorno.
 */
@Module({
  imports: [TarefasModule],
  controllers: [JornadaController, FunilController, MotivosController],
  providers: [
    JornadaService,
    FechamentoService,
    FunilService,
    MotivosService,
    /**
     * **A LINHA QUE FALTA TROCAR — Task 8 do plano do épico 5.**
     *
     * `MontadorDePrograma` é o seam, e ele agora mora em
     * `apps/api/src/programas/`. `MontadorRelacional` já EXISTE e funciona
     * (`ProgramasModule` o exporta): o conserto é
     * `imports: [TarefasModule, ProgramasModule]` e apagar esta linha, mais
     * `jornada/montador-de-programa.ts`.
     *
     * Por que não agora: `fechar` é o caminho do DINHEIRO, e ligá-lo sem os
     * testes de atomicidade da Task 8 seria entregar as quatro escritas sem a
     * prova de que elas vivem ou morrem juntas. Enquanto isso o montador
     * recusa, e a recusa desfaz a transação inteira — em vez de deixar o
     * dinheiro lançado e as sessões sem existir.
     */
    { provide: MontadorDePrograma, useClass: MontadorIndisponivel },
    provedorDeRelogio,
  ],
  exports: [JornadaService],
})
export class JornadaModule {}
