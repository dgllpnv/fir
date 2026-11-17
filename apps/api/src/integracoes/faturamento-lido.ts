import { Dinheiro, diasEntre, somarMeses } from '@fir/domain'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * **O ÚNICO LEITOR DO FATURAMENTO DO MEDX NO BALCÃO** (spec integracao-medx
 * C.3 e C.8; T7).
 *
 * A Visão do mês, a rota `/meta` e o Painel chamam esta função; nenhum deles
 * escreve o nome da tabela (`teste/arquitetura-do-faturamento-externo.test.ts`).
 * O que sai daqui é o número do MedX, para ser mostrado AO LADO do da FIR,
 * nunca somado a ele.
 *
 * Não devolve a quantidade de pagamentos: ela não atravessa sem `valores`
 * (C.11), e o que não sai do banco não precisa ser redigido.
 */
export type DiaLidoDoMedx = {
  readonly faturamento: Dinheiro
  /** Em dezmilésimos de real: o total sem o arredondamento por pagamento (A9). */
  readonly exatoEmDezmilesimos: bigint
}

export type FaturamentoLido = {
  /** Só os dias lidos. Dia sem linha é dia não lido (N-B3), e não zero. */
  readonly porDia: ReadonlyMap<string, DiaLidoDoMedx>
  /** Todo dia de `[de, min(ate, hoje)]` tem linha. */
  readonly coberturaCompleta: boolean
  /**
   * O selo "lido do MedX às HH:MM": a última leitura que COBRIU o período. A
   * de toda hora cobre do dia 1º do mês anterior em diante; antes disso, só a
   * releitura de 13 meses (ADR 2026-11-16-faturamento-do-medx).
   */
  readonly lidoEm: Date | null
}

/**
 * O faturamento do MedX nos dias civis `[de, ate]` (inclusive os dois), só até
 * `hoje` — o futuro não foi lido e não é "incompleto".
 *
 * `null`: a clínica não tem o faturamento do MedX ligado.
 */
export async function faturamentoLidoDoMedx(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  de: string,
  ate: string,
  hoje: string,
): Promise<FaturamentoLido | null> {
  const i = await c.query<{ ultimo: Date | null; releitura: Date | null }>(
    `SELECT faturamento_ultimo_sucesso_em AS ultimo, faturamento_releitura_em AS releitura
       FROM integracoes_da_clinica
      WHERE clinica_id = $1 AND provedor = 'medx' AND faturamento_ligado`,
    [clinicaId],
  )
  const ligada = i.rows[0]
  if (ligada === undefined) return null

  const fim = ate < hoje ? ate : hoje
  const lidoEm = de >= somarMeses(`${hoje.slice(0, 7)}-01`, -1) ? ligada.ultimo : ligada.releitura
  if (fim < de) return { porDia: new Map(), coberturaCompleta: true, lidoEm }

  const r = await c.query<{ dia: string; faturamento_lido: string; faturamento_exato: string }>(
    `SELECT dia::text AS dia, faturamento_lido::text AS faturamento_lido, faturamento_exato::text AS faturamento_exato
       FROM leituras_de_faturamento_externo
      WHERE clinica_id = $1 AND provedor = 'medx' AND dia BETWEEN $2::date AND $3::date`,
    [clinicaId, de, fim],
  )
  const porDia = new Map(
    r.rows.map((l) => [
      l.dia,
      { faturamento: Dinheiro.deCentavos(BigInt(l.faturamento_lido)), exatoEmDezmilesimos: BigInt(l.faturamento_exato) },
    ]),
  )
  return { porDia, coberturaCompleta: porDia.size === diasEntre(de, fim) + 1, lidoEm }
}

/** A soma do período, só dos dias de `dias` (os que passaram pelo corte de caixa, no Painel). */
export function somaDoMedx(f: FaturamentoLido, dias?: Iterable<string>): { faturamento: Dinheiro; exatoEmDezmilesimos: bigint } {
  let faturamento = Dinheiro.zero()
  let exato = 0n
  const escolhidos = dias === undefined ? f.porDia.values() : [...dias].flatMap((d) => f.porDia.get(d) ?? [])
  for (const x of escolhidos) {
    faturamento = faturamento.mais(x.faturamento)
    exato += x.exatoEmDezmilesimos
  }
  return { faturamento, exatoEmDezmilesimos: exato }
}
