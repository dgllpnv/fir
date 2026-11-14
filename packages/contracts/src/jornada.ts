import { ETAPAS } from '@fir/domain'
import { z } from 'zod'
import { centavosNaSaida, DiaCivil, dinheiroEmTexto, Hora, Uuid } from './comum'
import { confirmacoesDoRecebimento, MotivoDeSuporte, PagamentoEmbutido } from './tarefas'

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
 * Um PROCEDIMENTO LISTADO NO ORÇAMENTO — o conceito próprio, separado de
 * "programa" (ADR 2026-11-13).
 *
 * O programa diz como o tratamento será EXECUTADO (sessões, intervalo,
 * encadeamento). O item do orçamento só diz O QUE foi proposto, e é ele que o
 * fechamento parcial pergunta ("quais foram fechados?"). `valor` é opcional:
 * a recepção que não vê valores lista o procedimento sem preço.
 */
export const ItemDoOrcamento = z
  .object({
    chave: z.string().trim().min(1).max(20),
    procedimentoId: Uuid,
    valor: valorDeItem.optional(),
    /** Quantas sessões foram orçadas deste procedimento (opcional: nem todo item é de sessões). */
    sessoes: z.number().int().min(1).max(60).optional(),
  })
  .strict()
export type ItemDoOrcamento = z.infer<typeof ItemDoOrcamento>

export const ItensDoOrcamento = z
  .array(ItemDoOrcamento)
  .min(1)
  .max(10)
  .superRefine((itens, ctx) => {
    const chaves = new Set<string>()
    for (const [i, item] of itens.entries()) {
      if (chaves.has(item.chave)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, 'chave'],
          message: `Chave repetida nos procedimentos: "${item.chave}".`,
        })
      }
      chaves.add(item.chave)
    }
  })

