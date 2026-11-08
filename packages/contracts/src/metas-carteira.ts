import { z } from 'zod'
import { DiaCivil, Uuid, centavosNaSaida, dinheiroEmTexto } from './comum'
import { SentidoDeIndicador } from './cobranca-carteira'

/**
 * **G8 2B — metas completas da carteira, igual ao protótipo** (M1–M4, M6,
 * V8, V10; `vMetas`, `cPlano`, `cIndicadoresManual`, `abrirLancamentoMetas`,
 * `index.html` L730-827, L1432-1443, L1520-1530).
 *
 * REDAÇÃO (regra 17; appsec caso 12, "meta em R$: nenhum número absoluto
 * atravessa, só o percentual"). Todo número absoluto de uma meta ou de um
 * indicador de unidade `R$` mora num campo de NOME MONETÁRIO REGISTRADO em
 * `CAMPOS_MONETARIOS`: `valor` (atual, acumulado, cada semana, cada
 * lançamento), `valorMeta` (alvo; meta semanal do indicador) e `valorInicial`.
 * Os números de outras unidades moram em `numero`/`valorInteiro`/
 * `valorMetaInteiro`/`valorInicialInteiro`, que não são dinheiro e nunca são
 * apagados. Nenhum campo genérico (`atual`, `alvo`, `acumulado`) carrega
 * número: `atual` é um OBJETO cujo número está dentro de `valor`/`numero` —
 * o interceptor desce nele por nome.
 *
 * Percentuais (`percentual`, `ritmoEsperado`, `variacaoEmDecimos`, histórico)
 * atravessam: "84% do alvo" não revela o alvo.
 */

/** O conjunto fechado do indicador, agora com `dias` (M2). Inteiro fora do R$. */
export const UnidadeDeIndicadorCarteira = z.enum(['R$', 'un', '%', 'dias'])
export type UnidadeDeIndicadorCarteira = z.infer<typeof UnidadeDeIndicadorCarteira>

export const TipoDeMetaCarteira = z.enum(['mensal', 'prazo'])
export type TipoDeMetaCarteira = z.infer<typeof TipoDeMetaCarteira>

export const AgregacaoDeMetaCarteira = z.enum(['soma', 'media', 'ultimo'])
export type AgregacaoDeMetaCarteira = z.infer<typeof AgregacaoDeMetaCarteira>

/** `STATUS_META` (L513). `concluida` (G3) é lido como `atingida`. */
export const StatusDeMetaCarteira = z.enum(['em_andamento', 'atingida', 'nao_atingida', 'cancelada'])
export type StatusDeMetaCarteira = z.infer<typeof StatusDeMetaCarteira>

/**
 * De onde vem o resultado (`fontesMeta`, L730-735): o `Lançamento de
 * indicador` semanal (o "checkin" do protótipo, PP-2), o último lançamento de
 * outro indicador (`ind:<id>`), ou uma métrica da planilha
 * (`pl:<frente>|<métrica>|<ultima|media4|soma4>`).
 */
export const FonteDaMetaCarteira = z.string().regex(/^(lancamento|ind:[0-9a-f-]{36}|pl:[a-z]+\|[^|]{1,80}\|(ultima|media4|soma4))$/)
export type FonteDaMetaCarteira = z.infer<typeof FonteDaMetaCarteira>

const inteiroEmTexto = z
  .union([z.string().regex(/^-?\d{1,15}$/, 'precisa ser um inteiro'), z.null()])
  .transform((v) => (v === null ? null : BigInt(v)))
const inteiroNaSaida = z.string().regex(/^-?\d+$/).nullable()

/**
 * Um número de meta na escala de EXIBIÇÃO (`valorParaExibicao` do domínio):
 * `valor` em centavos quando a unidade é R$ (redigido sem `valores`);
 * `numero` nas outras — `%` em centésimos de ponto, `un`/`dias` em DÉCIMOS
 * (a média de "un" ganha uma casa, gate de números ajuste 20).
 */
