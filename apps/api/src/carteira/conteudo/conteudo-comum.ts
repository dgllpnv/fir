import type { UsuarioDeGestaoPublico } from '@fir/contracts'
import { HttpException, HttpStatus } from '@nestjs/common'
import type pg from 'pg'

export type Sessao = UsuarioDeGestaoPublico

/**
 * Os erros do módulo, como VALORES de classe que o controlador traduz para
 * status. Nenhum carrega texto do usuário (A-21: o erro não ecoa o que veio).
 */
export class NaoEncontrado extends Error {}
export class SemPermissaoDeAdministrar extends Error {}
export class ConteudoArquivado extends Error {}
export class ResponsavelInvalido extends Error {}
export class EntradaInvalida extends Error {
  constructor(public readonly codigo: string, mensagem: string) {
    super(mensagem)
  }
}
export class MotivoObrigatorio extends Error {}
export class ContagemMudou extends Error {}
export class ChaveReutilizada extends Error {}

/** Corpo de erro com código estável — a tela casa o código, nunca o texto. */
export const recusa = (status: HttpStatus, codigo: string, message: string): HttpException =>
  new HttpException({ statusCode: status, codigo, message }, status)

export type ClienteDoConteudo = {
  id: string
  grupo_id: string
  clinica_id: string | null
  produto: string
}

/**
 * O cliente da rota, lido SOB a RLS da sessão. Ausente = 404 — a mesma
 * resposta para "não existe" e "não é do seu grupo" (V1). O `grupo_id` de
 * toda escrita sai DAQUI, nunca do corpo (ADR 0016 item 2).
 *
 * O `WHERE` não filtra grupo à mão porque a RLS já o faz, e a segunda camada
 * mora no INSERT: as tabelas filhas têm FK composta `(cliente, grupo)` (A-8),
 * então um grupo divergente do pai não grava nem que o código erre.
 */
export async function clienteVisivel(c: pg.PoolClient, clienteId: string): Promise<ClienteDoConteudo> {
  const r = await c.query<ClienteDoConteudo>(
    `SELECT id, grupo_id, clinica_id, produto
       FROM clientes_carteira
      WHERE id = $1 AND excluido_em IS NULL`,
    [clienteId],
  )
  const cliente = r.rows[0]
  if (!cliente) throw new NaoEncontrado()
  return cliente
}

/**
 * Registro de ACESSO de um `Usuário de Gestão` às atas de um cliente (LGPD
 * A14, A53; ADR 0013 §7). Uma linha por leitura da LISTA, nunca uma por ata.
 *
 * Vai para `auditoria_do_painel`, na MESMA transação da leitura: a ata é dado
 * da Firmare (controladora, na carteira), e a trilha de acesso dela é a da
 * Firmare. Se a gravação falhar, a leitura cai junto (falha fechada, mesma
 * escolha de `AcessoInterceptor`).
 */
export async function registrarAcessoAsAtas(c: pg.PoolClient, sessao: Sessao, clienteId: string): Promise<void> {
  await c.query(
    `INSERT INTO auditoria_do_painel (ator_tipo, ator_id, acao, entidade, entidade_id)
     VALUES ('usuario_gestao', $1, 'acessou', 'reunioes_comerciais', $2)`,
    [sessao.id, clienteId],
  )
}

/** Monta um `UPDATE` só com as colunas presentes, na ordem do mapa. */
export function partesDoUpdate(
  campos: ReadonlyArray<readonly [coluna: string, valor: unknown]>,
  primeiroParametro: number,
): { sets: string[]; valores: unknown[] } {
  const sets: string[] = []
  const valores: unknown[] = []
  for (const [coluna, valor] of campos) {
    if (valor === undefined) continue
    valores.push(valor)
    sets.push(`${coluna} = $${primeiroParametro + valores.length - 1}`)
  }
  return { sets, valores }
}
