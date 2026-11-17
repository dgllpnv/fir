import { Dinheiro, fimDoMes, type MedidaDaMeta } from '@fir/domain'
import { ConflictException } from '@nestjs/common'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * **O LUGAR ÚNICO DA META** (spec I-24 a I-26; ADR 2026-11-17-meta-unica).
 *
 * A meta de faturamento do mês da Visão do mês é a meta viva do KPI
 * `faturamento_conferido` com `parametros = '{}'`, sem KR, que cobre o mês
 * inteiro. `metas_do_mes` congelou na 0100; nada aqui a lê nem a escreve.
 *
 * Estas funções rodam na conexão que o chamador abriu (`naClinica`): a RLS é
 * a primeira camada, e todo SQL também filtra por `clinica_id`.
 */

/** O KPI vivo de faturamento da clínica, sem parâmetros (números c.13). */
export async function kpiDeFaturamento(c: pg.PoolClient, clinicaId: ClinicaId): Promise<string | null> {
  const r = await c.query<{ id: string }>(
    `SELECT id FROM kpis
      WHERE clinica_id = $1 AND origem = 'catalogo' AND chave_catalogo = 'faturamento_conferido'
        AND parametros = '{}'::jsonb AND arquivado_em IS NULL`,
    [clinicaId],
  )
  return r.rows[0]?.id ?? null
}

/** Cria (idempotente, pelo índice único dos vivos) e devolve o KPI de faturamento. */
export async function garantirKpiDeFaturamento(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  pessoaId: string | null,
): Promise<string> {
  await c.query(
    `INSERT INTO kpis (clinica_id, origem, chave_catalogo, parametros, nome, frequencia, responsavel_id, criado_por)
     VALUES ($1, 'catalogo', 'faturamento_conferido', '{}'::jsonb, 'Faturamento conferido', 'mensal', $2, $2)
     ON CONFLICT (clinica_id, chave_catalogo, parametros) WHERE origem = 'catalogo' AND arquivado_em IS NULL
     DO NOTHING`,
    [clinicaId, pessoaId],
  )
  const id = await kpiDeFaturamento(c, clinicaId)
  if (id === null) throw new Error('KPI de faturamento ausente depois do INSERT idempotente')
  return id
}

export type MetaDoMes = {
  readonly id: string
  readonly valor: Dinheiro
  readonly medidaPor: MedidaDaMeta
  readonly tipo: 'mes' | 'recorrente'
}

/** A meta do mês civil `mes` (`aaaa-mm`): uma meta `mes` ou `recorrente` que começa no dia 1º. */
export async function metaDoMes(c: pg.PoolClient, clinicaId: ClinicaId, mes: string): Promise<MetaDoMes | null> {
  const r = await c.query<{ id: string; valor: string; medida_por: MedidaDaMeta; tipo: 'mes' | 'recorrente' }>(
    `SELECT m.id, m.alvo_centavos::text AS valor, m.medida_por, m.tipo
       FROM metas_de_kpi m
       JOIN kpis k ON k.id = m.kpi_id AND k.clinica_id = m.clinica_id
      WHERE m.clinica_id = $1 AND k.origem = 'catalogo' AND k.chave_catalogo = 'faturamento_conferido'
        AND k.parametros = '{}'::jsonb AND k.arquivado_em IS NULL
        AND m.resultado_chave_id IS NULL AND m.arquivada_em IS NULL
        AND m.tipo IN ('mes', 'recorrente') AND m.inicio = $2::date AND m.alvo_centavos IS NOT NULL`,
    [clinicaId, `${mes}-01`],
  )
  const l = r.rows[0]
  return l === undefined
    ? null
    : { id: l.id, valor: Dinheiro.deCentavos(BigInt(l.valor)), medidaPor: l.medida_por, tipo: l.tipo }
}

const dataNaTela = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

/**
 * `PUT /v1/metas/:mes` sobre o lugar único. Idempotente: a mesma meta duas
 * vezes escreve a mesma linha. **Zero ARQUIVA** (nunca DELETE: a trilha guarda).
 *
 * Mês coberto por meta `ate_data` (ou por outra meta viva que não seja a do
 * mês) → `409` com o nome e o prazo dela, NUNCA o `500` do `EXCLUDE`
 * (números c.13, `put-meta-mes-sobre-ate-data-409`).
 */
export async function definirMetaDoMes(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  mes: string,
  valor: bigint,
  medidaPor: MedidaDaMeta,
  pessoaId: string,
): Promise<void> {
  const inicio = `${mes}-01`
  const prazo = fimDoMes(mes)
  const atual = await metaDoMes(c, clinicaId, mes)
  if (valor === 0n) {
    if (atual !== null) {
      await c.query('UPDATE metas_de_kpi SET arquivada_em = now() WHERE clinica_id = $1 AND id = $2', [
        clinicaId,
        atual.id,
      ])
    }
    return
  }
  const kpiId = await garantirKpiDeFaturamento(c, clinicaId, pessoaId)
  const outra = await c.query<{ nome: string; prazo: string }>(
    `SELECT k.nome, m.prazo::text AS prazo FROM metas_de_kpi m JOIN kpis k ON k.id = m.kpi_id
      WHERE m.clinica_id = $1 AND m.kpi_id = $2 AND m.resultado_chave_id IS NULL AND m.arquivada_em IS NULL
        AND daterange(m.inicio, m.prazo, '[]') && daterange($3::date, $4::date, '[]')
        AND m.id IS DISTINCT FROM $5::uuid
      LIMIT 1`,
    [clinicaId, kpiId, inicio, prazo, atual?.id ?? null],
  )
  const conflito = outra.rows[0]
  if (conflito !== undefined) {
    throw new ConflictException(
      `Este mês está dentro da meta "${conflito.nome}" até ${dataNaTela(conflito.prazo)}; edite-a em Indicadores.`,
    )
  }
  if (atual !== null) {
    // A régua é COPIADA da configuração quando a meta é definida (N-B6), e a
    // trilha de `metas_de_kpi` registra o de → para.
    await c.query(
      `UPDATE metas_de_kpi SET alvo_centavos = $3, medida_por = $4, definida_por = $5, definida_em = now()
        WHERE clinica_id = $1 AND id = $2
          AND (alvo_centavos, medida_por, definida_por) IS DISTINCT FROM ($3::bigint, $4::text, $5::uuid)`,
      [clinicaId, atual.id, valor.toString(), medidaPor, pessoaId],
    )
    return
  }
  await c.query(
    `INSERT INTO metas_de_kpi (clinica_id, kpi_id, tipo, inicio, prazo, alvo_centavos, partida_centavos,
                               medida_por, definida_por)
     VALUES ($1, $2, 'mes', $3::date, $4::date, $5, 0, $6, $7)`,
    [clinicaId, kpiId, inicio, prazo, valor.toString(), medidaPor, pessoaId],
  )
}
