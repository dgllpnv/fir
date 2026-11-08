import type {
  BeneficioDeIndicacaoNaTela,
  ContatoRegistradoSaida,
  CriarInteracaoDoLeadEntrada,
  CriarLeadEntrada,
  EditarLeadEntrada,
  FichaDoLeadSaida,
  IndicacoesSaida,
  InteracaoDoLeadNaLista,
  LeadComercialNaLista,
  ListaDeLeadsSaida,
  MarcarLeadPerdidoEntrada,
  PessoaDaEquipeFirmare,
  RegistrarContatoDoLeadEntrada,
} from '@fir/contracts'
import {
  CANAL_DE_REGISTRO,
  Dinheiro,
  decidirPerda,
  diaCivil,
  ehErro,
  etapaSugeridaDepoisDoContato,
  linkDoWhatsApp,
  proximoContatoSugerido,
  quemIndicou,
  rankingDeQuemIndica,
  resolverGrupoDeEscrita,
  resumoDasOportunidades,
  sinalDoLead,
  situacaoDoBeneficio,
  validarRegistroDeContato,
  validarResponsavelDoMesmoGrupo,
  validarTransicaoDeEtapa,
  type EtapaDoLead,
  type TemperaturaDoLead,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { gravarAuditoriaDaCarteira } from '../financeiro/auditoria-da-carteira'
import { beneficiosNaTela, SQL_BENEFICIO_NA_TELA, type LinhaBeneficioNaTela } from '../financeiro/beneficios.leitura'
import { percentualDoBeneficioDeIndicacao } from '../financeiro/beneficios.regra'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
import { podeVerValoresDaCarteira, responsavelImpostoPelaCarteira } from './leads.permissoes'
import { hashDoTelefoneParaSupressao } from './leads.supressao'
import {
  FK_VIOLADA,
  GrupoCruzado,
  ReferenciaInexistente,
  ResponsavelDeOutroGrupo,
  type Sessao,
  codigoPg,
  grupoDeUsuarioDeGestao,
} from './prospeccao-comum'

export class LeadNaoEncontrado extends Error {}
export class TransicaoDeEtapaInvalida extends Error {
  constructor(public readonly codigo: string, message: string) {
    super(message)
  }
}
export class LeadJaArquivado extends Error {}
export class LeadConvertidoNaoArquiva extends Error {}
/** Oposição registrada (A37) ou telefone na lista de supressão. */
export class ContatoSuprimido extends Error {}
/** Escrita de valor por quem não vê valores (ponto de extensão do ticket 0.5). */
export class SemPermissaoDeValores extends Error {}
export class ClienteIndicadorInvalido extends Error {}
export class LeadExcluidoAPedido extends Error {}
export class LeadConvertidoNaoExclui extends Error {}

/**
 * G5 — funil de prospecção: lead comercial, etapas, arquivamento, interações
 * e a conversão em `Cliente Firmare` (etapa `ganho`). ADR 0016. Completado
 * pelo G8 1E: campos do protótipo, ficha do lead, registrar contato,
 * marcar perdido com "tentar de novo", indicações, benefício na conversão,
 * oposição e exclusão a pedido (LGPD A37).
 *
 * Toda escrita abaixo roda em `banco.nasTabelasDaCarteiraComoUsuarioDeGestao`
 * — a RLS (`app_pode_ver_grupo`) é a SEGUNDA camada; a PRIMEIRA é
 * `resolverGrupoDeEscrita`/`validarResponsavelDoMesmoGrupo`
 * (`packages/domain`), chamada aqui ANTES de qualquer `INSERT`/`UPDATE` —
 * exatamente o achado crítico do ADR 0016 item 2: `grupoId` e
 * `responsavelUsuarioGestaoId` nunca atravessam crus do corpo da requisição.
 *
 * Todo cálculo (sinal, potencial, conversões, ranking) é do domínio; este
 * serviço só lê, chama e grava.
 */
@Injectable()
export class LeadsService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /** O hoje do SERVIDOR, no fuso da carteira (regras 22 e 24). */
  private hoje(): string {
    return diaCivil(this.relogio.agora(), FUSO_DA_CARTEIRA)
  }

  /* ──────────────────────────────────────────────────────────────────────
   * LEITURA
   * ────────────────────────────────────────────────────────────────────── */

  async listarLeads(sessao: Sessao): Promise<ListaDeLeadsSaida> {
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const responsavel = responsavelImpostoPelaCarteira(sessao)
      const r = await c.query<LinhaLeadCompleta>(
        `${SQL_LEAD_COMPLETO}
          WHERE l.arquivado_em IS NULL
            AND ($1::uuid IS NULL OR l.responsavel_usuario_gestao_id = $1)
          ORDER BY l.recebida_em DESC, l.criado_em DESC`,
        [responsavel],
      )
      const leads = r.rows.map((l) => leadParaContrato(l, hoje))
      // Ordem da tela Oportunidades (L2480): quem tem sinal mais forte
      // primeiro; empate pela indicação mais recente (a ordem do SQL).
      const ordenados = leads
        .map((l, i) => ({ l, i }))
        .sort((a, b) => (b.l.sinal?.peso ?? 0) - (a.l.sinal?.peso ?? 0) || a.i - b.i)
        .map((x) => x.l)
      const resumo = resumoDasOportunidades(
        r.rows.map((l) => ({
          etapa: l.etapa as EtapaDoLead,
          arquivado: l.arquivado_em !== null,
          valorEstimado: l.valor_estimado_centavos === null ? null : Dinheiro.deCentavos(BigInt(l.valor_estimado_centavos)),
        })),
      )
      return {
        leads: ordenados,
        resumo: {
          emAndamento: resumo.emAndamento,
          porEtapa: [...resumo.porEtapa],
          potencial: resumo.potencial.centavos.toString(),
          conversaoDasEncerradas: resumo.conversaoDasEncerradas,
        },
        hoje,
        podeVerValores: podeVerValoresDaCarteira(sessao),
        equipe: await equipeVisivel(c, sessao),
      }
    })
  }

  /**
   * A ficha do lead (`vLead`, L2490-2513). Grava o ACESSO (LGPD A53, regra
   * 18): é a leitura de contato pessoal de um médico prospectado, e a
   * pergunta "quem abriu este lead" precisa ter resposta. Na mesma
   * transação da leitura — sem trilha, sem ficha.
   */
  async obterFicha(sessao: Sessao, leadId: string): Promise<FichaDoLeadSaida> {
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const lead = await lerLeadCompleto(c, leadId, sessao)
      if (lead === null) throw new LeadNaoEncontrado()

      const interacoes = await c.query<LinhaInteracao>(
        `${SQL_INTERACAO} WHERE i.lead_comercial_id = $1 ORDER BY i.data_do_contato DESC, i.quando DESC`,
        [leadId],
      )
      const beneficio = await beneficioDoLead(c, leadId)

      await c.query(
        `INSERT INTO auditoria_do_painel (ator_tipo, ator_id, acao, entidade, entidade_id)
         VALUES ('usuario_gestao', $1, 'acessou', 'leads_comerciais', $2)`,
        [sessao.id, leadId],
      )

      const etapa = lead.etapa as EtapaDoLead
      return {
        lead: leadParaContrato(lead, hoje),
        interacoes: interacoes.rows.map(interacaoParaContrato),
        beneficio,
        hoje,
        sugestaoDeContato: {
          etapa: etapaSugeridaDepoisDoContato(etapa),
          proximoContato: proximoContatoSugerido(etapa, hoje),
        },
        podeVerValores: podeVerValoresDaCarteira(sessao),
        equipe: await equipeVisivel(c, sessao),
      }
    })
  }

  /**
   * "Quem mais indica" (L2533-2548). Os leads arquivados ficam fora — no
   * protótipo eles nem existem mais (L2958).
   */
  async indicacoes(sessao: Sessao): Promise<IndicacoesSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const responsavel = responsavelImpostoPelaCarteira(sessao)
      const leads = await c.query<{
        id: string
        nome: string
        etapa: string
        arquivado: boolean
        cliente_indicador_id: string | null
        nome_do_cliente_indicador: string | null
        indicado_por: string | null
      }>(
        `SELECT l.id, l.nome, l.etapa, l.arquivado_em IS NOT NULL AS arquivado,
                l.cliente_indicador_id, ci.nome AS nome_do_cliente_indicador, l.indicado_por
           FROM leads_comerciais l
           LEFT JOIN clientes_carteira ci ON ci.id = l.cliente_indicador_id
          WHERE ($1::uuid IS NULL OR l.responsavel_usuario_gestao_id = $1)`,
        [responsavel],
      )
      const beneficios = await c.query<{
        lead_comercial_id: string | null
        cliente_carteira_id: string | null
        consumido_em: Date | null
      }>(`SELECT lead_comercial_id, cliente_carteira_id, consumido_em FROM beneficios_de_indicacao`)

      const ranking = rankingDeQuemIndica(
        leads.rows.map((l) => ({
          id: l.id,
          nome: l.nome,
          etapa: l.etapa as EtapaDoLead,
          arquivado: l.arquivado,
          clienteIndicadorId: l.cliente_indicador_id,
          nomeDoClienteIndicador: l.nome_do_cliente_indicador,
          indicadoPor: l.indicado_por,
        })),
        beneficios.rows.map((b) => ({
          leadComercialId: b.lead_comercial_id,
          situacao: situacaoDoBeneficio({
            clienteCarteiraId: b.cliente_carteira_id,
            consumidoEm: b.consumido_em?.toISOString() ?? null,
          }),
        })),
      )
      return { ranking: ranking.map((x) => ({ ...x, leads: [...x.leads] })) }
    })
  }

  /* ──────────────────────────────────────────────────────────────────────
   * LEAD COMERCIAL — escrita
   * ────────────────────────────────────────────────────────────────────── */

  async criarLead(sessao: Sessao, dados: CriarLeadEntrada): Promise<LeadComercialNaLista> {
    const resolucao = resolverGrupoDeEscrita(sessao, dados.grupoIdDeExpansao ?? null)
    if (ehErro(resolucao)) throw new GrupoCruzado(resolucao.erro.mensagem)
    const grupoId = resolucao.valor
    if (dados.valorEstimado !== undefined && dados.valorEstimado !== null && !podeVerValoresDaCarteira(sessao)) {
      throw new SemPermissaoDeValores()
    }
    const hoje = this.hoje()

    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const grupoDoResponsavel = await grupoDeUsuarioDeGestao(c, dados.responsavelUsuarioGestaoId ?? null)
      const validacao = validarResponsavelDoMesmoGrupo(
        sessao,
        grupoId,
        dados.responsavelUsuarioGestaoId ?? null,
        grupoDoResponsavel,
      )
      if (ehErro(validacao)) throw new ResponsavelDeOutroGrupo(validacao.erro.mensagem)
      await exigirClienteIndicadorVisivel(c, dados.clienteIndicadorId ?? null)
      await exigirTelefoneNaoSuprimido(c, dados.whatsapp ?? null)

      // `responsavelUsuarioGestaoId` é FK — `grupoDeUsuarioDeGestao` acima já
      // confere o grupo quando o usuário EXISTE, mas quando ele aponta para
      // um id inexistente (e `grupoId` é `null`, caso em que
      // `validarResponsavelDoMesmoGrupo` não tem o que recusar) o `INSERT`
      // abaixo é quem primeiro vê o erro — e sem este `catch` ele vaza como
      // FK crua (500) em vez de 400 (mesmo padrão de `RotinaInternaService.criarTarefa`).
      let r: pg.QueryResult<{ id: string }>
      try {
        r = await c.query<{ id: string }>(
          `INSERT INTO leads_comerciais
             (nome, grupo_id, responsavel_usuario_gestao_id, origem, temperatura,
              produto_interesse, proximo_contato, etapa, especialidade, clinica, cidade,
              whatsapp, instagram, cliente_indicador_id, indicado_por,
              valor_estimado_centavos, recebida_em, observacoes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
           RETURNING id`,
          [
            dados.nome,
            grupoId,
            dados.responsavelUsuarioGestaoId ?? null,
            dados.origem,
            dados.temperatura,
            dados.produtoInteresse ?? null,
            dados.proximoContato ?? null,
            dados.etapa ?? 'novo',
            dados.especialidade ?? null,
            dados.clinica ?? null,
            dados.cidade ?? null,
            dados.whatsapp ?? null,
            dados.instagram ?? null,
            dados.clienteIndicadorId ?? null,
            dados.indicadoPor ?? null,
            dados.valorEstimado?.toString() ?? null,
            dados.recebidaEm ?? hoje,
            dados.observacoes ?? null,
          ],
        )
      } catch (e) {
        if (codigoPg(e) === FK_VIOLADA) throw new ReferenciaInexistente()
        throw e
      }
      return leadParaContrato((await lerLeadCompleto(c, r.rows[0]!.id, sessao))!, hoje)
    })
  }

  /**
   * "Editar" (L2958): só o que veio no corpo muda. A etapa não se edita
   * aqui (ver `EditarLeadEntrada`). Lead excluído a pedido não se edita —
   * preencher de novo o que a pessoa pediu para apagar é recriar o que ela
   * apagou (regra 27).
   */
  async editarLead(sessao: Sessao, leadId: string, dados: EditarLeadEntrada): Promise<LeadComercialNaLista> {
    if (dados.valorEstimado !== undefined && !podeVerValoresDaCarteira(sessao)) throw new SemPermissaoDeValores()
    const hoje = this.hoje()

    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await c.query<{ grupo_id: string | null; excluido_a_pedido_em: Date | null; nao_contatar: boolean }>(
        `SELECT grupo_id, excluido_a_pedido_em, nao_contatar FROM leads_comerciais WHERE id = $1 FOR UPDATE`,
        [leadId],
      )
      const lead = atual.rows[0]
      if (!lead) throw new LeadNaoEncontrado()
      if (lead.excluido_a_pedido_em !== null) throw new LeadExcluidoAPedido()

      if (dados.responsavelUsuarioGestaoId !== undefined && dados.responsavelUsuarioGestaoId !== null) {
        const grupoDoResponsavel = await grupoDeUsuarioDeGestao(c, dados.responsavelUsuarioGestaoId)
        const v = validarResponsavelDoMesmoGrupo(sessao, lead.grupo_id, dados.responsavelUsuarioGestaoId, grupoDoResponsavel)
        if (ehErro(v)) throw new ResponsavelDeOutroGrupo(v.erro.mensagem)
      }
      if (dados.clienteIndicadorId !== undefined) await exigirClienteIndicadorVisivel(c, dados.clienteIndicadorId)
      if (dados.whatsapp !== undefined) await exigirTelefoneNaoSuprimido(c, dados.whatsapp)

      // Lista fechada de colunas: o nome da coluna nunca vem do corpo, só o valor.
      const colunas: [string, unknown][] = []
      const por = <K extends keyof EditarLeadEntrada>(k: K, coluna: string, f?: (v: NonNullable<EditarLeadEntrada[K]>) => unknown) => {
        const v = dados[k]
        if (v === undefined) return
        colunas.push([coluna, v === null ? null : f ? f(v as NonNullable<EditarLeadEntrada[K]>) : v])
      }
      por('nome', 'nome')
      por('origem', 'origem')
      por('temperatura', 'temperatura')
      por('produtoInteresse', 'produto_interesse')
      por('responsavelUsuarioGestaoId', 'responsavel_usuario_gestao_id')
      por('proximoContato', 'proximo_contato')
      por('especialidade', 'especialidade')
      por('clinica', 'clinica')
      por('cidade', 'cidade')
      por('whatsapp', 'whatsapp')
      por('instagram', 'instagram')
      por('clienteIndicadorId', 'cliente_indicador_id')
      por('indicadoPor', 'indicado_por')
      por('valorEstimado', 'valor_estimado_centavos', (v) => v.toString())
      por('recebidaEm', 'recebida_em')
      por('observacoes', 'observacoes')

      const sets: string[] = []
      const params: unknown[] = [leadId]
      for (const [coluna, valor] of colunas) {
        params.push(valor)
        sets.push(`${coluna} = $${params.length}`)
      }
      // A oposição guarda QUANDO foi registrada (o CHECK da 0049 exige a data
      // junto); marcar de novo não reescreve a data original.
      if (dados.naoContatar === true) sets.push('nao_contatar = true', 'nao_contatar_em = coalesce(nao_contatar_em, now())')
      if (dados.naoContatar === false) sets.push('nao_contatar = false', 'nao_contatar_em = NULL')
      try {
        await c.query(`UPDATE leads_comerciais SET ${sets.join(', ')} WHERE id = $1`, params)
      } catch (e) {
        if (codigoPg(e) === FK_VIOLADA) throw new ReferenciaInexistente()
        throw e
      }
      return leadParaContrato((await lerLeadCompleto(c, leadId, sessao))!, hoje)
    })
  }

  /**
   * Avança a etapa do lead — e fecha o funil quando `etapa = 'ganho'`.
   *
   * Idempotente (critério de aceite 2 do spec): se o lead JÁ está `ganho`
   * (mesma requisição em dobro), devolve o `Cliente Firmare` já criado, sem
   * criar uma segunda linha — nunca um erro para o retry inofensivo.
   *
   * G8 1E: a conversão também registra "Contrato fechado" no histórico e
   * gera o `Benefício de indicação` de quem indicou (L2962), na MESMA
   * transação — fora dela, um retry criaria o cliente sem o benefício, ou o
   * benefício duas vezes (o `UNIQUE (lead_comercial_id)` é a rede embaixo).
   */
  async avancarEtapa(
    sessao: Sessao,
    leadId: string,
    etapa: EtapaDoLead,
    motivoPerda: string | null,
    proximoContato: string | null | undefined,
  ): Promise<LeadComercialNaLista> {
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      // `FOR UPDATE` (F-3): o segundo clique espera o primeiro terminar e
      // então lê o lead JÁ ganho — cai no ramo idempotente abaixo, em vez de
      // criar um segundo cliente. O `UNIQUE` em `clientes_carteira.
      // lead_origem_id` (0042) é a rede embaixo desta trava.
      const atual = await c.query<LinhaLead>(
        `SELECT ${colunasLead} FROM leads_comerciais WHERE id = $1 FOR UPDATE`,
        [leadId],
      )
      const lead = atual.rows[0]
      if (!lead) throw new LeadNaoEncontrado()

      // Idempotência: pedir "ganho" de novo para um lead já ganho não é erro.
      if (lead.etapa === etapa && etapa === 'ganho') {
        return leadParaContrato((await lerLeadCompleto(c, leadId, sessao))!, hoje)
      }

      // `as EtapaDoLead`: seguro porque o `CHECK` de `leads_comerciais.etapa`
      // (migration 0032) já restringe a coluna à mesma união do domínio.
      const validacao = validarTransicaoDeEtapa(lead.etapa as EtapaDoLead, etapa, motivoPerda)
      if (ehErro(validacao)) throw new TransicaoDeEtapaInvalida(validacao.erro.codigo, validacao.erro.mensagem)

      if (etapa === 'ganho') {
        // O grupo do cliente (appsec A-11): o do lead, quando ele tem — e
        // para escopo 'grupo' ele SEMPRE tem, o da sessão (a RLS só deixa o
        // usuário ver lead do próprio grupo). Lead sem grupo só existe para
        // escopo 'geral', e aí o cliente ganha um grupo PRÓPRIO, criado na
        // mesma transação pela função estreita do banco — nome derivado do
        // lead lá dentro, nunca da requisição.
        const grupoDoCliente =
          lead.grupo_id ??
          (
            await c.query<{ grupo: string }>(`SELECT criar_grupo_de_conversao($1) AS grupo`, [leadId])
          ).rows[0]!.grupo

        let cliente: { id: string }
        try {
          const rc = await c.query<{ id: string }>(
            `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status, lead_origem_id)
             VALUES ($1, NULL, $2, 'A definir no onboarding', 'onboarding', $3)
             RETURNING id`,
            [grupoDoCliente, lead.nome, leadId],
          )
          cliente = rc.rows[0]!
        } catch (e) {
          if (codigoPg(e) === FK_VIOLADA) throw new ReferenciaInexistente()
          throw e
        }
        await c.query(
          `UPDATE leads_comerciais
              SET etapa = 'ganho', cliente_carteira_id = $2, fechado_em = now()
            WHERE id = $1`,
          [leadId, cliente.id],
        )
        await registrarNoHistorico(c, sessao, leadId, lead.grupo_id, hoje, 'Contrato fechado.')
        await gerarBeneficioDaIndicacao(c, sessao, lead, grupoDoCliente)
        return leadParaContrato((await lerLeadCompleto(c, leadId, sessao))!, hoje)
      }

      await c.query(
        `UPDATE leads_comerciais
            SET etapa = $2,
                motivo_perda = CASE WHEN $2 = 'perdido' THEN $3 ELSE motivo_perda END,
                fechado_em = CASE WHEN $2 = 'perdido' THEN now() ELSE fechado_em END,
                proximo_contato = COALESCE($4, proximo_contato)
          WHERE id = $1`,
        [leadId, etapa, motivoPerda, proximoContato ?? null],
      )
      if (etapa === 'perdido') {
        await registrarNoHistorico(c, sessao, leadId, lead.grupo_id, hoje, `Perdido: ${motivoPerda ?? ''}`)
      }
      return leadParaContrato((await lerLeadCompleto(c, leadId, sessao))!, hoje)
    })
  }

  /**
   * "Marcar como perdido" (L2960): motivo obrigatório; com "tentar de novo
   * em", o lead vai para `espera` com o próximo contato marcado em vez de se
   * perder. Nos dois casos o motivo entra no histórico ("Perdido: …"), como
   * no protótipo — é ele que responde "por que perdemos esse".
   */
  async marcarPerdido(sessao: Sessao, leadId: string, dados: MarcarLeadPerdidoEntrada): Promise<LeadComercialNaLista> {
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await c.query<LinhaLead>(`SELECT ${colunasLead} FROM leads_comerciais WHERE id = $1 FOR UPDATE`, [
        leadId,
      ])
      const lead = atual.rows[0]
      if (!lead) throw new LeadNaoEncontrado()
      const decisao = decidirPerda(dados.motivo, dados.tentarDeNovoEm ?? null, hoje)
      if (ehErro(decisao)) throw new TransicaoDeEtapaInvalida(decisao.erro.codigo, decisao.erro.mensagem)
      const transicao = validarTransicaoDeEtapa(lead.etapa as EtapaDoLead, decisao.valor.etapa, dados.motivo)
      if (ehErro(transicao)) throw new TransicaoDeEtapaInvalida(transicao.erro.codigo, transicao.erro.mensagem)

      if (decisao.valor.etapa === 'perdido') {
        await c.query(
          `UPDATE leads_comerciais
              SET etapa = 'perdido', motivo_perda = $2, fechado_em = now(), proximo_contato = NULL
            WHERE id = $1`,
          [leadId, dados.motivo],
        )
      } else {
        await c.query(`UPDATE leads_comerciais SET etapa = 'espera', proximo_contato = $2 WHERE id = $1`, [
          leadId,
          decisao.valor.proximoContato,
        ])
      }
      await registrarNoHistorico(c, sessao, leadId, lead.grupo_id, hoje, `Perdido: ${dados.motivo}`)
      return leadParaContrato((await lerLeadCompleto(c, leadId, sessao))!, hoje)
    })
  }

  /**
   * "Registrar contato" (L2559-2565): interação + etapa + temperatura +
   * próximo contato numa transação só — o caminho de um toque que evita o
   * lead esquecido.
   *
   * Idempotente pela `chaveIdempotencia` (A-20): a mesma chave devolve o
   * contato JÁ gravado e o lead como está, sem reaplicar a mudança de etapa
   * nem criar um segundo contato. O protótipo não tem o conceito (grava de
   * novo a cada clique); aqui o duplo toque com o telefone na outra mão é o
   * caso comum.
   */
  async registrarContato(
    sessao: Sessao,
    leadId: string,
    dados: RegistrarContatoDoLeadEntrada,
  ): Promise<ContatoRegistradoSaida> {
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await c.query<LinhaLead>(`SELECT ${colunasLead} FROM leads_comerciais WHERE id = $1 FOR UPDATE`, [
        leadId,
      ])
      const lead = atual.rows[0]
      if (!lead) throw new LeadNaoEncontrado()

      const repetido = await c.query<LinhaInteracao>(
        `${SQL_INTERACAO} WHERE i.lead_comercial_id = $1 AND i.chave_idempotencia = $2`,
        [leadId, dados.chaveIdempotencia],
      )
      if (repetido.rows[0] !== undefined) {
        return {
          lead: leadParaContrato((await lerLeadCompleto(c, leadId, sessao))!, hoje),
          interacao: interacaoParaContrato(repetido.rows[0]),
        }
      }

      const v = validarRegistroDeContato({
        etapaAtual: lead.etapa as EtapaDoLead,
        etapaDepois: dados.etapa,
        data: dados.data,
        hoje,
        naoContatar: lead.nao_contatar,
        nota: dados.nota,
      })
      if (ehErro(v)) {
        if (v.erro.codigo === 'NAO_CONTATAR') throw new ContatoSuprimido(v.erro.mensagem)
        throw new TransicaoDeEtapaInvalida(v.erro.codigo, v.erro.mensagem)
      }

      const ins = await c.query<{ id: string }>(
        `INSERT INTO interacoes_do_lead
           (lead_comercial_id, grupo_id, canal, nota, por_usuario_gestao_id, data_do_contato, chave_idempotencia)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [leadId, lead.grupo_id, dados.canal, dados.nota, sessao.id, dados.data, dados.chaveIdempotencia],
      )
      const mudouParaPerdido = dados.etapa === 'perdido' && lead.etapa !== 'perdido'
      await c.query(
        `UPDATE leads_comerciais
            SET etapa = $2, temperatura = $3, proximo_contato = $4,
                motivo_perda = CASE WHEN $5 THEN $6 ELSE motivo_perda END,
                fechado_em = CASE WHEN $5 THEN now() ELSE fechado_em END
          WHERE id = $1`,
        [leadId, dados.etapa, dados.temperatura, dados.proximoContato, mudouParaPerdido, dados.nota],
      )
      const interacao = await c.query<LinhaInteracao>(`${SQL_INTERACAO} WHERE i.id = $1`, [ins.rows[0]!.id])
      return {
        lead: leadParaContrato((await lerLeadCompleto(c, leadId, sessao))!, hoje),
        interacao: interacaoParaContrato(interacao.rows[0]!),
      }
    })
  }

  /**
   * "Excluir" na tela é "Arquivar" — nunca `DELETE` (regra 20/27). Um lead
   * já convertido (tem `cliente_carteira_id`) nunca é arquivado (spec §6.3,
   * critério de aceite 4) — o `CHECK leads_nao_arquiva_convertido` já recusa
   * no banco; aqui a recusa vem ANTES, com mensagem clara.
   */
  async arquivarLead(sessao: Sessao, leadId: string): Promise<LeadComercialNaLista> {
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await c.query<LinhaLead>(`SELECT ${colunasLead} FROM leads_comerciais WHERE id = $1`, [leadId])
      const lead = atual.rows[0]
      if (!lead) throw new LeadNaoEncontrado()
      if (lead.cliente_carteira_id !== null) throw new LeadConvertidoNaoArquiva()
      if (lead.arquivado_em === null) {
        await c.query(`UPDATE leads_comerciais SET arquivado_em = now() WHERE id = $1`, [leadId])
      }
      return leadParaContrato((await lerLeadCompleto(c, leadId, sessao))!, hoje)
    })
  }

  /**
   * Exclusão a pedido do titular (LGPD A37). O lead é anonimizado pela
   * função estreita do banco — que também reescreve o texto das interações,
   * append-only para a aplicação — e o telefone só fica na lista de
   * supressão como HMAC. A contagem do funil não muda. Idempotente: pedir de
   * novo devolve o lead já anonimizado.
   */
  async excluirAPedido(sessao: Sessao, leadId: string): Promise<LeadComercialNaLista> {
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await c.query<{ whatsapp: string | null; cliente_carteira_id: string | null }>(
        `SELECT whatsapp, cliente_carteira_id FROM leads_comerciais WHERE id = $1`,
        [leadId],
      )
      const lead = atual.rows[0]
      if (!lead) throw new LeadNaoEncontrado()
      if (lead.cliente_carteira_id !== null) throw new LeadConvertidoNaoExclui()
      try {
        await c.query(`SELECT excluir_lead_a_pedido($1, $2)`, [leadId, hashDoTelefoneParaSupressao(lead.whatsapp)])
      } catch (e) {
        if (codigoPg(e) === 'P0002') throw new LeadNaoEncontrado()
        throw e
      }
      return leadParaContrato((await lerLeadCompleto(c, leadId, sessao))!, hoje)
    })
  }

  /* ──────────────────────────────────────────────────────────────────────
   * INTERAÇÃO DO LEAD — append-only (rotas do G5, mantidas)
   * ────────────────────────────────────────────────────────────────────── */

  async listarInteracoes(sessao: Sessao, leadId: string): Promise<InteracaoDoLeadNaLista[]> {
    const r = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, (c) =>
      c.query<LinhaInteracao>(
        `${SQL_INTERACAO} WHERE i.lead_comercial_id = $1 ORDER BY i.data_do_contato DESC, i.quando DESC`,
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
    const hoje = this.hoje()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const lead = await c.query<{ grupo_id: string | null; nao_contatar: boolean }>(
        `SELECT grupo_id, nao_contatar FROM leads_comerciais WHERE id = $1`,
        [leadId],
      )
      if (lead.rows[0] === undefined) throw new LeadNaoEncontrado()
      if (lead.rows[0].nao_contatar) throw new ContatoSuprimido('Este contato pediu para não ser contatado pela Firmare.')

      const r = await c.query<{ id: string }>(
        `INSERT INTO interacoes_do_lead (lead_comercial_id, grupo_id, canal, nota, por_usuario_gestao_id, data_do_contato)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [leadId, lead.rows[0].grupo_id, dados.canal, dados.nota, sessao.id, hoje],
      )
      const i = await c.query<LinhaInteracao>(`${SQL_INTERACAO} WHERE i.id = $1`, [r.rows[0]!.id])
      return interacaoParaContrato(i.rows[0]!)
    })
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Apoio, dentro da transação de quem chama.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * As pessoas da equipe que a sessão pode pôr como responsável — o mesmo
 * critério de `validarResponsavelDoMesmoGrupo`: escopo geral vê todas as
 * ativas; escopo grupo, só as do próprio grupo. `usuarios_gestao` não tem RLS
 * (é identidade, ADR 0011): este `WHERE` é o filtro.
 */
