import { perfisPadrao } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { itensDoMenu, secoesDoMenu } from './menu'

const perfis = perfisPadrao()
const href = (u: { admin: boolean; perfilId: string | null }) =>
  itensDoMenu(u, perfis).map((i) => i.href)

describe('menu por permissão', () => {
  it('administrador vê tudo', () => {
    expect(href({ admin: true, perfilId: null })).toHaveLength(21)
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

describe('seções do menu', () => {
  it('a ordem dos grupos é a do dia da recepção, não a alfabética', () => {
    const s = secoesDoMenu(itensDoMenu({ admin: true, perfilId: null }, perfis))
    expect(s.map((x) => x.grupo)).toEqual([
      'Dia a dia',
      'Comercial',
      'Financeiro',
      'Processos',
      'Pessoas',
      'Gestão',
    ])
  })

  it('grupo sem item não vira título órfão', () => {
    // A Enfermagem não enxerga nada de Financeiro. Um título "FINANCEIRO"
    // sozinho diria a ela que existe algo ali que não abre.
    const s = secoesDoMenu(itensDoMenu({ admin: false, perfilId: 'pf_enf' }, perfis))
    expect(s.map((x) => x.grupo)).not.toContain('Financeiro')
    for (const sec of s) expect(sec.itens.length, `seção ${sec.grupo} vazia`).toBeGreaterThan(0)
  })

  it('Gestão aparece para todos, mas só com o manual', () => {
    // Gestão não serve de exemplo de grupo vazio: `/ajuda` é de todos, então o
    // título sempre tem ao menos um item embaixo. Para a Enfermagem é só ele —
    // nada de Unidades, Usuários ou Procedimentos.
    const s = secoesDoMenu(itensDoMenu({ admin: false, perfilId: 'pf_enf' }, perfis))
    const gestao = s.find((x) => x.grupo === 'Gestão')
    expect(gestao?.itens.map((i) => i.href)).toEqual(['/ajuda'])
  })

  it('nenhum item se perde no agrupamento', () => {
    for (const u of [
      { admin: true, perfilId: null },
      { admin: false, perfilId: 'pf_rec' },
      { admin: false, perfilId: 'pf_enf' },
      { admin: false, perfilId: null },
    ]) {
      const itens = itensDoMenu(u, perfis)
      const agrupados = secoesDoMenu(itens).flatMap((s) => s.itens)
      expect(agrupados.map((i) => i.href).sort()).toEqual(itens.map((i) => i.href).sort())
    }
  })
})
