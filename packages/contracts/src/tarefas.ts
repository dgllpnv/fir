import {
  ACOES,
  Dinheiro,
  ehPagamento,
  ETAPAS,
  FREQUENCIAS,
  MAX_PARTES,
  TIPOS,
  validarPartes,
} from '@fir/domain'
import { z } from 'zod'
import { centavosNaSaida, DiaCivil, dinheiroEmTexto, Hora, Uuid } from './comum'
import { KpiDaTarefa, LancamentoDeKpiNaTarefa } from './indicadores-lancamentos'

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
/**
 * Exportado desde o épico 8: **as campanhas validam tipo de tarefa também**,
 * e uma segunda expressão em `campanhas.ts` é como uma delas passa a aceitar
 * um nome que a tabela não tem. Mesma regra, um lugar.
 */
export const NomeDeTipo = z
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
 * UMA FORMA DE PAGAMENTO e o valor dela — a parte (`recebimento_partes`).
 * O formulário "Incluir mais de uma forma de pagamento" manda uma lista delas.
 */
export const ParteDoPagamento = z.object({ forma: z.enum(FORMAS), valor: valorRecebido }).strict()
export type ParteDoPagamento = z.infer<typeof ParteDoPagamento>

/** De 1 a 5 (uma por forma). A soma = valor e a promissória sozinha ficam em `conferirPartes`. */
export const PartesDoPagamento = z.array(ParteDoPagamento).min(1).max(MAX_PARTES)

/**
 * **A FORMA OU AS PARTES — nunca as duas, nunca nenhuma — e a soma fecha.**
 *
 * `forma` sozinha é o contrato de sempre (parte única, compatível). `partes`
 * é o novo: várias formas, com `Σ partes = valor` exato, forma repetida
 * recusada e nota promissória só como parte única. A validação mora no
 * domínio (`validarPartes`); aqui só se traduz o erro para o Zod, e o serviço
 * a repete (`gravarRecebimento`) porque o migrador e o seed não passam por
 * este esquema.
 */
export function conferirPartes(
  p: {
    readonly valor: bigint
    readonly forma?: string | undefined
    readonly partes?: readonly { readonly forma: string; readonly valor: bigint }[] | undefined
  },
  ctx: z.RefinementCtx,
): void {
  if ((p.forma === undefined) === (p.partes === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['partes'],
      message: 'Informe a forma de pagamento OU a lista de formas — uma das duas, nunca as duas.',
    })
    return
  }
  if (p.partes === undefined) return
  const r = validarPartes(
    Dinheiro.deCentavos(p.valor),
    p.partes.map((x) => ({ forma: x.forma, valor: Dinheiro.deCentavos(x.valor) })),
  )
  if (r.tipo === 'erro') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partes'], message: r.erro.mensagem })
  }
}

/**
 * As partes de um pagamento já validado, na forma única que o servidor
 * grava: `partes` quando vieram, senão a parte única com a `forma` de sempre.
 */
export const partesDoPagamento = (p: {
  readonly valor: bigint
  readonly forma?: string | undefined
  readonly partes?: readonly { readonly forma: string; readonly valor: bigint }[] | undefined
}): { forma: string; valor: bigint }[] =>
  p.partes !== undefined
    ? p.partes.map((x) => ({ forma: x.forma, valor: x.valor }))
    : p.forma === undefined
      ? []
      : [{ forma: p.forma, valor: p.valor }]

/**
 * O pagamento embutido no atendimento — o bloco "Houve pagamento?" da tela.
 *
 * Ele e o recebimento avulso do épico 4 produzem a MESMA linha de
 * `recebimentos`. Nunca as duas para o mesmo dinheiro (regra 3), e quem
 * garante isso não é este esquema: é o índice único parcial da migration
 * `0006`. Aqui só se declara a forma — ou, desde a fatia 4.1, as formas.
 */
export const PagamentoEmbutido = z
  .object({
    valor: valorRecebido,
    forma: z.enum(FORMAS).optional(),
    partes: PartesDoPagamento.optional(),
    valorAberto: valorEmAberto.optional(),
  })
  .strict()
  .superRefine(conferirPartes)
export type PagamentoEmbutido = z.infer<typeof PagamentoEmbutido>

/**
 * **A CONFIRMAÇÃO EXPLÍCITA (D-21)** — o padrão único dos avisos do servidor.
 *
 * Quando um aviso se aplica, a rota responde 409 com `ConfirmacaoNecessaria`
 * e não grava nada. A tela pergunta e, se a pessoa confirma, reenvia o MESMO
 * corpo com a chave do aviso em `true`.
 *
 * **O 409 não carrega número nenhum.** A redação central (regra 17) só alcança
 * respostas de sucesso; um valor dentro do corpo de erro atravessaria inteiro
 * para quem não tem `valores`. Quem escreve o texto é a TELA, com o valor que
 * a própria pessoa digitou.
 */
