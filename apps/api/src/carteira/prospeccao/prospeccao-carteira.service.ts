import type {
  CheckinInternoNaLista,
  CriarInteracaoDoLeadEntrada,
  CriarLeadEntrada,
  CriarRotinaInternaEntrada,
  CriarTarefaInternaEntrada,
  InteracaoDoLeadNaLista,
  LeadComercialNaLista,
  RegistrarCheckinInternoEntrada,
  RotinaInternaNaLista,
  TarefaInternaNaLista,
  UsuarioDeGestaoPublico,
} from '@fir/contracts'
import {
  ehErro,
  podeEditarCheckinDaSemana,
  proximoPrazoDaRotina,
  resolverGrupoDeEscrita,
  semanaAtual,
  validarResponsavelDoMesmoGrupo,
  validarTransicaoDeEtapa,
  type EtapaDoLead,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'

const FK_VIOLADA = '23503'

export class GrupoCruzado extends Error {}
export class ResponsavelDeOutroGrupo extends Error {}
export class LeadNaoEncontrado extends Error {}
export class TransicaoDeEtapaInvalida extends Error {
  constructor(public readonly codigo: string, message: string) {
    super(message)
  }
}
export class LeadJaArquivado extends Error {}
export class LeadConvertidoNaoArquiva extends Error {}
export class TarefaNaoEncontrada extends Error {}
export class CheckinForaDaSemana extends Error {}
export class ReferenciaInexistente extends Error {}

type Sessao = UsuarioDeGestaoPublico

/**
 * G5 — funil de prospecção e rotina interna. ADR 0016.
 *
 * Toda escrita abaixo roda em `banco.nasTabelasDaCarteiraComoUsuarioDeGestao`
 * — a RLS (`app_pode_ver_grupo`) é a SEGUNDA camada; a PRIMEIRA é
 * `resolverGrupoDeEscrita`/`validarResponsavelDoMesmoGrupo`
 * (`packages/domain`), chamada aqui ANTES de qualquer `INSERT`/`UPDATE` —
 * exatamente o achado crítico do ADR 0016 item 2: `grupoId` e
 * `responsavelUsuarioGestaoId` nunca atravessam crus do corpo da requisição.
 */
@Injectable()
export class ProspeccaoCarteiraService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /* ──────────────────────────────────────────────────────────────────────
   * LEAD COMERCIAL
   * ────────────────────────────────────────────────────────────────────── */

  async listarLeads(sessao: Sessao): Promise<LeadComercialNaLista[]> {
    const r = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, (c) =>
      c.query<LinhaLead>(
        `SELECT ${colunasLead} FROM leads_comerciais
          WHERE arquivado_em IS NULL
          ORDER BY criado_em DESC`,
      ),
    )
    return r.rows.map(leadParaContrato)
  }

  async criarLead(sessao: Sessao, dados: CriarLeadEntrada): Promise<LeadComercialNaLista> {
    const resolucao = resolverGrupoDeEscrita(sessao, dados.grupoIdDeExpansao ?? null)
    if (ehErro(resolucao)) throw new GrupoCruzado(resolucao.erro.mensagem)
    const grupoId = resolucao.valor

    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const grupoDoResponsavel = await grupoDeUsuarioDeGestao(c, dados.responsavelUsuarioGestaoId ?? null)
      const validacao = validarResponsavelDoMesmoGrupo(
        sessao,
        grupoId,
        dados.responsavelUsuarioGestaoId ?? null,
        grupoDoResponsavel,
      )
      if (ehErro(validacao)) throw new ResponsavelDeOutroGrupo(validacao.erro.mensagem)

      // `responsavelUsuarioGestaoId` é FK — `grupoDeUsuarioDeGestao` acima já
      // confere o grupo quando o usuário EXISTE, mas quando ele aponta para
      // um id inexistente (e `grupoId` é `null`, caso em que
      // `validarResponsavelDoMesmoGrupo` não tem o que recusar) o `INSERT`
      // abaixo é quem primeiro vê o erro — e sem este `catch` ele vaza como
      // FK crua (500) em vez de 400 (mesmo padrão de `criarTarefa`, abaixo).
      let r: pg.QueryResult<LinhaLead>
      try {
        r = await c.query<LinhaLead>(
          `INSERT INTO leads_comerciais
             (nome, grupo_id, responsavel_usuario_gestao_id, origem, temperatura,
              produto_interesse, proximo_contato)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING ${colunasLead}`,
          [
            dados.nome,
            grupoId,
            dados.responsavelUsuarioGestaoId ?? null,
            dados.origem,
            dados.temperatura,
            dados.produtoInteresse ?? null,
            dados.proximoContato ?? null,
          ],
        )
      } catch (e) {
        if ((e as { code?: string }).code === FK_VIOLADA) throw new ReferenciaInexistente()
        throw e
      }
      return leadParaContrato(r.rows[0]!)
    })
  }

  /**
   * Avança a etapa do lead — e fecha o funil quando `etapa = 'ganho'`.
   *
   * Idempotente (critério de aceite 2 do spec): se o lead JÁ está `ganho`
   * (mesma requisição em dobro), devolve o `Cliente Firmare` já criado, sem
   * criar uma segunda linha — nunca um erro para o retry inofensivo.
   */
  async avancarEtapa(
    sessao: Sessao,
    leadId: string,
    etapa: EtapaDoLead,
    motivoPerda: string | null,
    proximoContato: string | null | undefined,
  ): Promise<LeadComercialNaLista> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await c.query<LinhaLead>(`SELECT ${colunasLead} FROM leads_comerciais WHERE id = $1`, [
        leadId,
      ])
      const lead = atual.rows[0]
      if (!lead) throw new LeadNaoEncontrado()

      // Idempotência: pedir "ganho" de novo para um lead já ganho não é erro.
      if (lead.etapa === etapa && etapa === 'ganho') return leadParaContrato(lead)

      // `as EtapaDoLead`: seguro porque o `CHECK` de `leads_comerciais.etapa`
      // (migration 0032) já restringe a coluna à mesma união do domínio.
      const validacao = validarTransicaoDeEtapa(lead.etapa as EtapaDoLead, etapa, motivoPerda)
      if (ehErro(validacao)) throw new TransicaoDeEtapaInvalida(validacao.erro.codigo, validacao.erro.mensagem)

      if (etapa === 'ganho') {
        let cliente: { id: string }
        try {
          const rc = await c.query<{ id: string }>(
            `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status)
             VALUES ($1, NULL, $2, 'A definir no onboarding', 'onboarding')
             RETURNING id`,
            [lead.grupo_id, lead.nome],
          )
          cliente = rc.rows[0]!
        } catch (e) {
          if ((e as { code?: string }).code === FK_VIOLADA) throw new ReferenciaInexistente()
          throw e
        }
        const r = await c.query<LinhaLead>(
          `UPDATE leads_comerciais
              SET etapa = 'ganho', cliente_carteira_id = $2, fechado_em = now()
            WHERE id = $1
            RETURNING ${colunasLead}`,
          [leadId, cliente.id],
        )
        return leadParaContrato(r.rows[0]!)
      }

      const r = await c.query<LinhaLead>(
        `UPDATE leads_comerciais
            SET etapa = $2,
                motivo_perda = CASE WHEN $2 = 'perdido' THEN $3 ELSE motivo_perda END,
                fechado_em = CASE WHEN $2 = 'perdido' THEN now() ELSE fechado_em END,
                proximo_contato = COALESCE($4, proximo_contato)
          WHERE id = $1
          RETURNING ${colunasLead}`,
        [leadId, etapa, motivoPerda, proximoContato ?? null],
      )
      return leadParaContrato(r.rows[0]!)
    })
  }

  /**
   * "Excluir" na tela é "Arquivar" — nunca `DELETE` (regra 20/27). Um lead
   * já convertido (tem `cliente_carteira_id`) nunca é arquivado (spec §6.3,
   * critério de aceite 4) — o `CHECK leads_nao_arquiva_convertido` já recusa
   * no banco; aqui a recusa vem ANTES, com mensagem clara.
   */
  async arquivarLead(sessao: Sessao, leadId: string): Promise<LeadComercialNaLista> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await c.query<LinhaLead>(`SELECT ${colunasLead} FROM leads_comerciais WHERE id = $1`, [
        leadId,
      ])
      const lead = atual.rows[0]
      if (!lead) throw new LeadNaoEncontrado()
      if (lead.cliente_carteira_id !== null) throw new LeadConvertidoNaoArquiva()
      if (lead.arquivado_em !== null) return leadParaContrato(lead)

      const r = await c.query<LinhaLead>(
        `UPDATE leads_comerciais SET arquivado_em = now() WHERE id = $1 RETURNING ${colunasLead}`,
        [leadId],
      )
      return leadParaContrato(r.rows[0]!)
    })
  }

  /* ──────────────────────────────────────────────────────────────────────
   * INTERAÇÃO DO LEAD — append-only
   * ────────────────────────────────────────────────────────────────────── */

  async listarInteracoes(sessao: Sessao, leadId: string): Promise<InteracaoDoLeadNaLista[]> {
    const r = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, (c) =>
      c.query<LinhaInteracao>(
        `SELECT id, lead_comercial_id, quando, canal, nota, por_usuario_gestao_id
           FROM interacoes_do_lead WHERE lead_comercial_id = $1 ORDER BY quando DESC`,
        [leadId],
      ),
    )
    return r.rows.map(interacaoParaContrato)
  }

  async criarInteracao(
    sessao: Sessao,
    leadId: string,
    dados: CriarInteracaoDoLeadEntrada,
  ): Promise<InteracaoDoLeadNaLista> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const lead = await c.query<{ grupo_id: string | null }>(
        `SELECT grupo_id FROM leads_comerciais WHERE id = $1`,
        [leadId],
      )
      if (lead.rows[0] === undefined) throw new LeadNaoEncontrado()

      const r = await c.query<LinhaInteracao>(
        `INSERT INTO interacoes_do_lead (lead_comercial_id, grupo_id, canal, nota, por_usuario_gestao_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, lead_comercial_id, quando, canal, nota, por_usuario_gestao_id`,
        [leadId, lead.rows[0]!.grupo_id, dados.canal, dados.nota, sessao.id],
      )
      return interacaoParaContrato(r.rows[0]!)
    })
  }

  /* ──────────────────────────────────────────────────────────────────────
   * ROTINA INTERNA / TAREFA INTERNA
   * ────────────────────────────────────────────────────────────────────── */

  async listarRotinas(sessao: Sessao): Promise<RotinaInternaNaLista[]> {
    const r = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, (c) =>
      c.query<LinhaRotina>(`SELECT ${colunasRotina} FROM rotinas_internas ORDER BY titulo`),
    )
    return r.rows.map(rotinaParaContrato)
  }

  async criarRotina(sessao: Sessao, dados: CriarRotinaInternaEntrada): Promise<RotinaInternaNaLista> {
    // Rotina interna não recebe grupoId de expansão: ela nasce ou "da própria
    // Firmare" (grupo_id NULL, só quem tem escopo='geral' decide isso
    // implicitamente por ser quem cria sem contexto de grupo) ou do grupo da
    // própria sessão — nunca de um valor cru do corpo (mesma regra do lead).
    const resolucao = resolverGrupoDeEscrita(sessao, null)
    if (ehErro(resolucao)) throw new GrupoCruzado(resolucao.erro.mensagem)
    const grupoId = sessao.escopo === 'geral' ? null : resolucao.valor

    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const grupoDoResponsavel = await grupoDeUsuarioDeGestao(c, dados.responsavelUsuarioGestaoId ?? null)
      const validacao = validarResponsavelDoMesmoGrupo(
        sessao,
        grupoId,
        dados.responsavelUsuarioGestaoId ?? null,
        grupoDoResponsavel,
      )
      if (ehErro(validacao)) throw new ResponsavelDeOutroGrupo(validacao.erro.mensagem)

      // Mesmo caso de `criarLead`, acentuado aqui: quando `grupoId` é `null`
      // (rotina geral/global), `validarResponsavelDoMesmoGrupo` não tem grupo
      // nenhum para comparar e deixa passar um `responsavelUsuarioGestaoId`
      // inexistente — é o `INSERT` abaixo que recusa, e sem este `catch` a
      // recusa vaza como FK crua (500) em vez de 400.
      let r: pg.QueryResult<LinhaRotina>
      try {
        r = await c.query<LinhaRotina>(
          `INSERT INTO rotinas_internas
             (titulo, grupo_id, responsavel_usuario_gestao_id, frequencia, escopo_aplicacao, passos, inicio)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING ${colunasRotina}`,
          [
            dados.titulo,
            grupoId,
            dados.responsavelUsuarioGestaoId ?? null,
            dados.frequencia,
            dados.escopoAplicacao,
            dados.passos,
            dados.inicio,
          ],
        )
      } catch (e) {
        if ((e as { code?: string }).code === FK_VIOLADA) throw new ReferenciaInexistente()
        throw e
      }
      return rotinaParaContrato(r.rows[0]!)
    })
  }

  async listarTarefas(sessao: Sessao): Promise<TarefaInternaNaLista[]> {
    const r = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, (c) =>
      c.query<LinhaTarefa>(
        `SELECT ${colunasTarefa} FROM tarefas_internas
          WHERE status <> 'cancelada'
          ORDER BY prazo`,
      ),
    )
    return r.rows.map(tarefaParaContrato)
  }

  async criarTarefa(sessao: Sessao, dados: CriarTarefaInternaEntrada): Promise<TarefaInternaNaLista> {
    const resolucao = resolverGrupoDeEscrita(sessao, null)
    if (ehErro(resolucao)) throw new GrupoCruzado(resolucao.erro.mensagem)
    const grupoId = resolucao.valor

    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const grupoDoResponsavel = await grupoDeUsuarioDeGestao(c, dados.responsavelUsuarioGestaoId ?? null)
      const validacao = validarResponsavelDoMesmoGrupo(
        sessao,
        grupoId,
        dados.responsavelUsuarioGestaoId ?? null,
        grupoDoResponsavel,
      )
      if (ehErro(validacao)) throw new ResponsavelDeOutroGrupo(validacao.erro.mensagem)

      // `cliente_carteira_id`/`lead_comercial_id` são FK para tabelas com RLS
      // própria por grupo — e o FK do Postgres SEMPRE ignora RLS para checar
      // referência (é assim que a integridade referencial é garantida mesmo
      // quando a linha referenciada não é visível para quem a lê). Sem este
      // SELECT, a sessão do grupo A conseguiria criar uma tarefa apontando
      // para um Cliente Firmare/Lead comercial do grupo B — o `INSERT` abaixo
      // teria sucesso mesmo assim, porque o FK não reconsulta via RLS. Este
      // `SELECT`, rodando SOB a mesma RLS que o restante da transação, é quem
      // de fato fecha o cruzamento — mesmo padrão já usado em
      // `registrarCheckin`/`criarInteracao` acima.
      if (dados.clienteCarteiraId !== undefined) {
        const cliente = await c.query('SELECT 1 FROM clientes_carteira WHERE id = $1', [
          dados.clienteCarteiraId,
        ])
        if (!cliente.rows[0]) throw new ReferenciaInexistente()
      }
      if (dados.leadComercialId !== undefined) {
        const lead = await c.query('SELECT 1 FROM leads_comerciais WHERE id = $1', [dados.leadComercialId])
        if (!lead.rows[0]) throw new ReferenciaInexistente()
      }

      let r: pg.QueryResult<LinhaTarefa>
      try {
        r = await c.query<LinhaTarefa>(
          `INSERT INTO tarefas_internas
             (titulo, descricao, grupo_id, responsavel_usuario_gestao_id,
              cliente_carteira_id, lead_comercial_id, prazo, prioridade)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING ${colunasTarefa}`,
          [
            dados.titulo,
            dados.descricao ?? null,
            grupoId,
            dados.responsavelUsuarioGestaoId ?? null,
            dados.clienteCarteiraId ?? null,
            dados.leadComercialId ?? null,
            dados.prazo,
            dados.prioridade,
          ],
        )
      } catch (e) {
        if ((e as { code?: string }).code === FK_VIOLADA) throw new ReferenciaInexistente()
        throw e
      }
      return tarefaParaContrato(r.rows[0]!)
    })
  }

  async atualizarStatusTarefa(
    sessao: Sessao,
    tarefaId: string,
    status: 'concluida' | 'cancelada',
  ): Promise<TarefaInternaNaLista> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<LinhaTarefa>(
        `UPDATE tarefas_internas
            SET status = $2, concluida_em = CASE WHEN $2 = 'concluida' THEN now() ELSE concluida_em END
          WHERE id = $1
          RETURNING ${colunasTarefa}`,
        [tarefaId, status],
      )
      if (!r.rows[0]) throw new TarefaNaoEncontrada()
      return tarefaParaContrato(r.rows[0])
    })
  }

  /**
   * O `Marcador de rotina interna` (spec §3): materializa a próxima tarefa
   * de cada `Rotina interna` ativa com frequência `diaria`/`semanal`/
   * `mensal`. Reentrante: o `ON CONFLICT DO NOTHING` sobre os índices
   * parciais da migration 0032 é o que torna rodar duas vezes no mesmo dia
   * um não-evento (critério de aceite 5 do spec).
   *
   * O predicado do `ON CONFLICT` abaixo precisa casar SINTATICAMENTE com o
   * predicado do índice parcial correspondente — o Postgres não infere
   * equivalência lógica, só compara texto (`AND rotina_interna_id IS NOT
   * NULL` precisa estar nos dois lados, mesmo a coluna já sendo `NOT NULL`
   * neste INSERT). Sem essa cláusula a correspondência falha e o `INSERT`
   * recusa com "there is no unique or exclusion constraint matching the ON
   * CONFLICT specification" já na primeira chamada — não é um caso de
   * borda, é sempre.
   *
   * `vencimento` e `reuniao` ficam de fora nesta fatia — dependem de um dado
   * por `Cliente Firmare` (data de vencimento do contrato, dia da reunião
   * fixa) que `clientes_carteira` ainda não modela (G3/adjacente). Gerá-las
   * aqui seria inventar o dado, não lê-lo.
   */
  async gerarTarefasDeRotinasInternas(): Promise<number> {
    const agora = this.relogio.agora()
    return this.banco.nasTabelasDaCarteiraComEscopo('geral', null, async (c) => {
      const rotinas = await c.query<{
        id: string
        grupo_id: string | null
        responsavel_usuario_gestao_id: string | null
        titulo: string
        frequencia: 'diaria' | 'semanal' | 'mensal' | 'vencimento' | 'reuniao'
        escopo_aplicacao: 'global' | 'por_cliente'
        inicio: string
      }>(
        `SELECT id, grupo_id, responsavel_usuario_gestao_id, titulo, frequencia, escopo_aplicacao, inicio::text
           FROM rotinas_internas
          WHERE ativa AND frequencia IN ('diaria', 'semanal', 'mensal')`,
      )

      let geradas = 0
      for (const rotina of rotinas.rows) {
        const diaDeAncoragem = Number(rotina.inicio.slice(8, 10))
        let prazo = rotina.inicio
        const hoje = agora.toISOString().slice(0, 10)
        // Avança até alcançar hoje ou o futuro — nunca materializa tarefa
        // ATRASADA retroativa em massa: a varredura só busca o PRÓXIMO prazo.
        let guarda = 0
        while (prazo < hoje && guarda < 10_000) {
          prazo = proximoPrazoDaRotina(
            rotina.frequencia as 'diaria' | 'semanal' | 'mensal',
            prazo,
            diaDeAncoragem,
          )
          guarda++
        }

        if (rotina.escopo_aplicacao === 'global') {
          const r = await c.query(
            `INSERT INTO tarefas_internas
               (titulo, grupo_id, responsavel_usuario_gestao_id, prazo, rotina_interna_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (rotina_interna_id, prazo)
               WHERE cliente_carteira_id IS NULL AND status <> 'cancelada' AND rotina_interna_id IS NOT NULL
               DO NOTHING`,
            [rotina.titulo, rotina.grupo_id, rotina.responsavel_usuario_gestao_id, prazo, rotina.id],
          )
          geradas += r.rowCount ?? 0
        } else {
          const clientes = await c.query<{ id: string; grupo_id: string | null }>(
            `SELECT id, grupo_id FROM clientes_carteira
              WHERE status = 'ativo' AND excluido_em IS NULL
                AND ($1::uuid IS NULL OR grupo_id = $1)`,
            [rotina.grupo_id],
          )
          for (const cliente of clientes.rows) {
            const r = await c.query(
              `INSERT INTO tarefas_internas
                 (titulo, grupo_id, responsavel_usuario_gestao_id, cliente_carteira_id, prazo, rotina_interna_id)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (rotina_interna_id, prazo, cliente_carteira_id)
                 WHERE cliente_carteira_id IS NOT NULL AND status <> 'cancelada' AND rotina_interna_id IS NOT NULL
                 DO NOTHING`,
              [rotina.titulo, cliente.grupo_id, rotina.responsavel_usuario_gestao_id, cliente.id, prazo, rotina.id],
            )
            geradas += r.rowCount ?? 0
          }
        }
      }
      return geradas
    })
  }

  /* ──────────────────────────────────────────────────────────────────────
   * CHECKIN INTERNO
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
   * — a `semana` é sempre calculada pelo SERVIDOR a partir de `agora` (regra
   * 24 do CLAUDE.md: data de negócio nunca vem do cliente), então esta rota
   * **nunca** consegue mirar numa semana passada: é a semana de hoje, sempre.
   * `atualizarCheckin`, abaixo, é quem edita um checkin JÁ EXISTENTE por id —
   * e é ali que a janela de edição (spec §7, critério 7) é de fato cobrada.
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

  /**
   * Edita um checkin JÁ EXISTENTE, por id — só da semana CORRENTE (spec §7,
   * critério de aceite 7: "um fechamento por semana", mesma disciplina do
   * Caixa por dia). O servidor confere, não só a tela: um checkin de uma
   * semana anterior é recusado aqui mesmo que a requisição seja bem-formada.
   */
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
}

