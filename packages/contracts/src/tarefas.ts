import { ehPagamento, FREQUENCIAS, TIPOS } from '@fir/domain'
import { z } from 'zod'
import { DiaCivil, dinheiroEmTexto, Uuid } from './comum'

/**
 * `HH:MM`, com as faixas conferidas.
 *
 * O `Code.gs` valida só `/^\d{2}:\d{2}$/`, e a coluna `time` do Postgres
 * recusaria `99:99` com um erro de banco em vez de uma mensagem de tela. A
 * faixa entra aqui para que a recusa seja a do contrato.
 */
const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM')

/**
 * O tipo de contato precisa ser um dos NOMES CONHECIDOS.
 *
 * Divergência deliberada do plano, que aceitava `z.string().max(60)`: um nome
 * fora da tabela faz `infoDoTipo` cair no fallback sem flag nenhuma, e um
 * `"Pagamento de consulta "` com espaço no fim viraria uma tarefa que nunca
 * conta como receita — sem erro, só com o faturamento do mês menor. A coluna
 * do banco continua `text` justamente porque a MIGRAÇÃO das 4 clínicas
 * precisa gravar os nomes de três gerações; CRIAR pela API, não.
 */
const NomeDeTipo = z
  .string()
  .trim()
  .max(60)
  .refine((t) => TIPOS.some((x) => x.nome === t), {
    message: 'Tipo de contato desconhecido. Escolha um da lista.',
  })

export const FORMAS = [
  'Pix',
  'Dinheiro',
  'Cartão de crédito',
  'Cartão de débito',
  'Nota promissória',
] as const

/** Centavos positivos. `null` e zero não são pagamento. */
const valorRecebido = dinheiroEmTexto.refine((v): v is bigint => v !== null && v > 0n, {
  message: 'informe um valor maior que zero',
})

/** Centavos que podem ser zero — o que o pagamento deixou em aberto. */
const valorEmAberto = dinheiroEmTexto.refine((v): v is bigint => v !== null && v >= 0n, {
  message: 'informe um valor em centavos, zero ou mais',
})

/**
 * O pagamento embutido no atendimento — o bloco "Houve pagamento?" da tela.
 *
 * Ele e o recebimento avulso do épico 4 produzem a MESMA linha de
 * `recebimentos`. Nunca as duas para o mesmo dinheiro (regra 3), e quem
 * garante isso não é este esquema: é o índice único parcial da migration
 * `0006`. Aqui só se declara a forma.
 */
export const PagamentoEmbutido = z
  .object({
    valor: valorRecebido,
    forma: z.enum(FORMAS),
    valorAberto: valorEmAberto.optional(),
  })
  .strict()
export type PagamentoEmbutido = z.infer<typeof PagamentoEmbutido>

/**
 * QUANDO a tarefa acontece. União discriminada, e não `realizada: boolean` +
 * `datas: string[]`.
 *
 * O protótipo descobre a combinação ilegal em tempo de execução
 * (`if (t.realizada) return fail("Lançamento retroativo não pode ser
 * recorrente.")`). Aqui ela não tem como ser escrita: `pagamento` só existe no
 * ramo retroativo, `freq`/`ate` só existem no ramo série, e os ramos são
 * `.strict()` — mandar os dois juntos é erro de parse, antes de o serviço
 * existir.
 */
export const Quando = z
  .discriminatedUnion('modo', [
    // O caso normal: agendar para a frente (ou para hoje).
    z.object({ modo: z.literal('agendada'), prazo: DiaCivil, hora: Hora.optional() }).strict(),
    // MANUAL cap. 4, "Lançar algo que já aconteceu": a tarefa nasce CONCLUÍDA.
    z
      .object({
        modo: z.literal('retroativo'),
        em: DiaCivil,
        hora: Hora.optional(),
        pagamento: PagamentoEmbutido.optional(),
      })
      .strict(),
    // "Tarefas que se repetem": N tarefas com o mesmo `serie_id`.
    z
      .object({
        modo: z.literal('serie'),
        inicio: DiaCivil,
        hora: Hora.optional(),
        freq: z.enum(FREQUENCIAS),
        ate: DiaCivil,
        aCadaNDias: z.number().int().min(2).max(365).optional(),
      })
      .strict(),
  ])
  .superRefine((q, ctx) => {
    // "A cada X dias" sem o X. `gerarSerie` também recusa — mas aqui a recusa
    // chega como erro de campo, na borda, com o caminho que a tela destaca.
    if (q.modo === 'serie' && q.freq === 'ndias' && q.aCadaNDias === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['aCadaNDias'],
        message: 'Informe de 2 a 365 dias.',
      })
    }
  })