export const CODIGO_CONFIRMACAO_NECESSARIA = 'CONFIRMACAO_NECESSARIA'

/** `MES_ANTERIOR` é o do desfazer pagamento de conta; os dois primeiros, de recebimento. */
export const AVISOS_DE_CONFIRMACAO = [
  'CAIXA_FECHADO',
  'POSSIVEL_DUPLICIDADE',
  'MES_ANTERIOR',
  'CREDITO_NA_PACIENTE',
  'INICIO_NO_PASSADO',
] as const
export type AvisoDeConfirmacao = (typeof AVISOS_DE_CONFIRMACAO)[number]

export const ConfirmacaoNecessaria = z
  .object({
    statusCode: z.literal(409),
    codigo: z.literal(CODIGO_CONFIRMACAO_NECESSARIA),
    avisos: z.array(z.enum(AVISOS_DE_CONFIRMACAO)).min(1),
    message: z.string(),
  })
  .strict()
export type ConfirmacaoNecessaria = z.infer<typeof ConfirmacaoNecessaria>

/**
 * As duas confirmações de TODO corpo que grava recebimento — avulso, concluir
 * tarefa, criar tarefa já concluída, concluir sessão, fechar na jornada e
 * montar programa com entrada. Um objeto só, espalhado nos seis: a sétima
 * porta de dinheiro copia daqui, não reinventa o nome.
 *
 * `z.literal(true)`: `false` explícito não é confirmação, e aceitá-lo daria
 * duas maneiras de dizer "não confirmei".
 */
export const confirmacoesDoRecebimento = {
  confirmarCaixaFechado: z.literal(true).optional(),
  confirmarDuplicidade: z.literal(true).optional(),
}
export type ConfirmacoesDoRecebimento = {
  readonly confirmarCaixaFechado?: true | undefined
  readonly confirmarDuplicidade?: true | undefined
}

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
export const tipoQueNaoEhPagamento = NomeDeTipo.refine((t) => !ehPagamento(t), {
  message: 'Pagamento não é tarefa. Use Recebimento para registrar dinheiro recebido.',
})

/**
 * O texto livre de um evento do fluxo (nota da transferência, motivo). ≤ 200 e
 * **a tela avisa**: "Não escreva nome de paciente nem dado de saúde" (L3). Nunca
 * em log, nunca em mensagem de erro.
 */
export const NOTA_DO_FLUXO_MAXIMA = 200
export const AVISO_DA_NOTA_DO_FLUXO = 'Não escreva nome de paciente nem dado de saúde.'
const NotaDoFluxo = z.string().trim().max(NOTA_DO_FLUXO_MAXIMA)

const comumDaTarefa = {
  /** Pessoa OU grupo (`grupoId`) — exatamente um, conferido no fim do esquema (Q1). */
  responsavelId: Uuid.optional(),
  /** O grupo destino. Tarefa de grupo não nasce já concluída (retroativo recusa). */
  grupoId: Uuid.optional(),
  /**
   * A tarefa de onde esta nasce ("concluir e criar nova"). Só vale se for do
   * mesmo paciente ou sem paciente; o servidor confere (appsec S2).
   */
  tarefaOrigemId: Uuid.optional(),
  // Opcional porque o serviço a preenche com o nome do tipo quando vier vazia
  // — é o que a tela faz, e é por isso que o rótulo dela vira "Descrição
  // (opcional)" no modo paciente.
  descricao: z.string().trim().max(400).optional(),
  prioridade: z.enum(['normal', 'urgente']).default('normal'),
  obs: z.string().trim().max(300).default(''),
  unidadeId: Uuid.nullish(),
  /**
   * A campanha de que esta ação faz parte (A3). Opcional e anulável: ausente
   * e `null` são "nenhuma". A janela (em andamento ou encerrada há até 30
   * dias) e a clínica são conferidas no SERVIDOR, por `conferirVinculo`.
   */
  campanhaId: Uuid.nullish(),
  quando: Quando,
  // O lançamento retroativo com pagamento grava recebimento — e pode cair
  // num dia de caixa já fechado, que é justamente o caso que o aviso pega.
  ...confirmacoesDoRecebimento,
}

/**
 * União discriminada por `vinculo`, e **não** interseção de dois esquemas.
 *
 * A interseção impediria `.strict()`: cada lado recusaria as chaves do outro.
 * E sem `.strict()` o corpo `{ quando: { modo: 'retroativo' }, serie: {…} }`
 * — que é literalmente o que a tela antiga mandava — passaria com o `serie`
 * descartado em silêncio, criando UMA tarefa onde a recepção pediu doze.
 */