async function equipeVisivel(c: pg.PoolClient, sessao: Sessao): Promise<PessoaDaEquipeFirmare[]> {
  const r = await c.query<{ id: string; nome: string }>(
    `SELECT id, nome FROM usuarios_gestao
      WHERE ativo AND ($1 = 'geral' OR grupo_id = $2::uuid)
      ORDER BY nome`,
    [sessao.escopo, sessao.grupoId],
  )
  return r.rows
}

/** A-11 item 7: o cliente que indicou precisa ser visível pela sessão (RLS). Inexistente e "não é seu" respondem igual. */
async function exigirClienteIndicadorVisivel(c: pg.PoolClient, clienteId: string | null): Promise<void> {
  if (clienteId === null) return
  const r = await c.query(`SELECT 1 FROM clientes_carteira WHERE id = $1 AND excluido_em IS NULL`, [clienteId])
  if (r.rowCount === 0) throw new ClienteIndicadorInvalido()
}

/** A37: telefone de quem pediu exclusão não volta para a base, nem digitado de novo. */
async function exigirTelefoneNaoSuprimido(c: pg.PoolClient, telefone: string | null): Promise<void> {
  const hash = hashDoTelefoneParaSupressao(telefone)
  if (hash === null) return
  const r = await c.query<{ suprimido: boolean }>(`SELECT contato_de_lead_suprimido($1) AS suprimido`, [hash])
  if (r.rows[0]?.suprimido === true) {
    throw new ContatoSuprimido('Este contato pediu para não ser contatado pela Firmare e não pode voltar à base.')
  }
}

