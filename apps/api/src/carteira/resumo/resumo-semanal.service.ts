import type { ResumoSemanalSaida, UsuarioDeGestaoPublico } from '@fir/contracts'
import {
  type AcaoNoResumo,
  type CampanhaNoResumo,
  type ClienteNoResumo,
  Dinheiro,
  type SaudeDoCliente,
  type StatusDeCampanhaCarteira,
  clienteEmRisco,
  diaCivil,
  montarResumoSemanal,
  responsavelImpostoPeloPerfil,
  saudeDerivadaDoCliente,
  temPermCarteira,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { registrarAcessoAsAtas } from '../conteudo/conteudo-comum'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
import { umPorClinica } from '../um-por-clinica'

type Sessao = UsuarioDeGestaoPublico

type ClienteDb = {
  id: string
  nome: string
  status: string
  mensalidade_centavos: string
  clinica_id: string | null
  conta_na_receita: boolean
}

type CampanhaDb = {
  id: string
  cliente_carteira_id: string
  campanha_origem_id: string | null
  nome: string
  categoria: string
  mes: string
  status: StatusDeCampanhaCarteira
  metrica: string
  meta: string | null
  resultado: string | null
  receita_centavos: string | null
  investimento_centavos: string | null
  orcamentos_pagos: number | null
  rotulo_da_metrica: string
}

const dinheiro = (v: string | null): Dinheiro | null => (v === null ? null : Dinheiro.deCentavos(BigInt(v)))

/**
 * **O resumo semanal da carteira** (G8 3C, S1). Lê, agrega e entrega a
 * `montarResumoSemanal` — nenhuma regra mora aqui: saúde é
 * `saudeDerivadaDoCliente` (a mesma da ficha e das metas), "atrasada" e a
 * janela da semana são do domínio, campanha passa por `suprimirCampanhas`
 * dentro dele, e o MRR é soma de `Dinheiro`.
 *
 * Isolamento em duas camadas (regra 19, A-3): a RLS de `app_pode_ver_grupo`,
 * fixada pela sessão em `nasTabelasDaCarteiraComoUsuarioDeGestao`, e o filtro
 * explícito de grupo e de "só a minha carteira" no `WHERE`. Ações, campanhas e
 * tarefas da equipe só entram pelos clientes que a sessão vê (ajuste 35).
 *
 * `valores` é decidido por `temPermCarteira`, a mesma função do guard e da
 * tela (regra 16); o texto é montado já sem dinheiro quando ela nega.
 *
 * Registro de acesso (regra 18, LGPD): o resumo de reunião pode citar
 * paciente, então cada cliente cuja ata entrou no texto ganha uma linha
 * `acessou reunioes_comerciais` na mesma transação da leitura — e a ata só é
 * lida para os clientes em risco, os únicos que o texto cita.
 *
 * Nada do texto vai para log: o serviço não loga.
 */
@Injectable()
export class ResumoSemanalService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async semanal(sessao: Sessao): Promise<ResumoSemanalSaida> {
    const hoje = diaCivil(this.relogio.agora(), FUSO_DA_CARTEIRA)
    const podeVerValores = temPermCarteira(sessao, 'valores')
    const grupo = sessao.escopo === 'geral' ? null : sessao.grupoId
    const responsavel = responsavelImpostoPeloPerfil(sessao)

    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      // A clínica em 2+ grupos aparece 2+ vezes no `geral` (0068): "N clientes
      // ativos" conta por clínica, e só o cliente que conta na receita entra no MRR.
      const clientesDb = umPorClinica(
        (
          await c.query<ClienteDb>(
            `SELECT id, nome, status, mensalidade_centavos::text AS mensalidade_centavos, clinica_id, conta_na_receita
               FROM clientes_carteira
              WHERE excluido_em IS NULL
                AND ($1::uuid IS NULL OR grupo_id = $1::uuid)
                AND ($2::uuid IS NULL OR responsavel_usuario_gestao_id = $2::uuid)
              ORDER BY nome, id`,
            [grupo, responsavel],
          )
          ).rows,
      )
      const ids = clientesDb.map((x) => x.id)

      const saudes = await this.saudes(c, ids)
      const semAta = clientesDb.map((x) => ({
        id: x.id,
        nome: x.nome,
        ativo: x.status === 'ativo' || x.status === 'onboarding',
        saude: saudes.get(x.id) ?? null,
        mensalidade: x.conta_na_receita ? Dinheiro.deCentavos(BigInt(x.mensalidade_centavos)) : Dinheiro.zero(),
      }))
      const atas = await this.ultimasAtas(c, semAta.filter(clienteEmRisco).map((x) => x.id))
      const clientes: ClienteNoResumo[] = semAta.map((x) => ({ ...x, ultimaReuniao: atas.get(x.id) ?? null }))

      const acoes = await this.acoes(c, ids)
      const campanhas = await this.campanhas(c, ids)
      const equipe = await this.equipe(c, ids, responsavel)

      const r = montarResumoSemanal({ hoje, podeVerValores, clientes, acoes, campanhas, equipe })
      for (const id of r.atasCitadas) await registrarAcessoAsAtas(c, sessao, id)

      return { semana: r.semana, fuso: FUSO_DA_CARTEIRA, texto: r.texto, comValores: podeVerValores }
    })
  }

  /** `Saúde do cliente` derivada do checkin ou da ata mais recente (mesma leitura de metas e da ficha). */
  private async saudes(c: pg.PoolClient, ids: readonly string[]): Promise<Map<string, SaudeDoCliente | null>> {
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
      const lista = porCliente.get(x.cliente_carteira_id) ?? []
      lista.push({ em: x.em.toISOString(), saude: x.saude })
      porCliente.set(x.cliente_carteira_id, lista)
    }
    for (const id of ids) mapa.set(id, saudeDerivadaDoCliente(porCliente.get(id) ?? []))
    return mapa
  }

  /** A ata mais recente pela data da reunião (`ultimaReuniao`, L1333), só resumo e encaminhamentos. */
  private async ultimasAtas(
    c: pg.PoolClient,
    ids: readonly string[],
  ): Promise<Map<string, { resumo: string; encaminhamentos: string | null }>> {
    if (ids.length === 0) return new Map()
    const r = await c.query<{ cliente_carteira_id: string; resumo: string; encaminhamentos: string | null }>(
      `SELECT DISTINCT ON (cliente_carteira_id) cliente_carteira_id, resumo, encaminhamentos
         FROM reunioes_comerciais
        WHERE cliente_carteira_id = ANY($1) AND arquivada_em IS NULL
        ORDER BY cliente_carteira_id, data DESC, criado_em DESC`,
      [ids],
    )
    return new Map(r.rows.map((x) => [x.cliente_carteira_id, { resumo: x.resumo, encaminhamentos: x.encaminhamentos }]))
  }

  private async acoes(c: pg.PoolClient, ids: readonly string[]): Promise<AcaoNoResumo[]> {
    if (ids.length === 0) return []
    const r = await c.query<{ cliente_carteira_id: string; status: AcaoNoResumo['status']; prazo: string | null; concluida_em: Date | null }>(
      `SELECT cliente_carteira_id, status, prazo::text AS prazo, concluida_em
         FROM acoes_do_plano
        WHERE cliente_carteira_id = ANY($1) AND arquivada_em IS NULL`,
      [ids],
    )
    // O dia da conclusão no fuso da carteira (regra 23): a janela da semana é
    // comparada em dias civis desse fuso, nunca em UTC.
    return r.rows.map((x) => ({
      clienteId: x.cliente_carteira_id,
      status: x.status,
      prazo: x.prazo,
      concluidaNoDia: x.concluida_em === null ? null : diaCivil(x.concluida_em, FUSO_DA_CARTEIRA),
    }))
  }

  /**
   * As células ativas. A supressão (`k = 5`) é aplicada DENTRO de
   * `montarResumoSemanal`; aqui, como no `CampanhasCarteiraService`, todo
   * cliente é tratado como de saúde (`exigeContagem: true`, LGPD A24).
   */
  private async campanhas(c: pg.PoolClient, ids: readonly string[]): Promise<CampanhaNoResumo[]> {
    if (ids.length === 0) return []
    const r = await c.query<CampanhaDb>(
      `SELECT id, cliente_carteira_id, campanha_origem_id, nome, categoria, mes_referencia::text AS mes, status,
              metrica, meta::text AS meta, resultado::text AS resultado, receita_centavos::text AS receita_centavos,
              investimento_centavos::text AS investimento_centavos, orcamentos_pagos, rotulo_da_metrica
         FROM campanhas_carteira
        WHERE cliente_carteira_id = ANY($1) AND status = 'ativa'`,
      [ids],
    )
    return r.rows.map((l) => ({
      rotuloDaMetrica: l.rotulo_da_metrica,
      celula: {
        id: l.id,
        clienteId: l.cliente_carteira_id,
        campanhaChave: l.campanha_origem_id ?? l.id,
        nome: l.nome,
        tipo: l.categoria,
        mes: l.mes,
        status: l.status,
        receita: dinheiro(l.receita_centavos),
        investimento: dinheiro(l.investimento_centavos),
        orcamentosPagos: l.orcamentos_pagos,
        exigeContagem: true,
        resultado: l.resultado === null ? null : BigInt(l.resultado),
        meta: l.meta === null ? null : BigInt(l.meta),
        resultadoEmDinheiro: l.metrica === 'receita',
      },
    }))
  }

  /**
   * A equipe (L2017): as pessoas ativas fora da Diretoria — o `papel !==
   * "admin"` do protótipo é o setor `diretoria` aqui. Com "só a minha
   * carteira", só a própria pessoa: contar as tarefas dos outros só nos
   * clientes dela daria números que ninguém reconheceria.
   *
   * Tarefas: abertas (`pendente`), de cliente visível ou sem cliente.
   */
  private async equipe(
    c: pg.PoolClient,
    ids: readonly string[],
    responsavel: string | null,
  ): Promise<{ nome: string; prazosPendentes: string[] }[]> {
    const pessoas = (
      await c.query<{ id: string; nome: string }>(
        `SELECT id, nome FROM usuarios_gestao
          WHERE ativo AND setor IS DISTINCT FROM 'diretoria' AND ($1::uuid IS NULL OR id = $1::uuid)
          ORDER BY nome, id`,
        [responsavel],
      )
    ).rows
    if (pessoas.length === 0) return []
    const tarefas = (
      await c.query<{ responsavel_usuario_gestao_id: string; prazo: string }>(
        `SELECT responsavel_usuario_gestao_id, prazo::text AS prazo
           FROM tarefas_internas
          WHERE status = 'pendente'
            AND responsavel_usuario_gestao_id = ANY($1)
            AND (cliente_carteira_id IS NULL OR cliente_carteira_id = ANY($2))`,
        [pessoas.map((p) => p.id), ids],
      )
    ).rows
    return pessoas.map((p) => ({
      nome: p.nome,
      prazosPendentes: tarefas.filter((t) => t.responsavel_usuario_gestao_id === p.id).map((t) => t.prazo),
    }))
  }
}
