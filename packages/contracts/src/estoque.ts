import { TIPOS_DE_MOVIMENTO } from '@fir/domain'
import { z } from 'zod'
import { centavosNaSaida, DiaCivil, dinheiroEmTexto, quantidadeEmTexto, Uuid } from './comum'

/**
 * O ESTOQUE — o contrato das quatro primeiras ações do épico 6.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A REGRA QUE GOVERNA ESTE ARQUIVO: **quantidade NUNCA atravessa sem unidade.**
 *
 * O protótipo manda `qtd: 2.5` e descobre a unidade lendo o item. Aqui toda
 * quantidade viaja como `{ quantidade, unidade }`, em MILÉSIMOS INTEIROS
 * (regra 8), e o servidor a converte para `medida` pelos fatores do CADASTRO
 * (regra 9). Unidade que o item não declarou é **recusada** (regra 10) — nunca
 * convertida em silêncio, porque o silêncio aqui é a dose mil vezes maior.
 *
 * `Math.round(x * 1000) / 1000` não existe em nenhum lado desta fronteira.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Milésimos inteiros e POSITIVOS. Não existe movimento de quantidade zero. */
const quantidadePositiva = quantidadeEmTexto.refine((v): v is bigint => v !== null && v > 0n, {
  message: 'informe a quantidade em milésimos inteiros, maior que zero',
})

/** Milésimos inteiros, zero inclusive — a contagem que achou a prateleira vazia. */
const quantidadeNaoNegativa = quantidadeEmTexto.refine((v): v is bigint => v !== null && v >= 0n, {
  message: 'informe a quantidade em milésimos inteiros, zero ou mais',
})

const unidade = z.string().trim().min(1, 'informe a unidade').max(20)

/**
 * Quantidade **com a unidade**, e as duas são obrigatórias juntas.
 *
 * É a forma de `CONTEXT.md`: *quantidade sem unidade é a origem da dose
 * errada*. Um `z.object` com `unidade` opcional reabriria exatamente isso.
 */
export const QuantidadeComUnidade = z
  .object({ quantidade: quantidadePositiva, unidade })
  .strict()
export type QuantidadeComUnidade = z.infer<typeof QuantidadeComUnidade>

/** Quantidade de saída: milésimos em texto, mais a unidade em que ela está. */
export const QuantidadeNaSaida = z.object({
  /** Milésimos, em texto — o front não soma quantidade (regra 8). */
  milesimos: z.string().regex(/^-?\d+$/),
  unidade: z.string(),
  /** Já formatada pelo domínio: "0,5 ampola". A tela não formata número. */
  texto: z.string(),
})
export type QuantidadeNaSaida = z.infer<typeof QuantidadeNaSaida>

/* ======================================================================
 * LOCAIS — `salvarLocalEstoque`
 * ====================================================================== */

/**
 * O local onde o item fica na clínica: sala de estoque, geladeira, sala da
 * doutora. A lista de contagem sai agrupada por ele, como um roteiro.
 *
 * `unidadeId` nulo = a clínica tem um endereço só. O nome é único **por
 * unidade** (índice `locais_nome_unico`, com `NULLS NOT DISTINCT`): "Geladeira"
 * pode existir em duas unidades e não duas vezes na mesma.
 */
export const SalvarLocalEstoque = z
  .object({
    nome: z.string().trim().min(1, 'Dê um nome ao local.').max(40),
    unidadeId: Uuid.nullish(),
    ativo: z.boolean().default(true),
  })
  .strict()
export type SalvarLocalEstoque = z.infer<typeof SalvarLocalEstoque>

export const EditarLocalEstoque = SalvarLocalEstoque.partial()
export type EditarLocalEstoque = z.infer<typeof EditarLocalEstoque>

export const LocalNaLista = z.object({
  id: Uuid,
  nome: z.string(),
  unidadeId: Uuid.nullable(),
  ativo: z.boolean(),
  /** Quantos itens vivos moram neste local — a tela dela mostra isso. */
  itens: z.number().int(),
})
export type LocalNaLista = z.infer<typeof LocalNaLista>

export const ListaDeLocais = z.object({ locais: z.array(LocalNaLista) })
export type ListaDeLocais = z.infer<typeof ListaDeLocais>

/* ======================================================================
 * ITENS — `salvarItemEstoque`
 * ====================================================================== */

/**
 * AS TRÊS UNIDADES, e cada conversão viaja **inteira ou não viaja**.
 *
 * A união discriminada por `tem` torna o par meio preenchido impossível de
 * escrever. O protótipo aceita `unidCompra: 'caixa'` sem `fatorCompra`, grava,
 * e depois descarta na leitura (`compraItem = … f > 0 ? … : null`): a clínica
 * cadastra "caixa", não vê erro nenhum, e a entrada em caixas simplesmente não
 * aparece como opção. A migration diz a mesma coisa com um `CHECK`
 * (`compra_declarada_por_inteiro`), e o contrato a diz antes.
 *
 * `fator` em MILÉSIMOS: "1 caixa = 4 ampolas" é `4000`, e "1 ampola = 5 mg" é
 * `5000`. A mesma escala de toda quantidade do sistema — um fator em unidades
 * inteiras aqui e milésimos ali seria a conversão com duas escalas.
 */
const Conversao = z.discriminatedUnion('tem', [
  z.object({ tem: z.literal(false) }).strict(),
  z
    .object({
      tem: z.literal(true),
      unidade,
      fator: quantidadePositiva,
    })
    .strict(),
])

