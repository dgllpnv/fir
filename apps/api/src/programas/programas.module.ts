import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { EstoqueModule } from '../estoque/estoque.module'
import { TarefasModule } from '../tarefas/tarefas.module'
import { CatalogoController } from './catalogo.controller'
import { CatalogoService } from './catalogo.service'
import { LeituraDeProgramasService } from './leitura.service'
import { MontadorDePrograma } from './montador-de-programa'
import { MontadorRelacional } from './montador.service'
import { ProgramasController } from './programas.controller'
import { ProgramasService } from './programas.service'
import { SessoesController } from './sessoes.controller'
import { SessoesService } from './sessoes.service'

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
  imports: [TarefasModule, EstoqueModule],
  controllers: [CatalogoController, ProgramasController, SessoesController],
  providers: [
    CatalogoService,
    ProgramasService,
    LeituraDeProgramasService,
    SessoesService,
    provedorDeRelogio,
    // O seam da montagem, ligado à implementação relacional.
    { provide: MontadorDePrograma, useClass: MontadorRelacional },
    /**
     * **O SEAM DO ÉPICO 6 NÃO ESTÁ MAIS AQUI — ele está LIGADO.**
     *
     * `BaixaDeInsumos` vem de `EstoqueModule`, provido por `BaixaRelacional`, e
     * `BaixaInerte` foi **apagada** em vez de deixada para trás: provider
     * alternativo que ninguém usa é o lugar onde a próxima pessoa pluga sem
     * perceber. Foi a lição do `MontadorIndisponivel`, que o épico 3 deixou e a
     * Task 8 do épico 5 removeu — e a instrução estava escrita no próprio
     * arquivo do seam.
     *
     * A DIREÇÃO da dependência é `programas → estoque`: o estoque sabe gravar
     * movimento, o programa sabe quando pedir. Invertida, o módulo de programas
     * passaria a conhecer o esquema do estoque.
     */
  ],
  // `LeituraDeProgramasService` e EXPORTADO porque `HojeController` (em
  // `HojeModule`) compoe o bloco "Sessoes de programas" com ele.
  // `EstoqueModule` é RE-EXPORTADO, e não o token: quem importa
  // `ProgramasModule` por causa do montador (a jornada) continua alcançando
  // `BaixaDeInsumos` sem precisar saber que ele mudou de casa.
  exports: [MontadorDePrograma, EstoqueModule, LeituraDeProgramasService],
})
export class ProgramasModule {}
