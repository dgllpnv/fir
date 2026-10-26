import type { ConcluirSessao, TarefasAfetadas } from '@fir/contracts'
import {
  anexar,
  diaCivil,
  ehErro,
  ehOk,
  instanteDaConclusao,
  podeConcluir,
  podeEditar,
  Quantidade,
  type EventoDeJornada,
  type ItemParaCronograma,
  type RegraDeRetorno,
  type Relogio,
  type Result,
  type SessaoExistente,
  type StatusDeTarefa,
  reprogramar,
  retornoDe,
  TIPO_RETORNO,
  TIPO_SESSAO,
} from '@fir/domain'
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Ator, PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import type { Transacao } from '../banco/transacao'
import { RELOGIO } from '../comum/relogio'
import { lerTarefas, type AutorDaRequisicao } from '../tarefas/leitura'
import { exigirDominio, registrarPagamento } from '../tarefas/tarefas.service'
import { BaixaDeInsumos, type InsumoParaBaixa } from './baixa-de-insumos'

/**
 * **CONCLUIR UMA SESSÃO NÃO É CONCLUIR UMA TAREFA** (decisão P-5).
 *
 * Rota própria, e a rota genérica recusa. Concluir uma sessão faz **quatro**
 * coisas que concluir uma tarefa não faz:
 *
 *  1. reprograma as próximas sessões, se quem concluiu pediu;
 *  2. cria o contato de retorno na última sessão do item;
 *  3. dá baixa nos insumos (o seam do épico 6);
 *  4. carimba `programa_id` no recebimento embutido, para o saldo agrupar.
 *
 * Empilhar isso em `POST /v1/tarefas/:id/concluir` faria `TarefasModule`
 * depender de `ProgramasModule`, que já depende dele — e a saída para o ciclo
 * seria um `forwardRef`, que é onde a ordem de inicialização vira defeito
 * intermitente.
 *
 * **A ORDEM DENTRO DA TRANSAÇÃO NÃO É NEGOCIÁVEL**, e a baixa é a última:
 * ela é a única que pode falhar por motivo do mundo (saldo insuficiente), e
 * falhar depois de tudo escrito é o que torna o rollback significativo. A
 * enfermagem precisa saber que o frasco acabou **antes** de registrar que
 * aplicou.
 */

type SessaoCarregada = {
  readonly id: string
  readonly solicitanteId: string
  readonly responsavelId: string
  readonly status: StatusDeTarefa
  readonly tipo: string
  readonly pacienteId: string | null
  readonly unidadeId: string | null
  readonly programaId: string
  readonly itemChave: string
  readonly indice: number
  readonly procedimentoId: string | null
  readonly historico: EventoDeJornada[]
}

type ItemDoPrograma = {
  readonly chave: string
  readonly sessoes: number
  readonly intervaloDias: number
  readonly inicio: string
  readonly depoisDe: string | null
  readonly responsavelId: string
  readonly procedimentoId: string
  readonly procedimentoNome: string
  readonly insumoId: string | null
  readonly insumoMilesimos: bigint | null
  readonly insumoUnidade: string | null
}

