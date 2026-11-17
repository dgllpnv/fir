import { CATEGORIAS_DESP, FORMAS_DE_CONFERENCIA, FORMAS_DE_SAIDA, MEDIDAS_DA_META } from '@fir/domain'
import { z } from 'zod'
import { centavosNaSaida, DiaCivil, dinheiroEmTexto, Mes, Uuid } from './comum'
import {
  BooleanoDeConsulta,
  conferirPartes,
  confirmacoesDoRecebimento,
  FORMAS,
  PartesDoPagamento,
  RespostaDeHoje,
} from './tarefas'

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
  // `forma` OU `partes` (fatia 4.1), conferido na união abaixo: sem `partes` é
  // a parte única com a forma de sempre.
  forma: z.enum(FORMAS_DE_ENTRADA).optional(),
  partes: PartesDoPagamento.optional(),
  em: DiaCivil,
  obs: Obs,
  unidadeId: Uuid.nullish(),
  /**
   * A campanha do pagamento (A3). Vai para a TAREFA companheira que o
   * recebimento cria — nunca para `recebimentos`, que não tem a coluna: a
   * receita da campanha tem um caminho só (N-1, N-3).
   */
  campanhaId: Uuid.nullish(),
  ...confirmacoesDoRecebimento,
}

export const REFERENCIAS = ['consulta', 'sinal', 'novo', 'programa', 'saldo'] as const
export type Referencia = (typeof REFERENCIAS)[number]

/** As três que PODEM deixar valor em aberto. O ramo é escrito, não gerado. */
const queAbre = <R extends string>(ref: R) =>
  z.object({ ...comumDoRecebimento, ref: z.literal(ref), valorAberto: valorEmAberto.optional() }).strict()

/**
 * O 409 de "Saldo em aberto" pago em VÁRIAS formas acima da dívida (veto V-1).
 *
 * Com uma forma só, o servidor corta o valor no que quita a dívida (pedido 6).
 * Com mais de uma, cortar exigiria escolher DE QUAL forma tirar — e a escolhida
 * dependeria da ordem digitada, e o caixa acusaria uma sobra que ninguém causou.
 * Então o servidor recusa, e a tela pede uma nova divisão.
 *
 * `devido` só existe para quem tem `valores`. Sem ela, a chave NÃO EXISTE (o
 * 409 não passa pela redação central, e um `null` contaria que há número ali).
 */
/** As partes de um recebimento na SAÍDA (lista, tarefa, funil), da maior para a menor. */
export const PartesNaSaida = z.array(z.object({ forma: z.string(), valor: centavosNaSaida }))

export const CODIGO_PARTES_ACIMA_DA_DIVIDA = 'PARTES_ACIMA_DA_DIVIDA'
export const PartesAcimaDaDivida = z
  .object({
    statusCode: z.literal(409),
    codigo: z.literal(CODIGO_PARTES_ACIMA_DA_DIVIDA),
    message: z.string(),
    devido: centavosNaSaida.optional(),
  })
  .strict()
export type PartesAcimaDaDivida = z.infer<typeof PartesAcimaDaDivida>

export const RegistrarRecebimento = z
  .discriminatedUnion('ref', [
  queAbre('consulta'),
  queAbre('sinal'),
  queAbre('novo'),
  // `programa` exige o id do programa, que precisa ser da paciente (a rota recusa
  // com "Este paciente não tem programa em andamento." se não for). A tela usa
  // "Programa em andamento" como atalho de `saldo` com `programaId`, para herdar
  // o aviso de valor acima da dívida.
  z.object({ ...comumDoRecebimento, ref: z.literal('programa'), programaId: Uuid }).strict(),
  // `saldo` ABATE uma dívida. `programaId` diz QUAL: ausente/nulo = o grupo geral
  // (o que não é de programa); com id = a dívida daquele programa. Sem isto, todo
  // "Saldo em aberto" caía no grupo geral, e a paciente que devia num programa
  // ficava com a dívida do programa e um crédito no geral.
  z.object({ ...comumDoRecebimento, ref: z.literal('saldo'), programaId: Uuid.nullish() }).strict(),
  ])
  .superRefine(conferirPartes)
export type RegistrarRecebimento = z.infer<typeof RegistrarRecebimento>

