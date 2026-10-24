import { Module } from '@nestjs/common'
import { AuditoriaService } from './auditoria.service'

/**
 * `AuditoriaService` é exportado porque o `AcessoInterceptor` é registrado
 * como `APP_INTERCEPTOR` no `AppModule` — provider global se resolve no
 * módulo que o declara, então o `AppModule` precisa ver o serviço.
 */
@Module({
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
