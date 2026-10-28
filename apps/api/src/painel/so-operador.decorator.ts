import { SetMetadata } from '@nestjs/common'

/**
 * Chave de metadado que marca uma rota como **do painel do superadmin**.
 *
 * Prefixada com o produto para nunca colidir com metadado do Nest ou de
 * biblioteca de terceiro no mesmo handler — mesma razão de `fir:publico`.
 */
export const SO_OPERADOR = 'fir:so-operador'

/**
 * A rota pertence ao painel: ela **não** usa a sessão do produto e exige a
 * sessão de operador (`__Host-fir-painel`).
 *
 * Marca o controlador inteiro, nunca um handler solto. O painel é um
 * controlador do começo ao fim, e meio controlador marcado é exatamente a
 * confusão que o `PainelGuard` existe para tornar impossível.
 *
 * **Três estados, e toda rota é exatamente um deles:**
 *
 *   `@Publico()`   — sem sessão nenhuma (só `entrar` e `sair` do produto)
 *   nada           — sessão de CLÍNICA, `req.contexto` populado
 *   `@SoOperador()` — sessão de PAINEL, `req.painel` populado
 *
 * Os dois erros que a varredura de `teste/rotas-protegidas.test.ts` pega:
 * uma rota de painel SEM esta marca cairia no `SessaoGuard` do produto,
 * exigiria cookie de clínica e falharia de um jeito confuso; uma rota de
 * produto que ganhasse a marca por copiar-e-colar sairia do controle de
 * permissão da clínica inteiro.
 */
export const SoOperador = (): ClassDecorator & MethodDecorator =>
  SetMetadata(SO_OPERADOR, true)
