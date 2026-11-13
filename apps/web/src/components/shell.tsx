'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { chamar } from '@/lib/api'
import {
  ICONE_CHEVRON,
  ICONE_MENU,
  ICONE_PAINEL_DE_GESTAO,
  ICONE_SAIR,
  iconeDaRota,
  iconeDoGrupo,
  inicial,
} from '@/lib/icones'
import { type ItemDeMenu, secoesDoMenu } from '@/lib/menu'
import { SeletorDeTema } from './seletor-de-tema'

/**
 * Hover só onde existe hover de verdade: mouse, e janela de computador. No
 * celular e no tablet o grupo abre por TOQUE, sempre — o hover nunca é o único
 * caminho (390 px é o caso principal).
 */
const COM_HOVER = '(hover: hover) and (pointer: fine) and (min-width: 900px)'
const COMPUTADOR = '(min-width: 900px)'
/**
 * Tolerância para o mouse em diagonal, de um grupo para a lista dele. Soma-se à
 * ponte invisível de 12 px do protótipo (`.navfly::before`): a ponte cobre o
 * trajeto reto; o atraso cobre o trajeto torto e o tremor da mão.
 */
const ATRASO_DE_FECHAR_MS = 150

/**
 * O casco: barra lateral no computador, gaveta no celular.
 *
 * É cliente por dois motivos, e só por esses dois: o item ativo depende da
 * rota atual (`usePathname`) e a gaveta (e os grupos) têm estado de
 * aberta/fechada. **Quem decide o que entra no menu continua sendo o
 * servidor** — `itensDoMenu` roda no layout, com a sessão de `lib/sessao`, e o
 * que chega aqui já veio filtrado por permissão. Refiltrar aqui seria
 * reimplementar o controle de acesso no lugar errado.
 *
 * O menu mostra só os TÍTULOS; os itens de cada grupo ficam numa lista que
 * abre ao passar o mouse (computador) ou ao tocar (sempre), e na gaveta do
 * celular vira um acordeão. É o padrão disclosure — botão com `aria-expanded`
 * e `aria-controls` — e NÃO `role="menu"`, que prometeria setas e foco
 * gerenciado que não existem.
 */