/* ────────────────────────────────────────────────────────────────────────
 * Linhas cruas ↔ contrato. Um ponto só por entidade.
 *
 * Os `as` abaixo (`l.etapa as EtapaDoLead`, `r.frequencia as
 * RotinaInternaNaLista['frequencia']` etc.) convertem `text` de volta para a
 * união estreita do contrato. Não são um "confia em mim" solto: o `CHECK` da
 * migration 0032, na MESMA coluna, já recusa qualquer valor fora da união no
 * `INSERT`/`UPDATE` — o banco é quem garante a invariante, o `as` só
 * descreve para o TypeScript o que o `CHECK` já tornou verdade.
 * ──────────────────────────────────────────────────────────────────────── */

type LinhaLead = {
  id: string
  nome: string
  grupo_id: string | null
  responsavel_usuario_gestao_id: string | null
  origem: string
  etapa: string
  temperatura: string
  produto_interesse: string | null
  proximo_contato: string | null
  cliente_carteira_id: string | null
  motivo_perda: string | null
  fechado_em: Date | null
  arquivado_em: Date | null
  criado_em: Date
}
const colunasLead =
  'id, nome, grupo_id, responsavel_usuario_gestao_id, origem, etapa, temperatura, ' +
  'produto_interesse, proximo_contato::text, cliente_carteira_id, motivo_perda, ' +
  'fechado_em, arquivado_em, criado_em'
