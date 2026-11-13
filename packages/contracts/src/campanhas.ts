import { z } from 'zod'
import { DiaCivil, Uuid, centavosNaSaida, dinheiroEmTexto } from './comum'
import { NomeDeTipo, TarefaNaLista, tipoQueNaoEhPagamento } from './tarefas'

/**
 * **Comercial › Campanhas** (MANUAL cap. 9).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A META VIAJA EM DOIS CAMPOS PARALELOS, E EXATAMENTE UM É PREENCHIDO
 *
 * Das quatro métricas, **uma é dinheiro** (`receita`, em centavos) e três são
 * contagem. É o mesmo desenho de `MetaDePessoa`, e pela mesma razão: a regra
 * 17 exige que o servidor apague o dinheiro de quem não tem `valores`, e que
 * a tela não precise de um `if`.
 *
 *   `metaEmDinheiro` / `resultadoEmDinheiro` / `receita` — centavos, **em
 *      `CAMPOS_MONETARIOS`**: o `RedacaoInterceptor` os apaga por nome de
 *      chave. É a redação que o protótipo faz com um `vVal()` na tela
 *      (`oculto: c.metrica==="receita" && !vVal()`), que é um `if` por tela.
 *
 *   `metaEmNumero` / `resultadoEmNumero` — contagem, **fora** de
 *      `CAMPOS_MONETARIOS`: a recepção sem `valores` precisa ver "38 de 40
 *      contatos". É o mesmo raciocínio de `saldoEmEstoque` e de
 *      `saldoEmMinutos`.
 *
 *   `percentualDaMeta` — numa campanha de RECEITA, **`null` sem `valores`**
 *      (o protótipo mostra "Resultado visível para o administrativo", sem
 *      percentual e sem barra; ADR 2026-11-13, emenda): com meta e resultado
 *      conhecidos o percentual é a receita em claro. Nas de contagem atravessa.
 *   `taxaDeConversao` — **nunca redigida**: é contagem sobre contagem.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **Nenhum resultado é gravado** (regra 11): tudo abaixo que não é cadastro é
 * contagem derivada de `tarefas` e `recebimentos`, feita no servidor.
 */

/** As quatro de `METRICAS`, no protótipo, com o texto dela. */
export const METRICAS_DE_CAMPANHA = [
  {
    chave: 'convertidos',
    nome: 'Pacientes convertidos',
    ajuda:
      'Pacientes da campanha com consulta, procedimento ou orçamento pago concluído.',
  },
  {
    chave: 'contatos',
    nome: 'Contatos realizados',
    ajuda:
      'Contatos concluídos com pacientes (mensagens, ligações, follow-ups), sem contar pagamentos.',
  },
  {
    chave: 'tipo',
    nome: 'Tipo de contato concluído',
    ajuda: 'Quantidade de tarefas concluídas do tipo escolhido.',
  },
  {
    chave: 'receita',
    nome: 'Receita gerada (R$)',
    ajuda:
      'Soma dos pagamentos (de consulta, de orçamento e de saldo em aberto) vinculados à campanha.',
  },
] as const

export type MetricaDeCampanha = (typeof METRICAS_DE_CAMPANHA)[number]['chave']

export const MetricaDaCampanha = z.enum(
  METRICAS_DE_CAMPANHA.map((m) => m.chave) as [MetricaDeCampanha, ...MetricaDeCampanha[]],
)

/** `receita` é a única em dinheiro — e isso vale no contrato e no serviço. */
export const METRICA_EM_DINHEIRO: MetricaDeCampanha = 'receita'

/** O limite de linhas de uma importação. É o `MAX_IMPORT` dela. */
export const MAX_LINHAS_DA_CAMPANHA = 2000

// ---------------------------------------------------------------------------
// ESCRITA
// ---------------------------------------------------------------------------

/**
 * `salvarCampanha` — criar e editar pela mesma forma.
 *
 * O `superRefine` cobra as duas bicondicionais que o banco também cobra
 * (`tipo_combina_com_metrica` e a escala da meta), para que a recusa seja
 * mensagem de tela e não erro de Postgres.
 */
