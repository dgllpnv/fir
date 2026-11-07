import {
  INDICADORES,
  type IndicadorDeMeta,
  MAX_METAS_POR_PESSOA_NO_MES,
  tipoDoIndicador,
} from '@fir/domain'
import { z } from 'zod'
import { DiaCivil, Mes, Uuid, centavosNaSaida, dinheiroEmTexto } from './comum'

/**
 * **Pessoas › Metas do mês · Conversas 1:1 · Minhas metas** (MANUAL cap. 13).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A REGRA QUE GOVERNA ESTE ARQUIVO: SEM `valores`, A META ENTREGA SÓ O
 * PERCENTUAL
 *
 * Dos nove indicadores, **um é dinheiro** (`orc_valor`, em centavos) e oito
 * são quantidade ou percentual. A regra 17 exige que o SERVIDOR apague o
 * dinheiro de quem não tem `valores` — e que a tela não precise de um `if`.
 *
 * O que torna isso possível é a META VIAJAR EM DOIS PARES, dos quais
 * exatamente um é preenchido:
 *
 *   `metaEmDinheiro` / `realizadoEmDinheiro`  — centavos, **em
 *      `CAMPOS_MONETARIOS`**: o `RedacaoInterceptor` os apaga por nome de
 *      chave. Preenchidos só quando `tipo === 'valor'`.
 *
 *   `metaEmNumero` / `realizadoEmNumero`      — unidade ou ponto percentual,
 *      **fora** de `CAMPOS_MONETARIOS`: a recepcionista sem `valores` precisa
 *      ver "38 de 40 agendamentos", e apagar isso seria esconder o trabalho
 *      dela, não o preço de nada. É o mesmo raciocínio de `saldoEmEstoque` e
 *      de `saldoEmMinutos` — ali o perigo era um nome monetário apagando
 *      quantidade; aqui é o inverso, e os dois se resolvem nomeando a escala.
 *
 *   `percentual` — o atingimento. **Nunca redigido**, e é ele que sobra:
 *      "você está em 84% da meta" não revela quanto é a meta. É exatamente o
 *      que `PercentualDaMeta` do financeiro já faz com a meta de faturamento.
 *
 * Com a permissão, a tela mostra `R$ 18.000 de R$ 20.000 · 90%`; sem ela,
 * `90%` e mais nada. Um `if` na tela daria o mesmo resultado hoje e vazaria no
 * endpoint número quarenta.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * As nove chaves, de `INDICADORES` — **a mesma tabela** que a tela e o
 * servidor leem.
 *
 * `z.enum` sobre a lista do domínio e não `z.string()`: `'tarefas_prazos'` num
 * corpo viraria uma meta que nunca recebe contagem e aparece como `—` para
 * sempre. Mesma razão de `ChavePermitida` em `pessoas.ts`.
 */
export const IndicadorDaMeta = z.enum(
  INDICADORES.map((i) => i.chave) as [IndicadorDeMeta, ...IndicadorDeMeta[]],
)

export const TipoDaMeta = z.enum(['qtd', 'valor', 'pct'])

/** Teto de pontos percentuais. Meta de 150% no prazo é erro de digitação. */
const MAX_PERCENTUAL = 100

// ---------------------------------------------------------------------------
// ESCRITA
// ---------------------------------------------------------------------------

/**
 * `meta` dela — **adicionar** uma meta ao mês de uma pessoa.
 *
 * O mês vem do CAMINHO (`/v1/metas-de-pessoa/:mes`), nunca do corpo: a tela
 * edita um mês de cada vez, e um mês no corpo divergindo do da URL é a
 * ambiguidade que não precisa existir.
 *
 * O alvo viaja nos dois campos paralelos, e o `superRefine` cobra que o
 * preenchido combine com o TIPO do indicador. A alternativa era uma
 * `discriminatedUnion` de nove braços, que diria a mesma coisa nove vezes.
 */
/**
 * A regra do ALVO, partilhada por criar e editar: **exatamente um** dos dois
 * campos de valor combina com o tipo do indicador, e o nome é obrigatório na
 * manual e proibido nas outras — o mesmo `CHECK` `nome_combina_com_indicador`
 * da migration 0019, dito na borda para que a recusa seja mensagem de tela e
 * não erro de banco.
 */