export const NumeroDaMeta = z.object({
  valor: centavosNaSaida,
  numero: inteiroNaSaida,
  escala: z.enum(['centavos', 'centesimos', 'decimos']),
})
export type NumeroDaMeta = z.infer<typeof NumeroDaMeta>

export const EstadoDaMetaCarteira = z.enum(['atingida', 'no_ritmo', 'atencao', 'critica', 'sem_lancamento', 'cancelada'])
export type EstadoDaMetaCarteira = z.infer<typeof EstadoDaMetaCarteira>

/** O rótulo exato do protótipo (L772-778), mais `cancelada` (L771). */
export const DetalheDaMetaCarteira = z.enum([
  'atingida',
  'na_meta',
  'prazo_vencido',
  'sem_lancamento',
  'no_ritmo',
  'atencao',
  'abaixo_do_ritmo',
  'cancelada',
])
export type DetalheDaMetaCarteira = z.infer<typeof DetalheDaMetaCarteira>

export const MetaAvaliada = z.object({
  id: Uuid,
  clienteCarteiraId: Uuid,
  indicadorId: Uuid,
  indicadorNome: z.string(),
  unidade: UnidadeDeIndicadorCarteira,
  titulo: z.string(),
  tipo: TipoDeMetaCarteira,
  agregacao: AgregacaoDeMetaCarteira,
  sentido: SentidoDeIndicador,
  fonte: FonteDaMetaCarteira,
  /** Texto da fonte, como o seletor do protótipo o escreve (`fontesMeta`). */
  fonteRotulo: z.string(),
  inicio: DiaCivil,
  prazo: DiaCivil.nullable(),
  status: StatusDeMetaCarteira,
  /** Alvo: centavos (R$, redigido) OU inteiro na escala de armazenamento. */
  valorMeta: centavosNaSaida,
  valorMetaInteiro: inteiroNaSaida,
  valorInicial: centavosNaSaida,
  valorInicialInteiro: inteiroNaSaida,
  /** Valor atual agregado (acumulado, média ou último); `null` sem lançamento. */
  atual: NumeroDaMeta.nullable(),
  /** "da planilha" / leitura automática (`a.auto`, L787). */
  automatico: z.boolean(),
  avaliacao: z.object({
    estado: EstadoDaMetaCarteira,
    detalhe: DetalheDaMetaCarteira,
    bateu: z.boolean(),
    /** `round(progresso × 100)`; `null` sem lançamento ou com divisor zero ("—"). */
    percentual: z.number().int().nullable(),
    /** O marcador "Esperado para hoje" da barra (L782). */
    ritmoEsperado: z.number().int(),
  }),
  /** Só mensal com lançamento semanal: as segundas do mês e o que foi lançado nelas (L788). */
  semanas: z.array(
    z.object({
      referencia: DiaCivil,
      valor: centavosNaSaida,
      numero: inteiroNaSaida,
      lancada: z.boolean(),
      /** Altura relativa da barra, 0–100, calculada no servidor (L788); `null` sem lançamento. */
      altura: z.number().int().nullable(),
    }),
  ),
  /** Os três meses anteriores, em % do alvo (L761, L790). `percentual = null` → "—". */
  historico: z.array(
    z.object({
      mes: z.string().regex(/^\d{4}-\d{2}$/),
      percentual: z.number().int().nullable(),
      faixa: z.enum(['ok', 'atencao', 'critica']).nullable(),
    }),
  ),
  /** Mensal: "Novembro · 2 de 5 semanas lançadas" (L758). */
  semanasPassadas: z.number().int().nullable(),
  semanasDoMes: z.number().int().nullable(),
  /** "Falta lançar a semana de dd/mm" (L789): a segunda da reunião, ou `null`. */
  faltaLancar: DiaCivil.nullable(),
  /** Ações do plano vinculadas: concluídas de total (L1438, L1429). */
  acoes: z.object({ concluidas: z.number().int(), total: z.number().int() }),
})
export type MetaAvaliada = z.infer<typeof MetaAvaliada>

