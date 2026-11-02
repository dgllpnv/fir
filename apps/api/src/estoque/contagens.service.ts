import type {
  ConferenciaDeContagem,
  ContagemAberta,
  ContagemConcluida,
  ContagemNaLista,
  CriarContagem,
  ItemDaContagemAberta,
  ItemDaContagemConcluida,
  ListaDeContagens,
  ResultadoDaContagem,
  SalvarContagem,
} from '@fir/contracts'
import {
  Quantidade,
  analiseDaContagem,
  curvaABC,
  ehAltoValor,
  saldoEmMedida,
  somarDias,
  somarMeses,
} from '@fir/domain'
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type pg from 'pg'
import { exigePessoa, pessoaDoAtor, type Ator, type PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { diaDaClinica } from './dia-da-clinica'
import { gravarMovimento, movimentosDosItens, quantidadeNaSaida } from './movimentos.repositorio'

/**
 * **`criarContagem` e `salvarContagem`** — a contagem ÀS CEGAS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS QUATRO COISAS QUE ESTE SERVIÇO FAZ, E CADA UMA É UMA REGRA
 *
 *  1. **O ESPERADO NÃO ATRAVESSA ANTES DO FECHAMENTO** (regra 14). Enquanto a
 *     contagem está aberta, o que sai daqui é `ContagemAberta`, que **não tem**
 *     `esperadoEmEstoque`, `anteriorEmEstoque` nem `diferencaEmEstoque` — e
 *     também não tem os LOTES conhecidos do item, porque pré-preencher as
 *     validades é contar à pessoa o que o sistema espera achar na prateleira.
 *     Não há `if` sobre valor nesta classe: enquanto aberta, o número **não é
 *     calculado**.
 *
 *  2. **O FILTRO É RESOLVIDO AQUI, não no cliente.** `altoValor` depende da
 *     curva ABC, que depende do CUSTO de cada item — e custo é redigido para
 *     quem não tem `valores` (regra 17). Resolvido na tela, o filtro "alto
 *     valor" da enfermagem devolveria o catálogo inteiro.
 *
 *  3. **A DIFERENÇA É RELATADA, NUNCA CORRIGIDA** (regra 13). Concluir grava
 *     os movimentos de `contagem` e **mais nada**: nenhum ajuste nasce aqui.
 *     Corrigir é um `ajuste` com motivo e `estoque.gerir`, por `movEstoque`, e
 *     ele aparece como ajuste na análise seguinte.
 *
 *  4. **A CONTAGEM DE UM ITEM COM VALIDADE É UM GRUPO** de movimentos, uma
 *     linha por lote, amarradas por `contagem_id`. Ver a decisão 1 da
 *     migration 0017.
 * ────────────────────────────────────────────────────────────────────────────
 */

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: Ator
  readonly fuso: string
}

type LinhaDeContagem = {
  id: string
  nome: string
  filtro: string
  categoria: string
  local_id: string | null
  local: string | null
  unidade_id: string | null
  responsavel_id: string
  responsavel: string
  prazo: string
  repetir: string
  situacao: string
  concluida_em: string | null
  tarefa_id: string | null
  criada_em: Date
}

const SELECT_CONTAGEM = `
  SELECT c.id, c.nome, c.filtro, c.categoria, c.local_id, l.nome AS local,
         c.unidade_id, c.responsavel_id, p.nome AS responsavel,
         to_char(c.prazo, 'YYYY-MM-DD') AS prazo, c.repetir, c.situacao,
         to_char(c.concluida_em, 'YYYY-MM-DD') AS concluida_em,
         c.tarefa_id, c.criada_em
    FROM contagens_de_estoque c
    JOIN pessoas p ON p.id = c.responsavel_id
    LEFT JOIN locais_de_estoque l ON l.id = c.local_id`

