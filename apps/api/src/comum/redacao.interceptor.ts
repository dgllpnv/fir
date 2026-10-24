import { CAMPOS_MONETARIOS, type ChaveDePermissao } from '@fir/domain'
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common'
import type { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import type { RequisicaoComContexto } from './contexto.js'

/**
 * O TRADUTOR ÚNICO.
 *
 * Sem a permissão `valores`, todo campo monetário sai da resposta como `null`.
 * Isto atravessa **toda** saída da API, e é deliberado que não exista um `if`
 * por controlador: o endpoint número quarenta não será revisado com o cuidado
 * do primeiro, e o esquecido vaza o salário de uma funcionária.
 *
 * `salario` é o único que depende de `pessoas.gerir` em vez de `valores` —
 * dado de RH não se libera junto com receita.
 */
const CAMPOS = new Set<string>(CAMPOS_MONETARIOS)
const CHAVE_DO_CAMPO: Readonly<Record<string, ChaveDePermissao>> = { salario: 'pessoas.gerir' }

export function redigir(dado: unknown, pode: (chave: ChaveDePermissao) => boolean): unknown {
  if (dado === null || typeof dado !== 'object') return dado
  if (dado instanceof Date) return dado
  if (Array.isArray(dado)) return dado.map((x) => redigir(x, pode))

  const saida: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(dado as Record<string, unknown>)) {
    if (CAMPOS.has(chave)) {
      // Vira null, não some: a forma da resposta não muda com a permissão, e o
      // cliente distingue "sem acesso" de "sem valor" sem um `if` extra.
      saida[chave] = pode(CHAVE_DO_CAMPO[chave] ?? 'valores') ? valor : null
      continue
    }
    saida[chave] = redigir(valor, pode)
  }
  return saida
}

@Injectable()
export class RedacaoInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<RequisicaoComContexto>()
    const contexto = req.contexto
    // Sem contexto é rota pública (entrar, saúde): não há nada a redigir, e
    // também não há como decidir — então não se inventa permissão.
    if (!contexto) return next.handle()
    return next.handle().pipe(map((dado) => redigir(dado, contexto.pode)))
  }
}
