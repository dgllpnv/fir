import type { LeituraDaMetricaNaSaida, PlanilhaDefinidaSaida, PlanilhaDoClienteNaSaida, UsuarioDeGestaoPublico } from '@fir/contracts'
import {
  temPermCarteira,
  type AbaInterpretada,
  type LinhaDaFrente,
  PLANILHA_DE_INDICADORES,
  type PlanilhaInterpretada,
  type RacionalDaPlanilha,
  type Relogio,
  type UnidadeDaMetricaDaPlanilha,
  diaCivil,
  idDaPlanilha,
  leituraDaMetrica,
  resumirPlanilha,
  segundaDaSemanaDaPlanilha,
  somarDias,
} from '@fir/domain'
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO } from '../../comum/relogio'
import { gravarAuditoriaDaCarteira } from '../financeiro/auditoria-da-carteira'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
import { novaFilaDePlanilhas, pedirLeituraDaPlanilha } from './fila-planilhas'

/** O seam do "Ler planilha agora": em produção, a fila; no teste, um registro. */
export interface PedidoDeLeituraDaPlanilha {
  pedir(clienteCarteiraId: string): Promise<void>
}
export const PEDIDO_DE_LEITURA_DA_PLANILHA = Symbol('fir.pedido-de-leitura-da-planilha')

/** A fila só abre no primeiro pedido: a API serve a carteira mesmo com o Redis fora. */
export class PedidoPelaFilaDePlanilhas implements PedidoDeLeituraDaPlanilha, OnModuleDestroy {
  private fila: Queue | null = null
  async pedir(clienteCarteiraId: string): Promise<void> {
    this.fila ??= novaFilaDePlanilhas()
    await pedirLeituraDaPlanilha(this.fila, clienteCarteiraId)
  }
  async onModuleDestroy(): Promise<void> {
    await this.fila?.close()
  }
}

export class ClienteNaoEncontradoParaPlanilha extends Error {}
export class SemPermissaoParaLinkDaPlanilha extends Error {}
export class LinkDePlanilhaInvalido extends Error {}
export class PlanilhaDeOutroCliente extends Error {}
export class ClienteSemPlanilha extends Error {}
export class LeituraPedidaHaPouco extends Error {}

/** "Ler planilha agora" no máximo uma vez por minuto por cliente (A-16: enfileira, com limite). */
export const INTERVALO_MINIMO_ENTRE_PEDIDOS_MS = 60_000

type LinhaDaPlanilha = {
  id: string
  spreadsheet_id: string
  link: string
  lida_em: Date | null
  leitura_pedida_em: Date | null
  resultado: unknown
  erro: string | null
}

/**
 * **QUEM GRAVA O LINK (A-16, deputado confuso).** Até existir a chave
 * `carteira.administrar` (ticket 0.5), só o `Usuário de Gestão` de escopo
 * `geral` — a equipe da Firmare, que já enxerga todos os grupos e por isso
 * não ganha nada colando a planilha de um cliente no outro. O de escopo
 * `grupo` pode ser alguém do lado da rede-cliente (gate A-5, ainda sem
 * resposta), e negar por padrão é o que o gate manda. Quando a 0.5 chegar,
 * esta função vira `escopo === 'geral' && temPermCarteira(u, 'carteira.administrar')`
 * — e só ela muda.
 */
export const podeGravarLinkDaPlanilha = (u: UsuarioDeGestaoPublico): boolean =>
  u.escopo === 'geral' && temPermCarteira(u, 'carteira.administrar')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A planilha de indicadores do `Cliente Firmare`: gravar o link, pedir a
 * leitura e devolver a situação por frente e semana. A LEITURA em si é do
 * worker (`ler-planilhas.ts`): nenhuma requisição fala com o Google.
 */
