import { CATEGORIAS_DESP, FORMAS_DE_CONFERENCIA, FORMAS_DE_SAIDA } from '@fir/domain'
import { z } from 'zod'
import { centavosNaSaida, DiaCivil, dinheiroEmTexto, Mes, Uuid } from './comum'
import { FORMAS } from './tarefas'

/**
 * As formas de ENTRADA são as mesmas de `tarefas.ts` — `FORMAS` —, e esta
 * linha é um apelido, não uma segunda lista.
 *
 * O pagamento embutido no atendimento e o recebimento avulso produzem a MESMA
 * linha de `recebimentos`. Duas listas de formas é como uma delas ganha
 * `Boleto` um dia e o caixa passa a esperar na gaveta um dinheiro que nunca
 * esteve lá.
 */
export const FORMAS_DE_ENTRADA = FORMAS

const NOMES_DE_CATEGORIA = CATEGORIAS_DESP.map((c) => c.nome) as [string, ...string[]]

/** Centavos positivos. `null` e zero não são recebimento. */
const valorRecebido = dinheiroEmTexto.refine((v): v is bigint => v !== null && v > 0n, {
  message: 'informe um valor maior que zero',
})

/** Centavos que podem ser zero — o que o recebimento deixou em aberto. */
const valorEmAberto = dinheiroEmTexto.refine((v): v is bigint => v !== null && v >= 0n, {
  message: 'informe um valor em centavos, zero ou mais',
})

/** Centavos zero ou mais. Meta zero REMOVE a meta; ver `SalvarMeta`. */
const valorDeMeta = dinheiroEmTexto.refine((v): v is bigint => v !== null && v >= 0n, {
  message: 'informe um valor em centavos, zero ou mais',
})

const Obs = z.string().trim().max(200).default('')

/**
 * O QUE o paciente está pagando — `REFS_RECEB` do protótipo (linha 4917).
 *
 * União discriminada, e não um `tipo: string`, porque cada referência aceita
 * coisas diferentes:
 *
 *  - `consulta`, `sinal` e `novo` aceitam "ficou valor em aberto";
 *  - `programa` e `saldo` não aceitam — eles ABATEM saldo, não o criam;
 *  - só `programa` tem `programaId`, e ele é obrigatório lá.
 *
 * Com três campos opcionais num objeto só, "abater saldo criando saldo"
 * compila e faz parse. Aqui não.
 *
 * **Uma união só, com os campos comuns repetidos nos cinco ramos — e não
 * `z.object({…}).and(Referencia)` como o plano escreveu.** A interseção
 * IMPEDE `.strict()`: cada lado recusaria as chaves do outro, e sem `.strict()`
 * o `valorAberto` enviado junto de `ref: 'saldo'` é DESCARTADO EM SILÊNCIO em
 * vez de recusado — o teste passa verde e o saldo da paciente fica errado. É
 * a mesma armadilha que o épico 2 encontrou em `CriarTarefa`.
 */
const comumDoRecebimento = {
  /**
   * Gerado pelo CLIENTE **ao abrir o formulário**, nunca ao enviar.
   *
   * Reenviar devolve o mesmo recebimento (índice `recebimento_por_requisicao`),
   * e é assim que o duplo toque no balcão deixa de dobrar a receita. Gerado no
   * envio, os dois toques produzem dois ids e o índice não serve para nada.
   */
  requisicaoId: Uuid,
  pacienteId: Uuid,
  valor: valorRecebido,
  forma: z.enum(FORMAS_DE_ENTRADA),
  em: DiaCivil,
  obs: Obs,
  unidadeId: Uuid.nullish(),
}

export const REFERENCIAS = ['consulta', 'sinal', 'novo', 'programa', 'saldo'] as const
export type Referencia = (typeof REFERENCIAS)[number]

/** As três que PODEM deixar valor em aberto. O ramo é escrito, não gerado. */
const queAbre = <R extends string>(ref: R) =>
  z.object({ ...comumDoRecebimento, ref: z.literal(ref), valorAberto: valorEmAberto.optional() }).strict()

