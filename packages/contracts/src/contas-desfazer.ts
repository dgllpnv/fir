import { z } from 'zod'

/**
 * `POST /v1/contas/:id/desfazer-pagamento` (D-21, item 4). Exige `contas.gerir`.
 *
 * A conta volta para EM ABERTO e o pagamento desfeito vai, inteiro e com o
 * motivo, para a tabela append-only `pagamentos_de_conta_desfeitos`. A resposta
 * é a `ContaNaLista` já aberta.
 *
 * Pagamento de MÊS ANTERIOR (pela data `pagoEm`, no fuso da clínica, contra o
 * relógio do servidor) responde 409 `ConfirmacaoNecessaria` com
 * `avisos: ['MES_ANTERIOR']` — o mesmo padrão dos avisos de recebimento — e a
 * tela reenvia o MESMO corpo com `confirmarMesAnterior: true`.
 */
export const DesfazerPagamentoDeConta = z
  .object({
    motivo: z
      .string()
      .trim()
      .min(3, 'Escreva o motivo (pelo menos 3 caracteres).')
      .max(200, 'O motivo tem no máximo 200 caracteres.'),
    confirmarMesAnterior: z.literal(true).optional(),
  })
  .strict()
export type DesfazerPagamentoDeConta = z.infer<typeof DesfazerPagamentoDeConta>
