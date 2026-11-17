import type { PessoaNaLista } from '@fir/contracts'
import { canonizarEmail, ehErro, validarEmail } from '@fir/domain'

/**
 * O acesso por e-mail de uma pessoa, como Usuários e acessos o mostra (ADR
 * 2026-11-16). Nada aqui decide acesso: o servidor recusa o que não pode
 * (`podeAgirSobre`, 409, 503). Isto só escolhe o que a tela oferece e como diz.
 */

type AcessoNaLista = Pick<
  PessoaNaLista,
  'situacaoDoAcesso' | 'emailConfirmado' | 'emailPendente' | 'email' | 'ativo' | 'euMesma'
>

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

export type AcaoDeEmail = { readonly habilitada: boolean; readonly motivo: string | null }

/**
 * "Reenviar convite" e "Enviar link para redefinir senha".
 *
 * - Com o envio DESLIGADO, nenhuma das duas existe: o servidor responderia
 *   503, e duas opções mortas em cada pessoa só ensinam a não olhar o menu.
 * - Sobre si mesma, nenhuma: a própria senha se troca em "Trocar senha".
 * - **Reenviar convite** só para quem foi convidada e ainda não criou a senha
 *   (é o `aguardando_primeira_senha` que o servidor exige).
 * - **Enviar link** só para quem já tem senha, e só com e-mail CONFIRMADO
 *   (appsec 4): o pendente pode ter erro de digitação, e mandar para ele um
 *   link que troca a senha é entregar a conta a quem for dono do endereço.
 * - Pessoa desativada não recebe nada: o link não serviria (spec 3.9).
 */
export function acoesDeEmail(
  p: AcessoNaLista,
  envioDeEmail: boolean,
): { convite: AcaoDeEmail | null; redefinicao: AcaoDeEmail | null } {
  if (!envioDeEmail || p.euMesma) return { convite: null, redefinicao: null }
  const inativa = p.ativo ? null : 'Ela está desativada.'
  if (p.situacaoDoAcesso !== 'ativo') {
    const motivo = inativa ?? (p.emailPendente === null ? 'Cadastre o e-mail dela antes.' : null)
    return { convite: { habilitada: motivo === null, motivo }, redefinicao: null }
  }
  const motivo =
    inativa ?? (p.emailConfirmado ? null : 'Ela ainda não confirmou o e-mail. Use Redefinir senha.')
  return { convite: null, redefinicao: { habilitada: motivo === null, motivo } }
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
