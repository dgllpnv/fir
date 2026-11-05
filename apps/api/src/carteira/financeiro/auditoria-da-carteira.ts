import type pg from 'pg'

/**
 * A trilha de ESCRITA do `Usuário de Gestão` (regra 20: quem, quando,
 * de→para). Gravada EXPLICITAMENTE pelo código da aplicação — ver o
 * comentário de `auditoria_da_carteira` na migration 0031 para o porquê de
 * não ser um trigger: as tabelas de G3 não têm `clinica_id`, e
 * `app.pessoa_id` das conexões de leitura/escrita da carteira
 * (`nasTabelasDaCarteiraComEscopo`) é sempre `'sistema'` — gravar o
 * `usuarioGestaoId` de uma variável de sessão mentiria sobre quem escreveu.
 *
 * Chamar DENTRO da mesma transação (`c`) da escrita que está sendo
 * auditada — nunca numa conexão separada, para que a trilha nunca exista sem
 * a escrita que ela descreve (e vice-versa).
 */
export async function gravarAuditoriaDaCarteira(
  c: pg.PoolClient,
  entrada: {
    readonly usuarioGestaoId: string
    readonly grupoId: string
    readonly tabela: string
    readonly registroId: string
    readonly acao: 'criar' | 'atualizar' | 'marcar_pago' | 'desfazer_pago'
    readonly de: unknown
    readonly para: unknown
  },
): Promise<void> {
  await c.query(
    `INSERT INTO auditoria_da_carteira (usuario_gestao_id, grupo_id, tabela, registro_id, acao, de, para)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entrada.usuarioGestaoId,
      entrada.grupoId,
      entrada.tabela,
      entrada.registroId,
      entrada.acao,
      entrada.de === null ? null : JSON.stringify(entrada.de),
      entrada.para === null ? null : JSON.stringify(entrada.para),
    ],
  )
}