export const SalvarCampanha = z
  .object({
    categoria: z.string().trim().max(60).default('Outra'),
    foco: z.string().trim().max(80).default(''),
    nome: z.string().trim().min(1, 'Dê um nome à campanha.').max(80),
    objetivo: z.string().trim().max(400).default(''),
    inicio: DiaCivil,
    fim: DiaCivil,
    metrica: MetricaDaCampanha,
    /**
     * O nome do tipo de tarefa. **Só** quando a métrica é `tipo`.
     *
     * Vazio é permitido aqui e cobrado no `superRefine`: a bicondicional
     * "tipo ⟺ métrica `tipo`" não cabe num validador de campo.
     */
    tipoMetrica: z.union([z.literal(''), NomeDeTipo]).default(''),
    /** Centavos. **Só** para `receita`. */
    metaEmDinheiro: dinheiroEmTexto.default(null),
    /** Contagem. Para as outras três. */
    metaEmNumero: z.number().int().positive().max(1_000_000).nullable().default(null),
  })
  .strict()
  .superRefine((d, ctx) => {
    const erra = (path: string, message: string): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message })
    }
    if (d.fim < d.inicio) erra('fim', 'A campanha não pode terminar antes de começar.')

    if (d.metrica === METRICA_EM_DINHEIRO) {
      if (d.metaEmNumero !== null) erra('metaEmNumero', 'Esta meta é em reais.')
      if (d.metaEmDinheiro === null || d.metaEmDinheiro <= 0n) {
        erra('metaEmDinheiro', 'Informe a meta em reais.')
      }
    } else {
      if (d.metaEmDinheiro !== null) erra('metaEmDinheiro', 'Esta meta não é em reais.')
      if (d.metaEmNumero === null) erra('metaEmNumero', 'Informe a meta.')
    }

    /**
     * **O tipo viaja com a métrica, ou não viaja.**
     *
     * *"Tipo de contato concluído"* sem dizer QUAL tipo é uma meta que conta
     * zero para sempre — e o protótipo aceita exatamente isso, porque o
     * `select` dele nasce com o primeiro tipo selecionado e nada confere.
     *
     * O NOME do tipo é validado por `NomeDeTipo`, a mesma regra de
     * `tarefas.ts`: um nome fora da tabela viraria uma campanha que nunca
     * pontua, sem erro nenhum.
     */
    if (d.metrica === 'tipo') {
      if (d.tipoMetrica === '') erra('tipoMetrica', 'Escolha o tipo de contato.')
    } else if (d.tipoMetrica !== '') {
      erra('tipoMetrica', 'O tipo só existe na métrica por tipo de contato.')
    }
  })
export type SalvarCampanha = z.infer<typeof SalvarCampanha>

/** Uma linha da lista importada para a campanha. */
export const LinhaDaCampanha = z
  .object({
    nome: z.string().trim().max(120),
    telefone: z.string().trim().max(30).default(''),
    aniversario: z.string().trim().max(10).default(''),
    prazo: DiaCivil,
    responsavelId: Uuid,
    obs: z.string().trim().max(300).default(''),
    /**
     * O valor que a lista trazia ao lado do nome, em centavos (a tela tira o
     * "- R$ 15.200" do nome e o manda aqui). **Referência, nunca receita**
     * (regras 3 e 4); vira `tarefas.valor_de_referencia`. Ausente: o servidor
     * tenta ler do próprio nome.
     */
    valorDeReferencia: dinheiroEmTexto
      .refine((v) => v === null || v >= 0n, 'o valor da lista não pode ser negativo')
      .optional(),
  })
  .strict()
export type LinhaDaCampanha = z.infer<typeof LinhaDaCampanha>

/**
 * `importarCampanha` — a lista vira paciente mais tarefa, de uma vez.
 *
 * **Idempotente por esquema** (regra 26): o índice `tarefa_viva_da_campanha`
 * garante no máximo uma tarefa ABERTA por (campanha, paciente). Importar o
 * mesmo arquivo três vezes cria a tarefa uma vez, e a segunda e a terceira
 * devolvem tudo em `ignoradas`. O protótipo confere com `some()` antes de
 * empurrar, e duas abas atravessam juntas.
 */
