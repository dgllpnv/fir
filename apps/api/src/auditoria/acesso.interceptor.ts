import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
  type NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Observable } from 'rxjs'
import { concatMap } from 'rxjs/operators'
import type { RequisicaoComContexto } from '../comum/contexto'
import { DADO_SENSIVEL, ID_DE_LISTA, type MarcaDeAcesso } from './acesso.decorator'
import { AuditoriaService } from './auditoria.service'

/**
 * O registro de ACESSO a dado pessoal sensível — regra 18.
 *
 * Global, como a redação, mas ATIVO SÓ EM ROTA MARCADA com `@DadoSensivel`.
 * A diferença em relação ao guard de sessão (onde esquecer significa
 * protegido) é consciente e está explicada no decorador: aqui esquecer
 * significa não registrar, e o preço de automatizar seria uma trilha cheia de
 * recarga da tela Hoje.
 *
 * ORDEM. Isto roda DEPOIS do `SessaoGuard` — sem sessão não há ator, e um
 * acesso registrado como "sistema" não responde "quem olhou". Guard roda
 * antes de todo interceptor no Nest, então a ordem não depende de
 * configuração.
 *
 * Em relação ao `RedacaoInterceptor`, este fica por DENTRO: no Nest, o
 * interceptor registrado primeiro envolve os seguintes, logo a transformação
 * de resposta do que foi registrado DEPOIS roda ANTES. Assim este observa o
 * que o handler produziu, não o que sobrou da redação. Hoje a diferença é
 * invisível — a linha de trilha não copia o corpo (ver `registrarAcesso`) —
 * e dizer isso aqui é mais honesto que fingir que a ordem está provada por
 * teste. Ela importa no dia em que alguém quiser registrar QUAIS campos
 * foram entregues.
 *
 * FALHA FECHADO. A gravação é esperada antes de a resposta sair, e um erro
 * nela derruba a requisição em vez de ser engolido. Entregar dado sensível
 * sem registrar o acesso é precisamente a falha silenciosa que a regra 18
 * existe para impedir: a clínica continuaria achando que a pergunta "quem
 * olhou" tem resposta. Preferimos uma recepcionista vendo erro a uma trilha
 * com buraco que ninguém sabe que tem.
 */
@Injectable()
export class AcessoInterceptor implements NestInterceptor {
  // `@Inject` explícito: ver o comentário em autenticacao.service.ts.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    // `getAllAndOverride` para que a marca no handler vença a da classe —
    // um controlador inteiro de fichas de paciente pode marcar uma vez.
    const marca = this.reflector.getAllAndOverride<MarcaDeAcesso | undefined>(DADO_SENSIVEL, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (marca === undefined) return next.handle()

    const req = ctx
      .switchToHttp()
      .getRequest<RequisicaoComContexto & { params?: Record<string, string> }>()
    const contexto = req.contexto
    // Rota marcada e sem contexto só acontece em rota que também é
    // `@Publico()` — configuração contraditória, e a resposta certa é não
    // entregar o dado. Mesma escolha do `AutorizacaoGuard`.
    if (!contexto) {
      throw new InternalServerErrorException('Acesso a dado sensível sem sessão.')
    }

    const entidadeId = 'lista' in marca.de ? ID_DE_LISTA : req.params?.[marca.de.param]
    // Parâmetro declarado que não existe no caminho é erro de programação, e
    // `teste/acesso-sensivel.test.ts` o pega em tempo de teste. Se chegar
    // aqui, falha fechado: sem id não há a que amarrar o acesso, e uma linha
    // de trilha com id inventado é pior que nenhuma.
    if (entidadeId === undefined || entidadeId === '') {
      throw new InternalServerErrorException('Acesso a dado sensível sem registro identificável.')
    }

    return next.handle().pipe(
      // `concatMap` e não `tap`: a gravação é ESPERADA, e um erro nela
      // propaga. Com `tap` e uma promessa solta, a falha viraria um
      // `unhandledRejection` e a resposta sairia como se tudo tivesse sido
      // registrado.
      concatMap(async (dado) => {
        // Só aqui — depois de o handler ter produzido resposta. Erro do
        // handler (404, 403, 422) nunca chega a este operador, e é por isso
        // que resposta de erro não grava acesso: ninguém viu nada.
        await this.auditoria.registrarAcesso(
          contexto.clinicaId,
          contexto.ator,
          marca.entidade,
          entidadeId,
        )
        return dado
      }),
    )
  }
}
