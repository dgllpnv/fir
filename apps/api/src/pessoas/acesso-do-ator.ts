import {
  type AtorDeAcesso,
  type ChaveDePermissao,
  type ErroDeDominio,
  type Perfil,
  type Result,
  ehRecusaDePrivilegio,
} from '@fir/domain'
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common'
import type pg from 'pg'
import type { Ator } from '../banco/ator'

/**
 * Pedaços compartilhados da escrita de pessoas, clínica e painel.
 *
 * Moram aqui, e não em cada serviço, porque são as três coisas que a escalada
 * de privilégio e a corrida de "última administradora" exigem **iguais**:
 * o lock, a releitura do ator e a tradução da recusa.
 */

/**
 * **Lock por clínica, o PRIMEIRO comando da transação** (antes de ler o ator,
 * o alvo e a equipe).
 *
 * `FOR UPDATE` no alvo serializa duas escritas sobre a MESMA linha; A
 * rebaixando B enquanto B rebaixa A tocam linhas diferentes, as duas leem "há
 * duas administradoras" e as duas passam — a clínica fica sem nenhuma. O lock
 * consultivo transacional serializa tudo o que muda o acesso da clínica e
 * some no COMMIT/ROLLBACK, sem estado a limpar. Hash de 64 bits: colisão entre
 * clínicas só serializa duas escritas que não precisavam, nunca erra.
 */
export async function travarAcessoDaClinica(c: pg.PoolClient, clinicaId: string): Promise<void> {
  await c.query(`SELECT pg_advisory_xact_lock(hashtextextended('pessoas-acesso:' || $1::text, 0))`, [
    clinicaId,
  ])
}

/**
 * O ator **como está no banco agora**, dentro da transação travada.
 *
 * Pessoa: relida de `pessoas` (admin, perfil e ativa) — se a pessoa foi
 * desativada, excluída ou rebaixada entre o guard e aqui, quem decide é o
 * estado atual, não o que o guard viu. Operador (sessão de suporte): admin
 * por construção. Qualquer outro ator não tem rota aqui.
 */
export async function lerAtorDeAcesso(c: pg.PoolClient, ator: Ator): Promise<AtorDeAcesso> {
  if (typeof ator === 'string') {
    const r = await c.query<{ admin: boolean; perfil_id: string | null; ativo: boolean }>(
      'SELECT admin, perfil_id, ativo FROM pessoas WHERE id = $1 AND excluida_em IS NULL',
      [ator],
    )
    const l = r.rows[0]
    if (l === undefined || !l.ativo) throw new ForbiddenException('Seu acesso não está mais ativo.')
    return { tipo: 'pessoa', id: ator, admin: l.admin, perfilId: l.perfil_id }
  }
  if (ator.tipo === 'operador') return { tipo: 'operador', admin: true }
  throw new ForbiddenException('Este acesso não é de uma pessoa da clínica.')
}

/**
 * Os perfis na forma do DOMÍNIO — **inclusive os excluídos**: o perfil de uma
 * pessoa que o tem não deixa de valer para `temPerm` porque saiu da lista de
 * escolhas.
 */
export async function lerPerfisDoDominio(c: pg.PoolClient): Promise<Perfil[]> {
  const r = await c.query<{ id: string; nome: string; perms: string[] }>(
    'SELECT id, nome, perms FROM perfis',
  )
  return r.rows.map((l) => ({
    id: l.id,
    nome: l.nome,
    // `perms` vem de coluna que só recebe chaves validadas por `ChavePermitida`.
    perms: l.perms as ChaveDePermissao[],
  }))
}

/**
 * `Result` do domínio → exceção de borda (CLAUDE.md: *erros são valores no
 * domínio, exceções na borda*).
 *
 *  - **403** recusa de PRIVILÉGIO: quem pede não pode, e repetir não muda.
 *  - **422** recusa de ESTADO: o corpo está bem formado e a permissão existe;
 *    o que o servidor recusa é o estado resultante (última administradora).
 *
 * O `codigo` viaja para que a tela case código, nunca texto.
 */
export function exigirDominio(r: Result<void, ErroDeDominio>): void {
  if (r.tipo !== 'erro') return
  const corpo = { codigo: r.erro.codigo, message: r.erro.mensagem }
  if (ehRecusaDePrivilegio(r.erro.codigo)) {
    throw new ForbiddenException({ statusCode: 403, ...corpo })
  }
  throw new UnprocessableEntityException({ statusCode: 422, ...corpo })
}
