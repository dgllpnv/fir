import { SetMetadata } from '@nestjs/common'

/** Mesma razão de `SO_USUARIO_DE_GESTAO`: prefixado com o produto, nunca colide. */
export const SO_USUARIO_DO_PORTAL = 'fir:so-usuario-do-portal'

/**
 * A rota pertence ao Portal do Grupo: exige a sessão de `Usuário do portal`
 * (`__Host-fir-portal`), nunca a sessão de clínica, de operador nem de
 * `Usuário de Gestão`.
 *
 * Marca o controlador inteiro — mesma razão de `@SoUsuarioDeGestao()`.
 */
export const SoUsuarioDoPortal = (): ClassDecorator & MethodDecorator =>
  SetMetadata(SO_USUARIO_DO_PORTAL, true)
