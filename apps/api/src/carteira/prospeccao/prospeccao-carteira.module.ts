import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { ProspeccaoCarteiraController } from './prospeccao-carteira.controller'
import { ProspeccaoCarteiraService } from './prospeccao-carteira.service'

/**
 * G5 — funil de prospecção e rotina interna da equipe Firmare.
 *
 * Módulo PRÓPRIO, não fundido em `CarteiraModule`, para que as duas frentes
 * (G3/G5) evoluam em paralelo sem colidir no mesmo arquivo. Já fiado: `
 * carteira.module.ts` importa `ProspeccaoCarteiraModule` — ativo em
 * produção, servindo `/v1/carteira/leads`, `/rotinas-internas`,
 * `/tarefas-internas` e `/checkins-internos`. `BancoService` chega por
 * `BancoModule` (`@Global()`, `app.module.ts`), e `CarteiraGuard`/
 * `SoUsuarioDeGestao` são reaproveitados tal como estão — nenhuma mudança
 * neles.
 */
@Module({
  controllers: [ProspeccaoCarteiraController],
  providers: [ProspeccaoCarteiraService, provedorDeRelogio],
  exports: [ProspeccaoCarteiraService],
})
export class ProspeccaoCarteiraModule {}