export const SalvarItemEstoque = z
  .object({
    nome: z.string().trim().min(1, 'Dê um nome ao item.').max(80),
    codigo: z.string().trim().max(40).default(''),
    categoria: z.string().trim().max(40).default(''),

    /** A unidade de ESTOQUE: como a equipe conta na prateleira. */
    medida: z.string().trim().min(1, 'Informe a unidade de estoque.').max(20).default('un.'),
    /** Como vem na nota. `1 compra.unidade = compra.fator × medida`. */
    compra: Conversao.default({ tem: false }),
    /** A unidade da dose. `1 medida = uso.fator × uso.unidade`. */
    uso: Conversao.default({ tem: false }),

    /**
     * `false` = a sobra do frasco aberto não serve para o próximo paciente, e
     * a baixa gera **dois** movimentos (regra 15).
     *
     * Padrão `true` de propósito: descartável é o caso comum, e um padrão que
     * gera descarte sozinho seria perda inventada no relatório da clínica.
     */
    aproveitaSobra: z.boolean().default(true),
    controlaValidade: z.boolean().default(false),
    altaRotatividade: z.boolean().default(false),
    /** `''` = a curva ABC decide. `'sim'`/`'nao'` = a clínica forçou. */
    altoValor: z.enum(['', 'sim', 'nao']).default(''),

    /** Em milésimos de `medida`. `null` = sem mínimo, que não é "mínimo zero". */
    minimo: quantidadeEmTexto.nullish(),
    /** CENTAVOS por `medida` (regra 1). Exige `estoque.gerir`. */
    custo: dinheiroEmTexto.nullish(),

    localId: Uuid.nullish(),
    unidadeId: Uuid.nullish(),
    responsavelId: Uuid.nullish(),

    ativo: z.boolean().default(true),

    /**
     * A CONTAGEM INICIAL — "a quantidade de hoje é o ponto de partida"
     * (MANUAL cap. 12).
     *
     * Ela é um **movimento de contagem**, não um campo de saldo: saldo é
     * derivado (regra 11). Só vale na CRIAÇÃO e só se o item ainda não tem
     * movimento nenhum — é o que o protótipo faz
     * (`!E.movs.some(m => m.itemId === it.id)`), e é o que impede o cadastro
     * reeditado de reiniciar a história do estoque sem ninguém ter contado.
     *
     * `quantidade` aqui é na `medida`, porque é a prateleira que se conta.
     */
    inicial: z
      .object({
        quantidade: quantidadeNaoNegativa,
        /** A validade do lote contado, se o item controla validade. */
        lote: DiaCivil.nullish(),
      })
      .strict()
      .nullish(),
  })
  .strict()
export type SalvarItemEstoque = z.infer<typeof SalvarItemEstoque>

/**
 * A edição é PARCIAL — a mesma razão do `EditarProcedimento`: com o esquema de
 * criação, um `PATCH { ativo: false }` reescreveria `medida` para `'un.'` e
 * apagaria as duas conversões, sem erro nenhum, e a clínica descobriria na
 * próxima dose.
 *
 * `inicial` sai do esquema de edição: a contagem inicial é da CRIAÇÃO. Depois
 * dela, contar é `criarContagem`/`salvarContagem` (próxima fatia) ou um
 * movimento de `contagem` por `movEstoque`.
 */
export const EditarItemEstoque = SalvarItemEstoque.omit({ inicial: true }).partial()
export type EditarItemEstoque = z.infer<typeof EditarItemEstoque>

export const ConversaoNaSaida = z.object({ unidade: z.string(), fator: z.string() }).nullable()

export const ItemNaLista = z.object({
  id: Uuid,
  nome: z.string(),
  codigo: z.string(),
  categoria: z.string(),
  medida: z.string(),
  compra: ConversaoNaSaida,
  uso: ConversaoNaSaida,
  aproveitaSobra: z.boolean(),
  controlaValidade: z.boolean(),
  altaRotatividade: z.boolean(),
  altoValor: z.enum(['', 'sim', 'nao']),
  minimo: z.string().regex(/^-?\d+$/).nullable(),
  /** Redigido pelo nome `custo` para quem não tem `valores`. */
  custo: centavosNaSaida,
  localId: Uuid.nullable(),
  /** O NOME do local, para a lista mostrar "Geladeira" sem uma segunda busca. */
  local: z.string().nullable(),
  unidadeId: Uuid.nullable(),
  responsavelId: Uuid.nullable(),
  ativo: z.boolean(),

  /**
   * **DERIVADO** dos movimentos (regra 11), em `medida`. Nunca uma coluna.
   *
   * O nome é `saldoEmEstoque` e **não `saldo`**, e isso não é verbosidade:
   * `saldo` está em `CAMPOS_MONETARIOS` por causa do saldo em aberto da
   * paciente, e o `RedacaoInterceptor` casa **nome de chave** sem olhar o tipo
   * do valor. Chamado `saldo`, este campo era apagado para quem não tem
   * `valores` — e a tela do estoque da enfermagem mostrava o catálogo inteiro
   * **sem número nenhum**. Medido em `estoque.e2e.test.ts`.
   *
   * A redação casa nome EXATO e não prefixo (está escrito assim de propósito),
   * então `saldoEmEstoque` atravessa. É o mesmo conserto que
   * `resultado` → `resultadoDoMes` já registrou: nome genérico em dinheiro é
   * nome que colide.
   */
  saldoEmEstoque: QuantidadeNaSaida,
  /** O mesmo saldo na unidade de uso — "0,5 ampola · 2,5 mg". `null` sem `uso`. */
  saldoEmUso: QuantidadeNaSaida.nullable(),
  /**
   * Nunca houve contagem neste item.
   *
   * É o aviso "itens sem contagem inicial" do MANUAL. Sem ele, um item
   * recém-importado mostraria saldo zero como se alguém tivesse ido à
   * prateleira e encontrado zero.
   */
  semContagem: z.boolean(),
  /** `true` quando há mínimo e o saldo está abaixo dele. */
  abaixoDoMinimo: z.boolean(),
  /** O lote que vence primeiro com saldo — FIFO (regra 15). */
  loteSugerido: DiaCivil.nullable(),
  /** Todos os lotes com saldo, em ordem de validade. A ficha do item os mostra. */
  lotes: z.array(z.object({ lote: DiaCivil, quantidade: QuantidadeNaSaida })),

  /**
   * O código de barras da caixa do medicamento, **em 14 dígitos**, ou vazio.
   *
   * A forma canônica é gravada pelo servidor: EAN-13 e GTIN-14 do mesmo
   * produto são o mesmo código, e guardá-los sem normalizar faria a leitura do
   * DataMatrix não achar o item cadastrado pelo EAN.
   */
  gtin: z.string(),
  /**
   * O conteúdo da ETIQUETA QR deste item, montado pelo SERVIDOR.
   *
   * `FRMEST:<código da clínica>:<id>`. O formato mora num lugar só: com a
   * etiqueta montada no navegador, imprimir no desktop e ler no celular
   * dependeria de duas implementações concordarem — e a que não concordasse
   * imprimiria etiqueta que a câmera não reconhece, numa folha já colada na
   * geladeira.
   */
  codigoQr: z.string(),

  /**
   * A CURVA ABC: `A` até 80% do valor em estoque, `B` até 95%, `C` o resto.
   *
   * Calculada no SERVIDOR porque depende do CUSTO de todos os itens, e custo é
   * redigido sem `valores` (regra 17) — no navegador, a curva da enfermagem
   * seria calculada sobre uma lista de `null`.
   *
   * A letra não é dinheiro: é um ranking relativo, e é ela que faz o filtro
   * "Só alto valor" funcionar para quem conta a prateleira sem ver preço.
   */
  curvaAbc: z.enum(['A', 'B', 'C']),
  /** `altoValor` do cadastro manda; vazio, decide a curva. */
  ehAltoValor: z.boolean(),
})
export type ItemNaLista = z.infer<typeof ItemNaLista>