export const RegistrarRecebimento = z.discriminatedUnion('ref', [
  queAbre('consulta'),
  queAbre('sinal'),
  queAbre('novo'),
  // `programa` só é aceitável a partir do épico 5. Até lá a ROTA recusa com
  // "Este paciente não tem programa em andamento." — o mesmo texto da tela.
  // O contrato já exige o id: o épico 5 não mexe neste arquivo.
  z.object({ ...comumDoRecebimento, ref: z.literal('programa'), programaId: Uuid }).strict(),
  z.object({ ...comumDoRecebimento, ref: z.literal('saldo') }).strict(),
])
export type RegistrarRecebimento = z.infer<typeof RegistrarRecebimento>

export const RecebimentoNaLista = z.object({
  id: Uuid,
  tarefaId: Uuid.nullable(),
  pacienteId: Uuid,
  paciente: z.string(),
  tipo: z.string(),
  valor: centavosNaSaida,
  valorAberto: centavosNaSaida,
  forma: z.enum(FORMAS_DE_ENTRADA),
  em: DiaCivil,
  obs: z.string(),
  registradoPor: z.string(),
  estornado: z.boolean(),
})
export type RecebimentoNaLista = z.infer<typeof RecebimentoNaLista>

// ---------------------------------------------------------------------------
// CONTAS A PAGAR
// ---------------------------------------------------------------------------

export const SalvarConta = z
  .object({
    descricao: z.string().trim().min(1).max(80),
    // A lista é a de `packages/domain`. A coluna do banco é `text` de
    // propósito (acrescentar categoria não pode exigir migration), e é a
    // borda que cobra — igual ao `NomeDeTipo` do épico 2.
    categoria: z.enum(NOMES_DE_CATEGORIA),
    valor: valorRecebido,
    vencimento: DiaCivil,
    fornecedor: z.string().trim().max(80).default(''),
    responsavelId: Uuid,
    unidadeId: Uuid.nullish(),
    /**
     * Mensal, sim ou não — e **a âncora não vem do cliente**.
     *
     * O dia do primeiro `vencimento` É a âncora: pedi-la à parte permitiria
     * cadastrar uma conta que vence dia 10 e repete dia 31. O servidor a
     * deriva e grava em `dia_vencimento`.
     */
    mensal: z.boolean().default(false),
  })
  .strict()
export type SalvarConta = z.infer<typeof SalvarConta>

export const EditarConta = SalvarConta
export type EditarConta = z.infer<typeof EditarConta>

export const PagarConta = z
  .object({
    em: DiaCivil,
    /** O que de FATO saiu. Pode diferir do valor da conta, e é este que fecha o mês. */
    valor: valorRecebido,
    // `FORMAS_DE_SAIDA`, nunca `FORMAS`: Boleto e Débito automático existem
    // aqui e não lá; Nota promissória existe lá e não aqui. Misturar as duas
    // listas é o começo de uma Visão do mês que soma maçã com laranja.
    formaPagamento: z.enum(FORMAS_DE_SAIDA).optional(),
  })
  .strict()
export type PagarConta = z.infer<typeof PagarConta>

export const ContaNaLista = z.object({
  id: Uuid,
  descricao: z.string(),
  categoria: z.string(),
  tipo: z.enum(['fixa', 'variavel']),
  valor: centavosNaSaida,
  vencimento: DiaCivil,
  vencida: z.boolean(),
  fornecedor: z.string(),
  responsavelId: Uuid,
  responsavel: z.string(),
  mensal: z.boolean(),
  pagoEm: DiaCivil.nullable(),
  valorPago: centavosNaSaida,
  formaPagamento: z.string(),
})
export type ContaNaLista = z.infer<typeof ContaNaLista>

// ---------------------------------------------------------------------------
// CAIXA DO DIA
// ---------------------------------------------------------------------------