/**
 * A mesma leitura, mais os DOIS contadores da lista — "3 de 12 contados".
 *
 * Os contadores saem do SERVIDOR porque a alternativa é a tela baixar os itens
 * de todas as contagens para desenhar um cartão de duas linhas. É a mesma razão
 * de `pacientesAtivos` no catálogo de procedimentos.
 *
 * Escrito por extenso e não por `replace` sobre `SELECT_CONTAGEM`: a primeira
 * versão injetava as subconsultas com um `String.replace` no `FROM`, e uma
 * consulta montada por substituição de texto é uma consulta que ninguém
 * consegue ler nem procurar no código.
 */
const SELECT_CONTAGEM_COM_CONTAGENS = `
  SELECT c.id, c.nome, c.filtro, c.categoria, c.local_id, l.nome AS local,
         c.unidade_id, c.responsavel_id, p.nome AS responsavel,
         to_char(c.prazo, 'YYYY-MM-DD') AS prazo, c.repetir, c.situacao,
         to_char(c.concluida_em, 'YYYY-MM-DD') AS concluida_em,
         c.tarefa_id, c.criada_em,
         (SELECT count(*) FROM itens_da_contagem x WHERE x.contagem_id = c.id)::text AS itens,
         (SELECT count(DISTINCT y.item_id) FROM contado_na_contagem y
           WHERE y.contagem_id = c.id)::text AS anotados
    FROM contagens_de_estoque c
    JOIN pessoas p ON p.id = c.responsavel_id
    LEFT JOIN locais_de_estoque l ON l.id = c.local_id`

/** O item da lista, com o que o cadastro diz — e nada do saldo. */
type LinhaDeItemDaLista = {
  item_id: string
  nome: string
  categoria: string
  medida: string
  controla_validade: boolean
  minimo: string | null
  custo: string | null
  responsavel_id: string | null
  local_id: string | null
  local: string | null
}

const SELECT_ITENS_DA_LISTA = `
  SELECT ic.item_id, i.nome, i.categoria, i.medida, i.controla_validade,
         i.minimo::text AS minimo, i.custo::text AS custo,
         i.responsavel_id, i.local_id, l.nome AS local
    FROM itens_da_contagem ic
    JOIN itens_de_estoque i ON i.id = ic.item_id
    LEFT JOIN locais_de_estoque l ON l.id = i.local_id
   WHERE ic.contagem_id = $1
   ORDER BY coalesce(l.nome, 'zzz'), i.nome`

type LinhaDoRascunho = { item_id: string; lote: string | null; milesimos: string }