export const CriarTarefa = z
  .discriminatedUnion('vinculo', [
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
  .superRefine((d, ctx) => {
    // Destino EXCLUSIVO (Q1, `CHECK tarefa_tem_destino`): a recusa chega aqui, como
    // erro de campo, antes de o banco ter de recusá-la.
    if ((d.responsavelId === undefined) === (d.grupoId === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [d.grupoId === undefined ? 'responsavelId' : 'grupoId'],
        message: 'Escolha uma pessoa ou um grupo — não os dois, e não nenhum.',
      })
    }
  })
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
    ...confirmacoesDoRecebimento,
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
    /**
     * **TRÊS ESTADOS, e eles não se confundem** (N-4): AUSENTE mantém a
     * campanha que está lá; `null` remove; um id troca. Com dois estados, a
     * tela que reenvia o formulário sem o campo limparia a campanha de uma
     * tarefa antiga, e a receita sumiria dela em silêncio.
     */
    campanhaId: Uuid.nullish(),
    // A data de realização vale SÓ para esta tarefa, nunca para a série — a
    // tela diz isso em letra miúda, e o serviço precisa do mesmo contrato.
    realizadaEm: DiaCivil.optional(),
    /** Alcança as próximas da série: abertas, com prazo >= o desta. */
    serie: z.boolean().default(false),
  })
  .strict()
export type EditarTarefa = z.infer<typeof EditarTarefa>

/**
 * Booleano vindo da QUERY STRING, onde tudo é texto.
 *
 * `z.coerce.boolean()` seria o óbvio e está ERRADO: `Boolean('false')` é
 * `true`, então `?serie=false` — exatamente o que uma tela manda quando a
 * caixa está desmarcada — alcançaria a série inteira. A recepção pediria para
 * excluir UMA ocorrência e perderia as doze.
 *
 * Aqui só `true` e `1` são verdade, e qualquer outra coisa é recusada pelo
 * parse em vez de virar `true` em silêncio.
 */
export const BooleanoDeConsulta = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1')

/**
 * O MOTIVO de uma ação do Suporte Firmare dentro de uma clínica (I1).
 *
 * Texto curto, que vai para `auditoria.motivo` e para a tela Atividades da
 * clínica. Mínimo de 10 caracteres para não aceitar "x" ou "ok": é a
 * justificativa que a clínica lê depois. Não escreva nome de paciente.
 */
export const MotivoDeSuporte = z.string().trim().min(10).max(200)
export type MotivoDeSuporte = z.infer<typeof MotivoDeSuporte>

/** O corpo (opcional) de `DELETE`, `POST …/reativar` etc.: só carrega o motivo. */
export const CorpoComMotivo = z.object({ motivo: MotivoDeSuporte.optional() }).strict()
export type CorpoComMotivo = z.infer<typeof CorpoComMotivo>

/**
 * Para onde uma tarefa vai: uma pessoa OU um grupo. União discriminada, e não
 * dois campos opcionais, para que "os dois" e "nenhum" não tenham como ser escritos.
 */
export const DestinoDaTarefa = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('pessoa'), id: Uuid }).strict(),
  z.object({ tipo: z.literal('grupo'), id: Uuid }).strict(),
])
export type DestinoDaTarefa = z.infer<typeof DestinoDaTarefa>

/** `POST v1/tarefas/:id/transferir`. A clínica vem da sessão; "de" vem do banco. */
export const TransferirTarefa = z
  .object({ para: DestinoDaTarefa, nota: NotaDoFluxo.optional() })
  .strict()
export type TransferirTarefa = z.infer<typeof TransferirTarefa>

/** `POST v1/tarefas/:id/assumir`. Corpo vazio ou só com a nota. */
export const AssumirTarefa = z.object({ nota: NotaDoFluxo.optional() }).strict()
export type AssumirTarefa = z.infer<typeof AssumirTarefa>

export const ExcluirTarefa = z
  .object({ serie: BooleanoDeConsulta.default(false) })
  .strict()
export type ExcluirTarefa = z.infer<typeof ExcluirTarefa>

/* -------------------------------------------------------------------------
 * A SAÍDA
 * ---------------------------------------------------------------------- */

/**
 * Dinheiro na SAÍDA: string de centavos, ou `null` quando a redação apagou.
 *
 * Não é `dinheiroEmTexto` — aquele é de ENTRADA e transforma a string em
 * `bigint`, o que descreveria errado o que sai pelo JSON.
 */

