import { z } from 'zod'
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
  })
  .strict()
export type Painel = z.infer<typeof Painel>
