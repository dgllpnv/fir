import { type ChaveDePermissao, somarMeses } from '@fir/domain'
import { z } from 'zod'
import { centavosNaSaida, DiaCivil, Uuid } from './comum'
import { QuantidadeNaSaida } from './estoque'
import { ValorNaTelaSchema } from './indicadores-api'
import { CumprimentoDePrazos } from './painel'

/**
 * **OS RELATÓRIOS DE INDICADORES & INSIGHTS** (spec I-36 a I-41; ticket T8).
 *
 * O catálogo (filtros, colunas, permissão, classe) mora AQUI, e é o mesmo para
 * o servidor e para a tela: o servidor valida e executa, a tela mostra e
 * formata. Nenhuma das duas calcula o que a outra calcula.
 *
 * As regras que este arquivo carrega por construção:
 *
 *  - **Filtros `.strict()`, sem string livre** (appsec C12; LGPD L-IN-7): todo
 *    campo é enum, id, dia ou centavos. Não há filtro por nome, telefone ou
 *    CPF — procedimento, item e pessoa entram POR ID.
 *  - **Um schema de linha por relatório**, igual às colunas padrão da I-38 mais
 *    o opt-in (LGPD L-IN-6). O que não está no schema não sai. As chaves `*Id`
 *    não são coluna: identificam a linha para a ficha, para
 *    `pacientes_da_exportacao` e para "Criar campanha" (T9).
 *  - **Toda coluna `dinheiro` tem a chave em `CAMPOS_MONETARIOS`** (teste de
 *    arquitetura): o motor tira as colunas sem `valores`, e o
 *    `RedacaoInterceptor` é a segunda camada.
 *  - **A faixa de valor chama-se `valorMinimo`/`valorMaximo`** (appsec C9):
 *    dois nomes em `CAMPOS_MONETARIOS`, para que o favorito com faixa saia
 *    redigido para quem não tem `valores`.
 *  - **Nenhum campo string carrega dinheiro** (appsec C8): o cabeçalho, os
 *    "filtros em texto" e os rótulos do resumo nunca levam um valor.
 */

export const CHAVES_DE_RELATORIO = [
  'pacientes-sem-compra',
  'recebimentos',
  'saidas-de-estoque',
  'tarefas-da-equipe',
] as const
export const ChaveDeRelatorio = z.enum(CHAVES_DE_RELATORIO)
export type ChaveDeRelatorio = z.infer<typeof ChaveDeRelatorio>

/** LGPD L-IN-1: a classe declarada, que sobe para `saude` em tempo de execução. */
export const ClasseDeRelatorio = z.enum(['saude', 'pessoal', 'nenhuma'])
export type ClasseDeRelatorio = z.infer<typeof ClasseDeRelatorio>

/** LGPD L-IN-11: a finalidade da exportação de classe `saude`, sem texto livre. */
export const FINALIDADES_DE_EXPORTACAO = [
  { chave: 'acompanhamento-do-tratamento', rotulo: 'Acompanhamento do tratamento' },
  { chave: 'recall-de-lote', rotulo: 'Recall de lote' },
  { chave: 'conferencia-interna', rotulo: 'Conferência interna' },
] as const
type ChaveDeFinalidade = (typeof FINALIDADES_DE_EXPORTACAO)[number]['chave']
export const FinalidadeDeExportacao = z.enum(
  FINALIDADES_DE_EXPORTACAO.map((f) => f.chave) as [ChaveDeFinalidade, ...ChaveDeFinalidade[]],
)
export type FinalidadeDeExportacao = z.infer<typeof FinalidadeDeExportacao>

export const FormatoDeExportacao = z.enum(['csv', 'xlsx', 'impressao'])
export type FormatoDeExportacao = z.infer<typeof FormatoDeExportacao>

/** Appsec C13: a janela máxima de qualquer filtro de período. */
export const JANELA_MAXIMA_EM_MESES = 24
/** I-36: o teto de linhas de uma execução; acima disso, `truncado`. */
export const LIMITE_DE_LINHAS = 10_000

