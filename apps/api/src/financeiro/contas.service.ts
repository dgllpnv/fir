import {
  CODIGO_CONFIRMACAO_NECESSARIA,
  type ConfirmacaoNecessaria,
  type ConsultaDeContas,
  type ContaNaLista,
  type DesfazerPagamentoDeConta,
  type ListaDeContas,
  type PagarConta,
  type ResultadoDoPagamento,
  type CriarConta,
  type SalvarConta,
} from '@fir/contracts'
import {
  diaCivil,
  Dinheiro,
  FORMA_NAO_INFORMADA,
  infoDaCategoria,
  podeDesfazerPagamento,
  somarDias,
  vencimentoDaRenovacao,
} from '@fir/domain'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { exigePessoa, pessoaDoAtor, type Ator, type PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { unidadeValida } from '../comum/unidade'

/** "Vence em até 3 dias" — o aviso da tela Hoje, MANUAL cap. 14. */
export const DIAS_DE_AVISO = 3

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: Ator
  readonly fuso: string
  /** `contas.gerir` vê e paga TODAS; só `contas` vê e paga as dela. */
  readonly gerir: boolean
}

type LinhaDeConta = {
  id: string
  descricao: string
  categoria: string
  valor: string
  vencimento: string
  fornecedor: string
  responsavel_id: string
  responsavel: string
  serie_id: string | null
  pago_em: string | null
  valor_pago: string | null
  forma_pagamento: string
  forma_prevista: string
  pago_por_nome: string | null
}

const SELECT_BASE = `
  SELECT c.id, c.descricao, c.categoria, c.valor::text AS valor, c.vencimento::text AS vencimento,
         c.fornecedor, c.responsavel_id, p.nome AS responsavel, c.serie_id,
         c.pago_em::text AS pago_em, c.valor_pago::text AS valor_pago, c.forma_pagamento,
         c.forma_prevista, pp.nome AS pago_por_nome
    FROM contas_a_pagar c JOIN pessoas p ON p.id = c.responsavel_id
    -- LEFT: conta aberta não tem quem pagou. A RLS de pessoas vale aqui
    -- também; pago_por é sempre pessoa da mesma clínica.
    LEFT JOIN pessoas pp ON pp.id = c.pago_por
   WHERE c.clinica_id = $1 AND c.excluida_em IS NULL`

/**
 * A linha da conta, com `vencida` e `tipo` DERIVADOS no servidor.
 *
 * `vencida` compara contra o hoje do servidor no fuso da clínica (regra 24): o
 * relógio do balcão com a data errada pintaria de vermelho a conta que ainda
 * tem prazo — ou, pior, deixaria de pintar a que venceu.
 *
 * `tipo` (fixa/variável) vem de `CATEGORIAS_DESP`, em `@fir/domain`, e não de
 * um `if` aqui: espalhar `categoria === 'Pessoal'` é como o legado passou a
 * ter a mesma regra em três lugares.
 */
const paraSaida = (l: LinhaDeConta, hoje: string): ContaNaLista => ({
  id: l.id,
  descricao: l.descricao,
  categoria: l.categoria,
  // Categoria fora da lista cai em variável, como `Outras despesas` — nunca
  // some, que é como uma linha sai da tela sem sair do total.
  tipo: infoDaCategoria(l.categoria)?.tipo ?? 'variavel',
  valor: l.valor,
  vencimento: l.vencimento,
  vencida: l.pago_em === null && l.vencimento < hoje,
  fornecedor: l.fornecedor,
  responsavelId: l.responsavel_id,
  responsavel: l.responsavel,
  // `mensal` é DERIVADO do vínculo de série, nunca um booleano próprio: duas
  // representações do mesmo fato divergem no dia em que alguém desmarca uma
  // e não a outra.
  mensal: l.serie_id !== null,
  pagoEm: l.pago_em,
  valorPago: l.valor_pago,
  formaPagamento: l.forma_pagamento,
  formaPrevista: l.forma_prevista,
  pagoPor: l.pago_por_nome,
})

/**
 * A forma que o filtro olha: a USADA numa conta paga, a PREVISTA numa aberta
 * (ADR 0020). Aparada como o domínio apara ao agrupar o bloco "Pago por
 * forma" — sem isso, `'Pix '` gravado cairia na linha "Pix" do bloco e
 * sumiria do filtro "Pix", e o total da lista deixaria de bater com a linha.
 */
