import { ORIGEM_INDICACAO } from '@fir/contracts'
import { decidirIndicacao, MENSAGEM_AUTOINDICACAO, type PedidoDeIndicacao } from '@fir/domain'
import { BadRequestException } from '@nestjs/common'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * **Os vínculos do cadastro da paciente**: quem a indicou (B2) e por qual
 * campanha ela chegou (A3, no cadastro).
 *
 * Mora fora de `pacientes.service.ts` porque é uma regra com começo, meio e
 * fim — decidir, validar, gravar, ler — e o serviço só a chama.
 */

/**
 * A MESMA resposta para "não existe", "é de outra clínica" e "está
 * desativada" (S-34): três mensagens diferentes seriam um oráculo de
 * existência de paciente da clínica vizinha. Sem nome (L-B2-9).
 */
export const INDICADORA_INVALIDA = 'Escolha na lista a paciente que indicou.'

/** As colunas que o cadastro grava, já decididas. `undefined` = não mexe. */
export type IndicacaoDecidida = {
  readonly indicadoPorId?: string | null
  readonly indicadoPor?: string
}

/**
 * Decide e valida a indicação pedida, dentro da `naClinica` de quem grava.
 *
 * @param proprioId a paciente editada; `null` no cadastro.
 * @param atualId o `indicado_por_id` que a linha já tem. Ele é aceito sem
 *   nova validação: editar o telefone de quem foi indicada por uma paciente
 *   hoje desativada não pode recusar o vínculo que já estava lá.
 * @param origemEfetiva a origem que a linha terá depois da escrita. Fora de
 *   "Indicação" não há indicação nenhuma — nem por id. O contrato já limpa
 *   quando a origem vem no pedido; aqui vale também quando ela não vem.
 */
export async function decidirIndicacaoNoBanco(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  proprioId: string | null,
  atualId: string | null,
  origemEfetiva: string,
  pedido: PedidoDeIndicacao,
): Promise<IndicacaoDecidida> {
  const efetivo: PedidoDeIndicacao =
    origemEfetiva === ORIGEM_INDICACAO
      ? pedido
      : {
          ...(pedido.indicadoPorId === undefined ? {} : { indicadoPorId: null }),
          ...(pedido.indicadoPor === undefined ? {} : { indicadoPor: '' }),
        }
  const r = decidirIndicacao(proprioId, efetivo)
  if (r.tipo === 'erro') throw new BadRequestException(r.erro.mensagem)
  const decidido = r.valor
  const id = decidido.indicadoPorId
  if (typeof id === 'string' && id !== atualId) {
    // `clinica_id` explícito ALÉM da RLS (S-0.4), e só ATIVA (S-34).
    // `FOR SHARE` segura a desativação concorrente da indicadora até esta
    // transação terminar: sem ele, o vínculo podia nascer com uma indicadora
    // que acabou de sair do cadastro.
    const achou = await c.query(
      'SELECT 1 FROM pacientes WHERE clinica_id = $1 AND id = $2 AND ativo FOR SHARE',
      [clinicaId, id],
    )
    if (achou.rowCount === 0) throw new BadRequestException(INDICADORA_INVALIDA)
  }
  return decidido
}

/**
 * As violações das restrições da 0062 viram 400 legível, nunca 500.
 *
 * Só chegam aqui por corrida (a validação acima já recusou o caso normal):
 * a FK composta (`23503`) quando a indicadora some entre o `SELECT` e o
 * `UPDATE`, e o `CHECK` de autoindicação (`23514`) como última camada.
 */
export function traduzirErroDeIndicacao(e: unknown): void {
  if (typeof e !== 'object' || e === null) return
  // `as` para LER, não para confiar: o `pg` lança `DatabaseError` com `code` e
  // `constraint` opcionais, mas o `catch` só entrega `unknown`. Os dois campos
  // ficam opcionais no tipo, e cada um é comparado com um literal abaixo —
  // um erro sem eles (ou de outra origem) não casa com nada e segue adiante.
  const { code, constraint } = e as { code?: string; constraint?: string }
  if (code === '23503' && constraint === 'paciente_indicada_por_paciente_da_clinica') {
    throw new BadRequestException(INDICADORA_INVALIDA)
  }
  if (code === '23514' && constraint === 'paciente_nao_indica_a_si_mesma') {
    throw new BadRequestException(MENSAGEM_AUTOINDICACAO)
  }
}

/**
 * O que a FICHA mostra dos vínculos — por JOIN na mesma `naClinica`, com
 * `clinica_id` explícito nas duas pontas (S-36).
 *
 * Da indicadora, só id e nome, e só se ela estiver ATIVA (L-B2-6).
 */
export async function vinculosNaFicha(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  id: string,
): Promise<{
  indicadora: { id: string; nome: string } | null
  indicadaPorPaciente: boolean
  campanhaId: string | null
}> {
  const r = await c.query<{
    indicadora_id: string | null
    indicadora_nome: string | null
    tem_indicadora: boolean
    campanha_id: string | null
  }>(
    `SELECT i.id::text AS indicadora_id, i.nome AS indicadora_nome,
            (p.indicado_por_id IS NOT NULL) AS tem_indicadora,
            p.campanha_id::text AS campanha_id
       FROM pacientes p
       LEFT JOIN pacientes i
              ON i.clinica_id = p.clinica_id AND i.id = p.indicado_por_id AND i.ativo
      WHERE p.clinica_id = $1 AND p.id = $2`,
    [clinicaId, id],
  )
  const l = r.rows[0]
  return {
    indicadora:
      l?.indicadora_id != null && l.indicadora_nome !== null
        ? { id: l.indicadora_id, nome: l.indicadora_nome }
        : null,
    indicadaPorPaciente: l?.tem_indicadora ?? false,
    campanhaId: l?.campanha_id ?? null,
  }
}
