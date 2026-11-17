import type {
  ConfigFinanceira,
  PercentualDaMeta,
  RotinaDeFechamento,
  VisaoDoMes as VisaoNoContrato,
} from '@fir/contracts'
import {
  atingimentoDaMetaDoMes,
  type ContaEmAberto,
  type DespesaPaga,
  diaCivil,
  diasUteisAte,
  Dinheiro,
  fimDoMes,
  janela,
  type MedidaDaMeta,
  medidoParaAMeta,
  type RecebimentoDoMes,
  somarMeses,
  visaoDoMes,
  type VisaoDoMes,
} from '@fir/domain'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { exigePessoa, type Ator, type PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { faturamentoLidoDoMedx, somaDoMedx } from '../integracoes/faturamento-lido'
import { PARTES_VIVAS } from './dinheiro-que-entrou'
import { outrasEntradasDaJanela } from './outras-entradas.repositorio'
import { recebidosDaJanela } from './recebido-por-dia'
import { pacientesQuePodemTerSaldo, saldosDe } from './saldo.repositorio'

/** O rótulo que liga a tarefa à rotina que a criou. `CONTEXT.md`: Marcador de rotina. */
export const MARCADOR_DE_FECHAMENTO = 'fechamento-do-mes'

/** Doze meses, que é o horizonte da rotina do protótipo. */
const MESES_DA_ROTINA = 12

const DESCRICAO_DO_FECHAMENTO =
  'Fechamento financeiro do mês: recebido, contas pagas por categoria, resultado e cobranças'

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: Ator
  readonly fuso: string
}

const dinheiro = (texto: string): Dinheiro => Dinheiro.deCentavos(BigInt(texto))
const somaDe = (xs: readonly { valor: Dinheiro }[]): Dinheiro => xs.reduce((s, x) => s.mais(x.valor), Dinheiro.zero())

