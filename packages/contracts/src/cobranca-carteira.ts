import { z } from 'zod'
import { DiaCivil, Uuid, centavosNaSaida, dinheiroEmTexto } from './comum'

/**
 * **G3 — indicadores, metas comerciais e a cobrança do Cliente Firmare.**
 * Spec: `docs/superpowers/plans/g3-spec-metas-e-lancamentos.md`. Gate de
 * números: ADR 0015.
 *
 * Dinheiro trafega como string de centavos (`dinheiroEmTexto`/`centavosNaSaida`
 * de `./comum`), nunca `number` — regra 1. Os campos monetários dos contratos
 * abaixo (`mensalidade`, `desconto`, `valor`, `valorMeta`, `valorInicial`)
 * estão em `CAMPOS_MONETARIOS` (`@fir/domain`), e saem `null` sem a
 * permissão `valores` — hoje, por construção, para TODO `Usuário de Gestão`
 * (ver o comentário em `permissoes.ts`).
 */

export const UnidadeDeIndicador = z.enum(['R$', 'un', '%'])
export type UnidadeDeIndicador = z.infer<typeof UnidadeDeIndicador>

export const SentidoDeIndicador = z.enum(['maior_melhor', 'menor_melhor'])
export type SentidoDeIndicador = z.infer<typeof SentidoDeIndicador>

/** Inteiro simples (contagem, ou percentual em centésimos) — nunca ponto flutuante (regra 8). */
const inteiroEmTexto = z
  .union([z.string().regex(/^-?\d+$/, 'precisa ser um inteiro'), z.null()])
  .transform((v) => (v === null ? null : BigInt(v)))
const inteiroNaSaida = z.string().regex(/^-?\d+$/).nullable()

// ---------------------------------------------------------------------------
// Indicador da carteira
// ---------------------------------------------------------------------------

export const CriarIndicadorCarteiraEntrada = z
  .object({
    clienteCarteiraId: Uuid,
    nome: z.string().trim().min(1, 'Informe o nome.').max(120),
    unidade: UnidadeDeIndicador,
    sentido: SentidoDeIndicador,
  })
  .strict()
export type CriarIndicadorCarteiraEntrada = z.infer<typeof CriarIndicadorCarteiraEntrada>

export const IndicadorCarteiraNaLista = z.object({
  id: Uuid,
  clienteCarteiraId: Uuid,
  grupoId: Uuid,
  nome: z.string(),
  unidade: UnidadeDeIndicador,
  sentido: SentidoDeIndicador,
  ativo: z.boolean(),
})
export type IndicadorCarteiraNaLista = z.infer<typeof IndicadorCarteiraNaLista>

export const ListaDeIndicadoresCarteiraSaida = z.object({ indicadores: z.array(IndicadorCarteiraNaLista) })
export type ListaDeIndicadoresCarteiraSaida = z.infer<typeof ListaDeIndicadoresCarteiraSaida>

export const IndicadorCarteiraCriadoSaida = z.object({ indicador: IndicadorCarteiraNaLista })
export type IndicadorCarteiraCriadoSaida = z.infer<typeof IndicadorCarteiraCriadoSaida>

// ---------------------------------------------------------------------------
// Lançamento de indicador — upsert por (indicadorId, referencia)
// ---------------------------------------------------------------------------