export const ResponsavelDaCarteira = z.object({ id: Uuid, nome: z.string() })
export type ResponsavelDaCarteira = z.infer<typeof ResponsavelDaCarteira>

// ---------------------------------------------------------------------------
// M1 — Painel de metas (`vMetas`, L806-825)
// ---------------------------------------------------------------------------

export const PainelDeMetasSaida = z.object({
  hoje: DiaCivil,
  clientes: z.array(
    z.object({
      id: Uuid,
      nome: z.string(),
      produto: z.string(),
      areaFoco: z.string().nullable(),
      responsavelNome: z.string().nullable(),
      saude: z.enum(['bom', 'atencao', 'critico']).nullable(),
      /** As metas não canceladas, da pior para a melhor (`peso`, L812). */
      metas: z.array(MetaAvaliada),
      /** Tem meta de lançamento semanal → mostra "Lançar metas da semana". */
      podeLancar: z.boolean(),
    }),
  ),
  /** "Sem metas definidas" (L825). */
  semMeta: z.array(z.object({ id: Uuid, nome: z.string() })),
  /** Os cinco KPIs (L816). `abaixo` inclui "Prazo vencido". "Na meta" conta como atingida (L809). */
  contagens: z.object({
    abaixo: z.number().int(),
    atencao: z.number().int(),
    noRitmo: z.number().int(),
    atingida: z.number().int(),
    semLancamento: z.number().int(),
  }),
  responsaveis: z.array(ResponsavelDaCarteira),
})
export type PainelDeMetasSaida = z.infer<typeof PainelDeMetasSaida>

// ---------------------------------------------------------------------------
// Metas de UM cliente (`cPlano`, L1432-1438) e o modelo da meta (M2)
// ---------------------------------------------------------------------------

export const IndicadorParaMeta = z.object({
  id: Uuid,
  nome: z.string(),
  unidade: UnidadeDeIndicadorCarteira,
  sentido: SentidoDeIndicador,
})
export type IndicadorParaMeta = z.infer<typeof IndicadorParaMeta>

export const MetasDoClienteSaida = z.object({
  hoje: DiaCivil,
  /** A semana a que a reunião de metas se refere hoje (L750, M6). */
  semanaDaReuniao: DiaCivil,
  /** As opções de semana do lançamento: a atual e as 4 anteriores (L796). */
  semanasParaLancar: z.array(DiaCivil),
  metas: z.array(MetaAvaliada),
  indicadores: z.array(IndicadorParaMeta),
  /** As opções de "De onde vem o resultado" (`fontesMeta`). */
  fontes: z.array(z.object({ fonte: FonteDaMetaCarteira, rotulo: z.string(), unidade: UnidadeDeIndicadorCarteira.nullable() })),
})
export type MetasDoClienteSaida = z.infer<typeof MetasDoClienteSaida>

/**
 * Nova meta (`F.meta`, L2756-2761). O indicador é um existente
 * (`indicadorId`) OU nasce junto (`novoIndicador`): o caminho de dois toques
 * ganha (M2). A unidade é a do indicador (ajuste 20).
 */
