import {
  type CampanhaDeVinculo,
  type ContextoDeVinculo,
  conferirVinculo,
  ehErro,
} from '@fir/domain'
import { BadRequestException } from '@nestjs/common'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * As campanhas da clínica na forma que a regra de vínculo lê.
 *
 * **Colunas nomeadas** (S-9, L-A3-2): `id`, `nome`, as duas datas e o soft
 * delete. Meta, métrica e contagens não saem do banco por este caminho — o
 * que não é lido não tem como atravessar.
 *
 * `clinica_id = $1` também na aplicação (S-0.4): a RLS é a primeira camada, e
 * ela falha em silêncio.
 */
export async function lerCampanhasDeVinculo(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  ids?: readonly string[],
): Promise<CampanhaDeVinculo[]> {
  const r = await c.query<CampanhaDeVinculo>(
    `SELECT id::text AS id, nome, inicio::text AS inicio, fim::text AS fim,
            (excluida_em IS NOT NULL) AS excluida
       FROM campanhas
      WHERE clinica_id = $1
        ${ids === undefined ? '' : 'AND id = ANY($2::uuid[])'}`,
    ids === undefined ? [clinicaId] : [clinicaId, [...ids]],
  )
  return r.rows
}

/**
 * **A VALIDAÇÃO DA ESCRITA**, comum a criar tarefa, editar tarefa e registrar
 * recebimento (S-10, S-11). Devolve o id a gravar, ou `null`.
 *
 * A regra é `conferirVinculo` do domínio — a mesma janela da lista. A campanha
 * de outra clínica não volta do `SELECT` (RLS mais o filtro), e cai no mesmo
 * erro do UUID inventado e da excluída: 400, nunca 403 nem 404, que diriam que
 * ela existe em algum lugar. A FK composta da 0020 é a terceira camada, e
 * nunca chega a ser exercida por aqui — FK violada não vira 500.
 *
 * `atual` é a campanha que o registro já tem: reenviá-la passa, mesmo excluída
 * ou antiga (N-4).
 */
export async function campanhaParaVincular(
  c: pg.PoolClient,
  x: {
    readonly clinicaId: ClinicaId
    readonly campanhaId: string | null | undefined
    readonly contexto: ContextoDeVinculo
    readonly agora: Date
    readonly fuso: string
    readonly atual?: string | null
  },
): Promise<string | null> {
  if (x.campanhaId === undefined || x.campanhaId === null) return null
  const [campanha] = await lerCampanhasDeVinculo(c, x.clinicaId, [x.campanhaId])
  const r = conferirVinculo(campanha, x.contexto, x.agora, x.fuso, x.atual)
  if (ehErro(r)) throw new BadRequestException(r.erro.mensagem)
  return x.campanhaId
}
