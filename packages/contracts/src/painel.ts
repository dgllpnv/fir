import { z } from 'zod'
import { CampanhaNaLista } from './campanhas'
import { DiaCivil, Uuid, centavosNaSaida } from './comum'

/**
 * **Gestão › Painel geral** (MANUAL cap. 10) — a tela da CLÍNICA.
 *
 * *"Cumprimento de prazos da equipe, receita registrada, ticket médio,
 * contatos, orçamentos, formas de pagamento … no período escolhido."*
 *
 * **Não confundir com o painel do SUPERADMIN**, que mora em `superadmin.ts`:
 * são dois espaços de identidade disjuntos, e `CONTEXT.md` abre proibindo
 * chamar o segundo de `painel` — `painel` é a chave de permissão desta tela
 * aqui, e a allowlist de IP do Traefik casa o segmento `superadmin`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA ROTA NÃO DEVOLVE NÚMERO QUE A TELA PRECISE DIVIDIR
 *
 * Toda taxa (`taxaNoPrazo`, `conversaoDeOrcamentos`, o `percentual` de cada
 * forma) vem **em percentual inteiro, pronto**, e todo total vem somado. A
 * tela desenha. O protótipo calcula os quinze no navegador (`metricas`,
 * `vPainel`), com `today()` do aparelho — e aí o celular adiantado da recepção
 * conta como vencida a tarefa de amanhã.
 *
 * **`painel` → `valores` na matriz de permissões**, então quem abre esta tela
 * sempre vê dinheiro. Mesmo assim os campos monetários passam pela redação: a
 * dependência entre chaves vive na TABELA (regra 16), não numa suposição de
 * que ela nunca vai mudar.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Os cinco de `PERIODOS`, no protótipo. */
export const PERIODOS_DO_PAINEL = [
  { chave: '7d', rotulo: '7 dias' },
  { chave: '30d', rotulo: '30 dias' },
  { chave: 'mes', rotulo: 'Este mês' },
  { chave: 'ant', rotulo: 'Mês passado' },
  { chave: 'per', rotulo: 'Personalizado' },
] as const

export type ChaveDePeriodo = (typeof PERIODOS_DO_PAINEL)[number]['chave']

export const PeriodoDoPainel = z.enum(
  PERIODOS_DO_PAINEL.map((p) => p.chave) as [ChaveDePeriodo, ...ChaveDePeriodo[]],
)

/**
 * O pedido: a chave do período e, só em `per`, as duas bordas.
 *
 * **As bordas dos quatro períodos fixos são resolvidas no SERVIDOR** — `7d` é
 * `[hoje − 6, hoje]` no fuso da clínica, e `mes` é o mês civil de lá. A tela
 * manda a CHAVE, nunca as datas calculadas, pela regra 24: data de negócio não
 * vem do relógio do cliente.
 */
export const FiltroDoPainel = z
  .object({
    periodo: PeriodoDoPainel.default('30d'),
    de: DiaCivil.optional(),
    ate: DiaCivil.optional(),
    /**
     * A janela do **Top 10 pagantes** — *"no período ou desde o início"*.
     *
     * É o `S.topModo` dela, e viaja no MESMO filtro em vez de virar rota
     * própria: os dois modos leem o mesmo dado com a mesma regra, e uma
     * segunda rota seria um segundo lugar onde o corte de caixa fechado pode
     * ser esquecido.
     */
    top: z.enum(['periodo', 'tudo']).default('periodo'),
  })
  .strict()
  .refine((f) => f.periodo !== 'per' || (f.de !== undefined && f.ate !== undefined), {
    path: ['de'],
    message: 'Informe as duas datas do período personalizado.',
  })
  .refine((f) => f.de === undefined || f.ate === undefined || f.de <= f.ate, {
    path: ['ate'],
    message: 'A data final não pode ser anterior à inicial.',
  })
export type FiltroDoPainel = z.infer<typeof FiltroDoPainel>

