import type { UsuarioDeGestaoPublico } from '@fir/contracts'
import { temPermCarteira } from '@fir/domain'
import { HttpException, type HttpStatus } from '@nestjs/common'

export type Sessao = UsuarioDeGestaoPublico

/**
 * Erros do módulo como VALORES de classe; o controlador traduz para status.
 * Nenhum carrega texto do usuário nem o texto da mensagem (A-21, LGPD A38).
 */
export class NaoEncontrado extends Error {}
export class SemPermissao extends Error {}
export class NaoContatar extends Error {}
export class MensagemRestrita extends Error {}
export class ChaveReutilizada extends Error {}
export class EntradaInvalida extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

export const recusa = (status: HttpStatus, codigo: string, message: string): HttpException =>
  new HttpException({ statusCode: status, codigo, message }, status)

/**
 * **O PONTO DE EXTENSÃO DO TICKET 0.5 para este módulo.** Quem vê valor e
 * chave Pix dentro da mensagem, e quem grava os dados de pagamento.
 *
 * Hoje a carteira não tem a chave `valores` (ela nasce com `temPermCarteira`,
 * ticket 0.5), então ninguém vê — falha FECHADA, a mesma escolha de
 * `podeEscreverValoresDaCarteira` (carteira.service.ts) e do
 * `RedacaoInterceptor` para as rotas da carteira. Quando a 0.5 entrar, o
 * provedor abaixo passa a ser `(u) => temPermCarteira(u, 'valores')` e nada
 * mais muda. É um provedor injetável, e não uma constante, para que o teste
 * contra o banco exercite também o caminho COM `valores`.
 */
export const PODE_VER_VALORES_NA_MENSAGEM = Symbol('fir.carteira.mensagens.podeVerValores')
export type PodeVerValoresNaMensagem = (sessao: Sessao) => boolean
export const ninguemVeValoresAinda: PodeVerValoresNaMensagem = () => false
/** O provedor de produção desde a 0.5: a mesma função do `RedacaoInterceptor`. */
export const veValoresPeloPerfil: PodeVerValoresNaMensagem = (sessao) => temPermCarteira(sessao, 'valores')

/**
 * Quem edita modelos e roteiros: a diretoria (`admin()` no protótipo, L2659,
 * L2528). Hoje `escopo = 'geral'`, a mesma regra que a policy do banco
 * confere (A-19). Ganha `carteira.administrar` por AND com o ticket 0.5.
 */
export const podeEditarMensagens = (sessao: Sessao): boolean =>
  sessao.escopo === 'geral' && temPermCarteira(sessao, 'carteira.administrar')
