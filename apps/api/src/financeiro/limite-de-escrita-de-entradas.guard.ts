import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import { pessoaDoAtor } from '../banco/ator'
import { inteiroDoAmbiente } from '../comum/ambiente'
import type { RequisicaoComContexto } from '../comum/contexto'

/**
 * Freio nas escritas de OUTRAS ENTRADAS e das CATEGORIAS de entrada, por
 * `clinicaId:pessoaId` (emenda E5 do spec) — irmão de
 * `LimiteDeEscritaDoFluxoGuard`, com cota PRÓPRIA: lançar dinheiro não deve
 * consumir a cota de quem está movendo tarefas, e vice-versa.
 *
 * Atrito, não segurança: um laço de cliente com defeito (ou um script)
 * lançaria entrada após entrada. 60 por minuto é uma ordem de grandeza acima
 * do balcão real.
 *
 * **Por PROCESSO, em memória** (o mesmo `LimitePorOrigem` do login): com duas
 * réplicas o limite efetivo dobra, e reiniciar zera a conta.
 */
export const MAX_ESCRITAS_DE_ENTRADAS_POR_MINUTO = inteiroDoAmbiente(
  'MAX_ESCRITAS_DE_ENTRADAS_POR_MINUTO',
  60,
  { min: 1 },
)

let limite = new LimitePorOrigem(MAX_ESCRITAS_DE_ENTRADAS_POR_MINUTO, 60_000)

/** Para os testes: zera a conta sem esperar a janela. */
export function reiniciarLimiteDeEscritaDeEntradas(): void {
  limite = new LimitePorOrigem(MAX_ESCRITAS_DE_ENTRADAS_POR_MINUTO, 60_000)
}

@Injectable()
export class LimiteDeEscritaDeEntradasGuard implements CanActivate {
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
        message: 'Muitos lançamentos em pouco tempo. Aguarde um instante e tente de novo.',
        retryAfter: limite.esperaEmSegundos(chave),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    )
  }
}
