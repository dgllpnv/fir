import { randomUUID } from 'node:crypto'
import {
  diaCivil,
  diasEntre,
  Dinheiro,
  ehErro,
  horaCivil,
  inicioDoDia,
  type PagamentoExterno,
  type Relogio,
  somarDias,
  somarMeses,
  type TotalDoDia,
  totaisPorDia,
} from '@fir/domain'
import { z } from 'zod'
import type { BancoService } from '../../banco/banco.service'
import type { ClinicaId } from '../../banco/clinica-id'
import type { AberturaDeIntegracoes } from '../cofre-de-integracoes'
import { diaDoPagamento, relogioDoMedx } from './borda-do-medx'
import { ErroDoMedx, MENSAGENS_DO_MEDX } from './erros'
import { type LeitorDoMedx, Pagina, type Sessao } from './leitor-do-medx'

/**
 * A LEITURA DO FATURAMENTO DO MEDX (spec `integracao-medx.md` C.1–C.7; ticket T5;
 * parecer de números; ADR `2026-11-16-faturamento-do-medx`).
 *
 * **Fonte (G2): `GET /financas/lancamentos?tipo=receber&status=pago`, pela data
 * do pagamento.** O valor é `valorOriginal`: a documentação do MedX diz que,
 * no lançamento, "`valorOriginal` é o crédito e `valorPago` é o débito ou a
 * taxa, não o valor liquidado". Somar `valorPago`, como a spec escreveu antes
 * de ler essa linha, somaria as taxas do cartão. A calibração C.0 confirma com
 * dado real antes de ligar em qualquer clínica (ADR).
 *
 * Só conta lançamento **de fatura** (`faturaId` presente): lançamento manual e
 * sinal de orçamento ficam fora (orçamento nunca é receita, regra 4; A3). A
 * quantidade dos que ficaram fora vai para o log, sem valor.
 *
 * O ciclo, numa clínica:
 *  1. Toda hora lê do dia 1º do mês anterior até hoje; uma vez por dia (e
 *     quando o fuso muda), os últimos 13 meses (A1, N2). Em janelas de até 85
 *     dias, cada uma alargada 1 dia de cada lado (N-B3).
 *  2. Lê TUDO antes de gravar qualquer coisa. Uma página ruim aborta o ciclo.
 *  3. Grava uma linha por dia, inclusive zero, numa transação; o dia que não
 *     mudou não é regravado. Uma leitura que começou antes da última gravada
 *     não grava nada (A5). Histórico só quando muda (A6).
 *  4. Trava de leitura vazia: sem nenhum pagamento onde antes havia, aborta e
 *     não zera nada.
 */
const PROVEDOR = 'medx'
/** 85 dias + 1 de cada lado + o dia inteiro do fim: dentro dos 90 da API. */
const DIAS_POR_JANELA = 85
const MESES_DA_RELEITURA = 12
/** A releitura completa roda na primeira hora cheia depois das 02:00 da clínica. */
const HORA_DA_RELEITURA = '02:00'

/** Mensagens do catálogo (S-8): o texto do MedX nunca vira `ultimo_erro`. */
export const MENSAGENS_DO_FATURAMENTO = {
  vazia: 'O MedX respondeu sem nenhum pagamento num período em que antes havia. Nada foi alterado.',
  sem_escopo: 'O usuário do MedX não tem a permissão de lançamentos. O faturamento não foi lido.',
} as const

// Lista branca (B.0): do lançamento, só id, data do pagamento, valor e se é de fatura.
const Lancamento = z.object({
  id: z.number().int(),
  pagamento: z.string().max(40).nullable().optional(),
  valorOriginal: z.string().max(40),
  faturaId: z.number().int().nullable().optional(),
})
const PaginaDeLancamentos = z.object({ items: z.array(Lancamento), page: Pagina })

export type ResultadoDoFaturamento =
  | { tipo: 'desligado' }
  | { tipo: 'ok'; dias: number; pagamentos: number; completa: boolean }
  /** Uma leitura que começou depois desta já tinha gravado (A5): nada foi escrito. */
  | { tipo: 'superada' }
  | { tipo: 'falhou'; erro: string }

