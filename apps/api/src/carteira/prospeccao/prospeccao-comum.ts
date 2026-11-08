import type { UsuarioDeGestaoPublico } from '@fir/contracts'
import type pg from 'pg'

/*
 * O que os dois serviços da prospecção (`LeadsService`, `RotinaInternaService`)
 * compartilham: o tradutor do SQLSTATE de FK violada, os erros que os dois
 * lançam e a consulta do grupo do responsável. Um lugar só, para que a mesma
 * recusa não seja escrita duas vezes com mensagens que divergem.
 */

export const FK_VIOLADA = '23503'

/**
 * O driver `pg` não tipa `code` no `Error` que lança — é uma propriedade
 * que ele anexa em runtime, lida direto do SQLSTATE do Postgres. O `as` abaixo
 * é seguro porque `code`, quando presente, é sempre essa string de 5
 * caracteres; quando ausente (erro que não veio do banco), `code` é
 * `undefined` e a comparação com `FK_VIOLADA` simplesmente falha.
 */
export const codigoPg = (e: unknown): string | undefined => (e as { code?: string }).code

export class GrupoCruzado extends Error {}
export class ResponsavelDeOutroGrupo extends Error {}
export class ReferenciaInexistente extends Error {}

export type Sessao = UsuarioDeGestaoPublico

/** `null` quando `usuarioGestaoId` é `null` ou não existe (deixa o `FK_VIOLADA` do INSERT recusar). */
export async function grupoDeUsuarioDeGestao(c: pg.PoolClient, usuarioGestaoId: string | null): Promise<string | null> {
  if (usuarioGestaoId === null) return null
  const r = await c.query<{ grupo_id: string | null }>(
    'SELECT grupo_id FROM usuarios_gestao WHERE id = $1',
    [usuarioGestaoId],
  )
  return r.rows[0]?.grupo_id ?? null
}
