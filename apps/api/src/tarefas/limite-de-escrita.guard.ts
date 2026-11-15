import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { pessoaDoAtor } from '../banco/ator'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import type { RequisicaoComContexto } from '../comum/contexto'
import { inteiroDoAmbiente } from '../comum/ambiente'

/**
 * Freio nas escritas do FLUXO e dos GRUPOS (assumir, transferir, criar/editar
 * grupo, vínculo da pessoa), por `clinicaId:pessoaId` (emenda E5 do spec).
 *
 * Não é segurança, é atrito: cada uma dessas escritas acrescenta evento a um
 * histórico com teto, ou mexe em quem enxerga o quê, e um laço de cliente com
 * defeito (ou um script) as repetiria sem parar. 60 por minuto é uma ordem de
 * grandeza acima do uso real da recepção.
 *
 * **É por PROCESSO, em memória** (o mesmo `LimitePorOrigem` do login): com duas
 * réplicas da API o limite efetivo dobra, e reiniciar o processo zera a conta.
 * Aceitável para um controle de atrito; quem escalar a API precisa saber.
 * Um único contador para todas as rotas protegidas: a pessoa tem uma cota, não
 * uma cota por rota.
 */
export const MAX_ESCRITAS_DE_FLUXO_POR_MINUTO = inteiroDoAmbiente(
  'MAX_ESCRITAS_DE_FLUXO_POR_MINUTO',
  60,
  { min: 1 },
)

let limite = new LimitePorOrigem(MAX_ESCRITAS_DE_FLUXO_POR_MINUTO, 60_000)

/** Para os testes: zera a conta sem esperar a janela. */
export function reiniciarLimiteDeEscritaDoFluxo(): void {
  limite = new LimitePorOrigem(MAX_ESCRITAS_DE_FLUXO_POR_MINUTO, 60_000)
}

@Injectable()
export class LimiteDeEscritaDoFluxoGuard implements CanActivate {
  canActivate(contexto: ExecutionContext): boolean {
    const c = contexto.switchToHttp().getRequest<RequisicaoComContexto>().contexto
    // Sem contexto não há quem limitar; a autenticação (guard global) já recusou.
    if (c === undefined) return true
    const quem = pessoaDoAtor(c.ator) ?? 'suporte'
    const chave = `${c.clinicaId}:${quem}`
    if (limite.registrar(chave)) return true
    throw new HttpException(
      {
        statusCode: 429,
        message: 'Muitas alterações em pouco tempo. Aguarde um instante e tente de novo.',
        retryAfter: limite.esperaEmSegundos(chave),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    )
  }
}