const FORMA_DO_FILTRO = `btrim(CASE WHEN c.pago_em IS NULL THEN c.forma_prevista ELSE c.forma_pagamento END)`

@Injectable()
export class ContasService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  hojeDaClinica(fuso: string): string {
    return diaCivil(this.relogio.agora(), fuso)
  }

  async listar(ctx: Contexto, q: ConsultaDeContas): Promise<ListaDeContas> {
    const hoje = this.hojeDaClinica(ctx.fuso)
    const mes = q.mes ?? hoje.slice(0, 7)

    const filtros: string[] = []
    const params: unknown[] = [ctx.clinicaId]
    // **Os dois ALCANCES de `contas`.** Com `contas.gerir` a pessoa vê todas;
    // só com `contas`, as dela. Não são dois níveis — são dois alcances, e a
    // diferença importa: a conta do pró-labore não aparece para a recepção.
    if (!ctx.gerir) {
      // `pessoaDoAtor`: sem pessoa nao ha conta "dela", e a lista sai
      // vazia. O operador tem `contas.gerir` (acesso total), entao este
      // ramo nao e o dele — ele ve todas.
      params.push(pessoaDoAtor(ctx.ator))
      filtros.push(`c.responsavel_id = $${params.length}`)
    }
    if (q.situacao === 'abertas') filtros.push('c.pago_em IS NULL')
    if (q.situacao === 'pagas') {
      params.push(mes)
      filtros.push(`c.pago_em IS NOT NULL AND to_char(c.pago_em, 'YYYY-MM') = $${params.length}`)
    }
    if (q.situacao === 'todas') {
      // Abertas INTEIRAS (inclusive as vencidas de meses anteriores) mais as
      // pagas DO MÊS. É o recorte do protótipo, e é o que a clínica precisa
      // ver: a conta de agosto que ninguém pagou não some em outubro.
      params.push(mes)
      filtros.push(
        `(c.pago_em IS NULL OR to_char(c.pago_em, 'YYYY-MM') = $${params.length})`,
      )
    }

    if (q.forma !== undefined) {
      // O sentinela "Não informada" casa com `''` — e também com o texto
      // "Não informada" gravado, porque o domínio junta os dois na MESMA
      // linha do bloco. Qualquer outro valor casa com o texto gravado, dentro
      // ou fora de `FORMAS_DE_SAIDA`: toda linha do bloco é filtrável.
      params.push(q.forma)
      filtros.push(
        q.forma === FORMA_NAO_INFORMADA
          ? `${FORMA_DO_FILTRO} IN ('', $${params.length})`
          : `${FORMA_DO_FILTRO} = $${params.length}`,
      )
    }

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDeConta>(
        `${SELECT_BASE} ${filtros.map((f) => `AND ${f}`).join(' ')}
         ORDER BY c.pago_em DESC NULLS FIRST, c.vencimento ASC, c.descricao ASC`,
        params,
      )
      const itens = r.rows.map((x) => paraSaida(x, hoje))
      if (q.situacao !== 'pagas') return { itens }
      // O TOTAL É DO SERVIDOR, e das MESMAS linhas devolvidas: é ele que bate
      // com a linha do bloco "Pago por forma". A soma passa pelo `Dinheiro`
      // (regra 1), e o alcance já está aplicado — sem `contas.gerir` o total é
      // o das contas da pessoa, não o da clínica.
      const total = r.rows.reduce(
        (s, x) => s.mais(Dinheiro.deCentavos(BigInt(x.valor_pago ?? '0'))),
        Dinheiro.zero(),
      )
      return { itens, total: { valorPago: total.centavos.toString() } }
    })
  }

  /**
   * As contas que a tela Hoje avisa: as MINHAS que vencem em até 3 dias, mais
   * as já vencidas.
   *
   * O corte é do SERVIDOR, no fuso da clínica. "Minhas" aqui é sempre por
   * responsável, inclusive para quem tem `contas.gerir`: o lembrete é sobre o
   * que **eu** preciso pagar hoje, e encher a tela da gestora com as contas de
   * todo mundo é como ela para de olhar o bloco.
   */
  async paraAvisarHoje(ctx: Contexto): Promise<readonly ContaNaLista[]> {
    const hoje = this.hojeDaClinica(ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDeConta>(
        `${SELECT_BASE} AND c.pago_em IS NULL AND c.responsavel_id = $2 AND c.vencimento <= $3::date
         ORDER BY c.vencimento ASC, c.descricao ASC`,
        [ctx.clinicaId, pessoaDoAtor(ctx.ator), somarDias(hoje, DIAS_DE_AVISO)],
      )
      return r.rows.map((x) => paraSaida(x, hoje))
    })
  }

  async criar(ctx: Contexto, dados: CriarConta): Promise<ContaNaLista> {
    const hoje = this.hojeDaClinica(ctx.fuso)
    if (dados.pagamento !== undefined && dados.pagamento.em > hoje) {
      throw new BadRequestException('A data do pagamento precisa ser até hoje.')
    }
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      // Reenvio do mesmo lançamento (duplo toque, retry): devolve a conta que
      // o primeiro envio criou, sem pagar nem renovar de novo.
      if (dados.requisicaoId !== undefined) {
        const ja = await c.query<{ id: string }>(
          `SELECT id FROM contas_a_pagar WHERE clinica_id=$1 AND requisicao_id=$2`,
          [ctx.clinicaId, dados.requisicaoId],
        )
        if (ja.rows[0] !== undefined) return this.lerUma(c, ctx, ja.rows[0].id, hoje)
      }
      await this.exigirResponsavelAtivo(c, dados.responsavelId)
      const unidade = await unidadeValida(c, dados.unidadeId ?? null)
      // A ÂNCORA É O DIA DO PRIMEIRO VENCIMENTO, e o servidor a deriva. Pedi-la
      // ao cliente permitiria cadastrar uma conta que vence dia 10 e repete
      // dia 31.
      const serie = dados.mensal
        ? { id: randomUUID(), dia: Number(dados.vencimento.slice(8, 10)) }
        : null

      const r = await c.query<{ id: string }>(
        `INSERT INTO contas_a_pagar
           (clinica_id, descricao, categoria, valor, vencimento, fornecedor, responsavel_id,
            unidade_id, serie_id, dia_vencimento, criada_por, forma_prevista, requisicao_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [
          ctx.clinicaId,
          dados.descricao,
          dados.categoria,
          dados.valor.toString(),
          dados.vencimento,
          dados.fornecedor,
          dados.responsavelId,
          unidade,
          serie?.id ?? null,
          serie?.dia ?? null,
          pessoaDoAtor(ctx.ator),
          dados.formaPrevista,
          dados.requisicaoId ?? null,
        ],
      )
      const id = r.rows[0]!.id
      // "Conta já paga": a mesma baixa do Paguei, na mesma transação. Se ela
      // falhar, a conta também não nasce — nunca fica uma conta aberta que a
      // pessoa achava paga.
      if (dados.pagamento !== undefined) {
        const r2 = await this.pagarDentro(c, ctx, id, dados.pagamento, hoje)
        return r2.conta
      }
      return this.lerUma(c, ctx, id, hoje)
    })
  }

  async editar(ctx: Contexto, id: string, dados: SalvarConta): Promise<ContaNaLista> {
    const hoje = this.hojeDaClinica(ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      await this.exigirResponsavelAtivo(c, dados.responsavelId)
      const atual = await this.linhaCrua(c, ctx, id)
      const unidade = await unidadeValida(c, dados.unidadeId ?? null)

      // Manter a série quando ela já existe, e NUNCA reancorá-la pela edição:
      // mudar o vencimento de uma parcela não muda o dia em que a conta
      // repete. Marcar "mensal" numa conta solta cria a série; desmarcar a
      // desfaz, e a conta vira avulsa a partir dali.
      const temSerie = atual.serie_id !== null
      const serieId = dados.mensal ? (atual.serie_id ?? randomUUID()) : null
      const dia = dados.mensal
        ? temSerie
          ? await this.ancoraDa(c, atual.serie_id as string)
          : Number(dados.vencimento.slice(8, 10))
        : null

      const r = await c.query(
        `UPDATE contas_a_pagar
            SET descricao=$2, categoria=$3, valor=$4, vencimento=$5, fornecedor=$6,
                responsavel_id=$7, unidade_id=$8, serie_id=$9, dia_vencimento=$10,
                forma_prevista=$11
          WHERE id=$1 AND excluida_em IS NULL`,
        [
          id,
          dados.descricao,
          dados.categoria,
          dados.valor.toString(),
          dados.vencimento,
          dados.fornecedor,
          dados.responsavelId,
          unidade,
          serieId,
          dia,
          dados.formaPrevista,
        ],
      )
      if (r.rowCount === 0) throw new NotFoundException('Conta não encontrada.')
      return this.lerUma(c, ctx, id, hoje)
    })
  }

  /**
   * Soft delete — e **conta paga não se exclui**.
   *
   * O protótipo apaga qualquer uma, inclusive já paga. Apagar conta paga muda
   * o resultado do mês sem deixar rastro: o fechamento de outubro passa a dar
   * outro número, e não há onde olhar para saber por quê.
   */
  async excluir(ctx: Contexto, id: string): Promise<void> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const atual = await this.linhaCrua(c, ctx, id)
      if (atual.pago_em !== null) {
        throw new ConflictException(
          'Esta conta já foi paga e faz parte do resultado do mês. Para corrigir, use "Desfazer pagamento".',
        )
      }
      await c.query('UPDATE contas_a_pagar SET excluida_em = now() WHERE id = $1', [id])
    })
  }

  /**
   * Registra o pagamento — e a próxima da série **na mesma transação**.
   *
   * O `ON CONFLICT DO NOTHING` sobre `conta_da_serie_por_mes` é o que faz duas
   * abas pagando ao mesmo tempo gerarem UMA próxima. O protótipo usa
   * `if (!F.contas.some(y => y.descricao === c.descricao && …))`: a chave por
   * descrição quebra assim que alguém renomeia a conta, e o `if` perde a
   * corrida. O banco não perde.
   *
   * E a próxima só nasce se a série NÃO tem — nem teve e foi excluída — conta
   * com vencimento posterior a esta (`vencimentoDaRenovacao`, ajuste 10 do
   * gate): desfazer e refazer o Paguei, mesmo depois de adiar o vencimento ou
   * de excluir a seguinte, não dá à série uma segunda conta à frente.
   */
  async pagar(ctx: Contexto, id: string, dados: PagarConta): Promise<ResultadoDoPagamento> {
    const hoje = this.hojeDaClinica(ctx.fuso)
    if (dados.em > hoje) {
      throw new BadRequestException('A data do pagamento precisa ser até hoje.')
    }

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, (c) =>
      this.pagarDentro(c, ctx, id, dados, hoje),
    )
  }

  /**
   * A baixa em si, numa transação que o chamador já abriu: o Paguei e a conta
   * criada "já paga" passam pelo MESMO código — não existe um segundo caminho
   * de baixa que possa divergir do primeiro.
   */
  private async pagarDentro(
    c: pg.PoolClient,
    ctx: Contexto,
    id: string,
    dados: PagarConta,
    hoje: string,
  ): Promise<ResultadoDoPagamento> {
    const atual = await this.linhaCrua(c, ctx, id)
    if (atual.pago_em !== null) throw new ConflictException('Esta conta já foi paga.')

    // A FORMA GRAVADA É EXATAMENTE A RECEBIDA (ADR 0020, decisão 2). Ausente
    // ou `''` = "Não informada"; NUNCA `atual.forma_prevista`. A tela já
    // pré-preenche o Paguei com a prevista — se chegou vazio, foi a pessoa
    // que limpou, e o servidor não inventa a forma que o extrato vai cobrar.
    //
    // `AND pago_em IS NULL` + `rowCount`: dois "Paguei" ao mesmo tempo (duas
    // abas) liam a conta aberta e o segundo UPDATE SOBRESCREVIA o primeiro
    // pagamento em silêncio — achado no gate do desfazer (2026-11-08). Agora o
    // banco decide: o segundo recebe "já foi paga", e nada é sobrescrito.
    const pagou = await c.query(
      `UPDATE contas_a_pagar SET pago_em=$2, valor_pago=$3, forma_pagamento=$4, pago_por=$5
        WHERE id=$1 AND pago_em IS NULL`,
      [id, dados.em, dados.valor.toString(), dados.formaPagamento ?? '', pessoaDoAtor(ctx.ator)],
    )
    if (pagou.rowCount !== 1) throw new ConflictException('Esta conta já foi paga.')

    let proxima: ContaNaLista | null = null
    const vencimento =
      atual.serie_id === null
        ? null
        : await this.vencimentoDaRenovacao(c, ctx, atual.serie_id, atual.vencimento)
    if (vencimento !== null) {
      const nova = await c.query<{ id: string }>(
        `INSERT INTO contas_a_pagar
           (clinica_id, descricao, categoria, valor, vencimento, fornecedor, responsavel_id,
            unidade_id, serie_id, dia_vencimento, criada_por, forma_prevista)
         -- forma_prevista LISTADA: esquecê-la gravaria '' sem erro nenhum.
         -- forma_pagamento NÃO é copiada: o Pix por exceção deste mês não
         -- vira a previsão do próximo (ADR 0020, decisão 3).
         SELECT clinica_id, descricao, categoria, valor, $2::date, fornecedor, responsavel_id,
                unidade_id, serie_id, dia_vencimento, $3, forma_prevista
           FROM contas_a_pagar WHERE id = $1
         -- INFERENCIA pelas colunas, e nao ON CONFLICT ON CONSTRAINT:
         -- conta_da_serie_por_mes e um indice unico PARCIAL, e ON CONSTRAINT
         -- so enxerga constraints. Medido: o Postgres responde
         -- "constraint ... does not exist". O predicado do indice precisa
         -- ser repetido aqui para o planejador escolhe-lo.
         ON CONFLICT (clinica_id, serie_id, vencimento)
           WHERE serie_id IS NOT NULL AND excluida_em IS NULL
           DO NOTHING
         RETURNING id`,
        [id, vencimento, pessoaDoAtor(ctx.ator)],
      )
      const criada = nova.rows[0]
      if (criada !== undefined) proxima = await this.lerUma(c, ctx, criada.id, hoje)
    }

    return { conta: await this.lerUma(c, ctx, id, hoje), proxima }
  }

  /**
   * Desfaz o Paguei: a conta volta para EM ABERTO e o pagamento desfeito vai,
   * inteiro e com o motivo, para `pagamentos_de_conta_desfeitos` — na MESMA
   * transação (D-21, item 4; ajustes 9 e 11 do gate).
   *
   * `FOR UPDATE` serializa duas abas desfazendo ao mesmo tempo: a segunda
   * espera, relê a linha já aberta e recebe 409. O `UPDATE … AND pago_em IS NOT
   * NULL` e o `rowCount = 1` são a segunda trava — a linha append-only só
   * nasce de um pagamento que esta transação de fato desfez, e é isso que
   * mantém Σ registrados = Σ vivos + Σ desfeitos.
   *
   * A conta do mês seguinte, criada no Paguei original, FICA: pagar de novo
   * não a recria (`vencimentoDaRenovacao`).
   */
  async desfazerPagamento(
    ctx: Contexto,
    id: string,
    dados: DesfazerPagamentoDeConta,
  ): Promise<ContaNaLista> {
    const hoje = this.hojeDaClinica(ctx.fuso)
    // Corrigir o resultado do mês é ato de uma pessoa da clínica; a sessão de
    // suporte não assina `desfeito_por`.
    const desfeitoPor = exigePessoa(ctx.ator)

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<{
        pago_em: string | null
        valor_pago: string | null
        forma_pagamento: string
        pago_por: string | null
        categoria: string
        vencimento: string
      }>(
        `SELECT pago_em::text AS pago_em, valor_pago::text AS valor_pago, forma_pagamento,
                pago_por, categoria, vencimento::text AS vencimento
           FROM contas_a_pagar
          WHERE clinica_id = $1 AND id = $2 AND excluida_em IS NULL
            AND ($3::boolean OR responsavel_id = $4)
            FOR UPDATE`,
        [ctx.clinicaId, id, ctx.gerir, pessoaDoAtor(ctx.ator)],
      )
      const atual = r.rows[0]
      if (atual === undefined) throw new NotFoundException('Conta não encontrada.')

      const pode = podeDesfazerPagamento(atual.pago_em, hoje, dados.confirmarMesAnterior === true)
      if (pode.tipo === 'erro') {
        if (pode.erro.codigo === 'CONTA_NAO_PAGA') throw new ConflictException(pode.erro.mensagem)
        // SEM número nenhum: o 409 não passa pela redação central (ajuste 5).
        const corpo: ConfirmacaoNecessaria = {
          statusCode: 409,
          codigo: CODIGO_CONFIRMACAO_NECESSARIA,
          avisos: [...pode.erro.avisos],
          message: pode.erro.mensagem,
        }
        throw new ConflictException(corpo)
      }

      const limpou = await c.query(
        `UPDATE contas_a_pagar
            SET pago_em = NULL, valor_pago = NULL, forma_pagamento = '', pago_por = NULL
          WHERE id = $1 AND pago_em IS NOT NULL`,
        [id],
      )
      if (limpou.rowCount !== 1) throw new ConflictException('Esta conta não está paga.')

      await c.query(
        `INSERT INTO pagamentos_de_conta_desfeitos
           (clinica_id, conta_id, pago_em, valor_pago, forma_pagamento, pago_por,
            categoria, vencimento, motivo, desfeito_por)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8::date, $9, $10)`,
        [
          ctx.clinicaId,
          id,
          atual.pago_em,
          atual.valor_pago,
          atual.forma_pagamento,
          atual.pago_por,
          atual.categoria,
          atual.vencimento,
          dados.motivo,
          desfeitoPor,
        ],
      )
      return this.lerUma(c, ctx, id, hoje)
    })
  }

  /**
   * O vencimento da renovação — ou `null` se a série JÁ TEM conta depois desta,
   * inclusive excluída (ajuste 10). A regra é `vencimentoDaRenovacao`, do
   * domínio; aqui só se busca o que ela precisa olhar.
   *
   * Sem `excluida_em IS NULL` de propósito: a seguinte que a gestora excluiu
   * não volta porque alguém desfez e refez o Paguei (regra 27).
   */
  private async vencimentoDaRenovacao(
    c: pg.PoolClient,
    ctx: Contexto,
    serieId: string,
    vencimentoPago: string,
  ): Promise<string | null> {
    const ancora = await this.ancoraDa(c, serieId)
    const r = await c.query<{ vencimento: string }>(
      `SELECT vencimento::text AS vencimento FROM contas_a_pagar
        WHERE clinica_id = $1 AND serie_id = $2`,
      [ctx.clinicaId, serieId],
    )
    return vencimentoDaRenovacao(vencimentoPago, ancora, r.rows.map((x) => x.vencimento))
  }

  /**
   * A linha crua, com o ALCANCE aplicado.
   *
   * Quem tem só `contas` e pede a conta de outra pessoa recebe **404, não
   * 403**: 403 confirmaria que a conta existe — e quanto custa o pró-labore é
   * exatamente o que não se confirma a quem não pode ver.
   */
  private async linhaCrua(c: pg.PoolClient, ctx: Contexto, id: string): Promise<LinhaDeConta> {
    const r = await c.query<LinhaDeConta>(
      `${SELECT_BASE} AND c.id = $2 AND ($3::boolean OR c.responsavel_id = $4)`,
      [ctx.clinicaId, id, ctx.gerir, pessoaDoAtor(ctx.ator)],
    )
    const linha = r.rows[0]
    if (linha === undefined) throw new NotFoundException('Conta não encontrada.')
    return linha
  }

  private async lerUma(
    c: pg.PoolClient,
    ctx: Contexto,
    id: string,
    hoje: string,
  ): Promise<ContaNaLista> {
    return paraSaida(await this.linhaCrua(c, ctx, id), hoje)
  }

  /** O dia 1–31 em que a série repete. Guardado na série, nunca recalculado. */
  private async ancoraDa(c: pg.PoolClient, serieId: string): Promise<number> {
    const r = await c.query<{ dia: number }>(
      `SELECT dia_vencimento AS dia FROM contas_a_pagar
        WHERE serie_id = $1 AND dia_vencimento IS NOT NULL LIMIT 1`,
      [serieId],
    )
    // `serie_tem_ancora` garante no BANCO que série sem âncora não existe.
    return r.rows[0]!.dia
  }

  private async exigirResponsavelAtivo(c: pg.PoolClient, pessoaId: string): Promise<void> {
    const r = await c.query('SELECT 1 FROM pessoas WHERE id = $1 AND ativo', [pessoaId])
    if (r.rowCount === 0) {
      throw new BadRequestException('Escolha uma pessoa ativa como responsável pela conta.')
    }
  }
}
