import type {
  CadastrarMetasEmAndamentoEntrada,
  EntradaDoClienteSaida,
  LinhaDeMetaEmAndamento,
  MetasEmAndamentoSalvasSaida,
  PassoDaEntradaSaida,
} from '@fir/contracts'
import {
  type FaltaDaEntrada,
  type FrenteDoRelatorio,
  faltasDaEntrada,
  quemExecutaItem,
  segundaDaSemana,
  somarDias,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { podeVerValoresDaCarteira } from '../prospeccao/leads.permissoes'
import {
  type ClienteDoChecklist,
  EntradaInvalida,
  MetasJaCadastradas,
  NaoEhClienteExistente,
  type Sessao,
  ValorSemPermissao,
  clienteDoChecklist,
  equipeDoGrupo,
  hojeNaCarteira,
  registrarAcesso,
} from './checklists-comum'

const FRENTES: readonly FrenteDoRelatorio[] = ['financeiro', 'comercial', 'trafego', 'marketing']

/**
 * O que falta no cadastro de um cliente para o painel e a rotina
 * funcionarem (`faltasMigracao`, L1715). Lê sob a RLS da transação.
 */
export async function faltasDoCliente(c: pg.PoolClient, clienteId: string): Promise<FaltaDaEntrada[]> {
  const r = await c.query<{
    link_painel: string | null
    link_dash_fin: string | null
    link_dash_ind: string | null
    link_rotina: string | null
    semanal: boolean
    tem_metas: boolean
  }>(
    `SELECT k.link_painel, k.link_dash_fin, k.link_dash_ind, k.link_rotina,
            'semanal' = ANY (k.servicos) AS semanal,
            EXISTS (SELECT 1 FROM metas_comerciais m
                     WHERE m.cliente_carteira_id = k.id AND m.status = 'em_andamento' AND m.excluido_em IS NULL) AS tem_metas
       FROM clientes_carteira k WHERE k.id = $1`,
    [clienteId],
  )
  const k = r.rows[0]
  if (!k) return []
  const parceiros = await c.query<{ frente: FrenteDoRelatorio }>(
    `SELECT frente FROM parceiros_do_cliente
      WHERE cliente_carteira_id = $1 AND whatsapp IS NOT NULL AND link_formulario IS NOT NULL`,
    [clienteId],
  )
  const completas = new Set(parceiros.rows.map((p) => p.frente))
  return faltasDaEntrada({
    links: {
      painel: k.link_painel !== null,
      dashFin: k.link_dash_fin !== null,
      dashInd: k.link_dash_ind !== null,
      rotina: k.link_rotina !== null,
    },
    temMetasEmAndamento: k.tem_metas,
    recebeRelatorioSemanal: k.semanal,
    frentesSemParceiroCompleto: FRENTES.filter((f) => !completas.has(f)),
  })
}

type LinhaEntrada = {
  id: string
  tarefa_completar_cadastro_id: string | null
  tarefa_cadastrar_metas_id: string | null
  metas_chave: string | null
  metas_quantidade: number | null
  asana_dispensado_em: Date | null
}

/**
 * Garante a linha de `entradas_de_cliente_existente` e, se faltar algo além
 * das metas, a tarefa "Completar o cadastro de X" (L1742–1743) — uma vez só:
 * a coluna da tarefa é a chave. Chamada pelo "aplicar" com origem
 * `existente`, na MESMA transação que gera o checklist.
 */
export async function registrarEntradaDeClienteExistente(
  c: pg.PoolClient,
  sessao: Sessao,
  cliente: ClienteDoChecklist,
  hoje: string,
): Promise<void> {
  await c.query(
    `INSERT INTO entradas_de_cliente_existente (cliente_carteira_id, grupo_id, por_usuario_gestao_id)
     VALUES ($1, $2, $3) ON CONFLICT (cliente_carteira_id) DO NOTHING`,
    [cliente.id, cliente.grupo_id, sessao.id],
  )
  const entrada = await travarEntrada(c, cliente.id)
  if (!entrada || entrada.tarefa_completar_cadastro_id !== null) return
  const faltas = (await faltasDoCliente(c, cliente.id)).filter((f) => f.codigo !== 'metas')
  if (faltas.length === 0) return
  const equipe = await equipeDoGrupo(c, cliente.grupo_id)
  const tarefa = await inserirTarefa(c, {
    titulo: `Completar o cadastro de ${cliente.nome}`,
    descricao: `Falta: ${faltas.map((f) => f.texto).join('; ')}`,
    cliente,
    responsavelId: quemExecutaItem('administrativo', cliente.responsavel_usuario_gestao_id, equipe, sessao.id),
    prazo: somarDias(hoje, 2),
  })
  await c.query('UPDATE entradas_de_cliente_existente SET tarefa_completar_cadastro_id = $2 WHERE id = $1', [
    entrada.id,
    tarefa,
  ])
}

async function travarEntrada(c: pg.PoolClient, clienteId: string): Promise<LinhaEntrada | undefined> {
  const r = await c.query<LinhaEntrada>(
    `SELECT id, tarefa_completar_cadastro_id, tarefa_cadastrar_metas_id, metas_chave, metas_quantidade, asana_dispensado_em
       FROM entradas_de_cliente_existente WHERE cliente_carteira_id = $1 FOR UPDATE`,
    [clienteId],
  )
  return r.rows[0]
}

async function inserirTarefa(
  c: pg.PoolClient,
  t: { titulo: string; descricao: string; cliente: ClienteDoChecklist; responsavelId: string; prazo: string },
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `INSERT INTO tarefas_internas (titulo, descricao, grupo_id, responsavel_usuario_gestao_id, cliente_carteira_id, prazo, prioridade)
     VALUES ($1, $2, $3, $4, $5, $6, 'alta') RETURNING id`,
    [t.titulo, t.descricao, t.cliente.grupo_id, t.responsavelId, t.cliente.id, t.prazo],
  )
  return r.rows[0]!.id
}

