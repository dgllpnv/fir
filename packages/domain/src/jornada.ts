/**
 * A JORNADA DO PACIENTE — uma máquina de estados, não um punhado de `if`.
 *
 * O invariante do qual tudo o mais decorre: **uma única `Tarefa` anda pelas
 * etapas**. Nunca uma tarefa nova por etapa. Se cada etapa criasse uma tarefa,
 * o funil contaria a mesma paciente cinco vezes, a taxa de no-show seria
 * calculada sobre um denominador inflado, e o painel herdaria o erro sem jeito
 * de encontrá-lo.
 *
 * `faltou` e `desmarcou` MANTÊM O CARTÃO ABERTO (`status = 'aberta'`) até
 * alguém reagendar ou encerrar — é o que faz o cartão aparecer em "Recontatar"
 * todo dia. É também o único invariante deste épico que, quebrado, não produz
 * erro nenhum: produz silêncio, e ninguém liga para quem faltou.
 */
import { erro, erroDe, ok, type Result } from './resultado'
import type { StatusDeTarefa } from './tarefa'
import { TIPOS_DE_AGENDA, TIPOS_REALIZADOS } from './tipos-de-tarefa'

export type Etapa =
  | 'agendado'
  | 'confirmado'
  | 'faltou'
  | 'desmarcou'
  | 'realizado'
  | 'orcamento'
  | 'fechado'
  | 'perdido'
  | 'encerrado'

export type AcaoDeJornada =
  | 'agendar'
  | 'enviarConfirmacao'
  | 'confirmar'
  | 'noshow'
  | 'desmarcar'
  | 'reagendar'
  | 'encerrar'
  | 'concluir'
  | 'registrarOrcamento'
  | 'followUp'
  | 'fechar'
  | 'perder'
  | 'reabrir'

/** As nove etapas, na ordem em que a clínica as percorre. */
export const ETAPAS = [
  'agendado',
  'confirmado',
  'faltou',
  'desmarcou',
  'realizado',
  'orcamento',
  'fechado',
  'perdido',
  'encerrado',
] as const satisfies readonly Etapa[]

/** As treze ações. `agendar` e `concluir` são das rotas de tarefa do épico 2. */
export const ACOES = [
  'agendar',
  'enviarConfirmacao',
  'confirmar',
  'noshow',
  'desmarcar',
  'reagendar',
  'encerrar',
  'concluir',
  'registrarOrcamento',
  'followUp',
  'fechar',
  'perder',
  'reabrir',
] as const satisfies readonly AcaoDeJornada[]

const ABERTAS = ['agendado', 'confirmado', 'faltou', 'desmarcou'] as const

/**
 * Tipo LARGO (`readonly Etapa[]`), não a tupla literal.
 *
 * Com `as const`, `ETAPAS_TERMINAIS.includes(umaEtapaQualquer)` não compila —
 * o parâmetro de `includes` fica estreitado nos três literais, e a pergunta
 * "esta etapa é terminal?" deixa de ser escrevível. É a mesma razão de
 * `TIPOS` em `tipos-de-tarefa.ts`.
 */
export const ETAPAS_TERMINAIS: readonly Etapa[] = ['fechado', 'perdido', 'encerrado']
export const ETAPAS_EM_RECONTATO: readonly Etapa[] = ['faltou', 'desmarcou']

/**
 * De `fechado` e `perdido` NADA sai. Nem `reabrir`.
 *
 * `encerrado` é terminal no FUNIL — a jornada não avança dali — mas `reabrir`
 * alcança, porque reabrir não é avanço: é correção, e cancelar por engano
 * acontece. O que torna `fechado` diferente é o dinheiro: reabrir um fechado
 * deixaria um `Recebimento` pendurado num atendimento que voltou a "não
 * aconteceu". `encerrado` não tem dinheiro nenhum.
 *
 * Esta é uma divergência consciente do plano do épico 3, que lista `encerrado`
 * entre os terminais sem saída E, três linhas depois, recusa `reabrir` só em
 * `orcamento`, `fechado` e `perdido`. O épico 2 já reabre tarefa cancelada, e
 * tem teste verde para isso — fechar a porta aqui quebraria a correção.
 */
export const ETAPAS_SEM_SAIDA: readonly Etapa[] = ['fechado', 'perdido']

/**
 * A etapa de um cartão da jornada cuja TAREFA foi cancelada pela rota do
 * épico 2 (`POST /v1/tarefas/:id/cancelar`).
 *
 * Cancelar não é a ação `encerrar`: a autorização é outra (`podeCancelar`, de
 * quem solicitou) e ela alcança `agendado` e `confirmado`, que `encerrar` não
 * alcança. O que as duas portas têm em comum é o resultado — e ele é forçado
 * pelo `CHECK etapa_combina_com_status`, porque existe EXATAMENTE UMA etapa
 * com `status = 'cancelada'`.
 */
