import { PRAZO_DO_LINK_MS, type FinalidadeDeLink } from '@fir/domain'
import type pg from 'pg'
import { novoToken } from '../autenticacao/sessao'

/**
 * A escrita de `links_de_acesso` e `eventos_de_acesso`, UMA vez.
 *
 * Tudo recebe um `pg.PoolClient` de uma transação já aberta, com a clínica e o
 * ator fixados por quem chamou — o mesmo molde de `escrita-de-pessoa.ts`. Nada
 * aqui abre transação nem escolhe o pool, e por isso o painel (`fir_painel`)
 * invalida links pelo mesmo `UPDATE` que a clínica.
 */

export const EVENTOS_DE_ACESSO = [
  'convite_enviado',
  'convite_reenviado',
  'redefinicao_enviada_pela_admin',
  'pedido_de_redefinicao',
  'pedido_sem_conta',
  'senha_criada_pelo_convite',
  'senha_redefinida_pelo_link',
  'email_cadastrado',
  'email_confirmado',
  'link_vencido',
  'link_ja_usado',
] as const
export type EventoDeAcesso = (typeof EVENTOS_DE_ACESSO)[number]

/** O rótulo de Atividades. Uma tabela só, para a tela e para o teste. */
export const ROTULO_DO_EVENTO: Readonly<Record<EventoDeAcesso, string>> = {
  convite_enviado: 'Convite de acesso enviado',
  convite_reenviado: 'Convite de acesso reenviado',
  redefinicao_enviada_pela_admin: 'Link para redefinir a senha enviado pela administradora',
  pedido_de_redefinicao: 'Pedido de senha nova ("Esqueci minha senha")',
  pedido_sem_conta: 'Pedido de senha nova para um e-mail sem cadastro',
  senha_criada_pelo_convite: 'Senha criada pelo convite',
  senha_redefinida_pelo_link: 'Senha redefinida pelo link',
  email_cadastrado: 'E-mail cadastrado, aguardando confirmação',
  email_confirmado: 'E-mail confirmado',
  link_vencido: 'Tentativa com link vencido',
  link_ja_usado: 'Tentativa com link já usado',
}

/**
 * Emite um link novo e devolve o TOKEN CRU — a única vez que ele existe fora do
 * e-mail. O banco guarda só o SHA-256 (`token_hash`) e o HMAC do endereço.
 *
 * **Um link vivo por pessoa e finalidade, e quem garante é o banco** (appsec 6):
 * o índice único parcial `links_de_acesso_um_vivo`. O `FOR UPDATE` na pessoa
 * serializa duas emissões concorrentes — sem ele, as duas invalidariam o mesmo
 * nada e a segunda estouraria no índice; com ele, a segunda espera, invalida o
 * link da primeira e insere o seu.
 *
 * O relógio é o da aplicação, nos dois instantes (criação e prazo) e na
 * conferência de `usar`: um relógio só julga o prazo (ver o comentário longo de
 * `autenticacao.service.ts` sobre dois relógios decidindo a mesma coisa).
 */
export async function emitirLink(
  c: pg.PoolClient,
  dados: {
    readonly clinicaId: string
    readonly pessoaId: string
    readonly finalidade: FinalidadeDeLink
    readonly emailHmac: string
    readonly agora: Date
  },
): Promise<string> {
  await c.query('SELECT 1 FROM pessoas WHERE id = $1 FOR UPDATE', [dados.pessoaId])
  await c.query(
    `UPDATE links_de_acesso SET invalidado_em = $3
      WHERE pessoa_id = $1 AND finalidade = $2 AND usado_em IS NULL AND invalidado_em IS NULL`,
    [dados.pessoaId, dados.finalidade, dados.agora],
  )
  const { token, hash } = novoToken()
  await c.query(
    `INSERT INTO links_de_acesso
       (clinica_id, pessoa_id, finalidade, email_hmac, token_hash, criado_em, expira_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      dados.clinicaId,
      dados.pessoaId,
      dados.finalidade,
      dados.emailHmac,
      hash,
      dados.agora,
      new Date(dados.agora.getTime() + PRAZO_DO_LINK_MS[dados.finalidade]),
    ],
  )
  return token
}

/**
 * Os links abertos da pessoa morrem junto com o que eles autorizam (appsec 7):
 * troca de e-mail, desativação, exclusão, troca de senha, provisória definida.
 * Sem cláusula de clínica: a RLS a impõe.
 */
export async function invalidarLinksDaPessoa(c: pg.PoolClient, pessoaId: string): Promise<void> {
  await c.query(
    `UPDATE links_de_acesso SET invalidado_em = now()
      WHERE pessoa_id = $1 AND usado_em IS NULL AND invalidado_em IS NULL`,
    [pessoaId],
  )
}

/**
 * Uma linha em `eventos_de_acesso`. Sem e-mail, IP, user agent ou token (LGPD
 * L6). `porPessoaId` é quem PROVOU quem é (a admin que reenviou, a pessoa que
 * usou o link); `null` quando foi o sistema ou alguém sem sessão.
 */
export async function gravarEvento(
  c: pg.PoolClient,
  dados: {
    readonly clinicaId: string
    readonly pessoaId: string | null
    readonly evento: EventoDeAcesso
    readonly porPessoaId: string | null
  },
): Promise<void> {
  await c.query(
    `INSERT INTO eventos_de_acesso (clinica_id, pessoa_id, evento, por_pessoa_id)
     VALUES ($1, $2, $3, $4)`,
    [dados.clinicaId, dados.pessoaId, dados.evento, dados.porPessoaId],
  )
}