/**
 * As doze ações que esta rota aceita.
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
      /** Quem faz o contato da retomada. Opcional; o servidor confere pessoa ativa da clínica. */
      contatoId: Uuid.optional(),
      programa: Programa.optional(),
      /**
       * Os procedimentos do orçamento SEM virar programa. Ou `programa` (que
       * já carrega os itens) ou `itens` — nunca os dois (conferido no servidor).
       */
      itens: ItensDoOrcamento.optional(),
      nota: Nota,
    })
    .strict(),
  z
    .object({
      acao: z.literal('followUp'),
      retomarEm: DiaCivil.optional(),
      contatoId: Uuid.optional(),
      nota: Nota,
    }).strict(),
  // O MESMO `PagamentoEmbutido` do épico 2, não uma segunda cópia: se fosse
  // outro esquema, "valor em aberto pode ser zero" valeria num e não no
  // outro, e a diferença apareceria no saldo da paciente.
  z
    .object({
      acao: z.literal('fechar'),
      recebimento: PagamentoEmbutido,
      /**
       * O início do programa, quando a proposta tiver um.
       *
       * `ItemOrcado` não tem data — só `depoisDe`. Quem não depende de ninguém
       * começa no início do programa, e o início vem daqui. OPCIONAL: o padrão
       * é HOJE DA CLÍNICA, calculado no servidor (regra 24), porque o relógio
       * do cliente não é autoridade sobre data de negócio.
       */
      inicioDoPrograma: DiaCivil.optional(),
      /**
       * O QUE FOI FECHADO — declarado, não deduzido da soma digitada.
       *
       * Com um orçamento oferecido, a tela pergunta: "fechou o orçamento todo"
       * (entrada + em aberto = o oferecido) ou "fechou só uma parte" (menos que
       * o oferecido). O servidor CONFERE a escolha contra os números: sem isso,
       * um "em aberto" deixado em branco virava "parcial" e o saldo que a
       * clínica ia cobrar nunca existia. Ausente = o comportamento antigo.
       */
      fechamento: z.enum(['tudo', 'parte']).optional(),
      /**
       * Só no fechamento PARCIAL de um orçamento COM procedimentos listados: as
       * chaves dos que a paciente de fato contratou. O servidor exige, e exige
       * que sejam MENOS que todos (todos = "fechou o orçamento todo").
       * Persiste no evento `fechar`.
       */
      itensFechados: z.array(z.string().trim().min(1).max(20)).max(10).optional(),
      /**
       * Só no parcial de um orçamento de PROGRAMA: quantas sessões a paciente
       * fechou, por chave de procedimento marcado (1 até as orçadas). Ausente =
       * todas as orçadas. O programa nasce com ESTAS sessões, e o evento as guarda.
       */
      sessoesFechadas: z.record(z.string().trim().min(1).max(20), z.number().int().min(1).max(60)).optional(),
      /** Só no parcial: o dia de retomar o restante. Vira lembrete em Hoje › Retomar. */
      retomarRestanteEm: DiaCivil.optional(),
      nota: Nota,
      ...confirmacoesDoRecebimento,
    })
    .strict(),
  /** Retomar o RESTANTE de um orçamento fechado parcial; sem data, encerra o lembrete. */
  z
    .object({ acao: z.literal('retomarRestante'), retomarEm: DiaCivil.optional(), nota: Nota })
    .strict(),
  // `motivoId`, e NÃO o nome: o nome vem da lista da clínica, resolvido no
  // servidor dentro da mesma transação (decisão D-2). Aceitar o nome do
  // cliente faria a história contar o que o navegador disse.
  z.object({ acao: z.literal('perder'), motivoId: Uuid, nota: Nota }).strict(),
  /**
   * CORRIGIR O ORÇAMENTO JÁ ENVIADO (correções da PO, item B1).
   *
   * Os três campos são opcionais: ausente = MANTÉM, e `nota: ''` limpa. "Pelo
   * menos um" é regra do domínio (`corrigirOrcamento`), porque um `.refine`
   * aqui tiraria o objeto da `discriminatedUnion`.
   *
   * `valor` é o MESMO `valorDeOrcamento` do registro (gate de números, N-16):
   * dois esquemas para o mesmo dinheiro é como um deles passa a aceitar zero.
   *
   * `chaveIdempotencia` é obrigatória: a tela a gera quando abre o formulário,
   * e o duplo clique e o retry da rede trazem a mesma — um evento só.
   */
  z
    .object({
      acao: z.literal('corrigirOrcamento'),
      chaveIdempotencia: Uuid,
      valor: valorDeOrcamento.optional(),
      retomarEm: DiaCivil.optional(),
      nota: Nota,
      /**
       * Os ITENS do orçamento, trocados por inteiro (pedido 2 da cliente: ela
       * via o que foi orçado e não conseguia corrigir). Ausente = MANTÉM.
       * É a mesma proposta do `registrarOrcamento`, com as mesmas conferências.
       */
      programa: Programa.optional(),
      /** Os procedimentos do orçamento SEM programa, trocados por inteiro. */
      itens: ItensDoOrcamento.optional(),
    })
    .strict(),
  /**
   * REABRIR / EXCLUIR SÓ O ORÇAMENTO (pedido da cliente, 2026-11-13).
   *
   * O motivo é OBRIGATÓRIO para todos (10 a 200 caracteres): as duas ações
   * estornam dinheiro e vão para a trilha com o motivo. `confirmarCaixaFechado`
   * é a mesma confirmação do recebimento: o estorno mexe num dia de caixa já
   * conferido, e a tela diz qual dia antes de pedir.
   */
  z
    .object({
      acao: z.literal('reabrirOrcamento'),
      motivo: MotivoDeSuporte,
      confirmarCaixaFechado: z.literal(true).optional(),
    })
    .strict(),
  z
    .object({
      acao: z.literal('excluirOrcamento'),
      motivo: MotivoDeSuporte,
      confirmarCaixaFechado: z.literal(true).optional(),
    })
    .strict(),
])
export type MoverEtapa = z.infer<typeof MoverEtapa>

/** Um motivo de perda, como a lista suspensa da tela de perda o lê. */
export const MotivoDePerda = z.object({ id: Uuid, nome: z.string() })
export type MotivoDePerda = z.infer<typeof MotivoDePerda>

export const ListaDeMotivos = z.object({ itens: z.array(MotivoDePerda) })
export type ListaDeMotivos = z.infer<typeof ListaDeMotivos>

/* =========================================================================
 * GET /v1/jornada — O FUNIL
 *
 * Três coisas, e as três calculadas no SERVIDOR: o funil do PERÍODO, os três
 * KPIs e as colunas de HOJE.
 *
 * A diferença entre o funil e as colunas é a pergunta que a tela responde: o
 * funil conta **movimentos do período**; as colunas mostram **a situação de
 * hoje**. Um cartão agendado em setembro e realizado em outubro conta em
 * "agendados" de setembro e em "realizados" de outubro, e hoje está na coluna
 * "Realizadas sem orçamento". São duas perguntas diferentes, e colapsá-las
 * numa é como o número do funil deixa de bater com o tamanho da coluna e
 * ninguém sabe qual está certo.
 * ====================================================================== */

