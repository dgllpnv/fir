import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { TarefasModule } from '../tarefas/tarefas.module'
import { CatalogoController } from './catalogo.controller'
import { CatalogoService } from './catalogo.service'
import { MontadorDePrograma } from './montador-de-programa'
import { MontadorRelacional } from './montador.service'
import { ProgramasController } from './programas.controller'
import { ProgramasService } from './programas.service'

/**
 * PROGRAMAS — o catálogo, a montagem e o seam que a jornada consome.
 *
 * `MontadorDePrograma` é EXPORTADO: quem o consome é o `FechamentoService`,
 * que mora em `JornadaModule`. A dependência é de mão única — `jornada →
 * programas` é a que o DADO já tem (`tarefas.programa_orcado` guarda
 * `procedimentoId` desde o épico 3) —, então não há ciclo. O inverso teria.
 *
 * `provedorDeRelogio` porque a data de negócio vem do SERVIDOR (regra 24):
 * nenhum `new Date()` dentro de serviço, e o teste precisa poder fixar o
 * instante para provar que o início padrão é hoje NO FUSO DA CLÍNICA.
 */
@Module({
  imports: [TarefasModule],
  controllers: [CatalogoController, ProgramasController],
  providers: [
    CatalogoService,
    ProgramasService,
    provedorDeRelogio,
    // O seam, ligado à implementação relacional. O épico 6 fará o mesmo
    // movimento com `BaixaDeInsumos`.
    { provide: MontadorDePrograma, useClass: MontadorRelacional },
  ],
  exports: [MontadorDePrograma],
})
export class ProgramasModule {}