/* ------------------------------------------------------------------ filtros */

/** Centavos digitados num filtro: inteiro positivo. Nome sempre em `CAMPOS_MONETARIOS`. */
const CentavosDoFiltro = centavosNaSaida.unwrap().regex(/^\d{1,15}$/, 'centavos: um inteiro positivo')

/** O período `[de, ate]` em dias civis da clínica, com a janela máxima (C13). */
const comPeriodo = <T extends { de: string; ate: string }>(f: T, ctx: z.RefinementCtx): void => {
  if (f.ate < f.de) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ate'], message: 'A data final não pode ser anterior à inicial.' })
  } else if (f.ate >= somarMeses(f.de, JANELA_MAXIMA_EM_MESES)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ate'], message: `O período pode ter no máximo ${JANELA_MAXIMA_EM_MESES} meses.` })
  }
}

const comFaixa = (f: { valorMinimo?: string | undefined; valorMaximo?: string | undefined }, ctx: z.RefinementCtx): void => {
  if (f.valorMinimo !== undefined && f.valorMaximo !== undefined && BigInt(f.valorMinimo) > BigInt(f.valorMaximo)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valorMaximo'], message: 'O valor máximo não pode ser menor que o mínimo.' })
  }
}

/** Relatório 1. "Procedimento" = já comprou o procedimento; "sem compra" = nenhuma compra no período. */
export const CamposPacientesSemCompra = z
  .object({
    semCompraHaMeses: z.number().int().min(1).max(JANELA_MAXIMA_EM_MESES),
    procedimentoId: Uuid.optional(),
    /** Faixa de LTV, em centavos. Exige `valores` (I-40). */
    valorMinimo: CentavosDoFiltro.optional(),
    valorMaximo: CentavosDoFiltro.optional(),
  })
  .strict()
export const FiltrosPacientesSemCompra = CamposPacientesSemCompra.superRefine(comFaixa)

/** Relatório 8. Os dias de `[de, ate]`, no fuso da clínica. */
export const CamposRecebimentos = z.object({ de: DiaCivil, ate: DiaCivil }).strict()
export const FiltrosRecebimentos = CamposRecebimentos.superRefine(comPeriodo)

/**
 * Relatório 11. `analise`: o recorte da Análise (as duas contagens que ela
 * escolhe para `[de, ate]`, por índice) — e só neste modo o total por item bate
 * com a Análise (números B8). `calendario`: as saídas com dia em `[de, ate]`,
 * que **não** se comparam com a Análise.
 *
 * `incluirPaciente` é o opt-in da I-38: exige `jornada`, e faz a classe subir
 * para `saude`. Sem `jornada`, o relatório continua, sem a coluna.
 */
export const CamposSaidasDeEstoque = z
  .object({
    modo: z.enum(['analise', 'calendario']),
    de: DiaCivil,
    ate: DiaCivil,
    itemId: Uuid.optional(),
    incluirPaciente: z.boolean().default(false),
  })
  .strict()
export const FiltrosSaidasDeEstoque = CamposSaidasDeEstoque.superRefine(comPeriodo)

/** Relatório 15. Tarefas com PRAZO em `[de, ate]` — o recorte do Painel. */
export const CamposTarefasDaEquipe = z
  .object({ de: DiaCivil, ate: DiaCivil, responsavelId: Uuid.optional() })
  .strict()
export const FiltrosTarefasDaEquipe = CamposTarefasDaEquipe.superRefine(comPeriodo)

export const FILTROS_DOS_RELATORIOS = {
  'pacientes-sem-compra': FiltrosPacientesSemCompra,
  recebimentos: FiltrosRecebimentos,
  'saidas-de-estoque': FiltrosSaidasDeEstoque,
  'tarefas-da-equipe': FiltrosTarefasDaEquipe,
} as const satisfies Record<ChaveDeRelatorio, z.ZodTypeAny>