/**
 * Os períodos desta tela. `qualquer` **não** entra: um funil sem janela não
 * mede conversão de coisa nenhuma — mede o histórico inteiro da clínica.
 */
export const PERIODOS_DO_FUNIL = ['7dias', '30dias', 'mes', 'mes-passado', 'per'] as const
export type PeriodoDoFunil = (typeof PERIODOS_DO_FUNIL)[number]

export const ConsultaDaJornada = z.object({
  periodo: z.enum(PERIODOS_DO_FUNIL).default('30dias'),
  /** Só com `periodo=per`. Janela semiaberta `[de, ate+1dia)`, regra 23. */
  de: DiaCivil.optional(),
  ate: DiaCivil.optional(),
  /** Responsável **ou** solicitante — a mesma regra frouxa da tela Hoje. */
  responsavelId: Uuid.optional(),
  unidadeId: Uuid.optional(),
})
export type ConsultaDaJornada = z.infer<typeof ConsultaDaJornada>

export const PASSOS_DO_FUNIL = [
  'agendados',
  'confirmados',
  'realizados',
  'orcamentosEnviados',
  'fechados',
] as const
export type PassoDoFunil = (typeof PASSOS_DO_FUNIL)[number]

/**
 * Um passo do funil, com tudo já contado.
 *
 * `conversao` e `proporcao` saem prontos porque `docs/design.md` proíbe
 * percentual calculado no front — e não é só regra: a barra do passo é
 * proporcional a `agendados`, que é um número de OUTRO passo. Uma conta que
 * precisa de dois itens da lista para desenhar um deles é conta de quem tem a
 * lista inteira, e esse é o servidor.
 */
export const PassoDoFunilNaSaida = z.object({
  chave: z.enum(PASSOS_DO_FUNIL),
  rotulo: z.string(),
  n: z.number().int(),
  /** `null` sem a permissão `valores` — e `null` também quando o passo não tem valor. */
  valor: centavosNaSaida,
  /** *"recebido"* · *"orçado"* · *"fechado"*. Vazio quando não há valor. */
  rotuloDoValor: z.string(),
  /** Pontos percentuais inteiros sobre o passo de comparação. `null` = sem denominador. */
  conversao: z.number().int().nullable(),
  /** *"dos agendados"*, *"dos realizados"*, *"dos orçamentos"*. */
  conversaoSobre: z.string(),
  /** Largura da barra, 0 a 100, proporcional a `agendados`. */
  proporcao: z.number().int(),
})
export type PassoDoFunilNaSaida = z.infer<typeof PassoDoFunilNaSaida>

export const COLUNAS_DA_JORNADA = [
  'agendadas',
  'confirmadas',
  'recontatar',
  'realizadas',
  'orcamentos',
  // Visão DERIVADA dos fechados parciais (não é etapa): "Orçamento
  // parcialmente fechado". Recorte de HOJE, sem período. O cartão também
  // continua em 'fechados' (quando o fechamento cai na janela), e o passo
  // "Fechados" do funil não muda.
  'parciais',
  'fechados',
  'perdidos',
] as const
export type ColunaDaJornada = (typeof COLUNAS_DA_JORNADA)[number]

/**
 * O mini-cartão de uma coluna. Dado cru — **nenhuma data formatada**.
 *
 * Formatar é do front; calcular não é. Mandar `"retomar 24/10"` pronto daqui
 * amarraria a língua da clínica ao servidor e impediria o front de decidir
 * entre "24/10" e "ontem" conforme o espaço.
 */