type Guardado = {
  segredo_cifrado: Buffer | null
  segredo_versao: number | null
  impressao_da_chave: string | null
  faturamento_releitura_em: Date | null
  faturamento_fuso_lido: string | null
}

class FalhaDoFaturamento extends Error {}

export class FaturamentoDoMedx {
  constructor(
    private readonly banco: BancoService,
    private readonly abertura: AberturaDeIntegracoes,
    private readonly leitor: LeitorDoMedx,
    private readonly relogio: Relogio,
  ) {}

  async lerClinica(clinicaId: ClinicaId, fuso: string): Promise<ResultadoDoFaturamento> {
    const guardado = await this.banco.comoIntegracoes(clinicaId, async (c) => {
      const r = await c.query<Guardado>(
        `SELECT segredo_cifrado, segredo_versao, impressao_da_chave, faturamento_releitura_em, faturamento_fuso_lido
           FROM integracoes_da_clinica WHERE faturamento_ligado AND verificacao = 'ok'`,
      )
      return r.rows[0]
    })
    if (!guardado?.segredo_cifrado || guardado.segredo_versao === null || guardado.impressao_da_chave === null) {
      return { tipo: 'desligado' }
    }

    // `lido_em` é o INÍCIO da leitura (A5): quem começou antes não grava por cima.
    const lidoEm = this.relogio.agora()
    const hoje = diaCivil(lidoEm, fuso)
    const completa =
      guardado.faturamento_releitura_em === null ||
      guardado.faturamento_fuso_lido !== fuso ||
      (diaCivil(guardado.faturamento_releitura_em, fuso) < hoje && horaCivil(lidoEm, fuso) >= HORA_DA_RELEITURA)
    const inicioDoMes = `${hoje.slice(0, 7)}-01`
    const de = somarMeses(inicioDoMes, completa ? -MESES_DA_RELEITURA : -1)

    try {
      // O AAD leva a clínica do CONTEXTO, nunca a da linha (S-3).
      const chave = this.abertura.abrir(clinicaId, PROVEDOR, guardado.segredo_cifrado, guardado.segredo_versao)
      if (chave === null) {
        console.warn(`[integracoes] ALERTA clínica ${clinicaId}: a chave guardada não abriu`)
        throw new FalhaDoFaturamento(MENSAGENS_DO_MEDX.chave_invalida)
      }
      const s = await this.leitor.sessao(clinicaId, guardado.impressao_da_chave, chave)
      if (!s.escopos.includes('lancamentos:read')) throw new FalhaDoFaturamento(MENSAGENS_DO_FATURAMENTO.sem_escopo)

      const { pagamentos, foraDeFatura } = await this.lerPagamentos(s, de, hoje, fuso)
      const totais = totaisPorDia(pagamentos, diasDe(de, hoje))
      if ((await this.gravar(clinicaId, totais, pagamentos.length, lidoEm, hoje, completa, fuso)) === 'superada') {
        console.log(`[faturamento] clínica ${clinicaId}: uma leitura mais nova já gravou; esta foi descartada`)
        return { tipo: 'superada' }
      }
      console.log(
        `[faturamento] clínica ${clinicaId}: ${totais.length} dia(s), ${pagamentos.length} pagamento(s)` +
          `, ${foraDeFatura} fora de fatura${completa ? ', releitura completa' : ''}`,
      )
      return { tipo: 'ok', dias: totais.length, pagamentos: pagamentos.length, completa }
    } catch (e) {
      const erro =
        e instanceof FalhaDoFaturamento
          ? e.message
          : MENSAGENS_DO_MEDX[e instanceof ErroDoMedx ? e.codigo : 'contrato']
      if (e instanceof ErroDoMedx && e.codigo === 'recusada') {
        this.leitor.esquecer(clinicaId)
        console.warn(`[integracoes] ALERTA clínica ${clinicaId}: o MedX recusou a chave na leitura do faturamento`)
      }
      if (!(e instanceof ErroDoMedx) && !(e instanceof FalhaDoFaturamento)) {
        console.error('[faturamento] leitura:', e instanceof Error ? e.name : 'erro')
      }
      await this.banco.comoIntegracoes(clinicaId, (c) =>
        c.query(
          `UPDATE integracoes_da_clinica
              SET faturamento_ultima_leitura_em = $1, faturamento_ultimo_erro = $2, atualizada_em = now()`,
          [lidoEm, erro.slice(0, 300)],
        ),
      )
      return { tipo: 'falhou', erro }
    }
  }

