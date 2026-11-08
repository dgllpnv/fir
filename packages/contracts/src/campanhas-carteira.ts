import { PERIODOS_DE_CAMPANHAS, STATUS_DE_CAMPANHA_CARTEIRA } from '@fir/domain'
import { z } from 'zod'
import { DiaCivil, Mes, Uuid, centavosNaSaida, dinheiroEmTexto } from './comum'

/**
 * **Campanhas da carteira** — a tela comparativa (K1), a aba do cliente (V9),
 * o período (K2) e a campanha lançada à mão (K3). Inventário G8; gates LGPD
 * A20–A26 e números 23–29; D-22 item 9.
 *
 * Os campos monetários (`receita`, `investimento`, `valorGerado`,
 * `resultadoEmDinheiro`, `metaEmDinheiro`, `retornoSobreInvestimento`) estão em
 * `CAMPOS_MONETARIOS` e saem `null` sem a permissão `valores` — pelo
 * `RedacaoInterceptor`, nunca por `if` aqui. **`retornoSobreInvestimento`, e
 * não `retorno`**: a redação apaga por NOME em qualquer profundidade, e
 * `retorno` já é a regra de retorno do procedimento e a tarefa de retorno do
 * programa (`programas.ts`) — registrar `retorno` apagaria as duas de quem
 * não tem `valores`.
 *
 * Célula suprimida (menos de 5 pagamentos, LGPD A21) chega com `suprimida:
 * true` e todos os números da receita e derivados `null` — decidido no
 * servidor por `suprimirCampanhas` (`@fir/domain`), não pela tela.
 */

export const StatusDeCampanhaCarteira = z.enum(STATUS_DE_CAMPANHA_CARTEIRA)
export type StatusDeCampanhaCarteira = z.infer<typeof StatusDeCampanhaCarteira>

export const PeriodoDeCampanhasChave = z.enum(PERIODOS_DE_CAMPANHAS)

/** Query string das duas leituras. `de`/`ate` só com `periodo=custom`. */
export const ConsultaDePeriodoDeCampanhas = z
  .object({
    periodo: PeriodoDeCampanhasChave.default('3m'),
    de: Mes.optional(),
    ate: Mes.optional(),
  })
  .strict()
export type ConsultaDePeriodoDeCampanhas = z.infer<typeof ConsultaDePeriodoDeCampanhas>

export const PeriodoDeCampanhasSaida = z.object({
  chave: PeriodoDeCampanhasChave,
  de: DiaCivil,
  ate: DiaCivil,
  meses: z.array(DiaCivil),
  /** O mês corrente no fuso da carteira — "Valor gerado neste mês". */
  mesAtual: DiaCivil,
  /** O hoje e o fuso da carteira, para a tela escrever "hoje às 07:30" sem relógio próprio (regra 24). */
  hoje: DiaCivil,
  fuso: z.string(),
})
export type PeriodoDeCampanhasSaida = z.infer<typeof PeriodoDeCampanhasSaida>

export const CampanhaCarteiraNaLista = z.object({
  id: Uuid,
  clienteCarteiraId: Uuid,
  origem: z.enum(['sincronizada', 'manual']),
  nome: z.string(),
  tipo: z.string(),
  /** `aaaa-mm-01`. */
  mes: DiaCivil,
  status: StatusDeCampanhaCarteira,
  rotuloDaMetrica: z.string(),
  suprimida: z.boolean(),
  /** "Valor gerado no mês". */
  receita: centavosNaSaida,
  investimento: centavosNaSaida,
  /** "3,2x" (`roi`, L1477), ou `null` ("—"). */
  retornoSobreInvestimento: z.string().nullable(),
  resultadoEmNumero: z.number().int().nullable(),
  resultadoEmDinheiro: centavosNaSaida,
  metaEmNumero: z.number().int().nullable(),
  metaEmDinheiro: centavosNaSaida,
  percentualDaMeta: z.number().int().nullable(),
  /** Pagamentos da célula (o número que decide o `k`). `null` na suprimida. */
  orcamentosPagos: z.number().int().nullable(),
  observacoes: z.string(),
  /** Linha sincronizada aceita só investimento e observações (D-22 item 9). */
  editavel: z.enum(['tudo', 'investimento_e_observacoes']),
})
export type CampanhaCarteiraNaLista = z.infer<typeof CampanhaCarteiraNaLista>

const ValorGeradoNoMes = z.object({ mes: DiaCivil, valorGerado: centavosNaSaida })

const ValoresDoPeriodo = z.object({
  valorGerado: centavosNaSaida,
  investimento: centavosNaSaida,
  retornoSobreInvestimento: z.string().nullable(),
})

/** "Outras campanhas": só a quantidade, nunca valor (ver `suprimirCampanhas`). */
const OutrasCampanhas = z.object({ quantidade: z.number().int() })

export const CampanhasDoClienteSaida = z.object({
  periodo: PeriodoDeCampanhasSaida,
  cliente: z.object({
    id: Uuid,
    nome: z.string(),
    ligadoAClinica: z.boolean(),
    sincronizadoEm: z.string().nullable(),
  }),
  campanhas: z.array(CampanhaCarteiraNaLista),
  kpis: z.object({
    periodo: ValoresDoPeriodo,
    mesAtual: z.object({ valorGerado: centavosNaSaida }),
  }),
  outras: OutrasCampanhas,
  soDasExibidas: z.boolean(),
})
export type CampanhasDoClienteSaida = z.infer<typeof CampanhasDoClienteSaida>