/**
 * O pagamento embutido, como ele volta.
 *
 * É uma LINHA DE `recebimentos`, não um campo da tarefa — `tarefas` não tem
 * coluna de dinheiro. `valor` e `valorAberto` saem `null` para quem não tem
 * `valores`, e isso é trabalho do `RedacaoInterceptor`, nunca de um `if`
 * aqui. Por isso toda rota que devolve `TarefaNaLista` entra em
 * `ROTAS_COM_DINHEIRO`.
 */
export const PagamentoNaSaida = z.object({
  id: Uuid,
  valor: centavosNaSaida,
  valorAberto: centavosNaSaida,
  /** A forma da MAIOR parte (compatível com quem só conhece uma forma). */
  forma: z.string(),
  /** As partes, da maior para a menor. `forma` vazia = legado migrado. Vazia na venda a prazo. */
  partes: z.array(z.object({ forma: z.string(), valor: centavosNaSaida })),
  tipo: z.string(),
  recebidoEm: z.string(),
})
export type PagamentoNaSaida = z.infer<typeof PagamentoNaSaida>

/**
 * O orçamento num instante, como a correção (B1) o grava em `de` e `para`.
 * `valor` é `null` sem a permissão `valores` — a chave é a que a redação já
 * conhece, e por isso nada novo entra em `CAMPOS_MONETARIOS`.
 */
const RetratoDoOrcamentoNaSaida = z.object({
  valor: centavosNaSaida,
  retomarEm: DiaCivil.nullable(),
  nota: z.string().nullable(),
})

/**
 * Um evento da Jornada, como ele SAI.
 *
 * Chaves por extenso (decisão D-5), não as abreviações do protótipo
 * (`{e, em, por, rot, nota, valor}`): nome no código = nome no glossário =
 * nome na tela. A migration 0007 reescreveu no banco o que o épico 2 gravou
 * com as chaves curtas — duas formas de evento no mesmo `jsonb` faria o funil
 * contar metade dos eventos, em silêncio.
 *
 * `valor` entra aqui, e não só no topo da tarefa, porque é exatamente onde o
 * protótipo VAZA: `saida()` apaga `valorOrcamento` do topo, mas o valor do
 * orçamento e o do fechamento viajam dentro do `historico`, e só a tela os
 * esconde. O `RedacaoInterceptor` percorre em profundidade — e, declarado
 * aqui, `historico[].valor` entra na varredura de `redacao-de-valores`.
 */
export const EventoDeJornada = z.object({
  // `z.enum` DERIVADO do domínio, não uma segunda lista: `acao` e `etapa` são
  // vocabulário de `packages/domain/src/jornada.ts`, e um `z.string()` aqui
  // deixaria o serviço receber uma etapa que a máquina de estados não conhece
  // — para então descobri-lo em tempo de execução, uma etapa adiante.
  acao: z.enum(ACOES),
  etapa: z.enum(ETAPAS),
  em: z.string(),
  porId: z.string(),
  nota: z.string().optional(),
  /** Centavos em texto, ou `null` quando a redação apagou. */
  valor: centavosNaSaida.optional(),
  motivoId: Uuid.optional(),
  /** O NOME do motivo no instante do evento (D-2). Nunca redigido: não é valor. */
  motivo: z.string().optional(),
  /**
   * Só em `corrigirOrcamento` (B1): o orçamento antes e depois. `valor` dentro
   * deles é redigido pela MESMA varredura em profundidade (S-27).
   */
  de: RetratoDoOrcamentoNaSaida.optional(),
  para: RetratoDoOrcamentoNaSaida.optional(),
  chaveIdempotencia: Uuid.optional(),
  /** Só em `fechar`: as chaves dos procedimentos fechados. Ausente = sem detalhamento. */
  itensFechados: z.array(z.string()).optional(),
  /** Só em `fechar` parcial por sessões: quantas sessões ele fechou, por procedimento (menos que as orçadas). */
  sessoesFechadas: z.record(z.string(), z.number().int().positive()).optional(),
  /** Só em `fechar`: o que foi fechado (entrada + em aberto). Redigido sem `valores`. */
  valorFechado: centavosNaSaida.optional(),
})
export type EventoDeJornada = z.infer<typeof EventoDeJornada>

/** As ações do FLUXO da tarefa (ADR 2026-11-14) — separadas das da jornada. */
// `executar`: quem concluiu uma tarefa de PESSOA (pedido 3 — "registrar o usuário
// que executou"). Qualquer um pode concluir a tarefa de outra pessoa, então o
// responsável não prova quem fez; o evento prova.
export const ACOES_DO_FLUXO = ['atribuir', 'transferir', 'assumir', 'concluirPeloGrupo', 'executar'] as const

