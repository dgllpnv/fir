/**
 * A tabela de tipos de tarefa, portada de `CONFIG.TIPOS` do protótipo.
 *
 * As flags são a classificação que decide o que entra na receita, o que conta
 * como paciente atendido e o que aceita valor em aberto. Elas existem aqui, em
 * tabela, porque espalhá-las em `if (tipo === '...')` foi como o legado passou
 * a contar o mesmo dinheiro duas vezes.
 *
 *   receita     — é um pagamento: entra na receita e no LTV
 *   atende      — conta como paciente atendido
 *   saldo       — aceita "valor em aberto"
 *   orcamento   — valor de proposta: NÃO entra na receita
 *   recebimento — abate saldo em aberto
 *   sessao      — sessão de programa (criada pelo próprio programa)
 *   pagavel     — atendimento que guarda o pagamento na própria tarefa
 *   vira        — ao concluir, o tipo agendado passa a ser o realizado
 */
export type InfoDoTipo = {
  readonly nome: string
  readonly grupo: 'Agenda' | 'Atendimento' | 'Orçamento' | 'Pagamentos' | 'Relacionamento'
  readonly desc: string
  readonly receita?: true
  readonly atende?: true
  readonly saldo?: true
  readonly orcamento?: true
  readonly recebimento?: true
  readonly sessao?: true
  readonly pagavel?: true
  readonly vira?: string
  readonly rotulo?: string
}

export const TIPO_SESSAO = 'Sessão de plano'
export const TIPO_RETORNO = 'Retorno de procedimento'

const TIPOS_LITERAL = [
  { nome: 'Consulta agendada', grupo: 'Agenda', vira: 'Consulta realizada', desc: 'Consulta marcada. Ao concluir, vira Consulta realizada (com o pagamento, se houver). Sinal pago antes: lance como Sinal de consulta.' },
  { nome: 'Procedimento agendado', grupo: 'Agenda', vira: 'Procedimento realizado', desc: 'Procedimento marcado. Ao concluir, vira Procedimento realizado (com o pagamento, se houver).' },
  { nome: 'Reagendamento', grupo: 'Agenda', desc: 'Consulta, procedimento ou sessão remarcados.' },
  { nome: 'Confirmação', grupo: 'Agenda', desc: 'Confirmação de presença com o paciente.' },
  { nome: 'Consulta realizada', grupo: 'Atendimento', atende: true, pagavel: true, desc: 'Paciente atendido em consulta. O pagamento fica registrado nesta mesma tarefa.' },
  { nome: 'Procedimento realizado', grupo: 'Atendimento', atende: true, pagavel: true, desc: 'Procedimento feito. O pagamento fica registrado nesta mesma tarefa.' },
  { nome: TIPO_SESSAO, grupo: 'Atendimento', atende: true, sessao: true, pagavel: true, desc: 'Sessão de um programa de acompanhamento (criada pelo próprio programa).' },
  { nome: 'Orçamento enviado', grupo: 'Orçamento', orcamento: true, desc: 'Proposta apresentada. O valor do orçamento não entra na receita.' },
  { nome: 'Sinal de consulta', grupo: 'Pagamentos', receita: true, saldo: true, desc: 'Valor adiantado para reservar a consulta. O restante vai em valor em aberto.' },
  { nome: 'Pagamento de consulta', grupo: 'Pagamentos', receita: true, saldo: true, desc: 'Valor pago pela consulta. Se faltar alguma parte, informe em valor em aberto.' },
  { nome: 'Pagamento de orçamento', grupo: 'Pagamentos', receita: true, atende: true, saldo: true, desc: 'Orçamento fechado: valor pago agora (total ou entrada). O que faltar vai em valor em aberto.' },
  { nome: 'Pagamento de saldo em aberto', grupo: 'Pagamentos', receita: true, recebimento: true, rotulo: 'Valor recebido (R$)', desc: 'Parcela ou restante de um valor em aberto. Abate o saldo do paciente.' },
  { nome: 'Follow-up', grupo: 'Relacionamento', desc: 'Retomar conversa em andamento (ex.: orçamento enviado sem resposta).' },
  { nome: 'Recaptação', grupo: 'Relacionamento', desc: 'Paciente sem retorno há algum tempo.' },
  { nome: TIPO_RETORNO, grupo: 'Relacionamento', desc: 'Paciente que já pode repetir um procedimento (criado pelo catálogo).' },
  { nome: 'Contato de indicação', grupo: 'Relacionamento', desc: 'Contato com paciente indicado ou com quem indicou.' },
  { nome: 'Aniversário', grupo: 'Relacionamento', desc: 'Mensagem de aniversário.' },
  { nome: 'Pós-consulta', grupo: 'Relacionamento', desc: 'Acompanhamento depois da consulta ou procedimento.' },
  { nome: 'Outros', grupo: 'Relacionamento', desc: 'Outro contato com o paciente.' },
] as const satisfies readonly InfoDoTipo[]