export const CartaoDaColuna = z.object({
  id: Uuid,
  pacienteId: Uuid.nullable(),
  pacienteNome: z.string().nullable(),
  tipo: z.string(),
  etapa: z.enum(ETAPAS),
  prazo: DiaCivil,
  hora: z.string().nullable(),
  proximoPassoEm: DiaCivil.nullable(),
  /** O instante do último evento DESTA etapa. É o que data as colunas do período. */
  ultimoEventoEm: z.string().nullable(),
  valorOrcamento: centavosNaSaida,
  /**
   * Só na coluna `parciais` (nas outras, `null`): o fechado, o RESTANTE a
   * cobrar (oferecido − fechado) e "fechou X de Y" procedimentos. Os dois
   * valores são redigidos sem `valores`; as contagens não são dinheiro.
   * `itensFechados`/`itensTotal` `null` = fechado antes do detalhamento.
   */
  valorFechado: centavosNaSaida.optional(),
  valorRestante: centavosNaSaida.optional(),
  itensFechados: z.number().int().nullable().optional(),
  itensTotal: z.number().int().nullable().optional(),
  /** Soma das sessões do último fechamento / das orçadas; `null` se não foram informadas. */
  sessoesFechadas: z.number().int().nullable().optional(),
  sessoesTotal: z.number().int().nullable().optional(),
})
export type CartaoDaColuna = z.infer<typeof CartaoDaColuna>

export const ColunaDaJornadaNaSaida = z.object({
  chave: z.enum(COLUNAS_DA_JORNADA),
  rotulo: z.string(),
  n: z.number().int(),
  /**
   * A soma dos orçamentos da coluna. `null` nas colunas que não têm valor.
   * Na coluna `parciais` é o RESTANTE a cobrar (cabeçalho da coluna).
   */
  valor: centavosNaSaida,
  /** No máximo 30; o resto vai em `restantes`. */
  itens: z.array(CartaoDaColuna),
  restantes: z.number().int(),
})
export type ColunaDaJornadaNaSaida = z.infer<typeof ColunaDaJornadaNaSaida>

export const RespostaDaJornada = z.object({
  de: DiaCivil,
  ate: DiaCivil,
  /** *"Últimos 30 dias"*, *"Este mês"*. O servidor nomeia o período que ele resolveu. */
  rotuloDoPeriodo: z.string(),
  /** O dia civil de hoje na clínica. A tela nunca o calcula (regra 24). */
  hoje: DiaCivil,
  funil: z.array(PassoDoFunilNaSaida),
  /**
   * No-show: quantidade e **taxa em pontos percentuais inteiros**.
   *
   * O denominador é `realizados + faltaram`, **não** os agendados: um
   * agendamento que ainda vai acontecer não deveria piorar a taxa de hoje. É
   * a conta do protótipo, e é a certa.
   *
   * Inteiro, e não fração: uma fração em `number` convida um `toFixed` do
   * outro lado, e o percentual inteiro já é a resposta inteira.
   */
  noShow: z.object({ n: z.number().int(), taxa: z.number().int().nullable() }),
  desmarcados: z.object({ n: z.number().int() }),
  /** O valor é o ORÇADO que se perdeu — **nunca** receita (regra 4). */
  perdidos: z.object({ n: z.number().int(), valor: centavosNaSaida }),
  colunas: z.array(ColunaDaJornadaNaSaida),
})
export type RespostaDaJornada = z.infer<typeof RespostaDaJornada>

/**
 * RECEBIMENTOS DIRETOS na Jornada do paciente (pedido da cliente, 2026-11-13).
 *
 * O dinheiro que entrou por "Registrar recebimento" (consulta, sinal, programa,
 * saldo) não passa por um cartão da jornada, e por isso a paciente que já pagou
 * não aparecia ali. Esta lista só ENXERGA esses recebimentos: não conta em
 * nenhum indicador do funil (a receita tem um caminho só, regra 3). Nunca
 * carrega dose, lote nem produto: só o nome do programa.
 */
export const RecebimentoDireto = z.object({
  id: Uuid,
  pacienteId: Uuid,
  paciente: z.string(),
  /** O rótulo que a recepção escolheu: "Pagamento de saldo em aberto". */
  tipo: z.string(),
  valor: centavosNaSaida,
  forma: z.string(),
  em: DiaCivil,
  /** Nome do programa que o pagamento abateu, quando abateu um. */
  programa: z.string().nullable(),
})
export const RecebimentosDiretos = z.object({
  itens: z.array(RecebimentoDireto),
  restantes: z.number().int(),
})
export type RecebimentosDiretos = z.infer<typeof RecebimentosDiretos>

