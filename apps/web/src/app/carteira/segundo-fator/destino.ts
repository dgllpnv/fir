import type { CarteiraEuComSegundoFatorSaida } from '@fir/contracts'

export const CAMINHO_SEGUNDO_FATOR_DA_CARTEIRA = '/carteira/segundo-fator'

/**
 * O servidor exige o cadastro do app autenticador desta sessão? Só com o
 * segundo fator LIGADO no servidor (`exigido`, ADR 0023) e a conta ainda sem
 * TOTP. A tela não conhece a chave: lê o que o servidor diz.
 */
export const precisaCadastrarSegundoFator = (eu: CarteiraEuComSegundoFatorSaida): boolean =>
  eu.segundoFator.exigido && !eu.segundoFator.ativo

/**
 * Para onde vai quem acabou de entrar — a MESMA ordem que o servidor impõe
 * (`CarteiraGuard`, depois `SegundoFatorDaCarteiraGuard`): primeiro trocar a
 * provisória, depois (se o servidor exige) cadastrar o app, só então a
 * carteira. A tela só adianta o desvio; quem recusa é o servidor (409 com o
 * código de cada etapa).
 */
export function destinoDepoisDeEntrar(eu: CarteiraEuComSegundoFatorSaida): string {
  if (eu.usuarioDeGestao.senhaProvisoria) return '/carteira/trocar-senha'
  if (precisaCadastrarSegundoFator(eu)) return CAMINHO_SEGUNDO_FATOR_DA_CARTEIRA
  // A visão geral, como o protótipo; `/carteira` desvia quem não tem `painel`.
  return '/carteira'
}

/**
 * "Quando" de um aviso de segurança, no relógio de quem lê: é um fato sobre a
 * conta da pessoa, não uma data de negócio de clínica (regras 22–23 não se
 * aplicam a ele).
 */
export const formatarQuando = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
