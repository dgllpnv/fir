import type {
  ChecklistsDoMetodoSaida,
  CriarItemDeModeloEntrada,
  CriarModeloDeChecklistEntrada,
  EditarItemDeModeloEntrada,
  ItemDeModeloNaSaida,
  ItemDeModeloSalvoSaida,
  ModeloDeChecklistNaSaida,
} from '@fir/contracts'
import { podeAdministrarConteudo, rotuloDoModelo } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { BancoService } from '../../banco/banco.service'
import { ModeloJaExiste, NaoEncontrado, type Sessao, SemPermissaoDeAdministrar } from './checklists-comum'

type LinhaModelo = { id: string; produto: string; area_foco: string | null }
type LinhaItem = {
  id: string
  modelo_de_checklist_id: string
  dias: number
  titulo: string
  quem: ItemDeModeloNaSaida['quem']
  acao: 'diagnostico' | null
}

const itemParaContrato = (l: LinhaItem): ItemDeModeloNaSaida => ({
  id: l.id,
  dias: l.dias,
  titulo: l.titulo,
  quem: l.quem,
  acao: l.acao,
})

const SELECT_ITEM = 'SELECT id, modelo_de_checklist_id, dias, titulo, quem, acao FROM itens_de_modelo'

/** Lê os modelos vivos e os itens vivos, ordenados como a tela do protótipo (L2662). */
export async function lerModelos(c: pg.PoolClient): Promise<ModeloDeChecklistNaSaida[]> {
  const modelos = await c.query<LinhaModelo>(
    'SELECT id, produto, area_foco FROM modelos_de_checklist WHERE arquivado_em IS NULL',
  )
  const itens = await c.query<LinhaItem>(`${SELECT_ITEM} WHERE arquivado_em IS NULL ORDER BY dias, ordem, criado_em, id`)
  return modelos.rows
    .map((m) => ({
      id: m.id,
      produto: m.produto,
      areaFoco: m.area_foco,
      rotulo: rotuloDoModelo(m.produto, m.area_foco),
      itens: itens.rows.filter((i) => i.modelo_de_checklist_id === m.id).map(itemParaContrato),
    }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

/**
 * **X3 — os checklists dos programas** (Método Firmare › Checklists,
 * `corpoCad('modelos')` L2661–2665, `fItem` L2785, edição L2881–2884).
 *
 * Tabelas globais (A-19). A escrita passa por DUAS camadas: o serviço recusa
 * quem não pode administrar (403) e a policy recusa o `INSERT`/`UPDATE` de
 * quem não é `escopo = 'geral'` — se o código esquecer a primeira, a segunda
 * falha alto.
 */
@Injectable()
export class ModelosDeChecklistService {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  listar(sessao: Sessao): Promise<ChecklistsDoMetodoSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => ({
      modelos: await lerModelos(c),
      podeAdministrar: podeAdministrarConteudo(sessao),
    }))
  }

  /** "Novo checklist (produto e frente)" (L2945): "Esse checklist já existe" vira 409. */
  criarModelo(sessao: Sessao, dados: CriarModeloDeChecklistEntrada): Promise<ModeloDeChecklistNaSaida> {
    if (!podeAdministrarConteudo(sessao)) return Promise.reject(new SemPermissaoDeAdministrar())
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<LinhaModelo>(
        `INSERT INTO modelos_de_checklist (produto, area_foco, criado_por)
         VALUES ($1, $2, $3)
         ON CONFLICT (produto, coalesce(area_foco, '')) WHERE arquivado_em IS NULL DO NOTHING
         RETURNING id, produto, area_foco`,
        [dados.produto, dados.areaFoco, sessao.id],
      )
      const m = r.rows[0]
      if (!m) throw new ModeloJaExiste()
      return { id: m.id, produto: m.produto, areaFoco: m.area_foco, rotulo: rotuloDoModelo(m.produto, m.area_foco), itens: [] }
    })
  }

  criarItem(sessao: Sessao, modeloId: string, dados: CriarItemDeModeloEntrada): Promise<ItemDeModeloNaSaida> {
    if (!podeAdministrarConteudo(sessao)) return Promise.reject(new SemPermissaoDeAdministrar())
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const modelo = await c.query<{ proxima: number }>(
        `SELECT coalesce((SELECT max(ordem) FROM itens_de_modelo WHERE modelo_de_checklist_id = m.id), 0) + 1 AS proxima
           FROM modelos_de_checklist m WHERE m.id = $1 AND m.arquivado_em IS NULL FOR UPDATE`,
        [modeloId],
      )
      if (!modelo.rows[0]) throw new NaoEncontrado()
      const r = await c.query<LinhaItem>(
        `INSERT INTO itens_de_modelo (modelo_de_checklist_id, dias, titulo, quem, acao, ordem)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, modelo_de_checklist_id, dias, titulo, quem, acao`,
        [modeloId, dados.dias, dados.titulo, dados.quem, dados.acao, modelo.rows[0].proxima],
      )
      return itemParaContrato(r.rows[0]!)
    })
  }

  /**
   * Editar o item PROPAGA o título para as tarefas ainda ABERTAS geradas por
   * ele (L2882–2883) — em todo cliente, de todo grupo: quem edita é escopo
   * geral, e a RLS deixa. Cada `UPDATE` de tarefa passa pelo trigger de
   * auditoria (de → para). Prazo, responsável e status das tarefas não mudam:
   * "Mudanças valem para os próximos clientes".
   */
  editarItem(sessao: Sessao, itemId: string, dados: EditarItemDeModeloEntrada): Promise<ItemDeModeloSalvoSaida> {
    if (!podeAdministrarConteudo(sessao)) return Promise.reject(new SemPermissaoDeAdministrar())
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<LinhaItem>(
        `UPDATE itens_de_modelo
            SET titulo = coalesce($2, titulo),
                dias   = coalesce($3, dias),
                quem   = coalesce($4, quem),
                acao   = CASE WHEN $5 THEN $6 ELSE acao END,
                atualizado_em = now()
          WHERE id = $1 AND arquivado_em IS NULL
          RETURNING id, modelo_de_checklist_id, dias, titulo, quem, acao`,
        [itemId, dados.titulo ?? null, dados.dias ?? null, dados.quem ?? null, dados.acao !== undefined, dados.acao ?? null],
      )
      const item = r.rows[0]
      if (!item) throw new NaoEncontrado()
      let tarefasAtualizadas = 0
      if (dados.titulo !== undefined) {
        const t = await c.query(
          `UPDATE tarefas_internas t
              SET titulo = $2
             FROM checklist_do_cliente k
            WHERE k.item_de_modelo_id = $1 AND t.id = k.tarefa_interna_id
              AND t.status = 'pendente' AND t.titulo <> $2`,
          [itemId, item.titulo],
        )
        tarefasAtualizadas = t.rowCount ?? 0
      }
      return { item: itemParaContrato(item), tarefasAtualizadas }
    })
  }

  /** Excluir item é arquivar (regra 20): a tarefa gerada continua, e o vínculo dela também. */
  arquivarItem(sessao: Sessao, itemId: string): Promise<void> {
    if (!podeAdministrarConteudo(sessao)) return Promise.reject(new SemPermissaoDeAdministrar())
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query('UPDATE itens_de_modelo SET arquivado_em = now() WHERE id = $1 AND arquivado_em IS NULL', [
        itemId,
      ])
      if (r.rowCount === 0) throw new NaoEncontrado()
    })
  }
}