export const CriarMetaDoClienteEntrada = z
  .object({
    titulo: z.string().trim().min(1, 'Informe a meta.').max(160),
    indicadorId: Uuid.nullable().optional(),
    novoIndicador: z
      .object({ nome: z.string().trim().min(1).max(120), unidade: UnidadeDeIndicadorCarteira })
      .strict()
      .nullable()
      .optional(),
    tipo: TipoDeMetaCarteira,
    agregacao: AgregacaoDeMetaCarteira,
    sentido: SentidoDeIndicador,
    valorMeta: dinheiroEmTexto.optional(),
    valorMetaInteiro: inteiroEmTexto.optional(),
    valorInicial: dinheiroEmTexto.optional(),
    valorInicialInteiro: inteiroEmTexto.optional(),
    fonte: FonteDaMetaCarteira,
    inicio: DiaCivil,
    prazo: DiaCivil.nullable(),
    status: StatusDeMetaCarteira.optional(),
  })
  .strict()
  .refine((d) => (d.indicadorId != null) !== (d.novoIndicador != null), {
    message: 'Escolha um indicador ou crie um novo.',
    path: ['indicadorId'],
  })
  .refine((d) => (d.valorMeta != null) !== (d.valorMetaInteiro != null), {
    message: 'Informe o valor alvo.',
    path: ['valorMeta'],
  })
  .refine((d) => !(d.valorInicial != null && d.valorInicialInteiro != null), {
    message: 'Informe o valor no início uma vez só.',
    path: ['valorInicial'],
  })
  .refine((d) => d.prazo === null || d.prazo >= d.inicio, { message: 'O prazo vem depois do início.', path: ['prazo'] })
  .refine((d) => d.tipo === 'mensal' || d.prazo !== null, { message: 'Meta com prazo precisa da data final.', path: ['prazo'] })
export type CriarMetaDoClienteEntrada = z.infer<typeof CriarMetaDoClienteEntrada>

/**
 * Editar meta (`data-edit-meta`, L2867). PATCH: campo AUSENTE não muda;
 * `null` em campo monetário NUNCA apaga (A-6) — só os campos opcionais de
 * verdade (`prazo`, valor inicial) aceitam `null` explícito.
 */
export const EditarMetaDoClienteEntrada = z
  .object({
    titulo: z.string().trim().min(1).max(160).optional(),
    tipo: TipoDeMetaCarteira.optional(),
    agregacao: AgregacaoDeMetaCarteira.optional(),
    sentido: SentidoDeIndicador.optional(),
    valorMeta: dinheiroEmTexto.optional(),
    valorMetaInteiro: inteiroEmTexto.optional(),
    valorInicial: dinheiroEmTexto.optional(),
    valorInicialInteiro: inteiroEmTexto.optional(),
    fonte: FonteDaMetaCarteira.optional(),
    inicio: DiaCivil.optional(),
    prazo: DiaCivil.nullable().optional(),
    status: StatusDeMetaCarteira.optional(),
  })
  .strict()
export type EditarMetaDoClienteEntrada = z.infer<typeof EditarMetaDoClienteEntrada>

/**
 * `metaSalva`, e NÃO `meta`: `meta` está em `CAMPOS_MONETARIOS` (a meta de
 * faturamento da clínica, épico 4) e a redação apagaria o objeto inteiro —
 * medido no e2e deste ticket.
 */
export const MetaDoClienteSalvaSaida = z.object({ metaSalva: MetaAvaliada })
export type MetaDoClienteSalvaSaida = z.infer<typeof MetaDoClienteSalvaSaida>

// ---------------------------------------------------------------------------
// M4 — Lançar metas da semana (`abrirLancamentoMetas`, L793-805)
// ---------------------------------------------------------------------------

export const LancamentoSemanalDeMetasEntrada = z
  .object({
    /** A segunda-feira da semana — conferida no servidor (CE-4). */
    semana: DiaCivil,
    valores: z
      .array(
        z
          .object({
            metaId: Uuid,
            valor: dinheiroEmTexto.optional(),
            valorInteiro: inteiroEmTexto.optional(),
          })
          .strict()
          .refine((v) => (v.valor != null) !== (v.valorInteiro != null), {
            message: 'Informe o valor da semana.',
            path: ['valor'],
          }),
      )
      .max(50),
    /** "Combinados da reunião" — vira uma reunião registrada (L799, L802). */
    combinados: z.string().trim().max(3000).nullable().optional(),
    /**
     * Chave do envio, gerada pela tela. Os lançamentos já são idempotentes
     * por `(indicador, segunda)`; a chave fecha o mesmo buraco na REUNIÃO dos
     * combinados — o segundo envio do mesmo formulário não registra outra ata.
     */
    chaveIdempotencia: Uuid.optional(),
    /** A tarefa "reunião de metas" que abriu o formulário — concluída junto (L803). */
    tarefaInternaId: Uuid.nullable().optional(),
  })
  .strict()
