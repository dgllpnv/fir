import { z } from 'zod'
import { DiaCivil, Uuid } from './comum'
import { QuantidadeNaSaida } from './estoque'

/**
 * A ABA "CONSUMO" DA FICHA DO PACIENTE — `GET /v1/pacientes/:id/consumo`.
 *
 * É dado pessoal sensível de saúde (LGPD art. 11, regra 18): o que foi
 * aplicado em UM paciente, com lote. Por isso a forma é fechada (`.strict()`)
 * e o que NÃO está aqui é o ponto:
 *
 *  - **sem custo**: a aba não tem nenhum campo monetário, e nenhum nome de
 *    `CAMPOS_MONETARIOS` — a redação por nome de chave não tem o que apagar;
 *  - **sem outro paciente**: nem "outros pacientes do lote" (L2);
 *  - **`tarefaId` só para quem vê a tarefa** (mesma regra de editar tarefa).
 *
 * `quem` é o NOME de quem registrou. É o único nome de colaborador da resposta.
 */

/** O limite é FIXO: a rota não aceita `limite` do cliente (sem varredura por página gigante). */
export const LIMITE_DO_CONSUMO = 20

export const ConsultaDoConsumo = z
  .object({
    pagina: z.coerce.number().int().min(1).max(500).default(1),
  })
  .strict()
export type ConsultaDoConsumo = z.infer<typeof ConsultaDoConsumo>

export const LinhaDeConsumo = z
  .object({
    id: Uuid,
    /** Dia civil da clínica (regra 22). */
    dia: DiaCivil,
    item: z.string(),
    /** Em `medida`, já formatada pelo domínio: "0,5 ampola". Nunca milésimos brutos na tela. */
    quantidade: QuantidadeNaSaida,
    /** A mesma quantidade na unidade de USO do item ("2,5 mg"), quando o cadastro declara uma. */
    quantidadeEmUso: QuantidadeNaSaida.nullable(),
    /** A validade do lote. `null` = o item não controla validade. */
    lote: DiaCivil.nullable(),
    /** Nome de quem registrou. `null` = sessão de suporte ou compensação automática. */
    quem: z.string().nullable(),
    origem: z.enum(['sessao', 'atendimento']),
    /** Só quando o autor da leitura enxerga a tarefa; senão `null`. */
    tarefaId: Uuid.nullable(),
    /** `true` = movimento compensatório (sessão reaberta, programa excluído). */
    estorno: z.boolean(),
    /** No estorno: o movimento de consumo que ele desfaz. */
    estornaId: Uuid.nullable(),
    /** No consumo: `true` se já foi estornado. */
    estornado: z.boolean(),
  })
  .strict()
export type LinhaDeConsumo = z.infer<typeof LinhaDeConsumo>

/**
 * O LÍQUIDO por item, somado no SERVIDOR sobre o histórico inteiro do paciente
 * (não só a página): consumo menos estorno. Existe para nenhuma tela somar
 * linha a linha ignorando o flag de estorno — a soma ingênua dobraria o que
 * foi desfeito. Em `medida`, já formatada.
 */
export const LiquidoPorItem = z
  .object({ item: z.string(), quantidade: QuantidadeNaSaida })
  .strict()
export type LiquidoPorItem = z.infer<typeof LiquidoPorItem>

export const RespostaDoConsumo = z
  .object({
    itens: z.array(LinhaDeConsumo),
    liquidoPorItem: z.array(LiquidoPorItem),
    pagina: z.number().int(),
    limite: z.number().int(),
    temMais: z.boolean(),
  })
  .strict()
export type RespostaDoConsumo = z.infer<typeof RespostaDoConsumo>
