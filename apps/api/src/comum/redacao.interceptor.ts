import { CAMPOS_MONETARIOS, type ChaveDePermissao } from '@fir/domain'
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common'
import type { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import type { RequisicaoComContexto } from './contexto'

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

/**
 * Só objeto simples (literal ou sem protótipo) é estrutura de dado a
 * percorrer. Medido: `Object.entries` de um `Map` ou `Set` devolve `[]`, então
 * uma recursão ingênua devolvia `{}` e o dado sumia em silêncio; um `Buffer`
 * tem índices numéricos próprios e virava um objeto indexado
 * (`{"0":111,"1":105}`). `Date` já caía antes deste ponto, mas a checagem de
 * protótipo também a cobriria — a entrada explícita de `Date` fica como
 * documentação do caso mais comum.
 */
const ehObjetoSimples = (x: object): boolean => {
  const proto = Object.getPrototypeOf(x) as object | null
  return proto === Object.prototype || proto === null
}

export function redigir(dado: unknown, pode: (chave: ChaveDePermissao) => boolean): unknown {
  if (dado === null || typeof dado !== 'object') return dado
  if (dado instanceof Date) return dado
  if (Array.isArray(dado)) return dado.map((x) => redigir(x, pode))
  if (!ehObjetoSimples(dado)) return dado

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
    // Sem contexto, não há como decidir — e numa ferramenta que guarda o
    // caixa e o salário de uma clínica, a resposta certa para "não sei" é
    // esconder, não mostrar. Falha fechada: nenhuma rota pública hoje (ou no
    // desenho do Plano 1) devolve campo monetário, então isto redige campos
    // que de qualquer forma seriam `undefined` — e se um dia uma rota
    // pública precisar de um valor, o `null` aparece em minutos de depuração;
    // um vazamento silencioso por falta de guard, ninguém acha.
    const pode = req.contexto?.pode ?? (() => false)
    return next.handle().pipe(map((dado) => redigir(dado, pode)))
  }
}
