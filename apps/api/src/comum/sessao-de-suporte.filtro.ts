import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
} from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { SessaoDeSuporteNaoAssina } from '../banco/ator'

/** O código estável do corpo. A tela casa isto, nunca texto. */
export const CODIGO_SESSAO_DE_SUPORTE = 'SESSAO_DE_SUPORTE_NAO_ASSINA'

/**
 * A tradução de `SessaoDeSuporteNaoAssina` para **403**, num lugar só.
 *
 * ## Por que um filtro, e não um `ForbiddenException` lá dentro
 *
 * `exigePessoa` mora em `banco/ator.ts`, que não conhece HTTP — e não deve: a
 * mesma função é chamada de dezoito serviços, e nenhum deles é uma borda.
 * Erros são valores no domínio e exceções na borda (CLAUDE.md §6); este
 * filtro **é** a borda.
 *
 * `@Catch` com o tipo exato: ele não toca em nenhuma outra exceção, então o
 * tratamento de erro de todo o resto da API continua sendo o do Nest. Um
 * filtro genérico aqui engoliria 404 e 409 e os transformaria em 500 no
 * primeiro refactor.
 *
 * ## Por que 403 e não 404
 *
 * Quem está pedindo é o operador, autenticado, e ele **sabe** que a rota
 * existe — ele acabou de abrir o sistema da clínica. Esconder não esconderia
 * nada. 403 com uma frase que diz o que aconteecu é a resposta útil: *esta
 * ação é de uma pessoa da clínica*.
 */
@Catch(SessaoDeSuporteNaoAssina)
export class FiltroDeSessaoDeSuporte implements ExceptionFilter {
  catch(erro: SessaoDeSuporteNaoAssina, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<FastifyReply>()
    void res.status(HttpStatus.FORBIDDEN).send({
      statusCode: HttpStatus.FORBIDDEN,
      codigo: CODIGO_SESSAO_DE_SUPORTE,
      message: erro.message,
    })
  }
}
