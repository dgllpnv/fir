import type { ReactElement } from 'react'

/**
 * Os ícones do menu, SVG inline.
 *
 * Inline e não biblioteca: são dezessete traços de 24×24 que não mudam, e uma
 * dependência de ícones traria mil e um que ninguém usa, mais o peso no
 * primeiro carregamento da recepção. `docs/design.md` proíbe emoji na
 * interface — ícone é SVG, sempre com rótulo ao lado, nunca sozinho.
 *
 * O traço veio do protótipo da PO (`stroke-width` 1.8, `currentColor`), para o
 * menu novo não parecer de outra ferramenta.
 *
 * `aria-hidden`: o rótulo em texto já está no link. Um ícone anunciado de novo
 * faria o leitor de tela dizer "Hoje Hoje".
 */
const svg = (...filhos: ReactElement[]): ReactElement => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    {filhos}
  </svg>
)

const ICONES: Readonly<Record<string, ReactElement>> = {
  '/hoje': svg(
    <rect key="a" x="3" y="5" width="18" height="16" rx="2" />,
    <path key="b" d="M3 10h18M8 3v4M16 3v4" />,
    <circle key="c" cx="12" cy="15" r="1.6" fill="currentColor" />,
  ),
  '/tarefas': svg(
    <path key="a" d="M9 6h11M9 12h11M9 18h11" />,
    <path key="b" d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17" />,
  ),
  '/nova': svg(
    <rect key="a" x="4" y="4" width="16" height="16" rx="3" />,
    <path key="b" d="M12 8v8M8 12h8" />,
  ),
  '/jornada': svg(<path key="a" d="M3 5h18l-7 8v6l-4 2v-8z" />),
  '/pacientes': svg(
    <rect key="a" x="3" y="4" width="18" height="16" rx="2" />,
    <circle key="b" cx="9" cy="10.5" r="2.4" />,
    <path key="c" d="M5.2 16.5c.6-1.9 2-2.9 3.8-2.9s3.2 1 3.8 2.9M15 9.5h3.5M15 13h3.5" />,
  ),
  '/programas': svg(<path key="a" d="M3 12h4l2.5-6 4 12 2.5-6H21" />),
  '/campanhas': svg(
    <circle key="a" cx="12" cy="12" r="8.5" />,
    <circle key="b" cx="12" cy="12" r="4.5" />,
    <circle key="c" cx="12" cy="12" r="1.2" fill="currentColor" />,
  ),
  '/recebimentos': svg(
    <rect key="a" x="2.5" y="6" width="19" height="12" rx="2" />,
    <circle key="b" cx="12" cy="12" r="2.6" />,
    <path key="c" d="M6 9.5v5M18 9.5v5" />,
  ),
  '/caixa': svg(
    <path key="a" d="M3 9.5 5 4h14l2 5.5" />,
    <rect key="b" x="3" y="9.5" width="18" height="10.5" rx="2" />,
    <path key="c" d="M9.5 13.5h5" />,
  ),
  '/contas': svg(
    <path key="a" d="M5.5 3h13v18l-2.2-1.6L14 21l-2-1.6L10 21l-2.3-1.6L5.5 21z" />,
    <path key="b" d="M9 8h6M9 12h6" />,
  ),
  '/cobrancas': svg(
    <path key="a" d="M4 6a2 2 0 0 1 2-2h2l1.6 4-2 1.3a12 12 0 0 0 5.1 5.1l1.3-2 4 1.6v2a2 2 0 0 1-2 2A14 14 0 0 1 4 6z" />,
  ),
  '/visao-do-mes': svg(
    <rect key="a" x="3" y="4.5" width="18" height="16" rx="2" />,
    <path key="b" d="M3 9h18" />,
    <path key="c" d="m7 16.5 3-3 2.5 2L17 11" />,
  ),
  '/estoque': svg(
    <path key="a" d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />,
    <path key="b" d="M3 7.5 12 12l9-4.5M12 12v9" />,
  ),
  '/equipe': svg(
    <circle key="a" cx="9" cy="8" r="3.2" />,
    <path key="b" d="M3 20c.6-3.4 3-5 6-5s5.4 1.6 6 5" />,
    <circle key="c" cx="17" cy="9" r="2.4" />,
    <path key="d" d="M16.5 14.2c2.3.2 4 1.7 4.5 4.3" />,
  ),
  '/minhas-metas': svg(
    <circle key="a" cx="12" cy="12" r="8.5" />,
    <circle key="b" cx="12" cy="12" r="4.5" />,
    <path key="c" d="M12 12 19 5" />,
  ),
  '/painel': svg(<path key="a" d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
  /* Cédula com seta entrando: recebeu. A mesma cédula sem seta é "Recebimentos",
     que é a lista — o ícone precisa separar registrar de consultar. */
  '/recebimento': svg(
    <rect key="a" x="2.5" y="7" width="19" height="10" rx="2" />,
    <circle key="b" cx="12" cy="12" r="2.2" />,
    <path key="c" d="M12 2.5v3M10.3 4.2L12 5.9l1.7-1.7" />,
  ),
  /* Dois prédios: unidade é lugar físico, não setor. */
  '/unidades': svg(
    <path key="a" d="M3 21V8l6-3v16" />,
    <path key="b" d="M9 21V10l6-3v14" />,
    <path key="c" d="M15 21V12l6-3v12M2 21h20" />,
  ),
  /* Pessoa com chave: acesso, não ficha. "Equipe" é a pessoa sem a chave. */
  '/usuarios': svg(
    <circle key="a" cx="9" cy="8" r="3.2" />,
    <path key="b" d="M3 20c0-3.3 2.7-5.5 6-5.5 1 0 2 .2 2.8.6" />,
    <circle key="c" cx="17.5" cy="15.5" r="2.2" />,
    <path key="d" d="M19.2 17.2 22 20M20 18.4l1-1" />,
  ),
  /* Frasco com gota: procedimento consome insumo — é o que liga ao estoque. */
  '/procedimentos': svg(
    <path key="a" d="M10 2.5h4M11 2.5v5.2L6.6 16a3 3 0 0 0 2.6 4.5h5.6a3 3 0 0 0 2.6-4.5L13 7.7V2.5" />,
    <path key="b" d="M7.5 14.5h9" />,
  ),
  /* Livro aberto: manual, não ponto de interrogação — o conteúdo é leitura
     corrida em 14 capítulos, não uma caixa de dúvidas. */
  '/ajuda': svg(
    <path key="a" d="M12 6.5c-1.8-1.4-4-2-6.5-2H3v14h2.5c2.5 0 4.7.6 6.5 2" />,
    <path key="b" d="M12 6.5c1.8-1.4 4-2 6.5-2H21v14h-2.5c-2.5 0-4.7.6-6.5 2" />,
    <path key="c" d="M12 6.5v14" />,
  ),
}

/** Traço genérico de lista, para a rota que o mapa ainda não conhece. */
const PADRAO = svg(<path key="a" d="M4 6h16M4 12h16M4 18h10" />)

export const iconeDaRota = (href: string): ReactElement => ICONES[href] ?? PADRAO

/** Só para o teste que confronta o mapa com o menu. */
export const ROTAS_COM_ICONE: readonly string[] = Object.keys(ICONES)

/**
 * Tratamentos que vêm antes do nome e não identificam ninguém.
 *
 * Numa clínica, metade da equipe é "Dra." e a enfermagem é "Enf.". Se a
 * inicial sair do tratamento, três pessoas diferentes viram o mesmo "D" — e
 * distinguir pessoas é a única coisa que o avatar faz.
 */
const TRATAMENTOS = new Set([
  'dr', 'dra', 'drs', 'dras', 'sr', 'sra', 'srta', 'srs', 'sras',
  'enf', 'enfa', 'prof', 'profa', 'me', 'ma', 'tec', 'téc',
])

/** A inicial do avatar do rodapé. Nunca o nome inteiro, nunca uma foto. */
export const inicial = (nome: string): string => {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  // `replace` do ponto final: "Dra." e "Dra" são a mesma coisa para quem digita.
  const primeiro = partes.find((p) => !TRATAMENTOS.has(p.replace(/\.$/, '').toLowerCase()))
  return (primeiro?.[0] ?? '?').toUpperCase()
}

export const ICONE_MENU = svg(<path key="a" d="M4 7h16M4 12h16M4 17h16" />)
/* Porta à esquerda, seta saindo para a direita: a leitura de "sair" que não
   se confunde com "voltar". A seta apontando para dentro diz o contrário. */
export const ICONE_SAIR = svg(
  <path key="a" d="M9.5 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h4" />,
  <path key="b" d="m15 8.5 3.5 3.5-3.5 3.5M18.5 12H9" />,
)

/* ------------------------------------------------------------------------
 * Os ícones da ROTINA. Fora de `ICONES` de propósito: aquele mapa é o do
 * menu, e `icones.test.ts` cobra que ele case exatamente com `MENU`.
 * ---------------------------------------------------------------------- */

/** O visto dentro do círculo de concluir. */
export const ICONE_CHECK = svg(<path key="a" d="m5 12.5 4.5 4.5L19 7" strokeWidth={2.4} />)

export const ICONE_ANTERIOR = svg(<path key="a" d="m14.5 5-7 7 7 7" />)
export const ICONE_PROXIMO = svg(<path key="a" d="m9.5 5 7 7-7 7" />)

/**
 * WhatsApp: o balão com o fone, em traço.
 *
 * Desenhado e não emoji — `docs/design.md` proíbe emoji na interface — e
 * sempre com o rótulo "WhatsApp" ao lado, nunca sozinho.
 */
export const ICONE_WHATSAPP = svg(
  <path key="a" d="M20 11.5a8 8 0 0 1-11.9 7L4 20l1.6-4A8 8 0 1 1 20 11.5Z" />,
  <path key="b" d="M9.2 9.1c.2-.5.4-.5.6-.5h.5c.2 0 .4 0 .6.5l.6 1.4c.1.2 0 .4-.1.5l-.4.5c-.1.2-.2.3 0 .6a6 6 0 0 0 2.4 2c.3.1.4 0 .6-.1l.5-.5c.2-.2.3-.2.5-.1l1.4.7c.3.1.4.3.4.5 0 .5-.4 1.4-1.6 1.4-1 0-2.6-.6-4-2a7 7 0 0 1-2-3.5c0-.7.2-1.1.5-1.4Z" />,
)