export type NomeDeTipo = (typeof TIPOS_LITERAL)[number]['nome']

/**
 * Exportado com o tipo largo `InfoDoTipo[]`, não o tipo literal de
 * `TIPOS_LITERAL`. O tipo literal faz cada elemento ter só as chaves que de
 * fato escreveu (ex.: um item sem `vira` não tem a chave `vira` no seu tipo
 * nem como `undefined`) — então acessar `.vira` genericamente ao iterar a
 * união falha com TS2339 para quem não a declarou. Widening para `InfoDoTipo`
 * resolve, porque `vira?: string` existe em todo membro do tipo largo.
 * `NomeDeTipo`, acima, é derivado do tipo literal ANTES deste widening, então
 * continua sendo a união dos 19 nomes — não `string`.
 */
export const TIPOS: readonly InfoDoTipo[] = TIPOS_LITERAL

const porNome = new Map<string, InfoDoTipo>(TIPOS.map((t) => [t.nome, t]))

/**
 * Nomes desconhecidos já avistados, para avisar UMA vez por nome.
 *
 * `infoDoTipo` é chamada uma vez por tarefa em `ehReceita`, `ehContato` e
 * companhia — sem a deduplicação, um mês de dado legado com um nome errado
 * encheria o log com a mesma linha milhares de vezes, e um log que ninguém
 * consegue ler é o mesmo que silêncio.
 */
const desconhecidosAvistados = new Set<string>()

/** Os nomes desconhecidos que apareceram neste processo. Para log e teste. */
export const tiposDesconhecidosAvistados = (): readonly string[] => [...desconhecidosAvistados]

/** Esquece o que foi avistado. Existe para o teste isolar cada caso. */
export const esquecerTiposDesconhecidos = (): void => {
  desconhecidosAvistados.clear()
}

/**
 * O tipo da tarefa, ou um FALLBACK RUIDOSO para nome desconhecido.
 *
 * O que o fallback silencioso causava: um nome fora da tabela devolvia um
 * `InfoDoTipo` sem flag nenhuma, então `receita` ficava `undefined`,
 * `ehReceita` virava `false` e **o pagamento desaparecia da receita sem um
 * único erro**. Na migração das 4 clínicas é o cenário provável, não o
 * improvável: "Pagamento de orcamento" sem cedilha, "Orçamento Fechado" com
 * maiúscula, um espaço a mais no fim. O faturamento do mês fica subnotificado
 * e os totais da regra 28 não batem — e o único jeito de descobrir por quê é
 * conferir paciente por paciente.
 *
 * AVISA, mas NÃO LANÇA: o legado migrado precisa continuar legível. Uma
 * exceção aqui transformaria uma tarefa com nome estranho numa tela que não
 * abre, e a recepcionista perderia o dia inteiro por causa de um acento.
 *
 * O `console.warn` é a única saída de I/O de `packages/domain`, e é
 * deliberada: a regra de pureza existe para que o domínio não dependa de
 * framework nem de banco, e "classifiquei um pagamento como não-pagamento"
 * é precisamente o tipo de coisa que não pode acontecer em silêncio. Nada de
 * PII, valor ou dose entra na mensagem — só o nome do tipo, que é vocabulário
 * de configuração (regra 21).
 */
