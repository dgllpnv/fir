import { randomBytes } from 'node:crypto'
import type {
  ConfiguracaoDasMensagensSaida,
  CriarModeloDeMensagemEntrada,
  CriarRoteiroComercialEntrada,
  DestinoDaMensagem,
  EditarModeloDeMensagemEntrada,
  EditarPagamentoDaCarteiraEntrada,
  EditarRoteiroComercialEntrada,
  EnvioDeMensagemRegistradoSaida,
  MensagemMontadaSaida,
  ModeloDeMensagem,
  ModelosDeMensagemSaida,
  RegistrarEnvioDeMensagemEntrada,
  RoteiroComercial,
  RoteirosComerciaisSaida,
} from '@fir/contracts'
import {
  type FrenteDoParceiro,
  type MensagemMontada,
  ROTULO_DA_FRENTE,
  VARIAVEIS_DOS_MODELOS,
  VARIAVEIS_DOS_ROTEIROS,
  descricaoDoBeneficio,
  diaCivil,
  ehErro,
  montarMensagemDoCliente,
  montarMensagemDoLead,
  validarTextoDaMensagem,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { percentualDoBeneficioDeIndicacao } from '../financeiro/beneficios.regra'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
import {
  ChaveReutilizada,
  EntradaInvalida,
  MensagemRestrita,
  NaoContatar,
  NaoEncontrado,
  PODE_VER_VALORES_NA_MENSAGEM,
  type PodeVerValoresNaMensagem,
  type Sessao,
  SemPermissao,
  podeEditarMensagens,
} from './mensagens-comum'

/** A ordem dos sete modelos do protótipo (L834-841); os criados vêm depois, pela data. */
const ORDEM_DOS_MODELOS = ['pagamento', 'fluxo', 'dre', 'formulario', 'cobranca', 'acessos', 'semanal']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type LinhaRoteiro = {
  id: string
  chave: string | null
  titulo: string
  quando: string
  mensagem: string
  passos: string[]
}
const COLUNAS_ROTEIRO = 'id, chave, titulo, quando, mensagem, passos'
const roteiroParaContrato = (l: LinhaRoteiro): RoteiroComercial => ({ ...l })

/** O que o envio grava — o fato, nunca o texto (LGPD A36). */
type RegistroDoEnvio = {
  grupoId: string | null
  clienteId: string | null
  leadId: string | null
  tarefaId: string | null
  frente: FrenteDoParceiro | null
  origem: 'modelo' | 'roteiro'
  chave: string
}

type Resolvida = {
  readonly montada: MensagemMontada
  readonly titulo: string
  readonly para: string
  readonly passos: readonly string[]
  readonly registro: RegistroDoEnvio
}

/**
 * **G8 3A — mensagens prontas e WhatsApp.** Modelos (X4), roteiros de
 * abordagem (L10), dados de pagamento, e a montagem da mensagem de uma
 * tarefa, cliente ou lead (W1, L9) NO SERVIDOR, com a redação aplicada antes
 * do preenchimento (appsec A-14, LGPD A35).
 *
 * Duas camadas de isolamento, como no resto da carteira: a RLS por grupo da
 * sessão do `Usuário de Gestão` (cliente, lead, tarefa, parceiro e envio de
 * outro grupo simplesmente não existem para ela) e o grupo do envio lido do
 * cliente ou do lead, nunca do corpo.
 *
 * O texto montado não entra em log (LGPD A38): nenhum `console`/`Logger`
 * aqui, e os erros não carregam texto.
 */
@Injectable()
export class MensagensCarteiraService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(PODE_VER_VALORES_NA_MENSAGEM) private readonly podeVerValores: PodeVerValoresNaMensagem,
  ) {}

  /* ── Modelos de mensagem (X4) ──────────────────────────────────────── */

  async listarModelos(sessao: Sessao): Promise<ModelosDeMensagemSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<ModeloDeMensagem>(
        `SELECT chave, titulo, texto FROM mensagens_comerciais
          ORDER BY array_position($1::text[], chave) NULLS LAST, criado_em, chave`,
        [ORDEM_DOS_MODELOS],
      )
      return { modelos: r.rows, variaveisDisponiveis: [...VARIAVEIS_DOS_MODELOS], podeEditar: podeEditarMensagens(sessao) }
    })
  }

  /** "Nova mensagem" (L2922): a chave nasce `m_<aleatório>`, como no protótipo. */
  async criarModelo(sessao: Sessao, dados: CriarModeloDeMensagemEntrada): Promise<ModeloDeMensagem> {
    this.exigirEdicao(sessao)
    this.validarTexto(dados.texto, 'modelo', null)
    const chave = `m_${randomBytes(6).toString('hex')}`
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<ModeloDeMensagem>(
        `INSERT INTO mensagens_comerciais (chave, titulo, texto, criado_por)
         VALUES ($1, $2, $3, $4) RETURNING chave, titulo, texto`,
        [chave, dados.titulo, dados.texto, sessao.id],
      )
      return r.rows[0]!
    })
  }

  async editarModelo(sessao: Sessao, chave: string, dados: EditarModeloDeMensagemEntrada): Promise<ModeloDeMensagem> {
    this.exigirEdicao(sessao)
    if (dados.texto !== undefined) this.validarTexto(dados.texto, 'modelo', null)
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<ModeloDeMensagem>(
        `UPDATE mensagens_comerciais
            SET titulo = coalesce($2, titulo), texto = coalesce($3, texto), atualizado_em = now()
          WHERE chave = $1
          RETURNING chave, titulo, texto`,
        [chave, dados.titulo ?? null, dados.texto ?? null],
      )
      const m = r.rows[0]
      if (!m) throw new NaoEncontrado()
      return m
    })
  }

  /* ── Roteiros de abordagem (L10) ───────────────────────────────────── */

  async listarRoteiros(sessao: Sessao): Promise<RoteirosComerciaisSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<LinhaRoteiro>(
        `SELECT ${COLUNAS_ROTEIRO} FROM roteiros_comerciais
          WHERE arquivado_em IS NULL ORDER BY ordem, criado_em, id`,
      )
      return {
        roteiros: r.rows.map(roteiroParaContrato),
        variaveisDisponiveis: [...VARIAVEIS_DOS_ROTEIROS],
        podeEditar: podeEditarMensagens(sessao),
      }
    })
  }

  async criarRoteiro(sessao: Sessao, dados: CriarRoteiroComercialEntrada): Promise<RoteiroComercial> {
    this.exigirEdicao(sessao)
    this.validarTexto(dados.mensagem, 'roteiro', null)
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<LinhaRoteiro>(
        `INSERT INTO roteiros_comerciais (titulo, quando, mensagem, passos, criado_por)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUNAS_ROTEIRO}`,
        [dados.titulo, dados.quando, dados.mensagem, dados.passos, sessao.id],
      )
      return roteiroParaContrato(r.rows[0]!)
    })
  }

  async editarRoteiro(sessao: Sessao, id: string, dados: EditarRoteiroComercialEntrada): Promise<RoteiroComercial> {
    this.exigirEdicao(sessao)
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await c.query<{ chave: string | null }>(
        `SELECT chave FROM roteiros_comerciais WHERE id = $1 AND arquivado_em IS NULL FOR UPDATE`,
        [id],
      )
      const linha = atual.rows[0]
      if (!linha) throw new NaoEncontrado()
      if (dados.mensagem !== undefined) this.validarTexto(dados.mensagem, 'roteiro', linha.chave)
      const r = await c.query<LinhaRoteiro>(
        `UPDATE roteiros_comerciais
            SET titulo = coalesce($2, titulo), quando = coalesce($3, quando),
                mensagem = coalesce($4, mensagem), passos = coalesce($5, passos),
                atualizado_em = now()
          WHERE id = $1
          RETURNING ${COLUNAS_ROTEIRO}`,
        [id, dados.titulo ?? null, dados.quando ?? null, dados.mensagem ?? null, dados.passos ?? null],
      )
      return roteiroParaContrato(r.rows[0]!)
    })
  }

  /** "Excluir" do protótipo (L2860) é arquivar (regra 20). Os oito padrão ficam: o sinal do lead aponta para eles. */
  async arquivarRoteiro(sessao: Sessao, id: string): Promise<void> {
    this.exigirEdicao(sessao)
    await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await c.query<{ chave: string | null }>(
        `SELECT chave FROM roteiros_comerciais WHERE id = $1 AND arquivado_em IS NULL FOR UPDATE`,
        [id],
      )
      const linha = atual.rows[0]
      if (!linha) throw new NaoEncontrado()
      if (linha.chave !== null) {
        throw new EntradaInvalida('ROTEIRO_PADRAO', 'Os roteiros padrão não são excluídos. Edite o texto, se precisar.')
      }
      await c.query(`UPDATE roteiros_comerciais SET arquivado_em = now() WHERE id = $1`, [id])
    })
  }

  /* ── Dados de pagamento (L2655) ────────────────────────────────────── */

  async lerConfiguracao(sessao: Sessao): Promise<ConfiguracaoDasMensagensSaida> {
    const visivel = this.podeVerValores(sessao)
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cfg = await this.configuracao(c)
      return {
        chavePix: visivel ? cfg.chave_pix : null,
        favorecido: cfg.favorecido,
        beneficio: descricaoDoBeneficio(await percentualDoBeneficioDeIndicacao(c)),
        pagamentoVisivel: visivel,
        podeEditarPagamento: this.podeEditarPagamento(sessao),
      }
    })
  }

  /** "Editar" dos dados de pagamento aparece só com `valores` (L2655) — e o servidor confere. */
  async editarPagamento(
    sessao: Sessao,
    dados: EditarPagamentoDaCarteiraEntrada,
  ): Promise<ConfiguracaoDasMensagensSaida> {
    if (!this.podeEditarPagamento(sessao)) throw new SemPermissao()
    await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      await c.query(
        `UPDATE configuracao_da_carteira SET chave_pix = $1, favorecido = $2, atualizado_em = now() WHERE unica`,
        [dados.chavePix, dados.favorecido],
      )
    })
    return this.lerConfiguracao(sessao)
  }

  /* ── Montar e registrar (W1, W2, L9, PP-6) ─────────────────────────── */

  async montar(sessao: Sessao, destino: DestinoDaMensagem): Promise<MensagemMontadaSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await this.resolver(c, sessao, destino)
      return {
        titulo: r.titulo,
        para: r.para,
        texto: r.montada.texto,
        avisos: [...r.montada.avisos],
        telefone: r.montada.telefone,
        destinatario: r.montada.destinatario,
        restrita: r.montada.restrita,
        passos: [...r.passos],
        ultimoEnvioConfirmado: await this.ultimoEnvio(c, r.registro),
      }
    })
  }

  /**
   * "Marcar como enviada": grava o FATO depois da confirmação da pessoa
   * (PP-6) — nunca o texto (A36). A montagem roda de novo aqui para que as
   * mesmas recusas valham: oposição (A37) e mensagem restrita (um lembrete
   * sem o valor não conta como enviado).
   */
  async registrarEnvio(
    sessao: Sessao,
    dados: RegistrarEnvioDeMensagemEntrada,
  ): Promise<EnvioDeMensagemRegistradoSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await this.resolver(c, sessao, dados.destino)
      if (r.montada.restrita) throw new MensagemRestrita()
      if (r.montada.texto === '') {
        throw new EntradaInvalida('SEM_MENSAGEM', 'Este roteiro é só um guia de conversa, sem mensagem para enviar.')
      }
      const g = r.registro
      const inserida = await c.query<{ enviada_em: Date }>(
        `INSERT INTO envios_de_mensagem
           (grupo_id, cliente_carteira_id, lead_comercial_id, tarefa_interna_id, destinatario, frente,
            origem, chave, por_usuario_gestao_id, chave_idempotencia)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (por_usuario_gestao_id, chave_idempotencia) DO NOTHING
         RETURNING enviada_em`,
        [
          g.grupoId,
          g.clienteId,
          g.leadId,
          g.tarefaId,
          r.montada.destinatario,
          g.frente,
          g.origem,
          g.chave,
          sessao.id,
          dados.chaveIdempotencia,
        ],
      )
      const nova = inserida.rows[0]
      if (nova) return { ...this.instante(nova.enviada_em), repetido: false }

      const existente = await c.query<{
        enviada_em: Date
        cliente_carteira_id: string | null
        lead_comercial_id: string | null
        chave: string
      }>(
        `SELECT enviada_em, cliente_carteira_id, lead_comercial_id, chave FROM envios_de_mensagem
          WHERE por_usuario_gestao_id = $1 AND chave_idempotencia = $2`,
        [sessao.id, dados.chaveIdempotencia],
      )
      const e = existente.rows[0]
      if (!e || e.cliente_carteira_id !== g.clienteId || e.lead_comercial_id !== g.leadId || e.chave !== g.chave) {
        throw new ChaveReutilizada()
      }
      return { ...this.instante(e.enviada_em), repetido: true }
    })
  }

  /* ── Oposição do parceiro (A37) ────────────────────────────────────── */

  async marcarOposicaoDoParceiro(
    sessao: Sessao,
    clienteId: string,
    frente: FrenteDoParceiro,
    naoContatar: boolean,
  ): Promise<void> {
    await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query(
        `UPDATE parceiros_do_cliente
            SET nao_contatar = $3,
                nao_contatar_em = CASE WHEN $3 THEN coalesce(nao_contatar_em, now()) ELSE NULL END
          WHERE cliente_carteira_id = $1 AND frente = $2`,
        [clienteId, frente, naoContatar],
      )
      if (r.rowCount === 0) throw new NaoEncontrado()
    })
  }

  /* ── Internos ──────────────────────────────────────────────────────── */

  private podeEditarPagamento(sessao: Sessao): boolean {
    return this.podeVerValores(sessao) && podeEditarMensagens(sessao)
  }

  private exigirEdicao(sessao: Sessao): void {
    if (!podeEditarMensagens(sessao)) throw new SemPermissao()
  }

  private validarTexto(texto: string, tipo: 'modelo' | 'roteiro', chave: string | null): void {
    const v = validarTextoDaMensagem(texto, tipo, chave)
    if (ehErro(v)) throw new EntradaInvalida(v.erro.codigo, v.erro.mensagem)
  }

  private async configuracao(c: pg.PoolClient): Promise<{ chave_pix: string | null; favorecido: string | null }> {
    const r = await c.query<{ chave_pix: string | null; favorecido: string | null }>(
      `SELECT chave_pix, favorecido FROM configuracao_da_carteira WHERE unica`,
    )
    return r.rows[0] ?? { chave_pix: null, favorecido: null }
  }

  private async resolver(c: pg.PoolClient, sessao: Sessao, destino: DestinoDaMensagem): Promise<Resolvida> {
    return destino.para === 'cliente'
      ? this.resolverCliente(c, sessao, destino)
      : this.resolverLead(c, sessao, destino)
  }

  private async resolverCliente(
    c: pg.PoolClient,
    sessao: Sessao,
    destino: Extract<DestinoDaMensagem, { para: 'cliente' }>,
  ): Promise<Resolvida> {
    const modelo = (
      await c.query<{ titulo: string; texto: string }>(
        `SELECT titulo, texto FROM mensagens_comerciais WHERE chave = $1`,
        [destino.chave],
      )
    ).rows[0]
    if (!modelo) throw new NaoEncontrado()

    // A redação acontece AQUI, antes de qualquer preenchimento: sem `valores`
    // a mensalidade, o vencimento e o telefone de cobrança (seção Pagamento
    // do cadastro) nem são lidos do banco.
    const comValores = this.podeVerValores(sessao)
    const cliente = (
      await c.query<{
        id: string
        grupo_id: string
        nome: string
        decisor: string | null
        telefone: string | null
        link_painel: string | null
        link_dash_fin: string | null
        link_dash_ind: string | null
        link_rotina: string | null
        dia_vencimento: number | null
        mensalidade_centavos: string | null
        telefone_cobranca: string | null
      }>(
        `SELECT id, grupo_id, nome, decisor, telefone, link_painel, link_dash_fin, link_dash_ind, link_rotina,
                ${comValores ? 'dia_vencimento, mensalidade_centavos::text AS mensalidade_centavos, telefone_cobranca' : 'NULL::smallint AS dia_vencimento, NULL::text AS mensalidade_centavos, NULL::text AS telefone_cobranca'}
           FROM clientes_carteira
          WHERE id = $1 AND excluido_em IS NULL`,
        [destino.clienteId],
      )
    ).rows[0]
    if (!cliente) throw new NaoEncontrado()

    let dia = diaCivil(this.relogio.agora(), FUSO_DA_CARTEIRA)
    let remetente = sessao.nome
    let tarefaId: string | null = null
    if (destino.tarefaInternaId !== undefined) {
      const tarefa = (
        await c.query<{ prazo: string; cliente_carteira_id: string | null; responsavel: string | null }>(
          `SELECT t.prazo::text AS prazo, t.cliente_carteira_id, u.nome AS responsavel
             FROM tarefas_internas t
             LEFT JOIN usuarios_gestao u ON u.id = t.responsavel_usuario_gestao_id
            WHERE t.id = $1`,
          [destino.tarefaInternaId],
        )
      ).rows[0]
      // Tarefa de outro grupo é invisível pela RLS; tarefa de OUTRO cliente
      // recebe a mesma resposta — nunca se monta a mensagem de um cliente
      // pendurada na tarefa de outro.
      if (!tarefa || tarefa.cliente_carteira_id !== cliente.id) throw new NaoEncontrado()
      dia = tarefa.prazo
      if (tarefa.responsavel) remetente = tarefa.responsavel
      tarefaId = destino.tarefaInternaId
    }

    const frente = destino.frente ?? null
    let parceiro: { nome: string | null; whatsapp: string | null; linkFormulario: string | null; naoContatar: boolean } | null =
      null
    if (frente !== null) {
      const p = (
        await c.query<{ nome: string | null; whatsapp: string | null; link_formulario: string | null; nao_contatar: boolean }>(
          `SELECT nome, whatsapp, link_formulario, nao_contatar FROM parceiros_do_cliente
            WHERE cliente_carteira_id = $1 AND frente = $2`,
          [cliente.id, frente],
        )
      ).rows[0]
      if (p) parceiro = { nome: p.nome, whatsapp: p.whatsapp, linkFormulario: p.link_formulario, naoContatar: p.nao_contatar }
    }

    const cfg = await this.configuracao(c)
    const resultado = montarMensagemDoCliente({
      modelo: { chave: destino.chave, texto: modelo.texto },
      cliente: {
        nome: cliente.nome,
        decisor: cliente.decisor,
        telefone: cliente.telefone,
        linkPainel: cliente.link_painel,
        linkDashFin: cliente.link_dash_fin,
        linkDashInd: cliente.link_dash_ind,
        linkRotina: cliente.link_rotina,
      },
      remetente,
      dia,
      diaDoVencimento: cliente.dia_vencimento,
      pagamento: comValores
        ? {
            mensalidadeCentavos: cliente.mensalidade_centavos === null ? null : BigInt(cliente.mensalidade_centavos),
            telefoneCobranca: cliente.telefone_cobranca,
            chavePix: cfg.chave_pix,
          }
        : 'restrito',
      favorecido: cfg.favorecido,
      frente,
      parceiro,
      // As pendências das frentes dependem dos itens da tarefa (R5/W3), que
      // ainda não existem: sai vazio, como no protótipo sem frentes (L2578).
      pendencias: '',
    })
    if (ehErro(resultado)) throw new NaoContatar()

    const para =
      frente === null ? cliente.nome : `${parceiro?.nome ?? `Parceiro de ${ROTULO_DA_FRENTE[frente].toLowerCase()}`} · ${cliente.nome}`
    return {
      montada: resultado.valor,
      titulo: modelo.titulo,
      para,
      passos: [],
      registro: {
        grupoId: cliente.grupo_id,
        clienteId: cliente.id,
        leadId: null,
        tarefaId,
        frente,
        origem: 'modelo',
        chave: destino.chave,
      },
    }
  }

  private async resolverLead(
    c: pg.PoolClient,
    sessao: Sessao,
    destino: Extract<DestinoDaMensagem, { para: 'lead' }>,
  ): Promise<Resolvida> {
    const lead = (
      await c.query<{
        id: string
        grupo_id: string | null
        nome: string
        especialidade: string | null
        produto_interesse: string | null
        origem: string
        whatsapp: string | null
        nao_contatar: boolean
        excluido_a_pedido_em: Date | null
        indicado_por: string | null
        indicador_nome: string | null
        indicador_decisor: string | null
      }>(
        `SELECT l.id, l.grupo_id, l.nome, l.especialidade, l.produto_interesse, l.origem, l.whatsapp,
                l.nao_contatar, l.excluido_a_pedido_em, l.indicado_por,
                ci.nome AS indicador_nome, ci.decisor AS indicador_decisor
           FROM leads_comerciais l
           LEFT JOIN clientes_carteira ci ON ci.id = l.cliente_indicador_id
          WHERE l.id = $1`,
        [destino.leadId],
      )
    ).rows[0]
    if (!lead) throw new NaoEncontrado()

    const porId = UUID.test(destino.roteiro)
    const roteiro = (
      await c.query<LinhaRoteiro>(
        `SELECT ${COLUNAS_ROTEIRO} FROM roteiros_comerciais
          WHERE ${porId ? 'id = $1::uuid' : 'chave = $1'} AND arquivado_em IS NULL`,
        [destino.roteiro],
      )
    ).rows[0]
    if (!roteiro) throw new NaoEncontrado()

    // `indPessoa` (L2437): o decisor do cliente indicador, o cliente, ou o texto livre.
    const indicador = lead.indicador_decisor ?? lead.indicador_nome ?? lead.indicado_por
    const resultado = montarMensagemDoLead({
      roteiro: { chave: roteiro.chave, mensagem: roteiro.mensagem },
      lead: {
        nome: lead.nome,
        especialidade: lead.especialidade,
        produtoInteresse: lead.produto_interesse,
        origem: lead.origem,
        indicador,
        whatsapp: lead.whatsapp,
        naoContatar: lead.nao_contatar || lead.excluido_a_pedido_em !== null,
      },
      remetente: sessao.nome,
      beneficio: descricaoDoBeneficio(await percentualDoBeneficioDeIndicacao(c)),
    })
    if (ehErro(resultado)) throw new NaoContatar()

    const montada: MensagemMontada =
      roteiro.mensagem.trim() === ''
        ? {
            ...resultado.valor,
            texto: '',
            telefone: null,
            avisos: ['Este roteiro é só um guia de conversa, sem mensagem para enviar.'],
          }
        : resultado.valor
    return {
      montada,
      titulo: roteiro.titulo,
      para: lead.nome,
      passos: roteiro.passos,
      registro: {
        grupoId: lead.grupo_id,
        clienteId: null,
        leadId: lead.id,
        tarefaId: null,
        frente: null,
        origem: 'roteiro',
        chave: roteiro.chave ?? roteiro.id,
      },
    }
  }

  private instante(d: Date): { envioConfirmadoEm: string; envioConfirmadoNoDia: string } {
    return { envioConfirmadoEm: d.toISOString(), envioConfirmadoNoDia: diaCivil(d, FUSO_DA_CARTEIRA) }
  }

  private async ultimoEnvio(c: pg.PoolClient, g: RegistroDoEnvio): Promise<{ em: string; dia: string } | null> {
    const r =
      g.leadId !== null
        ? await c.query<{ em: Date | null }>(
            `SELECT max(enviada_em) AS em FROM envios_de_mensagem WHERE lead_comercial_id = $1 AND chave = $2`,
            [g.leadId, g.chave],
          )
        : g.tarefaId !== null
          ? await c.query<{ em: Date | null }>(
              `SELECT max(enviada_em) AS em FROM envios_de_mensagem
                WHERE tarefa_interna_id = $1 AND chave = $2 AND frente IS NOT DISTINCT FROM $3`,
              [g.tarefaId, g.chave, g.frente],
            )
          : await c.query<{ em: Date | null }>(
              `SELECT max(enviada_em) AS em FROM envios_de_mensagem
                WHERE cliente_carteira_id = $1 AND chave = $2 AND frente IS NOT DISTINCT FROM $3`,
              [g.clienteId, g.chave, g.frente],
            )
    const em = r.rows[0]?.em
    return em ? { em: em.toISOString(), dia: diaCivil(em, FUSO_DA_CARTEIRA) } : null
  }
}
