import { perfisPadrao } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { type BlocoDeMenu, LAYOUT_DO_MENU, MENU, itensDoMenu, secoesDoMenu } from './menu'

const perfis = perfisPadrao()
const href = (u: { admin: boolean; perfilId: string | null }) =>
  itensDoMenu(u, perfis).map((i) => i.href)

describe('menu por permissão', () => {
  it('administrador vê tudo', () => {
    expect(href({ admin: true, perfilId: null })).toHaveLength(24)
  })

  it('enfermagem vê programas e estoque, não vê financeiro', () => {
    const h = href({ admin: false, perfilId: 'pf_enf' })
    expect(h).toContain('/programas')
    expect(h).toContain('/estoque')
    expect(h).not.toContain('/recebimentos')
    expect(h).not.toContain('/visao-do-mes')
  })

  it('financeiro vê visão do mês porque tem valores junto', () => {
    expect(href({ admin: false, perfilId: 'pf_fin' })).toContain('/visao-do-mes')
  })

  it('recepção não vê visão do mês — não tem valores', () => {
    expect(href({ admin: false, perfilId: 'pf_rec' })).not.toContain('/visao-do-mes')
  })

  it('o que é de todos, inclusive de quem não tem perfil', () => {
    const h = href({ admin: false, perfilId: null })
    // `/ajuda` entra aqui de propósito: o manual é como a equipe aprende a
    // ferramenta, e exigir permissão para ler o manual é exigir permissão
    // para aprender. É o que o protótipo faz.
    expect(h).toEqual(['/hoje', '/tarefas', '/nova', '/minhas-metas', '/ajuda'])
  })
})

const blocosDe = (u: { admin: boolean; perfilId: string | null }) =>
  secoesDoMenu(itensDoMenu(u, perfis))
const ADMIN = { admin: true, perfilId: null }
const nomeDoBloco = (b: BlocoDeMenu): string =>
  b.tipo === 'link' ? b.item.href : b.tipo === 'grupo' ? `[${b.titulo}]` : b.tipo === 'acoes' ? '+acoes' : '---'
const hrefsDoBloco = (b: BlocoDeMenu): string[] =>
  b.tipo === 'link' ? [b.item.href] : b.tipo === 'separador' ? [] : b.itens.map((i) => i.href)

describe('seções do menu', () => {
  it('o administrador vê a ordem aprovada: títulos soltos, ações e grupos', () => {
    // Estoque é um grupo de um item só e vira link direto; Painel e Ajuda são
    // soltos; Configurações é o penúltimo.
    expect(blocosDe(ADMIN).map(nomeDoBloco)).toEqual([
      '/hoje',
      '/tarefas',
      '+acoes',
      '[Comercial]',
      '[Financeiro]',
      '/estoque',
      '[Pessoas]',
      '---',
      '/painel',
      '[Configurações]',
      '/ajuda',
    ])
  })

  it('o conteúdo dos grupos do administrador', () => {
    const g = (t: string) => {
      const b = blocosDe(ADMIN).find((x) => x.tipo === 'grupo' && x.titulo === t)
      return b ? hrefsDoBloco(b) : []
    }
    expect(g('Comercial')).toEqual(['/jornada', '/pacientes', '/programas', '/campanhas'])
    expect(g('Financeiro')).toEqual(['/recebimentos', '/caixa', '/contas', '/cobrancas', '/visao-do-mes'])
    expect(g('Pessoas')).toEqual(['/equipe', '/minhas-metas'])
    expect(g('Configurações')).toEqual([
      '/unidades', '/usuarios', '/procedimentos', '/atividades', '/agenda-do-sistema', '/grupos-da-clinica',
    ])
  })

  it('o administrador continua com os 24 itens, só reorganizados', () => {
    const todos = blocosDe(ADMIN).flatMap(hrefsDoBloco)
    expect(todos).toHaveLength(24)
    expect(new Set(todos).size).toBe(24)
  })

  it('grupo sem item não vira título órfão', () => {
    // A Enfermagem não enxerga nada de Financeiro. Um título "FINANCEIRO"
    // sozinho diria a ela que existe algo ali que não abre.
    const b = blocosDe({ admin: false, perfilId: 'pf_enf' })
    expect(b.map(nomeDoBloco)).not.toContain('[Financeiro]')
    for (const x of b) if (x.tipo === 'grupo') expect(x.itens.length).toBeGreaterThan(1)
  })

  it('grupo que sobra com um item só vira link direto', () => {
    // Sem `pessoas.gerir` só resta "Minhas metas": abrir uma lista para uma
    // única opção seria um toque a mais sem motivo.
    const b = blocosDe({ admin: false, perfilId: null })
    expect(b.map(nomeDoBloco)).toEqual(['/hoje', '/tarefas', '+acoes', '/minhas-metas', '---', '/ajuda'])
  })

  it('sem Painel nem Configurações, o separador ainda separa o que sobrou', () => {
    const n = blocosDe({ admin: false, perfilId: 'pf_enf' }).map(nomeDoBloco)
    expect(n[0]).not.toBe('---')
    expect(n.at(-1)).not.toBe('---')
    expect(n.join(' ')).not.toContain('--- ---')
  })

  it('nenhum item se perde nem se repete, em nenhum perfil', () => {
    for (const u of [
      ADMIN,
      { admin: false, perfilId: 'pf_rec' },
      { admin: false, perfilId: 'pf_enf' },
      { admin: false, perfilId: 'pf_fin' },
      { admin: false, perfilId: null },
    ]) {
      const itens = itensDoMenu(u, perfis)
      const agrupados = secoesDoMenu(itens).flatMap(hrefsDoBloco)
      expect(agrupados.sort()).toEqual(itens.map((i) => i.href).sort())
    }
  })

  it('o layout cobre o MENU inteiro, e o grupo de cada item bate com o do layout', () => {
    const noLayout = LAYOUT_DO_MENU.flatMap((e) =>
      e.tipo === 'link' ? [e.href] : e.tipo === 'grupo' ? [...e.hrefs] : [],
    )
    const acoes = MENU.filter((i) => i.acao === true).map((i) => i.href)
    expect([...noLayout, ...acoes].sort()).toEqual(MENU.map((i) => i.href).sort())
    for (const e of LAYOUT_DO_MENU) {
      if (e.tipo !== 'grupo') continue
      for (const h of e.hrefs) expect(MENU.find((i) => i.href === h)?.grupo, h).toBe(e.titulo)
    }
  })
})
