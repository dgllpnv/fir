import { z } from 'zod'
import { DiaCivil, dinheiroEmTexto, Uuid } from './comum'

/** As sugestões da tela (`CONFIG.ORIGENS`). A coluna é texto livre de 60. */
export const ORIGENS = [
  'Indicação',
  'Instagram',
  'WhatsApp',
  'Google',
  'Site',
  'Convênio',
  'Fachada / passou na frente',
  'Evento',
  'Outro',
] as const

/** O valor exato que liga o campo "Indicado por". Nem `origem` nem `Indicacao`. */
export const ORIGEM_INDICACAO = 'Indicação'

/** Teto de uma importação, igual no protótipo e no `Code.gs`. */
export const MAX_IMPORT_PACIENTES = 2000

const camposDoPaciente = {
  nome: z.string().trim().min(1, 'Informe o nome do paciente.').max(120),
  telefone: z.string().trim().max(30).default(''),
  aniversario: DiaCivil.nullish(),
  origem: z.string().trim().max(60).default(''),
  indicadoPor: z.string().trim().max(80).default(''),
  unidadeId: Uuid.nullish(),
  // Para quem já era atendido antes da ferramenta (MANUAL cap. 7). Data no
  // FUTURO é descartada pelo serviço, não recusada — a comparação com "hoje"
  // depende do fuso da clínica, e a data de negócio vem do servidor (regra 24).
  ultimaConsulta: DiaCivil.nullish(),
  obs: z.string().trim().max(300).default(''),
}

/**
 * "Indicado por" só existe quando a origem é Indicação.
 *
 * A regra é do `Code.gs` (`origem === 'Indicação' ? indicadoPor : ''`) e mora
 * no contrato de propósito: ela não precisa de relógio nem de banco, e no
 * contrato ela vale para a tela e para o servidor com uma escrita só. Um
 * "indicado por" pendurado numa paciente que veio do Instagram vira, na
 * próxima campanha, um agradecimento a quem nunca indicou ninguém.
 */
const limparIndicacao = <T extends { origem: string; indicadoPor: string }>(p: T): T =>
  p.origem === ORIGEM_INDICACAO ? p : { ...p, indicadoPor: '' }

export const SalvarPaciente = z.object(camposDoPaciente).strict().transform(limparIndicacao)
export type SalvarPaciente = z.infer<typeof SalvarPaciente>

/**
 * A edição não é `SalvarPaciente.partial()`.
 *
 * `partial()` deixaria `origem` ausente e `indicadoPor` presente, e aí
 * `limparIndicacao` não teria como decidir. Aqui os dois andam juntos: quem
 * mexe na origem manda a origem.
 */
export const EditarPaciente = z
  .object({
    nome: camposDoPaciente.nome.optional(),
    telefone: z.string().trim().max(30).optional(),
    aniversario: DiaCivil.nullish(),
    origem: z.string().trim().max(60).optional(),
    indicadoPor: z.string().trim().max(80).optional(),
    unidadeId: Uuid.nullish(),
    ultimaConsulta: DiaCivil.nullish(),
    obs: z.string().trim().max(300).optional(),
  })
  .strict()
  .transform((p) =>
    p.origem !== undefined && p.origem !== ORIGEM_INDICACAO ? { ...p, indicadoPor: '' } : p,
  )
export type EditarPaciente = z.infer<typeof EditarPaciente>

/** Os quatro atalhos do MANUAL cap. 7. */
export const ATALHOS_DE_PACIENTE = [
  'todos',
  'aniversariantes',
  'com-tarefa-aberta',
  'sem-retorno',
] as const

export const ORDENS_DE_PACIENTE = ['recentes', 'nome', 'ultima-consulta'] as const

export const ConsultaDePacientes = z.object({
  /** Busca por nome OU telefone, sem acento e sem máscara. */
  q: z.string().trim().max(120).optional(),
  atalho: z.enum(ATALHOS_DE_PACIENTE).default('todos'),
  origem: z.string().trim().max(60).optional(),
  ordem: z.enum(ORDENS_DE_PACIENTE).default('recentes'),
  // Deslocamento, e não cursor: diferente da trilha de auditoria, a lista de
  // pacientes é ordenada por nome ou por data de cadastro e não cresce no topo
  // a cada segundo — uma paciente nova por dia não desloca a página de
  // ninguém. Se um dia a lista passar a ser paginada em tempo real, o cursor
  // de `auditoria.ts` é o modelo.
  limite: z.coerce.number().int().min(1).max(200).default(50),
  deslocamento: z.coerce.number().int().min(0).max(100_000).default(0),
})
export type ConsultaDePacientes = z.infer<typeof ConsultaDePacientes>

/**
 * A linha da lista.
 *
 * `ltv` e `saldo` saem `null` para quem não tem a permissão `valores` — e isso
 * é trabalho do `RedacaoInterceptor`, num ponto único, nunca de um `if` aqui
 * nem no controlador. Por isso esta rota entra em `ROTAS_COM_DINHEIRO`.
 */
export const PacienteNaLista = z.object({
  id: Uuid,
  nome: z.string(),
  telefone: z.string(),
  aniversario: DiaCivil.nullable(),
  origem: z.string(),
  indicadoPor: z.string(),
  unidadeId: Uuid.nullable(),
  ultimaConsulta: DiaCivil.nullable(),
  ativo: z.boolean(),
  criadoEm: z.string(),
  /** O atendimento mais recente registrado em tarefas, se houver. */
  ultimoAtendimento: DiaCivil.nullable(),
  tarefasAbertas: z.number().int(),
  ltv: dinheiroEmTexto,
  saldo: dinheiroEmTexto,
})
export type PacienteNaLista = z.infer<typeof PacienteNaLista>

export const ListaDePacientes = z.object({
  pacientes: z.array(PacienteNaLista),
  total: z.number().int(),
})
export type ListaDePacientes = z.infer<typeof ListaDePacientes>

/**
 * Uma linha da planilha importada.
 *
 * Tudo opcional menos o nome, e nem o nome é obrigatório no esquema: linha sem
 * nome é IGNORADA, não derruba a importação inteira. Quem converte uma
 * planilha de dois mil nomes não pode perder as 1.999 boas por causa de uma
 * célula vazia — e saber quantas foram ignoradas é parte da resposta.
 */
export const LinhaDeImportacao = z.object({
  nome: z.string().max(200).optional(),
  telefone: z.string().max(60).optional(),
  aniversario: z.string().max(30).optional(),
  ultimaConsulta: z.string().max(30).optional(),
})
export type LinhaDeImportacao = z.infer<typeof LinhaDeImportacao>

export const ImportarPacientes = z
  .object({
    unidadeId: Uuid.nullish(),
    linhas: z
      .array(LinhaDeImportacao)
      .min(1, 'Envie ao menos um paciente.')
      .max(
        MAX_IMPORT_PACIENTES,
        `A lista passa de ${MAX_IMPORT_PACIENTES} pacientes. Divida a planilha em partes.`,
      ),
  })
  .strict()
export type ImportarPacientes = z.infer<typeof ImportarPacientes>

export const ResultadoDaImportacao = z.object({
  novos: z.number().int(),
  atualizados: z.number().int(),
  ignorados: z.number().int(),
})
export type ResultadoDaImportacao = z.infer<typeof ResultadoDaImportacao>

export const DesativacaoDePaciente = z.object({
  id: Uuid,
  /** Quantas tarefas ficaram ligadas — é o que a tela avisa antes. */
  tarefas: z.number().int(),
})
export type DesativacaoDePaciente = z.infer<typeof DesativacaoDePaciente>
