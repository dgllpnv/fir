import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { PEPPER_DE_DESENVOLVIMENTO, exigido } from '../integracoes/cofre-de-integracoes'

/**
 * O HMAC do e-mail canônico (spec 10, LGPD L4 e L7).
 *
 * Três lugares guardam um e-mail SEM guardá-lo:
 *  - `links_de_acesso.email_hmac`, que prende o link ao endereço para onde ele
 *    foi (appsec 3);
 *  - `tentativas_login.identificador` do entrar por um e-mail sem conta
 *    (`e:<hmac>`, appsec 9), que é de um terceiro;
 *  - a chave do limite por e-mail do esqueci-senha, em memória.
 *
 * A chave deriva por HKDF de `FIR_INTEGRACOES_PEPPER`, com rótulo PRÓPRIO: não
 * há segredo novo para implantar, e o HMAC daqui não é comparável com a
 * impressão das chaves de integração (outro rótulo, outra chave). Fora de
 * produção vale o pepper de desenvolvimento; em produção a variável é exigida,
 * com a mesma semântica do cofre.
 *
 * **Trocar o pepper invalida os links vivos** (o HMAC muda) e zera o histórico
 * de tentativas por e-mail sem conta. Nenhum dos dois é dado a preservar.
 */
export const ROTULO_DA_CHAVE_DE_EMAIL = 'acesso-por-email:v1'

export class ChaveDeEmail {
  private readonly chave: Buffer

  constructor(pepper: string) {
    this.chave = Buffer.from(hkdfSync('sha256', pepper, 'fir:acesso', ROTULO_DA_CHAVE_DE_EMAIL, 32))
  }

  static doAmbiente(ambiente: NodeJS.ProcessEnv = process.env): ChaveDeEmail {
    return new ChaveDeEmail(exigido(ambiente, 'FIR_INTEGRACOES_PEPPER', PEPPER_DE_DESENVOLVIMENTO))
  }

  /** 64 hex. Recebe o e-mail JÁ canônico: quem canoniza é o contrato. */
  hmac(emailCanonico: string): string {
    return createHmac('sha256', this.chave).update(`email:${emailCanonico}`).digest('hex')
  }

  /** O link ainda aponta para este endereço? Comparação em tempo constante. */
  confere(emailCanonico: string | null, hmacGravado: string): boolean {
    if (emailCanonico === null) return false
    const a = Buffer.from(this.hmac(emailCanonico), 'hex')
    const b = Buffer.from(hmacGravado, 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  }
}
