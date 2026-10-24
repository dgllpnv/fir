import { SetMetadata } from '@nestjs/common'

/**
 * Chave de metadado que marca uma rota como **dispensada de sessão**.
 *
 * String literal com prefixo do produto para nunca colidir com metadado do
 * Nest ou de biblioteca de terceiro no mesmo handler.
 */
export const PUBLICO = 'fir:publico'

/**
 * Dispensa a rota do `SessaoGuard` global.
 *
 * A inversão é o ponto inteiro desta correção: antes, autenticação era
 * opt-in (`@UseGuards(SessaoGuard)` rota a rota) e **esquecer o decorador
 * abria a rota para a internet** — um controlador novo copiado de
 * `saude.controller.ts` subiria sem autenticação, devolvendo nome de
 * paciente, procedimento e dose a qualquer um. O interceptor de redação
 * falha fechado e apagaria só o dinheiro, então o sintoma seria "sumiu o
 * valor", nunca "vazou o paciente".
 *
 * Agora é opt-out: esquecer o decorador significa **rota protegida**. Marcar
 * uma rota com `@Publico()` é um ato deliberado, e
 * `teste/rotas-protegidas.test.ts` exige que cada uma esteja no registro de
 * rotas públicas — acrescentar a segunda sem pensar derruba a suíte.
 */
export const Publico = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLICO, true)