/**
 * O CUMPRIMENTO DE PRAZOS de um conjunto de tarefas — as quatro situações.
 *
 * `taxaNoPrazo` divide `noPrazo` por `noPrazo + comAtraso + atrasadas`, e
 * **não** pelo total: o que ainda não venceu não pode estar no prazo nem fora
 * dele. É o `base` do protótipo, e trocar o denominador pelo total faz a taxa
 * de quem planejou o mês inteiro despencar sem que nada tenha piorado.
 *
 * `null` sem denominador — nunca `0%`, que acusaria alguém que não atrasou
 * nada. Mesma distinção de `percentualNoPrazo`.
 */
export const CumprimentoDePrazos = z
  .object({
    total: z.number().int(),
    noPrazo: z.number().int(),
    comAtraso: z.number().int(),
    atrasadas: z.number().int(),
    aVencer: z.number().int(),
    taxaNoPrazo: z.number().int().nullable(),
  })
  .strict()
export type CumprimentoDePrazos = z.infer<typeof CumprimentoDePrazos>

export const LinhaPorResponsavel = CumprimentoDePrazos.extend({
  pessoaId: Uuid,
  nome: z.string(),
  funcao: z.string(),
}).strict()
export type LinhaPorResponsavel = z.infer<typeof LinhaPorResponsavel>

/**
 * "Quem solicitou" — **pela data de CRIAÇÃO da tarefa**, não pelo prazo.
 *
 * São duas perguntas diferentes e dois recortes diferentes: *"quem está
 * entregando no prazo"* olha o prazo; *"quem está pedindo trabalho"* olha
 * quando o pedido foi feito. A nota da tela dela diz exatamente isso.
 */
export const LinhaPorSolicitante = z
  .object({
    pessoaId: Uuid,
    nome: z.string(),
    solicitadas: z.number().int(),
    paraSiMesma: z.number().int(),
    paraAEquipe: z.number().int(),
  })
  .strict()
export type LinhaPorSolicitante = z.infer<typeof LinhaPorSolicitante>

export const FormaNoPainel = z
  .object({
    forma: z.string(),
    pagamentos: z.number().int(),
    valor: centavosNaSaida,
    /** A fatia da receita do período, em percentual inteiro. Do servidor. */
    percentual: z.number().int().nullable(),
  })
  .strict()
export type FormaNoPainel = z.infer<typeof FormaNoPainel>

export const TipoNoPainel = z
  .object({
    tipo: z.string(),
    /** Tarefas desse tipo com PRAZO no período. */
    comPrazoNoPeriodo: z.number().int(),
    /** Tarefas desse tipo CONCLUÍDAS no período. */
    concluidasNoPeriodo: z.number().int(),
    valor: centavosNaSaida,
  })
  .strict()
export type TipoNoPainel = z.infer<typeof TipoNoPainel>

/**
 * PACIENTES NO PERÍODO — *"contatos e valores contam pela data em que a tarefa
 * foi concluída"*, exatamente como a nota da tela dela.
 */