/**
 * **PACIENTE EM PROGRAMA** — a seção "Em programa" da Jornada (pedido da cliente,
 * 2026-11-13: "puxar programas de tratamento em andamento").
 *
 * Leitura derivada, sem tarefa nova: não entra no funil nem na receita. Só o que
 * a recepção precisa para saber onde a paciente está: quais procedimentos, quantas
 * sessões já foram feitas e quando vem a próxima. Dose, produto, lote e dinheiro
 * ficam de fora (regra 18).
 */
export const ProgramaEmAndamento = z.object({
  id: Uuid,
  pacienteId: Uuid,
  paciente: z.string(),
  /** Os procedimentos do programa, em texto: "Semaglutida + Tirzepatida". */
  procedimentos: z.string(),
  sessoesFeitas: z.number().int().nonnegative(),
  sessoesTotal: z.number().int().nonnegative(),
  /** O prazo da próxima sessão aberta, ou `null` se não há. */
  proximaSessaoEm: DiaCivil.nullable(),
  /** Sessões abertas com o prazo já vencido. */
  atrasadas: z.number().int().nonnegative(),
})
export const ProgramasEmAndamento = z.object({
  itens: z.array(ProgramaEmAndamento),
  restantes: z.number().int().nonnegative(),
})
export type ProgramasEmAndamento = z.infer<typeof ProgramasEmAndamento>

/**
 * **ORÇAMENTOS POR ATENDENTE** — quantos lançou, quantos fechou completos e
 * quantos fechou parciais. Só contagens: nenhum centavo, então a resposta é a
 * mesma com ou sem a permissão `valores`.
 *
 * O período é o do funil (`periodo`, e `de`/`ate` com `per`).
 */
export const ConsultaDeOrcamentos = ConsultaDaJornada.pick({ periodo: true, de: true, ate: true })
export type ConsultaDeOrcamentos = z.infer<typeof ConsultaDeOrcamentos>

export const OrcamentosDeUmaPessoa = z.object({
  pessoaId: Uuid,
  nome: z.string(),
  /** Orçamentos enviados no período (evento `registrarOrcamento`). */
  lancados: z.number().int().nonnegative(),
  /** Fechados no período por inteiro: fechou o valor oferecido, ou mais. */
  fechadosCompletos: z.number().int().nonnegative(),
  /** Fechados no período por menos do que foi oferecido. */
  fechadosParciais: z.number().int().nonnegative(),
  /** Fechados antes de o sistema guardar o valor fechado: não dá para classificar. */
  fechadosSemClassificacao: z.number().int().nonnegative(),
})
export type OrcamentosDeUmaPessoa = z.infer<typeof OrcamentosDeUmaPessoa>

export const RespostaDeOrcamentos = z.object({
  de: DiaCivil,
  ate: DiaCivil,
  itens: z.array(OrcamentosDeUmaPessoa),
})
export type RespostaDeOrcamentos = z.infer<typeof RespostaDeOrcamentos>

/* =========================================================================
 * GET /v1/pacientes/:id/orcamentos — A ABA "ORÇAMENTOS" DA FICHA
 *
 * Derivado, nunca gravado: lê a tarefa (colunas + `historico`) e aplica
 * `resumoDoOrcamento` de `packages/domain`. Exige `jornada`; sem ela, sem
 * histórico. Dose, responsável e sessões NÃO saem (dado de saúde, regra 18).
 *
 * Sem `valores`, o servidor apaga por NOME de chave (`valorOrcamento`,
 * `valorFechado`, `valorRestante`, `valor` do item): sobram a situação, a
 * contagem e os nomes dos procedimentos.
 * ====================================================================== */

export const SITUACOES_DO_ORCAMENTO = ['aberto', 'fechado', 'parcial', 'perdido'] as const
export type SituacaoDoOrcamento = (typeof SITUACOES_DO_ORCAMENTO)[number]

/**
 * `orcado` = o orçamento ainda não foi decidido (aberto) ou foi perdido; os
 * outros três só existem num orçamento FECHADO. `sem_detalhamento` = fechado
 * antes de o sistema guardar quais itens foram fechados (sem backfill).
 */
export const SITUACOES_DO_ITEM = ['orcado', 'fechado', 'nao_fechado', 'sem_detalhamento'] as const
export type SituacaoDoItem = (typeof SITUACOES_DO_ITEM)[number]

