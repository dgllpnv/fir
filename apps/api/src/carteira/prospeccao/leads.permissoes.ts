import { responsavelImpostoPeloPerfil, temPermCarteira } from '@fir/domain'
import type { Sessao } from './prospeccao-comum'

/**
 * Os DOIS pontos de extensão que o ticket 0.5 (perfis do `Usuário de Gestão`,
 * appsec A-2/A-3) vai preencher. Um lugar só, para que a prospecção mude
 * junto com o resto da carteira trocando este arquivo — nunca um `if` por rota.
 *
 * Desde a 0.5, a resposta é `temPermCarteira(sessao, 'valores')`, a mesma
 * função que o `RedacaoInterceptor` usa para as rotas da carteira.
 */
export function podeVerValoresDaCarteira(sessao: Sessao): boolean {
  return temPermCarteira(sessao, 'valores')
}

/**
 * "Só a minha carteira" (A-3): os leads de quem tem `carteira = 'minha'` se
 * restringem aos que ela é responsável. Devolve o id do responsável a impor
 * no `WHERE`, ou `null` para não restringir. Resolvido pela sessão (relida
 * do banco a cada requisição), nunca por parâmetro.
 */
export function responsavelImpostoPelaCarteira(sessao: Sessao): string | null {
  return responsavelImpostoPeloPerfil(sessao)
}