@Injectable()
export class VisaoDoMesService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  mesCorrente(fuso: string): string {
    return diaCivil(this.relogio.agora(), fuso).slice(0, 7)
  }

  /**
   * A Visão do mês.
   *
   * **O serviço faz as consultas e a janela; a agregação inteira é de
   * `visaoDoMes`, em `@fir/domain`.** Nada aqui soma, divide ou decide — nem
   * mesmo o percentual, que é divisão inteira sobre `bigint` e mora lá pelo
   * mesmo motivo que o rateio mora lá.
   *
   * O MÊS ANTERIOR usa exatamente a mesma régua: as duas janelas saem da mesma
   * função, com o mesmo fuso. Uma comparação "vs. setembro" medida com réguas
   * diferentes é o jeito mais discreto de um relatório mentir.
   */
  async visao(ctx: Contexto, mes: string): Promise<VisaoNoContrato> {
    const hoje = diaCivil(this.relogio.agora(), ctx.fuso)
    const anterior = somarMeses(`${mes}-01`, -1).slice(0, 7)

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const [{ recebimentos: recebido, partes }, { recebimentos: recebidoAnterior }] =
        await Promise.all([this.recebidoNoMes(c, ctx, mes), this.recebidoNoMes(c, ctx, anterior)])
      const outras = await outrasEntradasDaJanela(
        c,
        ctx.clinicaId,
        janela(`${mes}-01`, fimDoMes(mes), ctx.fuso),
        ctx.fuso,
      )
      const [pagas, pagasAnterior] = await Promise.all([
        this.pagasNoMes(c, ctx, mes),
        this.pagasNoMes(c, ctx, anterior),
      ])

      // A REGRA 6 DENTRO DA VISÃO DO MÊS. `porForma` só alcança os dias que
      // já tiveram caixa fechado; o total do mês continua inteiro.
      const conferidos = await this.diasConferidos(c, ctx, mes)
      const diasComRecebimento = new Set(recebido.map((x) => x.dia))
      const semCaixa = [...diasComRecebimento].filter((d) => !conferidos.has(d))

      const meta = await this.metaDe(c, ctx, mes)
      const medida = await this.medidaDoMes(c, ctx, mes, hoje, meta, somaDe(recebido))

      const v = visaoDoMes({
        recebido,
        // As PARTES dos dias conferidos: é delas que vem a forma (regra 6 e 4.1).
        conferidos: partes.filter((x) => conferidos.has(x.dia)),
        outrasEntradas: outras,
        conferidoAte: ultimoDia(conferidos),
        diasSemCaixa: semCaixa.length,
        recebidoMesAnterior: somaDe(recebidoAnterior),
        pagas,
        pagasMesAnterior: pagasAnterior,
        aPagar: await this.aPagarAte(c, ctx, mes, hoje),
        aReceber: await this.aReceber(c, ctx),
        meta: meta?.valor ?? null,
        medidoParaAMeta: medida.medido,
        medidaDaMeta: medida.medidaPor,
        caixas: await this.caixasDoMes(c, ctx, mes),
        // "18 dias úteis passados" é do MANUAL, e é contado até HOJE — num mês
        // passado o laço para no fim do mês sozinho.
        diasUteis: diasUteisAte(mes, hoje),
      })

      return paraContrato(mes, v)
    })
  }

  /**
   * O percentual da meta — **a rota que a equipe lê, e a única sem `@Exige`**.
   *
   * A redação faz todo o trabalho: `meta` e `recebido` estão em
   * `CAMPOS_MONETARIOS` e saem `null`; `percentual` não é monetário e
   * atravessa. **Zero linha de código aqui decide permissão.**
   */
  async percentualDaMeta(ctx: Contexto, mes: string): Promise<PercentualDaMeta> {
    const hoje = diaCivil(this.relogio.agora(), ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const meta = await this.metaDe(c, ctx, mes)
      const recebido = somaDe((await this.recebidoNoMes(c, ctx, mes)).recebimentos)
      const medida = await this.medidaDoMes(c, ctx, mes, hoje, meta, recebido)
      // O MESMO cálculo da Visão do mês, sobre o MESMO medido: os dois
      // percentuais não divergem (N-B6, propriedade 13).
      const atingimento = atingimentoDaMetaDoMes(meta?.valor ?? null, medida.medido)
      return {
        mes,
        meta: meta === null ? null : meta.valor.centavos.toString(),
        recebido: recebido.centavos.toString(),
        medidaPor: medida.medidaPor,
        medido: medida.medido === null ? null : medida.medido.centavos.toString(),
        lidoEm: medida.lidoEm === null ? null : medida.lidoEm.toISOString(),
        percentual: atingimento.percentual,
      }
    })
  }

  /**
   * A régua e o valor medido do mês. A régua é a GRAVADA com a meta; sem
   * meta, o padrão da clínica (só para a tela dizer como o mês SERÁ medido).
   * Quem escolhe entre FIR e MedX é `medidoParaAMeta`, e só ele.
   */
  private async medidaDoMes(
    c: pg.PoolClient,
    ctx: Contexto,
    mes: string,
    hoje: string,
    meta: { valor: Dinheiro; medidaPor: MedidaDaMeta } | null,
    recebidoFir: Dinheiro,
  ): Promise<{ medidaPor: MedidaDaMeta; medido: Dinheiro | null; lidoEm: Date | null }> {
    const medidaPor = meta?.medidaPor ?? (await this.medidaPadrao(c, ctx))
    if (medidaPor === 'fir') return { medidaPor, medido: recebidoFir, lidoEm: null }
    const lido = await faturamentoLidoDoMedx(c, ctx.clinicaId, `${mes}-01`, fimDoMes(mes), hoje)
    const medido = medidoParaAMeta({
      medidaPor,
      recebidoFir,
      faturamentoMedx: lido === null ? null : somaDoMedx(lido).faturamento,
      coberturaMedxCompleta: lido?.coberturaCompleta ?? false,
    })
    return { medidaPor, medido, lidoEm: lido?.lidoEm ?? null }
  }

  /** O padrão da clínica para os meses novos: MedX só com o faturamento do MedX ligado. */
  private async medidaPadrao(c: pg.PoolClient, ctx: Contexto): Promise<MedidaDaMeta> {
    const r = await c.query<{ medida: MedidaDaMeta }>(
      `SELECT CASE WHEN faturamento_ligado AND meta_medida_por = 'medx' THEN 'medx' ELSE 'fir' END AS medida
         FROM integracoes_da_clinica WHERE clinica_id = $1`,
      [ctx.clinicaId],
    )
    return r.rows[0]?.medida ?? 'fir'
  }

  /** `PUT` idempotente. **Zero REMOVE a meta**, explicitamente. */
  async salvarMeta(ctx: Contexto, mes: string, valor: bigint): Promise<PercentualDaMeta> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      if (valor === 0n) {
        await c.query('DELETE FROM metas_do_mes WHERE clinica_id = $1 AND competencia = $2::date', [
          ctx.clinicaId,
          `${mes}-01`,
        ])
        return
      }
      // A régua é COPIADA da configuração da clínica quando a meta é definida
      // (N-B6): trocar a configuração depois não reescreve este mês. Editar a
      // meta do mês copia de novo, e a trilha de `metas_do_mes` registra.
      const medidaPor = await this.medidaPadrao(c, ctx)
      await c.query(
        `INSERT INTO metas_do_mes (clinica_id, competencia, valor, definida_por, medida_por)
         VALUES ($1, $2::date, $3, $4, $5)
         ON CONFLICT (clinica_id, competencia)
           DO UPDATE SET valor = EXCLUDED.valor, definida_por = EXCLUDED.definida_por,
                         medida_por = EXCLUDED.medida_por, definida_em = now()`,
        // `metas_do_mes.definida_por` e NOT NULL: a meta e da clinica,
        // definida por quem responde por ela (D-13).
        [ctx.clinicaId, `${mes}-01`, valor.toString(), exigePessoa(ctx.ator), medidaPor],
      )
    })
    return this.percentualDaMeta(ctx, mes)
  }

  async config(ctx: Contexto): Promise<ConfigFinanceira> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<{ caixa_responsavel_id: string | null; mensagem_de_cobranca: string }>(
        'SELECT caixa_responsavel_id, mensagem_de_cobranca FROM configuracao_financeira WHERE clinica_id = $1',
        [ctx.clinicaId],
      )
      const linha = r.rows[0]
      return {
        caixaResponsavelId: linha?.caixa_responsavel_id ?? null,
        mensagemDeCobranca: linha?.mensagem_de_cobranca ?? '',
      }
    })
  }

  async salvarConfig(ctx: Contexto, dados: ConfigFinanceira): Promise<ConfigFinanceira> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const responsavel = dados.caixaResponsavelId ?? null
      if (responsavel !== null) {
        // O responsável pelo caixa precisa estar ATIVO — mesmo espírito do
        // `Code.gs:355`: pessoa que saiu da clínica não recebe lembrete, e uma
        // configuração apontando para ela faz o caixa deixar de ser cobrado
        // de alguém sem ninguém notar.
        const p = await c.query('SELECT 1 FROM pessoas WHERE id = $1 AND ativo', [responsavel])
        if (p.rowCount === 0) {
          throw new BadRequestException('Escolha uma pessoa ativa como responsável pelo caixa.')
        }
      }
      await c.query(
        `INSERT INTO configuracao_financeira (clinica_id, caixa_responsavel_id, mensagem_de_cobranca)
         VALUES ($1,$2,$3)
         ON CONFLICT (clinica_id)
           DO UPDATE SET caixa_responsavel_id = EXCLUDED.caixa_responsavel_id,
                         mensagem_de_cobranca = EXCLUDED.mensagem_de_cobranca,
                         atualizada_em = now()`,
        [ctx.clinicaId, responsavel, dados.mensagemDeCobranca],
      )
      return {
        caixaResponsavelId: responsavel,
        mensagemDeCobranca: dados.mensagemDeCobranca,
      }
    })
  }

  /**
   * A rotina mensal de fechamento: doze tarefas, dia 1º, a partir do mês que
   * vem.
   *
   * **Idempotente sem lock**: o índice `tarefa_de_rotina
   * (clinica_id, marcador, prazo)` tem o PRAZO na chave, então o segundo toque
   * gera exatamente o mesmo conjunto e não escreve nada.
   */
  async criarRotina(ctx: Contexto): Promise<RotinaDeFechamento> {
    const hoje = diaCivil(this.relogio.agora(), ctx.fuso)
    const inicio = somarMeses(`${hoje.slice(0, 7)}-01`, 1)

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      let criadas = 0
      for (let i = 0; i < MESES_DA_ROTINA; i++) {
        const prazo = somarMeses(inicio, i)
        const r = await c.query(
          `INSERT INTO tarefas
             (clinica_id, solicitante_id, responsavel_id, descricao, prazo, prioridade, status,
              historico, resultado, obs, recorrencia, marcador)
           VALUES ($1,$2,$2,$3,$4::date,'normal','aberta','[]','','','Mensal',$5)
           ON CONFLICT (clinica_id, marcador, prazo)
             WHERE marcador IS NOT NULL AND excluida_em IS NULL
             DO NOTHING`,
          [
            ctx.clinicaId,
            exigePessoa(ctx.ator),
            DESCRICAO_DO_FECHAMENTO,
            prazo,
            MARCADOR_DE_FECHAMENTO,
          ],
        )
        criadas += r.rowCount ?? 0
      }
      return { criadas, deInicio: inicio }
    })
  }

  /* ------------------------------------------------------------- consultas */

  /**
   * Os recebimentos do mês (UM item por recebimento, com `r.valor`: a receita
   * conta cada pagamento uma vez) e as PARTES deles (uma por forma), cada um
   * com o DIA CIVIL da clínica em que caiu.
   *
   * São duas consultas de propósito, e não um JOIN: o JOIN com partes
   * multiplicaria o recebimento pelo número de formas e dobraria `recebido` —
   * é o erro clássico desta categoria, e `receita-nao-dobra-com-partes` o mede.
   * `Σ porForma = recebido` vale porque o banco garante `Σ partes = valor`.
   */
  private async recebidoNoMes(
    c: pg.PoolClient,
    ctx: Contexto,
    mes: string,
  ): Promise<{
    recebimentos: readonly (RecebimentoDoMes & { dia: string })[]
    partes: readonly { forma: string; valor: Dinheiro; dia: string }[]
  }> {
    const j = janela(`${mes}-01`, fimDoMes(mes), ctx.fuso)
    // A RECEITA SOMA `recebimentos`, e **nunca lê `tarefas`** (regra 4). A
    // consulta é a mesma da Conferência MedX × FIR do Painel (A8).
    const recebimentos = await recebidosDaJanela(c, ctx.clinicaId, j, ctx.fuso)
    const p = await c.query<{ forma: string; valor: string; dia: string }>(
      `SELECT pt.forma, pt.valor::text AS valor,
              ((r.recebido_em AT TIME ZONE $4)::date)::text AS dia
         FROM recebimento_partes pt
         JOIN recebimentos r ON r.id = pt.recebimento_id AND r.clinica_id = pt.clinica_id
         LEFT JOIN tarefas t ON t.id = r.tarefa_id
        WHERE r.clinica_id = $1 AND ${PARTES_VIVAS}
          AND r.recebido_em >= $2 AND r.recebido_em < $3`,
      [ctx.clinicaId, j.de, j.ate, ctx.fuso],
    )
    return {
      recebimentos,
      partes: p.rows.map((x) => ({ forma: x.forma, valor: dinheiro(x.valor), dia: x.dia })),
    }
  }

  private async pagasNoMes(
    c: pg.PoolClient,
    ctx: Contexto,
    mes: string,
  ): Promise<readonly DespesaPaga[]> {
    // O VALOR PAGO, nunca o valor da conta: a conta era R$ 980 e veio
    // R$ 1.012, e o mês fecha com 1.012.
    //
    // A forma USADA vem na MESMA consulta (ADR 0020): "Pago por forma" é uma
    // segunda partição destas mesmas linhas, e uma consulta à parte poderia
    // divergir de `despesasPagas` no primeiro filtro esquecido.
    const r = await c.query<{ categoria: string; valor: string; forma: string }>(
      `SELECT categoria, valor_pago::text AS valor, forma_pagamento AS forma FROM contas_a_pagar
        WHERE clinica_id = $1 AND excluida_em IS NULL AND pago_em IS NOT NULL
          AND to_char(pago_em, 'YYYY-MM') = $2`,
      [ctx.clinicaId, mes],
    )
    return r.rows.map((x) => ({ categoria: x.categoria, valor: dinheiro(x.valor), forma: x.forma }))
  }

  private async aPagarAte(
    c: pg.PoolClient,
    ctx: Contexto,
    mes: string,
    hoje: string,
  ): Promise<readonly ContaEmAberto[]> {
    // `<=` e não `=`: a conta de agosto que ninguém pagou não some em outubro.
    // É o que o protótipo faz (`mesDe(c.vencimento) <= m`) e é o que a clínica
    // precisa ver.
    const r = await c.query<{ valor: string; vencimento: string }>(
      `SELECT valor::text AS valor, vencimento::text AS vencimento FROM contas_a_pagar
        WHERE clinica_id = $1 AND excluida_em IS NULL AND pago_em IS NULL
          AND to_char(vencimento, 'YYYY-MM') <= $2`,
      [ctx.clinicaId, mes],
    )
    return r.rows.map((x) => ({ valor: dinheiro(x.valor), vencida: x.vencimento < hoje }))
  }

  /** O saldo a receber dos pacientes — a MESMA `saldoEmAberto` da tela Cobranças. */
  private async aReceber(c: pg.PoolClient, ctx: Contexto): Promise<Dinheiro> {
    const candidatos = await pacientesQuePodemTerSaldo(c, ctx.clinicaId)
    const saldos = await saldosDe(c, ctx.clinicaId, candidatos)
    return [...saldos.values()].reduce((s, x) => s.mais(x.saldo), Dinheiro.zero())
  }

  private async caixasDoMes(
    c: pg.PoolClient,
    ctx: Contexto,
    mes: string,
  ): Promise<readonly { diferenca: Dinheiro }[]> {
    const r = await c.query<{ diferenca: string }>(
      `SELECT coalesce(sum(f.contado - f.esperado), 0)::text AS diferenca
         FROM caixas_do_dia cx LEFT JOIN caixa_por_forma f ON f.caixa_id = cx.id
        WHERE cx.clinica_id = $1 AND to_char(cx.dia, 'YYYY-MM') = $2
        GROUP BY cx.id`,
      [ctx.clinicaId, mes],
    )
    return r.rows.map((x) => ({ diferenca: dinheiro(x.diferenca) }))
  }

  /** Os dias do mês cujo caixa já foi fechado. */
  private async diasConferidos(
    c: pg.PoolClient,
    ctx: Contexto,
    mes: string,
  ): Promise<ReadonlySet<string>> {
    const r = await c.query<{ dia: string }>(
      `SELECT dia::text AS dia FROM caixas_do_dia
        WHERE clinica_id = $1 AND to_char(dia, 'YYYY-MM') = $2`,
      [ctx.clinicaId, mes],
    )
    return new Set(r.rows.map((x) => x.dia))
  }

  private async metaDe(
    c: pg.PoolClient,
    ctx: Contexto,
    mes: string,
  ): Promise<{ valor: Dinheiro; medidaPor: MedidaDaMeta } | null> {
    const r = await c.query<{ valor: string; medida_por: MedidaDaMeta }>(
      'SELECT valor::text AS valor, medida_por FROM metas_do_mes WHERE clinica_id = $1 AND competencia = $2::date',
      [ctx.clinicaId, `${mes}-01`],
    )
    const linha = r.rows[0]
    return linha === undefined ? null : { valor: dinheiro(linha.valor), medidaPor: linha.medida_por }
  }
}

