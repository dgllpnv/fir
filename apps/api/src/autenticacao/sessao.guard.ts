import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { RequisicaoComContexto } from '../comum/contexto'
import { AutenticacaoService } from './autenticacao.service'

export const NOME_DO_COOKIE = '__Host-fir-sessao'

/**
 * Popula `req.contexto` a partir do cookie. **Nenhum identificador de usuário
 * ou de clínica vem do corpo ou da query** — se viesse, trocar um id no
 * DevTools leria o paciente de outra clínica.
 */
@Injectable()
export class SessaoGuard implements CanActivate {
  // `@Inject` explícito: ver o comentário em autenticacao.service.ts.
  constructor(@Inject(AutenticacaoService) private readonly auth: AutenticacaoService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<RequisicaoComContexto & { cookies?: Record<string, string> }>()
    const token = req.cookies?.[NOME_DO_COOKIE]
    if (!token) throw new UnauthorizedException('Entre para continuar.')

    const contexto = await this.auth.contextoDoToken(token)
    if (!contexto) throw new UnauthorizedException('Entre para continuar.')

    req.contexto = contexto
    return true
  }
}