@Injectable()
export class SessoesService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(BaixaDeInsumos) private readonly baixa: BaixaDeInsumos,
  ) {}

  async concluir(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    autor: AutorDaRequisicao,
    id: string,
    dados: ConcluirSessao,
  ): Promise<TarefasAfetadas> {
    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, fuso)

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const s = await carregarSessao(c, id)
      exigirAutorizacao(podeConcluir(s, autor))
      const concluidaEm = exigirDominio(instanteDaConclusao(dados.em, hoje, fuso, agora))
      // O dia civil da realização, no fuso da clínica. É ele que a
      // reprogramação usa como âncora e o contato de retorno como base — nunca
      // `dados.em` cru, que a borda já aceitou mas que o domínio precisa ver
      // normalizado pelo mesmo caminho da conclusão.
      const realizadaEm = diaCivil(concluidaEm, fuso)

      const programa = await carregarPrograma(c, s.programaId)
      const itens = await carregarItens(c, s.programaId)

      const historico = [...anexar(s.historico, {
        acao: 'concluir',
        etapa: 'realizado',
        em: concluidaEm.toISOString(),
        porId: autor.id,
      } as EventoDeJornada)]

      await c.query(
        `UPDATE tarefas
            SET status = 'concluida', concluida_em = $2, obs = coalesce($3, obs),
                historico = $4::jsonb
          WHERE id = $1`,
        [id, concluidaEm, dados.obs === '' ? null : dados.obs, JSON.stringify(historico)],
      )

      const afetadas = new Set<string>([id])

      /**
       * O DINHEIRO DA SESSÃO — uma linha, com o `programa_id`.
       *
       * A regra 3 continua sob a guarda do índice `recebimento_por_tarefa`: a
       * segunda tentativa na mesma sessão é recusada pelo BANCO, não por um
       * `if` aqui. O carimbo do programa é o que faz o pagamento abater o
       * saldo DAQUELE programa, e não o do outro (regra 5).
       */
      if (dados.pagamento !== undefined) {
        const recebimentoId = await registrarPagamento(c, {
          clinicaId,
          pacienteId: s.pacienteId,
          tarefaId: id,
          tipo: s.tipo,
          pagamento: dados.pagamento,
          quando: concluidaEm,
          unidade: s.unidadeId,
          autor: autor.id,
        })
        await c.query('UPDATE recebimentos SET programa_id = $1 WHERE id = $2', [
          s.programaId,
          recebimentoId,
        ])
      }

      /**
       * REPROGRAMAR É ESCOLHA, NÃO PADRÃO — e grava SÓ o que mudou.
       *
       * O contrato torna `reprogramar` obrigatório: um padrão silencioso aqui
       * move a agenda de doze aplicações sem ninguém ter pedido. E o domínio
       * devolve apenas as mudanças: gravar a lista inteira faria a trilha
       * registrar nove alterações para mover três, e trilha com ruído é prova
       * que ninguém lê (regra 20).
       */
      if (dados.reprogramar) {
        const sessoes = await lerSessoes(c, s.programaId)
        const mudancas = reprogramar({
          itens: itens.map(paraCronograma),
          sessoes,
          itemChave: s.itemChave,
          indice: s.indice,
          realizadaEm,
        })
        // Erro de domínio aqui é defeito nosso, não do cliente: os itens e as
        // sessões vêm do banco, e o item da sessão existe por construção
        // (`CHECK sessao_e_do_programa`). Subir como 400 seria culpar quem
        // tocou no círculo.
        if (ehErro(mudancas)) throw new ConflictException(mudancas.erro.mensagem)
        for (const m of mudancas.valor) {
          await c.query('UPDATE tarefas SET prazo = $2::date WHERE id = $1', [m.tarefaId, m.prazo])
          afetadas.add(m.tarefaId)
        }
      }

      /**
       * O CONTATO DE RETORNO, **por item** — e é o protótipo que manda.
       *
       * O `Code.gs` cria um por adesão porque ele não tem itens. Para o dado
       * migrado (um item `i1`) as duas regras produzem o mesmo resultado, e é
       * isso que a conferência do épico 9 vai cobrar.
       */
      const doRetorno = await this.criarRetorno(c, {
        clinicaId,
        sessao: s,
        programa,
        itens,
        realizadaEm,
        hoje,
        autorId: autor.id,
      })
      for (const x of doRetorno) afetadas.add(x)

      /**
       * A BAIXA, **por último e dentro da transação**.
       *
       * Inerte até o épico 6. Quando ela passar a falhar por saldo
       * insuficiente, a sessão NÃO pode ficar concluída — e é esta posição na
       * ordem que faz o rollback significar algo.
       */
      const item = itens.find((i) => i.chave === s.itemChave)
      if (item !== undefined) {
        const r = await this.baixa.baixar(c, {
          clinicaId,
          tarefaId: id,
          pacienteId: s.pacienteId!,
          procedimentoId: item.procedimentoId,
          programaId: s.programaId,
          itemChave: s.itemChave,
          aplicadoPorId: s.responsavelId as PessoaId,
          em: realizadaEm,
          insumos: await this.insumosDa(c, item),
        })
        if (ehErro(r)) throw new ConflictException(r.erro.mensagem)
      }

      return umaSo(await lerTarefas(c, clinicaId, hoje, [...afetadas]), id)
    })
  }

  /**
   * REABRIR — estorna o recebimento, cancela o contato de retorno que a
   * conclusão criou, e desfaz a baixa por compensação.
   *
   * **O que reabrir NÃO desfaz: a reprogramação.** Reprogramar é uma decisão
   * sobre a agenda, não um efeito da conclusão: a enfermagem já reorganizou o
   * dia dela, e devolver as datas antigas seria a surpresa. É também o que o
   * protótipo faz — lá não há caminho de volta nenhum para os prazos.
   */
  async reabrir(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    autor: AutorDaRequisicao,
    id: string,
  ): Promise<TarefasAfetadas> {
    const hoje = diaCivil(this.relogio.agora(), fuso)
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const s = await carregarSessao(c, id)
      // A autorização ANTES do estado: quem não pode mexer na tarefa não
      // merece saber em que estado ela está.
      exigirAutorizacao(podeEditar(s, autor))
      if (s.status === 'aberta') throw new ConflictException('Esta sessão já está aberta.')

      // Estornar é um UPDATE, nunca um DELETE (regra 20). O índice único só
      // olha os vivos, então o estorno abre UMA vaga — a regra continua.
      await c.query(
        'UPDATE recebimentos SET estornado_em = now() WHERE tarefa_id = $1 AND estornado_em IS NULL',
        [id],
      )

      await c.query(
        `UPDATE tarefas SET status = 'aberta', concluida_em = NULL, historico = $2::jsonb
          WHERE id = $1`,
        [
          id,
          JSON.stringify([
            ...anexar(s.historico, {
              acao: 'reabrir',
              etapa: 'agendado',
              em: this.relogio.agora().toISOString(),
              porId: autor.id,
            } as EventoDeJornada),
          ]),
        ],
      )

      /**
       * O CONTATO DE RETORNO QUE ESTA CONCLUSÃO CRIOU É CANCELADO.
       *
       * Sem isso, a paciente que teve a última sessão reaberta por engano
       * continua na fila de "já pode repetir o procedimento" — e recebe a
       * ligação antes de terminar o tratamento.
       */
      const canceladas = await c.query<{ id: string }>(
        `UPDATE tarefas
            SET status = 'cancelada', obs = 'Sessão reaberta'
          WHERE clinica_id = $1 AND programa_id = $2 AND item_chave = $3
            AND tipo = $4 AND status = 'aberta' AND excluida_em IS NULL
          RETURNING id`,
        [clinicaId, s.programaId, s.itemChave, TIPO_RETORNO],
      )

      const r = await this.baixa.desfazer(c, clinicaId, id, 'sessao-reaberta')
      if (ehErro(r)) throw new ConflictException(r.erro.mensagem)

      return umaSo(
        await lerTarefas(c, clinicaId, hoje, [id, ...canceladas.rows.map((x) => x.id)]),
        id,
      )
    })
  }

  /* --------------------------------------------------------------- privados */

  /**
   * O contato de retorno, com as QUATRO condições do protótipo.
   *
   * `restam` (alguma sessão aberta do item), `jaTem` (retorno vivo do item),
   * programa não encerrado, e o procedimento ter regra de retorno. Tirar
   * qualquer uma produz ligação errada: sem `restam`, a clínica liga no meio
   * do tratamento; sem `jaTem`, liga duas vezes.
   */
  private async criarRetorno(
    c: Transacao,
    x: {
      clinicaId: ClinicaId
      sessao: SessaoCarregada
      programa: { situacao: string }
      itens: readonly ItemDoPrograma[]
      realizadaEm: string
      hoje: string
      autorId: PessoaId
    },
  ): Promise<readonly string[]> {
    const { sessao: s } = x
    // `cancelado` no protótipo, `encerrado` aqui: o programa que a paciente
    // abandonou não gera convite para repetir.
    if (x.programa.situacao !== 'ativo') return []

    const item = x.itens.find((i) => i.chave === s.itemChave)
    if (item === undefined) return []

    const abertas = await c.query(
      `SELECT 1 FROM tarefas
        WHERE programa_id = $1 AND item_chave = $2 AND tipo = $3
          AND status = 'aberta' AND excluida_em IS NULL LIMIT 1`,
      [s.programaId, s.itemChave, TIPO_SESSAO],
    )
    if (abertas.rowCount !== 0) return []

    const jaTem = await c.query(
      `SELECT 1 FROM tarefas
        WHERE programa_id = $1 AND item_chave = $2 AND tipo = $3
          AND status <> 'cancelada' AND excluida_em IS NULL LIMIT 1`,
      [s.programaId, s.itemChave, TIPO_RETORNO],
    )
    if (jaTem.rowCount !== 0) return []

    const proc = await c.query<{
      nome: string
      retorno_quantidade: number | null
      retorno_unidade: 'd' | 'm'
      retorno_antecedencia_dias: number
      retorno_responsavel_id: string | null
      responsavel_ativo: boolean | null
    }>(
      `SELECT p.nome, p.retorno_quantidade, p.retorno_unidade, p.retorno_antecedencia_dias,
              p.retorno_responsavel_id, r.ativo AS responsavel_ativo
         FROM procedimentos p
         LEFT JOIN pessoas r ON r.id = p.retorno_responsavel_id
        WHERE p.id = $1`,
      [item.procedimentoId],
    )
    const l = proc.rows[0]
    if (l === undefined || l.retorno_quantidade === null) return []

    const regra: RegraDeRetorno = {
      quantidade: l.retorno_quantidade,
      unidade: l.retorno_unidade,
      antecedenciaDias: l.retorno_antecedencia_dias,
    }
    // `hoje` é o do SERVIDOR, no fuso da clínica (regra 24). O protótipo usa
    // `today()` do navegador, e é por isso que o clamp não pode copiá-lo.
    const r = retornoDe(regra, x.realizadaEm, x.hoje)
    if (r === null) return []

    /**
     * CANCELAR OS RETORNOS ANTIGOS DO MESMO PROCEDIMENTO, antes de criar.
     *
     * `'Paciente refez o procedimento'` — a frase é do protótipo. Sem isso, a
     * paciente que acabou de terminar o tratamento continua recebendo a
     * ligação de um retorno agendado no ciclo anterior.
     *
     * O casamento é por `procedimento_id`, não por programa: é o mesmo
     * procedimento que ela repetiu, venha de que adesão vier.
     */
    const canceladas = await c.query<{ id: string }>(
      `UPDATE tarefas
          SET status = 'cancelada', obs = 'Paciente refez o procedimento'
        WHERE clinica_id = $1 AND paciente_id = $2 AND tipo = $3
          AND status = 'aberta' AND excluida_em IS NULL
          AND procedimento_id = $4
        RETURNING id`,
      [x.clinicaId, s.pacienteId, TIPO_RETORNO, item.procedimentoId],
    )

    // O responsável do retorno: o do catálogo, se ATIVO; senão o do item.
    // `Code.gs:355` exige `ativo` pela mesma razão de sempre: tarefa atribuída
    // a quem saiu da clínica não aparece no "Para mim" de ninguém.
    const responsavel =
      l.retorno_responsavel_id !== null && l.responsavel_ativo === true
        ? l.retorno_responsavel_id
        : item.responsavelId

    // O formato é o do protótipo, copiado literalmente — é o texto que a
    // recepção lê na fila de ligações.
    const descricao =
      `Contato para repetir ${l.nome} · pode repetir a partir de ${emBrasileiro(r.podeEm)}`.slice(
        0,
        400,
      )

    const nova = await c.query<{ id: string }>(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, prioridade, status,
          paciente_id, tipo, historico, programa_id, item_chave, procedimento_id, unidade_id)
       VALUES ($1,$2,$3,$4,$5::date,'normal','aberta',$6,$7,'[]',$8,$9,$10,$11)
       RETURNING id`,
      [
        x.clinicaId,
        x.autorId,
        responsavel,
        descricao,
        r.prazo,
        s.pacienteId,
        TIPO_RETORNO,
        s.programaId,
        s.itemChave,
        item.procedimentoId,
        s.unidadeId,
      ],
    )
    return [...canceladas.rows.map((y) => y.id), nova.rows[0]!.id]
  }

  /**
   * O que a sessão consome: **a dose DO ITEM**, mais os descartáveis do
   * procedimento.
   *
   * A dose do item vence a do procedimento, e isso é clínico: o cadastro traz
   * a dose padrão, e o item traz a dose **daquela paciente**. Usar a do
   * catálogo aplicaria 5 mg em quem está na escalada de 2,5 mg.
   *
   * Este épico **não converte nada** (regras 9 e 10): a quantidade vai na
   * unidade em que foi declarada, e a conversão vive no cadastro do item, no
   * épico 6.
   */
  private async insumosDa(c: Transacao, item: ItemDoPrograma): Promise<InsumoParaBaixa[]> {
    const fora: InsumoParaBaixa[] = []

    if (item.insumoId !== null && item.insumoMilesimos !== null && item.insumoUnidade !== null) {
      fora.push({
        itemId: item.insumoId,
        quantidade: quantidadeDe(item.insumoMilesimos, item.insumoUnidade),
        principal: true,
      })
    } else {
      const p = await c.query<{
        insumo_padrao_id: string | null
        insumo_padrao_milesimos: string | null
        insumo_padrao_unidade: string | null
      }>(
        `SELECT insumo_padrao_id, insumo_padrao_milesimos::text AS insumo_padrao_milesimos,
                insumo_padrao_unidade
           FROM procedimentos WHERE id = $1`,
        [item.procedimentoId],
      )
      const l = p.rows[0]
      if (
        l !== undefined &&
        l.insumo_padrao_id !== null &&
        l.insumo_padrao_milesimos !== null &&
        l.insumo_padrao_unidade !== null
      ) {
        fora.push({
          itemId: l.insumo_padrao_id,
          quantidade: quantidadeDe(BigInt(l.insumo_padrao_milesimos), l.insumo_padrao_unidade),
          principal: true,
        })
      }
    }

    const desc = await c.query<{ item_id: string; milesimos: string; unidade: string }>(
      `SELECT item_id, milesimos::text AS milesimos, unidade
         FROM insumos_do_procedimento WHERE procedimento_id = $1 ORDER BY ordem, criado_em`,
      [item.procedimentoId],
    )
    for (const d of desc.rows) {
      fora.push({
        itemId: d.item_id,
        quantidade: quantidadeDe(BigInt(d.milesimos), d.unidade),
        // Descartável NUNCA é principal: uma seringa não tem sobra de frasco
        // aberto, e tratá-la como principal somaria descarte de algo que
        // ninguém abriu.
        principal: false,
      })
    }
    return fora
  }
}

/* ============================================================== auxiliares */

/** `Quantidade` carrega a unidade no tipo: a dose nunca anda sem ela. */
const quantidadeDe = (milesimos: bigint, unidade: string) =>
  Quantidade.deMilesimos(milesimos, unidade)

const paraCronograma = (i: ItemDoPrograma): ItemParaCronograma => ({
  chave: i.chave,
  sessoes: i.sessoes,
  intervaloDias: i.intervaloDias,
  inicio: i.inicio,
  depoisDe: i.depoisDe,
})

/** `25/02/27` — o formato que o protótipo escreve na descrição do retorno. */
function emBrasileiro(dia: string): string {
  const [a, m, d] = dia.split('-')
  return `${d}/${m}/${a!.slice(2)}`
}

function exigirAutorizacao(r: Result<void>): void {
  if (ehOk(r)) return
  if (r.erro.codigo === 'TAREFA_CANCELADA' || r.erro.codigo === 'TAREFA_JA_CONCLUIDA') {
    throw new ConflictException(r.erro.mensagem)
  }
  throw new ForbiddenException(r.erro.mensagem)
}

/**
 * `FOR UPDATE` na sessão: duas pessoas tocando o círculo da mesma aplicação
 * chegariam as duas em "aberta", e a segunda tentaria o segundo recebimento.
 * Com o bloqueio, a segunda espera, lê "concluída" e recebe o 409 que explica.
 */
async function carregarSessao(c: Transacao, id: string): Promise<SessaoCarregada> {
  const r = await c.query<{
    id: string
    solicitante_id: string
    responsavel_id: string
    status: StatusDeTarefa
    tipo: string
    paciente_id: string | null
    unidade_id: string | null
    programa_id: string | null
    item_chave: string | null
    sessao_indice: number | null
    procedimento_id: string | null
    historico: EventoDeJornada[]
  }>(
    `SELECT id, solicitante_id, responsavel_id, status, tipo, paciente_id, unidade_id,
            programa_id, item_chave, sessao_indice, procedimento_id, historico
       FROM tarefas WHERE id = $1 AND excluida_em IS NULL FOR UPDATE`,
    [id],
  )
  const l = r.rows[0]
  // 404 e não 409: a RLS já filtrou por clínica, e zero linhas é a mesma
  // resposta de "não existe" — que é o status que não confirma a existência
  // de nada. Uma tarefa que não é sessão cai no mesmo 404 de propósito: dizer
  // "não é sessão" confirmaria que a tarefa existe.
  if (l === undefined || l.tipo !== TIPO_SESSAO) {
    throw new NotFoundException('Sessão de programa não encontrada.')
  }
  return {
    id: l.id,
    solicitanteId: l.solicitante_id,
    responsavelId: l.responsavel_id,
    status: l.status,
    tipo: l.tipo,
    pacienteId: l.paciente_id,
    unidadeId: l.unidade_id,
    // Garantidos pelo `CHECK sessao_e_do_programa` da 0010.
    programaId: l.programa_id!,
    itemChave: l.item_chave!,
    indice: l.sessao_indice!,
    procedimentoId: l.procedimento_id,
    historico: l.historico,
  }
}

async function carregarPrograma(c: Transacao, id: string): Promise<{ situacao: string }> {
  const r = await c.query<{ situacao: string }>(
    `SELECT situacao FROM programas WHERE id = $1 AND excluido_em IS NULL FOR UPDATE`,
    [id],
  )
  const l = r.rows[0]
  if (l === undefined) throw new NotFoundException('Programa não encontrado.')
  return l
}

async function carregarItens(c: Transacao, programaId: string): Promise<ItemDoPrograma[]> {
  const r = await c.query<{
    chave: string
    sessoes: number
    intervalo_dias: number
    inicio: string
    depois_de: string | null
    responsavel_id: string
    procedimento_id: string
    procedimento_nome: string
    insumo_id: string | null
    insumo_milesimos: string | null
    insumo_unidade: string | null
  }>(
    `SELECT chave, sessoes, intervalo_dias, inicio::text AS inicio, depois_de, responsavel_id,
            procedimento_id, procedimento_nome, insumo_id,
            insumo_milesimos::text AS insumo_milesimos, insumo_unidade
       FROM itens_do_programa WHERE programa_id = $1 ORDER BY ordem`,
    [programaId],
  )
  return r.rows.map((l) => ({
    chave: l.chave,
    sessoes: l.sessoes,
    intervaloDias: l.intervalo_dias,
    inicio: l.inicio,
    depoisDe: l.depois_de,
    responsavelId: l.responsavel_id,
    procedimentoId: l.procedimento_id,
    procedimentoNome: l.procedimento_nome,
    insumoId: l.insumo_id,
    insumoMilesimos: l.insumo_milesimos === null ? null : BigInt(l.insumo_milesimos),
    insumoUnidade: l.insumo_unidade,
  }))
}

/** Todas as sessões do programa, como o domínio as espera. */
async function lerSessoes(c: Transacao, programaId: string): Promise<SessaoExistente[]> {
  const r = await c.query<{
    id: string
    item_chave: string
    sessao_indice: number
    prazo: string
    status: StatusDeTarefa
  }>(
    `SELECT id, item_chave, sessao_indice, prazo::text AS prazo, status
       FROM tarefas
      WHERE programa_id = $1 AND tipo = $2 AND excluida_em IS NULL
      ORDER BY item_chave, sessao_indice`,
    [programaId, TIPO_SESSAO],
  )
  return r.rows.map((l) => ({
    tarefaId: l.id,
    itemChave: l.item_chave,
    indice: l.sessao_indice,
    prazo: l.prazo,
    status: l.status as SessaoExistente['status'],
  }))
}

function umaSo(todas: TarefasAfetadas['todas'], id: string): TarefasAfetadas {
  const a = todas.find((t) => t.id === id)
  if (a === undefined) throw new NotFoundException('Sessão de programa não encontrada.')
  return { tarefa: a, todas }
}
