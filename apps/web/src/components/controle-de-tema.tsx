'use client'

import { useEffect, useState } from 'react'
import { ROTULO_DO_TEMA, TEMAS, type Tema, aplicarTema, temaGuardado } from '@/lib/tema'

/**
 * Claro · Escuro · Sistema, no rodapé da lateral.
 *
 * **Por que aqui e não em "Configurações":** aquelas telas exigem a permissão
 * `config`, que a recepção não tem — e a recepção é quem passa o dia na
 * ferramenta. Tema é preferência pessoal, do mesmo tipo de "Trocar meu PIN",
 * que o protótipo também põe no rodapé, junto do nome de quem entrou.
 *
 * O estado nasce vazio e só é preenchido no efeito: o servidor não sabe o que
 * há no `localStorage` do aparelho, e renderizar um palpite faria o React
 * trocar o botão marcado logo depois de hidratar. Enquanto não sabe, nenhum
 * botão fica marcado — é honesto e não pisca.
 */
export function ControleDeTema() {
  const [tema, setTema] = useState<Tema | null>(null)

  useEffect(() => {
    setTema(temaGuardado())
  }, [])

  return (
    <div className="tema" role="group" aria-label="Tema da tela">
      {TEMAS.map((t) => (
        <button
          key={t}
          type="button"
          // `aria-pressed` e não `aria-current`: são três estados de uma mesma
          // preferência, não navegação.
          aria-pressed={tema === t}
          onClick={() => {
            aplicarTema(t)
            setTema(t)
          }}
        >
          {ROTULO_DO_TEMA[t]}
        </button>
      ))}
    </div>
  )
}
