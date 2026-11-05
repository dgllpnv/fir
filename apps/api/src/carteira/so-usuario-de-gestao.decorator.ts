import { SetMetadata } from '@nestjs/common'

/** Mesma razão de `SO_OPERADOR`: prefixado com o produto, nunca colide. */
export const SO_USUARIO_DE_GESTAO = 'fir:so-usuario-de-gestao'

/**
 * A rota pertence à carteira: exige a sessão de `Usuário de Gestão`
 * (`__Host-fir-carteira`), nunca a sessão de clínica nem a de operador.
 *
 * Marca o controlador inteiro — mesma razão de `@SoOperador()`.
 */
export const SoUsuarioDeGestao = (): ClassDecorator & MethodDecorator =>
  SetMetadata(SO_USUARIO_DE_GESTAO, true)
