import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import type { RequisicaoComPainel } from './contexto-do-painel'
import { PainelService } from './painel.service'
import { SO_OPERADOR } from './so-operador.decorator'

/**
 * O cookie do painel. **Outro nome, outro valor, outro espaço de
 * identidade** — o cookie do produto não o substitui, e vice-versa.
 *
 * `__Host-` pelo mesmo motivo do outro: obriga `Secure` e `Path=/`, proíbe
 * `Domain`. É o prefixo mais restrito que existe.
 */
export const NOME_DO_COOKIE_PAINEL = '__Host-fir-painel'

/**
 * Oito horas, e não os trinta dias do produto.
 *
 * O balcão não pode relogar a cada hora (P-1); o painel pode — ele é usado
 * algumas vezes por semana, por duas pessoas, e guarda a credencial mais
 * valiosa do produto: a que cria clínica e administradora em qualquer
 * clínica. Uma sessão de trinta dias num notebook é a janela em que um
 * descuido vale tudo.
 */
export const DURACAO_SESSAO_PAINEL_MS = 8 * 60 * 60 * 1000

/**
 * As ÚNICAS rotas de painel que atravessam sem sessão de painel.
 *
 * `entrar` porque é ela que CRIA a sessão — exigir sessão aqui seria circular.
 * `sair` porque um cookie expirado precisa poder ser limpo: protegida, o
 * botão "Sair" deixaria de sair, e o navegador ficaria com o cookie velho.
 *
 * Lista central e curta, nunca um decorador por rota: acrescentar uma linha
 * aqui é visível na revisão, e esquecer um decorador não é.
 */
const LIBERADAS: ReadonlySet<string> = new Set([
  'POST /v1/superadmin/entrar',
  'POST /v1/superadmin/sair',
])

const juntar = (...partes: (string | undefined)[]): string => {
  const limpo = partes
    .filter((p): p is string => typeof p === 'string')
    .flatMap((p) => p.split('/'))
    .filter((p) => p !== '')
  return `/${limpo.join('/')}`
}

/**
 * O guard do painel — quarto `APP_GUARD`, e o único que responde **404**.
 *
 * ## Por que 404 e não 401
 *
 * 401 confirma que a rota existe. Atrás da allowlist de rede isso importa
 * pouco; numa origem permitida mas sem credencial — um notebook roubado, uma
 * rede do escritório — importa: a diferença entre "existe um painel aqui" e
 * "não existe nada aqui" é a diferença entre valer a pena insistir e não
 * valer. A allowlist é a primeira camada e esta é a segunda, e as duas falham
 * fechadas.
 *
 * ## Por que global
 *
 * Pela mesma razão dos outros três: com guarda por rota, a rota que o
 * programador esquecer é a que fica aberta. Aqui o esquecimento é pior que o
 * do produto — uma rota de painel sem guard não entrega UMA clínica, entrega
 * **todas**.
 *
 * Para rota que não é de painel, devolve `true` e sai do caminho: quem decide
 * lá é o `SessaoGuard`.
 */
@Injectable()
export class PainelGuard implements CanActivate {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(PainelService) private readonly painel: PainelService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const soOperador = this.reflector.getAllAndOverride<boolean | undefined>(SO_OPERADOR, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (soOperador !== true) return true

    const prefixo = Reflect.getMetadata(PATH_METADATA, ctx.getClass()) as string | undefined
    const caminho = Reflect.getMetadata(PATH_METADATA, ctx.getHandler()) as string | undefined
    const verbo = Reflect.getMetadata(METHOD_METADATA, ctx.getHandler()) as number | undefined
    const chave = `${verbo === undefined ? '?' : (RequestMethod[verbo] ?? '?')} ${juntar(prefixo, caminho)}`
    if (LIBERADAS.has(chave)) return true

    const req = ctx
      .switchToHttp()
      .getRequest<RequisicaoComPainel & { cookies?: Record<string, string> }>()
    const token = req.cookies?.[NOME_DO_COOKIE_PAINEL]
    // A MESMA resposta para "sem cookie", "cookie inválido", "sessão
    // expirada" e "operador desativado". Quatro frases diferentes seriam
    // quatro informações de graça.
    if (!token) throw new NotFoundException()

    const contexto = await this.painel.contextoDoToken(token)
    if (!contexto) throw new NotFoundException()

    req.painel = contexto
    return true
  }
}