export const ListaDeItens = z.object({ itens: z.array(ItemNaLista) })
export type ListaDeItens = z.infer<typeof ListaDeItens>

/* ======================================================================
 * IMPORTAÇÃO — `importarItensEstoque`
 * ====================================================================== */

/**
 * A lista exportada do sistema principal da clínica, **sem quantidades**
 * (MANUAL cap. 12: *"traga a lista de itens exportada do sistema principal,
 * sem quantidades"*).
 *
 * **IDEMPOTENTE (regra 26), e a chave sai do POSTGRES.** A deduplicação é pelo
 * `codigo` normalizado e, na falta dele, pelo `nome` normalizado — os dois
 * índices únicos parciais da `0015`, não uma cópia da regra em TypeScript.
 * Reimportar o mesmo arquivo três vezes não cria nada novo, e é assim que se
 * testa.
 *
 * `linhas` e não `itens`: o que chega é linha de planilha, e parte dela pode
 * não virar item (nome vazio). Chamar de `itens` prometeria uma correspondência
 * de um para um que a importação não tem.
 *
 * O nome do tipo carrega `DeItens` porque `pacientes.ts` já exporta
 * `LinhaDeImportacao` e `ResultadoDaImportacao` — e o `export *` do índice
 * resolve colisão com erro, de propósito: duas formas diferentes com o mesmo
 * nome é como a tela manda o corpo de uma importação para a outra.
 */
export const LinhaDeItemImportado = z
  .object({
    nome: z.string().trim().max(80),
    codigo: z.string().trim().max(40).default(''),
    categoria: z.string().trim().max(40).default(''),
    medida: z.string().trim().max(20).default(''),
    /** Nome do local; o servidor o cria se ainda não existir. */
    local: z.string().trim().max(40).default(''),
    minimo: quantidadeEmTexto.nullish(),
    custo: dinheiroEmTexto.nullish(),
    /**
     * As duas colunas de sim/não da planilha modelo, e elas valem **só na
     * criação**.
     *
     * Medido no protótipo (`case "importarItensEstoque"`): a lista de `comp()`
     * — o que a reimportação completa — tem `codigo`, `categoria`, `localId`,
     * `custo` e `minimo`, e **não tem estas duas**. Um item que já existe
     * atravessa a importação com o sim/não que a clínica escolheu na tela,
     * qualquer que seja o da planilha. Completar um booleano seria impossível
     * de fazer direito: `false` não é "vazio", é uma resposta.
     *
     * `controlaValidade` ausente vale **`true`**, não `false` — é a linha
     * `x.controlaValidade===undefined ? true : !!x.controlaValidade` do
     * protótipo. Medicamento sem validade controlada é o padrão errado numa
     * clínica.
     */
    altaRotatividade: z.boolean().default(false),
    controlaValidade: z.boolean().default(true),
  })
  .strict()
export type LinhaDeItemImportado = z.infer<typeof LinhaDeItemImportado>

export const ImportarItensEstoque = z
  .object({
    // 2.000 é o limite do protótipo, e ele é generoso: o cadastro de uma
    // clínica cabe em algumas centenas.
    linhas: z.array(LinhaDeItemImportado).min(1, 'Envie ao menos uma linha.').max(2000),
    /** A unidade de atendimento a que os itens novos pertencem. */
    unidadeId: Uuid.nullish(),
    responsavelId: Uuid.nullish(),
  })
  .strict()
export type ImportarItensEstoque = z.infer<typeof ImportarItensEstoque>

export const ResultadoDaImportacaoDeItens = z.object({
  novos: z.number().int(),
  /**
   * Itens que já existiam e ganharam um campo que estava VAZIO.
   *
   * A importação **completa, nunca sobrescreve** — é a regra 27 aplicada aqui:
   * nada do que a clínica digitou é apagado por um arquivo. Um `codigo` que já
   * estava preenchido permanece; um vazio é completado.
   */
  completados: z.number().int(),
  /** Linhas ignoradas por não ter nome. */
  ignoradas: z.number().int(),
  locaisCriados: z.number().int(),
  /** Itens sem contagem inicial depois da importação — o aviso do MANUAL. */
  semContagem: z.number().int(),
})
export type ResultadoDaImportacaoDeItens = z.infer<typeof ResultadoDaImportacaoDeItens>

/* ======================================================================
 * MOVIMENTOS — `movEstoque`
 * ====================================================================== */

export const TiposDeMovimento = z.enum(TIPOS_DE_MOVIMENTO)

