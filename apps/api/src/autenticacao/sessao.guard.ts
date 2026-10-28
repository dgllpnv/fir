import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { RequisicaoComContexto } from '../comum/contexto'
import { PUBLICO } from '../autorizacao/publico.decorator'
import { SO_OPERADOR } from '../painel/so-operador.decorator'
import { AutenticacaoService } from './autenticacao.service'

export const NOME_DO_COOKIE = '__Host-fir-sessao'

/**
 * Popula `req.contexto` a partir do cookie. **Nenhum identificador de usuário
 * ou de clínica vem do corpo ou da query** — se viesse, trocar um id no
 * DevTools leria o paciente de outra clínica.
 *
 * Registrado como `APP_GUARD` em `app.module.ts`, portanto **global**: roda em
 * toda rota de todo controlador, presente e futuro. Só `@Publico()` dispensa.
 * Era por rota (`@UseGuards`) até a revisão final da branch, e o modo de
 * falha era o que importa: um controlador novo copiado de
 * `saude.controller.ts` subia sem autenticação nenhuma, e nenhum teste
 * quebrava.
 */
@Injectable()
export class SessaoGuard implements CanActivate {
  // `@Inject` explícito: ver o comentário em autenticacao.service.ts.
  constructor(
    @Inject(AutenticacaoService) private readonly auth: AutenticacaoService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // `getAllAndOverride` para que `@Publico()` na classe libere o
    // controlador inteiro (é o caso de `SaudeController`) e no handler libere
    // só aquela rota.
    const publico = this.reflector.getAllAndOverride<boolean | undefined>(PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (publico === true) return true

    /**
     * ROTA DE PAINEL: sai do caminho **sem popular `req.contexto`**.
     *
     * Quem a protege é o `PainelGuard`, e a ausência de contexto aqui é o
     * desenho: o operador não pertence a clínica nenhuma, então não há
     * `clinicaId`, não há `perfis` e não há `pode`. Popular um contexto
     * fabricado seria tratá-lo como pessoa de alguma clínica — exatamente o
     * que a D-5 restrição 1 proíbe.
     *
     * Consequência deliberada: sem `req.contexto`, o `RedacaoInterceptor`
     * cai no `pode = () => false` e apaga todo campo monetário da resposta.
     * Hoje isso custa nada — o painel só trata identidade. **No dia em que o
     * painel mostrar dinheiro, esta é a linha a revisitar**, e a resposta
     * certa será dar ao contexto do operador um `pode` próprio, nunca
     * desligar o interceptor.
     */
    const soOperador = this.reflector.getAllAndOverride<boolean | undefined>(SO_OPERADOR, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (soOperador === true) return true

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
