import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { TarefasModule } from '../tarefas/tarefas.module'
import { CatalogoController } from './catalogo.controller'
import { CatalogoService } from './catalogo.service'
import { LeituraDeProgramasService } from './leitura.service'
import { MontadorDePrograma } from './montador-de-programa'
import { MontadorRelacional } from './montador.service'
import { BaixaDeInsumos, BaixaInerte } from './baixa-de-insumos'
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
  imports: [TarefasModule],
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
     * **O SEAM DO ÉPICO 6, INERTE.**
     *
     * Quando o estoque entrar, isto vira
     * `{ provide: BaixaDeInsumos, useClass: BaixaRelacional }` — uma linha, o
     * mesmo movimento que a Task 8 fez com o montador — e `BaixaInerte` é
     * **apagada**, não deixada para trás. O invariante que a implementação de
     * verdade terá de honrar está escrito, com teste, em
     * `baixa-de-insumos.test.ts`.
     */
    { provide: BaixaDeInsumos, useClass: BaixaInerte },
  ],
  // `LeituraDeProgramasService` e EXPORTADO porque `HojeController` (em
  // `HojeModule`) compoe o bloco "Sessoes de programas" com ele.
  exports: [MontadorDePrograma, BaixaDeInsumos, LeituraDeProgramasService],
})
export class ProgramasModule {}
