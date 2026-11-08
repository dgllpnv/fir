import { z } from 'zod'
import { DiaCivil, centavosNaSaida } from './comum'

/**
 * A planilha de indicadores do `Cliente Firmare` (ticket 4A — G1-G4, V11,
 * P7, M5, W3 do inventário G8). Ver `packages/domain/src/planilhas-indicadores.ts`.
 *
 * `PUT /v1/carteira/clientes/:id/planilha` recebe o LINK; o servidor guarda
 * só o id que extrai dele (gate A-16: nunca busca a URL colada).
 */
export const DefinirPlanilhaDoClienteEntrada = z
  .object({ link: z.string().trim().min(1, 'Cole o link da planilha.').max(2000) })
  .strict()
export type DefinirPlanilhaDoClienteEntrada = z.infer<typeof DefinirPlanilhaDoClienteEntrada>

const inteiroEmTexto = z.string().regex(/^-?\d+$/)

/**
 * Um valor de métrica. Só um dos três vem preenchido, conforme a unidade.
 *
 * `valor` é DINHEIRO (centavos, métrica em R$) e tem esse nome DE PROPÓSITO:
 * a redação de valores apaga por nome de campo (regra 17, gate A-16 —
 * "array com campo de nome monetário, não mapa"), e sem a permissão
 * `valores` ele sai `null`. Contagem e percentual não são dinheiro e
 * atravessam.
 */
export const LeituraDaMetricaNaSaida = z.object({
  valor: centavosNaSaida,
  /** Métrica em `un`, em décimos (a média de contagens tem fração). */
  quantidadeEmDecimos: inteiroEmTexto.nullable(),
  /** Métrica em `%`, em décimos de ponto percentual. */
  percentualEmDecimos: inteiroEmTexto.nullable(),
})
export type LeituraDaMetricaNaSaida = z.infer<typeof LeituraDaMetricaNaSaida>

const StatusDaFrente = z.enum(['ok', 'atencao', 'pendente'])

export const SituacaoDaFrenteNaSaida = z.object({
  semana: DiaCivil,
  status: StatusDaFrente,
  /** Sem valor de dinheiro no texto (ver `ProblemaDaPlanilha` no domínio). */
  problemas: z.array(z.object({ codigo: z.string(), mensagem: z.string() })),
  /** "Nova linha em dd/mm às hh:mm · 7 de 8 perguntas" (`FG_PL_STATUS`). */
  envio: z
    .object({ carimbo: z.string().datetime().nullable(), preenchidas: z.number().int(), total: z.number().int() })
    .nullable(),
  envios: z.number().int(),
})

export const MetricaDaFrenteNaSaida = z.object({
  chave: z.string(),
  nome: z.string(),
  unidade: z.enum(['R$', 'un', '%']),
  pontos: z.array(z.object({ semana: DiaCivil, leitura: LeituraDaMetricaNaSaida.nullable() })),
  ultimo: z.object({ semana: DiaCivil, leitura: LeituraDaMetricaNaSaida }).nullable(),
  media: LeituraDaMetricaNaSaida.nullable(),
  /** Contra a segunda imediatamente anterior, em décimos de ponto; `null` = indefinida. */
  variacaoEmDecimos: inteiroEmTexto.nullable(),
})

export const FrenteDaPlanilhaNaSaida = z.object({
  frente: z.enum(['financeiro', 'comercial', 'trafego', 'marketing']),
  /** O nome esperado da aba ("Tráfego pago"). */
  aba: z.string(),
  /** O nome real achado na planilha, ou `null`. */
  abaEncontrada: z.string().nullable(),
  /** "Estrutura da aba a confirmar" (protótipo L1505). */
  provisoria: z.boolean(),
  situacao: SituacaoDaFrenteNaSaida,
  historico: z.array(z.object({ semana: DiaCivil, status: StatusDaFrente })),
  semanasComDados: z.number().int(),
  metricas: z.array(MetricaDaFrenteNaSaida),
})

export const PlanilhaDoClienteNaSaida = z.object({
  /** `null` quando o cliente ainda não tem planilha cadastrada. */
  planilha: z
    .object({
      link: z.string(),
      lidaEm: z.string().datetime().nullable(),
      leituraPedidaEm: z.string().datetime().nullable(),
      /** A última falha de leitura, em frase para a tela — nunca o corpo da resposta do Google. */
      erro: z.string().nullable(),
    })
    .nullable(),
  /** O e-mail com que a planilha precisa ser compartilhada (leitor), quando configurado no servidor. */
  emailDaContaDeServico: z.string().nullable(),
  /** O hoje e o fuso da carteira, para a tela escrever "lida hoje às 07:30" sem relógio próprio (regra 24). */
  hoje: DiaCivil,
  fuso: z.string(),
  /** A segunda-feira da semana passada, no fuso da carteira. */
  semanaDeReferencia: DiaCivil,
  semanas: z.array(DiaCivil),
  frentes: z.array(FrenteDaPlanilhaNaSaida),
})
export type PlanilhaDoClienteNaSaida = z.infer<typeof PlanilhaDoClienteNaSaida>

/** Janela do filtro de V11: 8 semanas, 3, 6 ou 12 meses (`L1500`). */
export const JanelaDaPlanilha = z.enum(['8', '13', '26', '52']).default('8')

export const PlanilhaDefinidaSaida = z.object({ link: z.string(), trocou: z.boolean() })
export type PlanilhaDefinidaSaida = z.infer<typeof PlanilhaDefinidaSaida>
