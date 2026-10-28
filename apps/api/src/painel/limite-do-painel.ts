import { inteiroDoAmbiente } from '../comum/ambiente'

/**
 * Token de injeção próprio para o limite por origem **do painel**.
 *
 * A classe `LimitePorOrigem` já é o token do limite do produto, e o Nest
 * resolve provedor por token: reusá-la aqui faria as duas rotas dividirem a
 * MESMA janela deslizante — trinta tentativas no `/v1/entrar` de uma clínica
 * fechariam a porta do painel, e o sintoma seria "o painel dá 429 e ninguém
 * tentou entrar nele".
 */
export const LIMITE_DO_PAINEL = Symbol('painel.limite-por-origem')

/**
 * Dez tentativas por origem em quinze minutos — seis vezes mais apertado que
 * o do produto (60 em 5 min).
 *
 * O tráfego legítimo aqui é de **duas pessoas, algumas vezes por semana**.
 * Dez em quinze minutos já é muito mais do que qualquer uso real, e o alvo é
 * uma conta cujo nome de usuário é adivinhável e cuja credencial alcança
 * todas as clínicas.
 */
export const MAX_PAINEL_POR_ORIGEM = inteiroDoAmbiente('MAX_PAINEL_POR_ORIGEM', 10, { min: 1 })
export const JANELA_PAINEL_POR_ORIGEM_MS = inteiroDoAmbiente(
  'JANELA_PAINEL_POR_ORIGEM_MS',
  15 * 60 * 1000,
  { min: 1 },
)
