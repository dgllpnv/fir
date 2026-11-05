import { type CanActivate, type ExecutionContext, Inject, Injectable, NotFoundException, RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import type { RequisicaoComPortal } from './contexto-do-portal'
import { PortalService } from './portal.service'
import { SO_USUARIO_DO_PORTAL } from './so-usuario-do-portal.decorator'

/**
 * O cookie do Portal do Grupo. Quarto espaço de identidade, quarto cookie —
 * nunca substitui `__Host-fir-carteira`, `__Host-fir-painel` nem o do produto.
 */
export const NOME_DO_COOKIE_PORTAL = '__Host-fir-portal'

/**
 * Doze horas — mesma duração da carteira (D-17/ADR 0012): o `Usuário do
 * portal` é um usuário de produto, não um admin raro como o `Operador`
 * (painel, 8h). Sem a parte dinâmica de fim-de-dia-da-clínica: o portal não
 * pertence a uma clínica só (escopo=grupo cruza várias), não há um fuso
 * único contra o qual calcular "fim do dia".
 */
export const DURACAO_SESSAO_PORTAL_MS = 12 * 60 * 60 * 1000

/** As ÚNICAS rotas do portal que atravessam sem sessão — mesma razão do painel/carteira. */
const LIBERADAS: ReadonlySet<string> = new Set(['POST /v1/portal/entrar', 'POST /v1/portal/sair'])

const juntar = (...partes: (string | undefined)[]): string => {
  const limpo = partes
    .filter((p): p is string => typeof p === 'string')
    .flatMap((p) => p.split('/'))
    .filter((p) => p !== '')
  return `/${limpo.join('/')}`
}

/**
 * O guard do portal — mesmo papel de `CarteiraGuard`, um ator mais: nunca
 * acesso total, só ao(s) `Cliente(s) Firmare` do próprio escopo.
 *
 * 404 e não 401, mesma razão da carteira/do painel: não confirmar que a
 * rota existe para quem não provou identidade.
 */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(
    @Inject(PortalService) private readonly portal: PortalService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const soPortal = this.reflector.getAllAndOverride<boolean | undefined>(SO_USUARIO_DO_PORTAL, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (soPortal !== true) return true

    const prefixo = Reflect.getMetadata(PATH_METADATA, ctx.getClass()) as string | undefined
    const caminho = Reflect.getMetadata(PATH_METADATA, ctx.getHandler()) as string | undefined
    const verbo = Reflect.getMetadata(METHOD_METADATA, ctx.getHandler()) as number | undefined
    const chave = `${verbo === undefined ? '?' : (RequestMethod[verbo] ?? '?')} ${juntar(prefixo, caminho)}`
    if (LIBERADAS.has(chave)) return true

    const req = ctx
      .switchToHttp()
      .getRequest<RequisicaoComPortal & { cookies?: Record<string, string> }>()
    const token = req.cookies?.[NOME_DO_COOKIE_PORTAL]
    // Mesma resposta para "sem cookie", "inválido", "expirado" e
    // "desativado" — quatro frases diferentes seriam quatro informações de
    // graça (ADR 0018 §3 item 2).
    if (!token) throw new NotFoundException()

    const contexto = await this.portal.contextoDoToken(token)
    if (!contexto) throw new NotFoundException()

    req.portal = contexto
    return true
  }
}