export const DestinoNaSaida = z.object({ tipo: z.enum(['pessoa', 'grupo']), id: Uuid })
export type DestinoNaSaida = z.infer<typeof DestinoNaSaida>

/**
 * Um evento do FLUXO, como ele SAI. Mora em `historico` (jsonb) ao lado dos da
 * jornada, mas sem `etapa`: os leitores da jornada filtram por `acao`/`etapa` e o
 * ignoram. `de` é `null` em `atribuir` (a tarefa nasceu no grupo) e `para` é
 * `null` em `concluirPeloGrupo` (o grupo é de onde saiu). `porId` é SEMPRE a
 * pessoa que agiu.
 */
export const EventoDeFluxo = z.object({
  acao: z.enum(ACOES_DO_FLUXO),
  em: z.string(),
  porId: z.string(),
  de: DestinoNaSaida.nullable(),
  para: DestinoNaSaida.nullable(),
  nota: z.string().optional(),
})
export type EventoDeFluxo = z.infer<typeof EventoDeFluxo>

/** Um item do programa proposto no orçamento, como ele sai. A costura com o épico 5. */
export const ItemOrcadoNaSaida = z.object({
  procedimentoId: Uuid,
  sessoes: z.number().int(),
  intervaloDias: z.number().int(),
  dose: z.string().optional(),
  responsavelId: Uuid.nullish(),
  valor: centavosNaSaida.optional(),
  chave: z.string(),
  depoisDe: z.string().optional(),
  /** A data da primeira sessão deste item ("Em outra data"), quando houver. */
  inicio: DiaCivil.optional(),
})
export type ItemOrcadoNaSaida = z.infer<typeof ItemOrcadoNaSaida>

/** Um procedimento do orçamento, como ele sai: o que foi proposto, sem sessões nem dose. */
export const ItemDoOrcamentoNaSaida = z.object({
  chave: z.string(),
  procedimentoId: Uuid,
  valor: centavosNaSaida.optional(),
  /** Sessões orçadas do procedimento, quando informadas (lista ou programa). */
  sessoes: z.number().int().positive().optional(),
})
export type ItemDoOrcamentoNaSaida = z.infer<typeof ItemDoOrcamentoNaSaida>

/**
 * A tarefa como as duas telas a leem.
 *
 * `atrasada` vem CALCULADA DO SERVIDOR, contra o dia civil de hoje no fuso da
 * clínica — nunca contra o relógio do navegador (regra 24) e nunca contra o
 * dia que a pessoa está navegando. Navegar para a semana passada não torna
 * tudo atrasado, e navegar para a próxima não desatrasa nada.
 */
