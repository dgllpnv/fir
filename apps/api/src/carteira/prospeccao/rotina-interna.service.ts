import type {
  AniversarioNaLista,
  CargaDaEquipeSaida,
  CheckinInternoNaLista,
  CriarTarefaCarteiraEntrada,
  DefinirMeuAniversarioEntrada,
  EquipeDaRotinaSaida,
  ItemDaTarefaCarteira,
  ListaDeTarefasCarteiraSaida,
  MeuAniversarioSaida,
  RedistribuirTarefasEntrada,
  RegistrarCheckinInternoEntrada,
  RotinaCarteira,
  RotinaCarteiraEntrada,
  TarefaCarteira,
} from '@fir/contracts'
import {
  aniversariosProximos,
  aplicaRotinaAoCliente,
  cargaDaPessoa,
  cargaPorCliente,
  cumprimentoNoPrazo,
  destinoPodeReceberTarefa,
  diaCivil,
  ehErro,
  linkDoWhatsApp,
  mensagemDeAniversario,
  planejarTarefasDaRotina,
  podeEditarCheckinDaSemana,
  proximaDaRecorrencia,
  proximaDataDaRotina,
  resolverGrupoDeEscrita,
  responsavelImpostoPeloPerfil,
  secaoDaTarefa,
  semanaAtual,
  semanasDaCarga,
  somarDias,
  tarefaEntraNaRedistribuicao,
  temPermCarteira,
  textoDaFrequencia,
  validarResponsavelDoMesmoGrupo,
  type ClienteParaRotina,
  type RecorrenciaDaTarefaInterna,
  type RotinaParaPlanejar,
  type TipoDeTarefaInterna,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
import { type LinhaDeClinica, umPorClinica } from '../um-por-clinica'
import {
  FK_VIOLADA,
  GrupoCruzado,
  ReferenciaInexistente,
  ResponsavelDeOutroGrupo,
  type Sessao,
  codigoPg,
  grupoDeUsuarioDeGestao,
} from './prospeccao-comum'

export class TarefaNaoEncontrada extends Error {}
export class RotinaNaoEncontrada extends Error {}
export class ItemNaoEncontrado extends Error {}
export class CheckinForaDaSemana extends Error {}
export class SoEscopoGeral extends Error {}
export class TarefaEmConflito extends Error {}
export class SemTelefone extends Error {}

const VIOLACAO_DE_UNICIDADE = '23505'

/**
 * A rotina interna da equipe Firmare (G5, completada pelo G8 2A): rotinas com
 * todos os parâmetros do protótipo, tarefas com recorrência e subitens, a
 * lista "Minhas tarefas", a carga da equipe, redistribuir e aniversários.
 *
 * QUANDO uma rotina gera tarefa é decisão do domínio puro
 * (`planejarTarefasDaRotina`, `packages/domain/src/calendario-carteira.ts`);
 * aqui só se lê o que ele precisa e se grava com chave explícita e `ON
 * CONFLICT DO NOTHING` (regra 26, A-20). O "hoje" é sempre o dia civil no fuso
 * da carteira, do relógio do servidor (regras 22–24).
 *
 * Duas camadas, como no `LeadsService`: `resolverGrupoDeEscrita`/
 * `validarResponsavelDoMesmoGrupo`/`destinoPodeReceberTarefa` antes de
 * qualquer escrita, a RLS (`app_pode_ver_grupo`) embaixo.
 *
 * Log: nenhum aqui. O worker loga só contagens (regra 21).
 */
@Injectable()
export class RotinaInternaService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /** O dia de negócio da carteira, agora. */
  private hoje(): string {
    return diaCivil(this.relogio.agora(), FUSO_DA_CARTEIRA)
  }

  /* ──────────────────────────────────────────────────────────────────────
   * ROTINA
   * ────────────────────────────────────────────────────────────────────── */

  async listarRotinas(sessao: Sessao): Promise<RotinaCarteira[]> {
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const rotinas = await c.query<LinhaRotina>(
        `SELECT ${colunasRotina} FROM rotinas_internas r
           LEFT JOIN usuarios_gestao u ON u.id = r.responsavel_usuario_gestao_id
          WHERE r.excluida_em IS NULL
          ORDER BY u.nome NULLS LAST, r.titulo`,
      )
      if (rotinas.rows.length === 0) return []
      const clientes = await carregarClientesParaRotina(c)
      // As últimas 8 vencidas de cada rotina (`cump`, L1868) — a janela é
      // feita no banco para não trazer o histórico inteiro.
      const historico = await c.query<{
        rotina_interna_id: string
        prazo: string
        status: 'pendente' | 'concluida' | 'cancelada'
        concluida_no_dia: string | null
      }>(
        `SELECT rotina_interna_id, prazo::text, status,
                (concluida_em AT TIME ZONE $3)::date::text AS concluida_no_dia
           FROM (SELECT t.*, row_number() OVER (PARTITION BY rotina_interna_id ORDER BY prazo DESC) AS n
                   FROM tarefas_internas t
                  WHERE rotina_interna_id = ANY($1) AND prazo < $2 AND status <> 'cancelada') x
          WHERE n <= 8`,
        [rotinas.rows.map((r) => r.id), hoje, FUSO_DA_CARTEIRA],
      )
      return rotinas.rows.map((r) => {
        const p = rotinaParaPlanejar(r)
        const cs = clientesDaRotina(r, clientes)
        const hist = historico.rows
          .filter((h) => h.rotina_interna_id === r.id)
          .map((h) => ({ prazo: h.prazo, status: h.status, concluidaNoDia: h.concluida_no_dia }))
        return rotinaParaContrato(r, {
          textoFrequencia: textoDaFrequencia(p),
          proxima: r.ativa ? proximaDataDaRotina(p, cs, hoje) : null,
          noPrazo: cumprimentoNoPrazo(hist, hoje),
          clientesQueSeAplicam:
            r.escopo_aplicacao === 'global' ? 0 : cs.filter((x) => aplicaRotinaAoCliente(p, x)).length,
        })
      })
    })
  }

  async criarRotina(sessao: Sessao, dados: RotinaCarteiraEntrada): Promise<{ rotina: RotinaCarteira; geradas: number }> {
    // Rotina nasce "da própria Firmare" (grupo NULL, só `escopo='geral'`) ou do
    // grupo da sessão — nunca de um valor do corpo (ADR 0016 item 2).
    const resolucao = resolverGrupoDeEscrita(sessao, null)
    if (ehErro(resolucao)) throw new GrupoCruzado(resolucao.erro.mensagem)
    const grupoId = sessao.escopo === 'geral' ? null : resolucao.valor
    const hoje = this.hoje()
    const responsavel = dados.responsavelUsuarioGestaoId ?? sessao.id

    const id = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      await this.conferirResponsavel(c, sessao, grupoId, responsavel)
      let r: pg.QueryResult<{ id: string }>
      try {
        // O início é HOJE, do servidor (regra 24; o protótipo também fixa, L2984).
        r = await c.query<{ id: string }>(
          `INSERT INTO rotinas_internas
             (titulo, grupo_id, responsavel_usuario_gestao_id, frequencia, escopo_aplicacao, passos, inicio,
              ativa, prioridade, dia_semana, dia_util, antecedencia, servico, quem_executa, mensagem, frentes, envio)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           RETURNING id`,
          [
            dados.titulo, grupoId, responsavel, dados.frequencia, dados.escopoAplicacao, dados.passos, hoje,
            dados.ativa, dados.prioridade, dados.diaSemana, dados.diaUtil, dados.antecedencia, dados.servico,
            dados.quemExecuta, dados.mensagem, dados.frentes, dados.envio,
          ],
        )
      } catch (e) {
        if (codigoPg(e) === FK_VIOLADA) throw new ReferenciaInexistente()
        throw e
      }
      return r.rows[0]!.id
    })
    return this.gerarESalvar(sessao, id, hoje)
  }

  /**
   * Editar a rotina (R10, L2853): as tarefas FUTURAS ainda abertas são
   * canceladas (`cancelada_por = 'edicao_da_rotina'` — nunca `DELETE`, regra
   * 20) e a geração refaz com os parâmetros novos. Pausar é editar com
   * `ativa = false`: cancela as futuras e não gera.
   */
  async editarRotina(sessao: Sessao, id: string, dados: RotinaCarteiraEntrada): Promise<{ rotina: RotinaCarteira; geradas: number }> {
    const hoje = this.hoje()
    await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await c.query<{ grupo_id: string | null; responsavel_usuario_gestao_id: string | null }>(
        `SELECT grupo_id, responsavel_usuario_gestao_id FROM rotinas_internas
          WHERE id = $1 AND excluida_em IS NULL FOR UPDATE`,
        [id],
      )
      const rotina = atual.rows[0]
      if (!rotina) throw new RotinaNaoEncontrada()
      const responsavel = dados.responsavelUsuarioGestaoId ?? rotina.responsavel_usuario_gestao_id ?? sessao.id
      await this.conferirResponsavel(c, sessao, rotina.grupo_id, responsavel)
      // A frequência/formato coerentes já foram conferidos no contrato; o
      // CHECK da 0051 é a segunda camada.
      await c.query(
        `UPDATE rotinas_internas
            SET titulo = $2, responsavel_usuario_gestao_id = $3, frequencia = $4, escopo_aplicacao = $5,
                passos = $6, ativa = $7, prioridade = $8, dia_semana = $9, dia_util = $10, antecedencia = $11,
                servico = $12, quem_executa = $13, mensagem = $14, frentes = $15, envio = $16, atualizada_em = now()
          WHERE id = $1`,
        [
          id, dados.titulo, responsavel, dados.frequencia, dados.escopoAplicacao, dados.passos, dados.ativa,
          dados.prioridade, dados.diaSemana, dados.diaUtil, dados.antecedencia, dados.servico, dados.quemExecuta,
          dados.mensagem, dados.frentes, dados.envio,
        ],
      )
      await c.query(
        `UPDATE tarefas_internas
            SET status = 'cancelada', cancelada_por = 'edicao_da_rotina', atualizada_em = now()
          WHERE rotina_interna_id = $1 AND status = 'pendente' AND prazo >= $2`,
        [id, hoje],
      )
    })
    return this.gerarESalvar(sessao, id, hoje)
  }

  /** "Excluir rotina" (L2853) é estado: sai da lista, para de gerar, e as abertas são canceladas. */
  async excluirRotina(sessao: Sessao, id: string): Promise<void> {
    await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query(
        `UPDATE rotinas_internas SET ativa = false, excluida_em = now(), atualizada_em = now()
          WHERE id = $1 AND excluida_em IS NULL`,
        [id],
      )
      if (r.rowCount === 0) throw new RotinaNaoEncontrada()
      await c.query(
        `UPDATE tarefas_internas
            SET status = 'cancelada', cancelada_por = 'edicao_da_rotina', atualizada_em = now()
          WHERE rotina_interna_id = $1 AND status = 'pendente'`,
        [id],
      )
    })
  }

  /** Gera as tarefas da rotina recém-salva, na sessão de quem salvou, e devolve a rotina. */
  private async gerarESalvar(sessao: Sessao, id: string, hoje: string): Promise<{ rotina: RotinaCarteira; geradas: number }> {
    const geradas = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<LinhaRotina>(
        `SELECT ${colunasRotina} FROM rotinas_internas r
           LEFT JOIN usuarios_gestao u ON u.id = r.responsavel_usuario_gestao_id
          WHERE r.id = $1 AND r.ativa AND r.excluida_em IS NULL`,
        [id],
      )
      return gerarParaRotinas(c, r.rows, hoje)
    })
    const rotina = (await this.listarRotinas(sessao)).find((r) => r.id === id)
    if (!rotina) throw new RotinaNaoEncontrada()
    return { rotina, geradas }
  }

  /**
   * O `Marcador de rotina interna` (R11) — o que o worker chama todo dia.
   * Planeja cada rotina ativa no domínio e grava com `ON CONFLICT DO NOTHING`
   * sobre os índices únicos (0032 e 0051): rodar duas, três vezes no mesmo
   * dia não grava nada depois da primeira (A-20, regra 26). Depois, R14: o
   * lembrete de mensalidade cujo mês já está pago se conclui sozinho.
   *
   * `soDosGrupos` recorta a geração às rotinas desses grupos — para
   * reprocessar um grupo à mão, e para que um teste com relógio fixo não gere
   * tarefas nas rotinas de outro arquivo de teste rodando em paralelo. O
   * worker chama sem recorte.
   */
  async gerarTarefasDeRotinasInternas(soDosGrupos: readonly string[] | null = null): Promise<number> {
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComEscopo('geral', null, async (c) => {
      const r = await c.query<LinhaRotina>(
        `SELECT ${colunasRotina} FROM rotinas_internas r
           LEFT JOIN usuarios_gestao u ON u.id = r.responsavel_usuario_gestao_id
          WHERE r.ativa AND r.excluida_em IS NULL AND ($1::uuid[] IS NULL OR r.grupo_id = ANY($1))`,
        [soDosGrupos],
      )
      return gerarParaRotinas(c, r.rows, hoje)
    })
  }

  /* ──────────────────────────────────────────────────────────────────────
   * TAREFA
   * ────────────────────────────────────────────────────────────────────── */

  async listarTarefas(sessao: Sessao, filtro: 'minhas' | 'todas' | string): Promise<ListaDeTarefasCarteiraSaida> {
    const hoje = this.hoje()
    const responsavel = filtro === 'minhas' ? sessao.id : filtro === 'todas' ? null : filtro
    // "Só a minha carteira" (A-3, ticket 0.5): tarefa de cliente alheio some,
    // salvo se o trabalho é dela (responsável pela tarefa).
    const minha = responsavelImpostoPeloPerfil(sessao)
    const daMinhaCarteira = `($2::uuid IS NULL OR t.cliente_carteira_id IS NULL
            OR cc.responsavel_usuario_gestao_id = $2 OR t.responsavel_usuario_gestao_id = $2)`
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const abertas = await c.query<LinhaTarefa>(
        `SELECT ${colunasTarefa} ${deTarefa}
          WHERE t.status = 'pendente' AND ($1::uuid IS NULL OR t.responsavel_usuario_gestao_id = $1)
            AND ${daMinhaCarteira}
          ORDER BY t.prazo, t.criado_em`,
        [responsavel, minha],
      )
      const concluidas = await c.query<LinhaTarefa>(
        `SELECT ${colunasTarefa} ${deTarefa}
          WHERE t.status = 'concluida' AND ($1::uuid IS NULL OR t.responsavel_usuario_gestao_id = $1)
            AND ${daMinhaCarteira}
          ORDER BY t.concluida_em DESC NULLS LAST
          LIMIT 6`,
        [responsavel, minha],
      )
      const itens = await carregarItens(c, [...abertas.rows, ...concluidas.rows].map((t) => t.id))
      return {
        hoje,
        tarefas: abertas.rows.map((t) => tarefaParaContrato(t, itens, hoje)),
        concluidasRecentes: concluidas.rows.map((t) => tarefaParaContrato(t, itens, hoje)),
      }
    })
  }

  async criarTarefa(sessao: Sessao, dados: CriarTarefaCarteiraEntrada): Promise<TarefaCarteira> {
    const resolucao = resolverGrupoDeEscrita(sessao, null)
    if (ehErro(resolucao)) throw new GrupoCruzado(resolucao.erro.mensagem)
    const hoje = this.hoje()

    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const grupoId = await this.grupoDaTarefa(c, sessao, resolucao.valor, dados)
      // O protótipo abre com responsável e solicitante = quem está criando (L2981).
      const responsavel = dados.responsavelUsuarioGestaoId ?? sessao.id
      const solicitante = dados.solicitanteUsuarioGestaoId ?? sessao.id
      await this.conferirResponsavel(c, sessao, grupoId, responsavel)
      await this.conferirResponsavel(c, sessao, grupoId, solicitante)

      let r: pg.QueryResult<{ id: string }>
      try {
        r = await c.query<{ id: string }>(
          `INSERT INTO tarefas_internas
             (titulo, descricao, grupo_id, responsavel_usuario_gestao_id, solicitante_usuario_gestao_id,
              cliente_carteira_id, lead_comercial_id, prazo, prioridade, recorrencia)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            dados.titulo, dados.descricao, grupoId, responsavel, solicitante, dados.clienteCarteiraId,
            dados.leadComercialId, dados.prazo, dados.prioridade, dados.recorrencia,
          ],
        )
      } catch (e) {
        if (codigoPg(e) === FK_VIOLADA) throw new ReferenciaInexistente()
        throw e
      }
      return lerTarefa(c, r.rows[0]!.id, hoje)
    })
  }

  /** Editar (R2). O status muda pela rota própria; "Excluir" é cancelar. */
  async editarTarefa(sessao: Sessao, id: string, dados: CriarTarefaCarteiraEntrada): Promise<TarefaCarteira> {
    const resolucao = resolverGrupoDeEscrita(sessao, null)
    if (ehErro(resolucao)) throw new GrupoCruzado(resolucao.erro.mensagem)
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await c.query<{ id: string }>('SELECT id FROM tarefas_internas WHERE id = $1 FOR UPDATE', [id])
      if (!atual.rows[0]) throw new TarefaNaoEncontrada()
      const grupoId = await this.grupoDaTarefa(c, sessao, resolucao.valor, dados)
      const responsavel = dados.responsavelUsuarioGestaoId ?? sessao.id
      const solicitante = dados.solicitanteUsuarioGestaoId
      await this.conferirResponsavel(c, sessao, grupoId, responsavel)
      if (solicitante !== null) await this.conferirResponsavel(c, sessao, grupoId, solicitante)
      try {
        await c.query(
          `UPDATE tarefas_internas
              SET titulo = $2, descricao = $3, grupo_id = $4, responsavel_usuario_gestao_id = $5,
                  solicitante_usuario_gestao_id = $6, cliente_carteira_id = $7, lead_comercial_id = $8,
                  prazo = $9, prioridade = $10, recorrencia = $11, atualizada_em = now()
            WHERE id = $1`,
          [
            id, dados.titulo, dados.descricao, grupoId, responsavel, solicitante, dados.clienteCarteiraId,
            dados.leadComercialId, dados.prazo, dados.prioridade, dados.recorrencia,
          ],
        )
      } catch (e) {
        if (codigoPg(e) === FK_VIOLADA) throw new ReferenciaInexistente()
        if (codigoPg(e) === VIOLACAO_DE_UNICIDADE) throw new TarefaEmConflito()
        throw e
      }
      return lerTarefa(c, id, hoje)
    })
  }

  /**
   * Concluir, cancelar ("Excluir", regra 20) e reabrir (R3). Concluir uma
   * recorrente cria a próxima UMA vez (`tarefa_origem_id` único, A-20):
   * concluir-reabrir-concluir não cria a segunda.
   */
  async mudarStatusTarefa(
    sessao: Sessao,
    id: string,
    status: 'concluida' | 'cancelada' | 'pendente',
  ): Promise<{ tarefa: TarefaCarteira; proxima: TarefaCarteira | null }> {
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await c.query<{ status: string; recorrencia: RecorrenciaDaTarefaInterna; prazo: string }>(
        'SELECT status, recorrencia, prazo::text FROM tarefas_internas WHERE id = $1 FOR UPDATE',
        [id],
      )
      const t = atual.rows[0]
      if (!t) throw new TarefaNaoEncontrada()
      if (t.status !== status) {
        try {
          await c.query(
            `UPDATE tarefas_internas
                SET status = $2,
                    concluida_em = CASE WHEN $2 = 'concluida' THEN now() WHEN $2 = 'pendente' THEN NULL ELSE concluida_em END,
                    cancelada_por = CASE WHEN $2 = 'cancelada' THEN 'usuario' ELSE NULL END,
                    pago_antes = CASE WHEN $2 = 'pendente' THEN false ELSE pago_antes END,
                    atualizada_em = now()
              WHERE id = $1`,
            [id, status],
          )
        } catch (e) {
          // Reabrir uma cancelada cuja vaga a geração já ocupou (mesma rotina e prazo).
          if (codigoPg(e) === VIOLACAO_DE_UNICIDADE) throw new TarefaEmConflito()
          throw e
        }
      }

      let proxima: TarefaCarteira | null = null
      const prazoDaProxima = status === 'concluida' ? proximaDaRecorrencia(t.prazo, t.recorrencia) : null
      if (prazoDaProxima !== null) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO tarefas_internas
             (titulo, descricao, grupo_id, responsavel_usuario_gestao_id, solicitante_usuario_gestao_id,
              cliente_carteira_id, lead_comercial_id, prazo, prioridade, recorrencia, tarefa_origem_id)
           SELECT titulo, descricao, grupo_id, responsavel_usuario_gestao_id, solicitante_usuario_gestao_id,
                  cliente_carteira_id, lead_comercial_id, $2::date, prioridade, recorrencia, id
             FROM tarefas_internas WHERE id = $1
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [id, prazoDaProxima],
        )
        if (r.rows[0]) proxima = await lerTarefa(c, r.rows[0].id, hoje)
      }
      return { tarefa: await lerTarefa(c, id, hoje), proxima }
    })
  }

  /** "Transferir" (R4): o destino precisa enxergar a tarefa (mesmo grupo, ou `geral`). */
  async transferirTarefa(sessao: Sessao, id: string, para: string): Promise<TarefaCarteira> {
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await c.query<{ grupo_id: string | null; responsavel_usuario_gestao_id: string | null }>(
        `SELECT grupo_id, responsavel_usuario_gestao_id FROM tarefas_internas
          WHERE id = $1 AND status = 'pendente' FOR UPDATE`,
        [id],
      )
      const t = atual.rows[0]
      if (!t) throw new TarefaNaoEncontrada()
      await this.conferirResponsavel(c, sessao, t.grupo_id, para)
      if (t.responsavel_usuario_gestao_id !== para) {
        await c.query(
          `UPDATE tarefas_internas
              SET responsavel_usuario_gestao_id = $2, transferida_de_usuario_gestao_id = $3, atualizada_em = now()
            WHERE id = $1`,
          [id, para, t.responsavel_usuario_gestao_id],
        )
      }
      return lerTarefa(c, id, hoje)
    })
  }

  /**
   * Marca um subitem (R5). Com todos marcados, a tarefa se conclui no
   * servidor; desmarcar um item de tarefa concluída a reabre (L2855). A tarefa
   * de frentes do relatório NÃO conclui sozinha (`!t.frentes`, L2856): marcar a
   * frente é dizer que ela chegou, e quem conclui é a pessoa.
   */
  async marcarItem(sessao: Sessao, tarefaId: string, itemId: string, feito: boolean): Promise<TarefaCarteira> {
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const t = await c.query<{ status: string; frentes: boolean | null }>(
        `SELECT t.status, r.frentes FROM tarefas_internas t
           LEFT JOIN rotinas_internas r ON r.id = t.rotina_interna_id
          WHERE t.id = $1 FOR UPDATE OF t`,
        [tarefaId],
      )
      const tarefa = t.rows[0]
      if (!tarefa || tarefa.status === 'cancelada') throw new TarefaNaoEncontrada()
      const r = await c.query(
        `UPDATE itens_de_tarefa_interna
            SET feito = $3,
                feito_em = CASE WHEN $3 THEN coalesce(feito_em, now()) ELSE NULL END,
                feito_por_usuario_gestao_id = CASE WHEN $3 THEN $4::uuid ELSE NULL END
          WHERE id = $2 AND tarefa_interna_id = $1`,
        [tarefaId, itemId, feito, sessao.id],
      )
      if (r.rowCount === 0) throw new ItemNaoEncontrado()
      if (tarefa.frentes !== true) {
        const faltam = await c.query<{ n: string }>(
          'SELECT count(*) FILTER (WHERE NOT feito)::text AS n FROM itens_de_tarefa_interna WHERE tarefa_interna_id = $1',
          [tarefaId],
        )
        const todosFeitos = faltam.rows[0]!.n === '0'
        if (todosFeitos && tarefa.status === 'pendente') {
          await c.query(
            `UPDATE tarefas_internas SET status = 'concluida', concluida_em = now(), atualizada_em = now() WHERE id = $1`,
            [tarefaId],
          )
        } else if (!todosFeitos && tarefa.status === 'concluida') {
          await c.query(
            `UPDATE tarefas_internas SET status = 'pendente', concluida_em = NULL, atualizada_em = now() WHERE id = $1`,
            [tarefaId],
          )
        }
      }
      return lerTarefa(c, tarefaId, hoje)
    })
  }

  /* ──────────────────────────────────────────────────────────────────────
   * EQUIPE, CARGA E REDISTRIBUIR
   * ────────────────────────────────────────────────────────────────────── */

  async equipe(sessao: Sessao): Promise<EquipeDaRotinaSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<{ id: string; nome: string }>(
        // A equipe é a da Firmare, não a de quem opera a ferramenta: a conta de gestão de um
        // superadmin (ADR 0024 — o Operador entra por outro painel) só aparece para o próprio
        // dono dela. Sem isto, "Minhas tarefas" listava como colega a conta de teste do suporte
        // e as duplicatas da dona (2026-11-11: "eu só quero ver o meu time").
        `SELECT u.id, u.nome FROM usuarios_gestao u
          WHERE u.ativo AND ($1::text = 'geral' OR u.grupo_id = $2::uuid)
            AND (u.id = $3::uuid
                 OR NOT EXISTS (SELECT 1 FROM contas_de_gestao_do_operador o WHERE o.usuario_gestao_id = u.id))
          ORDER BY u.nome`,
        [sessao.escopo, sessao.grupoId, sessao.id],
      )
      return { eu: sessao.id, pessoas: r.rows, podeVerCarga: podeVerCarga(sessao) }
    })
  }

  /**
   * A carga da equipe (R7): pessoa × (atrasadas, 4 semanas de segunda a
   * domingo, no fuso da carteira). Gate appsec A-5: carga da equipe é módulo
   * de uso interno da Firmare — só `escopo = 'geral'` até a matriz por escopo
   * ser decidida.
   */
  async carga(sessao: Sessao, pessoa: string | null): Promise<CargaDaEquipeSaida> {
    if (!podeVerCarga(sessao)) throw new SoEscopoGeral()
    const hoje = this.hoje()
    const semanas = semanasDaCarga(hoje)
    const fim = semanas[3]!.fimExclusivo
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const pessoas = await c.query<{ id: string; nome: string }>(
        'SELECT id, nome FROM usuarios_gestao WHERE ativo ORDER BY nome',
      )
      const abertas = await c.query<{ responsavel: string; prazo: string; tipo: TipoDeTarefaInterna; cliente: string | null; cliente_nome: string | null }>(
        `SELECT t.responsavel_usuario_gestao_id AS responsavel, t.prazo::text, ${sqlTipoDaTarefa} AS tipo,
                t.cliente_carteira_id AS cliente, cc.nome AS cliente_nome
           FROM tarefas_internas t
           LEFT JOIN clientes_carteira cc ON cc.id = t.cliente_carteira_id
          WHERE t.status = 'pendente' AND t.responsavel_usuario_gestao_id IS NOT NULL AND t.prazo < $1`,
        [fim],
      )
      const daPessoa = (id: string) =>
        abertas.rows
          .filter((t) => t.responsavel === id)
          .map((t) => ({ prazo: t.prazo, tipo: t.tipo, clienteId: t.cliente }))
      const nomeDoCliente = new Map(abertas.rows.map((t) => [t.cliente, t.cliente_nome]))
      return {
        hoje,
        semanas: semanas.map((s) => ({ inicio: s.inicio, ultimoDia: somarDias(s.fimExclusivo, -1) })),
        pessoas: pessoas.rows.map((p) => {
          const carga = cargaDaPessoa(daPessoa(p.id), hoje)
          return { usuarioGestaoId: p.id, nome: p.nome, atrasadas: carga.atrasadas, semanas: [...carga.semanas] }
        }),
        detalhe:
          pessoa === null || !pessoas.rows.some((p) => p.id === pessoa)
            ? null
            : {
                usuarioGestaoId: pessoa,
                clientes: cargaPorCliente(daPessoa(pessoa), hoje).map((l) => ({
                  clienteCarteiraId: l.clienteId,
                  clienteNome: l.clienteId === null ? null : (nomeDoCliente.get(l.clienteId) ?? null),
                  total: l.total,
                  atrasadas: l.atrasadas,
                  porTipo: l.porTipo,
                })),
              },
      }
    })
  }

  /**
   * Redistribuir (R8, L1848): passa as tarefas abertas de uma pessoa para
   * outra, numa transação, com `transferida_de` e a trilha por tarefa (trigger
   * da 0032). Rotinas nunca se movem aqui.
   *
   * Autorização: o protótipo reserva à diretoria; o gate appsec A-9 cunha a
   * chave `carteira.administrar` para isso (ticket 0.5): `podeVerCarga`.
   *
   * Idempotente por natureza (A-20): a segunda chamada não acha mais nada com
   * o `de` e devolve `movidas: 0`; o estado final é o mesmo.
   */
  async redistribuir(sessao: Sessao, dados: RedistribuirTarefasEntrada): Promise<{ movidas: number }> {
    if (!podeVerCarga(sessao)) throw new SoEscopoGeral()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const destino = await c.query<{ escopo: 'geral' | 'grupo'; grupo_id: string | null; ativo: boolean }>(
        'SELECT escopo, grupo_id, ativo FROM usuarios_gestao WHERE id = $1',
        [dados.paraUsuarioGestaoId],
      )
      const d = destino.rows[0]
      if (!d || !d.ativo) throw new ReferenciaInexistente()
      const abertas = await c.query<{ id: string; grupo_id: string | null; prazo: string; tipo: TipoDeTarefaInterna; cliente: string | null }>(
        `SELECT t.id, t.grupo_id, t.prazo::text, ${sqlTipoDaTarefa} AS tipo, t.cliente_carteira_id AS cliente
           FROM tarefas_internas t
          WHERE t.status = 'pendente' AND t.responsavel_usuario_gestao_id = $1
          FOR UPDATE OF t`,
        [dados.deUsuarioGestaoId],
      )
      const filtro = { tipo: dados.tipo, clienteId: dados.clienteCarteiraId, desde: dados.desde }
      const ids = abertas.rows
        .filter((t) => tarefaEntraNaRedistribuicao({ prazo: t.prazo, tipo: t.tipo, clienteId: t.cliente }, filtro))
        .filter((t) => destinoPodeReceberTarefa(t.grupo_id, { escopo: d.escopo, grupoId: d.grupo_id, ativo: d.ativo }))
        .map((t) => t.id)
      if (ids.length === 0) return { movidas: 0 }
      const r = await c.query(
        `UPDATE tarefas_internas
            SET responsavel_usuario_gestao_id = $2, transferida_de_usuario_gestao_id = $3, atualizada_em = now()
          WHERE id = ANY($1) AND status = 'pendente' AND responsavel_usuario_gestao_id = $3`,
        [ids, dados.paraUsuarioGestaoId, dados.deUsuarioGestaoId],
      )
      return { movidas: r.rowCount ?? 0 }
    })
  }

  /* ──────────────────────────────────────────────────────────────────────
   * ANIVERSÁRIOS (P6) — LGPD A45–A48
   * ────────────────────────────────────────────────────────────────────── */

  /**
   * Hoje e os próximos 7 dias. Só nome, dia/mês e se há como parabenizar —
   * nunca o ano, a idade nem o telefone (A45, A46). Cliente encerrado sai
   * (A48). Equipe: só quem não se opôs (`mostrar_aniversario`, A47), e o
   * `Usuário de Gestão` de grupo vê só a equipe do próprio grupo —
   * `usuarios_gestao` não tem RLS, então este filtro é a fronteira.
   */
  async aniversarios(sessao: Sessao): Promise<AniversarioNaLista[]> {
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const clientesDb = await c.query<{
        id: string
        nome: string
        decisor: string | null
        dia: number
        mes: number
        tem_telefone: boolean
        clinica_id: string | null
        conta_na_receita: boolean
      }>(
        `SELECT id, nome, decisor, aniversario_decisor_dia AS dia, aniversario_decisor_mes AS mes,
                (telefone IS NOT NULL) AS tem_telefone, clinica_id, conta_na_receita
           FROM clientes_carteira
          WHERE excluido_em IS NULL AND status <> 'encerrado' AND aniversario_decisor_dia IS NOT NULL`,
      )
      // A clínica em 2+ grupos tem um cliente por grupo: o decisor é o mesmo, parabeniza-se uma vez.
      const clientes = { rows: umPorClinica(clientesDb.rows) }
      const equipe = await c.query<{ id: string; nome: string; dia: number; mes: number }>(
        `SELECT id, nome, aniversario_dia AS dia, aniversario_mes AS mes FROM usuarios_gestao
          WHERE ativo AND mostrar_aniversario AND aniversario_dia IS NOT NULL
            AND ($1::text = 'geral' OR grupo_id = $2::uuid)`,
        [sessao.escopo, sessao.grupoId],
      )
      const pessoas = [
        ...equipe.rows.map((p) => ({ tipo: 'equipe' as const, id: p.id, nome: p.nome, sub: 'Equipe Firmare', dia: p.dia, mes: p.mes, podeParabenizar: false })),
        ...clientes.rows.map((p) => ({ tipo: 'cliente' as const, id: p.id, nome: p.decisor ?? p.nome, sub: p.nome, dia: p.dia, mes: p.mes, podeParabenizar: p.tem_telefone })),
      ]
      return aniversariosProximos(pessoas, hoje, 7)
    })
  }

  /**
   * O link do "Parabenizar", montado só no clique (A45): o telefone nunca vai
   * numa lista. A mensagem não tem idade (A46). A equipe Firmare ainda não tem
   * telefone cadastrado (`usuarios_gestao.telefone` é do ticket 0.5).
   */
  async parabenizar(sessao: Sessao, tipo: 'cliente' | 'equipe', id: string): Promise<string> {
    if (tipo === 'equipe') throw new SemTelefone()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<{ nome: string; decisor: string | null; telefone: string | null }>(
        `SELECT nome, decisor, telefone FROM clientes_carteira
          WHERE id = $1 AND excluido_em IS NULL AND status <> 'encerrado' AND aniversario_decisor_dia IS NOT NULL`,
        [id],
      )
      const cliente = r.rows[0]
      if (!cliente) throw new ReferenciaInexistente()
      const link = linkDoWhatsApp(cliente.telefone)
      if (link === null) throw new SemTelefone()
      return `${link}?text=${encodeURIComponent(mensagemDeAniversario('cliente', cliente.decisor ?? cliente.nome))}`
    })
  }

  async meuAniversario(sessao: Sessao): Promise<MeuAniversarioSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<{ dia: number | null; mes: number | null; mostrar: boolean }>(
        'SELECT aniversario_dia AS dia, aniversario_mes AS mes, mostrar_aniversario AS mostrar FROM usuarios_gestao WHERE id = $1',
        [sessao.id],
      )
      return r.rows[0] ?? { dia: null, mes: null, mostrar: true }
    })
  }

  /** A própria pessoa grava — a função do banco resolve QUEM pela sessão, nunca por parâmetro. */
  async definirMeuAniversario(sessao: Sessao, dados: DefinirMeuAniversarioEntrada): Promise<MeuAniversarioSaida> {
    await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, (c) =>
      c.query('SELECT definir_meu_aniversario($1::smallint, $2::smallint, $3)', [dados.dia, dados.mes, dados.mostrar]),
    )
    return this.meuAniversario(sessao)
  }

  /* ──────────────────────────────────────────────────────────────────────
   * CHECKIN INTERNO (G5, inalterado)
   * ────────────────────────────────────────────────────────────────────── */

  async listarCheckins(sessao: Sessao, clienteCarteiraId: string): Promise<CheckinInternoNaLista[]> {
    const r = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, (c) =>
      c.query<LinhaCheckin>(
        `SELECT ${colunasCheckin} FROM checkins_internos
          WHERE cliente_carteira_id = $1 ORDER BY semana DESC`,
        [clienteCarteiraId],
      ),
    )
    return r.rows.map(checkinParaContrato)
  }

  /**
   * Cria OU atualiza o checkin da semana CORRENTE (`UNIQUE (cliente, semana)`)
   * — a `semana` é sempre calculada pelo SERVIDOR (regra 24).
   */
  async registrarCheckin(
    sessao: Sessao,
    fuso: string,
    dados: RegistrarCheckinInternoEntrada,
  ): Promise<CheckinInternoNaLista> {
    const semana = semanaAtual(this.relogio.agora(), fuso)

    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await c.query<{ grupo_id: string | null }>(
        `SELECT grupo_id FROM clientes_carteira WHERE id = $1`,
        [dados.clienteCarteiraId],
      )
      if (!cliente.rows[0]) throw new ReferenciaInexistente()

      const r = await c.query<LinhaCheckin>(
        `INSERT INTO checkins_internos
           (cliente_carteira_id, grupo_id, semana, nota, saude, por_usuario_gestao_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (cliente_carteira_id, semana)
         DO UPDATE SET nota = EXCLUDED.nota, saude = EXCLUDED.saude,
                       por_usuario_gestao_id = EXCLUDED.por_usuario_gestao_id,
                       atualizado_em = now()
         RETURNING ${colunasCheckin}`,
        [dados.clienteCarteiraId, cliente.rows[0].grupo_id, semana, dados.nota, dados.saude, sessao.id],
      )
      return checkinParaContrato(r.rows[0]!)
    })
  }

  /** Edita um checkin JÁ EXISTENTE — só da semana corrente (spec §7, critério 7). */
  async atualizarCheckin(
    sessao: Sessao,
    fuso: string,
    checkinId: string,
    dados: { nota: string; saude: CheckinInternoNaLista['saude'] },
  ): Promise<CheckinInternoNaLista> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await c.query<LinhaCheckin>(
        `SELECT ${colunasCheckin} FROM checkins_internos WHERE id = $1`,
        [checkinId],
      )
      const checkin = atual.rows[0]
      if (!checkin) throw new ReferenciaInexistente()
      if (!podeEditarCheckinDaSemana(checkin.semana, this.relogio.agora(), fuso)) {
        throw new CheckinForaDaSemana()
      }

      const r = await c.query<LinhaCheckin>(
        `UPDATE checkins_internos
            SET nota = $2, saude = $3, por_usuario_gestao_id = $4, atualizado_em = now()
          WHERE id = $1
          RETURNING ${colunasCheckin}`,
        [checkinId, dados.nota, dados.saude, sessao.id],
      )
      return checkinParaContrato(r.rows[0]!)
    })
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Conferências comuns
   * ────────────────────────────────────────────────────────────────────── */

  /**
   * O responsável (ou solicitante, ou destino) pode ficar com algo do grupo
   * `grupoId`? As duas regras: a de G5 (`validarResponsavelDoMesmoGrupo`,
   * para quem é de grupo) e a de visibilidade (`destinoPodeReceberTarefa`,
   * para todo mundo — inclusive o `geral`, que poderia entregar uma tarefa a
   * quem a RLS nem deixa ler).
   */
  private async conferirResponsavel(c: pg.PoolClient, sessao: Sessao, grupoId: string | null, usuarioId: string): Promise<void> {
    const grupoDoResponsavel = await grupoDeUsuarioDeGestao(c, usuarioId)
    const v = validarResponsavelDoMesmoGrupo(sessao, grupoId, usuarioId, grupoDoResponsavel)
    if (ehErro(v)) throw new ResponsavelDeOutroGrupo(v.erro.mensagem)
    const u = await c.query<{ escopo: 'geral' | 'grupo'; grupo_id: string | null; ativo: boolean }>(
      'SELECT escopo, grupo_id, ativo FROM usuarios_gestao WHERE id = $1',
      [usuarioId],
    )
    const destino = u.rows[0]
    if (!destino) throw new ReferenciaInexistente()
    if (!destinoPodeReceberTarefa(grupoId, { escopo: destino.escopo, grupoId: destino.grupo_id, ativo: destino.ativo })) {
      throw new ResponsavelDeOutroGrupo('Esta pessoa não pode receber esta tarefa.')
    }
  }

  /**
   * O grupo da tarefa. Cliente e lead referenciados passam por um `SELECT`
   * sob a mesma RLS — a FK do Postgres ignora RLS, e sem isso o grupo A
   * apontaria para o cliente do grupo B (achado de IDOR do G5). Para quem é
   * `geral`, a tarefa de um cliente fica no grupo do cliente: senão a equipe
   * do grupo nunca a veria.
   */
  private async grupoDaTarefa(
    c: pg.PoolClient,
    sessao: Sessao,
    grupoDaSessao: string | null,
    dados: { clienteCarteiraId: string | null; leadComercialId: string | null },
  ): Promise<string | null> {
    let grupoDoCliente: string | null = null
    if (dados.clienteCarteiraId !== null) {
      const cliente = await c.query<{ grupo_id: string }>('SELECT grupo_id FROM clientes_carteira WHERE id = $1', [
        dados.clienteCarteiraId,
      ])
      if (!cliente.rows[0]) throw new ReferenciaInexistente()
      grupoDoCliente = cliente.rows[0].grupo_id
    }
    if (dados.leadComercialId !== null) {
      const lead = await c.query('SELECT 1 FROM leads_comerciais WHERE id = $1', [dados.leadComercialId])
      if (!lead.rows[0]) throw new ReferenciaInexistente()
    }
    return sessao.escopo === 'geral' ? grupoDoCliente : grupoDaSessao
  }
}

/** Carga e redistribuir: `escopo = 'geral'` (A-5) E `carteira.administrar` (A-9, ticket 0.5). */
const podeVerCarga = (sessao: Sessao): boolean =>
  sessao.escopo === 'geral' && temPermCarteira(sessao, 'carteira.administrar')

/* ────────────────────────────────────────────────────────────────────────
 * Geração — compartilhada pelo job e pelo salvar
 * ──────────────────────────────────────────────────────────────────────── */

type LinhaClienteParaRotina = {
  id: string
  nome: string
  grupo_id: string
  status: ClienteParaRotina['status']
  inicio: string | null
  reunioes_inicio: string | null
  reuniao_dia_semana: number | null
  dia_vencimento: number | null
  tem_mensalidade: boolean
  clinica_id: string | null
  conta_na_receita: boolean
  servicos: string[]
  tem_meta: boolean
  responsavel_usuario_gestao_id: string | null
}

/**
 * Os clientes que a geração enxerga, sob a RLS da conexão. Só o FATO de ter
 * mensalidade (`> 0`) sai daqui, nunca o valor. O início é o do contrato ou,
 * sem ele, o dia (no fuso da carteira) em que o cliente foi criado.
 */
async function carregarClientesParaRotina(
  c: pg.PoolClient,
): Promise<(ClienteParaRotina & { grupoId: string } & LinhaDeClinica)[]> {
  const r = await c.query<LinhaClienteParaRotina>(
    `SELECT cc.id, cc.nome, cc.grupo_id, cc.status,
            coalesce(cc.data_inicio, (cc.criado_em AT TIME ZONE $1)::date)::text AS inicio,
            cc.reunioes_inicio::text, cc.reuniao_dia_semana, cc.dia_vencimento,
            (cc.mensalidade_centavos > 0) AS tem_mensalidade, cc.servicos, cc.clinica_id, cc.conta_na_receita,
            EXISTS (SELECT 1 FROM metas_comerciais m
                     WHERE m.cliente_carteira_id = cc.id AND m.status = 'em_andamento'
                       AND m.excluido_em IS NULL AND m.fonte = 'lancamento') AS tem_meta,
            cc.responsavel_usuario_gestao_id
       FROM clientes_carteira cc
      WHERE cc.excluido_em IS NULL AND cc.status IN ('ativo', 'onboarding')
      ORDER BY cc.nome, cc.id`,
    [FUSO_DA_CARTEIRA],
  )
  return r.rows.map((x) => ({
    id: x.id,
    grupoId: x.grupo_id,
    nome: x.nome,
    status: x.status,
    inicio: x.inicio,
    reunioesInicio: x.reunioes_inicio,
    reuniaoDiaSemana: x.reuniao_dia_semana,
    diaVencimento: x.dia_vencimento,
    temMensalidade: x.tem_mensalidade,
    servicos: x.servicos,
    temMetaEmAndamento: x.tem_meta,
    responsavelId: x.responsavel_usuario_gestao_id,
    clinica_id: x.clinica_id,
    conta_na_receita: x.conta_na_receita,
  }))
}

/** A rotina de um grupo alcança só os clientes dele; a da Firmare (grupo NULL), todos. */
// A da Firmare vê a clínica em 2+ grupos uma vez só (0068): o trabalho é da clínica, não de cada cópia.
const clientesDaRotina = <C extends { grupoId: string } & LinhaDeClinica>(r: { grupo_id: string | null }, clientes: readonly C[]): C[] =>
  r.grupo_id === null ? umPorClinica(clientes) : clientes.filter((x) => x.grupoId === r.grupo_id)

async function gerarParaRotinas(c: pg.PoolClient, rotinas: readonly LinhaRotina[], hoje: string): Promise<number> {
  let geradas = 0
  if (rotinas.length > 0) {
    const clientes = await carregarClientesParaRotina(c)
    const grupoDoCliente = new Map(clientes.map((x) => [x.id, x.grupoId]))
    for (const rotina of rotinas) {
      const planejadas = planejarTarefasDaRotina(rotinaParaPlanejar(rotina), clientesDaRotina(rotina, clientes), hoje)
      for (const t of planejadas) {
        const grupoId = t.clienteId === null ? rotina.grupo_id : (grupoDoCliente.get(t.clienteId) ?? null)
        // A chave explícita de cada forma, e a regra 27: a tarefa que a EQUIPE
        // cancelou (`cancelada_por` 'usuario', ou NULL das linhas antigas) não
        // renasce. A cancelada pela edição da rotina não conta — é ela que a
        // geração refaz.
        const r = await c.query<{ id: string }>(
          `INSERT INTO tarefas_internas
             (titulo, descricao, grupo_id, responsavel_usuario_gestao_id, cliente_carteira_id, prazo,
              prioridade, rotina_interna_id, vencimento, competencia, mensagem)
           SELECT $1::text, $2::text, $3::uuid, $4::uuid, $5::uuid, $6::date, $7::text, $8::uuid, $9::date, $10::date, $11::text
            WHERE NOT EXISTS (
              SELECT 1 FROM tarefas_internas x
               WHERE x.rotina_interna_id = $8 AND x.status = 'cancelada'
                 AND coalesce(x.cancelada_por, 'usuario') = 'usuario'
                 AND x.cliente_carteira_id IS NOT DISTINCT FROM $5::uuid
                 AND (CASE WHEN $10::date IS NOT NULL THEN x.competencia = $10::date ELSE x.prazo = $6::date END))
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            rotina.titulo,
            rotina.passos.length > 0 ? rotina.passos.join('\n') : null,
            grupoId,
            t.responsavelId,
            t.clienteId,
            t.prazo,
            rotina.prioridade,
            rotina.id,
            t.vencimento,
            t.competencia,
            rotina.mensagem,
          ],
        )
        const tarefaId = r.rows[0]?.id
        if (tarefaId === undefined) continue
        geradas++
        // Os itens nascem só com a tarefa que acabou de nascer: a idempotência
        // da tarefa é a dos itens.
        for (const [i, item] of t.itens.entries()) {
          await c.query(
            `INSERT INTO itens_de_tarefa_interna (tarefa_interna_id, ordem, rotulo, cliente_carteira_id, frente)
             VALUES ($1, $2, $3, $4, $5)`,
            [tarefaId, i + 1, item.rotulo, item.clienteId, item.frente],
          )
        }
      }
    }
  }
  await baixarLembretesPagos(c)
  return geradas
}