export type FiltrosDoRelatorio<K extends ChaveDeRelatorio> = z.infer<(typeof FILTROS_DOS_RELATORIOS)[K]>
/** A forma de ENTRADA (antes dos padrões): o que a tela manda e o favorito guarda. */
export type FiltrosDigitados<K extends ChaveDeRelatorio> = z.input<(typeof FILTROS_DOS_RELATORIOS)[K]>


/* ---------------------------------------------------------------- catálogo */

export const TipoDeColuna = z.enum(['texto', 'data', 'dinheiro', 'quantidade', 'numero', 'situacao'])
export type TipoDeColuna = z.infer<typeof TipoDeColuna>

export type ColunaDoCatalogo = {
  readonly chave: string
  readonly rotulo: string
  readonly tipo: TipoDeColuna
  /** Só sai quando escolhida: telefone na exportação, paciente no relatório 11. */
  readonly optIn?: 'telefone' | 'paciente'
  /** Só sai quando o filtro está presente (I-38: "procedimento só se filtrado"). */
  readonly seFiltradoPor?: string
}

export type DefinicaoDeRelatorio = {
  readonly numero: number
  readonly titulo: string
  readonly permissao: ChaveDePermissao
  readonly classe: ClasseDeRelatorio
  readonly listaDePacientes: boolean
  readonly colunas: readonly ColunaDoCatalogo[]
}

export const CATALOGO_DE_RELATORIOS = {
  'pacientes-sem-compra': {
    numero: 1,
    titulo: 'Pacientes sem compra',
    permissao: 'pacientes',
    classe: 'pessoal',
    listaDePacientes: true,
    colunas: [
      { chave: 'nome', rotulo: 'Paciente', tipo: 'texto' },
      { chave: 'ultimaCompra', rotulo: 'Última compra', tipo: 'data' },
      { chave: 'procedimento', rotulo: 'Procedimento', tipo: 'texto', seFiltradoPor: 'procedimentoId' },
      { chave: 'valorDaUltimaCompra', rotulo: 'Valor da última compra', tipo: 'dinheiro' },
      { chave: 'ltv', rotulo: 'LTV', tipo: 'dinheiro' },
      { chave: 'telefone', rotulo: 'Telefone', tipo: 'texto', optIn: 'telefone' },
    ],
  },
  recebimentos: {
    numero: 8,
    titulo: 'Recebimentos',
    permissao: 'finmes',
    classe: 'pessoal',
    listaDePacientes: false,
    colunas: [
      { chave: 'data', rotulo: 'Data', tipo: 'data' },
      { chave: 'tipo', rotulo: 'Tipo', tipo: 'texto' },
      { chave: 'forma', rotulo: 'Forma', tipo: 'texto' },
      { chave: 'valor', rotulo: 'Valor', tipo: 'dinheiro' },
      { chave: 'paciente', rotulo: 'Paciente', tipo: 'texto' },
      { chave: 'registradoPor', rotulo: 'Quem registrou', tipo: 'texto' },
    ],
  },
  'saidas-de-estoque': {
    numero: 11,
    titulo: 'Saídas de estoque',
    permissao: 'estoque.gerir',
    classe: 'nenhuma',
    listaDePacientes: false,
    colunas: [
      { chave: 'data', rotulo: 'Data', tipo: 'data' },
      { chave: 'item', rotulo: 'Item', tipo: 'texto' },
      { chave: 'lote', rotulo: 'Lote (validade)', tipo: 'data' },
      { chave: 'quantidadeEmEstoque', rotulo: 'Quantidade', tipo: 'quantidade' },
      { chave: 'unidade', rotulo: 'Unidade', tipo: 'texto' },
      { chave: 'motivo', rotulo: 'Motivo', tipo: 'texto' },
      { chave: 'registradoPor', rotulo: 'Quem registrou', tipo: 'texto' },
      { chave: 'custo', rotulo: 'Custo', tipo: 'dinheiro' },
      { chave: 'paciente', rotulo: 'Paciente', tipo: 'texto', optIn: 'paciente' },
    ],
  },
  'tarefas-da-equipe': {
    numero: 15,
    titulo: 'Tarefas da equipe',
    permissao: 'tarefas.equipe',
    classe: 'nenhuma',
    listaDePacientes: false,
    colunas: [
      { chave: 'tarefa', rotulo: 'Tarefa', tipo: 'texto' },
      { chave: 'responsavel', rotulo: 'Responsável', tipo: 'texto' },
      { chave: 'prazo', rotulo: 'Prazo', tipo: 'data' },
      { chave: 'concluidaEm', rotulo: 'Concluída em', tipo: 'data' },
      { chave: 'noPrazo', rotulo: 'No prazo?', tipo: 'situacao' },
    ],
  },
} as const satisfies Record<ChaveDeRelatorio, DefinicaoDeRelatorio>