export const infoDoTipo = (nome: string): InfoDoTipo => {
  const achado = porNome.get(nome)
  if (achado !== undefined) return achado

  if (!desconhecidosAvistados.has(nome)) {
    desconhecidosAvistados.add(nome)
    const alias = TIPO_ANTIGO[nome]
    console.warn(
      `[tipos-de-tarefa] tipo de tarefa desconhecido: ${JSON.stringify(nome)}. ` +
        'Ele NÃO conta como receita, atendimento nem saldo — o pagamento sai dos ' +
        'totais do mês. ' +
        (alias === undefined
          ? 'Confira acento, caixa e espaço contra TIPOS, ou acrescente o nome a TIPO_ANTIGO.'
          : `TIPO_ANTIGO mapeia este nome para ${JSON.stringify(alias)}: traduza antes de classificar.`),
    )
  }
  return { nome, grupo: 'Relacionamento', desc: '' }
}

/** O que a tarefa precisa expor para ser classificada. */
export type TarefaClassificavel = { readonly tipo: string; readonly valor: bigint }

/**
 * Receita = só o grupo Pagamentos, **mais** o atendimento que guardou um
 * pagamento na própria tarefa. Orçamento nunca.
 */
export const ehReceita = (t: TarefaClassificavel): boolean => {
  const i = infoDoTipo(t.tipo)
  return i.receita === true || (i.pagavel === true && t.valor > 0n)
}

/** Contato = tarefa que não é atendimento nem pagamento. */
export const ehContato = (t: TarefaClassificavel): boolean => {
  const i = infoDoTipo(t.tipo)
  return i.atende !== true && i.receita !== true && i.recebimento !== true
}

export const ehAtendimento = (t: TarefaClassificavel): boolean => infoDoTipo(t.tipo).atende === true
export const ehSessao = (t: TarefaClassificavel): boolean => infoDoTipo(t.tipo).sessao === true

export const aceitaPagamento = (nome: string): boolean => infoDoTipo(nome).pagavel === true
export const ehPagamento = (nome: string): boolean => infoDoTipo(nome).receita === true
export const temSaldo = (nome: string): boolean => infoDoTipo(nome).saldo === true
export const temValor = (nome: string): boolean => {
  const i = infoDoTipo(nome)
  return i.receita === true || i.orcamento === true
}

/** Agendado vira realizado — a mesma tarefa, com histórico. */
export const tipoAoConcluir = (nome: string): string => infoDoTipo(nome).vira ?? nome

/**
 * Os tipos de AGENDA — os que viram outro tipo ao concluir.
 *
 * Derivados de `TIPOS`, nunca escritos à mão: o `TIPOS_AGENDA` do protótipo é
 * a lista literal `["Consulta agendada","Procedimento agendado"]`, e uma
 * segunda cópia dela é como um tipo novo entra na tabela e não vira
 * "realizado" ao concluir, sem erro nenhum.
 *
 * Moram aqui, e não em `apps/api`, porque a JORNADA depende das duas listas
 * (`ehDaJornada`, `etapaDerivada`) e `packages/domain` não importa de app.
 */
export const TIPOS_DE_AGENDA: readonly string[] = TIPOS.filter((t) => t.vira !== undefined).map(
  (t) => t.nome,
)

/**
 * Atendimento já realizado — nasce "realizado" quando lançado retroativo.
 *
 * `Sessão de plano` fica FORA: sessão é do programa (épico 5), não da jornada
 * comercial. Contá-la no funil faria doze aplicações de uma paciente virarem
 * doze atendimentos no denominador da conversão.
 */
export const TIPOS_REALIZADOS: readonly string[] = TIPOS.filter(
  (t) => t.grupo === 'Atendimento' && t.sessao !== true,
).map((t) => t.nome)

/**
 * Nomes de versões anteriores. A migração das 4 clínicas depende deste mapa.
 *
 * Declarado depois de `infoDoTipo`, que o lê: `const` de módulo tem zona
 * morta temporal, mas `infoDoTipo` só é CHAMADA depois de o módulo terminar
 * de carregar — nenhum caminho de inicialização a executa.
 */
export const TIPO_ANTIGO: Readonly<Record<string, string>> = {
  'Orçamento fechado': 'Pagamento de orçamento',
  'Orçamento pago': 'Pagamento de orçamento',
  'Recebimento de saldo': 'Pagamento de saldo em aberto',
  Agendamento: 'Consulta agendada',
}
