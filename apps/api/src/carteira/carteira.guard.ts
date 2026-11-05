import { type CanActivate, type ExecutionContext, Inject, Injectable, NotFoundException, RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import type { RequisicaoComCarteira } from './contexto-da-carteira'
import { CarteiraService } from './carteira.service'
import { SO_USUARIO_DE_GESTAO } from './so-usuario-de-gestao.decorator'

/**
 * O cookie da carteira. Outro nome, outro espaço de identidade — não
 * substitui `__Host-fir-painel` nem o cookie do produto.
 */
export const NOME_DO_COOKIE_CARTEIRA = '__Host-fir-carteira'

/**
 * Doze horas — o teto já usado para a sessão do balcão (D-17), sem a parte
 * dinâmica (fim do dia da clínica): a carteira não pertence a uma clínica,
 * não tem fuso para calcular "fim do dia" contra. O `Usuário de Gestão` é um
 * usuário de produto o dia inteiro, como a recepção — não um admin raro como
 * o `Operador` (8h, painel).
 */
export const DURACAO_SESSAO_CARTEIRA_MS = 12 * 60 * 60 * 1000

/** As ÚNICAS rotas de carteira que atravessam sem sessão — mesma razão do painel. */
const LIBERADAS: ReadonlySet<string> = new Set(['POST /v1/carteira/entrar', 'POST /v1/carteira/sair'])

const juntar = (...partes: (string | undefined)[]): string => {
  const limpo = partes
    .filter((p): p is string => typeof p === 'string')
    .flatMap((p) => p.split('/'))
    .filter((p) => p !== '')
  return `/${limpo.join('/')}`
}

/**
 * O guard da carteira — mesmo papel de `PainelGuard`, um nível abaixo:
 * `Usuário de Gestão` nunca tem acesso total, só ao(s) grupo(s) atribuídos.
 *
 * 404 e não 401, mesma razão do painel: não confirmar que a rota existe para
 * quem não provou identidade.
 */
@Injectable()
export class CarteiraGuard implements CanActivate {
  constructor(
    @Inject(CarteiraService) private readonly carteira: CarteiraService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const soCarteira = this.reflector.getAllAndOverride<boolean | undefined>(SO_USUARIO_DE_GESTAO, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (soCarteira !== true) return true

    const prefixo = Reflect.getMetadata(PATH_METADATA, ctx.getClass()) as string | undefined
    const caminho = Reflect.getMetadata(PATH_METADATA, ctx.getHandler()) as string | undefined
    const verbo = Reflect.getMetadata(METHOD_METADATA, ctx.getHandler()) as number | undefined
    const chave = `${verbo === undefined ? '?' : (RequestMethod[verbo] ?? '?')} ${juntar(prefixo, caminho)}`
    if (LIBERADAS.has(chave)) return true

    const req = ctx
      .switchToHttp()
      .getRequest<RequisicaoComCarteira & { cookies?: Record<string, string> }>()
    const token = req.cookies?.[NOME_DO_COOKIE_CARTEIRA]
    // Mesma resposta para "sem cookie", "inválido", "expirado" e
    // "desativado" — quatro frases diferentes seriam quatro informações de
    // graça.
    if (!token) throw new NotFoundException()

    const contexto = await this.carteira.contextoDoToken(token)
    if (!contexto) throw new NotFoundException()

    req.carteira = contexto
    return true
  }
}
