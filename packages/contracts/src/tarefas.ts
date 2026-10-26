import { ACOES, ehPagamento, ETAPAS, FREQUENCIAS, TIPOS } from '@fir/domain'
import { z } from 'zod'
import { centavosNaSaida, DiaCivil, dinheiroEmTexto, Hora, Uuid } from './comum'

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
  forma: z.string(),
  tipo: z.string(),
  recebidoEm: z.string(),
})
export type PagamentoNaSaida = z.infer<typeof PagamentoNaSaida>

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
})
export type EventoDeJornada = z.infer<typeof EventoDeJornada>

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
})
export type ItemOrcadoNaSaida = z.infer<typeof ItemOrcadoNaSaida>

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
  responsavelId: Uuid,
  responsavelNome: z.string(),
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
  tipo: z.string(),
  etapa: z.enum(ETAPAS).nullable(),
  historico: z.array(EventoDeJornada),
  /**
   * Centavos do negócio proposto — **nunca receita** (regra 4).
   *
   * Mede conversão do funil, e nada mais. `null` também para quem não tem
   * `valores`: a forma da resposta não muda com a permissão.
   */
  valorOrcamento: centavosNaSaida,
  programaOrcado: z.array(ItemOrcadoNaSaida).nullable(),
  motivoPerdaId: Uuid.nullable(),
  /** O dia a partir do qual este cartão volta a pedir ação (D-3). */
  proximoPassoEm: DiaCivil.nullable(),
  confirmacaoEnviadaEm: z.string().nullable(),
  resultado: z.string(),
  obs: z.string(),
  serieId: Uuid.nullable(),
  recorrencia: z.string(),
  unidadeId: Uuid.nullable(),
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

export const ExclusaoDeTarefa = z.object({ id: Uuid, ids: z.array(Uuid) })
export type ExclusaoDeTarefa = z.infer<typeof ExclusaoDeTarefa>

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
  solicitanteId: Uuid.optional(),
  responsavelId: Uuid.optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  deslocamento: z.coerce.number().int().min(0).max(100_000).default(0),
})
export type ConsultaDeTarefas = z.infer<typeof ConsultaDeTarefas>

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
