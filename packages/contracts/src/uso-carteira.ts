import { z } from 'zod'
import { DiaCivil, Uuid, centavosNaSaida } from './comum'

/**
 * **O uso diário da FIR Clinic, lido pela carteira** (G8 ticket 1D — F1, V12).
 *
 * Os cálculos moram em `@fir/domain` (`uso-carteira.ts`); isto é só o
 * transporte. Duas regras de forma:
 *
 *  - `receita` é o ÚNICO campo monetário, e o nome é de propósito: já está em
 *    `CAMPOS_MONETARIOS`, então o `RedacaoInterceptor` o apaga (vira `null`)
 *    de quem não tem `valores`, em qualquer profundidade (regra 17, A18).
 *  - Nada por pessoa (A15). `pessoasAtivas` só como agregado da semana; a
 *    série diária carrega só tarefas concluídas (A16).
 */

export const SituacaoDeUso = z.enum(['bom', 'atencao', 'critico'])
export type SituacaoDeUso = z.infer<typeof SituacaoDeUso>

const inteiro = z.number().int()

export const MetricasDeUsoSaida = z.object({
  comDados: z.boolean(),
  diasUteis: inteiro,
  diasComUso: inteiro,
  diasSemDado: inteiro,
  pessoasAtivas: inteiro,
  pessoasCadastradas: inteiro.nullable(),
  tarefasCriadas: inteiro,
  tarefasConcluidas: inteiro,
  percentualNoPrazo: inteiro.nullable(),
  tarefasVencidasAbertas: inteiro.nullable(),
  contatos: inteiro,
  orcamentosEnviados: inteiro,
  orcamentosPagos: inteiro,
  percentualConversao: inteiro.nullable(),
  /** Centavos em texto; `null` sem a permissão `valores`. */
  receita: centavosNaSaida,
  faltas: inteiro,
  /** `null` enquanto o job não calculou todos os dias da janela (PP-8): a tela oculta. */
  faltasRecontatadas: inteiro.nullable(),
})
export type MetricasDeUsoSaida = z.infer<typeof MetricasDeUsoSaida>

export const DiaDaSerieDeUsoSaida = z.object({ dia: DiaCivil, tarefasConcluidas: inteiro.nullable() })
export type DiaDaSerieDeUsoSaida = z.infer<typeof DiaDaSerieDeUsoSaida>

export const SaudeDeUsoSaida = z.object({ situacao: SituacaoDeUso.nullable(), rotulo: z.string() })
export type SaudeDeUsoSaida = z.infer<typeof SaudeDeUsoSaida>

export const UsoNaVisaoGeralSaida = z.object({
  clienteCarteiraId: Uuid,
  nome: z.string(),
  saude: SaudeDeUsoSaida,
  semana: MetricasDeUsoSaida.nullable(),
  deltaNoPrazo: inteiro.nullable(),
  deltaContatos: inteiro.nullable(),
  serie: z.array(DiaDaSerieDeUsoSaida),
})
export type UsoNaVisaoGeralSaida = z.infer<typeof UsoNaVisaoGeralSaida>

export const VisaoDeUsoSaida = z.object({
  totais: z.object({
    clinicas: inteiro,
    comDados: inteiro,
    bom: inteiro,
    atencao: inteiro,
    critico: inteiro,
    semSituacao: inteiro,
  }),
  /** Ordem do protótipo: crítico, atenção, bom, sem situação. */
  clientes: z.array(UsoNaVisaoGeralSaida),
})
export type VisaoDeUsoSaida = z.infer<typeof VisaoDeUsoSaida>

export const IndicadorDoRelatorioDeUsoSaida = z.object({
  chave: z.enum(['diasComUsoPorSemana', 'tarefasNoPrazo', 'contatosPorSemana', 'tarefasVencidasAbertas']),
  rotulo: z.string(),
  /** `decimos`: 35 quer dizer 3,5. */
  unidade: z.enum(['decimos', '%', 'un']),
  menorEMelhor: z.boolean(),
  inicio: inteiro.nullable(),
  agora: inteiro.nullable(),
  evolucao: inteiro.nullable(),
})
export type IndicadorDoRelatorioDeUsoSaida = z.infer<typeof IndicadorDoRelatorioDeUsoSaida>

export const UsoDoClienteSaida = z.object({
  clienteCarteiraId: Uuid,
  nome: z.string(),
  /** `false`: o cliente ainda não está ligado a uma clínica (lead convertido sem FIR Clinic). */
  comClinica: z.boolean(),
  /** `null` quando a clínica ainda não tem nenhum resumo diário. */
  uso: z
    .object({
      saude: SaudeDeUsoSaida,
      semana: MetricasDeUsoSaida,
      semanaAnterior: MetricasDeUsoSaida,
      deltaContatos: inteiro.nullable(),
      serie: z.array(DiaDaSerieDeUsoSaida),
      relatorio: z.object({
        emUsoDesde: DiaCivil,
        diasDesde: inteiro,
        marcos: z.array(z.object({ dia: inteiro, atingido: z.boolean(), faltam: inteiro })),
        indicadores: z.array(IndicadorDoRelatorioDeUsoSaida),
        /** O "Copiar relatório", montado no servidor e sem valor monetário (A18). */
        texto: z.string(),
      }),
    })
    .nullable(),
})
export type UsoDoClienteSaida = z.infer<typeof UsoDoClienteSaida>
