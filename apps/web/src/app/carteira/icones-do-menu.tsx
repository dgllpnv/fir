import type { ReactNode } from 'react'

/**
 * Os ícones do menu lateral da carteira, os do app do Firmare Gestão que a
 * cliente usa hoje (`ICON`, index.html L1229–1245): traço de 1,7 px, 17 px de
 * lado, sem preenchimento. Decorativos: o rótulo ao lado já diz o que é, então
 * `aria-hidden`. A chave é o destino, não o rótulo, para a troca de um texto
 * não apagar o ícone.
 */
function Ico({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

const PAINEL = (
  <Ico>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Ico>
)
const ROTINA = (
  <Ico>
    <rect x="4" y="4" width="16" height="17" rx="2" />
    <path d="M8 2v4M16 2v4M8 12l2.5 2.5L16 9" />
  </Ico>
)
const CLIENTES = (
  <Ico>
    <path d="M4 21V8l8-5 8 5v13" />
    <path d="M9 21v-6h6v6" />
  </Ico>
)
const FIR_CLINIC = (
  <Ico>
    <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
  </Ico>
)
const METAS = (
  <Ico>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r=".8" fill="currentColor" />
  </Ico>
)
const CAMPANHAS = (
  <Ico>
    <path d="M3 11v2l13 6V5L3 11z" />
    <path d="M16 9a3 3 0 010 6M7 14l1.5 6h3L10 15" />
  </Ico>
)
const RESUMO = (
  <Ico>
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M9 11h7M9 15h7M9 7h3" />
  </Ico>
)
const MENSALIDADES = (
  <Ico>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.8-2.5 1.9 0 2.6 5 1.3 5 3.9 0 1.1-1.1 1.9-2.5 1.9-1.1 0-2-.4-2.5-1.2M12 6.5V8m0 8v1.5" />
  </Ico>
)
const PROSPECCAO = (
  <Ico>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2M11 8v6M8 11h6" />
  </Ico>
)
const ROTEIROS = (
  <Ico>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V2.5h6V4M9 10h6M9 14h6M9 18h3" />
  </Ico>
)
const BIBLIOTECA = (
  <Ico>
    <path d="M4 5.5A1.5 1.5 0 015.5 4H10v16H5.5A1.5 1.5 0 014 18.5z" />
    <path d="M10 4h4v16h-4zM15.5 5.2l3.6-.9 3 15-3.6.9z" />
  </Ico>
)
const CHECKLISTS = (
  <Ico>
    <path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6h9M11 12h9M11 18h9" />
  </Ico>
)
const MENSAGENS = (
  <Ico>
    <path d="M4 5h16v11H9l-5 4z" />
    <path d="M8 9h8M8 12h5" />
  </Ico>
)

const POR_DESTINO: Readonly<Record<string, ReactNode>> = {
  '/carteira': PAINEL,
  '/carteira/rotina': ROTINA,
  '/carteira/clientes': CLIENTES,
  '/carteira/fir-clinic': FIR_CLINIC,
  '/carteira/metas': METAS,
  '/carteira/campanhas': CAMPANHAS,
  '/carteira/resumo': RESUMO,
  '/carteira/mensalidades': MENSALIDADES,
  '/carteira/leads': PROSPECCAO,
  '/carteira/metodo/roteiros': ROTEIROS,
  '/carteira/metodo/biblioteca': BIBLIOTECA,
  '/carteira/metodo/checklists': CHECKLISTS,
  '/carteira/metodo/mensagens': MENSAGENS,
}

/** `null` para um destino sem ícone: o item aparece só com o rótulo, nunca quebra. */
export function IconeDoMenu({ href }: { href: string }): ReactNode {
  return POR_DESTINO[href] ?? null
}
