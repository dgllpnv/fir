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
import { Dinheiro } from './dinheiro'
import { ehDiaDoCalendario } from './relogio'
import { erro, erroDe, ok, type Result } from './resultado'
import { type Autor, podeEditar, type StatusDeTarefa, type TarefaParaAutorizar } from './tarefa'
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
  | 'corrigirOrcamento'

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

/**
 * As catorze ações. `agendar` e `concluir` são das rotas de tarefa do épico 2.
 *
 * `corrigirOrcamento` (correções da PO, 2026-11-09, item B1) é a última, e de
 * propósito: ela não é um passo da jornada, é o conserto de um passo já dado.
 */
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
  'corrigirOrcamento',
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
  // A correção do orçamento já enviado (B1). `de: ['orcamento']` e nada mais:
  // fechado e perdido são terminais, e o evento `fechar` congelou o negócio no
  // instante dele. `contaNoFunil: false` — contá-la dobraria "enviados" no
  // funil, no Painel e na carteira (gate de números, N-13). `exigeValor:
  // false` porque corrigir só a data ou só a nota é correção legítima.
  { acao: 'corrigirOrcamento',  de: ['orcamento'],              para: 'orcamento',  status: 'concluida', contaNoFunil: false, exigeValor: false, exigeMotivo: false },
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
  corrigirOrcamento: 'Corrigir orçamento',
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
  /**
   * Só em `corrigirOrcamento`: o orçamento ANTES e DEPOIS da correção.
   *
   * O dinheiro mora em `de.valor`/`para.valor` — e `valor` está em
   * `CAMPOS_MONETARIOS`, que a redação apaga em QUALQUER profundidade. Nomes
   * como `valorAnterior`/`valorNovo` vazariam o orçamento para a recepção
   * (gate appsec, S-27). E nunca o valor dentro de uma frase montada aqui.
   */
  readonly de?: RetratoDoOrcamento
  readonly para?: RetratoDoOrcamento
  /** Só em `corrigirOrcamento`: a chave do ENVIO, gerada pela tela (retry não duplica). */
  readonly chaveIdempotencia?: string
}

/**
 * O orçamento num instante: o que a correção pode mudar, e nada mais.
 *
 * `valor` em centavos EM TEXTO (D-4), `null` quando o cartão não tinha valor
 * (dado migrado) ou quando a redação apagou. `retomarEm` é o `proximo_passo_em`
 * do cartão. `nota` é "o que foi orçado".
 */
