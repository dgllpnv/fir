import { DURACAO_DESAFIO_MS } from '@fir/domain'
import type pg from 'pg'
import { novoToken } from '../../autenticacao/sessao'

/**
 * Cria o DESAFIO que a senha certa entrega a quem tem TOTP (A-12) — chamado
 * de dentro da transação do login (`CarteiraService.entrar`). Devolve o token
 * opaco; o banco guarda só o hash. Não é sessão: nenhuma rota de carteira o
 * aceita, e ele vence em 5 min.
 *
 * Arquivo à parte, sem importar nada da carteira: `carteira.service.ts` o
 * importa, e o serviço do segundo fator importa `carteira.guard.ts`, que
 * importa `carteira.service.ts` — o ciclo deixaria o `@Inject` do guard com
 * `undefined` conforme a ordem de carga.
 */
export async function criarDesafioDeCarteira(c: pg.PoolClient, usuarioGestaoId: string): Promise<string> {
  const { token, hash } = novoToken()
  await c.query(
    `INSERT INTO desafios_de_carteira (usuario_gestao_id, token_hash, expira_em)
     VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
    [usuarioGestaoId, hash, String(DURACAO_DESAFIO_MS)],
  )
  return token
}