/** As linhas que o próprio sistema escreve no histórico (L2960, L2963). */
async function registrarNoHistorico(
  c: pg.PoolClient,
  sessao: Sessao,
  leadId: string,
  grupoId: string | null,
  hoje: string,
  nota: string,
): Promise<void> {
  await c.query(
    `INSERT INTO interacoes_do_lead (lead_comercial_id, grupo_id, canal, nota, por_usuario_gestao_id, data_do_contato)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [leadId, grupoId, CANAL_DE_REGISTRO, nota, sessao.id, hoje],
  )
}

/**
 * O benefício de quem indicou (L2962), com o percentual FOTOGRAFADO agora
 * (gate de números, ajuste 9).
 *
 * - Indicado por cliente da carteira: o benefício é dele, no grupo dele, e a
 *   próxima cobrança o consome (o job de geração já faz isso).
 * - Indicado por quem não é cliente: benefício GUARDADO — sem cliente, no
 *   grupo do cliente recém-convertido (que é quem a indicação trouxe) — até
 *   a pessoa virar cliente e alguém ligá-lo (D-22 item 11).
 *
 * Sem tarefa "Aplicar benefício" para a diretoria (L2963): aqui quem aplica
 * é a cobrança, automaticamente, e o protótipo marcava "concedido" à mão.
 * `ON CONFLICT` no `UNIQUE (lead_comercial_id)`: um lead, um benefício (A-20).
 */
async function gerarBeneficioDaIndicacao(
  c: pg.PoolClient,
  sessao: Sessao,
  lead: LinhaLead,
  grupoDoClienteConvertido: string,
): Promise<void> {
  let clienteId: string | null = null
  let grupoId = grupoDoClienteConvertido
  let indicadorNome: string | null = null

  if (lead.cliente_indicador_id !== null) {
    const ci = await c.query<{ grupo_id: string; nome: string }>(
      `SELECT grupo_id, nome FROM clientes_carteira WHERE id = $1`,
      [lead.cliente_indicador_id],
    )
    if (ci.rows[0] === undefined) throw new ClienteIndicadorInvalido()
    clienteId = lead.cliente_indicador_id
    grupoId = ci.rows[0].grupo_id
  } else {
    indicadorNome = quemIndicou({ nomeDoClienteIndicador: null, indicadoPor: lead.indicado_por })
    if (indicadorNome === null) return
  }

  const r = await c.query<{ id: string; percentual_centesimos: string }>(
    `INSERT INTO beneficios_de_indicacao
       (cliente_carteira_id, grupo_id, percentual_centesimos, lead_comercial_id, indicador_nome)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (lead_comercial_id) WHERE lead_comercial_id IS NOT NULL DO NOTHING
     RETURNING id, percentual_centesimos::text AS percentual_centesimos`,
    [clienteId, grupoId, (await percentualDoBeneficioDeIndicacao(c)).toString(), lead.id, indicadorNome],
  )
  const criado = r.rows[0]
  if (criado === undefined) return
  await gravarAuditoriaDaCarteira(c, {
    usuarioGestaoId: sessao.id,
    grupoId,
    tabela: 'beneficios_de_indicacao',
    registroId: criado.id,
    acao: 'criar',
    de: null,
    para: {
      cliente_carteira_id: clienteId,
      lead_comercial_id: lead.id,
      percentual_centesimos: criado.percentual_centesimos,
      guardado: clienteId === null,
    },
  })
}

async function beneficioDoLead(c: pg.PoolClient, leadId: string): Promise<BeneficioDeIndicacaoNaTela | null> {
  const r = await c.query<LinhaBeneficioNaTela>(`${SQL_BENEFICIO_NA_TELA} WHERE b.lead_comercial_id = $1`, [leadId])
  const [b] = await beneficiosNaTela(c, r.rows)
  return b ?? null
}

/* ────────────────────────────────────────────────────────────────────────
 * Linhas cruas ↔ contrato. Um ponto só por entidade.
 *
 * Os `as` abaixo (`l.etapa as EtapaDoLead` etc.) convertem `text` de volta
 * para a união estreita do contrato. Não são um "confia em mim" solto: o
 * `CHECK` da migration 0032, na MESMA coluna, já recusa qualquer valor fora
 * da união no `INSERT`/`UPDATE` — o banco é quem garante a invariante, o
 * `as` só descreve para o TypeScript o que o `CHECK` já tornou verdade.
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
  especialidade: string | null
  clinica: string | null
  cidade: string | null
  whatsapp: string | null
  instagram: string | null
  cliente_indicador_id: string | null
  indicado_por: string | null
  valor_estimado_centavos: string | null
  recebida_em: string
  observacoes: string | null
  nao_contatar: boolean
  excluido_a_pedido_em: Date | null
}
const colunasLead =
  'id, nome, grupo_id, responsavel_usuario_gestao_id, origem, etapa, temperatura, ' +
  'produto_interesse, proximo_contato::text, cliente_carteira_id, motivo_perda, ' +
  'fechado_em, arquivado_em, criado_em, especialidade, clinica, cidade, whatsapp, instagram, ' +
  'cliente_indicador_id, indicado_por, valor_estimado_centavos::text, recebida_em::text, ' +
  'observacoes, nao_contatar, excluido_a_pedido_em'

type LinhaLeadCompleta = LinhaLead & {
  nome_do_cliente_indicador: string | null
  ultimo_contato: string | null
}
const SQL_LEAD_COMPLETO = `
  SELECT ${colunasLead
    .split(', ')
    .map((x) => `l.${x.trim()}`)
    .join(', ')},
         ci.nome AS nome_do_cliente_indicador,
         (SELECT max(i.data_do_contato)::text FROM interacoes_do_lead i WHERE i.lead_comercial_id = l.id) AS ultimo_contato
    FROM leads_comerciais l
    LEFT JOIN clientes_carteira ci ON ci.id = l.cliente_indicador_id`

async function lerLeadCompleto(c: pg.PoolClient, leadId: string, sessao: Sessao): Promise<LinhaLeadCompleta | null> {
  const responsavel = responsavelImpostoPelaCarteira(sessao)
  const r = await c.query<LinhaLeadCompleta>(
    `${SQL_LEAD_COMPLETO} WHERE l.id = $1 AND ($2::uuid IS NULL OR l.responsavel_usuario_gestao_id = $2)`,
    [leadId, responsavel],
  )
  return r.rows[0] ?? null
}

const leadParaContrato = (l: LinhaLeadCompleta, hoje: string): LeadComercialNaLista => {
  const etapa = l.etapa as EtapaDoLead
  const temperatura = l.temperatura as TemperaturaDoLead
  return {
    id: l.id,
    nome: l.nome,
    grupoId: l.grupo_id,
    responsavelUsuarioGestaoId: l.responsavel_usuario_gestao_id,
    origem: l.origem,
    etapa,
    temperatura,
    produtoInteresse: l.produto_interesse,
    proximoContato: l.proximo_contato,
    clienteCarteiraId: l.cliente_carteira_id,
    motivoPerda: l.motivo_perda,
    fechadoEm: l.fechado_em?.toISOString() ?? null,
    arquivadoEm: l.arquivado_em?.toISOString() ?? null,
    criadoEm: l.criado_em.toISOString(),
    especialidade: l.especialidade,
    clinica: l.clinica,
    cidade: l.cidade,
    whatsapp: l.whatsapp,
    instagram: l.instagram,
    clienteIndicadorId: l.cliente_indicador_id,
    nomeDoClienteIndicador: l.nome_do_cliente_indicador,
    indicadoPor: l.indicado_por,
    quemIndicou: quemIndicou({ nomeDoClienteIndicador: l.nome_do_cliente_indicador, indicadoPor: l.indicado_por }),
    valorEstimado: l.valor_estimado_centavos,
    recebidaEm: l.recebida_em,
    observacoes: l.observacoes,
    naoContatar: l.nao_contatar,
    excluidoAPedido: l.excluido_a_pedido_em !== null,
    ultimoContato: l.ultimo_contato,
    sinal:
      l.arquivado_em === null
        ? sinalDoLead(
            {
              etapa,
              temperatura,
              recebidaEm: l.recebida_em,
              proximoContato: l.proximo_contato,
              ultimoContato: l.ultimo_contato,
              indicadoPorCliente: l.cliente_indicador_id !== null,
              naoContatar: l.nao_contatar,
            },
            hoje,
          )
        : null,
    linkDoWhatsApp: l.nao_contatar ? null : linkDoWhatsApp(l.whatsapp),
  }
}

type LinhaInteracao = {
  id: string
  lead_comercial_id: string
  quando: Date
  data_do_contato: string
  canal: string
  nota: string
  por_usuario_gestao_id: string
  por_nome: string | null
}
const SQL_INTERACAO = `
  SELECT i.id, i.lead_comercial_id, i.quando, i.data_do_contato::text AS data_do_contato, i.canal, i.nota,
         i.por_usuario_gestao_id, u.nome AS por_nome
    FROM interacoes_do_lead i
    LEFT JOIN usuarios_gestao u ON u.id = i.por_usuario_gestao_id`
const interacaoParaContrato = (i: LinhaInteracao): InteracaoDoLeadNaLista => ({
  id: i.id,
  leadComercialId: i.lead_comercial_id,
  quando: i.quando.toISOString(),
  dataDoContato: i.data_do_contato,
  canal: i.canal,
  nota: i.nota,
  porUsuarioGestaoId: i.por_usuario_gestao_id,
  porNome: i.por_nome,
})
