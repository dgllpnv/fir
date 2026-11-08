import { z } from 'zod'
import { Uuid } from './comum'
import { MaterialNaLista } from './conteudo-carteira'

/**
 * G8 3D — o que a biblioteca geral e a regra do benefício acrescentam aos
 * contratos de 1B (`conteudo-carteira.ts`) e de 1E (`prospeccao.ts`), num
 * arquivo próprio para não disputar aqueles dois.
 */

// ---------------------------------------------------------------------------
// X2 — o filtro "Personalizados" da Biblioteca (`vMetodo`, protótipo L2689):
// todos os materiais feitos para uma cliente, com o nome dela no cartão
// ("personalizado · Clínica X", `cardMaterial` L2698). Só os clientes que a
// sessão vê — "minha carteira" aplicada no servidor (appsec A-3).
// ---------------------------------------------------------------------------

export const PersonalizadoNaBiblioteca = MaterialNaLista.extend({
  clienteCarteiraId: Uuid,
  clienteNome: z.string(),
})
export type PersonalizadoNaBiblioteca = z.infer<typeof PersonalizadoNaBiblioteca>

export const PersonalizadosDaBibliotecaSaida = z.object({ materiais: z.array(PersonalizadoNaBiblioteca) })
export type PersonalizadosDaBibliotecaSaida = z.infer<typeof PersonalizadosDaBibliotecaSaida>

// ---------------------------------------------------------------------------
// T5 / L12 — a regra do benefício por indicação ("Alterar regra", L2542,
// L2656, `editBenef` L2956). Centésimos de ponto percentual, nunca texto
// (ADR 0015 achado 5). A conversão do lead fotografa o valor vigente
// (gate de números, ajuste 9); mudar a regra não mexe em benefício gerado.
// ---------------------------------------------------------------------------

export const RegraDoBeneficioSaida = z.object({
  /** `1000` = 10,00%. */
  percentualCentesimos: z.string().regex(/^\d+$/),
  /** Escopo geral e `carteira.administrar` (a diretoria no protótipo, `admin()`). */
  podeAlterar: z.boolean(),
})
export type RegraDoBeneficioSaida = z.infer<typeof RegraDoBeneficioSaida>

export const AlterarRegraDoBeneficioEntrada = z
  .object({
    percentualCentesimos: z
      .string()
      .regex(/^\d+$/, 'informe os centésimos de ponto percentual, ex.: "1000" para 10%')
      .transform((v) => BigInt(v))
      .refine((v) => v >= 1n && v <= 10000n, 'O desconto precisa estar entre 0,01% e 100%.'),
  })
  .strict()
export type AlterarRegraDoBeneficioEntrada = z.infer<typeof AlterarRegraDoBeneficioEntrada>
