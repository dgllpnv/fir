import type { ContadoresDoMenuSaida, UsuarioDeGestaoPublico, VisaoGeralDaCarteiraSaida } from '@fir/contracts'
import {
  Dinheiro,
  type SaudeDoCliente,
  type StatusNaVisaoGeral,
  contadoresDoMenu,
  diaCivil,
  montarVisaoGeral,
  responsavelImpostoPeloPerfil,
  saudeDerivadaDoCliente,
  temPermCarteira,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { type LinhaAcao, SELECT_ACAO, acaoParaContrato } from '../acoes-do-plano/acoes-do-plano.service'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
import { umPorClinica } from '../um-por-clinica'
import { LeadsService } from '../prospeccao/leads.service'
import { RotinaInternaService } from '../prospeccao/rotina-interna.service'

type Sessao = UsuarioDeGestaoPublico

type LinhaCliente = {
  id: string
  nome: string
  status: StatusNaVisaoGeral
  mensalidade_centavos: string
  responsavel_usuario_gestao_id: string | null
  responsavel_nome: string | null
  reuniao_dia_semana: number | null
  reuniao_hora: string | null
  clinica_id: string | null
  conta_na_receita: boolean
}

/**
 * As tarefas PENDENTES no escopo da sessão — o MESMO predicado de
 * `RotinaInternaService.listarTarefas` (A-3): para quem tem "só a minha
 * carteira", some a tarefa de cliente alheio, salvo se o trabalho é dela.
 * A RLS (`app_pode_ver_grupo`) restringe o grupo por baixo.
 */
const SQL_TAREFAS_NO_ESCOPO = `
  SELECT t.responsavel_usuario_gestao_id AS responsavel, t.prazo::text AS prazo
    FROM tarefas_internas t
    LEFT JOIN clientes_carteira cc ON cc.id = t.cliente_carteira_id
   WHERE t.status = 'pendente'
     AND ($1::uuid IS NULL OR t.cliente_carteira_id IS NULL
          OR cc.responsavel_usuario_gestao_id = $1 OR t.responsavel_usuario_gestao_id = $1)`

/**
 * **A VISÃO GERAL DA CARTEIRA** (G8 3B: P1–P4, P6, P9–P11) e os contadores
 * do menu (T4).
 *
 * AGREGA, não recalcula: a composição da tela é `montarVisaoGeral` (domínio
 * puro); a saúde é `saudeDerivadaDoCliente`; "atrasada" é
 * `acaoParaContrato`; os aniversários vêm de `RotinaInternaService` (LGPD
 * A45–A48 já aplicados lá) e os contatos recomendados de
 * `LeadsService.listarLeads` (sinal, ordem e "minha carteira" já aplicados
 * lá). Aqui só se lê o que falta e se costura.
 *
 * Duas camadas, como todo serviço da carteira: a RLS por grupo embaixo
 * (`nasTabelasDaCarteiraComoUsuarioDeGestao`), e "só a minha carteira"
 * (`responsavelImpostoPeloPerfil`) no `WHERE` de cada leitura de cliente.
 * Dinheiro sai em centavos inteiros; a redação é do `RedacaoInterceptor`
 * (`mrr`, `ticketMedio`, `valorEstimado`), nunca daqui.
 *
 * Log: nenhum. Nada aqui vai para log (regra 21).
 */
@Injectable()
export class VisaoGeralService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(LeadsService) private readonly leads: LeadsService,
    @Inject(RotinaInternaService) private readonly rotina: RotinaInternaService,
  ) {}

  private hoje(): string {
    return diaCivil(this.relogio.agora(), FUSO_DA_CARTEIRA)
  }

  async visaoGeral(sessao: Sessao): Promise<VisaoGeralDaCarteiraSaida> {
    const hoje = this.hoje()
    const minha = responsavelImpostoPeloPerfil(sessao)

    const lido = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const clientes = await c.query<LinhaCliente>(
        `SELECT c.id, c.nome, c.status, c.mensalidade_centavos::text AS mensalidade_centavos,
                c.responsavel_usuario_gestao_id, u.nome AS responsavel_nome,
                c.reuniao_dia_semana, to_char(c.reuniao_hora, 'HH24:MI') AS reuniao_hora,
                c.clinica_id, c.conta_na_receita
           FROM clientes_carteira c
           LEFT JOIN usuarios_gestao u ON u.id = c.responsavel_usuario_gestao_id
          WHERE c.excluido_em IS NULL
            AND ($1::uuid IS NULL OR c.responsavel_usuario_gestao_id = $1)
          ORDER BY c.nome`,
        [minha],
      )
      // A clínica em 2+ grupos aparece 2+ vezes no `geral` (0068): conta-se por
      // clínica, preferindo o cliente que conta na receita. `idsVisiveis` guarda
      // todos, só para o filtro dos aniversários.
      const idsVisiveis = clientes.rows.map((x) => x.id)
      clientes.rows = umPorClinica(clientes.rows)
      const ids = clientes.rows.map((x) => x.id)
      const saudes = await saudesDosClientes(c, ids)
      const resumos = await c.query<{ cliente_carteira_id: string; resumo: string | null }>(
        `SELECT DISTINCT ON (cliente_carteira_id) cliente_carteira_id, resumo
           FROM reunioes_comerciais
          WHERE cliente_carteira_id = ANY($1) AND arquivada_em IS NULL
          ORDER BY cliente_carteira_id, data DESC, criado_em DESC`,
        [ids],
      )
      const acoes = await c.query<LinhaAcao>(
        `${SELECT_ACAO}
          WHERE a.cliente_carteira_id = ANY($1) AND a.arquivada_em IS NULL
            AND a.status NOT IN ('concluida', 'cancelada')`,
        [ids],
      )
      const tarefas = await c.query<{ responsavel: string | null; prazo: string }>(SQL_TAREFAS_NO_ESCOPO, [minha])
      // A equipe FIRMARE sem a diretoria (`papel !== 'admin'`, L1289): a
      // diretoria é quem tem `carteira.administrar` (D-22 item 2). Só
      // `escopo = 'geral'`: enquanto A-5 não disser se o `Usuário de Gestão`
      // de grupo pode ser alguém do lado da rede-cliente, ele não entra na
      // carga da equipe da Firmare (negar por padrão). `usuarios_gestao` não
      // tem RLS — este filtro é a fronteira, como em `equipe()`.
      const pessoas = await c.query<{ id: string; nome: string }>(
        `SELECT id, nome FROM usuarios_gestao
          WHERE ativo AND NOT administrar AND escopo = 'geral'
          ORDER BY nome`,
      )
      return { clientes: clientes.rows, idsVisiveis, saudes, resumos: resumos.rows, acoes: acoes.rows, tarefas: tarefas.rows, pessoas: pessoas.rows }
    })

    const resumoDe = new Map(lido.resumos.map((r) => [r.cliente_carteira_id, r.resumo]))
    const nomeDe = new Map(lido.clientes.map((x) => [x.id, x.nome]))
    const acoes = lido.acoes.map((l) => acaoParaContrato(l, hoje))

    const visao = montarVisaoGeral(
      {
        clientes: lido.clientes.map((x) => ({
          id: x.id,
          nome: x.nome,
          status: x.status,
          // Só o cliente que conta na receita entra em MRR e ticket médio.
          mensalidade: x.conta_na_receita ? Dinheiro.deCentavos(BigInt(x.mensalidade_centavos)) : Dinheiro.zero(),
          saude: lido.saudes.get(x.id) ?? null,
          responsavelId: x.responsavel_usuario_gestao_id,
          responsavelNome: x.responsavel_nome,
          reuniaoDiaSemana: x.reuniao_dia_semana,
          reuniaoHora: x.reuniao_hora,
          resumoDaUltimaReuniao: resumoDe.get(x.id) ?? null,
        })),
        acoes: acoes.map((a) => ({ id: a.id, clienteId: a.clienteCarteiraId, aberta: true, prazo: a.prazo })),
        tarefas: lido.tarefas.map((t) => ({ prazo: t.prazo, responsavelId: t.responsavel })),
        pessoas: lido.pessoas,
      },
      hoje,
    )

    const acaoPorId = new Map(acoes.map((a) => [a.id, a]))
    const visiveis = new Set(lido.idsVisiveis)
    const podeParabenizar = temPermCarteira(sessao, 'rotina')
    const aniversarios = (await this.rotina.aniversarios(sessao))
      .filter((a) => a.tipo === 'equipe' || visiveis.has(a.id))
      .map((a) => ({ ...a, podeParabenizar: a.podeParabenizar && podeParabenizar }))

    const contatosRecomendados = temPermCarteira(sessao, 'prospeccao')
      ? (await this.leads.listarLeads(sessao)).leads.filter((l) => l.sinal !== null && l.sinal.nivel !== 'semana').slice(0, 4)
      : null

    return {
      hoje,
      nome: sessao.nome,
      podeVerValores: temPermCarteira(sessao, 'valores'),
      kpis: {
        ...visao.kpis,
        mrr: visao.kpis.mrr.centavos.toString(),
        ticketMedio: visao.kpis.ticketMedio === null ? null : visao.kpis.ticketMedio.centavos.toString(),
      },
      saude: { ...visao.saude, barra: [...visao.saude.barra], emRisco: [...visao.saude.emRisco] },
      equipe: { pessoas: visao.equipe.pessoas.map((p) => ({ ...p, barra: [...p.barra] })), escala: visao.equipe.escala },
      reunioesDaSemana: [...visao.reunioesDaSemana],
      aniversarios,
      contatosRecomendados,
      proximasEntregas: visao.proximasEntregas.map((id) => {
        const a = acaoPorId.get(id)!
        return { ...a, clienteNome: nomeDe.get(a.clienteCarteiraId) ?? '' }
      }),
      clientesAtivos: lido.clientes
        .filter((x) => x.status === 'ativo' || x.status === 'onboarding')
        .map((x) => ({ id: x.id, nome: x.nome })),
    }
  }

  /**
   * Os badges do menu (T4). Só conta o que a sessão tem a tela para ver; o
   * resto é `null` (o badge não existe). Mesmo escopo da Visão geral: tarefas
   * pelo predicado da rotina, leads por `listarLeads` (RLS + "minha").
   */
  async contadores(sessao: Sessao): Promise<ContadoresDoMenuSaida> {
    const hoje = this.hoje()
    const veRotina = temPermCarteira(sessao, 'rotina')
    const veProspeccao = temPermCarteira(sessao, 'prospeccao')
    const tarefas = veRotina
      ? (
          await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, (c) =>
            c.query<{ responsavel: string | null; prazo: string }>(SQL_TAREFAS_NO_ESCOPO, [responsavelImpostoPeloPerfil(sessao)]),
          )
        ).rows
      : []
    const sinais = veProspeccao ? (await this.leads.listarLeads(sessao)).leads.map((l) => l.sinal?.nivel ?? null) : []
    const n = contadoresDoMenu(
      {
        tarefas: tarefas.map((t) => ({ prazo: t.prazo, responsavelId: t.responsavel })),
        eu: sessao.id,
        // A diretoria do protótipo (`admin()`) vê as vencidas de todo mundo.
        veTodas: temPermCarteira(sessao, 'carteira.administrar'),
        sinais,
      },
      hoje,
    )
    return {
      tarefasVencidas: veRotina ? n.tarefasVencidas : null,
      contatosAgora: veProspeccao ? n.contatosAgora : null,
    }
  }
}

