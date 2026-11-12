/**
 * Desativar um grupo corta o acesso de quem é DELE, na próxima requisição.
 *
 * `usuarios_gestao` de escopo `geral` e `usuarios_do_portal` sem grupo têm
 * `grupo_id` nulo e passam. Quem aponta para um grupo só passa se ele estiver
 * ativo. `grupos` não tem RLS (identidade, não dado de clínica), então o
 * `EXISTS` roda em qualquer papel que leia a tabela.
 *
 * Fragmento SQL estático (sem entrada de usuário): `alias` é uma constante do
 * chamador, nunca um valor vindo da requisição.
 */
export const grupoAtivoDe = (alias: 'u' | 'usuarios_gestao'): string =>
  `(${alias}.grupo_id IS NULL OR EXISTS (SELECT 1 FROM grupos gx WHERE gx.id = ${alias}.grupo_id AND gx.ativo))`