function refinarAlvoDaMeta(
  d: { indicador: IndicadorDeMeta; nome: string; metaEmDinheiro: bigint | null; metaEmNumero: number | null },
  ctx: z.RefinementCtx,
): void {
  const tipo = tipoDoIndicador(d.indicador)
  const erra = (path: string, message: string): void => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message })
  }

  if (tipo === 'valor') {
    if (d.metaEmNumero !== null) erra('metaEmNumero', 'Esta meta é em reais.')
    if (d.metaEmDinheiro === null || d.metaEmDinheiro <= 0n) {
      erra('metaEmDinheiro', 'Informe a meta em reais.')
    }
  } else {
    if (d.metaEmDinheiro !== null) erra('metaEmDinheiro', 'Esta meta não é em reais.')
    if (d.metaEmNumero === null) erra('metaEmNumero', 'Informe a meta.')
    else if (tipo === 'pct' && d.metaEmNumero > MAX_PERCENTUAL) {
      erra('metaEmNumero', `A meta de percentual vai até ${MAX_PERCENTUAL}%.`)
    }
  }

  const manual = d.indicador === 'manual'
  if (manual && d.nome === '') erra('nome', 'Dê um nome à meta.')
  if (!manual && d.nome !== '') erra('nome', 'O nome só existe na meta manual.')
}

export const SalvarMetaDePessoa = z
  .object({
    fichaId: Uuid,
    indicador: IndicadorDaMeta,
    /** O nome da meta MANUAL. Vazio nas automáticas — o nome vem da tabela. */
    nome: z.string().trim().max(60).default(''),
    /** Centavos. **Só** para `orc_valor`. */
    metaEmDinheiro: dinheiroEmTexto.default(null),
    /** Unidade ou ponto percentual. Para todos os outros oito. */
    metaEmNumero: z.number().int().positive().nullable().default(null),
  })
  .strict()
  .superRefine(refinarAlvoDaMeta)
export type SalvarMetaDePessoa = z.infer<typeof SalvarMetaDePessoa>

/**
 * `meta` dela — **editar o alvo** de uma meta que já existe.
 *
 * `fichaId` não está aqui: trocar de dona é apagar e criar outra, nunca um
 * `PUT`. `indicador` viaja **igual ao da criação**, só para que o mesmo
 * `refinarAlvoDaMeta` valide na borda sem precisar ler o banco antes — o
 * serviço confere que ele bate com o da linha e recusa a troca (o indicador é
 * identidade da meta, não um campo editável).
 */
export const EditarMetaDePessoa = z
  .object({
    indicador: IndicadorDaMeta,
    nome: z.string().trim().max(60).default(''),
    metaEmDinheiro: dinheiroEmTexto.default(null),
    metaEmNumero: z.number().int().positive().nullable().default(null),
  })
  .strict()
  .superRefine(refinarAlvoDaMeta)
export type EditarMetaDePessoa = z.infer<typeof EditarMetaDePessoa>

/**
 * `realizado` dela — **só na meta MANUAL**, e o servidor recusa nas outras.
 *
 * `null` LIMPA o lançamento e a meta volta a `—`. Zero é um resultado
 * declarado como zero, e os dois não são a mesma coisa: no protótipo,
 * `realizado: ''` devolve `null` e `realizado: 0` devolve `0` — medido.
 *
 * `.strict()` e sem `indicador`: a rota já sabe qual meta é pelo id. Um
 * `indicador` aqui seria a segunda fonte de uma verdade que a linha já tem.
 */
export const LancarRealizado = z
  .object({ realizadoEmNumero: z.number().int().min(0).nullable() })
  .strict()
export type LancarRealizado = z.infer<typeof LancarRealizado>

/**
 * `copiarMetas` — "Copiar metas de outubro".
 *
 * O destino é o mês do CAMINHO; o corpo traz só a origem. **Idempotente por
 * esquema** (índice `meta_por_ficha_mes_indicador` + `ON CONFLICT DO
 * NOTHING`): copiar duas vezes devolve `copiadas: 0` na segunda, e não duas
 * metas iguais. O protótipo faz `if (!some(...)) push`, que perde a corrida
 * entre duas abas.
 *
 * O realizado lançado **não** é copiado — é resultado do mês de origem.
 */