/**
 * Registrar um movimento à mão: entrada, saída ou ajuste.
 *
 * **UNIÃO DISCRIMINADA POR TIPO**, e isso é a regra toda desta rota. No
 * protótipo, `movEstoque` recebe um objeto solto e valida com uma pilha de
 * `if`: `pacienteId` só é exigido em `consumo`, `motivo` em `ajuste` e
 * `interno`, `custo` só vale em `entrada`, `sinal` só em `ajuste`. Cada um
 * desses `if` é um campo que atravessa quando não devia — um `custo` num
 * consumo, por exemplo, é descartado em silêncio.
 *
 * Com a união, o corpo errado **não tem como ser escrito**, e cada ramo é
 * `.strict()`: campo de outro ramo é 400.
 *
 * A quantidade é sempre `{ quantidade, unidade }` e sempre POSITIVA. O SINAL
 * vem do tipo (`sinalDoTipo`), exceto no ajuste, onde `sentido` o diz — porque
 * ajuste é o único movimento dos dois sentidos.
 */
const comumDoMovimento = {
  itemId: Uuid,
  /** Dia civil no fuso da clínica. O servidor recusa data futura. */
  dia: DiaCivil,
  obs: z.string().trim().max(120).default(''),
}

export const RegistrarMovimento = z.discriminatedUnion('tipo', [
  z
    .object({
      ...comumDoMovimento,
      tipo: z.literal('entrada'),
      ...QuantidadeComUnidade.shape,
      /** A validade do que chegou. Obrigatória quando o item controla. */
      lote: DiaCivil.nullish(),
      /** CENTAVOS por `medida`. Exige `estoque.gerir`. */
      custo: dinheiroEmTexto.nullish(),
    })
    .strict(),
  z
    .object({
      ...comumDoMovimento,
      tipo: z.literal('consumo'),
      ...QuantidadeComUnidade.shape,
      lote: DiaCivil.nullish(),
      /**
       * **Obrigatório.** "Uso interno ou cortesia" é o tipo `interno`, que
       * existe justamente para a saída sem paciente — então um `consumo` sem
       * paciente é lançamento no tipo errado, não um caso de uso.
       */
      pacienteId: Uuid,
      procedimentoId: Uuid.nullish(),
      aplicadoPorId: Uuid.nullish(),
    })
    .strict(),
  z
    .object({
      ...comumDoMovimento,
      tipo: z.literal('descarte'),
      ...QuantidadeComUnidade.shape,
      lote: DiaCivil.nullish(),
      /** Vencido · Avaria ou quebra · Sobra de frasco aberto · Outro. */
      motivo: z.string().trim().min(1, 'Informe o motivo do descarte.').max(40),
    })
    .strict(),
  z
    .object({
      ...comumDoMovimento,
      tipo: z.literal('interno'),
      ...QuantidadeComUnidade.shape,
      lote: DiaCivil.nullish(),
      /** Obrigatório: amostra, teste, cortesia — o MANUAL exige o motivo. */
      motivo: z.string().trim().min(1, 'Informe o motivo.').max(40),
    })
    .strict(),
  z
    .object({
      ...comumDoMovimento,
      tipo: z.literal('ajuste'),
      ...QuantidadeComUnidade.shape,
      lote: DiaCivil.nullish(),
      /**
       * O SENTIDO, obrigatório e explícito.
       *
       * O protótipo usa `sinal: 1 | -1` com `Number(m.sinal)===1 ? 1 : -1`, de
       * modo que **qualquer coisa que não seja 1 vira −1** — um corpo sem
       * `sinal` tira do estoque em silêncio. Aqui são duas palavras, e não
       * mandar nenhuma é 400.
       */
      sentido: z.enum(['faltou', 'sobrou']),
      /** Obrigatório (regra 13): ajuste sem motivo destrói a análise. */
      motivo: z.string().trim().min(1, 'Informe o motivo do ajuste.').max(40),
    })
    .strict(),
  z
    .object({
      ...comumDoMovimento,
      tipo: z.literal('contagem'),
      /** A contagem pode ser ZERO: a prateleira estava vazia. */
      quantidade: quantidadeNaoNegativa,
      unidade,
      lote: DiaCivil.nullish(),
    })
    .strict(),
])
export type RegistrarMovimento = z.infer<typeof RegistrarMovimento>

export const MovimentoNaLista = z.object({
  id: Uuid,
  itemId: Uuid,
  itemNome: z.string(),
  tipo: TiposDeMovimento,
  /** Assinado, em `medida`. A tela mostra `texto`, que o domínio formatou. */
  quantidade: QuantidadeNaSaida,
  dia: DiaCivil,
  em: z.string(),
  lote: DiaCivil.nullable(),
  custo: centavosNaSaida,
  motivo: z.string(),
  obs: z.string(),
  pacienteId: Uuid.nullable(),
  /** `true` quando esta linha é a compensação de outra (regra 12). */
  compensa: z.boolean(),
  /** `true` quando esta linha JÁ FOI compensada — ela não vale mais. */
  compensada: z.boolean(),
})
export type MovimentoNaLista = z.infer<typeof MovimentoNaLista>

export const ListaDeMovimentos = z.object({ movimentos: z.array(MovimentoNaLista) })
export type ListaDeMovimentos = z.infer<typeof ListaDeMovimentos>

/* ======================================================================
 * CONTAGEM — `criarContagem` e `salvarContagem`
 *
 * ────────────────────────────────────────────────────────────────────────
 * A REGRA 14, E ELA É DE TRANSPORTE
 *
 * A contagem é **ÀS CEGAS**: a quantidade esperada **não atravessa para o
 * cliente antes do fechamento**. Como no caixa (regra 6), isso não é uma
 * propriedade da tela — é uma propriedade do CONTRATO: enquanto a contagem
 * está aberta o servidor devolve `ContagemAberta`, que **não tem** os campos
 * `esperadoEmEstoque`, `diferencaEmEstoque` nem `anteriorEmEstoque`. Eles não
 * são `null`, não são redigidos: não existem, e por isso não há como montar a
 * resposta com o número dentro.
 *
 * `/v1/estoque/contagens` e `/v1/estoque/contagens/:id` entram em
 * `ROTAS_DE_CONFERENCIA`, e a varredura de `transporte-as-cegas.test.ts` cobra
 * as duas coisas: que a CHAVE não existe e que o NÚMERO não aparece sob nome
 * nenhum.
 *
 * ────────────────────────────────────────────────────────────────────────
 * POR QUE OS NOMES TERMINAM EM `EmEstoque`
 *
 * `esperado`, `contado` e `diferenca` estão em `CAMPOS_MONETARIOS` — por causa
 * do CAIXA, onde os três são dinheiro. O `RedacaoInterceptor` casa **nome de
 * chave** e não olha o tipo do valor: chamados assim, estes números seriam
 * apagados para quem não tem `valores`, e a contagem da enfermagem sairia sem
 * número nenhum. É exatamente o defeito que `saldo` → `saldoEmEstoque` já
 * registrou neste arquivo, e a mesma correção.
 * ====================================================================== */

