import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common'
import { BancoService } from '../banco/banco.service'

/**
 * Healthcheck que verifica o **banco**, não só se o processo está de pé.
 * Um container "saudável" cujo Postgres caiu é pior que um container morto:
 * ele continua recebendo tráfego.
 */
@Controller('v1/saude')
export class SaudeController {
  // `@Inject` explícito: a injeção por tipo refletido depende de
  // `design:paramtypes`, metadado que o esbuild (usado por vite/vitest e por
  // tsx) não emite mesmo com `emitDecoratorMetadata` no tsconfig — medido
  // diretamente, não suposto. Sem o token explícito, o Nest injeta
  // `undefined` nesse parâmetro.
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  @Get()
  async saude(): Promise<{ ok: boolean; banco: boolean }> {
    try {
      await this.banco.semIsolamentoDeClinica('SELECT 1')
      return { ok: true, banco: true }
    } catch {
      // 503, não 200: quem só lê o código HTTP — `HEALTHCHECK CMD curl -f` do
      // Docker, liveness probe padrão, balanceador simples — precisa
      // enxergar o banco fora sem interpretar o corpo. O corpo continua
      // {ok, banco} nos dois casos, para quem lê o JSON.
      throw new HttpException({ ok: false, banco: false }, HttpStatus.SERVICE_UNAVAILABLE)
    }
  }
}
