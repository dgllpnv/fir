import { perfisPadrao } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { itensDoMenu } from './menu.js'

const perfis = perfisPadrao()
const href = (u: { admin: boolean; perfilId: string | null }) =>
  itensDoMenu(u, perfis).map((i) => i.href)

describe('menu por permissão', () => {
  it('administrador vê tudo', () => {
    expect(href({ admin: true, perfilId: null })).toHaveLength(17)
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

  it('Hoje, Nova e Minhas metas são de todos, inclusive sem perfil', () => {
    const h = href({ admin: false, perfilId: null })
    expect(h).toEqual(['/hoje', '/tarefas', '/nova', '/minhas-metas'])
  })
})
