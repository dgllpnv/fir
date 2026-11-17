import {
  type CaixaDoPeriodo,
  type CorteDosDias,
  corteDosDiasQueContam,
  Dinheiro,
  diaConta,
  diasEntre,
  janela,
  type MedidaDaMeta,
  regimeDoDia,
  somarDias,
} from '@fir/domain'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'
import { type FaturamentoLido, faturamentoLidoDoMedx, somaDoMedx } from '../integracoes/faturamento-lido'
import { porDia, recebidosDaJanela } from './recebido-por-dia'

/**
 * **O RECORTE DE CAIXA DE UM PERÍODO — uma função para o Painel, a Visão do
 * mês e o KPI** (números B5, `dias-sem-caixa-uma-funcao`).
 *
 * "Sem caixa" é o dia, até hoje, sem `caixas_do_dia` e com recebimento na FIR
 * **ou** faturamento lido do MedX. O Painel (Conferência MedX × FIR), a meta da
 * Visão do mês e o `faturamento_conferido` leem daqui; um segundo "sem caixa"
 * seria a régua que um dia discorda desta.
 */
export type RecorteDeCaixaDoPeriodo = {
  /** Os dias civis de `[de, min(ate, hoje)]`. */
  readonly dias: readonly string[]
  readonly fechados: ReadonlySet<string>
  /** O recebido da FIR por dia (`recebidosDaJanela`, um item por recebimento). */
  readonly fir: ReadonlyMap<string, Dinheiro>
  /** `null`: a clínica não tem o faturamento do MedX ligado. */
  readonly lido: FaturamentoLido | null
  readonly semCaixa: readonly string[]
}

export async function recorteDeCaixa(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  de: string,
  ate: string,
  fuso: string,
  hoje: string,
): Promise<RecorteDeCaixaDoPeriodo> {
  const fim = ate < hoje ? ate : hoje
  const dias = fim < de ? [] : Array.from({ length: diasEntre(de, fim) + 1 }, (_, i) => somarDias(de, i))
  const fir = porDia(await recebidosDaJanela(c, clinicaId, janela(de, ate, fuso), fuso))
  const lido = await faturamentoLidoDoMedx(c, clinicaId, de, ate, hoje)
  const r = await c.query<{ dia: string }>(
    `SELECT dia::text AS dia FROM caixas_do_dia
      WHERE clinica_id = $1 AND dia BETWEEN $2::date AND $3::date`,
    [clinicaId, de, ate],
  )
  const fechados = new Set(r.rows.map((x) => x.dia))
  const temValor = (d: string) =>
    !(fir.get(d)?.ehZero() ?? true) || !(lido?.porDia.get(d)?.faturamento.ehZero() ?? true)
  const semCaixa = dias.filter((d) => !fechados.has(d) && temValor(d))
  return { dias, fechados, fir, lido, semCaixa }
}

/** Os dias aguardando fechamento: a lista do recorte. */
export async function diasSemCaixa(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  de: string,
  ate: string,
  fuso: string,
  hoje: string,
): Promise<readonly string[]> {
  return (await recorteDeCaixa(c, clinicaId, de, ate, fuso, hoje)).semCaixa
}

/** O início da conferência da clínica (G1). `null` = nenhum caixa fechado ainda. */
export async function conferenciaDesde(c: pg.PoolClient, clinicaId: ClinicaId): Promise<string | null> {
  const r = await c.query<{ d: string | null }>(
    'SELECT conferencia_desde::text AS d FROM clinicas WHERE id = $1',
    [clinicaId],
  )
  return r.rows[0]?.d ?? null
}

export type FaturamentoConferido = {
  readonly medidaPor: MedidaDaMeta
  /** O que a meta mede: FIR ou MedX, só dos dias que contam. `null` = MedX sem leitura num dia de `D`. */
  readonly medido: Dinheiro | null
  /** O recebido da FIR dos dias que contam (o valor do KPI pela régua `fir`). */
  readonly recebidoQueConta: Dinheiro
  /**
   * O recebido da FIR dos dias ANTERIORES a hoje que não contam. Um total,
   * nunca por dia (c.10). **Hoje fica fora:** o total do dia com o caixa
   * aberto é o esperado da gaveta (regra 6, `transporte-as-cegas`).
   */
  readonly aguardando: Dinheiro
  readonly diasAguardando: number
  /**
   * Os dias aguardando SEM depender de haver pagamento hoje: os anteriores a
   * hoje como em `diasAguardando`, e hoje sempre que estiver no período com o
   * caixa aberto. É o contador de `/v1/indicadores*`: com o de cima, o
   * primeiro Pix do dia mudaria 0 → 1 e diria que houve pagamento (C11).
   */
  readonly diasAguardandoSemHoje: number
  /**
   * As duas partes de `diasAguardandoSemHoje`, para a tela que põe valor ao
   * lado da contagem (Visão do mês): os dias ANTERIORES a hoje que não contam
   * — os mesmos de `aguardando` — e hoje com o caixa aberto, que nunca tem
   * valor (regra 6). Juntas, escreviam "R$ 0,00 … em 1 dia".
   */
  readonly diasAnterioresAguardando: number
  readonly hojeAguardando: boolean
  /** `D`/`L` para ritmo e projeção (números B1). */
  readonly corte: CorteDosDias
  readonly lidoEm: Date | null
}

