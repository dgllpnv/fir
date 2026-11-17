'use client'

import type { EnvioFeito } from '@fir/contracts'
import { canonizarEmail, ehErro, validarEmail } from '@fir/domain'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * O PRÓPRIO e-mail — cadastrar, trocar ou retirar (`POST /v1/eu/email`).
 *
 * Exige a **senha atual** sempre (appsec 1): quem acha uma sessão aberta no
 * balcão não pode cadastrar o próprio e-mail na conta de outra pessoa e depois
 * redefinir a senha dela quando quiser.
 *
 * Os erros vão para debaixo do campo que precisa mudar: senha que não confere
 * (403) embaixo da senha; forma do e-mail embaixo do e-mail; envio desligado
 * (503), limite (429) e o provedor que recusou (502) embaixo do formulário.
 */
export type ErrosDoMeuEmail = { email: string; senha: string; geral: string }
const SEM_ERRO: ErrosDoMeuEmail = { email: '', senha: '', geral: '' }

export function useMeuEmail() {
  const [erros, setErros] = useState<ErrosDoMeuEmail>(SEM_ERRO)
  const [enviando, setEnviando] = useState(false)

  /** `email: null` retira. Devolve o endereço mascarado para onde foi o link, ou `null`. */
  async function enviar(email: string | null, senha: string): Promise<EnvioFeito | 'erro'> {
    setErros(SEM_ERRO)
    let canonico: string | null = null
    if (email !== null) {
      canonico = canonizarEmail(email)
      const forma = validarEmail(canonico)
      if (ehErro(forma)) {
        setErros({ ...SEM_ERRO, email: forma.erro.mensagem })
        return 'erro'
      }
    }
    if (senha === '') {
      setErros({ ...SEM_ERRO, senha: 'Informe a sua senha atual.' })
      return 'erro'
    }
    setEnviando(true)
    try {
      return await chamar<EnvioFeito>('v1/eu/email', {
        method: 'POST',
        body: JSON.stringify({ email: canonico, senha }),
      })
    } catch (x) {
      const mensagem = x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.'
      if (x instanceof ErroDaApi && x.status === 403) setErros({ ...SEM_ERRO, senha: mensagem })
      else if (x instanceof ErroDaApi && x.status === 400) setErros({ ...SEM_ERRO, email: mensagem })
      else setErros({ ...SEM_ERRO, geral: mensagem })
      return 'erro'
    } finally {
      setEnviando(false)
    }
  }

  return { erros, enviando, enviar, limpar: () => setErros(SEM_ERRO) }
}

/** O par de campos — e-mail e senha atual — com o erro de cada um embaixo dele. */
export function CamposDoMeuEmail({
  id,
  email,
  senha,
  aoMudarEmail,
  aoMudarSenha,
  erros,
  rotuloDoEmail = 'E-mail',
}: {
  id: string
  email: string
  senha: string
  aoMudarEmail: (v: string) => void
  aoMudarSenha: (v: string) => void
  erros: ErrosDoMeuEmail
  rotuloDoEmail?: string
}) {
  return (
    <>
      <label className="campo">
        {rotuloDoEmail}
        <input
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => aoMudarEmail(e.target.value)}
          autoComplete="email"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={254}
          aria-invalid={erros.email !== ''}
          aria-describedby={`${id}-erro-email`}
        />
        <span id={`${id}-erro-email`} className="erro" role="status" aria-live="polite">
          {erros.email}
        </span>
      </label>
      <label className="campo">
        Senha atual
        <input
          type="password"
          value={senha}
          onChange={(e) => aoMudarSenha(e.target.value)}
          autoComplete="current-password"
          aria-invalid={erros.senha !== ''}
          aria-describedby={`${id}-erro-senha`}
        />
        <span id={`${id}-erro-senha`} className="erro" role="status" aria-live="polite">
          {erros.senha}
        </span>
      </label>
    </>
  )
}
