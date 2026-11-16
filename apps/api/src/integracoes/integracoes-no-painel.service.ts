import type {
  IntegracaoNoPainel,
  LigacoesDaIntegracaoEntrada,
  StatusDeCanceladoEntrada,
  TermoDeIntegracaoEntrada,
} from '@fir/contracts'
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { novaFilaDaAgenda } from '../agenda/fila-agenda'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import type { OperadorId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { registrarNoPainel } from '../painel/painel.service'
import { SeloDeIntegracoes } from './cofre-de-integracoes'
import { JOB_TESTAR_INTEGRACAO } from './jobs'

/**
 * A INTEGRAÇÃO DA CLÍNICA, escrita pelo superadmin (spec `integracao-medx.md` A, ticket T1).
 *
 * Tudo roda em `comoPainel(clinica)`: a RLS da clínica vale para o operador
 * como para qualquer um, e a trigger grava a trilha DA CLÍNICA (com o segredo
 * e a impressão ocultos pela denylist). A trilha do painel recebe a mesma
 * mudança, só com campos que podem atravessar.
 *
 * A API SELA a chave e nunca a abre — não tem a privada (gate S-2). Quem
 * testa a conexão é o worker (S-1): aqui só se enfileira o pedido, com ids.
 */

export const PROVEDOR = 'medx'
/** Escopos que habilitam o faturamento (G2: a fonte se decide na calibração C.0). */
const ESCOPOS_DE_FINANCAS = ['lancamentos:read', 'faturas:read'] as const

export class ChaveEmOutraClinica extends Error {}
export class SemChave extends Error {}
export class SemTermo extends Error {}
export class SemVerificacao extends Error {}
export class SemEscopoDeFinancas extends Error {}
/** B5: o escopo de finanças só com o faturamento ligado. */
export class EscopoDeFinancasSemFaturamento extends Error {}
export class MaisDeUmaUnidade extends Error {}
/** B.9: a clínica lê a agenda pelo link iCal; o MedX não liga por cima (cartões em dobro). */
export class AgendaPorIcalLigada extends Error {}
/** Os cartões da agenda precisam de um responsável: a clínica sem administrador ativo não liga. */
export class SemResponsavelDaAgenda extends Error {}
export class TesteCedoDemais extends Error {
  constructor(readonly esperaEmSegundos: number) {
    super()
  }
}

/** O pedido do teste vai para o worker com ids e nada mais (S-1). */
export interface PedidoDeTesteDeIntegracao {
  pedir(clinicaId: string, pedidoId: string): Promise<void>
}
export const PEDIDO_DE_TESTE_DE_INTEGRACAO = Symbol('PEDIDO_DE_TESTE_DE_INTEGRACAO')

@Injectable()
export class PedidoDeTestePelaFila implements PedidoDeTesteDeIntegracao, OnModuleDestroy {
  private fila: Queue | null = null
  async pedir(clinicaId: string, pedidoId: string): Promise<void> {
    this.fila ??= novaFilaDaAgenda()
    await this.fila.add(
      JOB_TESTAR_INTEGRACAO,
      { clinicaId, pedidoId },
      { jobId: `testar-${clinicaId}`, removeOnComplete: true, removeOnFail: { count: 20 } },
    )
  }
  async onModuleDestroy(): Promise<void> {
    await this.fila?.close()
  }
}

type Linha = {
  id: string
  final_da_chave: string | null
  termo_assinado_em: string | null
  termo_assinado_por: string | null
  termo_versao: string | null
  verificacao: 'sem_chave' | 'nao_verificada' | 'ok' | 'recusada'
  verificacao_pedida_em: Date | null
  verificada_em: Date | null
  usuario_externo_nome: string | null
  conta_externa_id: string | null
  escopos: string[]
  unidades_externas: number
  ultimo_erro: string
  agenda_ligada: boolean
  faturamento_ligado: boolean
  status_de_cancelado: number[]
}

// Nunca `segredo_cifrado` (o painel nem tem SELECT nele) nem a impressão.
const COLUNAS = `id, final_da_chave, termo_assinado_em::text AS termo_assinado_em, termo_assinado_por,
  termo_versao, verificacao, verificacao_pedida_em, verificada_em, usuario_externo_nome,
  conta_externa_id, escopos, unidades_externas, ultimo_erro, agenda_ligada, faturamento_ligado,
  status_de_cancelado`

const UNICIDADE_VIOLADA = '23505'

const SO_FIR: IntegracaoNoPainel = {
  provedor: 'so_fir',
  estado: 'sem_chave',
  finalDaChave: null,
  verificadaEm: null,
  usuarioExterno: null,
  contaExterna: null,
  escopos: [],
  unidades: 0,
  ligadoAgenda: false,
  ligadoFaturamento: false,
  statusDeCancelado: [],
  termo: null,
  ultimoErro: '',
}

function paraOPainel(l: Linha | undefined): IntegracaoNoPainel {
  if (l === undefined) return SO_FIR
  const pedida =
    l.verificacao !== 'sem_chave' &&
    l.verificacao_pedida_em !== null &&
    (l.verificada_em === null || l.verificacao_pedida_em > l.verificada_em)
  return {
    provedor: l.final_da_chave === null ? 'so_fir' : 'medx',
    estado: pedida ? 'pedida' : l.verificacao,
    finalDaChave: l.final_da_chave,
    verificadaEm: l.verificada_em?.toISOString() ?? null,
    usuarioExterno: l.usuario_externo_nome,
    contaExterna: l.conta_externa_id,
    escopos: l.escopos,
    unidades: l.unidades_externas,
    ligadoAgenda: l.agenda_ligada,
    ligadoFaturamento: l.faturamento_ligado,
    statusDeCancelado: l.status_de_cancelado,
    termo:
      l.termo_assinado_em === null
        ? null
        : { assinadoEm: l.termo_assinado_em, assinadoPor: l.termo_assinado_por!, versao: l.termo_versao! },
    ultimoErro: l.ultimo_erro,
  }
}

/** O que atravessa para a trilha do painel: estado, nunca segredo nem impressão. */
const resumoParaTrilha = (l: Linha) => ({
  final_da_chave: l.final_da_chave,
  verificacao: l.verificacao,
  agenda_ligada: l.agenda_ligada,
  faturamento_ligado: l.faturamento_ligado,
  termo_versao: l.termo_versao,
})

@Injectable()
export class IntegracoesNoPainelService {
  private readonly selo = SeloDeIntegracoes.doAmbiente()
  // S-12. Em memória: a API é um processo só (ver `LimitePorOrigem`).
  private readonly testeCurto = new LimitePorOrigem(1, 30_000)
  private readonly testeLongo = new LimitePorOrigem(10, 3_600_000)

  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(PEDIDO_DE_TESTE_DE_INTEGRACAO) private readonly pedido: PedidoDeTesteDeIntegracao,
  ) {}

  async ler(clinicaId: ClinicaId, ator: OperadorId): Promise<IntegracaoNoPainel> {
    return this.banco.comoPainel(clinicaId, ator, async (c) => paraOPainel(await this.linha(c)))
  }

  /**
   * Colar a chave (nova ou trocada). Trocar esquece tudo o que valia para a
   * chave anterior: a conta do MedX, os escopos e as ligações — a chave nova
   * pode ser de outro usuário, e só um teste verde volta a ligar (A.5).
   */
  async gravarChave(clinicaId: ClinicaId, ator: OperadorId, chave: string): Promise<IntegracaoNoPainel> {
    const { cifrado, versao } = this.selo.selar(clinicaId, PROVEDOR, chave)
    const impressao = this.selo.impressao(PROVEDOR, chave)
    const final = SeloDeIntegracoes.finalDaChave(chave)
    return this.banco.comoPainel(clinicaId, ator, async (c) => {
      const antes = await this.linha(c)
      let depois: Linha
      try {
        const r = await c.query<Linha>(
          `INSERT INTO integracoes_da_clinica
             (clinica_id, provedor, segredo_cifrado, segredo_versao, final_da_chave, impressao_da_chave,
              verificacao)
           VALUES ($1, $2, $3, $4, $5, $6, 'nao_verificada')
           ON CONFLICT (clinica_id) DO UPDATE SET
             segredo_cifrado = $3, segredo_versao = $4, final_da_chave = $5, impressao_da_chave = $6,
             verificacao = 'nao_verificada', verificacao_pedida_em = NULL, verificada_em = NULL,
             usuario_externo_nome = NULL, conta_externa_id = NULL, escopos = '{}',
             unidades_externas = 0, ultimo_erro = '', agenda_ligada = false,
             faturamento_ligado = false, atualizada_em = now()
           RETURNING ${COLUNAS}`,
          [clinicaId, PROVEDOR, cifrado, versao, final, impressao],
        )
        depois = r.rows[0]!
      } catch (e) {
        const erro = e as { code?: string; constraint?: string }
        if (erro.code === UNICIDADE_VIOLADA && erro.constraint === 'integracao_chave_unica') {
          throw new ChaveEmOutraClinica()
        }
        throw e
      }
      await desligarAgendaDoMedx(c)
      await this.trilha(c, ator, antes === undefined ? 'criou' : 'alterou', depois.id, antes, depois,
        antes?.final_da_chave ? 'chave trocada' : 'chave cadastrada')
      return paraOPainel(depois)
    })
  }

  /**
   * Remover APAGA o segredo (NULL), não só desliga (A.7). O termo fica: ele é
   * prova do que foi autorizado, com retenção própria.
   */
  async removerChave(clinicaId: ClinicaId, ator: OperadorId): Promise<IntegracaoNoPainel> {
    return this.banco.comoPainel(clinicaId, ator, async (c) => {
      const antes = await this.linha(c)
      if (antes === undefined) return SO_FIR
      const r = await c.query<Linha>(
        `UPDATE integracoes_da_clinica SET
           segredo_cifrado = NULL, segredo_versao = NULL, final_da_chave = NULL, impressao_da_chave = NULL,
           verificacao = 'sem_chave', verificacao_pedida_em = NULL, verificada_em = NULL,
           usuario_externo_nome = NULL, conta_externa_id = NULL, escopos = '{}', unidades_externas = 0,
           ultimo_erro = '', agenda_ligada = false, faturamento_ligado = false, atualizada_em = now()
         WHERE clinica_id = $1 RETURNING ${COLUNAS}`,
        [clinicaId],
      )
      const depois = r.rows[0]!
      await desligarAgendaDoMedx(c)
      await this.trilha(c, ator, 'removeu', depois.id, antes, depois, 'chave removida')
      return paraOPainel(depois)
    })
  }

  async registrarTermo(
    clinicaId: ClinicaId,
    ator: OperadorId,
    termo: TermoDeIntegracaoEntrada,
  ): Promise<IntegracaoNoPainel> {
    return this.banco.comoPainel(clinicaId, ator, async (c) => {
      const antes = await this.linha(c)
      const r = await c.query<Linha>(
        `INSERT INTO integracoes_da_clinica (clinica_id, provedor, termo_assinado_em, termo_assinado_por, termo_versao)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (clinica_id) DO UPDATE SET
           termo_assinado_em = $3, termo_assinado_por = $4, termo_versao = $5, atualizada_em = now()
         RETURNING ${COLUNAS}`,
        [clinicaId, PROVEDOR, termo.assinadoEm, termo.assinadoPor, termo.versao],
      )
      const depois = r.rows[0]!
      await this.trilha(c, ator, antes === undefined ? 'criou' : 'alterou', depois.id, antes, depois,
        `termo ${termo.versao} assinado em ${termo.assinadoEm}`)
      return paraOPainel(depois)
    })
  }

  /** Desligar é sempre permitido. Ligar exige chave, termo, teste verde e, para o faturamento, o escopo (A.0, A.3). */
  async ligar(
    clinicaId: ClinicaId,
    ator: OperadorId,
    ligacoes: LigacoesDaIntegracaoEntrada,
  ): Promise<IntegracaoNoPainel> {
    return this.banco.comoPainel(clinicaId, ator, async (c) => {
      const antes = await this.linha(c, true)
      const ligando = ligacoes.agenda || ligacoes.faturamento
      if (ligando) {
        if (antes === undefined || antes.final_da_chave === null) throw new SemChave()
        if (antes.termo_assinado_em === null) throw new SemTermo()
        if (antes.verificacao !== 'ok' || antes.conta_externa_id === null) throw new SemVerificacao()
        if (antes.unidades_externas > 1) throw new MaisDeUmaUnidade()
        const temFinancas = ESCOPOS_DE_FINANCAS.some((e) => antes.escopos.includes(e))
        if (ligacoes.faturamento && !temFinancas) throw new SemEscopoDeFinancas()
        if (!ligacoes.faturamento && temFinancas) throw new EscopoDeFinancasSemFaturamento()
      }
      if (antes === undefined) return SO_FIR
      if (ligacoes.agenda) await ligarAgendaDoMedx(c, clinicaId)
      else await desligarAgendaDoMedx(c)
      const r = await c.query<Linha>(
        `UPDATE integracoes_da_clinica SET agenda_ligada = $2, faturamento_ligado = $3, atualizada_em = now()
          WHERE clinica_id = $1 RETURNING ${COLUNAS}`,
        [clinicaId, ligacoes.agenda, ligacoes.faturamento],
      )
      const depois = r.rows[0]!
      await this.trilha(c, ator, 'alterou', depois.id, antes, depois)
      return paraOPainel(depois)
    })
  }

  /** Os status do MedX que significam "cancelado" (B.8). Sem chave, nada a configurar. */
  async definirStatusDeCancelado(
    clinicaId: ClinicaId,
    ator: OperadorId,
    entrada: StatusDeCanceladoEntrada,
  ): Promise<IntegracaoNoPainel> {
    return this.banco.comoPainel(clinicaId, ator, async (c) => {
      const antes = await this.linha(c, true)
      if (antes === undefined || antes.final_da_chave === null) throw new SemChave()
      const codigos = [...new Set(entrada.codigos)].sort((a, b) => a - b)
      const r = await c.query<Linha>(
        `UPDATE integracoes_da_clinica SET status_de_cancelado = $2, atualizada_em = now()
          WHERE clinica_id = $1 RETURNING ${COLUNAS}`,
        [clinicaId, codigos],
      )
      const depois = r.rows[0]!
      await this.trilha(c, ator, 'alterou', depois.id, antes, depois, `status de cancelado: ${codigos.join(', ') || 'nenhum'}`)
      return paraOPainel(depois)
    })
  }

  /** Marca o pedido e enfileira, só com ids. Quem fala com o MedX é o worker (S-1). */
  async pedirTeste(clinicaId: ClinicaId, ator: OperadorId): Promise<IntegracaoNoPainel> {
    const pedidoId = randomUUID()
    const saida = await this.banco.comoPainel(clinicaId, ator, async (c) => {
      const antes = await this.linha(c, true)
      if (antes === undefined || antes.final_da_chave === null) throw new SemChave()
      // O limite conta só pedido que iria de fato ao MedX: "sem chave" não gasta a vez.
      // 1 a cada 30 s por clínica; 10 por hora por clínica E por operador.
      const daClinica = `clinica:${clinicaId}`
      if (!this.testeCurto.registrar(daClinica)) throw new TesteCedoDemais(this.testeCurto.esperaEmSegundos(daClinica))
      for (const k of [daClinica, `operador:${ator.id}`]) {
        if (!this.testeLongo.registrar(k)) throw new TesteCedoDemais(this.testeLongo.esperaEmSegundos(k))
      }
      const r = await c.query<Linha>(
        `UPDATE integracoes_da_clinica SET verificacao_pedida_em = now(), atualizada_em = now()
          WHERE clinica_id = $1 RETURNING ${COLUNAS}`,
        [clinicaId],
      )
      return paraOPainel(r.rows[0]!)
    })
    await this.pedido.pedir(clinicaId, pedidoId)
    return saida
  }

  private async linha(c: pg.PoolClient, travar = false): Promise<Linha | undefined> {
    const r = await c.query<Linha>(
      `SELECT ${COLUNAS} FROM integracoes_da_clinica ${travar ? 'FOR UPDATE' : ''}`,
    )
    return r.rows[0]
  }

  private async trilha(
    c: pg.PoolClient,
    ator: OperadorId,
    acao: 'criou' | 'alterou' | 'removeu',
    id: string,
    antes: Linha | undefined,
    depois: Linha,
    motivo?: string,
  ): Promise<void> {
    await registrarNoPainel(c, {
      atorTipo: 'operador',
      atorId: ator.id,
      acao,
      entidade: 'integracoes_da_clinica',
      entidadeId: id,
      // Sem `de` na criação: `auditoria_sem_segredos` recusa um jsonb escalar (`null`).
      ...(antes === undefined ? {} : { de: resumoParaTrilha(antes) }),
      para: resumoParaTrilha(depois),
      ...(motivo === undefined ? {} : { motivo }),
    })
  }
}

