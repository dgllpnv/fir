import { z } from 'zod'
import { centavosNaSaida, DiaCivil, Uuid } from './comum'
import { TarefaNaLista } from './tarefas'

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
  /**
   * A indicadora, quando ela É paciente da clínica (correções da PO, B2). Com
   * ela, `indicadoPor` vai vazio — quem decide é `decidirIndicacao`, no
   * domínio. O servidor aceita só paciente ATIVA desta clínica.
   */
  indicadoPorId: Uuid.nullish(),
  /**
   * "Chegou por uma campanha?" — só campanha ativa hoje, no fuso da clínica
   * (`GET /v1/campanhas/vinculaveis?contexto=paciente`). Não cria receita: a
   * receita da campanha vem só dos recebimentos das tarefas dela (N-1).
   */
  campanhaId: Uuid.nullish(),
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
const limparIndicacao = <
  T extends { origem: string; indicadoPor: string; indicadoPorId?: string | null | undefined },
>(
  p: T,
): T => (p.origem === ORIGEM_INDICACAO ? p : { ...p, indicadoPor: '', indicadoPorId: null })

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
    /** Três estados: ausente mantém, `null` remove, uuid liga (B2). */
    indicadoPorId: Uuid.nullish(),
    /**
     * Três estados, como na tarefa (N-4): ausente mantém, `null` remove, uuid
     * troca. A campanha ATUAL é aceita mesmo já encerrada — editar o telefone
     * de quem chegou por uma campanha de março não pode soltá-la de março.
     */
    campanhaId: Uuid.nullish(),
    unidadeId: Uuid.nullish(),
    ultimaConsulta: DiaCivil.nullish(),
    obs: z.string().trim().max(300).optional(),
  })
  .strict()
  .transform((p) =>
    p.origem !== undefined && p.origem !== ORIGEM_INDICACAO
      ? { ...p, indicadoPor: '', indicadoPorId: null }
      : p,
  )
export type EditarPaciente = z.infer<typeof EditarPaciente>

/** Os quatro atalhos do MANUAL cap. 7. */
export const ATALHOS_DE_PACIENTE = [
  'todos',
  'aniversariantes',
  'com-tarefa-aberta',
  'sem-retorno',
] as const

/**
 * `ltv` está aqui, mas o controlador exige `valores` para usá-la.
 *
 * A POSIÇÃO na lista é informação sobre o valor: liberar a ordenação por LTV
 * a quem não vê valores entregaria o ranking de faturamento da clínica numa
 * requisição, com os campos saindo `null` e ninguém percebendo.
 */
export const ORDENS_DE_PACIENTE = ['recentes', 'nome', 'ultima-consulta', 'ltv'] as const

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
 * Dinheiro na SAÍDA: string de centavos, ou `null` quando a redação apagou.
 *
 * Não é `dinheiroEmTexto`: aquele é de ENTRADA e transforma a string em
 * `bigint`, o que descreveria errado o que sai pelo JSON.
 */

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
  obs: z.string(),
  /** Cadastrada pela agenda do sistema, ainda não conferida (ADR 0019). Salvar a ficha limpa. */
  conferirCadastro: z.boolean(),
  tarefasAbertas: z.number().int(),
  ltv: centavosNaSaida,
  /**
   * `aberto − abatido`, **somado a partir dos grupos já clampados**, nunca
   * `greatest(0, Σ)` em SQL.
   *
   * O detalhe por grupo está em `GET /v1/pacientes/:id/saldo`; aqui vem só o
   * total porque a lista mostra um número por linha. O que NÃO vem é um total
   * clampado depois da soma: um programa pago a mais pagaria a dívida de
   * outro, e a clínica pararia de cobrar o que lhe é devido.
   */
  saldo: centavosNaSaida,
  /**
   * O excedente que o clamp por grupo preservou. Zero no caso normal.
   *
   * Existe porque o clamp não pode PERDER dinheiro — paciente que pagou a
   * mais é erro de lançamento ou crédito real, e os dois precisam aparecer.
   * Era o que o `greatest(0, …)` do épico 2 jogava fora sem deixar rastro.
   */
  credito: centavosNaSaida,
  /**
   * Derivado, e **não monetário**: sobrevive à redação (regra 17).
   *
   * É o que a equipe sem `valores` recebe no lugar do número, e é o que a
   * ficha lê para dizer "a receber" ou "nada pendente". Decidir isso com
   * `saldo === '0'` no front dava "nada pendente" para toda paciente sempre
   * que quem olhava não tinha `valores` — com o saldo existindo.
   */
  temSaldo: z.boolean(),
})
export type PacienteNaLista = z.infer<typeof PacienteNaLista>

