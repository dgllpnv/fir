import { erro, ok, type Result } from './resultado'

/**
 * **"Indicado por"** — a ligação da paciente a quem a indicou (correções da PO, B2).
 *
 * São duas formas, e elas não convivem na mesma linha:
 *
 *  - `indicadoPorId` — a indicadora **é paciente** da clínica. O nome dela sai
 *    do cadastro dela, nunca de uma cópia em texto.
 *  - `indicadoPor` — texto livre, para quem indicou **sem ser paciente** e
 *    para o dado migrado da v20.
 *
 * Com o id, o texto vai vazio (LGPD L-B2-3, e o `CHECK` da 0062): uma cópia do
 * nome na linha da indicada sobreviveria à anonimização da indicadora, e a
 * eliminação ficaria incompleta sem que ninguém percebesse. Com texto
 * preenchido, o id sai: quem digitou um nome disse que a pessoa não está no
 * cadastro.
 *
 * Os três estados da edição valem para o id: **ausente** mantém, **`null`**
 * remove, **uuid** liga. Sem o "ausente", editar só o telefone apagaria a
 * indicação.
 *
 * A regra da origem (`indicadoPor` só existe quando a origem é Indicação)
 * mora no contrato, que conhece a lista de origens; esta função não precisa
 * dela.
 */
export type PedidoDeIndicacao = {
  readonly indicadoPorId?: string | null
  readonly indicadoPor?: string
}

export const MENSAGEM_AUTOINDICACAO = 'Uma paciente não pode indicar a si mesma.'

/**
 * @param proprioId o id da paciente que está sendo editada; `null` no cadastro.
 */
export function decidirIndicacao(
  proprioId: string | null,
  pedido: PedidoDeIndicacao,
): Result<PedidoDeIndicacao> {
  const { indicadoPorId, indicadoPor } = pedido
  if (typeof indicadoPorId === 'string') {
    // Sem nome na mensagem (L-B2-9): o erro volta para a tela e para o log
    // do cliente.
    if (proprioId !== null && indicadoPorId === proprioId) {
      return erro({ codigo: 'AUTOINDICACAO', mensagem: MENSAGEM_AUTOINDICACAO })
    }
    return ok({ indicadoPorId, indicadoPor: '' })
  }
  if (indicadoPor !== undefined && indicadoPor !== '') {
    return ok({ indicadoPorId: null, indicadoPor })
  }
  return ok({
    ...(indicadoPorId === null ? { indicadoPorId: null } : {}),
    ...(indicadoPor === undefined ? {} : { indicadoPor }),
  })
}