/**
 * Ligar a agenda do MedX é dizer, na linha ÚNICA de `agendas_externas` da
 * clínica, que o provedor é o MedX (spec B.9, S-14). Com o iCal ativo, recusa:
 * as duas fontes criariam o mesmo cartão duas vezes. O responsável pelos
 * cartões fica o da linha existente; sem linha, o administrador ativo mais antigo
 * (a clínica não troca isso pela tela dela enquanto o MedX estiver ligado, D.1).
 */
async function ligarAgendaDoMedx(c: pg.PoolClient, clinicaId: ClinicaId): Promise<void> {
  const r = await c.query<{ provedor: string; ativa: boolean }>('SELECT provedor, ativa FROM agendas_externas FOR UPDATE')
  const atual = r.rows[0]
  if (atual?.provedor === 'ical' && atual.ativa) throw new AgendaPorIcalLigada()
  if (atual !== undefined) {
    await c.query(
      `UPDATE agendas_externas SET
         provedor = 'medx', url_secreta = NULL, ativa = true, atualizada_em = now(),
         ultimo_erro = CASE WHEN provedor = 'medx' THEN ultimo_erro ELSE '' END,
         ultimo_resumo = CASE WHEN provedor = 'medx' THEN ultimo_resumo ELSE NULL END`,
    )
    return
  }
  const adm = await c.query<{ id: string }>(
    'SELECT id FROM pessoas WHERE ativo AND admin ORDER BY criada_em, id LIMIT 1',
  )
  if (adm.rows[0] === undefined) throw new SemResponsavelDaAgenda()
  await c.query(
    `INSERT INTO agendas_externas (clinica_id, provedor, url_secreta, responsavel_id, ativa)
     VALUES ($1, 'medx', NULL, $2, true)`,
    [clinicaId, adm.rows[0].id],
  )
}

async function desligarAgendaDoMedx(c: pg.PoolClient): Promise<void> {
  await c.query(
    `UPDATE agendas_externas SET ativa = false, atualizada_em = now() WHERE provedor = 'medx' AND ativa`,
  )
}
