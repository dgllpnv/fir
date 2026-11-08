import type { UsuarioDeGestaoPublico } from '@fir/contracts'
import { type PessoaDaEquipe, diaCivil } from '@fir/domain'
import { HttpException, type HttpStatus } from '@nestjs/common'
import type pg from 'pg'
import type { Relogio } from '../../comum/relogio'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'

export type Sessao = UsuarioDeGestaoPublico

/**
 * Os erros do módulo, como VALORES de classe que o controlador traduz para
 * status. Nenhum carrega texto do usuário (A-21: o erro não ecoa o que veio).
 */
export class NaoEncontrado extends Error {}
export class SemPermissaoDeAdministrar extends Error {}
export class ModeloJaExiste extends Error {}
export class ClienteSemDataDeEntrada extends Error {}
export class NaoEhClienteExistente extends Error {}
export class MetasJaCadastradas extends Error {}
export class ValorSemPermissao extends Error {}
export class TarefaCancelada extends Error {}
export class EntradaInvalida extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

/** Corpo de erro com código estável — a tela casa o código, nunca o texto. */
export const recusa = (status: HttpStatus, codigo: string, message: string): HttpException =>
  new HttpException({ statusCode: status, codigo, message }, status)

export const hojeNaCarteira = (relogio: Relogio): string => diaCivil(relogio.agora(), FUSO_DA_CARTEIRA)

export type ClienteDoChecklist = {
  id: string
  grupo_id: string
  nome: string
  produto: string
  area_foco: string | null
  data_inicio: string | null
  cliente_desde: string | null
  responsavel_usuario_gestao_id: string | null
}

/**
 * O cliente da rota, lido SOB a RLS da sessão e TRAVADO (`FOR UPDATE`) quando
 * a operação escreve: dois "aplicar" concorrentes do mesmo cliente se
 * enfileiram aqui. Ausente = 404, a mesma resposta para "não existe" e "não é
 * do seu grupo". O `grupo_id` de toda escrita sai DAQUI, nunca do corpo.
 */
export async function clienteDoChecklist(
  c: pg.PoolClient,
  clienteId: string,
  travar: boolean,
): Promise<ClienteDoChecklist> {
  const r = await c.query<ClienteDoChecklist>(
    `SELECT id, grupo_id, nome, produto, area_foco, data_inicio::text AS data_inicio,
            cliente_desde::text AS cliente_desde, responsavel_usuario_gestao_id
       FROM clientes_carteira
      WHERE id = $1 AND excluido_em IS NULL
      ${travar ? 'FOR UPDATE' : ''}`,
    [clienteId],
  )
  const cliente = r.rows[0]
  if (!cliente) throw new NaoEncontrado()
  return cliente
}

/**
 * Quem pode receber item do checklist de um cliente do grupo `grupoId`: as
 * pessoas do grupo e as de escopo geral (a mesma regra de responsável de
 * `reunioes.service.ts`, A-11 item 7). `setor` vem de `usuarios_gestao.setor`
 * (0050) e decide só A QUEM vai o item, nunca autorização (A-4). Diretoria =
 * setor 'diretoria'; sem ninguém nele, quem é de escopo geral — e a ordem
 * põe o setor declarado primeiro.
 */
export async function equipeDoGrupo(c: pg.PoolClient, grupoId: string): Promise<(PessoaDaEquipe & { nome: string })[]> {
  const r = await c.query<{ id: string; nome: string; ativo: boolean; escopo: 'geral' | 'grupo'; setor: string | null }>(
    `SELECT id, nome, ativo, escopo, setor FROM usuarios_gestao
      WHERE grupo_id = $1 OR escopo = 'geral'
      ORDER BY (setor = 'diretoria') DESC NULLS LAST, nome, id`,
    [grupoId],
  )
  return r.rows.map((p) => ({
    id: p.id,
    nome: p.nome,
    ativo: p.ativo,
    diretoria: p.setor === 'diretoria' || p.escopo === 'geral',
    setor: p.setor === 'comercial' || p.setor === 'administrativo' || p.setor === 'financeiro' ? p.setor : null,
  }))
}

/** Registro de ACESSO à ficha (LGPD A53): uma linha por leitura, na mesma transação. */
export async function registrarAcesso(c: pg.PoolClient, sessao: Sessao, entidade: string, clienteId: string): Promise<void> {
  await c.query(
    `INSERT INTO auditoria_do_painel (ator_tipo, ator_id, acao, entidade, entidade_id)
     VALUES ('usuario_gestao', $1, 'acessou', $2, $3)`,
    [sessao.id, entidade, clienteId],
  )
}