@Injectable()
export class ContagensService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async listar(ctx: Contexto): Promise<ListaDeContagens> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDeContagem & { itens: string; anotados: string }>(
        `${SELECT_CONTAGEM_COM_CONTAGENS}
         ORDER BY c.situacao, c.prazo DESC, c.criada_em DESC
         LIMIT 100`,
      )
      return {
        contagens: r.rows.map(
          (l): ContagemNaLista => ({
            id: l.id,
            nome: l.nome,
            responsavel: l.responsavel,
            prazo: l.prazo,
            repetir: l.repetir as ContagemNaLista['repetir'],
            concluida: l.situacao === 'concluida',
            concluidaEm: l.concluida_em,
            // O ATRASO vem do servidor, contra o hoje da clínica (regra 24): o
            // computador de balcão com a data errada pintaria de vermelho uma
            // contagem que ninguém atrasou.
            atrasada: l.situacao === 'aberta' && l.prazo < hoje,
            quantidadeDeItens: Number(l.itens),
            anotados: Number(l.anotados),
          }),
        ),
      }
    })
  }

  async ver(ctx: Contexto, id: string): Promise<ConferenciaDeContagem> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, (c) => this.montar(c, ctx, id))
  }

  /**
   * `criarContagem` — resolve o filtro em itens e cria a TAREFA de quem conta.
   *
   * A tarefa não é enfeite: é o que faz a contagem entrar na rotina em vez de
   * ficar numa aba que ninguém abre. É o produto inteiro desta ferramenta.
   */
  async criar(ctx: Contexto, d: CriarContagem): Promise<ResultadoDaContagem> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const id = await this.abrir(c, ctx, d, hoje, null)
      return {
        contagem: await this.montar(c, ctx, id),
        proximaEm: null,
        proximaId: null,
        reposicoes: 0,
      }
    })
  }

  /**
   * `salvarContagem` — grava o rascunho e, com `concluir`, fecha.
   *
   * O rascunho é um `DELETE` + `INSERT` das linhas DAQUELE item, e não um
   * `UPDATE` linha a linha: a pessoa pode ter removido uma validade que havia
   * digitado, e um `UPDATE` deixaria a linha velha viva — o total contado
   * passaria a incluir um lote que ela apagou da tela.
   */
  async salvar(ctx: Contexto, id: string, d: SalvarContagem): Promise<ResultadoDaContagem> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const atual = await linhaPorId(c, id)
      if (atual.situacao !== 'aberta') {
        throw new ConflictException(
          'Esta contagem já foi concluída. Gere uma lista nova para contar de novo.',
        )
      }

      const daLista = new Set(
        (await c.query<{ item_id: string }>(SELECT_ITENS_DA_LISTA, [id])).rows.map((x) => x.item_id),
      )

      for (const item of d.itens) {
        if (!daLista.has(item.itemId)) {
          throw new UnprocessableEntityException(
            'Um dos itens enviados não está nesta lista de contagem.',
          )
        }
        await c.query(
          'DELETE FROM contado_na_contagem WHERE contagem_id = $1 AND item_id = $2',
          [id, item.itemId],
        )
        for (const l of lotesLimpos(item.lotes)) {
          await c.query(
            `INSERT INTO contado_na_contagem
               (clinica_id, contagem_id, item_id, lote, milesimos, contado_por)
             VALUES ($1, $2, $3, $4::date, $5, $6)
             ON CONFLICT (contagem_id, item_id, lote) DO UPDATE SET milesimos =
               contado_na_contagem.milesimos + excluded.milesimos`,
            [ctx.clinicaId, id, item.itemId, l.lote, l.quantidade.toString(), pessoaDoAtor(ctx.ator)],
          )
        }
      }

      if (!d.concluir) {
        return {
          contagem: await this.montar(c, ctx, id),
          proximaEm: null,
          proximaId: null,
          reposicoes: 0,
        }
      }
      return this.concluir(c, ctx, atual, hoje, d.reposicao)
    })
  }

  /* ── privado ───────────────────────────────────────────────────────────── */

  /** Cria a contagem, resolve os itens e manda a tarefa. */
  private async abrir(
    c: pg.PoolClient,
    ctx: Contexto,
    d: CriarContagem,
    hoje: string,
    anteriorId: string | null,
  ): Promise<string> {
    if (d.filtro === 'categoria' && d.categoria === '') {
      throw new UnprocessableEntityException('Escolha a categoria da lista.')
    }
    if (d.filtro !== 'categoria' && d.categoria !== '') {
      throw new UnprocessableEntityException(
        'A categoria só vale no filtro por categoria.',
      )
    }
    // O prazo pode ser hoje ou depois — contar "até ontem" é um prazo que
    // nasce atrasado, e a lista abriria vermelha sem ninguém ter atrasado nada.
    if (d.prazo < hoje) {
      throw new UnprocessableEntityException(
        `A data de contar até não pode ser no passado. Hoje, nesta clínica, é ${hoje}.`,
      )
    }

    const itens = await this.itensDoFiltro(c, d)
    if (itens.length === 0) {
      throw new UnprocessableEntityException(
        'Nenhum item entra nessa lista. Confira o filtro, o local e a unidade.',
      )
    }

    const nome = d.nome !== '' ? d.nome : await nomeDaLista(c, d)

    const r = await c.query<{ id: string }>(
      `INSERT INTO contagens_de_estoque
         (clinica_id, nome, filtro, categoria, local_id, unidade_id, responsavel_id,
          prazo, repetir, anterior_id, criada_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11)
       RETURNING id`,
      [
        ctx.clinicaId,
        nome,
        d.filtro,
        d.categoria,
        d.localId ?? null,
        d.unidadeId ?? null,
        d.responsavelId,
        d.prazo,
        d.repetir,
        anteriorId,
        pessoaDoAtor(ctx.ator),
      ],
    )
    const id = r.rows[0]!.id

    for (const item of itens) {
      await c.query(
        'INSERT INTO itens_da_contagem (clinica_id, contagem_id, item_id) VALUES ($1,$2,$3)',
        [ctx.clinicaId, id, item],
      )
    }

    const tarefa = await c.query<{ id: string }>(
      `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo)
       VALUES ($1, $2, $3, $4, $5::date) RETURNING id`,
      // `tarefas.solicitante_id` e NOT NULL: a contagem VIRA uma tarefa de
      // quem vai contar, e a sessao de suporte nao assina tarefa (D-13).
      [ctx.clinicaId, exigePessoa(ctx.ator), d.responsavelId, nome, d.prazo],
    )
    await c.query('UPDATE contagens_de_estoque SET tarefa_id = $1 WHERE id = $2', [
      tarefa.rows[0]!.id,
      id,
    ])
    return id
  }

  /**
   * Os itens que o filtro alcança — **resolvido no servidor**.
   *
   * `altoValor` precisa do saldo e do custo de todo o catálogo, então ele é o
   * único ramo que lê movimento. Os outros são `WHERE` puro.
   */
  private async itensDoFiltro(c: pg.PoolClient, d: CriarContagem): Promise<string[]> {
    const condicoes = ['i.excluido_em IS NULL', 'i.ativo']
    const valores: unknown[] = []
    const por = (sql: string, v: unknown) => {
      valores.push(v)
      condicoes.push(sql.replace('$?', `$${valores.length}`))
    }
    if (d.localId != null) por('i.local_id = $?', d.localId)
    if (d.unidadeId != null) por('i.unidade_id = $?', d.unidadeId)
    if (d.filtro === 'rotatividade') condicoes.push('i.alta_rotatividade')
    if (d.filtro === 'categoria') por('normalizar_nome(i.categoria) = normalizar_nome($?)', d.categoria)

    const r = await c.query<{
      id: string
      medida: string
      custo: string | null
      alto_valor: string
    }>(
      `SELECT i.id, i.medida, i.custo::text AS custo, i.alto_valor
         FROM itens_de_estoque i
        WHERE ${condicoes.join(' AND ')}
        ORDER BY i.nome`,
      valores,
    )

    if (d.filtro !== 'altoValor' && d.filtro !== 'semContagem') {
      return r.rows.map((x) => x.id)
    }

    const movs = await movimentosDosItens(
      c,
      r.rows.map((x) => x.id),
    )

    if (d.filtro === 'semContagem') {
      // "Itens ainda sem contagem inicial" — e `semContagem` é do domínio, não
      // um `NOT EXISTS` em SQL: a pergunta "houve contagem?" tem de ser a
      // mesma que o saldo responde.
      return r.rows
        .filter((x) => saldoEmMedida(movs.get(x.id) ?? [], x.medida).semContagem)
        .map((x) => x.id)
    }

    const abc = curvaABC(
      r.rows.map((x) => ({
        id: x.id,
        // saldo (milésimos de medida) × custo (centavos por medida). A escala é
        // relativa e a comparação é entre itens, então não há dinheiro saindo
        // daqui — só a ordem.
        valor:
          saldoEmMedida(movs.get(x.id) ?? [], x.medida).saldo.milesimos *
          BigInt(x.custo ?? '0'),
      })),
    )
    return r.rows
      .filter((x) => ehAltoValor(x.alto_valor as '' | 'sim' | 'nao', abc.get(x.id)))
      .map((x) => x.id)
  }

  /**
   * O FECHAMENTO: os movimentos de contagem, a tarefa concluída, as reposições
   * e a próxima da rotina.
   *
   * Tudo na MESMA transação de `salvar`: uma contagem fechada cujos movimentos
   * não nasceram é um saldo que não mudou com um relatório dizendo que mudou.
   */
  private async concluir(
    c: pg.PoolClient,
    ctx: Contexto,
    atual: LinhaDeContagem,
    hoje: string,
    reposicao: boolean,
  ): Promise<ResultadoDaContagem> {
    const itens = (await c.query<LinhaDeItemDaLista>(SELECT_ITENS_DA_LISTA, [atual.id])).rows
    const rascunho = agruparRascunho(
      (
        await c.query<LinhaDoRascunho>(
          `SELECT item_id, to_char(lote, 'YYYY-MM-DD') AS lote, milesimos::text AS milesimos
             FROM contado_na_contagem WHERE contagem_id = $1`,
          [atual.id],
        )
      ).rows,
    )

    if (rascunho.size === 0) {
      throw new UnprocessableEntityException(
        'Informe a quantidade de pelo menos um item antes de concluir.',
      )
    }

    for (const item of itens) {
      const lotes = rascunho.get(item.item_id)
      if (lotes === undefined) continue
      for (const l of lotes) {
        if (item.controla_validade && l.lote === null && l.milesimos > 0n) {
          throw new UnprocessableEntityException(
            `"${item.nome}" controla validade: informe o vencimento do que foi contado.`,
          )
        }
        await gravarMovimento(c, {
          clinicaId: ctx.clinicaId,
          itemId: item.item_id,
          tipo: 'contagem',
          // Já em `medida`: é a prateleira que se conta.
          milesimos: l.milesimos,
          dia: hoje,
          lote: l.lote,
          contagemId: atual.id,
          obs: atual.nome.slice(0, 120),
          criadoPor: pessoaDoAtor(ctx.ator),
        })
      }
    }

    await c.query(
      `UPDATE contagens_de_estoque SET situacao = 'concluida', concluida_em = $2::date
        WHERE id = $1`,
      [atual.id, hoje],
    )
    if (atual.tarefa_id !== null) {
      await c.query(
        `UPDATE tarefas SET status = 'concluida', concluida_em = now()
          WHERE id = $1 AND status = 'aberta'`,
        [atual.tarefa_id],
      )
    }

    const reposicoes = reposicao ? await this.repor(c, ctx, itens, rascunho, hoje) : 0

    let proximaId: string | null = null
    let proximaEm: string | null = null
    if (atual.repetir !== '') {
      // A ÂNCORA é o dia da contagem concluída, e `somarMeses` é a regra 25:
      // mensal a partir de 31/01 cai em 28/02, não em 03/03.
      proximaEm =
        atual.repetir === 'mensal' ? somarMeses(hoje, 1) : somarDias(hoje, 14)
      proximaId = await this.abrir(
        c,
        ctx,
        {
          filtro: atual.filtro as CriarContagem['filtro'],
          categoria: atual.categoria,
          localId: atual.local_id,
          unidadeId: atual.unidade_id,
          responsavelId: atual.responsavel_id,
          prazo: proximaEm,
          repetir: atual.repetir as CriarContagem['repetir'],
          nome: atual.nome,
        },
        hoje,
        atual.id,
      )
    }

    return {
      contagem: await this.montar(c, ctx, atual.id),
      proximaEm,
      proximaId,
      reposicoes,
    }
  }

  /**
   * A TAREFA DE REPOSIÇÃO de quem ficou abaixo do mínimo.
   *
   * A idempotência é do índice `tarefa_de_reposicao_viva` (migration 0017): no
   * máximo UMA tarefa viva por item, garantida pelo banco. Com um `if` no
   * serviço, duas contagens concluídas ao mesmo tempo criariam duas tarefas
   * para o mesmo item — e a segunda só apareceria na lista de quem compra.
   */
  private async repor(
    c: pg.PoolClient,
    ctx: Contexto,
    itens: readonly LinhaDeItemDaLista[],
    rascunho: Map<string, readonly { lote: string | null; milesimos: bigint }[]>,
    hoje: string,
  ): Promise<number> {
    let criadas = 0
    // `tarefas.solicitante_id` e `responsavel_id` são NOT NULL e guardam uma
    // PESSOA. A tarefa de reposição nasce ao FECHAR a contagem, e fechar
    // contagem é ritual da clínica — a sessão de suporte é recusada (D-13).
    // Resolvido UMA vez, fora do laço: dentro dele, a recusa viria depois de
    // já ter criado as primeiras tarefas.
    const solicitante = exigePessoa(ctx.ator)
    for (const item of itens) {
      const lotes = rascunho.get(item.item_id)
      if (lotes === undefined || item.minimo === null) continue
      const contado = lotes.reduce((s, l) => s + l.milesimos, 0n)
      if (contado >= BigInt(item.minimo)) continue

      const contadoTexto = quantidadeNaSaida(
        emMedida(contado, item.medida),
      ).texto
      const minimoTexto = quantidadeNaSaida(
        emMedida(BigInt(item.minimo), item.medida),
      ).texto
      const r = await c.query(
        `INSERT INTO tarefas
           (clinica_id, solicitante_id, responsavel_id, descricao, prazo, item_de_estoque_id)
         VALUES ($1, $2, $3, $4, $5::date, $6)
         ON CONFLICT DO NOTHING`,
        [
          ctx.clinicaId,
          solicitante,
          // O responsável pelo ITEM, quando há; senão quem contou. É o
          // protótipo (`it.responsavelId || me.id`), e a razão é a do produto:
          // a tarefa precisa cair com alguém, nunca na fila de ninguém.
          item.responsavel_id ?? solicitante,
          `Repor estoque: ${item.nome} (tem ${contadoTexto}, mínimo ${minimoTexto})`,
          // Dois dias, como o protótipo: repor é urgente mas não é hoje.
          somarDias(hoje, 2),
          item.item_id,
        ],
      )
      if ((r.rowCount ?? 0) > 0) criadas++
    }
    return criadas
  }

  /**
   * A LEITURA, e é aqui que a regra 14 vive.
   *
   * Enquanto `situacao = 'aberta'`, este método **não chama
   * `analiseDaContagem`** e não lê movimento nenhum do item. Não é que o
   * número seja escondido: ele não é calculado, e a forma devolvida não tem
   * onde guardá-lo.
   */
  private async montar(
    c: pg.PoolClient,
    ctx: Contexto,
    id: string,
  ): Promise<ConferenciaDeContagem> {
    const l = await linhaPorId(c, id)
    const itens = (await c.query<LinhaDeItemDaLista>(SELECT_ITENS_DA_LISTA, [id])).rows
    const rascunho = agruparRascunho(
      (
        await c.query<LinhaDoRascunho>(
          `SELECT item_id, to_char(lote, 'YYYY-MM-DD') AS lote, milesimos::text AS milesimos
             FROM contado_na_contagem WHERE contagem_id = $1 ORDER BY lote NULLS FIRST`,
          [id],
        )
      ).rows,
    )

    const cabecalho = {
      id: l.id,
      nome: l.nome,
      filtro: l.filtro as ContagemAberta['filtro'],
      categoria: l.categoria,
      localId: l.local_id,
      local: l.local,
      unidadeId: l.unidade_id,
      responsavelId: l.responsavel_id,
      responsavel: l.responsavel,
      prazo: l.prazo,
      repetir: l.repetir as ContagemAberta['repetir'],
      tarefaId: l.tarefa_id,
      criadaEm: l.criada_em.toISOString(),
      quantidadeDeItens: itens.length,
      anotados: rascunho.size,
    }

    if (l.situacao !== 'concluida') {
      return {
        ...cabecalho,
        concluida: false,
        atrasada: l.prazo < diaDaClinica(this.relogio, ctx.fuso),
        itens: itens.map((i): ItemDaContagemAberta => {
          const lotes = rascunho.get(i.item_id) ?? []
          const total = lotes.reduce((s, x) => s + x.milesimos, 0n)
          return {
            itemId: i.item_id,
            nome: i.nome,
            categoria: i.categoria,
            medida: i.medida,
            controlaValidade: i.controla_validade,
            localId: i.local_id,
            local: i.local,
            contadoEmEstoque:
              lotes.length === 0 ? null : quantidadeNaSaida(emMedida(total, i.medida)),
            lotes: lotes.map((x) => ({
              lote: x.lote,
              quantidade: quantidadeNaSaida(emMedida(x.milesimos, i.medida)),
            })),
          }
        }),
      }
    }

    // CONCLUÍDA: agora sim a comparação, derivada dos movimentos (regra 11).
    const movs = await movimentosDosItens(
      c,
      itens.map((i) => i.item_id),
    )
    let valorDaFalta = 0n
    let itensComFalta = 0
    const saida = itens.map((i): ItemDaContagemConcluida => {
      const a = analiseDaContagem(movs.get(i.item_id) ?? [], id, i.medida)
      const q = (m: bigint) => quantidadeNaSaida(emMedida(m, i.medida))
      if (a === null) {
        return {
          itemId: i.item_id,
          nome: i.nome,
          categoria: i.categoria,
          medida: i.medida,
          controlaValidade: i.controla_validade,
          localId: i.local_id,
          local: i.local,
          anteriorEmEstoque: null,
          anteriorEm: null,
          entradasEmEstoque: q(0n),
          saidasEmEstoque: q(0n),
          ajustesEmEstoque: q(0n),
          esperadoEmEstoque: null,
          contadoEmEstoque: null,
          diferencaEmEstoque: null,
          abaixoDoMinimo: false,
        }
      }
      const falta = a.temEsperado && a.diferenca.milesimos < 0n ? -a.diferenca.milesimos : 0n
      if (falta > 0n) {
        itensComFalta++
        valorDaFalta += (falta * BigInt(i.custo ?? '0')) / 1_000n
      }
      return {
        itemId: i.item_id,
        nome: i.nome,
        categoria: i.categoria,
        medida: i.medida,
        controlaValidade: i.controla_validade,
        localId: i.local_id,
        local: i.local,
        anteriorEmEstoque: a.anterior === null ? null : q(a.anterior.quantidade.milesimos),
        anteriorEm: a.anterior?.dia ?? null,
        entradasEmEstoque: q(a.entradas.milesimos),
        saidasEmEstoque: q(a.saidas.milesimos),
        ajustesEmEstoque: q(a.ajustes.milesimos),
        esperadoEmEstoque: a.temEsperado ? q(a.esperado.milesimos) : null,
        contadoEmEstoque: q(a.contado.milesimos),
        diferencaEmEstoque: a.temEsperado ? q(a.diferenca.milesimos) : null,
        abaixoDoMinimo: i.minimo !== null && a.contado.milesimos < BigInt(i.minimo),
      }
    })

    return {
      ...cabecalho,
      concluida: true,
      concluidaEm: l.concluida_em!,
      itens: saida,
      itensComFalta,
      valorDaFalta: valorDaFalta.toString(),
    } satisfies ContagemConcluida
  }
}