export const ComparativoDeCampanhasSaida = z.object({
  periodo: PeriodoDeCampanhasSaida,
  kpis: z.object({
    mesAtual: z.object({ valorGerado: centavosNaSaida }),
    mesAnterior: z.object({ valorGerado: centavosNaSaida }).nullable(),
    periodo: ValoresDoPeriodo,
    ativas: z.number().int(),
    clientesAtualizandoSozinhos: z.number().int(),
  }),
  porCliente: z.array(
    z.object({
      clienteCarteiraId: Uuid,
      nome: z.string(),
      ligadoAClinica: z.boolean(),
      meses: z.array(ValorGeradoNoMes),
      valorGerado: centavosNaSaida,
      retornoSobreInvestimento: z.string().nullable(),
      melhor: z.object({ nome: z.string(), mes: DiaCivil, valorGerado: centavosNaSaida }).nullable(),
    }),
  ),
  maisGeraram: z.array(
    z.object({
      id: Uuid,
      clienteCarteiraId: Uuid,
      nomeDoCliente: z.string(),
      nome: z.string(),
      mes: DiaCivil,
      valorGerado: centavosNaSaida,
      resultadoEmNumero: z.number().int().nullable(),
      resultadoEmDinheiro: centavosNaSaida,
      rotuloDaMetrica: z.string(),
      retornoSobreInvestimento: z.string().nullable(),
    }),
  ),
  porTipo: z.array(z.object({ tipo: z.string(), clientes: z.number().int(), meses: z.array(ValorGeradoNoMes) })),
  atualizacao: z.array(
    z.object({ clienteCarteiraId: Uuid, nome: z.string(), ligadoAClinica: z.boolean(), sincronizadoEm: z.string().nullable() }),
  ),
  outras: OutrasCampanhas,
  soDasExibidas: z.boolean(),
})
export type ComparativoDeCampanhasSaida = z.infer<typeof ComparativoDeCampanhasSaida>

// ---------------------------------------------------------------------------
// Escrita (K3)
// ---------------------------------------------------------------------------

const naoNegativo = (v: bigint | null) => v === null || v >= 0n

/** Centavos, ou `null`. **`null` no PATCH significa "não mexer"** (A-6). */
const dinheiroNaoNegativo = dinheiroEmTexto.refine(naoNegativo, 'O valor não pode ser negativo.')

export const CriarCampanhaCarteiraEntrada = z
  .object({
    clienteCarteiraId: Uuid,
    nome: z.string().trim().min(1, 'Informe o nome da campanha.').max(80),
    tipo: z.string().trim().min(1).max(60).default('Aniversariantes'),
    mes: Mes,
    rotuloDaMetrica: z.string().trim().max(60).default('Agendamentos'),
    metaEmNumero: z.number().int().positive().max(1_000_000_000).nullable().default(null),
    resultadoEmNumero: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
    receita: dinheiroNaoNegativo.default(null),
    investimento: dinheiroNaoNegativo.default(null),
    /**
     * LGPD A24: sem o número de pagamentos, a receita da campanha manual é
     * tratada como abaixo de 5 e não aparece. Não existe no protótipo; é o
     * campo que o gate exige para que a regra valha também à mão.
     */
    orcamentosPagos: z.number().int().min(0).max(1_000_000).nullable().default(null),
    status: StatusDeCampanhaCarteira.default('planejada'),
    observacoes: z.string().max(2000).default(''),
  })
  .strict()
export type CriarCampanhaCarteiraEntrada = z.infer<typeof CriarCampanhaCarteiraEntrada>

/**
 * Campo ausente = não mexer. Nos dois campos monetários, `null` também é "não
 * mexer": sem `valores` a tela recebe `null` e pode reenviá-lo — e isso nunca
 * pode apagar o valor guardado (gate de segurança A-6). Para zerar, mande "0".
 */
export const AtualizarCampanhaCarteiraEntrada = z
  .object({
    nome: z.string().trim().min(1).max(80),
    tipo: z.string().trim().min(1).max(60),
    mes: Mes,
    rotuloDaMetrica: z.string().trim().max(60),
    metaEmNumero: z.number().int().positive().max(1_000_000_000).nullable(),
    resultadoEmNumero: z.number().int().min(0).max(1_000_000_000).nullable(),
    receita: dinheiroNaoNegativo,
    investimento: dinheiroNaoNegativo,
    orcamentosPagos: z.number().int().min(0).max(1_000_000).nullable(),
    status: StatusDeCampanhaCarteira,
    observacoes: z.string().max(2000),
  })
  .partial()
  .strict()
export type AtualizarCampanhaCarteiraEntrada = z.infer<typeof AtualizarCampanhaCarteiraEntrada>

export const CampanhaCarteiraSalvaSaida = z.object({ campanha: CampanhaCarteiraNaLista })
export type CampanhaCarteiraSalvaSaida = z.infer<typeof CampanhaCarteiraSalvaSaida>
