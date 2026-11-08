import type { UsuarioDeGestaoPublico } from '@fir/contracts'
import { segundaDaSemana } from '@fir/domain'
import type pg from 'pg'
import { podeVerValoresDaCarteira } from '../prospeccao/leads.permissoes'

export type Sessao = UsuarioDeGestaoPublico

/** Os erros de metas, indicadores e ações do plano, como valores que o controlador traduz. */
export class NaoEncontradoNaMeta extends Error {}
export class SemPermissaoDeValoresNaMeta extends Error {}
export class EntradaInvalidaNaMeta extends Error {
  constructor(public readonly codigo: string, mensagem: string) {
    super(mensagem)
  }
}

/**
 * **Escrita monetária exige `valores`** (appsec A-6, bloqueador). Alvo, valor
 * inicial, meta semanal e lançamento de um indicador `R$` são dinheiro do
 * negócio da cliente. Um ponto só, delegado à MESMA função da prospecção —
 * quando a carteira ganhar `temPermCarteira(u, 'valores')` (ticket 0.5), é lá
 * que muda, e aqui nada.
 */
export function exigirValores(sessao: Sessao, tocaDinheiro: boolean): void {
  if (tocaDinheiro && !podeVerValoresDaCarteira(sessao)) throw new SemPermissaoDeValoresNaMeta()
}

/**
 * A referência de todo `Lançamento de indicador` é a SEGUNDA-FEIRA da semana
 * (CE-4, ajuste 17). Recusada na entrada, em toda rota que lança — o banco
 * ainda não tem o CHECK, por causa dos legados (migration 0052).
 */
export function exigirSegunda(referencia: string): void {
  if (segundaDaSemana(referencia) !== referencia) {
    throw new EntradaInvalidaNaMeta('REFERENCIA_FORA_DA_SEGUNDA', 'A referência do lançamento é a segunda-feira da semana.')
  }
}

/**
 * O valor coerente com a unidade do indicador: `R$` em centavos (`valor`),
 * as outras em inteiro (`valorInteiro`). O banco confere de novo, por
 * trigger (0031) — esta é a mensagem legível.
 */
export function valorDaUnidade(
  unidade: string,
  valor: bigint | null | undefined,
  valorInteiro: bigint | null | undefined,
): { centavos: string | null; inteiro: string | null } {
  if (unidade === 'R$') {
    if (valor == null || valorInteiro != null) {
      throw new EntradaInvalidaNaMeta('UNIDADE_DO_VALOR', 'Indicador em R$: informe o valor em centavos.')
    }
    return { centavos: valor.toString(), inteiro: null }
  }
  if (valorInteiro == null || valor != null) {
    throw new EntradaInvalidaNaMeta('UNIDADE_DO_VALOR', 'Este indicador não é em R$: informe um número inteiro.')
  }
  return { centavos: null, inteiro: valorInteiro.toString() }
}

export type ClienteDaMeta = { id: string; grupo_id: string }

/**
 * O cliente da rota, lido SOB a RLS da sessão: ausente é 404, igual para "não
 * existe" e "não é do seu grupo". O `grupo_id` de toda escrita sai daqui,
 * nunca do corpo; a segunda camada é a FK composta `(cliente, grupo)`.
 */
export async function clienteDaMeta(c: pg.PoolClient, clienteId: string): Promise<ClienteDaMeta> {
  const r = await c.query<ClienteDaMeta>(
    'SELECT id, grupo_id FROM clientes_carteira WHERE id = $1 AND excluido_em IS NULL',
    [clienteId],
  )
  const cliente = r.rows[0]
  if (!cliente) throw new NaoEncontradoNaMeta()
  return cliente
}

/** A equipe que pode acompanhar ou ser responsável: ativa, do grupo ou de escopo geral. */
export async function equipeDoGrupo(
  c: pg.PoolClient,
  grupoId: string | null,
): Promise<{ id: string; nome: string }[]> {
  const r = await c.query<{ id: string; nome: string }>(
    `SELECT id, nome FROM usuarios_gestao
      WHERE ativo AND ($1::uuid IS NULL OR grupo_id = $1::uuid OR escopo = 'geral')
      ORDER BY nome`,
    [grupoId],
  )
  return r.rows
}
