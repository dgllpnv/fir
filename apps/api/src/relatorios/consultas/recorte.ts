import { ORIGEM_FORA_DA_LISTA, ORIGEM_NAO_INFORMADA, ORIGENS, type OrigemDoFiltro, ROTULO_DA_ORIGEM_DO_FILTRO } from '@fir/contracts'
import type pg from 'pg'
import { type ContextoDaConsulta, nomeOu422 } from '../consultas'

/**
 * **O RECORTE POR ATRIBUTO DA PACIENTE** (filtros da 1.8, S2): unidade
 * principal e origem. Os relatórios 1, 2, 3 e 6 continuam lendo a função da
 * tela de origem; este recorte só ESTREITA o conjunto que ela devolveu — o
 * número de cada paciente que fica é o mesmo de antes.
 *
 * Todo id é conferido contra a clínica antes (422), e a consulta filtra por
 * `clinica_id` além da RLS (regra 19).
 */
export type RecorteDePaciente = { readonly unidadeId?: string | undefined; readonly origem?: OrigemDoFiltro | undefined }

export const rotuloDaOrigem = (o: OrigemDoFiltro): string => ROTULO_DA_ORIGEM_DO_FILTRO[o] ?? o

export async function nomeDaUnidade(c: pg.PoolClient, ctx: ContextoDaConsulta, unidadeId: string): Promise<string> {
  return nomeOu422(c, 'SELECT nome FROM unidades WHERE id = $1 AND clinica_id = $2', [unidadeId, ctx.clinicaId], 'Unidade')
}

/**
 * Os ids das pacientes do recorte, ou `null` sem recorte (todas). Empurra o
 * texto do filtro em `filtrosEmTexto` — o nome da unidade e o rótulo da origem,
 * nunca dinheiro (appsec C8).
 *
 * A origem casa sem caixa nem acento (`normalizar_nome`, a da 0006): "instagram"
 * gravado pela importação é "Instagram". `nao-informada` é a origem vazia, e
 * `fora-da-lista` é o que não casa com nenhuma das `ORIGENS`.
 */
export async function pacientesDoRecorte(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  r: RecorteDePaciente,
  filtrosEmTexto: string[],
): Promise<ReadonlySet<string> | null> {
  if (r.unidadeId === undefined && r.origem === undefined) return null
  if (r.unidadeId !== undefined) filtrosEmTexto.push(`Unidade: ${await nomeDaUnidade(c, ctx, r.unidadeId)}`)
  if (r.origem !== undefined) filtrosEmTexto.push(`Origem: ${rotuloDaOrigem(r.origem)}`)
  const ids = await c.query<{ id: string }>(
    `SELECT p.id::text AS id FROM pacientes p
      WHERE p.clinica_id = $1
        AND ($2::uuid IS NULL OR p.unidade_id = $2::uuid)
        AND ($3::text IS NULL
             OR ($3::text = $4::text AND btrim(p.origem) = '')
             OR ($3::text = $5::text AND btrim(p.origem) <> ''
                 AND normalizar_nome(p.origem) <> ALL (SELECT normalizar_nome(o) FROM unnest($6::text[]) AS o))
             OR ($3::text <> $4::text AND $3::text <> $5::text AND normalizar_nome(p.origem) = normalizar_nome($3::text)))`,
    [ctx.clinicaId, r.unidadeId ?? null, r.origem ?? null, ORIGEM_NAO_INFORMADA, ORIGEM_FORA_DA_LISTA, [...ORIGENS]],
  )
  return new Set(ids.rows.map((l) => l.id))
}