export const TarefaNaLista = z.object({
  id: Uuid,
  solicitanteId: Uuid,
  solicitanteNome: z.string(),
  /** `null` na tarefa de GRUPO ainda não assumida (`tarefa_tem_destino`). */
  responsavelId: Uuid.nullable(),
  responsavelNome: z.string().nullable(),
  /** O grupo destino, ou `null` na tarefa de pessoa. O NOME do grupo não é dado pessoal. */
  grupoId: Uuid.nullable(),
  grupoNome: z.string().nullable(),
  /** Para onde a tarefa está AGORA: a pessoa ou o grupo, com o nome. Sempre um dos dois. */
  destino: z.object({ tipo: z.enum(['pessoa', 'grupo']), id: Uuid, nome: z.string() }),
  /** A tarefa de onde esta nasceu, ou `null`. Só o id: a cadeia vem de `/fluxo`. */
  tarefaOrigemId: Uuid.nullable(),
  descricao: z.string(),
  prazo: DiaCivil,
  hora: z.string().nullable(),
  prioridade: z.enum(['normal', 'urgente']),
  status: z.enum(['aberta', 'concluida', 'cancelada']),
  concluidaEm: z.string().nullable(),
  criadaEm: z.string(),
  pacienteId: Uuid.nullable(),
  pacienteNome: z.string().nullable(),
  pacienteTelefone: z.string().nullable(),
  /** A paciente foi cadastrada pela agenda do sistema e espera conferência (ADR 0019). */
  pacienteConferirCadastro: z.boolean(),
  tipo: z.string(),
  etapa: z.enum(ETAPAS).nullable(),
  historico: z.array(EventoDeJornada),
  /**
   * Os eventos do FLUXO (atribuir, transferir, assumir, concluir pelo grupo),
   * separados dos da jornada. Fica visível mesmo sem a permissão `jornada`: a
   * tarefa interna não tem jornada, e quem a enxerga vê por onde ela passou.
   */
  fluxo: z.array(EventoDeFluxo),
  /**
   * Centavos do negócio proposto — **nunca receita** (regra 4).
   *
   * Mede conversão do funil, e nada mais. `null` também para quem não tem
   * `valores`: a forma da resposta não muda com a permissão.
   */
  valorOrcamento: centavosNaSaida,
  /** Centavos que a paciente fechou (entrada + saldo). Redigido como o resto do dinheiro. */
  valorFechado: centavosNaSaida,
  /**
   * Centavos lidos da LISTA IMPORTADA da campanha, ao lado do nome (migration
   * 0080). **Referência, nunca receita** (regras 3 e 4): fora de recebido, LTV,
   * meta e `valorConvertido`. `null` sem `valores` e quando a lista não trazia.
   */
  valorDeReferencia: centavosNaSaida,
  /** Fechou menos do que foi oferecido. Não é dinheiro: aparece para todos. */
  orcamentoParcial: z.boolean(),
  programaOrcado: z.array(ItemOrcadoNaSaida).nullable(),
  /**
   * Os procedimentos LISTADOS no orçamento (conceito próprio, ADR 2026-11-13):
   * os de `itens_orcamento`, ou — migração por leitura — os de
   * `programa_orcado`. `null` = orçamento só com valor, sem lista.
   */
  itensOrcamento: z.array(ItemDoOrcamentoNaSaida).nullable(),
  motivoPerdaId: Uuid.nullable(),
  /** O dia a partir do qual este cartão volta a pedir ação (D-3). */
  proximoPassoEm: DiaCivil.nullable(),
  /** Quem faz o contato da retomada do orçamento, ou `null` (vale responsável/solicitante). */
  contatoId: Uuid.nullable(),
  contatoNome: z.string().nullable(),
  confirmacaoEnviadaEm: z.string().nullable(),
  resultado: z.string(),
  obs: z.string(),
  serieId: Uuid.nullable(),
  recorrencia: z.string(),
  unidadeId: Uuid.nullable(),
  /** A campanha desta ação (A3), ou `null`. Só o id: o nome vem da lista vinculável. */
  campanhaId: Uuid.nullable(),
  /**
   * O KPI desta tarefa (plano de ação ou lançamento), ou `null`. Só id e nome
   * (appsec C27): meta, valor e situação ficam atrás de `indicadores`.
   */
  kpi: KpiDaTarefa.nullable(),
  /**
   * Só na tarefa "Lançar [KPI]" (marcador `lancamento-kpi:`, escrito só pelo
   * servidor): tudo o que a janela D.4 precisa para abrir, para a responsável
   * que NÃO tem `indicadores` (appsec C2) — nunca por `GET /v1/indicadores*`.
   */
  lancamentoDeKpi: LancamentoDeKpiNaTarefa.nullable(),
  atrasada: z.boolean(),
  pagamento: PagamentoNaSaida.nullable(),
  /**
   * A IDENTIDADE DE SESSÃO — `null` em toda tarefa que não é sessão (épico 5).
   *
   * Por que mora aqui e não num contrato próprio: **a mesma tarefa aparece na
   * tela Hoje, na agenda de Programas e na ficha da paciente**, e as três
   * desenham o mesmo cartão. Uma forma separada para a sessão obrigaria a
   * terceira a não saber que o cartão é de um programa — e aí o toque no
   * círculo iria para a rota genérica, que recusa.
   *
   * **O rótulo que a usuária lê sai de `descricao`** ("Aplicação 5/12 ·
   * Tirzepatida 2,5 mg", gravada na montagem), nunca da composição de
   * `indice/total` no front: renomear o procedimento no catálogo não reescreve
   * a história de quem já está em tratamento, e `descricao` é essa história.
   * `indice` e `total` existem para ORDENAR e para a barra de progresso.
   *
   * `programaId` é o que leva o toque para `POST /v1/programas/sessoes/:id/…`
   * em vez da rota genérica, e o que faz o cartão linkar para a ficha do
   * programa.
   */
  sessao: z
    .object({
      programaId: Uuid,
      itemChave: z.string(),
      indice: z.number().int(),
      total: z.number().int(),
    })
    .nullable(),
})
export type TarefaNaLista = z.infer<typeof TarefaNaLista>

/**
 * O que criar, editar, concluir, cancelar e reabrir devolvem.
 *
 * `todas` existe porque uma série nasce com N tarefas e uma edição com
 * `serie: true` muda N — a tela precisa das N, não de uma e um recarregamento.
 * No caso de uma tarefa só, `todas` tem um elemento: nunca `undefined`, para
 * que o cliente não precise de um ramo.
 */
export const TarefasAfetadas = z.object({
  tarefa: TarefaNaLista,
  todas: z.array(TarefaNaLista),
})
export type TarefasAfetadas = z.infer<typeof TarefasAfetadas>

