import type {
  CaixaAberto,
  CaixaFechado,
  ConferenciaDeCaixa,
  FecharCaixa,
  FechamentoNaLista,
} from '@fir/contracts'
import {
  alteracoesDepoisDoFechamento,
  conferirCaixa,
  diaCivil,
  Dinheiro,
  esperadoDoCaixa,
  FORA_DA_CONFERENCIA,
  type Forma,
  FORMAS_DE_CONFERENCIA,
  janela,
  mudouDepoisDoFechamento,
} from '@fir/domain'
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { exigePessoa, type Ator, type PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { NA_GAVETA } from './dinheiro-que-entrou'

/** Quantos fechamentos a tela mostra em "Últimos fechamentos". É o do protótipo. */
const ULTIMOS = 15

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: Ator
  readonly fuso: string
}

type LinhaDoCaixa = {
  id: string
  dia: string
  obs: string
  fechado_por: string
  fechado_por_nome: string
  fechado_em: Date
}

type LinhaPorForma = { forma: string; esperado: string; contado: string }

const dinheiro = (texto: string): Dinheiro => Dinheiro.deCentavos(BigInt(texto))

@Injectable()
export class CaixaService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * O caixa de um dia.
   *
   * **A regra 6 é a FORMA da resposta, não um `if` aqui.** Enquanto o dia está
   * aberto, o contrato que esta função devolve (`CaixaAberto`) não tem campo
   * `esperado`, nem `diferenca`, nem `porForma` — não é `null`, não é
   * redigido: **não existe**. Não há como construir a resposta do dia aberto
   * com o número dentro, e é por isso que não há nada a esquecer.
   *
   * Vale para o usuário mais privilegiado do sistema. Redação não é defesa
   * aqui: quem fecha o caixa COM `valores` continua precisando conferir às
   * cegas.
   */
  async doDia(ctx: Contexto, dia: string): Promise<ConferenciaDeCaixa> {
    this.exigirAteHoje(ctx, dia, 'A data do caixa precisa ser até hoje.')

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const caixa = await this.caixaDoDia(c, ctx, dia)
      if (caixa !== undefined) return this.fechado(c, ctx, caixa)

      const resp = await c.query<{ id: string; nome: string }>(
        `SELECT p.id, p.nome FROM configuracao_financeira f
           JOIN pessoas p ON p.id = f.caixa_responsavel_id
          WHERE f.clinica_id = $1 AND p.ativo`,
        [ctx.clinicaId],
      )
      const aberto: CaixaAberto = {
        dia,
        fechado: false,
        formas: [...FORMAS_DE_CONFERENCIA],
        responsavel: resp.rows[0] ?? null,
      }
      return aberto
    })
  }

  /**
   * Fecha o caixa — **o esperado e a gravação na MESMA transação**.
   *
   * Um recebimento lançado entre o `SELECT` do esperado e o `INSERT` cairia
   * fora dos dois lados: não entraria no esperado gravado e também não
   * apareceria como diferença. A conferência passaria a dizer que estava tudo
   * certo num dia em que faltou dinheiro.
   */
  async fechar(ctx: Contexto, dados: FecharCaixa): Promise<CaixaFechado> {
    this.exigirAteHoje(ctx, dados.dia, 'Só dá para fechar o caixa de hoje ou de um dia passado.')

    const contado = new Map<Forma, Dinheiro>(
      dados.contado.map((l) => [l.forma, Dinheiro.deCentavos(l.valor)]),
    )

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const esperado = esperadoDoCaixa(await this.recebimentosDoDia(c, ctx, dados.dia))
      // A aritmética é do domínio; o serviço só busca e grava.
      const conf = conferirCaixa(esperado, contado)

      let caixaId: string
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          // `caixas_do_dia.fechado_por` e NOT NULL: fechar o caixa e
          // ritual da clinica, feito por quem trabalha nela (D-13).
          [ctx.clinicaId, dados.dia, dados.obs, exigePessoa(ctx.ator)],
        )
        caixaId = r.rows[0]!.id
      } catch (e) {
        // O conflito vem do ÍNDICE `caixa_por_dia`, nunca de um `SELECT`
        // antes: ler-depois-escrever perde a corrida entre duas abas, e o
        // índice não perde. O primeiro fechamento fica intacto.
        if (ehCaixaRepetido(e)) {
          throw new ConflictException('O caixa deste dia já foi fechado.')
        }
        throw e
      }

      for (const l of conf.linhas) {
        await c.query(
          `INSERT INTO caixa_por_forma (clinica_id, caixa_id, forma, esperado, contado)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            ctx.clinicaId,
            caixaId,
            l.forma,
            l.esperado.centavos.toString(),
            l.contado.centavos.toString(),
          ],
        )
      }

      const caixa = await this.caixaDoDia(c, ctx, dados.dia)
      // `caixa` acabou de ser inserido nesta transação; ausente seria defeito.
      return this.fechado(c, ctx, caixa!)
    })
  }

  /**
   * Os últimos fechamentos — **só dias fechados, por construção**.
   *
   * Rota separada de `GET /v1/caixa` de propósito: embutir o histórico na
   * resposta do dia aberto poria `diferenca` dentro de um corpo que a regra 6
   * manda não ter a chave, e o teste de transporte (corretamente) reprovaria.
   */
  async ultimos(ctx: Contexto): Promise<readonly FechamentoNaLista[]> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDoCaixa & { diferenca: string; conferido: boolean }>(
        `SELECT cx.id, cx.dia::text AS dia, cx.obs, cx.fechado_por, p.nome AS fechado_por_nome,
                cx.fechado_em,
                coalesce(sum(f.contado - f.esperado), 0)::text AS diferenca,
                bool_and(f.contado = f.esperado) AS conferido
           FROM caixas_do_dia cx
           JOIN pessoas p ON p.id = cx.fechado_por
           LEFT JOIN caixa_por_forma f ON f.caixa_id = cx.id
          WHERE cx.clinica_id = $1
          GROUP BY cx.id, p.nome
          ORDER BY cx.dia DESC
          LIMIT ${ULTIMOS}`,
        [ctx.clinicaId],
      )
      const itens: FechamentoNaLista[] = []
      for (const x of r.rows) {
        // Uma leitura por dia, e são no máximo quinze: a mesma função da
        // leitura do dia, para que o selo da lista e o do dia nunca discordem.
        const depois = await this.depoisDoFechamento(c, ctx, x)
        itens.push({
          dia: x.dia,
          fechadoPor: x.fechado_por_nome,
          fechadoEm: x.fechado_em.toISOString(),
          obs: x.obs,
          // `conferido` é o booleano que a recepcionista sem `valores` lê, e ele
          // é POR LINHA: sobra em Pix e falta igual em dinheiro zeram o total e
          // a clínica teria dois erros achando que não tem nenhum.
          conferido: x.conferido,
          diferenca: x.diferenca,
          mudouDepoisDoFechamento: depois.mudou,
        })
      }
      return itens
    })
  }

  /** A resposta do dia FECHADO: agora sim a comparação, que é o que se veio ver. */
  private async fechado(
    c: pg.PoolClient,
    ctx: Contexto,
    caixa: LinhaDoCaixa,
  ): Promise<CaixaFechado> {
    const linhas = await c.query<LinhaPorForma>(
      `SELECT forma, esperado::text AS esperado, contado::text AS contado
         FROM caixa_por_forma WHERE caixa_id = $1`,
      [caixa.id],
    )

    // As duas leituras voltam ao DOMÍNIO em vez de virarem subtração no SQL:
    // `conferido` não é `diferenca = 0`, e a tabela `caixa_por_forma` não tem
    // coluna `diferenca` justamente para que ninguém a calcule duas vezes.
    const mapa = (pegar: (l: LinhaPorForma) => string): Map<Forma, Dinheiro> =>
      new Map(linhas.rows.map((l) => [l.forma as Forma, dinheiro(pegar(l))]))
    const conf = conferirCaixa(mapa((l) => l.esperado), mapa((l) => l.contado))

    const promissorias = await this.promissoriasDoDia(c, ctx, caixa.dia)
    const depois = await this.depoisDoFechamento(c, ctx, caixa, mapa((l) => l.esperado))

    return {
      dia: caixa.dia,
      fechado: true,
      conferido: conf.conferido,
      fechadoPor: { id: caixa.fechado_por, nome: caixa.fechado_por_nome },
      fechadoEm: caixa.fechado_em.toISOString(),
      obs: caixa.obs,
      porForma: conf.linhas.map((l) => ({
        forma: l.forma,
        esperado: l.esperado.centavos.toString(),
        contado: l.contado.centavos.toString(),
        diferenca: l.diferenca.centavos.toString(),
      })),
      diferenca: conf.diferenca.centavos.toString(),
      promissorias,
      mudouDepoisDoFechamento: depois.mudou,
      alteracoesDepoisDoFechamento: depois.alteracoes.map((a) => ({
        forma: a.forma,
        valor: a.valor.centavos.toString(),
      })),
    }
  }

  /**
   * **O QUE MUDOU DEPOIS DO FECHAMENTO (D-21)** — só existe para dia FECHADO.
   *
   * Recebe a linha de `caixas_do_dia`, e só a leitura de um dia fechado a tem:
   * a regra 6 continua sendo a forma do código, não um `if`. O esperado
   * guardado é lido, nunca recalculado — é o registro do que foi conferido.
   *
   * A soma viva é `esperadoDoCaixa(recebimentosDoDia(…))`: a MESMA função do
   * fechamento. Duas maneiras de somar dariam "mudou" para um dia que não
   * mudou.
   *
   * O evento posterior pega o caso que se anula — estorno de 100 e novo
   * recebimento de 100 depois de fechado. A diferença é zero; o dia mudou.
   * Conta só o que vai à gaveta (`NA_GAVETA`, sem promissória): a promissória
   * lançada num dia fechado não mexe em conferência nenhuma.
   */
  private async depoisDoFechamento(
    c: pg.PoolClient,
    ctx: Contexto,
    caixa: { id: string; dia: string; fechado_em: Date },
    guardadoLido?: ReadonlyMap<Forma, Dinheiro>,
  ): Promise<{ mudou: boolean; alteracoes: ReturnType<typeof alteracoesDepoisDoFechamento> }> {
    const guardado = guardadoLido ?? (await this.guardadoDoCaixa(c, caixa.id))
    const vivo = esperadoDoCaixa(await this.recebimentosDoDia(c, ctx, caixa.dia))
    const alteracoes = alteracoesDepoisDoFechamento(guardado, vivo)

    const j = janela(caixa.dia, caixa.dia, ctx.fuso)
    const ev = await c.query<{ houve: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM recebimentos r
           LEFT JOIN tarefas t ON t.id = r.tarefa_id
          WHERE r.clinica_id = $1 AND ${NA_GAVETA} AND r.forma <> $5
            AND r.recebido_em >= $2 AND r.recebido_em < $3
            AND (r.criado_em > $4 OR r.estornado_em > $4 OR t.excluida_em > $4)
       ) AS houve`,
      [ctx.clinicaId, j.de, j.ate, caixa.fechado_em, FORA_DA_CONFERENCIA],
    )
    return { mudou: mudouDepoisDoFechamento(alteracoes, ev.rows[0]!.houve), alteracoes }
  }

  private async guardadoDoCaixa(
    c: pg.PoolClient,
    caixaId: string,
  ): Promise<ReadonlyMap<Forma, Dinheiro>> {
    const r = await c.query<{ forma: string; esperado: string }>(
      'SELECT forma, esperado::text AS esperado FROM caixa_por_forma WHERE caixa_id = $1',
      [caixaId],
    )
    // `forma` vem do CHECK da tabela, restrito às quatro da gaveta.
    return new Map(r.rows.map((l) => [l.forma as Forma, dinheiro(l.esperado)]))
  }

  private async caixaDoDia(
    c: pg.PoolClient,
    ctx: Contexto,
    dia: string,
  ): Promise<LinhaDoCaixa | undefined> {
    const r = await c.query<LinhaDoCaixa>(
      `SELECT cx.id, cx.dia::text AS dia, cx.obs, cx.fechado_por, p.nome AS fechado_por_nome,
              cx.fechado_em
         FROM caixas_do_dia cx JOIN pessoas p ON p.id = cx.fechado_por
        WHERE cx.clinica_id = $1 AND cx.dia = $2::date`,
      [ctx.clinicaId, dia],
    )
    return r.rows[0]
  }

  /**
   * Os recebimentos VIVOS do dia civil da clínica.
   *
   * A janela é semiaberta `[início, fim)` com as bordas calculadas no fuso da
   * clínica (regra 23) — nunca `::date` sobre UTC, que mandaria o recebimento
   * das 21h de Salvador para o caixa do dia seguinte.
   */
  private async recebimentosDoDia(
    c: pg.PoolClient,
    ctx: Contexto,
    dia: string,
  ): Promise<readonly { forma: string; valor: Dinheiro }[]> {
    const j = janela(dia, dia, ctx.fuso)
    const r = await c.query<{ forma: string; valor: string }>(
      `SELECT r.forma, r.valor::text AS valor
         FROM recebimentos r
         LEFT JOIN tarefas t ON t.id = r.tarefa_id
        WHERE r.clinica_id = $1 AND r.estornado_em IS NULL
          AND ${NA_GAVETA}
          AND r.recebido_em >= $2 AND r.recebido_em < $3
          AND (t.id IS NULL OR t.excluida_em IS NULL)`,
      [ctx.clinicaId, j.de, j.ate],
    )
    return r.rows.map((x) => ({ forma: x.forma, valor: dinheiro(x.valor) }))
  }

  /**
   * A nota promissória, **fora dos dois lados da conferência**.
   *
   * Ela continua sendo receita (entra no LTV e na Visão do mês); ela só não
   * está na gaveta. O protótipo a deixa entrar no `esperado` gravado e depois
   * a exclui do cálculo da diferença — um campo que a conferência ignora é um
   * campo que alguém soma um dia. Aqui ela sai num bloco próprio, informativo,
   * e só depois do fechamento.
   */
  private async promissoriasDoDia(
    c: pg.PoolClient,
    ctx: Contexto,
    dia: string,
  ): Promise<CaixaFechado['promissorias']> {
    const j = janela(dia, dia, ctx.fuso)
    const r = await c.query<{ n: string; valor: string }>(
      `SELECT count(*)::text AS n, coalesce(sum(r.valor), 0)::text AS valor
         FROM recebimentos r
         LEFT JOIN tarefas t ON t.id = r.tarefa_id
        WHERE r.clinica_id = $1 AND r.estornado_em IS NULL AND r.forma = $4
          AND ${NA_GAVETA}
          AND r.recebido_em >= $2 AND r.recebido_em < $3
          AND (t.id IS NULL OR t.excluida_em IS NULL)`,
      [ctx.clinicaId, j.de, j.ate, FORA_DA_CONFERENCIA],
    )
    return { quantidade: Number(r.rows[0]!.n), valor: r.rows[0]!.valor }
  }

  /** A data de negócio é do SERVIDOR, no fuso da clínica (regra 24). */
  private exigirAteHoje(ctx: Contexto, dia: string, mensagem: string): void {
    if (dia > diaCivil(this.relogio.agora(), ctx.fuso)) throw new BadRequestException(mensagem)
  }
}

/** `23505` = unique_violation, no índice `caixa_por_dia`. */
const ehCaixaRepetido = (e: unknown): boolean =>
  typeof e === 'object' &&
  e !== null &&
  (e as { code?: string }).code === '23505' &&
  String((e as { constraint?: string }).constraint ?? '') === 'caixa_por_dia'
