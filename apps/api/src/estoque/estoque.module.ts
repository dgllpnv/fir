import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { BaixaDeInsumos } from '../programas/baixa-de-insumos'
import { BaixaRelacional } from './baixa-relacional'
import { ImportacaoDeItensService } from './importacao.service'
import { ItensController } from './itens.controller'
import { ItensService } from './itens.service'
import { LocaisService } from './locais.service'
import { MovimentosService } from './movimentos.service'

/**
 * O ESTOQUE.
 *
 * `BaixaDeInsumos` é provido **aqui** com a implementação relacional, e
 * `exports` o entrega ao `ProgramasModule` — que é quem o CHAMA (concluir
 * sessão, reabrir, excluir programa). A direção é essa de propósito: o estoque
 * sabe gravar movimento, o programa sabe quando pedir. Invertida, o módulo de
 * programas passaria a conhecer o esquema do estoque.
 */
@Module({
  controllers: [ItensController],
  providers: [
    ItensService,
    LocaisService,
    MovimentosService,
    ImportacaoDeItensService,
    provedorDeRelogio,
    { provide: BaixaDeInsumos, useClass: BaixaRelacional },
  ],
  exports: [BaixaDeInsumos],
})
export class EstoqueModule {}