export const RecebimentoNaLista = z.object({
  id: Uuid,
  tarefaId: Uuid.nullable(),
  pacienteId: Uuid,
  paciente: z.string(),
  tipo: z.string(),
  valor: centavosNaSaida,
  valorAberto: centavosNaSaida,
  /** A forma da MAIOR parte. Quem mostra o detalhe lê `partes`. */
  forma: z.enum(FORMAS_DE_ENTRADA),
  /** As partes, da maior para a menor. `forma` vazia = legado migrado (entra na receita, fora do caixa). */
  partes: PartesNaSaida,
  em: DiaCivil,
  obs: z.string(),
  registradoPor: z.string(),
  estornado: z.boolean(),
})
export type RecebimentoNaLista = z.infer<typeof RecebimentoNaLista>

/**
 * O filtro da lista de recebimentos.
 *
 * `ultimosDias` existe por causa da regra 24: a lista "deste paciente nos
 * últimos 7 dias" é a defesa de produto contra a receita lançada duas vezes,
 * e ela aparece ANTES do campo de valor no formulário. Se o front calculasse
 * a janela, ela sairia do relógio do navegador — e um computador de balcão
 * com a data errada esconderia justamente o lançamento que a recepcionista
 * precisa ver. O servidor resolve a janela contra o próprio hoje, no fuso da
 * clínica.
 *
 * Sem filtro nenhum, a lista é a de HOJE — a seção "Recebimentos de hoje" da
 * tela.
 */
export const ConsultaDeRecebimentos = z
  .object({
    dia: DiaCivil.optional(),
    de: DiaCivil.optional(),
    ate: DiaCivil.optional(),
    pacienteId: Uuid.optional(),
    ultimosDias: z.coerce.number().int().min(1).max(31).optional(),
    // `z.coerce.boolean()` faria "false" virar true (string não vazia).
    incluirEstornados: BooleanoDeConsulta.optional(),
  })
  .strict()
  .refine((q) => (q.de === undefined) === (q.ate === undefined), {
    message: 'informe `de` e `ate` juntos',
  })
  .refine((q) => [q.dia, q.de, q.ultimosDias].filter((x) => x !== undefined).length <= 1, {
    message: 'escolha uma janela só: `dia`, `de`/`ate` ou `ultimosDias`',
  })
export type ConsultaDeRecebimentos = z.infer<typeof ConsultaDeRecebimentos>

export const ListaDeRecebimentos = z
  .object({ itens: z.array(RecebimentoNaLista) })
  .strict()
export type ListaDeRecebimentos = z.infer<typeof ListaDeRecebimentos>

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
    /**
     * A forma que a clínica ESPERA usar (ADR 0020). `''` = não prevista.
     *
     * É só a sugestão que a tela põe no Paguei, e o que a renovação mensal
     * copia. Nunca vira a forma usada no servidor — ver `PagarConta`.
     */
    formaPrevista: z.union([z.enum(FORMAS_DE_SAIDA), z.literal('')]).default(''),
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
    //
    // `''` explícito e ausente querem dizer o MESMO: "Não informada". O
    // servidor grava exatamente o que chegou e **nunca** cai para a forma
    // prevista (ADR 0020, decisão 2): alguém limpa o campo porque não sabe a
    // forma, e um fallback gravaria "Boleto" para o que saiu por Pix.
    formaPagamento: z.union([z.enum(FORMAS_DE_SAIDA), z.literal('')]).optional(),
  })
  .strict()
export type PagarConta = z.infer<typeof PagarConta>

/**
 * Criar a conta — `SalvarConta` mais, opcionalmente, o pagamento JÁ FEITO
 * ("Conta já paga"). Só a criação aceita `pagamento`: editar não paga.
 * É o mesmo `PagarConta` do Paguei, então a baixa não tem segundo formato.
 */
export const CriarConta = SalvarConta.extend({
  pagamento: PagarConta.optional(),
  /** Chave do envio: reenviar o mesmo lançamento devolve a conta já criada. */
  requisicaoId: Uuid.optional(),
}).strict()
export type CriarConta = z.infer<typeof CriarConta>

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
  /**
   * `z.string()`, e não o enum: o que está GRAVADO pode ser forma legada ou
   * renomeada, e a lista não pode recusar a própria linha que mostra.
   */
  formaPagamento: z.string(),
  formaPrevista: z.string(),
  /** Nome de quem registrou o pagamento (`pago_por`). `null` na conta aberta. */
  pagoPor: z.string().nullable(),
})
export type ContaNaLista = z.infer<typeof ContaNaLista>