/**
 * A quantidade de saída vem do DOMÍNIO, sempre — `quantidadeNaSaida` chama
 * `Quantidade.formatar()`, que é o formatador central (regra 7). Um
 * `toFixed`/`padStart` escrito aqui seria o segundo formatador de quantidade
 * do sistema, e seria este o que divergiria.
 */
const emMedida = (m: bigint, medida: string) => Quantidade.deMilesimos(m, medida)

async function linhaPorId(c: pg.PoolClient, id: string): Promise<LinhaDeContagem> {
  const r = await c.query<LinhaDeContagem>(`${SELECT_CONTAGEM} WHERE c.id = $1`, [id])
  const l = r.rows[0]
  // Sem cláusula de clínica: a RLS já a impõe, e a contagem da vizinha não
  // existe vista daqui.
  if (l === undefined) throw new NotFoundException('Contagem não encontrada.')
  return l
}

/**
 * As linhas do rascunho, por item — e **zeros com lote são descartados**.
 *
 * Contar "0 no lote de junho" é a mesma informação que não ter o lote de junho:
 * ele não está na prateleira. O que se guarda é o zero SEM lote, que diz "este
 * item está zerado" e é um fato — é a diferença entre "não achei nada" e "não
 * contei".
 */
function lotesLimpos(
  lotes: readonly { lote?: string | null | undefined; quantidade: bigint }[],
): readonly { lote: string | null; quantidade: bigint }[] {
  // Lista VAZIA apaga o rascunho — ela não vira "contei zero". Os dois estados
  // são diferentes, e confundi-los faz quem limpou o campo concluir com o
  // número velho.
  if (lotes.length === 0) return []
  const comLote = lotes.filter((l) => (l.lote ?? null) !== null && l.quantidade > 0n)
  if (comLote.length > 0) {
    return comLote.map((l) => ({ lote: l.lote ?? null, quantidade: l.quantidade }))
  }
  // Nenhum lote com quantidade: o item está zerado (ou não controla validade).
  const total = lotes.reduce((s, l) => s + l.quantidade, 0n)
  return [{ lote: null, quantidade: total }]
}