export type Quando = z.infer<typeof Quando>

/**
 * Nova tarefa NUNCA cria um tipo do grupo Pagamentos.
 *
 * A tela da PO já faz isso — o `<select>` de "Nova tarefa" filtra
 * `!ehPagamento(t.nome)` e a dica embaixo dele diz "Recebeu dinheiro do
 * paciente? Não é tarefa: use Recebimento". A regra mora aqui também porque o
 * servidor sempre valida: se a única guarda fosse o `<select>`, um POST direto
 * criaria a segunda contagem do mesmo dinheiro.
 */
const tipoQueNaoEhPagamento = NomeDeTipo.refine((t) => !ehPagamento(t), {
  message: 'Pagamento não é tarefa. Use Recebimento para registrar dinheiro recebido.',
})

const comumDaTarefa = {
  responsavelId: Uuid,
  // Opcional porque o serviço a preenche com o nome do tipo quando vier vazia
  // — é o que a tela faz, e é por isso que o rótulo dela vira "Descrição
  // (opcional)" no modo paciente.
  descricao: z.string().trim().max(400).optional(),
  prioridade: z.enum(['normal', 'urgente']).default('normal'),
  obs: z.string().trim().max(300).default(''),
  unidadeId: Uuid.nullish(),
  quando: Quando,
}

/**
 * União discriminada por `vinculo`, e **não** interseção de dois esquemas.
 *
 * A interseção impediria `.strict()`: cada lado recusaria as chaves do outro.
 * E sem `.strict()` o corpo `{ quando: { modo: 'retroativo' }, serie: {…} }`
 * — que é literalmente o que a tela antiga mandava — passaria com o `serie`
 * descartado em silêncio, criando UMA tarefa onde a recepção pediu doze.
 */
export const CriarTarefa = z.discriminatedUnion('vinculo', [
  z.object({ ...comumDaTarefa, vinculo: z.literal('interna') }).strict(),
  z
    .object({
      ...comumDaTarefa,
      vinculo: z.literal('paciente'),
      pacienteId: Uuid,
      tipo: tipoQueNaoEhPagamento,
    })
    .strict(),
])
export type CriarTarefa = z.infer<typeof CriarTarefa>

/**
 * Concluir. Três rotas separadas (`concluir`/`cancelar`/`reabrir`) porque são
 * três coisas — o `atualizarTarefa` da v20 as empilha num `status`, e foi
 * assim que ele ficou sem lista branca.
 */
export const Concluir = z
  .object({
    em: DiaCivil,
    resultado: z.string().trim().max(300).default(''),
    obs: z.string().trim().max(300).optional(),
    pagamento: PagamentoEmbutido.optional(),
  })
  .strict()
export type Concluir = z.infer<typeof Concluir>

export const Cancelar = z.object({ obs: z.string().trim().max(300).optional() }).strict()
export type Cancelar = z.infer<typeof Cancelar>

/**
 * Editar NÃO conclui, e `pagamento` não existe aqui.
 *
 * É a separação Concluir × Editar levada ao contrato: um corpo de edição com
 * `pagamento` é recusado pelo parse, não ignorado pelo serviço — ignorar em
 * silêncio é como a recepção acha que lançou o dinheiro e ele não está lá.
 */
export const EditarTarefa = z
  .object({
    responsavelId: Uuid.optional(),
    descricao: z.string().trim().min(1).max(400).optional(),
    prazo: DiaCivil.optional(),
    hora: Hora.nullish(),
    prioridade: z.enum(['normal', 'urgente']).optional(),
    obs: z.string().trim().max(300).optional(),
    resultado: z.string().trim().max(300).optional(),
    unidadeId: Uuid.nullish(),
    pacienteId: Uuid.nullish(),
    tipo: tipoQueNaoEhPagamento.optional(),
    // A data de realização vale SÓ para esta tarefa, nunca para a série — a
    // tela diz isso em letra miúda, e o serviço precisa do mesmo contrato.
    realizadaEm: DiaCivil.optional(),
    /** Alcança as próximas da série: abertas, com prazo >= o desta. */
    serie: z.boolean().default(false),
  })
  .strict()
export type EditarTarefa = z.infer<typeof EditarTarefa>

export const ExcluirTarefa = z.object({ serie: z.coerce.boolean().default(false) }).strict()
export type ExcluirTarefa = z.infer<typeof ExcluirTarefa>