export type LancamentoSemanalDeMetasEntrada = z.infer<typeof LancamentoSemanalDeMetasEntrada>

export const LancamentoSemanalDeMetasSaida = z.object({
  lancadas: z.number().int(),
  reuniaoId: Uuid.nullable(),
  tarefaConcluida: z.boolean(),
})
export type LancamentoSemanalDeMetasSaida = z.infer<typeof LancamentoSemanalDeMetasSaida>

// ---------------------------------------------------------------------------
// V10 — Indicadores manuais (`cIndicadoresManual`, L1520-1530)
// ---------------------------------------------------------------------------

export const PontoDoIndicador = z.object({
  referencia: DiaCivil,
  valor: centavosNaSaida,
  valorInteiro: inteiroNaSaida,
})
export type PontoDoIndicador = z.infer<typeof PontoDoIndicador>

export const IndicadorDoCliente = z.object({
  id: Uuid,
  nome: z.string(),
  unidade: UnidadeDeIndicadorCarteira,
  sentido: SentidoDeIndicador,
  /** Meta semanal: centavos (R$, redigido) ou inteiro. Ambos `null` = sem meta. */
  valorMeta: centavosNaSaida,
  valorMetaInteiro: inteiroNaSaida,
  /** As últimas 8 semanas lançadas, da mais antiga para a mais recente. */
  serie: z.array(PontoDoIndicador),
  ultimo: PontoDoIndicador.nullable(),
  /** "Na meta"/"Abaixo"; `null` sem meta ou sem lançamento (ajuste 22). */
  naMeta: z.boolean().nullable(),
  /**
   * Variação contra a segunda IMEDIATAMENTE anterior, em décimos de ponto
   * percentual, meio para longe do zero (ajuste 22). `null` = sem a semana
   * anterior ou com ela em zero.
   */
  variacaoEmDecimos: z.number().int().nullable(),
  /** Por que não há variação: a semana anterior falta, ou vale zero. */
  semVariacao: z.enum(['sem_semana_anterior', 'anterior_zero']).nullable(),
})
export type IndicadorDoCliente = z.infer<typeof IndicadorDoCliente>

export const IndicadoresDoClienteSaida = z.object({
  hoje: DiaCivil,
  /** A segunda desta semana — o padrão de "Lançar semana" (L2971). */
  semanaAtual: DiaCivil,
  indicadores: z.array(IndicadorDoCliente),
})
export type IndicadoresDoClienteSaida = z.infer<typeof IndicadoresDoClienteSaida>

export const CriarIndicadorDoClienteEntrada = z
  .object({
    nome: z.string().trim().min(1, 'Informe o indicador.').max(120),
    unidade: UnidadeDeIndicadorCarteira,
    sentido: SentidoDeIndicador,
    valorMeta: dinheiroEmTexto.optional(),
    valorMetaInteiro: inteiroEmTexto.optional(),
  })
  .strict()
  .refine((d) => !(d.valorMeta != null && d.valorMetaInteiro != null), {
    message: 'Informe a meta semanal uma vez só.',
    path: ['valorMeta'],
  })
export type CriarIndicadorDoClienteEntrada = z.infer<typeof CriarIndicadorDoClienteEntrada>

/** "Lançar semana": todos os indicadores num formulário, upsert por (indicador, segunda). */
export const LancarSemanaDosIndicadoresEntrada = z
  .object({
    referencia: DiaCivil,
    valores: z
      .array(
        z
          .object({
            indicadorId: Uuid,
            valor: dinheiroEmTexto.optional(),
            valorInteiro: inteiroEmTexto.optional(),
          })
          .strict()
          .refine((v) => (v.valor != null) !== (v.valorInteiro != null), {
            message: 'Informe o valor.',
            path: ['valor'],
          }),
      )
      .min(1)
      .max(50),
  })
  .strict()
