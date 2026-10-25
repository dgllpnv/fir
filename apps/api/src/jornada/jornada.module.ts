import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { TarefasModule } from '../tarefas/tarefas.module'
import { FechamentoService } from './fechamento.service'
import { JornadaController } from './jornada.controller'
import { JornadaService } from './jornada.service'
import { MontadorDePrograma, MontadorIndisponivel } from './montador-de-programa'
import { MotivosController, MotivosService } from './motivos.controller'

/**
 * `TarefasModule` é importado porque `reabrir` DELEGA para
 * `ConclusaoService.reabrir` — uma implementação, duas portas. Reescrever o
 * estorno do recebimento aqui seria a segunda cópia da regra que mexe em
 * dinheiro, e a segunda cópia é a que esquece o estorno.
 */
@Module({
  imports: [TarefasModule],
  controllers: [JornadaController, MotivosController],
  providers: [
    JornadaService,
    FechamentoService,
    MotivosService,
    /**
     * **A LINHA QUE O ÉPICO 5 TROCA.**
     *
     * `MontadorDePrograma` é o seam declarado em `docs/arquitetura/sistema.md`:
     * o fechamento de um orçamento com programa precisa montar o `Programa` na
     * mesma transação do recebimento e da etapa. Enquanto a tabela de programas
     * não existe, o montador recusa — e a recusa desfaz a transação inteira,
     * em vez de deixar o dinheiro lançado e as sessões sem existir.
     */
    { provide: MontadorDePrograma, useClass: MontadorIndisponivel },
    provedorDeRelogio,
  ],
  exports: [JornadaService],
})
export class JornadaModule {}
