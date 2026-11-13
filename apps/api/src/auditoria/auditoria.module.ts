import { Module } from '@nestjs/common'
import { AtividadesDaClinicaController } from './atividades.controller'
import { AtividadesDaClinicaService } from './atividades.service'
import { AuditoriaController } from './auditoria.controller'
import { AuditoriaService } from './auditoria.service'

/**
 * `AuditoriaService` é exportado porque o `AcessoInterceptor` é registrado
 * como `APP_INTERCEPTOR` no `AppModule` — provider global se resolve no
 * módulo que o declara, então o `AppModule` precisa ver o serviço.
 */
@Module({
  controllers: [AuditoriaController, AtividadesDaClinicaController],
  providers: [AuditoriaService, AtividadesDaClinicaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