/**
 * **O FATURAMENTO CONFERIDO (I-9)**, que é também o MEDIDO da meta da Visão do
 * mês (ADR 2026-11-17-meta-medida-pelos-dias-de-caixa).
 *
 * Para cada dia `d` de `[de, min(ate, hoje)]`, `regimeDoDia` decide: antes de
 * `conferencia_desde` (ou sem ela) conta TODO o recebido — a medida que a
 * Visão do mês sempre teve, e nada que existe muda (G1); a partir dela, só
 * dia com caixa fechado conta. **Hoje sem caixa nunca conta**, nos dois
 * regimes (regra 6).
 *
 * Régua MedX (B5): `somaDoMedx(lido, D)`, e `null` se algum dia de `D` não foi
 * lido — "0% da meta" diria que a clínica não faturou, quando falta a leitura.
 */
export async function medirFaturamentoConferido(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  de: string,
  ate: string,
  fuso: string,
  hoje: string,
  medidaPor: MedidaDaMeta,
): Promise<FaturamentoConferido> {
  const [recorte, desde] = await Promise.all([
    recorteDeCaixa(c, clinicaId, de, ate, fuso, hoje),
    conferenciaDesde(c, clinicaId),
  ])
  const marcados = recorte.dias.map((dia) => ({
    dia,
    conta: diaConta(regimeDoDia(dia, desde, hoje), recorte.fechados.has(dia)),
  }))
  const contam = new Set(marcados.filter((d) => d.conta).map((d) => d.dia))
  let recebidoQueConta = Dinheiro.zero()
  let aguardando = Dinheiro.zero()
  for (const [dia, valor] of recorte.fir) {
    if (contam.has(dia)) recebidoQueConta = recebidoQueConta.mais(valor)
    else if (dia !== hoje) aguardando = aguardando.mais(valor)
  }
  const diasAguardando = recorte.semCaixa.filter((d) => !contam.has(d)).length
  const hojeAberto = recorte.dias.includes(hoje) && !recorte.fechados.has(hoje)
  const diasAnterioresAguardando = recorte.semCaixa.filter((d) => d !== hoje && !contam.has(d)).length
  const diasAguardandoSemHoje = diasAnterioresAguardando + (hojeAberto ? 1 : 0)

  let medido: Dinheiro | null = recebidoQueConta
  if (medidaPor === 'medx') {
    const lido = recorte.lido
    medido =
      lido === null || [...contam].some((d) => !lido.porDia.has(d)) ? null : somaDoMedx(lido, contam).faturamento
  }
  return {
    medidaPor,
    medido,
    recebidoQueConta,
    aguardando,
    diasAguardando,
    diasAguardandoSemHoje,
    diasAnterioresAguardando,
    hojeAguardando: hojeAberto,
    corte: corteDosDiasQueContam(marcados),
    lidoEm: recorte.lido?.lidoEm ?? null,
  }
}

export type DiasQueContam = {
  /** `D`/`L`: os dias de `[de, min(ate, hoje)]` que contam. */
  readonly corte: CorteDosDias
  /** O contador de `/v1/indicadores*`, com a mesma regra de `diasAguardandoSemHoje`. */
  readonly diasAguardando: number
  /**
   * As duas partes de `diasAguardando`, para quem põe valor ao lado da
   * contagem (relatório 8): os dias ANTERIORES a hoje que não contam — os
   * mesmos cujo dinheiro é o "aguardando" — e hoje com o caixa aberto, que
   * nunca tem valor (regra 6). Somar a contagem de hoje a um valor sem hoje
   * escreveu "Mais R$ 0,00 em 1 dia".
   */
  readonly diasAnterioresAguardando: number
  /** Hoje está no período com o caixa aberto — haja pagamento hoje ou não (C11). */
  readonly hojeAguardando: boolean
}