export const CopiarMetas = z.object({ de: Mes }).strict()
export type CopiarMetas = z.infer<typeof CopiarMetas>

/**
 * `conversa` dela — o registro da 1:1.
 *
 * `mes` é o mês A QUE A CONVERSA SE REFERE, e não o mês em que ela aconteceu:
 * a conversa de outubro acontece em 3 de novembro, e é com as metas de outubro
 * que ela se compara.
 *
 * `criarTarefas` faz o servidor criar **uma tarefa por combinado**, para a
 * pessoa, com prazo de 30 dias — na MESMA transação do registro. No protótipo
 * é um laço na tela chamando a API uma vez por linha: a terceira falha deixa a
 * conversa gravada com dois combinados virados em tarefa e um não, e ninguém
 * descobre qual.
 */
export const SalvarConversa = z
  .object({
    fichaId: Uuid,
    /** O dia em que a conversa aconteceu. O servidor recusa dia futuro. */
    data: DiaCivil,
    mes: Mes,
    fortes: z.string().trim().max(1500).default(''),
    desenvolver: z.string().trim().max(1500).default(''),
    combinados: z.string().trim().max(1500).default(''),
    criarTarefas: z.boolean().default(true),
  })
  .strict()
  .refine(
    (d) => d.fortes !== '' || d.desenvolver !== '' || d.combinados !== '',
    'Registre pelo menos um ponto da conversa.',
  )
export type SalvarConversa = z.infer<typeof SalvarConversa>

/** As duas rotinas mensais da tela Equipe (MANUAL cap. 13). */
export const CriarRotinaDePessoal = z
  .object({ rotina: z.enum(['conversas', 'bancoDeHoras']) })
  .strict()
export type CriarRotinaDePessoal = z.infer<typeof CriarRotinaDePessoal>

// ---------------------------------------------------------------------------
// LEITURA
// ---------------------------------------------------------------------------

/**
 * Uma meta, com o realizado já resolvido pelo SERVIDOR.
 *
 * A tela **não calcula nada aqui**: nem o realizado (são oito consultas), nem
 * o percentual, nem a média. É a mesma regra da ficha de pessoa, e pela mesma
 * razão — o protótipo calcula os nove no navegador, e por isso a definição de
 * `tarefas_prazo` mora só lá.
 */
export const MetaDePessoa = z
  .object({
    id: Uuid,
    fichaId: Uuid,
    mes: Mes,
    indicador: IndicadorDaMeta,
    /** O nome a MOSTRAR: o da gestora na manual, o da tabela nas automáticas. */
    nome: z.string(),
    tipo: TipoDaMeta,
    /** `false` só na `manual` — é ela que tem o campo de lançar resultado. */
    automatica: z.boolean(),

    /** Centavos. Preenchido só em `orc_valor`. **Redigido sem `valores`.** */
    metaEmDinheiro: centavosNaSaida,
    /** Unidade ou ponto percentual. Nunca redigido. */
    metaEmNumero: z.number().int().nullable(),
    /** Centavos. Preenchido só em `orc_valor`. **Redigido sem `valores`.** */
    realizadoEmDinheiro: centavosNaSaida,
    /**
     * O realizado em número. `null` é **"sem dado"**, nunca zero.
     *
     * A diferença não é cosmética: `0` acusa quem deixou tudo atrasar, `—` diz
     * que não havia nada no mês. Uma ficha sem usuário ligado recebe `null` em
     * toda meta automática, porque não há registros de quem contar.
     */
    realizadoEmNumero: z.number().int().nullable(),

    /**
     * O atingimento, em percentual inteiro. **Nunca redigido** — é o que a
     * equipe sem `valores` lê no lugar do valor, e ele não revela a meta.
     *
     * `null` quando não há dado. Pode passar de 100.
     */
    percentual: z.number().int().nullable(),
  })
  .strict()
export type MetaDePessoa = z.infer<typeof MetaDePessoa>

export const MetasDaPessoa = z
  .object({
    fichaId: Uuid,
    nome: z.string(),
    cargo: z.string(),
    /** `false` = sem usuário ligado: as metas automáticas não têm o que contar. */
    temUsuario: z.boolean(),
    /** A média das metas com dado, **cada uma clampada em 100**. Do servidor. */
    mediaDeAtingimento: z.number().int().nullable(),
    metas: z.array(MetaDePessoa),
  })
  .strict()