export const PacientesNoPainel = z
  .object({
    receita: centavosNaSaida,
    pagamentos: z.number().int(),
    /** Pacientes DISTINTOS com atendimento concluído no período. */
    pacientesAtendidos: z.number().int(),
    /**
     * `receita ÷ pagamentos`, calculado pelo value object `Dinheiro` (regra
     * 1). `null` sem pagamento nenhum — `R$ 0,00` diria que o ticket médio é
     * zero, e ele não existe.
     */
    ticketMedio: centavosNaSaida,
    contatos: z.number().int(),
    orcamentosPagos: z.number().int(),
    valorDosOrcamentosPagos: centavosNaSaida,
    orcamentosEnviados: z.number().int(),
    /**
     * `fechados ÷ enviados`, em percentual inteiro, **limitado a 100**.
     *
     * Contado por **`acao` declarada** (ADR 0004), nunca por rótulo nem por
     * cruzamento de paciente e data. O protótipo soma aqui dois conjuntos
     * diferentes — eventos da jornada MAIS tarefas de "Orçamento enviado"
     * cujo paciente teve um pagamento em data posterior —, e a segunda metade
     * conta de novo o que a primeira já contou; daí o `Math.min(100, …)` que
     * ele precisa pôr em volta do resultado.
     *
     * `null` sem nenhum orçamento enviado: dividir por zero não diz nada.
     */
    conversaoDeOrcamentos: z.number().int().nullable(),

    /**
     * **O RECEBIDO POR FORMA, E SÓ DOS DIAS COM CAIXA JÁ FECHADO** (regra 6).
     *
     * Este é o campo perigoso do painel, e a razão é a mesma de
     * `visao-do-mes`: *"o recebido por forma de um período em curso é o
     * esperado somado com outro nome"*. A conferência às cegas protege o
     * agregado **por forma de pagamento num dia**, e um período personalizado
     * de `de = ate = hoje` entregaria exatamente isso.
     *
     * **O protótipo vaza aqui** — ele agrupa `rec` por `formaPagamento` no
     * navegador, sem olhar caixa nenhum, e a recepcionista que vai conferir a
     * gaveta pode abrir o Painel e ler o esperado por forma do próprio dia.
     * Divergência consciente, e é a mesma defesa que o épico 4 já construiu.
     *
     * `porFormaAteODia` e `porFormaDiasSemCaixa` DECLARAM o recorte: sem eles
     * a tabela parece o período inteiro, e a gestora compara uma soma parcial
     * com um total sem saber.
     */
    porForma: z.array(FormaNoPainel),
    /** O último dia do período cujo caixa foi fechado. `null` = nenhum. */
    porFormaAteODia: DiaCivil.nullable(),
    /** Dias do período com recebimento e SEM caixa fechado. */
    porFormaDiasSemCaixa: z.number().int(),
    porTipo: z.array(TipoNoPainel),
  })
  .strict()
export type PacientesNoPainel = z.infer<typeof PacientesNoPainel>

/**
 * **O CORTE DE CAIXA FECHADO, DECLARADO** — a regra 6 posta em dois números.
 *
 * `ateODia` é o último dia da janela cujo caixa já foi fechado; `diasSemCaixa`
 * é quantos dias da janela têm recebimento e **não** foram conferidos.
 *
 * Existe porque uma soma parcial sem recorte declarado é pior do que nenhuma
 * soma: a gestora compara o ranking com a receita do período e vê uma
 * diferença que ninguém explicou. O mesmo par já existe em `pacientes`
 * (`porFormaAteODia`/`porFormaDiasSemCaixa`), com o nome que a Visão do mês
 * usa — e os dois saem da MESMA função do serviço, com janelas diferentes.
 */
export const RecorteDeCaixa = z
  .object({
    ateODia: DiaCivil.nullable(),
    diasSemCaixa: z.number().int(),
  })
  .strict()
export type RecorteDeCaixa = z.infer<typeof RecorteDeCaixa>

/**
 * Uma linha do **Top 10 pagantes** (MANUAL cap. 10).
 *
 * `valor` é quanto a paciente pagou na janela, e ele passa pelo corte de caixa
 * fechado — ver `TopPagantes.recorte`.
 */
export const PaganteNoPainel = z
  .object({
    pacienteId: Uuid,
    nome: z.string(),
    /** A unidade PRINCIPAL da paciente. `''` quando não tem. */
    unidade: z.string(),
    pagamentos: z.number().int(),
    valor: centavosNaSaida,
  })
  .strict()
export type PaganteNoPainel = z.infer<typeof PaganteNoPainel>

