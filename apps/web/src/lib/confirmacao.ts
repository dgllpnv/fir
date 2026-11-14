import { formatarDinheiro } from '@fir/ui'
import { ErroDaApi } from './api'
import { diaCurto } from './formato'

/**
 * **A CONFIRMAÇÃO EXPLÍCITA (D-21), do lado da tela — escrita uma vez.**
 *
 * O servidor recusa com 409 `CONFIRMACAO_NECESSARIA` e uma lista de CÓDIGOS,
 * sem número nenhum (a redação central não alcança corpo de erro). A tela
 * escreve a pergunta — com o valor que a própria pessoa digitou, pelo
 * formatador central, e só para quem tem `valores` — e, se a pessoa confirma,
 * reenvia o MESMO corpo com a chave de cada aviso em `true`.
 *
 * Toda porta de recebimento passa por aqui: avulso, concluir tarefa, criar
 * tarefa já concluída, concluir sessão, fechar na jornada e montar programa.
 * Uma cópia por tela é como a sexta passa a gravar sem perguntar.
 */
export const CODIGO_CONFIRMACAO = 'CONFIRMACAO_NECESSARIA'

/** O aviso → a chave que o confirma no corpo. Aviso fora daqui não se confirma. */
const CHAVE_DO_AVISO: Readonly<Record<string, string>> = {
  CAIXA_FECHADO: 'confirmarCaixaFechado',
  POSSIVEL_DUPLICIDADE: 'confirmarDuplicidade',
  MES_ANTERIOR: 'confirmarMesAnterior',
}

export type ContextoDaPergunta = {
  /** O dia de negócio do lançamento, quando a tela o conhece (`AAAA-MM-DD`). */
  readonly dia: string | null
  /** O hoje da clínica, que veio do servidor. Decide entre "hoje" e "em 08/11". */
  readonly hoje: string | null
  /** O valor que a PESSOA digitou, em centavos. Nunca um número do servidor. */
  readonly valor: bigint | null
  /** `temPerm(…, 'valores')`. Sem ela, a pergunta não tem número. */
  readonly podeVerValores: boolean
}

/**
 * A pessoa disse "não": nada foi gravado, e a tela deixa o formulário como está.
 *
 * É um `ErroDaApi` (status 0: não veio do servidor) de propósito — todo
 * `catch` de tela já mostra `erro.message` de um `ErroDaApi`, e assim o
 * cancelamento chega como "Nada foi gravado." em vez de "Não consegui falar
 * com o servidor.", sem tocar em cada tela.
 */
export class ConfirmacaoRecusada extends ErroDaApi {
  constructor() {
    super(0, 'Nada foi gravado.', 'CONFIRMACAO_RECUSADA')
  }
}

/** As frases da pergunta, uma por aviso, na ordem em que o servidor os mandou. */
export function perguntasDosAvisos(
  avisos: readonly string[],
  ctx: ContextoDaPergunta,
): string[] {
  const ehHoje = ctx.dia === null || ctx.dia === ctx.hoje
  const quando = ehHoje ? 'hoje' : `em ${diaCurto(ctx.dia!)}`
  return avisos.map((a) => {
    switch (a) {
      case 'CAIXA_FECHADO':
        return `${ctx.dia === null ? 'O caixa deste dia' : `O caixa de ${diaCurto(ctx.dia)}`} já foi fechado. Lançar mesmo assim? O dia vai aparecer como alterado depois do fechamento.`
      case 'POSSIVEL_DUPLICIDADE':
        return ctx.podeVerValores && ctx.valor !== null
          ? `Já existe um pagamento de ${formatarDinheiro(ctx.valor)} para esta paciente ${quando}. É outro pagamento?`
          : `Já existe um pagamento de mesmo valor para esta paciente ${quando}. É outro pagamento?`
      case 'MES_ANTERIOR':
        return 'Este pagamento é de um mês anterior, que já pode ter sido fechado. Continuar mesmo assim?'
      default:
        return a
    }
  })
}

const avisosConhecidos = (e: unknown): readonly string[] | null => {
  if (!(e instanceof ErroDaApi) || e.status !== 409 || e.codigo !== CODIGO_CONFIRMACAO) return null
  const avisos = e.avisos ?? []
  if (avisos.length === 0 || avisos.some((a) => CHAVE_DO_AVISO[a] === undefined)) return null
  return avisos
}

/**
 * Envia; se o servidor pedir confirmação, pergunta e reenvia com as chaves.
 *
 * As confirmações SE ACUMULAM: se entre um envio e outro surgir um segundo
 * aviso (alguém fechou o caixa nesse meio-tempo), a pessoa é perguntada de
 * novo só sobre o que mudou, e o que já confirmou continua confirmado. O
 * limite de voltas existe para que um servidor confuso não prenda a tela num
 * laço de perguntas.
 */
export async function comConfirmacao<T>(
  enviar: (confirmacoes: Readonly<Record<string, true>>) => Promise<T>,
  perguntar: (avisos: readonly string[]) => Promise<boolean>,
): Promise<T> {
  const confirmacoes: Record<string, true> = {}
  for (let volta = 0; volta < 3; volta++) {
    try {
      return await enviar({ ...confirmacoes })
    } catch (e) {
      const avisos = avisosConhecidos(e)
      if (avisos === null) throw e
      if (!(await perguntar(avisos))) throw new ConfirmacaoRecusada()
      for (const a of avisos) confirmacoes[CHAVE_DO_AVISO[a]!] = true
    }
  }
  return enviar({ ...confirmacoes })
}