export type MetasDaPessoa = z.infer<typeof MetasDaPessoa>

export const MetasDoMes = z
  .object({
    mes: Mes,
    /** O mês anterior, para o botão "Copiar metas de …". Do servidor. */
    mesAnterior: Mes,
    /** Há metas no mês anterior — é o que faz o botão de copiar existir. */
    mesAnteriorTemMetas: z.boolean(),
    /** Só fichas ATIVAS, como na tela dela. Quem saiu não tem meta a bater. */
    pessoas: z.array(MetasDaPessoa),
    maxMetasPorPessoa: z.number().int(),
  })
  .strict()
export type MetasDoMes = z.infer<typeof MetasDoMes>

/** O resultado de `copiarMetas`: quantas entraram, e o mês já remontado. */
export const MetasCopiadas = MetasDoMes.extend({
  copiadas: z.number().int(),
  /** Quantas foram ignoradas por já existirem. A segunda cópia devolve todas. */
  jaExistiam: z.number().int(),
})
export type MetasCopiadas = z.infer<typeof MetasCopiadas>

/**
 * **Minhas metas** — a tela que TODO perfil tem (`perm: null`).
 *
 * Ela devolve as metas de quem está pedindo, e só. Não há parâmetro de pessoa:
 * um `?fichaId=` aqui seria a rota pela qual a recepção lê a meta (e o
 * atingimento) da colega, numa tela sem permissão nenhuma.
 */
export const MinhasMetas = z
  .object({
    mes: Mes,
    /** `false` = a ficha dela ainda não foi criada. A tela explica. */
    temFicha: z.boolean(),
    mediaDeAtingimento: z.number().int().nullable(),
    metas: z.array(MetaDePessoa),
  })
  .strict()
export type MinhasMetas = z.infer<typeof MinhasMetas>

// ---------------------------------------------------------------------------
// CONVERSAS
// ---------------------------------------------------------------------------

export const ConversaRegistrada = z
  .object({
    id: Uuid,
    fichaId: Uuid,
    /** De quem é a conversa. */
    nome: z.string(),
    data: DiaCivil,
    mes: Mes,
    /** Quem conduziu — o primeiro nome, como ela mostra. */
    por: z.string(),
    /**
     * Os três blocos, **já quebrados em linhas pelo servidor**.
     *
     * A tela dela faz `split(/\n/).map(trim).filter(Boolean)` no navegador.
     * Aqui o servidor entrega a lista: quebrar texto é a mesma classe de
     * "calcular" que o front não faz, e duas implementações do `filter(Boolean)`
     * divergem no dia em que uma delas aceitar a linha em branco.
     */
    fortes: z.array(z.string()),
    desenvolver: z.array(z.string()),
    combinados: z.array(z.string()),
  })
  .strict()
export type ConversaRegistrada = z.infer<typeof ConversaRegistrada>

export const Conversas = z
  .object({
    /** O mês corrente da clínica — é dele que sai a lista de pendentes. */
    mes: Mes,
    conversas: z.array(ConversaRegistrada),
    /**
     * Quem tem gestor e ainda não teve a conversa DESTE mês.
     *
     * Só quem tem `gestorId`, como ela: sem gestor definido, ninguém é
     * responsável por conduzir, e o aviso apontaria para o vazio.
     */
    pendentes: z.array(z.object({ fichaId: Uuid, nome: z.string(), gestor: z.string() })),
    /** A rotina mensal de 1:1 já está criada (tarefa viva com o marcador). */
    temRotina: z.boolean(),
  })
  .strict()
export type Conversas = z.infer<typeof Conversas>

export const ConversaSalva = Conversas.extend({ tarefasCriadas: z.number().int() })
export type ConversaSalva = z.infer<typeof ConversaSalva>

export const RotinaDePessoalCriada = z
  .object({ criadas: z.number().int(), deInicio: DiaCivil })
  .strict()
export type RotinaDePessoalCriada = z.infer<typeof RotinaDePessoalCriada>

export const MAX_METAS = MAX_METAS_POR_PESSOA_NO_MES