export const ImportarCampanha = z
  .object({
    /**
     * O tipo da tarefa que cada linha vira. Um só para o lote, como nela.
     *
     * **`tipoQueNaoEhPagamento`, a mesma regra de `POST /v1/tarefas`:**
     * pagamento não é tarefa (regra 3). Uma importação de 300 linhas de
     * "Pagamento de consulta" criaria 300 contagens do mesmo dinheiro.
     */
    tipo: tipoQueNaoEhPagamento,
    /** Vazio = "Contato da campanha: <nome>", montado pelo SERVIDOR. */
    descricao: z.string().trim().max(400).default(''),
    linhas: z.array(LinhaDaCampanha).min(1).max(MAX_LINHAS_DA_CAMPANHA),
  })
  .strict()
export type ImportarCampanha = z.infer<typeof ImportarCampanha>

export const CampanhaImportada = z
  .object({
    /** Tarefas criadas. */
    criadas: z.number().int(),
    /** Pacientes que não existiam e foram cadastrados agora. */
    novosPacientes: z.number().int(),
    /** Pacientes já cadastrados que tiveram um campo VAZIO completado. */
    pacientesCompletados: z.number().int(),
    /**
     * Linhas que não viraram tarefa: sem nome, com responsável inválido,
     * repetidas no arquivo, **ou com a tarefa desta campanha já aberta**.
     *
     * É a terceira que torna a reimportação segura — e o número existe para
     * que *"importei de novo e não aconteceu nada"* seja uma resposta e não um
     * silêncio.
     */
    ignoradas: z.number().int(),
  })
  .strict()
export type CampanhaImportada = z.infer<typeof CampanhaImportada>

// ---------------------------------------------------------------------------
// LEITURA
// ---------------------------------------------------------------------------

export const SituacaoDaCampanha = z.enum(['futura', 'andamento', 'encerrada'])
export type SituacaoDaCampanha = z.infer<typeof SituacaoDaCampanha>

/**
 * Uma campanha, com o resultado já contado pelo SERVIDOR.
 *
 * A tela **não calcula nada aqui**: nem o resultado, nem o percentual, nem a
 * taxa de conversão, nem a situação, nem quantos dias faltam. O protótipo
 * calcula os cinco no navegador (`statsCamp`, `situacaoCamp`), com `today()`
 * do aparelho — e aí o celular adiantado da recepção encerra a campanha um dia
 * antes.
 */
export const CampanhaNaLista = z
  .object({
    id: Uuid,
    categoria: z.string(),
    foco: z.string(),
    nome: z.string(),
    objetivo: z.string(),
    inicio: DiaCivil,
    fim: DiaCivil,
    metrica: MetricaDaCampanha,
    tipoMetrica: z.string(),
    /** O rótulo da meta, pronto: o tipo escolhido, ou o nome da métrica. */
    rotuloDaMeta: z.string(),

    /** Centavos. Preenchido só em `receita`. **Redigido sem `valores`.** */
    metaEmDinheiro: centavosNaSaida,
    /** Contagem. Nunca redigido. */
    metaEmNumero: z.number().int().nullable(),
    /** Centavos. Preenchido só em `receita`. **Redigido sem `valores`.** */
    resultadoEmDinheiro: centavosNaSaida,
    /** Contagem. Nunca redigido. */
    resultadoEmNumero: z.number().int().nullable(),
    /**
     * O atingimento, em percentual inteiro. Pode passar de 100.
     * **`null` numa campanha de RECEITA sem `valores`** (decisão do dono, segue
     * o protótipo): com a meta conhecida, o percentual devolve a receita.
     * Campanha de contagem: atravessa para todos.
     */
    percentualDaMeta: z.number().int().nullable(),

    /** A receita gerada, sempre — mesmo quando a métrica é outra. Redigida. */
    receita: centavosNaSaida,

    situacao: SituacaoDaCampanha,
    /** A frase da situação, pronta: "Em andamento · 12 dias restantes". */
    rotuloDaSituacao: z.string(),

    /** Tarefas vivas da campanha (nem canceladas nem excluídas). */
    tarefas: z.number().int(),
    tarefasConcluidas: z.number().int(),
    tarefasAbertas: z.number().int(),
    contatos: z.number().int(),
    /** Pacientes com alguma tarefa concluída na campanha. */
    pacientesAlcancados: z.number().int(),
    /** Destes, os que tiveram atendimento ou orçamento pago concluído. */
    pacientesConvertidos: z.number().int(),
    /** `convertidos ÷ alcançados`, em percentual inteiro. `null` sem base. */
    taxaDeConversao: z.number().int().nullable(),
  })
  .strict()