const leadParaContrato = (l: LinhaLead): LeadComercialNaLista => ({
  id: l.id,
  nome: l.nome,
  grupoId: l.grupo_id,
  responsavelUsuarioGestaoId: l.responsavel_usuario_gestao_id,
  origem: l.origem,
  etapa: l.etapa as EtapaDoLead,
  temperatura: l.temperatura as LeadComercialNaLista['temperatura'],
  produtoInteresse: l.produto_interesse,
  proximoContato: l.proximo_contato,
  clienteCarteiraId: l.cliente_carteira_id,
  motivoPerda: l.motivo_perda,
  fechadoEm: l.fechado_em?.toISOString() ?? null,
  arquivadoEm: l.arquivado_em?.toISOString() ?? null,
  criadoEm: l.criado_em.toISOString(),
})

type LinhaInteracao = {
  id: string
  lead_comercial_id: string
  quando: Date
  canal: string
  nota: string
  por_usuario_gestao_id: string
}
const interacaoParaContrato = (i: LinhaInteracao): InteracaoDoLeadNaLista => ({
  id: i.id,
  leadComercialId: i.lead_comercial_id,
  quando: i.quando.toISOString(),
  canal: i.canal,
  nota: i.nota,
  porUsuarioGestaoId: i.por_usuario_gestao_id,
})