/**
 * **A CLASSE EM TEMPO DE EXECUÇÃO** (LGPD L-IN-1, L-IN-2): o relatório 1 sobe
 * para `saude` com o filtro de procedimento; o 11, com a coluna de paciente
 * pedida. É uma função só, para o servidor (que exige `jornada` e a finalidade)
 * e para a tela (que pede a finalidade antes de exportar).
 */
export function classeDoRelatorio(chave: ChaveDeRelatorio, filtros: Readonly<Record<string, unknown>>): ClasseDeRelatorio {
  if (chave === 'pacientes-sem-compra' && filtros['procedimentoId'] !== undefined) return 'saude'
  if (chave === 'saidas-de-estoque' && filtros['incluirPaciente'] === true) return 'saude'
  return CATALOGO_DE_RELATORIOS[chave].classe
}

/** Filtro em reais (I-40): exige `valores`. */
export const temFaixaDeValor = (filtros: Readonly<Record<string, unknown>>): boolean =>
  filtros['valorMinimo'] !== undefined || filtros['valorMaximo'] !== undefined

/* ------------------------------------------------------------------ linhas */

const Dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Relatório 1 (I-38): nome, última compra, procedimento só se filtrado, valor e LTV com `valores`; telefone opt-in. */
export const LinhaPacientesSemCompra = z
  .object({
    pacienteId: Uuid,
    nome: z.string(),
    ultimaCompra: Dia,
    procedimento: z.string().optional(),
    valorDaUltimaCompra: centavosNaSaida,
    ltv: centavosNaSaida,
    telefone: z.string().optional(),
  })
  .strict()

/**
 * Relatório 8: uma linha por PARTE do pagamento. No dia aguardando fechamento
 * (e hoje com o caixa aberto), `valor` e `forma` saem `null`: o dinheiro desses
 * dias aparece só no total `aguardandoFechamento` (números c.10; appsec C11).
 * Paciente desativado ou anonimizado sai com `paciente: null`, e a linha fica —
 * sem ela, a soma deixaria de bater com a Visão do mês.
 */
export const LinhaRecebimento = z
  .object({
    recebimentoId: Uuid,
    pacienteId: Uuid.nullable(),
    data: Dia,
    tipo: z.string(),
    forma: z.string().nullable(),
    valor: centavosNaSaida,
    paciente: z.string().nullable(),
    registradoPor: z.string().nullable(),
  })
  .strict()

/** Relatório 11. Compensação de reabertura = linha com quantidade e custo NEGATIVOS (números B8). */
export const LinhaSaidaDeEstoque = z
  .object({
    movimentoId: Uuid,
    itemId: Uuid,
    data: Dia,
    item: z.string(),
    lote: Dia.nullable(),
    quantidadeEmEstoque: QuantidadeNaSaida,
    unidade: z.string(),
    motivo: z.string(),
    registradoPor: z.string().nullable(),
    custo: centavosNaSaida,
    /** Só com `incluirPaciente` E `jornada` (L-IN-2). */
    pacienteId: Uuid.nullable().optional(),
    paciente: z.string().nullable().optional(),
  })
  .strict()

/** A classificação de `consultarPrazos`, por tarefa. */
export const SituacaoDoPrazo = z.enum(['ok', 'tarde', 'atrasada', 'a_vencer'])

