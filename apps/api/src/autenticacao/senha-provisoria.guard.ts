import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  RequestMethod,
} from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import type { RequisicaoComContexto } from '../comum/contexto'

/**
 * As ÚNICAS rotas que uma sessão com senha provisória atravessa.
 *
 * Três, e cada uma por uma razão de "senão a pessoa fica presa":
 * `GET /v1/eu` é como a tela descobre para onde mandá-la; `POST /v1/eu/senha`
 * é a saída; `POST /v1/sair` é a saída de quem desistiu. Nenhuma delas
 * entrega dado de paciente, de dinheiro ou de equipe.
 *
 * Uma lista de três, central e curta, e não um decorador por rota: acrescentar
 * uma linha aqui é visível na revisão, e esquecer um decorador não é.
 */
const LIBERADAS: ReadonlySet<string> = new Set([
  'GET /v1/eu',
  'POST /v1/eu/senha',
  'POST /v1/sair',
])

/** O código no corpo, para a tela redirecionar sem casar texto de mensagem. */
export const CODIGO_SENHA_PROVISORIA = 'SENHA_PROVISORIA'

const juntar = (...partes: (string | undefined)[]): string => {
  const limpo = partes
    .filter((p): p is string => typeof p === 'string')
    .flatMap((p) => p.split('/'))
    .filter((p) => p !== '')
  return `/${limpo.join('/')}`
}

/**
 * Segundo `APP_GUARD`, entre `SessaoGuard` (que popula `req.contexto`) e
 * `AutorizacaoGuard`.
 *
 * GLOBAL pela mesma razão dos outros dois: com guarda por rota, a rota que o
 * programador esquecer é a que a senha provisória atravessa — e a provisória
 * foi digitada por OUTRA pessoa, ditada no balcão e anotada num papel. Ela é
 * uma credencial compartilhada por construção, e a única coisa que ela pode
 * fazer é deixar de ser.
 *
 * **ANTES de `AutorizacaoGuard`, e não depois como o plano previa.** Depois,
 * uma rota que a pessoa não tem permissão de usar responderia 403 em vez de
 * 409, e a tela — que redireciona pelo `codigo` — não redirecionaria.
 * "Termine isto primeiro" é precondição da sessão, não resposta à pergunta
 * "você pode?". Invertido, o 409 passaria a depender do perfil de quem está
 * preso, que é exatamente o tipo de condição que ninguém revisa.
 *
 * 409 e não 403: 403 é "você não pode"; isto é "termine isto primeiro".
 *
 * A fonte do estado é `req.contexto.usuario.senhaProvisoria`, que o
 * `SessaoGuard` leu do BANCO a cada requisição — nunca o corpo, nunca um
 * cabeçalho, nunca o cookie.
 */
@Injectable()
export class SenhaProvisoriaGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RequisicaoComContexto>()
    const contexto = req.contexto
    // Sem contexto é rota pública: não há sessão, logo não há provisória a
    // cobrar. Quem recusa o anônimo é o `SessaoGuard`, que já rodou.
    if (!contexto) return true
    if (!contexto.usuario.senhaProvisoria) return true

    const prefixo = Reflect.getMetadata(PATH_METADATA, ctx.getClass()) as string | undefined
    const caminho = Reflect.getMetadata(PATH_METADATA, ctx.getHandler()) as string | undefined
    const verbo = Reflect.getMetadata(METHOD_METADATA, ctx.getHandler()) as number | undefined
    const chave = `${verbo === undefined ? '?' : (RequestMethod[verbo] ?? '?')} ${juntar(prefixo, caminho)}`
    if (LIBERADAS.has(chave)) return true

    throw new HttpException(
      {
        statusCode: HttpStatus.CONFLICT,
        codigo: CODIGO_SENHA_PROVISORIA,
        message: 'Troque a senha provisória antes de continuar.',
      },
      HttpStatus.CONFLICT,
    )
  }
}
