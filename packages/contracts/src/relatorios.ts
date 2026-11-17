import { type ChaveDePermissao, somarMeses } from '@fir/domain'
import { z } from 'zod'
import { MAX_LINHAS_DA_CAMPANHA, SalvarCampanha } from './campanhas'
import { centavosNaSaida, DiaCivil, Uuid } from './comum'
import { QuantidadeNaSaida } from './estoque'
import { tipoQueNaoEhPagamento } from './tarefas'
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

/** Na ordem do número do relatório (spec "Os 15 relatórios"). */
export const CHAVES_DE_RELATORIO = [
  'pacientes-sem-compra',
  'pacientes-sem-atendimento',
  'pacientes-maior-ltv',
  'pacientes-que-indicaram',
  'pacientes-por-procedimento',
  'pacientes-por-origem-e-campanha',
  'aniversariantes',
  'recebimentos',
  'saldos-em-aberto',
  'contas',
  'saidas-de-estoque',
  'entradas-de-estoque',
  'orcamentos',
  'faltas-e-desmarcacoes',
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

/* ---- T9 --------------------------------------------------------------- */

/** Um período `[de, ate]` em dias civis da clínica, sem mais nada. */
const CamposDoPeriodo = z.object({ de: DiaCivil, ate: DiaCivil }).strict()

/**
 * Relatório 2. "Atendimento" é o MOVIMENTO da lista de pacientes: o mais
 * recente entre o último atendimento registrado e a última consulta do
 * cadastro (o atalho "Sem retorno"). Quem nunca veio não entra.
 */
export const FiltrosPacientesSemAtendimento = z
  .object({ semAtendimentoHaMeses: z.number().int().min(1).max(JANELA_MAXIMA_EM_MESES) })
  .strict()

/** Relatório 3 (top N por LTV). O relatório inteiro exige `valores` (números c.11c). */
export const FiltrosPacientesMaiorLtv = z
  .object({ quantos: z.number().int().min(1).max(500).default(50) })
  .strict()

/** Relatório 4. A janela é a do CADASTRO da indicada, como em "Quem mais indica" do Painel. */
export const FiltrosPacientesQueIndicaram = CamposDoPeriodo.superRefine(comPeriodo)

/** Relatório 5. Classe `saude`: exige `jornada` além de `programas` (LGPD L-IN-2). */
export const FiltrosPacientesPorProcedimento = z
  .object({ procedimentoId: Uuid.optional(), incluirEncerrados: z.boolean().default(false) })
  .strict()

/** Relatório 6. Os pacientes CADASTRADOS em `[de, ate]` — a janela de "Novos pacientes" do Painel. */
export const FiltrosPacientesPorOrigemECampanha = z
  .object({ de: DiaCivil, ate: DiaCivil, campanhaId: Uuid.optional() })
  .strict()
  .superRefine(comPeriodo)

/** Relatório 7. O mês do aniversário; a idade é a de hoje, no fuso da clínica. */
export const FiltrosAniversariantes = z.object({ mes: z.number().int().min(1).max(12) }).strict()

/**
 * Relatório 9. `ate` é o CORTE: o saldo no fim daquele dia (`saldosDe(…, { ate })`,
 * números c.9). Ausente = agora. A faixa de valor é do valor em aberto do grupo,
 * e exige `valores` (I-40).
 */
export const CamposSaldosEmAberto = z
  .object({
    ate: DiaCivil.optional(),
    valorMinimo: CentavosDoFiltro.optional(),
    valorMaximo: CentavosDoFiltro.optional(),
  })
  .strict()
export const FiltrosSaldosEmAberto = CamposSaldosEmAberto.superRefine(comFaixa)

/** Relatório 10. Contas com VENCIMENTO em `[de, ate]`. */
export const FiltrosContas = z
  .object({ de: DiaCivil, ate: DiaCivil, situacao: z.enum(['todas', 'abertas', 'pagas']).default('todas') })
  .strict()
  .superRefine(comPeriodo)

/** Relatório 12. As entradas com dia em `[de, ate]`. */
export const FiltrosEntradasDeEstoque = z
  .object({ de: DiaCivil, ate: DiaCivil, itemId: Uuid.optional() })
  .strict()
  .superRefine(comPeriodo)

/** Relatório 13. Os orçamentos REGISTRADOS em `[de, ate]` (evento vivo `registrarOrcamento`). */
export const FiltrosOrcamentos = CamposDoPeriodo.superRefine(comPeriodo)

/** Relatório 14. As faltas e desmarcações com dia em `[de, ate]`. */
export const FiltrosFaltasEDesmarcacoes = CamposDoPeriodo.superRefine(comPeriodo)

export const FILTROS_DOS_RELATORIOS = {
  'pacientes-sem-compra': FiltrosPacientesSemCompra,
  'pacientes-sem-atendimento': FiltrosPacientesSemAtendimento,
  'pacientes-maior-ltv': FiltrosPacientesMaiorLtv,
  'pacientes-que-indicaram': FiltrosPacientesQueIndicaram,
  'pacientes-por-procedimento': FiltrosPacientesPorProcedimento,
  'pacientes-por-origem-e-campanha': FiltrosPacientesPorOrigemECampanha,
  aniversariantes: FiltrosAniversariantes,
  recebimentos: FiltrosRecebimentos,
  'saldos-em-aberto': FiltrosSaldosEmAberto,
  contas: FiltrosContas,
  'saidas-de-estoque': FiltrosSaidasDeEstoque,
  'entradas-de-estoque': FiltrosEntradasDeEstoque,
  orcamentos: FiltrosOrcamentos,
  'faltas-e-desmarcacoes': FiltrosFaltasEDesmarcacoes,
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
  /**
   * Permissões que o relatório exige ALÉM da dele (T9): o 3 é um ranking em
   * reais e exige `valores` para existir (números c.11c); o 5 é de saúde e
   * exige `jornada` (LGPD L-IN-2). Sem elas, o relatório não aparece na lista
   * e rodá-lo é 403 — `podeAbrirRelatorio` é a conferência única.
   */
  readonly exigeTambem?: readonly ChaveDePermissao[]
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
  'pacientes-sem-atendimento': {
    numero: 2,
    titulo: 'Pacientes sem atendimento',
    permissao: 'pacientes',
    classe: 'pessoal',
    listaDePacientes: true,
    colunas: [
      { chave: 'nome', rotulo: 'Paciente', tipo: 'texto' },
      { chave: 'ultimoAtendimento', rotulo: 'Último atendimento', tipo: 'data' },
      { chave: 'telefone', rotulo: 'Telefone', tipo: 'texto', optIn: 'telefone' },
    ],
  },
  'pacientes-maior-ltv': {
    numero: 3,
    titulo: 'Pacientes com maior LTV',
    permissao: 'pacientes',
    exigeTambem: ['valores'],
    classe: 'pessoal',
    listaDePacientes: true,
    colunas: [
      { chave: 'nome', rotulo: 'Paciente', tipo: 'texto' },
      { chave: 'ltv', rotulo: 'LTV', tipo: 'dinheiro' },
      { chave: 'ticketMedio', rotulo: 'Ticket médio', tipo: 'dinheiro' },
      { chave: 'compras', rotulo: 'Compras', tipo: 'numero' },
      { chave: 'telefone', rotulo: 'Telefone', tipo: 'texto', optIn: 'telefone' },
    ],
  },
  'pacientes-que-indicaram': {
    numero: 4,
    titulo: 'Pacientes que indicaram',
    permissao: 'pacientes',
    classe: 'pessoal',
    listaDePacientes: true,
    colunas: [
      { chave: 'indicadora', rotulo: 'Indicadora', tipo: 'texto' },
      { chave: 'indicadas', rotulo: 'Indicadas', tipo: 'numero' },
      { chave: 'viraramPacientes', rotulo: 'Viraram pacientes', tipo: 'numero' },
      { chave: 'receitaDasIndicadas', rotulo: 'Receita das indicadas', tipo: 'dinheiro' },
      { chave: 'telefone', rotulo: 'Telefone', tipo: 'texto', optIn: 'telefone' },
    ],
  },
  'pacientes-por-procedimento': {
    numero: 5,
    titulo: 'Pacientes por procedimento',
    permissao: 'programas',
    exigeTambem: ['jornada'],
    classe: 'saude',
    listaDePacientes: true,
    colunas: [
      { chave: 'nome', rotulo: 'Paciente', tipo: 'texto' },
      { chave: 'procedimento', rotulo: 'Procedimento', tipo: 'texto' },
      { chave: 'sessoesFeitas', rotulo: 'Sessões feitas', tipo: 'numero' },
      { chave: 'sessoesRestantes', rotulo: 'Sessões restantes', tipo: 'numero' },
      { chave: 'valor', rotulo: 'Valor', tipo: 'dinheiro' },
      { chave: 'telefone', rotulo: 'Telefone', tipo: 'texto', optIn: 'telefone' },
    ],
  },
  'pacientes-por-origem-e-campanha': {
    numero: 6,
    titulo: 'Pacientes por origem e campanha',
    permissao: 'pacientes',
    classe: 'pessoal',
    listaDePacientes: true,
    colunas: [
      { chave: 'nome', rotulo: 'Paciente', tipo: 'texto' },
      { chave: 'origem', rotulo: 'Origem', tipo: 'texto' },
      { chave: 'campanha', rotulo: 'Campanha', tipo: 'texto' },
      { chave: 'convertido', rotulo: 'Convertido?', tipo: 'situacao' },
      { chave: 'receita', rotulo: 'Receita', tipo: 'dinheiro' },
      { chave: 'telefone', rotulo: 'Telefone', tipo: 'texto', optIn: 'telefone' },
    ],
  },
  aniversariantes: {
    numero: 7,
    titulo: 'Aniversariantes',
    permissao: 'pacientes',
    classe: 'pessoal',
    listaDePacientes: true,
    colunas: [
      { chave: 'nome', rotulo: 'Paciente', tipo: 'texto' },
      { chave: 'diaEMes', rotulo: 'Aniversário', tipo: 'texto' },
      { chave: 'idade', rotulo: 'Idade', tipo: 'numero' },
      { chave: 'ultimoAtendimento', rotulo: 'Último atendimento', tipo: 'data' },
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
  'saldos-em-aberto': {
    numero: 9,
    titulo: 'Saldos em aberto',
    permissao: 'cobrancas',
    classe: 'pessoal',
    listaDePacientes: true,
    colunas: [
      { chave: 'nome', rotulo: 'Paciente', tipo: 'texto' },
      { chave: 'adesao', rotulo: 'Adesão', tipo: 'texto' },
      { chave: 'valorAberto', rotulo: 'Valor em aberto', tipo: 'dinheiro' },
      { chave: 'desde', rotulo: 'Em aberto desde', tipo: 'data' },
      { chave: 'telefone', rotulo: 'Telefone', tipo: 'texto', optIn: 'telefone' },
    ],
  },
  contas: {
    numero: 10,
    titulo: 'Contas a pagar',
    permissao: 'contas.gerir',
    classe: 'nenhuma',
    listaDePacientes: false,
    colunas: [
      { chave: 'vencimento', rotulo: 'Vencimento', tipo: 'data' },
      { chave: 'descricao', rotulo: 'Descrição', tipo: 'texto' },
      { chave: 'categoria', rotulo: 'Categoria', tipo: 'texto' },
      { chave: 'valor', rotulo: 'Valor', tipo: 'dinheiro' },
      { chave: 'pagoEm', rotulo: 'Pago em', tipo: 'data' },
      { chave: 'valorPago', rotulo: 'Valor pago', tipo: 'dinheiro' },
      { chave: 'forma', rotulo: 'Forma', tipo: 'texto' },
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
  'entradas-de-estoque': {
    numero: 12,
    titulo: 'Entradas de estoque',
    permissao: 'estoque.gerir',
    classe: 'nenhuma',
    listaDePacientes: false,
    colunas: [
      { chave: 'data', rotulo: 'Data', tipo: 'data' },
      { chave: 'item', rotulo: 'Item', tipo: 'texto' },
      { chave: 'quantidadeEmEstoque', rotulo: 'Quantidade', tipo: 'quantidade' },
      { chave: 'unidade', rotulo: 'Unidade', tipo: 'texto' },
      { chave: 'lote', rotulo: 'Lote (validade)', tipo: 'data' },
      { chave: 'custo', rotulo: 'Custo', tipo: 'dinheiro' },
    ],
  },
  orcamentos: {
    numero: 13,
    titulo: 'Orçamentos',
    permissao: 'jornada',
    classe: 'saude',
    listaDePacientes: false,
    colunas: [
      { chave: 'nome', rotulo: 'Paciente', tipo: 'texto' },
      { chave: 'data', rotulo: 'Orçado em', tipo: 'data' },
      { chave: 'etapa', rotulo: 'Etapa', tipo: 'situacao' },
      { chave: 'motivo', rotulo: 'Motivo da perda', tipo: 'texto' },
      { chave: 'valorOrcamento', rotulo: 'Valor orçado', tipo: 'dinheiro' },
      { chave: 'valorFechado', rotulo: 'Valor fechado', tipo: 'dinheiro' },
    ],
  },
  'faltas-e-desmarcacoes': {
    numero: 14,
    titulo: 'Faltas e desmarcações',
    permissao: 'jornada',
    classe: 'pessoal',
    listaDePacientes: true,
    colunas: [
      { chave: 'nome', rotulo: 'Paciente', tipo: 'texto' },
      { chave: 'data', rotulo: 'Data', tipo: 'data' },
      { chave: 'motivo', rotulo: 'Motivo', tipo: 'situacao' },
      { chave: 'situacao', rotulo: 'Recontato', tipo: 'situacao' },
      { chave: 'recontatadaEm', rotulo: 'Recontatada em', tipo: 'data' },
      { chave: 'telefone', rotulo: 'Telefone', tipo: 'texto', optIn: 'telefone' },
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

/**
 * **Quem abre o relatório** (appsec C19, C20): a permissão dele e as que ele
 * exige também. Uma função só para o motor, os favoritos, a lista e "Criar
 * campanha" — e para a tela, que esconde o que o servidor recusaria.
 */
export function podeAbrirRelatorio(chave: ChaveDeRelatorio, pode: (k: ChaveDePermissao) => boolean): boolean {
  const def: DefinicaoDeRelatorio = CATALOGO_DE_RELATORIOS[chave]
  return pode(def.permissao) && (def.exigeTambem ?? []).every(pode)
}

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

/* ---- linhas do T9 (as colunas padrão da I-38, LGPD L-IN-6) ----------- */

/** Relatório 2: nome e o último atendimento; telefone opt-in. Nunca aniversário nem observação. */
export const LinhaPacientesSemAtendimento = z
  .object({ pacienteId: Uuid, nome: z.string(), ultimoAtendimento: Dia, telefone: z.string().optional() })
  .strict()

/** Relatório 3: o ranking por LTV. `ticketMedio` = LTV ÷ compras, por `Dinheiro.media`. Nunca procedimento. */
export const LinhaPacientesMaiorLtv = z
  .object({
    pacienteId: Uuid,
    nome: z.string(),
    ltv: centavosNaSaida,
    ticketMedio: centavosNaSaida,
    compras: z.number().int(),
    telefone: z.string().optional(),
  })
  .strict()

/**
 * Relatório 4: a INDICADORA. Nunca o nome das indicadas — são terceiras (I-38).
 * `viraramPacientes`: indicadas com ao menos uma compra. `receitaDasIndicadas`:
 * o que elas pagaram NO PERÍODO, só nos dias de caixa fechado (números N-22).
 */
export const LinhaPacientesQueIndicaram = z
  .object({
    pacienteId: Uuid,
    indicadora: z.string(),
    indicadas: z.number().int(),
    viraramPacientes: z.number().int(),
    receitaDasIndicadas: centavosNaSaida,
    telefone: z.string().optional(),
  })
  .strict()

/** Relatório 5: um item de programa por linha. Nunca dose nem lote. */
export const LinhaPacientesPorProcedimento = z
  .object({
    pacienteId: Uuid,
    programaId: Uuid,
    procedimentoId: Uuid,
    nome: z.string(),
    procedimento: z.string(),
    sessoesFeitas: z.number().int(),
    sessoesRestantes: z.number().int(),
    valor: centavosNaSaida,
    telefone: z.string().optional(),
  })
  .strict()

/**
 * Relatório 6: nunca procedimento. "Convertido" = já atendida, como "já atendidos" do Painel.
 * `receita` = o LTV do Painel SEM os dias do mês corrente que ainda não contam
 * (sem caixa fechado, e hoje): por paciente, o dia aberto seria o esperado da gaveta (regra 6).
 */
export const LinhaPacientesPorOrigemECampanha = z
  .object({
    pacienteId: Uuid,
    campanhaId: Uuid.nullable(),
    nome: z.string(),
    origem: z.string(),
    campanha: z.string().nullable(),
    convertido: z.enum(['sim', 'nao']),
    receita: centavosNaSaida,
    telefone: z.string().optional(),
  })
  .strict()

/** Relatório 7: dia/mês e idade — NUNCA a data completa de nascimento (I-38, divergência por lei). */
export const LinhaAniversariante = z
  .object({
    pacienteId: Uuid,
    nome: z.string(),
    diaEMes: z.string().regex(/^\d{2}\/\d{2}$/),
    idade: z.number().int().nullable(),
    ultimoAtendimento: Dia.nullable(),
    telefone: z.string().optional(),
  })
  .strict()

/**
 * Relatório 9: UMA LINHA POR GRUPO DE SALDO (regra 5) — a adesão, ou o grupo
 * geral. A adesão leva o nome do programa (os procedimentos dele), e nada além.
 */
export const LinhaSaldoEmAberto = z
  .object({
    pacienteId: Uuid,
    programaId: Uuid.nullable(),
    nome: z.string(),
    adesao: z.string(),
    valorAberto: centavosNaSaida,
    desde: Dia.nullable(),
    telefone: z.string().optional(),
  })
  .strict()

/** Relatório 10. `forma` é a usada na conta paga e a prevista na aberta, como no filtro da tela. */
export const LinhaConta = z
  .object({
    contaId: Uuid,
    vencimento: Dia,
    descricao: z.string(),
    categoria: z.string(),
    valor: centavosNaSaida,
    pagoEm: Dia.nullable(),
    valorPago: centavosNaSaida,
    forma: z.string(),
  })
  .strict()

/** Relatório 12. Custo da linha = quantidade × custo da entrada, meio-para-cima (`custoDaQuantidade`). */
export const LinhaEntradaDeEstoque = z
  .object({
    movimentoId: Uuid,
    itemId: Uuid,
    data: Dia,
    item: z.string(),
    quantidadeEmEstoque: QuantidadeNaSaida,
    unidade: z.string(),
    lote: Dia.nullable(),
    custo: centavosNaSaida,
  })
  .strict()

/**
 * Relatório 13. "Valor fechado" é o `orc_valor` do protótipo e do Painel, por
 * cartão: os "Pagamento de orçamento" dele concluídos no período, SÓ nos dias
 * que contam (regra 6). Σ da coluna = `resumo.valorFechado`. Sem pagamento que
 * conte, `null`. `valorOrcamento` é o orçado: coluna à parte, nunca somada
 * (regra 4). O pagamento sem cartão é linha própria. Nunca a nota do histórico.
 */
export const LinhaOrcamento = z
  .object({
    /** Paciente desativada: `null` nos ids e no nome; a linha fica, porque o Painel a conta (appsec M2). */
    tarefaId: Uuid.nullable(),
    pacienteId: Uuid.nullable(),
    nome: z.string().nullable(),
    data: Dia,
    etapa: z.string(),
    motivo: z.string().nullable(),
    valorOrcamento: centavosNaSaida,
    valorFechado: centavosNaSaida,
  })
  .strict()

/**
 * Relatório 14 (I-11). `recontatada`: até o dia da falta + 2; `recontatada-depois`:
 * depois disso; `aguardando-prazo`: sem recontato e o prazo ainda corre;
 * `sem-recontato`: o prazo passou.
 */
export const SituacaoDoRecontato = z.enum(['recontatada', 'recontatada-depois', 'aguardando-prazo', 'sem-recontato'])
export const LinhaFaltaOuDesmarcacao = z
  .object({
    /** Paciente desativada ou anonimizada: `null` nos TRÊS ids e no nome, e a linha fica — o KPI a conta. */
    tarefaId: Uuid.nullable(),
    pacienteId: Uuid.nullable(),
    nome: z.string().nullable(),
    data: Dia,
    motivo: z.enum(['falta', 'desmarcacao']),
    situacao: SituacaoDoRecontato,
    recontatadaEm: Dia.nullable(),
    telefone: z.string().optional(),
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

/* ---- resumos do T9 (contagens; o dinheiro só em campo monetário tipado) */

/** Relatórios 2, 3, 7: quantos pacientes. */
export const ResumoDePacientes = z.object({ pacientes: z.number().int() }).strict()

export const ResumoPacientesQueIndicaram = z.object({ indicadoras: z.number().int(), indicadas: z.number().int() }).strict()

export const ResumoPacientesPorProcedimento = z.object({ pacientes: z.number().int(), programas: z.number().int() }).strict()

/** Relatório 6: por origem, as contagens de "Novos pacientes" do Painel para o mesmo período. */
export const ResumoPacientesPorOrigemECampanha = z
  .object({
    pacientes: z.number().int(),
    convertidos: z.number().int(),
    porOrigem: z.array(z.object({ origem: z.string(), novos: z.number().int(), jaAtendidos: z.number().int() }).strict()),
  })
  .strict()

/** Relatório 9: `aReceber` = Σ das linhas. Com o corte em hoje, é o `aReceber` de Cobranças. */
export const ResumoSaldosEmAberto = z
  .object({ pacientes: z.number().int(), grupos: z.number().int(), aReceber: centavosNaSaida })
  .strict()

export const ResumoContas = z.object({ contas: z.number().int(), valor: centavosNaSaida, valorPago: centavosNaSaida }).strict()

export const ResumoEntradasDeEstoque = z.object({ linhas: z.number().int(), custo: centavosNaSaida }).strict()

/**
 * Relatório 13. `enviados` e `fechados` são os passos do funil do Painel no
 * mesmo período (`contarConversaoDeOrcamentos`: eventos, não cartões — o
 * cartão reorçado conta duas vezes lá, e aqui é uma linha). `valorFechado` é
 * o `orc_valor` do Painel e do KPI no período, só nos dias que contam
 * (números c.3), e é exatamente a Σ da coluna `valorFechado`.
 */
export const ResumoOrcamentos = z
  .object({
    orcamentos: z.number().int(),
    enviados: z.number().int(),
    fechados: z.number().int(),
    valorFechado: centavosNaSaida,
  })
  .strict()

/** Relatório 14: o KPI `faltas_recontatadas` é `recontatadasEmAteDoisDias ÷ maduras` (I-11). */
export const ResumoFaltasEDesmarcacoes = z
  .object({
    faltas: z.number().int(),
    maduras: z.number().int(),
    recontatadasEmAteDoisDias: z.number().int(),
    aguardandoPrazo: z.number().int(),
  })
  .strict()

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
export const ResultadoPacientesSemAtendimento = resultado('pacientes-sem-atendimento', LinhaPacientesSemAtendimento, ResumoDePacientes)
export const ResultadoPacientesMaiorLtv = resultado('pacientes-maior-ltv', LinhaPacientesMaiorLtv, ResumoDePacientes)
export const ResultadoPacientesQueIndicaram = resultado('pacientes-que-indicaram', LinhaPacientesQueIndicaram, ResumoPacientesQueIndicaram)
export const ResultadoPacientesPorProcedimento = resultado(
  'pacientes-por-procedimento',
  LinhaPacientesPorProcedimento,
  ResumoPacientesPorProcedimento,
)
export const ResultadoPacientesPorOrigemECampanha = resultado(
  'pacientes-por-origem-e-campanha',
  LinhaPacientesPorOrigemECampanha,
  ResumoPacientesPorOrigemECampanha,
)
export const ResultadoAniversariantes = resultado('aniversariantes', LinhaAniversariante, ResumoDePacientes)
export const ResultadoSaldosEmAberto = resultado('saldos-em-aberto', LinhaSaldoEmAberto, ResumoSaldosEmAberto)
export const ResultadoContas = resultado('contas', LinhaConta, ResumoContas)
export const ResultadoEntradasDeEstoque = resultado('entradas-de-estoque', LinhaEntradaDeEstoque, ResumoEntradasDeEstoque)
export const ResultadoOrcamentos = resultado('orcamentos', LinhaOrcamento, ResumoOrcamentos)
export const ResultadoFaltasEDesmarcacoes = resultado('faltas-e-desmarcacoes', LinhaFaltaOuDesmarcacao, ResumoFaltasEDesmarcacoes)

export const ResultadoDoRelatorio = z.discriminatedUnion('relatorio', [
  ResultadoPacientesSemCompra,
  ResultadoPacientesSemAtendimento,
  ResultadoPacientesMaiorLtv,
  ResultadoPacientesQueIndicaram,
  ResultadoPacientesPorProcedimento,
  ResultadoPacientesPorOrigemECampanha,
  ResultadoAniversariantes,
  ResultadoRecebimentos,
  ResultadoSaldosEmAberto,
  ResultadoContas,
  ResultadoSaidasDeEstoque,
  ResultadoEntradasDeEstoque,
  ResultadoOrcamentos,
  ResultadoFaltasEDesmarcacoes,
  ResultadoTarefasDaEquipe,
])
export type ResultadoDoRelatorio = z.infer<typeof ResultadoDoRelatorio>

/** As linhas de cada relatório, pela chave: o teste `schema-de-linha-e-o-padrao` e a tela leem daqui. */
export const LINHAS_DOS_RELATORIOS = {
  'pacientes-sem-compra': LinhaPacientesSemCompra,
  'pacientes-sem-atendimento': LinhaPacientesSemAtendimento,
  'pacientes-maior-ltv': LinhaPacientesMaiorLtv,
  'pacientes-que-indicaram': LinhaPacientesQueIndicaram,
  'pacientes-por-procedimento': LinhaPacientesPorProcedimento,
  'pacientes-por-origem-e-campanha': LinhaPacientesPorOrigemECampanha,
  aniversariantes: LinhaAniversariante,
  recebimentos: LinhaRecebimento,
  'saldos-em-aberto': LinhaSaldoEmAberto,
  contas: LinhaConta,
  'saidas-de-estoque': LinhaSaidaDeEstoque,
  'entradas-de-estoque': LinhaEntradaDeEstoque,
  orcamentos: LinhaOrcamento,
  'faltas-e-desmarcacoes': LinhaFaltaOuDesmarcacao,
  'tarefas-da-equipe': LinhaTarefaDaEquipe,
} as const satisfies Record<ChaveDeRelatorio, z.AnyZodObject>

/* ------------------------------------------------ "Criar campanha com esta lista" */

/** C22: acima disto, ou com o motor `truncado`, a campanha não nasce (o mesmo teto da importação). */
export const MAX_PACIENTES_DA_CAMPANHA_DA_LISTA = MAX_LINHAS_DA_CAMPANHA

/** A tarefa que cada paciente da lista ganha. `tipo` de lista fechada, e pagamento não é tarefa (C23). */
export const TarefaDaCampanhaDaLista = z
  .object({
    tipo: tipoQueNaoEhPagamento,
    /** Vazio = "Contato da campanha: <nome>", montado pelo servidor. */
    descricao: z.string().trim().max(400).default(''),
    prazo: DiaCivil,
    responsavelId: Uuid,
  })
  .strict()

/**
 * `POST /v1/relatorios/:chave/campanha` (spec I-42; appsec C20–C23), com o
 * cabeçalho `Idempotency-Key: <uuid>` gerado pela tela ao abrir o formulário.
 *
 * **Sem `pacienteIds`** (`.strict()`, C20): os pacientes saem SÓ da
 * re-execução do relatório no servidor, com os mesmos filtros.
 */
export const CriarCampanhaDaLista = z
  .object({
    filtros: z.record(z.unknown()),
    destino: z.union([z.object({ campanhaId: Uuid }).strict(), z.object({ nova: SalvarCampanha }).strict()]),
    tarefa: TarefaDaCampanhaDaLista,
  })
  .strict()
export type CriarCampanhaDaLista = z.input<typeof CriarCampanhaDaLista>

export const CampanhaDaListaCriada = z
  .object({
    campanhaId: Uuid,
    /** Os pacientes da lista (já sem desativados e anonimizados). */
    pacientes: z.number().int(),
    /** Tarefas novas. Repetir o pedido dá `0` (H.2). */
    criadas: z.number().int(),
    /** Pacientes que já tinham a tarefa aberta nesta campanha. */
    ignoradas: z.number().int(),
  })
  .strict()
export type CampanhaDaListaCriada = z.infer<typeof CampanhaDaListaCriada>

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

/**
 * LGPD L-IN-17 (revisão appsec do T8, L4): o nome do favorito é TEXTO LIVRE
 * que a clínica inteira vê. A tela mostra este aviso junto do campo; o
 * servidor nunca o escreve em log nem em mensagem de erro.
 */
export const AVISO_NOME_DO_FAVORITO =
  'A clínica inteira vê este nome. Não use nome de paciente, telefone, valor nem dado de saúde.'

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
