'use client'

import type { ContadoresDoMenuSaida, UsuarioDeGestaoPublico } from '@fir/contracts'
import { type ChaveDaCarteira, temPermCarteira } from '@fir/domain'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { chamar } from '@/lib/api'
import { useCarteira } from './contexto'

/**
 * As peças compartilhadas das telas de DADO da carteira (depois da porta).
 * Mesma forma de `superadmin/pecas.tsx` — nenhum `style` inline, tudo em
 * `packages/ui/src/carteira.css`.
 */

/**
 * **AS ÁREAS DA CARTEIRA, nos grupos e na ordem do protótipo** (`renderNav`,
 * index.html L1249–1253): Hoje · Clientes · Novos clientes · Método Firmare ·
 * Administração. Mesmo padrão de `NavDoPainel`: cada tela chama isto no topo,
 * e `aria-current="page"` diz onde se está. Um destino só entra aqui quando a
 * tela existe — link para 404 é pior que item ausente.
 */
type Area = {
  readonly href: string
  readonly rotulo: string
  /** A tela que a área exige — a MESMA chave que o `CarteiraGuard` confere. */
  readonly tela: ChaveDaCarteira
  /** O contador vermelho do protótipo (L1250–1251), quando a área tem um. */
  readonly badge?: { readonly de: keyof ContadoresDoMenuSaida; readonly dica: string }
}

const GRUPOS: readonly { titulo: string; areas: readonly Area[] }[] = [
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
 * O MENU: cada item só aparece se o perfil tem a tela (`can(k)`, L1252), pela
 * MESMA `temPermCarteira` do servidor (regra 16) — a tela é conveniência, o
 * guard é quem recusa. Os badges são CONTAGENS do servidor
 * (`GET /v1/carteira/eu/contadores`), nunca contados aqui; falhar em buscá-los
 * só deixa o menu sem badge.
 */
export function NavDaCarteira({ atual }: { atual: string }) {
  const { sessao } = useCarteira()
  const usuario = sessao.tag === 'pronta' ? sessao.usuarioDeGestao : null
  const [contadores, setContadores] = useState<ContadoresDoMenuSaida | null>(null)

  useEffect(() => {
    if (usuario === null) return
    let valeu = true
    chamar<ContadoresDoMenuSaida>('v1/carteira/eu/contadores')
      .then((c) => {
        if (valeu) setContadores(c)
      })
      .catch(() => {})
    return () => {
      valeu = false
    }
  }, [usuario])

  // Antes de saber quem é, o menu inteiro (o guard recusa o que não for dela).
  const pode = (a: Area) => usuario === null || temPermCarteira(usuario, a.tela)

  return (
    <nav className="carteira-nav carteira-nav-grupos" aria-label="Áreas da carteira">
      {GRUPOS.map((g) => {
        const areas = g.areas.filter(pode)
        if (areas.length === 0) return null
        return (
          <div key={g.titulo} className="carteira-nav-grupo">
            <span className="carteira-nav-titulo">{g.titulo}</span>
            {areas.map((a) => {
              const n = a.badge ? contadores?.[a.badge.de] : null
              return (
                <Link
                  key={a.href}
                  href={a.href}
                  className={a.href === atual ? 'link carteira-nav-atual' : 'link'}
                  aria-current={a.href === atual ? 'page' : undefined}
                >
                  {a.rotulo}
                  {a.badge && typeof n === 'number' && n > 0 ? (
                    <span className="visao-nav-badge num" title={a.badge.dica} aria-label={`${n} ${a.badge.dica}`}>
                      {n}
                    </span>
                  ) : null}
                </Link>
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}

/**
 * O erro diz o que aconteceu e DÁ SAÍDA (`design.md` §4) — mas a saída de
 * `Erro` (`components/estados.tsx`) é "Ir para Hoje", uma rota do PRODUTO que
 * a sessão de `Usuário de Gestão` não tem (ela cairia na entrada da clínica).
 * Aqui a saída é a primeira tela da carteira — mesma razão de `ErroDoPainel`.
 */
export function ErroDaCarteira({
  mensagem,
  recarregar,
}: {
  mensagem: string
  recarregar: () => void
}) {
  return (
    <div className="carteira-erro" role="alert">
      <p>{mensagem}</p>
      <div className="carteira-erro-acoes">
        <button type="button" className="btn" onClick={recarregar}>
          Tentar de novo
        </button>
        <Link className="btn ghost" href="/carteira/clientes">
          Ir para Clientes
        </Link>
      </div>
    </div>
  )
}