@Injectable()
export class PlanilhasCarteiraService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(PEDIDO_DE_LEITURA_DA_PLANILHA) private readonly pedido: PedidoDeLeituraDaPlanilha,
  ) {}

  async definirLink(usuario: UsuarioDeGestaoPublico, clienteCarteiraId: string, link: string): Promise<PlanilhaDefinidaSaida> {
    if (!podeGravarLinkDaPlanilha(usuario)) throw new SemPermissaoParaLinkDaPlanilha()
    if (!UUID.test(clienteCarteiraId)) throw new ClienteNaoEncontradoParaPlanilha()
    const id = idDaPlanilha(link)
    if (id.tipo === 'erro') throw new LinkDePlanilhaInvalido(id.erro.mensagem)
    const spreadsheetId = id.valor
    const linkLimpo = link.trim()
    try {
      return await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuario, async (c) => {
        const cliente = await c.query<{ grupo_id: string }>(
          'SELECT grupo_id FROM clientes_carteira WHERE id = $1 AND excluido_em IS NULL',
          [clienteCarteiraId],
        )
        const grupoId = cliente.rows[0]?.grupo_id
        if (grupoId === undefined) throw new ClienteNaoEncontradoParaPlanilha()
        const antes = await c.query<{ id: string; spreadsheet_id: string; link: string }>(
          'SELECT id, spreadsheet_id, link FROM planilhas_do_cliente WHERE cliente_carteira_id = $1 FOR UPDATE',
          [clienteCarteiraId],
        )
        const anterior = antes.rows[0]
        const agora = this.relogio.agora()
        let registroId: string
        let trocou: boolean
        if (anterior === undefined) {
          const r = await c.query<{ id: string }>(
            `INSERT INTO planilhas_do_cliente (cliente_carteira_id, grupo_id, spreadsheet_id, link, criado_em, atualizado_em)
             VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
            [clienteCarteiraId, grupoId, spreadsheetId, linkLimpo, agora],
          )
          registroId = r.rows[0]!.id
          trocou = true
        } else {
          trocou = anterior.spreadsheet_id !== spreadsheetId
          // Planilha nova: a fotografia da velha não vale mais nada para este cliente.
          await c.query(
            trocou
              ? `UPDATE planilhas_do_cliente
                    SET spreadsheet_id = $2, link = $3, atualizado_em = $4,
                        resultado = NULL, lida_em = NULL, erro = NULL, leitura_pedida_em = NULL
                  WHERE id = $1`
              : 'UPDATE planilhas_do_cliente SET spreadsheet_id = $2, link = $3, atualizado_em = $4 WHERE id = $1',
            [anterior.id, spreadsheetId, linkLimpo, agora],
          )
          registroId = anterior.id
        }
        if (anterior === undefined || anterior.link !== linkLimpo) {
          await gravarAuditoriaDaCarteira(c, {
            usuarioGestaoId: usuario.id,
            grupoId,
            tabela: 'planilhas_do_cliente',
            registroId,
            acao: anterior === undefined ? 'criar' : 'atualizar',
            de: anterior === undefined ? null : { spreadsheet_id: anterior.spreadsheet_id, link: anterior.link },
            para: { spreadsheet_id: spreadsheetId, link: linkLimpo },
          })
        }
        return { link: linkLimpo, trocou }
      })
    } catch (e) {
      // O índice único global (A-16) recusa o id que já está em outro
      // cliente — de qualquer grupo. A resposta não diz qual.
      if (ehViolacaoDeUnicidade(e, 'planilhas_do_cliente_spreadsheet_unico')) throw new PlanilhaDeOutroCliente()
      throw e
    }
  }

  async pedirLeitura(usuario: UsuarioDeGestaoPublico, clienteCarteiraId: string): Promise<{ pedida: true }> {
    if (!UUID.test(clienteCarteiraId)) throw new ClienteNaoEncontradoParaPlanilha()
    await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuario, async (c) => {
      const cliente = await c.query('SELECT 1 FROM clientes_carteira WHERE id = $1 AND excluido_em IS NULL', [
        clienteCarteiraId,
      ])
      if (cliente.rowCount === 0) throw new ClienteNaoEncontradoParaPlanilha()
      const r = await c.query<{ leitura_pedida_em: Date | null }>(
        'SELECT leitura_pedida_em FROM planilhas_do_cliente WHERE cliente_carteira_id = $1 FOR UPDATE',
        [clienteCarteiraId],
      )
      const linha = r.rows[0]
      if (linha === undefined) throw new ClienteSemPlanilha()
      const agora = this.relogio.agora()
      if (
        linha.leitura_pedida_em !== null &&
        agora.getTime() - linha.leitura_pedida_em.getTime() < INTERVALO_MINIMO_ENTRE_PEDIDOS_MS
      ) {
        throw new LeituraPedidaHaPouco()
      }
      await c.query('UPDATE planilhas_do_cliente SET leitura_pedida_em = $2 WHERE cliente_carteira_id = $1', [
        clienteCarteiraId,
        agora,
      ])
    })
    // Depois do COMMIT: o worker que pegar o job já vê o pedido gravado.
    await this.pedido.pedir(clienteCarteiraId)
    return { pedida: true }
  }

  async situacao(usuario: UsuarioDeGestaoPublico, clienteCarteiraId: string, nSemanas: number): Promise<PlanilhaDoClienteNaSaida> {
    if (!UUID.test(clienteCarteiraId)) throw new ClienteNaoEncontradoParaPlanilha()
    const linha = await this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, async (c) => {
      const cliente = await c.query('SELECT 1 FROM clientes_carteira WHERE id = $1 AND excluido_em IS NULL', [
        clienteCarteiraId,
      ])
      if (cliente.rowCount === 0) throw new ClienteNaoEncontradoParaPlanilha()
      const r = await c.query<LinhaDaPlanilha>(
        `SELECT id, spreadsheet_id, link, lida_em, leitura_pedida_em, resultado, erro
           FROM planilhas_do_cliente WHERE cliente_carteira_id = $1`,
        [clienteCarteiraId],
      )
      return r.rows[0] ?? null
    })

    // "Semana passada" é data de negócio da Firmare: hoje do SERVIDOR (regra 24) no fuso da carteira.
    const hoje = diaCivil(this.relogio.agora(), FUSO_DA_CARTEIRA)
    const referencia = somarDias(segundaDaSemanaDaPlanilha(hoje), -7)
    const planilha = planilhaDoJson(linha?.resultado) ?? { abas: [] }
    const resumo = resumirPlanilha(planilha, referencia, nSemanas)
    const semanas = resumo[0]?.metricas[0]?.pontos.map((p) => p.semana) ?? []

    return {
      planilha:
        linha === null
          ? null
          : {
              link: linha.link,
              lidaEm: linha.lida_em?.toISOString() ?? null,
              leituraPedidaEm: linha.leitura_pedida_em?.toISOString() ?? null,
              erro: linha.erro,
            },
      emailDaContaDeServico: emailConfigurado(process.env['GOOGLE_SA_EMAIL']),
      hoje,
      fuso: FUSO_DA_CARTEIRA,
      semanaDeReferencia: referencia,
      semanas,
      frentes: resumo.map((f) => {
        const spec = PLANILHA_DE_INDICADORES[f.frente]
        return {
          frente: f.frente,
          aba: spec.aba,
          abaEncontrada: planilha.abas.find((a) => a.frente === f.frente)?.titulo ?? null,
          provisoria: spec.provisoria,
          situacao: {
            semana: f.situacao.semana,
            status: f.situacao.status,
            problemas: f.situacao.problemas.map((p) => ({ codigo: p.codigo, mensagem: p.mensagem })),
            envio: f.situacao.linha,
            envios: f.situacao.envios,
          },
          historico: f.historico.map((h) => ({ semana: h.semana, status: h.status })),
          semanasComDados: f.semanasComDados,
          metricas: f.metricas.map((m) => ({
            chave: m.metrica.chave,
            nome: m.metrica.nome,
            unidade: m.metrica.unidade,
            pontos: m.pontos.map((p) => ({ semana: p.semana, leitura: p.valor === null ? null : leitura(p.valor, m.metrica.unidade) })),
            ultimo: m.ultimo === null ? null : { semana: m.ultimo.semana, leitura: leitura(m.ultimo.valor, m.metrica.unidade) },
            media: m.media === null ? null : leitura(m.media, m.metrica.unidade),
            variacaoEmDecimos: m.variacaoEmDecimos?.toString() ?? null,
          })),
        }
      }),
    }
  }
}

function leitura(r: RacionalDaPlanilha, unidade: UnidadeDaMetricaDaPlanilha): LeituraDaMetricaNaSaida {
  const l = leituraDaMetrica(r, unidade)
  return {
    valor: l.centavos?.toString() ?? null,
    quantidadeEmDecimos: l.quantidadeEmDecimos?.toString() ?? null,
    percentualEmDecimos: l.percentualEmDecimos?.toString() ?? null,
  }
}

function ehViolacaoDeUnicidade(e: unknown, restricao: string): boolean {
  if (typeof e !== 'object' || e === null) return false
  const x = e as { code?: unknown; constraint?: unknown }
  return x.code === '23505' && x.constraint === restricao
}

/**
 * O `resultado` gravado pelo worker, conferido na forma antes de usar. É dado
 * nosso, mas um jsonb não tem tipo: uma linha gravada por uma versão antiga
 * (ou à mão) não pode derrubar a tela — vira "sem leitura".
 */
export function planilhaDoJson(x: unknown): PlanilhaInterpretada | null {
  if (typeof x !== 'object' || x === null || !Array.isArray((x as { abas?: unknown }).abas)) return null
  const abas = (x as { abas: unknown[] }).abas
  const ok = abas.every((a) => {
    if (typeof a !== 'object' || a === null) return false
    const aba = a as Partial<Record<keyof AbaInterpretada, unknown>>
    return (
      typeof aba.frente === 'string' &&
      aba.frente in PLANILHA_DE_INDICADORES &&
      (aba.titulo === null || typeof aba.titulo === 'string') &&
      Array.isArray(aba.candidatas) &&
      Array.isArray(aba.colunasFaltando) &&
      typeof aba.semCarimbo === 'boolean' &&
      Array.isArray(aba.linhas) &&
      aba.linhas.every((l: unknown) => {
        if (typeof l !== 'object' || l === null) return false
        const linha = l as Partial<Record<keyof LinhaDaFrente, unknown>>
        return (
          (linha.semana === null || typeof linha.semana === 'string') &&
          typeof linha.preenchidas === 'number' &&
          typeof linha.total === 'number' &&
          typeof linha.valores === 'object' &&
          linha.valores !== null
        )
      })
    )
  })
  // `as`: a forma de cada aba e de cada linha acabou de ser conferida acima.
  return ok ? (x as PlanilhaInterpretada) : null
}

/**
 * O e-mail da conta de serviço, para a tela dizer com quem compartilhar. Vem
 * de `GOOGLE_SA_EMAIL`, à parte do JSON da chave: a API nunca recebe a
 * credencial, só este endereço, que não é segredo.
 */
function emailConfigurado(texto: string | undefined): string | null {
  const t = texto?.trim() ?? ''
  return /^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(t) ? t : null
}