type LinhaRotina = {
  id: string
  titulo: string
  grupo_id: string | null
  responsavel_usuario_gestao_id: string | null
  frequencia: string
  escopo_aplicacao: string
  passos: string[]
  ativa: boolean
  inicio: string
}
const colunasRotina =
  'id, titulo, grupo_id, responsavel_usuario_gestao_id, frequencia, escopo_aplicacao, ' +
  'passos, ativa, inicio::text'
const rotinaParaContrato = (r: LinhaRotina): RotinaInternaNaLista => ({
  id: r.id,
  titulo: r.titulo,
  grupoId: r.grupo_id,
  responsavelUsuarioGestaoId: r.responsavel_usuario_gestao_id,
  frequencia: r.frequencia as RotinaInternaNaLista['frequencia'],
  escopoAplicacao: r.escopo_aplicacao as RotinaInternaNaLista['escopoAplicacao'],
  passos: r.passos,
  ativa: r.ativa,
  inicio: r.inicio,
})

type LinhaTarefa = {
  id: string
  titulo: string
  descricao: string | null
  grupo_id: string | null
  responsavel_usuario_gestao_id: string | null
  cliente_carteira_id: string | null
  lead_comercial_id: string | null
  prazo: string
  prioridade: string
  status: string
  concluida_em: Date | null
  rotina_interna_id: string | null
}
const colunasTarefa =
  'id, titulo, descricao, grupo_id, responsavel_usuario_gestao_id, cliente_carteira_id, ' +
  'lead_comercial_id, prazo::text, prioridade, status, concluida_em, rotina_interna_id'
const tarefaParaContrato = (t: LinhaTarefa): TarefaInternaNaLista => ({
  id: t.id,
  titulo: t.titulo,
  descricao: t.descricao,
  grupoId: t.grupo_id,
  responsavelUsuarioGestaoId: t.responsavel_usuario_gestao_id,
  clienteCarteiraId: t.cliente_carteira_id,
  leadComercialId: t.lead_comercial_id,
  prazo: t.prazo,
  prioridade: t.prioridade as TarefaInternaNaLista['prioridade'],
  status: t.status as TarefaInternaNaLista['status'],
  concluidaEm: t.concluida_em?.toISOString() ?? null,
  rotinaInternaId: t.rotina_interna_id,
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

/** `null` quando `usuarioGestaoId` é `null` ou não existe (deixa o `FK_VIOLADA` do INSERT recusar). */
async function grupoDeUsuarioDeGestao(c: pg.PoolClient, usuarioGestaoId: string | null): Promise<string | null> {
  if (usuarioGestaoId === null) return null
  const r = await c.query<{ grupo_id: string | null }>(
    'SELECT grupo_id FROM usuarios_gestao WHERE id = $1',
    [usuarioGestaoId],
  )
  return r.rows[0]?.grupo_id ?? null
}