/**
 * **Top 10 pagantes** — *"no período do Painel ou desde o início"* (MANUAL
 * cap. 10 e a pergunta frequente *"Como funciona o Top 10 pagantes?"*).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ELE RESPEITA O MESMO CORTE DO "RECEBIDO POR FORMA", E A RAZÃO É A REGRA 6
 *
 * Um ranking por paciente numa janela de **um dia** é a soma do dia por outro
 * agrupamento — e a janela do painel é escolhida por quem olha (`per` com
 * `de = ate = hoje`). O corte é o mesmo do `porForma`: só os dias com caixa
 * **já fechado** entram, e `recorte` declara até onde a lista alcança.
 *
 * **Isto é mais restritivo que o protótipo de propósito.** Lá o top 10 soma
 * `S.tasks` no navegador, sem olhar caixa nenhum — a mesma porta dos fundos
 * que o `porForma` dele abre.
 *
 * Em `modo: 'periodo'` o `recorte` coincide com
 * `pacientes.porFormaAteODia`/`porFormaDiasSemCaixa`: é o mesmo corte, e o
 * serviço o calcula numa função só. Em `modo: 'tudo'` a janela é a história
 * inteira da clínica, e por isso o campo é PRÓPRIO — o corte do período não
 * descreveria o que esta lista somou.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const TopPagantes = z
  .object({
    modo: z.enum(['periodo', 'tudo']),
    recorte: RecorteDeCaixa,
    itens: z.array(PaganteNoPainel),
  })
  .strict()
export type TopPagantes = z.infer<typeof TopPagantes>

/**
 * **Desempenho por unidade** (MANUAL cap. 10 e cap. 11, "Unidades").
 *
 * A unidade de um atendimento é a da TAREFA e, quando ela não tem, a da
 * PACIENTE — é o `unidadeDaTarefa` dela (`t.unidadeId || pac.unidadeId`). Sem
 * o segundo termo, a clínica que nunca troca a unidade no atendimento veria
 * todo o faturamento em "Sem unidade".
 *
 * **`faturamento` passa pelo corte de caixa fechado** (a mesma razão de
 * `TopPagantes`); **`ltvMedio` não passa, e isso é deliberado.** O LTV é a
 * soma do que uma paciente pagou **na vida**, não na janela: ele não é o
 * esperado de dia nenhum, e `/v1/pacientes` já o entrega por paciente com essa
 * classificação escrita. Quem confere a gaveta não acha nela o LTV médio de
 * uma unidade.
 */
export const LinhaPorUnidade = z
  .object({
    /** `null` é o balde "Sem unidade" — é um balde, não a ausência de balde. */
    unidadeId: Uuid.nullable(),
    nome: z.string(),
    /** Pacientes ATIVAS cuja unidade principal é esta. */
    pacientes: z.number().int(),
    pagamentos: z.number().int(),
    faturamento: centavosNaSaida,
    /**
     * A média do LTV **entre as pacientes que já pagaram algo**. `null`
     * quando nenhuma pagou.
     *
     * O denominador exclui quem nunca pagou, como nela (`filter(x => x.ltv >
     * 0)`): incluí-las dividiria pelo cadastro inteiro e a unidade que
     * importou mil pacientes apareceria com o pior LTV da clínica.
     */
    ltvMedio: centavosNaSaida,
    /** Programas que NASCERAM na janela. */
    programasNovos: z.number().int(),
    /**
     * Programas não encerrados que **ainda têm sessão aberta**.
     *
     * É a definição que `catalogo.service.ts` já usa para "pacientes ativos",
     * e é o `statsAdesao` dela: um programa cujas sessões acabaram está
     * concluído, e contá-lo faria o número nunca descer.
     */
    programasAtivos: z.number().int(),
    /** Sessões com data prevista na janela que **já venceram**. */
    sessoesPrevistas: z.number().int(),
    /** Destas, as que não aconteceram ou aconteceram depois da data. */
    sessoesComFalta: z.number().int(),
    /** `comFalta ÷ previstas`, em percentual inteiro. `null` sem base. */
    taxaDeFalta: z.number().int().nullable(),
    /**
     * Tarefas de paciente ABERTAS e vencidas — **sem recorte de período**, como
     * nela: a pergunta é *"o que está parado nesta unidade agora"*, e uma
     * tarefa de agosto que ninguém fez não pode sumir quando a gestora olha
     * novembro.
     */
    tarefasAtrasadas: z.number().int(),
  })
  .strict()
export type LinhaPorUnidade = z.infer<typeof LinhaPorUnidade>