/** Relatório 15: sem paciente (I-38). */
export const LinhaTarefaDaEquipe = z
  .object({
    tarefaId: Uuid,
    tarefa: z.string(),
    responsavel: z.string().nullable(),
    prazo: Dia,
    concluidaEm: Dia.nullable(),
    noPrazo: SituacaoDoPrazo,
  })
  .strict()

/* ----------------------------------------------------------------- resumos */

export const ResumoPacientesSemCompra = z.object({ pacientes: z.number().int() }).strict()

/** `valor` é nome monetário: sem `valores`, sai `null` inteiro (a redação casa a chave). */
export const TotalComRotulo = z.object({ rotulo: z.string(), valor: ValorNaTelaSchema.nullable() }).strict()

/**
 * Relatório 8. `total`, `porForma` e `porTipo` somam SÓ os dias que contam; o
 * resto do período é `aguardandoFechamento`, um total só (números c.10).
 * `recebimentos` = `count(DISTINCT r.id)` dos dias que contam (números c.15).
 */
export const ResumoRecebimentos = z
  .object({
    recebimentos: z.number().int(),
    total: ValorNaTelaSchema,
    porForma: z.array(TotalComRotulo),
    porTipo: z.array(TotalComRotulo),
    aguardandoFechamento: centavosNaSaida,
    diasAguardando: z.number().int(),
  })
  .strict()

export const ResumoSaidasDeEstoque = z.object({ linhas: z.number().int(), custo: centavosNaSaida }).strict()

/** Relatório 15: o MESMO `prazos` de `GET /v1/painel` para o período. */
export const ResumoTarefasDaEquipe = z.object({ prazos: CumprimentoDePrazos }).strict()

/* --------------------------------------------------------------- respostas */

export const ColunaNaSaida = z.object({ chave: z.string(), rotulo: z.string(), tipo: TipoDeColuna }).strict()
export type ColunaNaSaida = z.infer<typeof ColunaNaSaida>

/** Pronto do servidor, sem dinheiro (appsec C8): procedimento e item pelo nome, a faixa de valor só como "aplicada". */
export const CabecalhoDoRelatorio = z.object({ titulo: z.string(), filtrosEmTexto: z.array(z.string()) }).strict()

const resultado = <K extends ChaveDeRelatorio, L extends z.ZodTypeAny, R extends z.ZodTypeAny>(chave: K, linha: L, resumo: R) =>
  z
    .object({
      relatorio: z.literal(chave),
      classe: ClasseDeRelatorio,
      cabecalho: CabecalhoDoRelatorio,
      colunas: z.array(ColunaNaSaida),
      linhas: z.array(linha),
      resumo,
      truncado: z.boolean(),
    })
    .strict()

export const ResultadoPacientesSemCompra = resultado('pacientes-sem-compra', LinhaPacientesSemCompra, ResumoPacientesSemCompra)
export const ResultadoRecebimentos = resultado('recebimentos', LinhaRecebimento, ResumoRecebimentos)
export const ResultadoSaidasDeEstoque = resultado('saidas-de-estoque', LinhaSaidaDeEstoque, ResumoSaidasDeEstoque)
export const ResultadoTarefasDaEquipe = resultado('tarefas-da-equipe', LinhaTarefaDaEquipe, ResumoTarefasDaEquipe)

export const ResultadoDoRelatorio = z.discriminatedUnion('relatorio', [
  ResultadoPacientesSemCompra,
  ResultadoRecebimentos,
  ResultadoSaidasDeEstoque,
  ResultadoTarefasDaEquipe,
])
export type ResultadoDoRelatorio = z.infer<typeof ResultadoDoRelatorio>

/** `POST /v1/relatorios/:chave/execucoes`. Os filtros são validados pelo schema do relatório. */
export const ExecutarRelatorio = z.object({ filtros: z.record(z.unknown()) }).strict()

/** `POST /v1/relatorios/:chave/exportacoes` (I-39). Telefone desligado por padrão (L-IN-6). */
export const ExportarRelatorio = z
  .object({
    filtros: z.record(z.unknown()),
    formato: FormatoDeExportacao,
    incluirTelefone: z.boolean().default(false),
    finalidade: FinalidadeDeExportacao.optional(),
  })
  .strict()