export type LancarSemanaDosIndicadoresEntrada = z.infer<typeof LancarSemanaDosIndicadoresEntrada>

export const SemanaDosIndicadoresLancadaSaida = z.object({ lancados: z.number().int() })
export type SemanaDosIndicadoresLancadaSaida = z.infer<typeof SemanaDosIndicadoresLancadaSaida>

// ---------------------------------------------------------------------------
// V8 — Ação do plano (`fAcao` L2767-2768, `tabelaAcoes` L1335-1345)
// ---------------------------------------------------------------------------

export const TipoDeAcaoDoPlano = z.enum(['plano', 'comercial'])
export type TipoDeAcaoDoPlano = z.infer<typeof TipoDeAcaoDoPlano>

export const StatusDeAcaoDoPlano = z.enum(['pendente', 'em_andamento', 'concluida', 'cancelada'])
export type StatusDeAcaoDoPlano = z.infer<typeof StatusDeAcaoDoPlano>

export const QuemExecutaAcao = z.enum(['cliente', 'firmare'])
export type QuemExecutaAcao = z.infer<typeof QuemExecutaAcao>

export const AcaoDoPlano = z.object({
  id: Uuid,
  clienteCarteiraId: Uuid,
  titulo: z.string(),
  tipo: TipoDeAcaoDoPlano,
  metaId: Uuid.nullable(),
  metaTitulo: z.string().nullable(),
  quemExecuta: QuemExecutaAcao,
  acompanhamentoUsuarioGestaoId: Uuid.nullable(),
  acompanhamentoNome: z.string().nullable(),
  prazo: DiaCivil.nullable(),
  status: StatusDeAcaoDoPlano,
  descricao: z.string().nullable(),
  concluidaEm: z.string().datetime().nullable(),
  /** Derivada no servidor: aberta e prazo < hoje (L1115). */
  atrasada: z.boolean(),
  diasDeAtraso: z.number().int().nullable(),
})
export type AcaoDoPlano = z.infer<typeof AcaoDoPlano>

export const AcoesDoPlanoSaida = z.object({
  hoje: DiaCivil,
  acoes: z.array(AcaoDoPlano),
  metas: z.array(z.object({ id: Uuid, titulo: z.string() })),
  responsaveis: z.array(ResponsavelDaCarteira),
})
export type AcoesDoPlanoSaida = z.infer<typeof AcoesDoPlanoSaida>

export const CriarAcaoDoPlanoEntrada = z
  .object({
    titulo: z.string().trim().min(1, 'Informe a ação.').max(200),
    tipo: TipoDeAcaoDoPlano,
    metaId: Uuid.nullable(),
    quemExecuta: QuemExecutaAcao,
    acompanhamentoUsuarioGestaoId: Uuid.nullable(),
    prazo: DiaCivil.nullable(),
    status: StatusDeAcaoDoPlano,
    descricao: z.string().trim().max(2000).nullable(),
  })
  .strict()
export type CriarAcaoDoPlanoEntrada = z.infer<typeof CriarAcaoDoPlanoEntrada>

export const EditarAcaoDoPlanoEntrada = z
  .object({
    titulo: z.string().trim().min(1).max(200).optional(),
    tipo: TipoDeAcaoDoPlano.optional(),
    metaId: Uuid.nullable().optional(),
    quemExecuta: QuemExecutaAcao.optional(),
    acompanhamentoUsuarioGestaoId: Uuid.nullable().optional(),
    prazo: DiaCivil.nullable().optional(),
    status: StatusDeAcaoDoPlano.optional(),
    descricao: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
export type EditarAcaoDoPlanoEntrada = z.infer<typeof EditarAcaoDoPlanoEntrada>

export const AcaoDoPlanoSalvaSaida = z.object({ acao: AcaoDoPlano })
export type AcaoDoPlanoSalvaSaida = z.infer<typeof AcaoDoPlanoSalvaSaida>