/**
 * **Novos pacientes por origem** (MANUAL cap. 10: *"novos pacientes"*).
 *
 * `novos` conta pela data de CADASTRO na ferramenta — um quarto recorte, que
 * não é o prazo, nem a conclusão, nem a criação da tarefa.
 *
 * `ltvTotal` é o quanto essas pacientes já pagaram **na vida**, somado — é o
 * `rec` dela (`g.reduce((a, p) => a + statsPac(p.id).ltv, 0)`). O nome não é
 * `receita` de propósito: a `receita` do painel é a da JANELA, e dois fatos
 * com o mesmo nome é a ambiguidade de `plano` que o `CONTEXT.md` abre
 * proibindo. Sendo LTV, ele não passa pelo corte de caixa — mesma
 * classificação de `ltvMedio`.
 */
export const OrigemNoPainel = z
  .object({
    /** `'Não informada'` quando a paciente foi cadastrada sem origem. */
    origem: z.string(),
    novos: z.number().int(),
    /** Destes, os que já têm atendimento concluído. */
    jaAtendidos: z.number().int(),
    ltvTotal: centavosNaSaida,
  })
  .strict()
export type OrigemNoPainel = z.infer<typeof OrigemNoPainel>

export const NovosPacientes = z
  .object({
    total: z.number().int(),
    porOrigem: z.array(OrigemNoPainel),
  })
  .strict()
export type NovosPacientes = z.infer<typeof NovosPacientes>

export const Painel = z
  .object({
    /** O dia da clínica, do SERVIDOR. É ele que separa atrasada de a vencer. */
    hoje: DiaCivil,
    periodo: z
      .object({
        chave: PeriodoDoPainel,
        /** "Últimos 30 dias", "Outubro" — pronto, do servidor. */
        rotulo: z.string(),
        de: DiaCivil,
        ate: DiaCivil,
      })
      .strict(),

    prazos: CumprimentoDePrazos,
    /** Tarefas CRIADAS no período — o segundo número do cartão do topo. */
    criadasNoPeriodo: z.number().int(),
    porResponsavel: z.array(LinhaPorResponsavel),
    porSolicitante: z.array(LinhaPorSolicitante),

    pacientes: PacientesNoPainel,

    // -----------------------------------------------------------------------
    // OS QUATRO BLOCOS QUE FECHAM O CAPÍTULO 10
    // -----------------------------------------------------------------------
    topPagantes: TopPagantes,
    /**
     * Uma linha por unidade da clínica, mais o balde "Sem unidade" quando há o
     * que pôr nele. **Vazio na clínica de um endereço só** — ela não cadastrou
     * unidade nenhuma, e uma tabela de uma linha chamada "Sem unidade" não
     * responde pergunta nenhuma. É o `temUnidades()` dela.
     */
    porUnidade: z.array(LinhaPorUnidade),
    novosPacientes: NovosPacientes,
    /**
     * **As campanhas que CRUZAM o período** — `inicio <= ate AND fim >= de`.
     *
     * A forma é a mesma de `GET /v1/campanhas` (`CampanhaNaLista`), e isso não
     * é economia de tipo: as sete contagens, o percentual da meta e a taxa de
     * conversão de uma campanha são **uma** regra, e ela já mora no
     * `CampanhasService`. Escrevê-las de novo aqui é a herança que o
     * `CLAUDE.md` descreve — a mesma regra em dois lugares, divergindo no
     * primeiro ajuste.
     *
     * **A `receita` da campanha NÃO passa pelo corte de caixa**, e a razão
     * está escrita em `ROTAS_FORA_DA_CONFERENCIA`: ela é o total da campanha
     * inteira, sem recorte de forma e sem recorte de dia — a janela dela é a
     * própria, de semanas, e não a do painel. Quem confere a gaveta não acha
     * nela o que o sistema espera em Pix hoje.
     */
    campanhas: z.array(CampanhaNaLista),
  })
  .strict()
export type Painel = z.infer<typeof Painel>
