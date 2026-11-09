import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { CampanhasController } from './campanhas.controller'
import { CampanhasService } from './campanhas.service'
import { CampanhasVinculaveisController } from './vinculaveis.controller'

/**
 * **Comercial › Campanhas** (épico 8).
 *
 * Módulo próprio e não um apêndice de `PacientesModule`: a campanha é um
 * conceito com ciclo de vida, meta e período, e a importação dela só CRIA
 * paciente de passagem — o dono do cadastro continua sendo o outro módulo.
 */
@Module({
  // A lista vinculável vem ANTES: a rota estática `vinculaveis` é registrada
  // primeiro, e nenhum `:id` de `CampanhasController` a sombreia.
  controllers: [CampanhasVinculaveisController, CampanhasController],
  providers: [CampanhasService, provedorDeRelogio],
  /**
   * **Exportado para o `PainelGeralModule`**, e só para ele.
   *
   * O bloco "Campanhas no período" do painel devolve a MESMA forma de
   * `GET /v1/campanhas` porque as sete contagens, o percentual da meta e a taxa
   * de conversão de uma campanha são **uma** regra — e ela mora aqui. A
   * alternativa era um `SELECT` novo no painel com as mesmas sete contagens:
   * exatamente a herança que o `CLAUDE.md` paga, a mesma regra em dois lugares,
   * divergindo no primeiro ajuste.
   */
  exports: [CampanhasService],
})
export class CampanhasModule {}
