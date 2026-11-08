import { CAMPOS_MONETARIOS, type ChaveDePermissao, temPermCarteira } from '@fir/domain'
import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor, Optional } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import type { RequisicaoComCarteira } from '../carteira/contexto-da-carteira'
import type { RequisicaoComPortal } from '../carteira/portal/contexto-do-portal'
import { SO_USUARIO_DO_PORTAL } from '../carteira/portal/so-usuario-do-portal.decorator'
import { SO_USUARIO_DE_GESTAO } from '../carteira/so-usuario-de-gestao.decorator'
import { SO_OPERADOR } from '../painel/so-operador.decorator'
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

/**
 * `valor_aberto` é `valorAberto`.
 *
 * `CAMPOS_MONETARIOS` está em camelCase porque é assim que a API fala. Uma
 * saída fala outra língua: `GET /v1/auditoria` devolve `de`/`para`, que são
 * `to_jsonb(NEW)` de uma linha do Postgres — NOME DE COLUNA, em snake_case.
 * Sem esta normalização, `valor_aberto`, `valor_orcamento`, `valor_pago`,
 * `valor_total` e `valor_entrada` atravessariam a redação inteiros, numa rota
 * que entrega o diff de toda escrita da clínica. `salario`, `valor` e `custo`
 * escapavam por sorte — eles se escrevem igual nas duas convenções.
 *
 * Isto é REMENDO, não o conserto: a redação continua decidindo por NOME de
 * campo, e a dívida D5 descreve o desenho certo (marcar o campo como
 * monetário no contrato e redigir por tipo). O remendo entra porque a rota da
 * trilha existe agora e a D5 não tem data.
 */
const emCamelCase = (chave: string): string =>
  chave.includes('_') ? chave.replace(/_([a-z])/g, (_, letra: string) => letra.toUpperCase()) : chave

export function redigir(dado: unknown, pode: (chave: ChaveDePermissao) => boolean): unknown {
  if (dado === null || typeof dado !== 'object') return dado
  if (dado instanceof Date) return dado
  if (Array.isArray(dado)) return dado.map((x) => redigir(x, pode))
  if (!ehObjetoSimples(dado)) return dado

  const saida: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(dado as Record<string, unknown>)) {
    const normalizada = emCamelCase(chave)
    if (CAMPOS.has(normalizada)) {
      // Vira null, não some: a forma da resposta não muda com a permissão, e o
      // cliente distingue "sem acesso" de "sem valor" sem um `if` extra.
      saida[chave] = pode(CHAVE_DO_CAMPO[normalizada] ?? 'valores') ? valor : null
      continue
    }
    saida[chave] = redigir(valor, pode)
  }
  return saida
}

/** O espaço de identidade da rota, lido da METADATA dela (appsec A-2). */
export type EspacoDaRota = 'carteira' | 'portal' | 'operador' | 'clinica'

type Requisicao = RequisicaoComContexto & RequisicaoComPortal & RequisicaoComCarteira

/**
 * Quem decide o que a resposta mostra, escolhido pelo ESPAÇO DA ROTA e nunca
 * pela propriedade que por acaso existe na requisição (gate G8, achado F-2,
 * ajuste A-2). A cadeia antiga de `??` sobre `req.contexto`/`req.portal`
 * tinha precedência implícita: um guard que populasse duas propriedades, ou
 * uma prévia do portal servida por rota de carteira, faria a regra
 * "o portal sempre vê" vazar dinheiro para quem não tem `valores`.
 *
 * Em cada espaço, a ausência da identidade daquele espaço é falha FECHADA:
 *  - **carteira** (`@SoUsuarioDeGestao`): `temPermCarteira(perfil, 'valores')`,
 *    o perfil relido do banco a cada requisição pelo `CarteiraGuard`. Um cookie
 *    de clínica com `valores` na mesma requisição não conta: a rota é de
 *    carteira. `salario` (`pessoas.gerir`) não existe na carteira: nega.
 *  - **portal** (`@SoUsuarioDoPortal`): o titular vê o próprio dinheiro
 *    (ADR 0017 §3, ADR 0018), só se `PortalGuard` provou a sessão — e só a
 *    conta com `ve_valores` (LGPD A52: a segunda conta não é o titular).
 *  - **operador** (`@SoOperador`): o painel trata identidade e tenancy, nunca
 *    negócio — nenhum dinheiro atravessa (`superadmin/identidade.test.ts`).
 *  - **clínica**: a permissão da `Pessoa` (`req.contexto.pode`).
 */
export function decisorDaRota(espaco: EspacoDaRota, req: Requisicao): (chave: ChaveDePermissao) => boolean {
  switch (espaco) {
    case 'carteira': {
      const perfil = req.carteira?.usuarioDeGestao
      if (!perfil) return () => false
      return (chave) => chave === 'valores' && temPermCarteira(perfil, 'valores')
    }
    case 'portal': {
      // LGPD A52 (G8 3D): com várias contas por cliente, só a que tem
      // `ve_valores` (o titular) vê o próprio dinheiro.
      const usuario = req.portal?.usuarioDoPortal
      if (!usuario) return () => false
      return (chave) => chave === 'valores' && usuario.veValores
    }
    case 'operador':
      return () => false
    case 'clinica':
      return req.contexto?.pode ?? (() => false)
  }
}

@Injectable()
export class RedacaoInterceptor implements NestInterceptor {
  private readonly reflector: Reflector

  constructor(@Optional() @Inject(Reflector) reflector?: Reflector) {
    this.reflector = reflector ?? new Reflector()
  }

  /** A carteira vence: é o espaço mais restrito e o único com perfil próprio. */
  espacoDaRota(ctx: ExecutionContext): EspacoDaRota {
    const alvos = [ctx.getHandler?.(), ctx.getClass?.()].filter((x): x is NonNullable<typeof x> => x !== undefined)
    if (alvos.length === 0) return 'clinica'
    const marcada = (chave: string) => this.reflector.getAllAndOverride<boolean | undefined>(chave, alvos) === true
    if (marcada(SO_USUARIO_DE_GESTAO)) return 'carteira'
    if (marcada(SO_USUARIO_DO_PORTAL)) return 'portal'
    if (marcada(SO_OPERADOR)) return 'operador'
    return 'clinica'
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Requisicao>()
    // Sem contexto, não há como decidir — e numa ferramenta que guarda o
    // caixa e o salário de uma clínica, a resposta certa para "não sei" é
    // esconder, não mostrar. Falha fechada: nenhuma rota pública hoje
    // devolve campo monetário, então isto redige campos que de qualquer forma
    // seriam `undefined`.
    const pode = decisorDaRota(this.espacoDaRota(ctx), req)
    return next.handle().pipe(map((dado) => redigir(dado, pode)))
  }
}