export type CampanhaNaLista = z.infer<typeof CampanhaNaLista>

/**
 * `GET /v1/campanhas?mes=aaaa-mm|atual&tipo=<categoria>` — a lista do protótipo
 * (`vCampanhas`): navegação por mês e filtro "Tipo de campanha".
 *
 * `atual` é o mês de HOJE na clínica, resolvido no servidor (regra 24): o
 * navegador não decide em que mês a campanha está. Sem `mes`, a lista vem
 * inteira — é o que as outras telas (painel, formulário) usam.
 *
 * O mês filtra pelo que a campanha **cruza**, não pelo que está dentro dele:
 * `inicio <= último dia do mês AND fim >= primeiro dia` (o `campsDoMes` dela).
 */
export const MesDaCampanha = z.union([
  z.literal('atual'),
  z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato aaaa-mm.'),
])
export const ConsultaDeCampanhas = z
  .object({
    mes: MesDaCampanha.optional(),
    tipo: z.string().trim().max(60).optional(),
  })
  .strict()
export type ConsultaDeCampanhas = z.infer<typeof ConsultaDeCampanhas>

/**
 * Os três números do alto da lista (`campkpis`). Somados no SERVIDOR sobre as
 * campanhas que a lista mostra (mês e tipo já aplicados).
 *
 * `valorConvertido` é dinheiro e **está em `CAMPOS_MONETARIOS`**: sem `valores`
 * sai `null` e a tela esconde o cartão. As duas contagens atravessam.
 */
export const TotaisDoMes = z
  .object({
    campanhas: z.number().int(),
    valorConvertido: centavosNaSaida,
    pacientesConvertidos: z.number().int(),
    acoesRealizadas: z.number().int(),
  })
  .strict()
export type TotaisDoMes = z.infer<typeof TotaisDoMes>

export const Campanhas = z
  .object({
    /** O dia da clínica, do SERVIDOR — é ele que decide a situação. */
    hoje: DiaCivil,
    /** O mês mostrado (`aaaa-mm`), ou `null` quando a lista veio sem recorte. */
    mes: z.string().nullable(),
    campanhas: z.array(CampanhaNaLista),
    /** As categorias já usadas pela clínica, para a lista de escolha. */
    categorias: z.array(z.string()),
    totais: TotaisDoMes,
  })
  .strict()
export type Campanhas = z.infer<typeof Campanhas>

// ---------------------------------------------------------------------------
// O DETALHE DA CAMPANHA (`vCampanha` do protótipo)
// ---------------------------------------------------------------------------

/**
 * O funil. Tudo contado no servidor com a MESMA consulta da lista (`montar`):
 * a campanha mostra aqui o mesmo número que mostrou no cartão.
 *
 * `percentualRealizado` é "% do planejado" (`realizadas ÷ planejadas`, 0 sem
 * planejadas, como no protótipo). `conversoes` é a contagem que o protótipo
 * rotula "pagamentos": tarefas concluídas, com paciente, de tipo que atende.
 * `receita` é dinheiro: redigida sem `valores`.
 */
export const FunilDaCampanha = z
  .object({
    planejadas: z.number().int(),
    emAberto: z.number().int(),
    realizadas: z.number().int(),
    percentualRealizado: z.number().int(),
    alcancados: z.number().int(),
    convertidos: z.number().int(),
    taxaDeConversao: z.number().int().nullable(),
    conversoes: z.number().int(),
    receita: centavosNaSaida,
  })
  .strict()