/**
 * O filtro da tela Contas a pagar.
 *
 * `mes` governa só as PAGAS ("Pagas em outubro"); as abertas aparecem
 * inteiras, inclusive as vencidas de meses anteriores — a conta de agosto que
 * ninguém pagou não pode sumir em outubro.
 */
export const ConsultaDeContas = z
  .object({
    situacao: z.enum(['abertas', 'pagas', 'todas']).default('todas'),
    mes: Mes.optional(),
    /**
     * Filtro por forma (ADR 0020). Numa conta PAGA olha a forma usada; numa
     * EM ABERTO, a prevista.
     *
     * Texto livre de até 30, e não o enum: toda linha do bloco "Pago por
     * forma" precisa ser filtrável, inclusive a forma legada gravada fora da
     * lista. O sentinela "Não informada" (`FORMA_NAO_INFORMADA`) casa com `''`.
     */
    forma: z.string().trim().min(1).max(30).optional(),
  })
  .strict()
export type ConsultaDeContas = z.infer<typeof ConsultaDeContas>

export const ListaDeContas = z
  .object({
    itens: z.array(ContaNaLista),
    /**
     * Só em `situacao=pagas`: Σ `valor_pago` dos itens, SOMADO NO SERVIDOR.
     * É ele que bate centavo a centavo com a linha do bloco "Pago por forma";
     * a tela não soma. `valorPago` já é monetário, e a redação o alcança aqui.
     */
    total: z.object({ valorPago: centavosNaSaida }).strict().optional(),
  })
  .strict()
export type ListaDeContas = z.infer<typeof ListaDeContas>

/**
 * O que `POST /v1/contas/:id/pagar` devolve.
 *
 * `proxima` é a conta do mês seguinte quando a conta é mensal — criada na
 * MESMA transação do pagamento, com `ON CONFLICT DO NOTHING` sobre
 * `conta_da_serie_por_mes`. `null` quando a conta não é de série, **ou**
 * quando a próxima já existia: a idempotência é do banco, e a resposta diz a
 * verdade sobre o que esta requisição criou.
 */
export const ResultadoDoPagamento = z
  .object({ conta: ContaNaLista, proxima: ContaNaLista.nullable() })
  .strict()
export type ResultadoDoPagamento = z.infer<typeof ResultadoDoPagamento>

/**
 * O bloco financeiro da tela **Hoje**.
 *
 * `caixaPendente` é BOOLEANO, e isso não é economia de bytes: um valor aqui
 * seria o esperado chegando pela porta dos fundos, numa rota que a recepção
 * recarrega o dia inteiro. É a regra 6, e `/v1/hoje` está em
 * `ROTAS_DE_CONFERENCIA` justamente por causa deste campo.
 *
 * `contas` são **as minhas** que vencem em até 3 dias, mais as já vencidas —
 * o corte é do servidor, no fuso da clínica (MANUAL cap. 14).
 */
export const BlocoFinanceiroDeHoje = z
  .object({ caixaPendente: z.boolean(), contas: z.array(ContaNaLista) })
  .strict()
export type BlocoFinanceiroDeHoje = z.infer<typeof BlocoFinanceiroDeHoje>

/**
 * **A resposta de verdade de `GET /v1/hoje`.**
 *
 * Mora neste arquivo, e não ao lado de `RespostaDeHoje`, por uma razão
 * mecânica: `financeiro.ts` já importa `tarefas.ts` (as formas de pagamento
 * são UMA lista, não duas), e pôr `ContaNaLista` dentro de `RespostaDeHoje`
 * faria `tarefas.ts` importar de volta. Ciclo entre arquivos de contrato é a
 * classe de problema que só aparece no bundler de alguém, meses depois.
 */
