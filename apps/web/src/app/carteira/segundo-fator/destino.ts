import type { CarteiraEuComSegundoFatorSaida } from '@fir/contracts'

export const CAMINHO_SEGUNDO_FATOR_DA_CARTEIRA = '/carteira/segundo-fator'

/**
 * Para onde vai quem acabou de entrar — a MESMA ordem que o servidor impõe
 * (`CarteiraGuard`, depois `SegundoFatorDaCarteiraGuard`): primeiro trocar a
 * provisória, depois cadastrar o app, só então a carteira. A tela só adianta
 * o desvio; quem recusa é o servidor (409 com o código de cada etapa).
 */
export function destinoDepoisDeEntrar(eu: CarteiraEuComSegundoFatorSaida): string {
  if (eu.usuarioDeGestao.senhaProvisoria) return '/carteira/trocar-senha'
  if (!eu.segundoFator.ativo) return CAMINHO_SEGUNDO_FATOR_DA_CARTEIRA
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