export function Shell({
  itens,
  clinica,
  usuario,
  funcao,
  suporte,
  children,
}: {
  itens: readonly ItemDeMenu[]
  clinica: string
  usuario: string
  funcao: string
  /**
   * A sessão é a de SUPORTE do painel (D-13).
   *
   * O casco não muda de forma por causa disto — só cede o topo: a faixa
   * dourada já está grudada em `top: 0`, e com as duas `sticky` a de baixo
   * ficaria escondida atrás dela. Ver `shell.css`,
   * `.shell[data-suporte='sim'] .topbar`.
   */
  suporte: boolean
  children: ReactNode
}) {
  const rota = usePathname()
  const [aberta, setAberta] = useState(false)
  const botaoMenu = useRef<HTMLButtonElement>(null)
  const gaveta = useRef<HTMLElement>(null)
  // `secoesDoMenu` já devolve as ações (pílulas) no lugar certo e tira os
  // títulos órfãos; aqui só se desenha.
  const blocos = secoesDoMenu(itens)
  const ativo = (href: string) => rota === href || rota.startsWith(`${href}/`)
  const grupoAtivo = blocos.findIndex(
    (b) => b.tipo === 'grupo' && b.itens.some((i) => ativo(i.href)),
  )

  // Grupo aberto: `fixo` = aberto por clique/teclado (não fecha ao tirar o
  // mouse); sem `fixo` = aberto só por hover.
  const [grupoAberto, setGrupoAberto] = useState<{ i: number; fixo: boolean } | null>(null)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  const botoesDeGrupo = useRef(new Map<number, HTMLButtonElement>())
  const listas = useRef(new Map<number, HTMLDivElement>())
  const cancelarFechar = () => {
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = null
  }

  // Trocar de tela fecha a gaveta. Sem isto, no celular a pessoa toca o item e
  // continua olhando para o menu, sem saber se algo aconteceu.
  useEffect(() => {
    setAberta(false)
  }, [rota])

  // Na gaveta, o grupo da tela atual já nasce aberto; no computador, nenhum.
  useEffect(() => {
    cancelarFechar()
    setGrupoAberto(aberta && grupoAtivo >= 0 ? { i: grupoAtivo, fixo: true } : null)
  }, [aberta, rota, grupoAtivo])

  // A lista do computador é `position: fixed` — a lateral rola (`overflow-y`),
  // e uma lista absoluta seria cortada por ela. As coordenadas saem do botão,
  // e a lista sobe se não couber embaixo (janela baixa). Via variáveis CSS, e
  // só no computador: na gaveta a lista é do fluxo e não usa nada disto.
  useLayoutEffect(() => {
    if (!grupoAberto) return
    const btn = botoesDeGrupo.current.get(grupoAberto.i)
    const lista = listas.current.get(grupoAberto.i)
    if (!btn || !lista || !window.matchMedia(COMPUTADOR).matches) return
    const r = btn.getBoundingClientRect()
    const margem = 8
    const maximo = window.innerHeight - 2 * margem
    const altura = Math.min(lista.offsetHeight, maximo)
    const topo = Math.max(margem, Math.min(r.top - 6, window.innerHeight - altura - margem))
    lista.style.setProperty('--fly-top', `${topo}px`)
    lista.style.setProperty('--fly-left', `${r.right + 6}px`)
    lista.style.setProperty('--fly-max', `${maximo}px`)
  }, [grupoAberto])

  // Tocar fora do grupo ou redimensionar fecha a lista do computador.
  useEffect(() => {
    if (!grupoAberto) return
    const fora = (e: PointerEvent) => {
      // Na gaveta (celular) a lista é em linha: fechar no pointerdown faz o
      // botão tocado subir antes do clique e o toque cai em outro grupo.
      if (!window.matchMedia(COMPUTADOR).matches) return
      if (!(e.target as Element).closest?.(`[data-g="${grupoAberto.i}"]`)) setGrupoAberto(null)
    }
    const fechar = () => {
      if (window.matchMedia(COMPUTADOR).matches) setGrupoAberto(null)
    }
    document.addEventListener('pointerdown', fora)
    window.addEventListener('resize', fechar)
    return () => {
      document.removeEventListener('pointerdown', fora)
      window.removeEventListener('resize', fechar)
    }
  }, [grupoAberto])

  // Abrir leva o foco para o PRIMEIRO item da gaveta. Sem isto, quem abre pelo
  // teclado continua com o foco no botão "Menu", que está atrás do véu: o Tab
  // seguinte entra no conteúdo encoberto, e não no menu que acabou de
  // aparecer. O foco vai para um link de verdade, e não para a <aside>, para
  // o anel de foco cair sobre algo que a pessoa pode acionar.
  useEffect(() => {
    if (aberta) gaveta.current?.querySelector<HTMLAnchorElement>('.navitem')?.focus()
  }, [aberta])

  // Esc fecha, e o foco volta para o botão que abriu — senão o foco fica numa
  // gaveta invisível e o próximo Tab parece não fazer nada.
  useEffect(() => {
    if (!aberta) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberta(false)
        botaoMenu.current?.focus()
      }
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [aberta])

  async function sair() {
    // `catch` vazio de propósito: se a chamada falhar, o cookie pode ter
    // morrido do outro lado assim mesmo. Deixar a pessoa presa numa tela que
    // diz "não consegui sair" é pior do que mandá-la para a entrada, onde o
    // servidor decide de novo se ela está dentro ou fora.
    await chamar('v1/sair', { method: 'POST' }).catch(() => undefined)
    // Navegação COMPLETA, e `replace`: o Router Cache do Next guarda as telas
    // autenticadas e o Voltar as restaura sem pedir nada ao servidor.
    window.location.replace('/entrar')
  }

  return (
    <div className="shell" data-suporte={suporte ? 'sim' : 'nao'}>
      <aside
        className="side"
        id="menu-lateral"
        aria-label="Menu"
        ref={gaveta}
        data-aberta={aberta ? 'sim' : 'nao'}
      >
        <div className="sidehead">
          <div className="marca">
            FIR Clinic<span>.</span>
          </div>
          <div className="sideclin">{clinica || 'FIR Clinic'}</div>
        </div>

        <nav className="sidenav" aria-label="Seções" onScroll={() => setGrupoAberto(null)}>
          {blocos.map((b, i) => {
            if (b.tipo === 'separador') {
              return <div className="navsep" key={`sep${i}`} role="separator" />
            }
            if (b.tipo === 'link') {
              return (
                <Link
                  key={b.item.href}
                  href={b.item.href}
                  className="navitem"
                  aria-current={ativo(b.item.href) ? 'page' : undefined}
                >
                  {iconeDaRota(b.item.href)}
                  <span>{b.item.rotulo}</span>
                </Link>
              )
            }
            if (b.tipo === 'acoes') {
              /*
                As AÇÕES, em pílulas, logo abaixo de Hoje e Tarefas (o lugar do
                protótipo). "Nova tarefa" e "Recebimento" criam alguma coisa —
                não são lugares para onde se vai — e continuam itens de menu:
                somem para quem não pode.
              */
              return (
                <div className="navacoes" key="acoes">
                  {b.itens.map((it) => (
                    <Link
                      key={it.href}
                      href={it.href}
                      className="navacao"
                      aria-current={ativo(it.href) ? 'page' : undefined}
                    >
                      <span aria-hidden="true">+</span>
                      {it.rotulo}
                    </Link>
                  ))}
                </div>
              )
            }
            const aberto = grupoAberto?.i === i
            const idLista = `navfly-${i}`
            return (
              <div
                className="navg"
                key={b.titulo}
                data-g={i}
                data-aberto={aberto ? 'sim' : 'nao'}
                onPointerEnter={(e) => {
                  if (e.pointerType !== 'mouse' || !window.matchMedia(COM_HOVER).matches) return
                  cancelarFechar()
                  setGrupoAberto((g) => (g?.i === i ? g : { i, fixo: false }))
                }}
                onPointerLeave={(e) => {
                  if (e.pointerType !== 'mouse' || !window.matchMedia(COM_HOVER).matches) return
                  cancelarFechar()
                  temporizador.current = setTimeout(
                    () => setGrupoAberto((g) => (g && !g.fixo && g.i === i ? null : g)),
                    ATRASO_DE_FECHAR_MS,
                  )
                }}
                onKeyDown={(e) => {
                  // Na gaveta o Esc é do `document` e fecha a gaveta inteira.
                  if (e.key !== 'Escape' || !aberto || !window.matchMedia(COMPUTADOR).matches) return
                  e.stopPropagation()
                  setGrupoAberto(null)
                  botoesDeGrupo.current.get(i)?.focus()
                }}
                onBlur={(e) => {
                  // Tab para fora do grupo fecha a lista aberta por teclado.
                  if (
                    aberto &&
                    grupoAberto?.fixo &&
                    window.matchMedia(COMPUTADOR).matches &&
                    !e.currentTarget.contains(e.relatedTarget)
                  ) {
                    setGrupoAberto(null)
                  }
                }}
              >
                <button
                  type="button"
                  className="navgbtn"
                  ref={(el) => {
                    if (el) botoesDeGrupo.current.set(i, el)
                    else botoesDeGrupo.current.delete(i)
                  }}
                  aria-expanded={aberto}
                  aria-controls={idLista}
                  aria-current={i === grupoAtivo ? 'true' : undefined}
                  onClick={() =>
                    setGrupoAberto((g) => (g?.i === i && g.fixo ? null : { i, fixo: true }))
                  }
                >
                  {iconeDoGrupo(b.titulo)}
                  <span>{b.titulo}</span>
                  <span className="navchev" aria-hidden="true">
                    {ICONE_CHEVRON}
                  </span>
                </button>
                <div
                  className="navfly"
                  id={idLista}
                  ref={(el) => {
                    if (el) listas.current.set(i, el)
                    else listas.current.delete(i)
                  }}
                >
                  <div className="navfly-caixa">
                    <div className="navflyt">{b.titulo}</div>
                    {b.itens.map((it) => (
                      <Link
                        key={it.href}
                        href={it.href}
                        className="navitem"
                        aria-current={ativo(it.href) ? 'page' : undefined}
                      >
                        {iconeDaRota(it.href)}
                        <span>{it.rotulo}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
          {/*
            O ATALHO PARA O PAINEL — só na sessão de SUPORTE do operador.

            `suporte` vem de `lib/sessao`, resolvido no servidor: só existe
            quando o cookie de operador abriu esta clínica. A recepcionista
            nunca tem esta sessão, então nunca vê o item; a rota `/gestao`
            segue exigindo o login do painel de qualquer jeito.

            `<a>`: `/gestao` tem casco próprio, fora do grupo `(app)`.
          */}
          {suporte ? (
            <a className="navitem" href="/gestao" data-atalho="painel-de-gestao">
              {ICONE_PAINEL_DE_GESTAO}
              <span>Painel de gestão</span>
            </a>
          ) : null}
        </nav>

        <div className="sidefoot">
          <div className="sideuser">
            <div className="avatar" aria-hidden="true">
              {inicial(usuario)}
            </div>
            <div className="sideuser-nome">
              <b>{usuario}</b>
              {funcao ? <small>{funcao}</small> : null}
            </div>
            <SeletorDeTema id="tema-lateral" lugar="rodape" />
          </div>
          {/*
            "Trocar senha" ao lado de "Sair", e não numa linha própria: o
            rodapé fica com duas linhas e sobra altura para os títulos.

            `<a>` e não `<Link>`: `/trocar-senha` está FORA do grupo `(app)`,
            não tem a Shell, e a navegação do cliente deixaria a lateral
            montada por cima de uma tela que não a tem. O manual (cap. 2,
            "Trocar a senha") descreve este botão.
          */}
          <div className="sidefoot-acoes">
            <a className="btn ghost" href="/trocar-senha">
              Trocar senha
            </a>
            <button type="button" className="btn ghost" onClick={sair}>
              {ICONE_SAIR}
              Sair
            </button>
          </div>
        </div>
      </aside>

      {aberta ? (
        <button type="button" className="scrim" aria-label="Fechar o menu" onClick={() => setAberta(false)} />
      ) : null}

      <div className="conteudo">
        <header className="topbar">
          <div className="barra-do-topo">
            <button
              type="button"
              className="botao-menu"
              ref={botaoMenu}
              aria-controls="menu-lateral"
              aria-expanded={aberta}
              onClick={() => setAberta(true)}
            >
              {ICONE_MENU}
              Menu
            </button>
            <div className="marca">
              FIR Clinic<span>.</span>
            </div>
            <div className="quem">{usuario}</div>
            <SeletorDeTema id="tema-topo" lugar="topo" />
          </div>
        </header>
        <main className="wrap">{children}</main>
      </div>
    </div>
  )
}
