import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { LeadsController } from './leads.controller'
import { LeadsService } from './leads.service'
import { RotinaInternaController } from './rotina-interna.controller'
import { RotinaInternaService } from './rotina-interna.service'

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
 *
 * Duas fatias coesas dentro do módulo (G8, ticket 0.3): `Leads*` (lead,
 * etapas, arquivar, interações, conversão em `Cliente Firmare`) e
 * `RotinaInterna*` (rotinas, tarefas internas, checkins e o marcador que o
 * worker chama).
 */
@Module({
  controllers: [LeadsController, RotinaInternaController],
  providers: [LeadsService, RotinaInternaService, provedorDeRelogio],
  exports: [LeadsService, RotinaInternaService],
})
export class ProspeccaoCarteiraModule {}
