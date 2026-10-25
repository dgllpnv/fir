import { z } from 'zod'
import { DiaCivil, dinheiroEmTexto, Hora, Uuid } from './comum'
import { PagamentoEmbutido } from './tarefas'

/**
 * `POST /v1/tarefas/:id/jornada` — UMA AÇÃO, UM CORPO.
 *
 * O protótipo recebe tudo num objeto só
 * (`{id, acao, prazo?, hora?, valor?, nota?, motivo?, acaoEm?, programa?}`) e
 * descobre o que falta em tempo de execução — às vezes. `perder` sem motivo
 * ele NÃO descobre: aceita e grava vazio. Resultado medido: o KPI "Orçamentos
 * perdidos · veja os motivos no histórico" aponta para um histórico sem motivo
 * nenhum, e o único número que explicaria a perda não explica nada.
 *
 * Aqui `perder` sem `motivoId` não compila, e `reagendar` com `valor` também
 * não.
 */

/** Texto livre da recepção. Máx. 160, aparado. **NUNCA vai para log** (regra 21). */
const Nota = z.string().trim().max(160).optional()

/** Centavos positivos. `null` e zero não são proposta. */
const valorDeOrcamento = dinheiroEmTexto.refine((v): v is bigint => v !== null && v > 0n, {
  message: 'Informe o valor do orçamento.',
})

/** O valor de um item da proposta. Opcional: o programa pode ter preço único. */
const valorDeItem = dinheiroEmTexto.refine((v): v is bigint => v !== null && v >= 0n, {
  message: 'informe um valor em centavos, zero ou mais',
})

/**
 * Um item do programa proposto no orçamento. A costura com o épico 5.
 *
 * `chave` e `depoisDe` são o ENCADEAMENTO dentro da proposta: "a segunda série
 * começa depois que a primeira terminar". Ficam como texto curto, e não como
 * índice do array, porque o épico 5 lê esta coluna meses depois e a ordem do
 * array não é contrato de nada.
 */
const ItemOrcado = z
  .object({
    procedimentoId: Uuid,
    sessoes: z.number().int().min(1).max(60),
    intervaloDias: z.number().int().min(1).max(365),
    dose: z.string().trim().max(40).optional(),
    responsavelId: Uuid.nullish(),
    valor: valorDeItem.optional(),
    chave: z.string().trim().min(1).max(20),
    depoisDe: z.string().trim().min(1).max(20).optional(),
  })
  .strict()

/**
 * A proposta tem de FECHAR: chaves únicas, e `depoisDe` apontando para um item
 * que existe.
 *
 * Sem isto, uma proposta cujo encadeamento não fecha chega inteira ao épico 5,
 * que monta sessões sem data de início — e a descoberta acontece na agenda da
 * enfermagem, não aqui.
 */
const Programa = z
  .array(ItemOrcado)
  .min(1)
  // `.max(10)`, não o `.slice(0,10)` do protótipo: cortar em silêncio é a
  // médica prescrever onze e a clínica montar dez.
  .max(10)
  .superRefine((itens, ctx) => {
    const chaves = new Set<string>()
    for (const [i, item] of itens.entries()) {
      if (chaves.has(item.chave)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, 'chave'],
          message: `Chave repetida no programa: "${item.chave}".`,
        })
      }
      chaves.add(item.chave)
    }
    for (const [i, item] of itens.entries()) {
      if (item.depoisDe === undefined) continue
      if (item.depoisDe === item.chave) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, 'depoisDe'],
          message: 'Um item não começa depois de si mesmo.',
        })
        continue
      }
      if (!chaves.has(item.depoisDe)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, 'depoisDe'],
          message: `O item "${item.depoisDe}" não está nesta proposta.`,
        })
      }
    }
  })

/**
 * As onze ações que esta rota aceita.
 *
 * **`agendar` e `concluir` não estão aqui.** São `POST /v1/tarefas` e
 * `POST /v1/tarefas/:id/concluir` (épico 2), que já escrevem `etapa` e
 * `historico`. Aceitá-los aqui seria um segundo caminho para a mesma
 * transição, e o segundo caminho é sempre o que diverge.
 *
 * **`etapa` também não está aqui.** O cliente nunca diz para onde o cartão vai
 * — ele diz o que a recepção FEZ, e o servidor decide o destino pela tabela de
 * `packages/domain/src/jornada.ts`. É a diferença entre uma máquina de estados
 * e um campo editável.
 *
 * `retomarEm` é OPCIONAL: o padrão (`hoje + 2` no orçamento, `hoje + 3` no
 * follow-up) é calculado no SERVIDOR, no fuso da clínica (regra 24). O
 * protótipo calcula na tela, e um relógio de cliente adiantado faria o
 * orçamento voltar a pedir ação no dia errado.
 */
export const MoverEtapa = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('enviarConfirmacao') }).strict(),
  z.object({ acao: z.literal('confirmar') }).strict(),
  z.object({ acao: z.literal('noshow') }).strict(),
  z.object({ acao: z.literal('desmarcar'), nota: Nota }).strict(),
  z.object({ acao: z.literal('reagendar'), prazo: DiaCivil, hora: Hora.optional() }).strict(),
  z.object({ acao: z.literal('encerrar'), nota: Nota }).strict(),
  z.object({ acao: z.literal('reabrir') }).strict(),
  z
    .object({
      acao: z.literal('registrarOrcamento'),
      valor: valorDeOrcamento,
      retomarEm: DiaCivil.optional(),
      programa: Programa.optional(),
      nota: Nota,
    })
    .strict(),
  z.object({ acao: z.literal('followUp'), retomarEm: DiaCivil.optional(), nota: Nota }).strict(),
  // O MESMO `PagamentoEmbutido` do épico 2, não uma segunda cópia: se fosse
  // outro esquema, "valor em aberto pode ser zero" valeria num e não no
  // outro, e a diferença apareceria no saldo da paciente.
  z.object({ acao: z.literal('fechar'), recebimento: PagamentoEmbutido, nota: Nota }).strict(),
  // `motivoId`, e NÃO o nome: o nome vem da lista da clínica, resolvido no
  // servidor dentro da mesma transação (decisão D-2). Aceitar o nome do
  // cliente faria a história contar o que o navegador disse.
  z.object({ acao: z.literal('perder'), motivoId: Uuid, nota: Nota }).strict(),
])
export type MoverEtapa = z.infer<typeof MoverEtapa>

/** Um motivo de perda, como a lista suspensa da tela de perda o lê. */
export const MotivoDePerda = z.object({ id: Uuid, nome: z.string() })
export type MotivoDePerda = z.infer<typeof MotivoDePerda>

export const ListaDeMotivos = z.object({ itens: z.array(MotivoDePerda) })
export type ListaDeMotivos = z.infer<typeof ListaDeMotivos>