export const ETAPA_AO_CANCELAR: Etapa = 'encerrado'

/**
 * O `status` que cada etapa OBRIGA — o mesmo par que o `CHECK
 * etapa_combina_com_status` da migration 0007 amarra no banco.
 *
 * Existe aqui E lá de propósito. A tabela de transições declara o status do
 * destino, e uma propriedade de teste confere que as duas declarações
 * concordam: sem ela, mudar a etapa numa e esquecer a outra passaria.
 */
const STATUS_DA_ETAPA: Readonly<Record<Etapa, StatusDeTarefa>> = {
  agendado: 'aberta',
  confirmado: 'aberta',
  // NÃO `concluida`, NÃO `cancelada`. Ver o cabeçalho deste arquivo.
  faltou: 'aberta',
  desmarcou: 'aberta',
  realizado: 'concluida',
  orcamento: 'concluida',
  fechado: 'concluida',
  perdido: 'concluida',
  encerrado: 'cancelada',
}

export const statusDaEtapa = (etapa: Etapa): StatusDeTarefa => STATUS_DA_ETAPA[etapa]

export type Transicao = {
  readonly acao: AcaoDeJornada
  readonly de: readonly Etapa[]
  /** `'anterior'` só em `reabrir`: a etapa vem do histórico, não da tabela. */
  readonly para: Etapa | 'anterior'
  readonly status: StatusDeTarefa
  readonly contaNoFunil: boolean
  readonly exigeValor: boolean
  readonly exigeMotivo: boolean
}

/**
 * A JORNADA É UMA TABELA, NÃO UM ENCADEAMENTO DE `if`.
 *
 * Toda regra sobre onde um agendamento pode ir está nesta constante, e em
 * lugar nenhum mais. O legado tem a mesma regra escrita três vezes — front,
 * `demoApiBase` e `Code.gs` — e elas já divergiram. Aqui existe uma.
 *
 * `contaNoFunil` é propriedade DA TRANSIÇÃO, não do evento. O protótipo a
 * infere da presença de um rótulo no histórico, o que funciona por
 * coincidência: `reagendar` tem rótulo E muda de etapa. Declarada, ela diz a
 * coisa certa — remarcar não é um agendamento novo, e contá-lo como tal infla
 * o denominador do funil e derruba toda conversão sem que nada tenha piorado
 * na clínica.
 *
 * `agendar` tem `de: []` porque é CRIAÇÃO: nenhuma etapa leva a ela. Ela entra
 * na tabela mesmo assim porque a tabela precisa ser a história completa — se
 * `agendar` e `concluir` estivessem fora, o funil teria de aprender a contar
 * `agendado` e `realizado` por um segundo caminho, e o segundo caminho é
 * sempre o que diverge.
 */
const TRANSICOES_LITERAL = [
  { acao: 'agendar',            de: [],                         para: 'agendado',   status: 'aberta',    contaNoFunil: true,  exigeValor: false, exigeMotivo: false },
  { acao: 'enviarConfirmacao',  de: ['agendado'],               para: 'agendado',   status: 'aberta',    contaNoFunil: false, exigeValor: false, exigeMotivo: false },
  { acao: 'confirmar',          de: ['agendado'],               para: 'confirmado', status: 'aberta',    contaNoFunil: true,  exigeValor: false, exigeMotivo: false },
  { acao: 'noshow',             de: ['agendado', 'confirmado'], para: 'faltou',     status: 'aberta',    contaNoFunil: true,  exigeValor: false, exigeMotivo: false },
  { acao: 'desmarcar',          de: ['agendado', 'confirmado'], para: 'desmarcou',  status: 'aberta',    contaNoFunil: true,  exigeValor: false, exigeMotivo: false },
  { acao: 'reagendar',          de: ABERTAS,                    para: 'agendado',   status: 'aberta',    contaNoFunil: false, exigeValor: false, exigeMotivo: false },
  { acao: 'encerrar',           de: ETAPAS_EM_RECONTATO,        para: 'encerrado',  status: 'cancelada', contaNoFunil: false, exigeValor: false, exigeMotivo: false },
  { acao: 'concluir',           de: ABERTAS,                    para: 'realizado',  status: 'concluida', contaNoFunil: true,  exigeValor: false, exigeMotivo: false },
  { acao: 'registrarOrcamento', de: ['realizado'],              para: 'orcamento',  status: 'concluida', contaNoFunil: true,  exigeValor: true,  exigeMotivo: false },
  { acao: 'followUp',           de: ['orcamento'],              para: 'orcamento',  status: 'concluida', contaNoFunil: false, exigeValor: false, exigeMotivo: false },
  { acao: 'fechar',             de: ['realizado', 'orcamento'], para: 'fechado',    status: 'concluida', contaNoFunil: true,  exigeValor: true,  exigeMotivo: false },
  { acao: 'perder',             de: ['orcamento'],              para: 'perdido',    status: 'concluida', contaNoFunil: true,  exigeValor: false, exigeMotivo: true  },
  { acao: 'reabrir',            de: ['realizado', 'encerrado'], para: 'anterior',   status: 'aberta',    contaNoFunil: false, exigeValor: false, exigeMotivo: false },
] as const satisfies readonly Transicao[]