export type RetratoDoOrcamento = {
  readonly valor: string | null
  readonly retomarEm: string | null
  readonly nota: string | null
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

/* =========================================================================
 * CORRIGIR O ORÇAMENTO JÁ ENVIADO (correções da PO, 2026-11-09, item B1)
 *
 * A PO digitou R$ 3.000 onde era R$ 300, e o funil passou a mentir. O conserto
 * tem três exigências que puxam para lados opostos:
 *
 *  - o cartão tem de passar a dizer o valor certo, já;
 *  - o funil de um mês FECHADO não pode mudar (quem leu outubro em novembro e
 *    lê de novo em dezembro tem de ver o mesmo número);
 *  - a trilha guarda de → para (regra 20), e o histórico "não se reescreve".
 *
 * A resposta: a correção é um EVENTO NOVO (`corrigirOrcamento`), e o
 * `registrarOrcamento` original fica byte a byte igual. O "R$ orçado" de uma
 * janela é o valor vigente NO FIM DA JANELA (gate de números, N-14, leitura
 * b): toda correção futura tem `em >= agora >= ate` de qualquer janela já
 * fechada, então ela não alcança o passado.
 * ====================================================================== */

/**
 * O teto de um orçamento: R$ 10.000.000,00.
 *
 * Não é regra de negócio de clínica — é a borda que impede um `bigint` do
 * tamanho do Postgres (ou um zero a mais de nervoso) de virar o funil do mês.
 */
export const TETO_DO_ORCAMENTO = 1_000_000_000n

const ACOES_DE_ORCAMENTO: readonly AcaoDeJornada[] = ['registrarOrcamento', 'corrigirOrcamento']

/**
 * O mínimo de um evento que a leitura do vigente precisa — estrutural, para
 * que a TELA use a mesma função sobre o evento que chega do servidor (onde a
 * redação troca `valor` por `null`) em vez de reescrever a regra.
 */
export type EventoDeOrcamentoLido = {
  readonly acao: AcaoDeJornada
  readonly em: string
  readonly valor?: string | null | undefined
  readonly nota?: string | undefined
  readonly para?: RetratoDoOrcamento | undefined
}

/** O valor e a nota que um evento de orçamento deixa vigentes. */
function retratoDoEvento(e: EventoDeOrcamentoLido): { valor: string | null; nota: string | null } | null {
  if (e.acao === 'registrarOrcamento') return { valor: e.valor ?? null, nota: e.nota ?? null }
  if (e.acao === 'corrigirOrcamento' && e.para !== undefined) {
    return { valor: e.para.valor, nota: e.para.nota }
  }
  return null
}

const centavosDe = (v: string | null | undefined): bigint | null =>
  typeof v === 'string' && /^-?\d+$/.test(v) ? BigInt(v) : null

/**
 * O orçamento VIGENTE: o do último evento de orçamento (registro ou correção),
 * só entre os de `em < ate` quando `ate` vem.
 *
 * Pela ordem do ARRAY, não por `em`: o histórico é append-only e cresce no
 * banco (`historico || $evento`) sob `FOR UPDATE`, então a ordem do array é a
 * ordem em que as coisas aconteceram — inclusive no empate de milissegundo.
 */
export function orcamentoVigente(
  historico: readonly EventoDeOrcamentoLido[],
  ate?: Date,
): { readonly valor: bigint | null; readonly nota: string | null } | null {
  let vigente: { valor: bigint | null; nota: string | null } | null = null
  for (const e of historico) {
    if (!ACOES_DE_ORCAMENTO.includes(e.acao)) continue
    if (ate !== undefined && !(new Date(e.em).getTime() < ate.getTime())) continue
    const r = retratoDoEvento(e)
    if (r === null) continue
    vigente = { valor: centavosDe(r.valor), nota: r.nota }
  }
  return vigente
}

/**
 * "Orçamentos enviados · R$ orçado" de uma janela `[de, ate)`.
 *
 * Para cada `registrarOrcamento` com `em` na janela, soma-se o valor vigente
 * do MESMO cartão no fim da janela. Contar continua sendo de
 * `registrarOrcamento` — a correção nunca é um segundo orçamento.
 *
 * A soma passa pelo `Dinheiro`, inclusive aqui (regra 1).
 */
export function orcadoNaJanela(
  historicos: readonly (readonly EventoDeJornada[])[],
  de: Date,
  ate: Date,
): Dinheiro {
  let total = Dinheiro.zero()
  for (const h of historicos) {
    for (const e of h) {
      if (e.acao !== 'registrarOrcamento') continue
      const em = new Date(e.em).getTime()
      if (!(em >= de.getTime() && em < ate.getTime())) continue
      const v = orcamentoVigente(h, ate)?.valor ?? null
      if (v !== null) total = total.mais(Dinheiro.deCentavos(v))
    }
  }
  return total
}

const PROGRAMA_PASSA_DO_ORCAMENTO = erroDe(
  'PROGRAMA_PASSA_DO_ORCAMENTO',
  'Os itens do programa com valor somam mais que o orçamento. Ajuste o valor ou o programa.',
)

/**
 * O programa orçado CABE no orçamento? (gate de números, N-17)
 *
 * Se os itens com valor explícito somam mais que o orçamento, o rateio do
 * fechamento prende a sobra em zero e o programa nasce com a soma das sessões
 * diferente do negócio. Uma regra, usada pelo registro e pela correção.
 */
export function programaCabeNoOrcamento(
  valor: Dinheiro,
  itens: readonly { readonly valor?: Dinheiro | null }[] | null,
): Result<void> {
  if (itens === null) return ok(undefined)
  const soma = itens.reduce(
    (s, i) => (i.valor === null || i.valor === undefined ? s : s.mais(i.valor)),
    Dinheiro.zero(),
  )
  return soma.ehMaiorQue(valor) ? erro(PROGRAMA_PASSA_DO_ORCAMENTO) : ok(undefined)
}

/** O que a correção precisa saber do cartão. `programaOrcado` só pelo valor de cada item. */
export type TarefaParaCorrigir = EstadoDaJornada &
  TarefaParaAutorizar & {
    /** Centavos da coluna `valor_orcamento`: o vigente do CARTÃO. */
    readonly valorOrcamento: bigint | null
    readonly proximoPassoEm: string | null
    /** Centavos em texto, como o `jsonb` guarda (D-4). */
    readonly programaOrcado: readonly { readonly valor?: string | null | undefined }[] | null
  }

/**
 * O que a recepção pediu. Ausente = MANTÉM. `nota: ''` = limpa a nota.
 *
 * `chaveIdempotencia` é do ENVIO (a tela a gera quando abre o formulário):
 * o duplo clique e o retry da rede trazem a mesma chave e não duplicam.
 */
export type PedidoDeCorrecao = {
  readonly chaveIdempotencia: string
  readonly valor?: bigint
  readonly retomarEm?: string
  readonly nota?: string
}

export type CorrecaoDeOrcamento =
  /** Nada a gravar: retry de um envio já aplicado, ou correção idêntica. */
  | { readonly tipo: 'nada' }
  | {
      readonly tipo: 'corrigir'
      readonly evento: EventoDeJornada
      /** As duas colunas que mudam. A etapa e o status NÃO mudam. */
      readonly valorOrcamento: bigint | null
      readonly proximoPassoEm: string | null
    }

const NADA_A_CORRIGIR = erroDe('NADA_A_CORRIGIR', 'Diga o que corrigir: valor, data de retomar ou nota.')
const VALOR_INVALIDO = erroDe('VALOR_INVALIDO', 'Informe um valor de orçamento válido.')
const RETOMAR_NO_PASSADO = erroDe('RETOMAR_NO_PASSADO', 'Escolha uma data de retomar a partir de hoje.')
const DATA_INVALIDA = erroDe('DATA_INVALIDA', 'Essa data não existe no calendário.')
const NOTA_LONGA = erroDe('NOTA_LONGA', 'A nota cabe em até cento e sessenta caracteres.')
const CORRECAO_EXIGE_VALORES = erroDe(
  'CORRECAO_EXIGE_VALORES',
  'Este orçamento tem preço por item. Peça a quem vê valores para corrigir o valor.',
)

const mesmoRetrato = (a: RetratoDoOrcamento, b: RetratoDoOrcamento): boolean =>
  a.valor === b.valor && a.retomarEm === b.retomarEm && a.nota === b.nota

/**
 * QUEM corrige: quem pode EDITAR a tarefa (solicitante, responsável ou
 * `tarefas.equipe`) — gate appsec, S-24. Sem isto, qualquer pessoa com
 * `jornada` reescreveria o orçamento de qualquer cartão.
 *
 * Exportada porque a tela pergunta o mesmo, para esconder o botão: a MESMA
 * função, nunca uma segunda cópia da regra no front (regra 16).
 */
export const podeCorrigirOrcamento = (t: TarefaParaAutorizar, a: Autor): boolean =>
  podeEditar(t, a).tipo === 'ok'

/**
 * A REGRA DA CORREÇÃO, inteira e pura.
 *
 * A ordem não é negociável:
 *
 *  1. QUEM: `podeEditar` (solicitante, responsável ou `tarefas.equipe`), antes
 *     de qualquer olhada no estado — quem não pode não fica sabendo a etapa
 *     (gate appsec, S-24).
 *  2. RETRY: a chave do envio já aplicada responde "nada", até depois de um
 *     Fechou — é a mesma resposta do primeiro envio (AB-B1-5).
 *  3. A TABELA: só de `orcamento` (S-25, N-15).
 *  4. O PEDIDO: valor positivo até o teto, retomar >= hoje DO SERVIDOR (regra
 *     24), nota até 160.
 *  5. O PROGRAMA: sem `valores`, corrigir o VALOR de um programa com preço por
 *     item é recusado pelo ESTADO, nunca pelo número mandado — senão 409/200
 *     seria uma busca binária da soma dos itens. Com `valores`, N-17.
 *  6. NADA MUDOU: com `valores`, ou sem mandar valor, a correção idêntica não
 *     grava. SEM `valores` e mandando valor, grava sempre: se o "valor certo"
 *     não gravasse, o tamanho do histórico diria qual era o valor (S-28).
 */
export function corrigirOrcamento(x: {
  readonly tarefa: TarefaParaCorrigir
  readonly autor: Autor
  /** `temPerm(…, 'valores')`, já resolvido. */
  readonly podeVerValores: boolean
  readonly pedido: PedidoDeCorrecao
  /** O dia civil de hoje NA CLÍNICA, do servidor. */
  readonly hoje: string
  readonly agora: Date
}): Result<CorrecaoDeOrcamento> {
  const { tarefa: t, pedido: p } = x

  // A mesma `podeEditar` de `podeCorrigirOrcamento` — aqui com o erro, que
  // carrega a frase para a tela.
  const pode = podeEditar(t, x.autor)
  if (pode.tipo === 'erro') return pode

  const jaAplicada = t.historico.some(
    (e) => e.acao === 'corrigirOrcamento' && e.chaveIdempotencia === p.chaveIdempotencia,
  )
  if (jaAplicada) return ok({ tipo: 'nada' })

  const destino = transicao(t, 'corrigirOrcamento')
  if (destino.tipo === 'erro') return destino

  if (p.valor === undefined && p.retomarEm === undefined && p.nota === undefined) {
    return erro(NADA_A_CORRIGIR)
  }
  if (p.valor !== undefined && (p.valor <= 0n || p.valor > TETO_DO_ORCAMENTO)) {
    return erro(VALOR_INVALIDO)
  }
  if (p.retomarEm !== undefined) {
    if (!ehDiaDoCalendario(p.retomarEm)) return erro(DATA_INVALIDA)
    // Lexicográfica: para `aaaa-mm-dd` é a mesma ordem da cronológica.
    if (p.retomarEm < x.hoje) return erro(RETOMAR_NO_PASSADO)
  }
  if (p.nota !== undefined && p.nota.length > 160) return erro(NOTA_LONGA)

  if (p.valor !== undefined && t.programaOrcado !== null) {
    const itens = t.programaOrcado.map((i) => {
      const c = centavosDe(i.valor)
      return { valor: c === null ? null : Dinheiro.deCentavos(c) }
    })
    if (!x.podeVerValores && itens.some((i) => i.valor !== null)) return erro(CORRECAO_EXIGE_VALORES)
    const cabe = programaCabeNoOrcamento(Dinheiro.deCentavos(p.valor), itens)
    if (cabe.tipo === 'erro') return cabe
  }

  const de: RetratoDoOrcamento = {
    valor: t.valorOrcamento === null ? null : t.valorOrcamento.toString(),
    retomarEm: t.proximoPassoEm,
    nota: orcamentoVigente(t.historico)?.nota ?? null,
  }
  const para: RetratoDoOrcamento = {
    valor: p.valor === undefined ? de.valor : p.valor.toString(),
    retomarEm: p.retomarEm ?? de.retomarEm,
    nota: p.nota === undefined ? de.nota : p.nota === '' ? null : p.nota,
  }

  if (mesmoRetrato(de, para) && (x.podeVerValores || p.valor === undefined)) {
    return ok({ tipo: 'nada' })
  }

  return ok({
    tipo: 'corrigir',
    evento: {
      acao: 'corrigirOrcamento',
      etapa: destino.valor.etapa,
      em: x.agora.toISOString(),
      porId: x.autor.id,
      chaveIdempotencia: p.chaveIdempotencia,
      de,
      para,
    },
    valorOrcamento: centavosDe(para.valor),
    proximoPassoEm: para.retomarEm,
  })
}