/**
 * UMA tarefa, com o dia de HOJE na clínica.
 *
 * `hoje` vem junto porque o painel de edição o usa como teto da data de
 * realização, e **data de negócio nunca vem do relógio do cliente** (regra
 * 24). A lista já devolve `hoje` pelo mesmo motivo; quem abre o painel por um
 * caminho que não é a lista — a ficha do paciente — precisa dele igual.
 */
export const TarefaParaEditar = z.object({
  tarefa: TarefaNaLista,
  hoje: DiaCivil,
})
export type TarefaParaEditar = z.infer<typeof TarefaParaEditar>

export const ExclusaoDeTarefa = z.object({ id: Uuid, ids: z.array(Uuid) })
export type ExclusaoDeTarefa = z.infer<typeof ExclusaoDeTarefa>

/**
 * O que excluir a tarefa desfaz. `valor` (centavos, texto) é dinheiro: sai
 * `null` sem a permissão `valores`, e a tela então avisa sem o número.
 */
export const PrevisaoDeExclusao = z.object({
  temPagamento: z.boolean(),
  temPrograma: z.boolean(),
  valor: z.string().nullable(),
  /**
   * `true` na SESSÃO DE SUPORTE: o servidor só aceita a exclusão com `motivo`
   * (decisoes.md: justificativa por acesso). É o servidor quem diz — a tela não
   * precisa adivinhar em que sessão está.
   */
  exigeMotivo: z.boolean().default(false),
})
export type PrevisaoDeExclusao = z.infer<typeof PrevisaoDeExclusao>

/* -------------------------------------------------------------------------
 * A CONSULTA
 * ---------------------------------------------------------------------- */

/** Os três escopos do MANUAL cap. 3. `equipe` exige `tarefas.equipe`. */
export const ESCOPOS = ['meu', 'solicitei', 'equipe'] as const
export type Escopo = (typeof ESCOPOS)[number]

export const SITUACOES = ['todas', 'aberta', 'atrasada', 'concluida', 'cancelada'] as const

/**
 * Os períodos da tela, resolvidos NO SERVIDOR.
 *
 * `7dias`, `30dias`, `mes` e `mes-passado` viram datas a partir do dia civil
 * de hoje no fuso da clínica — o cliente manda o NOME do período, nunca as
 * bordas, porque bordas calculadas no navegador são o relógio do cliente
 * decidindo a data de negócio (regra 24).
 */
export const PERIODOS = ['qualquer', '7dias', '30dias', 'mes', 'mes-passado', 'per'] as const

export const ConsultaDeTarefas = z.object({
  escopo: z.enum(ESCOPOS).default('meu'),
  situacao: z.enum(SITUACOES).default('todas'),
  periodo: z.enum(PERIODOS).default('qualquer'),
  /** Só com `periodo=per`. Janela semiaberta `[de, ate+1dia)`, regra 23. */
  de: DiaCivil.optional(),
  ate: DiaCivil.optional(),
  q: z.string().trim().max(120).optional(),
  /** O nome do tipo, ou `__interna` para as tarefas sem paciente. */
  tipo: z.string().trim().max(60).optional(),
  unidadeId: Uuid.optional(),
  /** Uma campanha, ou `__sem` para as tarefas sem campanha. */
  campanhaId: z.union([Uuid, z.literal('__sem')]).optional(),
  solicitanteId: Uuid.optional(),
  responsavelId: Uuid.optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  deslocamento: z.coerce.number().int().min(0).max(100_000).default(0),
})
export type ConsultaDeTarefas = z.infer<typeof ConsultaDeTarefas>

/**
 * `GET v1/tarefas/:id/fluxo` — a cadeia de tarefas ligadas por `tarefaOrigemId`.
 *
 * O nó que a pessoa NÃO enxerga sai como marcador OPACO (`visivel: false`, sem
 * descrição, sem destino, sem nome): a existência da cadeia aparece, o conteúdo
 * não (appsec S2). `posicao` é a ordem do mais antigo (0) ao mais novo.
 */
export const NoDoFluxo = z.discriminatedUnion('visivel', [
  z.object({ visivel: z.literal(false), id: Uuid, posicao: z.number().int() }),
  z.object({
    visivel: z.literal(true),
    id: Uuid,
    posicao: z.number().int(),
    descricao: z.string(),
    status: z.enum(['aberta', 'concluida', 'cancelada']),
    prazo: DiaCivil,
    criadaEm: z.string(),
    concluidaEm: z.string().nullable(),
    destino: z.object({ tipo: z.enum(['pessoa', 'grupo']), id: Uuid, nome: z.string() }),
    pacienteId: Uuid.nullable(),
    eventos: z.array(EventoDeFluxo),
  }),
])
export type NoDoFluxo = z.infer<typeof NoDoFluxo>

