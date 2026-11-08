import type {
  AcaoDoPlano,
  AcoesDoPlanoSaida,
  CriarAcaoDoPlanoEntrada,
  EditarAcaoDoPlanoEntrada,
  StatusDeAcaoDoPlano,
  UsuarioDeGestaoPublico,
} from '@fir/contracts'
import { diaCivil, diasEntre } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'

type Sessao = UsuarioDeGestaoPublico

export class AcaoNaoEncontrada extends Error {}
export class AcaoInvalida extends Error {
  constructor(public readonly codigo: string, mensagem: string) {
    super(mensagem)
  }
}

export type LinhaAcao = {
  id: string
  cliente_carteira_id: string
  titulo: string
  tipo: AcaoDoPlano['tipo']
  meta_comercial_id: string | null
  meta_titulo: string | null
  quem_executa: AcaoDoPlano['quemExecuta']
  acompanhamento_usuario_gestao_id: string | null
  acompanhamento_nome: string | null
  prazo: string | null
  status: StatusDeAcaoDoPlano
  descricao: string | null
  concluida_em: Date | null
}

export const SELECT_ACAO = `
  SELECT a.id, a.cliente_carteira_id, a.titulo, a.tipo, a.meta_comercial_id, m.titulo AS meta_titulo,
         a.quem_executa, a.acompanhamento_usuario_gestao_id, u.nome AS acompanhamento_nome,
         a.prazo::text AS prazo, a.status, a.descricao, a.concluida_em
    FROM acoes_do_plano a
    LEFT JOIN metas_comerciais m ON m.id = a.meta_comercial_id
    LEFT JOIN usuarios_gestao u ON u.id = a.acompanhamento_usuario_gestao_id`

/** "Atrasada" é DERIVADA (L1114-1115): aberta e prazo antes de hoje — nunca um estado gravado. */
export function acaoParaContrato(l: LinhaAcao, hoje: string): AcaoDoPlano {
  const aberta = l.status !== 'concluida' && l.status !== 'cancelada'
  const atrasada = aberta && l.prazo !== null && l.prazo < hoje
  return {
    id: l.id,
    clienteCarteiraId: l.cliente_carteira_id,
    titulo: l.titulo,
    tipo: l.tipo,
    metaId: l.meta_comercial_id,
    metaTitulo: l.meta_titulo,
    quemExecuta: l.quem_executa,
    acompanhamentoUsuarioGestaoId: l.acompanhamento_usuario_gestao_id,
    acompanhamentoNome: l.acompanhamento_nome,
    prazo: l.prazo,
    status: l.status,
    descricao: l.descricao,
    concluidaEm: l.concluida_em?.toISOString() ?? null,
    atrasada,
    diasDeAtraso: atrasada && l.prazo !== null ? diasEntre(l.prazo, hoje) : null,
  }
}

/** Concluídas por último, depois por prazo — sem prazo antes (L1435, `localeCompare` de ""). */
const ordem = (a: AcaoDoPlano, b: AcaoDoPlano): number =>
  Number(a.status === 'concluida') - Number(b.status === 'concluida') || (a.prazo ?? '').localeCompare(b.prazo ?? '')

/**
 * **`Ação do plano`** (G8 2B, V8; `cPlano`, `tabelaAcoes`, `fAcao`).
 *
 * Escrita como o `Usuário de Gestão` da sessão: a trilha (`auditoria_do_painel`,
 * trigger da 0052) grava QUEM, nunca `sistema`. O cliente vem sob a RLS (404
 * igual para "não existe" e "outro grupo"); o `grupo_id` da escrita sai dele,
 * nunca do corpo; a FK composta `(cliente, grupo)` é a segunda camada, e a
 * FK `(meta, cliente)` prova que a meta vinculada é do mesmo cliente.
 */