function agruparRascunho(
  linhas: readonly LinhaDoRascunho[],
): Map<string, readonly { lote: string | null; milesimos: bigint }[]> {
  const fora = new Map<string, { lote: string | null; milesimos: bigint }[]>()
  for (const l of linhas) {
    const atual = fora.get(l.item_id)
    const linha = { lote: l.lote, milesimos: BigInt(l.milesimos) }
    if (atual === undefined) fora.set(l.item_id, [linha])
    else atual.push(linha)
  }
  return fora
}

/**
 * O nome que a lista recebe quando ninguém o digitou.
 *
 * "Contagem · Geladeira · Alto valor" — montado no SERVIDOR, com os nomes que
 * o banco tem. Montado na tela, ele dependeria de a tela ter carregado a lista
 * de locais, e a contagem criada pelo atalho sairia com "Contagem · undefined".
 */
const ROTULO_DO_FILTRO: Record<CriarContagem['filtro'], string> = {
  todos: 'Todos os itens',
  rotatividade: 'Alta rotatividade',
  altoValor: 'Alto valor (curva ABC)',
  categoria: 'Categoria',
  semContagem: 'Sem contagem inicial',
}

async function nomeDaLista(c: pg.PoolClient, d: CriarContagem): Promise<string> {
  const nomeDe = async (tabela: string, id: string | null | undefined) => {
    if (id == null) return null
    const r = await c.query<{ nome: string }>(`SELECT nome FROM ${tabela} WHERE id = $1`, [id])
    return r.rows[0]?.nome ?? null
  }
  const partes = [
    'Contagem',
    await nomeDe('locais_de_estoque', d.localId),
    d.filtro === 'categoria' ? d.categoria : ROTULO_DO_FILTRO[d.filtro],
    await nomeDe('unidades', d.unidadeId),
  ].filter((x): x is string => x !== null)
  return partes.join(' · ').slice(0, 100)
}