export type ExportarRelatorio = z.input<typeof ExportarRelatorio>

/** LGPD L-IN-12: o cabeçalho do arquivo, pronto, no fuso da clínica e sem dinheiro. */
export const CabecalhoDaExportacao = z
  .object({
    clinica: z.string(),
    relatorio: z.string(),
    filtrosEmTexto: z.array(z.string()),
    /** `dd/mm/aaaa hh:mm`, no fuso da clínica. */
    geradoEm: z.string(),
    exportadoPor: z.string(),
    codigo: z.string().regex(/^[0-9a-f]{8}$/),
    /** O rótulo da finalidade (classe `saude`), ou `null`. */
    finalidade: z.string().nullable(),
    /** `null` na classe `nenhuma`. */
    aviso: z.string().nullable(),
  })
  .strict()

export const ExportacaoNaSaida = z
  .object({
    /** O id da exportação (L-IN-10): vai no cabeçalho e no nome do arquivo, e é o `entidade_id` da trilha. */
    codigo: z.string().regex(/^[0-9a-f]{8}$/),
    /** `fir-<relatorio>-<AAAAMMDD>-<codigo>.<ext>`; `.pdf` na impressão. */
    nomeDoArquivo: z.string(),
    formato: FormatoDeExportacao,
    cabecalho: CabecalhoDaExportacao,
  })
  .strict()

export const ResultadoDaExportacao = z.object({ exportacao: ExportacaoNaSaida, resultado: ResultadoDoRelatorio }).strict()
export type ResultadoDaExportacao = z.infer<typeof ResultadoDaExportacao>

/* --------------------------------------------------------------- favoritos */

/** LGPD L-IN-17: a tela avisa "não use nome de paciente". */
const NomeDoFavorito = z.string().trim().min(1, 'Dê um nome ao favorito.').max(80, 'No máximo 80 caracteres.')

export const SalvarFavorito = z
  .object({ chave: ChaveDeRelatorio, nome: NomeDoFavorito, filtros: z.record(z.unknown()) })
  .strict()
export type SalvarFavorito = z.infer<typeof SalvarFavorito>

export const EditarFavorito = z
  .object({ nome: NomeDoFavorito.optional(), filtros: z.record(z.unknown()).optional() })
  .strict()
export type EditarFavorito = z.infer<typeof EditarFavorito>

/**
 * O favorito na lista. `filtros: null` com `desatualizado: true` quando o que
 * está gravado não passa mais no schema do relatório (I-41). Sem `valores`, a
 * faixa de valor sai `null` pela redação (appsec C9) — e rodar dá 403.
 */
export const FavoritoNaLista = z
  .object({
    id: Uuid,
    chave: ChaveDeRelatorio,
    nome: z.string(),
    /**
     * Já validados pelo schema do relatório no servidor (I-41). `record`, e não
     * o schema estrito: sem `valores`, a redação devolve `valorMinimo: null`, e a
     * tela precisa ler o favorito assim mesmo para mostrar "faixa de valor".
     */
    filtros: z.record(z.unknown()).nullable(),
    desatualizado: z.boolean(),
    criadoEm: z.string(),
  })
  .strict()
export type FavoritoNaLista = z.infer<typeof FavoritoNaLista>

export const RelatorioNaLista = z
  .object({
    chave: ChaveDeRelatorio,
    numero: z.number().int(),
    titulo: z.string(),
    classe: ClasseDeRelatorio,
    listaDePacientes: z.boolean(),
    colunas: z.array(ColunaNaSaida),
  })
  .strict()

/** `GET /v1/relatorios`: só os relatórios (e os favoritos) que a pessoa pode abrir (appsec C19). */
export const ListaDeRelatorios = z
  .object({ relatorios: z.array(RelatorioNaLista), favoritos: z.array(FavoritoNaLista) })
  .strict()
export type ListaDeRelatorios = z.infer<typeof ListaDeRelatorios>
