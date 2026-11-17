import type { Provider } from '@nestjs/common'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import { inteiroDoAmbiente } from '../comum/ambiente'

/**
 * Os limites do acesso por e-mail, TODOS em memória do processo e com janela de
 * uma hora (spec 10.9, appsec 12). A janela deslizante é a de
 * `LimitePorOrigem`, que conta por qualquer chave — a origem é só o uso
 * original dela.
 *
 * Em memória, e não numa tabela: o limite por e-mail conta também o e-mail SEM
 * conta, que é de um terceiro e não pode ser guardado (LGPD L7), e o envio já
 * vive em memória (o token cru nunca sai do processo). Duas réplicas dobrariam
 * o teto, como o limite do entrar — atrito, não muralha.
 *
 * `consultar` e `usar` NÃO estão aqui: contam no limite por origem do ENTRAR,
 * a mesma instância, como o spec manda (3.6).
 */
const HORA = 60 * 60 * 1000

/** Esqueci-senha, por `req.ip`. Estourado: 429, igual para todo mundo. */
export const LIMITE_ESQUECI_POR_ORIGEM = Symbol('fir.limite.esqueci-por-origem')
/** Esqueci-senha, por `clínica + hmac(e-mail)`, exista a conta ou não. Estourado: 202 sem envio. */
export const LIMITE_ESQUECI_POR_EMAIL = Symbol('fir.limite.esqueci-por-email')
/** Reenviar convite, enviar redefinição e `/eu/email`: por pessoa-alvo. Estourado: 429. */
export const LIMITE_ENVIOS_POR_PESSOA = Symbol('fir.limite.envios-por-pessoa')

export const provedoresDeLimiteDoAcesso: Provider[] = [
  {
    provide: LIMITE_ESQUECI_POR_ORIGEM,
    useFactory: () =>
      new LimitePorOrigem(inteiroDoAmbiente('MAX_ESQUECI_POR_ORIGEM', 5, { min: 1 }), HORA),
  },
  {
    provide: LIMITE_ESQUECI_POR_EMAIL,
    useFactory: () => new LimitePorOrigem(5, HORA),
  },
  {
    provide: LIMITE_ENVIOS_POR_PESSOA,
    useFactory: () => new LimitePorOrigem(5, HORA),
  },
]