/**
 * R14 (`baixarPagos`, L704): o lembrete de mensalidade aberto cuja cobrança
 * DAQUELA competência já está paga se conclui sozinho, com `pago_antes`. A
 * competência é a do vencimento (ajuste 38), a mesma chave da cobrança.
 */
async function baixarLembretesPagos(c: pg.PoolClient): Promise<number> {
  const r = await c.query(
    `UPDATE tarefas_internas t
        SET status = 'concluida', concluida_em = cb.pago_em, pago_antes = true, atualizada_em = now()
       FROM cobrancas_do_cliente_firmare cb
      WHERE t.mensagem = 'pagamento' AND t.status = 'pendente' AND t.competencia IS NOT NULL
        AND cb.cliente_carteira_id = t.cliente_carteira_id AND cb.competencia = t.competencia
        AND cb.status = 'pago'`,
  )
  return r.rowCount ?? 0
}

/* ────────────────────────────────────────────────────────────────────────
 * Linhas cruas ↔ contrato. Um ponto só por entidade.
 *
 * Os `as` de texto para união (frequência, status, …) descrevem para o
 * TypeScript o que o CHECK da coluna (0032, 0051) já garante no banco.
 * ──────────────────────────────────────────────────────────────────────── */

type LinhaRotina = {
  id: string
  titulo: string
  grupo_id: string | null
  responsavel_usuario_gestao_id: string | null
  responsavel_nome: string | null
  frequencia: string
  escopo_aplicacao: string
  passos: string[]
  ativa: boolean
  inicio: string
  prioridade: string
  dia_semana: number | null
  dia_util: number | null
  antecedencia: number | null
  servico: string | null
  quem_executa: string
  mensagem: string | null
  frentes: boolean
  envio: boolean
}
const colunasRotina =
  'r.id, r.titulo, r.grupo_id, r.responsavel_usuario_gestao_id, u.nome AS responsavel_nome, r.frequencia, ' +
  'r.escopo_aplicacao, r.passos, r.ativa, r.inicio::text, r.prioridade, r.dia_semana, r.dia_util, ' +
  'r.antecedencia, r.servico, r.quem_executa, r.mensagem, r.frentes, r.envio'