@Injectable()
export class AcoesDoPlanoService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  private hoje(): string {
    return diaCivil(this.relogio.agora(), FUSO_DA_CARTEIRA)
  }

  private async cliente(c: pg.PoolClient, clienteId: string): Promise<{ id: string; grupo_id: string }> {
    const r = await c.query<{ id: string; grupo_id: string }>(
      'SELECT id, grupo_id FROM clientes_carteira WHERE id = $1 AND excluido_em IS NULL',
      [clienteId],
    )
    if (!r.rows[0]) throw new AcaoNaoEncontrada()
    return r.rows[0]
  }

  async listar(sessao: Sessao, clienteId: string): Promise<AcoesDoPlanoSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await this.cliente(c, clienteId)
      const hoje = this.hoje()
      const acoes = await c.query<LinhaAcao>(
        `${SELECT_ACAO} WHERE a.cliente_carteira_id = $1 AND a.grupo_id = $2 AND a.arquivada_em IS NULL`,
        [cliente.id, cliente.grupo_id],
      )
      const metas = await c.query<{ id: string; titulo: string }>(
        `SELECT id, titulo FROM metas_comerciais WHERE cliente_carteira_id = $1 AND excluido_em IS NULL ORDER BY criado_em`,
        [cliente.id],
      )
      const equipe = await c.query<{ id: string; nome: string }>(
        `SELECT id, nome FROM usuarios_gestao WHERE ativo AND (grupo_id = $1 OR escopo = 'geral') ORDER BY nome`,
        [cliente.grupo_id],
      )
      return {
        hoje,
        acoes: acoes.rows.map((l) => acaoParaContrato(l, hoje)).sort(ordem),
        metas: metas.rows,
        responsaveis: equipe.rows,
      }
    })
  }

  private async lerUma(c: pg.PoolClient, id: string): Promise<AcaoDoPlano> {
    const r = await c.query<LinhaAcao>(`${SELECT_ACAO} WHERE a.id = $1`, [id])
    if (!r.rows[0]) throw new AcaoNaoEncontrada()
    return acaoParaContrato(r.rows[0], this.hoje())
  }

  /** As recusas do banco viram recusa legível; o resto sobe (defeito, não usuário). */
  private async gravar<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f()
    } catch (e) {
      const pgErro = e as { code?: string; constraint?: string }
      if (pgErro.code === '23503' && pgErro.constraint === 'acoes_do_plano_meta_do_cliente') {
        throw new AcaoInvalida('META_INVALIDA', 'Essa meta não é desta cliente.')
      }
      if (pgErro.code === '23514' && pgErro.constraint === 'acoes_do_plano_acompanhamento_do_grupo') {
        throw new AcaoInvalida('RESPONSAVEL_INVALIDO', 'Escolha alguém da equipe desta cliente.')
      }
      if (pgErro.code === '23503' && pgErro.constraint === 'acoes_do_plano_acompanhamento_usuario_gestao_id_fkey') {
        throw new AcaoInvalida('RESPONSAVEL_INVALIDO', 'Escolha alguém da equipe desta cliente.')
      }
      throw e
    }
  }

  async criar(sessao: Sessao, clienteId: string, dto: CriarAcaoDoPlanoEntrada): Promise<AcaoDoPlano> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await this.cliente(c, clienteId)
      const r = await this.gravar(() =>
        c.query<{ id: string }>(
          `INSERT INTO acoes_do_plano
             (cliente_carteira_id, grupo_id, titulo, tipo, meta_comercial_id, quem_executa,
              acompanhamento_usuario_gestao_id, prazo, status, descricao, concluida_em, criado_por)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $9 = 'concluida' THEN now() END, $11)
           RETURNING id`,
          [
            cliente.id,
            cliente.grupo_id,
            dto.titulo,
            dto.tipo,
            dto.metaId,
            dto.quemExecuta,
            dto.acompanhamentoUsuarioGestaoId,
            dto.prazo,
            dto.status,
            dto.descricao,
            sessao.id,
          ],
        ),
      )
      return this.lerUma(c, r.rows[0]!.id)
    })
  }

  /** Editar (`data-edit-acao`, L2866): concluída guarda o instante da primeira conclusão; reaberta, perde. */
  async editar(sessao: Sessao, clienteId: string, acaoId: string, dto: EditarAcaoDoPlanoEntrada): Promise<AcaoDoPlano> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await this.cliente(c, clienteId)
      const r = await this.gravar(() =>
        c.query<{ id: string }>(
          `UPDATE acoes_do_plano SET
             titulo = coalesce($3, titulo),
             tipo = coalesce($4, tipo),
             meta_comercial_id = CASE WHEN $5::boolean THEN $6::uuid ELSE meta_comercial_id END,
             quem_executa = coalesce($7, quem_executa),
             acompanhamento_usuario_gestao_id = CASE WHEN $8::boolean THEN $9::uuid ELSE acompanhamento_usuario_gestao_id END,
             prazo = CASE WHEN $10::boolean THEN $11::date ELSE prazo END,
             descricao = CASE WHEN $12::boolean THEN $13 ELSE descricao END,
             status = coalesce($14, status),
             concluida_em = CASE
               WHEN coalesce($14, status) = 'concluida' THEN coalesce(concluida_em, now())
               ELSE NULL END,
             atualizado_em = now()
           WHERE id = $1 AND cliente_carteira_id = $2 AND arquivada_em IS NULL
           RETURNING id`,
          [
            acaoId,
            cliente.id,
            dto.titulo ?? null,
            dto.tipo ?? null,
            dto.metaId !== undefined,
            dto.metaId ?? null,
            dto.quemExecuta ?? null,
            dto.acompanhamentoUsuarioGestaoId !== undefined,
            dto.acompanhamentoUsuarioGestaoId ?? null,
            dto.prazo !== undefined,
            dto.prazo ?? null,
            dto.descricao !== undefined,
            dto.descricao ?? null,
            dto.status ?? null,
          ],
        ),
      )
      if (!r.rows[0]) throw new AcaoNaoEncontrada()
      return this.lerUma(c, acaoId)
    })
  }

  /** O check da tabela (`data-toggle-acao`, L2861): concluída ↔ pendente. */
  async alternar(sessao: Sessao, clienteId: string, acaoId: string): Promise<AcaoDoPlano> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await this.cliente(c, clienteId)
      const r = await c.query<{ id: string }>(
        `UPDATE acoes_do_plano SET
           status = CASE WHEN status = 'concluida' THEN 'pendente' ELSE 'concluida' END,
           concluida_em = CASE WHEN status = 'concluida' THEN NULL ELSE now() END,
           atualizado_em = now()
         WHERE id = $1 AND cliente_carteira_id = $2 AND arquivada_em IS NULL
         RETURNING id`,
        [acaoId, cliente.id],
      )
      if (!r.rows[0]) throw new AcaoNaoEncontrada()
      return this.lerUma(c, acaoId)
    })
  }

  /** "Excluir" (L2866, `del`) vira arquivar (regra 20). */
  async arquivar(sessao: Sessao, clienteId: string, acaoId: string): Promise<void> {
    await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await this.cliente(c, clienteId)
      const r = await c.query(
        `UPDATE acoes_do_plano SET arquivada_em = now(), atualizado_em = now()
          WHERE id = $1 AND cliente_carteira_id = $2 AND arquivada_em IS NULL RETURNING id`,
        [acaoId, cliente.id],
      )
      if ((r.rowCount ?? 0) === 0) throw new AcaoNaoEncontrada()
    })
  }
}
