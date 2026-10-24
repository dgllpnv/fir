import { describe, expect, it } from 'vitest'
import { ROTAS_COM_ICONE, inicial } from './icones'
import { MENU } from './menu'

/**
 * O mapa de ícones tem um fallback: rota desconhecida recebe um traço de lista
 * genérico. Isso é bom para não quebrar a tela e péssimo para ser notado — a
 * tela nova do épico 5 entraria no menu com o mesmo ícone de outras três e
 * ninguém veria. Esta varredura é o que torna o esquecimento visível.
 */
describe('todo item do menu tem ícone próprio', () => {
  it('nenhuma rota do menu cai no ícone genérico', () => {
    const semIcone = MENU.filter((i) => !ROTAS_COM_ICONE.includes(i.href)).map((i) => i.href)
    expect(semIcone, 'sem ícone em lib/icones.tsx — cairiam todas no traço genérico').toEqual([])
  })

  it('nenhum ícone sobrando de uma rota que saiu do menu', () => {
    const hrefs = new Set(MENU.map((i) => i.href))
    expect(ROTAS_COM_ICONE.filter((r) => !hrefs.has(r))).toEqual([])
  })
})

describe('inicial do avatar', () => {
  it('é a primeira letra, maiúscula, sem o espaço de um nome mal digitado', () => {
    expect(inicial('  helena prado')).toBe('H')
    expect(inicial('Dra. Helena')).toBe('D')
  })

  it('nome vazio não quebra o rodapé do menu', () => {
    expect(inicial('')).toBe('?')
    expect(inicial('   ')).toBe('?')
  })
})
