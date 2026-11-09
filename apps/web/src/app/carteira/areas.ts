import type { ContadoresDoMenuSaida, UsuarioDeGestaoPublico } from '@fir/contracts'
import { type ChaveDaCarteira, temPermCarteira } from '@fir/domain'

/**
 * **AS ÁREAS DA CARTEIRA, nos grupos e na ordem do protótipo** (`renderNav`,
 * index.html L1249–1253): Hoje · Clientes · Novos clientes · Método Firmare.
 * Um destino só entra aqui quando a tela existe — link para 404 é pior que
 * item ausente.
 *
 * Mora num `.ts` e não em `pecas.tsx` para que a regra de "qual item está
 * aceso" seja testável sem DOM (`areas.test.ts`).
 */
export type Area = {
  readonly href: string
  readonly rotulo: string
  /** A tela que a área exige — a MESMA chave que o `CarteiraGuard` confere. */
  readonly tela: ChaveDaCarteira
  /** O contador vermelho do protótipo (L1250–1251), quando a área tem um. */
  readonly badge?: { readonly de: keyof ContadoresDoMenuSaida; readonly dica: string }
}

export const GRUPOS: readonly { titulo: string; areas: readonly Area[] }[] = [
  {
    titulo: 'Hoje',
    areas: [
      { href: '/carteira', rotulo: 'Visão geral', tela: 'painel' },
      { href: '/carteira/rotina', rotulo: 'Minhas tarefas', tela: 'rotina', badge: { de: 'tarefasVencidas', dica: 'tarefas vencidas' } },
    ],
  },
  {
    titulo: 'Clientes',
    areas: [
      { href: '/carteira/clientes', rotulo: 'Carteira', tela: 'clientes' },
      { href: '/carteira/fir-clinic', rotulo: 'FIR Clinic', tela: 'firclinic' },
      { href: '/carteira/metas', rotulo: 'Metas', tela: 'metas' },
      { href: '/carteira/campanhas', rotulo: 'Campanhas', tela: 'campanhas' },
      // `resumo` é "só escopo geral" na tabela do domínio (A-5): some do menu
      // de quem é de grupo pela mesma `temPermCarteira`, sem `if` aqui.
      { href: '/carteira/resumo', rotulo: 'Resumo semanal', tela: 'resumo' },
      { href: '/carteira/mensalidades', rotulo: 'Mensalidades', tela: 'mensalidades' },
    ],
  },
  {
    titulo: 'Novos clientes',
    areas: [
      {
        href: '/carteira/leads',
        rotulo: 'Prospecção',
        tela: 'prospeccao',
        badge: { de: 'contatosAgora', dica: 'contatos recomendados agora' },
      },
    ],
  },
  {
    titulo: 'Método Firmare',
    areas: [
      { href: '/carteira/metodo/roteiros', rotulo: 'Roteiros de briefing', tela: 'metodo' },
      { href: '/carteira/metodo/biblioteca', rotulo: 'Biblioteca de materiais', tela: 'metodo' },
      { href: '/carteira/metodo/checklists', rotulo: 'Checklists', tela: 'metodo' },
      { href: '/carteira/metodo/mensagens', rotulo: 'Mensagens automáticas', tela: 'metodo' },
    ],
  },
]

/**
 * A primeira área que a sessão pode abrir, na ordem do menu — para onde vai
 * quem abre `/carteira` sem a Visão geral (o protótipo faz o mesmo:
 * `MODULOS.find(can) || "rotina"`, L1266).
 */
export function primeiraAreaPermitida(usuario: UsuarioDeGestaoPublico): string {
  for (const g of GRUPOS) {
    for (const a of g.areas) if (a.href !== '/carteira' && temPermCarteira(usuario, a.tela)) return a.href
  }
  return '/carteira/metodo/roteiros'
}

/**
 * Telas que não são item de menu mas MORAM numa área: a carga da equipe é
 * parte de "Minhas tarefas", e a ficha de entrada de uma cliente é parte da
 * Carteira. Antes da lateral cada página dizia isto à mão (`atual=`); agora é
 * uma tabela só.
 */
const MORA_EM: readonly { readonly prefixo: string; readonly area: string }[] = [
  { prefixo: '/carteira/carga', area: '/carteira/rotina' },
  { prefixo: '/carteira/entrada/', area: '/carteira/clientes' },
]

const HREFS: readonly string[] = GRUPOS.flatMap((g) => g.areas.map((a) => a.href))

const sobPrefixo = (caminho: string, prefixo: string): boolean =>
  prefixo.endsWith('/') ? caminho.startsWith(prefixo) : caminho === prefixo || caminho.startsWith(`${prefixo}/`)

/**
 * O item do menu que fica aceso no `caminho` — ou `null` quando a tela não é
 * de área nenhuma (a lista de entradas, `/carteira/entrada`, nunca acendeu
 * nada, e continua assim).
 *
 * `/carteira` só acende na Visão geral EXATA: por prefixo ela acenderia em
 * toda tela da carteira.
 */
export function areaDoCaminho(caminho: string): string | null {
  const c = caminho.length > 1 ? caminho.replace(/\/+$/, '') : caminho
  if (c === '/carteira') return '/carteira'
  for (const m of MORA_EM) if (sobPrefixo(c, m.prefixo)) return m.area
  let melhor: string | null = null
  for (const h of HREFS) {
    if (h === '/carteira') continue
    if (sobPrefixo(c, h) && (melhor === null || h.length > melhor.length)) melhor = h
  }
  return melhor
}