/**
 * Exportada com o tipo LARGO, não com o literal de `TRANSICOES_LITERAL`.
 *
 * Com o tipo literal, cada `de` guarda a própria tupla — `readonly []` em
 * `agendar`, `readonly ['realizado']` em `registrarOrcamento` — e
 * `t.de.includes(umaEtapaQualquer)` deixa de compilar (TS2345, parâmetro
 * `never`). Quem percorre a tabela precisa fazer exatamente essa pergunta.
 */
export const TRANSICOES: readonly Transicao[] = TRANSICOES_LITERAL

const POR_ACAO = new Map<AcaoDeJornada, Transicao>(TRANSICOES.map((t) => [t.acao, t]))

/** A linha da tabela, para quem precisa de `exigeValor`/`exigeMotivo`. */
export const transicaoDe = (acao: AcaoDeJornada): Transicao | undefined => POR_ACAO.get(acao)

/**
 * As ações que CONTAM NO FUNIL. Derivado da tabela — nunca escrito à mão.
 *
 * O funil conta por `acao`, não por `etapa`: `reagendar` leva a `agendado` e
 * não conta, senão quem remarcou três vezes apareceria como três
 * agendamentos.
 */
export const ACOES_DO_FUNIL: readonly AcaoDeJornada[] = TRANSICOES.filter(
  (t) => t.contaNoFunil,
).map((t) => t.acao)

/** Os rótulos do protótipo (`ETAPAS`), que a recepção já conhece. */
export const ROTULO_DE_ETAPA: Readonly<Record<Etapa, string>> = {
  agendado: 'Agendada',
  confirmado: 'Confirmada',
  faltou: 'No-show',
  desmarcou: 'Desmarcada',
  realizado: 'Realizada',
  orcamento: 'Orçamento enviado',
  fechado: 'Fechado',
  perdido: 'Orçamento perdido',
  encerrado: 'Encerrado sem reagendar',
}

/**
 * Os rótulos dos BOTÕES, como a PO os escreveu (`acoesEsteira`).
 *
 * Moram aqui, e não numa segunda tabela no front, porque é literalmente a
 * dívida que este projeto existe para não repetir.
 */
export const ROTULO_DE_ACAO: Readonly<Record<AcaoDeJornada, string>> = {
  agendar: 'Agendar',
  enviarConfirmacao: 'Enviar confirmação',
  confirmar: 'Confirmou',
  noshow: 'No-show',
  desmarcar: 'Desmarcou',
  reagendar: 'Reagendar',
  encerrar: 'Encerrar',
  concluir: 'Concluir',
  registrarOrcamento: 'Registrar orçamento',
  followUp: 'Registrar follow-up',
  fechar: 'Fechou',
  perder: 'Perdeu',
  reabrir: 'Reabrir',
}

/**
 * Um evento do histórico. Chaves POR EXTENSO, não as abreviações do protótipo
 * (`{e, em, por, rot, nota, valor}`): nome no código = nome no glossário =
 * nome na tela.
 */
export type EventoDeJornada = {
  readonly acao: AcaoDeJornada
  readonly etapa: Etapa
  /** ISO 8601 em UTC. */
  readonly em: string
  readonly porId: string
  /** Máx. 160. Texto livre da recepção — NUNCA vai para log (regra 21). */
  readonly nota?: string
  /**
   * Centavos EM TEXTO, nunca número JSON.
   *
   * O `jsonb` do Postgres guarda `numeric` exato, então o banco não perderia
   * precisão — mas `JSON.parse`, do lado do Node, devolve `number`, e um
   * `number` perto de dinheiro é a assinatura que a regra 1 proíbe
   * atravessar. A convenção já existe no transporte (`dinheiroEmTexto`); duas
   * convenções para a mesma coisa é como uma delas é esquecida. Bônus: a
   * redação de valores vira `valor: null` sem conversão.
   */
  readonly valor?: string
  readonly motivoId?: string
  /** O NOME do motivo no instante do evento — renomear não reescreve a história. */
  readonly motivo?: string
}

export type EstadoDaJornada = {
  readonly etapa: Etapa
  readonly status: StatusDeTarefa
  readonly historico: readonly EventoDeJornada[]
}

