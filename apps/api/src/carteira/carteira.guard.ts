import {
  type CanActivate,
  ConflictException,
  type ExecutionContext,
  ForbiddenException,
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
import { responsavelImpostoPeloPerfil, temPermCarteira } from '@fir/domain'
import { telaDaRota } from './modulos-das-rotas'

/**
 * Onde uma rota de carteira nomeia um `Cliente Firmare`: o `:id` de
 * `clientes/:id/**`, o `:clienteId` de qualquer rota, e `clienteId` ou
 * `clienteCarteiraId` na query ou no corpo. É por aqui que "só a minha
 * carteira" (A-3) chega a TODA rota que recebe um cliente, num ponto só, sem
 * depender de cada serviço lembrar.
 */
function clientesNomeados(
  molde: string,
  req: { params?: unknown; query?: unknown; body?: unknown },
): string[] {
  const ids: string[] = []
  const de = (o: unknown, chave: string) => {
    if (o && typeof o === 'object') {
      const v = (o as Record<string, unknown>)[chave]
      if (typeof v === 'string' && v !== '') ids.push(v)
    }
  }
  if (/^\/v1\/carteira\/clientes\/:id(\/|$)/.test(molde)) de(req.params, 'id')
  de(req.params, 'clienteId')
  for (const fonte of [req.query, req.body]) {
    de(fonte, 'clienteId')
    de(fonte, 'clienteCarteiraId')
  }
  return [...new Set(ids)]
}

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
      .getRequest<
        RequisicaoComCarteira & { cookies?: Record<string, string>; params?: unknown; query?: unknown; body?: unknown }
      >()
    const token = req.cookies?.[NOME_DO_COOKIE_CARTEIRA]
    // Mesma resposta para "sem cookie", "inválido", "expirado" e
    // "desativado" — quatro frases diferentes seriam quatro informações de
    // graça.
    if (!token) throw new NotFoundException()

    const contexto = await this.carteira.contextoDoToken(token)
    if (!contexto) throw new NotFoundException()

    req.carteira = contexto
    const usuario = contexto.usuarioDeGestao

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

    // A TELA da rota (A-4): negação por padrão. Rota sem tela declarada em
    // `modulos-das-rotas.ts` é recusada; tela não concedida, também. O perfil
    // vem do banco, relido agora (`contextoDoToken`), nunca do cookie.
    const molde = juntar(prefixo, caminho)
    const verboTexto = verbo === undefined ? '?' : (RequestMethod[verbo] ?? '?')
    const tela = telaDaRota(verboTexto, molde)
    if (tela === null || (tela !== 'livre' && !temPermCarteira(usuario, tela))) {
      throw new ForbiddenException('Seu acesso não inclui esta tela.')
    }

    // "Só a minha carteira" (A-3): cliente alheio responde 404, a MESMA
    // resposta de um id que não existe — nada confirma que ele existe.
    if (responsavelImpostoPeloPerfil(usuario) !== null) {
      for (const id of clientesNomeados(molde, req)) {
        if (!(await this.carteira.clienteEstaNaMinhaCarteira(usuario, id))) throw new NotFoundException()
      }
    }
    return true
  }
}