/** O cadastro mais a linha do tempo. LTV por programa chega nos épicos 4 e 5. */
export const FichaDoPaciente = PacienteNaLista.extend({
  /**
   * Abertas primeiro, depois da mais recente para a mais antiga — a ordem do
   * Histórico do protótipo (`vPaciente`). Ordenada no servidor.
   *
   * `TarefaNaLista`, **a mesma forma de Hoje e de Tarefas** (correções da PO,
   * A2). Era uma forma enxuta própria, sem `historico`, `valorOrcamento`,
   * `proximoPassoEm` nem `programaOrcado`, e por isso a ficha não desenhava o
   * cartão da jornada: a paciente com um orçamento de R$ 20.000 em aberto
   * aparecia sem nenhuma etapa. O protótipo desenha o mesmo `cardTarefa` no
   * Histórico (`semPaciente`), e uma terceira forma da mesma tarefa é
   * exatamente como o legado divergiu. Sem alias: um segundo nome para a
   * mesma forma convida a divergir de novo.
   *
   * O dinheiro (`valorOrcamento`, `pagamento.valor`, `programaOrcado[].valor`)
   * sai pela redação de ponto único (regra 17). Sem `jornada`, o servidor
   * devolve `historico: []`, `proximoPassoEm` e `programaOrcado` nulos — a
   * mesma forma, os blocos vazios (appsec S-5).
   */
  tarefas: z.array(TarefaNaLista),
  /** O dia civil de hoje NA CLÍNICA (regra 24): o cartão nunca usa `new Date()`. */
  hoje: DiaCivil,
  /**
   * A indicadora cadastrada — **só id e nome, e só se ela estiver ATIVA**
   * (LGPD L-B2-6, appsec S-36). Desativada ou anonimizada: `null`, e a ficha
   * diz "Indicada por uma paciente", sem nome e sem link.
   *
   * Mora na FICHA, e não em `PacienteNaLista`: a ficha tem trilha de acesso,
   * a lista não. Nem o id da indicadora sai na lista — com os nomes de todas
   * ao lado, o id já remontaria o grafo de quem indicou quem.
   */
  indicadora: z.object({ id: Uuid, nome: z.string() }).strict().nullable(),
  /** Há indicadora cadastrada ligada, ativa ou não. É o que a ficha usa sem nome. */
  indicadaPorPaciente: z.boolean(),
  /** "Chegou por uma campanha?" — só o id; o nome vem da lista de vinculáveis. */
  campanhaId: Uuid.nullable(),
})
export type FichaDoPaciente = z.infer<typeof FichaDoPaciente>

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

/**
 * A busca estreita do seletor de "Nova tarefa" — **decisão D-7**.
 *
 * Criar tarefa é de todos, e vincular a tarefa à paciente certa é o fluxo real
 * do balcão: sem isso a recepcionista cria tarefa solta e alguém vincula
 * depois, o que gera retrabalho e tarefa órfã — justamente o que suja o funil.
 *
 * **Por que uma rota nova em vez de abrir `GET /v1/pacientes`:** aquela devolve
 * `ltv`, `saldo`, origem e última consulta. Liberar dado financeiro de paciente
 * por conveniência de rota é exatamente o que a regra 17 existe para impedir.
 * Aqui saem **três campos**, e o esquema é `.strict()` para que acrescentar um
 * quarto seja um ato deliberado, não um descuido de `SELECT *`.
 */
export const BuscaDePacientes = z
  .object({ termo: z.string().trim().min(2).max(80) })
  .strict()

export const PacienteEncontrado = z
  .object({
    id: z.string().uuid(),
    nome: z.string(),
    telefone: z.string(),
  })
  .strict()

export const RespostaDaBusca = z
  .object({ itens: z.array(PacienteEncontrado) })
  .strict()

export type TBuscaDePacientes = z.infer<typeof BuscaDePacientes>
export type TPacienteEncontrado = z.infer<typeof PacienteEncontrado>
export type TRespostaDaBusca = z.infer<typeof RespostaDaBusca>
