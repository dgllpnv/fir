import type { ChaveDePermissao } from '@fir/domain'
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { RequisicaoComContexto } from '../comum/contexto'

/** Chave de metadado da permissão exigida. Prefixada para não colidir. */
export const EXIGE = 'fir:exige'

/**
 * Exige uma permissão do `CLAUDE.md` regra 16 para a rota.
 *
 * O parâmetro é `ChaveDePermissao` — a união literal derivada de `PERMS` em
 * `@fir/domain` — e **não** `string`: um erro de digitação (`'estoque.gerr'`)
 * quebra o `pnpm typecheck`, em vez de virar uma rota que nunca libera
 * ninguém (ou, pior, uma chave que ninguém revisou). A dependência entre
 * chaves (`finmes` → `valores`, `painel` → `valores`) já é resolvida por
 * `temPerm`, que é a mesma função do servidor e da tela.
 *
 * Nenhuma rota do Plano 1 precisa de `@Exige` — ela existe para os Planos 2 a
 * 8, e vem com teste próprio (`autorizacao.guard.test.ts`) justamente para
 * que a primeira rota que a use não seja a primeira vez que ela roda.
 */
export const Exige = (chave: ChaveDePermissao): MethodDecorator & ClassDecorator =>
  SetMetadata(EXIGE, chave)

/**
 * Guard global de **autorização**. Autenticação é do `SessaoGuard`, que roda
 * antes e popula `req.contexto`.
 *
 * Sem `@Exige`, libera: a rota já passou pela autenticação, e exigir uma
 * permissão nominal de toda rota faria `GET /v1/eu` precisar de uma chave que
 * não existe na matriz. A separação é deliberada — "quem é você" e "o que
 * você pode" são duas perguntas, e só a primeira tem resposta obrigatória.
 */
@Injectable()
export class AutorizacaoGuard implements CanActivate {
  // `@Inject` explícito: ver o comentário em autenticacao.service.ts — o
  // esbuild não emite `design:paramtypes`, e sem o token o Nest injetaria
  // `undefined` aqui.
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    // `getAllAndOverride`: o `@Exige` do handler vence o da classe, para que
    // um controlador inteiro possa exigir `estoque` e uma rota de dentro
    // exigir `estoque.gerir`.
    const chave = this.reflector.getAllAndOverride<ChaveDePermissao | undefined>(EXIGE, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (chave === undefined) return true

    const req = ctx.switchToHttp().getRequest<RequisicaoComContexto>()
    const contexto = req.contexto
    // Sem contexto com `@Exige` presente só acontece em rota marcada
    // `@Publico()` que também exige permissão — configuração contraditória.
    // Recusa, nunca libera: a resposta certa para "não sei quem é você" numa
    // ferramenta que guarda caixa e dose é esconder.
    if (!contexto) throw new ForbiddenException('Sem acesso a esta ação.')

    // Uma frase só, sem dizer qual permissão falta: a lista de chaves de quem
    // não as tem é um mapa do que existe atrás da porta.
    if (!contexto.pode(chave)) throw new ForbiddenException('Sem acesso a esta ação.')
    return true
  }
}