/**
 * COMO a lista é montada — e **o servidor é quem resolve o filtro em itens**.
 *
 * O protótipo manda a lista de ids pronta, calculada no navegador. Aqui não:
 * `altoValor` depende da **curva ABC**, que depende do CUSTO de cada item — e
 * custo é redigido para quem não tem `valores` (regra 17). Resolvido no
 * cliente, o filtro "alto valor" da enfermagem devolveria o catálogo inteiro,
 * porque todos os custos chegariam `null` e a curva não existiria.
 */
export const FILTROS_DE_CONTAGEM = [
  'todos',
  'rotatividade',
  'altoValor',
  'categoria',
  /** Os itens que nunca foram contados — o botão "Gerar contagem inicial". */
  'semContagem',
] as const
export type FiltroDeContagem = (typeof FILTROS_DE_CONTAGEM)[number]

export const REPETICOES_DE_CONTAGEM = ['', 'quinzenal', 'mensal'] as const

export const CriarContagem = z
  .object({
    filtro: z.enum(FILTROS_DE_CONTAGEM).default('todos'),
    /** Obrigatória quando o filtro é `categoria`, e proibida nos outros. */
    categoria: z.string().trim().max(40).default(''),
    localId: Uuid.nullish(),
    unidadeId: Uuid.nullish(),
    /** Quem vai contar. A lista vira uma TAREFA para esta pessoa. */
    responsavelId: Uuid,
    /** "Contar até" — dia civil no fuso da clínica. */
    prazo: DiaCivil,
    /** Com repetição, concluir uma contagem já cria a próxima. */
    repetir: z.enum(REPETICOES_DE_CONTAGEM).default(''),
    /** Vazio = o servidor monta o nome a partir do filtro, do local e da unidade. */
    nome: z.string().trim().max(100).default(''),
  })
  .strict()
export type CriarContagem = z.infer<typeof CriarContagem>

/**
 * O que foi contado num item: **uma linha por LOTE**.
 *
 * Sempre um array, mesmo no item que não controla validade — ele manda UMA
 * linha com `lote: null`. Um campo `quantidade` solto ao lado do array seria a
 * segunda representação do mesmo número, e a soma dos lotes passaria a
 * depender de qual dos dois cada tela preencheu.
 */
export const ContadoPorLote = z
  .object({
    /** A validade do lote. `null` no item sem validade, ou quando contou zero. */
    lote: DiaCivil.nullish(),
    /** Milésimos de `medida`. Pode ser ZERO: a prateleira estava vazia. */
    quantidade: quantidadeNaoNegativa,
  })
  .strict()
export type ContadoPorLote = z.infer<typeof ContadoPorLote>

export const SalvarContagem = z
  .object({
    /**
     * **`PUT` é substituição do rascunho DESTE item**, e `lotes: []` o APAGA.
     *
     * Três estados, e eles são diferentes:
     *
     *  - item **ausente** do corpo → o rascunho dele fica como estava. É o que
     *    permite salvar um local por vez sem reenviar a lista inteira.
     *  - `lotes: []` → **apaga** o rascunho: a pessoa tinha anotado e limpou.
     *    Sem este estado, limpar o campo e tocar em Concluir usaria o número
     *    velho — ela erraria, corrigiria para vazio, e a contagem fecharia com
     *    o erro. Medido no desenho: a tela só mandava os itens COM quantidade.
     *  - `lotes: [{ quantidade: '0' }]` → **contou zero**: a prateleira está
     *    vazia. É uma informação, e é diferente de "ainda não contei".
     *
     * A tela manda **todos** os itens da lista, e por isso o `PUT` é
     * idempotente: o mesmo corpo duas vezes deixa a contagem no mesmo estado.
     */
    itens: z
      .array(
        z.object({ itemId: Uuid, lotes: z.array(ContadoPorLote).max(60) }).strict(),
      )
      .max(2000),
    /** `false` = "Salvar e continuar depois". O rascunho não gera movimento. */
    concluir: z.boolean().default(false),
    /** Criar tarefa de reposição para quem ficar abaixo do mínimo. */
    reposicao: z.boolean().default(true),
  })
  .strict()
export type SalvarContagem = z.infer<typeof SalvarContagem>

const cabecalhoDaContagem = {
  id: Uuid,
  nome: z.string(),
  filtro: z.enum(FILTROS_DE_CONTAGEM),
  categoria: z.string(),
  localId: Uuid.nullable(),
  local: z.string().nullable(),
  unidadeId: Uuid.nullable(),
  responsavelId: Uuid,
  responsavel: z.string(),
  prazo: DiaCivil,
  repetir: z.enum(REPETICOES_DE_CONTAGEM),
  /** A tarefa que levou a lista para quem conta. */
  tarefaId: Uuid.nullable(),
  criadaEm: z.string(),
}

const itemDaLista = {
  itemId: Uuid,
  nome: z.string(),
  categoria: z.string(),
  medida: z.string(),
  controlaValidade: z.boolean(),
  localId: Uuid.nullable(),
  /** O nome do local, para a lista sair agrupada — o roteiro de quem conta. */
  local: z.string().nullable(),
}