export const FecharCaixa = z
  .object({
    dia: DiaCivil,
    /**
     * ARRAY, e não mapa `{ Pix: '45000' }`.
     *
     * Na entrada o interceptor não está em jogo, mas a forma tem de ser a
     * MESMA da resposta: duas formas para a mesma coisa é como uma delas vira
     * mapa de novo do outro lado — e aí o valor passa a morar na chave, onde
     * a redação não alcança.
     */
    contado: z
      .array(z.object({ forma: z.enum(FORMAS_DE_CONFERENCIA), valor: valorEmAberto }).strict())
      .superRefine((linhas, ctx) => {
        const vistas = new Set<string>()
        for (const l of linhas) {
          if (vistas.has(l.forma)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `forma repetida: ${l.forma}` })
          }
          vistas.add(l.forma)
        }
      }),
    obs: z.string().trim().max(160).default(''),
  })
  .strict()
export type FecharCaixa = z.infer<typeof FecharCaixa>

const LinhaDeCaixa = z.object({
  forma: z.enum(FORMAS_DE_CONFERENCIA),
  esperado: centavosNaSaida,
  contado: centavosNaSaida,
  diferenca: centavosNaSaida,
})

/**
 * O caixa de um dia AINDA ABERTO.
 *
 * **A regra 6 é esta forma, não um `if` no controlador.** Não existe
 * `esperado`, não existe `diferenca`, não existe `porForma` — e não como
 * `null`, que contaria ao cliente que há um número ali e convidaria o próximo
 * refactor a "consertá-lo". Os campos NÃO EXISTEM, e por isso não há como
 * construir esta resposta com eles dentro.
 *
 * Vale para o usuário MAIS privilegiado do sistema. Redação não é defesa
 * aqui: quem fecha o caixa com `valores` continua precisando conferir às
 * cegas.
 */
export const CaixaAberto = z
  .object({
    dia: DiaCivil,
    fechado: z.literal(false),
    formas: z.array(z.enum(FORMAS_DE_CONFERENCIA)),
    responsavel: z.object({ id: Uuid, nome: z.string() }).nullable(),
  })
  .strict()
export type CaixaAberto = z.infer<typeof CaixaAberto>

/** O caixa já fechado — e agora sim a comparação, que é o que a clínica veio ver. */
export const CaixaFechado = z
  .object({
    dia: DiaCivil,
    fechado: z.literal(true),
    /**
     * Derivado no servidor, e é ELE que a recepcionista sem `valores` lê.
     *
     * Não a `diferenca`: ela digitou o contado, então a diferença lhe daria o
     * esperado por subtração. É a divergência #6 do plano, e a ADR 0004-bis.
     */
    conferido: z.boolean(),
    fechadoPor: z.object({ id: Uuid, nome: z.string() }),
    fechadoEm: z.string(),
    obs: z.string(),
    // ARRAY, não mapa: o interceptor redige por NOME DE CHAVE, e num mapa de
    // forma de pagamento a chave é dado — `{ Pix: '45000' }` atravessa.
    porForma: z.array(LinhaDeCaixa),
    diferenca: centavosNaSaida,
    /** Informativo, FORA da conferência: promissória não está na gaveta. */
    promissorias: z.object({ quantidade: z.number().int(), valor: centavosNaSaida }),
  })
  .strict()
export type CaixaFechado = z.infer<typeof CaixaFechado>

export const ConferenciaDeCaixa = z.discriminatedUnion('fechado', [CaixaAberto, CaixaFechado])
export type ConferenciaDeCaixa = z.infer<typeof ConferenciaDeCaixa>

// ---------------------------------------------------------------------------
// SALDO E COBRANÇAS
// ---------------------------------------------------------------------------

export const GrupoDeSaldo = z.object({
  /** `null` = o grupo geral, fora de programa. */
  programaId: Uuid.nullable(),
  programa: z.string().nullable(),
  aberto: centavosNaSaida,
  abatido: centavosNaSaida,
  saldo: centavosNaSaida,
  credito: centavosNaSaida,
})

export const SaldoDoPaciente = z
  .object({
    // SEMPRE lista de grupos, nunca um total só — mesmo hoje, em que o épico
    // 5 ainda não preencheu `programa_id` e o resultado é um grupo. Entregar
    // um total agora e "agrupar depois" é como se colapsa para sempre.
    grupos: z.array(GrupoDeSaldo),
    saldo: centavosNaSaida,
    credito: centavosNaSaida,
    /** Derivado; sobrevive à redação. É o que a equipe sem `valores` recebe. */
    temSaldo: z.boolean(),
  })
  .strict()