export type FunilDaCampanha = z.infer<typeof FunilDaCampanha>

/** `tipo === ''` são as tarefas internas ("Tarefas internas"). */
export const LinhaPorTipo = z
  .object({
    tipo: z.string(),
    rotulo: z.string(),
    planejadas: z.number().int(),
    realizadas: z.number().int(),
    /** Receita das realizadas daquele tipo. Redigida sem `valores`. */
    valor: centavosNaSaida,
  })
  .strict()
export type LinhaPorTipo = z.infer<typeof LinhaPorTipo>

export const LinhaPorPessoa = z
  .object({
    pessoaId: Uuid,
    nome: z.string(),
    planejadas: z.number().int(),
    realizadas: z.number().int(),
  })
  .strict()
export type LinhaPorPessoa = z.infer<typeof LinhaPorPessoa>

export const CampanhaDetalhe = z
  .object({
    hoje: DiaCivil,
    campanha: CampanhaNaLista,
    funil: FunilDaCampanha,
    /** `resultado >= meta`. A frase "Meta atingida." / "Faltam X" é da tela. */
    metaAtingida: z.boolean(),
    /** O que falta, em centavos (métrica `receita`). Redigido sem `valores`. */
    faltaEmDinheiro: centavosNaSaida,
    /** O que falta, em contagem (as outras três métricas). */
    faltaEmNumero: z.number().int().nullable(),
    porTipo: z.array(LinhaPorTipo),
    porPessoa: z.array(LinhaPorPessoa),
    /** "Histórico · <foco ou categoria>". */
    tituloDoHistorico: z.string(),
    /** As campanhas do mesmo tipo (a atual incluída), da mais recente para a mais antiga. */
    historico: z.array(CampanhaNaLista),
  })
  .strict()
export type CampanhaDetalhe = z.infer<typeof CampanhaDetalhe>

/**
 * Os recortes que os números do funil e das tabelas abrem (o `drill` do
 * protótipo). Cada um é um conjunto de tarefas, definido no servidor — a tela
 * só escolhe o nome.
 */
export const RECORTES_DA_CAMPANHA = [
  'planejadas',
  'realizadas',
  'alcancadas',
  'conversoes',
  'resultado',
  'tipo-planejadas',
  'tipo-realizadas',
  'pessoa-planejadas',
  'pessoa-realizadas',
] as const
export type RecorteDaCampanha = (typeof RECORTES_DA_CAMPANHA)[number]

/**
 * `GET /v1/campanhas/:id/tarefas`. **Todas as tarefas da campanha**, para quem
 * tem a permissão `campanhas` — não o recorte de `escopo` de `/v1/tarefas`
 * (decisão do dono, ADR 2026-11-13). Sem `recorte`, vale `situacao`; com
 * `recorte`, ele manda.
 */