  /** Todas as janelas, todas as páginas. Qualquer coisa fora do contrato lança, e nada é gravado. */
  private async lerPagamentos(
    s: Sessao,
    de: string,
    ate: string,
    fuso: string,
  ): Promise<{ pagamentos: PagamentoExterno[]; foraDeFatura: number }> {
    const porId = new Map<number, PagamentoExterno>()
    let foraDeFatura = 0
    for (const j of janelas(de, ate)) {
      const query = {
        Tipo: 'receber',
        Status: 'pago',
        // Alargada 1 dia de cada lado: só se gravam dias inteiros (N-B3). O
        // fim é inclusivo na API; o último instante do dia seguinte ao fim.
        PagamentoInicio: relogioDoMedx(inicioDoDia(somarDias(j.de, -1), fuso)),
        PagamentoFim: relogioDoMedx(new Date(inicioDoDia(somarDias(j.ate, 2), fuso).getTime() - 1000)),
        Limit: '100',
      }
      await this.leitor.paginar(
        s,
        '/financas/lancamentos',
        query,
        PaginaDeLancamentos,
        (p) => {
          for (const l of p.items) {
            if (l.pagamento === null || l.pagamento === undefined) continue
            const valor = Dinheiro.deDecimalExterno(l.valorOriginal)
            if (ehErro(valor)) throw new ErroDoMedx('contrato')
            if (valor.valor.exatoEmDezmilesimos === 0n) continue
            if (l.faturaId === null || l.faturaId === undefined) {
              foraDeFatura++
              continue
            }
            const dia = diaDoPagamento(l.pagamento, fuso)
            if (dia === null) throw new ErroDoMedx('contrato')
            // As janelas se sobrepõem na borda: o mesmo lançamento vem duas vezes.
            porId.set(l.id, { dia, centavos: valor.valor.centavos, exatoEmDezmilesimos: valor.valor.exatoEmDezmilesimos })
          }
        },
        { decimais: ['valorOriginal'] },
      )
    }
    return { pagamentos: [...porId.values()], foraDeFatura }
  }