/**
 * A contagem ABERTA — e o que ela **não** tem é o ponto inteiro.
 *
 * Sem `esperadoEmEstoque`, sem `anteriorEmEstoque`, sem `diferencaEmEstoque`,
 * e **sem os lotes conhecidos do item**: pré-preencher as validades contaria
 * à pessoa o que o sistema espera encontrar na prateleira, que é o esperado
 * por outro caminho. Quem conta lê o rótulo da caixa.
 *
 * `contadoEmEstoque` existe e não viola nada: é o RASCUNHO, o que a própria
 * pessoa digitou. Não mostrá-lo faria "Salvar e continuar depois" perder o
 * trabalho de quem parou no meio.
 */
export const ItemDaContagemAberta = z
  .object({
    ...itemDaLista,
    /** O que já foi anotado, somando os lotes. `null` = ainda não contado. */
    contadoEmEstoque: QuantidadeNaSaida.nullable(),
    /** O rascunho por lote, como a pessoa o deixou. */
    lotes: z.array(
      z.object({ lote: DiaCivil.nullable(), quantidade: QuantidadeNaSaida }),
    ),
  })
  .strict()
export type ItemDaContagemAberta = z.infer<typeof ItemDaContagemAberta>

export const ContagemAberta = z
  .object({
    ...cabecalhoDaContagem,
    concluida: z.literal(false),
    /** Calculada no SERVIDOR, contra o hoje da clínica (regra 24). */
    atrasada: z.boolean(),
    itens: z.array(ItemDaContagemAberta),
    quantidadeDeItens: z.number().int(),
    /** Quantos já têm quantidade anotada — o "3 de 12 contados" da lista. */
    anotados: z.number().int(),
  })
  .strict()
export type ContagemAberta = z.infer<typeof ContagemAberta>

/**
 * A contagem CONCLUÍDA — agora sim a comparação, que é o que a clínica veio
 * ver.
 *
 * **A diferença é RELATADA, nunca corrigida** (regra 13). Não existe nesta API
 * nenhuma rota que "acerte" o estoque pela diferença: corrigir é um `ajuste`
 * com motivo e `estoque.gerir`, e ele aparece como ajuste na análise seguinte.
 */
export const ItemDaContagemConcluida = z
  .object({
    ...itemDaLista,
    /** A contagem ANTERIOR, o ponto de partida. `null` = inventário inicial. */
    anteriorEmEstoque: QuantidadeNaSaida.nullable(),
    anteriorEm: DiaCivil.nullable(),
    entradasEmEstoque: QuantidadeNaSaida,
    /** Consumo + descarte + uso interno, em módulo. */
    saidasEmEstoque: QuantidadeNaSaida,
    /** Assinado: o ajuste é o único movimento dos dois sentidos. */
    ajustesEmEstoque: QuantidadeNaSaida,
    /** `null` na primeira contagem do item: não havia de onde esperar. */
    esperadoEmEstoque: QuantidadeNaSaida.nullable(),
    /** `null` = o item ficou sem quantidade; ele não virou movimento. */
    contadoEmEstoque: QuantidadeNaSaida.nullable(),
    diferencaEmEstoque: QuantidadeNaSaida.nullable(),
    /** `true` quando há mínimo declarado e o contado ficou abaixo dele. */
    abaixoDoMinimo: z.boolean(),
  })
  .strict()
export type ItemDaContagemConcluida = z.infer<typeof ItemDaContagemConcluida>

export const ContagemConcluida = z
  .object({
    ...cabecalhoDaContagem,
    concluida: z.literal(true),
    concluidaEm: DiaCivil,
    itens: z.array(ItemDaContagemConcluida),
    quantidadeDeItens: z.number().int(),
    anotados: z.number().int(),
    /**
     * Quantos itens ficaram ABAIXO do esperado. Não é monetário, e por isso é
     * o indicador que a equipe sem `valores` lê — a mesma ideia do `conferido`
     * do caixa.
     */
    itensComFalta: z.number().int(),
    /** O que a falta vale, ao custo cadastrado. Redigido sem `valores`. */
    valorDaFalta: centavosNaSaida,
  })
  .strict()
export type ContagemConcluida = z.infer<typeof ContagemConcluida>

export const ConferenciaDeContagem = z.discriminatedUnion('concluida', [
  ContagemAberta,
  ContagemConcluida,
])
export type ConferenciaDeContagem = z.infer<typeof ConferenciaDeContagem>

export const ContagemNaLista = z
  .object({
    id: Uuid,
    nome: z.string(),
    responsavel: z.string(),
    prazo: DiaCivil,
    repetir: z.enum(REPETICOES_DE_CONTAGEM),
    concluida: z.boolean(),
    concluidaEm: DiaCivil.nullable(),
    atrasada: z.boolean(),
    quantidadeDeItens: z.number().int(),
    anotados: z.number().int(),
  })
  .strict()
export type ContagemNaLista = z.infer<typeof ContagemNaLista>

export const ListaDeContagens = z.object({ contagens: z.array(ContagemNaLista) }).strict()
export type ListaDeContagens = z.infer<typeof ListaDeContagens>

/**
 * O resultado de criar ou salvar: a contagem, mais o que a AÇÃO produziu.
 *
 * `proximaEm` e `reposicoes` não são campos da contagem — são consequências do
 * fechamento, e guardá-los na entidade seria gravar o que já está em
 * `tarefas` e em `contagens_de_estoque`.
 */
export const ResultadoDaContagem = z
  .object({
    contagem: ConferenciaDeContagem,
    /** A próxima da rotina, quando `repetir` está ligado. */
    proximaEm: DiaCivil.nullable(),
    proximaId: Uuid.nullable(),
    /** Quantas tarefas de reposição NASCERAM — zero no segundo toque. */
    reposicoes: z.number().int(),
  })
  .strict()
export type ResultadoDaContagem = z.infer<typeof ResultadoDaContagem>

/* ======================================================================
 * ANÁLISE DO ESTOQUE — o período entre duas contagens
 * ====================================================================== */

