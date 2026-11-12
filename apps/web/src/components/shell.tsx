'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { chamar } from '@/lib/api'
import { ControleDeTema } from './controle-de-tema'
import { ICONE_MENU, ICONE_PAINEL_DE_GESTAO, ICONE_SAIR, iconeDaRota, inicial } from '@/lib/icones'
import { type ItemDeMenu, secoesDoMenu } from '@/lib/menu'

/**
 * O casco: barra lateral no computador, gaveta no celular.
 *
 * É cliente por dois motivos, e só por esses dois: o item ativo depende da
 * rota atual (`usePathname`) e a gaveta tem estado de aberta/fechada. **Quem
 * decide o que entra no menu continua sendo o servidor** — `itensDoMenu` roda
 * no layout, com a sessão de `lib/sessao`, e o que chega aqui já veio filtrado
 * por permissão. Refiltrar aqui seria reimplementar o controle de acesso no
 * lugar errado.
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
  const acoes = itens.filter((i) => i.acao === true)
  // As ações saem do menu: elas já estão acima, como botão. Repeti-las na
  // lista seria o mesmo destino duas vezes na mesma barra.
  const secoes = secoesDoMenu(itens.filter((i) => i.acao !== true))

  // Trocar de tela fecha a gaveta. Sem isto, no celular a pessoa toca o item e
  // continua olhando para o menu, sem saber se algo aconteceu.
  useEffect(() => setAberta(false), [rota])

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

  const ativo = (href: string) => rota === href || rota.startsWith(`${href}/`)

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

        {/*
          As AÇÕES vêm antes do menu, e são botões.

          "Nova tarefa" e "Recebimento" são as duas coisas mais frequentes que
          a recepção faz, e as duas criam alguma coisa — não são lugares para
          onde se vai. Enterrá-las no meio de dezessete links é enterrar o
          caminho de dois toques dentro de uma lista (`docs/design.md` §1).
          Elas continuam sendo itens de menu: somem para quem não pode.
        */}
        {acoes.length > 0 ? (
          <div className="sideacoes">
            {acoes.map((i) => (
              <Link key={i.href} href={i.href} className="btn ghost acao">
                <span aria-hidden="true">+</span>
                {i.rotulo}
              </Link>
            ))}
          </div>
        ) : null}

        <nav className="sidenav" aria-label="Seções">
          {secoes.map((s) => (
            <div className="navgrupo" key={s.grupo}>
              <div className="navtit">{s.grupo}</div>
              {s.itens.map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  className="navitem"
                  aria-current={ativo(i.href) ? 'page' : undefined}
                >
                  {iconeDaRota(i.href)}
                  <span>{i.rotulo}</span>
                </Link>
              ))}
            </div>
          ))}
          {/*
            O ATALHO PARA O PAINEL — só na sessão de SUPORTE do operador.

            `suporte` vem de `lib/sessao`, resolvido no servidor: só existe
            quando o cookie de operador abriu esta clínica. A recepcionista
            nunca tem esta sessão, então nunca vê o item; a rota `/gestao`
            segue exigindo o login do painel de qualquer jeito.

            `<a>`: `/gestao` tem casco próprio, fora do grupo `(app)`.
          */}
          {suporte ? (
            <div className="navgrupo">
              <a className="navitem" href="/gestao" data-atalho="painel-de-gestao">
                {ICONE_PAINEL_DE_GESTAO}
                <span>Painel de gestão</span>
              </a>
            </div>
          ) : null}
        </nav>

        <div className="sidefoot">
          <ControleDeTema />
          <div className="sideuser">
            <div className="avatar" aria-hidden="true">
              {inicial(usuario)}
            </div>
            <div>
              <b>{usuario}</b>
              {funcao ? <small>{funcao}</small> : null}
            </div>
          </div>
          {/*
            "Trocar senha", embaixo do nome — é o "Trocar meu PIN" dela, no
            lugar em que ela o pôs.

            A rota já existia e só era alcançada pelo DESVIO do primeiro
            acesso (`lib/sessao` manda para lá quem tem senha provisória), ou
            seja: quem quisesse trocar a senha por vontade própria tinha de
            digitar o endereço. O manual (cap. 2, "Trocar a senha") descreve
            este botão, e um manual que descreve um botão que não existe é
            pior que nenhum.

            `<a>` e não `<Link>`: `/trocar-senha` está FORA do grupo `(app)`,
            não tem a Shell, e a navegação do cliente deixaria a lateral
            montada por cima de uma tela que não a tem.
          */}
          <a className="btn ghost" href="/trocar-senha">
            Trocar senha
          </a>
          <button type="button" className="btn ghost" onClick={sair}>
            {ICONE_SAIR}
            Sair
          </button>
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
          </div>
        </header>
        <main className="wrap">{children}</main>
      </div>
    </div>
  )
}