export const ItemDoOrcamentoDoPaciente = z.object({
  chave: z.string(),
  procedimentoId: Uuid,
  procedimento: z.string(),
  /** Preço do item. Redigido sem `valores`. */
  valor: centavosNaSaida.optional(),
  /**
   * Quantas sessões foram orçadas e de quanto em quanto tempo. Só no orçamento
   * de PROGRAMA. Dado de plano terapêutico: sai sob a mesma permissão
   * (`jornada`) que já mostra o cartão da ficha. Dose, produto, lote e
   * responsável continuam fora (regra 18; ADR 2026-11-13 sessoes-na-leitura).
   */
  sessoes: z.number().int().positive().optional(),
  intervaloDias: z.number().int().positive().optional(),
  /** Parcial por sessões: quantas ele fechou (menos que `sessoes`). */
  sessoesFechadas: z.number().int().positive().optional(),
  situacao: z.enum(SITUACOES_DO_ITEM),
})
export type ItemDoOrcamentoDoPaciente = z.infer<typeof ItemDoOrcamentoDoPaciente>

export const OrcamentoDoPaciente = z.object({
  /** A tarefa (o atendimento) de onde o orçamento saiu. */
  tarefaId: Uuid,
  tipoDoAtendimento: z.string(),
  /** O dia do atendimento, no fuso da clínica. */
  atendimentoEm: DiaCivil,
  /** Quando o orçamento foi enviado (instante UTC, ISO). A tela formata. */
  registradoEm: z.string(),
  situacao: z.enum(SITUACOES_DO_ORCAMENTO),
  valorOrcamento: centavosNaSaida,
  valorFechado: centavosNaSaida,
  /** Oferecido − fechado, só no parcial. Redigido sem `valores`. */
  valorRestante: centavosNaSaida,
  itens: z.array(ItemDoOrcamentoDoPaciente),
  /** `null` = sem detalhamento (orçamento antigo, ou sem itens listados). */
  itensFechados: z.number().int().nullable(),
  itensTotal: z.number().int(),
  /** Só no parcial: o dia de retomar o restante, ou `null`. */
  retomarRestanteEm: DiaCivil.nullable(),
  /** "O que foi orçado", em texto livre (a nota do orçamento vigente), ou `null`. */
  notaDoOrcamento: z.string().nullable(),
  /**
   * A observação do fechamento — por exemplo, o que a paciente NÃO fechou e por
   * quê (pedido da cliente: "essa observação não fica em lugar nenhum"). Só em
   * orçamento fechado; `null` nos demais.
   */
  notaDoFechamento: z.string().nullable(),
})
export type OrcamentoDoPaciente = z.infer<typeof OrcamentoDoPaciente>

export const RespostaDeOrcamentosDoPaciente = z.object({
  /** Contagens por situação: a única coisa que sobra quando a lista não cabe na tela. */
  totais: z.object({
    orcamentos: z.number().int(),
    abertos: z.number().int(),
    fechados: z.number().int(),
    parciais: z.number().int(),
    perdidos: z.number().int(),
  }),
  /** Mais recente primeiro. */
  itens: z.array(OrcamentoDoPaciente),
})
export type RespostaDeOrcamentosDoPaciente = z.infer<typeof RespostaDeOrcamentosDoPaciente>

/**
 * `GET /v1/tarefas/:id/orcamento/previa` — o que reabrir ou excluir o orçamento
 * vai desfazer, para a confirmação da tela. Nenhum campo novo de dinheiro: `valor`
 * já é monetário e a redação central o apaga sem `valores` (a equipe lê "há um
 * pagamento a estornar", sem o número).
 */
export const PreviaDeDesfazerOrcamento = z.object({
  /** O orçamento tem dinheiro do fechamento a estornar. */
  temPagamento: z.boolean(),
  /** O fechamento montou um programa, que será encerrado. */
  temPrograma: z.boolean(),
  /** O que será estornado. Redigido sem `valores`. */
  valor: centavosNaSaida.nullable(),
  /** O dia do dinheiro (fuso da clínica), quando há pagamento. */
  diaDoDinheiro: DiaCivil.nullable(),
  /** Aquele dia já tem caixa fechado: o estorno pede confirmação. */
  caixaFechado: z.boolean(),
  /** Se há algo que impede, a frase que diz o que fazer. `null` = pode. */
  bloqueio: z.string().nullable(),
})
export type PreviaDeDesfazerOrcamento = z.infer<typeof PreviaDeDesfazerOrcamento>
