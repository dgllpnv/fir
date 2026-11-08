import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { ChecklistDoClienteService } from './checklist-do-cliente.service'
import { ChecklistsCarteiraController } from './checklists.controller'
import { EntradaDeClienteService } from './entrada-de-cliente.service'
import { ModelosDeChecklistService } from './modelos.service'

/**
 * G8 2C — checklists dos programas (X3), aplicar checklist (X5), checklist do
 * contrato na ficha (V3, V15) e a entrada de cliente (C4, C6). O
 * `CarteiraGuard` global protege as rotas pela metadata de
 * `@SoUsuarioDeGestao()`; `BancoService` vem do `BancoModule` global.
 */
@Module({
  controllers: [ChecklistsCarteiraController],
  providers: [ModelosDeChecklistService, ChecklistDoClienteService, EntradaDeClienteService, provedorDeRelogio],
})
export class CarteiraChecklistsModule {}