const rotinaParaPlanejar = (r: LinhaRotina): RotinaParaPlanejar => ({
  id: r.id,
  frequencia: r.frequencia as RotinaParaPlanejar['frequencia'],
  escopoAplicacao: r.escopo_aplicacao as RotinaParaPlanejar['escopoAplicacao'],
  diaSemana: r.dia_semana,
  diaUtil: r.dia_util,
  antecedencia: r.antecedencia,
  servico: r.servico as RotinaParaPlanejar['servico'],
  quemExecuta: r.quem_executa as RotinaParaPlanejar['quemExecuta'],
  responsavelId: r.responsavel_usuario_gestao_id,
  inicio: r.inicio,
  frentes: r.frentes,
  envio: r.envio,
})

const rotinaParaContrato = (
  r: LinhaRotina,
  calculado: Pick<RotinaCarteira, 'textoFrequencia' | 'proxima' | 'noPrazo' | 'clientesQueSeAplicam'>,
): RotinaCarteira => ({
  id: r.id,
  titulo: r.titulo,
  grupoId: r.grupo_id,
  responsavelUsuarioGestaoId: r.responsavel_usuario_gestao_id,
  responsavelNome: r.responsavel_nome,
  prioridade: r.prioridade as RotinaCarteira['prioridade'],
  frequencia: r.frequencia as RotinaCarteira['frequencia'],
  diaSemana: r.dia_semana,
  diaUtil: r.dia_util,
  antecedencia: r.antecedencia,
  escopoAplicacao: r.escopo_aplicacao as RotinaCarteira['escopoAplicacao'],
  servico: r.servico as RotinaCarteira['servico'],
  quemExecuta: r.quem_executa as RotinaCarteira['quemExecuta'],
  mensagem: r.mensagem as RotinaCarteira['mensagem'],
  frentes: r.frentes,
  envio: r.envio,
  passos: r.passos,
  ativa: r.ativa,
  inicio: r.inicio,
  ...calculado,
})

