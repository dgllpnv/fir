'use client'

import { useEffect, useState } from 'react'
import { chamar } from '@/lib/api'
import { MOTIVO_MAX, validarMotivoDeSuporte } from '@/lib/motivo-de-suporte'

/**
 * A sessão é do Suporte Firmare? Lê `/v1/eu` (o servidor é quem sabe: a tela
 * nunca decide). Uma ida por página, guardada no módulo. Enquanto não responde
 * é `false`: se for suporte e o campo não apareceu, o servidor responde 400
 * com a mensagem, e quem chama a mostra.
 */
let promessa: Promise<boolean> | null = null
export function useEhSuporte(): boolean {
  const [suporte, setSuporte] = useState(false)
  useEffect(() => {
    let valeu = true
    promessa ??= chamar<{ operador: unknown }>('v1/eu')
      .then((e) => e.operador !== null && e.operador !== undefined)
      .catch(() => {
        promessa = null
        return false
      })
    void promessa.then((v) => {
      if (valeu) setSuporte(v)
    })
    return () => {
      valeu = false
    }
  }, [])
  return suporte
}

export function CampoDeMotivoDeSuporte({
  valor,
  aoMudar,
  tocado,
}: {
  valor: string
  aoMudar: (v: string) => void
  /** Mostra o erro de tamanho mesmo antes de a pessoa digitar (após clicar em confirmar). */
  tocado?: boolean
}) {
  const r = validarMotivoDeSuporte(valor)
  const mostrarErro = !r.ok && (tocado === true || valor.length > 0)
  return (
    <label className="campo">
      Motivo (aparece no histórico da clínica)
      <textarea
        maxLength={MOTIVO_MAX}
        style={{ minHeight: 56 }}
        value={valor}
        aria-invalid={mostrarErro}
        onChange={(e) => aoMudar(e.target.value)}
      />
      <small className="num">
        {valor.trim().length}/{MOTIVO_MAX} · de 10 a 200 caracteres. Não escreva nome nem telefone de paciente.
      </small>
      {mostrarErro && !r.ok ? (
        <small className="erro" role="alert">
          {r.erro}
        </small>
      ) : null}
    </label>
  )
}