/** A `Saúde do cliente` derivada do checkin ou da ata mais recente — a mesma leitura da ficha e do painel de metas. */
async function saudesDosClientes(c: pg.PoolClient, ids: readonly string[]): Promise<Map<string, SaudeDoCliente | null>> {
  const mapa = new Map<string, SaudeDoCliente | null>()
  if (ids.length === 0) return mapa
  const r = await c.query<{ cliente_carteira_id: string; em: Date; saude: SaudeDoCliente | null }>(
    `SELECT cliente_carteira_id, atualizado_em AS em, saude FROM checkins_internos WHERE cliente_carteira_id = ANY($1)
     UNION ALL
     SELECT cliente_carteira_id, coalesce(atualizado_em, criado_em), saude_registrada
       FROM reunioes_comerciais WHERE cliente_carteira_id = ANY($1) AND arquivada_em IS NULL`,
    [ids],
  )
  const porCliente = new Map<string, { em: string; saude: SaudeDoCliente | null }[]>()
  for (const x of r.rows) {
    const l = porCliente.get(x.cliente_carteira_id) ?? []
    l.push({ em: x.em.toISOString(), saude: x.saude })
    porCliente.set(x.cliente_carteira_id, l)
  }
  for (const id of ids) mapa.set(id, saudeDerivadaDoCliente(porCliente.get(id) ?? []))
  return mapa
}
