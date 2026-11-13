import request from 'supertest'
import { hashDeSenha } from '../../autenticacao/senha'
import type { Cenario } from './cenario'

const SENHA_EXTRA = 'senha-de-persona-extra-seis-janelas'

/**
 * Uma pessoa com EXATAMENTE as permissões pedidas, dentro de um cenário que já
 * existe. O cenário traz sete perfis fixos, e nenhum combina `jornada` +
 * `receber` sem `valores` — que é o perfil dos achados F9 e F10.
 *
 * Registra a pessoa e o cookie dentro do `Cenario`, para `postar`/`pegar`
 * funcionarem com o nome dela.
 */
export async function criarPersona(
  c: Cenario,
  usuario: string,
  perms: readonly string[],
): Promise<void> {
  const perfil = (
    await c.migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, $2, $2, $3) RETURNING id`,
      [c.clinica, `pf_${usuario}`, perms],
    )
  ).rows[0]!.id
  const id = (
    await c.migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
       VALUES ($1, $2, $2, $3, $4) RETURNING id`,
      [c.clinica, usuario, await hashDeSenha(SENHA_EXTRA), perfil],
    )
  ).rows[0]!.id
  const codigo = (
    await c.migrate.query<{ codigo: string }>('SELECT codigo FROM clinicas WHERE id = $1', [c.clinica])
  ).rows[0]!.codigo
  const r = await request(c.app.getHttpServer())
    .post('/v1/entrar')
    .send({ clinica: codigo, usuario, senha: SENHA_EXTRA })
    .expect(200)
  const v = r.headers['set-cookie'] as unknown
  ;(c.pessoas as Record<string, string>)[usuario] = id
  ;(c.cookies as Record<string, string[]>)[usuario] = Array.isArray(v)
    ? (v as string[])
    : typeof v === 'string'
      ? [v]
      : []
}
