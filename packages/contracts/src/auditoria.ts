import { z } from 'zod'
import { Uuid } from './comum'

export const AcaoDaTrilha = z.enum(['criou', 'alterou', 'removeu', 'acessou'])
export type AcaoDaTrilha = z.infer<typeof AcaoDaTrilha>

/** `'operador'` é o superadmin do épico 12, que não é uma `pessoa` (D-5). */
export const AtorDaTrilha = z.enum(['pessoa', 'operador', 'sistema'])
export type AtorDaTrilha = z.infer<typeof AtorDaTrilha>

/**
 * O CURSOR, e por que ele não é um `OFFSET`.
 *
 * `OFFSET n` conta linhas a partir do topo no momento da consulta — e o topo
 * da trilha muda o tempo todo, porque toda escrita de toda pessoa da clínica
 * acrescenta linha. Entre a página 1 e a página 2, três linhas novas fazem o
 * fim da página 1 reaparecer no começo da página 2. Quem está investigando um
 * incidente conta registros que viu duas vezes, e nunca vê os que a janela
 * pulou — numa trilha de auditoria isso não é desconforto de paginação, é
 * resposta errada à pergunta "o que aconteceu aqui".
 *
 * `(em, id)` é posição ABSOLUTA: a página seguinte continua exatamente onde a
 * anterior parou, aconteça o que acontecer acima dela. `id` entra junto
 * porque `em` tem empate — duas escritas na mesma transação compartilham
 * `now()`, e um cursor só de `em` pularia a segunda ou a repetiria para
 * sempre. O índice `auditoria_por_clinica_em (clinica_id, em DESC, id DESC)`
 * atende essa comparação de tupla sem varrer.
 *
 * Formato `<timestamp ISO>|<id>`: opaco o bastante para ninguém depender da
 * forma, legível o bastante para quem depura ler. Não é segredo e não precisa
 * ser — ele é uma POSIÇÃO, e a consulta roda dentro de `naClinica`, então um
 * cursor forjado continua preso à clínica da sessão.
 */
export const CursorDaTrilha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|\d+$/, 'cursor inválido')

export const TrilhaConsulta = z.object({
  entidade: z.string().trim().min(1).max(63).optional(),
  entidadeId: z.string().trim().min(1).max(200).optional(),
  acao: AcaoDaTrilha.optional(),
  atorId: Uuid.optional(),
  // Teto de 200: a trilha carrega `de`/`para` inteiros, e "me dá tudo" numa
  // rota que entrega dado sensível é o pedido que não se atende.
  limite: z.coerce.number().int().min(1).max(200).default(50),
  antesDe: CursorDaTrilha.optional(),
})
export type TrilhaConsulta = z.infer<typeof TrilhaConsulta>

/**
 * `de` e `para` são `unknown` porque a trilha é deliberadamente sem esquema:
 * ela guarda o diff das colunas que mudaram, de qualquer tabela, inclusive
 * das que ainda não existem.
 *
 * O PREÇO DISSO, dito aqui porque é o único lugar onde quem lê vai procurar:
 * a varredura de `teste/redacao-de-valores.test.ts` percorre os esquemas Zod
 * atrás de campo monetário e **é cega aqui** — não há `shape` onde descer.
 * Nesta rota, a redação em tempo de execução é a única camada, e é por isso
 * que ela tem teste próprio com registro sintético de salário no e2e, em vez
 * de depender da varredura.
 */
export const ItemDaTrilha = z.object({
  /** `bigint` do Postgres, em texto — ver `dinheiroEmTexto` para o porquê. */
  id: z.string(),
  clinicaId: Uuid,
  /** Instante em UTC (regra 22). O fuso de exibição é o da clínica. */
  em: z.string(),
  atorTipo: AtorDaTrilha,
  atorId: Uuid.nullable(),
  acao: AcaoDaTrilha,
  /** Nome da TABELA — mesmo vocabulário da escrita e do acesso. */
  entidade: z.string(),
  entidadeId: z.string(),
  de: z.unknown(),
  para: z.unknown(),
  motivo: z.string().nullable(),
})
export type ItemDaTrilha = z.infer<typeof ItemDaTrilha>

export const TrilhaSaida = z.object({
  itens: z.array(ItemDaTrilha),
  /** Cursor da próxima página, ou `null` quando acabou. */
  proxima: CursorDaTrilha.nullable(),
})
export type TrilhaSaida = z.infer<typeof TrilhaSaida>