export const FluxoDaTarefa = z.object({
  /** A tarefa pedida. */
  raizId: Uuid,
  nos: z.array(NoDoFluxo),
  /** A cadeia foi cortada (profundidade 20 ou ciclo). */
  truncado: z.boolean(),
})
export type FluxoDaTarefa = z.infer<typeof FluxoDaTarefa>

export const ListaDeTarefas = z.object({
  tarefas: z.array(TarefaNaLista),
  total: z.number().int(),
  /** O dia civil de hoje na clínica. A tela nunca o calcula (regra 24). */
  hoje: DiaCivil,
})
export type ListaDeTarefas = z.infer<typeof ListaDeTarefas>

/* -------------------------------------------------------------------------
 * A TELA HOJE
 * ---------------------------------------------------------------------- */

export const ConsultaDeHoje = z.object({
  /** Sem ele, o servidor usa o dia civil DELE no fuso da clínica. */
  dia: DiaCivil.optional(),
  escopo: z.enum(ESCOPOS).default('meu'),
})
export type ConsultaDeHoje = z.infer<typeof ConsultaDeHoje>

/**
 * Uma bolinha da faixa da semana. Contada no SERVIDOR — o front não calcula.
 *
 * `abertas`, e não "tarefas": a faixa desenha o que ainda há POR FAZER
 * naquele dia, que é a pergunta que a recepção faz ao olhar para ela. Uma
 * segunda-feira com dez tarefas todas concluídas não precisa de bolinha.
 *
 * `atrasadas` é um subconjunto de `abertas`: as abertas de um dia JÁ PASSADO,
 * medido contra o hoje do servidor.
 */
export const DiaDaSemana = z.object({
  dia: DiaCivil,
  abertas: z.number().int(),
  atrasadas: z.number().int(),
})
export type DiaDaSemana = z.infer<typeof DiaDaSemana>

export const AniversarianteDoDia = z.object({
  id: Uuid,
  nome: z.string(),
  telefone: z.string(),
  aniversario: DiaCivil,
  /** Já existe tarefa de Aniversário para ele hoje? Então o aviso não insiste. */
  jaTemTarefa: z.boolean(),
})
export type AniversarianteDoDia = z.infer<typeof AniversarianteDoDia>

/**
 * Tudo o que a tela Hoje mostra, composto no SERVIDOR.
 *
 * `hoje` é o dia civil de verdade e `dia` é o que está sendo navegado — os
 * dois existem porque "atrasada" se mede contra o primeiro e a lista se monta
 * a partir do segundo.
 *
 * `ocultasPeloFiltro` é o aviso *"6 tarefas em aberto para hoje não aparecem
 * em 'Para mim'"*. Sem ele a recepção acha que o dia está vazio.
 */
export const RespostaDeHoje = z.object({
  dia: DiaCivil,
  hoje: DiaCivil,
  escopo: z.enum(ESCOPOS),
  semana: z.array(DiaDaSemana),
  aniversariantes: z.array(AniversarianteDoDia),
  pendentes: z.object({ total: z.number().int(), itens: z.array(TarefaNaLista) }),
  tarefas: z.array(TarefaNaLista),
  concluidas: z.array(TarefaNaLista),
  ocultasPeloFiltro: z.number().int(),
  /** Para qual escopo o aviso manda olhar. `null` quando não há aviso. */
  escopoComAsOcultas: z.enum(ESCOPOS).nullable(),

  /* ----------------------------------------------------- os três da jornada */

  /**
   * **Pacientes que faltaram ou desmarcaram.** Ficam aqui TODO DIA, até
   * alguém reagendar ou encerrar.
   *
   * Estes cartões **saem** de `tarefas`, de `pendentes` e da contagem de
   * `semana` — e é de propósito: um cartão que faltou há três semanas não é
   * uma tarefa atrasada que alguém esqueceu, é um recontato pendente, e ele
   * já tem seção própria. Misturar os dois faz a recepção ver "15 pendentes"
   * todo dia e parar de olhar.
   *
   * Vazio para quem não tem a permissão `jornada`.
   */
  recontatar: z.array(TarefaNaLista),
  /** *"Confirmar os agendamentos de amanhã."* `prazo = hoje + 1`, do servidor. */
  paraConfirmar: z.array(TarefaNaLista),
  /** *"Orçamentos para retomar o contato."* `proximoPassoEm <= hoje`, do mais antigo. */
  retomar: z.array(TarefaNaLista),
})
export type RespostaDeHoje = z.infer<typeof RespostaDeHoje>
