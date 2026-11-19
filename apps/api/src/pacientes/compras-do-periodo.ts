import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'
import { COMPRA_DO_PACIENTE } from './pacientes.service'

/** O LTV de uma paciente ativa NUMA JANELA, e quantas compras o formam (relatório 3 com período). */
export type CompraNoPeriodo = {
  readonly pacienteId: string
  readonly nome: string
  readonly telefone: string
  readonly ltv: bigint
  readonly compras: number
  /** O dia (fuso da clínica) da compra mais recente DENTRO da janela (relatório 3). */
  readonly ultimaCompra: string
}

/**
 * **AS COMPRAS DA FICHA, RECORTADAS POR `[de, ate)`** — o relatório 3 com
 * período (backlog 1.8, revisão S2).
 *
 * O conjunto é o MESMO `COMPRA_DO_PACIENTE` de `pacientes.service.ts` (recebimento
 * não estornado, `DINHEIRO_QUE_ENTROU`), com o instante em `[de, ate)` em UTC —
 * as bordas já vêm no fuso da clínica (`janela`, regra 23). Sem período, o
 * relatório continua lendo `comprasDosPacientes`; uma paciente com a janela
 * cobrindo todas as compras dela tem aqui o LTV da ficha.
 *
 * A cláusula É `COMPRA_DO_PACIENTE`, importada: uma regra só, e este arquivo só
 * acrescenta o recorte da janela.
 */
export async function comprasDoPeriodo(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  j: { readonly de: Date; readonly ate: Date },
  fuso: string,
): Promise<CompraNoPeriodo[]> {
  const r = await c.query<{ id: string; nome: string; telefone: string; ltv: string; compras: string; ultima_compra: string }>(
    `SELECT p.id, p.nome, p.telefone, sum(r.valor)::bigint::text AS ltv, count(r.id)::text AS compras,
            (max(r.recebido_em) AT TIME ZONE $4)::date::text AS ultima_compra
       FROM pacientes p
       JOIN recebimentos r ON r.clinica_id = p.clinica_id AND ${COMPRA_DO_PACIENTE}
                          AND r.recebido_em >= $2 AND r.recebido_em < $3
      WHERE p.clinica_id = $1 AND p.ativo
      GROUP BY p.id
      ORDER BY p.nome, p.id`,
    [clinicaId, j.de, j.ate, fuso],
  )
  return r.rows.map((l) => ({
    pacienteId: l.id,
    nome: l.nome,
    telefone: l.telefone,
    ltv: BigInt(l.ltv),
    compras: Number(l.compras),
    ultimaCompra: l.ultima_compra,
  }))
}