/** O último dia conferido, em ordem de calendário. `null` quando não há nenhum. */
function ultimoDia(dias: ReadonlySet<string>): string | null {
  let ultimo: string | null = null
  // Comparação lexicográfica: para `aaaa-mm-dd` é a mesma ordem da cronológica.
  for (const d of dias) if (ultimo === null || d > ultimo) ultimo = d
  return ultimo
}

/** O domínio na forma que o JSON fala: centavos em texto, `null` onde é nulo. */
function paraContrato(mes: string, v: VisaoDoMes): VisaoNoContrato {
  const t = (d: Dinheiro): string => d.centavos.toString()
  return {
    mes,
    recebido: t(v.recebido),
    quantidadeDeRecebimentos: v.quantidadeDeRecebimentos,
    outrasEntradas: t(v.outrasEntradas),
    quantidadeDeOutrasEntradas: v.quantidadeDeOutrasEntradas,
    porForma: v.porForma.map((x) => ({ forma: x.forma, valor: t(x.valor) })),
    porFormaAteODia: v.porFormaAteODia,
    porFormaDiasSemCaixa: v.porFormaDiasSemCaixa,
    pagoPorForma: v.pagoPorForma.map((x) => ({ forma: x.forma, valor: t(x.valor) })),
    mesAnterior: {
      recebido: t(v.mesAnterior.recebido),
      despesasPagas: t(v.mesAnterior.despesasPagas),
    },
    despesasPagas: t(v.despesasPagas),
    quantidadeDePagas: v.quantidadeDePagas,
    porCategoria: v.porCategoria.map((x) => ({
      categoria: x.categoria,
      tipo: x.tipo,
      valor: t(x.valor),
      percentual: x.percentual,
      mesAnterior: { valor: t(x.mesAnterior.valor) },
    })),
    fixas: t(v.fixas),
    variaveis: t(v.variaveis),
    percentualFixas: v.percentualFixas,
    percentualVariaveis: v.percentualVariaveis,
    resultadoDoMes: t(v.resultadoDoMes),
    percentualDoResultado: v.percentualDoResultado,
    aPagar: t(v.aPagar),
    quantidadeAPagar: v.quantidadeAPagar,
    quantidadeVencidas: v.quantidadeVencidas,
    aReceber: t(v.aReceber),
    meta: v.meta === null ? null : t(v.meta),
    medidaDaMeta: v.medidaDaMeta,
    medido: v.medido === null ? null : t(v.medido),
    metaRestante: v.metaRestante === null ? null : t(v.metaRestante),
    percentualDaMeta: v.percentualDaMeta,
    caixa: {
      fechados: v.caixa.fechados,
      diasUteis: v.caixa.diasUteis,
      comDiferenca: v.caixa.comDiferenca,
      diferenca: t(v.caixa.diferenca),
    },
  }
}
