'use client'

import { useCallback, useEffect, useState } from 'react'
import { chamar, ErroDaApi } from './api'

/**
 * Carregar · erro · vazio em UM lugar.
 *
 * `docs/design.md` diz que os três estados são parte do ticket, não
 * acabamento — e um `useEffect` com `try/catch` copiado em quatro telas é
 * como o terceiro deles perde o estado de erro. Aqui a tela recebe os três
 * prontos e decide só o que desenhar.
 *
 * Não há TanStack Query neste repositório ainda; quando houver, esta função é
 * o ponto único a trocar.
 */
export type Estado<T> = {
  readonly dados: T | null
  readonly carregando: boolean
  readonly erro: string | null
  readonly recarregar: () => void
  /** Troca os dados em memória depois de uma ação, sem nova ida ao servidor. */
  readonly trocar: (fn: (atual: T) => T) => void
}

export function useDados<T>(caminho: string | null): Estado<T> {
  const [dados, setDados] = useState<T | null>(null)
  const [carregando, setCarregando] = useState(caminho !== null)
  const [erro, setErro] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (caminho === null) return
    let valeu = true
    setCarregando(true)
    setErro(null)
    chamar<T>(caminho)
      .then((r) => {
        // Sem esta guarda, a resposta de uma navegação abandonada chega
        // DEPOIS da nova e pinta a tela com o dado do dia anterior.
        if (valeu) setDados(r)
      })
      .catch((e: unknown) => {
        if (!valeu) return
        setErro(
          e instanceof ErroDaApi
            ? e.message
            : 'Não consegui falar com o servidor. Confira a conexão.',
        )
      })
      .finally(() => {
        if (valeu) setCarregando(false)
      })
    return () => {
      valeu = false
    }
  }, [caminho, tentativa])

  const recarregar = useCallback(() => setTentativa((n) => n + 1), [])
  const trocar = useCallback(
    (fn: (atual: T) => T) => setDados((atual) => (atual === null ? atual : fn(atual))),
    [],
  )

  return { dados, carregando, erro, recarregar, trocar }
}

/** Monta `?a=1&b=2` sem os campos vazios — query limpa é URL compartilhável. */
export function consultaEmTexto(campos: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(campos)) {
    if (v === undefined || v === '') continue
    p.set(k, String(v))
  }
  const texto = p.toString()
  return texto === '' ? '' : `?${texto}`
}
