import type { PessoaNaLista } from '@fir/contracts'
import { canonizarEmail, ehErro, validarEmail } from '@fir/domain'

/**
 * O acesso por e-mail de uma pessoa, como Usuários e acessos o mostra (ADR
 * 2026-11-16). Nada aqui decide acesso: o servidor recusa o que não pode
 * (`podeAgirSobre`, 409, 503). Isto só escolhe o que a tela oferece e como diz.
 */

/**
 * O que as DUAS telas sabem da pessoa: a da clínica (`PessoaNaLista`) e a do
 * painel (`PessoaNoPainel`, que não tem `euMesma` — o operador não é pessoa
 * da clínica — nem `emailConfirmado`, que é `email !== null` nas duas).
 */
type AcessoDaPessoa = Pick<PessoaNaLista, 'situacaoDoAcesso' | 'email' | 'emailPendente' | 'ativo'> & {
  readonly euMesma?: boolean
}

/**
 * O SELO, um por pessoa. A ordem é a da urgência para a admin: o convite que
 * venceu deixa a pessoa do lado de fora; o pendente só espera; o e-mail não
 * confirmado não impede ninguém de entrar.
 */
export function seloDoAcesso(
  p: Pick<PessoaNaLista, 'situacaoDoAcesso' | 'emailConfirmado' | 'emailPendente'>,
): { texto: string; classe: string } | null {
  if (p.situacaoDoAcesso === 'convite_vencido') return { texto: 'Convite vencido', classe: 'pill mau' }
  if (p.situacaoDoAcesso === 'convite_pendente') return { texto: 'Convite pendente', classe: 'pill alerta' }
  if (!p.emailConfirmado && p.emailPendente !== null) return { texto: 'E-mail não confirmado', classe: 'pill' }
  return null
}

/**
 * **O caminho da senha de OUTRA pessoa** (spec 2.7): quem administra manda o
 * link e **nunca vê a senha**; a provisória fica como saída para quem não tem
 * e-mail que receba.
 *
 * - `link` — o PRINCIPAL. `convite` para quem foi convidada e ainda não criou
 *   a senha (é o `aguardando_primeira_senha` que o servidor exige), indo ao
 *   pendente; `redefinicao` para quem já tem senha e e-mail CONFIRMADO. A
 *   provisória continua ao alcance, como "Sem acesso ao e-mail?".
 * - `provisoria` — o caminho de hoje, e o único. `motivo` diz por que o link
 *   não serve, quando há o que dizer; `null` quando o envio está desligado ou
 *   não há e-mail nenhum (aí não há o que explicar: é como sempre foi).
 *
 * Só o CONFIRMADO recebe redefinição (appsec 4): o pendente pode ter erro de
 * digitação, e mandar para ele um link que troca a senha é entregar a conta a
 * quem for dono do endereço. Desativada não recebe nada: o link não serviria
 * (spec 3.9). Sobre si mesma, nada de link: a própria senha se troca em
 * "Trocar senha".
 *
 * Nada aqui decide acesso: o servidor recusa (403, 409, 503) o que não pode.
 */
export type CaminhoDaSenha =
  | { readonly tipo: 'link'; readonly finalidade: 'convite' | 'redefinicao' }
  | { readonly tipo: 'provisoria'; readonly motivo: string | null }

export function caminhoDaSenha(p: AcessoDaPessoa, envioDeEmail: boolean): CaminhoDaSenha {
  const provisoria = (motivo: string | null): CaminhoDaSenha => ({ tipo: 'provisoria', motivo })
  if (!envioDeEmail || p.euMesma === true) return provisoria(null)
  if (p.email === null && p.emailPendente === null) {
    return provisoria(p.situacaoDoAcesso === 'ativo' ? null : 'Cadastre o e-mail dela para reenviar o convite.')
  }
  if (!p.ativo) return provisoria('Ela está desativada: o link não serviria.')
  if (p.situacaoDoAcesso !== 'ativo') {
    return p.emailPendente === null
      ? provisoria('Cadastre o e-mail dela para reenviar o convite.')
      : { tipo: 'link', finalidade: 'convite' }
  }
  if (p.email !== null) return { tipo: 'link', finalidade: 'redefinicao' }
  return provisoria(
    'Ela ainda não confirmou o e-mail: o link de redefinição só vai para e-mail confirmado.',
  )
}

/** O recado depois do envio: o endereço MASCARADO que o servidor devolveu, nunca uma senha. */
export function recadoDoEnvio(finalidade: 'convite' | 'redefinicao', enviadoPara: string | null): string {
  const para = enviadoPara ?? 'o e-mail dela'
  return finalidade === 'convite'
    ? `Convite reenviado para ${para}. O anterior deixou de valer.`
    : `Link para redefinir a senha enviado para ${para}. Vale por 1 hora.`
}

/** O e-mail que o campo de edição mostra: o pendente (o que ainda espera), senão o confirmado. */
export const emailDoCampo = (p: Pick<PessoaNaLista, 'email' | 'emailPendente'>): string =>
  p.emailPendente ?? p.email ?? ''

/**
 * O que o `PATCH` leva no campo `email`, comparando o digitado com o atual:
 *
 * - `undefined` — não mudou, e o campo nem vai no corpo (a trilha não registra
 *   uma troca que ninguém fez);
 * - `null` — o campo foi esvaziado: RETIRAR (LGPD L8);
 * - `string` — o e-mail novo, canônico;
 * - `{ erro }` — fora da forma, com a frase do domínio para debaixo do campo.
 */
export function emailParaOPatch(
  digitado: string,
  p: Pick<PessoaNaLista, 'email' | 'emailPendente'>,
): string | null | undefined | { erro: string } {
  const canonico = canonizarEmail(digitado)
  const atual = emailDoCampo(p)
  if (canonico === atual) return undefined
  if (canonico === '') return atual === '' ? undefined : null
  const forma = validarEmail(canonico)
  return ehErro(forma) ? { erro: forma.erro.mensagem } : canonico
}
