import type { AbaLida, Result } from '@fir/domain'

/**
 * **O SEAM `LeitorDePlanilha`** (ticket 4A; `docs/arquitetura/sistema.md` §2).
 *
 * A porta por onde a planilha de indicadores entra. O que entra é um id de
 * planilha; o que sai são células cruas por aba. **Ele não decide nada**: qual
 * aba é de qual frente, qual coluna é de qual pergunta, a semana, a
 * validação e as métricas são de `packages/domain/src/planilhas-indicadores.ts`.
 * Por isso é testável com uma fixture e nada mais (`LeitorDePlanilhaEmMemoria`),
 * e por isso trocar o Google por outra fonte é um arquivo novo.
 *
 * Duas chamadas, e não uma: a planilha pode ter dezenas de abas (instruções,
 * rascunhos, gráficos), e só as que casam com uma frente são lidas. Quem
 * escolhe é o domínio (`escolherAbasDaPlanilha`), entre as duas.
 */
export interface LeitorDePlanilha {
  /** Os nomes das abas e o fuso da planilha (o do relógio de parede do carimbo). */
  lerEstrutura(spreadsheetId: string): Promise<Result<EstruturaDaPlanilha, ErroDeLeituraDaPlanilha>>
  /** As células das abas pedidas, na ordem pedida. A primeira linha de cada uma é o cabeçalho. */
  lerAbas(spreadsheetId: string, titulos: readonly string[]): Promise<Result<readonly AbaLida[], ErroDeLeituraDaPlanilha>>
}

export type EstruturaDaPlanilha = {
  /** IANA (`America/Sao_Paulo`), ou `null` se a fonte não informa. */
  readonly fuso: string | null
  readonly abas: readonly string[]
}

/**
 * Conjunto FECHADO. A mensagem é escrita pelo adaptador, para a tela — nunca
 * o corpo da resposta da fonte, que pode ecoar o pedido, e nunca credencial.
 */
export type CodigoDeErroDeLeitura =
  | 'nao_configurado'
  | 'autenticacao'
  | 'sem_acesso'
  | 'nao_encontrada'
  | 'limite'
  | 'grande_demais'
  | 'indisponivel'

export type ErroDeLeituraDaPlanilha = { readonly codigo: CodigoDeErroDeLeitura; readonly mensagem: string }

export const MENSAGENS_DE_LEITURA: Readonly<Record<CodigoDeErroDeLeitura, string>> = {
  nao_configurado: 'A leitura de planilhas ainda não foi configurada no servidor (conta de serviço do Google).',
  autenticacao: 'O Google recusou a conta de serviço. Confira a chave configurada no servidor.',
  sem_acesso:
    'A conta de serviço não tem acesso a esta planilha. Compartilhe a planilha com o e-mail da conta de serviço, como leitor.',
  nao_encontrada: 'Planilha não encontrada. Confira o link.',
  limite: 'O Google limitou as leituras agora. Tente de novo em alguns minutos.',
  grande_demais: 'A planilha é grande demais para ler. Deixe só as abas das frentes.',
  indisponivel: 'Não foi possível falar com o Google agora. A leitura será tentada de novo.',
}

export const erroDeLeitura = (codigo: CodigoDeErroDeLeitura): ErroDeLeituraDaPlanilha => ({
  codigo,
  mensagem: MENSAGENS_DE_LEITURA[codigo],
})

export const LEITOR_DE_PLANILHA = Symbol('fir.leitor-de-planilha')