/**
 * A origem da tarefa (`tipoTarefa`, L1823): checklist do contrato (2C, 0053),
 * rotina, encaminhamento de reunião (1B, 0048) ou avulsa.
 */
const sqlTipoDaTarefa = `CASE
    WHEN EXISTS (SELECT 1 FROM checklist_do_cliente k WHERE k.tarefa_interna_id = t.id) THEN 'checklist'
    WHEN t.rotina_interna_id IS NOT NULL THEN 'rotina'
    WHEN EXISTS (SELECT 1 FROM encaminhamentos_de_reuniao e WHERE e.tarefa_interna_id = t.id) THEN 'reuniao'
    ELSE 'avulsa' END`

type LinhaTarefa = {
  id: string
  titulo: string
  descricao: string | null
  grupo_id: string | null
  responsavel_usuario_gestao_id: string | null
  responsavel_nome: string | null
  solicitante_usuario_gestao_id: string | null
  cliente_carteira_id: string | null
  cliente_nome: string | null
  lead_comercial_id: string | null
  prazo: string
  prioridade: string
  status: string
  concluida_em: Date | null
  rotina_interna_id: string | null
  recorrencia: string
  tipo: TipoDeTarefaInterna
  vencimento: string | null
  competencia: string | null
  mensagem: string | null
  pago_antes: boolean
  transferida_de_usuario_gestao_id: string | null
}
const colunasTarefa =
  't.id, t.titulo, t.descricao, t.grupo_id, t.responsavel_usuario_gestao_id, u.nome AS responsavel_nome, ' +
  't.solicitante_usuario_gestao_id, t.cliente_carteira_id, cc.nome AS cliente_nome, t.lead_comercial_id, ' +
  't.prazo::text, t.prioridade, t.status, t.concluida_em, t.rotina_interna_id, t.recorrencia, ' +
  `${sqlTipoDaTarefa} AS tipo, t.vencimento::text, t.competencia::text, t.mensagem, t.pago_antes, ` +
  't.transferida_de_usuario_gestao_id'
