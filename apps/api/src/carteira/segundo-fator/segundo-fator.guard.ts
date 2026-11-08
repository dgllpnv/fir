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
import { NOME_DO_COOKIE_CARTEIRA } from '../carteira.guard'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SO_USUARIO_DE_GESTAO } from '../so-usuario-de-gestao.decorator'
import { segundoFatorLigado } from './ligado'
import { SegundoFatorDaCarteiraService } from './segundo-fator.service'

/** O código no corpo do 409, para a tela desviar sem casar texto. */
export const CODIGO_SEGUNDO_FATOR_DA_CARTEIRA = 'SEGUNDO_FATOR_CARTEIRA'

/**
 * O que uma sessão SEM segundo fator alcança (A-12): o cadastro, `eu` e
 * `sair` — a mesma lista curta de `LIBERADAS_COM_PROVISORIA_NA_CARTEIRA`,
 * mais as duas rotas do cadastro. A troca de senha entra só enquanto a senha
 * é provisória: é a etapa ANTERIOR, e o `CarteiraGuard` já a impõe primeiro.
 */
export const LIBERADAS_SEM_SEGUNDO_FATOR: ReadonlySet<string> = new Set([
  'GET /v1/carteira/eu',
  'POST /v1/carteira/sair',
  'GET /v1/carteira/eu/segundo-fator',
  'POST /v1/carteira/eu/segundo-fator/cadastro',
  'POST /v1/carteira/eu/segundo-fator/confirmar',
])
const TROCA_DE_SENHA = 'POST /v1/carteira/eu/senha'

const juntar = (...partes: (string | undefined)[]): string =>
  `/${partes
    .filter((p): p is string => typeof p === 'string')
    .flatMap((p) => p.split('/'))
    .filter((p) => p !== '')
    .join('/')}`

/**
 * Registrado como `APP_GUARD` LOGO DEPOIS do `CarteiraGuard`: só age quando
 * ele já validou a sessão e anexou `req.carteira`. Rota liberada sem sessão
 * (`entrar`, `sair`) não tem `req.carteira` e passa direto — o DESAFIO do
 * login nunca é sessão, então nenhuma rota de carteira o aceita.
 *
 * Guard à parte, e não um estado a mais dentro do `CarteiraGuard`, só por
 * propriedade de arquivo no G8 (o `CarteiraGuard` é do ticket 0.5). A regra
 * é a mesma: o estado vem do BANCO a cada requisição.
 *
 * Só age com `SEGUNDO_FATOR_CARTEIRA_LIGADO` ligada (ADR 0023). Ligada, é o
 * guard da ADR 0022 sem relaxamento nenhum: a antiga
 * `SEGUNDO_FATOR_CARTEIRA_OPCIONAL_FORA_DE_PRODUCAO` saiu, porque os e2e dos
 * outros módulos rodam com a chave desligada, que é o padrão.
 */
@Injectable()
export class SegundoFatorDaCarteiraGuard implements CanActivate {
  constructor(
    @Inject(SegundoFatorDaCarteiraService) private readonly servico: SegundoFatorDaCarteiraService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // D-23 item 3 (ADR 0023): desligado, a senha basta — nenhuma rota pede o
    // segundo fator, nem a quem já o tem ativo.
    if (!segundoFatorLigado()) return true

    const soCarteira = this.reflector.getAllAndOverride<boolean | undefined>(SO_USUARIO_DE_GESTAO, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (soCarteira !== true) return true

    const req = ctx.switchToHttp().getRequest<RequisicaoComCarteira & { cookies?: Record<string, string> }>()
    if (!req.carteira) return true

    const token = req.cookies?.[NOME_DO_COOKIE_CARTEIRA]
    if (!token) throw new NotFoundException()
    const estado = await this.servico.estadoDaSessao(token)
    if (!estado) throw new NotFoundException()
    if (estado.ativo && estado.sessaoVerificada) return true

    const prefixo = Reflect.getMetadata(PATH_METADATA, ctx.getClass()) as string | undefined
    const caminho = Reflect.getMetadata(PATH_METADATA, ctx.getHandler()) as string | undefined
    const verbo = Reflect.getMetadata(METHOD_METADATA, ctx.getHandler()) as number | undefined
    const chave = `${verbo === undefined ? '?' : (RequestMethod[verbo] ?? '?')} ${juntar(prefixo, caminho)}`
    if (LIBERADAS_SEM_SEGUNDO_FATOR.has(chave)) return true
    if (chave === TROCA_DE_SENHA && req.carteira.usuarioDeGestao.senhaProvisoria) return true

    throw new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      codigo: CODIGO_SEGUNDO_FATOR_DA_CARTEIRA,
      message: 'Ative a verificação em duas etapas antes de continuar.',
    })
  }
}
