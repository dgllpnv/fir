import { PROGRAMAS, type Programa } from '@/conteudo/roteiro-briefing'

/**
 * Os quatro programas lado a lado (`.seg` do protótipo, L2684). Botões com
 * `aria-pressed`, não abas: trocar o programa troca o conteúdo da mesma
 * lista, não abre outro painel.
 */
export function SeletorDePrograma({
  programa,
  escolher,
}: {
  programa: Programa
  escolher: (p: Programa) => void
}) {
  return (
    <div className="brief-seletor" role="group" aria-label="Programa">
      {PROGRAMAS.map((p) => (
        <button
          key={p}
          type="button"
          className="brief-seletor-opcao"
          aria-pressed={p === programa}
          onClick={() => escolher(p)}
        >
          {p}
        </button>
      ))}
    </div>
  )
}