export type DestinoDaJornada = {
  readonly etapa: Etapa
  readonly status: StatusDeTarefa
  readonly contaNoFunil: boolean
}

/**
 * A mensagem é a DO PROTÓTIPO, porque é a que a recepção já conhece — e ela
 * depende da etapa de ORIGEM, não da ação.
 */
const mensagemPorOrigem = (etapa: Etapa): string =>
  STATUS_DA_ETAPA[etapa] === 'aberta'
    ? 'Essa etapa não vale para um agendamento que ainda não aconteceu.'
    : 'Essa etapa não vale para a situação atual.'

const JA_TEM_ORCAMENTO = 'Este atendimento já tem orçamento registrado.'

/**
 * A etapa a que `reabrir` devolve o cartão.
 *
 * O último evento cuja etapa estava EM ABERTO — não "agendado" por padrão.
 * Quem faltou e foi concluído por engano volta para `faltou`, e o cartão
 * reaparece em Recontatar, que é onde ele estava.
 */
function etapaAnterior(historico: readonly EventoDeJornada[]): Etapa {
  for (let i = historico.length - 1; i >= 0; i--) {
    const e = historico[i]!.etapa
    if (STATUS_DA_ETAPA[e] === 'aberta') return e
  }
  return 'agendado'
}

/**
 * O destino, ou o erro de domínio. **É A ÚNICA PORTA.**
 *
 * Nenhum `if (acao === 'confirmar' && etapa === 'agendado')` em lugar nenhum
 * do sistema: se alguém escrever um, a tabela deixou de ser a verdade e o
 * décimo terceiro caso vai ser esquecido.
 */
export function transicao(estado: EstadoDaJornada, acao: AcaoDeJornada): Result<DestinoDaJornada> {
  // O par etapa↔status é amarrado por `CHECK` no banco. Se um dado migrado
  // chegar inconsistente, a resposta é recusar — escolher um dos dois e
  // seguir é como um cartão `faltou` concluído some do Recontatar em silêncio.
  if (estado.status !== STATUS_DA_ETAPA[estado.etapa]) {
    return erro(
      erroDe(
        'ESTADO_IMPOSSIVEL',
        'A situação deste agendamento não combina com a etapa dele. Avise o suporte.',
      ),
    )
  }

  const t = POR_ACAO.get(acao)
  if (t === undefined || !t.de.includes(estado.etapa)) {
    const mensagem =
      acao === 'reabrir' && (['orcamento', 'fechado', 'perdido'] as readonly Etapa[]).includes(estado.etapa)
        ? JA_TEM_ORCAMENTO
        : mensagemPorOrigem(estado.etapa)
    return erro(erroDe('TRANSICAO_INVALIDA', mensagem))
  }

  const etapa = t.para === 'anterior' ? etapaAnterior(estado.historico) : t.para
  return ok({ etapa, status: t.status, contaNoFunil: t.contaNoFunil })
}

/** Append-only. Devolve um array novo; nunca muta o recebido. */
export function anexar(
  historico: readonly EventoDeJornada[],
  evento: EventoDeJornada,
): readonly EventoDeJornada[] {
  return [...historico, evento]
}

/** A tarefa é da jornada comercial? Sessão de programa não é (épico 5). */
export function ehDaJornada(t: {
  readonly tipo: string
  readonly pacienteId: string | null
}): boolean {
  if (t.pacienteId === null) return false
  return TIPOS_DE_AGENDA.includes(t.tipo) || TIPOS_REALIZADOS.includes(t.tipo)
}

/**
 * Preenche `etapa` de dado MIGRADO. **O runtime nunca deriva.**
 *
 * O protótipo deriva a cada leitura (`etapaDe`), e com isso produz o cartão
 * morto: uma "Consulta agendada" já concluída devolve `agendado`, e
 * `acoesEsteira` devolve `[]` — o cartão fica sem nenhuma ação possível, no
 * lugar errado do kanban. Aqui a etapa é COLUNA, escrita por quem fez a
 * transição, e esta função existe só para o épico 9 preencher a coluna uma
 * vez, no dado que nasceu antes dela.
 *
 * `cancelada` vira `encerrado`, não `desmarcou`: o protótipo devolve
 * `desmarcou` e o cartão fica em Recontatar para sempre — cancelado e pedindo
 * recontato ao mesmo tempo.
 */
export function etapaDerivada(t: {
  readonly tipo: string
  readonly status: StatusDeTarefa
  readonly pacienteId: string | null
}): Etapa | null {
  if (!ehDaJornada(t)) return null
  if (t.status === 'cancelada') return 'encerrado'
  if (t.status === 'concluida') return 'realizado'
  return 'agendado'
}