/**
 * A escala de armazenamento de cada unidade é a de `lancamentos_de_indicador`:
 * `R$` vai para as colunas `_centavos`, as outras para `_inteiro` (o trigger
 * `validar_valor_por_unidade` recusa a troca).
 */
const colunas = (unidade: LinhaDeMetaEmAndamento['unidade'], v: string | null): [string | null, string | null] =>
  v === null ? [null, null] : unidade === 'R$' ? [v, null] : [null, v]

/**
 * **C6 — a entrada da cliente que já era da Firmare**: o aviso permanente,
 * o passo 2 de 3 (metas em andamento) e o "fazer depois"/"não há reuniões
 * para importar".
 */
@Injectable()
export class EntradaDeClienteService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  ler(sessao: Sessao, clienteId: string): Promise<EntradaDoClienteSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDoChecklist(c, clienteId, false)
      const e = await c.query<{ asana_dispensado_em: Date | null; reunioes_importadas: boolean }>(
        `SELECT e.asana_dispensado_em,
                EXISTS (SELECT 1 FROM reunioes_comerciais r
                         WHERE r.cliente_carteira_id = e.cliente_carteira_id AND r.tipo = 'importada') AS reunioes_importadas
           FROM entradas_de_cliente_existente e WHERE e.cliente_carteira_id = $1`,
        [cliente.id],
      )
      await registrarAcesso(c, sessao, 'entradas_de_cliente_existente', cliente.id)
      const entrada = e.rows[0]
      if (!entrada) {
        return { existente: false, clienteDesde: cliente.cliente_desde, faltas: [], asanaResolvido: true, mostrarAviso: false }
      }
      const faltas = await faltasDoCliente(c, cliente.id)
      const asanaResolvido = entrada.asana_dispensado_em !== null || entrada.reunioes_importadas
      return {
        existente: true,
        clienteDesde: cliente.cliente_desde,
        faltas,
        asanaResolvido,
        mostrarAviso: faltas.length > 0 || !asanaResolvido,
      }
    })
  }

  /**
   * "Salvar e seguir" das metas em andamento (`migMetasSalvar`, L2908).
   * Para cada linha: o indicador (reaproveitado se o cliente já tem um com o
   * mesmo nome e unidade), a meta e — se veio "Hoje" — o lançamento da semana.
   * `agregacao` e `sentido` seguem o protótipo: `%` é média, o resto soma;
   * `dias` é "menor é melhor".
   *
   * IDEMPOTÊNCIA (A-20): o lote tem chave; reenviar a mesma chave devolve o
   * resultado sem gravar nada. Um SEGUNDO lote com outra chave é recusado
   * (409): a entrada cadastra as metas uma vez; as próximas são da tela de
   * metas.
   *
   * Meta em R$ é escrita monetária (appsec A-6): sem `valores`, 403 — e nada
   * do lote é gravado.
   */
  cadastrarMetas(
    sessao: Sessao,
    clienteId: string,
    dados: CadastrarMetasEmAndamentoEntrada,
  ): Promise<MetasEmAndamentoSalvasSaida> {
    if (dados.metas.some((m) => m.unidade === 'R$') && !podeVerValoresDaCarteira(sessao)) {
      return Promise.reject(new ValorSemPermissao())
    }
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDoChecklist(c, clienteId, true)
      const entrada = await travarEntrada(c, cliente.id)
      if (!entrada) throw new NaoEhClienteExistente()
      if (entrada.metas_chave === dados.chaveIdempotencia) return { criadas: entrada.metas_quantidade ?? 0, jaExistia: true }
      if (entrada.metas_chave !== null) throw new MetasJaCadastradas()

      const hoje = hojeNaCarteira(this.relogio)
      const semana = segundaDaSemana(hoje)
      const vencida = dados.metas.findIndex((m) => m.prazo !== null && m.prazo < hoje)
      if (vencida >= 0) {
        throw new EntradaInvalida(
          'PRAZO_VENCIDO',
          `Meta ${vencida + 1}: o prazo já passou. Uma meta em andamento vence de hoje em diante.`,
        )
      }
      for (const m of dados.metas) {
        const nomeDoIndicador = m.indicador ?? m.titulo
        const sentido = m.unidade === 'dias' ? 'menor_melhor' : 'maior_melhor'
        const existente = await c.query<{ id: string }>(
          `SELECT id FROM indicadores_carteira
            WHERE cliente_carteira_id = $1 AND lower(nome) = lower($2) AND unidade = $3 AND excluido_em IS NULL
            ORDER BY criado_em LIMIT 1`,
          [cliente.id, nomeDoIndicador, m.unidade],
        )
        const indicadorId =
          existente.rows[0]?.id ??
          (
            await c.query<{ id: string }>(
              `INSERT INTO indicadores_carteira (cliente_carteira_id, grupo_id, nome, unidade, sentido)
               VALUES ($1, $2, $3, $4, $5) RETURNING id`,
              [cliente.id, cliente.grupo_id, nomeDoIndicador, m.unidade, sentido],
            )
          ).rows[0]!.id
        const [metaC, metaI] = colunas(m.unidade, m.valorMeta)
        const [iniC, iniI] = colunas(m.unidade, m.valorInicial)
        await c.query(
          `INSERT INTO metas_comerciais
             (cliente_carteira_id, grupo_id, indicador_id, titulo, sentido, tipo, agregacao,
              valor_meta_centavos, valor_meta_inteiro, valor_inicial_centavos, valor_inicial_inteiro, inicio, prazo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            cliente.id,
            cliente.grupo_id,
            indicadorId,
            m.titulo,
            sentido,
            m.tipo,
            m.unidade === '%' ? 'media' : 'soma',
            metaC,
            metaI,
            iniC,
            iniI,
            semana,
            m.prazo,
          ],
        )
        if (m.valorAtual !== null) {
          const [atualC, atualI] = colunas(m.unidade, m.valorAtual)
          await c.query(
            `INSERT INTO lancamentos_de_indicador (indicador_id, grupo_id, referencia, valor_centavos, valor_inteiro, observacao, lancado_por)
             VALUES ($1, $2, $3, $4, $5, 'Último resultado conhecido na entrada da cliente', $6)
             ON CONFLICT (indicador_id, referencia) DO NOTHING`,
            [indicadorId, cliente.grupo_id, semana, atualC, atualI, sessao.id],
          )
        }
      }
      await c.query(
        'UPDATE entradas_de_cliente_existente SET metas_chave = $2, metas_quantidade = $3 WHERE id = $1',
        [entrada.id, dados.chaveIdempotencia, dados.metas.length],
      )
      // A tarefa "Cadastrar as metas em andamento" deixada pelo "Fazer depois" conclui (L2911).
      if (entrada.tarefa_cadastrar_metas_id !== null) {
        await c.query(
          `UPDATE tarefas_internas SET status = 'concluida', concluida_em = now() WHERE id = $1 AND status = 'pendente'`,
          [entrada.tarefa_cadastrar_metas_id],
        )
      }
      return { criadas: dados.metas.length, jaExistia: false }
    })
  }

  /** "Fazer depois" (L2906): a tarefa "Cadastrar as metas em andamento de X", uma vez só. */
  metasDepois(sessao: Sessao, clienteId: string): Promise<PassoDaEntradaSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDoChecklist(c, clienteId, true)
      const entrada = await travarEntrada(c, cliente.id)
      if (!entrada) throw new NaoEhClienteExistente()
      if (entrada.tarefa_cadastrar_metas_id !== null || entrada.metas_chave !== null) return { tarefaCriada: false }
      const equipe = await equipeDoGrupo(c, cliente.grupo_id)
      const tarefa = await inserirTarefa(c, {
        titulo: `Cadastrar as metas em andamento de ${cliente.nome}`,
        descricao: 'Sem metas a cliente não aparece no painel de metas nem na reunião semanal.',
        cliente,
        responsavelId: quemExecutaItem('comercial', cliente.responsavel_usuario_gestao_id, equipe, sessao.id),
        prazo: somarDias(hojeNaCarteira(this.relogio), 2),
      })
      await c.query('UPDATE entradas_de_cliente_existente SET tarefa_cadastrar_metas_id = $2 WHERE id = $1', [
        entrada.id,
        tarefa,
      ])
      return { tarefaCriada: true }
    })
  }

  /** "Não há reuniões para importar" (L1727). Repetir não muda o instante. */
  dispensarAsana(sessao: Sessao, clienteId: string): Promise<PassoDaEntradaSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDoChecklist(c, clienteId, false)
      const r = await c.query(
        `UPDATE entradas_de_cliente_existente SET asana_dispensado_em = coalesce(asana_dispensado_em, now())
          WHERE cliente_carteira_id = $1`,
        [cliente.id],
      )
      if (r.rowCount === 0) throw new NaoEhClienteExistente()
      return { tarefaCriada: false }
    })
  }
}