export const ConsultaDeTarefasDaCampanha = z
  .object({
    situacao: z.enum(['tudo', 'abertas', 'concluidas']).default('tudo'),
    recorte: z.enum(RECORTES_DA_CAMPANHA).optional(),
    /** Com `tipo-*`: o nome do tipo, ou `__interna` para as sem tipo. */
    tipo: z.string().trim().max(60).optional(),
    /** Com `pessoa-*`. */
    pessoaId: Uuid.optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
    deslocamento: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict()
export type ConsultaDeTarefasDaCampanha = z.infer<typeof ConsultaDeTarefasDaCampanha>

export const TarefasDaCampanha = z
  .object({
    hoje: DiaCivil,
    tarefas: z.array(TarefaNaLista),
    total: z.number().int(),
    /**
     * A soma da receita do recorte aberto (o `tot` do `drill`). `null` sem
     * recorte — e `null` sem `valores`, em `CAMPOS_MONETARIOS`.
     */
    valorTotal: centavosNaSaida,
  })
  .strict()
export type TarefasDaCampanha = z.infer<typeof TarefasDaCampanha>

/**
 * `GET /v1/campanhas/:id/proximo-mes` — o rascunho de "Repetir no próximo mês".
 *
 * Como no protótipo, **nada é criado**: o rascunho abre o formulário de nova
 * campanha, e a gestora confere (o nome precisa mudar — o índice
 * `campanha_por_nome` recusa dois iguais). As datas saem do servidor: mês
 * inteiro vira o mês seguinte inteiro, e dia 29–31 cai no último dia do mês
 * curto (regra 25). A meta em reais viaja redigida sem `valores`.
 */
export const RascunhoDeCampanha = z
  .object({
    categoria: z.string(),
    foco: z.string(),
    nome: z.string(),
    objetivo: z.string(),
    inicio: DiaCivil,
    fim: DiaCivil,
    metrica: MetricaDaCampanha,
    tipoMetrica: z.string(),
    metaEmDinheiro: centavosNaSaida,
    metaEmNumero: z.number().int().nullable(),
  })
  .strict()
export type RascunhoDeCampanha = z.infer<typeof RascunhoDeCampanha>

// ---------------------------------------------------------------------------
// AS CAMPANHAS VINCULÁVEIS (correções da PO, A3)
// ---------------------------------------------------------------------------

/**
 * `GET /v1/campanhas/vinculaveis?contexto=tarefa|paciente[&incluir=<uuid>]`.
 *
 * A janela é `campanhasVinculaveis` de `packages/domain` — a mesma função que
 * valida a escrita. `incluir` acrescenta a campanha ATUAL do registro em
 * edição, mesmo encerrada ou excluída (N-4).
 *
 * **`paciente` NÃO existe aqui** (L-A3-8). A sugestão é a campanha de ORIGEM
 * da paciente, e essa leitura precisa de trilha de acesso com o id dela: sai
 * de `GET /v1/pacientes/:id/campanha-sugerida` (`CampanhaSugerida`). O
 * `.strict()` faz o cliente antigo que ainda manda `?paciente=` levar 400 —
 * ignorar em silêncio esconderia quem não migrou.
 */
export const ConsultaDeCampanhasVinculaveis = z
  .object({
    contexto: z.enum(['tarefa', 'paciente']),
    incluir: Uuid.optional(),
  })
  .strict()
export type ConsultaDeCampanhasVinculaveis = z.infer<typeof ConsultaDeCampanhasVinculaveis>

/**
 * **Só `id` e `nome`** (S-9, L-A3-2, AB-A3-1). Esta rota é de quem cria
 * tarefa, recebe ou cadastra — inclusive quem NÃO tem a permissão
 * `campanhas` —, e por isso é OUTRO contrato, não `CampanhaNaLista` com campos
 * nulos: meta, receita, resultado e contagens não existem aqui nem como chave.
 * `.strict()` nos dois níveis: a chave nova que alguém acrescentar no SELECT
 * quebra o parse do teste de forma, em vez de atravessar.
 */
export const CampanhaVinculavel = z.object({ id: Uuid, nome: z.string() }).strict()
export type CampanhaVinculavel = z.infer<typeof CampanhaVinculavel>

export const CampanhasVinculaveis = z
  .object({
    itens: z.array(CampanhaVinculavel),
  })
  .strict()
export type CampanhasVinculaveis = z.infer<typeof CampanhasVinculaveis>

/**
 * `GET /v1/pacientes/:id/campanha-sugerida` (L-A3-8, L-A3-9) — a sugestão da
 * Nova tarefa e do Recebimento (`campanhaDoPaciente` do protótipo).
 *
 * **Resposta mínima.** Só o uuid e o porquê, que a tela mostra ("chegou por
 * esta campanha" / "tarefa recente nesta campanha"). Sem nome da campanha (a
 * tela já o tem da lista vinculável), sem id, data ou descrição de tarefa, e
 * sem a origem quando ela não está em andamento. `.strict()`: a chave nova que
 * alguém puser na resposta quebra o teste de forma, em vez de atravessar.
 */
export const MOTIVOS_DE_SUGESTAO = ['origem', 'tarefa'] as const
export const CampanhaSugerida = z
  .object({
    sugerida: Uuid.nullable(),
    motivo: z.enum(MOTIVOS_DE_SUGESTAO).nullable(),
  })
  .strict()
export type CampanhaSugerida = z.infer<typeof CampanhaSugerida>