export const HojeComFinanceiro = RespostaDeHoje.extend({ financeiro: BlocoFinanceiroDeHoje })
export type HojeComFinanceiro = z.infer<typeof HojeComFinanceiro>

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
    /**
     * O dia mudou DEPOIS de fechado (D-21): recebimento lançado, estornado ou
     * tarefa excluída depois de `fechadoEm`, ou a soma viva por forma já não
     * bate com o esperado guardado. Booleano: atravessa para quem não tem
     * `valores`. O fechamento guardado NUNCA é recalculado.
     */
    mudouDepoisDoFechamento: z.boolean(),
    /**
     * Por forma, as quatro: `valor = vivo − guardado`, com sinal. `valor` é
     * monetário e a redação o apaga; nunca `diferenca`, que é contado −
     * esperado. Array, não mapa — a chave de um mapa é onde a redação não chega.
     */
    alteracoesDepoisDoFechamento: z.array(
      z.object({ forma: z.enum(FORMAS_DE_CONFERENCIA), valor: centavosNaSaida }),
    ),
  })
  .strict()
export type CaixaFechado = z.infer<typeof CaixaFechado>

export const ConferenciaDeCaixa = z.discriminatedUnion('fechado', [CaixaAberto, CaixaFechado])
export type ConferenciaDeCaixa = z.infer<typeof ConferenciaDeCaixa>

/**
 * A linha de "Últimos fechamentos".
 *
 * Rota PRÓPRIA (`GET /v1/caixa/ultimos`), e não um campo dentro de
 * `GET /v1/caixa`: embutir o histórico poria `diferenca` dentro do corpo do
 * dia ABERTO, que é exatamente a chave que a regra 6 manda não existir ali. A
 * separação não é organização — é o que mantém a resposta do dia aberto
 * impossível de construir com um número dentro.
 *
 * Por construção esta lista só contém dias FECHADOS: ela lê `caixas_do_dia`,
 * e um dia aberto não tem linha lá.
 */
export const FechamentoNaLista = z.object({
  dia: DiaCivil,
  fechadoPor: z.string(),
  fechadoEm: z.string(),
  obs: z.string(),
  /** Derivado; é o que a equipe sem `valores` lê. Ver `CaixaFechado.conferido`. */
  conferido: z.boolean(),
  diferenca: centavosNaSaida,
  /**
   * O selo "alterado depois do fechamento". SÓ o booleano: a diferença por
   * forma é da leitura do dia (`GET /v1/caixa?dia=`), e a lista continua com
   * um campo monetário só.
   */
  mudouDepoisDoFechamento: z.boolean(),
})
export type FechamentoNaLista = z.infer<typeof FechamentoNaLista>

export const ListaDeFechamentos = z.object({ itens: z.array(FechamentoNaLista) }).strict()
export type ListaDeFechamentos = z.infer<typeof ListaDeFechamentos>

/** O filtro de `GET /v1/caixa`. Sem `dia`, é o de HOJE — o do servidor. */
export const ConsultaDeCaixa = z.object({ dia: DiaCivil.optional() }).strict()
export type ConsultaDeCaixa = z.infer<typeof ConsultaDeCaixa>

// ---------------------------------------------------------------------------
// SALDO E COBRANÇAS
// ---------------------------------------------------------------------------