/**
 * **OS DIAS QUE CONTAM NAS CHAVES EM REAIS QUE ESPELHAM UMA TELA** (ADR
 * 2026-11-17-chaves-em-reais-e-os-dias-de-caixa). Uma regra por dia, e por
 * isso aditiva — a série, o cartão e a meta dão o mesmo número:
 *
 * - **Dia de mês PASSADO conta sempre:** é o número que a tela daquele mês
 *   mostra (fonte única, c.1).
 * - **Dia do mês CORRENTE segue a I-9** (`regimeDoDia` + caixa): a partir de
 *   `conferencia_desde`, o dia sem caixa ainda pode ser fechado às cegas e
 *   fica aguardando (c.10); hoje sem caixa nunca conta (regra 6).
 *
 * O `faturamento_conferido` e a meta dele NÃO passam por aqui: eles são a I-9
 * em todo período (`medirFaturamentoConferido`).
 */
export async function diasQueContamNasTelas(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  de: string,
  ate: string,
  fuso: string,
  hoje: string,
): Promise<DiasQueContam> {
  const [recorte, desde] = await Promise.all([
    recorteDeCaixa(c, clinicaId, de, ate, fuso, hoje),
    conferenciaDesde(c, clinicaId),
  ])
  const inicioDoMesCorrente = `${hoje.slice(0, 7)}-01`
  const marcados = recorte.dias.map((dia) => ({
    dia,
    conta: dia < inicioDoMesCorrente || diaConta(regimeDoDia(dia, desde, hoje), recorte.fechados.has(dia)),
  }))
  const contam = new Set(marcados.filter((d) => d.conta).map((d) => d.dia))
  const hojeAberto = recorte.dias.includes(hoje) && !recorte.fechados.has(hoje)
  const anteriores = recorte.semCaixa.filter((d) => d !== hoje && !contam.has(d)).length
  return {
    corte: corteDosDiasQueContam(marcados),
    diasAguardando: anteriores + (hojeAberto ? 1 : 0),
    diasAnterioresAguardando: anteriores,
    hojeAguardando: hojeAberto,
  }
}

/** Os trechos contínuos de um conjunto de dias: a fonte de janela mede cada um. */
export function trechosContinuos(dias: readonly string[]): { de: string; ate: string }[] {
  const r: { de: string; ate: string }[] = []
  for (const d of [...dias].sort()) {
    const ultimo = r.at(-1)
    if (ultimo !== undefined && somarDias(ultimo.ate, 1) === d) ultimo.ate = d
    else r.push({ de: d, ate: d })
  }
  return r
}

/**
 * **OS CAIXAS DO PERÍODO, linha a linha** — a consulta única de "caixas sem
 * diferença" (I-15), que a Visão do mês e o KPI leem. A regra (o conjunto de
 * dias e "toda forma igual") é `caixasSemDiferenca`, no domínio.
 */
export async function caixasDoPeriodo(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  de: string,
  ate: string,
): Promise<(CaixaDoPeriodo & { readonly diferenca: Dinheiro })[]> {
  const r = await c.query<{ dia: string; contado: string | null; esperado: string | null }>(
    `SELECT cx.dia::text AS dia, f.contado::text AS contado, f.esperado::text AS esperado
       FROM caixas_do_dia cx LEFT JOIN caixa_por_forma f ON f.caixa_id = cx.id AND f.clinica_id = cx.clinica_id
      WHERE cx.clinica_id = $1 AND cx.dia BETWEEN $2::date AND $3::date
      ORDER BY cx.dia`,
    [clinicaId, de, ate],
  )
  const porDia = new Map<string, { contado: Dinheiro; esperado: Dinheiro }[]>()
  for (const l of r.rows) {
    const linhas = porDia.get(l.dia) ?? []
    if (l.contado !== null && l.esperado !== null) {
      linhas.push({ contado: Dinheiro.deCentavos(BigInt(l.contado)), esperado: Dinheiro.deCentavos(BigInt(l.esperado)) })
    }
    porDia.set(l.dia, linhas)
  }
  return [...porDia].map(([dia, linhas]) => ({
    dia,
    linhas,
    diferenca: linhas.reduce((s, x) => s.mais(x.contado.menos(x.esperado)), Dinheiro.zero()),
  }))
}
