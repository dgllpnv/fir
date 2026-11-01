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