export type SaldoDoPaciente = z.infer<typeof SaldoDoPaciente>

export const CANAIS_DE_COBRANCA = ['WhatsApp', 'Telefone', 'Presencial', 'Outro'] as const

export const RegistrarCobranca = z
  .object({ pacienteId: Uuid, canal: z.enum(CANAIS_DE_COBRANCA) })
  .strict()
export type RegistrarCobranca = z.infer<typeof RegistrarCobranca>

// ---------------------------------------------------------------------------
// META, CONFIGURAÇÃO E VISÃO DO MÊS
// ---------------------------------------------------------------------------

/**
 * `PUT` idempotente. **Zero REMOVE a meta**, explicitamente.
 *
 * O protótipo faz `Number(b.valor)||0` e grava o zero, que depois vira
 * denominador — e meta zero não tem percentual. Aqui é a mesma semântica,
 * escrita: zero apaga a linha.
 */
export const SalvarMeta = z.object({ valor: valorDeMeta }).strict()
export type SalvarMeta = z.infer<typeof SalvarMeta>

export const PercentualDaMeta = z
  .object({
    mes: Mes,
    meta: centavosNaSaida,
    recebido: centavosNaSaida,
    /** Não é monetário, e por isso atravessa para quem não tem `valores`. */
    percentual: z.number().int().nullable(),
  })
  .strict()
export type PercentualDaMeta = z.infer<typeof PercentualDaMeta>

export const ConfigFinanceira = z
  .object({
    caixaResponsavelId: Uuid.nullish(),
    mensagemDeCobranca: z.string().trim().max(400).default(''),
  })
  .strict()
export type ConfigFinanceira = z.infer<typeof ConfigFinanceira>

const LinhaDeCategoria = z.object({
  categoria: z.string(),
  tipo: z.enum(['fixa', 'variavel']),
  valor: centavosNaSaida,
  percentual: z.number().int().nullable(),
  // Aninhado, e não `valorMesAnterior`: a chave volta a ser `valor`, que a
  // lista de `CAMPOS_MONETARIOS` já conhece. Ver a nota em `@fir/domain`.
  mesAnterior: z.object({ valor: centavosNaSaida }),
})

const LinhaDeForma = z.object({ forma: z.string(), valor: centavosNaSaida })

export const VisaoDoMes = z
  .object({
    mes: Mes,

    recebido: centavosNaSaida,
    quantidadeDeRecebimentos: z.number().int(),
    porForma: z.array(LinhaDeForma),

    mesAnterior: z.object({ recebido: centavosNaSaida, despesasPagas: centavosNaSaida }),

    despesasPagas: centavosNaSaida,
    quantidadeDePagas: z.number().int(),
    porCategoria: z.array(LinhaDeCategoria),
    fixas: centavosNaSaida,
    variaveis: centavosNaSaida,
    percentualFixas: z.number().int().nullable(),
    percentualVariaveis: z.number().int().nullable(),

    // `resultadoDoMes`, e não `resultado`: `TarefaNaFicha.resultado` já existe
    // e é texto, e a redação apaga por NOME em qualquer profundidade.
    resultadoDoMes: centavosNaSaida,
    percentualDoResultado: z.number().int().nullable(),

    aPagar: centavosNaSaida,
    quantidadeAPagar: z.number().int(),
    quantidadeVencidas: z.number().int(),
    aReceber: centavosNaSaida,

    meta: centavosNaSaida,
    metaRestante: centavosNaSaida,
    percentualDaMeta: z.number().int().nullable(),

    caixa: z.object({
      fechados: z.number().int(),
      diasUteis: z.number().int(),
      comDiferenca: z.number().int(),
      diferenca: centavosNaSaida,
    }),
  })
  .strict()
export type VisaoDoMes = z.infer<typeof VisaoDoMes>
