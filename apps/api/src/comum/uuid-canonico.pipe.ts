import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common'

/** UUID em qualquer caixa — a mesma forma que o `ParseUUIDPipe` aceita. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const canonico = (v: unknown): unknown =>
  typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : v

/**
 * **O id da rota chega na forma canônica do banco** (revisão appsec B1).
 *
 * O Postgres compara `uuid` sem caixa, e o `ParseUUIDPipe` aceita maiúsculas:
 * `PATCH /v1/pessoas/<ID EM MAIÚSCULAS>` alcançava o MESMO registro, mas
 * qualquer comparação em TypeScript com o id da sessão (que sai do banco em
 * minúsculas) dava "outra pessoa". Foi assim que a recusa de trocar o próprio
 * e-mail pelo PATCH se contornava, até a tomada de conta.
 *
 * Global (`APP_PIPE`), e não um pipe por rota: a rota número quarenta não
 * será lembrada. Roda ANTES dos pipes da rota, então o `ParseUUIDPipe` segue
 * validando, agora sobre a forma minúscula. Só toca `param` e `query`, e só
 * valores com forma de UUID: um código de clínica ou um texto livre passam
 * intactos. Corpo não: nele os ids vão para o banco, que decide, e as
 * decisões "é a própria pessoa" moram sobre o id LIDO do banco.
 */
@Injectable()
export class UuidCanonicoPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'param' && metadata.type !== 'query') return value
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // `@Param()` / `@Query()` sem nome: o objeto inteiro.
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, canonico(v)]))
    }
    return canonico(value)
  }
}
