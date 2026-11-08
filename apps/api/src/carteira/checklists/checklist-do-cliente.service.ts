import type {
  AplicarChecklistEntrada,
  ChecklistAplicadoSaida,
  ChecklistDoClienteSaida,
  ItemDoChecklistDoCliente,
} from '@fir/contracts'
import { chaveDoModelo, diaCivil, progressoDoChecklist, semanaDaCarga, tarefasDoChecklist } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
import {
  ClienteSemDataDeEntrada,
  NaoEncontrado,
  type Sessao,
  TarefaCancelada,
  clienteDoChecklist,
  equipeDoGrupo,
  hojeNaCarteira,
  registrarAcesso,
} from './checklists-comum'
import { registrarEntradaDeClienteExistente } from './entrada-de-cliente.service'
import { lerModelos } from './modelos.service'

type LinhaItemDoCliente = {
  id: string
  tarefa_id: string
  titulo: string
  dias: number
  prazo: string
  status: ItemDoChecklistDoCliente['status']
  concluida_em: Date | null
  responsavel_id: string | null
  responsavel_nome: string | null
  acao: 'diagnostico' | null
  entrou_feito: boolean
  modelo_de_checklist_id: string
}

const juntar = (nomes: readonly string[]): string =>
  nomes.length <= 1 ? (nomes[0] ?? '') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`

/**
 * **X5, V3, V15 — o checklist do contrato de um cliente.**
 *
 * Toda escrita roda em `nasTabelasDaCarteiraComoUsuarioDeGestao`: RLS por
 * grupo (primeira camada) e o ator gravado pelo trigger de auditoria. O
 * grupo de cada tarefa sai do cliente lido sob RLS, nunca do corpo; a FK
 * composta de `checklist_do_cliente` (A-8) é a segunda camada.
 */
@Injectable()
export class ChecklistDoClienteService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  ler(sessao: Sessao, clienteId: string): Promise<ChecklistDoClienteSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDoChecklist(c, clienteId, false)
      const hoje = hojeNaCarteira(this.relogio)
      const modelos = await lerModelos(c)
      const rotulo = chaveDoModelo(cliente.produto, cliente.area_foco, modelos.map((m) => m.rotulo))
      const modelo = modelos.find((m) => m.rotulo === rotulo)
      const linhas = await this.itens(c, cliente.id)
      await registrarAcesso(c, sessao, 'checklist_do_cliente', cliente.id)
      const itens = linhas.map(
        (l): ItemDoChecklistDoCliente => ({
          id: l.id,
          tarefaId: l.tarefa_id,
          titulo: l.titulo,
          dias: l.dias,
          prazo: l.prazo,
          status: l.status,
          concluidaNoDia: l.concluida_em ? diaCivil(l.concluida_em, FUSO_DA_CARTEIRA) : null,
          responsavel: l.responsavel_id && l.responsavel_nome ? { id: l.responsavel_id, nome: l.responsavel_nome } : null,
          acao: l.acao,
          entrouFeito: l.entrou_feito,
        }),
      )
      return {
        modelo: { rotulo, existe: modelo !== undefined, itens: modelo?.itens.length ?? 0 },
        geradoParaOModelo: modelo !== undefined && linhas.some((l) => l.modelo_de_checklist_id === modelo.id),
        itens,
        progresso: progressoDoChecklist(
          itens.map((i) => ({ id: i.id, titulo: i.titulo, prazo: i.prazo, status: i.status, responsavelId: i.responsavel?.id ?? null })),
          hoje,
        ),
        hoje,
      }
    })
  }

  /**
   * Aplicar o checklist (X5). Uma transação: as tarefas, os vínculos e — na
   * entrada de quem já era cliente — a tarefa "Completar o cadastro".
   *
   * IDEMPOTÊNCIA (A-20), em duas redes:
   *  1. o cliente é travado (`FOR UPDATE`): dois cliques concorrentes se
   *     enfileiram, e o segundo vê o que o primeiro gravou;
   *  2. `UNIQUE (cliente, item)`: a tarefa só nasce quando o vínculo acabou
   *     de nascer — mesmo que o código mude, o item não vira duas tarefas.
   */
  aplicar(sessao: Sessao, clienteId: string, dados: AplicarChecklistEntrada): Promise<ChecklistAplicadoSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDoChecklist(c, clienteId, true)
      const existente = dados.origem === 'existente'
      if (existente && cliente.cliente_desde === null) throw new ClienteSemDataDeEntrada()

      const hoje = hojeNaCarteira(this.relogio)
      const modelos = await lerModelos(c)
      const rotulo = chaveDoModelo(cliente.produto, cliente.area_foco, modelos.map((m) => m.rotulo))
      const modelo = modelos.find((m) => m.rotulo === rotulo)
      const equipe = await equipeDoGrupo(c, cliente.grupo_id)
      // A base do D+N: o início do ciclo; na entrada de quem já era cliente,
      // sem início informado, "cliente desde" (L1738).
      const inicio = cliente.data_inicio ?? (existente ? cliente.cliente_desde : null) ?? hoje
      const plano = tarefasDoChecklist(
        (modelo?.itens ?? []).map((it, i) => ({ ...it, ordem: i })),
        {
          inicio,
          hoje,
          marcarVencidosComoFeitos: existente,
          responsavelId: cliente.responsavel_usuario_gestao_id,
          equipe,
          atorId: sessao.id,
        },
      )

      const novas: { responsavelId: string; prazo: string; feita: boolean }[] = []
      for (const t of modelo ? plano : []) {
        const vinculo = await c.query<{ id: string }>(
          `INSERT INTO checklist_do_cliente
             (cliente_carteira_id, grupo_id, modelo_de_checklist_id, item_de_modelo_id, dias, acao, ordem, entrou_feito)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (cliente_carteira_id, item_de_modelo_id) DO NOTHING
           RETURNING id`,
          [cliente.id, cliente.grupo_id, modelo?.id, t.itemId, t.dias, t.acao, t.ordem, t.entraFeito],
        )
        if (!vinculo.rows[0]) continue
        // O item que entra feito tem `concluida_em` no próprio prazo (L1740),
        // ao meio-dia no fuso da Firmare — um instante dentro do dia civil.
        const tarefa = await c.query<{ id: string }>(
          `INSERT INTO tarefas_internas
             (titulo, grupo_id, responsavel_usuario_gestao_id, cliente_carteira_id, prazo, prioridade, status, concluida_em)
           VALUES ($1, $2, $3, $4, $5::date, 'normal', $6,
                   CASE WHEN $7 THEN ($5::date + time '12:00') AT TIME ZONE $8 END)
           RETURNING id`,
          [t.titulo, cliente.grupo_id, t.responsavelId, cliente.id, t.prazo, t.entraFeito ? 'concluida' : 'pendente', t.entraFeito, FUSO_DA_CARTEIRA],
        )
        await c.query('UPDATE checklist_do_cliente SET tarefa_interna_id = $2 WHERE id = $1', [
          vinculo.rows[0].id,
          tarefa.rows[0]!.id,
        ])
        novas.push({ responsavelId: t.responsavelId, prazo: t.prazo, feita: t.entraFeito })
      }

      if (existente) await registrarEntradaDeClienteExistente(c, sessao, cliente, hoje)

      const cargaDaSemana = await this.cargaDaSemana(c, novas, hoje, equipe)
      const feitas = novas.filter((n) => n.feita).length
      const criadas = novas.length
      return {
        rotulo,
        criadas,
        entraramFeitas: feitas,
        jaExistiam: plano.length - criadas,
        recado: this.recado(dados.origem, rotulo, modelo !== undefined, criadas, feitas, novas, equipe, cargaDaSemana),
        cargaDaSemana,
      }
    })
  }

  /** Marcar aqui conclui na rotina também (L2631): o status é UM, o da tarefa. */
  mudarStatus(sessao: Sessao, clienteId: string, itemId: string, concluir: boolean): Promise<void> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDoChecklist(c, clienteId, false)
      const r = await c.query<{ tarefa_id: string; status: string }>(
        `SELECT t.id AS tarefa_id, t.status
           FROM checklist_do_cliente k JOIN tarefas_internas t ON t.id = k.tarefa_interna_id
          WHERE k.id = $1 AND k.cliente_carteira_id = $2
          FOR UPDATE OF t`,
        [itemId, cliente.id],
      )
      const atual = r.rows[0]
      if (!atual) throw new NaoEncontrado()
      if (atual.status === 'cancelada') throw new TarefaCancelada()
      await c.query(
        `UPDATE tarefas_internas
            SET status = $2, concluida_em = CASE WHEN $2 = 'concluida' THEN now() ELSE NULL END
          WHERE id = $1 AND status <> $2`,
        [atual.tarefa_id, concluir ? 'concluida' : 'pendente'],
      )
    })
  }

  private async itens(c: pg.PoolClient, clienteId: string): Promise<LinhaItemDoCliente[]> {
    const r = await c.query<LinhaItemDoCliente>(
      `SELECT k.id, t.id AS tarefa_id, t.titulo, k.dias, t.prazo::text AS prazo, t.status, t.concluida_em,
              t.responsavel_usuario_gestao_id AS responsavel_id, u.nome AS responsavel_nome,
              k.acao, k.entrou_feito, k.modelo_de_checklist_id
         FROM checklist_do_cliente k
         JOIN tarefas_internas t ON t.id = k.tarefa_interna_id
         LEFT JOIN usuarios_gestao u ON u.id = t.responsavel_usuario_gestao_id
        WHERE k.cliente_carteira_id = $1
        ORDER BY k.dias, k.ordem, t.prazo, k.id`,
      [clienteId],
    )
    return r.rows
  }

  /**
   * "Eduarda +4 (fica com 11)" (L2893–2894): o que esta aplicação pôs na
   * SEMANA de cada pessoa, e com quantas abertas ela fica até domingo
   * (atrasadas inclusas — é o que a carga mostra, R7). Semana de segunda a
   * domingo no fuso da Firmare, calculada no servidor (regra 23).
   */
  private async cargaDaSemana(
    c: pg.PoolClient,
    novas: readonly { responsavelId: string; prazo: string; feita: boolean }[],
    hoje: string,
    equipe: readonly { id: string; nome: string }[],
  ): Promise<ChecklistAplicadoSaida['cargaDaSemana']> {
    const { fim } = semanaDaCarga(hoje)
    const porPessoa = new Map<string, number>()
    for (const n of novas) {
      if (n.feita || n.prazo > fim) continue
      porPessoa.set(n.responsavelId, (porPessoa.get(n.responsavelId) ?? 0) + 1)
    }
    if (porPessoa.size === 0) return []
    const ids = [...porPessoa.keys()]
    const r = await c.query<{ id: string; n: number }>(
      `SELECT responsavel_usuario_gestao_id AS id, count(*)::int AS n
         FROM tarefas_internas
        WHERE responsavel_usuario_gestao_id = ANY ($1::uuid[]) AND status = 'pendente' AND prazo <= $2::date
        GROUP BY 1`,
      [ids, fim],
    )
    return ids.map((id) => ({
      responsavel: { id, nome: equipe.find((p) => p.id === id)?.nome ?? 'quem aplicou' },
      novas: porPessoa.get(id) ?? 0,
      ficaCom: r.rows.find((x) => x.id === id)?.n ?? 0,
    }))
  }

  private recado(
    origem: AplicarChecklistEntrada['origem'],
    rotulo: string,
    temModelo: boolean,
    criadas: number,
    feitas: number,
    novas: readonly { responsavelId: string }[],
    equipe: readonly { id: string; nome: string }[],
    carga: ChecklistAplicadoSaida['cargaDaSemana'],
  ): string {
    if (!temModelo) return `Não há checklist cadastrado para ${rotulo}. Monte em Método Firmare, na aba Checklists.`
    if (criadas === 0) return `O checklist ${rotulo} já estava aplicado. Nada novo foi criado.`
    if (origem === 'existente') {
      return `Cliente trazida. ${criadas - feitas} itens do checklist pela frente, ${feitas} marcados como feitos.`
    }
    const nomes = [...new Set(novas.map((n) => n.responsavelId))].map(
      (id) => equipe.find((p) => p.id === id)?.nome ?? 'quem aplicou',
    )
    const semana = carga.map((x) => `${x.responsavel.nome} +${x.novas} (fica com ${x.ficaCom})`).join(', ')
    const base =
      origem === 'novo'
        ? `Cliente criada com ${criadas} tarefas do checklist ${rotulo}.`
        : `Checklist ${rotulo}: ${criadas} tarefas para ${juntar(nomes)}.`
    return semana ? `${base} Nesta semana: ${semana}.` : base
  }
}