export const LancarIndicadorEntrada = z
  .object({
    referencia: DiaCivil,
    // Exatamente um dos dois, conforme a unidade do indicador — o SERVIDOR
    // confere contra `indicadores_carteira.unidade` (e o BANCO confere de
    // novo, por trigger — nunca só a aplicação).
    valor: dinheiroEmTexto.nullable().optional(),
    valorInteiro: inteiroEmTexto.nullable().optional(),
    observacao: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((d) => (d.valor != null) !== (d.valorInteiro != null), {
    message: 'Informe "valor" OU "valorInteiro", nunca os dois nem nenhum.',
    path: ['valor'],
  })
export type LancarIndicadorEntrada = z.infer<typeof LancarIndicadorEntrada>

export const LancamentoDeIndicadorNaLista = z.object({
  id: Uuid,
  indicadorId: Uuid,
  referencia: DiaCivil,
  valor: centavosNaSaida,
  valorInteiro: inteiroNaSaida,
  observacao: z.string().nullable(),
  lancadoPor: Uuid,
})
export type LancamentoDeIndicadorNaLista = z.infer<typeof LancamentoDeIndicadorNaLista>

export const ListaDeLancamentosDeIndicadorSaida = z.object({
  lancamentos: z.array(LancamentoDeIndicadorNaLista),
})
export type ListaDeLancamentosDeIndicadorSaida = z.infer<typeof ListaDeLancamentosDeIndicadorSaida>

export const LancamentoDeIndicadorSalvoSaida = z.object({ lancamento: LancamentoDeIndicadorNaLista })
export type LancamentoDeIndicadorSalvoSaida = z.infer<typeof LancamentoDeIndicadorSalvoSaida>

// ---------------------------------------------------------------------------
// Meta comercial do cliente — progresso SEMPRE derivado (critério 2.1.4)
// ---------------------------------------------------------------------------

export const CriarMetaComercialEntrada = z
  .object({
    clienteCarteiraId: Uuid,
    indicadorId: Uuid,
    titulo: z.string().trim().min(1, 'Informe o título.').max(160),
    sentido: SentidoDeIndicador,
    valorMeta: dinheiroEmTexto.nullable().optional(),
    valorMetaInteiro: inteiroEmTexto.nullable().optional(),
    valorInicial: dinheiroEmTexto.nullable().optional(),
    valorInicialInteiro: inteiroEmTexto.nullable().optional(),
    inicio: DiaCivil,
    prazo: DiaCivil,
  })
  .strict()
  .refine((d) => (d.valorMeta != null) !== (d.valorMetaInteiro != null), {
    message: 'Informe "valorMeta" OU "valorMetaInteiro", nunca os dois nem nenhum.',
    path: ['valorMeta'],
  })
export type CriarMetaComercialEntrada = z.infer<typeof CriarMetaComercialEntrada>

export const MetaComercialNaLista = z.object({
  id: Uuid,
  clienteCarteiraId: Uuid,
  indicadorId: Uuid,
  titulo: z.string(),
  sentido: SentidoDeIndicador,
  valorMeta: centavosNaSaida,
  valorMetaInteiro: inteiroNaSaida,
  valorInicial: centavosNaSaida,
  valorInicialInteiro: inteiroNaSaida,
  inicio: DiaCivil,
  prazo: DiaCivil,
  status: z.enum(['em_andamento', 'concluida']),
  /**
   * DERIVADO do último `Lançamento de indicador` da série — `null` quando
   * ainda não há nenhum ("Aguardando o primeiro lançamento", critério 2.1.5).
   * Nunca lido de um campo persistido.
   */
  ultimoLancamento: LancamentoDeIndicadorNaLista.nullable(),
})
export type MetaComercialNaLista = z.infer<typeof MetaComercialNaLista>

export const ListaDeMetasComerciaisSaida = z.object({ metas: z.array(MetaComercialNaLista) })
export type ListaDeMetasComerciaisSaida = z.infer<typeof ListaDeMetasComerciaisSaida>

export const MetaComercialCriadaSaida = z.object({ meta: MetaComercialNaLista })
export type MetaComercialCriadaSaida = z.infer<typeof MetaComercialCriadaSaida>

// ---------------------------------------------------------------------------
// Cobrança do Cliente Firmare — dinheiro REAL (critérios 2.2.7 a 2.2.12)
// ---------------------------------------------------------------------------

export const CobrancaCarteiraNaLista = z.object({
  id: Uuid,
  clienteCarteiraId: Uuid,
  competencia: DiaCivil,
  /** Snapshot da mensalidade NA ÉPOCA — nunca recalculado (critério 2.2.8). */
  mensalidade: centavosNaSaida,
  desconto: centavosNaSaida,
  /** `mensalidade - desconto`. O que de fato foi cobrado. */
  valor: centavosNaSaida,
  vencimento: DiaCivil,
  status: z.enum(['aberto', 'pago', 'cancelado']),
  pagoEm: z.string().datetime().nullable(),
})
export type CobrancaCarteiraNaLista = z.infer<typeof CobrancaCarteiraNaLista>

/**
 * **Nenhum total colapsado (achado 1, ADR 0015).** `somaValor` é SEMPRE
 * recalculado, no servidor, sobre o MESMO array `cobrancas` desta resposta —
 * nunca uma segunda consulta com filtro diferente. `null` quando `valor` já
 * saiu `null` por falta de `valores` (a soma de nada que você pode ver não é
 * zero — é "você não tem a permissão", a mesma semântica de `centavosNaSaida`).
 */
export const ListaDeCobrancasCarteiraSaida = z.object({
  cobrancas: z.array(CobrancaCarteiraNaLista),
  somaValor: centavosNaSaida,
})
export type ListaDeCobrancasCarteiraSaida = z.infer<typeof ListaDeCobrancasCarteiraSaida>

export const MarcarCobrancaPagaSaida = z.object({ cobranca: CobrancaCarteiraNaLista })
export type MarcarCobrancaPagaSaida = z.infer<typeof MarcarCobrancaPagaSaida>

/**
 * "Desfazer" (critério 2.2.9 do spec G3) — mesma forma de `MarcarCobrancaPagaSaida`:
 * grava e relê pela mesma porta, para que a tela não precise de uma segunda
 * chamada só para saber em que estado a cobrança ficou.
 */
export const DesfazerCobrancaPagaSaida = z.object({ cobranca: CobrancaCarteiraNaLista })
export type DesfazerCobrancaPagaSaida = z.infer<typeof DesfazerCobrancaPagaSaida>

// ---------------------------------------------------------------------------
// Benefício de indicação — cadastro simples; consumo é só pelo job (interno)
// ---------------------------------------------------------------------------

export const CriarBeneficioDeIndicacaoEntrada = z
  .object({
    clienteCarteiraId: Uuid,
    /** `1000` = 10,00%. `PercentualCentesimos` de `@fir/domain`. */
    percentualCentesimos: z
      .string()
      .regex(/^\d+$/, 'informe os centésimos de ponto percentual, ex.: "1000" para 10%')
      .transform((v) => BigInt(v))
      .refine((v) => v >= 0n && v <= 10000n, 'precisa estar entre 0 e 10000'),
    motivo: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
export type CriarBeneficioDeIndicacaoEntrada = z.infer<typeof CriarBeneficioDeIndicacaoEntrada>

export const BeneficioDeIndicacaoNaLista = z.object({
  id: Uuid,
  clienteCarteiraId: Uuid,
  percentualCentesimos: z.string().regex(/^\d+$/),
  motivo: z.string().nullable(),
  consumidoEm: z.string().datetime().nullable(),
  cobrancaId: Uuid.nullable(),
})
export type BeneficioDeIndicacaoNaLista = z.infer<typeof BeneficioDeIndicacaoNaLista>

export const BeneficioDeIndicacaoCriadoSaida = z.object({ beneficio: BeneficioDeIndicacaoNaLista })
export type BeneficioDeIndicacaoCriadoSaida = z.infer<typeof BeneficioDeIndicacaoCriadoSaida>