export const GrupoDeSaldo = z.object({
  /** `null` = o grupo geral, fora de programa. */
  programaId: Uuid.nullable(),
  programa: z.string().nullable(),
  /** O grupo deve algo? Derivado, não monetário: sobrevive à redação sem `valores`. */
  devendo: z.boolean(),
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

/**
 * A linha da tela Cobranças.
 *
 * `temSaldo` e `diasSemContato` são DERIVADOS e não monetários — e é por eles
 * que a lista continua utilizável para quem não tem `valores`. Sem eles, a
 * recepcionista receberia uma lista de nomes com `saldo: null` e nenhum jeito
 * de saber por quem começar, que é precisamente o trabalho que esta tela é.
 *
 * `diasSemContato` vem do SERVIDOR, contra o hoje do servidor no fuso da
 * clínica (regra 24): calculado no navegador, o computador de balcão com a
 * data errada reordenaria a fila de ligação.
 */
export const CobrancaNaLista = z.object({
  pacienteId: Uuid,
  paciente: z.string(),
  telefone: z.string(),
  saldo: centavosNaSaida,
  temSaldo: z.boolean(),
  ultimoContatoEm: DiaCivil.nullable(),
  ultimoContatoPor: z.string().nullable(),
  canal: z.enum(CANAIS_DE_COBRANCA).nullable(),
  /** `null` = nunca houve contato. Zero = houve hoje. */
  diasSemContato: z.number().int().nullable(),
})
export type CobrancaNaLista = z.infer<typeof CobrancaNaLista>

export const ListaDeCobrancas = z
  .object({
    /** Já ORDENADA pelo servidor: quem está há mais tempo sem contato primeiro. */
    itens: z.array(CobrancaNaLista),
    aReceber: centavosNaSaida,
    /** Quantos pacientes — sobrevive à redação, e é o indicador da equipe. */
    quantidade: z.number().int(),
    /** Quantos estão sem contato há 15 dias ou mais, contados no servidor. */
    semContato: z.number().int(),
  })
  .strict()
export type ListaDeCobrancas = z.infer<typeof ListaDeCobrancas>

/**
 * A mensagem pronta, montada no SERVIDOR — e **sem valor nenhum no texto**.
 *
 * Regra 21: valor e nome de paciente não vão para log. O texto sai daqui
 * direto para o `wa.me`, e nunca passa por lugar nenhum além da resposta. E a
 * mensagem não leva o número de propósito: cobrança por mensagem com o valor
 * escrito vira print, e o print circula.
 */
export const MensagemDeCobranca = z.object({ texto: z.string() }).strict()
export type MensagemDeCobranca = z.infer<typeof MensagemDeCobranca>

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

/** Com que régua a meta do mês é medida (spec integracao-medx C.10). */
export const MedidaDaMeta = z.enum(MEDIDAS_DA_META)
export type MedidaDaMeta = z.infer<typeof MedidaDaMeta>

export const PercentualDaMeta = z
  .object({
    mes: Mes,
    meta: centavosNaSaida,
    /** SEMPRE o recebido da FIR, qualquer que seja a régua (N-B6.4). */
    recebido: centavosNaSaida,
    medidaPor: MedidaDaMeta,
    /** O que a meta mede: o recebido da FIR ou o faturamento do MedX. */
    medido: centavosNaSaida,
    /** Medida pelo MedX: quando ele foi lido pela última vez para o mês. Atravessa sem `valores`. */
    lidoEm: z.string().datetime().nullable(),
    /** Não é monetário, e por isso atravessa para quem não tem `valores`. */
    percentual: z.number().int().nullable(),
    /**
     * O recebido dos dias que ainda NÃO contam para a meta (I-9, ADR
     * 2026-11-17-meta-medida-pelos-dias-de-caixa): hoje sem caixa e, a partir
     * de `conferencia_desde`, todo dia sem caixa. UM total, nunca por dia nem
     * por forma (números c.10). Está em `CAMPOS_MONETARIOS`: a equipe recebe
     * `null` (c.11d). Opcional só para a tela antiga continuar compilando.
     */
    aguardandoFechamento: centavosNaSaida.optional(),
    /** Quantos dias estão aguardando fechamento. Não é dinheiro: atravessa. */
    diasAguardandoFechamento: z.number().int().optional(),
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
    /**
     * A linha "Outras entradas" (fatia 4.2): dinheiro que NÃO é de paciente.
     * Fora de `recebido`, de meta e de `porForma`; dentro de `resultadoDoMes`
     * (recebido + outras − despesas pagas). Sem `valores`, a redação a apaga.
     */
    outrasEntradas: centavosNaSaida,
    quantidadeDeOutrasEntradas: z.number().int(),
    /**
     * Recebido por forma — **só dos dias com o caixa já fechado** (regra 6).
     *
     * O mês corrente contém o dia de hoje, e um agregado por forma de
     * pagamento de um dia aberto **é o esperado com outra etiqueta**: quem vai
     * contar a gaveta abriria a Visão do mês e leria quanto o sistema espera
     * em Pix. Num mês fechado estas linhas somam `recebido`; num mês em curso
     * elas somam menos, e `porFormaAteODia` e `porFormaDiasSemCaixa` dizem
     * exatamente de onde o recorte vem — a tela mostra a frase, em vez de um
     * número que não fecha e ninguém explica.
     */
    porForma: z.array(LinhaDeForma),
    porFormaAteODia: DiaCivil.nullable(),
    porFormaDiasSemCaixa: z.number().int(),
    /**
     * As despesas pagas do mês por forma USADA (ADR 0020). Segunda partição
     * das mesmas contas de `porCategoria`: soma `despesasPagas`, exatamente.
     * Mês inteiro — não é caixa, e a regra 6 não se aplica. Array, nunca mapa.
     */
    pagoPorForma: z.array(LinhaDeForma),

    mesAnterior: z.object({ recebido: centavosNaSaida, despesasPagas: centavosNaSaida }),

    despesasPagas: centavosNaSaida,
    quantidadeDePagas: z.number().int(),
    porCategoria: z.array(LinhaDeCategoria),
    fixas: centavosNaSaida,
    variaveis: centavosNaSaida,
    percentualFixas: z.number().int().nullable(),
    percentualVariaveis: z.number().int().nullable(),

    // `resultadoDoMes`, e não `resultado`: `TarefaNaLista.resultado` já existe
    // e é texto, e a redação apaga por NOME em qualquer profundidade.
    resultadoDoMes: centavosNaSaida,
    percentualDoResultado: z.number().int().nullable(),

    aPagar: centavosNaSaida,
    quantidadeAPagar: z.number().int(),
    quantidadeVencidas: z.number().int(),
    aReceber: centavosNaSaida,

    meta: centavosNaSaida,
    /** Com que régua a meta é medida (gravada com a meta, N-B6). Atravessa sem `valores`. */
    medidaDaMeta: MedidaDaMeta,
    /** O valor medido: o recebido da FIR ou o faturamento do MedX. `recebido` é sempre o da FIR. */
    medido: centavosNaSaida,
    metaRestante: centavosNaSaida,
    percentualDaMeta: z.number().int().nullable(),
    /** Ver `PercentualDaMeta.aguardandoFechamento`. */
    aguardandoFechamento: centavosNaSaida.optional(),
    diasAguardandoFechamento: z.number().int().optional(),
    /**
     * O destino do link "Ver em Indicadores" (T7): o KPI `faturamento_conferido`
     * vivo e sem parâmetros, que guarda a meta do mês (I-26). `null` antes da
     * primeira meta. Não é dinheiro; a tela só mostra o link a quem tem
     * `indicadores`. Opcional só para a tela antiga continuar compilando.
     */
    kpiDaMetaId: Uuid.nullable().optional(),

    caixa: z.object({
      fechados: z.number().int(),
      diasUteis: z.number().int(),
      /** Caixas com ALGUMA forma diferente (I-15; ADR 2026-11-17-correcao-de-caixas-do-mes). */
      comDiferenca: z.number().int(),
      diferenca: centavosNaSaida,
      /**
       * O denominador corrigido de "caixas sem diferença": úteis até ontem +
       * hoje se fechado + não úteis com caixa. `fechados` ÷ isto nunca passa
       * de 100%; `diasUteis` continua sendo o "N dias úteis passados" da meta.
       */
      diasDaConferencia: z.number().int().optional(),
    }),
  })
  .strict()
export type VisaoDoMes = z.infer<typeof VisaoDoMes>

/** Sem `mes`, é o mês CORRENTE — o do servidor, no fuso da clínica. */
export const ConsultaDaVisao = z.object({ mes: Mes.optional() }).strict()
export type ConsultaDaVisao = z.infer<typeof ConsultaDaVisao>

/**
 * A rotina mensal de fechamento: 12 tarefas, uma por mês, a partir do dia 1º
 * do mês que vem.
 *
 * `criadas` é quantas NASCERAM nesta chamada — zero no segundo toque. A
 * idempotência é do índice `tarefa_de_rotina (clinica_id, marcador, prazo)`,
 * não de um `if` que lê antes de escrever: com o prazo na chave, criar a
 * rotina duas vezes gera o MESMO conjunto de (marcador, prazo) e o segundo
 * `INSERT … ON CONFLICT DO NOTHING` não escreve nada.
 */
export const RotinaDeFechamento = z
  .object({ criadas: z.number().int(), deInicio: DiaCivil })
  .strict()
export type RotinaDeFechamento = z.infer<typeof RotinaDeFechamento>
