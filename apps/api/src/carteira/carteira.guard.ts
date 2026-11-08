import {
  type CanActivate,
  ConflictException,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common'
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

/**
 * E as únicas que uma sessão com **senha provisória** atravessa — a mesma
 * lista de três de `senha-provisoria.guard.ts` e de `PainelGuard`: `eu` é
 * como a tela descobre para onde mandar a pessoa, `eu/senha` é a saída, e
 * `sair` é a saída de quem desistiu.
 *
 * A provisória foi gerada pelo servidor e repassada por outra pessoa — é
 * credencial compartilhada por construção, numa sessão que lê dado agregado
 * de várias clínicas. A única coisa que ela pode fazer é deixar de ser.
 */
export const LIBERADAS_COM_PROVISORIA_NA_CARTEIRA: ReadonlySet<string> = new Set([
  'GET /v1/carteira/eu',
  'POST /v1/carteira/eu/senha',
  'POST /v1/carteira/sair',
])

/**
 * O código no corpo do 409, para a tela redirecionar sem casar texto. Um
 * código POR espaço de identidade, como o do painel: um só faria a tela da
 * carteira desviar para a troca de senha da clínica, que pede outra sessão.
 */
export const CODIGO_SENHA_PROVISORIA_DA_CARTEIRA = 'SENHA_PROVISORIA_CARTEIRA'

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

    // 409 e não 404: a sessão JÁ foi provada válida. "Termine isto primeiro"
    // é precondição da sessão, não resposta a "você pode?" — mesma resposta
    // da clínica e do painel. O estado vem do BANCO (`contextoDoToken`, a
    // cada requisição), nunca do corpo nem do cookie.
    if (
      contexto.usuarioDeGestao.senhaProvisoria &&
      !LIBERADAS_COM_PROVISORIA_NA_CARTEIRA.has(chave)
    ) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        codigo: CODIGO_SENHA_PROVISORIA_DA_CARTEIRA,
        message: 'Troque a senha provisória antes de continuar.',
      })
    }
    return true
  }
}