  private async gravar(
    clinicaId: ClinicaId,
    totais: readonly TotalDoDia[],
    pagamentosLidos: number,
    lidoEm: Date,
    hoje: string,
    completa: boolean,
    fuso: string,
  ): Promise<'gravada' | 'superada'> {
    const leituraId = randomUUID()
    const de = totais[0]?.dia
    const ate = totais.at(-1)?.dia
    if (de === undefined || ate === undefined) return 'gravada'
    const desfecho = await this.banco.comoIntegracoes(clinicaId, async (c) => {
      // Um ciclo por clínica de cada vez (A5).
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('faturamento-externo'), hashtext($1))`, [clinicaId])

      // Uma leitura que começou DEPOIS desta já gravou: ela vale, e esta,
      // com o dado mais velho, não grava nada (A5). Por clínica, e não por
      // dia: o dia que não mudou não é regravado, então o `lido_em` da linha
      // não diz quem leu por último.
      const u = await c.query<{ faturamento_ultimo_sucesso_em: Date | null }>(
        'SELECT faturamento_ultimo_sucesso_em FROM integracoes_da_clinica WHERE provedor = $1',
        [PROVEDOR],
      )
      const ultimo = u.rows[0]?.faturamento_ultimo_sucesso_em ?? null
      if (ultimo !== null && ultimo >= lidoEm) return 'superada' as const

      const r = await c.query<{ dia: string; faturamento_lido: string; faturamento_exato: string; quantidade_de_pagamentos: number }>(
        `SELECT dia::text AS dia, faturamento_lido::text AS faturamento_lido, faturamento_exato::text AS faturamento_exato,
                quantidade_de_pagamentos
           FROM leituras_de_faturamento_externo
          WHERE provedor = $1 AND dia BETWEEN $2::date AND $3::date
          FOR UPDATE`,
        [PROVEDOR, de, ate],
      )
      const antes = new Map(r.rows.map((l) => [l.dia, l]))

      // Trava de leitura vazia (N-B3.4): nenhum pagamento onde antes havia.
      if (pagamentosLidos === 0 && r.rows.some((l) => l.quantidade_de_pagamentos > 0)) return 'vazia' as const

      const mesCorrente = hoje.slice(0, 7)
      for (const t of totais) {
        const a = antes.get(t.dia)
        if (a === undefined) {
          await c.query(
            `INSERT INTO leituras_de_faturamento_externo
               (clinica_id, provedor, dia, faturamento_lido, faturamento_exato, quantidade_de_pagamentos, lido_em, leitura_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [clinicaId, PROVEDOR, t.dia, t.centavos.toString(), t.exatoEmDezmilesimos.toString(), t.quantidade, lidoEm, leituraId],
          )
          continue
        }
        const mudou =
          BigInt(a.faturamento_lido) !== t.centavos ||
          BigInt(a.faturamento_exato) !== t.exatoEmDezmilesimos ||
          a.quantidade_de_pagamentos !== t.quantidade
        // O mesmo total: nada a escrever, nem na trilha (A6).
        if (!mudou) continue
        await c.query(
          `UPDATE leituras_de_faturamento_externo
              SET faturamento_lido = $3, faturamento_exato = $4, quantidade_de_pagamentos = $5, lido_em = $6, leitura_id = $7
            WHERE provedor = $1 AND dia = $2::date`,
          [PROVEDOR, t.dia, t.centavos.toString(), t.exatoEmDezmilesimos.toString(), t.quantidade, lidoEm, leituraId],
        )
        // O histórico é do número que a gestora vê: centavos e quantidade. Um
        // resíduo de dezmilésimo que muda sem mudar o centavo não é notícia.
        if (BigInt(a.faturamento_lido) !== t.centavos || a.quantidade_de_pagamentos !== t.quantidade) {
          await c.query(
            `INSERT INTO historico_de_faturamento_externo
               (clinica_id, provedor, dia, faturamento_anterior, faturamento_lido, quantidade_de_pagamentos_anterior, quantidade_de_pagamentos,
                lido_em, leitura_id, mes_fechado)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              clinicaId,
              PROVEDOR,
              t.dia,
              a.faturamento_lido,
              t.centavos.toString(),
              a.quantidade_de_pagamentos,
              t.quantidade,
              lidoEm,
              leituraId,
              t.dia.slice(0, 7) < mesCorrente,
            ],
          )
        }
      }
      await c.query(
        `UPDATE integracoes_da_clinica
            SET faturamento_ultima_leitura_em = $1, faturamento_ultimo_sucesso_em = $1, faturamento_ultimo_erro = '',
                faturamento_releitura_em = CASE WHEN $2 THEN $1 ELSE faturamento_releitura_em END,
                faturamento_fuso_lido = CASE WHEN $2 THEN $3 ELSE faturamento_fuso_lido END,
                atualizada_em = now()`,
        [lidoEm, completa, fuso],
      )
      return 'gravada' as const
    })
    if (desfecho === 'vazia') {
      console.warn(`[integracoes] ALERTA clínica ${clinicaId}: leitura de faturamento vazia onde antes havia pagamentos`)
      throw new FalhaDoFaturamento(MENSAGENS_DO_FATURAMENTO.vazia)
    }
    return desfecho
  }
}

/** Os dias `[de, ate]`, inclusive os dois. */
function diasDe(de: string, ate: string): string[] {
  const n = diasEntre(de, ate)
  return Array.from({ length: n + 1 }, (_, i) => somarDias(de, i))
}

/** `[de, ate]` em pedaços de até `DIAS_POR_JANELA` dias, contíguos. */
function janelas(de: string, ate: string): { de: string; ate: string }[] {
  const r: { de: string; ate: string }[] = []
  for (let d = de; d <= ate; d = somarDias(d, DIAS_POR_JANELA)) {
    const fim = somarDias(d, DIAS_POR_JANELA - 1)
    r.push({ de: d, ate: fim < ate ? fim : ate })
  }
  return r
}