export const ItemNaAnalise = z
  .object({
    ...itemDaLista,
    /** `null` = o item não tem duas contagens no período: nada a comparar. */
    deDia: DiaCivil.nullable(),
    ateDia: DiaCivil.nullable(),
    inicialEmEstoque: QuantidadeNaSaida.nullable(),
    entradasEmEstoque: QuantidadeNaSaida.nullable(),
    saidasEmEstoque: QuantidadeNaSaida.nullable(),
    ajustesEmEstoque: QuantidadeNaSaida.nullable(),
    esperadoEmEstoque: QuantidadeNaSaida.nullable(),
    finalEmEstoque: QuantidadeNaSaida.nullable(),
    diferencaEmEstoque: QuantidadeNaSaida.nullable(),
    /** O que a falta vale ao custo cadastrado. Redigido sem `valores`. */
    valorDaFalta: centavosNaSaida,
  })
  .strict()
export type ItemNaAnalise = z.infer<typeof ItemNaAnalise>

export const AnaliseDoEstoque = z
  .object({
    de: DiaCivil,
    ate: DiaCivil,
    itens: z.array(ItemNaAnalise),
    /** Itens abaixo do esperado no período. Sobrevive à redação. */
    itensComFalta: z.number().int(),
    valorDaFalta: centavosNaSaida,
    /** Itens sem as duas contagens — a análise não os alcança, e isso se diz. */
    itensSemContagens: z.number().int(),
  })
  .strict()
export type AnaliseDoEstoque = z.infer<typeof AnaliseDoEstoque>

/**
 * O filtro da análise. Janela **semiaberta `[de, ate)`**? Não: aqui as duas
 * bordas são CONTAGENS, e uma contagem é um ponto, não um intervalo.
 *
 * A borda é inclusiva nos dois lados de propósito — "a contagem do dia 1º" e
 * "a contagem do dia 30" são as duas que a clínica quer comparar, e excluir a
 * de cima faria a análise do mês terminar na contagem do mês anterior.
 */
export const ConsultaDaAnalise = z
  .object({ de: DiaCivil.optional(), ate: DiaCivil.optional() })
  .strict()
export type ConsultaDaAnalise = z.infer<typeof ConsultaDaAnalise>

/* ======================================================================
 * CÓDIGO DO ITEM — `ligarCodigoItem`
 * ====================================================================== */

/**
 * Liga o código de barras da caixa do medicamento (GS1/EAN) ao item.
 *
 * "Escolha o item uma vez: nas próximas leituras a ferramenta reconhece
 * sozinha" (MANUAL cap. 12).
 *
 * **8 a 14 dígitos, e o servidor normaliza para 14** com zeros à esquerda —
 * EAN-13 e GTIN-14 do mesmo produto são o mesmo código, e guardá-los sem
 * normalizar faria a leitura do DataMatrix não achar o item cadastrado pelo
 * EAN. O protótipo compara com `padStart(14, '0')` dos dois lados; aqui a
 * forma canônica é gravada uma vez, no servidor.
 */
export const LigarCodigoItem = z
  .object({
    gtin: z
      .string()
      .trim()
      .regex(/^\d{8,14}$/, 'O código precisa ter de 8 a 14 dígitos.'),
  })
  .strict()
export type LigarCodigoItem = z.infer<typeof LigarCodigoItem>

/* ======================================================================
 * ENTRADA PELA NOTA — `entradaNota`
 * ====================================================================== */

/**
 * O XML da NF-e, lido no **servidor** — o seam `LeitorDeNota`.
 *
 * O protótipo lê o XML no navegador com `DOMParser` e casa os produtos com os
 * itens lá também. Duas razões para o servidor:
 *
 *  1. **O casamento depende de dado do servidor** — os vínculos salvos de
 *     `(CNPJ, código do produto)` e o catálogo inteiro. Feito no cliente, ele
 *     seria a segunda implementação da mesma regra.
 *  2. **O custo unitário da nota é dinheiro**, e ele atravessa redigido
 *     (regra 17). Lido no navegador, chegaria inteiro a quem não tem
 *     `valores`.
 */
export const LerNotaFiscal = z
  .object({
    /**
     * O limite é **900 KB**, e ele não é arbitrário: o `bodyLimit` padrão do
     * Fastify é **1 MB**, e um limite de contrato maior que o do servidor é uma
     * promessa que o servidor quebra — a nota de 2 MB levaria 413 antes de
     * chegar ao Zod, e a mensagem que a recepção leria não diria nada sobre
     * tamanho de arquivo.
     *
     * Uma NF-e de distribuidora de medicamento tem dezenas de quilobytes. 900 KB
     * é folga de uma ordem de grandeza, abaixo do teto de verdade.
     */
    xml: z.string().min(1, 'Envie o XML da nota.').max(900_000, 'O arquivo é grande demais para uma NF-e.'),
  })
  .strict()
export type LerNotaFiscal = z.infer<typeof LerNotaFiscal>

export const CabecalhoDaNota = z
  .object({
    /** A chave de acesso da NF-e: 44 dígitos. `null` na nota digitada. */
    chave: z.string().nullable(),
    numero: z.string(),
    fornecedor: z.string(),
    cnpj: z.string(),
    dia: DiaCivil,
  })
  .strict()
export type CabecalhoDaNota = z.infer<typeof CabecalhoDaNota>

/** Como o servidor casou o produto da nota com o item do estoque. */
export const CASAMENTOS_DA_NOTA = [
  /** Vínculo salvo de `(CNPJ, código)` — a nota anterior ensinou. */
  'vinculo',
  /** O código do produto é igual ao código cadastrado no item. */
  'codigo',
  /** O nome é muito parecido com o do item. */
  'nome',
  /** Parecido o bastante para sugerir, não para confiar. Confira. */
  'sugestao',
  /** Nenhum item corresponde — provavelmente não é item de estoque (frete). */
  'sem',
] as const