const deTarefa = `FROM tarefas_internas t
    LEFT JOIN usuarios_gestao u ON u.id = t.responsavel_usuario_gestao_id
    LEFT JOIN clientes_carteira cc ON cc.id = t.cliente_carteira_id`

async function carregarItens(c: pg.PoolClient, ids: readonly string[]): Promise<Map<string, ItemDaTarefaCarteira[]>> {
  const mapa = new Map<string, ItemDaTarefaCarteira[]>()
  if (ids.length === 0) return mapa
  const r = await c.query<{ id: string; tarefa_interna_id: string; rotulo: string; cliente_carteira_id: string | null; frente: string | null; feito: boolean }>(
    `SELECT id, tarefa_interna_id, rotulo, cliente_carteira_id, frente, feito
       FROM itens_de_tarefa_interna WHERE tarefa_interna_id = ANY($1) ORDER BY ordem`,
    [ids],
  )
  for (const i of r.rows) {
    const l = mapa.get(i.tarefa_interna_id) ?? []
    l.push({
      id: i.id,
      rotulo: i.rotulo,
      clienteCarteiraId: i.cliente_carteira_id,
      frente: i.frente as ItemDaTarefaCarteira['frente'],
      feito: i.feito,
    })
    mapa.set(i.tarefa_interna_id, l)
  }
  return mapa
}

