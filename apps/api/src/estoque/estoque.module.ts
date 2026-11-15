import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { BaixaDeInsumos } from '../programas/baixa-de-insumos'
import { AnaliseService } from './analise.service'
import { BaixaRelacional } from './baixa-relacional'
import { ConsumoDoPacienteController } from './consumo-do-paciente.controller'
import { ConsumoDoPacienteService } from './consumo-do-paciente.service'
import { ContagensService } from './contagens.service'
import { DiferencasService } from './diferencas.service'
import { ImportacaoDeItensService } from './importacao.service'
import { LeitorDeNota, LeitorDeNotaXml } from './leitor-de-nota'
import { NotasService } from './notas.service'
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
  controllers: [ItensController, ConsumoDoPacienteController],
  providers: [
    ItensService,
    LocaisService,
    MovimentosService,
    ImportacaoDeItensService,
    ContagensService,
    DiferencasService,
    ConsumoDoPacienteService,
    NotasService,
    AnaliseService,
    provedorDeRelogio,
    { provide: BaixaDeInsumos, useClass: BaixaRelacional },
    // O seam `LeitorDeNota` (CLAUDE.md 5), provido com o leitor de XML. Ele
    // nao toca o banco: o que entra e texto e o que sai sao linhas com
    // quantidade inteira — e e por isso que ele e testavel com um arquivo.
    { provide: LeitorDeNota, useClass: LeitorDeNotaXml },
  ],
  exports: [BaixaDeInsumos],
})
export class EstoqueModule {}