export const LinhaDaNotaLida = z
  .object({
    /** `cProd` — o código do produto no fornecedor. */
    codigo: z.string(),
    /** `xProd` — a descrição como o fornecedor a escreve. */
    descricao: z.string(),
    /** `uCom` — a unidade da nota: CX, UN, FR. */
    unidadeDaNota: z.string(),
    /** `qCom`, em milésimos. O front não multiplica quantidade (regra 8). */
    quantidadeNaNota: z.string().regex(/^\d+$/),
    /** `vUnCom` em CENTAVOS, por unidade da NOTA. Redigido sem `valores`. */
    valorUnitario: centavosNaSaida,
    /** `nLote` — o lote do fabricante, como texto. Informativo. */
    loteDoFabricante: z.string(),
    /** `dVal` — a validade, que é o LOTE do nosso modelo. */
    validade: DiaCivil.nullable(),
    /** A sugestão do servidor. `null` = nenhum item corresponde. */
    itemId: Uuid.nullable(),
    casamento: z.enum(CASAMENTOS_DA_NOTA),
    /**
     * Quantas `medida` vêm em 1 unidade da NOTA, em milésimos.
     *
     * Vem do vínculo salvo, ou do `fatorCompra` do item quando a unidade da
     * nota é a de compra, ou `1000` (uma por uma) quando não há de onde tirar.
     * A tela mostra "1 CX = N ampolas" e deixa confirmar — e o que a clínica
     * confirmar é GRAVADO no vínculo, nunca em código (regra 9).
     */
    fator: z.string().regex(/^\d+$/),
  })
  .strict()
export type LinhaDaNotaLida = z.infer<typeof LinhaDaNotaLida>

export const NotaLida = z
  .object({
    nota: CabecalhoDaNota,
    linhas: z.array(LinhaDaNotaLida),
    /**
     * `true` = esta nota **já foi registrada** (regra 26).
     *
     * A tela avisa antes de a pessoa conferir trinta linhas para descobrir no
     * fim que nada seria criado.
     */
    jaRegistrada: z.boolean(),
  })
  .strict()
export type NotaLida = z.infer<typeof NotaLida>

/**
 * A linha a registrar, e a **união declara de onde vem a conversão**.
 *
 * As duas conversões são cadastro, nunca número em código (regra 9):
 *
 *  - `cadastro` — a unidade é uma das três do ITEM (`medida`, compra ou uso),
 *    e quem converte é `paraMedida`. É o caminho da nota digitada à mão.
 *  - `nota` — a unidade é a da NOTA (`CX`), com o fator que a clínica
 *    confirmou. O fator é **gravado no vínculo** `(CNPJ, código)`, que é o
 *    cadastro do produto daquele fornecedor: a próxima nota já chega casada e
 *    convertida.
 *
 * Um campo `fator` opcional no mesmo ramo seria o pior dos dois: a mesma rota
 * com duas fontes de conversão, e a escolha entre elas decidida por um
 * `if (fator != null)` que ninguém vê.
 */
export const LinhaDaEntradaPelaNota = z.discriminatedUnion('como', [
  z
    .object({
      como: z.literal('cadastro'),
      itemId: Uuid,
      ...QuantidadeComUnidade.shape,
      /** A validade do que chegou. Obrigatória quando o item controla. */
      lote: DiaCivil.nullish(),
      /** CENTAVOS por `medida`. Exige `estoque.gerir`. */
      custo: dinheiroEmTexto.nullish(),
    })
    .strict(),
  z
    .object({
      como: z.literal('nota'),
      itemId: Uuid,
      /** A quantidade NA NOTA, em milésimos da unidade da nota. */
      quantidade: quantidadePositiva,
      unidadeDaNota: unidade,
      /** Quantas `medida` em 1 unidade da nota, em milésimos. */
      fator: quantidadePositiva,
      /** O `cProd`, que é a chave do vínculo. Vazio = não guarda vínculo. */
      codigo: z.string().trim().max(60).default(''),
      descricao: z.string().trim().max(80).default(''),
      lote: DiaCivil.nullish(),
      /** CENTAVOS por unidade da NOTA — o servidor divide pelo fator. */
      custoDaNota: dinheiroEmTexto.nullish(),
    })
    .strict(),
])
export type LinhaDaEntradaPelaNota = z.infer<typeof LinhaDaEntradaPelaNota>

export const RegistrarEntradaPelaNota = z
  .object({
    nota: z
      .object({
        /** A chave de acesso: 44 dígitos. É a chave de idempotência (regra 26). */
        chave: z
          .string()
          .trim()
          .regex(/^\d{44}$/, 'A chave de acesso da NF-e tem 44 dígitos.')
          .nullish(),
        numero: z.string().trim().max(20).default(''),
        fornecedor: z.string().trim().max(80).default(''),
        cnpj: z
          .string()
          .trim()
          .regex(/^\d{0,14}$/, 'O CNPJ tem 14 dígitos.')
          .default(''),
        /** O dia da nota — e o dia dos movimentos de entrada. */
        dia: DiaCivil,
      })
      .strict(),
    linhas: z
      .array(LinhaDaEntradaPelaNota)
      .min(1, 'Ligue ao menos um item da nota ao estoque.')
      .max(200),
  })
  .strict()
export type RegistrarEntradaPelaNota = z.infer<typeof RegistrarEntradaPelaNota>

export const ResultadoDaEntradaPelaNota = z
  .object({
    notaId: Uuid,
    /**
     * `true` = a nota **já estava registrada**, e nada novo foi criado.
     *
     * **Divergimos do protótipo aqui, de propósito.** Ele responde
     * `fail("Esta nota já foi registrada.")` — um erro. Uma escrita externa
     * idempotente devolve o MESMO resultado (regra 26): a segunda e a terceira
     * importação do mesmo XML devolvem os mesmos movimentos, com os mesmos
     * ids, e `jaRegistrada: true`. A tela diz "esta nota já estava lançada" e
     * mostra o que ela criou — em vez de um vermelho que não diz se o estoque
     * entrou ou não.
     */
    jaRegistrada: z.boolean(),
    movimentos: z.array(MovimentoNaLista),
    /**
     * Itens cujo custo subiu 10% ou mais nesta nota — o aviso do protótipo.
     *
     * Só nomes, nunca o valor: o aviso serve para a gestão conferir o preço, e
     * o número está na ficha do item, onde a redação o alcança.
     */
    custoSubiu: z.array(z.string()),
    /** Quantos vínculos `(CNPJ, código)` foram gravados ou atualizados. */
    vinculosGravados: z.number().int(),
  })
  .strict()
export type ResultadoDaEntradaPelaNota = z.infer<typeof ResultadoDaEntradaPelaNota>
