import {
  type AcaoDeJornada,
  type Etapa,
  ROTULO_DE_ACAO,
  type StatusDeTarefa,
  TRANSICOES,
} from '@fir/domain'

/**
 * A FAIXA DE AÇÕES VEM DA TABELA DE `@fir/domain`, nunca de uma segunda lista
 * aqui.
 *
 * É literalmente a dívida que este projeto existe para não repetir: o legado
 * tem a mesma regra escrita três vezes — front, `demoApiBase` e `Code.gs` — e
 * elas já divergiram. Aqui a pergunta "o que dá para fazer com este cartão?"
 * tem uma resposta só, e o servidor devolve 409 quando a tela errar.
 *
 * Isto é CONVENIÊNCIA DE TELA, não controle: o botão que não aparece não é o
 * botão que não pode. Quem decide é `transicao()`, no servidor, em toda
 * chamada.
 */

/** As ações que a faixa NUNCA mostra, mesmo quando a tabela as permite. */
const FORA_DA_FAIXA: readonly AcaoDeJornada[] = [
  // Criação e conclusão são de outras telas (épico 2): a primeira é
  // "Nova tarefa", a segunda é o círculo do próprio cartão.
  'agendar',
  'concluir',
  // Reabrir também é o círculo. Pô-lo na faixa daria dois caminhos para a
  // mesma coisa, lado a lado, com rótulos diferentes.
  'reabrir',
]

/**
 * O limite de 30 dias para orçar um atendimento — **e ele é só da tela**
 * (decisão D-6).
 *
 * O servidor PERMITE registrar orçamento contra uma consulta antiga, e isso é
 * deliberado: a migração das 4 clínicas precisa fazê-lo, e bloquear no
 * servidor obrigaria o migrador a escrever direto na tabela — que é como a
 * regra morre. Aqui é afordância: um "Registrar orçamento" num atendimento de
 * março é quase sempre engano de quem rolou a lista.
 */
const DIAS_PARA_ORCAR = 30

export type AcaoDaFaixa = {
  readonly acao: AcaoDeJornada
  readonly rotulo: string
  /** Ação que fecha uma porta: no-show, desmarcou, encerrar, perdeu. */
  readonly negativa: boolean
}

/** As que recusam ou encerram — desenhadas com menos peso que as que avançam. */
const NEGATIVAS: readonly AcaoDeJornada[] = ['noshow', 'desmarcar', 'encerrar', 'perder']

export function acoesDaEtapa(t: {
  readonly etapa: Etapa | null
  readonly status: StatusDeTarefa
  readonly concluidaEm: string | null
  /** O dia civil de hoje, **do servidor**. Nunca `new Date()` (regra 24). */
  readonly hoje: string
  /**
   * `temPerm(…, 'receber')`, já resolvido.
   *
   * `fechar` cria dinheiro e o servidor exige `receber` além de `jornada`
   * (decisão D-7). Esconder o botão de quem não tem a chave é conveniência —
   * o 403 continua sendo a resposta de verdade —, mas é a conveniência que
   * importa: a recepcionista que toca em "Fechou", preenche o valor e leva um
   * 403 perdeu o atendimento inteiro com a paciente na frente dela.
   *
   * Ausente = `true`: quem não passa a informação vê a faixa completa e
   * descobre pelo servidor. Falhar mostrando é melhor que esconder uma ação
   * de quem a tem.
   */
  readonly podeReceber?: boolean
}): AcaoDaFaixa[] {
  if (t.etapa === null) return []
  const etapa = t.etapa

  return TRANSICOES.filter((x) => {
    if (FORA_DA_FAIXA.includes(x.acao)) return false
    if (!x.de.includes(etapa)) return false
    // Afordância de tela, não regra: ver `DIAS_PARA_ORCAR`.
    if (x.acao === 'registrarOrcamento' && !aindaDaParaOrcar(t.concluidaEm, t.hoje)) return false
    if (x.acao === 'fechar' && t.podeReceber === false) return false
    return true
  })
    .map((x) => ({
      acao: x.acao,
      rotulo: ROTULO_DE_ACAO[x.acao],
      negativa: NEGATIVAS.includes(x.acao),
    }))
    /**
     * As que AVANÇAM vêm primeiro; dentro de cada grupo, a ordem da tabela.
     *
     * A faixa é lida da esquerda para a direita, e o caminho que a clínica
     * quer é o que avança: "Confirmou" e "Reagendar" antes de "No-show" e
     * "Desmarcou". Deixar a recusa no começo é pôr o botão do dia ruim sob o
     * polegar.
     */
    .sort((a, b) => Number(a.negativa) - Number(b.negativa))
}

/** `aaaa-mm-dd` de um instante ISO, sem fuso: só para comparar com o hoje. */
const diaDe = (iso: string): string => iso.slice(0, 10)

function aindaDaParaOrcar(concluidaEm: string | null, hoje: string): boolean {
  if (concluidaEm === null) return true
  const [a, m, d] = hoje.split('-').map(Number)
  const limite = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, (d ?? 1) - DIAS_PARA_ORCAR))
  const dois = (x: number) => String(x).padStart(2, '0')
  const corte = `${limite.getUTCFullYear()}-${dois(limite.getUTCMonth() + 1)}-${dois(limite.getUTCDate())}`
  // Lexicográfica: para `aaaa-mm-dd` é a mesma ordem da cronológica.
  return diaDe(concluidaEm) >= corte
}

/**
 * A linha de contexto da etapa — *"o que está acontecendo com este cartão"*.
 *
 * Vem das colunas que o servidor já devolveu; nada é calculado aqui além de
 * comparar dois dias civis, e o `hoje` também é do servidor.
 */
export function contextoDaEtapa(t: {
  readonly etapa: Etapa | null
  readonly confirmacaoEnviadaEm: string | null
  readonly proximoPassoEm: string | null
  readonly hoje: string
}): string | null {
  if (t.etapa === 'agendado' && t.confirmacaoEnviadaEm !== null) {
    return `confirmação enviada em ${brCurto(diaDe(t.confirmacaoEnviadaEm))}, aguardando resposta`
  }
  if (t.etapa === 'faltou' || t.etapa === 'desmarcou') return 'recontatar para reagendar'
  if (t.etapa === 'orcamento' && t.proximoPassoEm !== null) {
    const atrasado = t.proximoPassoEm < t.hoje ? ' (atrasado)' : ''
    return `retomar em ${brCurto(t.proximoPassoEm)}${atrasado}`
  }
  return null
}

/** `aaaa-mm-dd` → `dd/mm`. Formatar é da tela; calcular não é. */
const brCurto = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