async function lerTarefa(c: pg.PoolClient, id: string, hoje: string): Promise<TarefaCarteira> {
  const r = await c.query<LinhaTarefa>(`SELECT ${colunasTarefa} ${deTarefa} WHERE t.id = $1`, [id])
  const t = r.rows[0]
  if (!t) throw new TarefaNaoEncontrada()
  return tarefaParaContrato(t, await carregarItens(c, [id]), hoje)
}

const tarefaParaContrato = (t: LinhaTarefa, itens: Map<string, ItemDaTarefaCarteira[]>, hoje: string): TarefaCarteira => ({
  id: t.id,
  titulo: t.titulo,
  descricao: t.descricao,
  grupoId: t.grupo_id,
  responsavelUsuarioGestaoId: t.responsavel_usuario_gestao_id,
  responsavelNome: t.responsavel_nome,
  solicitanteUsuarioGestaoId: t.solicitante_usuario_gestao_id,
  clienteCarteiraId: t.cliente_carteira_id,
  clienteNome: t.cliente_nome,
  leadComercialId: t.lead_comercial_id,
  prazo: t.prazo,
  prioridade: t.prioridade as TarefaCarteira['prioridade'],
  status: t.status as TarefaCarteira['status'],
  concluidaEm: t.concluida_em?.toISOString() ?? null,
  rotinaInternaId: t.rotina_interna_id,
  recorrencia: t.recorrencia as TarefaCarteira['recorrencia'],
  tipo: t.tipo,
  secao: t.status === 'pendente' ? secaoDaTarefa(t.prazo, hoje) : null,
  vencimento: t.vencimento,
  competencia: t.competencia,
  mensagem: t.mensagem as TarefaCarteira['mensagem'],
  pagoAntes: t.pago_antes,
  transferidaDeUsuarioGestaoId: t.transferida_de_usuario_gestao_id,
  itens: itens.get(t.id) ?? [],
})

type LinhaCheckin = {
  id: string
  cliente_carteira_id: string
  semana: string
  nota: string
  saude: string
  por_usuario_gestao_id: string
  rotina_interna_id: string | null
}
const colunasCheckin =
  'id, cliente_carteira_id, semana, nota, saude, por_usuario_gestao_id, rotina_interna_id'
const checkinParaContrato = (c: LinhaCheckin): CheckinInternoNaLista => ({
  id: c.id,
  clienteCarteiraId: c.cliente_carteira_id,
  semana: c.semana,
  nota: c.nota,
  saude: c.saude as CheckinInternoNaLista['saude'],
  porUsuarioGestaoId: c.por_usuario_gestao_id,
  rotinaInternaId: c.rotina_interna_id,
})
